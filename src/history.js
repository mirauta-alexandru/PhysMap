// history.js
// ---------------------------------------------------------------------------
// Small undo stack for user actions. Local save/load intentionally stores only
// reusable scene setup, but Undo should also restore transient dropped circles,
// so this module keeps an in-memory snapshot with dynamic body state too.

import Matter from 'matter-js';
import { serialize, applyScene } from './scene.js';
import { allBodies, clearDynamic, createParticle } from './physics.js';

const { Body } = Matter;

function cloneSnapshot(app) {
  const setup = serialize(app);
  const circles = allBodies()
    .filter((b) => b.label === 'circle')
    .map((b) => ({
      x: b.position.x,
      y: b.position.y,
      radius: b.circleRadius || b.render?.size || 12,
      color: b.render?.color || '#ffffff',
      kind: b.render?.kind || 'orb',
      velocity: { x: b.velocity.x, y: b.velocity.y },
      angle: b.angle,
      angularVelocity: b.angularVelocity,
    }));

  return {
    ...setup,
    circles,
    paused: app.paused,
  };
}

function restoreSnapshot(snapshot, app) {
  applyScene(snapshot, app);
  clearDynamic();

  for (const c of snapshot.circles || []) {
    const body = createParticle(c.x, c.y, c.radius, c.color, null, c.kind);
    Body.setVelocity(body, c.velocity || { x: 0, y: 0 });
    Body.setAngle(body, c.angle || 0);
    Body.setAngularVelocity(body, c.angularVelocity || 0);
  }

  app.paused = !!snapshot.paused;
}

export function createHistory(app, hooks = {}) {
  const limit = hooks.limit || 200;
  const onRestore = hooks.onRestore || (() => {});
  const stack = []; // past states (undo)
  const redoStack = []; // future states (redo)
  let restoring = false;

  function checkpoint() {
    if (restoring) return;
    stack.push(cloneSnapshot(app));
    if (stack.length > limit) stack.shift();
    // A fresh user action invalidates the redo timeline.
    redoStack.length = 0;
  }

  function undo() {
    const snapshot = stack.pop();
    if (!snapshot) return false;

    // Remember where we are so Redo can bring it back.
    redoStack.push(cloneSnapshot(app));
    if (redoStack.length > limit) redoStack.shift();

    restoring = true;
    restoreSnapshot(snapshot, app);
    restoring = false;
    onRestore();
    return true;
  }

  function redo() {
    const snapshot = redoStack.pop();
    if (!snapshot) return false;

    stack.push(cloneSnapshot(app));
    if (stack.length > limit) stack.shift();

    restoring = true;
    restoreSnapshot(snapshot, app);
    restoring = false;
    onRestore();
    return true;
  }

  return {
    checkpoint,
    undo,
    redo,
    canUndo: () => stack.length > 0,
    canRedo: () => redoStack.length > 0,
  };
}
