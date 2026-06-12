// config.js
// ---------------------------------------------------------------------------
// Central place for all the knobs you might want to tweak: colors, gravity,
// circle size, spawn rate. Keeping these together makes PhysMap easy to
// re-theme for a different facade or feel.
//
// The projection palette is now white/red to match the brand direction.

export const config = {
  // --- Palette --------------------------------------------------------------
  // Background is always pure black (#000) so that, when projected, only the
  // lit shapes emit light. Do not change this unless you know what you want.
  background: '#000000',

  // Colors used for dynamic circles. Each spawned circle picks one at random.
  palette: ['#ffffff', '#ff1f2d', '#ff5a66', '#f4f4f4'],

  // Color for static obstacles (walls/lines and rectangles) drawn in the scene.
  obstacleColor: '#ff5e3a',

  // Color for freehand Draw strokes. Cool cyan is intentionally distinct from
  // the warm physics palette so hand-drawn marks are easy to read on a facade.
  drawColor: '#35d7ff',
  drawSize: 5,
  drawPointSpacing: 3,

  // Color of the editor grid and body outlines (only shown in EDIT mode).
  gridColor: 'rgba(255, 255, 255, 0.06)',
  outlineColor: 'rgba(255, 255, 255, 0.35)',

  // --- Shapes (drawable objects) --------------------------------------------
  // Default fill color for a freshly drawn shape (square / triangle / poly).
  shapeColor: '#ffcc4d',
  // Stroke width for the 'outline' fill style.
  shapeOutlineWidth: 3,
  // Color of the selection outline + vertex handles in edit mode (mint, to
  // match the PhysMap pixel theme).
  selectionColor: '#b4e89c',

  // --- Physics --------------------------------------------------------------
  // Downward gravity. Matter.js uses ~1.0 as "earth-like"; tune to taste.
  gravity: 1.0,

  // Radius range (px) for spawned circles. Each circle gets a random radius
  // between these two values.
  circleRadiusMin: 8,
  circleRadiusMax: 22,

  // Bounciness (0 = no bounce, 1 = perfectly elastic) of dynamic circles.
  restitution: 0.55,

  // --- Emitters / spawning --------------------------------------------------
  // Default interval (ms) between drops for a spawn point / emitter.
  spawnInterval: 600,

  // Safety cap on how many dynamic circles can exist at once. Old ones are
  // removed when the cap is exceeded, keeping the sim from grinding to a halt.
  maxCircles: 400,

  // --- Rendering ------------------------------------------------------------
  // Glow strength for circles (canvas shadowBlur, in px). 0 disables glow.
  glow: 12,

  // Grid cell size (px) used in edit mode.
  gridSize: 40,

  // --- Tools / editing ------------------------------------------------------
  // Thickness (px) of drawn wall/line segments (they're thin static rectangles).
  wallThickness: 10,

  // Minimum drag distance (px) before a wall/rectangle is actually created.
  // Prevents accidental zero-size bodies from a stray click.
  minDrawSize: 6,

  // Whether to add an invisible-to-serialization floor at the bottom of the
  // stage so circles have something to land on out of the box. Turn off if you
  // want shapes to fall off the bottom edge of the facade.
  defaultFloor: false,

  // localStorage key used by save/load.
  storageKey: 'physmap-scene',

  // --- Projection mapping ---------------------------------------------------
  // How finely each warped surface is subdivided into a grid of triangles.
  // Higher = smoother perspective but more work per frame. 7–9 is a good
  // projection default; the warp grid is cached while corners stay still.
  warpSubdivisions: 8,

  // Clamp the internal source canvas DPR. This keeps fullscreen projection
  // responsive on Retina screens while the output canvas still fills perfectly.
  sourceMaxDpr: 1,

  // Initial launch strength for directed emitters. Drag farther from the
  // emitter to increase strength; a simple click keeps the old drop behavior.
  emitterSpeedScale: 0.14,
  emitterMaxSpeed: 16,
  emitterEditRadius: 18,

  // Radius (px) of the draggable corner handles in Map mode.
  handleRadius: 9,

  // Colors for the Map-mode editing overlay (handles, outlines).
  mapLineColor: 'rgba(255, 255, 255, 0.45)',
  mapActiveColor: '#ff1f2d',

  // --- Projection looks -----------------------------------------------------
  // Visual modes keep the same physics/mapping setup but change what gets
  // projected. Warm colors stay readable on red facades.
  // 'physics' = the shape/particle playground (the reformed default).
  // 'eyes'    = the autonomous facade-eyes art mode (kept as a bonus).
  visualMode: 'physics',
  visualModes: ['physics', 'eyes'],
  eyeStyle: 'round',
  eyeStyles: ['round', 'hollow', 'big-iris', 'red-core', 'minimal'],
};
