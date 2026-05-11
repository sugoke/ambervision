import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { PortfolioSnapshotHelpers } from '../../imports/api/portfolioSnapshots.js';
import { getAssetClassLabel, getGranularCategoryLabel } from '../../imports/api/securitiesMetadata.js';

/**
 * Validate session and get user
 */
async function validateSession(sessionId) {
  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  return user;
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

    const user = await validateSession(sessionId);

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
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const user = await validateSession(sessionId);

    console.log(`[PERFORMANCE] Getting period performance for user: ${user.username}, viewAs: ${viewAsFilter ? viewAsFilter.type : 'none'}`);

    const now = new Date();

    // Check if admin viewing all clients (no filter)
    const isAdminAllClients = (user.role === 'admin' || user.role === 'superadmin') && !viewAsFilter;

    // Determine target userId and portfolioCode based on viewAsFilter
    let targetUserId = user._id;
    let targetPortfolioCode = portfolioCode;

    if (viewAsFilter && (user.role === 'admin' || user.role === 'superadmin')) {
      const { BankAccountsCollection } = await import('../../imports/api/bankAccounts.js');

      if (viewAsFilter.type === 'client') {
        targetUserId = viewAsFilter.id;
        // Only reset portfolioCode if not explicitly provided
        // (allows selecting specific account within a client view)
        if (!portfolioCode) {
          targetPortfolioCode = null;
        }
      } else if (viewAsFilter.type === 'account') {
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          targetUserId = bankAccount.userId;
          targetPortfolioCode = bankAccount.accountNumber;
        }
      }
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
   * Get portfolio value chart data
   */
  async 'performance.getChartData'({ sessionId, portfolioCode = null, startDate = null, endDate = null, viewAsFilter = null }) {
    check(sessionId, String);
    check(portfolioCode, Match.OneOf(String, null, undefined));
    check(startDate, Match.OneOf(String, Date, null, undefined));
    check(endDate, Match.OneOf(String, Date, null, undefined));
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const user = await validateSession(sessionId);

    console.log(`[PERFORMANCE] Getting chart data for user: ${user.username}, viewAs: ${viewAsFilter ? viewAsFilter.type : 'none'}`);

    // Convert dates if needed
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    let snapshots;

    // Admin/SuperAdmin without filter = aggregate ALL clients
    if ((user.role === 'admin' || user.role === 'superadmin') && !viewAsFilter) {
      console.log(`[PERFORMANCE] Admin view: aggregating all clients`);
      snapshots = await PortfolioSnapshotHelpers.getAggregatedSnapshots({
        startDate: start,
        endDate: end
      });
    } else {
      // Account-centric approach: resolve portfolio codes from accounts
      const { BankAccountsCollection } = await import('../../imports/api/bankAccounts.js');
      const { ClientEntitiesCollection } = await import('../../imports/api/clientEntities.js');
      const { PortfolioSnapshotsCollection } = await import('../../imports/api/portfolioSnapshots.js');

      let targetPortfolioCodes = portfolioCode ? [portfolioCode] : null;

      if (viewAsFilter && (user.role === 'admin' || user.role === 'superadmin' || user.role === 'rm' || user.role === 'assistant')) {
        if (viewAsFilter.type === 'entity') {
          if (!portfolioCode) {
            const entityAccounts = await BankAccountsCollection.find(
              { $or: [{ entityId: viewAsFilter.id }, { beneficialOwnerIds: viewAsFilter.id }, { beneficialOwnerId: viewAsFilter.id }], isActive: true },
              { fields: { accountNumber: 1 } }
            ).fetchAsync();
            targetPortfolioCodes = entityAccounts.map(a => a.accountNumber);
          }
        } else if (viewAsFilter.type === 'client') {
          if (!portfolioCode) {
            const clientAccounts = await BankAccountsCollection.find(
              { $or: [{ userId: viewAsFilter.id }, { entityId: viewAsFilter.id }], isActive: true },
              { fields: { accountNumber: 1 } }
            ).fetchAsync();
            targetPortfolioCodes = clientAccounts.map(a => a.accountNumber);
          }
        } else if (viewAsFilter.type === 'account') {
          const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
          if (bankAccount) {
            targetPortfolioCodes = [bankAccount.accountNumber];
          } else {
            return { hasData: false, labels: [], datasets: [] };
          }
        }
      } else if (!portfolioCode) {
        // Current user's own accounts
        const entity = await ClientEntitiesCollection.findOneAsync({ migratedFromUserId: user._id, isActive: true });
        const accountQuery = entity
          ? { $or: [{ entityId: entity._id }, { userId: user._id }], isActive: true }
          : { userId: user._id, isActive: true };
        const ownAccounts = await BankAccountsCollection.find(accountQuery, { fields: { accountNumber: 1 } }).fetchAsync();
        targetPortfolioCodes = ownAccounts.map(a => a.accountNumber);
      }

      console.log(`[PERFORMANCE] Target portfolioCodes: ${targetPortfolioCodes?.join(',') || 'none'}`);

      // Query snapshots directly by portfolioCode
      if (targetPortfolioCodes && targetPortfolioCodes.length > 0) {
        const snapshotQuery = {
          portfolioCode: targetPortfolioCodes.length === 1 ? targetPortfolioCodes[0] : { $in: targetPortfolioCodes }
        };
        if (start) snapshotQuery.snapshotDate = { ...(snapshotQuery.snapshotDate || {}), $gte: start };
        if (end) snapshotQuery.snapshotDate = { ...(snapshotQuery.snapshotDate || {}), $lte: end };

        const rawSnapshots = await PortfolioSnapshotsCollection.find(snapshotQuery, { sort: { snapshotDate: 1 } }).fetchAsync();

        if (targetPortfolioCodes.length > 1 && rawSnapshots.length > 0) {
          const byDate = {};
          for (const snap of rawSnapshots) {
            const dateKey = snap.snapshotDate.toISOString().split('T')[0];
            if (!byDate[dateKey]) {
              byDate[dateKey] = { ...snap };
            } else {
              byDate[dateKey].totalAccountValue = (byDate[dateKey].totalAccountValue || 0) + (snap.totalAccountValue || 0);
              byDate[dateKey].cashBalance = (byDate[dateKey].cashBalance || 0) + (snap.cashBalance || 0);
              byDate[dateKey].totalMarketValue = (byDate[dateKey].totalMarketValue || 0) + (snap.totalMarketValue || 0);
            }
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

    return {
      hasData: true,
      labels,
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
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const user = await validateSession(sessionId);

    // Determine target userId and portfolioCode based on viewAsFilter
    let targetUserId = user._id;
    let targetPortfolioCode = portfolioCode;

    if (viewAsFilter && (user.role === 'admin' || user.role === 'superadmin')) {
      const { BankAccountsCollection } = await import('../../imports/api/bankAccounts.js');

      if (viewAsFilter.type === 'client') {
        targetUserId = viewAsFilter.id;
        targetPortfolioCode = null;
      } else if (viewAsFilter.type === 'account') {
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          targetUserId = bankAccount.userId;
          targetPortfolioCode = bankAccount.accountNumber;
        }
      }
    }

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
    check(portfolioCode, Match.Optional(String));
    check(limit, Match.Optional(Number));

    const user = await validateSession(sessionId);

    console.log(`[SNAPSHOTS] Getting available dates for user: ${user.username}`);

    try {
      const { PortfolioSnapshotsCollection } = await import('../../imports/api/portfolioSnapshots.js');

      // Build query
      const query = { userId: user._id };
      if (portfolioCode) {
        query.portfolioCode = portfolioCode;
      }

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
  async 'performance.calculateTWR'({ sessionId, portfolioCode = null, viewAsFilter = null }) {
    check(sessionId, String);
    check(portfolioCode, Match.OneOf(String, null, undefined));
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const user = await validateSession(sessionId);

    const now = new Date();
    const isAdminAllClients = (user.role === 'admin' || user.role === 'superadmin') && !viewAsFilter;

    // Resolve target portfolio codes — account-centric approach (no userId dependency)
    const { BankAccountsCollection } = await import('../../imports/api/bankAccounts.js');
    const { ClientEntitiesCollection } = await import('../../imports/api/clientEntities.js');
    const { PortfolioSnapshotsCollection } = await import('../../imports/api/portfolioSnapshots.js');

    let targetPortfolioCodes = portfolioCode ? [portfolioCode] : null;

    if (viewAsFilter && (user.role === 'admin' || user.role === 'superadmin' || user.role === 'rm' || user.role === 'assistant')) {
      if (viewAsFilter.type === 'entity') {
        // Get all account numbers where entity is owner OR beneficial owner
        const entityAccounts = await BankAccountsCollection.find(
          { $or: [{ entityId: viewAsFilter.id }, { beneficialOwnerIds: viewAsFilter.id }, { beneficialOwnerId: viewAsFilter.id }], isActive: true },
          { fields: { accountNumber: 1 } }
        ).fetchAsync();
        if (!portfolioCode) {
          targetPortfolioCodes = entityAccounts.map(a => a.accountNumber);
        }
      } else if (viewAsFilter.type === 'client') {
        // Get all account numbers for this user
        if (!portfolioCode) {
          const clientAccounts = await BankAccountsCollection.find(
            { $or: [{ userId: viewAsFilter.id }, { entityId: viewAsFilter.id }], isActive: true },
            { fields: { accountNumber: 1 } }
          ).fetchAsync();
          targetPortfolioCodes = clientAccounts.map(a => a.accountNumber);
        }
      } else if (viewAsFilter.type === 'account') {
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          targetPortfolioCodes = [bankAccount.accountNumber];
        }
      }
    } else if (!isAdminAllClients && !portfolioCode) {
      // Current user's own accounts (client or RM viewing own)
      const entity = await ClientEntitiesCollection.findOneAsync({ migratedFromUserId: user._id, isActive: true });
      const accountQuery = entity
        ? { $or: [{ entityId: entity._id }, { userId: user._id }], isActive: true }
        : { userId: user._id, isActive: true };
      const ownAccounts = await BankAccountsCollection.find(accountQuery, { fields: { accountNumber: 1 } }).fetchAsync();
      targetPortfolioCodes = ownAccounts.map(a => a.accountNumber);
    }

    console.log(`[TWR] Calculating for user: ${user.username}, portfolioCodes: ${targetPortfolioCodes?.join(',') || 'ALL'}, adminAll: ${isAdminAllClients}`);

    // 1. Fetch snapshots by portfolio codes (account-centric)
    let snapshots;
    if (isAdminAllClients) {
      snapshots = await PortfolioSnapshotHelpers.getAggregatedSnapshots({
        startDate: null,
        endDate: now
      });
    } else if (targetPortfolioCodes && targetPortfolioCodes.length > 0) {
      const snapshotQuery = {};
      if (targetPortfolioCodes.length === 1) {
        snapshotQuery.portfolioCode = targetPortfolioCodes[0];
      } else {
        snapshotQuery.portfolioCode = { $in: targetPortfolioCodes };
      }
      if (now) snapshotQuery.snapshotDate = { $lte: now };

      console.log(`[TWR] Snapshot query: ${JSON.stringify(snapshotQuery)}`);

      const rawSnapshots = await PortfolioSnapshotsCollection.find(snapshotQuery, {
        sort: { snapshotDate: 1 }
      }).fetchAsync();

      console.log(`[TWR] Found ${rawSnapshots.length} raw snapshots`);

      // Aggregate by date if multiple accounts
      if (targetPortfolioCodes.length > 1 && rawSnapshots.length > 0) {
        const byDate = {};
        for (const snap of rawSnapshots) {
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

    const externalFlowTypes = [
      OPERATION_TYPES.TRANSFER_IN,
      OPERATION_TYPES.TRANSFER_OUT,
      OPERATION_TYPES.PAYMENT_IN,
      OPERATION_TYPES.PAYMENT_OUT
    ];

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

    // 4. Calculate TWR
    const {
      buildDailyValuesFromSnapshots,
      buildDailyFlowsFromOperations,
      calculateDailyTWR,
      annualizeTWR
    } = await import('../../imports/api/helpers/twrCalculator.js');

    const dailyValues = buildDailyValuesFromSnapshots(snapshots);
    const dailyFlows = buildDailyFlowsFromOperations(operations, ratesMap);
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

    const periodDefs = {
      '1M': new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      '3M': new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
      '6M': new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000),
      'YTD': new Date(now.getFullYear(), 0, 1),
      '1Y': new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
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

    console.log(`[TWR] Complete: ${twrSeries.length} data points, ALL TWR: ${formatTWR(lastEntry.cumulativeTWR)}, ${operations.length} external flows`);

    return {
      hasData: true,
      periods,
      chartData,
      metadata: {
        calculatedAt: new Date(),
        totalDays,
        firstSnapshotDate: dailyValues[0].date,
        lastSnapshotDate: lastEntry.date,
        externalFlowCount: operations.length
      }
    };
  }
});
