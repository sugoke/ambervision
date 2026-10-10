import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { PortfolioSnapshotHelpers, filterSnapshotsByBankStartDate, dedupeSnapshotsPerAccountDay } from '../../imports/api/portfolioSnapshots.js';
import { getAssetClassLabel, getGranularCategoryLabel } from '../../imports/api/securitiesMetadata.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { parseViewAs } from '../../imports/utils/viewAs.js';
import { requireSession } from '../helpers/sessionAuth.js';
import {
  resolveScope, holdingsSelector, snapshotsSelector, heldProductIds, isPortfolioCodeInScope
} from '../helpers/accessScope.js';
import { buildEURRatesMap, convertCurrency } from '../helpers/currencyHelpers.js';
import { snapshotValueCurrency } from '../../imports/api/helpers/twrCalculator.js';

const ViewAsArg = Match.OneOf(Match.ObjectIncluding({ type: String, id: String }), null, undefined);

/**
 * The viewer's scope for a (possibly narrowed) performance request. Throws
 * when the View As target is outside the caller's perimeter.
 */
async function scopeFor(user, viewAsFilter) {
  const scope = await resolveScope(user, parseViewAs(viewAsFilter));
  if (scope.denied) throw new Meteor.Error('not-authorized', 'Out of scope');
  return scope;
}

/**
 * Portfolio codes a request may read: the one asked for, if it belongs to an
 * account in scope, else every account in scope. Null for a see-all view.
 */
function portfolioCodesFor(scope, portfolioCode) {
  if (portfolioCode) {
    if (!isPortfolioCodeInScope(scope, null, portfolioCode)) {
      throw new Meteor.Error('not-authorized', 'Portfolio is outside your access scope');
    }
    return [portfolioCode];
  }
  if (scope.isAdmin) return null;
  return [...new Set(scope.bankAccounts.map(a => a.accountNumber).filter(Boolean))];
}

/**
 * Owner id the snapshot helpers key on for a View As target: the account's
 * owner, or the entity/client id (the helpers match `$or: [{ userId }, { entityId }]`).
 */
async function targetOwnerIdFor(scope, user) {
  if (!scope.viewAs) return user._id;
  if (scope.viewAs.type === 'account') {
    const account = scope.bankAccounts.find(a => a._id === scope.viewAs.id);
    return account ? (account.userId || account.entityId) : null;
  }
  return scope.viewAs.id;
}

// Snapshot amounts, each stored in its account's reference currency (snapshotValueCurrency)
const SNAPSHOT_AMOUNT_FIELDS = ['totalAccountValue', 'cashBalance', 'totalMarketValue', 'totalCostBasis', 'totalCapitalInvested', 'unrealizedPnL'];

/**
 * Express snapshots in `currency` at current spot rates, before any summing
 * across accounts. Returns null when a rate is missing, so the caller keeps the
 * original currencies rather than mislabelling unconverted amounts.
 */
async function convertSnapshots(snapshots, currency) {
  const ratesMap = await buildEURRatesMap();
  const converted = [];
  for (const snap of snapshots) {
    const out = { ...snap, currency, portfolioCurrency: currency };
    for (const field of SNAPSHOT_AMOUNT_FIELDS) {
      if (snap[field] === null || snap[field] === undefined) continue;
      const value = convertCurrency(snap[field], snapshotValueCurrency(snap), currency, ratesMap);
      if (value === null) return null;
      out[field] = value;
    }
    converted.push(out);
  }
  return converted;
}

