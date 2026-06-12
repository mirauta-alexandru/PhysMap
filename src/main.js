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
import { initTools, getPreview, spawnParticleAt } from './tools.js';
import { drawPhysicsEffects, updatePhysicsEffects } from './physicsEffects.js';
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

// Desktop builds render a second, UI-free canvas and stream it into a dedicated
// fullscreen BrowserWindow on the selected projector display.
const desktopOutput = window.physmapDesktop || null;
const outputCanvas = document.createElement('canvas');
const outputCtx = outputCanvas.getContext('2d');
let outputWindow = null;
let outputStream = null;
let outputDisplay = null;
let availableDisplays = [];
let selectedDisplayId = localStorage.getItem('physmap-output-display') || '';
let currentProjectName = localStorage.getItem('physmap-current-project-name') || 'Current Project';

function isNamedProject(name = currentProjectName) {
  return Boolean(name && !['Current Project', 'Untitled Project'].includes(name));
}

function updateAutosaveStatus(label = 'Autosaved') {
  const status = document.getElementById('workspace-save-status');
  if (!status) return;
  status.textContent = label;
  status.dataset.state = label.toLowerCase().replace(/\s+/g, '-');
}

function saveCurrentProject({ announce = false } = {}) {
  saveLocal(app);
  if (!isNamedProject()) {
    openSaves();
    return false;
  }

  const saved = saveNamed(app, currentProjectName);
  if (saved) {
    updateAutosaveStatus('Autosaved');
    if (announce) flash(`Saved “${currentProjectName}”`);
  } else {
    updateAutosaveStatus('Save failed');
    if (announce) flash('Save failed (storage full?)');
  }
  return saved;
}

function setWorkspaceProjectName(name) {
  currentProjectName = name || 'Current Project';
  localStorage.setItem('physmap-current-project-name', currentProjectName);
  const label = document.getElementById('workspace-project-name');
  if (label) label.textContent = currentProjectName;
}

