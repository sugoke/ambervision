// Templates Publications
// Product templates are reference data for any logged-in user.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { getSessionUser } from '../helpers/sessionAuth.js';

Meteor.publish("templates", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const { TemplatesCollection } = require('/imports/api/templates');
  return TemplatesCollection.find({}, { sort: { name: 1 } });
});
