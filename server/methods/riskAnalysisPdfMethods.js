/**
 * Risk Analysis PDF Methods
 *
 * Server method feeding the underlyings risk report PDF (RiskAnalysisPDF.jsx).
 * It authenticates via PDF token instead of session, allowing Puppeteer to
 * access data without a real session.
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { findUserByPdfAccessToken } from '../helpers/pdfAccessTokens.js';

Meteor.methods({
  /**
   * The whole report: every figure, label and page break, built server-side by
   * buildRiskReport, which also applies the read rule (see-all roles any
   * report, other staff the reports they generated).
   */
  async 'riskAnalysis.getReportForPdf'({ reportId, userId, pdfToken, lang = 'en' }) {
    check(reportId, String);
    check(userId, String);
    check(pdfToken, String);
    check(lang, Match.Maybe(String));

    // See server/helpers/pdfAccessTokens.js — one token per generation, so a
    // retry cannot invalidate the run that is still rendering.
    const currentUser = await findUserByPdfAccessToken(userId, pdfToken);
    if (!currentUser) {
      throw new Meteor.Error('unauthorized', 'Invalid or expired PDF token');
    }

    const { buildRiskReport } = await import('../helpers/riskReport/buildRiskReport.js');
    return buildRiskReport({ currentUser, reportId, lang: lang === 'fr' ? 'fr' : 'en' });
  }
});