function wireProjectName() {
  const label = document.getElementById('workspace-project-name');
  if (!label) return;

  const finishEditing = (save = true) => {
    if (label.contentEditable !== 'true') return;
    const previous = label.dataset.previousName || currentProjectName;
    const next = label.textContent.trim().replace(/\s+/g, ' ').slice(0, 60);
    label.contentEditable = 'false';

    if (!save) {
      label.textContent = previous;
      return;
    }

    const finalName = next || previous || 'Untitled Project';
    if (finalName !== previous && listSaves()[finalName]) {
      label.textContent = previous;
      flash('A project with that name already exists');
      return;
    }

    setWorkspaceProjectName(finalName);
    if (finalName !== previous && isNamedProject(previous)) deleteNamed(previous);
    saveCurrentProject();
    renderHomeProjects();
    flash(`Project renamed to “${currentProjectName}”`);
  };

  label.addEventListener('click', () => {
    if (label.contentEditable === 'true') return;
    label.dataset.previousName = currentProjectName;
    label.contentEditable = 'true';
    label.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(label);
    selection.removeAllRanges();
    selection.addRange(range);
  });

  label.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishEditing();
      label.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishEditing(false);
      label.blur();
    }
  });
  label.addEventListener('blur', () => finishEditing());
}

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
let nextEffectId = 1;
const app = {
  mode: 'edit', // 'edit' | 'map' | 'perform'
  paused: false,
  tool: 'wall', // current draw tool
  emitters: [], // { id, x, y, interval, acc }
  effects: [],
  particleKind: 'orb',
  selectedPhysics: null,
  drawings: [], // { id, points:[[x,y],...], color, size }
  shapes: [], // drawable shape objects (see shapes.js)
  selectedShapeId: null,
  surfaces: [], // { id, corners: [[x,y]×4] }  (corners: TL, TR, BR, BL)
  activeSurfaceId: null,
  visualMode: config.visualMode,
  eyeStyle: config.eyeStyle,
  trackingTarget: null, // optional camera/car target: { x, y, vx, vy, lastSeen }

  // Emitter helpers (used by tools.js and scene.js).
  addEmitter(x, y, interval = config.spawnInterval, angle = Math.PI / 2, power = 0, kind = 'orb') {
    const emitter = { id: nextEmitterId++, x, y, interval, angle, power, kind, acc: 0 };
    this.emitters.push(emitter);
    return emitter;
  },
  clearEmitters() {
    this.emitters.length = 0;
    if (this.selectedPhysics?.type === 'emitter') this.selectedPhysics = null;
  },
  addEffect(effect) {
    const next = { id: nextEffectId++, ...effect };
    this.effects.push(next);
    return next;
  },
  clearEffects() {
    this.effects.length = 0;
    if (this.selectedPhysics?.type === 'effect') this.selectedPhysics = null;
  },
  setEffects(list, savedViewport = null) {
    const sx = savedViewport?.width ? width / savedViewport.width : 1;
    const sy = savedViewport?.height ? height / savedViewport.height : 1;
    const sr = Math.min(sx, sy);
    this.effects = Array.isArray(list)
      ? list.map((effect) => {
          const next = { id: nextEffectId++, ...effect };
          if ('x' in next) {
            next.x *= sx;
            next.y *= sy;
          }
          if ('ax' in next) {
            next.ax *= sx;
            next.ay *= sy;
            next.bx *= sx;
            next.by *= sy;
          }
          if (next.radius) next.radius *= sr;
          return next;
        })
      : [];
    this.selectedPhysics = null;
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

function resizePhysicsEffects(oldWidth, oldHeight) {
  if (!oldWidth || !oldHeight || !app.effects.length) return;
  const sx = width / oldWidth;
  const sy = height / oldHeight;
  const sr = Math.min(sx, sy);
  for (const effect of app.effects) {
    if ('x' in effect) {
      effect.x *= sx;
      effect.y *= sy;
    }
    if ('ax' in effect) {
      effect.ax *= sx;
      effect.ay *= sy;
      effect.bx *= sx;
      effect.by *= sy;
    }
    if (effect.radius) effect.radius *= sr;
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

  const toolbarRect = document.getElementById('toolbar')?.getBoundingClientRect();
  const propsRect = document.getElementById('props')?.getBoundingClientRect();
  const workspace = {
    left: Math.ceil(toolbarRect?.right || 142) + 14,
    top: 82,
    right: Math.ceil(window.innerWidth - (propsRect?.left || window.innerWidth - 310)) + 14,
    bottom: 14,
  };
  const availableWidth = Math.max(320, window.innerWidth - workspace.left - workspace.right);
  const availableHeight = Math.max(240, window.innerHeight - workspace.top - workspace.bottom);
  const selectedDisplay = availableDisplays.find((display) => display.id === selectedDisplayId);
  const targetWidth = selectedDisplay?.bounds.width || 16;
  const targetHeight = selectedDisplay?.bounds.height || 9;
  const targetRatio = targetWidth / targetHeight;
  const availableRatio = availableWidth / availableHeight;

  if (availableRatio > targetRatio) {
    height = Math.floor(availableHeight);
    width = Math.floor(height * targetRatio);
  } else {
    width = Math.floor(availableWidth);
    height = Math.floor(width / targetRatio);
  }

  const stageLeft = Math.floor(workspace.left + (availableWidth - width) / 2);
  const stageTop = Math.floor(workspace.top + (availableHeight - height) / 2);

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  canvas.style.left = stageLeft + 'px';
  canvas.style.top = stageTop + 'px';
  youtubeOverlay.setViewport(stageLeft, stageTop, width, height);
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
  resizePhysicsEffects(oldWidth, oldHeight);

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
      spawnParticleAt(e.x, e.y, velocity, e.kind || 'orb');
    }
  }
}

function drawScene(targetCtx, editMode, now) {
  if (editMode) drawGrid(targetCtx, width, height);
  renderWorld(targetCtx, allBodies(), editMode);
  drawDrawings(targetCtx, app.drawings);
  drawShapes(targetCtx, app, editMode, now);
  drawPhysicsEffects(
    targetCtx,
    app.effects,
    now,
    editMode,
    app.selectedPhysics?.type === 'effect' ? app.selectedPhysics.id : null,
  );
  if (editMode) {
    for (const e of app.emitters) {
      drawEmitter(
        targetCtx,
        e,
        app.selectedPhysics?.type === 'emitter' && app.selectedPhysics.id === e.id,
      );
    }
    drawPreview(targetCtx, getPreview(), now);
  }
}

function drawProjectionFrame(targetCtx, now) {
  // Shapes are the projected content; draw them first, then the visual-mode
  // layer (falling particles in 'physics', or the facade eyes in 'eyes').
  drawShapes(targetCtx, app, false, now);
  drawPhysicsEffects(targetCtx, app.effects, now, false);
  renderProjection(targetCtx, allBodies(), {
    visualMode: app.visualMode,
    eyeStyle: app.eyeStyle,
    trackingTarget: app.trackingTarget,
    width,
    height,
    now,
  });
}

function isOutputActive() {
  return Boolean(outputWindow && !outputWindow.closed);
}

function renderOutputFrame(now) {
  if (!isOutputActive() || !outputDisplay || !width || !height) return;

  const scaleX = outputCanvas.width / width;
  const scaleY = outputCanvas.height / height;
  outputCtx.setTransform(1, 0, 0, 1, 0, 0);
  clear(outputCtx, outputCanvas.width, outputCanvas.height);
  outputCtx.setTransform(scaleX, 0, 0, scaleY, 0, 0);
  outputCtx.imageSmoothingEnabled = true;
  outputCtx.imageSmoothingQuality = 'high';
  drawProjectionFrame(outputCtx, now);
}

// --- Render loop ------------------------------------------------------------
let last = performance.now();
function loop(now) {
  const dt = now - last;
  last = now;

  if (!app.paused) {
    tickEmitters(dt);
    updatePhysicsEffects(app.effects, allBodies(), now);
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
  renderOutputFrame(now);

  // Keep the YouTube <iframe>s aligned/warped to their shapes every frame.
  youtubeOverlay.sync(app.shapes);

  requestAnimationFrame(loop);
}

// ===========================================================================
// Mode switching + projection
// ===========================================================================
function updateUI() {
  document.body.classList.toggle('perform', app.mode === 'perform');
  document.body.classList.toggle('output-live', isOutputActive());

  const proj = document.getElementById('btn-project');
  if (proj) {
    const active = desktopOutput ? isOutputActive() : app.mode === 'perform';
    proj.textContent = desktopOutput
      ? (active ? 'STOP OUTPUT (P)' : 'OUTPUT (P)')
      : (active ? 'STOP (P)' : 'PROJECT (P)');
    proj.classList.toggle('active', active);
  }

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
  updateOutputStatus();
}

function displayResolution(display) {
  const scale = display.scaleFactor || 1;
  return `${Math.round(display.bounds.width * scale)}x${Math.round(display.bounds.height * scale)}`;
}

function displayLabel(display) {
  const tags = [];
  if (display.isPrimary) tags.push('Primary');
  if (display.isEditor) tags.push('Editor');
  const suffix = tags.length ? ` / ${tags.join(' + ')}` : ' / External';
  return `${display.label} / ${displayResolution(display)}${suffix}`;
}

function chooseDefaultDisplay(displays) {
  return (
    displays.find((display) => display.id === selectedDisplayId) ||
    displays.find((display) => !display.isEditor) ||
    displays.find((display) => !display.isPrimary) ||
    displays[0] ||
    null
  );
}

function updateOutputStatus() {
  const status = document.getElementById('output-status');
  const select = document.getElementById('output-display');
  const target = document.getElementById('output-target');
  if (!status || !select || !target) return;

  if (!desktopOutput) {
    status.className = 'warning';
    status.textContent = 'Desktop output unavailable';
    target.textContent = 'Open the installed PhysMap app';
    select.disabled = true;
    return;
  }

  if (isOutputActive() && outputDisplay) {
    status.className = 'live';
    status.textContent = 'Output live';
    target.textContent = `${outputDisplay.label} / ${displayResolution(outputDisplay)}`;
    select.disabled = true;
    return;
  }

  select.disabled = false;
  const selected = availableDisplays.find((display) => display.id === selectedDisplayId);
  target.textContent = selected
    ? `${selected.label} / ${displayResolution(selected)}`
    : 'No projector selected';
  if (availableDisplays.length < 2) {
    status.className = 'warning';
    status.textContent = 'Waiting for projector';
  } else {
    status.className = '';
    status.textContent = 'Ready to project';
  }
}

function renderDisplayOptions(displays) {
  availableDisplays = Array.isArray(displays) ? displays : [];
  const select = document.getElementById('output-display');
  if (!select) return;

  const choice = chooseDefaultDisplay(availableDisplays);
  if (choice) selectedDisplayId = choice.id;

  select.replaceChildren();
  for (const display of availableDisplays) {
    const option = document.createElement('option');
    option.value = display.id;
    option.textContent = displayLabel(display);
    option.selected = display.id === selectedDisplayId;
    select.appendChild(option);
  }

  if (!availableDisplays.length) {
    const option = document.createElement('option');
    option.textContent = 'No displays detected';
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
  }

  if (outputDisplay && !availableDisplays.some((display) => display.id === outputDisplay.id)) {
    stopDedicatedOutput(false);
    flash('Projector disconnected');
  }
  resize();
  updateOutputStatus();
}

async function refreshDisplays() {
  if (!desktopOutput) {
    renderDisplayOptions([]);
    return;
  }
  try {
    renderDisplayOptions(await desktopOutput.listDisplays());
  } catch (err) {
    console.warn('PhysMap: could not read connected displays —', err);
    renderDisplayOptions([]);
  }
}

function configureOutputCanvas(display) {
  const scale = display.scaleFactor || 1;
  outputCanvas.width = Math.max(1, Math.round(display.bounds.width * scale));
  outputCanvas.height = Math.max(1, Math.round(display.bounds.height * scale));
}

function populateOutputWindow(windowRef, stream, display) {
  const doc = windowRef.document;
  doc.open();
  doc.write(`<!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>PhysMap Output</title>
        <style>
          html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #000; }
          body { cursor: none; }
          video { display: block; width: 100%; height: 100%; object-fit: fill; background: #000; }
        </style>
      </head>
      <body><video id="physmap-output" autoplay muted playsinline></video></body>
    </html>`);
  doc.close();

  const video = doc.getElementById('physmap-output');
  video.srcObject = stream;
  video.play().catch((err) => console.warn('PhysMap: output playback failed —', err));
  windowRef.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') windowRef.close();
  });
  windowRef.addEventListener('pagehide', () => {
    if (outputWindow === windowRef) {
      outputWindow = null;
      outputDisplay = null;
      outputStream = null;
      updateUI();
    }
  });
  windowRef.document.title = `PhysMap Output / ${display.label}`;
}

