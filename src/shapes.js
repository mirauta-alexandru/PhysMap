// shapes.js
// ---------------------------------------------------------------------------
// The heart of the reformed app: drawable SHAPE OBJECTS.
//
// A shape is a polygon you draw over a real object on the facade (square,
// triangle, or a freeform poly whose points you drag to model the object).
// Each shape then has:
//   - a ROLE:  'decor' (no physics, pure visual)
//              'obstacle' (static body — particles collide with it)
//              'dynamic' (a body that falls / can be knocked around)
//   - a FILL:  how it looks when projected — solid, outline, glow, pulse,
//              rainbow, or an imported image/video mapped into it.
//
// This module owns: the shape data model, geometry helpers, the Matter body
// for each physics shape, all pointer interaction for the shape tools
// (square / triangle / poly / select + vertex dragging), and shape rendering.
// It is additive — the rest of the app keeps working unchanged.

import Matter from 'matter-js';
import { config } from './config.js';
import { world } from './physics.js';
import { warpImageToQuad } from './mapping.js';
import { renderAnimation } from './animations.js';
import { audioEnergy, isAudioActive } from './audio.js';

const { Bodies, Composite, Vertices } = Matter;
const TAU = Math.PI * 2;

export const TEXT_STYLES = ['static', 'marquee', 'blink', 'type'];
export const TEXT_FONTS = {
  pixel: "'Press Start 2P', 'Silkscreen', monospace",
  bold: "800 1px -apple-system, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  serif: "600 1px Georgia, 'Times New Roman', serif",
};
export const REACT_BANDS = ['off', 'level', 'bass', 'mid', 'treble'];
export const LIVE_FILLS = ['camera', 'screen'];

let nextId = 1;

// In-progress drawing state, read by the renderer to show a live preview.
let preview = null; // square/triangle drag preview: { type, points }
let polyDraft = null; // freeform poly being clicked out: { points: [...] }

export function getShapePreview() {
  return preview;
}
export function getPolyDraft() {
  return polyDraft;
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
export function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

export function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function centroid(points) {
  let x = 0, y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return { x: x / points.length, y: y / points.length };
}

// Ray-casting point-in-polygon (works for convex and concave).
export function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i][0], yi = points[i][1];
    const xj = points[j][0], yj = points[j][1];
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Shape factory + canned point sets
// ---------------------------------------------------------------------------
export function makeShape(opts) {
  return {
    id: opts.id ?? nextId++,
    name: typeof opts.name === 'string' ? opts.name : '',
    visible: opts.visible !== false,
    locked: opts.locked === true,
    type: opts.type || 'poly', // 'rect' | 'triangle' | 'poly' | 'line'
    points: opts.points.map((p) => [p[0], p[1]]),
    // Open polyline ('line') vs closed polygon (everything else). When undefined
    // we infer it from the type so old saved scenes keep behaving as before.
    closed: opts.closed !== undefined ? opts.closed : opts.type !== 'line',
    // Per-edge quadratic control points. curves[i] is the control point for the
    // edge from points[i] -> points[i+1] (null/absent = straight edge).
    curves: Array.isArray(opts.curves)
      ? opts.curves.map((c) => (c ? [c[0], c[1]] : null))
      : [],
    role: opts.role || 'decor', // 'decor' | 'obstacle' | 'dynamic'
    fill: opts.fill || 'outline', // 'outline'|'solid'|'glow'|'pulse'|'rainbow'|'image'|'video'|'youtube'|'anim'
    anim: opts.anim || 'cube3d', // animation name when fill === 'anim'
    animSpeed: Math.max(0.25, Math.min(3, Number(opts.animSpeed) || 1)),
    animIntensity: Math.max(0.2, Math.min(1, Number(opts.animIntensity) || 1)),
    quickLook: typeof opts.quickLook === 'string' ? opts.quickLook : '',
    color: opts.color || config.shapeColor,
    strokeWidth: Math.max(1, Math.min(20, Number(opts.strokeWidth) || config.shapeOutlineWidth)),
    outlineFx: ['static', 'snake', 'chase', 'sparks'].includes(opts.outlineFx)
      ? opts.outlineFx
      : 'snake',
    outlineSpeed: Math.max(0.25, Math.min(3, Number(opts.outlineSpeed) || 1)),
    image: opts.image || null, // dataURL when fill === 'image'
    video: opts.video || null, // dataURL when fill === 'video'
    youtube: opts.youtube || null, // YouTube video id when fill === 'youtube'
    // Projected text (fill === 'text'). Supports {time}, {seconds} and {date}.
    text: typeof opts.text === 'string' ? opts.text.slice(0, 280) : '',
    textStyle: TEXT_STYLES.includes(opts.textStyle) ? opts.textStyle : 'static',
    textFont: TEXT_FONTS[opts.textFont] ? opts.textFont : 'pixel',
    // Sound reactivity: which band drives this shape, and how strongly.
    react: REACT_BANDS.includes(opts.react) ? opts.react : 'off',
    reactAmount: Math.max(0.1, Math.min(1, Number(opts.reactAmount) || 0.7)),
    _reactPhase: 0, // extra animation time accumulated from sound energy
    _lastNow: 0,
    _born: 0, // creation timestamp, drives the editor-only arrival ping
    _img: null, // decoded HTMLImageElement cache
    _video: null, // HTMLVideoElement cache for the 'video' fill
    _animCanvas: null, // offscreen cache for animated fills
    body: null, // Matter body when role !== 'decor'
  };
}

