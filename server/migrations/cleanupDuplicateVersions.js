/**
 * Migration: Clean up duplicate PMSHoldings versions
 *
 * Problem: Due to timestamp comparison bug, multiple versions were created
 * for the same date when reprocessing files.
 *
 * Solution: Keep only the highest version per uniqueKey + date combination,
 * delete all other duplicates.
 */

import { Meteor } from 'meteor/meteor';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';

export async function cleanupDuplicateVersions() {
  console.log('[MIGRATION] Starting cleanup of duplicate PMSHoldings versions...');

  const startTime = Date.now();

  // Get all unique keys
  const uniqueKeys = await PMSHoldingsCollection.rawCollection().distinct('uniqueKey');
  console.log(`[MIGRATION] Found ${uniqueKeys.length} unique holdings to check`);

  let totalDeleted = 0;
  let holdingsProcessed = 0;
  let holdingsWithDuplicates = 0;

  for (const uniqueKey of uniqueKeys) {
    // Get all versions for this holding
    const allVersions = await PMSHoldingsCollection.find(
      { uniqueKey },
      { sort: { snapshotDate: 1, version: -1 } }
    ).fetchAsync();

    if (allVersions.length <= 1) {
      holdingsProcessed++;
      continue;
    }

    // Group by date (normalize to YYYY-MM-DD)
    const byDate = {};
    for (const holding of allVersions) {
      const dateKey = holding.snapshotDate.toISOString().split('T')[0];
      if (!byDate[dateKey]) {
        byDate[dateKey] = [];
      }
      byDate[dateKey].push(holding);
    }

    // Find duplicates (more than one version per date)
    const idsToDelete = [];
    let keepLatestId = null;

    for (const [dateKey, holdings] of Object.entries(byDate)) {
      if (holdings.length > 1) {
        // Sort by version descending, keep the highest
        holdings.sort((a, b) => (b.version || 0) - (a.version || 0));
        const keep = holdings[0];
        const duplicates = holdings.slice(1);

        idsToDelete.push(...duplicates.map(h => h._id));
      }
    }

    // Also determine the correct "latest" - highest date, then highest version
    const sortedByDateDesc = Object.entries(byDate)
      .sort((a, b) => b[0].localeCompare(a[0]));

    if (sortedByDateDesc.length > 0) {
      const latestDateHoldings = sortedByDateDesc[0][1];
      latestDateHoldings.sort((a, b) => (b.version || 0) - (a.version || 0));
      keepLatestId = latestDateHoldings[0]._id;
    }

    if (idsToDelete.length > 0) {
      holdingsWithDuplicates++;

      // Delete duplicates
      const deleteResult = await PMSHoldingsCollection.removeAsync({
        _id: { $in: idsToDelete }
      });

      totalDeleted += deleteResult;

      // Recalculate versions after cleanup
      const remaining = await PMSHoldingsCollection.find(
        { uniqueKey },
        { sort: { snapshotDate: 1 } }
      ).fetchAsync();

      // Renumber versions sequentially
      for (let i = 0; i < remaining.length; i++) {
        const isLast = i === remaining.length - 1;
        await PMSHoldingsCollection.updateAsync(remaining[i]._id, {
          $set: {
            version: i + 1,
            isLatest: isLast
          }
        });
      }

      const securityName = allVersions[0]?.securityName || uniqueKey;
      console.log(`[MIGRATION] ${securityName}: deleted ${idsToDelete.length} duplicates, kept ${remaining.length} versions`);
    }

    holdingsProcessed++;

    // Progress log every 100 holdings
    if (holdingsProcessed % 100 === 0) {
      console.log(`[MIGRATION] Progress: ${holdingsProcessed}/${uniqueKeys.length} holdings processed...`);
    }
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`[MIGRATION] Cleanup complete in ${duration}s:`);
  console.log(`[MIGRATION]   - Holdings checked: ${holdingsProcessed}`);
  console.log(`[MIGRATION]   - Holdings with duplicates: ${holdingsWithDuplicates}`);
  console.log(`[MIGRATION]   - Total records deleted: ${totalDeleted}`);

  return {
    holdingsProcessed,
    holdingsWithDuplicates,
    totalDeleted,
    duration
  };
}

// Meteor method to run migration
if (Meteor.isServer) {
  Meteor.methods({
    async 'migration.cleanupDuplicateVersions'(sessionId) {
      const { check } = await import('meteor/check');
      check(sessionId, String);

      // Authenticate user - only superadmin
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Superadmin privileges required');
      }

      console.log(`[MIGRATION] Triggered by ${currentUser.email}`);

      return await cleanupDuplicateVersions();
    }
  });
}
