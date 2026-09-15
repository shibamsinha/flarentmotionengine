/**
 * Structured logging.
 *
 * One line per event, machine-parseable, human-skimmable — enough for
 * `journalctl -u flarent | grep render.failed` to be a real answer and little
 * enough that nothing new has to be installed to read it.
 *
 * **What must never reach a log line**, and why each one is listed:
 *
 *  - the access token, or any header carrying it — logs are the most commonly
 *    over-shared artefact an operator has;
 *  - scene JSON — it is the user's script, it is large, and it is the thing the
 *    filenames were changed to stop leaking (PHASE 8);
 *  - uploaded bytes, or client-supplied filenames — the former is media, the
 *    latter is attacker-controlled text that would be written verbatim into a
 *    log an operator later greps;
 *  - absolute filesystem paths, which are free reconnaissance if a log is ever
 *    surfaced (PHASE 14).
 *
 * `redact()` below is the enforcement, not the convention: every value passes
 * through it, so a caller cannot leak by forgetting.
 */

const START = Date.now();

/** Keys whose values are never printed, whatever they contain. */
const SECRET_KEYS = new Set([
  'token', 'accessToken', 'authorization', 'cookie', 'password', 'secret',
  'scenes', 'audio', 'overlay', 'fields', 'ink', 'inputProps', 'body',
  'filename_original', 'clientName',
]);

/** Values that look like a filesystem path leave only their basename behind. */
const looksAbsolute = (value) =>
  typeof value === 'string' && (value.startsWith('/') || /^[A-Za-z]:[\\/]/.test(value));

const redact = (key, value) => {
  if (SECRET_KEYS.has(key)) return '[redacted]';
  if (looksAbsolute(value)) return `…/${value.split(/[\\/]/).pop()}`;
  if (typeof value === 'string' && value.length > 200) return `${value.slice(0, 200)}…`;
  return value;
};

const line = (level, event, fields = {}) => {
  const parts = [`t=${new Date().toISOString()}`, `level=${level}`, `evt=${event}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    const safe = redact(key, value);
    parts.push(`${key}=${typeof safe === 'string' && /[\s"]/.test(safe) ? JSON.stringify(safe) : safe}`);
  }
  return parts.join(' ');
};

export const log = (event, fields) => {
  // eslint-disable-next-line no-console
  console.log(line('info', event, fields));
};

export const warn = (event, fields) => {
  // eslint-disable-next-line no-console
  console.warn(line('warn', event, fields));
};

export const error = (event, fields) => {
  // eslint-disable-next-line no-console
  console.error(line('error', event, fields));
};

export const uptimeSeconds = () => Math.round((Date.now() - START) / 1000);
