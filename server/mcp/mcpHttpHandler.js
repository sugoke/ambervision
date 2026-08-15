/**
 * MCP Streamable HTTP endpoint mounted at /mcp.
 *
 * Auth: bearer token from the Authorization header, validated against
 * McpApiTokensCollection. Each request gets a fresh McpServer instance
 * bound to the authenticated user (stateless transport).
 *
 * Rate limit: simple in-memory rolling window, 120 requests / minute / token.
 */

import { WebApp } from 'meteor/webapp';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/dist/cjs/server/streamableHttp.js';

import { McpTokenHelpers, MCP_TOKEN_PREFIX } from '/imports/api/mcpApiTokens';
import { UsersCollection } from '/imports/api/users';
import { buildMcpServer } from './mcpServer.js';
import { oauthProvider } from './oauth/router.js';
import { createRateLimiter, clientIp } from './rateLimit.js';

// Pre-auth throttle keyed on IP: caps the cost of unauthenticated request
// floods (each attempt is a token-hash DB lookup) before any validation runs.
const ipRateLimit = createRateLimiter({ max: 300 });
// Post-auth throttle keyed on the USER, not the token — otherwise a user could
// mint N tokens for N× the ceiling.
const userRateLimit = createRateLimiter({ max: 120 });

// DNS-rebinding defense for the MCP transport: validate Host and Origin.
// Derived from ROOT_URL, plus loopback (dev) and the connector origins.
const MCP_ROOT_URL = (process.env.ROOT_URL || 'http://localhost:3000').replace(/\/+$/, '');
const MCP_ALLOWED_HOSTS = (() => {
  const hosts = ['localhost:3000', 'localhost', '127.0.0.1:3000', '127.0.0.1'];
  try { hosts.push(new URL(MCP_ROOT_URL).host); } catch { /* ignore */ }
  return [...new Set(hosts)];
})();
const MCP_ALLOWED_ORIGINS = new Set([
  MCP_ROOT_URL,
  'https://claude.ai',
  'https://claude.com',
  ...String(process.env.MCP_CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)
]);
// ACAO value for a request: echo the Origin only when allowlisted (bearer auth,
// no cookies, so this is defense-in-depth rather than the primary control).
function acaoFor(req) {
  const origin = req.headers?.origin;
  return origin && MCP_ALLOWED_ORIGINS.has(origin) ? origin : null;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB — MCP JSON-RPC payloads are tiny

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(req.body);
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (statusCode, message) => {
      if (done) return;
      done = true;
      const err = new Error(message);
      err.statusCode = statusCode;
      req.destroy();          // stop reading — do not buffer a multi-GB body into RAM
      reject(err);
    };
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) return fail(413, 'request body too large');
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try { resolve(JSON.parse(raw)); } catch (err) { reject(err); }
    });
    req.on('error', (err) => { if (!done) { done = true; reject(err); } });
  });
}

WebApp.connectHandlers.use('/mcp', async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();

  // CORS preflight — echo an allowlisted Origin instead of a wildcard.
  if (method === 'OPTIONS') {
    const acao = acaoFor(req);
    if (acao) {
      res.setHeader('Access-Control-Allow-Origin', acao);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Last-Event-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    res.statusCode = 204;
    return res.end();
  }

  // Pre-auth IP throttle — runs BEFORE token validation so failed-auth floods
  // (and the DB lookups they trigger) are bounded, not just successful calls.
  if (!ipRateLimit(clientIp(req))) {
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  // Extract bearer token
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const rawToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  // Point Claude.ai at the protected resource metadata so it knows where to do OAuth
  const rootUrl = (process.env.ROOT_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const resourceMetadataUrl = `${rootUrl}/.well-known/oauth-protected-resource/mcp`;
  const wwwAuth = (err) =>
    `Bearer realm="ambervision-mcp", resource_metadata="${resourceMetadataUrl}"${err ? `, error="${err}"` : ''}`;

  if (!rawToken) {
    res.setHeader('WWW-Authenticate', wwwAuth());
    return sendJson(res, 401, { error: 'missing_bearer_token' });
  }

  // Two token flavors are accepted:
  //   1. amvs_<…>           personal long-lived token from the profile page
  //   2. amvs_at_<…>        OAuth 2.1 access token issued via /authorize + /token
  let validation = null;
  try {
    if (rawToken.startsWith('amvs_at_')) {
      const authInfo = await oauthProvider.verifyAccessToken(rawToken);
      const userId = authInfo.extra?.userId;
      if (!userId) throw new Error('invalid_token');
      const user = await UsersCollection.findOneAsync(userId);
      if (!user) throw new Error('invalid_token');
      // Capture the granted scopes so the 'portfolio' scope shown on the consent
      // screen is actually enforced (below), not decorative.
      validation = { user, tokenDoc: { _id: `oauth:${authInfo.clientId}:${userId}` }, isOAuth: true, scopes: authInfo.scopes || [] };
    } else if (rawToken.startsWith(MCP_TOKEN_PREFIX)) {
      // Personal tokens are full-access by design (the user's own token for
      // their own use) — no scope model applies.
      validation = await McpTokenHelpers.validate(rawToken);
    }
  } catch (err) {
    console.error('[MCP] Token validation error:', err?.message || err);
  }

  if (!validation) {
    res.setHeader('WWW-Authenticate', wwwAuth('invalid_token'));
    return sendJson(res, 401, { error: 'invalid_token' });
  }

  // Enforce the OAuth scope. Every tool requires the 'portfolio' scope; a token
  // granted without it gets nothing (RFC 6750 insufficient_scope). Currently a
  // single scope gates the whole surface — when a narrower/second scope is
  // added, extend this into per-tool checks in mcpServer/tools.
  if (validation.isOAuth && !(validation.scopes || []).includes('portfolio')) {
    res.setHeader('WWW-Authenticate', `${wwwAuth('insufficient_scope')}, scope="portfolio"`);
    return sendJson(res, 403, { error: 'insufficient_scope' });
  }

  if (!userRateLimit(validation.user._id)) {
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  const acao = acaoFor(req);
  if (acao) {
    res.setHeader('Access-Control-Allow-Origin', acao);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  let body;
  try {
    body = await readRequestBody(req);
  } catch (err) {
    if (err?.statusCode === 413) {
      return sendJson(res, 413, { error: 'payload_too_large' });
    }
    return sendJson(res, 400, { error: 'invalid_json' });
  }

  const startedAt = Date.now();
  const mcpServer = buildMcpServer(validation.user);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    // DNS-rebinding protection (the MCP spec's countermeasure): reject requests
    // whose Host/Origin are not ours. Bearer-only auth means no ambient
    // credentials, but this closes the spec gap.
    enableDnsRebindingProtection: true,
    allowedHosts: MCP_ALLOWED_HOSTS,
    allowedOrigins: [...MCP_ALLOWED_ORIGINS]
  });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error('[MCP] Request handling error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'mcp_internal_error' });
    }
  } finally {
    const ms = Date.now() - startedAt;
    // Light audit — single-line
    const logBody = body && typeof body === 'object' ? {
      jsonrpcMethod: body.method,
      toolName: body.params?.name
    } : {};
    console.log(`[MCP] ${method} user=${validation.user._id} role=${validation.user.role} ${ms}ms ${JSON.stringify(logBody)}`);
    try { await transport.close?.(); } catch (e) { /* ignore */ }
    try { await mcpServer.close?.(); } catch (e) { /* ignore */ }
  }
});
