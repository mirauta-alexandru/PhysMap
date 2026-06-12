import { defineConfig } from 'vite';

// Minimal Vite config. PhysMap is a static single-page app, so the defaults
// mostly work; we only set the base to relative so the built `dist/` can be
// served from any sub-path (handy when deploying to GitHub Pages, etc).
export default defineConfig({
  base: './',
});