async function startDedicatedOutput() {
  if (!desktopOutput) {
    await enterPerform();
    return;
  }

  await refreshDisplays();
  const display =
    availableDisplays.find((candidate) => candidate.id === selectedDisplayId) ||
    chooseDefaultDisplay(availableDisplays);
  if (!display) {
    flash('No output display found');
    return;
  }

  stopDedicatedOutput(false);
  outputDisplay = display;
  selectedDisplayId = display.id;
  localStorage.setItem('physmap-output-display', selectedDisplayId);
  configureOutputCanvas(display);
  outputStream = outputCanvas.captureStream(60);

  const frameName = `physmap-output-${display.id}`;
  const popup = window.open('about:blank', frameName, 'popup=yes');
  if (!popup) {
    outputDisplay = null;
    outputStream = null;
    flash('Output window was blocked');
    updateUI();
    return;
  }

  outputWindow = popup;
  try {
    populateOutputWindow(popup, outputStream, display);
    document.getElementById('output-panel')?.classList.remove('open');
    flash(`Output live / ${display.label}`);
  } catch (err) {
    console.warn('PhysMap: could not initialize output window —', err);
    stopDedicatedOutput();
    flash('Output window failed');
  }
  updateUI();
}

function stopDedicatedOutput(notifyDesktop = true) {
  const windowRef = outputWindow;
  outputWindow = null;
  outputDisplay = null;
  if (outputStream) {
    for (const track of outputStream.getTracks()) track.stop();
    outputStream = null;
  }
  if (windowRef && !windowRef.closed) windowRef.close();
  if (notifyDesktop) desktopOutput?.closeOutput().catch(() => {});
  updateUI();
}

