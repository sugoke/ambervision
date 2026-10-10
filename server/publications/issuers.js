// Issuers Publications
// Reference data for any logged-in user; full management list for admins.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { IssuersCollection } from '/imports/api/issuers';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { ADMIN_ROLES } from '../helpers/accessPolicy.js';

Meteor.publish("issuers", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();
  return IssuersCollection.find({ active: true }, { sort: { name: 1 } });
});

Meteor.publish("issuersManagement", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user || !ADMIN_ROLES.includes(user.role)) return this.ready();
  return IssuersCollection.find({}, { sort: { name: 1 } });
});
