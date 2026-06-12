// main.js
// ---------------------------------------------------------------------------
// App entry point. Wires everything together:
//   - full-window black canvas (DPR-scaled for crisp shapes)
//   - an offscreen "source" canvas the scene is rendered to for warping
//   - shared `app` state (mode, current tool, emitters, mapping surfaces)
//   - the requestAnimationFrame render loop (Engine.update + draw + warp)
//   - three modes: Edit (draw physics) / Map (align surfaces) / Perform (project)
//   - a Project button that goes fullscreen on the projector (external display)
//   - keyboard shortcuts and toolbar wiring
//
// Rendering pipeline:
//   EDIT  -> draw the flat scene straight onto #stage (grid, outlines, handles).
//   MAP   -> render scene to the offscreen source, warp it onto each surface,
//            then draw the corner-handle overlay so you can align to objects.
//   PERFORM -> same warp as MAP but with NO overlay — this is what's projected.

import { config } from './config.js';
import {
  step,
  allBodies,
  clearDynamic,
  clearObstacles,
  createDrawDot,
  createDrawSegment,
  createRectangle,
  removeBody,
  setupMouse,
  setDragEnabled,
  updatePixelRatio,
} from './physics.js';
import {
  clear,
  drawDrawings,
  drawGrid,
  drawEmitter,
  drawPreview,
  renderProjection,
  renderWorld,
} from './render.js';
import { initTools, getPreview, spawnCircleAt } from './tools.js';
import {
  saveLocal,
  getLocalScene,
  loadLocal,
  exportFile,
  importFile,
  listSaves,
  saveNamed,
  loadNamed,
  deleteNamed,
} from './scene.js';
import { createHistory } from './history.js';
import {
  makeShape,
  buildShapeBody,
  removeShapeBody,
  drawShapes,
  initShapeInput,
} from './shapes.js';
import { createYouTubeOverlay, parseYouTubeId } from './youtube.js';

// --- Canvas setup -----------------------------------------------------------
const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

// Offscreen canvas the scene is rendered to before warping (the "texture").
const source = document.createElement('canvas');
const sctx = source.getContext('2d');

// Warped <iframe> overlay for YouTube-backed shapes (canvas can't draw YT).
const youtubeOverlay = createYouTubeOverlay();

// Hidden pool that keeps shape <video> elements decoding so their frames can be
// drawn onto the canvas every render. (display:none would stop playback.)
const mediaPool = document.createElement('div');
Object.assign(mediaPool.style, {
  position: 'absolute',
  width: '0',
  height: '0',
  overflow: 'hidden',
  opacity: '0',
  pointerEvents: 'none',
});
document.body.appendChild(mediaPool);

let width = 0;
let height = 0;
let dpr = 1;
let sourceDpr = 1;
let floor = null; // auto floor (managed here, not serialized)

// --- Shared app state -------------------------------------------------------
let nextEmitterId = 1;
let nextSurfaceId = 1;
let nextDrawingId = 1;
const app = {
  mode: 'edit', // 'edit' | 'map' | 'perform'
  paused: false,
  tool: 'wall', // current draw tool
  emitters: [], // { id, x, y, interval, acc }
  drawings: [], // { id, points:[[x,y],...], color, size }
  shapes: [], // drawable shape objects (see shapes.js)
  selectedShapeId: null,
  surfaces: [], // { id, corners: [[x,y]×4] }  (corners: TL, TR, BR, BL)
  activeSurfaceId: null,
  visualMode: config.visualMode,
  eyeStyle: config.eyeStyle,
  trackingTarget: null, // optional camera/car target: { x, y, vx, vy, lastSeen }

  // Emitter helpers (used by tools.js and scene.js).
  addEmitter(x, y, interval = config.spawnInterval, angle = Math.PI / 2, power = 0) {
    this.emitters.push({ id: nextEmitterId++, x, y, interval, angle, power, acc: 0 });
  },
  clearEmitters() {
    this.emitters.length = 0;
  },
  addDrawing(points, color = config.drawColor, size = config.drawSize) {
    const d = {
      id: nextDrawingId++,
      points: points.map((p) => [p[0], p[1]]),
      color,
      size,
    };
    addDrawingColliders(d);
    this.drawings.push(d);
    return d;
  },
  clearDrawings() {
    for (const d of this.drawings) {
      for (const body of d.bodies || []) removeBody(body);
    }
    this.drawings.length = 0;
  },
  setDrawings(list) {
    this.drawings = Array.isArray(list)
      ? list.map((d) => ({
          id: nextDrawingId++,
          points: (d.points || []).map((p) => [p[0], p[1]]),
          color: d.color || config.drawColor,
          size: d.size || config.drawSize,
        }))
      : [];
    for (const d of this.drawings) addDrawingColliders(d);
  },

  // Shape helpers (used by shapes.js input, toolbar, and scene.js).
  addShape(shape) {
    if (shape.role !== 'decor') buildShapeBody(shape);
    this.shapes.push(shape);
    return shape;
  },
  removeShape(id) {
    const idx = this.shapes.findIndex((s) => s.id === id);
    if (idx === -1) return;
    removeShapeBody(this.shapes[idx]);
    disposeShapeVideo(this.shapes[idx]);
    this.shapes.splice(idx, 1);
    if (this.selectedShapeId === id) this.selectedShapeId = null;
  },
  getSelectedShape() {
    return this.shapes.find((s) => s.id === this.selectedShapeId) || null;
  },
  clearShapes() {
    for (const s of this.shapes) {
      removeShapeBody(s);
      disposeShapeVideo(s);
    }
    this.shapes.length = 0;
    this.selectedShapeId = null;
  },
  setShapes(list) {
    this.clearShapes();
    if (!Array.isArray(list)) return;
    for (const s of list) {
      const shape = makeShape(s);
      if (shape.image) loadShapeImage(shape);
      if (shape.video) loadShapeVideo(shape);
      if (shape.role !== 'decor') buildShapeBody(shape);
      this.shapes.push(shape);
    }
  },

  // Surface helpers (used by mapping input, toolbar, and scene.js).
  fullScreenCorners() {
    return [[0, 0], [width, 0], [width, height], [0, height]];
  },
  addSurface(corners) {
    const s = { id: nextSurfaceId++, corners: corners || centeredQuad() };
    this.surfaces.push(s);
    this.activeSurfaceId = s.id;
    return s;
  },
  setSurfaces(list, savedViewport = null) {
    if (Array.isArray(list) && list.length) {
      const sx = savedViewport?.width ? width / savedViewport.width : 1;
      const sy = savedViewport?.height ? height / savedViewport.height : 1;
      this.surfaces = list.map((s) => ({
        id: nextSurfaceId++,
        corners: s.corners.map((c) => [c[0] * sx, c[1] * sy]),
      }));
    } else {
      // No surfaces saved → one identity surface so Perform looks "flat".
      this.surfaces = [{ id: nextSurfaceId++, corners: this.fullScreenCorners() }];
    }
    this.activeSurfaceId = this.surfaces[0].id;
  },
  getViewport() {
    return { width, height };
  },
};

