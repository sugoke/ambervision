import { Mongo } from 'meteor/mongo';
import { SecuritiesMetadataCollection } from './securitiesMetadata';
import { getHoldingCategoryKey } from './assetClassification';
import { PMSOperationsCollection } from './pmsOperations';
import { PMSHoldingsCollection } from './pmsHoldings';

// Conditionally-protected ("barrier") structured products. The legacy key kept
// no underlying, so equity-linked products landed in it too and were counted as
// bonds; buildCategoryKey() now records the underlying alongside the protection.
const LEGACY_BARRIER_PROTECTED_KEY = 'structured_product_barrier_protected';
const EQUITY_LINKED_BARRIER_PROTECTED_KEY = 'structured_product_equity_linked_barrier_protected';

// Snapshots corrected per bulk write when reclassifying stored breakdowns.
const WRITE_BATCH_SIZE = 500;

/**
 * Portfolio Snapshots Collection
 * Stores historical snapshots of portfolio values for performance tracking
 *
 * Each snapshot represents the total value of a portfolio at a specific point in time
 */
export const PortfolioSnapshotsCollection = new Mongo.Collection('portfolioSnapshots');

/**
 * Bank-specific minimum valid snapshot dates.
 * Snapshots before these dates had incorrect pricing and should be excluded
 * from charts and performance calculations.
 * Key: bankId, Value: earliest valid date (inclusive)
 */
export const BANK_SNAPSHOT_START_DATES = {
  'LfngefkMppWQcqMnN': new Date('2026-01-09T00:00:00Z'), // CMB — prices corrected from Jan 9, 2026
};

/**
 * Filter out snapshots from banks with known bad historical data
 */
