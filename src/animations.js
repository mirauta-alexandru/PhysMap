// animations.js
// ---------------------------------------------------------------------------
// Built-in graphic animations you can map onto a shape. Each one draws into a
// plain rectangle (0,0,w,h) with a transparent background, so when it's warped
// onto a shape only the bright lines/forms light up the real object — the rest
// stays pure black.
//
// Includes real 3D content (a rotating wireframe cube and a perspective grid)
// rendered with a tiny software 3D projection — no extra dependency.

const TAU = Math.PI * 2;

// Catalog (used to build the UI + validate saved values).
export const ANIMATIONS = ['cube3d', 'grid3d', 'scan', 'bars', 'rings', 'wave'];

// Unit cube corners + the 12 edges connecting them.
const CUBE = [
  [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1],
];
const CUBE_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

// Rotate a 3D point around the Y then X axes.
function rotate(p, ax, ay) {
  let [x, y, z] = p;
  // Y axis
  let cz = Math.cos(ay), sz = Math.sin(ay);
  let x1 = x * cz - z * sz;
  let z1 = x * sz + z * cz;
  // X axis
  let cx = Math.cos(ax), sx = Math.sin(ax);
  let y1 = y * cx - z1 * sx;
  let z2 = y * sx + z1 * cx;
  return [x1, y1, z2];
}

// A spinning 3D wireframe cube, perspective-projected into the box.
function drawCube(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  const scale = Math.min(w, h) * 0.3;
  const ax = t * 0.7;
  const ay = t * 1.0;
  const cam = 3.2; // camera distance for perspective

  const proj = CUBE.map((p) => {
    const [x, y, z] = rotate(p, ax, ay);
    const f = cam / (cam - z);
    return [cx + x * scale * f, cy + y * scale * f];
  });

  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.016);
  ctx.beginPath();
  for (const [a, b] of CUBE_EDGES) {
    ctx.moveTo(proj[a][0], proj[a][1]);
    ctx.lineTo(proj[b][0], proj[b][1]);
  }
  ctx.stroke();
}

// A scrolling perspective floor grid (classic synthwave look).
function drawGrid3d(ctx, w, h, t, color) {
  const horizon = h * 0.42;
  const vpx = w / 2;
  ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.008);

  // Horizontal lines marching toward the horizon.
  const lines = 12;
  const scroll = (t * 0.6) % 1;
  ctx.beginPath();
  for (let i = 0; i < lines; i++) {
    const f = (i + scroll) / lines; // 0..1 depth
    const y = horizon + (h - horizon) * (f * f); // ease toward horizon
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  // Vertical lines fanning out from the vanishing point.
  const cols = 10;
  for (let i = -cols; i <= cols; i++) {
    const x = vpx + (i / cols) * w;
    ctx.moveTo(vpx, horizon);
    ctx.lineTo(x, h);
  }
  ctx.stroke();
}

// A bright bar sweeping left↔right (a scan line).
function drawScan(ctx, w, h, t, color) {
  const x = (0.5 + 0.5 * Math.sin(t * 1.6)) * w;
  ctx.lineWidth = Math.max(3, w * 0.02);
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, h);
  ctx.stroke();
}

// Audio-style equalizer bars.
function drawBars(ctx, w, h, t, color) {
  const n = 9;
  const gap = w / n;
  const bw = gap * 0.6;
  for (let i = 0; i < n; i++) {
    const v = 0.2 + 0.8 * (0.5 + 0.5 * Math.sin(t * 3 + i * 0.9));
    const bh = v * h * 0.9;
    ctx.fillRect(i * gap + (gap - bw) / 2, h - bh, bw, bh);
  }
}

// Concentric pulsing rings.
function drawRings(ctx, w, h, t, color) {
  const cx = w / 2, cy = h / 2;
  const maxR = Math.hypot(w, h) / 2;
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.012);
  const count = 5;
  for (let i = 0; i < count; i++) {
    const r = ((t * 0.4 + i / count) % 1) * maxR;
    ctx.globalAlpha = 1 - r / maxR;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// A travelling sine wave.
function drawWave(ctx, w, h, t, color) {
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.014);
  ctx.beginPath();
  const amp = h * 0.28;
  for (let x = 0; x <= w; x += Math.max(2, w / 120)) {
    const y = h / 2 + Math.sin(x / w * TAU * 2 + t * 2) * amp;
    if (x === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// Render the named animation into a (0,0,w,h) box on the given context.
export function renderAnimation(ctx, name, w, h, now, color) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = Math.min(w, h) * 0.05;
  const t = now * 0.001;

  switch (name) {
    case 'cube3d': drawCube(ctx, w, h, t, color); break;
    case 'grid3d': drawGrid3d(ctx, w, h, t, color); break;
    case 'scan': drawScan(ctx, w, h, t, color); break;
    case 'bars': drawBars(ctx, w, h, t, color); break;
    case 'rings': drawRings(ctx, w, h, t, color); break;
    case 'wave': drawWave(ctx, w, h, t, color); break;
    default: drawCube(ctx, w, h, t, color);
  }
  ctx.restore();
}
