// tools.js
// ---------------------------------------------------------------------------
// Drawing tools + pointer input for EDIT mode. Translates mouse/pen/touch
// gestures into physics bodies (walls, rectangles) or emitters, and exposes
// the in-progress "preview" shape so render.js can draw it while dragging.
//
// Tools:
//   move    -> drag existing bodies (handled by Matter's MouseConstraint;
//              this module just stays out of the way)
//   wall    -> click-drag a line segment (static thin rectangle)
//   rect    -> click-drag a solid static rectangle
//   draw    -> draw freehand strokes made from visible points
//   emitter -> click to place a spawn point that drops circles
//   spawn   -> click to drop a single circle right now
//
// The module is intentionally framework-free: it works against a shared `app`
// state object and a couple of callbacks passed in at init time.

import { config } from './config.js';
import { createWall, createRectangle, createCircle } from './physics.js';

// In-progress drawing shape, or null. Read by render.js via getPreview().
let preview = null;

export function getPreview() {
  return preview;
}

// Wire up pointer handling on the canvas.
//   app   : shared state ({ mode, tool, emitters, addEmitter, ... })
//   hooks : { onChange }  -> called after the scene is modified (for autosave)
export function initTools(canvas, app, hooks = {}) {
  const beforeChange = hooks.beforeChange || (() => {});
  const onChange = hooks.onChange || (() => {});

  // Drag bookkeeping.
  let down = false;
  let startX = 0;
  let startY = 0;
  let editingEmitterId = null;

  // Convert a pointer event to canvas-space (CSS pixel) coordinates. Because
  // we draw in CSS pixels (the context is DPR-scaled in main.js), the offset
  // from getBoundingClientRect is exactly what we want — no DPR math here.
  function toCanvas(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  canvas.addEventListener('pointerdown', (e) => {
    // No drawing in perform mode, and the Move tool is owned by Matter.
    if (app.mode !== 'edit' || app.tool === 'move') return;

    const p = toCanvas(e);
    down = true;
    editingEmitterId = null;
    startX = p.x;
    startY = p.y;
    canvas.setPointerCapture?.(e.pointerId);

    if (app.tool === 'spawn') {
      // Drop a single circle immediately where you clicked.
      beforeChange();
      spawnCircleAt(p.x, p.y);
      onChange();
      down = false;
      canvas.releasePointerCapture?.(e.pointerId);
    } else if (app.tool === 'draw') {
      preview = {
        type: 'draw',
        points: [[p.x, p.y]],
        color: config.drawColor,
        size: config.drawSize,
      };
    } else if (app.tool === 'emitter') {
      const existing = app.emitters.find((em) => {
        return Math.hypot(em.x - p.x, em.y - p.y) <= config.emitterEditRadius;
      });
      if (existing) {
        editingEmitterId = existing.id;
        startX = existing.x;
        startY = existing.y;
      }
      preview = { type: 'emitter', x1: startX, y1: startY, x2: p.x, y2: p.y };
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!down || app.mode !== 'edit') return;
    const p = toCanvas(e);

    if (app.tool === 'wall') {
      preview = { type: 'wall', x1: startX, y1: startY, x2: p.x, y2: p.y };
    } else if (app.tool === 'rect') {
      // Normalize so dragging in any direction yields a positive-size rect.
      const x = Math.min(startX, p.x);
      const y = Math.min(startY, p.y);
      preview = { type: 'rect', x, y, w: Math.abs(p.x - startX), h: Math.abs(p.y - startY) };
    } else if (app.tool === 'draw' && preview?.type === 'draw') {
      const last = preview.points[preview.points.length - 1];
      const d = Math.hypot(p.x - last[0], p.y - last[1]);
      if (d >= config.drawPointSpacing) {
        preview.points.push([p.x, p.y]);
      }
    } else if (app.tool === 'emitter') {
      preview = { type: 'emitter', x1: startX, y1: startY, x2: p.x, y2: p.y };
    }
  });

  function finish(e) {
    if (!down) return;
    down = false;
    const p = toCanvas(e);

    if (app.tool === 'wall') {
      const len = Math.hypot(p.x - startX, p.y - startY);
      if (len >= config.minDrawSize) {
        beforeChange();
        createWall(startX, startY, p.x, p.y);
        onChange();
      }
    } else if (app.tool === 'rect') {
      const w = Math.abs(p.x - startX);
      const h = Math.abs(p.y - startY);
      if (w >= config.minDrawSize && h >= config.minDrawSize) {
        beforeChange();
        createRectangle(Math.min(startX, p.x), Math.min(startY, p.y), w, h);
        onChange();
      }
    } else if (app.tool === 'draw' && preview?.type === 'draw') {
      const last = preview.points[preview.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) >= config.drawPointSpacing) {
        preview.points.push([p.x, p.y]);
      }
      beforeChange();
      app.addDrawing(preview.points, preview.color, preview.size);
      onChange();
    } else if (app.tool === 'emitter') {
      const dx = p.x - startX;
      const dy = p.y - startY;
      const len = Math.hypot(dx, dy);
      const angle = len >= config.minDrawSize ? Math.atan2(dy, dx) : Math.PI / 2;
      const power = len >= config.minDrawSize
        ? Math.min(len * config.emitterSpeedScale, config.emitterMaxSpeed)
        : 0;
      beforeChange();
      if (editingEmitterId != null) {
        const emitter = app.emitters.find((em) => em.id === editingEmitterId);
        if (emitter) {
          emitter.angle = angle;
          emitter.power = power;
        }
      } else {
        app.addEmitter(startX, startY, config.spawnInterval, angle, power);
      }
      onChange();
    }

    preview = null;
    editingEmitterId = null;
    canvas.releasePointerCapture?.(e.pointerId);
  }

  canvas.addEventListener('pointerup', finish);
  // If the pointer leaves the window mid-drag, treat it as a release so we
  // don't get stuck in a dragging state.
  canvas.addEventListener('pointercancel', finish);
}

// Spawn a single random-colored, random-radius circle at (x, y).
export function spawnCircleAt(x, y, velocity = null) {
  const r =
    config.circleRadiusMin +
    Math.random() * (config.circleRadiusMax - config.circleRadiusMin);
  const color = config.palette[Math.floor(Math.random() * config.palette.length)];
  return createCircle(x, y, r, color, velocity);
}
