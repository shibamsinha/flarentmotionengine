/**
 * Test isolation. **Import this first in every test file.**
 *
 * `DATA_DIR` is resolved when `lib/engine.mjs` is first evaluated, so the
 * environment has to be set before any other module is imported. ES module
 * imports evaluate depth-first in source order, so an `import './env.mjs'` above
 * the rest of the imports runs early enough — and putting it anywhere else
 * silently does nothing, which is why it lives in its own file with this note.
 *
 * Without it a test run would create, mutate and delete projects in the
 * developer's real `.flarent/projects`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (!process.env.FLARENT_MCP_HOME) {
  process.env.FLARENT_MCP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'flarent-mcp-test-'));
}

export const TEST_HOME = process.env.FLARENT_MCP_HOME;