// Eight points on an ellipse inscribed in the drag box, plus the quadratic
// control point for every edge (the intersection of the neighbouring tangents).
// Eight arcs keep the outline within 0.3% of a true ellipse.
export function circleGeometry(x0, y0, x1, y1) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  const points = [];
  const curves = [];
  const outer = 1 / Math.cos(Math.PI / 8);
  for (let i = 0; i < 8; i++) {
    const angle = -Math.PI / 2 + (i / 8) * TAU;
    const mid = angle + Math.PI / 8;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
    curves.push([cx + Math.cos(mid) * rx * outer, cy + Math.sin(mid) * ry * outer]);
  }
  return { points, curves };
}

// Bounding-box rectangle from a drag (two opposite corners).
export function rectPoints(x0, y0, x1, y1) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  return [[ax, ay], [bx, ay], [bx, by], [ax, by]];
}

// Triangle inscribed in the drag box: apex at top-center, base along the bottom.
export function trianglePoints(x0, y0, x1, y1) {
  const ax = Math.min(x0, x1), bx = Math.max(x0, x1);
  const ay = Math.min(y0, y1), by = Math.max(y0, y1);
  return [[(ax + bx) / 2, ay], [bx, by], [ax, by]];
}

// ---------------------------------------------------------------------------
// Physics body management
// ---------------------------------------------------------------------------
// Build (or rebuild) the Matter body for a shape. Decor shapes have no body.
export function buildShapeBody(shape) {
  removeShapeBody(shape);
  if (shape.visible === false) return null;
  if (shape.role === 'decor') return null;
  if (shape.points.length < 3) return null;

  const verts = shape.points.map((p) => ({ x: p[0], y: p[1] }));
  const c = Vertices.centre(verts);
  const isStatic = shape.role === 'obstacle';
  const opts = {
    isStatic,
    label: 'shape',
    restitution: 0.25,
    friction: 0.4,
  };

  let body = null;
  try {
    body = Bodies.fromVertices(c.x, c.y, [verts], opts, true);
  } catch (err) {
    body = null;
  }
  // Fallback: if decomposition failed, use the bounding box.
  if (!body) {
    const bb = bbox(shape.points);
    body = Bodies.rectangle(
      (bb.minX + bb.maxX) / 2,
      (bb.minY + bb.maxY) / 2,
      Math.max(4, bb.w),
      Math.max(4, bb.h),
      opts,
    );
  }
  body.plugin = { shapeId: shape.id };
  body.physmap = { type: 'shape' };
  shape.body = body;
  Composite.add(world, body);
  return body;
}

export function removeShapeBody(shape) {
  if (shape.body) {
    Composite.remove(world, shape.body);
    shape.body = null;
  }
}

