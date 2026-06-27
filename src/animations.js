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
export const ANIMATIONS = [
  'cube3d',
  'grid3d',
  'orb3d',
  'tunnel3d',
  'starfield3d',
  'helix3d',
  'scan',
  'bars',
  'wave',
  'radar',
  'rings',
  'kaleido',
  'aurora',
  'constellation',
  'laserfan',
  'topography',
  'pixelrain',
  'prism',
  'moire',
  'circuit',
  'liquidmetal',
  'neonribs',
  'depthscan',
  'sparkburst',
  'mandala',
  'datatunnel',
  'ripplefield',
  'shutter',
  'focusrings',
];

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

  // Bright nodes make the rotation legible on uneven projection surfaces.
  for (let i = 0; i < proj.length; i++) {
    const pulse = 0.65 + Math.sin(t * 2.4 + i) * 0.25;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(proj[i][0], proj[i][1], Math.max(1.5, scale * 0.025), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
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

// A rotating latitude/longitude orb. Back-facing segments fade while the front
// hemisphere blooms, giving a real volume cue without WebGL.
function drawOrb3d(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.36;
  const tilt = -0.28;
  const spin = t * 0.72;
  const project = (x, y, z) => {
    const y1 = y * Math.cos(tilt) - z * Math.sin(tilt);
    const z1 = y * Math.sin(tilt) + z * Math.cos(tilt);
    const x1 = x * Math.cos(spin) - z1 * Math.sin(spin);
    const z2 = x * Math.sin(spin) + z1 * Math.cos(spin);
    return [cx + x1 * radius, cy + y1 * radius, z2];
  };

  ctx.lineWidth = Math.max(1.2, radius * 0.018);
  const drawStrip = (points) => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      const depth = (a[2] + b[2]) * 0.5;
      ctx.globalAlpha = 0.18 + (depth + 1) * 0.36;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  };

  for (let lat = -3; lat <= 3; lat++) {
    const phi = (lat / 7) * Math.PI;
    const ring = [];
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * TAU;
      ring.push(project(Math.cos(phi) * Math.cos(a), Math.sin(phi), Math.cos(phi) * Math.sin(a)));
    }
    drawStrip(ring);
  }
  for (let lon = 0; lon < 10; lon++) {
    const theta = (lon / 10) * TAU;
    const arc = [];
    for (let i = 0; i <= 48; i++) {
      const phi = -Math.PI / 2 + (i / 48) * Math.PI;
      arc.push(project(Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta)));
    }
    drawStrip(arc);
  }

  ctx.globalAlpha = 0.85;
  const core = ctx.createRadialGradient(cx - radius * 0.18, cy - radius * 0.2, 0, cx, cy, radius);
  core.addColorStop(0, color);
  core.addColorStop(0.08, 'rgba(255,255,255,0.42)');
  core.addColorStop(0.2, 'rgba(255,255,255,0.05)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
}

// Nested, rotating frames move from a vanishing point toward the viewer. The
// changing center creates a slow camera drift instead of a static screensaver.
function drawTunnel3d(ctx, w, h, t, color) {
  const cx = w * (0.5 + Math.sin(t * 0.43) * 0.07);
  const cy = h * (0.5 + Math.cos(t * 0.37) * 0.06);
  const count = 12;
  ctx.lineJoin = 'round';

  for (let i = count - 1; i >= 0; i--) {
    const phase = (i / count + t * 0.22) % 1;
    const eased = phase * phase;
    const rw = w * (0.045 + eased * 0.78);
    const rh = h * (0.045 + eased * 0.78);
    const angle = t * 0.16 + phase * 0.72;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.globalAlpha = 0.12 + phase * 0.82;
    ctx.lineWidth = Math.max(1, Math.min(w, h) * (0.004 + phase * 0.012));
    ctx.strokeRect(-rw / 2, -rh / 2, rw, rh);
    ctx.restore();
  }

  ctx.globalAlpha = 0.75 + Math.sin(t * 2) * 0.2;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, Math.min(w, h) * 0.018), 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function seeded(n) {
  const x = Math.sin(n * 91.733) * 43758.5453;
  return x - Math.floor(x);
}

