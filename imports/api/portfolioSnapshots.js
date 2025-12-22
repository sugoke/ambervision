import { Mongo } from 'meteor/mongo';
import { SecuritiesMetadataCollection } from './securitiesMetadata';
import { PMSOperationsCollection } from './pmsOperations';

/**
 * Portfolio Snapshots Collection
 * Stores historical snapshots of portfolio values for performance tracking
 *
 * Each snapshot represents the total value of a portfolio at a specific point in time
 */
export const PortfolioSnapshotsCollection = new Mongo.Collection('portfolioSnapshots');

/**
 * Schema:
 * {
 *   _id: String,
 *   userId: String,                    // Owner of the portfolio
 *   bankId: String,                    // Bank identifier (e.g., "TEST_JULIUS_BAER")
 *   bankName: String,                  // Human-readable bank name
 *   connectionId: String,              // Bank connection identifier
 *   portfolioCode: String,             // Portfolio/account code (e.g., "5032826-1")
 *   accountNumber: String,             // Account number if available
 *
 *   snapshotDate: Date,                // Date of this snapshot
 *   fileDate: Date,                    // Date from the source file
 *   processingDate: Date,              // When this snapshot was created
 *   sourceFile: String,                // Source filename that generated this snapshot
 *
 *   // Portfolio value breakdown
 *   totalMarketValue: Number,          // Total market value of all positions
 *   totalCostBasis: Number,            // Total cost basis of all positions
 *   totalCapitalInvested: Number,      // Cumulative capital invested (deposits - withdrawals)
 *   unrealizedPnL: Number,             // Unrealized profit/loss
 *   unrealizedPnLPercent: Number,      // Unrealized P&L percentage
 *
 *   // Cash and total
 *   cashBalance: Number,               // Cash balance if available
 *   totalAccountValue: Number,         // Total account value (positions + cash)
 *
 *   // Position counts
 *   positionCount: Number,             // Number of positions in this snapshot
 *
 *   // Currency information
 *   currency: String,                  // Primary currency of the account
 *   hasMixedCurrencies: Boolean,       // Whether positions have multiple currencies
 *
 *   // Asset class breakdown
 *   assetClassBreakdown: {             // Value by asset class
 *     'Structured Products': Number,
 *     'Equities': Number,
 *     'Direct Bonds': Number,
 *     // ... other asset classes
 *   },
 *
 *   // Metadata
 *   version: Number,                   // Schema version
 *   createdAt: Date,                   // When this record was created
 *   updatedAt: Date                    // When this record was last updated
 * }
 */

// Indexes for efficient querying
if (Meteor.isServer) {
  PortfolioSnapshotsCollection.createIndexAsync({
    userId: 1,
    snapshotDate: -1
  });

  PortfolioSnapshotsCollection.createIndexAsync({
    userId: 1,
    portfolioCode: 1,
    snapshotDate: -1
  });

  PortfolioSnapshotsCollection.createIndexAsync({
    userId: 1,
    bankId: 1,
    snapshotDate: -1
  });

  // Unique index to prevent duplicate snapshots for same date
  PortfolioSnapshotsCollection.createIndexAsync({
    userId: 1,
    portfolioCode: 1,
    snapshotDate: 1
  }, {
    unique: true,
    sparse: true  // Allow multiple snapshots without portfolioCode (aggregated across all portfolios)
  });
}

/**
 * Helper functions for portfolio snapshots
 */
