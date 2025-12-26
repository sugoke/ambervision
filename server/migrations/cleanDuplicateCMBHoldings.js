/**
 * Migration Script: Clean Duplicate CMB Monaco Holdings
 *
 * Problem: Some CMB Monaco cash positions have duplicate records with different uniqueKeys
 * but the same positionNumber, causing cash to be counted twice in calculations.
 *
 * This script finds duplicate cash holdings (same positionNumber stored in bankSpecificData)
 * and archives all but the most recent version.
 *
 * Run from Meteor shell:
 *   meteor shell
 *   > require('./server/migrations/cleanDuplicateCMBHoldings.js').cleanDuplicateCMBHoldings()
 */

import { Meteor } from 'meteor/meteor';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';

export async function cleanDuplicateCMBHoldings() {
  console.log('[MIGRATION] Starting cleanup of duplicate CMB Monaco holdings...');

  // Find all CMB Monaco cash holdings with isLatest=true
  const cmbCashHoldings = await PMSHoldingsCollection.find({
    bankName: { $regex: /cmb/i },
    assetClass: 'cash',
    isLatest: true
  }).fetchAsync();

  console.log(`[MIGRATION] Found ${cmbCashHoldings.length} CMB Monaco cash holdings with isLatest=true`);

  // Group by portfolioCode + positionNumber (from bankSpecificData) + currency
  const groups = {};
  for (const holding of cmbCashHoldings) {
    // positionNumber is stored in bankSpecificData, not at top level
    const positionNumber = holding.bankSpecificData?.positionNumber || 'no-position-number';
    const key = `${holding.portfolioCode}|${positionNumber}|${holding.currency}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(holding);
  }

  // Find and fix duplicates
  let totalDuplicates = 0;
  let archivedCount = 0;

  for (const [key, holdings] of Object.entries(groups)) {
    if (holdings.length > 1) {
      totalDuplicates++;
      const [portfolioCode, positionNumber, currency] = key.split('|');

      console.log(`[MIGRATION] Found duplicate for portfolio ${portfolioCode}, positionNumber ${positionNumber}, currency ${currency}:`);

      // Sort by snapshotDate descending to keep the newest
      holdings.sort((a, b) => {
        const dateA = a.snapshotDate || a.fileDate || new Date(0);
        const dateB = b.snapshotDate || b.fileDate || new Date(0);
        return dateB.getTime() - dateA.getTime();
      });

      // Log all duplicates
      for (let i = 0; i < holdings.length; i++) {
        const h = holdings[i];
        const action = i === 0 ? 'KEEP' : 'ARCHIVE';
        console.log(`  ${action}: uniqueKey=${h.uniqueKey?.substring(0, 12)}... snapshotDate=${h.snapshotDate?.toISOString()} marketValue=${h.marketValue} ${h.currency}`);
      }

      // Archive all except the first (newest)
      for (let i = 1; i < holdings.length; i++) {
        const holdingToArchive = holdings[i];
        await PMSHoldingsCollection.updateAsync(
          { _id: holdingToArchive._id },
          {
            $set: {
              isLatest: false,
              archivedAt: new Date(),
              archivedReason: 'duplicate-position-cleanup'
            }
          }
        );
        archivedCount++;
      }
    }
  }

  console.log(`[MIGRATION] Cleanup complete:`);
  console.log(`  - Total duplicate groups found: ${totalDuplicates}`);
  console.log(`  - Holdings archived: ${archivedCount}`);

  return {
    duplicateGroups: totalDuplicates,
    archivedCount
  };
}

// Check for duplicates without fixing (dry run)
export async function findDuplicateCMBHoldings() {
  console.log('[MIGRATION] Checking for duplicate CMB Monaco holdings...');

  const cmbCashHoldings = await PMSHoldingsCollection.find({
    bankName: { $regex: /cmb/i },
    assetClass: 'cash',
    isLatest: true
  }).fetchAsync();

  console.log(`[MIGRATION] Found ${cmbCashHoldings.length} CMB Monaco cash holdings with isLatest=true`);

  // Group by portfolioCode + positionNumber (from bankSpecificData) + currency
  const groups = {};
  for (const holding of cmbCashHoldings) {
    const positionNumber = holding.bankSpecificData?.positionNumber || 'no-position-number';
    const key = `${holding.portfolioCode}|${positionNumber}|${holding.currency}`;
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(holding);
  }

  const duplicates = [];
  for (const [key, holdings] of Object.entries(groups)) {
    if (holdings.length > 1) {
      const [portfolioCode, positionNumber, currency] = key.split('|');
      duplicates.push({
        portfolioCode,
        positionNumber,
        currency,
        count: holdings.length,
        holdings: holdings.map(h => ({
          _id: h._id,
          uniqueKey: h.uniqueKey,
          securityName: h.securityName,
          marketValue: h.marketValue,
          snapshotDate: h.snapshotDate,
          fileDate: h.fileDate
        }))
      });
    }
  }

  if (duplicates.length === 0) {
    console.log('[MIGRATION] No duplicates found!');
  } else {
    console.log(`[MIGRATION] Found ${duplicates.length} duplicate groups:`);
    for (const dup of duplicates) {
      console.log(`  Portfolio ${dup.portfolioCode}, Position ${dup.positionNumber}, ${dup.currency}: ${dup.count} records`);
    }
  }

  return duplicates;
}

// Register as Meteor methods for easy invocation
if (Meteor.isServer) {
  Meteor.methods({
    'migrations.cleanDuplicateCMBHoldings': async function() {
      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'Must be logged in');
      }
      return await cleanDuplicateCMBHoldings();
    },

    'migrations.findDuplicateCMBHoldings': async function() {
      if (!this.userId) {
        throw new Meteor.Error('not-authorized', 'Must be logged in');
      }
      return await findDuplicateCMBHoldings();
    }
  });
}
