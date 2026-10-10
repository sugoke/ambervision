/**
 * Client Documents Publications
 *
 * KYC / identity documents: the caller must be the client themselves or a
 * staff member whose access scope contains that client.
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClientDocumentsCollection } from '/imports/api/clientDocuments.js';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { isStaff } from '../helpers/accessPolicy.js';
import { resolveScope, isClientInScope, usersSelector, bankAccountsSelector } from '../helpers/accessScope.js';

/** Documents of one client (entity id or legacy user id). */
Meteor.publish('clientDocuments', async function (userId, sessionId) {
  check(userId, Match.Maybe(String));
  check(sessionId, Match.Maybe(String));
  if (!userId) return this.ready();

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  // The subject is the client's login id or their entity id. A client's own
  // scope contains both; a staff member's scope contains their perimeter; any
  // other role resolves to a denied scope and gets nothing.
  if (user._id !== userId) {
    const scope = await resolveScope(user);
    if (!(await isClientInScope(scope, userId))) return this.ready();
  }

  return ClientDocumentsCollection.find({ userId });
});

/** Documents in scope expiring within three months (dashboard alerts) — staff only. */
Meteor.publish('clientDocuments.expiring', async function (sessionId) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

  const owner = scope.isAdmin
    ? {}
    : { $or: [await usersSelector(scope), { userId: { $in: scope.entityIds } }, bankAccountsSelector(scope)] };
  return ClientDocumentsCollection.find({ $and: [owner, { expirationDate: { $lte: threeMonthsFromNow } }] });
});

/** Documents of several clients — each must be in scope. */
Meteor.publish('clientDocuments.forUsers', async function (userIds, sessionId) {
  check(userIds, [String]);
  check(sessionId, Match.Maybe(String));
  if (userIds.length === 0) return this.ready();

  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  const allowed = [];
  for (const id of [...new Set(userIds)].slice(0, 500)) {
    if (await isClientInScope(scope, id)) allowed.push(id);
  }
  if (allowed.length === 0) return this.ready();
  return ClientDocumentsCollection.find({ userId: { $in: allowed } });
});
