/**
 * Small in-memory rolling-window rate limiter, shared by the MCP transport and
 * the OAuth endpoints.
 *
 * Notes / limitations (documented deliberately):
 *  - Per-process. Behind N app instances the effective ceiling is N × max. For
 *    the current single-instance mup deployment that is fine; if you scale out,
 *    move this to a shared store (Redis/Mongo TTL) keyed the same way.
 *  - Buckets are swept so the Map cannot grow without bound (the previous
 *    per-token Map was never evicted).
 */

const DEFAULT_WINDOW_MS = 60 * 1000;

export function createRateLimiter({ windowMs = DEFAULT_WINDOW_MS, max } = {}) {
  if (!max || max < 1) throw new Error('createRateLimiter: max required');
  const buckets = new Map(); // key -> number[] of timestamps (ms)
  let lastSweep = 0;

  return function allow(key) {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Periodic sweep: drop keys whose activity has aged out, bounding memory.
    if (now - lastSweep > windowMs) {
      for (const [k, arr] of buckets) {
        const recent = arr.filter(ts => ts > windowStart);
        if (recent.length === 0) buckets.delete(k);
        else buckets.set(k, recent);
      }
      lastSweep = now;
    }

    const recent = (buckets.get(key) || []).filter(ts => ts > windowStart);
    if (recent.length >= max) {
      buckets.set(key, recent);
      return false;
    }
    recent.push(now);
    buckets.set(key, recent);
    return true;
  };
}

/**
 * Best-effort client IP for rate-limit keying. The deployment runs exactly one
 * trusted proxy hop (HTTP_FORWARDED_COUNT=1), so the LAST X-Forwarded-For entry
 * is the address our proxy observed — a client cannot forge it by prepending
 * entries. Falls back to the socket peer.
 */
export function clientIp(req) {
  const xff = req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For']);
  if (xff) {
    const parts = String(xff).split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return (req.socket && req.socket.remoteAddress)
    || (req.connection && req.connection.remoteAddress)
    || 'unknown';
}