async function toggleDedicatedOutput() {
  if (isOutputActive()) stopDedicatedOutput();
  else await startDedicatedOutput();
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
  if (desktopOutput) {
    toggleDedicatedOutput();
  } else if (app.mode === 'perform') {
    enterEdit();
  } else {
    enterPerform();
  }
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
  if (tool.startsWith('spawn-')) app.particleKind = tool.replace('spawn-', '');
  applyToolDrag();
  document.querySelectorAll('[data-tool]').forEach((el) => {
    el.classList.toggle('active', el.dataset.tool === tool);
  });
  const hints = {
    attractor: 'Click to place a gravity well',
    repulsor: 'Click to place a repulsion field',
    vortex: 'Click to place a spiral vortex',
    colorGate: 'Drag a line; crossing particles change color',
    boostGate: 'Drag a line; crossing particles launch forward',
    portal: 'Drag from entrance to exit',
    emitter: `Drag an emitter direction for ${app.particleKind}s`,
    'spawn-orb': 'Click the workspace to drop an orb',
    'spawn-cube': 'Click the workspace to drop a cube',
    'spawn-shard': 'Click the workspace to drop a shard',
  };
  const hint = document.getElementById('tool-hint');
  if (hint) hint.textContent = hints[tool] || 'Choose a tool and build on the workspace';
}

// Matter's MouseConstraint (drag) is only active for the Move tool in edit mode.
function applyToolDrag() {
  setDragEnabled(app.mode === 'edit' && app.tool === 'move');
}

function resetScene() {
  clearDynamic();
  clearObstacles();
  app.clearEmitters();
  app.clearEffects();
  app.clearDrawings();
  app.clearShapes();
}

function resetHistory() {
  history = createHistory(app, { onRestore: updateUI });
}

let history = null;

function commitSceneChange() {
  saveCurrentProject();
  updateUI();
}

function runUndoable(fn) {
  history?.checkpoint();
  fn();
  commitSceneChange();
}

function undoLastAction() {
  if (history?.undo()) {
    saveCurrentProject();
    flash('Undo');
  } else {
    flash('Nothing to undo');
  }
  updateUI();
}

