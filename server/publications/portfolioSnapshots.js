import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { parseViewAs } from '/imports/utils/viewAs';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { resolveScope, snapshotsSelector, isPortfolioCodeInScope } from '../helpers/accessScope.js';

/**
 * Portfolio valuation history within the viewer's scope.
 */
Meteor.publish('portfolioSnapshots', async function(sessionId, filters = {}, rawViewAs = null) {
  check(sessionId, Match.Maybe(String));
  check(filters, Match.Maybe({
    portfolioCode: Match.Maybe(String),
    bankId: Match.Maybe(String),
    startDate: Match.Maybe(Match.OneOf(Date, String)),
    endDate: Match.Maybe(Match.OneOf(Date, String)),
    limit: Match.Maybe(Number)
  }));
  const viewAs = parseViewAs(rawViewAs);
  const f = filters || {};

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user, viewAs);
  if (scope.denied) return this.ready();

  // An explicit portfolio code must itself be in scope — the owner clause
  // below would reject it anyway, but failing fast keeps the intent obvious.
  if (f.portfolioCode && f.portfolioCode !== 'CONSOLIDATED' && !isPortfolioCodeInScope(scope, f.bankId || null, f.portfolioCode)) {
    return this.ready();
  }

  const extra = {};
  if (f.portfolioCode) extra.portfolioCode = f.portfolioCode;
  if (f.bankId) extra.bankId = f.bankId;
  if (f.startDate || f.endDate) {
    extra.snapshotDate = {};
    if (f.startDate) extra.snapshotDate.$gte = new Date(f.startDate);
    if (f.endDate) extra.snapshotDate.$lte = new Date(f.endDate);
  }

  return PortfolioSnapshotsCollection.find({ $and: [await snapshotsSelector(scope), extra] }, {
    sort: { snapshotDate: -1 },
    limit: Math.min(f.limit || 365, 5000)
  });
});
