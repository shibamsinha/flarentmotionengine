/**
 * Remotion bundle entry point. Used by `npm run studio` and by the render
 * server (`server/render-server.mjs`), which bundles this file with webpack.
 */

import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';

registerRoot(RemotionRoot);
