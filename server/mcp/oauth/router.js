/**
 * Hand-rolled OAuth 2.1 authorization-server endpoints.
 *
 * We don't use the MCP SDK's mcpAuthRouter — it has transitive deps
 * (pkce-challenge, express-rate-limit) whose ESM-with-conditional-exports
 * shape Meteor's bundler doesn't handle cleanly, causing MODULE_NOT_FOUND
 * in production bundles. All the SDK would do for us is wire Express
 * handlers to methods on an OAuthServerProvider — we can do that directly
 * and rely on Node's built-in crypto for PKCE verification (via
 * verifyPkceS256 in oauthAuthServer.js).
 *
 * Endpoints (mounted at ROOT_URL):
 *   GET  /.well-known/oauth-authorization-server
 *   GET  /.well-known/oauth-protected-resource/mcp
 *   GET  /authorize
 *   POST /token
 *   POST /register
 *   POST /revoke
 */

import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import express from 'express';

import {
  OauthClientStore,
  hashToken
} from '/imports/api/oauthAuthServer';
import { AmbervisionOAuthProvider } from './provider.js';

const ROOT_URL = process.env.ROOT_URL || 'http://localhost:3000';
const issuerUrl = ROOT_URL.replace(/\/+$/, '');
const resourceServerUrl = `${issuerUrl}/mcp`;

export const oauthProvider = new AmbervisionOAuthProvider();

const app = express();
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// CORS for well-known and token endpoints — OAuth clients may fetch these from arbitrary origins
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ----- Metadata ---------------------------------------------------------