// World-space polygon to render for a shape: the live body vertices for a
// moving dynamic shape, otherwise the exact authored points.
function renderPoints(shape) {
  if (shape.role === 'dynamic' && shape.body) {
    return shape.body.vertices.map((v) => [v.x, v.y]);
  }
  return shape.points;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

// How many edges a shape has: open lines have one fewer than their point count.
function edgeCount(shape, n) {
  return shape.closed === false ? Math.max(0, n - 1) : n;
}

// Curve-aware path: straight edges use lineTo, curved edges (an entry in
// shape.curves) use a quadratic through their control point. Open lines aren't
// closed. This replaces tracePath wherever a real shape (with optional curves /
// open ends) is being drawn, clipped, or filled.
function tracePathShape(ctx, shape, pts) {
  const n = pts.length;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  const edges = edgeCount(shape, n);
  for (let i = 0; i < edges; i++) {
    const b = pts[(i + 1) % n];
    const c = shape.curves && shape.curves[i];
    if (c) ctx.quadraticCurveTo(c[0], c[1], b[0], b[1]);
    else ctx.lineTo(b[0], b[1]);
  }
  if (shape.closed !== false) ctx.closePath();
}

// The point where an edge's "curve grip" sits: the midpoint of a straight edge,
// or the t=0.5 point of the quadratic when the edge is curved. Dragging this
// grip bends the edge so the curve passes through the cursor.
function edgeGrip(shape, pts, i) {
  const n = pts.length;
  const a = pts[i];
  const b = pts[(i + 1) % n];
  const c = shape.curves && shape.curves[i];
  if (c) {
    return [0.25 * a[0] + 0.5 * c[0] + 0.25 * b[0], 0.25 * a[1] + 0.5 * c[1] + 0.25 * b[1]];
  }
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

// Set edge i's control point so the quadratic's midpoint lands on (hx, hy).
export function setEdgeCurve(shape, i, hx, hy) {
  const n = shape.points.length;
  const a = shape.points[i];
  const b = shape.points[(i + 1) % n];
  if (!Array.isArray(shape.curves)) shape.curves = [];
  shape.curves[i] = [2 * hx - 0.5 * (a[0] + b[0]), 2 * hy - 0.5 * (a[1] + b[1])];
}

// Distance from point p to segment a-b (used to grab a line anywhere along it).
function distToSegment(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

// Hover state for the curve grips (so we can highlight the one under the cursor
// and hint "click here to curve"). Read by the renderer.
let hoverCurve = null; // { shapeId, edge }
export function getHoverCurve() {
  return hoverCurve;
}
export function setHoverCurve(v) {
  hoverCurve = v;
}

// Resolve the effective color for animated fills.
function effectiveColor(shape, now) {
  if (shape.fill === 'rainbow') {
    const hue = (now * 0.05 + shape.id * 47) % 360;
    return `hsl(${hue}, 100%, 60%)`;
  }
  return shape.color;
}

function shapePathLength(shape, pts) {
  const edges = edgeCount(shape, pts.length);
  let total = 0;
  for (let i = 0; i < edges; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const c = shape.curves?.[i];
    if (!c) {
      total += dist(a[0], a[1], b[0], b[1]);
      continue;
    }
    let px = a[0];
    let py = a[1];
    for (let step = 1; step <= 12; step++) {
      const t = step / 12;
      const inv = 1 - t;
      const x = inv * inv * a[0] + 2 * inv * t * c[0] + t * t * b[0];
      const y = inv * inv * a[1] + 2 * inv * t * c[1] + t * t * b[1];
      total += dist(px, py, x, y);
      px = x;
      py = y;
    }
  }
  return Math.max(1, total);
}

function drawOutline(ctx, shape, pts, now, color, strokeWidth, gain = 1) {
  const fx = shape.outlineFx || 'snake';
  const speed = shape.outlineSpeed || 1;
  const length = shapePathLength(shape, pts);

  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.shadowColor = color;

  // The dim rail remains visible while the bright LED segment travels over it.
  tracePathShape(ctx, shape, pts);
  ctx.globalAlpha = (fx === 'static' ? 0.2 : 0.16) * gain;
  ctx.lineWidth = strokeWidth * 2.4;
  ctx.shadowBlur = config.glow * (fx === 'static' ? 2.2 : 1.1);
  ctx.stroke();

  tracePathShape(ctx, shape, pts);
  ctx.globalAlpha = (fx === 'static' ? 1 : 0.3) * gain;
  ctx.lineWidth = strokeWidth;
  ctx.shadowBlur = config.glow * 0.65;
  ctx.stroke();

  if (fx === 'static') return;

  const travel = now * 0.12 * speed + shape.id * 31;
  if (fx === 'snake') {
    const lit = Math.max(32, Math.min(length * 0.22, 180));
    ctx.setLineDash([lit, Math.max(1, length - lit)]);
    ctx.lineDashOffset = -travel;
    ctx.lineWidth = strokeWidth * 1.35;
  } else if (fx === 'chase') {
    const lit = Math.max(12, strokeWidth * 5);
    const dark = Math.max(18, strokeWidth * 8);
    ctx.setLineDash([lit, dark]);
    ctx.lineDashOffset = -travel;
    ctx.lineWidth = strokeWidth * 1.15;
  } else {
    ctx.setLineDash([0.1, Math.max(12, strokeWidth * 5.5)]);
    ctx.lineDashOffset = -travel;
    ctx.lineWidth = Math.max(2, strokeWidth * 1.5);
  }

  tracePathShape(ctx, shape, pts);
  ctx.globalAlpha = 0.92 * gain;
  ctx.shadowBlur = config.glow * 2.4;
  ctx.stroke();

  // A white-hot core makes the moving section read like an actual LED strip.
  tracePathShape(ctx, shape, pts);
  ctx.globalAlpha = 0.82 * gain;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, strokeWidth * 0.34);
  ctx.shadowColor = color;
  ctx.shadowBlur = config.glow * 0.8;
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineDashOffset = 0;
}

// Resolve {time} / {seconds} / {date} tokens so text can show a live clock.
function resolveText(text) {
  if (!text.includes('{')) return text;
  const date = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const time = `${two(date.getHours())}:${two(date.getMinutes())}`;
  return text
    .replaceAll('{time}', time)
    .replaceAll('{seconds}', `${time}:${two(date.getSeconds())}`)
    .replaceAll('{date}', date.toLocaleDateString());
}

// Paint the shape's text into its offscreen canvas, fitted to the box. The
// canvas is then warped / clipped onto the shape exactly like an animation.
function renderText(target, shape, W, H, now, color) {
  target.save();
  target.clearRect(0, 0, W, H);
  const raw = resolveText(shape.text || 'PHYSMAP');
  const style = shape.textStyle || 'static';
  const family = TEXT_FONTS[shape.textFont] || TEXT_FONTS.pixel;
  const setFont = (size) => {
    target.font = family.includes(' 1px ')
      ? family.replace(' 1px ', ` ${size}px `)
      : `${size}px ${family}`;
  };
  const t = now * 0.001;
  target.fillStyle = color;
  target.shadowColor = color;
  target.textBaseline = 'middle';

  if (style === 'marquee') {
    const line = raw.replace(/\s*\n\s*/g, '   ');
    const size = Math.max(8, Math.min(H * 0.56, W * 0.3));
    setFont(size);
    target.shadowBlur = size * 0.16;
    target.textAlign = 'left';
    const textWidth = target.measureText(line).width;
    const lap = textWidth + W;
    const x = W - ((t * size * 2.2) % lap);
    target.fillText(line, x, H / 2);
  } else {
    const lines = raw.split('\n').slice(0, 6);
    setFont(100);
    const widest = Math.max(1, ...lines.map((line) => target.measureText(line).width));
    const size = Math.max(6, Math.min((W * 0.9 * 100) / widest, (H * 0.84) / (lines.length * 1.18)));
    setFont(size);
    target.shadowBlur = size * 0.16;
    target.textAlign = 'center';
    if (style === 'blink') target.globalAlpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 5));

    // Typewriter: reveal characters, hold, then start over.
    const total = lines.join('').length;
    const cycle = total + 14;
    let budget = style === 'type' ? Math.floor((t * 9) % cycle) : Infinity;
    const lineHeight = size * 1.18;
    const top = H / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => {
      const visible = line.slice(0, Math.max(0, budget));
      budget -= line.length;
      const y = top + index * lineHeight;
      if (style === 'type') {
        const full = target.measureText(line).width;
        target.textAlign = 'left';
        target.fillText(visible, W / 2 - full / 2, y);
        const typing = visible.length < line.length || index === lines.length - 1;
        if (typing && visible.length && budget <= 0 && Math.sin(t * 9) > 0) {
          const cursor = W / 2 - full / 2 + target.measureText(visible).width;
          target.fillRect(cursor + size * 0.06, y - size * 0.42, size * 0.1, size * 0.84);
        }
      } else {
        target.fillText(line, W / 2, y);
      }
    });
  }
  target.restore();
}

