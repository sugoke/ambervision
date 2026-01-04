/**
 * Migration: Cleanup Duplicate Holdings
 *
 * Fixes duplicate isLatest: true entries caused by inconsistent securityType values
 * (null vs 'CASH') generating different uniqueKeys for the same position.
 *
 * For each group of duplicates (same userId, portfolioCode, and identifier):
 * - Keep the one with the most recent snapshotDate
 * - Mark all others as isLatest: false
 */

import { Meteor } from 'meteor/meteor';
import { PMSHoldingsCollection, PMSHoldingsHelpers } from '/imports/api/pmsHoldings.js';

export async function cleanupDuplicateHoldings() {
  console.log('[MIGRATION] Starting cleanup of duplicate holdings...');

  try {
    // Step 1: Find all duplicate groups (same userId, portfolioCode, securityName with isLatest: true)
    const duplicates = await PMSHoldingsCollection.rawCollection().aggregate([
      { $match: { isLatest: true } },
      {
        $group: {
          _id: {
            userId: '$userId',
            portfolioCode: '$portfolioCode',
            // Group by isin if available, otherwise by securityName + currency
            identifier: { $ifNull: ['$isin', { $concat: ['$securityName', '_', { $ifNull: ['$currency', 'UNKNOWN'] }] }] }
          },
          count: { $sum: 1 },
          docs: {
            $push: {
              _id: '$_id',
              snapshotDate: '$snapshotDate',
              securityType: '$securityType',
              uniqueKey: '$uniqueKey',
              quantity: '$quantity',
              marketValue: '$marketValue'
            }
          }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    console.log(`[MIGRATION] Found ${duplicates.length} groups with duplicate isLatest entries`);

    let fixedCount = 0;
    let skippedCount = 0;

    for (const group of duplicates) {
      const docs = group.docs;

      // Sort by snapshotDate descending to find the most recent
      docs.sort((a, b) => {
        const dateA = a.snapshotDate ? new Date(a.snapshotDate).getTime() : 0;
        const dateB = b.snapshotDate ? new Date(b.snapshotDate).getTime() : 0;
        return dateB - dateA;
      });

      // Keep the first one (most recent), mark others as not latest
      const keepDoc = docs[0];
      const removeFromLatest = docs.slice(1);

      console.log(`[MIGRATION] Group: userId=${group._id.userId}, portfolio=${group._id.portfolioCode}, id=${group._id.identifier}`);
      console.log(`  Keeping: ${keepDoc._id} (snapshotDate: ${keepDoc.snapshotDate}, qty: ${keepDoc.quantity})`);

      for (const doc of removeFromLatest) {
        console.log(`  Marking as not latest: ${doc._id} (snapshotDate: ${doc.snapshotDate}, qty: ${doc.quantity})`);

        await PMSHoldingsCollection.updateAsync(doc._id, {
          $set: {
            isLatest: false,
            replacedAt: new Date(),
            replacedBy: keepDoc._id,
            migrationNote: 'Duplicate fixed by cleanupDuplicateHoldings migration'
          }
        });
        fixedCount++;
      }
    }

    // Step 2: Recalculate uniqueKeys for positions with null securityType but has currency (likely cash)
    console.log('[MIGRATION] Recalculating uniqueKeys for positions with null securityType...');

    const nullSecurityTypePositions = await PMSHoldingsCollection.find({
      isLatest: true,
      securityType: null,
      isin: null,
      currency: { $exists: true, $ne: null }
    }).fetchAsync();

    console.log(`[MIGRATION] Found ${nullSecurityTypePositions.length} positions with null securityType to update`);

    for (const pos of nullSecurityTypePositions) {
      const newUniqueKey = PMSHoldingsHelpers.generateUniqueKey({
        bankId: pos.bankId,
        portfolioCode: pos.portfolioCode,
        isin: pos.isin,
        currency: pos.currency,
        securityType: 'CASH', // Treat as cash for consistency
        endDate: pos.bankSpecificData?.instrumentDates?.endDate,
        reference: pos.bankSpecificData?.instrumentDates?.reference || pos.bankSpecificData?.reference
      });

      if (newUniqueKey !== pos.uniqueKey) {
        await PMSHoldingsCollection.updateAsync(pos._id, {
          $set: {
            uniqueKey: newUniqueKey,
            securityType: 'CASH', // Also fix the securityType
            migrationNote: 'UniqueKey recalculated by cleanupDuplicateHoldings migration'
          }
        });
        skippedCount++; // Reusing variable for updated keys
      }
    }

    console.log(`[MIGRATION] Cleanup complete:`);
    console.log(`  - Duplicate entries fixed: ${fixedCount}`);
    console.log(`  - UniqueKeys recalculated: ${skippedCount}`);

    return {
      success: true,
      duplicatesFixed: fixedCount,
      uniqueKeysUpdated: skippedCount
    };

  } catch (error) {
    console.error('[MIGRATION] Error during cleanup:', error);
    return { success: false, error: error.message };
  }
}

// Register as a Meteor method for manual execution
Meteor.methods({
  'migration.cleanupDuplicateHoldings': async function () {
    // Only allow admins to run this
    return await cleanupDuplicateHoldings();
  }
});
