/**
 * Operations coverage per bank.
 *
 * A time-weighted return only holds where every deposit and withdrawal is
 * known: a transfer missing from the operations reads as a gain or a loss.
 * Banks send one operations file per business day (empty files included),
 * and each connection records the files it received (`seenOperationFiles`).
 * A bank's coverage starts after the last break in that daily series; before
 * it, valuations exist but the flows between them are unknown.
 *
 * Example: CMB Monaco sent operations files on 6 Jan and 11 Feb 2026, then
 * daily from 25 Mar. Its flows are known from 24 Mar (the file of a day
 * carries the bookings of the previous business day).
 */

import { BankConnectionsCollection } from '/imports/api/bankConnections';

// Longest run of days without an operations file that is still a normal
// break (weekends, bank holidays, a late file). Matches the carry-forward
// window of buildConsolidatedDailyValues.
const MAX_GAP_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** First YYYYMMDD date in a bank file name, as a UTC Date, or null. */
export function fileNameDate(fileName) {
  const m = String(fileName || '').match(/(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

/**
 * Start of continuous operations coverage for a list of file dates: the day
 * before the first file that follows the last break longer than MAX_GAP_DAYS.
 * @param {Date[]} dates
 * @returns {Date|null}
 */
export function coverageStartFromDates(dates) {
  const days = [...new Set(dates.filter(Boolean).map(d => d.getTime()))].sort((a, b) => a - b);
  if (!days.length) return null;
  let start = days[0];
  for (let i = 1; i < days.length; i++) {
    if ((days[i] - days[i - 1]) / DAY_MS > MAX_GAP_DAYS) start = days[i];
  }
  return new Date(start - DAY_MS);
}

/**
 * Coverage start per bank, from the operations files of all its connections.
 * Banks without recorded files (manual imports) are left out: no limit.
 * @param {String[]} bankIds
 * @returns {Promise<Object<String, Date>>} bankId -> first day with known flows
 */
export async function getOperationsCoverageStarts(bankIds) {
  const ids = [...new Set((bankIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const connections = await BankConnectionsCollection.find(
    { bankId: { $in: ids } },
    { fields: { bankId: 1, seenOperationFiles: 1 } }
  ).fetchAsync();
  const datesByBank = {};
  for (const c of connections) {
    (datesByBank[c.bankId] = datesByBank[c.bankId] || []).push(...(c.seenOperationFiles || []).map(fileNameDate));
  }
  const starts = {};
  for (const [bankId, dates] of Object.entries(datesByBank)) {
    const start = coverageStartFromDates(dates);
    if (start) starts[bankId] = start;
  }
  return starts;
}

/** Snapshots of each bank from its coverage start on (others kept as they are). */
export function filterSnapshotsByOperationsCoverage(snapshots, coverageStarts) {
  return snapshots.filter(s => {
    const start = s.bankId ? coverageStarts[s.bankId] : null;
    return !start || new Date(s.snapshotDate) >= start;
  });
}
