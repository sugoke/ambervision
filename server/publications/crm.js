// CRM Publications
// Meeting notes and activity logs are staff-only CRM data, scoped to the
// staff member's clients.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { isStaff } from '../helpers/accessPolicy.js';
import { resolveScope, isClientInScope } from '../helpers/accessScope.js';

/** The staff user when `clientId` is in their scope, else null. */
async function staffForClient(sessionId, clientId) {
  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return null;
  const scope = await resolveScope(user);
  return (await isClientInScope(scope, clientId)) ? user : null;
}

Meteor.publish('clientMeetings', async function(clientId, sessionId) {
  check(clientId, String);
  check(sessionId, Match.Maybe(String));
  if (!(await staffForClient(sessionId, clientId))) return this.ready();

  const { ClientMeetingsCollection } = require('/imports/api/clientMeetings');
  return ClientMeetingsCollection.find({ clientId });
});

Meteor.publish('clientActivities', async function(clientId, limit = 50, sessionId) {
  check(clientId, String);
  check(limit, Number);
  check(sessionId, Match.Maybe(String));
  if (!(await staffForClient(sessionId, clientId))) return this.ready();

  const { ClientActivitiesCollection } = require('/imports/api/clientActivities');
  return ClientActivitiesCollection.find(
    { clientId },
    { sort: { actualDate: -1, createdAt: -1 }, limit: Math.min(limit, 500) }
  );
});
