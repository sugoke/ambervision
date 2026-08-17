import { Meteor } from 'meteor/meteor';
import { createRateLimiter } from './mcp/rateLimit.js';

/**
 * Rate limiters for auth-sensitive methods. Previously there was no throttle on
 * login / password-reset, so an attacker could brute-force passwords or spam
 * reset emails at unlimited speed. Buckets per client IP (in-memory, per process
 * — see mcp/rateLimit.js for the scale-out caveat).
 *
 * Call these inside a method with the client IP; skip when there is no client
 * connection (trusted server-originated calls).
 */
// Limits are per client IP. Kept generous enough not to lock out a whole office
// behind one NAT, while still bounding brute-force to a trickle (each attempt is
// now an expensive scrypt verify server-side).
export const loginRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });
export const authRateLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 40 });

/**
 * Enforce a limiter for the current method invocation. `invocation` is `this`
 * inside a Meteor method. No-op for server-originated calls (no connection).
 * Throws a Meteor.Error('too-many-requests') when the limit is exceeded.
 */
export function enforceAuthRateLimit(invocation, limiter) {
  const ip = invocation && invocation.connection && invocation.connection.clientAddress;
  if (!ip) return; // server-originated call — not rate limited
  if (!limiter(ip)) {
    throw new Meteor.Error('too-many-requests', 'Too many attempts. Please wait a minute and try again.');
  }
}