export function filterSnapshotsByBankStartDate(snapshots) {
  return snapshots.filter(s => {
    if (!s.bankId) return true;
    const minDate = BANK_SNAPSHOT_START_DATES[s.bankId];
    if (!minDate) return true;
    return s.snapshotDate >= minDate;
  });
}

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
   *
   * @param {Object} params
   * @param {string} params.userId - User ID
   * @param {string} params.portfolioCode - Portfolio code
   * @param {Date} params.upToDate - Calculate up to this date
   * @param {Array} [params.transferOpsCache] - Optional pre-fetched transfer operations to avoid repeated DB queries
   */
  async calculateTotalCapitalInvested({ userId, portfolioCode, upToDate, transferOpsCache }) {
    try {
      let operations;

      if (transferOpsCache) {
        // Use pre-fetched cache - filter by userId, portfolioCode, and date
        operations = transferOpsCache.filter(op => {
          if (op.userId !== userId) return false;
          if (portfolioCode && op.portfolioCode !== portfolioCode) return false;
          if (upToDate && op.operationDate > upToDate) return false;
          return true;
        }).sort((a, b) => a.operationDate - b.operationDate);
      } else {
        // No cache - query database (legacy path)
        console.log(`[CAPITAL_INVESTED] Calculating for userId: ${userId}, portfolio: ${portfolioCode}, upTo: ${upToDate}`);

        const query = {
          userId,
          operationType: 'TRANSFER',
          operationCategory: 'CASH'
        };

        if (portfolioCode) {
          query.portfolioCode = portfolioCode;
        }

        if (upToDate) {
          query.operationDate = { $lte: upToDate };
        }

        operations = await PMSOperationsCollection.find(query, {
          sort: { operationDate: 1 }
        }).fetchAsync();

        console.log(`[CAPITAL_INVESTED] Found ${operations.length} transfer operations`);
      }

      // Calculate cumulative capital invested
      let totalCapitalInvested = 0;

      for (const op of operations) {
        const debitCredit = op.bankSpecificData?.debitCredit || '';
        const amount = op.netAmount || 0;

        // CREDIT = money IN (deposit) → add to capital invested
        // DEBIT = money OUT (withdrawal) → subtract from capital invested
        if (debitCredit === 'CREDIT') {
          totalCapitalInvested += amount;
        } else if (debitCredit === 'DEBIT') {
          totalCapitalInvested -= amount;
        }
      }

      // Only log when there are actual operations (transfers are rare)
      if (operations.length > 0) {
        console.log(`[CAPITAL_INVESTED] ${portfolioCode}: ${operations.length} transfers → total: ${totalCapitalInvested}`);
      }

      return totalCapitalInvested;
    } catch (error) {
      console.error('[CAPITAL_INVESTED] Error calculating total capital invested:', error);
      // Return 0 on error instead of throwing
      return 0;
    }
  },

  /**
   * Split holdings into cash vs investment positions.
   * Cash is detected on the raw bank fields (not the enriched asset class) so
   * the split is identical whatever bank the file came from.
   * @param {Array} holdings
   * @returns {Object} { cashHoldings, investmentHoldings }
   */
  splitCashHoldings(holdings = []) {
    const isCash = (h) => {
      const type = String(h.securityType || '').trim().toUpperCase();
      const name = (h.securityName || '').toLowerCase();
      return type === 'CASH' || type === '4' || name.includes('cash') || name.includes('money market');
    };
    return {
      cashHoldings: holdings.filter(isCash),
      investmentHoldings: holdings.filter(h => !isCash(h))
    };
  },

  /**
   * Build the granular asset class breakdown for a set of holdings.
   * Classification itself lives in assetClassification.js, shared with the PMS
   * screen, the portfolio review generator and the pre-trade check, so a
   * position can never land in one bucket here and another one there.
   * @param {Array} holdings - Position objects (cash included; it is split out here)
   * @returns {Object} Map of category key -> market value
   */
  async buildAssetClassBreakdown(holdings = []) {
    const { cashHoldings, investmentHoldings } = this.splitCashHoldings(holdings);

    const assetClassBreakdown = {};

    // Pre-populate cash from cashHoldings (already filtered by securityType)
    // This ensures cash is always in the breakdown regardless of the classifier
    const cashBalance = cashHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
    if (cashBalance > 0) {
      assetClassBreakdown['cash'] = cashBalance;
    }

    // Batch lookup securities metadata for the investment holdings
    const isins = investmentHoldings
      .map(h => h.isin)
      .filter(isin => isin && isin.trim());

    const metadataMap = {};
    if (isins.length > 0) {
      const metadataRecords = await SecuritiesMetadataCollection.find({
        isin: { $in: isins }
      }).fetchAsync();

      metadataRecords.forEach(record => {
        metadataMap[record.isin] = record;
      });
    }

    investmentHoldings.forEach(h => {
      const categoryKey = getHoldingCategoryKey(h, h.isin ? metadataMap[h.isin] : null);
      assetClassBreakdown[categoryKey] = (assetClassBreakdown[categoryKey] || 0) + (h.marketValue || 0);
    });

    return assetClassBreakdown;
  },

  /**
   * The holdings on record for a snapshot's date: the newest record per
   * uniqueKey dated on or before the snapshot's day.
   *
   * A position is not restated in every bank file, and a snapshot can be
   * carried forward when a bank's file lags a day - so matching on the
   * snapshot's own day alone loses positions. This mirrors the historical
   * (asOfDate) PMS view: $top per uniqueKey rather than $sort + $group, which
   * blows MongoDB's 32MB sort limit during plan selection on this collection.
   *
   * @param {Object} snapshot - A portfolio snapshot document
   * @returns {Array} Holdings as of that snapshot's date, newest record per key
   */
  async getHoldingsAsOfDate(snapshot) {
    const dayEnd = new Date(snapshot.snapshotDate);
    dayEnd.setUTCHours(0, 0, 0, 0);
    dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

    // Scope to the snapshot's owner: several clients share the literal
    // portfolioCode 'CONSOLIDATED', so bank + code + date alone would merge them.
    const ownerSelector = snapshot.userId
      ? { userId: snapshot.userId }
      : (snapshot.entityId ? { entityId: snapshot.entityId } : {});

    const latestByKey = await PMSHoldingsCollection.rawCollection().aggregate([
      {
        $match: {
          portfolioCode: snapshot.portfolioCode,
          ...(snapshot.bankId ? { bankId: snapshot.bankId } : {}),
          ...ownerSelector,
          snapshotDate: { $lt: dayEnd }
        }
      },
      {
        $group: {
          _id: '$uniqueKey',
          top: {
            $top: {
              sortBy: { snapshotDate: -1, version: -1 },
              output: '$$ROOT'
            }
          }
        }
      }
    ], { allowDiskUse: true }).toArray();

    return latestByKey.map(doc => doc.top);
  },

  /**
   * Split holdings' conditionally-protected ("barrier") structured products by
   * underlying, using the shared classifier.
   * @param {Array} holdings
   * @param {Object} metadataByIsin
   * @returns {Object} { equityLinked, nonEquity } market values
   */
  splitBarrierProtectedByUnderlying(holdings, metadataByIsin) {
    let equityLinked = 0;
    let nonEquity = 0;

    holdings.forEach(h => {
      const key = getHoldingCategoryKey(h, h.isin ? metadataByIsin[h.isin] : null);
      if (key === LEGACY_BARRIER_PROTECTED_KEY) {
        nonEquity += h.marketValue || 0;
      } else if (key === EQUITY_LINKED_BARRIER_PROTECTED_KEY) {
        equityLinked += h.marketValue || 0;
      }
    });

    return { equityLinked, nonEquity };
  },

  /**
   * Reclassify the legacy structured-product key on existing snapshots.
   *
   * Snapshots written before the classifier was unified filed every
   * conditionally-protected ("barrier") structured product under
   * `structured_product_barrier_protected`, dropping the underlying - so an
   * equity-linked barrier product was counted as a bond. Allocation alerts and
   * the RM dashboard read the stored breakdown, so they keep reporting the old
   * classification until the snapshots are corrected.
   *
   * This only ever RE-BUCKETS: the stored amount is split between the equity
   * and non-equity keys and every other key keeps its stored value, so a
   * snapshot's total is unchanged by construction. Values are never rebuilt
   * from today's holdings - a position deactivated after a snapshot was taken
   * (a rollover, a stale-key reconcile) makes that unreproducible, and fixing
   * the classification must not rewrite history's numbers.
   *
   * How the split is resolved, in order of confidence:
   *   - `exact`     - the barrier holdings on record account for the stored
   *                   amount, so their split is the snapshot's split
   *   - `one-sided` - every barrier product on record shares one underlying
   *                   class, so the split is unambiguous whatever the amount
   *   - `siblings`  - a CONSOLIDATED roll-up takes the split of its per-account
   *                   snapshots for that day (its own holdings are duplicate
   *                   roll-up copies and would double count)
   *   - `apportioned` - mixed underlyings, holdings within 5% of the stored
   *                   amount: apportion by their mix
   * Anything less certain than that is left untouched and reported.
   *
   * @param {Object} params
   * @param {String} [params.portfolioCode] - Limit to one portfolio
   * @param {String} [params.bankId] - Limit to one bank
   * @param {Date} [params.since] - Only snapshots on/after this date
   * @param {Boolean} [params.dryRun=true] - Report without writing
   * @param {Number} [params.limit=20000] - Max snapshots to examine
   * @returns {Object} Counts by resolution basis plus a sample of the changes
   */
  async rebuildAssetClassBreakdowns({
    portfolioCode = null,
    bankId = null,
    since = null,
    dryRun = true,
    limit = 20000
  } = {}) {
    const selector = {
      [`assetClassBreakdown.${LEGACY_BARRIER_PROTECTED_KEY}`]: { $exists: true },
      ...(portfolioCode ? { portfolioCode } : {}),
      ...(bankId ? { bankId } : {}),
      ...(since ? { snapshotDate: { $gte: since } } : {})
    };

    const snapshots = await PortfolioSnapshotsCollection.find(selector, {
      sort: { snapshotDate: -1 },
      limit
    }).fetchAsync();

    const stats = {
      examined: snapshots.length,
      exact: 0,
      oneSided: 0,
      siblings: 0,
      apportioned: 0,
      unchangedAllNonEquity: 0,
      skippedNoBarrierHoldings: 0,
      skippedUncertainMix: 0
    };
    const samples = [];

    // Thousands of snapshots are corrected in one pass. Each Meteor updateAsync
    // costs a round trip plus observer work on every connected client, so the
    // corrections go out as unordered bulk writes instead.
    const pendingWrites = [];
    const reclassifiedAt = new Date();

    // The same positions recur across hundreds of daily snapshots - cache their
    // metadata rather than re-reading it per snapshot.
    const metadataByIsin = {};
    const metadataFetched = new Set();

    const loadMetadata = async (holdings) => {
      const missing = [...new Set(holdings
        .map(h => h.isin)
        .filter(isin => isin && isin.trim() && !metadataFetched.has(isin)))];
      if (missing.length === 0) return;
      missing.forEach(isin => metadataFetched.add(isin));
      const records = await SecuritiesMetadataCollection.find({
        isin: { $in: missing }
      }).fetchAsync();
      records.forEach(record => { metadataByIsin[record.isin] = record; });
    };

    // Per-account splits, keyed by owner|bank|day, so a CONSOLIDATED roll-up can
    // take the split of the accounts it rolls up.
    const dayKey = (snapshot) =>
      [
        snapshot.userId || snapshot.entityId || '',
        snapshot.bankId || '',
        new Date(snapshot.snapshotDate).toISOString().slice(0, 10)
      ].join('|');
    const perAccountSplits = new Map();

    // Per-account snapshots first: the roll-ups are resolved from them.
    const ordered = [
      ...snapshots.filter(s => s.portfolioCode !== 'CONSOLIDATED'),
      ...snapshots.filter(s => s.portfolioCode === 'CONSOLIDATED')
    ];

    for (const snapshot of ordered) {
      const storedLegacy = snapshot.assetClassBreakdown?.[LEGACY_BARRIER_PROTECTED_KEY] || 0;
      if (!storedLegacy) {
        stats.skippedNoBarrierHoldings++;
        continue;
      }

      const isConsolidated = snapshot.portfolioCode === 'CONSOLIDATED';
      let split = null;
      let basis = null;

      // A roll-up's own holdings are duplicate copies of the per-account ones -
      // reconstructing from them double counts. Use the accounts' split.
      if (isConsolidated) {
        const sibling = perAccountSplits.get(dayKey(snapshot));
        if (sibling && (sibling.equityLinked + sibling.nonEquity) > 0) {
          split = sibling;
          basis = 'siblings';
        }
      }

      if (!split) {
        const holdings = await this.getHoldingsAsOfDate(snapshot);
        await loadMetadata(holdings);

        // Prefer the active positions (what createSnapshot counted). Fall back
        // to every record on file when the active ones don't account for the
        // stored amount - a position can have been deactivated since.
        const candidates = [
          this.splitBarrierProtectedByUnderlying(holdings.filter(h => h.isActive !== false), metadataByIsin),
          this.splitBarrierProtectedByUnderlying(holdings, metadataByIsin)
        ];
        const tolerance = Math.max(0.01, storedLegacy * 0.001);
        const exact = candidates.find(c =>
          Math.abs((c.equityLinked + c.nonEquity) - storedLegacy) <= tolerance
        );
        const observed = exact || candidates.find(c => c.equityLinked + c.nonEquity > 0);

        if (!observed) {
          stats.skippedNoBarrierHoldings++;
          continue;
        }

        const observedTotal = observed.equityLinked + observed.nonEquity;
        const drift = Math.abs(observedTotal - storedLegacy) / storedLegacy;
        const isMixed = observed.equityLinked > 0 && observed.nonEquity > 0;

        if (exact) {
          basis = 'exact';
        } else if (!isMixed) {
          // One underlying class only - the split is unambiguous whatever the
          // amount on record.
          basis = 'one-sided';
        } else if (drift <= 0.05) {
          basis = 'apportioned';
        } else {
          // Mixed underlyings and the holdings don't line up with the stored
          // amount: no honest way to split it. Leave it.
          stats.skippedUncertainMix++;
          continue;
        }
        split = observed;
      }

      const observedTotal = split.equityLinked + split.nonEquity;
      // Re-bucket the STORED amount, never the observed one, so the snapshot's
      // total is untouched.
      const equityValue = storedLegacy * (split.equityLinked / observedTotal);
      const nonEquityValue = storedLegacy - equityValue;

      if (!isConsolidated) {
        const key = dayKey(snapshot);
        const running = perAccountSplits.get(key) || { equityLinked: 0, nonEquity: 0 };
        running.equityLinked += equityValue;
        running.nonEquity += nonEquityValue;
        perAccountSplits.set(key, running);
      }

      if (equityValue <= 0) {
        // Genuinely non-equity underlyings: the legacy key is still correct.
        stats.unchangedAllNonEquity++;
        continue;
      }

      const updated = { ...snapshot.assetClassBreakdown };
      delete updated[LEGACY_BARRIER_PROTECTED_KEY];
      updated[EQUITY_LINKED_BARRIER_PROTECTED_KEY] =
        (updated[EQUITY_LINKED_BARRIER_PROTECTED_KEY] || 0) + equityValue;
      if (nonEquityValue > 0) {
        updated[LEGACY_BARRIER_PROTECTED_KEY] = nonEquityValue;
      }

      if (basis === 'exact') stats.exact++;
      else if (basis === 'one-sided') stats.oneSided++;
      else if (basis === 'siblings') stats.siblings++;
      else stats.apportioned++;

      if (samples.length < 20) {
        samples.push({
          snapshotId: snapshot._id,
          portfolioCode: snapshot.portfolioCode,
          snapshotDate: snapshot.snapshotDate,
          outcome: dryRun ? 'would_update' : 'updated',
          basis,
          storedLegacy,
          before: snapshot.assetClassBreakdown,
          after: updated
        });
      }

      if (!dryRun) {
        pendingWrites.push({
          updateOne: {
            filter: { _id: snapshot._id },
            update: { $set: { assetClassBreakdown: updated, breakdownReclassifiedAt: reclassifiedAt } }
          }
        });
        if (pendingWrites.length >= WRITE_BATCH_SIZE) {
          await PortfolioSnapshotsCollection.rawCollection().bulkWrite(pendingWrites, { ordered: false });
          pendingWrites.length = 0;
        }
      }
    }

    if (pendingWrites.length > 0) {
      await PortfolioSnapshotsCollection.rawCollection().bulkWrite(pendingWrites, { ordered: false });
    }

    return { ...stats, samples };
  },

  /**
   * Create a portfolio snapshot from current holdings
   * @param {Object} params
   * @param {Array} [params.transferOpsCache] - Optional pre-fetched transfer operations to avoid repeated DB queries
   */
  async createSnapshot({
    userId,
    entityId = null,  // Client entity ID (entity architecture)
    bankId,
    bankName,
    connectionId,
    portfolioCode = null,  // null for aggregated snapshot across all portfolios
    accountNumber = null,
    snapshotDate,
    fileDate,
    sourceFile,
    holdings = [],  // Array of position objects
    transferOpsCache = null  // Pre-fetched transfer operations for capital invested calculation
  }) {
    // Defense in depth: exclude inactive holdings so stale isLatest=true + isActive=false
    // ghost records (e.g. FX-forward legs orphaned by a rollover with a new uniqueKey)
    // cannot contaminate totals if a caller forgets to pre-filter.
    holdings = holdings.filter(h => h.isActive !== false);

    // Separate cash positions from investment holdings
    const { cashHoldings, investmentHoldings } = this.splitCashHoldings(holdings);

    // Calculate cash balance
    const cashBalance = cashHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);

    // Calculate totals for investment holdings (excluding cash)
    const totalMarketValue = investmentHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
    // costPrice is already normalized to decimal by every bank parser
    // (1.0 = 100% for percentage-quoted instruments, see CLAUDE.md), so it
    // must NOT be divided by 100 again here — doing so shrank the cost basis
    // of bonds and structured notes 100× in every snapshot.
    const totalCostBasis = investmentHoldings.reduce((sum, h) => {
      return sum + ((h.quantity || 0) * (h.costPrice || 0));
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
    const assetClassBreakdown = await this.buildAssetClassBreakdown(holdings);

    // Calculate total capital invested from cash flow operations
    const totalCapitalInvested = await this.calculateTotalCapitalInvested({
      userId,
      portfolioCode,
      upToDate: snapshotDate,
      transferOpsCache  // Pass through pre-fetched operations if available
    });

    // Create snapshot object
    const snapshot = {
      userId,
      ...(entityId && { entityId }),
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
      // `currency` is the dominant SECURITY trading currency (display only).
      // `portfolioCurrency` is what totalAccountValue is DENOMINATED in — the
      // portfolio reference currency the parsers converted marketValue into.
      // Aggregations must convert by portfolioCurrency, never by `currency`.
      currency: dominantCurrency,
      portfolioCurrency: holdings.find(h => h.portfolioCurrency)?.portfolioCurrency || 'EUR',
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
    // Support both userId and entityId for entity-based architecture
    const query = { $or: [{ userId }, { entityId: userId }] };

    if (portfolioCode) {
      query.portfolioCode = portfolioCode;
    }

    if (startDate || endDate) {
      query.snapshotDate = {};
      if (startDate) query.snapshotDate.$gte = startDate;
      if (endDate) query.snapshotDate.$lte = endDate;
    }

    const snapshots = await PortfolioSnapshotsCollection.find(query, {
      sort: { snapshotDate: 1 }
    }).fetchAsync();

    return filterSnapshotsByBankStartDate(snapshots);
  },

  /**
   * Get aggregated snapshots for a specific user across all their portfolios
   * Groups snapshots by date and sums values (prevents zigzag chart when user has multiple accounts)
   */
  async getAggregatedSnapshotsForUser({ userId, startDate, endDate }) {
    const query = { $or: [{ userId }, { entityId: userId }], portfolioCode: { $ne: 'CONSOLIDATED' } };

    if (startDate || endDate) {
      query.snapshotDate = {};
      if (startDate) query.snapshotDate.$gte = startDate;
      if (endDate) query.snapshotDate.$lte = endDate;
    }

    // Get all snapshots for this user across all portfolios (exclude CONSOLIDATED to avoid double-counting)
    const rawSnapshots = await PortfolioSnapshotsCollection.find(query, {
      sort: { snapshotDate: 1 }
    }).fetchAsync();

    // Filter out snapshots from banks with known bad historical data
    const snapshots = filterSnapshotsByBankStartDate(rawSnapshots);

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
    // Get all snapshots for this user up to target date (exclude CONSOLIDATED to avoid double-counting)
    const snapshots = await PortfolioSnapshotsCollection.find({
      userId,
      snapshotDate: { $lte: targetDate },
      portfolioCode: { $ne: 'CONSOLIDATED' }
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
    const query = { portfolioCode: { $ne: 'CONSOLIDATED' } };

    if (startDate || endDate) {
      query.snapshotDate = {};
      if (startDate) query.snapshotDate.$gte = startDate;
      if (endDate) query.snapshotDate.$lte = endDate;
    }

    console.log(`[SNAPSHOTS] getAggregatedSnapshots query:`, JSON.stringify(query));

    // Get all snapshots across all users/portfolios (exclude CONSOLIDATED to avoid double-counting)
    const rawSnapshots = await PortfolioSnapshotsCollection.find(query, {
      sort: { snapshotDate: 1 }
    }).fetchAsync();

    console.log(`[SNAPSHOTS] getAggregatedSnapshots found ${rawSnapshots.length} raw snapshots`);

    // Filter out snapshots from banks with known bad historical data
    const snapshots = filterSnapshotsByBankStartDate(rawSnapshots);

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
