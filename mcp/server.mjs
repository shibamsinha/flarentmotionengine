#!/usr/bin/env node
/**
 * Flarent MCP server.
 *
 * Speaks MCP over stdio, so an AI client (Claude Desktop, Claude Code) launches
 * it as a child process and talks to it down a pipe. There is no network
 * listener and no port.
 *
 * **The security model is the operating system.** Flarent has no accounts,
 * sessions or tokens, and this server does not invent any: the process runs as
 * whoever started it and can reach exactly the projects that user can already
 * read. That is a real boundary rather than a pretend one, and it is why v1 is
 * stdio-only. Tool logic is deliberately free of any transport or identity
 * concept, so an authenticated HTTP transport can be added later by changing
 * this file and nothing in `tools/`.
 *
 * **stdout belongs to the protocol.** Every diagnostic goes to stderr. A stray
 * `console.log` here corrupts the JSON-RPC stream and the client disconnects
 * with a parse error that points nowhere near the cause — which is why
 * `log()` exists and why nothing below prints to stdout.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadEngine } from './lib/engine.mjs';
import { buildSchemas } from './lib/schemas.mjs';
import { sweep } from './lib/idempotency.mjs';

import { registerProjectTools } from './tools/project.mjs';
import { registerSceneTools } from './tools/scene.mjs';
import { registerContentTools } from './tools/content.mjs';
import { registerTypographyTools } from './tools/typography.mjs';
import { registerMotionTools } from './tools/motion.mjs';
import { registerTimingTools } from './tools/timing.mjs';
import { registerAudioTools } from './tools/audio.mjs';
import { registerRenderTools } from './tools/render.mjs';
import { registerInspectTools } from './tools/inspect.mjs';

export const log = (...parts) => {
  process.stderr.write(`[flarent-mcp] ${parts.join(' ')}\n`);
};

/**
 * Build a fully-registered server.
 *
 * Exported separately from `main` so tests can drive it over an in-memory
 * transport without spawning a process or touching stdio.
 */
export const createServer = async () => {
  const engine = await loadEngine();
  const schemas = buildSchemas(engine);
  const ctx = { engine, schemas };

  const server = new McpServer(
    { name: 'flarent-motion-engine', version: '1.0.0' },
    {
      instructions:
        'Flarent is a kinetic-typography and 2D motion-graphics engine. A video is an ' +
        'ordered list of scenes; each scene holds text elements and optional graphic ' +
        'objects, and one audio track sits on the whole project. Motion is expressed as ' +
        'intent (an entrance, an emphasis, an exit) rather than keyframes — Flarent has ' +
        'no keyframe model, no video elements, and no per-property typography such as ' +
        'font family or letter spacing. Prefer the high-level tools: apply_typography_style, ' +
        'apply_motion_style and sync_to_beats express intent and let the engine compute ' +
        'deterministic values. Start with inspect_project to see what exists.',
    },
  );

  registerProjectTools(server, ctx);
  registerSceneTools(server, ctx);
  registerContentTools(server, ctx);
  registerTypographyTools(server, ctx);
  registerMotionTools(server, ctx);
  registerTimingTools(server, ctx);
  registerAudioTools(server, ctx);
  registerRenderTools(server, ctx);
  registerInspectTools(server, ctx);

  return server;
};

const main = async () => {
  const started = Date.now();
  const server = await createServer();

  const swept = await sweep();
  if (swept > 0) log(`swept ${swept} expired idempotency records`);

  await server.connect(new StdioServerTransport());
  log(`ready in ${Date.now() - started}ms (stdio)`);
};

// Only run when executed directly, so importing this module in a test does not
// try to seize stdio.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    log('fatal:', error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
