import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendOrigin = process.env.VITE_BACKEND_ORIGIN ?? 'http://127.0.0.1:8000';
const backendWsOrigin = backendOrigin.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  build: {
    // RNNoise is loaded on demand only when noise suppression is enabled, so its
    // large WebAssembly-backed chunk should not warn like initial app code.
    chunkSizeWarningLimit: 5000,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': backendOrigin,
      '/ws': {
        target: backendWsOrigin,
        ws: true,
      },
    },
  },
});
