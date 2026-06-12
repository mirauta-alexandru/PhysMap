// youtube.js
// ---------------------------------------------------------------------------
// Warped <iframe> overlay for YouTube-backed shapes.
//
// Canvas2D cannot draw a cross-origin YouTube player, so a shape whose fill is
// 'youtube' is shown by floating a real <iframe> *behind* the stage canvas and
// CSS-warping it onto the shape's polygon. The renderer then "punches" a
// transparent hole in the (otherwise opaque-black) canvas exactly over that
// polygon, so the warped video shows through and lines up with the object.
//
//   - 4-corner shapes  -> a perspective matrix3d (real corner-pin warp).
//   - triangle / poly  -> translate + scale to the bounding box, then a CSS
//                          polygon clip so only the shape area shows.

// --- Parse a YouTube video id out of whatever the user pasted -------------
export function parseYouTubeId(input) {
  if (!input) return null;
  const raw = String(input).trim();
  // Already a bare 11-char id.
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (url.hostname === 'youtu.be') {
      const id = url.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (url.hostname.includes('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = url.pathname.match(/\/(?:embed|shorts|v|live)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    /* not a URL — fall through */
  }
  const m = raw.match(/[\w-]{11}/);
  return m ? m[0] : null;
}

// --- Geometry helpers -----------------------------------------------------
function bbox(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Solve the linear system M·x = b (n equations, n unknowns) by Gaussian
// elimination with partial pivoting. Used for the 8-unknown homography.
function solve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

// Projective transform mapping the four `from` points onto the four `to`
// points, returned as a CSS matrix3d() string (column-major 4x4).
function quadToMatrix3d(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = from[i];
    const [dx, dy] = to[i];
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]);
    b.push(dy);
  }
  const h = solve(A, b);
  return (
    `matrix3d(${h[0]},${h[3]},0,${h[6]},` +
    `${h[1]},${h[4]},0,${h[7]},` +
    `0,0,1,0,` +
    `${h[2]},${h[5]},0,1)`
  );
}

// --- Overlay manager ------------------------------------------------------
export function createYouTubeOverlay() {
  const layer = document.createElement('div');
  layer.id = 'yt-layer';
  Object.assign(layer.style, {
    position: 'absolute',
    inset: '0',
    zIndex: '1', // behind the stage canvas (which punches holes to reveal it)
    overflow: 'hidden',
    pointerEvents: 'none',
    background: '#000',
  });
  document.body.appendChild(layer);

  const frames = new Map(); // shapeId -> { wrap, iframe, ytId, baseW, baseH }

  function makeFrame(ytId) {
    const baseW = 640;
    const baseH = 360;
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: baseW + 'px',
      height: baseH + 'px',
      transformOrigin: '0 0',
      overflow: 'hidden',
      background: '#000',
      pointerEvents: 'none',
    });
    const iframe = document.createElement('iframe');
    const params = new URLSearchParams({
      autoplay: '1',
      mute: '1',
      controls: '0',
      loop: '1',
      playlist: ytId, // required for loop to work on a single video
      playsinline: '1',
      modestbranding: '1',
      rel: '0',
      disablekb: '1',
    });
    iframe.src = `https://www.youtube.com/embed/${ytId}?${params}`;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
    iframe.setAttribute('frameborder', '0');
    Object.assign(iframe.style, {
      width: '100%',
      height: '100%',
      border: '0',
      pointerEvents: 'none',
    });
    wrap.appendChild(iframe);
    return { wrap, iframe, ytId, baseW, baseH };
  }

  function position(f, pts) {
    const { baseW: W, baseH: H } = f;
    if (pts.length === 4) {
      f.wrap.style.clipPath = 'none';
      f.wrap.style.transform = quadToMatrix3d(
        [[0, 0], [W, 0], [W, H], [0, H]],
        pts,
      );
    } else if (pts.length >= 3) {
      const bb = bbox(pts);
      const sx = bb.w / W || 1;
      const sy = bb.h / H || 1;
      f.wrap.style.transform = `translate(${bb.minX}px, ${bb.minY}px) scale(${sx}, ${sy})`;
      const poly = pts
        .map((p) => `${(p[0] - bb.minX) / sx}px ${(p[1] - bb.minY) / sy}px`)
        .join(', ');
      f.wrap.style.clipPath = `polygon(${poly})`;
    }
  }

  // Reconcile the live <iframe>s with the current youtube-filled shapes.
  function sync(shapes) {
    const live = new Set();
    for (const s of shapes) {
      if (s.fill !== 'youtube' || !s.youtube || !s.points || s.points.length < 3) {
        continue;
      }
      live.add(s.id);
      let f = frames.get(s.id);
      if (!f || f.ytId !== s.youtube) {
        if (f) f.wrap.remove();
        f = makeFrame(s.youtube);
        layer.appendChild(f.wrap);
        frames.set(s.id, f);
      }
      position(f, s.points);
    }
    for (const [id, f] of frames) {
      if (!live.has(id)) {
        f.wrap.remove();
        frames.delete(id);
      }
    }
  }

  return { sync };
}
