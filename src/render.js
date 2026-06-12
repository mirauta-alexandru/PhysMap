// render.js
// ---------------------------------------------------------------------------
// Pure rendering. This module NEVER changes physics state — it only reads body
// positions/angles and paints them on the canvas. Keeping it read-only is what
// keeps the sim decoupled from the visuals.
//
// In PERFORM mode we draw only the lit shapes on pure black (what the projector
// shows). In EDIT mode we additionally draw helper UI: a faint grid, body
// outlines, emitter markers, and the in-progress drawing preview.

import { config } from './config.js';
import { renderVisualMode } from './visualModes.js';

// Paint the pure-black background. Done every frame for a clean slate.
export function clear(ctx, width, height) {
  ctx.fillStyle = config.background;
  ctx.fillRect(0, 0, width, height);
}

// Faint editor grid (edit mode only) to help line things up.
export function drawGrid(ctx, width, height) {
  ctx.save();
  ctx.strokeStyle = config.gridColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= width; x += config.gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y <= height; y += config.gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
  ctx.restore();
}

// Draw a single dynamic circle with a soft glow. The glow is canvas shadowBlur
// using the circle's own color, which reads beautifully when projected.
export function drawCircle(ctx, body) {
  const color = body.render?.color || '#ffffff';
  ctx.save();
  ctx.beginPath();
  ctx.arc(body.position.x, body.position.y, body.circleRadius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = config.glow;
  ctx.fill();
  ctx.restore();
}

// Draw a static obstacle (rectangle/line/floor) by tracing its world vertices.
export function drawObstacle(ctx, body) {
  const verts = body.vertices;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) {
    ctx.lineTo(verts[i].x, verts[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = config.obstacleColor;
  ctx.shadowColor = config.obstacleColor;
  ctx.shadowBlur = config.glow * 0.5;
  ctx.fill();
  ctx.restore();
}

// Thin outline on top of a body — only used in edit mode so you can see exact
// edges (the glow softens them otherwise).
export function drawOutline(ctx, body) {
  const verts = body.vertices;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.strokeStyle = config.outlineColor;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// Draw an emitter marker (edit mode only): a small ring with a downward arrow,
// hinting that circles drop from here.
export function drawEmitter(ctx, e) {
  ctx.save();
  const angle = e.angle ?? Math.PI / 2;
  const power = e.power || 0;
  const arrowLen = power ? Math.max(26, power / config.emitterSpeedScale) : 20;
  const tx = e.x + Math.cos(angle) * arrowLen;
  const ty = e.y + Math.sin(angle) * arrowLen;

  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(e.x, e.y, 12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Direction arrow.
  ctx.beginPath();
  ctx.moveTo(e.x, e.y);
  ctx.lineTo(tx, ty);
  const head = Math.max(7, Math.min(12, arrowLen * 0.22));
  ctx.lineTo(
    tx - Math.cos(angle - 0.55) * head,
    ty - Math.sin(angle - 0.55) * head,
  );
  ctx.moveTo(tx, ty);
  ctx.lineTo(
    tx - Math.cos(angle + 0.55) * head,
    ty - Math.sin(angle + 0.55) * head,
  );
  ctx.stroke();
  ctx.restore();
}

export function drawEmitterAim(ctx, preview) {
  const dx = preview.x2 - preview.x1;
  const dy = preview.y2 - preview.y1;
  const len = Math.hypot(dx, dy);
  const angle = len >= 1 ? Math.atan2(dy, dx) : Math.PI / 2;
  drawEmitter(ctx, {
    x: preview.x1,
    y: preview.y1,
    angle,
    power: Math.min(len * config.emitterSpeedScale, config.emitterMaxSpeed),
  });
}

// Draw freehand strokes. Each stroke is a small polyline plus visible point
// stamps, so quick "pac-pac" taps read as marks instead of disappearing.
export function drawDrawings(ctx, drawings) {
  if (!Array.isArray(drawings)) return;

  for (const d of drawings) {
    if (!d.points?.length) continue;
    const color = d.color || config.drawColor;
    const size = d.size || config.drawSize;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);
    ctx.shadowColor = color;
    ctx.shadowBlur = config.glow * 0.55;

    if (d.points.length > 1) {
      ctx.beginPath();
      ctx.moveTo(d.points[0][0], d.points[0][1]);
      for (let i = 1; i < d.points.length; i++) {
        ctx.lineTo(d.points[i][0], d.points[i][1]);
      }
      ctx.stroke();
    }

    for (const p of d.points) {
      ctx.beginPath();
      ctx.arc(p[0], p[1], size * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

// Draw the in-progress drawing preview (a dashed wall line or rectangle) while
// the user is dragging in edit mode.
export function drawPreview(ctx, preview) {
  if (!preview) return;
  ctx.save();
  ctx.strokeStyle = config.obstacleColor;
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  if (preview.type === 'wall') {
    ctx.beginPath();
    ctx.moveTo(preview.x1, preview.y1);
    ctx.lineTo(preview.x2, preview.y2);
    ctx.stroke();
  } else if (preview.type === 'rect') {
    ctx.strokeRect(preview.x, preview.y, preview.w, preview.h);
  } else if (preview.type === 'draw') {
    drawDrawings(ctx, [preview]);
  } else if (preview.type === 'emitter') {
    drawEmitterAim(ctx, preview);
  }
  ctx.restore();
}

// Render every physics body for one frame. `editMode` controls whether
// outlines are drawn on obstacles.
export function renderWorld(ctx, bodies, editMode) {
  for (const body of bodies) {
    if (body.label === 'circle') {
      drawCircle(ctx, body);
    } else if (body.label === 'obstacle' && body.physmap?.type !== 'draw') {
      drawObstacle(ctx, body);
      if (editMode) drawOutline(ctx, body);
    }
  }
}

// Perform/project output: only dynamic light bodies are visible. Walls, blocks,
// Draw strokes, emitters, handles, and editor helpers remain collision/setup
// data and do not leak onto the projector.
export function renderProjection(ctx, bodies, options = {}) {
  const mode = options.visualMode || config.visualMode;
  if (mode === 'physics') {
    for (const body of bodies) {
      if (body.label === 'circle') drawCircle(ctx, body);
    }
    return;
  }
  renderVisualMode(ctx, bodies, options.width || 0, options.height || 0, options.now || 0, mode, options);
}
