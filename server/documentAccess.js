/**
 * Short-lived capability tokens for authenticated document downloads.
 *
 * The document endpoints (/fichier_central, /order_traces, /termsheets,
 * /meetingReports) are hit by plain browser navigations, which cannot carry the
 * app's localStorage session id. So instead of authenticating the GET directly,
 * an already-authenticated Meteor method mints a single-use, short-lived token
 * bound to the exact file path, and the endpoint validates it.
 *
 * Only the SHA-256 hash of the token is stored. Tokens expire (default 5 min)
 * and are single-use (consumed on first successful validation).
 */

import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import crypto from 'crypto';
import { AuditLog } from '/imports/api/auditLog';

export const DocumentAccessTokensCollection = new Mongo.Collection('documentAccessTokens');

if (Meteor.isServer) {
  DocumentAccessTokensCollection.createIndex({ tokenHash: 1 }, { unique: true });
  // TTL index: Mongo removes the doc ~60s after expiresAt.
  DocumentAccessTokensCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 60 });
}

const DOC_TOKEN_PREFIX = 'amdl_';
const DEFAULT_TTL_SECONDS = 300;

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * Mint a download token for a specific path. `path` must be the exact endpoint
 * path the browser will request (e.g. "/fichier_central/<uid>/<file>").
 */
export async function issueDocumentToken(path, userId, ttlSeconds = DEFAULT_TTL_SECONDS) {
  if (!path) throw new Error('issueDocumentToken: path required');
  const raw = `${DOC_TOKEN_PREFIX}${Random.id(32)}`;
  await DocumentAccessTokensCollection.insertAsync({
    tokenHash: hashToken(raw),
    path,
    userId: userId || null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000)
  });
  return raw;
}

/**
 * Validate a token for the requested path. Multi-use within its short TTL (a
 * preview iframe re-renders, and users preview-then-download the same file, so
 * strict single-use would break those flows). Replay is bounded by the 5-minute
 * expiry plus the exact path binding. Returns { userId } when valid, or null.
 */
export async function consumeDocumentToken(rawToken, requestedPath) {
  if (!rawToken || typeof rawToken !== 'string') return null;
  if (!rawToken.startsWith(DOC_TOKEN_PREFIX)) return null;

  const tokenHash = hashToken(rawToken);
  const record = await DocumentAccessTokensCollection.findOneAsync({ tokenHash });
  if (!record) return null;
  if (record.path !== requestedPath) return null;
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) return null;

  // GDPR accountability: every actual document serve is auditable. The path
  // identifies the file; the userId is who minted the token.
  await AuditLog.record({
    actorUserId: record.userId || null,
    action: 'document.download',
    targetType: 'file',
    targetId: record.path
  });

  return { userId: record.userId || null };
}

/**
 * Connect-handler helper: pull the token from ?dl= and validate it against the
 * request's own path. Returns { userId } or null. Never throws.
 */
export async function authorizeDocumentRequest(req) {
  try {
    const host = req.headers?.host || 'localhost';
    const url = new URL(req.url, `http://${host}`);
    const token = url.searchParams.get('dl');
    if (!token) return null;
    return await consumeDocumentToken(token, url.pathname);
  } catch {
    return null;
  }
}
