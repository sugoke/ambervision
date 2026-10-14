import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { UnderlyingsAnalysisCollection } from '/imports/api/underlyingsAnalysis';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { isSeeAll } from '../helpers/accessPolicy.js';
import { resolveScope } from '../helpers/accessScope.js';
import { LIVE_ANALYSIS_ID, scopeLiveAnalysis } from '../helpers/underlyingsScope.js';

/**
 * Underlyings analysis (barrier-protected products): one document of notional per product and ISIN.
 * See-all roles get the firm-wide document; everyone else gets it restricted
 * to the products their perimeter holds, with their own notionals.
 */
Meteor.publish('phoenixUnderlyingsAnalysis', async function(sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const cursor = UnderlyingsAnalysisCollection.find({ _id: LIVE_ANALYSIS_ID });
  if (isSeeAll(user)) return cursor;

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  // Manual publish: re-scope the document every time the analysis is rebuilt
  const self = this;
  let published = false;
  const publishScoped = async () => {
    const analysis = await UnderlyingsAnalysisCollection.findOneAsync({ _id: LIVE_ANALYSIS_ID });
    if (!analysis) return;
    const { _id, ...fields } = await scopeLiveAnalysis(analysis, scope);
    if (published) {
      self.changed('underlyingsAnalysis', _id, fields);
    } else {
      self.added('underlyingsAnalysis', _id, fields);
      published = true;
    }
  };

  await publishScoped();
  self.ready();

  const handle = await cursor.observeChanges({
    added() { if (!published) publishScoped().catch(err => console.error('[UnderlyingsAnalysis] scoped publish failed:', err?.message)); },
    changed() { publishScoped().catch(err => console.error('[UnderlyingsAnalysis] scoped publish failed:', err?.message)); },
    removed(id) {
      if (published) {
        self.removed('underlyingsAnalysis', id);
        published = false;
      }
    }
  });
  self.onStop(() => handle.stop());
});
