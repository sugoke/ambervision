// Session authentication for publications and methods.
//
// The app does not use Meteor accounts: `this.userId` is always null. Every
// publication and method receives a raw session token from the client and
// resolves it here. This file is the only place that turns a token into a user,
// so the string-only guard (a selector object such as { $gt: '' } must never
// reach the database) and the idle/expiry rules apply everywhere at once.
import { Meteor } from 'meteor/meteor';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';
import { findUserByPdfAccessToken } from './pdfAccessTokens.js';

const PDF_PREFIX = 'pdf-temp-';

const isToken = (s) => typeof s === 'string' && s.length > 0;

/**
 * The user behind a session token, or null. Never throws — publications call
 * `if (!user) return this.ready()`.
 *
 * @param {string} sessionId  raw token sent by the client
 * @param {object} [opts]
 * @param {boolean} [opts.touch=false]  refresh `lastUsed` (non-blocking)
 */
export async function getSessionUser(sessionId, { touch = false } = {}) {
  if (!isToken(sessionId)) return null;
  const session = await SessionHelpers.findByToken(sessionId);
  if (!session || !session.userId) return null;
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) return null;
  if (touch) {
    SessionsCollection.updateAsync(session._id, { $set: { lastUsed: new Date() } })
      .catch(err => console.error('[sessionAuth] lastUsed update failed:', err?.message));
  }
  return user;
}

/** The user behind a session token; throws `not-authorized` otherwise. */
export async function requireSession(sessionId) {
  const user = await getSessionUser(sessionId, { touch: true });
  if (!user) throw new Meteor.Error('not-authorized', 'Authentication required');
  return user;
}

/** requireSession plus a role check. */
export async function requireRole(sessionId, roles) {
  const user = await requireSession(sessionId);
  if (!roles.includes(user.role)) {
    throw new Meteor.Error('not-authorized', 'Insufficient permissions');
  }
  return user;
}

/** True when the user holds one of `roles`. */
export function isRole(user, roles) {
  return !!user && roles.includes(user.role);
}

/**
 * The user behind either a real session or a PDF capability token.
 *
 * The headless renderer cannot hold a browser session, so `pdf.generateReport`
 * mints a short-lived token for the caller and the report page authenticates
 * with it — either as `pdf-temp-<token>` in place of a session id, or as
 * `{ userId, pdfToken }` query parameters. The token identifies the user; the
 * caller still applies the user's scope to decide what the page may show.
 *
 * Returns the user or null. Never throws.
 */
export async function getSessionOrPdfUser({ sessionId = null, userId = null, pdfToken = null } = {}) {
  if (isToken(sessionId) && sessionId.startsWith(PDF_PREFIX)) {
    const token = sessionId.slice(PDF_PREFIX.length);
    return token ? findUserByPdfAccessToken(null, token) : null;
  }
  if (isToken(pdfToken)) {
    return findUserByPdfAccessToken(userId, pdfToken);
  }
  return getSessionUser(sessionId);
}

/** getSessionOrPdfUser that throws `not-authorized` when nobody is identified. */
export async function requireSessionOrPdfToken(args) {
  const user = await getSessionOrPdfUser(args);
  if (!user) throw new Meteor.Error('not-authorized', 'Authentication required');
  return user;
}
