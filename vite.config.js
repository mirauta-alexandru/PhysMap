import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8'));
// Also exposed to the HTML pages as %VITE_APP_VERSION% (download links, labels).
process.env.VITE_APP_VERSION = version;

// PhysMap ships as a public landing page plus the full browser/desktop app.
// Keep paths relative so the built `dist/` can be hosted from any sub-path.
export default defineConfig({
  base: './',
  // The app shows its own version; take it from package.json so it never drifts.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    rollupOptions: {
      input: {
        site: resolve(__dirname, 'index.html'),
        app: resolve(__dirname, 'app.html'),
      },
    },
  },
});
