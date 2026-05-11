/**
 * Meteor methods that the React consent page uses to complete the OAuth flow.
 * These methods handle the human-in-the-loop piece: showing what's being
 * requested, capturing the user's approve/deny, and returning the final
 * redirect URL for the browser to follow back to the OAuth client.
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';

import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';
import {
  OauthClientsCollection,
  PendingRequests,
  Consents,
  OauthConsentsCollection
} from '/imports/api/oauthAuthServer';
import { revokeAllForUserClient } from '/server/mcp/oauth/provider';

async function resolveUser(sessionId) {
  const session = await SessionHelpers.validateSession(sessionId);
  if (!session) throw new Meteor.Error('not-authorized', 'Invalid or expired session');
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) throw new Meteor.Error('not-authorized', 'User not found');
  return user;
}

function buildRedirectUrl(pending, extra) {
  const url = new URL(pending.redirectUri);
  for (const [k, v] of Object.entries(extra)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  }
  if (pending.state) url.searchParams.set('state', pending.state);
  return url.toString();
}

Meteor.methods({
  /**
   * Fetch what's pending for a given authorization request id.
   * The React consent page shows client name, scopes, and redirect destination
   * before the user clicks Allow.
   */
  async 'oauth.getAuthorizationRequest'(reqId) {
    check(reqId, String);

    const pending = await PendingRequests.find(reqId);
    if (!pending) throw new Meteor.Error('not-found', 'Authorization request not found or expired');

    const client = await OauthClientsCollection.findOneAsync(pending.clientId);
    return {
      reqId,
      status: pending.status,
      scopes: pending.scopes,
      redirectUri: pending.redirectUri,
      clientId: pending.clientId,
      client: client ? {
        clientName: client.clientName,
        clientUri: client.clientUri || null,
        logoUri: client.logoUri || null
      } : null
    };
  },

  /**
   * Approve an authorization request. Returns the final redirect URL which
   * the browser must navigate to so the OAuth client receives the auth code.
   */
  async 'oauth.approveAuthorization'(sessionId, reqId) {
    check(sessionId, String);
    check(reqId, String);

    const user = await resolveUser(sessionId);
    const pending = await PendingRequests.find(reqId);
    if (!pending) throw new Meteor.Error('not-found', 'Authorization request not found or expired');
    if (pending.status !== 'pending') {
      throw new Meteor.Error('invalid-state', `Request already ${pending.status}`);
    }

    const { authCode } = await PendingRequests.approve(reqId, user._id);
    await Consents.record({ userId: user._id, clientId: pending.clientId, scopes: pending.scopes });

    return {
      redirectUrl: buildRedirectUrl(pending, { code: authCode })
    };
  },

  /**
   * Deny an authorization request. Returns the redirect URL with ?error=access_denied.
   */
  async 'oauth.denyAuthorization'(sessionId, reqId) {
    check(sessionId, String);
    check(reqId, String);

    await resolveUser(sessionId); // enforce auth, even though deny is unauthenticated-safe
    const pending = await PendingRequests.find(reqId);
    if (!pending) throw new Meteor.Error('not-found', 'Authorization request not found or expired');

    await PendingRequests.deny(reqId);

    return {
      redirectUrl: buildRedirectUrl(pending, {
        error: 'access_denied',
        error_description: 'User denied the authorization request'
      })
    };
  },

  /**
   * List third-party apps the current user has connected via OAuth.
   */
  async 'oauth.listConnectedClients'(sessionId) {
    check(sessionId, String);
    const user = await resolveUser(sessionId);
    const consents = await OauthConsentsCollection.find(
      { userId: user._id, revokedAt: null },
      { sort: { consentedAt: -1 } }
    ).fetchAsync();

    const clientIds = consents.map(c => c.clientId);
    const clients = clientIds.length
      ? await OauthClientsCollection.find({ _id: { $in: clientIds } }).fetchAsync()
      : [];
    const clientMap = Object.fromEntries(clients.map(c => [c._id, c]));

    return consents.map(c => ({
      _id: c._id,
      clientId: c.clientId,
      clientName: clientMap[c.clientId]?.clientName || 'Unknown client',
      clientUri: clientMap[c.clientId]?.clientUri || null,
      scopes: c.scopes,
      consentedAt: c.consentedAt
    }));
  },

  /**
   * Revoke an OAuth grant (consent + all access/refresh tokens for that client).
   */
  async 'oauth.revokeConnectedClient'(sessionId, clientId) {
    check(sessionId, String);
    check(clientId, String);

    const user = await resolveUser(sessionId);
    await revokeAllForUserClient(user._id, clientId);
    return { success: true };
  }
});
