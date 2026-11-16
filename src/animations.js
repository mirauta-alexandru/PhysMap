// animations.js
// ---------------------------------------------------------------------------
// Built-in graphic animations you can map onto a shape. Each one draws into a
// plain rectangle (0,0,w,h) with a transparent background, so when it's warped
// onto a shape only the bright lines/forms light up the real object — the rest
// stays pure black.
//
// Includes real 3D content (a rotating wireframe cube and a perspective grid)
// rendered with a tiny software 3D projection — no extra dependency.

import { audioState, isAudioActive } from './audio.js';

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
  'plasma',
  'fire',
  'lightning',
  'hexgrid',
  'bokeh',
  'galaxy',
  'glitch',
  'confetti',
  'clock',
  'spectrum',
  'waveform',
  'beatring',
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

// ---------------------------------------------------------------------------
// 0.3 additions: colour helpers, eight generative looks, a wall clock and
// three sound-driven animations.
// ---------------------------------------------------------------------------
const colorCache = new Map();

// Parse '#rrggbb' (or '#rgb') into HSL so animations can derive harmonious
// accents from the single shape colour. Anything else falls back to mint.
function toHsl(color) {
  if (colorCache.has(color)) return colorCache.get(color);
  let hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(color) ? color.slice(1) : 'b4e89c';
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let hue = 0;
  let sat = 0;
  if (max !== min) {
    const d = max - min;
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) hue = ((b - r) / d + 2) * 60;
    else hue = ((r - g) / d + 4) * 60;
  }
  const result = { h: hue, s: sat * 100, l: l * 100 };
  if (colorCache.size > 64) colorCache.clear();
  colorCache.set(color, result);
  return result;
}

function tint(color, hueShift = 0, lightShift = 0, alpha = 1) {
  const { h, s, l } = toHsl(color);
  const light = Math.max(8, Math.min(96, l + lightShift));
  return `hsla(${(h + hueShift + 360) % 360}, ${Math.max(35, s)}%, ${light}%, ${alpha})`;
}

// Slow interference of sine fields, painted as soft cells.
function drawPlasma(ctx, w, h, t, color) {
  const cols = 30;
  const rows = Math.max(8, Math.round(cols * (h / w)));
  const cw = w / cols;
  const ch = h / rows;
  ctx.shadowBlur = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const u = x / cols;
      const v = y / rows;
      const value =
        Math.sin(u * 7 + t * 0.9) +
        Math.sin(v * 6 - t * 0.7) +
        Math.sin((u + v) * 5 + t * 0.5) +
        Math.sin(Math.hypot(u - 0.5, v - 0.5) * 12 - t * 1.2);
      const n = (value + 4) / 8;
      ctx.fillStyle = tint(color, (n - 0.5) * 110, (n - 0.5) * 34, 0.12 + n * 0.82);
      ctx.fillRect(x * cw, y * ch, cw + 0.6, ch + 0.6);
    }
  }
}

// Layered flame tongues rising from the bottom edge.
function drawFire(ctx, w, h, t, color) {
  const tongues = 13;
  ctx.shadowBlur = Math.min(w, h) * 0.06;
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = layer === 2 ? tint(color, 28, 34, 0.85) : tint(color, layer * 14, layer * 10, 0.42 + layer * 0.14);
    ctx.shadowColor = tint(color, 0, 0, 0.9);
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let i = 0; i <= tongues; i++) {
      const x = (i / tongues) * w;
      const flicker =
        Math.sin(t * (3.2 + layer) + i * 1.9) * 0.5 +
        Math.sin(t * (5.7 - layer * 0.8) + i * 0.83 + layer) * 0.5;
      const reach = (0.62 - layer * 0.17) * (0.62 + 0.38 * seeded(i * 3 + layer * 11));
      const y = h - h * reach * (0.72 + flicker * 0.28);
      const mid = x - w / tongues / 2;
      ctx.quadraticCurveTo(mid, h - h * reach * 0.28, x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  }
  // Rising embers.
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 26; i++) {
    const phase = (seeded(i + 3) + t * (0.16 + seeded(i + 40) * 0.2)) % 1;
    const x = (seeded(i + 12) + Math.sin(t * 1.3 + i) * 0.03) * w;
    ctx.globalAlpha = (1 - phase) * 0.9;
    const size = Math.max(1.2, Math.min(w, h) * 0.008 * (1 - phase * 0.6));
    ctx.fillRect(x, h - phase * h * 0.95, size, size);
  }
  ctx.globalAlpha = 1;
}

