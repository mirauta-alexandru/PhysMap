// visualModes.js
// ---------------------------------------------------------------------------
// Autonomous facade eyes. The regular loop is intentionally subtle: the eyes
// scan like they are watching a street, follow imagined cars left-to-right and
// right-to-left, blink, settle, and frown only slightly. Rare specials add a
// small scene: an airplane, stars, and a mouth with teeth.

import { config } from './config.js';

const TAU = Math.PI * 2;

const NORMAL_SEGMENTS = [
  { name: 'quiet-watch', duration: 8000 },
  { name: 'car-left-right', duration: 10500 },
  { name: 'settle-blink', duration: 5200 },
  { name: 'check-left', duration: 6500 },
  { name: 'car-right-left', duration: 9800 },
  { name: 'small-frown', duration: 5200 },
  { name: 'look-down', duration: 5600 },
  { name: 'check-right', duration: 6500 },
  { name: 'far-left-hold', duration: 6200 },
  { name: 'slow-blink', duration: 5200 },
  { name: 'far-right-hold', duration: 6200 },
  { name: 'calm-breathe', duration: 9000 },
];

const SPECIALS = [
  { name: 'airplane', duration: 11800 },
  { name: 'star-catch', duration: 12600 },
  { name: 'teeth-smile', duration: 9800 },
  { name: 'constellation', duration: 13200 },
  { name: 'night-scan', duration: 10500 },
];