function drawOneShape(ctx, shape, now, editMode = false) {
  const pts = renderPoints(shape);
  if (!pts || pts.length < 2) return;
  const color = effectiveColor(shape, now);
  let strokeWidth = shape.strokeWidth || config.shapeOutlineWidth;

  // An image is ready when decoded; a video is ready once it has frame data.
  const media = shape._video || shape._img;
  const mediaReady = media && (media.complete || media.readyState >= 2);

  // Sound reactivity: the chosen band lifts brightness (dim in silence, full on
  // peaks) and pushes animation time forward, so motion surges with the music.
  const reactive = shape.react && shape.react !== 'off' && isAudioActive();
  const energy = reactive ? audioEnergy(shape.react) : 0;
  const amount = reactive ? shape.reactAmount || 0.7 : 0;
  const gain = reactive ? 1 - amount * 0.78 + amount * 0.78 * energy : 1;
  if (reactive && shape._lastNow !== now) {
    const dt = shape._lastNow ? Math.min(100, now - shape._lastNow) : 16;
    shape._reactPhase = (shape._reactPhase || 0) + dt * energy * amount * 2.2;
  }
  shape._lastNow = now;
  if (reactive) strokeWidth *= 1 + energy * amount * 0.9;

  ctx.save();
  if (shape.fill === 'anim' || shape.fill === 'text') {
    // Render the animation to a per-shape offscreen canvas, then map it onto
    // the shape (perspective warp for quads, clip-fit for other polygons) so
    // the graphic conforms to the real object.
    const bb = bbox(pts);
    const W = Math.max(8, Math.min(1200, Math.round(bb.w)));
    const H = Math.max(8, Math.min(1200, Math.round(bb.h)));
    if (!shape._animCanvas) {
      shape._animCanvas = document.createElement('canvas');
      shape._animCtx = shape._animCanvas.getContext('2d');
    }
    if (shape._animCanvas.width !== W || shape._animCanvas.height !== H) {
      shape._animCanvas.width = W;
      shape._animCanvas.height = H;
    }
    const clock = now * (shape.animSpeed || 1) + (shape._reactPhase || 0);
    if (shape.fill === 'text') renderText(shape._animCtx, shape, W, H, clock, color);
    else renderAnimation(shape._animCtx, shape.anim, W, H, clock, color);
    ctx.globalAlpha = (shape.animIntensity || 1) * gain;
    if (pts.length === 4) {
      warpImageToQuad(ctx, shape._animCanvas, pts);
    } else {
      tracePathShape(ctx, shape, pts);
      ctx.clip();
      ctx.drawImage(shape._animCanvas, bb.minX, bb.minY, bb.w, bb.h);
    }
  } else if (LIVE_FILLS.includes(shape.fill) && !mediaReady) {
    // A live source that is not running: nothing is projected, but the editor
    // shows where it will appear and how to start it.
    if (editMode) drawLivePlaceholder(ctx, shape, pts);
  } else if (MEDIA_FILLS.includes(shape.fill) && mediaReady) {
    ctx.globalAlpha = gain;
    if (pts.length === 4) {
      // 4-corner shape → true perspective warp, so the media conforms to the
      // object as you drag the corners. This is the projection-mapping core.
      warpImageToQuad(ctx, media, pts);
    } else {
      // Triangle / freeform poly → clip to the polygon, fit to its box.
      const bb = bbox(pts);
      tracePathShape(ctx, shape, pts);
      ctx.clip();
      ctx.drawImage(media, bb.minX, bb.minY, bb.w, bb.h);
    }
  } else if (shape.fill === 'youtube') {
    // The actual video is a warped <iframe> floated *behind* the canvas (see
    // youtube.js). Here we punch a transparent hole in the opaque-black canvas
    // exactly over the shape so the warped player shows through and lines up.
    tracePathShape(ctx, shape, pts);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fill();
  } else if (shape.fill === 'outline') {
    drawOutline(ctx, shape, pts, now, color, strokeWidth, gain);
  } else {
    // Filled variants: solid / glow / pulse / rainbow.
    let alpha = gain;
    let blur = config.glow * 0.6 * (1 + energy * amount * 1.6);
    if (shape.fill === 'glow') blur = config.glow * 1.4;
    if (shape.fill === 'pulse') alpha *= 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(now * 0.004 + shape.id));
    tracePathShape(ctx, shape, pts);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.fill();

    // Glow and pulse fills get a restrained luminous rim for dimensionality.
    if (shape.closed !== false && (shape.fill === 'glow' || shape.fill === 'pulse')) {
      tracePathShape(ctx, shape, pts);
      ctx.globalAlpha = alpha * 0.72;
      ctx.fillStyle = 'transparent';
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.2, strokeWidth * 0.42);
      ctx.shadowBlur = blur * 1.6;
      ctx.stroke();
    }
  }
  ctx.restore();
}

