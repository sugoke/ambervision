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

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120;
const rateBuckets = new Map(); // tokenId -> Array<timestamp>

function checkRateLimit(tokenId) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const bucket = rateBuckets.get(tokenId) || [];
  const recent = bucket.filter(ts => ts > windowStart);
  if (recent.length >= RATE_LIMIT_MAX) {
    rateBuckets.set(tokenId, recent);
    return false;
  }
  recent.push(now);
  rateBuckets.set(tokenId, recent);
  return true;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) return resolve(req.body);
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

WebApp.connectHandlers.use('/mcp', async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();

  // CORS preflight — Claude Desktop hits from its own origin
  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Last-Event-Id');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    res.statusCode = 204;
    return res.end();
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
  let rateLimitKey = null;
  try {
    if (rawToken.startsWith('amvs_at_')) {
      const authInfo = await oauthProvider.verifyAccessToken(rawToken);
      const userId = authInfo.extra?.userId;
      if (!userId) throw new Error('invalid_token');
      const user = await UsersCollection.findOneAsync(userId);
      if (!user) throw new Error('invalid_token');
      validation = { user, tokenDoc: { _id: `oauth:${authInfo.clientId}:${userId}` } };
      rateLimitKey = validation.tokenDoc._id;
    } else if (rawToken.startsWith(MCP_TOKEN_PREFIX)) {
      validation = await McpTokenHelpers.validate(rawToken);
      if (validation) rateLimitKey = validation.tokenDoc._id;
    }
  } catch (err) {
    console.error('[MCP] Token validation error:', err?.message || err);
  }

  if (!validation) {
    res.setHeader('WWW-Authenticate', wwwAuth('invalid_token'));
    return sendJson(res, 401, { error: 'invalid_token' });
  }

  if (!checkRateLimit(rateLimitKey)) {
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');

  let body;
  try {
    body = await readRequestBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: 'invalid_json', detail: err.message });
  }

  const startedAt = Date.now();
  const mcpServer = buildMcpServer(validation.user);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error('[MCP] Request handling error:', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'mcp_internal_error', detail: String(err?.message || err) });
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
