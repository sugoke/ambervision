/**
 * OAuth 2.1 authorization-server state.
 *
 * This is what Claude.ai's custom-connector web UI relies on (no header / bearer
 * field available). Users are redirected to our /oauth/authorize, sign in on our
 * domain, approve the connector, and Claude.ai receives a short-lived access
 * token — never a long-lived secret.
 *
 * Token values are never stored raw; only SHA-256 hashes. Auth codes and refresh
 * tokens are single-use / rotating.
 */

import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import crypto from 'crypto';

export const OauthClientsCollection         = new Mongo.Collection('oauthClients');
export const OauthPendingRequestsCollection = new Mongo.Collection('oauthPendingRequests');
export const OauthAccessTokensCollection    = new Mongo.Collection('oauthAccessTokens');
export const OauthRefreshTokensCollection   = new Mongo.Collection('oauthRefreshTokens');
export const OauthConsentsCollection        = new Mongo.Collection('oauthConsents');

// Token value prefixes — recognizable in logs/UI, distinct from the amvs_ personal tokens
export const OAUTH_ACCESS_TOKEN_PREFIX  = 'amvs_at_';
export const OAUTH_REFRESH_TOKEN_PREFIX = 'amvs_rt_';
export const OAUTH_AUTH_CODE_PREFIX     = 'amvs_ac_';
export const OAUTH_CLIENT_SECRET_PREFIX = 'amvs_cs_';

// Lifetimes
export const ACCESS_TOKEN_TTL_SECONDS  = 60 * 60;            // 1h
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;  // 30d
export const AUTH_CODE_TTL_SECONDS     = 10 * 60;            // 10m
export const PENDING_REQUEST_TTL_SECONDS = 10 * 60;          // 10m

if (Meteor.isServer) {
  OauthClientsCollection.createIndex({ _id: 1 });

  OauthPendingRequestsCollection.createIndex({ authCodeHash: 1 });

  OauthAccessTokensCollection.createIndex({ tokenHash: 1 }, { unique: true });
  OauthAccessTokensCollection.createIndex({ userId: 1, clientId: 1 });

  OauthRefreshTokensCollection.createIndex({ tokenHash: 1 }, { unique: true });
  OauthRefreshTokensCollection.createIndex({ userId: 1, clientId: 1 });

  OauthConsentsCollection.createIndex({ userId: 1, clientId: 1 }, { unique: true });

  // TTL indexes so expired pending requests, access and refresh tokens are
  // reaped by Mongo instead of accumulating forever (there was no sweeper).
  // expireAfterSeconds:0 means "delete once now > expiresAt". A refresh token's
  // expiresAt is its 30-day expiry, so a revoked-but-unexpired token still
  // survives for reuse detection (H-5) until it would have expired anyway.
  //
  // Deferred to Meteor.startup and fully guarded: rawCollection() needs the DB
  // connection, and on a DB that already has a plain { expiresAt: 1 } index
  // Mongo rejects adding TTL options to the same key (drop the old index once
  // for the TTL to take effect). Neither must ever crash server startup.
  Meteor.startup(async () => {
    const ttl = async (coll, label) => {
      try {
        await coll.rawCollection().createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      } catch (e) {
        console.warn(`[OAuth] TTL index on ${label}: ${e?.message || e}`);
      }
    };
    await ttl(OauthPendingRequestsCollection, 'oauthPendingRequests');
    await ttl(OauthAccessTokensCollection, 'oauthAccessTokens');
    await ttl(OauthRefreshTokensCollection, 'oauthRefreshTokens');
  });
}

export function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateOpaqueToken(prefix, entropyChars = 40) {
  return `${prefix}${Random.id(entropyChars)}`;
}

/**
 * Verify a PKCE code_verifier against a stored code_challenge (S256 only).
 */
export function verifyPkceS256(codeVerifier, codeChallenge) {
  if (!codeVerifier || !codeChallenge) return false;
  const hash = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    // base64url, no padding
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return hash === codeChallenge;
}

// ---------- Client store ------------------------------------------------

