/**
 * Holdings on record at the end of a past day.
 *
 * The newest record per uniqueKey dated on or before the day is NOT enough on
 * its own: a position sold, or recorded under an older uniqueKey recipe (the
 * legacy "CMB" bank records on today's CMB Monaco accounts), keeps its last
 * record forever and was carried into every later date, inflating historical
 * totals (30 Sept 2026: about EUR 11M too high) while the live view, which
 * reads isLatest, stayed right.
 *
 * So, per account (bank + portfolio code), the day shows what the account's
 * newest file on or before that day contained. A record from an older file is
 * kept only when the same position is in a file within GAP_DAYS after the day:
 * a bank file occasionally leaves a position out for a day, and that position
 * must not drop out of the view for that day.
 */
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';

const DAY = 24 * 60 * 60 * 1000;
const GAP_DAYS = 7;

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Several clients share the literal portfolioCode 'CONSOLIDATED', so it needs
 * the owner; clientCode is stable across the entity migration.
 */
const accountKey = (h) => {
  const base = `${h.bankId}|${h.portfolioCode}`;
  return h.portfolioCode === 'CONSOLIDATED'
    ? `${base}|${h.clientCode || h.entityId || h.userId || ''}`
    : base;
};

/**
 * Drop carried-forward records from a newest-per-uniqueKey set.
 * @param {Array} rows - newest record per uniqueKey (needs uniqueKey, bankId,
 *   portfolioCode, snapshotDate; clientCode/entityId/userId for CONSOLIDATED)
 * @param {Date} dayEnd - exclusive end of the as-of day
 * @param {Object} [selector] - owner selector the rows were read with
 */
export async function dropCarriedForward(rows, dayEnd, selector = {}) {
  const newestDay = {};
  for (const h of rows) {
    const k = accountKey(h);
    const d = dayKey(h.snapshotDate);
    if (!newestDay[k] || d > newestDay[k]) newestDay[k] = d;
  }

  const older = rows.filter(h => dayKey(h.snapshotDate) !== newestDay[accountKey(h)]);
  if (older.length === 0) return rows;

  const resumed = new Set(await PMSHoldingsCollection.rawCollection().distinct('uniqueKey', {
    $and: [
      selector,
      { isActive: true },
      { uniqueKey: { $in: older.map(h => h.uniqueKey) } },
      { snapshotDate: { $gte: dayEnd, $lt: new Date(dayEnd.getTime() + GAP_DAYS * DAY) } }
    ]
  }));

  return rows.filter(h =>
    dayKey(h.snapshotDate) === newestDay[accountKey(h)] || resumed.has(h.uniqueKey)
  );
}

/** Exclusive end of the UTC day containing date. */
export function endOfDay(date) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() + DAY);
}