function redoLastAction() {
  if (history?.redo()) {
    saveCurrentProject();
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
  document.getElementById('btn-output-settings').addEventListener('click', async () => {
    const panel = document.getElementById('output-panel');
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) await refreshDisplays();
  });
  document.getElementById('output-close').addEventListener('click', () => {
    document.getElementById('output-panel').classList.remove('open');
  });
  document.getElementById('output-display').addEventListener('change', (event) => {
    selectedDisplayId = event.target.value;
    localStorage.setItem('physmap-output-display', selectedDisplayId);
    resize();
    updateOutputStatus();
  });
  document.getElementById('btn-fullscreen').addEventListener('click', toggleFullscreen);
  document.getElementById('btn-undo').addEventListener('click', undoLastAction);
  document.getElementById('btn-redo').addEventListener('click', redoLastAction);
  document.getElementById('btn-clear').addEventListener('click', () => runUndoable(clearDynamic));
  document.getElementById('btn-clear-fx').addEventListener('click', () => {
    runUndoable(() => app.clearEffects());
    flash('Physics effects cleared');
  });
  document.getElementById('btn-reset').addEventListener('click', () => runUndoable(resetScene));
  document.getElementById('btn-pause').addEventListener('click', togglePause);

  document.getElementById('btn-home').addEventListener('click', openHome);
  document.getElementById('btn-saves').addEventListener('click', () => saveCurrentProject({ announce: true }));
  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-export').addEventListener('click', () => exportFile(app));

  const fileInput = document.getElementById('import-file');
  document.getElementById('btn-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) return;
    try {
      history?.checkpoint();
      await importFile(fileInput.files[0], app);
      setWorkspaceProjectName(fileInput.files[0].name.replace(/\.json$/i, '') || 'Imported Project');
      commitSceneChange();
      flash('Scene imported');
    } catch (err) {
      flash('Import failed');
      console.warn(err);
    }
    fileInput.value = '';
  });

  document.querySelectorAll('.workspace-menu button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector('.workspace-more')?.removeAttribute('open');
    });
  });
}

// ===========================================================================
// Startup splash + project hub
// ===========================================================================
function sceneSummary(scene) {
  const shapes = Array.isArray(scene?.shapes) ? scene.shapes.length : 0;
  const emitters = Array.isArray(scene?.emitters) ? scene.emitters.length : 0;
  const effects = Array.isArray(scene?.effects) ? scene.effects.length : 0;
  const parts = [`${shapes} shape${shapes === 1 ? '' : 's'}`];
  if (emitters) parts.push(`${emitters} emitter${emitters === 1 ? '' : 's'}`);
  if (effects) parts.push(`${effects} effect${effects === 1 ? '' : 's'}`);
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
  if (isOutputActive()) stopDedicatedOutput();
  if (app.mode === 'perform') enterEdit();
  closeSaves();
  closeSettings();
  renderHomeProjects();
  document.body.classList.add('menu-open');
  document.getElementById('home-screen')?.classList.remove('closed');
}

function startNewProject() {
  openSaves();
}

function createNamedProject(name) {
  resetScene();
  app.paused = false;
  app.mode = 'edit';
  resetHistory();
  setTool('select');
  setWorkspaceProjectName(name);
  saveCurrentProject();
  renderHomeProjects();
  closeSaves();
  closeHome();
  flash(`Created “${name}”`);
}

function continueCurrentProject() {
  if (!getLocalScene()) return;
  setWorkspaceProjectName(currentProjectName);
  closeHome();
  flash('Current project opened');
}

function openNamedFromHome(name) {
  if (!loadNamed(app, name)) return;
  app.mode = 'edit';
  resetHistory();
  setTool('select');
  setWorkspaceProjectName(name);
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
  count.textContent = `${names.length} project${names.length === 1 ? '' : 's'}`;
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
  document.getElementById('home-settings').addEventListener('click', openSettings);
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
  saveCurrentProject();
  updatePropsPanel();
}

