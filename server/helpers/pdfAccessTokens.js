/**
 * Capability tokens for the headless renderer.
 *
 * A PDF is produced by pointing Puppeteer at a normal report URL, and that page
 * cannot carry the user's localStorage session, so `pdf.generateReport` mints a
 * short-lived token the page authenticates with.
 *
 * It used to live in ONE slot, `user.services.pdfAccess`, written at the start
 * of a generation and `$unset` at the end. Two generations for the same user
 * overlapping — a retry after a slow report, or a PMS report and a product
 * report at once — made them fight over that slot: the second run minted its
 * token, the first run's cleanup then deleted it, and the second run's page
 * reported "Authentication failed: Invalid or expired token" and never rendered.
 * That is what a compliance user saw as "nothing happens".
 *
 * So tokens are a LIST, each entry independent: a run only ever removes its own,
 * and expired entries are swept whenever one is issued. Validation still accepts
 * the old single-slot shape, so a token minted by a previous build keeps working
 * across a deploy.
 */

import { Random } from 'meteor/random';
import { UsersCollection } from '/imports/api/users.js';

const FIELD = 'services.pdfAccessTokens';
const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** Mint a token for this user and sweep any that have expired. */
export async function issuePdfAccessToken(userId, ttlMs = DEFAULT_TTL_MS) {
  const token = Random.secret();
  const expiresAt = new Date(Date.now() + ttlMs);

  // Sweep first, then push: two updates because $pull and $push on the same
  // field cannot share one update document.
  await UsersCollection.updateAsync(userId, {
    $pull: { [FIELD]: { expiresAt: { $lte: new Date() } } }
  });
  await UsersCollection.updateAsync(userId, {
    $push: { [FIELD]: { token, expiresAt } }
  });

  return { token, expiresAt };
}

/** Drop one token — only ever the caller's own. */
export async function revokePdfAccessToken(userId, token) {
  if (!userId || typeof token !== 'string' || !token) return;
  await UsersCollection.updateAsync(userId, {
    $pull: { [FIELD]: { token } }
  });
  // The legacy single slot is only cleared when it still holds THIS token, so a
  // stale run cannot wipe a newer one.
  await UsersCollection.updateAsync(
    { _id: userId, 'services.pdfAccess.token': token },
    { $unset: { 'services.pdfAccess': '' } }
  );
}

/**
 * Selector matching a user holding this token, in either shape. Exported so the
 * validators that also need the user document can keep a single query.
 *
 * SECURITY: token and userId arrive from URL query strings. They are compared
 * as strings only — a non-string would otherwise become a Mongo operator.
 */
export function pdfAccessTokenSelector(userId, token) {
  if (typeof token !== 'string' || !token) return null;
  if (userId !== undefined && userId !== null && typeof userId !== 'string') return null;

  const now = new Date();
  return {
    ...(userId ? { _id: userId } : {}),
    $or: [
      { [FIELD]: { $elemMatch: { token, expiresAt: { $gt: now } } } },
      // Legacy shape: expiry is checked here so an old token cannot outlive it.
      { 'services.pdfAccess.token': token, 'services.pdfAccess.expiresAt': { $gt: now } }
    ]
  };
}

/**
 * The user this token belongs to, or null. `userId` is optional: some callers
 * know only the token.
 */
export async function findUserByPdfAccessToken(userId, token, options = undefined) {
  const selector = pdfAccessTokenSelector(userId, token);
  if (!selector) return null;
  return UsersCollection.findOneAsync(selector, options);
}
