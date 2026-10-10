/**
 * Risk Analysis PDF Methods
 *
 * Server methods for fetching Risk Analysis report data for PDF generation.
 * These methods authenticate via PDF token instead of session,
 * allowing Puppeteer to access data without a real session.
 */

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { RiskAnalysisReportsCollection } from '/imports/api/riskAnalysis';
import { findUserByPdfAccessToken } from '../helpers/pdfAccessTokens.js';
import { isSeeAll } from '../helpers/accessPolicy.js';

/**
 * Validate PDF token and return the user
 */
async function validatePdfToken(userId, pdfToken) {
  if (!userId || !pdfToken) {
    throw new Meteor.Error('invalid-params', 'Missing userId or pdfToken');
  }

  // See server/helpers/pdfAccessTokens.js — one token per generation, so a
  // retry cannot invalidate the run that is still rendering.
  const user = await findUserByPdfAccessToken(userId, pdfToken);

  if (!user) {
    throw new Meteor.Error('unauthorized', 'Invalid or expired PDF token');
  }

  return user;
}

Meteor.methods({
  /**
   * Get Risk Analysis report for PDF generation
   */
  async 'riskAnalysis.getReportForPdf'({ reportId, userId, pdfToken }) {
    check(reportId, String);
    check(userId, String);
    check(pdfToken, String);

    console.log('[RISK_PDF] Fetching report for PDF, reportId:', reportId);

    // Validate PDF token
    const currentUser = await validatePdfToken(userId, pdfToken);
    console.log('[RISK_PDF] Token validated for user:', currentUser.emails?.[0]?.address);

    // The token proves identity only. Risk reports span the whole book, so the
    // same rule as the on-screen publication applies: see-all roles only.
    if (!isSeeAll(currentUser)) {
      throw new Meteor.Error('not-authorized', 'Insufficient permissions');
    }

    // Fetch the report
    const report = await RiskAnalysisReportsCollection.findOneAsync({ _id: reportId });

    if (!report) {
      throw new Meteor.Error('not-found', 'Risk analysis report not found');
    }

    console.log('[RISK_PDF] Found report with', report.analyses?.length || 0, 'analyses');
    return report;
  }
});

console.log('[RISK_PDF] Risk Analysis PDF methods registered');
