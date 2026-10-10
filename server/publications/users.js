// Users Publications
//
// Staff see the staff directory (validators, RMs — needed by pickers); client
// logins are published within the viewer's scope only. No password hashes, no
// token fields, ever.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { STAFF_ROLES, isSeeAll, isStaff } from '../helpers/accessPolicy.js';
import { resolveScope, usersSelector } from '../helpers/accessScope.js';

const DIRECTORY_FIELDS = {
  email: 1, username: 1, role: 1, profile: 1, createdAt: 1, isActive: 1,
  relationshipManagerId: 1, assignedRmIds: 1, canValidateOrders: 1, canValidateAnyOrder: 1
};

/** Staff users plus the client logins in scope. */
async function directorySelector(user) {
  if (isSeeAll(user)) return {};
  const scope = await resolveScope(user);
  const clients = await usersSelector(scope);
  return { $or: [{ role: { $in: STAFF_ROLES } }, clients] };
}

// Users for admin management / staff pickers
Meteor.publish("customUsers", async function (sessionId) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return this.ready();
  return UsersCollection.find(await directorySelector(user), { fields: DIRECTORY_FIELDS });
});

// Users for the Clients section
Meteor.publish("rmClients", async function (sessionId) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return this.ready();

  const selector = await directorySelector(user);
  return UsersCollection.find(
    { $and: [selector, { isActive: { $ne: false } }] },
    { fields: DIRECTORY_FIELDS }
  );
});

// Users for allocation selection — see-all roles only
Meteor.publish("users", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isSeeAll(user)) return this.ready();
  return UsersCollection.find({}, { fields: DIRECTORY_FIELDS });
});

export { USER_ROLES };
