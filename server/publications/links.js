// Links Publications
// The links list is shared content for any logged-in user.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { LinksCollection } from '/imports/api/links';
import { getSessionUser } from '../helpers/sessionAuth.js';

Meteor.publish("links", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();
  return LinksCollection.find();
});
