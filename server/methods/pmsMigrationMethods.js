import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { PMSOperationsCollection } from '../../imports/api/pmsOperations.js';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';

/**
 * Validate session and ensure user is superadmin
 */
async function validateSuperadminSession(sessionId) {
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

  if (user.role !== 'superadmin') {
    throw new Meteor.Error('not-authorized', 'Superadmin access required for migration operations');
  }

  return user;
}

/**
 * Find userId for a portfolio code by matching to bank accounts
 */
async function findUserIdForPortfolioCode(portfolioCode, bankId) {
  if (!portfolioCode || !bankId) {
    return null;
  }

  const bankAccount = await BankAccountsCollection.findOneAsync({
    accountNumber: portfolioCode,
    bankId: bankId,
    isActive: true
  });

  return bankAccount ? bankAccount.userId : null;
}

Meteor.methods({
  /**
   * Re-link existing PMS holdings to correct users based on portfolio code matching
   * SUPERADMIN ONLY - This modifies existing data
   */
  async 'pms.relinkHoldingsToUsers'({ sessionId }) {
    check(sessionId, String);

    // Validate superadmin access
    const user = await validateSuperadminSession(sessionId);

    console.log(`[PMS_MIGRATION] Holdings re-linking started by ${user.username}`);

    try {
      // Get all active holdings
      const allHoldings = await PMSHoldingsCollection.find({
        isActive: true
      }).fetchAsync();

      console.log(`[PMS_MIGRATION] Found ${allHoldings.length} active holdings to process`);

      let totalProcessed = 0;
      let matched = 0;
      let unmatchedCount = 0;
      const unmatchedPortfolioCodes = new Map(); // Map<portfolioCode, { bankId, count }>
      const errors = [];

      for (const holding of allHoldings) {
        totalProcessed++;

        try {
          // Find matching userId for this portfolio code
          const matchedUserId = await findUserIdForPortfolioCode(
            holding.portfolioCode,
            holding.bankId
          );

          if (matchedUserId) {
            // Update the holding with correct userId
            await PMSHoldingsCollection.updateAsync(holding._id, {
              $set: {
                userId: matchedUserId,
                updatedAt: new Date()
              }
            });

            matched++;
          } else {
            // Track unmapped portfolio codes
            unmatchedCount++;
            const key = `${holding.portfolioCode}|${holding.bankId}`;

            if (!unmatchedPortfolioCodes.has(key)) {
              unmatchedPortfolioCodes.set(key, {
                portfolioCode: holding.portfolioCode,
                bankId: holding.bankId,
                bankName: holding.bankName,
                count: 0
              });
            }
            unmatchedPortfolioCodes.get(key).count++;
          }
        } catch (error) {
          console.error(`[PMS_MIGRATION] Error processing holding ${holding._id}: ${error.message}`);
          errors.push({
            holdingId: holding._id,
            portfolioCode: holding.portfolioCode,
            error: error.message
          });
        }
      }

      const result = {
        success: true,
        totalProcessed,
        matched,
        unmatchedCount,
        unmatchedPortfolioCodes: Array.from(unmatchedPortfolioCodes.values()),
        errors: errors.length > 0 ? errors : undefined
      };

      console.log(
        `[PMS_MIGRATION] Holdings re-linking complete: ` +
        `${matched} matched, ${unmatchedCount} unmapped from ${totalProcessed} total`
      );

      if (unmatchedCount > 0) {
        console.log(
          `[PMS_MIGRATION] Unmapped portfolio codes: ${Array.from(unmatchedPortfolioCodes.values())
            .map(item => `${item.portfolioCode} (${item.bankName}): ${item.count} holdings`)
            .join(', ')}`
        );
      }

      return result;

    } catch (error) {
      console.error(`[PMS_MIGRATION] Holdings re-linking failed: ${error.message}`);
      throw new Meteor.Error('migration-failed', error.message);
    }
  },

  /**
   * Re-link existing PMS operations to correct users based on portfolio code matching
   * SUPERADMIN ONLY - This modifies existing data
   */
  async 'pms.relinkOperationsToUsers'({ sessionId }) {
    check(sessionId, String);

    // Validate superadmin access
    const user = await validateSuperadminSession(sessionId);

    console.log(`[PMS_MIGRATION] Operations re-linking started by ${user.username}`);

    try {
      // Get all active operations
      const allOperations = await PMSOperationsCollection.find({
        isActive: true
      }).fetchAsync();

      console.log(`[PMS_MIGRATION] Found ${allOperations.length} active operations to process`);

      let totalProcessed = 0;
      let matched = 0;
      let unmatchedCount = 0;
      const unmatchedPortfolioCodes = new Map();
      const errors = [];

      for (const operation of allOperations) {
        totalProcessed++;

        try {
          // Find matching userId for this portfolio code
          const matchedUserId = await findUserIdForPortfolioCode(
            operation.portfolioCode,
            operation.bankId
          );

          if (matchedUserId) {
            // Update the operation with correct userId
            await PMSOperationsCollection.updateAsync(operation._id, {
              $set: {
                userId: matchedUserId,
                updatedAt: new Date()
              }
            });

            matched++;
          } else {
            // Track unmapped portfolio codes
            unmatchedCount++;
            const key = `${operation.portfolioCode}|${operation.bankId}`;

            if (!unmatchedPortfolioCodes.has(key)) {
              unmatchedPortfolioCodes.set(key, {
                portfolioCode: operation.portfolioCode,
                bankId: operation.bankId,
                bankName: operation.bankName || 'Unknown',
                count: 0
              });
            }
            unmatchedPortfolioCodes.get(key).count++;
          }
        } catch (error) {
          console.error(`[PMS_MIGRATION] Error processing operation ${operation._id}: ${error.message}`);
          errors.push({
            operationId: operation._id,
            portfolioCode: operation.portfolioCode,
            error: error.message
          });
        }
      }

      const result = {
        success: true,
        totalProcessed,
        matched,
        unmatchedCount,
        unmatchedPortfolioCodes: Array.from(unmatchedPortfolioCodes.values()),
        errors: errors.length > 0 ? errors : undefined
      };

      console.log(
        `[PMS_MIGRATION] Operations re-linking complete: ` +
        `${matched} matched, ${unmatchedCount} unmapped from ${totalProcessed} total`
      );

      if (unmatchedCount > 0) {
        console.log(
          `[PMS_MIGRATION] Unmapped portfolio codes: ${Array.from(unmatchedPortfolioCodes.values())
            .map(item => `${item.portfolioCode} (${item.bankName}): ${item.count} operations`)
            .join(', ')}`
        );
      }

      return result;

    } catch (error) {
      console.error(`[PMS_MIGRATION] Operations re-linking failed: ${error.message}`);
      throw new Meteor.Error('migration-failed', error.message);
    }
  },

  /**
   * Re-link existing portfolio snapshots to correct users
   * SUPERADMIN ONLY - This modifies existing data
   */
  async 'pms.relinkSnapshotsToUsers'({ sessionId }) {
    check(sessionId, String);

    // Validate superadmin access
    const user = await validateSuperadminSession(sessionId);

    console.log(`[PMS_MIGRATION] Snapshots re-linking started by ${user.username}`);

    try {
      // Get all snapshots
      const allSnapshots = await PortfolioSnapshotsCollection.find({}).fetchAsync();

      console.log(`[PMS_MIGRATION] Found ${allSnapshots.length} snapshots to process`);

      let totalProcessed = 0;
      let matched = 0;
      let unmatchedCount = 0;
      const unmatchedPortfolioCodes = new Map();

      for (const snapshot of allSnapshots) {
        totalProcessed++;

        try {
          // Find matching userId for this portfolio code
          const matchedUserId = await findUserIdForPortfolioCode(
            snapshot.portfolioCode,
            snapshot.bankId
          );

          if (matchedUserId) {
            // Update the snapshot with correct userId
            await PortfolioSnapshotsCollection.updateAsync(snapshot._id, {
              $set: {
                userId: matchedUserId
              }
            });

            matched++;
          } else {
            unmatchedCount++;
            const key = `${snapshot.portfolioCode}|${snapshot.bankId}`;

            if (!unmatchedPortfolioCodes.has(key)) {
              unmatchedPortfolioCodes.set(key, {
                portfolioCode: snapshot.portfolioCode,
                bankId: snapshot.bankId,
                bankName: snapshot.bankName,
                count: 0
              });
            }
            unmatchedPortfolioCodes.get(key).count++;
          }
        } catch (error) {
          console.error(`[PMS_MIGRATION] Error processing snapshot ${snapshot._id}: ${error.message}`);
        }
      }

      const result = {
        success: true,
        totalProcessed,
        matched,
        unmatchedCount,
        unmappedPortfolioCodes: Array.from(unmatchedPortfolioCodes.values())
      };

      console.log(
        `[PMS_MIGRATION] Snapshots re-linking complete: ` +
        `${matched} matched, ${unmatchedCount} unmapped from ${totalProcessed} total`
      );

      return result;

    } catch (error) {
      console.error(`[PMS_MIGRATION] Snapshots re-linking failed: ${error.message}`);
      throw new Meteor.Error('migration-failed', error.message);
    }
  },

  /**
   * Get list of unmapped portfolio codes in current PMS data
   * Useful for admins to see what bank accounts need to be created
   */
  async 'pms.getUnmappedPortfolioCodes'({ sessionId }) {
    check(sessionId, String);

    // Validate superadmin access
    await validateSuperadminSession(sessionId);

    try {
      // Get unique portfolio codes from holdings
      const holdingsPortfolioCodes = await PMSHoldingsCollection.rawCollection()
        .aggregate([
          { $match: { isActive: true } },
          {
            $group: {
              _id: { portfolioCode: '$portfolioCode', bankId: '$bankId' },
              bankName: { $first: '$bankName' },
              count: { $sum: 1 }
            }
          }
        ]).toArray();

      // Get unique portfolio codes from operations
      const operationsPortfolioCodes = await PMSOperationsCollection.rawCollection()
        .aggregate([
          { $match: { isActive: true } },
          {
            $group: {
              _id: { portfolioCode: '$portfolioCode', bankId: '$bankId' },
              bankName: { $first: '$bankName' },
              count: { $sum: 1 }
            }
          }
        ]).toArray();

      // Check which ones are unmapped
      const unmappedHoldings = [];
      for (const item of holdingsPortfolioCodes) {
        const userId = await findUserIdForPortfolioCode(item._id.portfolioCode, item._id.bankId);
        if (!userId) {
          unmappedHoldings.push({
            portfolioCode: item._id.portfolioCode,
            bankId: item._id.bankId,
            bankName: item.bankName,
            count: item.count
          });
        }
      }

      const unmappedOperations = [];
      for (const item of operationsPortfolioCodes) {
        const userId = await findUserIdForPortfolioCode(item._id.portfolioCode, item._id.bankId);
        if (!userId) {
          unmappedOperations.push({
            portfolioCode: item._id.portfolioCode,
            bankId: item._id.bankId,
            bankName: item.bankName || 'Unknown',
            count: item.count
          });
        }
      }

      return {
        unmappedHoldings,
        unmappedOperations,
        totalUnmappedHoldings: unmappedHoldings.reduce((sum, item) => sum + item.count, 0),
        totalUnmappedOperations: unmappedOperations.reduce((sum, item) => sum + item.count, 0)
      };

    } catch (error) {
      console.error(`[PMS_MIGRATION] Failed to get unmapped codes: ${error.message}`);
      throw new Meteor.Error('query-failed', error.message);
    }
  },

  /**
   * Diagnose PMSHoldings database state
   * SUPERADMIN ONLY - Check isLatest flag status across all holdings
   */
  async 'pms.diagnoseHoldingsState'({ sessionId }) {
    check(sessionId, String);

    // Validate superadmin access
    const user = await validateSuperadminSession(sessionId);

    console.log(`[PMS_DIAGNOSTIC] Holdings diagnosis started by ${user.username}`);

    try {
      // Count holdings by different criteria
      const totalHoldings = await PMSHoldingsCollection.find({}).countAsync();
      const activeHoldings = await PMSHoldingsCollection.find({ isActive: true }).countAsync();
      const withIsLatestTrue = await PMSHoldingsCollection.find({ isLatest: true }).countAsync();
      const withIsLatestFalse = await PMSHoldingsCollection.find({ isLatest: false }).countAsync();
      const withoutIsLatest = await PMSHoldingsCollection.find({ isLatest: { $exists: false } }).countAsync();
      const activeWithIsLatestTrue = await PMSHoldingsCollection.find({ isActive: true, isLatest: true }).countAsync();

      // Get sample holdings
      const sampleWithoutFlag = await PMSHoldingsCollection.find(
        { isActive: true, isLatest: { $exists: false } },
        { limit: 3 }
      ).fetchAsync();

      const sampleWithFalse = await PMSHoldingsCollection.find(
        { isActive: true, isLatest: false },
        { limit: 3 }
      ).fetchAsync();

      const result = {
        totalHoldings,
        activeHoldings,
        withIsLatestTrue,
        withIsLatestFalse,
        withoutIsLatest,
        activeWithIsLatestTrue,
        problem: activeWithIsLatestTrue === 0 && activeHoldings > 0,
        samples: {
          withoutFlag: sampleWithoutFlag.map(h => ({
            _id: h._id,
            securityName: h.securityName,
            portfolioCode: h.portfolioCode,
            isActive: h.isActive,
            isLatest: h.isLatest,
            hasVersionField: !!h.version
          })),
          withFalse: sampleWithFalse.map(h => ({
            _id: h._id,
            securityName: h.securityName,
            portfolioCode: h.portfolioCode,
            isActive: h.isActive,
            isLatest: h.isLatest,
            version: h.version
          }))
        }
      };

      console.log('[PMS_DIAGNOSTIC] Holdings state:', result);

      return result;

    } catch (error) {
      console.error(`[PMS_DIAGNOSTIC] Holdings diagnosis failed: ${error.message}`);
      throw new Meteor.Error('diagnostic-failed', error.message);
    }
  },

  /**
   * Set isLatest flag on all existing PMSHoldings that don't have versioning
   * SUPERADMIN ONLY - This fixes holdings that existed before versioning was added
   */
  async 'pms.setIsLatestFlag'({ sessionId }) {
    check(sessionId, String);

    // Validate superadmin access
    const user = await validateSuperadminSession(sessionId);

    console.log(`[PMS_MIGRATION] Setting isLatest flags started by ${user.username}`);

    try {
      // Find all holdings that don't have isLatest field set
      const holdingsWithoutFlag = await PMSHoldingsCollection.find({
        isActive: true,
        isLatest: { $exists: false }
      }).fetchAsync();

      console.log(`[PMS_MIGRATION] Found ${holdingsWithoutFlag.length} holdings without isLatest flag`);

      let updated = 0;

      // Set isLatest: true for all holdings without the flag
      for (const holding of holdingsWithoutFlag) {
        await PMSHoldingsCollection.updateAsync(holding._id, {
          $set: {
            isLatest: true,
            version: 1,
            snapshotDate: holding.dataDate || holding.fileDate || new Date(),
            updatedAt: new Date()
          }
        });
        updated++;
      }

      console.log(`[PMS_MIGRATION] Set isLatest flag on ${updated} holdings`);

      return {
        success: true,
        totalProcessed: holdingsWithoutFlag.length,
        updated
      };

    } catch (error) {
      console.error(`[PMS_MIGRATION] Setting isLatest flags failed: ${error.message}`);
      throw new Meteor.Error('migration-failed', error.message);
    }
  },

  /**
   * Deduplicate portfolio snapshots by normalizing dates to midnight UTC
   * SUPERADMIN ONLY - Removes duplicate snapshots created with different timestamps on same day
   *
   * The bug: snapshotDate was stored with full timestamps (e.g., 2024-12-08T10:30:00Z)
   * causing multiple snapshots per day when files were reprocessed.
   *
   * This migration:
   * 1. Groups snapshots by (userId, portfolioCode, dateOnly)
   * 2. For groups with multiple snapshots, keeps the one with highest totalAccountValue
   * 3. Deletes duplicate snapshots
   * 4. Normalizes all remaining snapshot dates to midnight UTC
   */
  async 'pmsSnapshots.deduplicateMigration'({ sessionId, dryRun = true }) {
    check(sessionId, String);

    // Validate superadmin access
    const user = await validateSuperadminSession(sessionId);

    console.log(`[PMS_MIGRATION] Snapshot deduplication started by ${user.username} (dryRun: ${dryRun})`);

    try {
      // Get all snapshots
      const allSnapshots = await PortfolioSnapshotsCollection.find({}).fetchAsync();
      console.log(`[PMS_MIGRATION] Found ${allSnapshots.length} total snapshots`);

      // Group by (userId, portfolioCode, dateOnly)
      const groups = new Map();

      for (const snapshot of allSnapshots) {
        // Normalize date to YYYY-MM-DD string for grouping
        const dateOnly = snapshot.snapshotDate.toISOString().split('T')[0];
        const key = `${snapshot.userId}|${snapshot.portfolioCode || 'null'}|${dateOnly}`;

        if (!groups.has(key)) {
          groups.set(key, []);
        }
        groups.get(key).push(snapshot);
      }

      console.log(`[PMS_MIGRATION] Grouped into ${groups.size} unique (userId, portfolioCode, date) combinations`);

      let duplicateGroupCount = 0;
      let snapshotsToDelete = 0;
      let snapshotsToNormalize = 0;
      const deletions = [];
      const normalizations = [];

      for (const [key, snapshots] of groups) {
        if (snapshots.length > 1) {
          // Multiple snapshots for same day - keep the one with highest totalAccountValue
          duplicateGroupCount++;

          // Sort by totalAccountValue descending, then by processingDate descending (most recent)
          snapshots.sort((a, b) => {
            const valueDiff = (b.totalAccountValue || 0) - (a.totalAccountValue || 0);
            if (valueDiff !== 0) return valueDiff;
            return (b.processingDate || b.createdAt || new Date(0)) - (a.processingDate || a.createdAt || new Date(0));
          });

          const keeper = snapshots[0];
          const toDelete = snapshots.slice(1);

          snapshotsToDelete += toDelete.length;

          for (const dup of toDelete) {
            deletions.push({
              _id: dup._id,
              portfolioCode: dup.portfolioCode,
              snapshotDate: dup.snapshotDate,
              totalAccountValue: dup.totalAccountValue
            });
          }

          // Normalize the keeper's date
          const normalizedDate = new Date(keeper.snapshotDate);
          normalizedDate.setUTCHours(0, 0, 0, 0);

          if (keeper.snapshotDate.getTime() !== normalizedDate.getTime()) {
            snapshotsToNormalize++;
            normalizations.push({
              _id: keeper._id,
              oldDate: keeper.snapshotDate,
              newDate: normalizedDate
            });
          }
        } else {
          // Single snapshot - just normalize the date if needed
          const snapshot = snapshots[0];
          const normalizedDate = new Date(snapshot.snapshotDate);
          normalizedDate.setUTCHours(0, 0, 0, 0);

          if (snapshot.snapshotDate.getTime() !== normalizedDate.getTime()) {
            snapshotsToNormalize++;
            normalizations.push({
              _id: snapshot._id,
              oldDate: snapshot.snapshotDate,
              newDate: normalizedDate
            });
          }
        }
      }

      console.log(`[PMS_MIGRATION] Found ${duplicateGroupCount} groups with duplicates`);
      console.log(`[PMS_MIGRATION] Snapshots to delete: ${snapshotsToDelete}`);
      console.log(`[PMS_MIGRATION] Snapshots to normalize: ${snapshotsToNormalize}`);

      // If not a dry run, perform the actual changes
      let deletedCount = 0;
      let normalizedCount = 0;

      if (!dryRun) {
        // Delete duplicates
        for (const del of deletions) {
          await PortfolioSnapshotsCollection.removeAsync(del._id);
          deletedCount++;
        }
        console.log(`[PMS_MIGRATION] Deleted ${deletedCount} duplicate snapshots`);

        // Normalize dates
        for (const norm of normalizations) {
          await PortfolioSnapshotsCollection.updateAsync(norm._id, {
            $set: {
              snapshotDate: norm.newDate,
              updatedAt: new Date()
            }
          });
          normalizedCount++;
        }
        console.log(`[PMS_MIGRATION] Normalized ${normalizedCount} snapshot dates`);
      }

      const result = {
        success: true,
        dryRun,
        totalSnapshots: allSnapshots.length,
        uniqueGroups: groups.size,
        duplicateGroups: duplicateGroupCount,
        snapshotsToDelete,
        snapshotsToNormalize,
        deletedCount: dryRun ? 0 : deletedCount,
        normalizedCount: dryRun ? 0 : normalizedCount,
        sampleDeletions: deletions.slice(0, 10),
        sampleNormalizations: normalizations.slice(0, 10)
      };

      console.log(`[PMS_MIGRATION] Deduplication complete:`, result);

      return result;

    } catch (error) {
      console.error(`[PMS_MIGRATION] Snapshot deduplication failed: ${error.message}`);
      throw new Meteor.Error('migration-failed', error.message);
    }
  },

  /**
   * Run all migration tasks (holdings, operations, snapshots)
   * SUPERADMIN ONLY - Convenience method to run all migrations at once
   */
  async 'pms.runFullMigration'({ sessionId }) {
    check(sessionId, String);

    // Validate superadmin access
    const user = await validateSuperadminSession(sessionId);

    console.log(`[PMS_MIGRATION] Full migration started by ${user.username}`);

    try {
      // Run all migrations in sequence
      const holdingsResult = await Meteor.callAsync('pms.relinkHoldingsToUsers', { sessionId });
      const operationsResult = await Meteor.callAsync('pms.relinkOperationsToUsers', { sessionId });
      const snapshotsResult = await Meteor.callAsync('pms.relinkSnapshotsToUsers', { sessionId });

      const totalMatched = holdingsResult.matched + operationsResult.matched + snapshotsResult.matched;
      const totalUnmapped = holdingsResult.unmatchedCount + operationsResult.unmatchedCount + snapshotsResult.unmatchedCount;

      console.log(
        `[PMS_MIGRATION] Full migration complete: ${totalMatched} total matched, ${totalUnmapped} total unmapped`
      );

      return {
        success: true,
        holdings: holdingsResult,
        operations: operationsResult,
        snapshots: snapshotsResult,
        summary: {
          totalMatched,
          totalUnmapped
        }
      };

    } catch (error) {
      console.error(`[PMS_MIGRATION] Full migration failed: ${error.message}`);
      throw new Meteor.Error('migration-failed', error.message);
    }
  }
});