// A default centered quad for a freshly added surface (so it's visible/grabbable).
function centeredQuad() {
  const w = width * 0.4;
  const h = height * 0.4;
  const x = (width - w) / 2;
  const y = (height - h) / 2;
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

function addDrawingColliders(drawing) {
  drawing.bodies = [];
  if (drawing.points.length === 1) {
    const p = drawing.points[0];
    drawing.bodies.push(createDrawDot(p[0], p[1], drawing.size));
    return;
  }
  for (let i = 1; i < drawing.points.length; i++) {
    const a = drawing.points[i - 1];
    const b = drawing.points[i];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) >= 1) {
      drawing.bodies.push(createDrawSegment(a[0], a[1], b[0], b[1], drawing.size));
    }
  }
}

// Decode a shape's stored image dataURL into an <img> for the 'image' fill.
function loadShapeImage(shape) {
  if (!shape.image) {
    shape._img = null;
    return;
  }
  const img = new Image();
  img.onload = () => {
    shape._img = img;
  };
  img.src = shape.image;
}

// Decode a shape's stored video into a looping, muted <video> for the 'video'
// fill. The element lives in a hidden pool so it keeps decoding frames that the
// renderer draws (and perspective-warps) onto the shape each frame.
function loadShapeVideo(shape) {
  if (shape._video) {
    shape._video.remove();
    shape._video = null;
  }
  if (!shape.video) return;
  const v = document.createElement('video');
  v.muted = true;
  v.loop = true;
  v.autoplay = true;
  v.playsInline = true;
  v.src = shape.video;
  mediaPool.appendChild(v);
  shape._video = v;
  v.play().catch(() => {});
}

// Stop and detach a shape's <video> element (on delete / scene clear).
function disposeShapeVideo(shape) {
  if (!shape || !shape._video) return;
  shape._video.pause();
  shape._video.removeAttribute('src');
  shape._video.load();
  shape._video.remove();
  shape._video = null;
}

function isFullScreenQuad(corners, w, h) {
  if (!corners?.length) return false;
  const eq = (p, x, y) => Math.abs(p[0] - x) < 0.5 && Math.abs(p[1] - y) < 0.5;
  return (
    eq(corners[0], 0, 0) &&
    eq(corners[1], w, 0) &&
    eq(corners[2], w, h) &&
    eq(corners[3], 0, h)
  );
}

function resizeSurfaces(oldWidth, oldHeight) {
  if (!oldWidth || !oldHeight || !app.surfaces.length) return;
  if (Math.abs(oldWidth - width) < 0.5 && Math.abs(oldHeight - height) < 0.5) return;

  const sx = width / oldWidth;
  const sy = height / oldHeight;
  for (const s of app.surfaces) {
    if (isFullScreenQuad(s.corners, oldWidth, oldHeight)) {
      s.corners = app.fullScreenCorners();
    } else {
      for (const c of s.corners) {
        c[0] *= sx;
        c[1] *= sy;
      }
    }
  }
}