export const PortfolioSnapshotHelpers = {
  /**
   * Calculate total capital invested from cash flow operations
   * Sums deposits (CREDIT) minus withdrawals (DEBIT) up to a specific date
   */
  async calculateTotalCapitalInvested({ userId, portfolioCode, upToDate }) {
    console.log(`[CAPITAL_INVESTED] Calculating for userId: ${userId}, portfolio: ${portfolioCode}, upTo: ${upToDate}`);

    try {
      // Query for TRANSFER operations (deposits/withdrawals)
      const query = {
        userId,
        operationType: 'TRANSFER',
        operationCategory: 'CASH'
      };

      // Filter by portfolio if specified
      if (portfolioCode) {
        query.portfolioCode = portfolioCode;
      }

      // Filter by date if specified
      if (upToDate) {
        query.operationDate = { $lte: upToDate };
      }

      const operations = await PMSOperationsCollection.find(query, {
        sort: { operationDate: 1 }
      }).fetchAsync();

      console.log(`[CAPITAL_INVESTED] Found ${operations.length} transfer operations`);

      // Calculate cumulative capital invested
      let totalCapitalInvested = 0;

      for (const op of operations) {
        const debitCredit = op.bankSpecificData?.debitCredit || '';
        const amount = op.netAmount || 0;

        // CREDIT = money IN (deposit) → add to capital invested
        // DEBIT = money OUT (withdrawal) → subtract from capital invested
        if (debitCredit === 'CREDIT') {
          totalCapitalInvested += amount;
          console.log(`[CAPITAL_INVESTED] + ${amount} (CREDIT) on ${op.operationDate} → Total: ${totalCapitalInvested}`);
        } else if (debitCredit === 'DEBIT') {
          totalCapitalInvested -= amount;
          console.log(`[CAPITAL_INVESTED] - ${amount} (DEBIT) on ${op.operationDate} → Total: ${totalCapitalInvested}`);
        } else {
          console.log(`[CAPITAL_INVESTED] Unknown debit/credit type: ${debitCredit}, skipping`);
        }
      }

      console.log(`[CAPITAL_INVESTED] Final total capital invested: ${totalCapitalInvested}`);

      return totalCapitalInvested;
    } catch (error) {
      console.error('[CAPITAL_INVESTED] Error calculating total capital invested:', error);
      // Return 0 on error instead of throwing
      return 0;
    }
  },

  /**
   * Create a portfolio snapshot from current holdings
   */
  async createSnapshot({
    userId,
    bankId,
    bankName,
    connectionId,
    portfolioCode = null,  // null for aggregated snapshot across all portfolios
    accountNumber = null,
    snapshotDate,
    fileDate,
    sourceFile,
    holdings = []  // Array of position objects
  }) {
    // Separate cash positions from investment holdings
    const cashHoldings = holdings.filter(h => {
      const type = String(h.securityType || '').trim().toUpperCase();
      const name = (h.securityName || '').toLowerCase();
      return type === 'CASH' || type === '4' || name.includes('cash') || name.includes('money market');
    });

    const investmentHoldings = holdings.filter(h => {
      const type = String(h.securityType || '').trim().toUpperCase();
      const name = (h.securityName || '').toLowerCase();
      return !(type === 'CASH' || type === '4' || name.includes('cash') || name.includes('money market'));
    });

    // Calculate cash balance
    const cashBalance = cashHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);

    // Calculate totals for investment holdings (excluding cash)
    const totalMarketValue = investmentHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
    const totalCostBasis = investmentHoldings.reduce((sum, h) => {
      // Convert percentage prices to decimal (e.g., 100% → 1.0)
      const adjustedCostPrice = h.priceType === 'percentage'
        ? (h.costPrice || 0) / 100
        : (h.costPrice || 0);
      return sum + (h.quantity * adjustedCostPrice);
    }, 0);
    const unrealizedPnL = totalMarketValue - totalCostBasis;
    const unrealizedPnLPercent = totalCostBasis > 0 ? (unrealizedPnL / totalCostBasis) * 100 : 0;

    // Determine dominant currency
    const currencyCounts = holdings.reduce((counts, h) => {
      const curr = h.currency || 'USD';
      counts[curr] = (counts[curr] || 0) + 1;
      return counts;
    }, {});

    const currencies = Object.keys(currencyCounts);
    const dominantCurrency = currencies.length > 0
      ? currencies.reduce((a, b) => currencyCounts[a] > currencyCounts[b] ? a : b)
      : 'USD';
    const hasMixedCurrencies = currencies.length > 1;

    // Calculate asset class breakdown
    const assetClassBreakdown = {};

    // Pre-populate cash from cashHoldings (already filtered by securityType)
    // This ensures cash is always in the breakdown regardless of the heuristic loop
    if (cashBalance > 0) {
      assetClassBreakdown['cash'] = cashBalance;
    }

    // Create a map to store ISINs for batch lookup (only for investment holdings)
    const isins = investmentHoldings
      .map(h => h.isin)
      .filter(isin => isin && isin.trim());

    // Batch lookup all securities metadata
    const metadataMap = {};
    if (isins.length > 0) {
      const metadataRecords = await SecuritiesMetadataCollection.find({
        isin: { $in: isins }
      }).fetchAsync();

      metadataRecords.forEach(record => {
        metadataMap[record.isin] = record;
      });
    }

    // Process only investment holdings (cash is already handled above)
    investmentHoldings.forEach(h => {
      let assetClass = 'other'; // Default to 'other' (standardized value)
      let subClass = null;
      let underlyingType = null;
      let protectionType = null;

      // First, try to get asset class and sub-class from metadata
      if (h.isin && metadataMap[h.isin]) {
        const metadata = metadataMap[h.isin];
        if (metadata.assetClass) {
          assetClass = metadata.assetClass;
          subClass = metadata.assetSubClass;
          underlyingType = metadata.structuredProductUnderlyingType;
          protectionType = metadata.structuredProductProtectionType;
        }
      }

      // If no metadata, try the holding's own assetClass (from Ambervision enrichment)
      if (assetClass === 'other' && h.assetClass) {
        assetClass = h.assetClass;
        // Also try to get sub-class info from bankSpecificData
        if (h.bankSpecificData) {
          underlyingType = h.bankSpecificData.structuredProductUnderlyingType || underlyingType;
          protectionType = h.bankSpecificData.structuredProductProtectionType || protectionType;
        }
      }

      // If still 'other', fall back to heuristic detection using standardized values
      if (assetClass === 'other') {
        const type = String(h.securityType || '').trim().toLowerCase();
        const name = (h.securityName || '').toLowerCase();

        // STRUCTURED PRODUCTS - Check FIRST (before equity/bonds since some have misleading types)
        // Type 19 is Julius Baer's code for structured products/certificates
        const isStructuredByType = type === 'certificate' || type === 'structured' || type === '19';
        const isStructuredByIssuer = name.includes('sg issuer') || name.includes('julius baer express') ||
            name.includes('bnp paribas iss') || name.includes('raiffeisen ch') ||
            name.includes('banque intern') || name.includes('credit suisse ag') ||
            name.includes('credit agricole') || name.includes('citigroup') ||
            name.includes('ubs ag') || name.includes('vontobel');
        const isStructuredByName = name.includes('autocallable') || name.includes('phoenix') ||
            name.includes('orion') || name.includes('himalaya') || name.includes('reverse convertible') ||
            name.includes('bar.cap') || name.includes('barrier') || name.includes('express') ||
            name.includes('cap.prot') || name.includes('capital prot') ||
            (name.includes('cert') && !name.includes('certificate of deposit'));

        if (isStructuredByType || isStructuredByIssuer || isStructuredByName) {
          assetClass = 'structured_product';
          if (name.includes('capital guaranteed') || name.includes('cap.prot') ||
              name.includes('capital protection') || name.includes('100%')) {
            protectionType = 'capital_guaranteed_100';
          } else if (name.includes('bar.cap') || name.includes('barrier')) {
            protectionType = 'capital_protected_conditional';
          }
        } else if (type === '13' || name.includes('private equity') || name.includes('schroders capital') ||
            name.includes('kkr') || name.includes('blackstone')) {
          assetClass = 'private_equity';
        } else if (type === 'money_market_fund' || (name.includes('money market') && name.includes('fund'))) {
          assetClass = 'monetary_products';
        } else if (type === 'fund' || type === 'etf' || name.includes('sicav') || name.includes('ucits')) {
          assetClass = 'fund';
        } else if (type === '1' || type === 'equity' || type === 'stock') {
          assetClass = 'equity';
          if (name.includes('fund') || name.includes('etf')) {
            subClass = 'equity_fund';
          } else {
            subClass = 'direct_equity';
          }
        } else if (type === '2' || type === 'bond' || name.includes('treasury')) {
          assetClass = 'fixed_income';
          if (name.includes('fund')) {
            subClass = 'fixed_income_fund';
          } else {
            subClass = 'direct_bond';
          }
        } else if (type === 'cash') {
          assetClass = 'cash';
        } else if (type === 'term_deposit' || name.includes('term deposit') || name.includes('time deposit') || name.includes('fixed deposit')) {
          assetClass = 'time_deposit';
        } else if (name.includes('gold') || name.includes('commodity') || name.includes('metal')) {
          assetClass = 'commodities';
        }
      }

      // Build granular category key
      let categoryKey = assetClass;

      if (assetClass === 'structured_product') {
        // Prioritize protection type (capital guaranteed is most important)
        if (protectionType === 'capital_guaranteed_100') {
          categoryKey = 'structured_product_capital_guaranteed';
        } else if (protectionType === 'capital_guaranteed_partial') {
          categoryKey = 'structured_product_partial_guarantee';
        } else if (protectionType === 'capital_protected_conditional') {
          categoryKey = 'structured_product_barrier_protected';
        } else if (underlyingType) {
          // If no specific protection, use underlying type
          categoryKey = `structured_product_${underlyingType}`;
        }
        // Otherwise just 'structured_product'
      } else if (assetClass === 'equity' && subClass) {
        categoryKey = `equity_${subClass}`;
      } else if (assetClass === 'fixed_income' && subClass) {
        categoryKey = `fixed_income_${subClass}`;
      }
      // For cash, commodities, monetary_products, other: use base class as key

      assetClassBreakdown[categoryKey] = (assetClassBreakdown[categoryKey] || 0) + (h.marketValue || 0);
    });

    // Calculate total capital invested from cash flow operations
    const totalCapitalInvested = await this.calculateTotalCapitalInvested({
      userId,
      portfolioCode,
      upToDate: snapshotDate
    });

    // Create snapshot object
    const snapshot = {
      userId,
      bankId,
      bankName,
      connectionId,
      portfolioCode,
      accountNumber,
      snapshotDate,
      fileDate,
      processingDate: new Date(),
      sourceFile,
      totalMarketValue,
      totalCostBasis,
      totalCapitalInvested,
      unrealizedPnL,
      unrealizedPnLPercent,
      cashBalance,
      totalAccountValue: totalMarketValue + cashBalance,
      positionCount: investmentHoldings.length,  // Count only investment holdings (not cash)
      currency: dominantCurrency,
      hasMixedCurrencies,
      assetClassBreakdown,
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Normalize snapshotDate to midnight UTC to ensure one snapshot per day
    // This prevents duplicates when files are reprocessed at different times
    const normalizedSnapshotDate = new Date(snapshotDate);
    normalizedSnapshotDate.setUTCHours(0, 0, 0, 0);

    // Update the snapshot object with normalized date
    snapshot.snapshotDate = normalizedSnapshotDate;

    // Upsert snapshot (update if exists for same date, insert otherwise)
    const query = {
      userId,
      portfolioCode,
      snapshotDate: normalizedSnapshotDate
    };

    const existingSnapshot = await PortfolioSnapshotsCollection.findOneAsync(query);

    if (existingSnapshot) {
      await PortfolioSnapshotsCollection.updateAsync(query, {
        $set: {
          ...snapshot,
          updatedAt: new Date()
        }
      });

      console.log(`[SNAPSHOT] Updated snapshot for ${portfolioCode || 'ALL'} on ${snapshotDate.toISOString()}`);

      return {
        snapshotId: existingSnapshot._id,
        updated: true
      };
    } else {
      const snapshotId = await PortfolioSnapshotsCollection.insertAsync(snapshot);

      console.log(`[SNAPSHOT] Created new snapshot for ${portfolioCode || 'ALL'} on ${snapshotDate.toISOString()}`);

      return {
        snapshotId,
        updated: false
      };
    }
  },

  /**
   * Get portfolio snapshots for a date range
   */
  async getSnapshots({ userId, portfolioCode = null, startDate, endDate }) {
    const query = { userId };

    if (portfolioCode) {
      query.portfolioCode = portfolioCode;
    }

    if (startDate || endDate) {
      query.snapshotDate = {};
      if (startDate) query.snapshotDate.$gte = startDate;
      if (endDate) query.snapshotDate.$lte = endDate;
    }

    return await PortfolioSnapshotsCollection.find(query, {
      sort: { snapshotDate: 1 }
    }).fetchAsync();
  },

  /**
   * Get aggregated snapshots for a specific user across all their portfolios
   * Groups snapshots by date and sums values (prevents zigzag chart when user has multiple accounts)
   */
  async getAggregatedSnapshotsForUser({ userId, startDate, endDate }) {
    const query = { userId };

    if (startDate || endDate) {
      query.snapshotDate = {};
      if (startDate) query.snapshotDate.$gte = startDate;
      if (endDate) query.snapshotDate.$lte = endDate;
    }

    // Get all snapshots for this user across all portfolios
    const snapshots = await PortfolioSnapshotsCollection.find(query, {
      sort: { snapshotDate: 1 }
    }).fetchAsync();

    // Group by date and sum values
    const dateMap = {};
    snapshots.forEach(s => {
      const dateKey = s.snapshotDate.toISOString().split('T')[0];
      if (!dateMap[dateKey]) {
        dateMap[dateKey] = {
          snapshotDate: s.snapshotDate,
          totalAccountValue: 0,
          totalCostBasis: 0,
          totalCapitalInvested: 0,
          unrealizedPnL: 0,
          positionCount: 0
        };
      }
      dateMap[dateKey].totalAccountValue += s.totalAccountValue || 0;
      dateMap[dateKey].totalCostBasis += s.totalCostBasis || 0;
      dateMap[dateKey].totalCapitalInvested += s.totalCapitalInvested || 0;
      dateMap[dateKey].unrealizedPnL += s.unrealizedPnL || 0;
      dateMap[dateKey].positionCount += s.positionCount || 0;
    });

    // Calculate unrealizedPnLPercent for aggregated data
    const result = Object.values(dateMap).map(d => ({
      ...d,
      unrealizedPnLPercent: d.totalCostBasis > 0 ? (d.unrealizedPnL / d.totalCostBasis) * 100 : 0
    }));

    return result.sort((a, b) => a.snapshotDate - b.snapshotDate);
  },

  /**
   * Calculate performance for a user across all portfolios (aggregated by date)
   * Prevents incorrect calculations when user has multiple accounts
   */
  async calculatePerformanceForUser({ userId, startDate, endDate }) {
    const snapshots = await this.getAggregatedSnapshotsForUser({ userId, startDate, endDate });

    if (snapshots.length === 0) {
      return null;
    }

    const firstSnapshot = snapshots[0];
    const lastSnapshot = snapshots[snapshots.length - 1];

    const initialValue = firstSnapshot.totalAccountValue;
    const finalValue = lastSnapshot.totalAccountValue;
    const totalReturn = finalValue - initialValue;
    const totalReturnPercent = initialValue > 0 ? (totalReturn / initialValue) * 100 : 0;

    const periodReturns = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];
      if (prev.totalAccountValue > 0) {
        const periodReturn = ((curr.totalAccountValue - prev.totalAccountValue) / prev.totalAccountValue) * 100;
        periodReturns.push(periodReturn);
      }
    }

    const avgPeriodReturn = periodReturns.length > 0
      ? periodReturns.reduce((sum, r) => sum + r, 0) / periodReturns.length
      : 0;

    return {
      startDate: firstSnapshot.snapshotDate,
      endDate: lastSnapshot.snapshotDate,
      initialValue,
      finalValue,
      totalReturn,
      totalReturnPercent,
      avgPeriodReturn,
      snapshots,
      dataPoints: snapshots.length
    };
  },

  /**
   * Get aggregated asset allocation for a user across all portfolios
   * Merges assetClassBreakdown from all portfolios for the target date
   */
  async getAggregatedAssetAllocationForUser({ userId, targetDate }) {
    // Get all snapshots for this user up to target date
    const snapshots = await PortfolioSnapshotsCollection.find({
      userId,
      snapshotDate: { $lte: targetDate }
    }, {
      sort: { snapshotDate: -1 }
    }).fetchAsync();

    if (snapshots.length === 0) {
      return null;
    }

    // Get the most recent date available
    const latestDate = snapshots[0].snapshotDate.toISOString().split('T')[0];

    // Get all snapshots for that date (one per portfolio)
    const latestSnapshots = snapshots.filter(s =>
      s.snapshotDate.toISOString().split('T')[0] === latestDate
    );

    // Merge asset class breakdowns
    const mergedBreakdown = {};
    let totalValue = 0;

    latestSnapshots.forEach(s => {
      totalValue += s.totalAccountValue || 0;
      if (s.assetClassBreakdown) {
        Object.entries(s.assetClassBreakdown).forEach(([key, value]) => {
          mergedBreakdown[key] = (mergedBreakdown[key] || 0) + (value || 0);
        });
      }
    });

    return {
      snapshotDate: latestSnapshots[0].snapshotDate,
      totalAccountValue: totalValue,
      assetClassBreakdown: mergedBreakdown
    };
  },

  /**
   * Get aggregated snapshots across ALL clients (for admin "all clients" view)
   * Groups snapshots by date and sums values across all portfolios
   */
  async getAggregatedSnapshots({ startDate, endDate }) {
    const query = {};

    if (startDate || endDate) {
      query.snapshotDate = {};
      if (startDate) query.snapshotDate.$gte = startDate;
      if (endDate) query.snapshotDate.$lte = endDate;
    }

    // Get all snapshots across all users/portfolios
    const snapshots = await PortfolioSnapshotsCollection.find(query, {
      sort: { snapshotDate: 1 }
    }).fetchAsync();

    // Group by date and sum values (skip weekends - banks don't report on weekends)
    const dateMap = {};
    snapshots.forEach(s => {
      // Skip weekends (Sunday = 0, Saturday = 6) - incomplete data causes chart dips
      const dayOfWeek = s.snapshotDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        return;
      }

      const dateKey = s.snapshotDate.toISOString().split('T')[0];
      if (!dateMap[dateKey]) {
        dateMap[dateKey] = {
          snapshotDate: s.snapshotDate,
          totalAccountValue: 0,
          totalCostBasis: 0,
          totalCapitalInvested: 0,
          unrealizedPnL: 0,
          positionCount: 0
        };
      }
      dateMap[dateKey].totalAccountValue += s.totalAccountValue || 0;
      dateMap[dateKey].totalCostBasis += s.totalCostBasis || 0;
      dateMap[dateKey].totalCapitalInvested += s.totalCapitalInvested || 0;
      dateMap[dateKey].unrealizedPnL += s.unrealizedPnL || 0;
      dateMap[dateKey].positionCount += s.positionCount || 0;
    });

    // Calculate unrealizedPnLPercent for aggregated data
    const result = Object.values(dateMap).map(d => ({
      ...d,
      unrealizedPnLPercent: d.totalCostBasis > 0 ? (d.unrealizedPnL / d.totalCostBasis) * 100 : 0
    }));

    return result.sort((a, b) => a.snapshotDate - b.snapshotDate);
  },

  /**
   * Calculate performance metrics for a date range
   */
  async calculatePerformance({ userId, portfolioCode = null, startDate, endDate }) {
    const snapshots = await this.getSnapshots({ userId, portfolioCode, startDate, endDate });

    if (snapshots.length === 0) {
      return null;
    }

    const firstSnapshot = snapshots[0];
    const lastSnapshot = snapshots[snapshots.length - 1];

    const initialValue = firstSnapshot.totalAccountValue;
    const finalValue = lastSnapshot.totalAccountValue;
    const totalReturn = finalValue - initialValue;
    const totalReturnPercent = initialValue > 0 ? (totalReturn / initialValue) * 100 : 0;

    // Calculate time-weighted return (simple average for now)
    const periodReturns = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];

      if (prev.totalAccountValue > 0) {
        const periodReturn = ((curr.totalAccountValue - prev.totalAccountValue) / prev.totalAccountValue) * 100;
        periodReturns.push(periodReturn);
      }
    }

    const avgPeriodReturn = periodReturns.length > 0
      ? periodReturns.reduce((sum, r) => sum + r, 0) / periodReturns.length
      : 0;

    return {
      startDate: firstSnapshot.snapshotDate,
      endDate: lastSnapshot.snapshotDate,
      initialValue,
      finalValue,
      totalReturn,
      totalReturnPercent,
      avgPeriodReturn,
      snapshots,
      dataPoints: snapshots.length
    };
  },

  /**
   * Calculate aggregated performance metrics across ALL clients (for admin view)
   */
  async calculateAggregatedPerformance({ startDate, endDate }) {
    const snapshots = await this.getAggregatedSnapshots({ startDate, endDate });

    if (snapshots.length === 0) {
      return null;
    }

    const firstSnapshot = snapshots[0];
    const lastSnapshot = snapshots[snapshots.length - 1];

    const initialValue = firstSnapshot.totalAccountValue;
    const finalValue = lastSnapshot.totalAccountValue;
    const totalReturn = finalValue - initialValue;
    const totalReturnPercent = initialValue > 0 ? (totalReturn / initialValue) * 100 : 0;

    // Calculate time-weighted return (simple average for now)
    const periodReturns = [];
    for (let i = 1; i < snapshots.length; i++) {
      const prev = snapshots[i - 1];
      const curr = snapshots[i];

      if (prev.totalAccountValue > 0) {
        const periodReturn = ((curr.totalAccountValue - prev.totalAccountValue) / prev.totalAccountValue) * 100;
        periodReturns.push(periodReturn);
      }
    }

    const avgPeriodReturn = periodReturns.length > 0
      ? periodReturns.reduce((sum, r) => sum + r, 0) / periodReturns.length
      : 0;

    return {
      startDate: firstSnapshot.snapshotDate,
      endDate: lastSnapshot.snapshotDate,
      initialValue,
      finalValue,
      totalReturn,
      totalReturnPercent,
      avgPeriodReturn,
      snapshots,
      dataPoints: snapshots.length
    };
  }
};
