/**
 * The access gate.
 *
 * The brief asks for a token gate and warns that a weak solution — one that
 * hands the shared secret to client-side JavaScript — should be flagged rather
 * than silently built. It does not have to be: the token never reaches the
 * browser at all.
 *
 * **How.** Two credentials are accepted, for two different callers.
 *
 *  - `Authorization: Bearer <token>` — for MCP, `curl`, CI. These are processes
 *    that already hold the secret legitimately.
 *  - `Cookie: flarent_session=<v1.exp.mac>` — for the browser. The cookie does
 *    **not** contain the token. It carries an expiry and an HMAC of that expiry
 *    keyed by the token, so possessing the cookie proves someone once knew the
 *    token without the cookie being the token. It is set `HttpOnly`, so no
 *    script on the page can read it, and the editor bundle is untouched: it
 *    keeps making the same relative `fetch` calls it always made, and the
 *    browser attaches the cookie itself.
 *
 * The token is exchanged for the cookie on a small server-rendered page at
 * `/__auth`. That page is plain HTML from this file — not part of the Vite
 * build — so the editor's UX is unchanged and the secret never enters the
 * bundle, `import.meta.env`, or any JS the browser can read.
 *
 * **What this is not.** No accounts, no per-user state, no sessions table, no
 * OAuth. One shared secret for one private deployment, which is what was asked
 * for. Everyone who has the token is the same principal, so this gate stops
 * *the internet* from consuming the renderer — it does not separate one holder
 * of the token from another, and it should not be mistaken for something that
 * does.
 */

import crypto from 'node:crypto';

const COOKIE = 'flarent_session';
const VERSION = 'v1';

/**
 * Compare two secrets without leaking their contents through timing.
 *
 * Both sides are hashed first so the buffers are always 32 bytes:
 * `timingSafeEqual` throws on a length mismatch, and guarding that with a length
 * check would itself leak the length of the real token.
 */
const sameSecret = (a, b) => {
  const left = crypto.createHash('sha256').update(String(a)).digest();
  const right = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
};

const sign = (token, expiry) =>
  crypto.createHmac('sha256', token).update(`${VERSION}|${expiry}`).digest('hex');

export const makeSessionValue = (token, ttlMs) => {
  const expiry = Date.now() + ttlMs;
  return `${VERSION}.${expiry}.${sign(token, expiry)}`;
};

const validSession = (value, token) => {
  if (typeof value !== 'string') return false;
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  const [version, expiry, mac] = parts;
  if (version !== VERSION) return false;
  const expiresAt = Number(expiry);
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false;
  try {
    return sameSecret(mac, sign(token, expiry));
  } catch {
    return false;
  }
};

const parseCookies = (header) => {
  const out = {};
  for (const part of String(header ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
};

const bearer = (header) => {
  const value = String(header ?? '');
  return /^Bearer\s+/i.test(value) ? value.replace(/^Bearer\s+/i, '').trim() : null;
};

/**
 * Is this request allowed through?
 *
 * `/api/health` is exempt so an uptime monitor and a container health check do
 * not need the secret — it reports liveness and capacity, never content.
 */
export const isAuthorised = (req, config) => {
  if (!config.accessToken) return true;

  const presented = bearer(req.headers.authorization);
  if (presented) {
    try {
      if (sameSecret(presented, config.accessToken)) return true;
    } catch {
      /* fall through */
    }
  }

  const cookie = parseCookies(req.headers.cookie)[COOKIE];
  return validSession(cookie, config.accessToken);
};

export const isPublicPath = (pathname) =>
  pathname === '/api/health' || pathname === '/__auth';

/**
 * The sign-in page.
 *
 * Deliberately dependency-free, styleless-but-legible, and self-contained: it
 * has to work before any of the app's assets are allowed to load.
 */
export const signInPage = (message = null) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Flarent — access</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         background:#0f100f; color:#e8ebe6;
         font:15px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,sans-serif; }
  form { width:min(92vw,340px); display:flex; flex-direction:column; gap:12px; }
  h1 { font-size:15px; font-weight:600; margin:0; letter-spacing:.02em; }
  p { margin:0; color:#9aa396; font-size:13px; }
  input { padding:10px 12px; border-radius:6px; border:1px solid #2a302a;
          background:#171b16; color:inherit; font:inherit; }
  input:focus-visible { outline:2px solid #4ADE6A; outline-offset:1px; }
  button { padding:10px 12px; border-radius:6px; border:0; background:#4ADE6A;
           color:#0f100f; font:inherit; font-weight:600; cursor:pointer; }
  .err { color:#f08a7a; font-size:13px; }
</style></head><body>
<form method="POST" action="/__auth">
  <h1>Flarent Motion Engine</h1>
  <p>This deployment is private. Enter the access token to continue.</p>
  ${message ? `<p class="err">${message}</p>` : ''}
  <input type="password" name="token" autocomplete="current-password"
         aria-label="Access token" autofocus required>
  <button type="submit">Continue</button>
</form>
</body></html>`;

/**
 * Cookie attributes.
 *
 * `Secure` is set only when the request actually arrived over TLS — hard-coding
 * it would make the gate impossible to use over plain HTTP on a LAN or in a
 * test, and omitting it in production would be worse. `SameSite=Lax` rather
 * than `Strict` so that following a link to the app from elsewhere does not
 * present as signed-out; the gate protects an expensive renderer, and there is
 * no state-changing GET here for a cross-site request to abuse.
 */
export const sessionCookie = (value, { secure, maxAgeSeconds }) =>
  [
    `${COOKIE}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
    secure ? 'Secure' : null,
  ].filter(Boolean).join('; ');

export const requestIsSecure = (req) =>
  String(req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https' ||
  Boolean(req.socket?.encrypted);

/** A browser navigation gets a redirect to the form; an API call gets 401 JSON. */
export const wantsHtml = (req) =>
  String(req.headers.accept ?? '').includes('text/html');

export { COOKIE };
