// mapping.js
// ---------------------------------------------------------------------------
// Real-time projection mapping ("corner-pin" warping).
//
// The physics scene is first rendered flat onto an offscreen "source" canvas.
// Then, for each user-defined SURFACE (a quad with 4 draggable corners), we
// warp that source image onto the quad so it lines up with a real-world object
// face on the facade. Drag the corners until the projected image matches the
// physical edges — that's projection mapping.
//
// Why subdivided triangles?
//   Canvas2D can only do *affine* transforms (no true perspective). To fake a
//   perspective warp we map a UNIT SQUARE -> the destination quad with a proper
//   3x3 homography, sample that homography on a fine grid, and draw each little
//   grid cell as two affine-textured triangles. With enough cells the result is
//   visually perspective-correct — and it needs no WebGL or extra dependency.

import { config } from './config.js';

const warpCache = new WeakMap();

// ---------------------------------------------------------------------------
// Homography: unit square (0,0),(1,0),(1,1),(0,1) -> quad p0,p1,p2,p3
// Returns the 8 coefficients of the projective transform (Heckbert's method).
// Apply with projectPoint() below.
// ---------------------------------------------------------------------------
function squareToQuad(p0, p1, p2, p3) {
  const x0 = p0[0], y0 = p0[1];
  const x1 = p1[0], y1 = p1[1];
  const x2 = p2[0], y2 = p2[1];
  const x3 = p3[0], y3 = p3[1];

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;

  let a11, a12, a13, a21, a22, a23, a31, a32;

  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    // Affine (parallelogram) — no perspective component.
    a11 = x1 - x0; a21 = x2 - x1; a31 = x0;
    a12 = y1 - y0; a22 = y2 - y1; a32 = y0;
    a13 = 0; a23 = 0;
  } else {
    const denom = dx1 * dy2 - dx2 * dy1;
    a13 = (dx3 * dy2 - dx2 * dy3) / denom;
    a23 = (dx1 * dy3 - dx3 * dy1) / denom;
    a11 = x1 - x0 + a13 * x1;
    a21 = x3 - x0 + a23 * x3;
    a31 = x0;
    a12 = y1 - y0 + a13 * y1;
    a22 = y3 - y0 + a23 * y3;
    a32 = y0;
  }
  return [a11, a12, a13, a21, a22, a23, a31, a32];
}

// Map a unit-square coord (u, v) through the homography to a destination point.
function projectPoint(m, u, v) {
  const w = m[2] * u + m[5] * v + 1;
  return [
    (m[0] * u + m[3] * v + m[6]) / w,
    (m[1] * u + m[4] * v + m[7]) / w,
  ];
}

