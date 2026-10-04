/**
 * TWR (Time-Weighted Return) Calculator
 *
 * Pure functions for calculating Time-Weighted Returns that neutralize
 * the effect of external cash flows (deposits/withdrawals).
 *
 * Methodology: Net-of-all-fees TWR using Modified Dietz at daily frequency.
 * Fees debited from the account already reduce portfolio value, so they
 * naturally reduce returns. No special fee handling needed.
 *
 * External cash flows excluded: TRANSFER_IN/OUT, PAYMENT_IN/OUT only.
 *
 * Follows the cashCalculator.js pattern - no DB access, pure computation.
 */

import { OPERATION_TYPES } from '/imports/api/constants/operationTypes.js';
import { convertToEUR } from '/imports/api/helpers/cashCalculator.js';

/**
 * Currency a snapshot's totals (totalAccountValue, cashBalance, ...) are
 * denominated in. `portfolioCurrency` is the account's reference currency the
 * holdings were valued in; `currency` is only the dominant security currency
 * (a EUR credit line with a USD sub-balance is labelled "USD"). Older
 * snapshots have no portfolioCurrency, and there `currency` is the only hint.
 */
export const snapshotValueCurrency = (snap) => (snap && (snap.portfolioCurrency || snap.currency)) || null;

// External cash flow operation types that distort performance
const EXTERNAL_FLOW_TYPES = new Set([
  OPERATION_TYPES.TRANSFER_IN,
  OPERATION_TYPES.TRANSFER_OUT,
  OPERATION_TYPES.PAYMENT_IN,
  OPERATION_TYPES.PAYMENT_OUT,
]);

/**
 * Check if an operation is an external cash flow
 * @param {Object} operation - PMSOperations document
 * @returns {boolean}
 */
export const isExternalCashFlow = (operation) => {
  return EXTERNAL_FLOW_TYPES.has(operation.operationType);
};

/**
 * Get signed EUR amount for an external cash flow operation
 * Positive = inflow (deposit), Negative = outflow (withdrawal)
 *
 * Uses amountPortfolioCcy if available (already in portfolio currency),
 * otherwise converts netAmount via convertToEUR().
 *
 * @param {Object} operation - PMSOperations document
 * @param {Object} ratesMap - Currency conversion rates (from buildRatesMap + mergeRatesMaps)
 * @returns {number} Signed EUR amount
 */
export const getSignedFlowAmountEUR = (operation, ratesMap) => {
  // Prefer portfolio-currency amount (already in portfolio currency, typically EUR)
  const hasPortfolioCcy = operation.amountPortfolioCcy != null && operation.amountPortfolioCcy !== 0;
  const rawAmount = hasPortfolioCcy
    ? operation.amountPortfolioCcy
    : (operation.netAmount || operation.grossAmount || 0);
  const absAmount = Math.abs(rawAmount);

  // Determine currency for conversion
  const currency = hasPortfolioCcy
    ? 'EUR' // amountPortfolioCcy is in portfolio currency (typically EUR)
    : (operation.operationCurrency || operation.currency || operation.settlementCurrency || 'EUR');

  const eurAmount = convertToEUR(absAmount, currency, ratesMap);

  // Apply sign based on operation type (always use operationType, ignore raw sign)
  const isInflow = operation.operationType === OPERATION_TYPES.TRANSFER_IN ||
                   operation.operationType === OPERATION_TYPES.PAYMENT_IN;

  return isInflow ? eurAmount : -eurAmount;
};

/**
 * Build sorted array of daily portfolio values from snapshots
 * @param {Array} snapshots - Portfolio snapshot documents (or aggregated snapshots)
 * @returns {Array} Sorted array of { date: 'YYYY-MM-DD', totalValueEUR: number }
 */