function applyStrokeWidth(value) {
  const s = app.getSelectedShape();
  if (!s) return;
  s.strokeWidth = Math.max(1, Math.min(20, Number(value) || config.shapeOutlineWidth));
  saveCurrentProject();
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
  saveCurrentProject();
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
  if (app.selectedPhysics) {
    history.checkpoint();
    const { type, id } = app.selectedPhysics;
    if (type === 'emitter') app.emitters = app.emitters.filter((item) => item.id !== id);
    else app.effects = app.effects.filter((item) => item.id !== id);
    app.selectedPhysics = null;
    commitSceneChange();
    return;
  }
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

function getSelectedPhysicsObject() {
  const selected = app.selectedPhysics;
  if (!selected) return null;
  const item = selected.type === 'emitter'
    ? app.emitters.find((emitter) => emitter.id === selected.id)
    : app.effects.find((effect) => effect.id === selected.id);
  if (!item) {
    app.selectedPhysics = null;
    return null;
  }
  return { selectionType: selected.type, item };
}

function physicsLabel(selectionType, item) {
  if (selectionType === 'emitter') return `${item.kind || 'orb'} emitter`;
  return {
    attractor: 'Gravity Well',
    repulsor: 'Repulsor Field',
    vortex: 'Vortex Field',
    colorGate: 'Color Gate',
    boostGate: 'Boost Gate',
    portal: 'Portal Pair',
  }[item.type] || 'Physics Object';
}

function updatePhysicsInspector(selectionType, item) {
  const groups = {
    emitter: document.getElementById('emitter-config'),
    field: document.getElementById('field-config'),
    colorGate: document.getElementById('color-gate-config'),
    boostGate: document.getElementById('boost-gate-config'),
    portal: document.getElementById('portal-config'),
  };
  Object.values(groups).forEach((group) => { group.hidden = true; });

  const title = document.getElementById('physics-config-title');
  const help = document.getElementById('physics-config-help');
  const label = physicsLabel(selectionType, item);
  title.textContent = label;

  if (selectionType === 'emitter') {
    groups.emitter.hidden = false;
    help.textContent = 'Choose what this emitter creates, how often it fires and how strongly it launches.';
    document.querySelectorAll('[data-emitter-kind]').forEach((button) => {
      button.classList.toggle('active', button.dataset.emitterKind === (item.kind || 'orb'));
    });
    document.getElementById('emitter-rate').value = item.interval;
    document.getElementById('emitter-rate-value').textContent = `${Math.round(item.interval)} ms`;
    document.getElementById('emitter-power').value = item.power || 0;
    document.getElementById('emitter-power-value').textContent = Number(item.power || 0).toFixed(1);
  } else if (['attractor', 'repulsor', 'vortex'].includes(item.type)) {
    groups.field.hidden = false;
    help.textContent = item.type === 'attractor'
      ? 'Pulls particles toward its center.'
      : item.type === 'repulsor'
        ? 'Pushes particles away from its center.'
        : 'Pulls particles into a rotating spiral.';
    document.getElementById('field-radius').value = item.radius || 150;
    document.getElementById('field-radius-value').textContent = `${Math.round(item.radius || 150)} px`;
    const base = item.type === 'repulsor' ? 0.001 : 0.0008;
    const intensity = Math.max(1, Math.min(10, Math.round((item.strength || base) / base * 5)));
    document.getElementById('field-strength').value = intensity;
    document.getElementById('field-strength-value').textContent = intensity;
  } else if (item.type === 'colorGate') {
    groups.colorGate.hidden = false;
    help.textContent = 'Every particle crossing this line changes to the chosen color.';
    document.querySelectorAll('[data-gate-color]').forEach((button) => {
      button.classList.toggle('active', button.dataset.gateColor === (item.color || '#63f5c5'));
    });
  } else if (item.type === 'boostGate') {
    groups.boostGate.hidden = false;
    help.textContent = 'Crossing particles are launched perpendicular to the gate arrows.';
    document.getElementById('boost-power').value = item.power || 13;
    document.getElementById('boost-power-value').textContent = Math.round(item.power || 13);
  } else if (item.type === 'portal') {
    groups.portal.hidden = false;
    help.textContent = 'Particles entering either ring exit through the paired ring.';
    document.getElementById('portal-radius').value = item.radius || 30;
    document.getElementById('portal-radius-value').textContent = `${Math.round(item.radius || 30)} px`;
  }
}

function updatePropsPanel() {
  const panel = document.getElementById('props');
  if (!panel) return;
  const s = app.getSelectedShape();
  const physics = getSelectedPhysicsObject();
  const isEditing = app.mode === 'edit';
  const empty = document.getElementById('inspector-empty');
  const shapeName = document.getElementById('inspector-shape-name');
  const liveBadge = panel.querySelector('.inspector-live');

  panel.style.display = isEditing ? 'flex' : 'none';
  panel.classList.toggle('physics-selected', Boolean(physics));
  panel.classList.toggle('empty', !s && !physics);
  if (empty) empty.hidden = Boolean(s || physics);
  if (liveBadge) liveBadge.textContent = s || physics ? 'Live' : 'Ready';

  if (physics) {
    if (shapeName) shapeName.textContent = physicsLabel(physics.selectionType, physics.item);
    updatePhysicsInspector(physics.selectionType, physics.item);
    return;
  }

  if (!s) {
    if (shapeName) shapeName.textContent = 'Nothing selected';
    return;
  }
  if (shapeName) {
    const labels = {
      square: 'Rectangle Surface',
      triangle: 'Triangle Surface',
      line: s.closed === false ? 'Open Path' : 'Closed Path',
    };
    shapeName.textContent = labels[s.type] || 'Mapped Surface';
  }
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

  const updateSelectedPhysics = (mutate) => {
    const selected = getSelectedPhysicsObject();
    if (!selected) return;
    history.checkpoint();
    mutate(selected.item, selected.selectionType);
    commitSceneChange();
    updatePropsPanel();
  };

  document.querySelectorAll('[data-emitter-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      updateSelectedPhysics((item, type) => {
        if (type === 'emitter') item.kind = button.dataset.emitterKind;
      });
    });
  });
  document.getElementById('emitter-rate').addEventListener('change', (event) => {
    updateSelectedPhysics((item, type) => {
      if (type === 'emitter') item.interval = Number(event.target.value);
    });
  });
  document.getElementById('emitter-rate').addEventListener('input', (event) => {
    document.getElementById('emitter-rate-value').textContent = `${event.target.value} ms`;
  });
  document.getElementById('emitter-power').addEventListener('change', (event) => {
    updateSelectedPhysics((item, type) => {
      if (type === 'emitter') item.power = Number(event.target.value);
    });
  });
  document.getElementById('emitter-power').addEventListener('input', (event) => {
    document.getElementById('emitter-power-value').textContent = Number(event.target.value).toFixed(1);
  });
  document.getElementById('field-radius').addEventListener('change', (event) => {
    updateSelectedPhysics((item) => { item.radius = Number(event.target.value); });
  });
  document.getElementById('field-radius').addEventListener('input', (event) => {
    document.getElementById('field-radius-value').textContent = `${event.target.value} px`;
  });
  document.getElementById('field-strength').addEventListener('change', (event) => {
    updateSelectedPhysics((item) => {
      const base = item.type === 'repulsor' ? 0.001 : 0.0008;
      item.strength = base * (Number(event.target.value) / 5);
    });
  });
  document.getElementById('field-strength').addEventListener('input', (event) => {
    document.getElementById('field-strength-value').textContent = event.target.value;
  });
  document.querySelectorAll('[data-gate-color]').forEach((button) => {
    button.addEventListener('click', () => {
      updateSelectedPhysics((item) => { item.color = button.dataset.gateColor; });
    });
  });
  document.getElementById('boost-power').addEventListener('change', (event) => {
    updateSelectedPhysics((item) => { item.power = Number(event.target.value); });
  });
  document.getElementById('boost-power').addEventListener('input', (event) => {
    document.getElementById('boost-power-value').textContent = event.target.value;
  });
  document.getElementById('boost-flip').addEventListener('click', () => {
    updateSelectedPhysics((item) => { item.direction = (item.direction || 1) * -1; });
  });
  document.getElementById('portal-radius').addEventListener('change', (event) => {
    updateSelectedPhysics((item) => { item.radius = Number(event.target.value); });
  });
  document.getElementById('portal-radius').addEventListener('input', (event) => {
    document.getElementById('portal-radius-value').textContent = `${event.target.value} px`;
  });
  document.getElementById('physics-delete').addEventListener('click', () => {
    const selected = app.selectedPhysics;
    if (!selected) return;
    history.checkpoint();
    if (selected.type === 'emitter') {
      app.emitters = app.emitters.filter((item) => item.id !== selected.id);
    } else {
      app.effects = app.effects.filter((item) => item.id !== selected.id);
    }
    app.selectedPhysics = null;
    commitSceneChange();
  });
}

