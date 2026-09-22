import { Meteor } from 'meteor/meteor';
import {
  MsGraphAccountsCollection,
  MSGRAPH_STATUS,
  MSGRAPH_PUBLIC_FIELDS
} from '/imports/api/msGraphAccounts';
import {
  encryptGraphSecret,
  decryptGraphSecret,
  assertGraphCryptoAvailable,
  isGraphCryptoAvailable
} from './tokenCrypto.js';
import { getGraphConfig } from './config.js';

/**
 * Persistence for per-user Graph tokens. All encryption lives here.
 *
 * Every lookup is scoped by { userId, clientId }: dev and production use
 * separate Entra app registrations against the same shared Atlas database, so
 * this keeps a developer's own test connection from overwriting — or being
 * mistaken for — their real production one.
 */

export { isGraphCryptoAvailable };

const currentClientId = () => getGraphConfig().clientId || null;

const selector = (userId) => ({ userId, clientId: currentClientId() });

/** Full document including encrypted fields. Server-side use only. */
export async function getAccount(userId) {
  if (!userId) return null;
  return MsGraphAccountsCollection.findOneAsync(selector(userId));
}

/** Safe projection for the UI — never contains tokens. */
export async function getPublicStatus(userId) {
  if (!userId) return null;
  return MsGraphAccountsCollection.findOneAsync(selector(userId), { fields: MSGRAPH_PUBLIC_FIELDS });
}

export function readRefreshToken(account) {
  if (!account?.refreshToken) return null;
  return decryptGraphSecret(account.refreshToken);
}

export function readAccessToken(account) {
  if (!account?.accessToken) return null;
  return decryptGraphSecret(account.accessToken);
}

/**
 * Create or replace a user's mailbox connection after a successful code exchange.
 * `profile` is the /me response.
 */
export async function saveAccount({ userId, tokens, profile, tenantId }) {
  assertGraphCryptoAvailable();
  const now = new Date();
  const clientId = currentClientId();

  await MsGraphAccountsCollection.upsertAsync(
    { userId, clientId },
    {
      $set: {
        userId,
        clientId,
        microsoftUserId: profile?.id || null,
        microsoftEmail: (profile?.mail || profile?.userPrincipalName || '').toLowerCase() || null,
        displayName: profile?.displayName || null,
        tenantId: tenantId || null,
        // Store what was actually granted — the refresh request must ask for the
        // same set, and a tenant policy can grant less than we requested.
        scopes: typeof tokens.scope === 'string' ? tokens.scope.split(' ').filter(Boolean) : [],
        refreshToken: encryptGraphSecret(tokens.refresh_token),
        accessToken: encryptGraphSecret(tokens.access_token),
        accessTokenExpiresAt: new Date(now.getTime() + (Number(tokens.expires_in) || 3600) * 1000),
        status: MSGRAPH_STATUS.CONNECTED,
        lastError: null,
        connectedAt: now,
        lastRefreshAt: now
      }
    }
  );

  return getPublicStatus(userId);
}

/**
 * Persist a refreshed access token. Entra rotates refresh tokens, so store the
 * new one whenever the response carries it — dropping it strands the connection
 * at the old token's expiry and the next refresh fails with invalid_grant.
 */
export async function updateTokens(userId, tokens) {
  assertGraphCryptoAvailable();
  const now = new Date();
  const $set = {
    accessToken: encryptGraphSecret(tokens.access_token),
    accessTokenExpiresAt: new Date(now.getTime() + (Number(tokens.expires_in) || 3600) * 1000),
    status: MSGRAPH_STATUS.CONNECTED,
    lastError: null,
    lastRefreshAt: now
  };
  if (tokens.refresh_token) $set.refreshToken = encryptGraphSecret(tokens.refresh_token);
  if (typeof tokens.scope === 'string' && tokens.scope) {
    $set.scopes = tokens.scope.split(' ').filter(Boolean);
  }

  await MsGraphAccountsCollection.updateAsync(selector(userId), { $set });
}

/**
 * The refresh token is no longer usable (revoked, password changed, consent
 * withdrawn, or a Conditional Access policy now demands interactive re-auth).
 * Keep the row so the UI can explain what happened and offer to reconnect,
 * but drop the dead tokens.
 */
export async function markNeedsReconsent(userId, reason) {
  await MsGraphAccountsCollection.updateAsync(
    selector(userId),
    {
      $set: { status: MSGRAPH_STATUS.NEEDS_RECONSENT, lastError: reason ? String(reason).slice(0, 300) : null },
      $unset: { refreshToken: '', accessToken: '', accessTokenExpiresAt: '' }
    }
  );
}

export async function touchLastUsed(userId) {
  MsGraphAccountsCollection.updateAsync(selector(userId), { $set: { lastUsedAt: new Date() } })
    .catch(err => console.error('[MSGraph] lastUsedAt update failed:', err.message));
}

/**
 * Forget the connection locally. This does NOT revoke the grant at Microsoft —
 * that lives at https://myaccount.microsoft.com ("Apps you have given access
 * to") or an admin revoke. Since we delete our only copy of the refresh token,
 * the app can no longer reach the mailbox, which is what "disconnect" means here.
 */
export async function deleteAccount(userId) {
  const removed = await MsGraphAccountsCollection.removeAsync(selector(userId));
  return removed > 0;
}