// ---------------------------------------------------------------------------
// Affine-textured triangle: draw triangle (s0,s1,s2) of `img` onto the
// destination triangle (d0,d1,d2). This is the primitive the warp is built on.
// ---------------------------------------------------------------------------
function drawTexturedTriangle(ctx, img, s, d) {
  const [x0, y0] = s[0], [x1, y1] = s[1], [x2, y2] = s[2];
  const [u0, v0] = d[0], [u1, v1] = d[1], [u2, v2] = d[2];

  // Clip to the destination triangle, expanded slightly to avoid hairline
  // seams between adjacent cells.
  const cx = (u0 + u1 + u2) / 3;
  const cy = (v0 + v1 + v2) / 3;
  const grow = 0.6;
  const ex = (px, py) => {
    const dx = px - cx, dy = py - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [px + (dx / len) * grow, py + (dy / len) * grow];
  };
  const [e0x, e0y] = ex(u0, v0);
  const [e1x, e1y] = ex(u1, v1);
  const [e2x, e2y] = ex(u2, v2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(e0x, e0y);
  ctx.lineTo(e1x, e1y);
  ctx.lineTo(e2x, e2y);
  ctx.closePath();
  ctx.clip();

  // Solve the affine (a,b,c,d,e,f) that maps source (x,y) -> dest (u,v).
  const delta = x0 * (y1 - y2) - x1 * (y0 - y2) + x2 * (y0 - y1);
  if (Math.abs(delta) < 1e-9) {
    ctx.restore();
    return;
  }
  const a = (u0 * (y1 - y2) - u1 * (y0 - y2) + u2 * (y0 - y1)) / delta;
  const b = (-u0 * (x1 - x2) + u1 * (x0 - x2) - u2 * (x0 - x1)) / delta;
  const c = (u0 * (x1 * y2 - x2 * y1) - u1 * (x0 * y2 - x2 * y0) + u2 * (x0 * y1 - x1 * y0)) / delta;
  const dd = (v0 * (y1 - y2) - v1 * (y0 - y2) + v2 * (y0 - y1)) / delta;
  const e = (-v0 * (x1 - x2) + v1 * (x0 - x2) - v2 * (x0 - x1)) / delta;
  const f = (v0 * (x1 * y2 - x2 * y1) - v1 * (x0 * y2 - x2 * y0) + v2 * (x0 * y1 - x1 * y0)) / delta;

  ctx.transform(a, dd, b, e, c, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// True when the quad exactly covers the whole output (the default surface), so
// we can skip warping and blit straight — the common, fast path.
export function isIdentity(corners, w, h) {
  const eq = (p, x, y) => Math.abs(p[0] - x) < 0.5 && Math.abs(p[1] - y) < 0.5;
  return (
    eq(corners[0], 0, 0) &&
    eq(corners[1], w, 0) &&
    eq(corners[2], w, h) &&
    eq(corners[3], 0, h)
  );
}

// Draw the source image warped onto one surface's quad.
//   ctx     : output context
//   source  : the offscreen source canvas (sw x sh device px)
//   corners : [TL, TR, BR, BL] in output CSS px
export function drawSurface(ctx, source, corners, outW, outH) {
  // Fast path: untouched full-screen surface → straight blit.
  if (isIdentity(corners, outW, outH)) {
    ctx.drawImage(source, 0, 0, outW, outH);
    return;
  }

  const m = squareToQuad(corners[0], corners[1], corners[2], corners[3]);
  const n = config.warpSubdivisions;
  const sw = source.width;
  const sh = source.height;
  const key = `${outW}x${outH}:${sw}x${sh}:${n}:${corners
    .flat()
    .map((v) => v.toFixed(2))
    .join(',')}`;

  // Precompute the grid of (source point, dest point) at each lattice node.
  let cached = warpCache.get(corners);
  let grid = cached?.key === key ? cached.grid : null;
  if (!grid) {
    grid = [];
    for (let iy = 0; iy <= n; iy++) {
      const row = [];
      for (let ix = 0; ix <= n; ix++) {
        const u = ix / n;
        const v = iy / n;
        row.push({
          s: [u * sw, v * sh],
          d: projectPoint(m, u, v),
        });
      }
      grid.push(row);
    }
    warpCache.set(corners, { key, grid });
  }

  // Two triangles per cell.
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const a = grid[iy][ix];
      const b = grid[iy][ix + 1];
      const c = grid[iy + 1][ix + 1];
      const dpt = grid[iy + 1][ix];
      drawTexturedTriangle(ctx, source, [a.s, b.s, c.s], [a.d, b.d, c.d]);
      drawTexturedTriangle(ctx, source, [a.s, c.s, dpt.s], [a.d, c.d, dpt.d]);
    }
  }
}

// Perspective-warp a whole image (or canvas) onto a 4-corner quad. This is how
// an imported image is mapped into a square/quad shape so it conforms to the
// real object when you drag the corners. `corners` order: [TL, TR, BR, BL].
export function warpImageToQuad(ctx, img, corners) {
  const m = squareToQuad(corners[0], corners[1], corners[2], corners[3]);
  const n = config.warpSubdivisions;
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (!sw || !sh) return;

  const grid = [];
  for (let iy = 0; iy <= n; iy++) {
    const row = [];
    for (let ix = 0; ix <= n; ix++) {
      const u = ix / n;
      const v = iy / n;
      row.push({ s: [u * sw, v * sh], d: projectPoint(m, u, v) });
    }
    grid.push(row);
  }
  for (let iy = 0; iy < n; iy++) {
    for (let ix = 0; ix < n; ix++) {
      const a = grid[iy][ix];
      const b = grid[iy][ix + 1];
      const c = grid[iy + 1][ix + 1];
      const d = grid[iy + 1][ix];
      drawTexturedTriangle(ctx, img, [a.s, b.s, c.s], [a.d, b.d, c.d]);
      drawTexturedTriangle(ctx, img, [a.s, c.s, d.s], [a.d, c.d, d.d]);
    }
  }
}

// ---------------------------------------------------------------------------
// Hit testing + overlay for Map-mode editing
// ---------------------------------------------------------------------------

// Is point p inside the (convex) quad? Consistent sign of edge cross products.
export function pointInQuad(p, corners) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if (cross !== 0) {
      const s = Math.sign(cross);
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

// Draw the editing overlay: quad outlines + corner handles. The active surface
// is highlighted. Only called in Map mode.
export function drawMapOverlay(ctx, surfaces, activeId) {
  for (const s of surfaces) {
    const active = s.id === activeId;
    const color = active ? config.mapActiveColor : config.mapLineColor;
    const c = s.corners;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = active ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(c[0][0], c[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]);
    ctx.closePath();
    ctx.stroke();

    // Corner handles.
    for (const [x, y] of c) {
      ctx.beginPath();
      ctx.arc(x, y, config.handleRadius, 0, Math.PI * 2);
      ctx.fillStyle = active ? config.mapActiveColor : 'rgba(255,255,255,0.85)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1a1a1a';
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Pointer input for Map mode: drag corners, or drag a whole surface.
// Coexists with tools.js — each handler ignores events outside its own mode.
// ---------------------------------------------------------------------------
export function initMapInput(canvas, app, hooks = {}) {
  const beforeChange = hooks.beforeChange || (() => {});
  const onChange = hooks.onChange || (() => {});
  let drag = null;

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (app.mode !== 'map') return;
    const p = toCanvas(e);

    // 1) Grab the nearest corner handle, if close enough.
    let best = null;
    let bestD = config.handleRadius * 2;
    for (const s of app.surfaces) {
      s.corners.forEach((c, i) => {
        const d = Math.hypot(c[0] - p.x, c[1] - p.y);
        if (d < bestD) {
          bestD = d;
          best = { surfaceId: s.id, cornerIndex: i };
        }
      });
    }
    if (best) {
      beforeChange();
      app.activeSurfaceId = best.surfaceId;
      drag = best;
      canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    // 2) Otherwise, click inside a quad selects it and moves it as a whole.
    for (let i = app.surfaces.length - 1; i >= 0; i--) {
      const s = app.surfaces[i];
      if (pointInQuad(p, s.corners)) {
        beforeChange();
        app.activeSurfaceId = s.id;
        drag = { surfaceId: s.id, move: true, lastX: p.x, lastY: p.y };
        canvas.setPointerCapture?.(e.pointerId);
        return;
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag || app.mode !== 'map') return;
    const p = toCanvas(e);
    const s = app.surfaces.find((s) => s.id === drag.surfaceId);
    if (!s) return;

    if (drag.move) {
      const dx = p.x - drag.lastX;
      const dy = p.y - drag.lastY;
      for (const c of s.corners) {
        c[0] += dx;
        c[1] += dy;
      }
      drag.lastX = p.x;
      drag.lastY = p.y;
    } else {
      s.corners[drag.cornerIndex][0] = p.x;
      s.corners[drag.cornerIndex][1] = p.y;
    }
  });

  function end(e) {
    if (drag) {
      drag = null;
      canvas.releasePointerCapture?.(e.pointerId);
      onChange();
    }
  }
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
}