// Forked bolts that re-strike several times a second.
function drawLightning(ctx, w, h, t, color) {
  const strike = Math.floor(t * 2.6);
  const age = (t * 2.6) % 1;
  const bolts = 1 + Math.floor(seeded(strike + 5) * 3);
  ctx.lineJoin = 'miter';
  ctx.shadowBlur = Math.min(w, h) * 0.09;
  for (let b = 0; b < bolts; b++) {
    const seed = strike * 13 + b * 71;
    let x = w * (0.15 + seeded(seed) * 0.7);
    let y = 0;
    const steps = 13;
    ctx.globalAlpha = Math.max(0, 1 - age * 1.25) * (age < 0.12 || seeded(seed + age * 40) > 0.25 ? 1 : 0.35);
    ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.012);
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 1; i <= steps; i++) {
      x += (seeded(seed + i * 7) - 0.5) * w * 0.2;
      x = Math.max(w * 0.04, Math.min(w * 0.96, x));
      y = (i / steps) * h;
      ctx.lineTo(x, y);
      if (seeded(seed + i * 19) > 0.74) {
        const bx = x + (seeded(seed + i * 23) - 0.5) * w * 0.36;
        const by = y + h * (0.06 + seeded(seed + i * 29) * 0.12);
        ctx.moveTo(x, y);
        ctx.lineTo(bx, by);
        ctx.moveTo(x, y);
      }
    }
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth *= 2.4;
    ctx.globalAlpha *= 0.32;
    ctx.stroke();
  }
  // The sky flashes for an instant on every strike.
  ctx.globalAlpha = Math.max(0, 0.2 - age * 1.4);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
}

