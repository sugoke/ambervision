/**
 * Cleanup Script: Remove CMB Monaco Duplicate Holdings
 *
 * Run with: node cleanup-cmb-duplicates.js
 *
 * This script:
 * 1. Finds all duplicate holdings (same portfolioCode + ISIN with multiple isLatest:true)
 * 2. Keeps only the newest record (by snapshotDate)
 * 3. Deletes the older duplicates
 */

const { MongoClient, ObjectId } = require('mongodb');

// Database connection string (from settings)
const MONGO_URL = 'mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0';

// Set to true to actually delete, false for dry-run
const ACTUALLY_DELETE = true;

async function cleanupDuplicates() {
  const client = new MongoClient(MONGO_URL);

  try {
    await client.connect();
    console.log('Connected to database\n');

    const db = client.db('amberlake');
    const holdings = db.collection('pmsHoldings');
    const banks = db.collection('banks');

    // Find CMB Monaco bank ID
    const cmbBank = await banks.findOne({
      $or: [
        { name: /CMB/i },
        { name: /Monaco/i }
      ]
    });

    if (!cmbBank) {
      console.log('CMB Monaco bank not found');
      return;
    }

    console.log(`Found CMB Monaco bank: ${cmbBank.name} (ID: ${cmbBank._id})\n`);

    // Count before cleanup
    const beforeCount = await holdings.countDocuments({
      bankId: cmbBank._id.toString(),
      isLatest: true
    });
    console.log(`Holdings with isLatest:true BEFORE cleanup: ${beforeCount}\n`);

    // Find duplicates by portfolioCode + ISIN
    console.log('=== Finding duplicates by portfolioCode + ISIN ===\n');

    const duplicatesByIsin = await holdings.aggregate([
      {
        $match: {
          bankId: cmbBank._id.toString(),
          isLatest: true,
          isin: { $ne: null, $exists: true }
        }
      },
      {
        $group: {
          _id: { portfolioCode: "$portfolioCode", isin: "$isin" },
          count: { $sum: 1 },
          docs: {
            $push: {
              _id: "$_id",
              snapshotDate: "$snapshotDate",
              processedAt: "$processedAt",
              securityName: "$securityName",
              marketValue: "$marketValue"
            }
          }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    console.log(`Found ${duplicatesByIsin.length} sets of ISIN duplicates\n`);

    let totalDeleted = 0;
    let totalKept = 0;

    for (const dup of duplicatesByIsin) {
      // Sort by snapshotDate (newest first), then by processedAt as tiebreaker
      const sorted = dup.docs.sort((a, b) => {
        const dateA = new Date(a.snapshotDate);
        const dateB = new Date(b.snapshotDate);
        if (dateB.getTime() !== dateA.getTime()) {
          return dateB.getTime() - dateA.getTime();
        }
        return new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime();
      });

      const toKeep = sorted[0];
      const toDelete = sorted.slice(1);

      console.log(`Portfolio: ${dup._id.portfolioCode}, ISIN: ${dup._id.isin}`);
      console.log(`  Keeping: ${toKeep.securityName} (${toKeep.snapshotDate}) - ${toKeep.marketValue?.toLocaleString()}`);
      console.log(`  Deleting ${toDelete.length} duplicates:`);

      for (const doc of toDelete) {
        console.log(`    - ${doc.snapshotDate} (${doc.marketValue?.toLocaleString()})`);
      }

      if (ACTUALLY_DELETE) {
        const deleteIds = toDelete.map(d => d._id);
        const result = await holdings.deleteMany({ _id: { $in: deleteIds } });
        console.log(`  Deleted: ${result.deletedCount} records`);
        totalDeleted += result.deletedCount;
      }
      totalKept++;
      console.log('');
    }

    // Also clean up cash positions (no ISIN)
    console.log('\n=== Finding duplicates in cash positions ===\n');

    const cashDuplicates = await holdings.aggregate([
      {
        $match: {
          bankId: cmbBank._id.toString(),
          isLatest: true,
          $or: [
            { isin: null },
            { isin: { $exists: false } }
          ]
        }
      },
      {
        $group: {
          _id: { portfolioCode: "$portfolioCode", currency: "$currency", securityType: "$securityType" },
          count: { $sum: 1 },
          docs: {
            $push: {
              _id: "$_id",
              snapshotDate: "$snapshotDate",
              processedAt: "$processedAt",
              securityName: "$securityName",
              marketValue: "$marketValue"
            }
          }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    console.log(`Found ${cashDuplicates.length} sets of cash duplicates\n`);

    for (const dup of cashDuplicates) {
      const sorted = dup.docs.sort((a, b) => {
        const dateA = new Date(a.snapshotDate);
        const dateB = new Date(b.snapshotDate);
        if (dateB.getTime() !== dateA.getTime()) {
          return dateB.getTime() - dateA.getTime();
        }
        return new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime();
      });

      const toKeep = sorted[0];
      const toDelete = sorted.slice(1);

      console.log(`Portfolio: ${dup._id.portfolioCode}, Currency: ${dup._id.currency}`);
      console.log(`  Keeping: ${toKeep.securityName} (${toKeep.snapshotDate})`);
      console.log(`  Deleting ${toDelete.length} duplicates`);

      if (ACTUALLY_DELETE) {
        const deleteIds = toDelete.map(d => d._id);
        const result = await holdings.deleteMany({ _id: { $in: deleteIds } });
        totalDeleted += result.deletedCount;
      }
      console.log('');
    }

    // Count after cleanup
    const afterCount = await holdings.countDocuments({
      bankId: cmbBank._id.toString(),
      isLatest: true
    });

    console.log('\n=== SUMMARY ===');
    console.log(`Holdings BEFORE cleanup: ${beforeCount}`);
    console.log(`Holdings AFTER cleanup: ${afterCount}`);
    console.log(`Total deleted: ${totalDeleted}`);
    console.log(`Reduction: ${((beforeCount - afterCount) / beforeCount * 100).toFixed(1)}%`);

    // Show final portfolio values
    console.log('\n=== Final Portfolio Values ===\n');

    const portfolioSummary = await holdings.aggregate([
      {
        $match: {
          bankId: cmbBank._id.toString(),
          isLatest: true
        }
      },
      {
        $group: {
          _id: "$portfolioCode",
          holdingCount: { $sum: 1 },
          totalValue: { $sum: "$marketValue" }
        }
      },
      { $sort: { totalValue: -1 } }
    ]).toArray();

    for (const p of portfolioSummary) {
      console.log(`${p._id}: ${p.holdingCount} holdings, ${p.totalValue?.toLocaleString('en-US', { style: 'currency', currency: 'EUR' }) || 'N/A'}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('\nDatabase connection closed');
  }
}

cleanupDuplicates();