// ===========================================================================
// Saved-scenes menu (multiple named scenes in the browser)
// ===========================================================================
function openSaves() {
  document.getElementById('saves-modal').classList.add('open');
  const nameInput = document.getElementById('saves-name');
  nameInput.value = '';
  requestAnimationFrame(() => nameInput.focus());
}

function closeSaves() {
  document.getElementById('saves-modal')?.classList.remove('open');
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
    if (listSaves()[name]) {
      flash('A project with that name already exists');
      nameInput.select();
      return;
    }
    createNamedProject(name);
  };
  document.getElementById('saves-add').addEventListener('click', doSave);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSave();
  });
}

function applyTheme(theme) {
  const nextTheme = theme === 'light' ? 'light' : 'dark';
  document.body.dataset.theme = nextTheme;
  localStorage.setItem('physmap-theme', nextTheme);
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.classList.toggle('active', button.dataset.themeChoice === nextTheme);
  });
}

function openSettings() {
  document.querySelector('.workspace-more')?.removeAttribute('open');
  document.getElementById('settings-modal')?.classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-modal')?.classList.remove('open');
}

function wireSettings() {
  const modal = document.getElementById('settings-modal');
  document.getElementById('settings-close').addEventListener('click', closeSettings);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeSettings();
  });
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    button.addEventListener('click', () => applyTheme(button.dataset.themeChoice));
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeSettings();
  });
  applyTheme(localStorage.getItem('physmap-theme') || 'dark');
}

let currentUpdateState = null;