Meteor.methods({
  /**
   * Get portfolio performance for a date range
   */
  async 'performance.calculate'({ sessionId, portfolioCode = null, startDate = null, endDate = null }) {
    check(sessionId, String);
    check(portfolioCode, Match.Optional(String));
    check(startDate, Match.Optional(Match.OneOf(String, Date, null)));
    check(endDate, Match.Optional(Match.OneOf(String, Date, null)));

    const user = await requireSession(sessionId);
    const scope = await scopeFor(user, null);
    portfolioCodesFor(scope, portfolioCode); // throws when the code is outside the scope

    console.log(`[PERFORMANCE] Calculating performance for user: ${user.username}`);

    // Convert dates if needed
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    // Calculate performance
    const performance = await PortfolioSnapshotHelpers.calculatePerformance({
      userId: user._id,
      portfolioCode,
      startDate: start,
      endDate: end
    });

    if (!performance) {
      return {
        hasData: false,
        message: 'No performance data available for the selected date range'
      };
    }

    return {
      hasData: true,
      ...performance
    };
  },

  /**
   * Get performance for predefined periods (1M, 3M, YTD, 1Y, All Time)
   */
  async 'performance.getPeriods'({ sessionId, portfolioCode = null, viewAsFilter = null }) {
    check(sessionId, String);
    check(portfolioCode, Match.OneOf(String, null, undefined));
    check(viewAsFilter, ViewAsArg);

    const user = await requireSession(sessionId);
    const scope = await scopeFor(user, viewAsFilter);
    portfolioCodesFor(scope, portfolioCode); // throws when the code is outside the scope

    console.log(`[PERFORMANCE] Getting period performance for user: ${user.username}, viewAs: ${scope.viewAs ? scope.viewAs.type : 'none'}`);

    const now = new Date();

    // A see-all view without View As aggregates every client
    const isAdminAllClients = scope.isAdmin;

    // Owner id the snapshot helpers key on (they match `$or: [{ userId }, { entityId }]`,
    // so an entity-only client resolves through its entity id); the account's
    // number when one account is drilled into.
    const targetUserId = await targetOwnerIdFor(scope, user);
    let targetPortfolioCode = portfolioCode;
    if (scope.viewAs?.type === 'account' && !portfolioCode) {
      targetPortfolioCode = scope.bankAccounts.find(a => a._id === scope.viewAs.id)?.accountNumber || null;
    }

    if (isAdminAllClients) {
      console.log(`[PERFORMANCE] Admin view: aggregating all clients for periods`);
    }

    // Define period start dates
    const periods = {
      '1M': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      '3M': new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
      '6M': new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000),
      'YTD': new Date(now.getFullYear(), 0, 1),  // Jan 1 of this year
      '1Y': new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
      'ALL': null  // All time
    };

    const results = {};

    for (const [periodName, startDate] of Object.entries(periods)) {
      try {
        let performance;

        if (isAdminAllClients) {
          // Use aggregated performance for admin "all clients" view
          performance = await PortfolioSnapshotHelpers.calculateAggregatedPerformance({
            startDate,
            endDate: now
          });
        } else if (targetPortfolioCode) {
          // Specific portfolio
          performance = await PortfolioSnapshotHelpers.calculatePerformance({
            userId: targetUserId,
            portfolioCode: targetPortfolioCode,
            startDate,
            endDate: now
          });
        } else {
          // All portfolios - use aggregated calculation to prevent incorrect returns
          performance = await PortfolioSnapshotHelpers.calculatePerformanceForUser({
            userId: targetUserId,
            startDate,
            endDate: now
          });
        }

        if (performance) {
          results[periodName] = {
            hasData: true,
            returnPercent: performance.totalReturnPercent,
            returnAmount: performance.totalReturn,
            initialValue: performance.initialValue,
            finalValue: performance.finalValue,
            dataPoints: performance.dataPoints
          };
        } else {
          results[periodName] = {
            hasData: false,
            returnPercent: 0,
            returnAmount: 0
          };
        }
      } catch (error) {
        console.error(`[PERFORMANCE] Error calculating ${periodName} performance: ${error.message}`);
        results[periodName] = {
          hasData: false,
          returnPercent: 0,
          returnAmount: 0,
          error: error.message
        };
      }
    }

    return results;
  },

  /**
   * Per-line period performance for the PMS holdings table.
   *
   * For each holding it returns the WTD / MTD / YTD price return
   * (mark-to-market: currentPrice / startPrice − 1) and that line's
   * value-change contribution to its booking portfolio's return over the
   * same period ((currentValue − startValue) / portfolioValueAtStart).
   * Summed over a booking portfolio (portfolioCode + portfolioCurrency),
   * the contributions reconcile to that portfolio's period return.
   *
   * Start prices/values come from the latest PMSHoldings snapshot with
   * snapshotDate <= periodStart. Positions with no snapshot before the
   * period start (opened mid-period) return null for that period.
   *
   * The caller passes the current holdings it received through the pmsHoldings
   * publication. uniqueKey is a predictable hash (bank | portfolio | ISIN), so
   * the keys are re-checked against the caller's access scope here and any
   * key outside it is dropped before a single price is looked up.
   *
   * @param {String}  sessionId
   * @param {Array}   holdings   [{ uniqueKey, portfolioCode, portfolioCurrency, currentPrice, currentValue }]
   * @param {Date}    asOfDate   period end reference (null = now / latest view)
   * @returns {Object} map uniqueKey -> { wtd, mtd, ytd: { returnPercent, contributionPercent } }
   */
  async 'performance.getHoldingPeriodPerformance'({ sessionId, holdings = [], asOfDate = null }) {
    check(sessionId, String);
    check(asOfDate, Match.OneOf(Date, String, null, undefined));
    check(holdings, [Match.ObjectIncluding({ uniqueKey: String })]);

    const user = await requireSession(sessionId);

    if (!holdings.length) return {};

    const requestedKeys = [...new Set(holdings.map(h => h.uniqueKey).filter(Boolean))];
    const scope = await scopeFor(user, null);
    const inScope = await PMSHoldingsCollection.find(
      { $and: [await holdingsSelector(scope), { uniqueKey: { $in: requestedKeys } }] },
      { fields: { uniqueKey: 1 } }
    ).fetchAsync();
    const allowedKeys = new Set(inScope.map(h => h.uniqueKey));
    holdings = holdings.filter(h => allowedKeys.has(h.uniqueKey));
    if (!holdings.length) return {};

    const uniqueKeys = [...allowedKeys];

    // Anchor the periods to the LATEST available data date (max snapshotDate of
    // the in-scope holdings), not wall-clock "today". The current prices we
    // compare against come from the latest bank file, so if that file is a few
    // days stale (e.g. it is Monday but the last file is Friday's), anchoring to
    // "today" would make WTD compare Friday-vs-Friday and read 0. Anchoring to
    // the data date makes WTD span the week that actually contains the data.
    let end;
    if (asOfDate) {
      end = new Date(asOfDate);
    } else {
      const latest = await PMSHoldingsCollection.rawCollection().aggregate([
        { $match: { uniqueKey: { $in: uniqueKeys } } },
        { $group: { _id: null, maxDate: { $max: '$snapshotDate' } } }
      ]).toArray();
      end = latest[0] && latest[0].maxDate ? new Date(latest[0].maxDate) : new Date();
    }

    // Period calendar starts relative to the end reference.
    // WTD = current ISO week (Monday 00:00), MTD = 1st of month, YTD = Jan 1.
    const weekStart = new Date(end);
    const daysSinceMonday = (weekStart.getDay() + 6) % 7; // Mon=0 .. Sun=6
    weekStart.setDate(weekStart.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);
    const monthStart = new Date(end.getFullYear(), end.getMonth(), 1);
    const yearStart = new Date(end.getFullYear(), 0, 1);

    // Baseline = last snapshot STRICTLY BEFORE the period's first day, i.e. the
    // prior period's closing value: WTD vs last week's close, MTD vs prior
    // month-end, YTD vs prior year-end. The exclusive cutoff (start − 1ms) stops
    // a snapshot dated on the period's first day (e.g. today, when it is a
    // Monday / the 1st) from becoming the baseline, which would make the period
    // read ~0 against the current price.
    const periods = {
      wtd: new Date(weekStart.getTime() - 1),
      mtd: new Date(monthStart.getTime() - 1),
      ytd: new Date(yearStart.getTime() - 1)
    };

    // For each period, fetch the latest snapshot version per uniqueKey on/before
    // the period start, returning its marketPrice + marketValue as the baseline.
    const startByPeriod = {};
    for (const [periodName, startDate] of Object.entries(periods)) {
      const rows = await PMSHoldingsCollection.rawCollection().aggregate([
        { $match: { uniqueKey: { $in: uniqueKeys }, snapshotDate: { $lte: startDate } } },
        { $sort: { uniqueKey: 1, snapshotDate: -1, version: -1 } },
        { $group: {
          _id: '$uniqueKey',
          startPrice: { $first: '$marketPrice' },
          startValue: { $first: '$marketValue' }
        } }
      ]).toArray();

      const byKey = {};
      for (const r of rows) byKey[r._id] = r;
      startByPeriod[periodName] = byKey;
    }

    // Fallback baseline: the EARLIEST snapshot per uniqueKey. When a position has
    // no snapshot on/before a period start (opened mid-period, or tracking began
    // after the period start), we carry the first available value forward instead
    // of leaving the period blank/zero.
    const earliestByKey = {};
    {
      const rows = await PMSHoldingsCollection.rawCollection().aggregate([
        { $match: { uniqueKey: { $in: uniqueKeys } } },
        { $sort: { uniqueKey: 1, snapshotDate: 1, version: 1 } },
        { $group: {
          _id: '$uniqueKey',
          startPrice: { $first: '$marketPrice' },
          startValue: { $first: '$marketValue' }
        } }
      ]).toArray();
      for (const r of rows) earliestByKey[r._id] = r;
    }

    // Baseline for a period = last snapshot on/before the period start, else the
    // earliest snapshot we have (carry-forward). null only if the holding has no
    // snapshot history at all.
    const baselineFor = (periodName, key) =>
      startByPeriod[periodName][key] || earliestByKey[key] || null;

    // Portfolio value at period start, grouped by portfolioCode|portfolioCurrency
    // (matches the export's "Weight in Portfolio %" grouping — currency-consistent).
    const pvStartByPeriod = {};
    for (const periodName of Object.keys(periods)) {
      const pv = {};
      for (const h of holdings) {
        const start = baselineFor(periodName, h.uniqueKey);
        if (!start || start.startValue == null) continue;
        const groupKey = `${h.portfolioCode || ''}|${h.portfolioCurrency || ''}`;
        pv[groupKey] = (pv[groupKey] || 0) + start.startValue;
      }
      pvStartByPeriod[periodName] = pv;
    }

    const result = {};
    for (const h of holdings) {
      if (!h.uniqueKey) continue;
      const groupKey = `${h.portfolioCode || ''}|${h.portfolioCurrency || ''}`;
      const perHolding = {};

      for (const periodName of Object.keys(periods)) {
        const start = baselineFor(periodName, h.uniqueKey);
        const pvStart = pvStartByPeriod[periodName][groupKey] || 0;

        let returnPercent = null;
        if (start && start.startPrice) {
          returnPercent = (h.currentPrice / start.startPrice - 1) * 100;
        }

        let contributionPercent = null;
        if (start && start.startValue != null && pvStart > 0) {
          contributionPercent = ((h.currentValue || 0) - start.startValue) / pvStart * 100;
        }

        perHolding[periodName] = { returnPercent, contributionPercent };
      }

      result[h.uniqueKey] = perHolding;
    }

    return result;
  },

  /**
   * Return the Products._id currently HELD within the given scope (actual bank
   * holdings, source of truth). Used by the Underlyings view to hide sold/matured
   * products. See server/helpers/holdingsScope.js.
   *
   * @param {String} sessionId
   * @param {Object|null} viewAsFilter
   * @returns {Promise<String[]>} held product ids
   */
  async 'holdings.getHeldProductIds'({ sessionId, viewAsFilter = null }) {
    check(sessionId, String);
    check(viewAsFilter, ViewAsArg);

    const user = await requireSession(sessionId);
    const scope = await resolveScope(user, parseViewAs(viewAsFilter));
    if (scope.denied) return [];
    return [...await heldProductIds(scope)];
  },

  /**
   * Get portfolio value chart data
   */
  async 'performance.getChartData'({ sessionId, portfolioCode = null, startDate = null, endDate = null, viewAsFilter = null, currency = null }) {
    check(sessionId, String);
    // Display currency: every snapshot is converted to it (current spot) before
    // accounts are summed. Without it, amounts stay in the snapshots' currencies.
    check(currency, Match.OneOf(String, null, undefined));
    check(portfolioCode, Match.OneOf(String, null, undefined));
    check(startDate, Match.OneOf(String, Date, null, undefined));
    check(endDate, Match.OneOf(String, Date, null, undefined));
    check(viewAsFilter, ViewAsArg);

    const user = await requireSession(sessionId);
    const scope = await scopeFor(user, viewAsFilter);

    console.log(`[PERFORMANCE] Getting chart data for user: ${user.username}, viewAs: ${scope.viewAs ? scope.viewAs.type : 'none'}`);

    // Convert dates if needed
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    let snapshots;
    let convertedAtSpot = false;

    // A see-all view without View As aggregates every client
    if (scope.isAdmin && !portfolioCode) {
      console.log(`[PERFORMANCE] Admin view: aggregating all clients`);
      snapshots = await PortfolioSnapshotHelpers.getAggregatedSnapshots({
        startDate: start,
        endDate: end
      });
    } else {
      // Account-centric approach: the portfolio codes of the accounts in scope
      // (or the one asked for, once it is known to be in scope).
      const { PortfolioSnapshotsCollection } = await import('../../imports/api/portfolioSnapshots.js');

      const targetPortfolioCodes = portfolioCodesFor(scope, portfolioCode);

      console.log(`[PERFORMANCE] Target portfolioCodes: ${targetPortfolioCodes?.join(',') || 'none'}`);

      // Query snapshots by portfolioCode, inside the owner clause so a code can
      // never read another client's account at a different bank
      if (targetPortfolioCodes && targetPortfolioCodes.length > 0) {
        const dateClause = {};
        if (start) dateClause.snapshotDate = { ...(dateClause.snapshotDate || {}), $gte: start };
        if (end) dateClause.snapshotDate = { ...(dateClause.snapshotDate || {}), $lte: end };
        const snapshotQuery = {
          $and: [
            await snapshotsSelector(scope),
            { portfolioCode: targetPortfolioCodes.length === 1 ? targetPortfolioCodes[0] : { $in: targetPortfolioCodes } },
            dateClause
          ]
        };

        const fetchedSnapshots = await PortfolioSnapshotsCollection.find(snapshotQuery, { sort: { snapshotDate: 1 } }).fetchAsync();
        // Exclude snapshots from banks with known bad historical pricing (e.g. CMB before 2026-01-09)
        let rawSnapshots = filterSnapshotsByBankStartDate(fetchedSnapshots);

        if (currency && rawSnapshots.some(snap => snapshotValueCurrency(snap) && snapshotValueCurrency(snap) !== currency)) {
          const converted = await convertSnapshots(rawSnapshots, currency);
          if (converted) {
            rawSnapshots = converted;
            convertedAtSpot = true;
          } else {
            console.warn(`[PERFORMANCE] Missing FX rate to show chart in ${currency}; keeping snapshot currencies`);
          }
        }

        if (targetPortfolioCodes.length > 1 && rawSnapshots.length > 0) {
          const byDate = {};
          // One row per account per day first: duplicates of the same file would be summed
          const perAccountDay = dedupeSnapshotsPerAccountDay(rawSnapshots);
          for (const snap of perAccountDay) {
            const dateKey = snap.snapshotDate.toISOString().split('T')[0];
            if (!byDate[dateKey]) {
              byDate[dateKey] = { ...snap };
            } else {
              byDate[dateKey].totalAccountValue = (byDate[dateKey].totalAccountValue || 0) + (snap.totalAccountValue || 0);
              byDate[dateKey].cashBalance = (byDate[dateKey].cashBalance || 0) + (snap.cashBalance || 0);
              byDate[dateKey].totalMarketValue = (byDate[dateKey].totalMarketValue || 0) + (snap.totalMarketValue || 0);
            }
          }
          // An account missing on a day (late file, credit line not regenerated)
          // keeps its last value, as in the TWR: summing only the accounts present
          // dropped a credit line's debt and spiked the curve
          const { buildConsolidatedDailyValues } = await import('../../imports/api/helpers/twrCalculator.js');
          const { dailyValues } = buildConsolidatedDailyValues(perAccountDay, (v) => v);
          for (const { date, totalValue } of dailyValues) {
            if (byDate[date]) byDate[date].totalAccountValue = totalValue;
          }
          snapshots = Object.values(byDate);
        } else if (rawSnapshots.length > 0) {
          // Single portfolioCode can still produce multiple snapshots per day when the
          // same account exists under different userIds/entities (e.g. bank migrations
          // or regenerated snapshots). Dedupe by date, preferring the userId whose
          // series is the longest — this preserves continuity with the dominant
          // daily-import series instead of zig-zagging between parallel writers.
          const userCounts = new Map();
          for (const snap of rawSnapshots) {
            userCounts.set(snap.userId, (userCounts.get(snap.userId) || 0) + 1);
          }
          const primaryUserId = [...userCounts.entries()]
            .sort((a, b) => b[1] - a[1])[0]?.[0];

          const byDate = new Map();
          for (const snap of rawSnapshots) {
            const dateKey = snap.snapshotDate.toISOString().split('T')[0];
            const existing = byDate.get(dateKey);
            if (!existing) {
              byDate.set(dateKey, snap);
              continue;
            }
            const existingIsPrimary = existing.userId === primaryUserId;
            const snapIsPrimary = snap.userId === primaryUserId;
            if (snapIsPrimary && !existingIsPrimary) {
              byDate.set(dateKey, snap);
            } else if (snapIsPrimary === existingIsPrimary) {
              const existingCreated = existing.createdAt ? existing.createdAt.getTime() : 0;
              const snapCreated = snap.createdAt ? snap.createdAt.getTime() : 0;
              if (snapCreated > existingCreated) byDate.set(dateKey, snap);
            }
          }
          snapshots = [...byDate.values()].sort((a, b) => a.snapshotDate - b.snapshotDate);
        } else {
          snapshots = rawSnapshots;
        }
      } else {
        snapshots = [];
      }
    }

    console.log(`[PERFORMANCE] Found ${snapshots.length} snapshots for chart`);

    if (snapshots.length === 0) {
      console.log(`[PERFORMANCE] No snapshots found - returning hasData: false`);
      return {
        hasData: false,
        labels: [],
        datasets: []
      };
    }

    // Prepare chart data
    const labels = snapshots.map(s => s.snapshotDate.toISOString().split('T')[0]);
    const values = snapshots.map(s => s.totalAccountValue);

    // The currency the amounts are in: the requested one once converted, else
    // the snapshots' own currency when they agree, else unknown (mixed).
    const snapshotCurrencies = [...new Set(snapshots.map(s => snapshotValueCurrency(s)).filter(Boolean))];
    const valueCurrency = convertedAtSpot ? currency
      : snapshotCurrencies.length === 1 ? snapshotCurrencies[0] : null;

    return {
      hasData: true,
      labels,
      valueCurrency,
      convertedAtSpot,
      datasets: [
        {
          label: 'Portfolio Value',
          data: values,
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          fill: true
        }
      ],
      snapshots: snapshots.map(s => ({
        date: s.snapshotDate,
        value: s.totalAccountValue,
        costBasis: s.totalCostBasis,
        capitalInvested: s.totalCapitalInvested || 0,
        unrealizedPnL: s.unrealizedPnL,
        unrealizedPnLPercent: s.unrealizedPnLPercent,
        positionCount: s.positionCount
      }))
    };
  },

  /**
   * Get asset allocation over time
   */
  async 'performance.getAssetAllocation'({ sessionId, portfolioCode = null, date = null, viewAsFilter = null }) {
    check(sessionId, String);
    check(portfolioCode, Match.OneOf(String, null, undefined));
    check(date, Match.OneOf(String, Date, null, undefined));
    check(viewAsFilter, ViewAsArg);

    const user = await requireSession(sessionId);
    const scope = await scopeFor(user, viewAsFilter);
    portfolioCodesFor(scope, portfolioCode); // throws when the code is outside the scope

    const targetUserId = await targetOwnerIdFor(scope, user);
    let targetPortfolioCode = portfolioCode;
    if (scope.viewAs?.type === 'account' && !portfolioCode) {
      targetPortfolioCode = scope.bankAccounts.find(a => a._id === scope.viewAs.id)?.accountNumber || null;
    }
    if (!targetUserId) return { hasData: false, assetClasses: [] };

    // Get the most recent snapshot for the specified date (or latest if no date)
    const targetDate = date ? new Date(date) : new Date();

    let latestSnapshot;

    if (targetPortfolioCode) {
      // Specific portfolio
      const snapshots = await PortfolioSnapshotHelpers.getSnapshots({
        userId: targetUserId,
        portfolioCode: targetPortfolioCode,
        startDate: null,
        endDate: targetDate
      });
      if (snapshots.length === 0) {
        return { hasData: false, assetClasses: [] };
      }
      latestSnapshot = snapshots[snapshots.length - 1];
    } else {
      // All portfolios - aggregate asset allocation across all accounts
      latestSnapshot = await PortfolioSnapshotHelpers.getAggregatedAssetAllocationForUser({
        userId: targetUserId,
        targetDate
      });
      if (!latestSnapshot) {
        return { hasData: false, assetClasses: [] };
      }
    }

    // Convert asset class breakdown to array format for charts
    const assetClasses = Object.entries(latestSnapshot.assetClassBreakdown).map(([categoryKey, value]) => ({
      name: getGranularCategoryLabel(categoryKey), // Convert granular category key to display label
      value,
      percentage: latestSnapshot.totalAccountValue > 0
        ? (value / latestSnapshot.totalAccountValue) * 100
        : 0
    }));

    // Sort by value descending
    assetClasses.sort((a, b) => b.value - a.value);

    return {
      hasData: true,
      assetClasses,
      totalValue: latestSnapshot.totalAccountValue,
      snapshotDate: latestSnapshot.snapshotDate
    };
  },

  /**
   * Get available snapshot dates for date selector
   */
  async 'snapshots.getAvailableDates'({ sessionId, portfolioCode = null, limit = 90 }) {
    check(sessionId, String);
    check(portfolioCode, Match.Maybe(String));
    check(limit, Match.Optional(Number));

    const user = await requireSession(sessionId);
    const scope = await scopeFor(user, null);
    portfolioCodesFor(scope, portfolioCode); // throws when the code is outside the scope

    console.log(`[SNAPSHOTS] Getting available dates for user: ${user.username}`);

    try {
      const { PortfolioSnapshotsCollection } = await import('../../imports/api/portfolioSnapshots.js');

      // Build query
      const query = { $and: [await snapshotsSelector(scope), portfolioCode ? { portfolioCode } : {}] };

      // Get distinct snapshot dates
      const snapshots = await PortfolioSnapshotsCollection.find(query, {
        sort: { snapshotDate: -1 },
        limit: limit,
        fields: { snapshotDate: 1 }
      }).fetchAsync();

      // Extract unique dates and format as ISO strings
      const uniqueDates = [...new Set(snapshots.map(s => s.snapshotDate.toISOString().split('T')[0]))];

      console.log(`[SNAPSHOTS] Found ${uniqueDates.length} available dates`);

      return {
        success: true,
        dates: uniqueDates,
        count: uniqueDates.length
      };
    } catch (error) {
      console.error('[SNAPSHOTS] Error getting available dates:', error);
      throw new Meteor.Error('get-dates-failed', error.message);
    }
  },

  /**
   * Calculate Time-Weighted Return (TWR) for a portfolio
   *
   * TWR neutralizes the effect of external cash flows (deposits/withdrawals)
   * by chain-linking daily sub-period returns.
   *
   * Returns pre-formatted data for all periods (1M, 3M, 6M, YTD, 1Y, ALL)
   * plus chart data rebased to 100.
   */
  async 'performance.calculateTWR'({ sessionId, portfolioCode = null, viewAsFilter = null, currency = null }) {
    check(sessionId, String);
    check(portfolioCode, Match.OneOf(String, null, undefined));
    check(currency, Match.OneOf(String, null, undefined));
    check(viewAsFilter, ViewAsArg);

    const user = await requireSession(sessionId);
    const scope = await scopeFor(user, viewAsFilter);

    const now = new Date();
    const isAdminAllClients = scope.isAdmin && !portfolioCode;

    // Portfolio codes of the accounts in scope (or the one asked for, once it is
    // known to be in scope); the owner clause keeps the query inside the scope.
    const targetPortfolioCodes = portfolioCodesFor(scope, portfolioCode);

    return computeTWR({
      codes: targetPortfolioCodes,
      portfolioCode,
      isAdminAllClients,
      ownerSelector: scope.isAdmin ? null : await snapshotsSelector(scope),
      currency,
      now,
      label: user.username
    });
  }
});

