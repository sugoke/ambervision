import { SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { findUserByPdfAccessToken } from './pdfAccessTokens.js';

/**
 * Authorises a viewer of product-level data (evaluation reports, chart data,
 * schedules, product commentary). These feeds were previously published to ANY
 * DDP connection with no authentication, leaking the firm's structured-product
 * book (ISINs, evaluations) to anyone.
 *
 * Two legitimate callers exist:
 *   1. A normal logged-in user — a real hashed session token.
 *   2. The headless PDF renderer — which cannot hold a real session and instead
 *      passes a synthetic `pdf-temp-<pdfToken>` string, where <pdfToken> is a
 *      short-lived capability stored on user.services.pdfAccess.token.
 *
 * Returns true if either path validates, false otherwise. Never throws.
 */
export async function isAuthorizedReportViewer(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return false;

  // PDF renderer path: pdf-temp-<pdfToken>
  const PDF_PREFIX = 'pdf-temp-';
  if (sessionId.startsWith(PDF_PREFIX)) {
    const pdfToken = sessionId.slice(PDF_PREFIX.length);
    if (!pdfToken) return false;
    // Either token shape, expiry enforced in the selector — see
    // server/helpers/pdfAccessTokens.js.
    const user = await findUserByPdfAccessToken(null, pdfToken, { fields: { _id: 1 } });
    return !!user;
  }

  // Normal path: a real, active, unexpired session (hashed lookup).
  const session = await SessionHelpers.findByToken(sessionId);
  return !!(session && session.userId);
}
