import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';
import crypto from 'crypto';
import { getAssetClassFromSecurityType } from './constants/instrumentTypes.js';
import { SecuritiesMetadataCollection } from './securitiesMetadata.js';

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

    // IMPORTANT: Derive assetClass from securityType if not already set
    // This ensures all holdings have a valid assetClass for UI filtering
    if (!holdingData.assetClass && holdingData.securityType) {
      holdingData.assetClass = getAssetClassFromSecurityType(
        holdingData.securityType,
        holdingData.securityName || ''
      );
    }

    // If still no assetClass but has ISIN, try to enrich from securitiesMetadata
    // This handles cases where admin has classified a security but parser didn't provide assetClass
    if (!holdingData.assetClass && holdingData.isin) {
      try {
        const metadata = await SecuritiesMetadataCollection.findOneAsync({ isin: holdingData.isin });
        if (metadata?.assetClass) {
          holdingData.assetClass = metadata.assetClass;
          // Also copy securityType if missing and metadata has it
          if (!holdingData.securityType && metadata.securityType) {
            holdingData.securityType = metadata.securityType;
          }
        }
      } catch (e) {
        // Silently continue - metadata lookup is optional enrichment
        console.warn(`[PMSHoldings] Could not lookup metadata for ISIN ${holdingData.isin}:`, e.message);
      }
    }

    // Normalize field names (different parsers use different names)
    // balance: some parsers use 'quantity', some use 'balance'
    if (holdingData.balance === undefined && holdingData.quantity !== undefined) {
      holdingData.balance = holdingData.quantity;
    }
    // instrumentName: some parsers use 'securityName', some use 'instrumentName'
    if (!holdingData.instrumentName && holdingData.securityName) {
      holdingData.instrumentName = holdingData.securityName;
    }
    // marketValuePortfolioCurrency: some use 'marketValue', some use 'marketValuePortfolioCurrency'
    if (holdingData.marketValuePortfolioCurrency === undefined && holdingData.marketValue !== undefined) {
      holdingData.marketValuePortfolioCurrency = holdingData.marketValue;
    }

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

        // STEP 4: Post-insert race condition check
        // If concurrent processing created multiple isLatest=true records, fix it immediately
        const raceCheck = await this.checkAndFixDuplicatesForKey(uniqueKey);
        if (raceCheck.hadDuplicates) {
          console.log(`[PMS_HOLDINGS] Fixed ${raceCheck.fixedCount} duplicate(s) for ${holdingData.securityName} after insert`);
        }

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

        // Post-insert race condition check
        const raceCheck = await this.checkAndFixDuplicatesForKey(uniqueKey);
        if (raceCheck.hadDuplicates) {
          console.log(`[PMS_HOLDINGS] Fixed ${raceCheck.fixedCount} duplicate(s) for ${holdingData.securityName} (key migration)`);
        }

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

      // Post-insert race condition check for concurrent first-inserts
      const raceCheck = await this.checkAndFixDuplicatesForKey(uniqueKey);
      if (raceCheck.hadDuplicates) {
        console.log(`[PMS_HOLDINGS] Fixed ${raceCheck.fixedCount} duplicate(s) for ${holdingData.securityName} (concurrent first inserts)`);
      }

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
  },

  /**
   * Clean up duplicate isLatest=true records caused by race conditions
   * When concurrent file processing creates multiple "latest" records for the same uniqueKey,
   * this method keeps only the newest one (by snapshotDate, then version) and marks others as false.
   *
   * @param {object} options - Cleanup options
   * @param {string} [options.bankId] - Limit cleanup to specific bank
   * @param {string} [options.portfolioCode] - Limit cleanup to specific portfolio
   * @param {boolean} [options.dryRun=true] - If true, only report duplicates without fixing
   * @returns {Promise<{duplicateKeysFound: number, recordsFixed: number, details: array}>}
   */
  async cleanupDuplicateLatest(options = {}) {
    const { bankId, portfolioCode, dryRun = true } = options;
    const startTime = Date.now();

    console.log(`[PMS_HOLDINGS] cleanupDuplicateLatest started (dryRun=${dryRun}, bankId=${bankId || 'all'}, portfolio=${portfolioCode || 'all'})`);

    // Build match query for filtering
    const matchQuery = { isLatest: true };
    if (bankId) matchQuery.bankId = bankId;
    if (portfolioCode) matchQuery.portfolioCode = portfolioCode;

    // Aggregation pipeline to find uniqueKeys with multiple isLatest=true records
    const pipeline = [
      { $match: matchQuery },
      {
        $group: {
          _id: '$uniqueKey',
          count: { $sum: 1 },
          records: {
            $push: {
              _id: '$_id',
              snapshotDate: '$snapshotDate',
              version: '$version',
              securityName: '$securityName',
              portfolioCode: '$portfolioCode'
            }
          }
        }
      },
      { $match: { count: { $gt: 1 } } }, // Only uniqueKeys with duplicates
      { $sort: { count: -1 } } // Most duplicates first
    ];

    const rawCollection = PMSHoldingsCollection.rawCollection();
    const duplicateGroups = await rawCollection.aggregate(pipeline).toArray();

    console.log(`[PMS_HOLDINGS] Found ${duplicateGroups.length} uniqueKeys with duplicate isLatest=true records`);

    if (duplicateGroups.length === 0) {
      return {
        duplicateKeysFound: 0,
        recordsFixed: 0,
        details: [],
        dryRun,
        elapsed: Date.now() - startTime
      };
    }

    const details = [];
    let totalRecordsFixed = 0;

    for (const group of duplicateGroups) {
      // Sort records: newest snapshotDate first, then highest version
      const sortedRecords = group.records.sort((a, b) => {
        const dateA = new Date(a.snapshotDate).getTime();
        const dateB = new Date(b.snapshotDate).getTime();
        if (dateB !== dateA) return dateB - dateA; // Newest date first
        return (b.version || 0) - (a.version || 0); // Highest version first
      });

      const keepRecord = sortedRecords[0];
      const fixRecords = sortedRecords.slice(1);

      const detail = {
        uniqueKey: group._id.substring(0, 16) + '...',
        securityName: keepRecord.securityName,
        portfolioCode: keepRecord.portfolioCode,
        duplicateCount: group.count,
        keepId: keepRecord._id.toString(),
        keepDate: keepRecord.snapshotDate,
        fixIds: fixRecords.map(r => r._id.toString())
      };
      details.push(detail);

      if (!dryRun) {
        // Mark all but the newest as isLatest: false
        const idsToFix = fixRecords.map(r => r._id);
        const now = new Date();

        await PMSHoldingsCollection.updateAsync(
          { _id: { $in: idsToFix } },
          {
            $set: {
              isLatest: false,
              replacedAt: now,
              replacedBy: keepRecord._id,
              updatedAt: now
            }
          },
          { multi: true }
        );

        totalRecordsFixed += fixRecords.length;
        console.log(`[PMS_HOLDINGS] Fixed ${fixRecords.length} duplicate records for ${keepRecord.securityName} (keeping ${keepRecord.snapshotDate})`);
      } else {
        totalRecordsFixed += fixRecords.length;
        console.log(`[PMS_HOLDINGS] DRY RUN: Would fix ${fixRecords.length} duplicates for ${keepRecord.securityName}`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[PMS_HOLDINGS] cleanupDuplicateLatest completed in ${elapsed}ms: ${duplicateGroups.length} keys with duplicates, ${totalRecordsFixed} records ${dryRun ? 'would be ' : ''}fixed`);

    return {
      duplicateKeysFound: duplicateGroups.length,
      recordsFixed: totalRecordsFixed,
      details: details.slice(0, 50), // Limit details to first 50 for readability
      dryRun,
      elapsed
    };
  },

  /**
   * Check and fix duplicate isLatest records for a specific uniqueKey
   * Called after insert to detect and handle race conditions immediately
   *
   * @param {string} uniqueKey - The uniqueKey to check
   * @returns {Promise<{hadDuplicates: boolean, fixedCount: number}>}
   */
  async checkAndFixDuplicatesForKey(uniqueKey) {
    const latestRecords = await PMSHoldingsCollection.find({
      uniqueKey,
      isLatest: true
    }, {
      sort: { snapshotDate: -1, version: -1 }
    }).fetchAsync();

    if (latestRecords.length <= 1) {
      return { hadDuplicates: false, fixedCount: 0 };
    }

    // Race condition detected! Keep only the newest
    console.log(`[PMS_HOLDINGS] Race condition detected: ${latestRecords.length} isLatest=true records for same uniqueKey`);

    const keepRecord = latestRecords[0];
    const fixRecords = latestRecords.slice(1);
    const now = new Date();

    await PMSHoldingsCollection.updateAsync(
      { _id: { $in: fixRecords.map(r => r._id) } },
      {
        $set: {
          isLatest: false,
          replacedAt: now,
          replacedBy: keepRecord._id,
          updatedAt: now
        }
      },
      { multi: true }
    );

    console.log(`[PMS_HOLDINGS] Fixed race condition: kept ${keepRecord.snapshotDate}, marked ${fixRecords.length} as not latest`);

    return { hadDuplicates: true, fixedCount: fixRecords.length };
  },

  /**
   * Clean up duplicate positions that have different uniqueKeys but represent the same holding
   * This happens when parser uniqueKey logic changes (e.g., from positionNumber to ISIN-based)
   *
   * Identifies duplicates by: bankId + portfolioCode (base) + isin
   * Keeps the newest record (by snapshotDate) as isLatest=true
   * Marks older records as isLatest=false
   *
   * @param {object} options - Cleanup options
   * @param {string} [options.bankId] - Limit to specific bank
   * @param {boolean} [options.dryRun=true] - If true, only report without fixing
   * @returns {Promise<{duplicateGroupsFound: number, recordsFixed: number, details: array}>}
   */
  async cleanupDuplicatesByIdentity(options = {}) {
    const { bankId, dryRun = true } = options;
    const startTime = Date.now();

    console.log(`[PMS_HOLDINGS] cleanupDuplicatesByIdentity started (dryRun=${dryRun}, bankId=${bankId || 'all'})`);

    // Build match query - only look at isLatest=true records with ISIN
    const matchQuery = { isLatest: true, isin: { $ne: null, $exists: true } };
    if (bankId) matchQuery.bankId = bankId;

    // Aggregation to find same (bankId, basePortfolioCode, isin) with different uniqueKeys
    const pipeline = [
      { $match: matchQuery },
      // Normalize portfolioCode to base (strip .XXX suffix)
      {
        $addFields: {
          basePortfolioCode: {
            $arrayElemAt: [{ $split: ['$portfolioCode', '.'] }, 0]
          }
        }
      },
      // Group by identity (bankId + basePortfolio + isin)
      {
        $group: {
          _id: {
            bankId: '$bankId',
            basePortfolioCode: '$basePortfolioCode',
            isin: '$isin'
          },
          count: { $sum: 1 },
          uniqueKeys: { $addToSet: '$uniqueKey' },
          records: {
            $push: {
              _id: '$_id',
              uniqueKey: '$uniqueKey',
              snapshotDate: '$snapshotDate',
              version: '$version',
              securityName: '$securityName',
              portfolioCode: '$portfolioCode'
            }
          }
        }
      },
      // Only groups with multiple uniqueKeys (the problem case)
      {
        $match: {
          $expr: { $gt: [{ $size: '$uniqueKeys' }, 1] }
        }
      },
      { $sort: { count: -1 } }
    ];

    const rawCollection = PMSHoldingsCollection.rawCollection();
    const duplicateGroups = await rawCollection.aggregate(pipeline).toArray();

    console.log(`[PMS_HOLDINGS] Found ${duplicateGroups.length} positions with multiple uniqueKeys (same bankId/portfolio/isin)`);

    if (duplicateGroups.length === 0) {
      return {
        duplicateGroupsFound: 0,
        recordsFixed: 0,
        details: [],
        dryRun,
        elapsed: Date.now() - startTime
      };
    }

    const details = [];
    let totalRecordsFixed = 0;

    for (const group of duplicateGroups) {
      // Sort records: newest snapshotDate first, then highest version
      const sortedRecords = group.records.sort((a, b) => {
        const dateA = new Date(a.snapshotDate).getTime();
        const dateB = new Date(b.snapshotDate).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return (b.version || 0) - (a.version || 0);
      });

      const keepRecord = sortedRecords[0];
      const fixRecords = sortedRecords.slice(1);

      const detail = {
        isin: group._id.isin,
        basePortfolioCode: group._id.basePortfolioCode,
        securityName: keepRecord.securityName,
        totalRecords: group.count,
        uniqueKeysCount: group.uniqueKeys.length,
        keepDate: keepRecord.snapshotDate,
        keepUniqueKey: keepRecord.uniqueKey.substring(0, 12) + '...',
        fixCount: fixRecords.length
      };
      details.push(detail);

      if (!dryRun) {
        const idsToFix = fixRecords.map(r => r._id);
        const now = new Date();

        // Mark duplicate records as not latest
        await PMSHoldingsCollection.updateAsync(
          { _id: { $in: idsToFix } },
          {
            $set: {
              isLatest: false,
              replacedAt: now,
              replacedBy: keepRecord._id,
              updatedAt: now
            }
          },
          { multi: true }
        );

        // ALSO: Deactivate ALL records with stale uniqueKeys (not just the isLatest ones)
        // This ensures historical queries don't show duplicates
        const staleUniqueKeys = [...new Set(fixRecords.map(r => r.uniqueKey))];
        if (staleUniqueKeys.length > 0) {
          const deactivateResult = await PMSHoldingsCollection.updateAsync(
            { uniqueKey: { $in: staleUniqueKeys } },
            {
              $set: {
                isActive: false,
                isLatest: false,
                replacedAt: now,
                replacedBy: keepRecord._id,
                updatedAt: now
              }
            },
            { multi: true }
          );
          console.log(`[PMS_HOLDINGS] Deactivated ${deactivateResult} records with stale uniqueKeys for ${keepRecord.securityName}`);
        }

        totalRecordsFixed += fixRecords.length;
        console.log(`[PMS_HOLDINGS] Fixed ${fixRecords.length} duplicate(s) for ${keepRecord.securityName} (${group._id.isin}) - kept ${keepRecord.snapshotDate}`);
      } else {
        totalRecordsFixed += fixRecords.length;
        console.log(`[PMS_HOLDINGS] DRY RUN: Would fix ${fixRecords.length} duplicate(s) for ${keepRecord.securityName} (${group._id.isin})`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[PMS_HOLDINGS] cleanupDuplicatesByIdentity completed in ${elapsed}ms: ${duplicateGroups.length} groups, ${totalRecordsFixed} records ${dryRun ? 'would be ' : ''}fixed`);

    return {
      duplicateGroupsFound: duplicateGroups.length,
      recordsFixed: totalRecordsFixed,
      details: details.slice(0, 50),
      dryRun,
      elapsed
    };
  },

  /**
   * Deactivate records with stale uniqueKeys - for positions that have already been partially cleaned
   * This method looks at ALL records (not just isLatest=true) to find and deactivate stale uniqueKeys
   *
   * @param {object} options - Cleanup options
   * @param {string} [options.bankId] - Limit to specific bank
   * @param {boolean} [options.dryRun=true] - If true, only report without fixing
   * @returns {Promise<{staleKeysFound: number, recordsDeactivated: number, details: array}>}
   */
  async deactivateStaleUniqueKeys(options = {}) {
    const { bankId, dryRun = true } = options;
    const startTime = Date.now();

    console.log(`[PMS_HOLDINGS] deactivateStaleUniqueKeys started (dryRun=${dryRun}, bankId=${bankId || 'all'})`);

    // Build match query - look at ALL records with ISIN (not just isLatest=true)
    const matchQuery = { isin: { $ne: null, $exists: true }, isActive: true };
    if (bankId) matchQuery.bankId = bankId;

    // Find positions with multiple uniqueKeys
    const pipeline = [
      { $match: matchQuery },
      {
        $addFields: {
          basePortfolioCode: {
            $arrayElemAt: [{ $split: ['$portfolioCode', '.'] }, 0]
          }
        }
      },
      {
        $group: {
          _id: {
            bankId: '$bankId',
            basePortfolioCode: '$basePortfolioCode',
            isin: '$isin'
          },
          uniqueKeys: { $addToSet: '$uniqueKey' },
          totalCount: { $sum: 1 },
          latestRecord: {
            $max: {
              snapshotDate: '$snapshotDate',
              uniqueKey: '$uniqueKey',
              securityName: '$securityName'
            }
          },
          recordsByKey: {
            $push: {
              uniqueKey: '$uniqueKey',
              snapshotDate: '$snapshotDate',
              isLatest: '$isLatest'
            }
          }
        }
      },
      {
        $match: {
          $expr: { $gt: [{ $size: '$uniqueKeys' }, 1] }
        }
      },
      { $sort: { totalCount: -1 } }
    ];

    const rawCollection = PMSHoldingsCollection.rawCollection();
    const duplicateGroups = await rawCollection.aggregate(pipeline).toArray();

    console.log(`[PMS_HOLDINGS] Found ${duplicateGroups.length} positions with multiple active uniqueKeys`);

    if (duplicateGroups.length === 0) {
      return {
        staleKeysFound: 0,
        recordsDeactivated: 0,
        details: [],
        dryRun,
        elapsed: Date.now() - startTime
      };
    }

    const details = [];
    let totalRecordsDeactivated = 0;
    let totalStaleKeys = 0;

    for (const group of duplicateGroups) {
      // Find the "correct" uniqueKey - the one with the newest snapshotDate
      const keyDates = {};
      for (const rec of group.recordsByKey) {
        const date = new Date(rec.snapshotDate).getTime();
        if (!keyDates[rec.uniqueKey] || date > keyDates[rec.uniqueKey]) {
          keyDates[rec.uniqueKey] = date;
        }
      }

      // Sort keys by newest date
      const sortedKeys = Object.entries(keyDates).sort((a, b) => b[1] - a[1]);
      const correctKey = sortedKeys[0][0];
      const staleKeys = sortedKeys.slice(1).map(([key]) => key);

      if (staleKeys.length === 0) continue;

      const detail = {
        isin: group._id.isin,
        basePortfolioCode: group._id.basePortfolioCode,
        securityName: group.latestRecord.securityName,
        correctKey: correctKey.substring(0, 12) + '...',
        staleKeysCount: staleKeys.length,
        totalRecords: group.totalCount
      };
      details.push(detail);
      totalStaleKeys += staleKeys.length;

      if (!dryRun) {
        const now = new Date();
        const deactivateResult = await PMSHoldingsCollection.updateAsync(
          { uniqueKey: { $in: staleKeys }, isActive: true },
          {
            $set: {
              isActive: false,
              isLatest: false,
              replacedAt: now,
              updatedAt: now
            }
          },
          { multi: true }
        );

        totalRecordsDeactivated += deactivateResult;
        console.log(`[PMS_HOLDINGS] Deactivated ${deactivateResult} records with stale uniqueKeys for ${group.latestRecord.securityName} (${group._id.isin})`);
      } else {
        // Count how many would be deactivated
        const wouldDeactivate = await PMSHoldingsCollection.find({
          uniqueKey: { $in: staleKeys },
          isActive: true
        }).countAsync();
        totalRecordsDeactivated += wouldDeactivate;
        console.log(`[PMS_HOLDINGS] DRY RUN: Would deactivate ${wouldDeactivate} records for ${group.latestRecord.securityName} (${group._id.isin})`);
      }
    }

    const elapsed = Date.now() - startTime;
    console.log(`[PMS_HOLDINGS] deactivateStaleUniqueKeys completed in ${elapsed}ms: ${totalStaleKeys} stale keys, ${totalRecordsDeactivated} records ${dryRun ? 'would be ' : ''}deactivated`);

    return {
      staleKeysFound: totalStaleKeys,
      recordsDeactivated: totalRecordsDeactivated,
      details: details.slice(0, 50),
      dryRun,
      elapsed
    };
  },

  /**
   * Deactivate ALL historical records for positions that have been marked as sold
   *
   * Problem: When an FX forward (or any position) is closed/sold, only the isLatest=true record
   * gets marked isActive=false. Historical records (same uniqueKey, isLatest=false) keep isActive=true.
   * This causes historical snapshot queries to show closed positions.
   *
   * Solution: Find all uniqueKeys where isLatest=true AND isActive=false AND soldAt exists,
   * then mark ALL records with those uniqueKeys as isActive=false.
   *
   * @param {object} options - Cleanup options
   * @param {string} [options.bankId] - Limit to specific bank
   * @param {string} [options.portfolioCode] - Limit to specific portfolio
   * @param {boolean} [options.dryRun=true] - If true, only report without fixing
   * @returns {Promise<{soldPositionsFound: number, historicalRecordsFixed: number, details: array}>}
   */
  async deactivateSoldPositions(options = {}) {
    const { bankId, portfolioCode, dryRun = true } = options;
    const startTime = Date.now();

    console.log(`[PMS_HOLDINGS] deactivateSoldPositions started (dryRun=${dryRun}, bankId=${bankId || 'all'}, portfolio=${portfolioCode || 'all'})`);

    // Build match query for finding sold positions (isLatest=true, isActive=false, soldAt exists)
    const soldQuery = {
      isLatest: true,
      isActive: false,
      soldAt: { $exists: true, $ne: null }
    };
    if (bankId) soldQuery.bankId = bankId;
    if (portfolioCode) soldQuery.portfolioCode = portfolioCode;

    // Find all sold positions
    const soldPositions = await PMSHoldingsCollection.find(soldQuery, {
      fields: { uniqueKey: 1, securityName: 1, portfolioCode: 1, soldAt: 1 }
    }).fetchAsync();

    console.log(`[PMS_HOLDINGS] Found ${soldPositions.length} sold positions (isLatest=true, isActive=false)`);

    if (soldPositions.length === 0) {
      return {
        soldPositionsFound: 0,
        historicalRecordsFixed: 0,
        details: [],
        dryRun,
        elapsed: Date.now() - startTime
      };
    }

    // Collect all uniqueKeys from sold positions
    const soldUniqueKeys = soldPositions.map(p => p.uniqueKey);

    // Find historical records that are still active (isActive=true or undefined) for these uniqueKeys
    const historicalQuery = {
      uniqueKey: { $in: soldUniqueKeys },
      isLatest: { $ne: true },  // Historical records only
      $or: [
        { isActive: true },
        { isActive: { $exists: false } }
      ]
    };

    const historicalRecords = await PMSHoldingsCollection.find(historicalQuery, {
      fields: { _id: 1, uniqueKey: 1, securityName: 1, portfolioCode: 1, snapshotDate: 1 }
    }).fetchAsync();

    console.log(`[PMS_HOLDINGS] Found ${historicalRecords.length} historical records still marked as active`);

    // Group by uniqueKey for detailed reporting
    const recordsByKey = {};
    for (const rec of historicalRecords) {
      if (!recordsByKey[rec.uniqueKey]) {
        recordsByKey[rec.uniqueKey] = {
          securityName: rec.securityName,
          portfolioCode: rec.portfolioCode,
          records: []
        };
      }
      recordsByKey[rec.uniqueKey].records.push({
        _id: rec._id,
        snapshotDate: rec.snapshotDate
      });
    }

    const details = [];
    for (const [uniqueKey, data] of Object.entries(recordsByKey)) {
      const soldPosition = soldPositions.find(p => p.uniqueKey === uniqueKey);
      details.push({
        uniqueKey: uniqueKey.substring(0, 16) + '...',
        securityName: data.securityName,
        portfolioCode: data.portfolioCode,
        soldAt: soldPosition?.soldAt,
        historicalRecordsToFix: data.records.length
      });
    }

    let totalRecordsFixed = 0;

    if (!dryRun && historicalRecords.length > 0) {
      const now = new Date();

      // Bulk update all historical records to isActive=false
      const idsToFix = historicalRecords.map(r => r._id);

      const result = await PMSHoldingsCollection.updateAsync(
        { _id: { $in: idsToFix } },
        {
          $set: {
            isActive: false,
            updatedAt: now
          }
        },
        { multi: true }
      );

      totalRecordsFixed = result;
      console.log(`[PMS_HOLDINGS] Fixed ${totalRecordsFixed} historical records (marked isActive=false)`);
    } else if (dryRun) {
      totalRecordsFixed = historicalRecords.length;
      console.log(`[PMS_HOLDINGS] DRY RUN: Would fix ${totalRecordsFixed} historical records`);
    }

    const elapsed = Date.now() - startTime;
    console.log(`[PMS_HOLDINGS] deactivateSoldPositions completed in ${elapsed}ms: ${soldPositions.length} sold positions, ${totalRecordsFixed} historical records ${dryRun ? 'would be ' : ''}fixed`);

    return {
      soldPositionsFound: soldPositions.length,
      historicalRecordsFixed: totalRecordsFixed,
      details: details.slice(0, 50),
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
