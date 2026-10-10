// Equity Holdings Publications
// Equity positions keyed by bankAccountId, scoped through the access scope.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { EquityHoldingsCollection } from '/imports/api/equityHoldings';
import { parseViewAs } from '/imports/utils/viewAs';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { resolveScope, equityHoldingsSelector } from '../helpers/accessScope.js';

Meteor.publish('equityHoldings', async function (sessionId = null, rawViewAs = null) {
  check(sessionId, Match.Maybe(String));
  const viewAs = parseViewAs(rawViewAs);

  const user = await getSessionUser(sessionId, { touch: true });
  if (!user) return this.ready();

  const scope = await resolveScope(user, viewAs);
  if (scope.denied) return this.ready();

  return EquityHoldingsCollection.find(await equityHoldingsSelector(scope));
});
