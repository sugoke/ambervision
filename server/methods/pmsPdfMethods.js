/**
 * PMS PDF Methods
 *
 * Server method feeding the portfolio statement PDF (PortfolioStatementPDF.jsx).
 * It authenticates via PDF token instead of session, allowing Puppeteer to
 * access data without a real session.
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { findUserByPdfAccessToken } from '../helpers/pdfAccessTokens.js';

/**
 * Validate PDF token and return the user
 */
async function validatePdfToken(userId, pdfToken) {
  if (!userId || !pdfToken) {
    throw new Meteor.Error('invalid-params', 'Missing userId or pdfToken');
  }

  // Accepts a token from the per-run list as well as the legacy single slot,
  // and checks expiry in the query — see server/helpers/pdfAccessTokens.js.
  const user = await findUserByPdfAccessToken(userId, pdfToken);

  if (!user) {
    throw new Meteor.Error('unauthorized', 'Invalid or expired PDF token');
  }

  return user;
}

// GDPR accountability
const { AuditLog } = require('/imports/api/auditLog');

Meteor.methods({
  /**
   * The whole portfolio statement: every figure, label and page break, built
   * server-side by buildStatement. The perimeter is resolved there exactly as
   * the on-screen PMS resolves it (getFilteredClientIds).
   */
  async 'pms.getStatementForPdf'({ userId, pdfToken, viewAsFilter, accountId = null, currency = null, sections = null }) {
    check(userId, String);
    check(pdfToken, String);
    check(viewAsFilter, Match.Maybe(Match.ObjectIncluding({ type: String, id: String })));
    check(accountId, Match.Maybe(String));
    check(currency, Match.Maybe(String));
    check(sections, Match.Maybe([String]));

    const currentUser = await validatePdfToken(userId, pdfToken);

    // The token identifies the user; their access scope decides what the
    // statement may cover. A View As target outside the perimeter, or an
    // account the viewer may not see, is refused before anything is built.
    const { parseViewAs } = await import('../../imports/utils/viewAs.js');
    const { resolveScope, assertAccountInScope } = await import('../helpers/accessScope.js');
    const scope = await resolveScope(currentUser, parseViewAs(viewAsFilter));
    if (scope.denied) throw new Meteor.Error('not-authorized', 'Out of scope');
    if (accountId && accountId !== 'all' && accountId !== 'consolidated') {
      await assertAccountInScope(scope, accountId);
    }

    await AuditLog.record({
      actorUserId: currentUser._id,
      actorRole: currentUser.role,
      action: 'export.pdf',
      targetType: 'pmsStatement',
      targetId: viewAsFilter ? `${viewAsFilter.type}:${viewAsFilter.id}` : (accountId ? `account:${accountId}` : 'all')
    });

    const { buildStatement } = await import('../helpers/portfolioStatement/buildStatement.js');
    return buildStatement({ currentUser, viewAsFilter: viewAsFilter || null, accountId, currency, sections });
  }
});

console.log('[PMS_PDF] PMS PDF methods registered');