function renderUpdateState(state) {
  currentUpdateState = state;
  const current = document.getElementById('current-version');
  const introCurrent = document.getElementById('intro-current-version');
  const available = document.getElementById('available-version');
  const message = document.getElementById('update-message');
  const action = document.getElementById('update-action');
  const progress = document.getElementById('update-progress');
  const progressBar = document.getElementById('update-progress-bar');
  if (!current || !available || !message || !action || !progress || !progressBar) return;

  const currentVersion = `v${state.currentVersion || '0.1.0-alpha.3'}`;
  current.textContent = currentVersion;
  if (introCurrent) introCurrent.textContent = currentVersion;
  available.textContent = state.availableVersion ? `v${state.availableVersion}` : 'Latest';
  message.textContent = state.message || 'Ready to check';
  progress.classList.toggle('visible', state.status === 'downloading');
  progressBar.style.width = `${Math.max(0, Math.min(100, state.progress || 0))}%`;
  action.classList.toggle('ready', ['available', 'downloaded'].includes(state.status));
  action.disabled = ['checking', 'downloading'].includes(state.status);

  if (state.status === 'available') action.textContent = 'Download Update';
  else if (state.status === 'downloaded') action.textContent = 'Restart & Install';
  else if (state.status === 'checking') action.textContent = 'Checking...';
  else if (state.status === 'downloading') action.textContent = `${state.progress || 0}%`;
  else if (state.status === 'development') {
    action.textContent = 'Installed App Only';
    action.disabled = true;
  } else action.textContent = 'Check Update';
}

async function runUpdateAction() {
  if (!desktopOutput || !currentUpdateState) return;
  try {
    if (currentUpdateState.status === 'available') {
      renderUpdateState(await desktopOutput.downloadUpdate());
    } else if (currentUpdateState.status === 'downloaded') {
      await desktopOutput.installUpdate();
    } else {
      renderUpdateState(await desktopOutput.checkForUpdates());
    }
  } catch (error) {
    renderUpdateState({
      ...currentUpdateState,
      status: 'error',
      message: error?.message || 'Update action failed',
    });
  }
}

async function wireUpdater() {
  document.getElementById('update-action').addEventListener('click', runUpdateAction);
  if (!desktopOutput?.getUpdateState) {
    renderUpdateState({
      status: 'development',
      currentVersion: '0.1.0-alpha.3',
      message: 'Updates are available in the installed desktop app',
    });
    return;
  }
  desktopOutput.onUpdateState(renderUpdateState);
  renderUpdateState(await desktopOutput.getUpdateState());
}

// ===========================================================================
// Keyboard shortcuts
// ===========================================================================
window.addEventListener('keydown', (e) => {
  if (document.body.classList.contains('menu-open')) return;
  if (e.target.matches?.('input, select, textarea')) return;
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
  if (e.key === 'Escape') {
    closeSaves();
    document.getElementById('output-panel')?.classList.remove('open');
    document.querySelector('.workspace-more')?.removeAttribute('open');
  }

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
    case '1': setTool('spawn-orb'); break;
    case '2': setTool('spawn-cube'); break;
    case '3': setTool('spawn-shard'); break;
    case 'g': setTool('attractor'); break;
    case 'h': setTool('repulsor'); break;
    case 'j': setTool('vortex'); break;
    case 'k': setTool('colorGate'); break;
    case 'l': setTool('boostGate'); break;
    case 'o': setTool('portal'); break;
    // Shape tools.
    case 'v': setTool('select'); break;
    case 'q': setTool('square'); break;
    case 't': setTool('triangle'); break;
    case 'y': setTool('line'); break;
    case 'delete':
    case 'backspace':
      if (app.getSelectedShape() || app.selectedPhysics) {
        e.preventDefault();
        deleteSelected();
      }
      break;
  }
});

// ===========================================================================
// Init
// ===========================================================================
window.addEventListener('resize', resize);
window.addEventListener('beforeunload', () => stopDedicatedOutput());
resize();

setupMouse(canvas, dpr);
resetHistory();
initTools(canvas, app, {
  beforeChange: () => history.checkpoint(),
  onChange: commitSceneChange,
  onSelect: updatePropsPanel,
});
initShapeInput(canvas, app, {
  beforeChange: () => history.checkpoint(),
  onChange: commitSceneChange,
  onSelect: () => {
    if (app.selectedShapeId) app.selectedPhysics = null;
    updatePropsPanel();
  },
  onCreated: () => setTool('select'),
});
wireToolbar();
wireProps();
wireSaves();
wireHome();
wireProjectName();
wireSettings();
wireUpdater();
desktopOutput?.onDisplaysChanged(renderDisplayOptions);
desktopOutput?.onOutputClosed(() => {
  outputWindow = null;
  outputDisplay = null;
  if (outputStream) {
    for (const track of outputStream.getTracks()) track.stop();
    outputStream = null;
  }
  updateUI();
});
refreshDisplays();
setTool('select');

loadLocal(app);
setWorkspaceProjectName(currentProjectName);
renderHomeProjects();
updateUI();
requestAnimationFrame(resize);

requestAnimationFrame(loop);
