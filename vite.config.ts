import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const APP_PORT = Number(process.env.FLARENT_APP_PORT ?? 5173);
const RENDER_PORT = Number(process.env.FLARENT_RENDER_PORT ?? 5174);

export default defineConfig({
  plugins: [react()],
  server: {
    port: APP_PORT,
    // Fail loudly instead of hopping to the next free port — the next free port
    // is the render server's, and the collision is confusing to debug.
    strictPort: true,
    proxy: {
      // The render server (server/render-server.mjs) runs alongside `vite`.
      '/api': `http://localhost:${RENDER_PORT}`,
      '/out': `http://localhost:${RENDER_PORT}`,
    },
  },
});