export const OauthClientStore = {
  async getClient(clientId) {
    if (!clientId) return undefined;
    const doc = await OauthClientsCollection.findOneAsync(clientId);
    if (!doc) return undefined;
    return reconstructClientInfo(doc);
  },

  async registerClient(info) {
    // info is OAuthClientInformationFull minus client_id / client_id_issued_at
    const clientId = Random.id(24);
    const now = Math.floor(Date.now() / 1000);

    const wantsSecret = !info.token_endpoint_auth_method || info.token_endpoint_auth_method !== 'none';
    let clientSecret = null;
    let clientSecretHash = null;
    if (wantsSecret) {
      clientSecret = generateOpaqueToken(OAUTH_CLIENT_SECRET_PREFIX, 40);
      clientSecretHash = hashToken(clientSecret);
    }

    const doc = {
      _id: clientId,
      clientName: info.client_name || 'Unknown client',
      clientUri: info.client_uri || null,
      logoUri: info.logo_uri || null,
      redirectUris: info.redirect_uris || [],
      grantTypes: info.grant_types || ['authorization_code', 'refresh_token'],
      responseTypes: info.response_types || ['code'],
      tokenEndpointAuthMethod: info.token_endpoint_auth_method || 'client_secret_basic',
      scope: info.scope || 'portfolio',
      clientSecretHash,
      clientSecretExpiresAt: null, // never expires
      createdAt: new Date(),
      clientIdIssuedAt: now
    };

    await OauthClientsCollection.insertAsync(doc);

    // Return OAuthClientInformationFull shape (include plaintext secret ONCE)
    return {
      client_id: clientId,
      client_id_issued_at: now,
      client_secret: clientSecret || undefined,
      client_secret_expires_at: 0,
      client_name: doc.clientName,
      client_uri: doc.clientUri || undefined,
      logo_uri: doc.logoUri || undefined,
      redirect_uris: doc.redirectUris,
      grant_types: doc.grantTypes,
      response_types: doc.responseTypes,
      token_endpoint_auth_method: doc.tokenEndpointAuthMethod,
      scope: doc.scope
    };
  }
};

function reconstructClientInfo(doc) {
  return {
    client_id: doc._id,
    client_id_issued_at: doc.clientIdIssuedAt,
    client_secret: doc.clientSecretHash ? '__redacted__' : undefined, // never return real secret
    client_secret_expires_at: 0,
    client_name: doc.clientName,
    client_uri: doc.clientUri || undefined,
    logo_uri: doc.logoUri || undefined,
    redirect_uris: doc.redirectUris,
    grant_types: doc.grantTypes,
    response_types: doc.responseTypes,
    token_endpoint_auth_method: doc.tokenEndpointAuthMethod,
    scope: doc.scope
  };
}

// ---------- Pending authorization requests ------------------------------

export const PendingRequests = {
  async create({ clientId, redirectUri, codeChallenge, codeChallengeMethod, scopes, state, resource }) {
    const now = new Date();
    const doc = {
      _id: Random.id(24),
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: codeChallengeMethod || 'S256',
      scopes: scopes || [],
      state: state || null,
      resource: resource ? String(resource) : null,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + PENDING_REQUEST_TTL_SECONDS * 1000),
      approvedByUserId: null,
      authCodeHash: null,
      authCodeExpiresAt: null,
      authCodeUsed: false
    };
    await OauthPendingRequestsCollection.insertAsync(doc);
    return doc;
  },

  async find(reqId) {
    const doc = await OauthPendingRequestsCollection.findOneAsync(reqId);
    if (!doc) return null;
    if (doc.expiresAt && doc.expiresAt.getTime() < Date.now()) return null;
    return doc;
  },

  async approve(reqId, userId) {
    const authCode = generateOpaqueToken(OAUTH_AUTH_CODE_PREFIX, 40);
    const authCodeHash = hashToken(authCode);
    const authCodeExpiresAt = new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000);

    const updated = await OauthPendingRequestsCollection.updateAsync(
      { _id: reqId, status: 'pending' },
      {
        $set: {
          status: 'approved',
          approvedByUserId: userId,
          authCodeHash,
          authCodeExpiresAt,
          authCodeUsed: false
        }
      }
    );
    if (updated === 0) throw new Error('Authorization request not found or already processed');
    return { authCode };
  },

  async deny(reqId) {
    await OauthPendingRequestsCollection.updateAsync(
      { _id: reqId, status: 'pending' },
      { $set: { status: 'denied' } }
    );
  },

  async findByAuthCode(authCode) {
    if (!authCode) return null;
    const authCodeHash = hashToken(authCode);
    const doc = await OauthPendingRequestsCollection.findOneAsync({ authCodeHash });
    if (!doc) return null;
    if (doc.authCodeExpiresAt && doc.authCodeExpiresAt.getTime() < Date.now()) return null;
    // NOTE: returns the doc even when authCodeUsed — the caller consumes it
    // atomically (consumeAuthCode) and treats an already-used code as a replay.
    // Filtering used codes here would make replay indistinguishable from
    // not-found and silently skip token revocation.
    return doc;
  },

  // Atomically claim an unused auth code. Returns true only for the single
  // caller that flips authCodeUsed false→true; concurrent/replayed exchanges
  // get false. This closes the read-check-write double-spend window.
  async consumeAuthCode(reqId) {
    const n = await OauthPendingRequestsCollection.updateAsync(
      { _id: reqId, authCodeUsed: false },
      { $set: { authCodeUsed: true, authCodeUsedAt: new Date() } }
    );
    return n === 1;
  }
};

