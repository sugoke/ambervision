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
 *
 * @param {Array} dailyValues - Sorted array of { date, totalValueEUR }
 * @param {Object} dailyFlows - Map of date -> net EUR flow
 * @returns {Array} Array of { date, dailyReturn, cumulativeTWR, vStart, vEnd, cashFlow }
 */
export const calculateDailyTWR = (dailyValues, dailyFlows) => {
  if (!dailyValues || dailyValues.length < 2) return [];

  const results = [];
  let cumulativeProduct = 1;

  for (let i = 1; i < dailyValues.length; i++) {
    const vStart = dailyValues[i - 1].totalValueEUR;
    const vEnd = dailyValues[i].totalValueEUR;
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

    const dailyReturn = (vEnd - vStart - cf) / denominator;
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