const normalTotal = NORMAL_SEGMENTS.reduce((sum, b) => sum + b.duration, 0);
const specialQuietGap = 110000;
const specialTotal = SPECIALS.reduce((sum, b) => sum + b.duration, 0);

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function mix(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function ease(t) {
  return smoothstep(0, 1, t);
}

function pulse(t, center, width) {
  return Math.max(0, 1 - Math.abs(t - center) / width);
}

function seeded(n) {
  const s = Math.sin(n * 12.9898) * 43758.5453;
  return s - Math.floor(s);
}

function segmentAt(ms) {
  let local = ms % normalTotal;
  for (const segment of NORMAL_SEGMENTS) {
    if (local <= segment.duration) return { ...segment, t: local / segment.duration };
    local -= segment.duration;
  }
  return { ...NORMAL_SEGMENTS[0], t: 0 };
}

function specialAt(ms) {
  const cycle = specialQuietGap + specialTotal;
  const localCycle = ms % cycle;
  if (localCycle < specialQuietGap) return null;

  let local = localCycle - specialQuietGap;
  for (let i = 0; i < SPECIALS.length; i++) {
    const special = SPECIALS[i];
    if (local <= special.duration) return { ...special, index: i, t: local / special.duration };
    local -= special.duration;
  }
  return null;
}

function naturalBlink(now, t) {
  const a = pulse((now * 0.001) % 5.7, 0.18, 0.035);
  const b = pulse((now * 0.001) % 8.9, 0.62, 0.03);
  const segmentBlink = Math.max(pulse(t, 0.28, 0.05), pulse(t, 0.74, 0.04));
  return Math.max(a, b, segmentBlink);
}

function carTrack(from, to, t) {
  const lead = ease(t);
  const saccade = Math.sin(t * Math.PI * 8) * 0.025 + Math.sin(t * Math.PI * 17) * 0.015;
  return mix(from, to, lead) + saccade;
}

function normalState(now) {
  const seg = segmentAt(now);
  const t = seg.t;
  const breath = Math.sin(now * 0.00115) * 0.018;
  const state = {
    gazeX: Math.sin(now * 0.00032) * 0.08,
    gazeY: Math.cos(now * 0.00025) * 0.035,
    leftGazeX: null,
    rightGazeX: null,
    leftOpen: 1,
    rightOpen: 1,
    eyeScale: 1 + breath,
    pupilScale: 1,
    browLift: 0,
    browTilt: 0,
    rimWarmth: 0.08,
    mouth: null,
  };

  if (seg.name === 'car-left-right') {
    state.gazeX = carTrack(-0.82, 0.82, t);
    state.gazeY = -0.03 + Math.sin(t * Math.PI * 2) * 0.035;
    state.browLift = pulse(t, 0.5, 0.48) * 0.08;
  } else if (seg.name === 'car-right-left') {
    state.gazeX = carTrack(0.82, -0.82, t);
    state.gazeY = -0.02 + Math.sin(t * Math.PI * 2.4) * 0.03;
    state.browLift = pulse(t, 0.48, 0.46) * 0.06;
  } else if (seg.name === 'check-left') {
    state.gazeX = mix(0, -0.55, ease(t));
    state.gazeY = -0.03;
  } else if (seg.name === 'check-right') {
    state.gazeX = mix(0, 0.55, ease(t));
    state.gazeY = -0.02;
  } else if (seg.name === 'far-left-hold') {
    state.gazeX = -0.72 + Math.sin(t * TAU) * 0.035;
    state.gazeY = 0.02;
    state.browTilt = 0.08;
  } else if (seg.name === 'far-right-hold') {
    state.gazeX = 0.72 + Math.sin(t * TAU) * 0.035;
    state.gazeY = 0.02;
    state.browTilt = -0.08;
  } else if (seg.name === 'look-down') {
    state.gazeX = Math.sin(t * Math.PI * 1.5) * 0.18;
    state.gazeY = mix(0, 0.36, ease(t));
    state.leftOpen -= 0.08;
    state.rightOpen -= 0.08;
  } else if (seg.name === 'small-frown') {
    state.gazeX = Math.sin(t * Math.PI * 2) * 0.12;
    state.gazeY = -0.04;
    state.leftOpen -= 0.12;
    state.rightOpen -= 0.12;
    state.browTilt = -0.18;
    state.pupilScale = 1.05;
  } else if (seg.name === 'settle-blink') {
    state.gazeX = mix(0.28, 0, ease(t));
    state.gazeY = 0.04;
  } else if (seg.name === 'slow-blink') {
    const close = pulse(t, 0.48, 0.16);
    state.leftOpen -= close * 0.78;
    state.rightOpen -= close * 0.78;
    state.gazeY = 0.1;
  } else if (seg.name === 'calm-breathe') {
    state.gazeX = Math.sin(t * TAU) * 0.12;
    state.gazeY = Math.sin(t * Math.PI * 4) * 0.045;
    state.rimWarmth = 0.12 + Math.sin(t * TAU) * 0.04;
  }

  const blink = naturalBlink(now, t);
  state.leftOpen = clamp(state.leftOpen - blink * 0.82, 0.08, 1.1);
  state.rightOpen = clamp(state.rightOpen - blink * 0.82, 0.08, 1.1);
  return { segment: seg.name, state };
}

function applyExternalTarget(state, target, now, width, height) {
  if (!target || now - target.lastSeen > 2500) return;
  const cx = width / 2;
  const cy = height / 2;
  state.gazeX = clamp((target.x - cx) / (width * 0.34), -0.9, 0.9);
  state.gazeY = clamp((target.y - cy) / (height * 0.34), -0.55, 0.55);
  state.browLift = 0.08;
}

function glowFill(ctx, color, blur = config.glow) {
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}

function buildEyes(width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const base = Math.min(width, height);
  const r = base * 0.118;
  return [
    { side: 'left', x: cx - width * 0.15, y: cy - height * 0.035, r, tilt: -0.012 },
    { side: 'right', x: cx + width * 0.15, y: cy - height * 0.035, r, tilt: 0.012 },
  ];
}

const EYE_STYLES = {
  round: {
    label: 'Round',
    white: '#ffffff',
    rim: '#ff1f2d',
    glow: '#ff1f2d',
    pupil: '#020202',
    highlight: '#ffffff',
    brow: 'rgba(255, 31, 45, 0.58)',
    pupilScale: 0.74,
    irisScale: 0,
    ringScale: 0,
    rxScale: 0.86,
    ryScale: 0.86,
    glowScale: 0.42,
    strokeScale: 0.04,
    outlineOnly: false,
    noPupil: false,
    thin: false,
  },
  hollow: {
    label: 'Hollow',
    white: '#ffffff',
    rim: '#ff1f2d',
    glow: '#ff1f2d',
    pupil: '#000000',
    highlight: '#ffffff',
    brow: 'rgba(255, 31, 45, 0.5)',
    pupilScale: 0,
    irisScale: 0.43,
    ringScale: 0,
    rxScale: 0.82,
    ryScale: 0.82,
    glowScale: 0.34,
    strokeScale: 0.034,
    outlineOnly: false,
    noPupil: true,
    thin: true,
  },
  'big-iris': {
    label: 'Big Iris',
    white: '#ffffff',
    rim: '#ff1f2d',
    glow: '#ff1f2d',
    pupil: '#050505',
    highlight: '#ffffff',
    brow: 'rgba(255, 31, 45, 0.56)',
    pupilScale: 0.55,
    irisScale: 0.48,
    ringScale: 0,
    rxScale: 0.86,
    ryScale: 0.86,
    glowScale: 0.38,
    strokeScale: 0.038,
    outlineOnly: false,
    noPupil: false,
    thin: false,
  },
  'red-core': {
    label: 'Red Core',
    white: '#ffffff',
    rim: '#ff1f2d',
    glow: '#ff1f2d',
    pupil: '#ff1f2d',
    highlight: '#ffffff',
    brow: 'rgba(255, 31, 45, 0.62)',
    pupilScale: 0.58,
    irisScale: 0.36,
    ringScale: 0,
    rxScale: 0.82,
    ryScale: 0.8,
    glowScale: 0.36,
    strokeScale: 0.036,
    outlineOnly: false,
    noPupil: false,
    thin: false,
  },
  minimal: {
    label: 'Minimal',
    white: '#ffffff',
    rim: '#ff1f2d',
    glow: '#ff1f2d',
    pupil: '#020202',
    highlight: '#ffffff',
    brow: 'rgba(255, 31, 45, 0.36)',
    pupilScale: 0.28,
    irisScale: 0,
    ringScale: 0,
    rxScale: 0.78,
    ryScale: 0.78,
    glowScale: 0.32,
    strokeScale: 0.03,
    outlineOnly: true,
    noPupil: false,
    thin: true,
  },
};

function getEyeStyle(styleName) {
  return EYE_STYLES[styleName] || EYE_STYLES.round;
}

function drawBrow(ctx, eye, state, open, style) {
  const dir = eye.side === 'left' ? -1 : 1;
  const lift = eye.r * ((style.ryScale || 0.84) + 0.34 + state.browLift * 0.18);
  const tilt = eye.tilt + state.browTilt * dir;
  ctx.save();
  ctx.translate(eye.x, eye.y - lift);
  ctx.rotate(tilt);
  ctx.beginPath();
  ctx.moveTo(-eye.r * 0.4, 0);
  ctx.quadraticCurveTo(0, -eye.r * 0.075, eye.r * 0.4, 0);
  ctx.strokeStyle = style.brow;
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = config.glow * 0.16;
  ctx.lineWidth = Math.max(2, eye.r * 0.018);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawEye(ctx, eye, state, style) {
  const open = eye.side === 'left' ? state.leftOpen : state.rightOpen;
  const gazeX = eye.side === 'left' && state.leftGazeX != null
    ? state.leftGazeX
    : eye.side === 'right' && state.rightGazeX != null
      ? state.rightGazeX
      : state.gazeX;
  const rx = eye.r * state.eyeScale * (style.rxScale || 0.84);
  const ry = eye.r * (style.ryScale || 0.84) * state.eyeScale * open;
  const tilt = eye.tilt;
  const pupilR = eye.r * 0.23 * state.pupilScale * style.pupilScale;
  const px = eye.x + clamp(gazeX, -1, 1) * eye.r * 0.33;
  const py = eye.y + clamp(state.gazeY, -1, 1) * eye.r * 0.23;
  const rim = style.rim;
  const white = style.white;

  ctx.save();
  ctx.translate(eye.x, eye.y);
  ctx.rotate(tilt);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, Math.max(eye.r * 0.035, ry), 0, 0, TAU);
  if (!style.outlineOnly) {
    glowFill(ctx, white, config.glow * (style.glowScale || 0.38));
    ctx.fill();
  }
  ctx.lineWidth = Math.max(style.thin ? 2.5 : 3, eye.r * (style.strokeScale || 0.038));
  ctx.strokeStyle = rim;
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = config.glow * (style.glowScale || 0.38);
  ctx.stroke();
  ctx.restore();

  if (open > 0.12) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, rx * 0.98, Math.max(eye.r * 0.04, ry * 0.98), tilt, 0, TAU);
    ctx.clip();

    if (style.irisScale > 0) {
      const irisR = eye.r * style.irisScale;
      ctx.beginPath();
      ctx.arc(px, py, irisR, 0, TAU);
      ctx.strokeStyle = style.rim;
      ctx.shadowColor = style.glow;
      ctx.shadowBlur = config.glow * 0.22;
      ctx.lineWidth = Math.max(2.5, eye.r * 0.036);
      ctx.stroke();
      if (style.ringScale > 0) {
        ctx.beginPath();
        ctx.arc(px, py, eye.r * style.ringScale, 0, TAU);
        ctx.strokeStyle = 'rgba(255, 31, 45, 0.32)';
        ctx.lineWidth = Math.max(1.5, eye.r * 0.018);
        ctx.stroke();
      }
    }

    if (!style.noPupil && pupilR > 1) {
      ctx.beginPath();
      ctx.arc(px, py, Math.max(6, pupilR), 0, TAU);
      glowFill(ctx, style.pupil, style.pupil === style.rim ? config.glow * 0.35 : 0);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px - pupilR * 0.34, py - pupilR * 0.38, Math.max(2, pupilR * 0.22), 0, TAU);
      glowFill(ctx, style.highlight, config.glow * 0.16);
      ctx.fill();
    }
    ctx.restore();
  }

  drawBrow(ctx, eye, state, open, style);
}

