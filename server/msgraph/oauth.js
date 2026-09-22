import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import crypto from 'crypto';
import { MsGraphAuthStatesCollection } from '/imports/api/msGraphAccounts';
import { getGraphConfig, assertGraphConfigured, GRAPH_SCOPES } from './config.js';

/**
 * Authorization-code + PKCE against Entra ID, entirely server-side.
 *
 * PKCE on top of a confidential client (we do hold a client secret) is belt and
 * braces: it binds the redirect to the browser that started it, so a leaked or
 * replayed `code` is useless on its own.
 */

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes to complete a sign-in

const base64url = buf => buf.toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const hashState = raw => crypto.createHash('sha256').update(raw).digest('hex');

function createPkcePair() {
  const codeVerifier = base64url(crypto.randomBytes(48));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

/**
 * Only same-origin relative paths may be returned to after the callback.
 * Rejects absolute URLs and protocol-relative "//evil.com" (which a browser
 * treats as absolute) — the classic open-redirect hole in an OAuth callback.
 */
export function sanitizeReturnTo(returnTo) {
  const fallback = '/profile';
  if (!returnTo || typeof returnTo !== 'string') return fallback;
  if (!returnTo.startsWith('/')) return fallback;
  if (returnTo.startsWith('//')) return fallback;
  if (returnTo.includes('\\')) return fallback; // some browsers normalise \ to /
  if (!/^\/[A-Za-z0-9_\-/?=&.%#]*$/.test(returnTo)) return fallback;
  return returnTo.slice(0, 300);
}

/**
 * Start a sign-in. Returns the URL the browser should navigate to, having
 * stashed the userId server-side against a single-use state value.
 */
export async function beginAuthorization({ userId, sessionTokenHash, returnTo }) {
  const config = assertGraphConfigured();
  const { codeVerifier, codeChallenge } = createPkcePair();
  const state = Random.id(32);
  const now = new Date();

  await MsGraphAuthStatesCollection.insertAsync({
    // Only the hash is stored: `state` is a bearer value that travels through
    // the browser and Microsoft, same treatment as every other token here.
    stateHash: hashState(state),
    userId,
    // Lets the callback confirm the session that started the flow is still
    // alive and still belongs to this user, rather than trusting the query
    // string alone.
    sessionTokenHash,
    // Plaintext is fine: single-use, 10-minute TTL, swept by index, and
    // worthless without the client secret. Encrypting it would drag the
    // key-configuration problem into the sign-in path for no gain.
    codeVerifier,
    returnTo: sanitizeReturnTo(returnTo),
    createdAt: now,
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
    usedAt: null
  });

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: config.redirectUri,
    response_mode: 'query',
    scope: GRAPH_SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // Make the account explicit rather than silently reusing whatever Windows
    // session is active — users may be signed into more than one tenant.
    prompt: 'select_account'
  });

  return { authorizeUrl: `${config.authorizeUrl}?${params.toString()}`, state };
}

/**
 * Validate and burn a state value.
 *
 * Single-use is enforced by a conditional update on `usedAt`, not by a delete:
 * the update's matched-count tells us whether *this* call was the one that
 * claimed it, so two concurrent callbacks replaying the same state cannot both
 * proceed. (A plain delete-then-check has the same effect, but leaves no trace
 * of a replay attempt; keeping the row until TTL makes that visible.)
 */
export async function consumeState(rawState) {
  if (!rawState || typeof rawState !== 'string') return null;

  const stateDoc = await MsGraphAuthStatesCollection.findOneAsync({ stateHash: hashState(rawState) });
  if (!stateDoc) return null;

  const claimed = await MsGraphAuthStatesCollection.updateAsync(
    { _id: stateDoc._id, usedAt: null },
    { $set: { usedAt: new Date() } }
  );
  if (claimed !== 1) return null; // already used, or lost the race

  // The TTL index is a background sweeper, not a guarantee at read time.
  if (stateDoc.expiresAt && stateDoc.expiresAt.getTime() < Date.now()) return null;

  return stateDoc;
}

async function postToken(body) {
  const config = assertGraphConfigured();
  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString()
  });

  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch (e) { payload = { error: 'invalid_response', error_description: text.slice(0, 500) }; }

  if (!response.ok) {
    const err = new Error(payload.error_description || payload.error || `Token endpoint returned ${response.status}`);
    err.oauthError = payload.error || null;
    err.status = response.status;
    throw err;
  }
  return payload;
}

export async function exchangeCode({ code, codeVerifier }) {
  const config = getGraphConfig();
  return postToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
    scope: GRAPH_SCOPES.join(' ')
  });
}

export async function refreshAccessToken(refreshToken) {
  const config = getGraphConfig();
  return postToken({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: GRAPH_SCOPES.join(' ')
  });
}

/** Errors that mean the connection is dead and only re-consent can fix it. */
export function isReconsentError(err) {
  const code = err?.oauthError;
  return code === 'invalid_grant' || code === 'interaction_required' || code === 'consent_required';
}