// --- Canvas sizing ----------------------------------------------------------
// Fill the window and account for high-DPI screens so shapes render sharp. We
// scale the drawing context so all drawing code works in plain CSS pixels.
function resize() {
  const oldWidth = width;
  const oldHeight = height;
  dpr = window.devicePixelRatio || 1;
  sourceDpr = Math.min(dpr, config.sourceMaxDpr || dpr);
  width = window.innerWidth;
  height = window.innerHeight;

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Source canvas mirrors the stage resolution; its context also works in CSS px.
  source.width = Math.floor(width * sourceDpr);
  source.height = Math.floor(height * sourceDpr);
  sctx.setTransform(sourceDpr, 0, 0, sourceDpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = 'high';

  updatePixelRatio(dpr); // keep Matter's drag mouse aligned
  resizeSurfaces(oldWidth, oldHeight);

  // Rebuild the auto floor along the new bottom edge.
  if (config.defaultFloor) {
    if (floor) removeBody(floor);
    floor = createRectangle(-50, height - 8, width + 100, 16);
    floor.physmap = { type: 'floor' }; // mark so scene.js skips it
  }
}

function setTrackingTarget(x, y, vx = 0, vy = 0) {
  app.trackingTarget = { x, y, vx, vy, lastSeen: performance.now() };
}

window.setFacadeTarget = setTrackingTarget;
// Debug handle (harmless): lets tooling inspect live state.
window.__app = app;

// --- Emitters ---------------------------------------------------------------
function tickEmitters(dt) {
  for (const e of app.emitters) {
    e.acc += dt;
    if (e.acc >= e.interval) {
      e.acc = 0;
      const velocity = e.power
        ? { x: Math.cos(e.angle ?? Math.PI / 2) * e.power, y: Math.sin(e.angle ?? Math.PI / 2) * e.power }
        : null;
      spawnCircleAt(e.x, e.y, velocity);
    }
  }
}

function drawScene(targetCtx, editMode, now) {
  if (editMode) drawGrid(targetCtx, width, height);
  renderWorld(targetCtx, allBodies(), editMode);
  drawDrawings(targetCtx, app.drawings);
  drawShapes(targetCtx, app, editMode, now);
  if (editMode) {
    for (const e of app.emitters) drawEmitter(targetCtx, e);
    drawPreview(targetCtx, getPreview());
  }
}

function drawProjectionFrame(targetCtx, now) {
  // Shapes are the projected content; draw them first, then the visual-mode
  // layer (falling particles in 'physics', or the facade eyes in 'eyes').
  drawShapes(targetCtx, app, false, now);
  renderProjection(targetCtx, allBodies(), {
    visualMode: app.visualMode,
    eyeStyle: app.eyeStyle,
    trackingTarget: app.trackingTarget,
    width,
    height,
    now,
  });
}

// --- Render loop ------------------------------------------------------------
let last = performance.now();
function loop(now) {
  const dt = now - last;
  last = now;

  if (!app.paused) {
    tickEmitters(dt);
    step();
  }

  // Pure black stage every frame; the shapes carry their own mapping (their
  // corners are dragged onto the real object, and image fills warp into them).
  clear(ctx, width, height);
  if (app.mode === 'edit') {
    drawScene(ctx, true, now);
  } else {
    drawProjectionFrame(ctx, now);
  }

  // Keep the YouTube <iframe>s aligned/warped to their shapes every frame.
  youtubeOverlay.sync(app.shapes);

  requestAnimationFrame(loop);
}

// ===========================================================================
// Mode switching + projection
// ===========================================================================
function updateUI() {
  document.body.classList.toggle('perform', app.mode === 'perform');

  const proj = document.getElementById('btn-project');
  if (proj) proj.textContent = app.mode === 'perform' ? 'STOP (P)' : 'PROJECT (P)';

  const fsBtn = document.getElementById('btn-fullscreen');
  if (fsBtn) {
    fsBtn.textContent = document.fullscreenElement ? 'EXIT FULL (F)' : 'FULLSCREEN (F)';
    fsBtn.classList.toggle('active', !!document.fullscreenElement);
  }

  const undoBtn = document.getElementById('btn-undo');
  if (undoBtn && history) undoBtn.disabled = !history.canUndo();
  const redoBtn = document.getElementById('btn-redo');
  if (redoBtn && history) redoBtn.disabled = !history.canRedo();

  const pauseBtn = document.getElementById('btn-pause');
  if (pauseBtn) pauseBtn.textContent = app.paused ? 'Resume' : 'Pause';

  updatePropsPanel();
}

// Request fullscreen — on the projector / external display if the browser
// supports the Window Management API (Chrome/Edge); otherwise current screen.
async function goFullscreen() {
  try {
    if ('getScreenDetails' in window) {
      const details = await window.getScreenDetails();
      const target = details.screens.find((s) => !s.isPrimary) || details.currentScreen;
      await document.documentElement.requestFullscreen({ screen: target });
      return;
    }
  } catch (err) {
    console.warn('PhysMap: multi-screen fullscreen unavailable, using default —', err);
  }
  try {
    await document.documentElement.requestFullscreen();
  } catch (err) {
    console.warn('PhysMap: fullscreen request failed —', err);
  }
}

// Fullscreen is now INDEPENDENT of perform mode: you can enter fullscreen and
// keep editing (toolbar stays). Perform only hides the UI. So the workflow is
// F (fullscreen) → build your scene at projector resolution → P (project).
async function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  } else {
    await goFullscreen();
  }
}