function drawMouth(ctx, width, height, t, mood = 'smile') {
  const cx = width / 2;
  const cy = height * 0.58;
  const base = Math.min(width, height);
  const open = mood === 'catch'
    ? base * (0.035 + pulse(t, 0.72, 0.28) * 0.06)
    : base * (0.026 + Math.sin(Math.PI * t) * 0.028);
  const w = base * (mood === 'catch' ? 0.16 : 0.18);
  const alpha = Math.sin(Math.PI * t);

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  ctx.ellipse(cx, cy, w, open, 0, 0, TAU);
  ctx.fillStyle = '#000000';
  ctx.shadowBlur = 0;
  ctx.fill();
  ctx.lineWidth = Math.max(3, base * 0.006);
  ctx.strokeStyle = '#ff1f2d';
  ctx.shadowColor = '#ff1f2d';
  ctx.shadowBlur = config.glow * 0.65;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = config.glow * 0.2;
  const teeth = mood === 'catch' ? 5 : 6;
  const toothW = w * 1.2 / teeth;
  for (let i = 0; i < teeth; i++) {
    const x = cx - w * 0.6 + i * toothW;
    ctx.fillRect(x, cy - open * 0.65, toothW * 0.72, open * 0.55);
  }
  ctx.restore();
}

function drawAirplane(ctx, width, height, t) {
  const base = Math.min(width, height);
  const x = mix(-width * 0.12, width * 1.12, ease(t));
  const y = height * (0.18 + Math.sin(t * Math.PI) * 0.08);
  const size = base * 0.048;
  const alpha = smoothstep(0, 0.14, t) * (1 - smoothstep(0.9, 1, t));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.rotate(-0.12);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = config.glow * 1.1;
  ctx.lineWidth = Math.max(2, base * 0.004);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-size * 1.15, 0);
  ctx.lineTo(size * 1.18, 0);
  ctx.lineTo(size * 1.42, -size * 0.1);
  ctx.moveTo(-size * 0.2, 0);
  ctx.lineTo(-size * 0.72, -size * 0.55);
  ctx.moveTo(-size * 0.05, 0);
  ctx.lineTo(-size * 0.62, size * 0.5);
  ctx.moveTo(-size * 0.95, 0);
  ctx.lineTo(-size * 1.22, -size * 0.28);
  ctx.moveTo(-size * 0.95, 0);
  ctx.lineTo(-size * 1.22, size * 0.28);
  ctx.stroke();
  ctx.restore();
}

