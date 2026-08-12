import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative, so one build serves from anywhere: the Pages site root, a
  // pr-<number>/ preview directory, or the render CLI's local server. An
  // absolute base baked in at build time made `modl render` time out on
  // assets its server could not resolve (#56).
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    // The core package is consumed as TypeScript source from the workspace.
    fs: { allow: ['..', '../..'] },
  },
  optimizeDeps: {
    exclude: ['@modl/core'],
  },
});