const MEDIA_FILLS = ['image', 'video', ...LIVE_FILLS];

function drawLivePlaceholder(ctx, shape, pts) {
  const center = centroid(pts);
  tracePathShape(ctx, shape, pts);
  ctx.fillStyle = 'rgba(53, 215, 255, 0.07)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(53, 215, 255, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#35d7ff';
  ctx.font = '10px Silkscreen, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(shape.fill === 'camera' ? 'CAMERA OFF' : 'SCREEN OFF', center.x, center.y - 7);
  ctx.globalAlpha = 0.7;
  ctx.fillText('START IT IN MEDIA', center.x, center.y + 8);
}

// A 'mask' (Cut) shape paints an opaque-black hole that hides everything behind
// it — warped video, image fills, and even the YouTube iframe that shows
// through the canvas. Masks are drawn LAST so they sit on top of every other
// shape and of the youtube "holes". In edit mode they're semi-transparent with
// a dashed magenta outline so you can still see/position them over the video.
function drawMask(ctx, shape, editMode) {
  const pts = renderPoints(shape);
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  tracePath(ctx, pts);
  ctx.fillStyle = editMode ? 'rgba(0, 0, 0, 0.72)' : '#000000';
  ctx.fill();
  if (editMode) {
    ctx.strokeStyle = '#ff3df0';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

// Marching-ants selection. Switched off together with reduced UI motion.
let animateSelection = true;
export function setSelectionMotion(enabled) {
  animateSelection = enabled !== false;
}

// Draw all shapes. In edit mode also draws outlines + vertex handles on the
// selected shape, plus the in-progress create/poly preview.
export function drawShapes(ctx, app, editMode, now) {
  // Normal shapes first; mask (Cut) shapes are deferred to a top pass below.
  for (const shape of app.shapes) {
    if (shape.visible === false) continue;
    if (shape.fill === 'mask') continue;
    drawOneShape(ctx, shape, now, editMode);
  }
  // Mask pass: opaque-black cut-outs on top of everything (incl. youtube holes).
  for (const shape of app.shapes) {
    if (shape.visible === false) continue;
    if (shape.fill === 'mask') drawMask(ctx, shape, editMode);
  }

  if (!editMode) return;

  // Arrival ping: a freshly created shape throws one soft ring outward from
  // its outline. Editor-only, so the projector never sees it.
  for (const shape of app.shapes) {
    if (!shape._born || shape.visible === false) continue;
    const age = (now - shape._born) / 520;
    if (age >= 1 || age < 0) {
      shape._born = 0;
      continue;
    }
    const pts = renderPoints(shape);
    const center = centroid(pts);
    const ease = 1 - (1 - age) ** 3;
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.scale(1 + ease * 0.16, 1 + ease * 0.16);
    ctx.translate(-center.x, -center.y);
    tracePathShape(ctx, shape, pts);
    ctx.globalAlpha = (1 - age) * 0.85;
    ctx.strokeStyle = config.selectionColor;
    ctx.shadowColor = config.selectionColor;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2.5 * (1 - age) + 0.5;
    ctx.stroke();
    ctx.restore();
  }

  // Selection outline + vertex handles + curve grips.
  const sel = app.shapes.find((s) => s.id === app.selectedShapeId);
  if (sel && sel.visible !== false) {
    const pts = renderPoints(sel);
    ctx.save();
    tracePathShape(ctx, sel, pts);
    ctx.strokeStyle = config.selectionColor;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = animateSelection ? -(now * 0.018) % 9 : 0;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    if (!sel.locked) {
      // Curve grips: a small dot at the middle of every edge. Drag one to bend
      // that edge into a curve; the hovered grip is highlighted as a hint.
      const edges = edgeCount(sel, pts.length);
      for (let i = 0; i < edges; i++) {
        const g = edgeGrip(sel, pts, i);
        const hovered = hoverCurve && hoverCurve.shapeId === sel.id && hoverCurve.edge === i;
        const curved = sel.curves && sel.curves[i];
        ctx.beginPath();
        ctx.arc(g[0], g[1], hovered ? config.handleRadius * 0.95 : config.handleRadius * 0.62, 0, TAU);
        ctx.fillStyle = curved ? '#7CFF6B' : 'rgba(124,255,107,0.65)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#0b0b0b';
        ctx.stroke();
      }

      // Vertex handles sit on the authored points (what you actually edit).
      for (const [x, y] of sel.points) {
        ctx.beginPath();
        ctx.arc(x, y, config.handleRadius, 0, TAU);
        ctx.fillStyle = config.selectionColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#0b0b0b';
        ctx.stroke();
      }
    } else {
      const center = centroid(pts);
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(5, 9, 11, 0.9)';
      ctx.fillRect(center.x - 21, center.y - 11, 42, 22);
      ctx.fillStyle = config.selectionColor;
      ctx.font = '10px Silkscreen, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('LOCK', center.x, center.y + 1);
    }
    ctx.restore();
  }

  // Live preview for square/triangle drag.
  if (preview) {
    ctx.save();
    if (preview.curves) tracePathShape(ctx, { closed: true, curves: preview.curves }, preview.points);
    else tracePath(ctx, preview.points);
    ctx.strokeStyle = config.selectionColor;
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // Live preview for the line being clicked out.
  if (polyDraft && polyDraft.points.length) {
    const dp = polyDraft.points;
    const last = dp[dp.length - 1];
    const first = dp[0];
    ctx.save();

    // Committed segments so far.
    ctx.strokeStyle = config.selectionColor;
    ctx.fillStyle = config.selectionColor;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < dp.length; i++) ctx.lineTo(dp[i][0], dp[i][1]);
    ctx.stroke();

    // Rubber-band preview from the last point to the cursor — shows where the
    // next click will go. If the cursor is near the first point (and we have
    // enough points), preview the CLOSING segment instead so you can see the
    // shape close into a uniform form.
    if (polyDraft.cursor) {
      const target = polyDraft.nearFirst ? first : polyDraft.cursor;
      ctx.setLineDash([6, 5]);
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(last[0], last[1]);
      ctx.lineTo(target[0], target[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // Point dots.
    for (const [x, y] of dp) {
      ctx.beginPath();
      ctx.arc(x, y, config.handleRadius * 0.55, 0, TAU);
      ctx.fill();
    }

    // Highlight the first point when the cursor is hovering it to close: a
    // pulsing ring telling you "click here to finish into a shape".
    if (polyDraft.nearFirst) {
      ctx.beginPath();
      ctx.arc(first[0], first[1], config.handleRadius * 1.4, 0, TAU);
      ctx.strokeStyle = '#7CFF6B';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// Pointer input for shape tools (square / triangle / line / select)
// ---------------------------------------------------------------------------
const SHAPE_TOOLS = new Set(['square', 'triangle', 'circle', 'line', 'select']);

export function initShapeInput(canvas, app, hooks = {}) {
  const beforeChange = hooks.beforeChange || (() => {});
  const onChange = hooks.onChange || (() => {});
  const onSelect = hooks.onSelect || (() => {});
  const onCreated = hooks.onCreated || (() => {});
  const onContextMenu = hooks.onContextMenu || (() => {});
  const transformPoint = hooks.transformPoint || ((point) => point);

  let mode = null; // 'create' | 'move' | 'vertex' | 'curve'
  let startX = 0, startY = 0;
  let dragVertexIndex = -1;
  let dragEdgeIndex = -1;
  let moveLast = null;
  let movePointerOffset = null;
  let committed = false;

  // Find the curve grip (edge) of the selected shape near point p, if any.
  function curveGripAt(sel, x, y) {
    const pts = renderPoints(sel);
    const edges = edgeCount(sel, pts.length);
    for (let i = 0; i < edges; i++) {
      const g = edgeGrip(sel, pts, i);
      if (dist(x, y, g[0], g[1]) <= config.handleRadius * 1.05) return i;
    }
    return -1;
  }

  // For open lines: the nearest edge whose segment passes close to point p.
  function lineEdgeNear(sel, x, y) {
    if (sel.closed !== false) return -1;
    const pts = renderPoints(sel);
    const edges = edgeCount(sel, pts.length);
    let best = -1;
    let bestD = config.handleRadius * 0.8;
    for (let i = 0; i < edges; i++) {
      const d = distToSegment(x, y, pts[i], pts[i + 1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function topShapeAt(x, y) {
    for (let i = app.shapes.length - 1; i >= 0; i--) {
      const s = app.shapes[i];
      if (s.visible === false) continue;
      const pts = s.role === 'dynamic' && s.body ? s.body.vertices.map((v) => [v.x, v.y]) : s.points;
      if (s.closed === false) {
        for (let edge = 0; edge < pts.length - 1; edge++) {
          if (distToSegment(x, y, pts[edge], pts[edge + 1]) <= 12) return s;
        }
        continue;
      }
      if (pointInPolygon(x, y, pts)) return s;
    }
    return null;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (app.mode !== 'edit' || !SHAPE_TOOLS.has(app.tool)) return;
    const rawPoint = toCanvas(e);
    const p = transformPoint(rawPoint);
    startX = p.x;
    startY = p.y;
    committed = false;

    if (app.tool === 'line') {
      // Click to add a point. Close into a polygon by clicking near the first
      // point; otherwise double-click (handled below) finishes an open line.
      if (!polyDraft) polyDraft = { points: [] };
      const first = polyDraft.points[0];
      if (first && polyDraft.points.length >= 3 && dist(p.x, p.y, first[0], first[1]) <= config.handleRadius * 2.2) {
        finishLine(true);
      } else {
        polyDraft.points.push([p.x, p.y]);
      }
      return;
    }

    if (app.tool === 'select') {
      const sel = app.shapes.find((s) => s.id === app.selectedShapeId);
      if (sel && !sel.locked && sel.visible !== false) {
        // 1) grab a vertex handle of the selected shape
        for (let i = 0; i < sel.points.length; i++) {
          if (dist(p.x, p.y, sel.points[i][0], sel.points[i][1]) <= config.handleRadius * 1.8) {
            mode = 'vertex';
            dragVertexIndex = i;
            beforeChange();
            committed = true;
            canvas.setPointerCapture?.(e.pointerId);
            return;
          }
        }
        // 2) grab a curve grip (edge midpoint) → bend that edge
        let edge = curveGripAt(sel, p.x, p.y);
        // For an open line you can also grab anywhere along a segment.
        if (edge < 0) edge = lineEdgeNear(sel, p.x, p.y);
        if (edge >= 0) {
          mode = 'curve';
          dragEdgeIndex = edge;
          beforeChange();
          committed = true;
          setEdgeCurve(sel, edge, p.x, p.y);
          canvas.setPointerCapture?.(e.pointerId);
          return;
        }
      }
      // 3) select / start moving a shape
      const hit = topShapeAt(p.x, p.y);
      app.selectedShapeId = hit ? hit.id : null;
      onSelect();
      if (hit) {
        if (!hit.locked) {
          mode = 'move';
          const center = centroid(hit.points);
          moveLast = center;
          movePointerOffset = { x: rawPoint.x - center.x, y: rawPoint.y - center.y };
          canvas.setPointerCapture?.(e.pointerId);
        }
      }
      return;
    }

    // square / triangle / circle: start a drag-create
    mode = 'create';
    preview = { type: app.tool, points: rectPoints(p.x, p.y, p.x, p.y) };
    canvas.setPointerCapture?.(e.pointerId);
  });

  canvas.addEventListener('contextmenu', (e) => {
    if (app.mode !== 'edit') return;
    const rawPoint = toCanvas(e);
    const p = transformPoint(rawPoint);
    const hit = topShapeAt(p.x, p.y);
    if (!hit) return;
    e.preventDefault();
    app.selectedShapeId = hit.id;
    app.selectedPhysics = null;
    onSelect();
    onContextMenu({ shape: hit, event: e, point: p });
  });

  canvas.addEventListener('pointermove', (e) => {
    if (app.mode !== 'edit') return;
    const rawPoint = toCanvas(e);
    const p = transformPoint(rawPoint);

    // While drawing a line, remember the cursor so the renderer can show a
    // rubber-band preview segment to where the next point will land.
    if (app.tool === 'line' && polyDraft) {
      polyDraft.cursor = [p.x, p.y];
      const first = polyDraft.points[0];
      polyDraft.nearFirst =
        !!first && polyDraft.points.length >= 3 &&
        dist(p.x, p.y, first[0], first[1]) <= config.handleRadius * 2.2;
    }

    if (mode === 'create' && preview) {
      // Hold Shift to keep the drag box square (perfect circles and squares).
      let endX = p.x;
      let endY = p.y;
      if (e.shiftKey) {
        const side = Math.max(Math.abs(p.x - startX), Math.abs(p.y - startY));
        endX = startX + Math.sign(p.x - startX || 1) * side;
        endY = startY + Math.sign(p.y - startY || 1) * side;
      }
      if (app.tool === 'circle') {
        const geometry = circleGeometry(startX, startY, endX, endY);
        preview.points = geometry.points;
        preview.curves = geometry.curves;
      } else {
        preview.points =
          app.tool === 'triangle'
            ? trianglePoints(startX, startY, endX, endY)
            : rectPoints(startX, startY, endX, endY);
      }
    } else if (mode === 'vertex') {
      const sel = app.shapes.find((s) => s.id === app.selectedShapeId);
      if (sel && !sel.locked && dragVertexIndex >= 0) {
        sel.points[dragVertexIndex] = [p.x, p.y];
      }
    } else if (mode === 'curve') {
      const sel = app.shapes.find((s) => s.id === app.selectedShapeId);
      if (sel && !sel.locked && dragEdgeIndex >= 0) {
        setEdgeCurve(sel, dragEdgeIndex, p.x, p.y);
      }
    } else if (mode === 'move' && moveLast) {
      const sel = app.shapes.find((s) => s.id === app.selectedShapeId);
      if (sel && !sel.locked) {
        const desired = transformPoint({
          x: rawPoint.x - (movePointerOffset?.x || 0),
          y: rawPoint.y - (movePointerOffset?.y || 0),
        });
        const dx = desired.x - moveLast.x;
        const dy = desired.y - moveLast.y;
        if (!committed) {
          beforeChange();
          committed = true;
        }
        for (const pt of sel.points) {
          pt[0] += dx;
          pt[1] += dy;
        }
        moveLast = desired;
      }
    } else if (app.tool === 'select') {
      // Idle hover: highlight the curve grip under the cursor as a "bend me" hint.
      const sel = app.shapes.find((s) => s.id === app.selectedShapeId);
      if (sel && !sel.locked && sel.visible !== false) {
        let edge = curveGripAt(sel, p.x, p.y);
        if (edge < 0) edge = lineEdgeNear(sel, p.x, p.y);
        hoverCurve = edge >= 0 ? { shapeId: sel.id, edge } : null;
      } else {
        hoverCurve = null;
      }
    }
  });

  function endDrag(e) {
    if (app.mode !== 'edit') return;
    const p = e ? toCanvas(e) : { x: startX, y: startY };

    if (mode === 'create' && preview) {
      const bb = bbox(preview.points);
      if (bb.w >= config.minDrawSize && bb.h >= config.minDrawSize) {
        beforeChange();
        const shape = makeShape({
          type: app.tool,
          points: preview.points,
          curves: preview.curves,
          role: 'decor',
          fill: 'outline',
          color: config.shapeColor,
        });
        shape._born = performance.now();
        app.addShape(shape);
        app.selectedShapeId = shape.id;
        onSelect();
        onChange();
        onCreated(shape);
      }
      preview = null;
    } else if (mode === 'vertex' || mode === 'curve') {
      const sel = app.shapes.find((s) => s.id === app.selectedShapeId);
      if (sel && sel.role !== 'decor') buildShapeBody(sel);
      onChange();
    } else if (mode === 'move') {
      const sel = app.shapes.find((s) => s.id === app.selectedShapeId);
      if (sel && sel.role !== 'decor') buildShapeBody(sel);
      if (committed) onChange();
    }

    mode = null;
    dragVertexIndex = -1;
    dragEdgeIndex = -1;
    moveLast = null;
    movePointerOffset = null;
    if (e) canvas.releasePointerCapture?.(e.pointerId);
  }

  // Finish the line being drawn. `close` makes it a closed polygon (you clicked
  // back on the first point); otherwise it stays an open polyline.
  function finishLine(close = false) {
    if (polyDraft && polyDraft.points.length >= 2) {
      beforeChange();
      const shape = makeShape({
        type: 'line',
        points: polyDraft.points,
        role: 'decor',
        fill: 'outline',
        color: config.shapeColor,
        closed: close,
      });
      shape._born = performance.now();
      app.addShape(shape);
      app.selectedShapeId = shape.id;
      onSelect();
      onChange();
      onCreated(shape);
    }
    polyDraft = null;
  }

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // Double-click finishes the open line.
  canvas.addEventListener('dblclick', () => {
    if (app.mode === 'edit' && app.tool === 'line') finishLine(false);
  });

  // Esc cancels an in-progress poly.
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && polyDraft) {
      polyDraft = null;
    }
  });
}
