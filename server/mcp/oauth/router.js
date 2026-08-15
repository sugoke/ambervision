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
import { createRateLimiter, clientIp } from '../rateLimit.js';

const ROOT_URL = process.env.ROOT_URL || 'http://localhost:3000';
const issuerUrl = ROOT_URL.replace(/\/+$/, '');
const resourceServerUrl = `${issuerUrl}/mcp`;

// The only scope this resource server understands. Advertised in metadata,
// defaulted at /authorize, and enforced at /mcp.
const SUPPORTED_SCOPES = ['portfolio'];

export const oauthProvider = new AmbervisionOAuthProvider();

const app = express();

// This express app is mounted at the ROOT of Meteor's connect stack
// (WebApp.connectHandlers.use(app) below), so it observes EVERY request in the
// application, not just OAuth ones. Its middleware must therefore be a strict
// no-op for anything that is not an OAuth endpoint — otherwise wildcard CORS
// leaks onto the SPA and the document endpoints, every app-wide OPTIONS is
// hijacked with a 204, and the body parsers consume the request stream before
// downstream handlers (e.g. /mcp) ever see it.
const OAUTH_PATH_PREFIXES = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/authorize',
  '/token',
  '/register',
  '/revoke'
];
function isOAuthRequest(req) {
  const path = (req.url || '').split('?')[0];
  return OAUTH_PATH_PREFIXES.some(p => path === p || path.startsWith(p + '/'));
}