async function enterPerform() {
  app.mode = 'perform';
  setDragEnabled(false);
  updateUI();
  // Convenience for one-touch projecting: jump to fullscreen if not already.
  if (!document.fullscreenElement) await goFullscreen();
}

function enterEdit() {
  app.mode = 'edit';
  applyToolDrag();
  updateUI();
}

function togglePerform() {
  if (app.mode === 'perform') enterEdit();
  else enterPerform();
}

// Leaving fullscreen via Esc: if we were projecting, reveal the UI again.
// Either way, refresh the fullscreen button label.
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement && app.mode === 'perform') enterEdit();
  updateUI();
});

// ===========================================================================
// Tools + toolbar wiring
// ===========================================================================
function setTool(tool) {
  app.tool = tool;
  applyToolDrag();
  document.querySelectorAll('[data-tool]').forEach((el) => {
    el.classList.toggle('active', el.dataset.tool === tool);
  });
}

// Matter's MouseConstraint (drag) is only active for the Move tool in edit mode.
function applyToolDrag() {
  setDragEnabled(app.mode === 'edit' && app.tool === 'move');
}

function resetScene() {
  clearDynamic();
  clearObstacles();
  app.clearEmitters();
  app.clearDrawings();
  app.clearShapes();
}

function resetHistory() {
  history = createHistory(app, { onRestore: updateUI });
}

let history = null;

function commitSceneChange() {
  saveLocal(app);
  updateUI();
}

function runUndoable(fn) {
  history?.checkpoint();
  fn();
  commitSceneChange();
}

function undoLastAction() {
  if (history?.undo()) {
    saveLocal(app);
    flash('Undo');
  } else {
    flash('Nothing to undo');
  }
  updateUI();
}

function redoLastAction() {
  if (history?.redo()) {
    saveLocal(app);
    flash('Redo');
  } else {
    flash('Nothing to redo');
  }
  updateUI();
}

function wireToolbar() {
  document.querySelectorAll('[data-tool]').forEach((el) => {
    el.addEventListener('click', () => setTool(el.dataset.tool));
  });

  document.getElementById('btn-project').addEventListener('click', togglePerform);
  document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
  document.getElementById('btn-undo').addEventListener('click', undoLastAction);
  document.getElementById('btn-redo').addEventListener('click', redoLastAction);
  document.getElementById('btn-clear').addEventListener('click', () => runUndoable(clearDynamic));
  document.getElementById('btn-reset').addEventListener('click', () => runUndoable(resetScene));
  document.getElementById('btn-pause').addEventListener('click', togglePause);

  document.getElementById('btn-home').addEventListener('click', openHome);
  document.getElementById('btn-saves').addEventListener('click', openSaves);
  document.getElementById('btn-export').addEventListener('click', () => exportFile(app));

  const fileInput = document.getElementById('import-file');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) return;
    try {
      history?.checkpoint();
      await importFile(fileInput.files[0], app);
      commitSceneChange();
      flash('Scene imported');
    } catch (err) {
      flash('Import failed');
      console.warn(err);
    }
    fileInput.value = '';
  });
}

// ===========================================================================
// Startup splash + project hub
// ===========================================================================
function sceneSummary(scene) {
  const shapes = Array.isArray(scene?.shapes) ? scene.shapes.length : 0;
  const emitters = Array.isArray(scene?.emitters) ? scene.emitters.length : 0;
  const parts = [`${shapes} shape${shapes === 1 ? '' : 's'}`];
  if (emitters) parts.push(`${emitters} emitter${emitters === 1 ? '' : 's'}`);
  return parts.join(' / ');
}

function formatSavedAt(value) {
  if (!value) return 'Saved previously';
  return `Saved ${new Date(value).toLocaleString()}`;
}

function closeHome() {
  document.body.classList.remove('menu-open');
  document.getElementById('home-screen')?.classList.add('closed');
}

function openHome() {
  if (app.mode === 'perform') enterEdit();
  closeSaves();
  renderHomeProjects();
  document.body.classList.add('menu-open');
  document.getElementById('home-screen')?.classList.remove('closed');
}

