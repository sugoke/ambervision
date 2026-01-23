/**
 * Migration Script: Normalize Operation Types
 *
 * This migration normalizes all existing pmsOperations records to use the standardized
 * Ambervision operation types defined in operationTypes.js
 *
 * Affected banks:
 * - CMB Monaco: Raw codes (mba$*, sectrx2_*) → Standardized types
 * - CFM: Already normalized (BUY, SELL, etc.) → Verify consistency
 * - Andbank: Already normalized → Verify consistency
 *
 * Run this migration after deploying the operationTypes.js constants file.
 */

import { Meteor } from 'meteor/meteor';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import {
  OPERATION_TYPES,
  mapCMBOperationType,
  normalizeOperationType,
  isValidOperationType
} from '/imports/api/constants/operationTypes';

/**
 * Migration function to normalize operation types
 * @param {boolean} dryRun - If true, only logs changes without updating
 * @returns {object} Migration results summary
 */
export async function migrateOperationTypes(dryRun = true) {
  console.log(`\n========================================`);
  console.log(`OPERATION TYPES MIGRATION ${dryRun ? '(DRY RUN)' : '(LIVE)'}`);
  console.log(`========================================\n`);

  const results = {
    total: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    byBank: {},
    byOldType: {},
    byNewType: {}
  };

  // Get all operations
  const operations = await PMSOperationsCollection.find({}).fetchAsync();
  results.total = operations.length;

  console.log(`Found ${operations.length} operations to process\n`);

  for (const op of operations) {
    const bankName = op.bankName || 'Unknown';

    // Initialize bank counter
    if (!results.byBank[bankName]) {
      results.byBank[bankName] = { total: 0, updated: 0, skipped: 0 };
    }
    results.byBank[bankName].total++;

    const oldType = op.operationType;

    // Track old types
    if (!results.byOldType[oldType]) {
      results.byOldType[oldType] = 0;
    }
    results.byOldType[oldType]++;

    let newType = oldType;
    let updateNeeded = false;

    // Determine if update is needed and what the new type should be
    if (bankName === 'CMB' || bankName === 'CMB Monaco') {
      // CMB Monaco: Map raw codes to standardized types
      const orderTypeId = op.bankSpecificData?.orderTypeId || op.operationType;
      const metaTypeId = op.bankSpecificData?.metaTypeId || op.transactionCategory;
      const amount = op.netAmount || op.grossAmount || 0;

      newType = mapCMBOperationType(orderTypeId, metaTypeId, amount);

      if (newType !== oldType) {
        updateNeeded = true;
      }
    } else {
      // CFM, Andbank, etc.: Verify and normalize if needed
      if (!isValidOperationType(oldType)) {
        newType = normalizeOperationType(oldType);
        if (newType !== oldType) {
          updateNeeded = true;
        }
      }
    }

    // Track new types
    if (!results.byNewType[newType]) {
      results.byNewType[newType] = 0;
    }
    results.byNewType[newType]++;

    if (updateNeeded) {
      console.log(`[${bankName}] ${op._id}: "${oldType}" → "${newType}"`);

      if (!dryRun) {
        try {
          await PMSOperationsCollection.updateAsync(
            { _id: op._id },
            {
              $set: {
                operationType: newType,
                // Preserve original type in bankSpecificData
                'bankSpecificData.originalOperationType': oldType,
                updatedAt: new Date()
              }
            }
          );
          results.updated++;
          results.byBank[bankName].updated++;
        } catch (err) {
          console.error(`Error updating ${op._id}:`, err.message);
          results.errors++;
        }
      } else {
        results.updated++;
        results.byBank[bankName].updated++;
      }
    } else {
      results.skipped++;
      results.byBank[bankName].skipped++;
    }
  }

  // Print summary
  console.log(`\n========================================`);
  console.log(`MIGRATION SUMMARY ${dryRun ? '(DRY RUN)' : '(COMPLETE)'}`);
  console.log(`========================================`);
  console.log(`Total operations: ${results.total}`);
  console.log(`Updated: ${results.updated}`);
  console.log(`Skipped (already correct): ${results.skipped}`);
  console.log(`Errors: ${results.errors}`);

  console.log(`\n--- By Bank ---`);
  for (const [bank, counts] of Object.entries(results.byBank)) {
    console.log(`${bank}: ${counts.total} total, ${counts.updated} updated, ${counts.skipped} skipped`);
  }

  console.log(`\n--- Old Operation Types ---`);
  for (const [type, count] of Object.entries(results.byOldType).sort((a, b) => b[1] - a[1])) {
    const isValid = isValidOperationType(type);
    console.log(`${type}: ${count}${isValid ? ' ✓' : ' → needs migration'}`);
  }

  console.log(`\n--- New Operation Types ---`);
  for (const [type, count] of Object.entries(results.byNewType).sort((a, b) => b[1] - a[1])) {
    console.log(`${type}: ${count}`);
  }

  return results;
}

/**
 * Meteor method to run migration
 */
Meteor.methods({
  async 'migration.normalizeOperationTypes'(dryRun = true) {
    // Check if user is admin (optional - add your auth check here)
    // if (!this.userId) {
    //   throw new Meteor.Error('not-authorized', 'Must be logged in');
    // }

    console.log(`\n[MIGRATION] normalizeOperationTypes called with dryRun=${dryRun}`);

    const results = await migrateOperationTypes(dryRun);

    return {
      success: true,
      dryRun,
      results
    };
  }
});

/**
 * Run migration automatically on server startup (DRY RUN only)
 * Uncomment the live run line when ready to execute
 */
// Meteor.startup(async () => {
//   console.log('\n[STARTUP] Running operation types migration check...');
//
//   // DRY RUN first
//   const dryResults = await migrateOperationTypes(true);
//
//   // Uncomment below to run live migration:
//   // if (dryResults.updated > 0) {
//   //   console.log('\n[STARTUP] Running LIVE migration...');
//   //   await migrateOperationTypes(false);
//   // }
// });
