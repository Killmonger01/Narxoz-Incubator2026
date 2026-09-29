import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, API and WebSocket calls are proxied to `wrangler dev` (port 8787).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
});