function startNewProject() {
  const current = getLocalScene();
  const hasWork = (current?.shapes?.length || 0) + (current?.drawings?.length || 0) > 0;
  if (
    hasWork &&
    !window.confirm(
      'Start a new project? The current autosave will be replaced. Named projects stay safe.',
    )
  ) {
    return;
  }

  resetScene();
  app.paused = false;
  app.mode = 'edit';
  resetHistory();
  setTool('select');
  commitSceneChange();
  closeHome();
  flash('New project ready');
}

function continueCurrentProject() {
  if (!getLocalScene()) return;
  closeHome();
  flash('Current project opened');
}

function openNamedFromHome(name) {
  if (!loadNamed(app, name)) return;
  app.mode = 'edit';
  resetHistory();
  setTool('select');
  commitSceneChange();
  closeHome();
  flash(`Opened “${name}”`);
}

function renderHomeProjects() {
  const all = listSaves();
  const names = Object.keys(all).sort((a, b) => (all[b].savedAt || 0) - (all[a].savedAt || 0));
  const container = document.getElementById('home-projects');
  const empty = document.getElementById('home-empty');
  const count = document.getElementById('home-project-count');
  const current = getLocalScene();
  const continueBtn = document.getElementById('home-continue');
  const currentMeta = document.getElementById('home-current-meta');
  if (!container || !empty || !count || !continueBtn || !currentMeta) return;

  container.replaceChildren();
  empty.style.display = names.length ? 'none' : 'block';
  count.textContent = `${names.length} saved`;
  continueBtn.disabled = !current;
  currentMeta.textContent = current
    ? `${sceneSummary(current)} · ${formatSavedAt(current.savedAt)}`
    : 'No autosave found';

  for (const name of names) {
    const scene = all[name];
    const card = document.createElement('article');
    card.className = 'project-card';

    const info = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'project-name';
    title.textContent = name;
    const meta = document.createElement('div');
    meta.className = 'project-meta';
    meta.textContent = `${sceneSummary(scene)} · ${formatSavedAt(scene.savedAt)}`;
    info.append(title, meta);

    const buttons = document.createElement('div');
    buttons.className = 'project-buttons';
    const openBtn = document.createElement('button');
    openBtn.textContent = 'Open';
    openBtn.addEventListener('click', () => openNamedFromHome(name));
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete';
    deleteBtn.textContent = 'Del';
    deleteBtn.addEventListener('click', () => {
      if (!window.confirm(`Delete saved project “${name}”?`)) return;
      deleteNamed(name);
      renderHomeProjects();
    });
    buttons.append(openBtn, deleteBtn);
    card.append(info, buttons);
    container.appendChild(card);
  }
}

function wireHome() {
  document.getElementById('home-new').addEventListener('click', startNewProject);
  document.getElementById('home-continue').addEventListener('click', continueCurrentProject);
  const credits = document.getElementById('credits-modal');
  document.getElementById('home-credits').addEventListener('click', () => {
    credits.classList.add('open');
  });
  document.getElementById('credits-close').addEventListener('click', () => {
    credits.classList.remove('open');
  });
  credits.addEventListener('click', (e) => {
    if (e.target === credits) credits.classList.remove('open');
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') credits.classList.remove('open');
  });
  document.body.classList.add('menu-open');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  setTimeout(() => {
    document.getElementById('home-screen')?.classList.add('ready');
  }, reduceMotion ? 80 : 1350);
}

// Make a floating panel draggable. You can grab it anywhere that ISN'T an
// interactive control (so buttons/inputs still work) — the grip bar at the top
// is just the obvious place to grab. Position is clamped to stay on screen.
function makeDraggable(el) {
  if (!el) return;
  let drag = null;

  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button, input, select, textarea, a')) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    el.classList.add('dragging');
    // Switch to explicit left/top positioning (panels may start at right/top).
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
    el.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });

  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const x = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, e.clientX - drag.dx));
    const y = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, e.clientY - drag.dy));
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  });

  const end = (e) => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
    el.releasePointerCapture?.(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
}

// Editor chrome follows the pointer very slightly. This is deliberately kept
// out of the canvas and disabled for reduced-motion users.
function initEditorMotion() {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  window.addEventListener('pointermove', (e) => {
    document.documentElement.style.setProperty('--cursor-x', `${e.clientX}px`);
    document.documentElement.style.setProperty('--cursor-y', `${e.clientY}px`);
  }, { passive: true });

  if (reduceMotion) return;
  document.querySelectorAll('#toolbar, #props').forEach((panel) => {
    panel.addEventListener('pointermove', (e) => {
      if (panel.classList.contains('dragging')) return;
      const r = panel.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      panel.style.setProperty('--tilt-x', `${(-ny * 1.8).toFixed(2)}deg`);
      panel.style.setProperty('--tilt-y', `${(nx * 2.2).toFixed(2)}deg`);
    });
    panel.addEventListener('pointerleave', () => {
      panel.style.setProperty('--tilt-x', '0deg');
      panel.style.setProperty('--tilt-y', '0deg');
    });
  });
}

function togglePause() {
  app.paused = !app.paused;
  document.getElementById('btn-pause').textContent = app.paused ? 'Resume' : 'Pause';
}

