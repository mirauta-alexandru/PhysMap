const STORAGE_KEY = 'physmap-preferences-v1';

export const DEFAULT_PREFERENCES = Object.freeze({
  theme: 'dark',
  showGrid: true,
  gridSize: 40,
  snapToGrid: false,
  showCenterGuides: true,
  showThirds: false,
  showSafeArea: false,
  focusMode: false,
  reduceMotion: false,
});

function normalize(raw = {}) {
  const gridSize = Number(raw.gridSize);
  return {
    theme: raw.theme === 'light' ? 'light' : 'dark',
    showGrid: raw.showGrid !== false,
    gridSize: [20, 40, 80].includes(gridSize) ? gridSize : DEFAULT_PREFERENCES.gridSize,
    snapToGrid: raw.snapToGrid === true,
    showCenterGuides: raw.showCenterGuides !== false,
    showThirds: raw.showThirds === true,
    showSafeArea: raw.showSafeArea === true,
    focusMode: raw.focusMode === true,
    reduceMotion: raw.reduceMotion === true,
  };
}

export function loadPreferences() {
  try {
    return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences) {
  const normalized = normalize(preferences);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function snapCoordinate(value, size, threshold = 9) {
  const snapped = Math.round(value / size) * size;
  return Math.abs(snapped - value) <= threshold ? snapped : value;
}

export function snapPoint(point, preferences) {
  if (!preferences.snapToGrid) return point;
  const size = preferences.gridSize || DEFAULT_PREFERENCES.gridSize;
  const threshold = Math.min(12, Math.max(6, size * 0.22));
  return {
    x: snapCoordinate(point.x, size, threshold),
    y: snapCoordinate(point.y, size, threshold),
  };
}