// Honeycomb cells lighting up in waves that travel out from the centre.
function drawHexGrid(ctx, w, h, t, color) {
  const size = Math.max(10, Math.min(w, h) / 9);
  const stepX = size * 1.5;
  const stepY = size * Math.sqrt(3);
  const maxDistance = Math.hypot(w, h) / 2;
  ctx.shadowBlur = size * 0.35;
  ctx.lineWidth = Math.max(1, size * 0.07);
  for (let col = -1; col * stepX < w + size; col++) {
    for (let row = -1; row * stepY < h + size; row++) {
      const x = col * stepX;
      const y = row * stepY + (col % 2 ? stepY / 2 : 0);
      const distance = Math.hypot(x - w / 2, y - h / 2) / maxDistance;
      const wave = 0.5 + 0.5 * Math.sin(distance * 9 - t * 2.4);
      const spark = seeded(col * 31 + row * 17 + Math.floor(t * 1.5)) > 0.93 ? 1 : 0;
      const energy = Math.max(wave * wave, spark);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const angle = (k / 6) * TAU;
        const px = x + Math.cos(angle) * size * 0.9;
        const py = y + Math.sin(angle) * size * 0.9;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.12 + energy * 0.55;
      ctx.stroke();
      if (energy > 0.55) {
        ctx.globalAlpha = (energy - 0.55) * 0.9;
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
}

// Out-of-focus discs of light drifting slowly, like city lights at night.
function drawBokeh(ctx, w, h, t, color) {
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'lighter';
  const count = 22;
  for (let i = 0; i < count; i++) {
    const depth = seeded(i + 2);
    const radius = Math.min(w, h) * (0.05 + depth * 0.13);
    const x = ((seeded(i + 30) + t * (0.012 + depth * 0.02)) % 1.2 - 0.1) * w;
    const y = (seeded(i + 60) + Math.sin(t * 0.3 + i) * 0.05) * h;
    const breathe = 0.55 + 0.45 * Math.sin(t * (0.6 + depth) + i * 2.1);
    const gradient = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius);
    const hue = (seeded(i + 90) - 0.5) * 70;
    gradient.addColorStop(0, tint(color, hue, 12, 0.34 * breathe));
    gradient.addColorStop(0.72, tint(color, hue, 0, 0.26 * breathe));
    gradient.addColorStop(0.9, tint(color, hue, 18, 0.4 * breathe));
    gradient.addColorStop(1, tint(color, hue, 0, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, TAU);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';
}

// A spiral galaxy: stars orbit faster near the bright core.
function drawGalaxy(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.47;
  const stars = 260;
  const arms = 3;
  ctx.shadowBlur = Math.min(w, h) * 0.02;
  for (let i = 0; i < stars; i++) {
    const distance = Math.pow(seeded(i + 1), 0.62);
    const arm = (i % arms) / arms * TAU;
    const angle = arm + distance * 4.6 + (seeded(i + 200) - 0.5) * 0.55 + t * (0.5 - distance * 0.32);
    const x = cx + Math.cos(angle) * radius * distance;
    const y = cy + Math.sin(angle) * radius * distance * 0.62;
    const twinkle = 0.6 + 0.4 * Math.sin(t * 3 + i);
    ctx.globalAlpha = (1 - distance * 0.7) * twinkle;
    ctx.fillStyle = i % 5 === 0 ? '#ffffff' : tint(color, (distance - 0.5) * 80, 8);
    const size = Math.max(1, Math.min(w, h) * 0.006 * (1.6 - distance));
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.3);
  core.addColorStop(0, tint(color, 0, 30, 0.9));
  core.addColorStop(1, tint(color, 0, 0, 0));
  ctx.globalAlpha = 0.8;
  ctx.fillStyle = core;
  ctx.fillRect(cx - radius * 0.3, cy - radius * 0.3, radius * 0.6, radius * 0.6);
  ctx.globalAlpha = 1;
}

// Broken-signal look: displaced slices, colour fringes and block noise.
function drawGlitch(ctx, w, h, t, color) {
  const frame = Math.floor(t * 9);
  ctx.shadowBlur = 0;
  const rows = 16;
  const rowHeight = h / rows;
  for (let i = 0; i < rows; i++) {
    const active = seeded(frame * 3 + i * 7);
    const shift = active > 0.72 ? (seeded(frame + i * 13) - 0.5) * w * 0.3 : 0;
    const length = w * (0.25 + seeded(i + frame * 5) * 0.7);
    const start = (w - length) * seeded(i * 3 + Math.floor(t * 2)) + shift;
    const y = i * rowHeight;
    ctx.globalAlpha = 0.25 + seeded(i + frame) * 0.6;
    ctx.fillStyle = tint(color, -150, 6, 0.8);
    ctx.fillRect(start - 5, y + rowHeight * 0.2, length, rowHeight * 0.52);
    ctx.fillStyle = tint(color, 150, 6, 0.8);
    ctx.fillRect(start + 5, y + rowHeight * 0.28, length, rowHeight * 0.52);
    ctx.fillStyle = color;
    ctx.fillRect(start, y + rowHeight * 0.24, length, rowHeight * 0.52);
  }
  ctx.fillStyle = '#ffffff';
  for (let i = 0; i < 9; i++) {
    if (seeded(frame * 17 + i) < 0.5) continue;
    ctx.globalAlpha = 0.5 + seeded(frame + i * 3) * 0.5;
    const size = Math.min(w, h) * (0.03 + seeded(i + frame * 2) * 0.08);
    ctx.fillRect(seeded(frame * 5 + i * 11) * w, seeded(frame * 7 + i * 5) * h, size * 2.2, size * 0.5);
  }
  const tear = ((t * 0.45) % 1) * h;
  ctx.globalAlpha = 0.6;
  ctx.fillRect(0, tear, w, Math.max(1, h * 0.006));
  ctx.globalAlpha = 1;
}

// Paper confetti tumbling down in the shape colour and its neighbours.
function drawConfetti(ctx, w, h, t, color) {
  const count = 70;
  ctx.shadowBlur = Math.min(w, h) * 0.012;
  for (let i = 0; i < count; i++) {
    const speed = 0.12 + seeded(i + 5) * 0.2;
    const phase = (seeded(i + 11) + t * speed) % 1;
    const sway = Math.sin(t * (1 + seeded(i) * 2) + i) * w * 0.035;
    const x = seeded(i + 23) * w + sway;
    const y = phase * (h + 30) - 15;
    const size = Math.min(w, h) * (0.016 + seeded(i + 31) * 0.022);
    const flip = Math.cos(t * (3 + seeded(i + 41) * 4) + i);
    const fill = tint(color, (seeded(i + 51) - 0.5) * 160, 6);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(t * (1 + seeded(i + 61) * 2) + i);
    ctx.scale(1, Math.abs(flip) * 0.9 + 0.1);
    ctx.fillStyle = flip > 0 ? fill : tint(color, (seeded(i + 51) - 0.5) * 160, -16);
    ctx.shadowColor = fill;
    ctx.fillRect(-size, -size * 0.55, size * 2, size * 1.1);
    ctx.restore();
  }
}

// A real wall clock showing the computer's local time.
function drawClock(ctx, w, h, t, color) {
  const cx = w / 2;
  const cy = h / 2;
  const radius = Math.min(w, h) * 0.44;
  const date = new Date();
  const seconds = date.getSeconds() + date.getMilliseconds() / 1000;
  const minutes = date.getMinutes() + seconds / 60;
  const hours = (date.getHours() % 12) + minutes / 60;
  ctx.shadowBlur = radius * 0.08;

  ctx.lineWidth = Math.max(1.5, radius * 0.025);
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 60; i++) {
    const angle = (i / 60) * TAU;
    const major = i % 5 === 0;
    const inner = radius * (major ? 0.84 : 0.92);
    ctx.globalAlpha = major ? 1 : 0.4;
    ctx.lineWidth = Math.max(1, radius * (major ? 0.028 : 0.012));
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * radius * 0.97, cy + Math.sin(angle) * radius * 0.97);
    ctx.stroke();
  }
  const hand = (value, total, length, width, stroke) => {
    const angle = (value / total) * TAU - Math.PI / 2;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(1.5, radius * width);
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(angle) * radius * 0.1, cy - Math.sin(angle) * radius * 0.1);
    ctx.lineTo(cx + Math.cos(angle) * radius * length, cy + Math.sin(angle) * radius * length);
    ctx.stroke();
  };
  ctx.globalAlpha = 1;
  hand(hours, 12, 0.5, 0.06, color);
  hand(minutes, 60, 0.74, 0.04, color);
  hand(seconds, 60, 0.82, 0.016, '#ffffff');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.045, 0, TAU);
  ctx.fill();
}

