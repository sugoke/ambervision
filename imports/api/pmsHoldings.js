import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';
import crypto from 'crypto';

export const PMSHoldingsCollection = new Mongo.Collection('pmsHoldings');

/**
 * PMS Holdings Collection
 *
 * Stores standardized position/holdings data from various bank position files.
 * All bank-specific formats are converted to this unified schema.
 */

// Helper functions for PMS Holdings management
export const PMSHoldingsHelpers = {
  /**
   * Generate unique key for position tracking across time
   * Hash of: bankId + portfolioCode + isin (or currency for cash)
   * For FX forwards: includes endDate (Julius Baer) or reference (CFM) to differentiate contracts
   * Note: fileDate is NOT included to allow versioning of the same position over time
   */
  generateUniqueKey({ bankId, portfolioCode, isin, currency, securityType, endDate, reference }) {
    // For cash positions without ISIN, use currency + 'CASH' as identifier
    let identifier = isin || (securityType === 'CASH' ? `CASH_${currency}` : 'UNKNOWN');

    // For FX forwards, include differentiating factor to separate contracts
    if (securityType === 'FX_FORWARD') {
      if (endDate) {
        // Julius Baer: use value/settlement date
        const endDateStr = endDate instanceof Date ? endDate.toISOString().split('T')[0] : String(endDate).split('T')[0];
        identifier = `${identifier}|${endDateStr}`;
      } else if (reference) {
        // CFM: use FX reference number (e.g., FX0329536)
        identifier = `${identifier}|${reference}`;
      }
    }

    const data = `${bankId}|${portfolioCode}|${identifier}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  },

  /**
   * Create or update a holding record with versioning
   * Creates new version instead of overwriting existing data
   */
  async upsertHolding(holdingData) {
    check(holdingData.bankId, String);
    check(holdingData.portfolioCode, String);
    check(holdingData.fileDate, Date);

    // Use parser's uniqueKey if provided, otherwise generate one
    // This allows bank-specific parsers to define their own uniqueKey logic
    // (e.g., CMB Monaco uses Position_Number instead of ISIN for stability)
    const uniqueKey = holdingData.uniqueKey || this.generateUniqueKey({
      bankId: holdingData.bankId,
      portfolioCode: holdingData.portfolioCode,
      isin: holdingData.isin,
      currency: holdingData.currency,
      securityType: holdingData.securityType,
      // For FX forwards, include differentiating factor:
      // - Julius Baer: uses endDate (value/settlement date)
      // - CFM: uses reference (FX reference number)
      endDate: holdingData.bankSpecificData?.instrumentDates?.endDate,
      reference: holdingData.bankSpecificData?.instrumentDates?.reference || holdingData.bankSpecificData?.reference
      // NO fileDate in uniqueKey!
    });

    const now = new Date();
    // Use dataDate if available (actual portfolio valuation date), otherwise fallback to fileDate
    const snapshotDate = holdingData.dataDate || holdingData.fileDate;

    // Find the current "latest" version for this position
    const existing = await PMSHoldingsCollection.findOneAsync({
      uniqueKey,
      isLatest: true
    });

    if (existing) {
      // Check if this is truly new data (different snapshot date or values changed)
      const hasChanged =
        existing.snapshotDate.getTime() !== snapshotDate.getTime() ||
        existing.quantity !== holdingData.quantity ||
        existing.marketValue !== holdingData.marketValue ||
        existing.marketPrice !== holdingData.marketPrice ||
        existing.costBasisPortfolioCurrency !== holdingData.costBasisPortfolioCurrency ||
        existing.costBasisOriginalCurrency !== holdingData.costBasisOriginalCurrency;

      if (hasChanged) {
        // STEP 1: Insert new version FIRST
        // This ensures we always have at least one record with isLatest: true
        // If this insert fails, the old record remains visible (fail-safe)
        const newHoldingId = await PMSHoldingsCollection.insertAsync({
          ...holdingData,
          uniqueKey,
          snapshotDate,
          processedAt: now,
          isLatest: true,
          isActive: true,
          version: (existing.version || 0) + 1,
          createdAt: now,
          updatedAt: now,
          // Product linking - inherit from previous version
          linkedProductId: existing.linkedProductId,
          linkedAllocationId: existing.linkedAllocationId,
          linkingStatus: existing.linkingStatus,
          linkedAt: existing.linkedAt,
          linkedBy: existing.linkedBy
        });

        // STEP 2: Only after successful insert, mark ALL old versions as not latest
        // Uses multi: true to handle any potential duplicate isLatest records
        await PMSHoldingsCollection.updateAsync(
          {
            uniqueKey,
            isLatest: true,
            _id: { $ne: newHoldingId }  // Exclude the one we just inserted
          },
          {
            $set: {
              isLatest: false,
              replacedAt: now,
              replacedBy: newHoldingId
            }
          },
          { multi: true }
        );

        console.log(`[PMS_HOLDINGS] Created version ${(existing.version || 0) + 1} for ${holdingData.securityName}`);
        return { _id: newHoldingId, isNew: false, updated: true, versioned: true };
      } else {
        // No value changes - but still update file-related fields to reflect new file was processed
        await PMSHoldingsCollection.updateAsync(existing._id, {
          $set: {
            updatedAt: now,
            processedAt: now,
            // Update file source info even if values unchanged
            fileDate: holdingData.fileDate,
            sourceFile: holdingData.sourceFile,
            sourceFilePath: holdingData.sourceFilePath,
            processingDate: holdingData.processingDate || now
          }
        });
        return { _id: existing._id, isNew: false, updated: false, versioned: false };
      }
    } else {
      // First version
      const holdingId = await PMSHoldingsCollection.insertAsync({
        ...holdingData,
        uniqueKey,
        snapshotDate,
        processedAt: now,
        isLatest: true,
        isActive: true,
        version: 1,
        createdAt: now,
        updatedAt: now,
        // Product linking fields
        linkedProductId: null,
        linkedAllocationId: null,
        linkingStatus: 'unlinked',
        linkedAt: null,
        linkedBy: null
      });
      console.log(`[PMS_HOLDINGS] Created initial version for ${holdingData.securityName}`);
      return { _id: holdingId, isNew: true, updated: false, versioned: false };
    }
  },

  /**
   * Get holdings for a specific portfolio
   */
  async getPortfolioHoldings(portfolioCode, options = {}) {
    const { bankId, limit = 100, skip = 0 } = options;

    const query = { portfolioCode, isActive: true };
    if (bankId) query.bankId = bankId;

    return await PMSHoldingsCollection.find(query, {
      limit,
      skip,
      sort: { fileDate: -1, securityName: 1 }
    }).fetchAsync();
  },

  /**
   * Get latest holdings for a portfolio
   */
  async getLatestHoldings(portfolioCode, bankId = null) {
    const query = { portfolioCode, isActive: true };
    if (bankId) query.bankId = bankId;

    // Find the most recent file date for this portfolio
    const latest = await PMSHoldingsCollection.findOneAsync(query, {
      sort: { fileDate: -1 }
    });

    if (!latest) return [];

    // Get all holdings from that date
    query.fileDate = latest.fileDate;
    return await PMSHoldingsCollection.find(query).fetchAsync();
  },

  /**
   * Get holdings summary by security
   */
  async getHoldingsSummary(portfolioCode) {
    const holdings = await this.getLatestHoldings(portfolioCode);

    // Group by ISIN
    const summary = {};
    holdings.forEach(holding => {
      const key = holding.isin || 'UNKNOWN';
      if (!summary[key]) {
        summary[key] = {
          isin: holding.isin,
          securityName: holding.securityName,
          securityType: holding.securityType,
          totalQuantity: 0,
          totalMarketValue: 0,
          currency: holding.currency,
          holdings: []
        };
      }
      summary[key].totalQuantity += holding.quantity || 0;
      summary[key].totalMarketValue += holding.marketValue || 0;
      summary[key].holdings.push(holding);
    });

    return Object.values(summary);
  },

  /**
   * Delete holdings for a specific file
   */
  async deleteByFile(bankId, sourceFile) {
    return await PMSHoldingsCollection.removeAsync({ bankId, sourceFile });
  },

  /**
   * Mark old holdings as inactive
   */
  async deactivateOldHoldings(bankId, portfolioCode, beforeDate) {
    return await PMSHoldingsCollection.updateAsync(
      {
        bankId,
        portfolioCode,
        fileDate: { $lt: beforeDate },
        isActive: true
      },
      {
        $set: { isActive: false, updatedAt: new Date() }
      },
      { multi: true }
    );
  }
};

// Create indexes on server startup
if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      // MIGRATION: Drop old unique index on uniqueKey that blocks versioning
      // The versioning system needs multiple records with same uniqueKey (different versions)
      try {
        const rawCollection = PMSHoldingsCollection.rawCollection();
        const indexes = await rawCollection.indexes();
        const oldUniqueIndex = indexes.find(idx =>
          idx.name === 'uniqueKey_1' && idx.unique === true
        );
        if (oldUniqueIndex) {
          console.log('[PMS_HOLDINGS] Dropping old unique index on uniqueKey to enable versioning...');
          await rawCollection.dropIndex('uniqueKey_1');
          console.log('[PMS_HOLDINGS] Successfully dropped uniqueKey_1 unique index');
        }
      } catch (dropError) {
        // Index might not exist or already dropped - that's fine
        console.log('[PMS_HOLDINGS] Note: uniqueKey_1 index drop skipped:', dropError.message);
      }

      // Compound index for finding latest versions (most common query)
      await PMSHoldingsCollection.createIndexAsync({
        uniqueKey: 1,
        isLatest: 1
      });

      // Index for snapshot date queries
      await PMSHoldingsCollection.createIndexAsync({
        portfolioCode: 1,
        snapshotDate: -1
      });

      // Compound index for date-based queries with latest flag
      await PMSHoldingsCollection.createIndexAsync({
        portfolioCode: 1,
        snapshotDate: -1,
        isLatest: 1
      });

      // Compound index for common queries
      await PMSHoldingsCollection.createIndexAsync({
        bankId: 1,
        portfolioCode: 1,
        fileDate: -1
      });

      // Index on ISIN for security lookups
      await PMSHoldingsCollection.createIndexAsync({ isin: 1 });

      // Index on portfolio and active status
      await PMSHoldingsCollection.createIndexAsync({
        portfolioCode: 1,
        isActive: 1
      });

      // Index on file date for sorting
      await PMSHoldingsCollection.createIndexAsync({ fileDate: -1 });

      // Index on snapshot date for sorting
      await PMSHoldingsCollection.createIndexAsync({ snapshotDate: -1 });

      console.log('[PMS_HOLDINGS] Indexes created successfully');
    } catch (error) {
      // Indexes might already exist
      console.log('[PMS_HOLDINGS] Skipping index creation (might already exist)');
    }
  });
}
