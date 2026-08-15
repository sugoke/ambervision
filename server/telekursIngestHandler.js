/**
 * Telekurs ingest endpoint mounted at POST /api/telekurs/quotes.
 *
 * Receives a JSON snapshot of OHLCV rows pushed from a VBA macro in a locally
 * live-updated Excel (Telekurs.xlsx) and upserts them into the `telekursQuotes`
 * collection, which backs the last-resort TelekursProvider in the market-data
 * chain (see imports/api/marketData/providers/telekursProvider.js).
 *
 * Auth: a shared secret in the `X-API-Key` header, compared (constant-time)
 * against Meteor.settings.private.TELEKURS_API_KEY.
 *
 * Body: { "quotes": [ { ticker, isin?, name?, currency?, date,
 *                       open?, high?, low?, close, volume? }, ... ] }
 *   - `ticker` MUST be the exchange-qualified fullTicker, e.g. "7203.TSE".
 */

import { WebApp } from 'meteor/webapp';
import { Meteor } from 'meteor/meteor';
import crypto from 'crypto';

import { TelekursQuotesHelpers } from '/imports/api/telekursQuotes';

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

// Generous cap for bulk price files, but bounded so a malformed/hostile body
// cannot buffer unbounded into RAM and OOM the process.
const MAX_BODY_BYTES = 16 * 1024 * 1024; // 16 MB

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
      req.destroy();
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

// Constant-time comparison that never throws on length mismatch.
function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

WebApp.connectHandlers.use('/api/telekurs/quotes', async (req, res) => {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
    res.statusCode = 204;
    return res.end();
  }

  if (method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
  }

  const expected = Meteor.settings.private?.TELEKURS_API_KEY;
  if (!expected) {
    console.error('[Telekurs] TELEKURS_API_KEY not configured in Meteor.settings.private');
    return sendJson(res, 503, { ok: false, error: 'endpoint_not_configured' });
  }

  const provided = req.headers['x-api-key'] || req.headers['X-API-Key'] || '';
  if (!secretsMatch(String(provided), String(expected))) {
    return sendJson(res, 401, { ok: false, error: 'invalid_api_key' });
  }

  let body;
  try {
    body = await readRequestBody(req);
  } catch (err) {
    if (err?.statusCode === 413) {
      return sendJson(res, 413, { ok: false, error: 'payload_too_large' });
    }
    return sendJson(res, 400, { ok: false, error: 'invalid_json' });
  }

  const quotes = body?.quotes;
  if (!Array.isArray(quotes)) {
    return sendJson(res, 400, { ok: false, error: 'quotes_must_be_array' });
  }

  try {
    const result = await TelekursQuotesHelpers.upsertQuotes(quotes);
    console.log(`[Telekurs] Ingest: received=${quotes.length} upserted=${result.upserted} skipped=${result.skipped}`);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (err) {
    console.error('[Telekurs] Ingest error:', err?.message || err);
    return sendJson(res, 500, { ok: false, error: 'ingest_failed' });
  }
});