// Live frequency bars (mirrored). Follows the sound input when it is on, and
// falls back to a gentle synthetic motion so the look is never dead.
function drawSpectrum(ctx, w, h, t, color) {
  const live = isAudioActive();
  const { spectrum } = audioState();
  const bars = Math.max(12, Math.min(spectrum.length, Math.round(w / 14)));
  const gap = w / bars;
  const barWidth = gap * 0.68;
  ctx.shadowBlur = Math.min(w, h) * 0.035;
  for (let i = 0; i < bars; i++) {
    const index = Math.floor((i / bars) * spectrum.length);
    const value = live
      ? spectrum[index]
      : 0.16 + 0.5 * Math.abs(Math.sin(t * 1.7 + i * 0.42)) * (0.4 + 0.6 * Math.abs(Math.sin(t * 0.6 + i * 0.13)));
    const barHeight = Math.max(2, value * h * 0.46);
    const x = i * gap + (gap - barWidth) / 2;
    ctx.fillStyle = tint(color, (i / bars - 0.5) * 70, value * 22);
    ctx.globalAlpha = 0.5 + value * 0.5;
    ctx.fillRect(x, h / 2 - barHeight, barWidth, barHeight);
    ctx.globalAlpha = 0.22 + value * 0.3;
    ctx.fillRect(x, h / 2 + 2, barWidth, barHeight * 0.8);
  }
  ctx.globalAlpha = 1;
}