// Particles accelerate out of a central vanishing point, creating continuous
// forward motion through a deep star field.
function drawStarfield3d(ctx, w, h, t, color) {
  const cx = w * (0.5 + Math.sin(t * 0.23) * 0.04);
  const cy = h * (0.5 + Math.cos(t * 0.19) * 0.035);
  const radius = Math.hypot(w, h) * 0.65;
  const count = 92;

  for (let i = 0; i < count; i++) {
    const phase = (seeded(i + 4) + t * (0.12 + seeded(i + 9) * 0.08)) % 1;
    const angle = seeded(i + 17) * TAU;
    const spread = phase * phase;
    const x = cx + Math.cos(angle) * radius * spread;
    const y = cy + Math.sin(angle) * radius * spread;
    const tail = 4 + phase * Math.min(w, h) * 0.055;
    ctx.globalAlpha = 0.12 + phase * 0.88;
    ctx.lineWidth = 0.7 + phase * 2.4;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(angle) * tail, y - Math.sin(angle) * tail);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Two luminous strands rotate through depth and cross-connect like a DNA helix.
function drawHelix3d(ctx, w, h, t, color) {
  const steps = 42;
  const amp = w * 0.28;
  const top = h * 0.08;
  const span = h * 0.84;
  const strandA = [];
  const strandB = [];

  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const phase = f * TAU * 2.4 + t * 1.4;
    const depth = Math.sin(phase);
    const y = top + f * span;
    strandA.push([w / 2 + Math.cos(phase) * amp, y, depth]);
    strandB.push([w / 2 + Math.cos(phase + Math.PI) * amp, y, -depth]);
  }

  ctx.lineWidth = Math.max(1.4, Math.min(w, h) * 0.009);
  for (let i = 1; i <= steps; i++) {
    for (const strand of [strandA, strandB]) {
      const a = strand[i - 1];
      const b = strand[i];
      ctx.globalAlpha = 0.24 + ((a[2] + b[2]) * 0.25 + 0.5) * 0.7;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    if (i % 3 === 0) {
      ctx.globalAlpha = 0.18 + Math.abs(strandA[i][2]) * 0.55;
      ctx.beginPath();
      ctx.moveTo(strandA[i][0], strandA[i][1]);
      ctx.lineTo(strandB[i][0], strandB[i][1]);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

// Circular scanner with persistent rings and deterministic target blips.
function drawRadar(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.42;
  ctx.lineWidth = Math.max(1, r * 0.012);
  ctx.globalAlpha = 0.32;
  for (let i = 1; i <= 4; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, (r * i) / 4, 0, TAU);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();

  const angle = t * 1.25;
  const sweep = ctx.createConicGradient(angle - 0.85, cx, cy);
  sweep.addColorStop(0, 'rgba(255,255,255,0)');
  sweep.addColorStop(0.12, color);
  sweep.addColorStop(0.16, 'rgba(255,255,255,0)');
  ctx.globalAlpha = 0.48;
  ctx.fillStyle = sweep;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.fillStyle = color;

  for (let i = 0; i < 7; i++) {
    const a = seeded(i + 31) * TAU;
    const d = (0.2 + seeded(i + 47) * 0.72) * r;
    const delta = Math.abs(Math.atan2(Math.sin(angle - a), Math.cos(angle - a)));
    ctx.globalAlpha = Math.max(0.12, 1 - delta / 1.4);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, Math.max(2, r * 0.025), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// Mirrored radial geometry rotates at two speeds for a crisp kaleidoscope.
function drawKaleido(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.44;
  const arms = 12;
  ctx.lineWidth = Math.max(1.2, r * 0.018);
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * TAU + t * 0.22;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(a);
    ctx.globalAlpha = 0.34 + (i % 3) * 0.18;
    ctx.beginPath();
    ctx.moveTo(r * 0.08, 0);
    ctx.lineTo(r * 0.38, r * 0.14);
    ctx.lineTo(r * 0.72, 0);
    ctx.lineTo(r * 0.38, -r * 0.14);
    ctx.closePath();
    ctx.stroke();
    ctx.rotate(-t * 0.7);
    ctx.strokeRect(r * 0.25, -r * 0.07, r * 0.22, r * 0.14);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r * (0.12 + Math.sin(t * 1.8) * 0.025), 0, TAU);
  ctx.stroke();
}

// Layered flowing ribbons with gentle vertical drift. The bands are built from
// translucent strokes so they stay readable when projected on textured walls.
function drawAurora(ctx, w, h, t, color) {
  const bands = 6;
  const step = Math.max(3, w / 90);
  ctx.lineCap = 'round';

  for (let band = 0; band < bands; band++) {
    const offset = (band - (bands - 1) / 2) * h * 0.075;
    const phase = t * (0.42 + band * 0.035) + band * 0.72;
    const gradient = ctx.createLinearGradient(0, 0, w, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.2, color);
    gradient.addColorStop(0.55, 'rgba(255,255,255,0.92)');
    gradient.addColorStop(0.82, color);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = gradient;
    ctx.globalAlpha = 0.13 + band * 0.055;
    ctx.lineWidth = Math.max(2, h * (0.025 + band * 0.006));
    ctx.beginPath();
    for (let x = -step; x <= w + step; x += step) {
      const f = x / Math.max(1, w);
      const y = h * 0.5 + offset
        + Math.sin(f * TAU * 1.35 + phase) * h * 0.12
        + Math.sin(f * TAU * 3.1 - phase * 0.65) * h * 0.035;
      if (x <= 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, h * 0.008);
  const horizon = h * (0.5 + Math.sin(t * 0.34) * 0.04);
  ctx.beginPath();
  ctx.moveTo(0, horizon);
  ctx.lineTo(w, horizon);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// A deterministic star network whose nodes drift at different depths. Nearby
// points form temporary links, producing a calm generative structure.
function drawConstellation(ctx, w, h, t, color) {
  const count = 28;
  const points = [];
  const diagonal = Math.hypot(w, h);
  const maxLink = diagonal * 0.14;

  for (let i = 0; i < count; i++) {
    const depth = 0.45 + seeded(i + 83) * 0.75;
    const baseX = seeded(i + 101) * w;
    const baseY = seeded(i + 137) * h;
    const x = (baseX + Math.sin(t * (0.16 + depth * 0.08) + i) * w * 0.035 + w) % w;
    const y = (baseY + Math.cos(t * (0.13 + depth * 0.06) + i * 0.7) * h * 0.05 + h) % h;
    points.push({ x, y, depth });
  }

  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(0.75, Math.min(w, h) * 0.004);
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const distance = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
      if (distance > maxLink) continue;
      ctx.globalAlpha = (1 - distance / maxLink) * 0.34;
      ctx.beginPath();
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[j].x, points[j].y);
      ctx.stroke();
    }
  }

  ctx.fillStyle = color;
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const pulse = 0.65 + Math.sin(t * 1.7 + i * 1.9) * 0.25;
    ctx.globalAlpha = pulse;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(1.3, point.depth * 2.4), 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// A bright radial fan designed for architectural edges and stage haze.
function drawLaserFan(ctx, w, h, t, color) {
  const originX = w * (0.5 + Math.sin(t * 0.42) * 0.16);
  const originY = h * 0.96;
  const rayCount = 15;
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.006);
  for (let i = 0; i < rayCount; i++) {
    const phase = i / (rayCount - 1);
    const angle = -Math.PI * 0.88 + phase * Math.PI * 0.76 + Math.sin(t * 0.7 + i) * 0.025;
    const reach = Math.hypot(w, h) * (0.9 + Math.sin(t * 1.2 + i * 1.7) * 0.08);
    ctx.globalAlpha = 0.28 + Math.pow(Math.sin(t * 1.6 + i * 0.8) * 0.5 + 0.5, 2) * 0.72;
    ctx.beginPath();
    ctx.moveTo(originX, originY);
    ctx.lineTo(originX + Math.cos(angle) * reach, originY + Math.sin(angle) * reach);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.86;
  ctx.beginPath();
  ctx.arc(originX, originY, Math.max(3, Math.min(w, h) * 0.022), 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}

// Animated contour lines stay legible even on irregular mapped surfaces.
function drawTopography(ctx, w, h, t, color) {
  const bands = 12;
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.005);
  for (let band = 0; band < bands; band++) {
    const yBase = ((band + 0.5) / bands) * h;
    ctx.globalAlpha = 0.24 + (band % 3 === 0 ? 0.5 : 0.24);
    ctx.beginPath();
    for (let x = -8; x <= w + 8; x += Math.max(5, w / 80)) {
      const y =
        yBase +
        Math.sin(x * 0.025 + t * 0.9 + band * 0.8) * h * 0.035 +
        Math.sin(x * 0.061 - t * 0.55 + band) * h * 0.018;
      if (x <= -8) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// Pixel columns with deterministic timing for a crisp digital rain look.
function drawPixelRain(ctx, w, h, t, color) {
  const cell = Math.max(5, Math.min(w, h) * 0.032);
  const columns = Math.ceil(w / cell);
  ctx.fillStyle = color;
  for (let column = 0; column < columns; column++) {
    const speed = 0.35 + seeded(column + 201) * 0.9;
    const head = ((t * speed + seeded(column + 301) * 8) % 1.25) * h;
    const length = 3 + Math.floor(seeded(column + 401) * 7);
    for (let row = 0; row < length; row++) {
      const y = head - row * cell;
      if (y < -cell || y > h + cell) continue;
      ctx.globalAlpha = Math.max(0.08, 1 - row / length);
      ctx.fillRect(column * cell + cell * 0.2, y, cell * 0.58, cell * 0.58);
    }
  }
  ctx.globalAlpha = 1;
}

// Rotating mirrored beams create a clean prism / stained-glass projection.
function drawPrism(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.hypot(w, h) * 0.68;
  const blades = 10;
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < blades; i++) {
    const angle = t * 0.22 + (i / blades) * TAU;
    const hue = (i * 36 + t * 24) % 360;
    const gradient = ctx.createLinearGradient(cx, cy, cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(0.4, `hsla(${hue}, 94%, 64%, 0.72)`);
    gradient.addColorStop(1, `hsla(${(hue + 70) % 360}, 94%, 58%, 0)`);
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.44;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, angle - 0.13, angle + 0.13);
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}

function drawMoire(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.004);
  for (let layer = 0; layer < 2; layer++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((layer ? -1 : 1) * (0.18 + Math.sin(t * 0.22) * 0.08));
    ctx.globalAlpha = layer ? 0.42 : 0.62;
    for (let x = -w; x <= w; x += Math.max(8, w / 28)) {
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(t + x * 0.018) * 10, -h);
      ctx.lineTo(x + Math.cos(t * 0.8 + x * 0.014) * 10, h);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawCircuit(ctx, w, h, t, color) {
  const cols = 9;
  const rows = 6;
  const dx = w / (cols + 1);
  const dy = h / (rows + 1);
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.008);
  for (let y = 1; y <= rows; y++) {
    for (let x = 1; x <= cols; x++) {
      const px = x * dx;
      const py = y * dy;
      const lit = (seeded(x * 19 + y * 37) + t * 0.34) % 1;
      ctx.globalAlpha = lit > 0.55 ? 0.82 : 0.22;
      if (x < cols && seeded(x * 13 + y * 29) > 0.28) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + dx * 0.72, py);
        ctx.lineTo(px + dx * 0.72, py + (seeded(x + y) > 0.5 ? dy * 0.32 : -dy * 0.32));
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(px, py, Math.max(2, Math.min(w, h) * 0.012), 0, TAU);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawLiquidMetal(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  ctx.globalCompositeOperation = 'screen';
  for (let layer = 0; layer < 5; layer++) {
    const radius = Math.min(w, h) * (0.16 + layer * 0.055);
    const gradient = ctx.createRadialGradient(cx, cy, radius * 0.1, cx, cy, radius * 1.65);
    gradient.addColorStop(0, 'rgba(255,255,255,0.62)');
    gradient.addColorStop(0.35, color);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const a = (i / 72) * TAU;
      const wave = 1
        + Math.sin(a * 3 + t * (0.75 + layer * 0.08)) * 0.18
        + Math.sin(a * 7 - t * 0.62 + layer) * 0.08;
      const x = cx + Math.cos(a) * radius * wave;
      const y = cy + Math.sin(a) * radius * wave * (0.68 + layer * 0.04);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = color;
}

function drawNeonRibs(ctx, w, h, t, color) {
  const ribs = 14;
  ctx.lineWidth = Math.max(2, Math.min(w, h) * 0.012);
  for (let i = 0; i < ribs; i++) {
    const f = i / (ribs - 1);
    const y = h * (0.08 + f * 0.84);
    const bow = Math.sin(t * 0.9 + i * 0.6) * w * 0.045;
    ctx.globalAlpha = 0.22 + Math.pow(Math.sin(t * 1.4 + i * 0.55) * 0.5 + 0.5, 2) * 0.7;
    ctx.beginPath();
    ctx.moveTo(w * 0.08, y);
    ctx.quadraticCurveTo(w * 0.5 + bow, y - h * 0.09, w * 0.92, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawDepthScan(ctx, w, h, t, color) {
  const slices = 18;
  const cx = w / 2;
  const cy = h / 2;
  for (let i = 0; i < slices; i++) {
    const phase = (i / slices + t * 0.16) % 1;
    const size = Math.min(w, h) * (0.08 + phase * 0.76);
    ctx.globalAlpha = (1 - phase) * 0.55 + 0.08;
    ctx.lineWidth = Math.max(1, Math.min(w, h) * (0.004 + phase * 0.012));
    ctx.strokeRect(cx - size * 0.75, cy - size * 0.42, size * 1.5, size * 0.84);
  }
  ctx.globalAlpha = 1;
}

function drawSparkBurst(ctx, w, h, t, color) {
  const cx = w * (0.5 + Math.sin(t * 0.37) * 0.14);
  const cy = h * (0.5 + Math.cos(t * 0.31) * 0.12);
  const count = 48;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + Math.sin(t * 0.8 + i) * 0.08;
    const burst = (seeded(i + 77) + t * (0.35 + seeded(i) * 0.24)) % 1;
    const r = Math.min(w, h) * (0.08 + burst * 0.48);
    const tail = Math.min(w, h) * (0.04 + burst * 0.09);
    ctx.globalAlpha = 1 - burst;
    ctx.lineWidth = 1 + burst * 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - tail), cy + Math.sin(a) * (r - tail));
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function drawMandala(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.42;
  const petals = 16;
  ctx.lineWidth = Math.max(1, radius * 0.012);
  for (let i = 0; i < petals; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((i / petals) * TAU + t * 0.18);
    ctx.globalAlpha = 0.34 + (i % 4) * 0.08;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(radius * 0.18, -radius * 0.3, radius * 0.54, -radius * 0.22, radius * 0.78, 0);
    ctx.bezierCurveTo(radius * 0.54, radius * 0.22, radius * 0.18, radius * 0.3, 0, 0);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * (0.18 + Math.sin(t * 1.1) * 0.03), 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawDataTunnel(ctx, w, h, t, color) {
  const lanes = 18;
  const cx = w / 2;
  const cy = h / 2;
  ctx.font = `${Math.max(8, Math.round(Math.min(w, h) * 0.04))}px monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < lanes; i++) {
    const a = (i / lanes) * TAU + Math.sin(t * 0.18) * 0.4;
    for (let j = 0; j < 7; j++) {
      const phase = (j / 7 + t * (0.22 + seeded(i) * 0.08) + seeded(i * 31 + j)) % 1;
      const r = phase * Math.hypot(w, h) * 0.58;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      ctx.globalAlpha = phase * 0.85;
      ctx.fillText(seeded(i * 99 + j) > 0.5 ? '1' : '0', x, y);
    }
  }
  ctx.globalAlpha = 1;
}

function drawRippleField(ctx, w, h, t, color) {
  const centers = [
    [w * 0.28, h * 0.36, 0],
    [w * 0.68, h * 0.42, 0.33],
    [w * 0.48, h * 0.72, 0.66],
  ];
  const maxR = Math.hypot(w, h) * 0.35;
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.006);
  centers.forEach(([cx, cy, offset]) => {
    for (let i = 0; i < 6; i++) {
      const phase = (offset + i / 6 + t * 0.23) % 1;
      ctx.globalAlpha = (1 - phase) * 0.62;
      ctx.beginPath();
      ctx.arc(cx, cy, phase * maxR, 0, TAU);
      ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;
}

function drawShutter(ctx, w, h, t, color) {
  const blades = 10;
  const open = 0.3 + (Math.sin(t * 1.6) * 0.5 + 0.5) * 0.52;
  ctx.globalAlpha = 0.72;
  for (let i = 0; i < blades; i++) {
    const y = (i / blades) * h;
    const bh = h / blades * open;
    ctx.fillRect(0, y, w, bh);
  }
  ctx.globalAlpha = 1;
}

function drawFocusRings(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.44;
  ctx.lineWidth = Math.max(1, r * 0.01);
  for (let i = 1; i <= 7; i++) {
    ctx.globalAlpha = i % 2 ? 0.86 : 0.38;
    ctx.beginPath();
    ctx.arc(cx, cy, (r * i) / 7 + Math.sin(t * 1.4 + i) * r * 0.01, 0, TAU);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy + r);
  ctx.stroke();
  ctx.globalAlpha = 1;
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
    case 'orb3d': drawOrb3d(ctx, w, h, t, color); break;
    case 'tunnel3d': drawTunnel3d(ctx, w, h, t, color); break;
    case 'starfield3d': drawStarfield3d(ctx, w, h, t, color); break;
    case 'helix3d': drawHelix3d(ctx, w, h, t, color); break;
    case 'radar': drawRadar(ctx, w, h, t, color); break;
    case 'kaleido': drawKaleido(ctx, w, h, t, color); break;
    case 'aurora': drawAurora(ctx, w, h, t, color); break;
    case 'constellation': drawConstellation(ctx, w, h, t, color); break;
    case 'laserfan': drawLaserFan(ctx, w, h, t, color); break;
    case 'topography': drawTopography(ctx, w, h, t, color); break;
    case 'pixelrain': drawPixelRain(ctx, w, h, t, color); break;
    case 'prism': drawPrism(ctx, w, h, t, color); break;
    case 'moire': drawMoire(ctx, w, h, t, color); break;
    case 'circuit': drawCircuit(ctx, w, h, t, color); break;
    case 'liquidmetal': drawLiquidMetal(ctx, w, h, t, color); break;
    case 'neonribs': drawNeonRibs(ctx, w, h, t, color); break;
    case 'depthscan': drawDepthScan(ctx, w, h, t, color); break;
    case 'sparkburst': drawSparkBurst(ctx, w, h, t, color); break;
    case 'mandala': drawMandala(ctx, w, h, t, color); break;
    case 'datatunnel': drawDataTunnel(ctx, w, h, t, color); break;
    case 'ripplefield': drawRippleField(ctx, w, h, t, color); break;
    case 'shutter': drawShutter(ctx, w, h, t, color); break;
    case 'focusrings': drawFocusRings(ctx, w, h, t, color); break;
    default: drawCube(ctx, w, h, t, color);
  }
  ctx.restore();
}
