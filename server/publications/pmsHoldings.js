// PMS Holdings Publications
// Bank positions, scoped through the access scope (server/helpers/accessScope.js).

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { parseViewAs } from '/imports/utils/viewAs';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { resolveScope, holdingsSelector } from '../helpers/accessScope.js';

/**
 * Publish a cursor through observeChanges so the owner `$and` never reaches the
 * oplog matcher as a complex selector: ids are resolved first, then a plain
 * `_id: { $in }` cursor is observed (same pattern the publication always used
 * for `$or` filters).
 */
async function publishByIds(pub, collectionName, query, options) {
  const ids = (await PMSHoldingsCollection.find(query, { fields: { _id: 1 } }).fetchAsync()).map(d => d._id);
  const cursor = PMSHoldingsCollection.find({ _id: { $in: ids } }, options);
  const handle = await cursor.observeChanges({
    added(id, fields) { pub.added(collectionName, id, fields); },
    changed(id, fields) { pub.changed(collectionName, id, fields); },
    removed(id) { pub.removed(collectionName, id); }
  });
  pub.ready();
  pub.onStop(() => handle.stop());
}

Meteor.publish('pmsHoldings', async function (sessionId = null, rawViewAs = null, latestOnly = true, asOfDate = null) {
  check(sessionId, Match.Maybe(String));
  const viewAs = parseViewAs(rawViewAs);
  check(latestOnly, Match.Maybe(Boolean));
  check(asOfDate, Match.Maybe(Match.OneOf(Date, String)));

  const parsedAsOfDate = asOfDate ? (asOfDate instanceof Date ? asOfDate : new Date(asOfDate)) : null;

  const user = await getSessionUser(sessionId, { touch: true });
  if (!user) return this.ready();

  const scope = await resolveScope(user, viewAs);
  if (scope.denied) return this.ready();

  try {
    const ownerClause = await holdingsSelector(scope);
    const base = [ownerClause, { isActive: true }];

    // Historical view: newest record per uniqueKey up to the date.
    // $top instead of a pipeline-level $sort + $group/$first: a blocking $sort
    // over the full history exceeds MongoDB's 32MB sort memory limit while the
    // multiplanner trials candidate plans (allowDiskUse is NOT honored during
    // plan selection), which made this aggregation throw and the publication
    // silently return zero holdings.
    if (parsedAsOfDate && !isNaN(parsedAsOfDate)) {
      const pipeline = [
        { $match: { $and: [...base, { snapshotDate: { $lte: parsedAsOfDate } }] } },
        {
          $group: {
            _id: '$uniqueKey',
            top: {
              $top: {
                sortBy: { snapshotDate: -1, version: -1 },
                output: { holdingId: '$_id' }
              }
            }
          }
        }
      ];
      const latestByKey = await PMSHoldingsCollection.rawCollection()
        .aggregate(pipeline, { allowDiskUse: true })
        .toArray();
      const holdingIds = latestByKey.map(doc => doc.top.holdingId);
      return PMSHoldingsCollection.find({ _id: { $in: holdingIds } }, { sort: { securityName: 1 } });
    }

    // Every historical version
    if (!latestOnly) {
      return publishByIds(this, 'pmsHoldings', { $and: base }, {
        sort: { snapshotDate: -1, version: -1, securityName: 1 }
      });
    }

    // Default: current positions
    const query = { $and: [...base, { isLatest: true }] };
    if (scope.isAdmin) {
      return PMSHoldingsCollection.find(query, { sort: { securityName: 1 } });
    }
    return publishByIds(this, 'pmsHoldings', query, { sort: { securityName: 1 } });
  } catch (error) {
    console.error('PMS holdings publication error:', error);
    return this.ready();
  }
});

/**
 * Distinct snapshot dates within the viewer's scope, for the date selector.
 */
Meteor.publish('pmsHoldings.snapshotDates', async function (sessionId = null, rawViewAs = null) {
  check(sessionId, Match.Maybe(String));
  const viewAs = parseViewAs(rawViewAs);

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user, viewAs);
  if (scope.denied) return this.ready();

  try {
    const pipeline = [
      { $match: { $and: [await holdingsSelector(scope), { isActive: true }] } },
      { $group: { _id: '$snapshotDate', count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 100 }
    ];
    const dates = await PMSHoldingsCollection.rawCollection().aggregate(pipeline).toArray();

    dates.forEach((dateDoc, index) => {
      this.added('pmsHoldingsSnapshotDates', index.toString(), {
        date: dateDoc._id,
        holdingsCount: dateDoc.count
      });
    });
    this.ready();
  } catch (error) {
    console.error('PMS holdings snapshot dates publication error:', error);
    return this.ready();
  }
});

/**
 * Holdings linked to a product by ISIN, within the viewer's scope.
 * Used by the product report to show client positions from bank files.
 */
Meteor.publish('pmsHoldings.byProduct', async function (isin, sessionId = null) {
  check(isin, Match.Maybe(String));
  check(sessionId, Match.Maybe(String));
  if (!isin) return this.ready();

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  try {
    const query = { $and: [await holdingsSelector(scope), { isin, isLatest: true, isActive: true }] };
    if (scope.isAdmin) return PMSHoldingsCollection.find(query);
    return publishByIds(this, 'pmsHoldings', query, {});
  } catch (error) {
    console.error('[pmsHoldings.byProduct] Error:', error);
    return this.ready();
  }
});
