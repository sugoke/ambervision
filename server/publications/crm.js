// CRM Publications
// Handles all CRM-related publications (clients, meetings, documents, activities)

import { check, Match } from 'meteor/check';
// import { InvestorProfilesCollection } from '/imports/api/investorProfiles'; // Commented out - module doesn't exist
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionHelpers } from '/imports/api/sessions';

// NOTE: 'clientDocuments' publication moved to server/publications/clientDocuments.js
// with proper session-based authentication and userId field

// Meeting notes / activity logs are staff-only CRM data. SECURITY: these previously
// guarded with `this.userId`, which is ALWAYS null under this app's custom session
// model — so they were fail-closed (returned nothing) but latently an IDOR if a Meteor
// account session ever existed. Now they validate a real session with a staff role.
const STAFF_ROLES = [
  USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE,
  USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT
];
async function resolveStaff(sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  const session = await SessionHelpers.findByToken(sessionId);
  if (!session || !session.userId) return null;
  const user = await UsersCollection.findOneAsync(session.userId);
  return (user && STAFF_ROLES.includes(user.role)) ? user : null;
}

Meteor.publish('clientMeetings', async function(clientId, sessionId) {
  check(clientId, String);
  check(sessionId, Match.Maybe(String));
  if (!(await resolveStaff(sessionId))) return this.ready();

  const { ClientMeetingsCollection } = require('/imports/api/clientMeetings');
  return ClientMeetingsCollection.find({ clientId: clientId });
});

Meteor.publish('clientActivities', async function(clientId, limit = 50, sessionId) {
  check(clientId, String);
  check(limit, Number);
  check(sessionId, Match.Maybe(String));
  if (!(await resolveStaff(sessionId))) return this.ready();

  const { ClientActivitiesCollection } = require('/imports/api/clientActivities');
  return ClientActivitiesCollection.find(
    { clientId: clientId },
    { sort: { actualDate: -1, createdAt: -1 }, limit: limit }
  );
});

// Publish investor profiles (admin only) - COMMENTED OUT - InvestorProfilesCollection doesn't exist
// Meteor.publish('investorProfiles', async function() {
//   const user = await UsersCollection.findOneAsync(this.userId);
//   if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
//     return this.ready();
//   }
//   return InvestorProfilesCollection.find({}, { sort: { createdAt: -1 } });
// });