let flashTimer = null;
function flash(msg) {
  const el = document.getElementById('flash');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  el.style.transform = 'translateY(0)';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(4px)';
  }, 1400);
}

// ===========================================================================
// Shape properties panel
// ===========================================================================
function applyRole(role) {
  const s = app.getSelectedShape();
  if (!s) return;
  history.checkpoint();
  s.role = role;
  if (role === 'decor') removeShapeBody(s);
  else buildShapeBody(s);
  commitSceneChange();
  updatePropsPanel();
}

function applyFill(fill) {
  const s = app.getSelectedShape();
  if (!s) return;
  if (fill === 'image' && !s.image) {
    document.getElementById('props-image-file').click();
    return;
  }
  if (fill === 'video' && !s.video) {
    document.getElementById('props-video-file').click();
    return;
  }
  if (fill === 'youtube' && !s.youtube) {
    promptYouTube(s);
    return;
  }
  history.checkpoint();
  s.fill = fill;
  commitSceneChange();
  updatePropsPanel();
}

// Ask for a YouTube link / id and attach it to the shape as a 'youtube' fill.
function promptYouTube(shape) {
  const url = window.prompt('Lipește un link YouTube (sau ID-ul videoclipului):', shape.youtube || '');
  if (url == null) return;
  const id = parseYouTubeId(url);
  if (!id) {
    flash('Link YouTube invalid');
    return;
  }
  history.checkpoint();
  shape.youtube = id;
  shape.fill = 'youtube';
  commitSceneChange();
  updatePropsPanel();
}

function applyAnim(name) {
  const s = app.getSelectedShape();
  if (!s) return;
  history.checkpoint();
  s.anim = name;
  s.fill = 'anim';
  commitSceneChange();
  updatePropsPanel();
}

function applyColor(color) {
  const s = app.getSelectedShape();
  if (!s) return;
  s.color = color;
  saveLocal(app);
  updatePropsPanel();
}

function applyStrokeWidth(value) {
  const s = app.getSelectedShape();
  if (!s) return;
  s.strokeWidth = Math.max(1, Math.min(20, Number(value) || config.shapeOutlineWidth));
  saveLocal(app);
  updateStrokeWidthControl(s);
}

function applyOutlineFx(name) {
  const s = app.getSelectedShape();
  if (!s) return;
  history.checkpoint();
  s.fill = 'outline';
  s.outlineFx = name;
  commitSceneChange();
  updatePropsPanel();
}

function applyOutlineSpeed(value) {
  const s = app.getSelectedShape();
  if (!s) return;
  s.outlineSpeed = Math.max(0.25, Math.min(3, Number(value) || 1));
  saveLocal(app);
  updateOutlineControls(s);
}

function updateStrokeWidthControl(shape) {
  const slider = document.getElementById('props-stroke-width');
  const output = document.getElementById('props-stroke-value');
  if (!slider || !output || !shape) return;
  const value = shape.strokeWidth || config.shapeOutlineWidth;
  slider.value = String(value);
  output.value = `${value} PX`;
  output.textContent = `${value} PX`;
}

function updateOutlineControls(shape) {
  document.querySelectorAll('#props [data-outline-fx]').forEach((el) => {
    el.classList.toggle(
      'active',
      shape.fill === 'outline' && el.dataset.outlineFx === (shape.outlineFx || 'snake'),
    );
  });
  const slider = document.getElementById('props-outline-speed');
  const output = document.getElementById('props-outline-speed-value');
  if (!slider || !output) return;
  const value = shape.outlineSpeed || 1;
  slider.value = String(value);
  const label = Number.isInteger(value) ? `${value}X` : `${value.toFixed(2).replace(/0$/, '')}X`;
  output.value = label;
  output.textContent = label;
}

function deleteSelected() {
  const s = app.getSelectedShape();
  if (!s) return;
  history.checkpoint();
  app.removeShape(s.id);
  commitSceneChange();
  updatePropsPanel();
}

// Toggle whether the selected shape's path is closed (a filled/closed form) or
// open (a polyline). Lets you turn a line into a shape after drawing it.
function toggleClosed() {
  const s = app.getSelectedShape();
  if (!s) return;
  history.checkpoint();
  s.closed = s.closed === false; // open -> closed, closed -> open
  if (s.role !== 'decor') buildShapeBody(s);
  commitSceneChange();
  updatePropsPanel();
}

// Straighten every edge of the selected shape (drop all curve control points).
function straightenSelected() {
  const s = app.getSelectedShape();
  if (!s) return;
  history.checkpoint();
  s.curves = [];
  commitSceneChange();
  updatePropsPanel();
}

