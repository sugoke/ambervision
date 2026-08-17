import { Meteor } from 'meteor/meteor';
import { WebApp } from 'meteor/webapp';

/**
 * Baseline security response headers on every HTTP response (Meteor 3 / webapp 2.x).
 *
 * The Content-Security-Policy is the primary defense-in-depth control for the
 * localStorage-stored session token (JS-readable by necessity in this DDP app):
 * `connect-src 'self' …` and `form-action 'self'` mean that even if an XSS ran, it
 * could not exfiltrate the token to an attacker-controlled origin (fetch/XHR/beacon/
 * websocket and form posts are constrained to same-origin + a tiny allowlist).
 *
 * Allowlist derived from an audit of the client bundle. `script-src`/`style-src`
 * need 'unsafe-inline' (Meteor's inline bootstrap + pervasive React inline styles);
 * 'unsafe-eval' is added ONLY in development (Meteor HMR uses eval — production does not).
 */
function buildCsp() {
  const scriptEval = Meteor.isDevelopment ? " 'unsafe-eval'" : '';
  return [
    "default-src 'self'",
    // GDPR: Chart.js, fonts and Font Awesome are self-hosted (public/vendor, public/fonts)
    // and counter.dev analytics was removed — no third-party script/style/font origins remain.
    `script-src 'self' 'unsafe-inline'${scriptEval}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https://amberlakepartners.com https://financialmodelingprep.com https://eodhistoricaldata.com",
    "connect-src 'self'",
    "frame-src 'self' blob: https://infine.eu.meteorapp.com",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

const CSP = buildCsp();

function applySecurityHeaders(req, res, next) {
  try {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-XSS-Protection', '0');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Content-Security-Policy', CSP);
  } catch (e) { /* never hang a request over a header */ }
  next();
}

Meteor.startup(() => {
  try { WebApp.rawConnectHandlers.use(applySecurityHeaders); } catch (e) { /* older API */ }
  try { WebApp.handlers.use(applySecurityHeaders); } catch (e) { /* older API */ }
  console.log('[SecurityHeaders] CSP + security headers registered');
});
