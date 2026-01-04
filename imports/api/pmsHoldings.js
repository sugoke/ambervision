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
    // Also treat positions with null isin + currency as cash (handles older records without securityType)
    let identifier;
    if (isin) {
      identifier = isin;
    } else if (securityType === 'CASH' || securityType === 'FX_FORWARD') {
      identifier = `CASH_${currency}`;
    } else if (!isin && currency) {
      // Fallback: treat null ISIN + currency as cash (backwards compatibility)
      identifier = `CASH_${currency}`;
    } else {
      identifier = 'UNKNOWN';
    }

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

    // Helper to normalize date to midnight UTC for date-only comparison
    const toDateOnly = (d) => {
      const date = new Date(d);
      return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).getTime();
    };

    // Helper for floating-point comparison with tolerance
    // Avoids creating new versions due to tiny precision differences
    const isEqual = (a, b, tolerance = 0.0001) => {
      if (a === b) return true;
      if (a == null || b == null) return a == b;
      return Math.abs(a - b) < tolerance;
    };

    // Calculate snapshot date boundaries for query
    const snapshotDateStart = new Date(toDateOnly(snapshotDate));
    const snapshotDateEnd = new Date(toDateOnly(snapshotDate) + 24 * 60 * 60 * 1000);

    // FIRST: Check if we already have a record for this SPECIFIC DATE
    // This prevents duplicate writes when reprocessing historical dates
    const existingForDate = await PMSHoldingsCollection.findOneAsync({
      uniqueKey,
      snapshotDate: { $gte: snapshotDateStart, $lt: snapshotDateEnd }
    });

    if (existingForDate) {
      // Record exists for this specific date - check if values changed
      const qtyMatch = isEqual(existingForDate.quantity, holdingData.quantity);
      const mvMatch = isEqual(existingForDate.marketValue, holdingData.marketValue, 0.01);
      const mpMatch = isEqual(existingForDate.marketPrice, holdingData.marketPrice, 0.0001);
      const cbpMatch = isEqual(existingForDate.costBasisPortfolioCurrency, holdingData.costBasisPortfolioCurrency, 0.01);
      const cboMatch = isEqual(existingForDate.costBasisOriginalCurrency, holdingData.costBasisOriginalCurrency, 0.01);

      if (qtyMatch && mvMatch && mpMatch && cbpMatch && cboMatch) {
        // Data unchanged for this date - skip write entirely
        return { _id: existingForDate._id, isNew: false, updated: false, versioned: false, skipped: true };
      }

      // Values changed - update the existing record for this date (don't create new version)
      // IMPORTANT: Preserve the existing isLatest flag - don't overwrite from holdingData
      // The parser always sets isLatest: true, but historical records should stay isLatest: false
      const { isLatest: _ignoreIsLatest, version: _ignoreVersion, ...holdingDataWithoutFlags } = holdingData;
      await PMSHoldingsCollection.updateAsync(existingForDate._id, {
        $set: {
          ...holdingDataWithoutFlags,
          uniqueKey,
          snapshotDate,
          processedAt: now,
          updatedAt: now
        }
      });
      return { _id: existingForDate._id, isNew: false, updated: true, versioned: false };
    }

    // No record for this specific date - check if there's a "latest" version to inherit from
    const existing = await PMSHoldingsCollection.findOneAsync({
      uniqueKey,
      isLatest: true
    });

    if (existing) {
      // Check if incoming data is for a NEWER date than the current latest
      const incomingIsNewer = toDateOnly(snapshotDate) > toDateOnly(existing.snapshotDate);

      // Compare values with existing latest
      const qtyMatch = isEqual(existing.quantity, holdingData.quantity);
      const mvMatch = isEqual(existing.marketValue, holdingData.marketValue, 0.01);
      const mpMatch = isEqual(existing.marketPrice, holdingData.marketPrice, 0.0001);
      const cbpMatch = isEqual(existing.costBasisPortfolioCurrency, holdingData.costBasisPortfolioCurrency, 0.01);
      const cboMatch = isEqual(existing.costBasisOriginalCurrency, holdingData.costBasisOriginalCurrency, 0.01);

      const hasChanged = !qtyMatch || !mvMatch || !mpMatch || !cbpMatch || !cboMatch;

      // Processing a NEW date (not yet in DB) - decide whether to create a new "latest" version
      if (incomingIsNewer) {
        // Incoming data is for a NEWER date - this becomes the new "latest"
        // DEBUG: Log which field caused the version change
        if (hasChanged) {
          console.log(`[PMS_DEBUG] ${holdingData.securityName} (new latest):`);
          if (!qtyMatch) console.log(`  QTY: ${existing.quantity} vs ${holdingData.quantity}`);
          if (!mvMatch) console.log(`  MV: ${existing.marketValue} vs ${holdingData.marketValue}`);
          if (!mpMatch) console.log(`  MP: ${existing.marketPrice} vs ${holdingData.marketPrice}`);
        }

        // STEP 1: Mark ALL existing isLatest records as false FIRST
        // This prevents race conditions when multiple files are processed concurrently
        // By marking old records false BEFORE inserting, we ensure only one isLatest: true exists
        await PMSHoldingsCollection.updateAsync(
          {
            uniqueKey,
            isLatest: true
          },
          {
            $set: {
              isLatest: false,
              replacedAt: now
            }
          },
          { multi: true }
        );

        // STEP 2: Insert new version as latest
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

        // STEP 3: Update replacedBy field on old records (non-critical, just for tracking)
        await PMSHoldingsCollection.updateAsync(
          {
            uniqueKey,
            replacedAt: now,
            replacedBy: { $exists: false }
          },
          {
            $set: { replacedBy: newHoldingId }
          },
          { multi: true }
        );

        console.log(`[PMS_HOLDINGS] Created version ${(existing.version || 0) + 1} for ${holdingData.securityName}`);
        return { _id: newHoldingId, isNew: false, updated: true, versioned: true };
      } else {
        // Incoming data is for an OLDER date (historical backfill)
        // Insert as historical record WITHOUT changing what's "latest"
        const historicalHoldingId = await PMSHoldingsCollection.insertAsync({
          ...holdingData,
          uniqueKey,
          snapshotDate,
          processedAt: now,
          isLatest: false,  // Historical - not latest
          isActive: true,
          version: (existing.version || 0) + 1,
          createdAt: now,
          updatedAt: now,
          // Product linking - inherit from latest version
          linkedProductId: existing.linkedProductId,
          linkedAllocationId: existing.linkedAllocationId,
          linkingStatus: existing.linkingStatus,
          linkedAt: existing.linkedAt,
          linkedBy: existing.linkedBy
        });

        // Don't touch the existing "latest" record
        return { _id: historicalHoldingId, isNew: true, updated: false, versioned: false, historical: true };
      }
    } else {
      // No existing record found for this uniqueKey
      // SAFETY CHECK: Look for existing records by portfolio + ISIN/cash identifier
      // This handles cases where uniqueKey changed (e.g., parser logic update)
      let existingByIdentifier = null;
      if (holdingData.isin) {
        // For securities, check by portfolio + ISIN
        existingByIdentifier = await PMSHoldingsCollection.findOneAsync({
          portfolioCode: holdingData.portfolioCode,
          isin: holdingData.isin,
          isLatest: true
        });
      } else if (holdingData.securityType === 'CASH') {
        // For cash, check by portfolio + currency + security name
        existingByIdentifier = await PMSHoldingsCollection.findOneAsync({
          portfolioCode: holdingData.portfolioCode,
          currency: holdingData.currency,
          securityName: holdingData.securityName,
          isLatest: true
        });
      }

      if (existingByIdentifier) {
        // Found existing record with different uniqueKey - this is a uniqueKey migration case
        console.log(`[PMS_HOLDINGS] Found existing record with different uniqueKey for ${holdingData.securityName}`);
        console.log(`[PMS_HOLDINGS] Old key: ${existingByIdentifier.uniqueKey?.substring(0, 16)}..., New key: ${uniqueKey.substring(0, 16)}...`);

        // Mark ALL old records for this identifier as not latest
        await PMSHoldingsCollection.updateAsync(
          {
            portfolioCode: holdingData.portfolioCode,
            ...(holdingData.isin ? { isin: holdingData.isin } : { currency: holdingData.currency, securityName: holdingData.securityName }),
            isLatest: true
          },
          {
            $set: {
              isLatest: false,
              replacedAt: now
            }
          },
          { multi: true }
        );

        // Insert new version with new uniqueKey
        const newHoldingId = await PMSHoldingsCollection.insertAsync({
          ...holdingData,
          uniqueKey,
          snapshotDate,
          processedAt: now,
          isLatest: true,
          isActive: true,
          version: (existingByIdentifier.version || 0) + 1,
          createdAt: now,
          updatedAt: now,
          // Inherit product linking from old record
          linkedProductId: existingByIdentifier.linkedProductId,
          linkedAllocationId: existingByIdentifier.linkedAllocationId,
          linkingStatus: existingByIdentifier.linkingStatus,
          linkedAt: existingByIdentifier.linkedAt,
          linkedBy: existingByIdentifier.linkedBy
        });

        return { _id: newHoldingId, isNew: false, updated: true, versioned: true, keyMigrated: true };
      }

      // Truly first version - no existing records
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
  },

  /**
   * Reclassify all holdings with a specific ISIN
   * Used when admin changes classification in SecuritiesMetadata - propagates to all holdings
   *
   * @param {string} isin - The ISIN to reclassify
   * @param {object} classification - The new classification data
   * @param {string} classification.securityType - e.g., 'EQUITY', 'BOND', 'STRUCTURED_PRODUCT'
   * @param {string} classification.assetClass - e.g., 'EQUITY', 'FIXED_INCOME', 'ALTERNATIVE'
   * @param {string} [classification.structuredProductUnderlyingType] - e.g., 'EQUITY', 'INDEX'
   * @param {string} [classification.structuredProductProtectionType] - e.g., 'CAPITAL_AT_RISK'
   * @param {string} [classification.classifiedBy] - Who made the classification ('admin', 'AI', 'EOD')
   * @returns {Promise<{modifiedCount: number, matchedCount: number}>}
   */
  async reclassifyByIsin(isin, classification) {
    if (!isin) {
      throw new Error('ISIN is required for reclassification');
    }
    if (!classification || !classification.securityType) {
      throw new Error('Classification with securityType is required');
    }

    const updateFields = {
      securityType: classification.securityType,
      assetClass: classification.assetClass || null,
      classifiedAt: new Date(),
      classifiedBy: classification.classifiedBy || 'admin',
      updatedAt: new Date()
    };

    // Add structured product fields if present
    if (classification.structuredProductUnderlyingType) {
      updateFields.structuredProductUnderlyingType = classification.structuredProductUnderlyingType;
    }
    if (classification.structuredProductProtectionType) {
      updateFields.structuredProductProtectionType = classification.structuredProductProtectionType;
    }

    // Update ALL holdings with this ISIN (both latest and historical versions)
    const result = await PMSHoldingsCollection.updateAsync(
      { isin },
      { $set: updateFields },
      { multi: true }
    );

    console.log(`[PMS_HOLDINGS] Reclassified ${result} holdings with ISIN ${isin} to ${classification.securityType}`);

    return {
      modifiedCount: result,
      matchedCount: result, // In Meteor, updateAsync returns the number of affected documents
      isin,
      newSecurityType: classification.securityType,
      newAssetClass: classification.assetClass
    };
  },

  /**
   * Fix isLatest flags by finding the latest record per uniqueKey and setting isLatest: true
   * This is a recovery method for when all isLatest flags get corrupted (e.g., interrupted processing)
   *
   * @param {object} options - Filter options
   * @param {string} [options.bankId] - Limit fix to specific bank
   * @param {boolean} [options.dryRun=true] - If true, only report what would be fixed without making changes
   * @returns {Promise<{uniqueKeysFixed: number, totalRecords: number, fixedRecordIds: string[]}>}
   */
  async fixIsLatestFlags(options = {}) {
    const { bankId, dryRun = true } = options;
    const startTime = Date.now();

    console.log(`[PMS_HOLDINGS] fixIsLatestFlags started (dryRun=${dryRun}, bankId=${bankId || 'all'})`);

    // Build match query
    const matchQuery = {};
    if (bankId) matchQuery.bankId = bankId;

    // Step 1: Set ALL isLatest to false first (if not dry run)
    if (!dryRun) {
      const resetResult = await PMSHoldingsCollection.updateAsync(
        { ...matchQuery, isLatest: true },
        { $set: { isLatest: false, replacedAt: new Date() } },
        { multi: true }
      );
      console.log(`[PMS_HOLDINGS] Reset ${resetResult} records to isLatest=false`);
    }

    // Step 2: Find all unique uniqueKeys and their latest record (by snapshotDate)
    const pipeline = [
      { $match: matchQuery },
      { $sort: { snapshotDate: -1 } },
      {
        $group: {
          _id: '$uniqueKey',
          latestId: { $first: '$_id' },
          latestDate: { $first: '$snapshotDate' },
          recordCount: { $sum: 1 }
        }
      }
    ];

    const rawCollection = PMSHoldingsCollection.rawCollection();
    const latestRecords = await rawCollection.aggregate(pipeline).toArray();

    console.log(`[PMS_HOLDINGS] Found ${latestRecords.length} unique holdings to fix`);

    // Step 3: Update all latest records to isLatest: true
    const latestIds = latestRecords.map(r => r.latestId);
    let fixedCount = 0;

    if (!dryRun && latestIds.length > 0) {
      // Use MongoDB bulk operation for efficiency
      const bulkOps = latestIds.map(id => ({
        updateOne: {
          filter: { _id: id },
          update: { $set: { isLatest: true, updatedAt: new Date() } }
        }
      }));

      const bulkResult = await rawCollection.bulkWrite(bulkOps);
      fixedCount = bulkResult.modifiedCount;
      console.log(`[PMS_HOLDINGS] Set isLatest=true on ${fixedCount} records`);
    } else if (dryRun) {
      fixedCount = latestIds.length;
      console.log(`[PMS_HOLDINGS] DRY RUN: Would set isLatest=true on ${fixedCount} records`);
    }

    // Calculate total records affected
    const totalRecords = latestRecords.reduce((sum, r) => sum + r.recordCount, 0);
    const elapsed = Date.now() - startTime;

    console.log(`[PMS_HOLDINGS] fixIsLatestFlags completed in ${elapsed}ms: ${fixedCount} uniqueKeys fixed, ${totalRecords} total records`);

    return {
      uniqueKeysFixed: fixedCount,
      totalRecords,
      fixedRecordIds: dryRun ? latestIds.map(id => id.toString()).slice(0, 20) : [], // Only include sample in dry run
      dryRun,
      elapsed
    };
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
