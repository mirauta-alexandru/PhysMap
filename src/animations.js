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
    default: drawCube(ctx, w, h, t, color);
  }
  ctx.restore();
}