// Oscilloscope trace of the incoming sound.
function drawWaveform(ctx, w, h, t, color) {
  const live = isAudioActive();
  const { waveform, levels } = audioState();
  const points = 160;
  const draw = (scale, width, alpha, stroke) => {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const u = i / points;
      const sample = live
        ? waveform[Math.min(waveform.length - 1, Math.floor(u * waveform.length))]
        : Math.sin(u * 14 + t * 3) * 0.32 * Math.sin(u * Math.PI) + Math.sin(u * 47 - t * 5) * 0.07;
      const envelope = Math.sin(u * Math.PI);
      const y = h / 2 + sample * envelope * h * 0.42 * scale;
      if (i === 0) ctx.moveTo(u * w, y);
      else ctx.lineTo(u * w, y);
    }
    ctx.stroke();
  };
  const base = Math.max(1.5, Math.min(w, h) * 0.012);
  ctx.shadowBlur = Math.min(w, h) * 0.06 * (1 + (live ? levels.level : 0.3));
  draw(1, base * 2.6, 0.22, color);
  draw(1, base, 1, color);
  draw(1, base * 0.34, 0.9, '#ffffff');
  ctx.globalAlpha = 1;
}

// A ring that swells with the bass and throws a shockwave on every beat.
function drawBeatRing(ctx, w, h, t, color) {
  const live = isAudioActive();
  const { levels, spectrum } = audioState();
  const cx = w / 2;
  const cy = h / 2;
  const base = Math.min(w, h) * 0.24;
  const bass = live ? levels.bass : 0.5 + 0.5 * Math.sin(t * 4);
  const beat = live ? levels.beat : Math.exp(-((t * 2) % 1) * 5);
  const radius = base * (0.8 + bass * 0.5);
  ctx.shadowBlur = Math.min(w, h) * (0.04 + bass * 0.06);

  const spikes = 72;
  ctx.lineWidth = Math.max(1.5, base * 0.035);
  ctx.beginPath();
  for (let i = 0; i <= spikes; i++) {
    const angle = (i / spikes) * TAU + t * 0.2;
    const index = Math.floor((Math.abs(i - spikes / 2) / (spikes / 2)) * (spectrum.length - 1));
    const value = live ? spectrum[index] : 0.3 + 0.3 * Math.sin(t * 3 + i * 0.6);
    const r = radius + value * base * 0.7;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = 0.16 + bass * 0.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius * 0.78, 0, TAU);
  ctx.fill();

  // Shockwave: travels outward as the beat value decays from 1 to 0.
  const wave = 1 - beat;
  ctx.globalAlpha = beat * 0.9;
  ctx.lineWidth = Math.max(1, base * 0.05 * beat);
  ctx.beginPath();
  ctx.arc(cx, cy, radius + wave * Math.min(w, h) * 0.3, 0, TAU);
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
    case 'plasma': drawPlasma(ctx, w, h, t, color); break;
    case 'fire': drawFire(ctx, w, h, t, color); break;
    case 'lightning': drawLightning(ctx, w, h, t, color); break;
    case 'hexgrid': drawHexGrid(ctx, w, h, t, color); break;
    case 'bokeh': drawBokeh(ctx, w, h, t, color); break;
    case 'galaxy': drawGalaxy(ctx, w, h, t, color); break;
    case 'glitch': drawGlitch(ctx, w, h, t, color); break;
    case 'confetti': drawConfetti(ctx, w, h, t, color); break;
    case 'clock': drawClock(ctx, w, h, t, color); break;
    case 'spectrum': drawSpectrum(ctx, w, h, t, color); break;
    case 'waveform': drawWaveform(ctx, w, h, t, color); break;
    case 'beatring': drawBeatRing(ctx, w, h, t, color); break;
    default: drawCube(ctx, w, h, t, color);
  }
  ctx.restore();
}