function updatePropsPanel() {
  const panel = document.getElementById('props');
  if (!panel) return;
  const s = app.getSelectedShape();
  panel.style.display = s && app.mode === 'edit' ? 'flex' : 'none';
  if (!s) return;
  document.querySelectorAll('#props [data-role]').forEach((el) => {
    el.classList.toggle('active', el.dataset.role === s.role);
  });
  document.querySelectorAll('#props [data-fill]').forEach((el) => {
    el.classList.toggle('active', el.dataset.fill === s.fill);
  });
  document.querySelectorAll('#props [data-anim]').forEach((el) => {
    el.classList.toggle('active', s.fill === 'anim' && el.dataset.anim === s.anim);
  });
  const ci = document.getElementById('props-color-input');
  if (ci && /^#[0-9a-f]{6}$/i.test(s.color)) ci.value = s.color;
  updateStrokeWidthControl(s);
  updateOutlineControls(s);

  // Path controls reflect the current open/closed state.
  const closeBtn = document.getElementById('props-close-toggle');
  if (closeBtn) {
    const isClosed = s.closed !== false;
    closeBtn.textContent = isClosed ? 'Open Path' : 'Close Path';
    closeBtn.classList.toggle('active', isClosed);
  }
  const straightenBtn = document.getElementById('props-straighten');
  if (straightenBtn) {
    straightenBtn.disabled = !(Array.isArray(s.curves) && s.curves.some(Boolean));
  }
}

function wireProps() {
  document.querySelectorAll('#props [data-role]').forEach((el) => {
    el.addEventListener('click', () => applyRole(el.dataset.role));
  });
  document.querySelectorAll('#props [data-fill]').forEach((el) => {
    el.addEventListener('click', () => applyFill(el.dataset.fill));
  });
  document.querySelectorAll('#props [data-anim]').forEach((el) => {
    el.addEventListener('click', () => applyAnim(el.dataset.anim));
  });
  document.querySelectorAll('#props [data-outline-fx]').forEach((el) => {
    el.addEventListener('click', () => applyOutlineFx(el.dataset.outlineFx));
  });
  document.querySelectorAll('#props [data-swatch]').forEach((el) => {
    el.addEventListener('click', () => applyColor(el.dataset.swatch));
  });
  document.getElementById('props-color-input').addEventListener('input', (e) => applyColor(e.target.value));

  const strokeSlider = document.getElementById('props-stroke-width');
  let strokeChangeStarted = false;
  const checkpointStroke = () => {
    if (strokeChangeStarted || !app.getSelectedShape()) return;
    history.checkpoint();
    strokeChangeStarted = true;
  };
  strokeSlider.addEventListener('pointerdown', checkpointStroke);
  strokeSlider.addEventListener('keydown', checkpointStroke);
  strokeSlider.addEventListener('input', (e) => applyStrokeWidth(e.target.value));
  strokeSlider.addEventListener('change', () => {
    strokeChangeStarted = false;
    commitSceneChange();
  });
  strokeSlider.addEventListener('blur', () => {
    strokeChangeStarted = false;
  });

  const outlineSpeed = document.getElementById('props-outline-speed');
  let outlineSpeedChangeStarted = false;
  const checkpointOutlineSpeed = () => {
    if (outlineSpeedChangeStarted || !app.getSelectedShape()) return;
    history.checkpoint();
    outlineSpeedChangeStarted = true;
  };
  outlineSpeed.addEventListener('pointerdown', checkpointOutlineSpeed);
  outlineSpeed.addEventListener('keydown', checkpointOutlineSpeed);
  outlineSpeed.addEventListener('input', (e) => applyOutlineSpeed(e.target.value));
  outlineSpeed.addEventListener('change', () => {
    outlineSpeedChangeStarted = false;
    commitSceneChange();
  });
  outlineSpeed.addEventListener('blur', () => {
    outlineSpeedChangeStarted = false;
  });

  document.getElementById('props-close-toggle').addEventListener('click', toggleClosed);
  document.getElementById('props-straighten').addEventListener('click', straightenSelected);
  document.getElementById('props-delete').addEventListener('click', deleteSelected);

  const f = document.getElementById('props-image-file');
  document.getElementById('props-image-btn').addEventListener('click', () => f.click());
  f.addEventListener('change', () => {
    const s = app.getSelectedShape();
    if (!s || !f.files.length) return;
    const reader = new FileReader();
    reader.onload = () => {
      history.checkpoint();
      s.image = reader.result;
      loadShapeImage(s);
      s.fill = 'image';
      commitSceneChange();
      updatePropsPanel();
    };
    reader.readAsDataURL(f.files[0]);
    f.value = '';
  });

  // Video file → decode into a looping <video> and map it onto the shape.
  const vf = document.getElementById('props-video-file');
  document.getElementById('props-video-btn').addEventListener('click', () => vf.click());
  vf.addEventListener('change', () => {
    const s = app.getSelectedShape();
    if (!s || !vf.files.length) return;
    const reader = new FileReader();
    reader.onload = () => {
      history.checkpoint();
      s.video = reader.result;
      loadShapeVideo(s);
      s.fill = 'video';
      commitSceneChange();
      updatePropsPanel();
    };
    reader.readAsDataURL(vf.files[0]);
    vf.value = '';
  });

  // YouTube link → warped <iframe> overlay mapped onto the shape.
  document.getElementById('props-youtube-btn').addEventListener('click', () => {
    const s = app.getSelectedShape();
    if (s) promptYouTube(s);
  });
}

// ===========================================================================
// Saved-scenes menu (multiple named scenes in the browser)
// ===========================================================================
function openSaves() {
  renderSavesList();
  document.getElementById('saves-modal').classList.add('open');
  document.getElementById('saves-name').focus();
}

function closeSaves() {
  document.getElementById('saves-modal')?.classList.remove('open');
}

function renderSavesList() {
  const all = listSaves();
  const names = Object.keys(all).sort((a, b) => (all[b].savedAt || 0) - (all[a].savedAt || 0));
  const list = document.getElementById('saves-list');
  const empty = document.getElementById('saves-empty');
  list.replaceChildren();
  empty.style.display = names.length ? 'none' : 'block';

  for (const name of names) {
    const when = all[name].savedAt ? new Date(all[name].savedAt).toLocaleString() : '';
    const li = document.createElement('li');

    const nameEl = document.createElement('span');
    nameEl.className = 'name';
    nameEl.textContent = name;
    nameEl.title = when ? `Saved ${when}` : name;

    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load';
    loadBtn.addEventListener('click', () => {
      history?.checkpoint();
      if (loadNamed(app, name)) {
        commitSceneChange();
        closeSaves();
        flash(`Loaded “${name}”`);
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'del';
    delBtn.textContent = 'Del';
    delBtn.title = 'Delete this scene';
    delBtn.addEventListener('click', () => {
      if (window.confirm(`Delete saved scene “${name}”?`)) {
        deleteNamed(name);
        renderSavesList();
        renderHomeProjects();
      }
    });

    li.append(nameEl, loadBtn, delBtn);
    list.appendChild(li);
  }
}

function wireSaves() {
  const modal = document.getElementById('saves-modal');
  document.getElementById('saves-close').addEventListener('click', closeSaves);
  // Click on the dimmed backdrop (outside the card) closes the menu.
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeSaves();
  });

  const nameInput = document.getElementById('saves-name');
  const doSave = () => {
    const name = nameInput.value.trim();
    if (!name) {
      flash('Type a name first');
      nameInput.focus();
      return;
    }
    if (saveNamed(app, name)) {
      nameInput.value = '';
      renderSavesList();
      renderHomeProjects();
      flash(`Saved “${name}”`);
    } else {
      flash('Save failed (storage full?)');
    }
  };
  document.getElementById('saves-add').addEventListener('click', doSave);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSave();
  });
}

