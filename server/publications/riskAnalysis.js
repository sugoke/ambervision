import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { RiskAnalysisReportsCollection } from '/imports/api/riskAnalysis';

/**
 * Publish risk analysis reports
 * All authenticated users can view reports
 */
Meteor.publish('riskAnalysisReports', function(sessionId) {
  check(sessionId, String);

  // Verify session exists (basic authentication check)
  if (!sessionId) {
    console.log('[RiskAnalysis Pub] No session ID provided');
    return this.ready();
  }

  console.log('[RiskAnalysis Pub] Publishing risk analysis reports for session:', sessionId);

  // Return all risk analysis reports, sorted by most recent first
  return RiskAnalysisReportsCollection.find(
    {},
    {
      sort: { generatedAt: -1 },
      limit: 50 // Limit to last 50 reports
    }
  );
});

/**
 * Publish a single risk analysis report by ID
 */
Meteor.publish('riskAnalysisReport', function(reportId, sessionId) {
  check(reportId, String);
  check(sessionId, String);

  if (!sessionId) {
    console.log('[RiskAnalysis Pub] No session ID provided for single report');
    return this.ready();
  }

  console.log('[RiskAnalysis Pub] Publishing risk analysis report:', reportId);

  return RiskAnalysisReportsCollection.find({ _id: reportId });
});
