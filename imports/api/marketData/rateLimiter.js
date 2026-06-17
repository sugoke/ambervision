import { ProviderError, PROVIDER_ERROR } from './providers/providerInterface';
import { recordCreditsUsed } from './dataProvidersCollection';

/**
 * In-memory token bucket per provider (single-server deployment).
 *
 * - perMinute: requests are spaced at 60000/perMinute ms; acquire() awaits its
 *   turn in a serialized promise chain.
 * - perDay: hard daily cap (resets at UTC midnight); exceeding it throws
 *   ProviderError('rate-limit') immediately instead of queueing.
 *
 * Known limitations (acceptable here, documented for the future):
 * - per-process: counters reset on server restart
 * - not shared across horizontal instances
 */
class TokenBucket {
  constructor(providerId, { perMinute, perDay }) {
    this.providerId = providerId;
    this.perMinute = perMinute;
    this.perDay = perDay;
    this.minIntervalMs = perMinute ? Math.ceil(60000 / perMinute) : 0;
    this.nextSlotAt = 0;
    this.dailyUsed = 0;
    this.dailyDate = this._utcDay();
    this.queue = Promise.resolve();
  }

  _utcDay() {
    return new Date().toISOString().split('T')[0];
  }

  _rollDayIfNeeded() {
    const today = this._utcDay();
    if (today !== this.dailyDate) {
      this.dailyDate = today;
      this.dailyUsed = 0;
    }
  }

  // Returns a promise that resolves when this caller may issue its request.
  acquire() {
    const run = this.queue.then(async () => {
      this._rollDayIfNeeded();
      if (this.perDay && this.dailyUsed >= this.perDay) {
        throw new ProviderError(
          PROVIDER_ERROR.RATE_LIMIT,
          `${this.providerId} daily request cap reached (${this.perDay}/day)`
        );
      }
      const now = Date.now();
      const waitMs = Math.max(0, this.nextSlotAt - now);
      this.nextSlotAt = Math.max(now, this.nextSlotAt) + this.minIntervalMs;
      if (waitMs > 0) {
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }
      this.dailyUsed++;
      // Mirror usage into the provider doc for the dashboard (fire-and-forget).
      recordCreditsUsed(this.providerId, this.dailyUsed, this.dailyDate);
    });
    // Keep the chain alive even if a caller's request later fails.
    this.queue = run.catch(() => {});
    return run;
  }
}

const buckets = new Map();

// Lazy singleton per provider. Re-created when the configured limits change
// (e.g. edited from the dashboard) — usage counters carry over for the day.
export function getRateLimiter(providerId, rateLimit) {
  if (!rateLimit) return { acquire: async () => {} };
  const key = providerId;
  const existing = buckets.get(key);
  if (
    existing &&
    existing.perMinute === rateLimit.perMinute &&
    existing.perDay === rateLimit.perDay
  ) {
    return existing;
  }
  const bucket = new TokenBucket(providerId, rateLimit);
  if (existing) {
    bucket.dailyUsed = existing.dailyUsed;
    bucket.dailyDate = existing.dailyDate;
  }
  buckets.set(key, bucket);
  return bucket;
}
