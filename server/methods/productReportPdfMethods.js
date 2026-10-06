/**
 * Product report PDF methods
 *
 * Server method feeding the structured product report PDF (ProductReportPDF.jsx).
 * It authenticates via PDF token instead of session, allowing Puppeteer to
 * access data without a real session.
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { findUserByPdfAccessToken } from '../helpers/pdfAccessTokens.js';

// GDPR accountability
const { AuditLog } = require('/imports/api/auditLog');

Meteor.methods({
  /**
   * The whole product report: every figure, label, chart and page break, built
   * server-side by buildProductReport, which also checks the user may see the
   * product (same rule as the products.single publication).
   */
  async 'products.getReportForPdf'({ userId, pdfToken, productId, lang = 'en' }) {
    check(userId, String);
    check(pdfToken, String);
    check(productId, String);
    check(lang, Match.Maybe(String));

    const currentUser = await findUserByPdfAccessToken(userId, pdfToken);
    if (!currentUser) {
      throw new Meteor.Error('unauthorized', 'Invalid or expired PDF token');
    }

    await AuditLog.record({
      actorUserId: currentUser._id,
      actorRole: currentUser.role,
      action: 'export.pdf',
      targetType: 'productReport',
      targetId: productId
    });

    const { buildProductReport } = await import('../helpers/productReport/buildProductReport.js');
    return buildProductReport({ currentUser, productId, lang: lang === 'fr' ? 'fr' : 'en' });
  }
});
