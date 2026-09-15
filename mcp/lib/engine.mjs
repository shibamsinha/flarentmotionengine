/**
 * The bridge from Node to Flarent's engine.
 *
 * The engine is TypeScript compiled by Vite for the browser; the MCP server is
 * plain ESM run by Node. `scripts/baseline.mjs` already solved this exact
 * problem — esbuild the bits we need into one CommonJS file and `require` it —
 * and this reuses that approach rather than inventing a second one.
 *
 * **This module exists so that MCP never reimplements engine logic.** Every
 * enum, every constructor, every serialisation rule comes from `src/` at
 * runtime, so a change to the engine reaches MCP without anyone remembering to
 * mirror it. If a tool ever needs a rule the engine already knows, the answer is
 * to export it here, never to restate it in a tool.
 *
 * The bundle is cached on disk under `.flarent/cache/` and keyed by a signature
 * of `src/`, so a cold start pays the build once and every later start is a
 * file read. Same idea as the render server's `bundleCache`, same reason.
 */

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src');

/**
 * Where MCP keeps its own state: projects, idempotency records, analysis cache.
 *
 * Overridable with `FLARENT_MCP_HOME` so a test run — or a second checkout —
 * can be pointed at a scratch directory instead of the developer's real
 * projects. Tests rely on this; without it they would delete real work.
 */
export const DATA_DIR = process.env.FLARENT_MCP_HOME
  ? path.resolve(process.env.FLARENT_MCP_HOME)
  : path.join(ROOT, '.flarent');

/**
 * The compiled-engine cache stays with the checkout rather than under
 * `DATA_DIR`: it is derived from `src/`, not from anyone's data, so sharing it
 * across test runs saves rebuilding a bundle that cannot differ.
 */
const CACHE_DIR = path.join(ROOT, '.flarent', 'cache');

/**
 * What the bundle re-exports. Everything the MCP layer is allowed to know about
 * the engine passes through this list, which makes the coupling surface
 * explicit and greppable rather than ambient.
 */
const ENTRY_SOURCE = `
export {
  serialiseProject,
  parseFlarentScript,
} from ${JSON.stringify(path.join(SRC, 'utils/importScript'))};

export {
  buildTimeline,
  totalFrames,
  totalSeconds,
  sceneFrames,
  secondsToFrames,
  framesToSeconds,
  canvasFor,
  CANVAS_FORMATS,
  MIN_SCENE_DURATION,
  MAX_SCENE_DURATION,
} from ${JSON.stringify(path.join(SRC, 'utils/timing'))};

export {
  blankScene,
  blankElement,
  element,
  makeSceneId,
  makeElementId,
  defaultScenes,
} from ${JSON.stringify(path.join(SRC, 'data/defaultScenes'))};

export {
  TEXT_ROLES,
  SIZE_PRESETS,
  POSITION_PRESETS,
  COMPOSITION_PRESETS,
} from ${JSON.stringify(path.join(SRC, 'utils/composition'))};

export { VISUAL_STYLE_NAMES } from ${JSON.stringify(path.join(SRC, 'utils/visualStyle'))};

export {
  ENTER_NAMES,
  EMPHASIS_NAMES,
  EXIT_NAMES,
} from ${JSON.stringify(path.join(SRC, 'utils/objectMotion'))};

export {
  newObject,
  addObject,
  updateObject,
  removeObject,
  findObject,
  flattenObjects,
  duplicateObject,
  reorderObject,
  objectTitle,
  OBJECT_KIND_LABELS,
} from ${JSON.stringify(path.join(SRC, 'data/objects'))};

export { PRESETS } from ${JSON.stringify(path.join(SRC, 'data/presets'))};

export {
  buildPhraseScenes,
  splitPhrases,
  pacePhrases,
} from ${JSON.stringify(path.join(SRC, 'data/phraseBuild'))};

export {
  DEFAULT_PALETTE,
  DEFAULT_ACCENT,
  PALETTE_NAMES,
  FONT_ROLES,
  FACES,
  faceFor,
  themeFor,
  contrastRatio,
  FIELDS,
} from ${JSON.stringify(path.join(SRC, 'utils/typography'))};

export { ANIMATION_STYLES, MOTION_STYLES } from ${JSON.stringify(path.join(SRC, 'components/motion/registry'))};

export { DEFAULT_FORMAT } from ${JSON.stringify(path.join(SRC, 'utils/timing'))};

export {
  audioSelectionLength,
  defaultSelection,
} from ${JSON.stringify(path.join(SRC, 'types/audio'))};

/*
 * Browser auto-save. NOT for the MCP tools — MCP has its own store and must
 * never touch localStorage. These are here only so \`test/persistence.test.mjs\`
 * can exercise the real save/restore path in Node, which is what stops a field
 * being added to \`Scene\` and forgotten in the restore whitelist. That has
 * happened once already: V6 objects were dropped on every reload.
 */
export {
  saveProject,
  loadProject,
  clearProject,
} from ${JSON.stringify(path.join(SRC, 'utils/persistence'))};
`;

/**
 * Cheap change detector over `src/`. Mirrors the render server's
 * `sourceSignature`: file count plus newest mtime is enough to catch an edit
 * without hashing every byte on every start.
 */
const sourceSignature = async () => {
  const stack = [SRC];
  let newest = 0;
  let count = 0;
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else {
        const stat = await fsp.stat(full);
        newest = Math.max(newest, stat.mtimeMs);
        count += 1;
      }
    }
  }
  return createHash('sha1')
    .update(`${count}:${Math.round(newest)}:${ENTRY_SOURCE.length}`)
    .digest('hex')
    .slice(0, 16);
};

let cached = null;

/**
 * The engine, as a plain object of functions and constants.
 *
 * Memoised in-process and cached on disk. Callers should treat the result as
 * read-only: it is the live engine module, not a copy.
 */
export const loadEngine = async () => {
  if (cached) return cached;

  const signature = await sourceSignature();
  await fsp.mkdir(CACHE_DIR, { recursive: true });
  const bundlePath = path.join(CACHE_DIR, `engine-${signature}.cjs`);

  if (!fs.existsSync(bundlePath)) {
    const work = await fsp.mkdtemp(path.join(CACHE_DIR, 'build-'));
    const entry = path.join(work, 'entry.ts');
    await fsp.writeFile(entry, ENTRY_SOURCE);
    try {
      /*
       * React comes along because `presets.ts` reaches the scene types, exactly
       * as it does for the regression gate. Nothing renders — these are pure
       * data functions — but the bundle has to resolve the imports.
       *
       * esbuild's own API rather than `node_modules/.bin/esbuild`: on Windows
       * that path is only an `esbuild.cmd` shim, which `execFileSync` cannot run.
       */
      require('esbuild').buildSync({
        entryPoints: [entry],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        loader: { '.ts': 'ts', '.tsx': 'tsx' },
        logLevel: 'error',
        outfile: bundlePath,
      });
    } finally {
      await fsp.rm(work, { recursive: true, force: true });
    }

    // Drop older bundles so the cache cannot grow without bound.
    for (const name of await fsp.readdir(CACHE_DIR)) {
      if (name.startsWith('engine-') && name !== path.basename(bundlePath)) {
        await fsp.rm(path.join(CACHE_DIR, name), { force: true });
      }
    }
  }

  cached = require(bundlePath);
  return cached;
};
