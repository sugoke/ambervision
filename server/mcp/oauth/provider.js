/**
 * Ambervision OAuth 2.1 provider implementation.
 *
 * Plugs into the MCP SDK's `mcpAuthRouter` to expose
 *  - /.well-known/oauth-authorization-server
 *  - /oauth/authorize
 *  - /oauth/token
 *  - /oauth/register
 *  - /oauth/revoke
 *
 * Authorization flow:
 *  1. SDK handles /oauth/authorize request, calls provider.authorize()
 *  2. We stash the request params and redirect the user to /oauth-consent?req=<id>
 *     (the React app serves that path and runs the consent component)
 *  3. Consent component calls oauth.approve Meteor method which issues an auth code
 *  4. React redirects browser back to Claude.ai redirect_uri with ?code=...&state=...
 *  5. Claude.ai calls /oauth/token → provider.exchangeAuthorizationCode
 *  6. PKCE verified, access + refresh tokens issued
 */

import {
  OauthClientStore,
  PendingRequests,
  AccessTokens,
  RefreshTokens,
  Consents,
  verifyPkceS256,
  ACCESS_TOKEN_TTL_SECONDS
} from '/imports/api/oauthAuthServer';

export class AmbervisionOAuthProvider {
  get clientsStore() {
    return OauthClientStore;
  }

  /**
   * Entry point: SDK has parsed/validated the request; we must eventually
   * redirect `res` either with ?code+state or ?error.
   */
  async authorize(client, params, res) {
    // params: { state, scopes, codeChallenge, redirectUri, resource }
    const pending = await PendingRequests.create({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256',
      scopes: params.scopes || [],
      state: params.state,
      resource: params.resource
    });

    // Hand off to the React consent page. Absolute path keeps the origin.
    const consentUrl = `/oauth-consent?req=${encodeURIComponent(pending._id)}`;
    res.redirect(302, consentUrl);
  }

  async challengeForAuthorizationCode(client, authorizationCode) {
    const pending = await PendingRequests.findByAuthCode(authorizationCode);
    if (!pending) throw new Error('invalid_grant: authorization code not found or expired');
    if (pending.clientId !== client.client_id) {
      throw new Error('invalid_grant: authorization code issued to a different client');
    }
    return pending.codeChallenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, codeVerifier, redirectUri /*, resource */) {
    const pending = await PendingRequests.findByAuthCode(authorizationCode);
    if (!pending) throw new Error('invalid_grant: authorization code not found or expired');
    if (pending.clientId !== client.client_id) {
      throw new Error('invalid_grant: authorization code issued to a different client');
    }
    if (pending.redirectUri !== redirectUri) {
      throw new Error('invalid_grant: redirect_uri mismatch');
    }
    if (!verifyPkceS256(codeVerifier, pending.codeChallenge)) {
      throw new Error('invalid_grant: PKCE verifier does not match challenge');
    }

    // Atomically consume the code. The single caller that flips it to used wins;
    // a concurrent double-spend or a later replay gets false, which for a code
    // that was already delivered means replay — revoke everything issued from
    // this grant (RFC 9700 §4.1.1).
    const won = await PendingRequests.consumeAuthCode(pending._id);
    if (!won) {
      await AccessTokens.revokeForClient(pending.approvedByUserId, pending.clientId);
      await RefreshTokens.revokeForClient(pending.approvedByUserId, pending.clientId);
      console.warn(`[MCP OAuth] auth-code replay/double-spend; revoked grant for user=${pending.approvedByUserId} client=${pending.clientId}`);
      throw new Error('invalid_grant: authorization code already used');
    }

    const userId = pending.approvedByUserId;
    const scopes = pending.scopes || [];

    const access  = await AccessTokens.issue({ userId, clientId: client.client_id, scopes });
    const refresh = await RefreshTokens.issue({ userId, clientId: client.client_id, scopes });

    return {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refresh.token,
      scope: scopes.join(' ')
    };
  }

  async exchangeRefreshToken(client, refreshToken, scopes /*, resource */) {
    const existing = await RefreshTokens.find(refreshToken);
    if (!existing) {
      // Reuse detection (RFC 9700 §4.14.2): a refresh token that exists but is
      // already revoked is a rotated-and-superseded token being replayed — the
      // classic stolen-refresh-token signal. Tear down the whole family plus
      // every access token for this (user, client), so an attacker who captured
      // an earlier token in the chain cannot keep minting from its descendants.
      const stale = await RefreshTokens.findAnyByValue(refreshToken);
      if (stale && stale.revokedAt) {
        await RefreshTokens.revokeForClient(stale.userId, stale.clientId);
        await AccessTokens.revokeForClient(stale.userId, stale.clientId);
        console.warn(`[MCP OAuth] refresh-token reuse detected; revoked family for user=${stale.userId} client=${stale.clientId}`);
      }
      throw new Error('invalid_grant: refresh token not found or expired');
    }
    if (existing.clientId !== client.client_id) {
      throw new Error('invalid_grant: refresh token issued to a different client');
    }

    // Scopes requested must be a subset of the originally granted scopes
    const grantedScopes = existing.scopes || [];
    const requestedScopes = scopes && scopes.length ? scopes : grantedScopes;
    for (const s of requestedScopes) {
      if (!grantedScopes.includes(s)) {
        throw new Error('invalid_scope: requested scope exceeds granted scope');
      }
    }

    // Rotate: revoke old refresh token and issue a new pair
    const newRefresh = await RefreshTokens.issue({
      userId: existing.userId,
      clientId: client.client_id,
      scopes: requestedScopes,
      replacesTokenId: existing._id
    });
    await RefreshTokens.revokeById(existing._id, newRefresh.tokenId);

    const access = await AccessTokens.issue({
      userId: existing.userId,
      clientId: client.client_id,
      scopes: requestedScopes
    });

    return {
      access_token: access.token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: newRefresh.token,
      scope: requestedScopes.join(' ')
    };
  }

  /**
   * Called by bearerAuth middleware (and by our /mcp handler).
   * Returns AuthInfo if valid, throws otherwise.
   */
  async verifyAccessToken(token) {
    const doc = await AccessTokens.find(token);
    if (!doc) throw new Error('invalid_token');
    return {
      token,
      clientId: doc.clientId,
      scopes: doc.scopes || [],
      expiresAt: Math.floor(doc.expiresAt.getTime() / 1000),
      extra: { userId: doc.userId }
    };
  }

  async revokeToken(client, request) {
    // request: { token, token_type_hint? }
    const { token, token_type_hint } = request;
    if (!token) return;

    // Scope revocation to the authenticating client (RFC 7009: the token must
    // have been issued to it). Honor the hint, else try both types.
    const clientId = client?.client_id || null;
    if (token_type_hint === 'refresh_token') {
      await RefreshTokens.revokeByValue(token, clientId);
      return;
    }
    if (token_type_hint === 'access_token') {
      await AccessTokens.revokeByValue(token, clientId);
      return;
    }
    await AccessTokens.revokeByValue(token, clientId);
    await RefreshTokens.revokeByValue(token, clientId);
  }
}

/** Helper: revoke everything the user granted to a client (used from profile revoke). */
export async function revokeAllForUserClient(userId, clientId) {
  await AccessTokens.revokeForClient(userId, clientId);
  await RefreshTokens.revokeForClient(userId, clientId);
  await Consents.revoke(userId, clientId);
}