// CORS scoped to OAuth endpoints, with an origin allowlist instead of `*`.
// These endpoints are either public metadata or body-authenticated (no cookies),
// so CORS is only needed for browser-based discovery from the connector's origin.
// Extra origins can be added via MCP_CORS_ORIGINS (comma-separated).
const ALLOWED_CORS_ORIGINS = new Set([
  'https://claude.ai',
  'https://claude.com',
  ...String(process.env.MCP_CORS_ORIGINS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
]);

app.use((req, res, next) => {
  if (!isOAuthRequest(req)) return next();
  const origin = req.headers.origin;
  if (origin && ALLOWED_CORS_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Per-IP throttle on the OAuth endpoints — none were rate-limited, so
// /register (unbounded inserts), /token (guessing/CPU load) and /authorize
// (pending-request inserts) could be hammered freely. 60/min/IP is generous
// for a real consent flow (a handful of requests) but caps abuse.
const oauthIpRateLimit = createRateLimiter({ max: 60 });
app.use((req, res, next) => {
  if (!isOAuthRequest(req)) return next();
  if (!oauthIpRateLimit(clientIp(req))) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  next();
});

// Body parsing, also scoped to OAuth endpoints so it never consumes another
// handler's request stream.
const jsonParser = express.json({ limit: '512kb' });
const urlencodedParser = express.urlencoded({ extended: true, limit: '512kb' });
app.use((req, res, next) => {
  if (!isOAuthRequest(req)) return next();
  jsonParser(req, res, (err) => (err ? next(err) : urlencodedParser(req, res, next)));
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

// Registration is open (claude.ai registers itself via DCR), but a registered
// redirect_uri is where an authorization code is delivered — so an attacker who
// can register an arbitrary redirect host can complete the consent-phishing →
// code-exfiltration chain. We therefore constrain redirect_uris to an allowlist
// of hosts (claude.ai/claude.com + loopback, extendable via env) over https.
// An attacker cannot receive a code at a host they don't control, which defuses
// the phishing chain regardless of the display name shown on the consent screen.
const ALLOWED_REDIRECT_HOSTS = new Set([
  'claude.ai',
  'claude.com',
  'anthropic.com',
  ...String(process.env.MCP_ALLOWED_REDIRECT_HOSTS || '')
    .split(',').map(s => s.trim()).filter(Boolean)
]);
function isLoopbackHost(h) {
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}
function validateRedirectUri(uri) {
  if (typeof uri !== 'string' || uri.length > 2048) return 'malformed';
  let u;
  try { u = new URL(uri); } catch { return 'malformed'; }
  if (isLoopbackHost(u.hostname)) {
    return (u.protocol === 'http:' || u.protocol === 'https:') ? null : 'scheme';
  }
  if (u.protocol !== 'https:') return 'https_required';
  const host = u.hostname.toLowerCase();
  const ok = [...ALLOWED_REDIRECT_HOSTS].some(a => host === a || host.endsWith('.' + a));
  return ok ? null : 'host_not_allowed';
}

app.post('/register', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0) {
      return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' });
    }
    if (body.redirect_uris.length > 5) {
      return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'too many redirect_uris' });
    }
    for (const uri of body.redirect_uris) {
      if (validateRedirectUri(uri) !== null) {
        // Do not echo the rejected URI back — keep the error generic.
        return res.status(400).json({ error: 'invalid_redirect_uri', error_description: 'redirect_uri not permitted' });
      }
    }
    // Cap attacker-controlled string fields before they are stored and later
    // rendered on the consent screen.
    const clean = { ...body };
    if (clean.client_name != null) clean.client_name = String(clean.client_name).slice(0, 100);
    if (clean.client_uri != null) clean.client_uri = String(clean.client_uri).slice(0, 2048);
    if (clean.logo_uri != null) clean.logo_uri = String(clean.logo_uri).slice(0, 2048);
    const info = await OauthClientStore.registerClient(clean);
    return res.status(201).json(info);
  } catch (err) {
    console.error('[OAuth /register] error:', err);
    return res.status(500).json({ error: 'server_error' });
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
    // RFC 8252 §7.3: for loopback only the PORT may vary. Host, path and query
    // must match exactly — don't cross localhost/127.0.0.1 and don't ignore the
    // query string.
    if (isLoopback(a.hostname) && isLoopback(b.hostname)
        && a.hostname === b.hostname
        && a.protocol === b.protocol
        && a.pathname === b.pathname
        && a.search === b.search) {
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

  // Validate requested scopes against what we support, and default to the sole
  // 'portfolio' scope when none is requested. The issued token is enforced to
  // carry 'portfolio' at /mcp, so this keeps legit clients working while making
  // the scope real. A request for only unsupported scopes is rejected.
  const requestedScopes = scope ? String(scope).split(/\s+/).filter(Boolean) : [];
  const grantedScopes = requestedScopes.length
    ? requestedScopes.filter(s => SUPPORTED_SCOPES.includes(s))
    : ['portfolio'];
  if (requestedScopes.length && grantedScopes.length === 0) {
    return redirectWithError(res, redirect_uri, state, 'invalid_scope', 'unsupported scope');
  }

  const params = {
    state: state ? String(state) : undefined,
    scopes: grantedScopes,
    codeChallenge: String(code_challenge),
    redirectUri: String(redirect_uri),
    resource: resource ? new URL(String(resource)) : undefined
  };

  try {
    await oauthProvider.authorize(client, params, res);
  } catch (err) {
    console.error('[OAuth /authorize] error:', err);
    // Never echo internal error text into the redirect URL — it lands in the
    // (attacker-controllable) client's logs.
    return redirectWithError(res, redirect_uri, state, 'server_error', 'internal error');
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
  // RFC 6749 §5.1 — token responses must never be cached.
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
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
    // Classify by the provider's error prefixes, but return FIXED descriptions —
    // never echo the internal message (which can carry PKCE/redirect/Mongo detail).
    if (/^invalid_grant/.test(msg)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'invalid or expired authorization grant' });
    }
    if (/^invalid_scope/.test(msg)) {
      return res.status(400).json({ error: 'invalid_scope', error_description: 'requested scope is invalid' });
    }
    console.error('[OAuth /token] error:', err);
    return res.status(500).json({ error: 'server_error' });
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
    return res.status(500).json({ error: 'server_error' });
  }
});

// 404 JSON for any unmatched /.well-known/* so Meteor's static fallback doesn't serve HTML
app.use('/.well-known', (req, res) => res.status(404).json({ error: 'not_found' }));

// Hook into Meteor's connect stack at root
WebApp.connectHandlers.use(app);

Meteor.startup(() => {
  // Fail fast in production: if ROOT_URL is unset or non-https, every OAuth
  // endpoint (issuer, authorize, token, resource metadata, WWW-Authenticate)
  // advertises localhost/http, silently pointing clients at the wrong or an
  // insecure authorization server.
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ROOT_URL) {
      throw new Error('[MCP OAuth] ROOT_URL must be set in production (it drives every OAuth endpoint URL).');
    }
    if (!/^https:\/\//i.test(process.env.ROOT_URL)) {
      throw new Error(`[MCP OAuth] ROOT_URL must be https in production, got: ${process.env.ROOT_URL}`);
    }
  }
  console.log(`[MCP OAuth] Authorization server ready: issuer=${issuerUrl}, resource=${resourceServerUrl}`);
});
