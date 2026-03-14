/**
 * Migration Script: Clean Duplicate EDR Monaco Holdings
 *
 * Problem: EDR CSV files contain multiple rows for the same term deposit and cash position,
 * and the `devise` (currency) field has inconsistent quoting across rows (e.g., "EUR" vs EUR vs EUR\r),
 * causing different uniqueKeys to be generated for identical positions.
 * This results in double/triple counting of deposits and cash.
 *
 * Fix approach:
 * 1. For each snapshot date: deduplicate positions with same account + securityName + currency + idCat
 * 2. For isLatest duplicates: keep one canonical record, mark rest as isLatest: false
 * 3. Update uniqueKeys to use cleaned currency values for consistency going forward
 *
 * Run from Meteor shell:
 *   meteor shell
 *   > require('./server/migrations/cleanDuplicateEDRHoldings.js').cleanDuplicateEDRHoldings()
 */

import { Meteor } from 'meteor/meteor';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import crypto from 'crypto';

export async function cleanDuplicateEDRHoldings() {
  console.log('[EDR_CLEANUP] Starting cleanup of duplicate EDR Monaco holdings...');

  // Step 1: Fix isLatest duplicates for term deposits
  console.log('[EDR_CLEANUP] Step 1: Fixing isLatest duplicates for term deposits...');

  const depositDupes = await PMSHoldingsCollection.rawCollection().aggregate([
    { $match: { bankName: 'Edmond de Rothschild', securityType: 'TERM_DEPOSIT', isLatest: true } },
    {
      $group: {
        _id: {
          portfolioCode: '$portfolioCode',
          idCat: '$bankSpecificData.idCat',
          currency: '$currency'
        },
        count: { $sum: 1 },
        docs: {
          $push: {
            _id: '$_id',
            uniqueKey: '$uniqueKey',
            snapshotDate: '$snapshotDate',
            quantity: '$quantity',
            marketValue: '$marketValue',
            createdAt: '$createdAt'
          }
        }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  let fixedLatest = 0;

  for (const group of depositDupes) {
    const docs = group.docs;
    // Keep the one with the most recent snapshotDate
    docs.sort((a, b) => new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime());
    const keep = docs[0];
    const remove = docs.slice(1);

    console.log(`[EDR_CLEANUP] TERM_DEPOSIT: portfolio=${group._id.portfolioCode}, idCat=${group._id.idCat}, keeping ${keep._id} (snapshot ${keep.snapshotDate}), removing ${remove.length} duplicates`);

    for (const doc of remove) {
      await PMSHoldingsCollection.updateAsync(doc._id, {
        $set: {
          isLatest: false,
          replacedAt: new Date(),
          replacedBy: keep._id,
          migrationNote: 'EDR duplicate: same deposit counted multiple times due to devise quoting'
        }
      });
      fixedLatest++;
    }
  }

  // Step 2: Fix isLatest duplicates for cash positions
  console.log('[EDR_CLEANUP] Step 2: Fixing isLatest duplicates for cash positions...');

  const cashDupes = await PMSHoldingsCollection.rawCollection().aggregate([
    { $match: { bankName: 'Edmond de Rothschild', securityType: 'CASH', isLatest: true } },
    {
      $group: {
        _id: {
          portfolioCode: '$portfolioCode',
          currency: '$currency',
          rubrique: '$bankSpecificData.rubrique'
        },
        count: { $sum: 1 },
        docs: {
          $push: {
            _id: '$_id',
            uniqueKey: '$uniqueKey',
            snapshotDate: '$snapshotDate',
            quantity: '$quantity',
            marketValue: '$marketValue'
          }
        }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  for (const group of cashDupes) {
    const docs = group.docs;
    docs.sort((a, b) => new Date(b.snapshotDate).getTime() - new Date(a.snapshotDate).getTime());
    const keep = docs[0];
    const remove = docs.slice(1);

    console.log(`[EDR_CLEANUP] CASH: portfolio=${group._id.portfolioCode}, ccy=${group._id.currency}, rub=${group._id.rubrique}, keeping ${keep._id}, removing ${remove.length} duplicates`);

    for (const doc of remove) {
      await PMSHoldingsCollection.updateAsync(doc._id, {
        $set: {
          isLatest: false,
          replacedAt: new Date(),
          replacedBy: keep._id,
          migrationNote: 'EDR duplicate: same cash position counted multiple times due to devise quoting'
        }
      });
      fixedLatest++;
    }
  }

  // Step 3: Clean up historical snapshot duplicates (same logical position, same date, multiple records)
  console.log('[EDR_CLEANUP] Step 3: Cleaning historical snapshot duplicates...');

  const historicalDupes = await PMSHoldingsCollection.rawCollection().aggregate([
    { $match: { bankName: 'Edmond de Rothschild', securityType: { $in: ['TERM_DEPOSIT', 'CASH'] } } },
    {
      $group: {
        _id: {
          portfolioCode: '$portfolioCode',
          securityName: '$securityName',
          currency: '$currency',
          snapshotDate: '$snapshotDate',
          idCat: '$bankSpecificData.idCat',
          rubrique: '$bankSpecificData.rubrique'
        },
        count: { $sum: 1 },
        ids: { $push: '$_id' },
        isLatestValues: { $push: '$isLatest' }
      }
    },
    { $match: { count: { $gt: 1 } } }
  ]).toArray();

  let deletedHistorical = 0;

  for (const group of historicalDupes) {
    const ids = group.ids;
    // Keep the first one, delete the rest (they're identical data)
    const toDelete = ids.slice(1);

    for (const id of toDelete) {
      await PMSHoldingsCollection.removeAsync(id);
      deletedHistorical++;
    }
  }

  console.log(`[EDR_CLEANUP] Complete:`);
  console.log(`  - isLatest duplicates fixed: ${fixedLatest}`);
  console.log(`  - Historical duplicate records deleted: ${deletedHistorical}`);

  return {
    success: true,
    isLatestFixed: fixedLatest,
    historicalDeleted: deletedHistorical
  };
}

// Register as a Meteor method for manual execution
Meteor.methods({
  'migration.cleanDuplicateEDRHoldings': async function () {
    return await cleanDuplicateEDRHoldings();
  }
});
