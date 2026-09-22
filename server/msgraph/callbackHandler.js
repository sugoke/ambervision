import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';
import { SessionsCollection } from '/imports/api/sessions';
import { AuditLog } from '/imports/api/auditLog';
import { createRateLimiter, clientIp } from '../mcp/rateLimit.js';
import { getGraphConfig, reportGraphStartupState, GRAPH_BASE } from './config.js';
import { consumeState, exchangeCode } from './oauth.js';
import { saveAccount } from './accountStore.js';

/**
 * OAuth redirect target: /auth/microsoft/callback?code=...&state=...
 *
 * This is the one place where a browser redirect has to be tied back to the
 * app's custom session model. `this.userId` is always null here and there is no
 * accounts-base, so the handler trusts nothing in the query string except an
 * opaque `state`, which it exchanges server-side for the userId recorded when
 * the flow began. The session token itself never travels through Microsoft.
 */

const callbackRateLimit = createRateLimiter({ max: 20 });

// Never echo anything user- or IdP-supplied into the response; redirect with a
// short fixed code and keep the detail in the server log.
const ERRORS = {
  denied: 'denied',
  invalid: 'invalid',
  expired: 'expired',
  session: 'session',
  failed: 'failed',
  ratelimited: 'ratelimited'
};

function redirect(res, target) {
  res.writeHead(302, { Location: target, 'Cache-Control': 'no-store' });
  res.end();
}

/**
 * Express strips the mount prefix from req.url inside a prefixed handler, so
 * `/auth/microsoft/callback?code=…` arrives as `/?code=…`. Only req.originalUrl
 * keeps the full path. Documented at server/documentAccess.js:80-93, where the
 * same trap 401'd every document download.
 */
function requestedUrl(req) {
  if (req.originalUrl) return req.originalUrl;
  const base = req.baseUrl || '';
  return `${base}${req.url || ''}` || '/';
}

WebApp.connectHandlers.use('/auth/microsoft/callback', async (req, res, next) => {
  const config = getGraphConfig();
  if (!config.isConfigured) return next();

  let returnTo = '/profile';

  try {
    if (!callbackRateLimit(clientIp(req))) {
      return redirect(res, `${returnTo}?mailError=${ERRORS.ratelimited}`);
    }

    const url = new URL(requestedUrl(req), process.env.ROOT_URL || 'http://localhost:3000');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const idpError = url.searchParams.get('error');

    // Validate state BEFORE looking at anything else, so a forged callback is
    // rejected without touching the token endpoint.
    const stateDoc = state ? await consumeState(state) : null;
    if (stateDoc?.returnTo) returnTo = stateDoc.returnTo;

    if (idpError) {
      console.warn(`[MSGraph] Authorization declined at Microsoft: ${idpError} — ${url.searchParams.get('error_description') || ''}`);
      return redirect(res, `${returnTo}?mailError=${ERRORS.denied}`);
    }
    if (!stateDoc) {
      console.warn('[MSGraph] Callback with unknown, replayed or expired state');
      return redirect(res, `${returnTo}?mailError=${ERRORS.invalid}`);
    }
    if (stateDoc.expiresAt && stateDoc.expiresAt.getTime() < Date.now()) {
      return redirect(res, `${returnTo}?mailError=${ERRORS.expired}`);
    }
    if (!code) {
      return redirect(res, `${returnTo}?mailError=${ERRORS.invalid}`);
    }

    // The session that started the flow must still be alive and still belong to
    // the same user — otherwise a connection could be bound to a logged-out or
    // reassigned account.
    const session = await SessionsCollection.findOneAsync({
      sessionId: stateDoc.sessionTokenHash,
      isActive: true
    });
    if (!session || session.userId !== stateDoc.userId ||
        (session.expiresAt && session.expiresAt.getTime() < Date.now())) {
      console.warn(`[MSGraph] Callback for user ${stateDoc.userId} but the originating session is gone or mismatched`);
      return redirect(res, `${returnTo}?mailError=${ERRORS.session}`);
    }

    const tokens = await exchangeCode({ code, codeVerifier: stateDoc.codeVerifier });

    const meResponse = await fetch(`${GRAPH_BASE}/me?$select=id,displayName,mail,userPrincipalName`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    if (!meResponse.ok) {
      throw new Error(`Graph /me returned ${meResponse.status}`);
    }
    const profile = await meResponse.json();

    await saveAccount({
      userId: stateDoc.userId,
      tokens,
      profile,
      tenantId: config.tenantId
    });

    AuditLog.record({
      actorUserId: stateDoc.userId,
      action: 'msgraph.connect',
      targetType: 'user',
      targetId: stateDoc.userId,
      meta: { mailbox: profile?.mail || profile?.userPrincipalName || null }
    });

    console.log(`[MSGraph] Mailbox connected for user ${stateDoc.userId}: ${profile?.mail || profile?.userPrincipalName}`);
    return redirect(res, `${returnTo}?mail=connected`);
  } catch (err) {
    console.error('[MSGraph] Callback failed:', err && err.message);
    return redirect(res, `${returnTo}?mailError=${ERRORS.failed}`);
  }
});

Meteor.startup(() => {
  reportGraphStartupState();
});