// ===========================================================================
// Keyboard shortcuts
// ===========================================================================
window.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('menu-open')) return;
  if (e.target.tagName === 'INPUT') return;
  const key = e.key.toLowerCase();

  if ((e.metaKey || e.ctrlKey) && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoLastAction();
    else undoLastAction();
    return;
  }
  // Ctrl/Cmd+Y is a common Redo shortcut too.
  if ((e.metaKey || e.ctrlKey) && key === 'y') {
    e.preventDefault();
    redoLastAction();
    return;
  }
  // Esc closes the saves menu.
  if (e.key === 'Escape') closeSaves();

  if (e.metaKey || e.ctrlKey || e.altKey) return;

  switch (key) {
    case 'p': togglePerform(); break;
    case 'e': enterEdit(); break;
    case 'f': toggleFullscreen(); break;
    case 'c': runUndoable(clearDynamic); break;
    case 'r': runUndoable(resetScene); break;
    case ' ': e.preventDefault(); togglePause(); break;
    // Quick tool selection (edit mode).
    case 'm': setTool('move'); break;
    case 'w': setTool('wall'); break;
    case 'b': setTool('rect'); break;
    case 'd': setTool('draw'); break;
    case 'x': setTool('emitter'); break;
    case 's': setTool('spawn'); break;
    // Shape tools.
    case 'v': setTool('select'); break;
    case 'q': setTool('square'); break;
    case 't': setTool('triangle'); break;
    case 'y': setTool('line'); break;
    case 'delete':
    case 'backspace':
      if (app.getSelectedShape()) { e.preventDefault(); deleteSelected(); }
      break;
  }
});

// ===========================================================================
// Init
// ===========================================================================
window.addEventListener('resize', resize);
resize();

setupMouse(canvas, dpr);
resetHistory();
initTools(canvas, app, {
  beforeChange: () => history.checkpoint(),
  onChange: commitSceneChange,
});
initShapeInput(canvas, app, {
  beforeChange: () => history.checkpoint(),
  onChange: commitSceneChange,
  onSelect: updatePropsPanel,
  onCreated: () => setTool('select'),
});
wireToolbar();
wireProps();
wireSaves();
wireHome();
makeDraggable(document.getElementById('toolbar'));
makeDraggable(document.getElementById('props'));
initEditorMotion();
setTool('select');

loadLocal(app);
renderHomeProjects();
updateUI();

requestAnimationFrame(loop);