app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: issuerUrl,
    authorization_endpoint: `${issuerUrl}/authorize`,
    token_endpoint: `${issuerUrl}/token`,
    registration_endpoint: `${issuerUrl}/register`,
    revocation_endpoint: `${issuerUrl}/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    scopes_supported: ['portfolio'],
    service_documentation: `${issuerUrl}/`
  });
});

app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
  res.json({
    resource: resourceServerUrl,
    authorization_servers: [issuerUrl],
    scopes_supported: ['portfolio'],
    resource_name: 'Ambervision MCP'
  });
});

// ----- Dynamic client registration (RFC 7591) --------------------------

app.post('/register', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' });
    }
    for (const uri of body.redirect_uris) {
      try { new URL(uri); } catch {
        return res.status(400).json({ error: 'invalid_redirect_uri', error_description: `Invalid redirect_uri: ${uri}` });
      }
    }
    const info = await OauthClientStore.registerClient(body);
    return res.status(201).json(info);
  } catch (err) {
    console.error('[OAuth /register] error:', err);
    return res.status(500).json({ error: 'server_error', error_description: String(err?.message || err) });
  }
});

// ----- Authorization ----------------------------------------------------

function redirectUriMatches(requested, registered) {
  if (requested === registered) return true;
  // Per RFC 8252 §7.3 — allow any port for loopback URIs
  try {
    const a = new URL(requested);
    const b = new URL(registered);
    const isLoopback = h => h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    if (isLoopback(a.hostname) && isLoopback(b.hostname)
        && a.protocol === b.protocol
        && a.pathname === b.pathname) {
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

async function redirectWithError(res, redirectUri, state, error, description) {
  try {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (description) url.searchParams.set('error_description', description);
    if (state) url.searchParams.set('state', state);
    return res.redirect(302, url.toString());
  } catch {
    return res.status(400).json({ error, error_description: description });
  }
}

app.get('/authorize', async (req, res) => {
  const {
    client_id, redirect_uri, response_type, code_challenge, code_challenge_method,
    state, scope, resource
  } = req.query;

  if (!client_id) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
  }
  const client = await OauthClientStore.getClient(String(client_id));
  if (!client) {
    return res.status(400).json({ error: 'invalid_client', error_description: 'Unknown client' });
  }
  if (!redirect_uri) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri required' });
  }
  const registered = (client.redirect_uris || []).some(u => redirectUriMatches(String(redirect_uri), u));
  if (!registered) {
    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri not registered for client' });
  }
  if (response_type !== 'code') {
    return redirectWithError(res, redirect_uri, state, 'unsupported_response_type', 'Only response_type=code is supported');
  }
  if (!code_challenge || (code_challenge_method && code_challenge_method !== 'S256')) {
    return redirectWithError(res, redirect_uri, state, 'invalid_request', 'PKCE S256 code_challenge is required');
  }

  const params = {
    state: state ? String(state) : undefined,
    scopes: scope ? String(scope).split(/\s+/).filter(Boolean) : [],
    codeChallenge: String(code_challenge),
    redirectUri: String(redirect_uri),
    resource: resource ? new URL(String(resource)) : undefined
  };

  try {
    await oauthProvider.authorize(client, params, res);
  } catch (err) {
    console.error('[OAuth /authorize] error:', err);
    return redirectWithError(res, redirect_uri, state, 'server_error', String(err?.message || err));
  }
});

// ----- Token ------------------------------------------------------------

async function authenticateClient(req) {
  // Accept client_secret_post, client_secret_basic, or public clients (no secret)
  const authHeader = req.headers.authorization || '';
  let clientId, clientSecret;

  if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx >= 0) {
      clientId = decodeURIComponent(decoded.slice(0, idx));
      clientSecret = decodeURIComponent(decoded.slice(idx + 1));
    }
  }
  if (!clientId && req.body) {
    clientId = req.body.client_id;
    clientSecret = req.body.client_secret;
  }
  if (!clientId) throw { status: 401, error: 'invalid_client', description: 'client_id required' };

  const client = await OauthClientStore.getClient(String(clientId));
  if (!client) throw { status: 401, error: 'invalid_client', description: 'Unknown client' };

  // Load raw doc to check secret (getClient returns a sanitized view)
  const { OauthClientsCollection } = await import('/imports/api/oauthAuthServer');
  const doc = await OauthClientsCollection.findOneAsync(clientId);
  if (!doc) throw { status: 401, error: 'invalid_client', description: 'Unknown client' };

  if (doc.tokenEndpointAuthMethod === 'none') {
    // Public client — no secret required
    return client;
  }
  if (!clientSecret) {
    throw { status: 401, error: 'invalid_client', description: 'client_secret required' };
  }
  if (!doc.clientSecretHash || hashToken(String(clientSecret)) !== doc.clientSecretHash) {
    throw { status: 401, error: 'invalid_client', description: 'Invalid client_secret' };
  }
  return client;
}

app.post('/token', async (req, res) => {
  try {
    const client = await authenticateClient(req);
    const { grant_type } = req.body || {};

    if (grant_type === 'authorization_code') {
      const { code, code_verifier, redirect_uri, resource } = req.body;
      if (!code || !code_verifier || !redirect_uri) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'code, code_verifier and redirect_uri required' });
      }
      const tokens = await oauthProvider.exchangeAuthorizationCode(
        client, code, code_verifier, redirect_uri, resource ? new URL(resource) : undefined
      );
      return res.status(200).json(tokens);
    }

    if (grant_type === 'refresh_token') {
      const { refresh_token, scope, resource } = req.body;
      if (!refresh_token) {
        return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token required' });
      }
      const scopes = scope ? String(scope).split(/\s+/).filter(Boolean) : undefined;
      const tokens = await oauthProvider.exchangeRefreshToken(
        client, refresh_token, scopes, resource ? new URL(resource) : undefined
      );
      return res.status(200).json(tokens);
    }

    return res.status(400).json({ error: 'unsupported_grant_type', error_description: `Unsupported grant_type: ${grant_type}` });
  } catch (err) {
    if (err && err.status && err.error) {
      return res.status(err.status).json({ error: err.error, error_description: err.description });
    }
    const msg = String(err?.message || err);
    const isInvalidGrant = /^invalid_grant/.test(msg);
    const isInvalidScope = /^invalid_scope/.test(msg);
    if (isInvalidGrant) return res.status(400).json({ error: 'invalid_grant', error_description: msg });
    if (isInvalidScope) return res.status(400).json({ error: 'invalid_scope', error_description: msg });
    console.error('[OAuth /token] error:', err);
    return res.status(500).json({ error: 'server_error', error_description: msg });
  }
});

// ----- Token revocation (RFC 7009) --------------------------------------

app.post('/revoke', async (req, res) => {
  try {
    const client = await authenticateClient(req);
    const { token, token_type_hint } = req.body || {};
    if (!token) return res.status(400).json({ error: 'invalid_request', error_description: 'token required' });
    await oauthProvider.revokeToken(client, { token, token_type_hint });
    return res.status(200).json({});
  } catch (err) {
    if (err && err.status && err.error) {
      return res.status(err.status).json({ error: err.error, error_description: err.description });
    }
    console.error('[OAuth /revoke] error:', err);
    return res.status(500).json({ error: 'server_error', error_description: String(err?.message || err) });
  }
});

// 404 JSON for any unmatched /.well-known/* so Meteor's static fallback doesn't serve HTML
app.use('/.well-known', (req, res) => res.status(404).json({ error: 'not_found' }));

// Hook into Meteor's connect stack at root
WebApp.connectHandlers.use(app);

Meteor.startup(() => {
  console.log(`[MCP OAuth] Authorization server ready: issuer=${issuerUrl}, resource=${resourceServerUrl}`);
});
