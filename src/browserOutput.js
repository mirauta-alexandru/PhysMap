// browserOutput.js
// ---------------------------------------------------------------------------
// Projector routing for the web build.
//
// The desktop app asks Electron which displays are connected and opens a
// fullscreen window on the chosen one. A browser cannot do that by itself, so
// this module offers the same small interface (`listDisplays`, change
// notifications) on top of what the web platform has:
//
//   - Chromium browsers with the Window Management API: the real list of
//     screens, so the output window opens directly on the projector.
//   - Every other browser: one generic "Output window" target. The window
//     opens next to the editor; the user drags it onto the projector and
//     clicks it once to go fullscreen.
//
// Nothing here asks for a permission on page load. The screen list is only
// requested after a click (Setup or Output).

const GENERIC_ID = 'browser-window';

let screenDetails = null;
let permissionDenied = false;
const displayListeners = new Set();

function supportsScreenDetails() {
  return typeof window.getScreenDetails === 'function';
}

function genericDisplay() {
  const scale = window.devicePixelRatio || 1;
  return {
    id: GENERIC_ID,
    label: 'Output window',
    bounds: {
      x: window.screenX + 80,
      y: window.screenY + 80,
      width: window.screen.width || 1280,
      height: window.screen.height || 720,
    },
    scaleFactor: scale,
    isPrimary: true,
    isEditor: false,
    isGeneric: true,
  };
}

function describeScreens(details) {
  return details.screens.map((screen, index) => ({
    id: `screen-${index}-${screen.left}-${screen.top}-${screen.width}x${screen.height}`,
    label: screen.label || `Display ${index + 1}`,
    bounds: {
      x: screen.availLeft ?? screen.left,
      y: screen.availTop ?? screen.top,
      width: screen.width,
      height: screen.height,
    },
    scaleFactor: screen.devicePixelRatio || 1,
    isPrimary: Boolean(screen.isPrimary),
    isEditor: screen === details.currentScreen,
    isGeneric: false,
  }));
}

async function readScreens({ prompt }) {
  if (!supportsScreenDetails() || permissionDenied) return null;
  if (!screenDetails) {
    if (!prompt) {
      // Only read silently when the permission was already granted earlier.
      try {
        const status = await navigator.permissions.query({ name: 'window-management' });
        if (status.state !== 'granted') return null;
      } catch (err) {
        return null;
      }
    }
    try {
      screenDetails = await window.getScreenDetails();
      screenDetails.addEventListener('screenschange', () => {
        const displays = describeScreens(screenDetails);
        for (const listener of displayListeners) listener(displays);
      });
    } catch (err) {
      permissionDenied = true;
      return null;
    }
  }
  return describeScreens(screenDetails);
}

export function createBrowserOutput() {
  return {
    isDesktop: false,
    isBrowser: true,
    canDetectDisplays: supportsScreenDetails(),

    // `prompt: true` may show the browser's "manage windows" permission prompt,
    // so it is only passed from a click handler.
    async listDisplays({ prompt = false } = {}) {
      const screens = await readScreens({ prompt });
      return screens?.length ? screens : [genericDisplay()];
    },

    async closeOutput() {},

    onDisplaysChanged(callback) {
      displayListeners.add(callback);
      return () => displayListeners.delete(callback);
    },

    onOutputClosed() {
      return () => {};
    },
  };
}

// window.open features that place the popup on the chosen display.
export function popupFeatures(display) {
  if (!display || display.isGeneric) {
    return 'popup=yes,width=960,height=540';
  }
  const { x, y, width, height } = display.bounds;
  return `popup=yes,left=${x},top=${y},width=${width},height=${height}`;
}