/**
 * Time-weighted return of a set of accounts, in one currency.
 * Shared by the PMS Performance tab (performance.calculateTWR) and the PDF
 * report, so both always show the same figures.
 *
 * @param {Array<String>} codes - portfolio codes (account numbers) of the perimeter
 * @param {String} portfolioCode - set when ONE account was picked explicitly:
 *        it is then measured even if it is not an investment account
 * @param {Boolean} isAdminAllClients - firm-wide aggregate
 * @param {Object|null} ownerSelector - the caller's snapshot scope clause (see
 *        accessScope.snapshotsSelector), ANDed into the snapshot query so a
 *        portfolio code can never read another client's account
 * @param {String} currency - currency to express the return in
 */
export async function computeTWR({ codes, portfolioCode = null, isAdminAllClients = false, ownerSelector = null, currency = null, now = new Date(), label = '' }) {
  const { BankAccountsCollection } = await import('../../imports/api/bankAccounts.js');
  const { PortfolioSnapshotsCollection } = await import('../../imports/api/portfolioSnapshots.js');
  let targetPortfolioCodes = codes ? [...codes] : null;
  // A client's performance is that of its investment accounts. Credit lines,
  // card and spending accounts carry no performance of their own, and their
  // card settlements and drawdowns would read as gains or losses. One account
  // picked explicitly (portfolioCode) is measured as asked.
  let perimeterAccounts = [];
  if (!isAdminAllClients && targetPortfolioCodes && targetPortfolioCodes.length > 0) {
    const { isInvestmentAccount } = await import('../../imports/api/bankAccounts.js');
    perimeterAccounts = await BankAccountsCollection.find(
      { accountNumber: { $in: targetPortfolioCodes }, isActive: true },
      { fields: { accountNumber: 1, comment: 1, referenceCurrency: 1, bankId: 1 } }
    ).fetchAsync();
    if (!portfolioCode) {
      const investmentCodes = perimeterAccounts.filter(isInvestmentAccount).map(a => a.accountNumber);
      if (investmentCodes.length > 0) targetPortfolioCodes = [...new Set(investmentCodes)];
    }
  }

  console.log(`[TWR] Calculating for user: ${label}, portfolioCodes: ${targetPortfolioCodes?.join(',') || 'ALL'}, adminAll: ${isAdminAllClients}`);

  // 1. Fetch snapshots by portfolio codes (account-centric)
  let snapshots;
  let rawSnapshotsForTWR = [];
  let coverageStarts = {};
  if (isAdminAllClients) {
    snapshots = await PortfolioSnapshotHelpers.getAggregatedSnapshots({
      startDate: null,
      endDate: now
    });
  } else if (targetPortfolioCodes && targetPortfolioCodes.length > 0) {
    const codeClause = {
      portfolioCode: targetPortfolioCodes.length === 1 ? targetPortfolioCodes[0] : { $in: targetPortfolioCodes }
    };
    if (now) codeClause.snapshotDate = { $lte: now };
    const snapshotQuery = ownerSelector ? { $and: [ownerSelector, codeClause] } : codeClause;

    console.log(`[TWR] Snapshot query: ${JSON.stringify(snapshotQuery)}`);

    const fetchedSnapshots = await PortfolioSnapshotsCollection.find(snapshotQuery, {
      sort: { snapshotDate: 1 }
    }).fetchAsync();

    // Exclude snapshots from banks with known bad historical pricing (e.g. CMB before 2026-01-09),
    // and those from before a bank's operations history: the flows between them are unknown
    const { getOperationsCoverageStarts, filterSnapshotsByOperationsCoverage } = await import('../helpers/operationsCoverage.js');
    coverageStarts = await getOperationsCoverageStarts(fetchedSnapshots.map(s => s.bankId));
    const rawSnapshots = filterSnapshotsByOperationsCoverage(filterSnapshotsByBankStartDate(fetchedSnapshots), coverageStarts);

    console.log(`[TWR] Found ${rawSnapshots.length} raw snapshots (filtered from ${fetchedSnapshots.length})`);

    rawSnapshotsForTWR = rawSnapshots;

    // Aggregate by date if multiple accounts
    if (targetPortfolioCodes.length > 1 && rawSnapshots.length > 0) {
      const byDate = {};
      // One row per account per day first: duplicates of the same file would be summed
      for (const snap of dedupeSnapshotsPerAccountDay(rawSnapshots)) {
        const dateKey = snap.snapshotDate.toISOString().split('T')[0];
        if (!byDate[dateKey]) {
          byDate[dateKey] = { ...snap, _aggregated: true };
        } else {
          byDate[dateKey].totalAccountValue = (byDate[dateKey].totalAccountValue || 0) + (snap.totalAccountValue || 0);
          byDate[dateKey].cashBalance = (byDate[dateKey].cashBalance || 0) + (snap.cashBalance || 0);
          byDate[dateKey].totalMarketValue = (byDate[dateKey].totalMarketValue || 0) + (snap.totalMarketValue || 0);
        }
      }
      snapshots = Object.values(byDate);
    } else {
      snapshots = rawSnapshots;
    }
  } else {
    snapshots = [];
  }

  const emptyResponse = {
    hasData: false,
    periods: {},
    chartData: { labels: [], datasets: [] },
    metadata: { calculatedAt: new Date() }
  };

  if (!snapshots || snapshots.length < 2) {
    console.log(`[TWR] Insufficient snapshots (${snapshots?.length || 0}), need at least 2`);
    return emptyResponse;
  }

  // 2. Fetch external cash flow operations
  const { PMSOperationsCollection } = await import('../../imports/api/pmsOperations.js');
  const { OPERATION_TYPES } = await import('../../imports/api/constants/operationTypes.js');

  const { PERIMETER_FLOW_TYPE_LIST } = await import('../../imports/api/helpers/twrCalculator.js');
  const externalFlowTypes = PERIMETER_FLOW_TYPE_LIST;

  const opsQuery = {
    operationType: { $in: externalFlowTypes }
  };

  if (!isAdminAllClients && targetPortfolioCodes && targetPortfolioCodes.length > 0) {
    opsQuery.portfolioCode = targetPortfolioCodes.length === 1
      ? targetPortfolioCodes[0]
      : { $in: targetPortfolioCodes };
  }

  const operations = await PMSOperationsCollection.find(opsQuery, {
    sort: { operationDate: 1 }
  }).fetchAsync();

  console.log(`[TWR] Found ${snapshots.length} snapshots, ${operations.length} external flows`);

  // 3. Build FX rates map
  const { CurrencyRateCacheCollection } = await import('../../imports/api/currencyCache.js');
  const { buildRatesMap, extractBankFxRates, mergeRatesMaps } = await import('../../imports/api/helpers/cashCalculator.js');

  const currencyRates = await CurrencyRateCacheCollection.find({}).fetchAsync();
  const eodRatesMap = buildRatesMap(currencyRates);

  // Get bank FX rates from recent holdings
  const { PMSHoldingsCollection } = await import('../../imports/api/pmsHoldings.js');
  const holdingsQuery = {};
  if (!isAdminAllClients && targetPortfolioCodes && targetPortfolioCodes.length > 0) {
    holdingsQuery.portfolioCode = targetPortfolioCodes.length === 1
      ? targetPortfolioCodes[0]
      : { $in: targetPortfolioCodes };
  }
  const recentHoldings = await PMSHoldingsCollection.find(holdingsQuery, {
    limit: 100,
    sort: { updatedAt: -1 }
  }).fetchAsync();

  const bankRates = extractBankFxRates(recentHoldings);
  const ratesMap = mergeRatesMaps(eodRatesMap, bankRates);

  // 4. Calculate TWR in ONE currency: the one asked for, else the accounts'
  // common currency, else the most frequent snapshot currency.
  const {
    buildConsolidatedDailyValues,
    buildConsolidatedDailyFlows,
    calculateDailyTWR,
    annualizeTWR,
    buildCalendarReturns
  } = await import('../../imports/api/helpers/twrCalculator.js');

  const snapshotCurrencyCounts = snapshots.reduce((acc, snap) => {
    const ccy = snapshotValueCurrency(snap);
    if (ccy) acc[ccy] = (acc[ccy] || 0) + 1;
    return acc;
  }, {});
  const twrCurrency = currency
    || Object.entries(snapshotCurrencyCounts).sort((a, b) => b[1] - a[1])[0]?.[0]
    || 'EUR';
  // ratesMap: currency -> EUR multiplier
  const eurPerUnit = (ccy) => (ccy === 'EUR' ? 1 : (ratesMap[ccy] || null));
  const convert = (amount, fromCurrency) => {
    if (!fromCurrency || fromCurrency === twrCurrency) return amount;
    const from = eurPerUnit(fromCurrency);
    const to = eurPerUnit(twrCurrency);
    return from && to ? amount * from / to : null;
  };

  // Banks that book signed amounts: their sign gives a flow's direction
  const flowBankIds = [...new Set(operations.map(op => op.bankId).filter(Boolean))];
  const signedBankIds = new Set();
  for (const bankId of flowBankIds) {
    const negative = await PMSOperationsCollection.findOneAsync(
      { bankId, operationType: { $in: externalFlowTypes }, netAmount: { $lt: 0 } },
      { fields: { _id: 1 } }
    );
    if (negative) signedBankIds.add(bankId);
  }

  const valuesResult = buildConsolidatedDailyValues(isAdminAllClients ? snapshots : rawSnapshotsForTWR, convert);
  const flowsResult = buildConsolidatedDailyFlows(operations, convert, signedBankIds);
  if (valuesResult.missingRate || flowsResult.missingRate) {
    console.warn(`[TWR] No FX rate for ${valuesResult.missingRate || flowsResult.missingRate} -> ${twrCurrency}`);
    return { ...emptyResponse, metadata: { ...emptyResponse.metadata, missingRate: valuesResult.missingRate || flowsResult.missingRate } };
  }
  const dailyValues = valuesResult.dailyValues;
  const dailyFlows = { ...flowsResult.dailyFlows };
  for (const [date, amount] of Object.entries(valuesResult.structuralFlows)) {
    dailyFlows[date] = (dailyFlows[date] || 0) + amount;
  }
  const twrSeries = calculateDailyTWR(dailyValues, dailyFlows);

  if (twrSeries.length === 0) {
    console.log(`[TWR] No TWR data points generated`);
    return emptyResponse;
  }

  // 5. Calculate period TWRs
  const lastEntry = twrSeries[twrSeries.length - 1];
  const firstDate = new Date(dailyValues[0].date);
  const lastDate = new Date(lastEntry.date);
  const totalDays = Math.ceil((lastDate - firstDate) / (1000 * 60 * 60 * 24));

  // Periods count back from the last valuation, not from the clock: the PMS
  // (called today) and the statement (as of its valuation date) then measure
  // the same days. Counting from today moved every start by a day or more.
  const anchor = lastDate;
  const periodDefs = {
    '1M': new Date(anchor.getTime() - 30 * 24 * 60 * 60 * 1000),
    '3M': new Date(anchor.getTime() - 90 * 24 * 60 * 60 * 1000),
    '6M': new Date(anchor.getTime() - 180 * 24 * 60 * 60 * 1000),
    'YTD': new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1)),
    '1Y': new Date(anchor.getTime() - 365 * 24 * 60 * 60 * 1000),
    'ALL': null
  };

  const formatTWR = (value) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;

  const periods = {};

  for (const [periodName, periodStart] of Object.entries(periodDefs)) {
    // ALL period: use total cumulative TWR
    if (periodName === 'ALL') {
      const twr = lastEntry.cumulativeTWR;
      const annualized = annualizeTWR(twr, totalDays);

      periods.ALL = {
        hasData: true,
        twr,
        twrFormatted: formatTWR(twr),
        startDate: dailyValues[0].date,
        measuredFrom: dailyValues[0].date,
        endDate: lastEntry.date,
        dataPoints: twrSeries.length,
        isAnnualized: annualized !== null,
        twrAnnualized: annualized,
        twrAnnualizedFormatted: annualized !== null
          ? `${formatTWR(annualized).replace('%', '% (ann.)')}`
          : null
      };
      continue;
    }

    const periodStartStr = periodStart.toISOString().split('T')[0];

    // Find the TWR entry closest to (but not after) the period start
    let startTWR = 0; // Default: reference point at the very beginning

    // Look for an entry at or before the period start date
    for (let i = twrSeries.length - 1; i >= 0; i--) {
      if (twrSeries[i].date <= periodStartStr) {
        startTWR = twrSeries[i].cumulativeTWR;
        break;
      }
    }

    // Check if we have any data in this period range
    const dataPointsInPeriod = twrSeries.filter(e => e.date >= periodStartStr).length;

    if (dataPointsInPeriod === 0) {
      periods[periodName] = {
        hasData: false,
        twr: 0,
        twrFormatted: 'N/A',
        startDate: periodStartStr,
        endDate: lastEntry.date,
        dataPoints: 0
      };
      continue;
    }

    // Chain-link: period TWR = (1 + endTWR) / (1 + startTWR) - 1
    const endTWR = lastEntry.cumulativeTWR;
    const periodTWR = (1 + endTWR) / (1 + startTWR) - 1;

    periods[periodName] = {
      hasData: true,
      twr: periodTWR,
      twrFormatted: formatTWR(periodTWR),
      startDate: periodStartStr,
      // The measure starts later than the period when the history does
      // (first valuation, or start of the bank's operations history)
      measuredFrom: dailyValues[0].date > periodStartStr ? dailyValues[0].date : periodStartStr,
      endDate: lastEntry.date,
      dataPoints: dataPointsInPeriod
    };
  }

  // 6. Build chart data (rebased to 100 from inception)
  const chartLabels = [dailyValues[0].date, ...twrSeries.map(r => r.date)];
  const chartValues = [100, ...twrSeries.map(r => 100 * (1 + r.cumulativeTWR))];

  const chartData = {
    labels: chartLabels,
    datasets: [{
      label: 'TWR Performance',
      data: chartValues,
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      fill: true,
      borderWidth: 2,
      pointRadius: 0,
      tension: 0.1
    }]
  };

  // 7. Calendar returns (per month / per year), chain-linked from the same daily
  // series so they multiply back to the cumulative TWR. Bar colors follow the
  // sign: the hex values of --gain-color / --loss-color (client/main.css).
  const monthlyReturns = buildCalendarReturns(twrSeries, 'month', dailyValues[0].date);
  const yearlyReturns = buildCalendarReturns(twrSeries, 'year', dailyValues[0].date);
  const GAIN_COLOR = '#57B891';
  const LOSS_COLOR = '#D9776B';
  const toBarChart = (rows) => ({
    labels: rows.map(r => (r.isPartial ? `${r.label}*` : r.label)),
    datasets: [{
      label: 'Time-weighted return',
      data: rows.map(r => Number((r.twr * 100).toFixed(2))),
      backgroundColor: rows.map(r => (r.isPositive ? GAIN_COLOR : LOSS_COLOR)),
      borderRadius: 3,
      maxBarThickness: 48
    }],
    // Per-bar text for the tooltip, already formatted
    tooltips: rows.map(r => ({ value: r.twrFormatted, range: r.rangeText, partial: r.isPartial }))
  });
  const calendarCharts = { monthly: toBarChart(monthlyReturns), yearly: toBarChart(yearlyReturns) };

  console.log(`[TWR] Complete: ${twrSeries.length} data points, ALL TWR: ${formatTWR(lastEntry.cumulativeTWR)}, ${operations.length} external flows`);

  return {
    hasData: true,
    periods,
    chartData,
    monthlyReturns,
    yearlyReturns,
    calendarCharts,
    metadata: {
      calculatedAt: new Date(),
      totalDays,
      firstSnapshotDate: dailyValues[0].date,
      lastSnapshotDate: lastEntry.date,
      externalFlowCount: operations.length,
      // bankId -> first day with known flows (ISO), for banks whose operations history starts later
      operationsCoverageStarts: Object.fromEntries(Object.entries(coverageStarts).map(([b, d]) => [b, d.toISOString().split('T')[0]])),
      currency: twrCurrency,
      // Accounts of the perimeter left out of the measure (credit lines, cards, spending)
      excludedAccounts: perimeterAccounts
        .filter(a => !targetPortfolioCodes?.includes(a.accountNumber))
        .map(a => ({ accountNumber: a.accountNumber, comment: a.comment || null }))
    }
  };
}
