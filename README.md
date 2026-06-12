# PhysMap

**A free projection-mapping workspace for macOS, Windows, Linux, and the browser.**

PhysMap is the easiest way to start with projection mapping. No expensive software,
no account, no install headaches — open it, draw a shape over the thing you want to
light up, drag the corners to fit, and project. That's it.

The desktop app runs offline, keeps the projector output on pure black so only
your shapes emit light, and ships with a retro pixel-art interface.

---

## What is projection mapping?

Projection mapping turns any real-world surface — a wall, a box, a building facade,
a sculpture — into a display. Instead of a flat rectangle, you shape the projected
light to match the physical object so graphics, video, or animation appear to live
*on* it.

The hard part is usually lining the light up with the object. PhysMap makes that the
whole workflow: you draw a shape, drag its corners onto the real edges, and the
content warps to fit.

---

## Features

- **Corner-pin mapping** — draw a square, triangle, or freeform line, then drag the
  points onto your object. 4-corner shapes get a true perspective warp.
- **Put anything inside a shape:**
  - Solid / glow / pulse / rainbow fills
  - Animated LED outlines: static, snake, chase, and sparks, with adjustable speed
  - Built-in animations grouped by depth, signal, and geometry: 3D cube/grid/orb,
    neon tunnel, starfield, helix, scan, equalizer, wave, radar, rings, and kaleido
  - An **imported image**
  - A **local video file** (loops, muted)
  - A **YouTube video**, perspective-warped onto the shape
- **Cut (mask)** — punch a black hole over part of the projection to hide light spill
  or carve content to an exact shape.
- **Curved lines** — with the Line tool, hover any segment and drag to bend it into a
  smooth curve, with a live preview. Close the path to form a shape.
- **Optional physics** — drop bouncing particles and emitters that collide with your
  shapes (turn any shape into a static obstacle or a falling dynamic body).
- **Movable panels** — drag the toolbar and properties panel anywhere.
- **Project home** — animated startup splash, current-project autosave, new projects,
  and a browsable library of named saved projects.
- **Undo / Redo** with a deep history.
- **Named scenes** — save, load, and manage multiple setups in the browser, or
  export/import them as a `.json` file.
- **One-touch projecting** — a Project button jumps to fullscreen (on a second screen
  / projector where supported) and hides all UI.
- **Works offline** — fonts and assets are bundled; no network required.

---

## Quick start

You need [Node.js](https://nodejs.org) installed.

```bash
# 1. Get the code
git clone https://github.com/mirauta-alexandru/PhysMap.git
cd PhysMap

# 2. Install dependencies
npm install

# 3. Run it
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`).

To run the packaged desktop experience locally:

```bash
npm run desktop
```

To build a static version you can host anywhere:

```bash
npm run build      # output goes to dist/
npm run preview    # preview the built version
```

---

## Desktop packages

PhysMap uses Electron and electron-builder to produce native installers:

```bash
npm run pack         # unpacked app for the current platform
npm run dist:mac     # macOS DMG: Apple Silicon + Intel
npm run dist:win     # Windows x64 NSIS installer
npm run dist:linux   # Linux x64 AppImage + deb
```

Build output is written to `release/`.

### GitHub releases

Push a semantic version tag to build and publish all desktop packages:

```bash
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

The `Desktop Release` GitHub Actions workflow builds:

- macOS Apple Silicon DMG
- macOS Intel DMG
- Windows x64 installer
- Linux x64 AppImage and deb package

The current workflow creates unsigned packages. Apple notarization and Windows
code signing require platform certificates and repository secrets before their
security warnings can be removed.

---

## How to use it

The whole workflow is four steps:

1. **Draw a shape** over the real object — press `Q` for a square, `T` for a
   triangle, or `Y` for a line. (For a line, click point by point and double-click to
   finish; click back on the first point to close it into a shape.)
2. **Fit it** — switch to Select (`V`) and drag the corner points until the shape sits
   exactly on the physical object. With a line, drag any segment to curve it.
3. **Set its look** — in the panel on the right pick a fill (solid, glow, image,
   video, YouTube, animation, cut mask...) and a color.
4. **Project** — press `P` (or the Project button) to go fullscreen and hide the UI.
   Press `P` or `Esc` to come back and keep editing.

Tip: press `F` to put the editor itself on the projector at full resolution, build
your scene there, then `P` to project — what you see is exactly what gets projected.

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `V` | Select / move shapes, drag points |
| `Q` | Square / rectangle |
| `T` | Triangle |
| `Y` | Line (drag a segment to curve it) |
| `X` | Particle emitter |
| `S` | Drop a single particle |
| `Delete` | Delete the selected shape |
| `P` | Project (fullscreen, UI hidden) |
| `E` | Back to edit |
| `F` | Toggle fullscreen |
| `Ctrl/Cmd + Z` | Undo |
| `Shift + Ctrl/Cmd + Z` | Redo |
| `Space` | Pause / resume physics |
| `C` | Clear particles |
| `R` | Reset scene |

---

## Saving your work

- **Scenes** — open the Scenes menu to save the current setup under a name, then load
  or delete saved scenes later. Everything is stored in your browser.
- **Export / Import** — download your scene as a `.json` file to back it up, move it
  to another machine, or share it.

---

## Tech

PhysMap is a small vanilla-JavaScript app built with [Vite](https://vitejs.dev) and
[Matter.js](https://brm.io/matter-js/) for the 2D physics. The perspective warping is
done on a plain 2D canvas (no WebGL, no heavy dependencies), so it stays light and
runs almost anywhere.

---

## License

MIT — see [LICENSE](LICENSE). Free to use, modify, and share.
