// PMS Operations Publications
// Bank transactions, scoped through the access scope (server/helpers/accessScope.js).

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { parseViewAs } from '/imports/utils/viewAs';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { resolveScope, operationsSelector } from '../helpers/accessScope.js';

Meteor.publish('pmsOperations', async function (sessionId = null, rawViewAs = null) {
  check(sessionId, Match.Maybe(String));
  const viewAs = parseViewAs(rawViewAs);

  const user = await getSessionUser(sessionId, { touch: true });
  if (!user) return this.ready();

  const scope = await resolveScope(user, viewAs);
  if (scope.denied) return this.ready();

  const query = { $and: [await operationsSelector(scope), { isActive: true }] };

  return PMSOperationsCollection.find(query, {
    sort: { operationDate: -1, inputDate: -1 }
  });
});