export const buildDailyValuesFromSnapshots = (snapshots) => {
  if (!snapshots || snapshots.length === 0) return [];

  const dailyMap = {};

  for (const snapshot of snapshots) {
    const dateKey = snapshot.snapshotDate instanceof Date
      ? snapshot.snapshotDate.toISOString().split('T')[0]
      : String(snapshot.snapshotDate).split('T')[0];

    // Sum values for same date (handles aggregated multi-portfolio snapshots)
    if (!dailyMap[dateKey]) {
      dailyMap[dateKey] = { date: dateKey, totalValueEUR: 0 };
    }
    dailyMap[dateKey].totalValueEUR += snapshot.totalAccountValue || 0;
  }

  return Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Build map of daily net external flows from operations
 * @param {Array} operations - External cash flow operations
 * @param {Object} ratesMap - Currency conversion rates
 * @returns {Object} Map of 'YYYY-MM-DD' -> net flow in EUR
 */
export const buildDailyFlowsFromOperations = (operations, ratesMap) => {
  const dailyFlows = {};

  for (const op of operations) {
    if (!isExternalCashFlow(op)) continue;

    const dateKey = op.operationDate instanceof Date
      ? op.operationDate.toISOString().split('T')[0]
      : String(op.operationDate).split('T')[0];

    const signedEUR = getSignedFlowAmountEUR(op, ratesMap);
    dailyFlows[dateKey] = (dailyFlows[dateKey] || 0) + signedEUR;
  }

  return dailyFlows;
};

/**
 * Core TWR calculation engine
 *
 * For each day: R_i = (V_end - V_start - CF) / (V_start + CF)
 * where CF is the net external cash flow on that day (assumes start-of-day timing).
 *
 * Cumulative TWR = product of (1 + R_i) - 1
 *
 * Handles edge cases:
 * - Missing days (weekends/holidays): TWR calculates over multi-day gaps naturally
 * - First day: loop starts at index 1, index 0 is the reference point
 * - Zero/negative denominator: skip day (new account with first deposit)
 * - Extreme daily returns clamped: a single-day move beyond ±50% is almost
 *   certainly a missing cash flow (deposit/withdrawal not in operations),
 *   so the day is neutralized (return = 0) to avoid chart spikes.
 *
 * @param {Array} dailyValues - Sorted array of { date, totalValueEUR }
 * @param {Object} dailyFlows - Map of date -> net EUR flow
 * @returns {Array} Array of { date, dailyReturn, cumulativeTWR, vStart, vEnd, cashFlow }
 */
export const calculateDailyTWR = (dailyValues, dailyFlows) => {
  if (!dailyValues || dailyValues.length < 2) return [];

  const MAX_DAILY_RETURN = 0.15; // ±15% — beyond this, treat as missing cash flow

  const results = [];
  let cumulativeProduct = 1;

  for (let i = 1; i < dailyValues.length; i++) {
    const vStart = dailyValues[i - 1].totalValue ?? dailyValues[i - 1].totalValueEUR;
    const vEnd = dailyValues[i].totalValue ?? dailyValues[i].totalValueEUR;
    const cf = dailyFlows[dailyValues[i].date] || 0;

    const denominator = vStart + cf;

    // Skip if denominator is zero or negative (e.g., new account with first deposit)
    if (denominator <= 0) {
      results.push({
        date: dailyValues[i].date,
        dailyReturn: 0,
        cumulativeTWR: cumulativeProduct - 1,
        vStart,
        vEnd,
        cashFlow: cf
      });
      continue;
    }

    let dailyReturn = (vEnd - vStart - cf) / denominator;

    // Clamp extreme daily returns — likely a missing/unmatched cash flow
    if (Math.abs(dailyReturn) > MAX_DAILY_RETURN) {
      console.warn(`[TWR] Clamping extreme daily return on ${dailyValues[i].date}: ${(dailyReturn * 100).toFixed(1)}% (vStart=${vStart.toFixed(0)}, vEnd=${vEnd.toFixed(0)}, cf=${cf.toFixed(0)}) — likely missing cash flow`);
      dailyReturn = 0;
    }

    cumulativeProduct *= (1 + dailyReturn);

    results.push({
      date: dailyValues[i].date,
      dailyReturn,
      cumulativeTWR: cumulativeProduct - 1,
      vStart,
      vEnd,
      cashFlow: cf
    });
  }

  return results;
};

// ---------------------------------------------------------------------------
// Multi-account, multi-currency series
//
// The original builders above sum snapshot values as stored (each in its own
// account's currency) and always convert flows to EUR, which mis-states any
// client whose accounts are not all in EUR, and take each flow's direction
// from its operation type alone. The builders below express every value and
// flow in ONE currency, keep accounts whose snapshot is missing on a day at
// their last value, and read a flow's direction from the bank's own sign when
// that bank books signed amounts.
// ---------------------------------------------------------------------------

// Money entering or leaving the measured accounts. Card spending from an
// investment account is money leaving it, like a payment.
const PERIMETER_FLOW_TYPES = new Set([
  OPERATION_TYPES.TRANSFER_IN,
  OPERATION_TYPES.TRANSFER_OUT,
  OPERATION_TYPES.PAYMENT_IN,
  OPERATION_TYPES.PAYMENT_OUT,
  OPERATION_TYPES.CARD_PAYMENT,
]);

const INFLOW_TYPES = new Set([OPERATION_TYPES.TRANSFER_IN, OPERATION_TYPES.PAYMENT_IN]);

export const PERIMETER_FLOW_TYPE_LIST = [...PERIMETER_FLOW_TYPES];

/**
 * Signed amount of a flow in the operation's own currency (+ in, - out).
 * Some banks book signed amounts and their operation type can disagree with
 * the sign (CMB files "transfer out" lines that credit the account); others
 * book every amount as positive and only the type carries the direction.
 * `trustSign` says which convention the operation's bank follows. Cash lines
 * that leave the net amount empty carry it in the quantity.
 */
export const getSignedFlowAmount = (operation, { trustSign = false } = {}) => {
  // Parsers now store the signed amount (+ in, - out) in the operation's std block
  if (operation.std && Number.isFinite(Number(operation.std.amount)) && Number(operation.std.amount) !== 0) {
    return Number(operation.std.amount);
  }
  const raw = [operation.netAmount, operation.grossAmount, operation.quantity]
    .find(v => v != null && v !== 0 && !Number.isNaN(Number(v)));
  if (raw == null) return 0;
  const amount = Number(raw);
  if (trustSign) return amount;
  const abs = Math.abs(amount);
  return INFLOW_TYPES.has(operation.operationType) ? abs : -abs;
};

const dateKeyOf = (value) => (value instanceof Date
  ? value.toISOString().split('T')[0]
  : String(value).split('T')[0]);

/**
 * Daily total of several accounts in one currency.
 *
 * - `convert(amount, fromCurrency)` returns the amount in the target currency,
 *   or null when no rate is known (the whole series is then refused).
 * - An account with no snapshot on a day keeps its last value for up to
 *   `maxGapDays`, so a late file does not read as the account vanishing.
 * - An account entering the perimeter after the first day (or leaving it)
 *   moves the total without any performance: that move is returned as a
 *   structural flow for the same day.
 *
 * @returns {{ dailyValues: Array<{date, totalValue}>, structuralFlows: Object, missingRate: String|null }}
 */
export const buildConsolidatedDailyValues = (snapshots, convert, { maxGapDays = 10 } = {}) => {
  // One value per account per day (several writers can store the same day)
  const byAccount = new Map();
  for (const snap of snapshots || []) {
    const key = `${snap.bankId || ''}|${snap.portfolioCode || ''}`;
    const date = dateKeyOf(snap.snapshotDate);
    if (!byAccount.has(key)) byAccount.set(key, new Map());
    const days = byAccount.get(key);
    const existing = days.get(date);
    const created = snap.createdAt ? new Date(snap.createdAt).getTime() : 0;
    if (!existing || created >= existing.created) {
      const value = convert(snap.totalAccountValue || 0, snapshotValueCurrency(snap));
      if (value === null) return { dailyValues: [], structuralFlows: {}, missingRate: snapshotValueCurrency(snap) };
      days.set(date, { value, created });
    }
  }

  const dates = [...new Set([...byAccount.values()].flatMap(days => [...days.keys()]))].sort();
  const dayMs = 24 * 60 * 60 * 1000;
  const state = new Map(); // key -> { value, date, active }
  const dailyValues = [];
  const structuralFlows = {};

  dates.forEach((date, index) => {
    let total = 0;
    for (const [key, days] of byAccount) {
      const today = days.get(date);
      const prev = state.get(key);
      if (today) {
        if (index > 0 && !(prev && prev.active)) {
          structuralFlows[date] = (structuralFlows[date] || 0) + today.value; // enters the perimeter
        }
        state.set(key, { value: today.value, date, active: true });
        total += today.value;
      } else if (prev && prev.active) {
        const gap = (new Date(date) - new Date(prev.date)) / dayMs;
        if (gap <= maxGapDays) {
          total += prev.value; // late or missing file: carry the last value
        } else {
          structuralFlows[date] = (structuralFlows[date] || 0) - prev.value; // left the perimeter
          state.set(key, { ...prev, active: false });
        }
      }
    }
    dailyValues.push({ date, totalValue: total });
  });

  return { dailyValues, structuralFlows, missingRate: null };
};

/**
 * Daily net flows in the target currency.
 * @param {Array} operations
 * @param {Function} convert - (amount, fromCurrency) => amount in target currency, or null
 * @param {Set} signedBankIds - banks whose amounts carry the direction
 * @returns {{ dailyFlows: Object, missingRate: String|null }}
 */
export const buildConsolidatedDailyFlows = (operations, convert, signedBankIds = new Set()) => {
  const dailyFlows = {};
  for (const op of operations || []) {
    if (!PERIMETER_FLOW_TYPES.has(op.operationType)) continue;
    const signed = getSignedFlowAmount(op, { trustSign: signedBankIds.has(op.bankId) });
    if (!signed) continue;
    // The std amount is in std.currency; the legacy amount fields in the bank currency fields
    const usesStd = op.std && Number(op.std.amount) !== 0 && Number.isFinite(Number(op.std.amount));
    const currency = (usesStd && op.std.currency) || op.currency || op.accountCurrency || op.operationCurrency || op.settlementCurrency;
    const value = convert(signed, currency);
    if (value === null) return { dailyFlows: {}, missingRate: currency };
    const date = dateKeyOf(op.operationDate);
    dailyFlows[date] = (dailyFlows[date] || 0) + value;
  }
  return { dailyFlows, missingRate: null };
};

/**
 * Annualize a TWR return
 * Only meaningful for periods > 365 days
 *
 * Formula: (1 + TWR)^(365/days) - 1
 *
 * @param {number} twr - Cumulative TWR (decimal, e.g., 0.15 = 15%)
 * @param {number} totalDays - Number of calendar days in the period
 * @returns {number|null} Annualized TWR, or null if period <= 365 days
 */
export const annualizeTWR = (twr, totalDays) => {
  if (totalDays <= 365) return null;
  return Math.pow(1 + twr, 365 / totalDays) - 1;
};

// ---------------------------------------------------------------------------
// Calendar (monthly / yearly) returns
// ---------------------------------------------------------------------------

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatDayMonth = (iso) => `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]}`;

/**
 * Time-weighted return per calendar month or year, chain-linked from the daily
 * series built by calculateDailyTWR — so deposits and withdrawals are already
 * neutralised and the buckets multiply back to the cumulative TWR.
 *
 * Return of a bucket = (1 + cum at its last day) / (1 + cum at the previous
 * bucket's last day) − 1. The first bucket starts from the series base value
 * (cumulative 0 on `baseDate`, the day before the first series entry).
 *
 * A bucket is partial when the series starts inside it (no value at the end of
 * the previous bucket) or when it is still running at `asOf`.
 *
 * @param {Array} twrSeries - [{ date: 'YYYY-MM-DD', cumulativeTWR }], sorted
 * @param {'month'|'year'} granularity
 * @param {string} baseDate - date of the series base value ('YYYY-MM-DD')
 * @param {Date} [asOf] - reference "today" for the running bucket
 * @returns {Array} [{ key, label, twr, twrFormatted, isPositive, isPartial, fromDate, toDate, rangeText }]
 */
export const buildCalendarReturns = (twrSeries, granularity, baseDate, asOf = new Date()) => {
  if (!twrSeries || twrSeries.length === 0 || !baseDate) return [];
  const keyOf = (iso) => (granularity === 'year' ? iso.slice(0, 4) : iso.slice(0, 7));
  const asOfIso = asOf.toISOString().slice(0, 10);

  // Last entry of each bucket, in order
  const buckets = [];
  for (const point of twrSeries) {
    const key = keyOf(point.date);
    const last = buckets[buckets.length - 1];
    if (last && last.key === key) {
      last.end = point;
    } else {
      buckets.push({ key, first: point, end: point });
    }
  }

  let prevCum = 0;
  let prevEndDate = baseDate;
  return buckets.map((b, index) => {
    const twr = (1 + b.end.cumulativeTWR) / (1 + prevCum) - 1;
    const startsInside = index === 0 && keyOf(baseDate) === b.key;
    const isRunning = keyOf(asOfIso) === b.key;
    const fromDate = index === 0 ? baseDate : prevEndDate;
    const toDate = b.end.date;
    prevCum = b.end.cumulativeTWR;
    prevEndDate = b.end.date;

    const label = granularity === 'year'
      ? b.key
      : `${MONTH_NAMES[Number(b.key.slice(5, 7)) - 1]} ${b.key.slice(0, 4)}`;
    const pct = twr * 100;
    return {
      key: b.key,
      label,
      twr,
      twrFormatted: `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`,
      isPositive: twr >= 0,
      isPartial: startsInside || isRunning,
      fromDate,
      toDate,
      rangeText: `${formatDayMonth(fromDate)} ${fromDate.slice(0, 4)} – ${formatDayMonth(toDate)} ${toDate.slice(0, 4)}${isRunning ? ' (to date)' : startsInside ? ' (from first valuation)' : ''}`
    };
  });
};
