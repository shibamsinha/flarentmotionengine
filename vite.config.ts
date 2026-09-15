import { rm } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const APP_PORT = Number(process.env.FLARENT_APP_PORT ?? 5173);
const RENDER_PORT = Number(process.env.FLARENT_RENDER_PORT ?? 5174);

/**
 * Keep runtime uploads out of the production build.
 *
 * `public/uploads` used to hold every image and audio file anyone had ever
 * imported, and Vite copies `public/` wholesale — so `npm run build` baked one
 * developer's media into the deployable artifact, and the build-time snapshot
 * then *shadowed* the live directory in production: a file uploaded after
 * deployment was served by nothing, and the editor showed a broken image while
 * the exported MP4 contained the picture correctly.
 *
 * Uploads now live outside `public/` (see `server/config.mjs`), so this is the
 * belt to that braces: even if a stray `public/uploads` reappears — a leftover
 * checkout, a hand-copied file — it never reaches `dist/`. Vite has no
 * per-subdirectory exclusion for `publicDir`, so removing it after the copy is
 * the available mechanism.
 */
const excludeUploadsFromBuild = (): Plugin => {
  // Taken from the resolved config rather than `__dirname`: this file is ESM,
  // where `__dirname` does not exist, and the output directory is Vite's to
  // decide in any case.
  let outDir = 'dist';
  return {
    name: 'flarent-exclude-uploads',
    apply: 'build',
    configResolved(resolved) {
      outDir = path.resolve(resolved.root, resolved.build.outDir);
    },
    closeBundle: async () => {
      await rm(path.join(outDir, 'uploads'), { recursive: true, force: true });
    },
  };
};

export default defineConfig({
  plugins: [react(), excludeUploadsFromBuild()],
  server: {
    port: APP_PORT,
    // Fail loudly instead of hopping to the next free port — the next free port
    // is the render server's, and the collision is confusing to debug.
    strictPort: true,
    proxy: {
      // The render server (server/render-server.mjs) runs alongside `vite`.
      '/api': `http://localhost:${RENDER_PORT}`,
      '/out': `http://localhost:${RENDER_PORT}`,
      /*
       * Uploads are proxied now rather than served from `public/`.
       *
       * This is what makes development and production agree. Previously Vite
       * served `public/uploads` directly, so the dev editor could see an upload
       * that a deployed build could not — the difference that hid the
       * upload-after-deployment bug until it reached production. One path, one
       * server, both environments.
       */
      '/uploads': `http://localhost:${RENDER_PORT}`,
    },
  },
});
