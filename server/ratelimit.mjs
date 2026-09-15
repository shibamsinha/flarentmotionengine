/**
 * In-process rate limiting.
 *
 * Abuse prevention, not traffic management: the goal is that one client cannot
 * hold the renderer open by looping `POST /api/render`, and nothing more
 * ambitious. A fixed window per key is enough for that and has no moving parts.
 *
 * **The proxy caveat, stated because it is easy to get silently wrong.** Behind
 * Caddy every request arrives from 127.0.0.1, so without `FLARENT_TRUST_PROXY=1`
 * the limiter sees one client and the limit becomes global rather than
 * per-caller. Trusting `X-Forwarded-For` unconditionally would be the worse
 * error — with nothing in front of the server, any caller could forge the header
 * and mint a fresh identity per request — so it is opt-in, and the resolved
 * setting is logged at boot.
 */

export class RateLimiter {
  #windowMs;
  #buckets = new Map();

  constructor(windowMinutes) {
    this.#windowMs = Math.max(1, windowMinutes) * 60_000;
  }

  /**
   * Record a hit against `key` and say whether it is allowed.
   *
   * A `limit` of 0 disables the check for that route, which is how the
   * environment turns limiting off without a second flag.
   */
  check(key, limit) {
    if (!limit || limit <= 0) return { allowed: true, remaining: Infinity, resetMs: 0 };

    const now = Date.now();
    const bucket = this.#buckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      this.#buckets.set(key, { count: 1, resetAt: now + this.#windowMs });
      this.#sweep(now);
      return { allowed: true, remaining: limit - 1, resetMs: this.#windowMs };
    }

    bucket.count += 1;
    const resetMs = bucket.resetAt - now;
    if (bucket.count > limit) {
      return { allowed: false, remaining: 0, resetMs };
    }
    return { allowed: true, remaining: limit - bucket.count, resetMs };
  }

  /**
   * Drop expired buckets.
   *
   * Amortised rather than on a timer: an unbounded Map keyed by client address
   * is itself a memory-exhaustion vector, and a timer would keep the event loop
   * alive in tests.
   */
  #sweep(now) {
    if (this.#buckets.size < 1000) return;
    for (const [key, bucket] of this.#buckets) {
      if (now >= bucket.resetAt) this.#buckets.delete(key);
    }
  }

  reset() {
    this.#buckets.clear();
  }
}

/**
 * Who is this request from, for limiting purposes.
 *
 * Never logged as-is and never used for anything but bucketing.
 */
export const clientKey = (req, trustProxy) => {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket?.remoteAddress ?? 'unknown';
};
