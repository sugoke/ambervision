/**
 * Full CMB Monaco Cleanup Script
 *
 * Cleans ALL duplicates - keeps only the NEWEST record for each:
 * - For securities: portfolio + ISIN
 * - For cash: portfolio + currency + securityType
 */

const { MongoClient } = require('mongodb');

const MONGO_URL = 'mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0';

async function fullCleanup() {
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

    let totalDeleted = 0;

    // ========== STEP 1: Clean up securities (by ISIN) ==========
    console.log('=== Step 1: Cleaning securities duplicates (by ISIN) ===\n');

    const securityGroups = await holdings.aggregate([
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
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    console.log(`Found ${securityGroups.length} groups with duplicate securities\n`);

    for (const group of securityGroups) {
      // Sort by snapshotDate DESC, then processedAt DESC
      const sorted = group.docs.sort((a, b) => {
        const dateA = new Date(a.snapshotDate).getTime();
        const dateB = new Date(b.snapshotDate).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime();
      });

      const toKeep = sorted[0];
      const toDelete = sorted.slice(1);

      console.log(`${group._id.portfolioCode} | ${group._id.isin}`);
      console.log(`  Keeping: ${toKeep.securityName} (${new Date(toKeep.snapshotDate).toISOString().split('T')[0]})`);
      console.log(`  Deleting: ${toDelete.length} duplicates`);

      const deleteIds = toDelete.map(d => d._id);
      const result = await holdings.deleteMany({ _id: { $in: deleteIds } });
      totalDeleted += result.deletedCount;
    }

    // ========== STEP 2: Clean up cash positions ==========
    console.log('\n=== Step 2: Cleaning cash duplicates ===\n');

    const cashGroups = await holdings.aggregate([
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
          _id: {
            portfolioCode: "$portfolioCode",
            currency: "$currency",
            securityName: "$securityName"  // Group by exact name for cash
          },
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
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    console.log(`Found ${cashGroups.length} groups with duplicate cash positions\n`);

    for (const group of cashGroups) {
      // Sort by snapshotDate DESC, then processedAt DESC
      const sorted = group.docs.sort((a, b) => {
        const dateA = new Date(a.snapshotDate).getTime();
        const dateB = new Date(b.snapshotDate).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime();
      });

      const toKeep = sorted[0];
      const toDelete = sorted.slice(1);

      console.log(`${group._id.portfolioCode} | ${group._id.currency} | ${group._id.securityName?.substring(0, 40)}`);
      console.log(`  Keeping: ${toKeep.marketValue?.toLocaleString()} (${new Date(toKeep.snapshotDate).toISOString().split('T')[0]})`);
      console.log(`  Deleting: ${toDelete.length} duplicates`);

      const deleteIds = toDelete.map(d => d._id);
      const result = await holdings.deleteMany({ _id: { $in: deleteIds } });
      totalDeleted += result.deletedCount;
    }

    // ========== STEP 3: Mark all remaining as having correct isLatest ==========
    // First, mark ALL CMB holdings as NOT latest
    // Then mark only the newest for each uniqueKey as latest

    console.log('\n=== Step 3: Fixing isLatest flags ===\n');

    // Get all unique keys for CMB
    const uniqueKeys = await holdings.distinct('uniqueKey', {
      bankId: cmbBank._id.toString()
    });

    console.log(`Processing ${uniqueKeys.length} unique positions...\n`);

    let fixedCount = 0;
    for (const uniqueKey of uniqueKeys) {
      // Find all records for this uniqueKey
      const records = await holdings.find({
        bankId: cmbBank._id.toString(),
        uniqueKey
      }).sort({ snapshotDate: -1, processedAt: -1 }).toArray();

      if (records.length === 0) continue;

      // The first one (newest) should be isLatest: true
      // All others should be isLatest: false
      const newestId = records[0]._id;

      // Update newest to isLatest: true if not already
      if (!records[0].isLatest) {
        await holdings.updateOne(
          { _id: newestId },
          { $set: { isLatest: true } }
        );
        fixedCount++;
      }

      // Update all others to isLatest: false
      if (records.length > 1) {
        const olderIds = records.slice(1).map(r => r._id);
        const result = await holdings.updateMany(
          { _id: { $in: olderIds }, isLatest: true },
          { $set: { isLatest: false } }
        );
        if (result.modifiedCount > 0) {
          fixedCount += result.modifiedCount;
        }
      }
    }

    console.log(`Fixed isLatest flag on ${fixedCount} records\n`);

    // Final count
    const afterCount = await holdings.countDocuments({
      bankId: cmbBank._id.toString(),
      isLatest: true
    });

    console.log('=== SUMMARY ===');
    console.log(`Holdings BEFORE cleanup: ${beforeCount}`);
    console.log(`Holdings AFTER cleanup: ${afterCount}`);
    console.log(`Total deleted: ${totalDeleted}`);
    console.log(`isLatest flags fixed: ${fixedCount}`);

    // Final portfolio summary
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

fullCleanup();
