/**
 * Diagnostic: Check current CMB Monaco holdings state
 */

const { MongoClient } = require('mongodb');

const MONGO_URL = 'mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0';

async function checkState() {
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

    // Count total holdings
    const totalCount = await holdings.countDocuments({
      bankId: cmbBank._id.toString()
    });

    const latestCount = await holdings.countDocuments({
      bankId: cmbBank._id.toString(),
      isLatest: true
    });

    console.log(`Total CMB Monaco holdings: ${totalCount}`);
    console.log(`Holdings with isLatest:true: ${latestCount}\n`);

    // Find duplicates by portfolioCode + ISIN
    console.log('=== Checking for duplicates by portfolioCode + ISIN ===\n');

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
          totalValue: { $sum: "$marketValue" },
          holdings: {
            $push: {
              _id: "$_id",
              uniqueKey: "$uniqueKey",
              securityName: "$securityName",
              marketValue: "$marketValue",
              snapshotDate: "$snapshotDate",
              processedAt: "$processedAt",
              sourceFile: "$sourceFile"
            }
          }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    console.log(`Found ${duplicatesByIsin.length} sets of ISIN duplicates\n`);

    for (const dup of duplicatesByIsin.slice(0, 10)) {
      console.log(`Portfolio: ${dup._id.portfolioCode}, ISIN: ${dup._id.isin}`);
      console.log(`  Count: ${dup.count}, Total Value: ${dup.totalValue?.toLocaleString()}`);
      for (const h of dup.holdings) {
        console.log(`  - ${h.securityName}: ${h.marketValue?.toLocaleString()}`);
        console.log(`    uniqueKey: ${h.uniqueKey?.substring(0, 16)}...`);
        console.log(`    snapshotDate: ${h.snapshotDate}`);
        console.log(`    sourceFile: ${h.sourceFile}`);
      }
      console.log('');
    }

    // Check cash duplicates
    console.log('=== Checking for cash duplicates ===\n');

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
          totalValue: { $sum: "$marketValue" },
          holdings: {
            $push: {
              _id: "$_id",
              uniqueKey: "$uniqueKey",
              securityName: "$securityName",
              marketValue: "$marketValue",
              snapshotDate: "$snapshotDate",
              sourceFile: "$sourceFile"
            }
          }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    console.log(`Found ${cashDuplicates.length} sets of cash duplicates\n`);

    for (const dup of cashDuplicates) {
      console.log(`Portfolio: ${dup._id.portfolioCode}, Currency: ${dup._id.currency}, Type: ${dup._id.securityType}`);
      console.log(`  Count: ${dup.count}, Total Value: ${dup.totalValue?.toLocaleString()}`);
      for (const h of dup.holdings) {
        console.log(`  - ${h.securityName}: ${h.marketValue?.toLocaleString()}`);
        console.log(`    uniqueKey: ${h.uniqueKey?.substring(0, 16)}...`);
        console.log(`    snapshotDate: ${h.snapshotDate}`);
        console.log(`    sourceFile: ${h.sourceFile}`);
      }
      console.log('');
    }

    // Portfolio summary
    console.log('=== Portfolio Summary ===\n');

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
          totalValue: { $sum: "$marketValue" },
          snapshotDates: { $addToSet: "$snapshotDate" }
        }
      },
      { $sort: { totalValue: -1 } }
    ]).toArray();

    for (const p of portfolioSummary) {
      const dates = p.snapshotDates.map(d => d?.toISOString?.()?.split('T')[0] || d).sort();
      console.log(`${p._id}: ${p.holdingCount} holdings, ${p.totalValue?.toLocaleString('en-US', { style: 'currency', currency: 'EUR' }) || 'N/A'}`);
      console.log(`  Snapshot dates: ${dates.join(', ')}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('\nDatabase connection closed');
  }
}

checkState();
