/**
 * Migration Script: PMSHoldings Versioning
 *
 * Migrates existing PMSHoldings data to support versioning system.
 *
 * Changes:
 * 1. Regenerate uniqueKey without fileDate
 * 2. Add snapshotDate, processedAt, isLatest fields
 * 3. Group by new uniqueKey and establish version chain
 * 4. Mark latest version with isLatest: true
 * 5. Link historical versions with replacedBy references
 *
 * Usage:
 * Run this script once after deploying the new versioning code.
 * Can be run safely multiple times (idempotent).
 */

import { Meteor } from 'meteor/meteor';
import { PMSHoldingsCollection, PMSHoldingsHelpers } from '/imports/api/pmsHoldings';

export async function migratePMSHoldingsVersioning() {
  console.log('[MIGRATION] Starting PMSHoldings versioning migration...');

  try {
    // Get all existing holdings
    const allHoldings = await PMSHoldingsCollection.find({}).fetchAsync();
    console.log(`[MIGRATION] Found ${allHoldings.length} total holdings to migrate`);

    if (allHoldings.length === 0) {
      console.log('[MIGRATION] No holdings to migrate. Migration complete.');
      return { success: true, migrated: 0 };
    }

    // Group by new uniqueKey (without fileDate)
    const byUniqueKey = new Map();

    for (const holding of allHoldings) {
      // Generate new uniqueKey without fileDate
      const newKey = PMSHoldingsHelpers.generateUniqueKey({
        bankId: holding.bankId,
        portfolioCode: holding.portfolioCode,
        isin: holding.isin,
        currency: holding.currency,
        securityType: holding.securityType
        // No fileDate!
      });

      if (!byUniqueKey.has(newKey)) {
        byUniqueKey.set(newKey, []);
      }
      byUniqueKey.get(newKey).push(holding);
    }

    console.log(`[MIGRATION] Grouped into ${byUniqueKey.size} unique positions`);

    let migratedCount = 0;
    let versionsCreated = 0;

    // Process each group
    for (const [newKey, versions] of byUniqueKey) {
      // Sort by fileDate descending (latest first)
      versions.sort((a, b) => {
        const dateA = a.fileDate || new Date(0);
        const dateB = b.fileDate || new Date(0);
        return dateB - dateA;
      });

      // Mark the latest as isLatest: true
      const latest = versions[0];
      await PMSHoldingsCollection.updateAsync(latest._id, {
        $set: {
          uniqueKey: newKey,
          snapshotDate: latest.fileDate || latest.createdAt,
          processedAt: latest.createdAt || new Date(),
          isLatest: true
        }
      });

      migratedCount++;
      console.log(`[MIGRATION] [${migratedCount}/${byUniqueKey.size}] Migrated latest version: ${latest.securityName} (${versions.length} versions)`);

      // Mark others as historical
      for (let i = 1; i < versions.length; i++) {
        const older = versions[i];
        const newerVersion = versions[i - 1];

        await PMSHoldingsCollection.updateAsync(older._id, {
          $set: {
            uniqueKey: newKey,
            snapshotDate: older.fileDate || older.createdAt,
            processedAt: older.createdAt || new Date(),
            isLatest: false,
            replacedBy: newerVersion._id,
            replacedAt: newerVersion.createdAt || new Date()
          }
        });

        versionsCreated++;
      }
    }

    console.log('[MIGRATION] ✅ Migration complete!');
    console.log(`[MIGRATION] Summary:`);
    console.log(`[MIGRATION]   - Total unique positions: ${byUniqueKey.size}`);
    console.log(`[MIGRATION]   - Latest versions marked: ${migratedCount}`);
    console.log(`[MIGRATION]   - Historical versions linked: ${versionsCreated}`);

    return {
      success: true,
      uniquePositions: byUniqueKey.size,
      latestVersions: migratedCount,
      historicalVersions: versionsCreated
    };

  } catch (error) {
    console.error('[MIGRATION] ❌ Migration failed:', error);
    throw error;
  }
}

// Create a Meteor method to run the migration
if (Meteor.isServer) {
  Meteor.methods({
    async 'pmsHoldings.runVersioningMigration'() {
      // Only allow admins/superadmins to run migration
      const user = await Meteor.users.findOneAsync(this.userId);
      if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
        throw new Meteor.Error('not-authorized', 'Only administrators can run migrations');
      }

      console.log(`[MIGRATION] Migration triggered by user: ${user.username}`);
      return await migratePMSHoldingsVersioning();
    }
  });
}