// ---------- Access tokens ----------------------------------------------

export const AccessTokens = {
  async issue({ userId, clientId, scopes }) {
    const raw = generateOpaqueToken(OAUTH_ACCESS_TOKEN_PREFIX, 40);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000);
    await OauthAccessTokensCollection.insertAsync({
      tokenHash: hashToken(raw),
      userId,
      clientId,
      scopes: scopes || [],
      createdAt: now,
      expiresAt,
      revokedAt: null
    });
    return { token: raw, expiresAt };
  },

  async find(rawToken) {
    if (!rawToken) return null;
    const doc = await OauthAccessTokensCollection.findOneAsync({ tokenHash: hashToken(rawToken) });
    if (!doc) return null;
    if (doc.revokedAt) return null;
    if (doc.expiresAt.getTime() < Date.now()) return null;
    return doc;
  },

  async revokeForClient(userId, clientId) {
    await OauthAccessTokensCollection.updateAsync(
      { userId, clientId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { multi: true }
    );
  },

  async revokeByValue(rawToken, clientId = null) {
    const selector = { tokenHash: hashToken(rawToken), revokedAt: null };
    // Scope revocation to the requesting client so one client cannot revoke
    // another's token merely by learning its value.
    if (clientId) selector.clientId = clientId;
    await OauthAccessTokensCollection.updateAsync(selector, { $set: { revokedAt: new Date() } });
  }
};

// ---------- Refresh tokens ---------------------------------------------

export const RefreshTokens = {
  async issue({ userId, clientId, scopes, replacesTokenId = null }) {
    const raw = generateOpaqueToken(OAUTH_REFRESH_TOKEN_PREFIX, 40);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000);
    const _id = await OauthRefreshTokensCollection.insertAsync({
      tokenHash: hashToken(raw),
      userId,
      clientId,
      scopes: scopes || [],
      createdAt: now,
      expiresAt,
      revokedAt: null,
      replacedBy: null,
      replacesTokenId
    });
    return { token: raw, tokenId: _id, expiresAt };
  },

  async find(rawToken) {
    if (!rawToken) return null;
    const doc = await OauthRefreshTokensCollection.findOneAsync({ tokenHash: hashToken(rawToken) });
    if (!doc) return null;
    if (doc.revokedAt) return null;
    if (doc.expiresAt.getTime() < Date.now()) return null;
    return doc;
  },

  // Look up a refresh token regardless of its revoked/expired state. Used only
  // for reuse detection: a presented token that exists but is already revoked
  // is a replay of a rotated token, and the whole family must be torn down.
  async findAnyByValue(rawToken) {
    if (!rawToken) return null;
    return OauthRefreshTokensCollection.findOneAsync({ tokenHash: hashToken(rawToken) });
  },

  async revokeById(tokenId, replacedBy = null) {
    await OauthRefreshTokensCollection.updateAsync(
      { _id: tokenId, revokedAt: null },
      { $set: { revokedAt: new Date(), replacedBy } }
    );
  },

  async revokeByValue(rawToken, clientId = null) {
    const selector = { tokenHash: hashToken(rawToken), revokedAt: null };
    if (clientId) selector.clientId = clientId;
    await OauthRefreshTokensCollection.updateAsync(selector, { $set: { revokedAt: new Date() } });
  },

  async revokeForClient(userId, clientId) {
    await OauthRefreshTokensCollection.updateAsync(
      { userId, clientId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
      { multi: true }
    );
  }
};

// ---------- Consent records --------------------------------------------

export const Consents = {
  async record({ userId, clientId, scopes }) {
    await OauthConsentsCollection.upsertAsync(
      { userId, clientId },
      {
        $set: {
          userId,
          clientId,
          scopes: scopes || [],
          consentedAt: new Date(),
          revokedAt: null
        }
      }
    );
  },

  async listForUser(userId) {
    return await OauthConsentsCollection.find({ userId, revokedAt: null }).fetchAsync();
  },

  async revoke(userId, clientId) {
    await OauthConsentsCollection.updateAsync(
      { userId, clientId },
      { $set: { revokedAt: new Date() } }
    );
  }
};
