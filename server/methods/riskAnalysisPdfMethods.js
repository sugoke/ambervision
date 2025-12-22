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
import { UsersCollection } from '/imports/api/users';

/**
 * Validate PDF token and return the user
 */
async function validatePdfToken(userId, pdfToken) {
  if (!userId || !pdfToken) {
    throw new Meteor.Error('invalid-params', 'Missing userId or pdfToken');
  }

  const user = await UsersCollection.findOneAsync({
    _id: userId,
    'services.pdfAccess.token': pdfToken
  });

  if (!user) {
    throw new Meteor.Error('unauthorized', 'Invalid or expired PDF token');
  }

  const expiresAt = user.services?.pdfAccess?.expiresAt;
  if (expiresAt && new Date(expiresAt) < new Date()) {
    throw new Meteor.Error('token-expired', 'PDF token has expired');
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
