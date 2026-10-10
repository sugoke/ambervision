import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { AccountProfilesCollection } from '../../imports/api/accountProfiles.js';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { resolveScope } from '../helpers/accessScope.js';

/**
 * Investment profiles of the bank accounts in the viewer's scope.
 * (The userId / entityId arguments are accepted for compatibility and ignored:
 * the scope decides.)
 */
Meteor.publish('accountProfiles', async function(sessionId, userId = null, entityId = null) {
  check(sessionId, Match.Maybe(String));
  check(userId, Match.Maybe(String));
  check(entityId, Match.Maybe(String));

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();
  if (scope.isAdmin) return AccountProfilesCollection.find({});
  if (scope.bankAccountIds.length === 0) return this.ready();

  return AccountProfilesCollection.find({ bankAccountId: { $in: scope.bankAccountIds } });
});
