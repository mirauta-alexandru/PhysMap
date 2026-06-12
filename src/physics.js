// physics.js
// ---------------------------------------------------------------------------
// All Matter.js setup lives here. The rest of the app talks to the physics
// world only through these helpers, so the simulation stays decoupled from
// rendering and input.
//
// Mental model:
//   - `engine`  owns the simulation (timing, solver).
//   - `world`   is the container of all bodies.
//   - Static bodies (label 'obstacle') = walls/lines and rectangles. Never move.
//   - Dynamic bodies (label 'circle')  = the falling circles.
//
// Every obstacle we create carries a `body.physmap` descriptor (e.g.
// { type: 'wall', x1, y1, x2, y2 }). That descriptor is what scene.js
// serializes — we never try to reverse-engineer geometry out of Matter.

import Matter from 'matter-js';
import { config } from './config.js';

const { Engine, World, Bodies, Body, Composite, Mouse, MouseConstraint } = Matter;

// Create the engine + world once. Exported so other modules can read body
// positions (render) or add/remove bodies (tools, emitters).
export const engine = Engine.create();
export const world = engine.world;

// Apply gravity from config. Matter's gravity.y is a scalar multiplier.
engine.gravity.y = config.gravity;

// ---------------------------------------------------------------------------
// Dynamic bodies
// ---------------------------------------------------------------------------

// A dynamic circle that falls under gravity. `color` is stashed on the body
// so render.js can draw it without a separate lookup.
export function createParticle(x, y, radius, color, velocity = null, kind = 'orb') {
  let particle;
  const options = {
    restitution: config.restitution,
    friction: 0.05,
    label: 'circle',
  };

  if (kind === 'cube') {
    const size = radius * 1.7;
    particle = Bodies.rectangle(x, y, size, size, options);
  } else if (kind === 'shard') {
    particle = Bodies.polygon(x, y, 3, radius * 1.25, options);
  } else {
    particle = Bodies.circle(x, y, radius, options);
    kind = 'orb';
  }

  particle.render = {
    color,
    kind,
    size: radius,
    trail: [],
    pulse: Math.random() * Math.PI * 2,
  };
  Composite.add(world, particle);
  if (velocity) Body.setVelocity(particle, velocity);
  enforceMaxCircles();
  return particle;
}

export function createCircle(x, y, radius, color, velocity = null) {
  return createParticle(x, y, radius, color, velocity, 'orb');
}

// ---------------------------------------------------------------------------
// Static obstacles
// ---------------------------------------------------------------------------

// A static line/wall segment from (x1,y1) to (x2,y2), realized as a thin
// rotated rectangle. The original endpoints are stored for serialization.
export function createWall(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  const body = Bodies.rectangle(cx, cy, len, config.wallThickness, {
    isStatic: true,
    label: 'obstacle',
    angle,
  });
  body.physmap = { type: 'wall', x1, y1, x2, y2 };
  Composite.add(world, body);
  return body;
}

// A hidden static collider that follows a freehand Draw stroke. The stroke is
// rendered separately in cyan, so these bodies are collision-only.
export function createDrawSegment(x1, y1, x2, y2, size = config.drawSize) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy, dx);
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;

  const body = Bodies.rectangle(cx, cy, len, Math.max(size, config.wallThickness * 0.75), {
    isStatic: true,
    label: 'obstacle',
    angle,
  });
  body.physmap = { type: 'draw', x1, y1, x2, y2, size };
  Composite.add(world, body);
  return body;
}

export function createDrawDot(x, y, size = config.drawSize) {
  const body = Bodies.circle(x, y, Math.max(size * 0.55, 3), {
    isStatic: true,
    label: 'obstacle',
  });
  body.physmap = { type: 'draw', x, y, size };
  Composite.add(world, body);
  return body;
}

// A static solid rectangle. (x, y) is the top-left corner; w/h the size.
export function createRectangle(x, y, w, h) {
  const body = Bodies.rectangle(x + w / 2, y + h / 2, w, h, {
    isStatic: true,
    label: 'obstacle',
  });
  body.physmap = { type: 'rect', x, y, w, h };
  Composite.add(world, body);
  return body;
}

// ---------------------------------------------------------------------------
// Removal / clearing
// ---------------------------------------------------------------------------

export function removeBody(body) {
  Composite.remove(world, body);
}

// Remove every dynamic circle (keeps obstacles + emitters). Bound to `C`.
export function clearDynamic() {
  for (const body of Composite.allBodies(world)) {
    if (body.label === 'circle') Composite.remove(world, body);
  }
}

// Remove every user-drawn obstacle. The auto floor (type 'floor') is left to
// main.js to manage, so we skip it here.
export function clearObstacles() {
  for (const body of Composite.allBodies(world)) {
    if (body.label === 'obstacle' && body.physmap?.type !== 'floor') {
      Composite.remove(world, body);
    }
  }
}

// Keep the circle count under config.maxCircles by trimming the oldest ones.
// allBodies() preserves insertion order, so the front of the list is oldest.
export function enforceMaxCircles() {
  const circles = Composite.allBodies(world).filter((b) => b.label === 'circle');
  const excess = circles.length - config.maxCircles;
  for (let i = 0; i < excess; i++) {
    Composite.remove(world, circles[i]);
  }
}

// ---------------------------------------------------------------------------
// Simulation tick
// ---------------------------------------------------------------------------

// Advance the simulation by a fixed timestep. We use a fixed dt (~16.6ms) for
// stable physics regardless of the actual frame timing.
export function step() {
  Engine.update(engine, 1000 / 60);
}

// Every body in the world (static + dynamic), for the renderer to iterate.
export function allBodies() {
  return Composite.allBodies(world);
}

// ---------------------------------------------------------------------------
// Mouse dragging (edit mode, "Move" tool)
// ---------------------------------------------------------------------------
// MouseConstraint lets you grab and drag bodies. We only add it to the world
// when the Move tool is active, so it never steals events from the drawing
// tools.

let mouse = null;
let mouseConstraint = null;
let dragEnabled = false;

// Create the MouseConstraint bound to the canvas. `dpr` (devicePixelRatio) is
// fed into Matter's mouse so drag coordinates line up with our DPR-scaled
// canvas — see the note in main.js about why this matters on retina screens.
export function setupMouse(canvas, dpr) {
  mouse = Mouse.create(canvas);
  mouse.pixelRatio = dpr;
  mouseConstraint = MouseConstraint.create(engine, {
    mouse,
    constraint: { stiffness: 0.2, render: { visible: false } },
  });
  return mouseConstraint;
}

// Toggle whether bodies can be dragged. Called when the active tool changes.
export function setDragEnabled(on) {
  if (!mouseConstraint || on === dragEnabled) return;
  if (on) {
    Composite.add(world, mouseConstraint);
  } else {
    Composite.remove(world, mouseConstraint);
  }
  dragEnabled = on;
}

// Keep Matter's mouse in sync if the device pixel ratio changes (e.g. window
// dragged between a retina and non-retina display, like a projector).
export function updatePixelRatio(dpr) {
  if (mouse) mouse.pixelRatio = dpr;
}