function drawStars(ctx, width, height, t, count = 18) {
  const base = Math.min(width, height);
  const alpha = smoothstep(0, 0.18, t) * (1 - smoothstep(0.86, 1, t));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = config.glow * 0.75;
  ctx.lineWidth = Math.max(1.5, base * 0.0035);
  for (let i = 0; i < count; i++) {
    const x = width * (0.16 + seeded(i + 12) * 0.68);
    const y = height * (0.12 + seeded(i + 82) * 0.42) + Math.sin(t * TAU + i) * base * 0.012;
    const s = base * (0.006 + seeded(i + 4) * 0.009);
    ctx.beginPath();
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFallingStar(ctx, width, height, t) {
  const base = Math.min(width, height);
  const x = mix(width * 0.72, width * 0.5, ease(t));
  const y = mix(height * 0.16, height * 0.55, ease(t));
  const alpha = smoothstep(0, 0.16, t) * (1 - smoothstep(0.82, 1, t));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ff1f2d';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ff1f2d';
  ctx.shadowBlur = config.glow * 1.4;
  ctx.lineWidth = Math.max(3, base * 0.006);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + base * 0.08, y - base * 0.1);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, base * 0.012, 0, TAU);
  ctx.fill();
  ctx.restore();
}

function drawConstellation(ctx, width, height, t) {
  const points = [
    [0.28, 0.2], [0.36, 0.16], [0.45, 0.23], [0.54, 0.18], [0.64, 0.24], [0.72, 0.2],
  ];
  const base = Math.min(width, height);
  const reveal = ease(t);
  const alpha = smoothstep(0, 0.16, t) * (1 - smoothstep(0.88, 1, t));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ff1f2d';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#ff1f2d';
  ctx.shadowBlur = config.glow * 0.9;
  ctx.lineWidth = Math.max(2, base * 0.004);
  ctx.beginPath();
  for (let i = 0; i < points.length - 1; i++) {
    if (i / (points.length - 1) > reveal) break;
    const a = points[i];
    const b = points[i + 1];
    ctx.moveTo(a[0] * width, a[1] * height);
    ctx.lineTo(b[0] * width, b[1] * height);
  }
  ctx.stroke();
  for (let i = 0; i < points.length; i++) {
    if (i / points.length > reveal) break;
    const p = points[i];
    ctx.beginPath();
    ctx.arc(p[0] * width, p[1] * height, base * 0.009, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

function specialState(state, special, width, height) {
  if (!special) return state;
  const t = special.t;
  if (special.name === 'airplane') {
    state.gazeX = carTrack(-0.78, 0.78, t);
    state.gazeY = -0.55 + Math.sin(t * Math.PI) * 0.05;
    state.browLift = 0.24;
    state.rimWarmth = 0.35;
    state.mouth = t > 0.28 && t < 0.78 ? { mood: 'smile', t: (t - 0.28) / 0.5 } : null;
  } else if (special.name === 'star-catch') {
    state.gazeX = mix(0.55, 0, ease(t));
    state.gazeY = mix(-0.45, 0.35, ease(t));
    state.browLift = 0.18;
    state.rimWarmth = 0.5;
    state.mouth = { mood: 'catch', t };
  } else if (special.name === 'teeth-smile') {
    state.gazeX = Math.sin(t * TAU) * 0.16;
    state.gazeY = 0.08;
    state.leftOpen -= Math.sin(Math.PI * t) * 0.18;
    state.rightOpen -= Math.sin(Math.PI * t) * 0.18;
    state.rimWarmth = 0.42;
    state.mouth = { mood: 'smile', t };
  } else if (special.name === 'constellation') {
    state.gazeX = Math.sin(t * Math.PI * 1.4) * 0.62;
    state.gazeY = -0.42 + Math.sin(t * Math.PI * 2) * 0.08;
    state.browLift = 0.15;
  } else if (special.name === 'night-scan') {
    state.gazeX = Math.sin(t * Math.PI * 2) * 0.28;
    state.gazeY = -0.08;
    state.leftOpen -= 0.12;
    state.rightOpen -= 0.12;
    state.browTilt = -0.12;
  }
  state.leftOpen = clamp(state.leftOpen, 0.08, 1.16);
  state.rightOpen = clamp(state.rightOpen, 0.08, 1.16);
  return state;
}

function drawNightScan(ctx, width, height, t) {
  const base = Math.min(width, height);
  const alpha = smoothstep(0, 0.18, t) * (1 - smoothstep(0.82, 1, t));
  const y = mix(height * 0.26, height * 0.58, ease(t));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ff1f2d';
  ctx.shadowColor = '#ff1f2d';
  ctx.shadowBlur = config.glow * 0.8;
  ctx.lineWidth = Math.max(2, base * 0.004);
  ctx.beginPath();
  ctx.moveTo(width * 0.24, y);
  ctx.lineTo(width * 0.76, y);
  ctx.stroke();
  ctx.restore();
}

function drawSpecial(ctx, width, height, special) {
  if (!special) return;
  if (special.name === 'airplane') {
    drawAirplane(ctx, width, height, special.t);
    drawStars(ctx, width, height, special.t, 10);
  } else if (special.name === 'star-catch') {
    drawFallingStar(ctx, width, height, special.t);
  } else if (special.name === 'teeth-smile') {
    drawStars(ctx, width, height, special.t, 20);
  } else if (special.name === 'constellation') {
    drawConstellation(ctx, width, height, special.t);
  } else if (special.name === 'night-scan') {
    drawNightScan(ctx, width, height, special.t);
  }
}

export function renderEyes(ctx, bodies, width, height, now, options = {}) {
  const debugOffset = Number(new URLSearchParams(window.location.search).get('debugOffset') || 0);
  const time = now + debugOffset;
  const { state } = normalState(time);
  const special = specialAt(time);
  const style = getEyeStyle(options.eyeStyle || config.eyeStyle);

  applyExternalTarget(state, options.trackingTarget, time, width, height);
  specialState(state, special, width, height);

  drawSpecial(ctx, width, height, special);
  for (const eye of buildEyes(width, height)) drawEye(ctx, eye, state, style);
  if (state.mouth) drawMouth(ctx, width, height, state.mouth.t, state.mouth.mood);
}

export function renderVisualMode(ctx, bodies, width, height, now, mode, options = {}) {
  if (mode === 'eyes') renderEyes(ctx, bodies, width, height, now, options);
}
