/**
 * Aggressive Cleanup: Fix isLatest flags for ALL CMB Monaco holdings
 *
 * This script ensures exactly ONE record per portfolio+ISIN has isLatest: true
 * by looking at ALL records (not just those with isLatest: true).
 */

const { MongoClient } = require('mongodb');

const MONGO_URL = 'mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0';

async function fixIsLatestFlags() {
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

    // Count current state
    const totalCMB = await holdings.countDocuments({ bankId: cmbBank._id.toString() });
    const latestCount = await holdings.countDocuments({ bankId: cmbBank._id.toString(), isLatest: true });
    console.log(`Total CMB holdings: ${totalCMB}`);
    console.log(`Currently with isLatest:true: ${latestCount}\n`);

    // ========== STEP 1: Fix securities (with ISIN) ==========
    console.log('=== Step 1: Fixing securities (by portfolio + ISIN) ===\n');

    const securityGroups = await holdings.aggregate([
      {
        $match: {
          bankId: cmbBank._id.toString(),
          isin: { $ne: null, $exists: true }
        }
      },
      {
        $group: {
          _id: { portfolioCode: "$portfolioCode", isin: "$isin" },
          docs: {
            $push: {
              _id: "$_id",
              snapshotDate: "$snapshotDate",
              processedAt: "$processedAt",
              isLatest: "$isLatest",
              securityName: "$securityName"
            }
          }
        }
      }
    ]).toArray();

    console.log(`Found ${securityGroups.length} unique portfolio+ISIN combinations\n`);

    let fixedSecurities = 0;
    let alreadyCorrect = 0;

    for (const group of securityGroups) {
      // Sort by snapshotDate DESC, then processedAt DESC to find newest
      const sorted = group.docs.sort((a, b) => {
        const dateA = new Date(a.snapshotDate).getTime();
        const dateB = new Date(b.snapshotDate).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime();
      });

      const newest = sorted[0];
      const others = sorted.slice(1);

      // Check if already correct
      const latestOnes = group.docs.filter(d => d.isLatest === true);
      if (latestOnes.length === 1 && latestOnes[0]._id.toString() === newest._id.toString()) {
        alreadyCorrect++;
        continue;
      }

      // Fix needed
      console.log(`Fixing: ${group._id.portfolioCode} | ${group._id.isin} | ${newest.securityName}`);
      console.log(`  Found ${group.docs.length} records, ${latestOnes.length} had isLatest:true`);

      // Mark newest as isLatest: true
      await holdings.updateOne(
        { _id: newest._id },
        { $set: { isLatest: true } }
      );

      // Mark ALL others as isLatest: false
      if (others.length > 0) {
        const otherIds = others.map(d => d._id);
        await holdings.updateMany(
          { _id: { $in: otherIds } },
          { $set: { isLatest: false } }
        );
      }

      fixedSecurities++;
    }

    console.log(`\nSecurities: Fixed ${fixedSecurities}, Already correct ${alreadyCorrect}\n`);

    // ========== STEP 2: Fix cash positions (no ISIN) ==========
    console.log('=== Step 2: Fixing cash positions (by portfolio + currency + name) ===\n');

    const cashGroups = await holdings.aggregate([
      {
        $match: {
          bankId: cmbBank._id.toString(),
          $or: [
            { isin: null },
            { isin: { $exists: false } }
          ]
        }
      },
      {
        $group: {
          _id: { portfolioCode: "$portfolioCode", currency: "$currency", securityName: "$securityName" },
          docs: {
            $push: {
              _id: "$_id",
              snapshotDate: "$snapshotDate",
              processedAt: "$processedAt",
              isLatest: "$isLatest"
            }
          }
        }
      }
    ]).toArray();

    console.log(`Found ${cashGroups.length} unique cash position combinations\n`);

    let fixedCash = 0;
    let cashAlreadyCorrect = 0;

    for (const group of cashGroups) {
      const sorted = group.docs.sort((a, b) => {
        const dateA = new Date(a.snapshotDate).getTime();
        const dateB = new Date(b.snapshotDate).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return new Date(b.processedAt).getTime() - new Date(a.processedAt).getTime();
      });

      const newest = sorted[0];
      const others = sorted.slice(1);

      const latestOnes = group.docs.filter(d => d.isLatest === true);
      if (latestOnes.length === 1 && latestOnes[0]._id.toString() === newest._id.toString()) {
        cashAlreadyCorrect++;
        continue;
      }

      console.log(`Fixing: ${group._id.portfolioCode} | ${group._id.currency} | ${group._id.securityName?.substring(0, 40)}`);
      console.log(`  Found ${group.docs.length} records, ${latestOnes.length} had isLatest:true`);

      await holdings.updateOne(
        { _id: newest._id },
        { $set: { isLatest: true } }
      );

      if (others.length > 0) {
        const otherIds = others.map(d => d._id);
        await holdings.updateMany(
          { _id: { $in: otherIds } },
          { $set: { isLatest: false } }
        );
      }

      fixedCash++;
    }

    console.log(`\nCash: Fixed ${fixedCash}, Already correct ${cashAlreadyCorrect}\n`);

    // ========== SUMMARY ==========
    const newLatestCount = await holdings.countDocuments({ bankId: cmbBank._id.toString(), isLatest: true });

    console.log('=== SUMMARY ===');
    console.log(`isLatest:true BEFORE: ${latestCount}`);
    console.log(`isLatest:true AFTER: ${newLatestCount}`);
    console.log(`Securities fixed: ${fixedSecurities}`);
    console.log(`Cash positions fixed: ${fixedCash}`);
    console.log(`Total positions now: ${securityGroups.length + cashGroups.length}`);

    // Verify no duplicates remain
    console.log('\n=== VERIFICATION ===\n');

    const remainingDuplicates = await holdings.aggregate([
      {
        $match: {
          bankId: cmbBank._id.toString(),
          isLatest: true,
          isin: { $ne: null }
        }
      },
      {
        $group: {
          _id: { portfolioCode: "$portfolioCode", isin: "$isin" },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    if (remainingDuplicates.length === 0) {
      console.log('✅ SUCCESS: No duplicate securities remaining!');
    } else {
      console.log(`❌ WARNING: ${remainingDuplicates.length} duplicate security sets still exist!`);
      for (const dup of remainingDuplicates) {
        console.log(`  - ${dup._id.portfolioCode} | ${dup._id.isin}: ${dup.count} records`);
      }
    }

    // Portfolio summary
    console.log('\n=== Portfolio Values ===\n');

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

fixIsLatestFlags();
