import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { RiskAnalysisReportsCollection } from '/imports/api/riskAnalysis';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { isSeeAll } from '../helpers/accessPolicy.js';

// Risk reports span the whole book (client/portfolio names, exposures): a
// firm-wide aggregate, so see-all roles only.

Meteor.publish('riskAnalysisReports', async function(sessionId) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isSeeAll(user)) return this.ready();

  return RiskAnalysisReportsCollection.find({}, { sort: { generatedAt: -1 }, limit: 50 });
});

Meteor.publish('riskAnalysisReport', async function(reportId, sessionId) {
  check(reportId, String);
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isSeeAll(user)) return this.ready();

  return RiskAnalysisReportsCollection.find({ _id: reportId });
});
