import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { RiskAnalysisReportsCollection } from '/imports/api/riskAnalysis';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';
import { UsersCollection, USER_ROLES } from '/imports/api/users';

// Risk reports span the whole book (client/portfolio names, exposures) — staff only.
const STAFF_ROLES = [
  USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE,
  USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT
];

// SECURITY: the previous version only did check(sessionId, String) and never looked
// the session up — ANY non-empty string (i.e. any anonymous caller) received the full
// firm-wide risk dossier. Validate the session AND require a staff role.
async function resolveStaffUser(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  const session = await SessionHelpers.findByToken(sessionId);
  if (!session || !session.userId) return null;
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user || !STAFF_ROLES.includes(user.role)) return null;
  return user;
}

/**
 * Publish risk analysis reports (staff only)
 */
Meteor.publish('riskAnalysisReports', async function(sessionId) {
  check(sessionId, Match.Maybe(String));

  const user = await resolveStaffUser(sessionId);
  if (!user) return this.ready();

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
 * Publish a single risk analysis report by ID (staff only)
 */
Meteor.publish('riskAnalysisReport', async function(reportId, sessionId) {
  check(reportId, String);
  check(sessionId, Match.Maybe(String));

  const user = await resolveStaffUser(sessionId);
  if (!user) return this.ready();

  return RiskAnalysisReportsCollection.find({ _id: reportId });
});
