import { Meteor } from 'meteor/meteor';
import { getAccount, readAccessToken, readRefreshToken, updateTokens, markNeedsReconsent } from './accountStore.js';
import { refreshAccessToken, isReconsentError } from './oauth.js';
import { MSGRAPH_STATUS } from '/imports/api/msGraphAccounts';

/**
 * Access-token supply for Graph calls.
 *
 * Same shape as EmailService.getAccessToken() (imports/api/emailService.js):
 * an in-process cache that refreshes shortly before expiry. The extra piece
 * here is the per-user in-flight map — a mail picker fires several Graph calls
 * at once, and without it each would kick off its own refresh. Since Entra
 * rotates refresh tokens, concurrent refreshes race to overwrite each other and
 * can invalidate the connection outright.
 */

const REFRESH_SKEW_MS = 5 * 60 * 1000; // renew 5 minutes early

// userId -> { token, expiresAt }
const tokenCache = new Map();
// userId -> Promise<string> while a refresh is in flight
const inFlight = new Map();

export function clearCachedToken(userId) {
  tokenCache.delete(userId);
  inFlight.delete(userId);
}

function cacheIfFresh(userId, token, expiresAt) {
  if (!token || !expiresAt) return null;
  if (expiresAt.getTime() - Date.now() <= REFRESH_SKEW_MS) return null;
  tokenCache.set(userId, { token, expiresAt });
  return token;
}

async function doRefresh(userId, account) {
  const refreshToken = readRefreshToken(account);
  if (!refreshToken) {
    await markNeedsReconsent(userId, 'No refresh token stored');
    throw new Meteor.Error('msgraph-needs-reconsent', 'Your Outlook connection needs to be renewed.');
  }

  try {
    const tokens = await refreshAccessToken(refreshToken);
    await updateTokens(userId, tokens);
    const expiresAt = new Date(Date.now() + (Number(tokens.expires_in) || 3600) * 1000);
    tokenCache.set(userId, { token: tokens.access_token, expiresAt });
    return tokens.access_token;
  } catch (err) {
    if (isReconsentError(err)) {
      // Revoked, password changed, consent withdrawn, or Conditional Access now
      // demands an interactive sign-in. Nothing to retry — the user must reconnect.
      await markNeedsReconsent(userId, err.message);
      tokenCache.delete(userId);
      throw new Meteor.Error('msgraph-needs-reconsent', 'Your Outlook connection expired. Please reconnect your mailbox.');
    }
    throw new Meteor.Error('msgraph-token-refresh-failed', err.message || 'Could not refresh the Outlook access token.');
  }
}

/**
 * Valid access token for a user, refreshing transparently.
 * Throws 'msgraph-not-connected' when there is no mailbox to talk to.
 */
export async function getAccessToken(userId) {
  if (!userId) throw new Meteor.Error('msgraph-not-connected', 'No Outlook mailbox connected.');

  const cached = tokenCache.get(userId);
  if (cached && cached.expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) {
    return cached.token;
  }

  const pending = inFlight.get(userId);
  if (pending) return pending;

  const account = await getAccount(userId);
  if (!account) throw new Meteor.Error('msgraph-not-connected', 'No Outlook mailbox connected.');
  if (account.status === MSGRAPH_STATUS.NEEDS_RECONSENT) {
    throw new Meteor.Error('msgraph-needs-reconsent', 'Your Outlook connection expired. Please reconnect your mailbox.');
  }

  // The stored token may still be good — another process may have refreshed it.
  const stored = cacheIfFresh(userId, readAccessToken(account), account.accessTokenExpiresAt);
  if (stored) return stored;

  const promise = doRefresh(userId, account).finally(() => inFlight.delete(userId));
  inFlight.set(userId, promise);
  return promise;
}
