import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
