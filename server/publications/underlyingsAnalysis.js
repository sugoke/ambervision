import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { UnderlyingsAnalysisCollection } from '/imports/api/underlyingsAnalysis';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { isSeeAll } from '../helpers/accessPolicy.js';

/**
 * Phoenix underlyings analysis: one document of firm-wide notional per product
 * and ISIN. A firm-wide aggregate, so see-all roles only.
 */
Meteor.publish('phoenixUnderlyingsAnalysis', async function(sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isSeeAll(user)) return this.ready();
  return UnderlyingsAnalysisCollection.find({ _id: 'phoenix_live_underlyings' });
});
