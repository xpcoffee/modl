import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // PR previews are served from a subdirectory, so assets need a matching base.
  base: process.env['BASE_PATH'] ?? '/',
  plugins: [react()],
  server: {
    port: 5173,
    // The core package is consumed as TypeScript source from the workspace.
    fs: { allow: ['..', '../..'] },
  },
  optimizeDeps: {
    exclude: ['@domain-mapper/core'],
  },
});
