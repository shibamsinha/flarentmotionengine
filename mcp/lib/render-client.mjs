/**
 * Talking to the existing render server.
 *
 * MCP does not render anything itself. `server/render-server.mjs` already owns
 * Remotion bundling, the browser, the job table and the output directory, and
 * duplicating any of that would give the editor and MCP two renderers that could
 * disagree. This is a client, not a second implementation.
 *
 * The one thing worth care here is the server not being up. The render server is
 * a separate process (`npm run dev` starts both), so "connection refused" is the
 * single most likely failure an MCP user will hit — and a raw `ECONNREFUSED`
 * tells a model nothing. Every call turns that into a retryable
 * SERVICE_UNAVAILABLE naming the command to start it.
 */

import nodePath from 'node:path';

import { config } from '../../server/config.mjs';
import { renderFailed, unavailable, validationError } from './errors.mjs';

const PORT = Number(process.env.FLARENT_RENDER_PORT ?? 5174);
const BASE = process.env.FLARENT_RENDER_URL ?? `http://localhost:${PORT}`;

/** Generous, because a first render downloads a browser and builds a bundle. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * The absolute path of a rendered file.
 *
 * The server used to return this in the response body and no longer does —
 * absolute paths are reconnaissance for a remote client, and the render server
 * is now a public-facing process. MCP is not a remote client: it runs on the
 * same machine, reading the same `FLARENT_OUT_DIR`, so it resolves the path
 * itself from the filename the server does return.
 *
 * The one way this can be wrong is a render server started with a different
 * `FLARENT_OUT_DIR` than this process sees. The callers check that the file
 * exists and say so plainly rather than failing on a bare ENOENT.
 */
export const outPath = (filename) =>
  nodePath.join(config.outDir, nodePath.basename(String(filename ?? '')));

/**
 * Credentials, when the deployment has a gate.
 *
 * Only ever sent to `FLARENT_RENDER_URL`, which is localhost unless deliberately
 * pointed elsewhere. Unset in ordinary local use, where the server is open.
 */
const authHeaders = () =>
  config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {};

const call = async (path, { method = 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        ...authHeaders(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw unavailable(`The render server did not respond within ${timeoutMs / 1000}s.`);
    }
    throw unavailable(
      `Cannot reach the Flarent render server at ${BASE}. Start it with \`npm run dev\` ` +
        '(or `npm run dev:render` for the renderer alone).',
      { baseUrl: BASE, cause: error.message },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw renderFailed(`The render server returned something that is not JSON: ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const message = payload.error ?? `Render server returned ${response.status}.`;
    if (response.status === 404) throw validationError(message, payload);
    if (response.status >= 500) throw unavailable(message, payload);
    throw renderFailed(message, { status: response.status, ...payload });
  }

  return payload;
};

export const health = () => call('/api/health', { timeoutMs: 4000 });

/** Start an MP4 render. Returns `{ jobId }` — the server never blocks. */
export const startRender = (payload) =>
  call('/api/render', { method: 'POST', body: payload });

export const renderStatus = (jobId) =>
  call(`/api/render/${encodeURIComponent(jobId)}`, { timeoutMs: 10_000 });

export const cancelRender = (jobId) =>
  call(`/api/render/${encodeURIComponent(jobId)}`, { method: 'DELETE', timeoutMs: 10_000 });

/**
 * Render one frame. Synchronous on the server, so this waits.
 *
 * The timeout is the long one: a *first* still may have to download the headless
 * browser and build the webpack bundle before it can draw anything.
 */
export const renderStill = (payload) =>
  call('/api/still', { method: 'POST', body: payload, timeoutMs: 300_000 });

/**
 * Render several frames and composite them into one image.
 *
 * A longer ceiling than a single still because the cost scales with the number
 * of cells — nine frames is nine renders, even though they share one bundle and
 * one browser.
 */
export const renderContactSheet = (payload) =>
  call('/api/contact-sheet', { method: 'POST', body: payload, timeoutMs: 600_000 });

/**
 * The shape the render server expects.
 *
 * Built from a parsed project so the bytes MCP sends are the bytes the editor
 * would send for the same document — same fields, same omissions. `format` is
 * only included when it is landscape, matching the editor and keeping a portrait
 * request byte-identical to what a pre-format client sent.
 */
export const renderPayload = (project) => ({
  scenes: project.scenes,
  palette: project.palette,
  fields: project.fields ?? {},
  /**
   * V8's other two palette halves. Omitted when empty for the same reason
   * `format` is: a project that sets neither must produce the request a pre-V8
   * client sent, byte for byte.
   */
  ...(Object.keys(project.ink ?? {}).length > 0 ? { ink: project.ink } : {}),
  ...(project.accent ? { accent: project.accent } : {}),
  ...(project.overlay ? { overlay: project.overlay } : {}),
  ...(project.audio ? { audio: project.audio } : {}),
  ...(project.format === 'landscape' ? { format: 'landscape' } : {}),
});

export { BASE };
