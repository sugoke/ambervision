/**
 * Diagnostic Script: Find CMB Monaco Duplicate Holdings
 *
 * Run with: node find-cmb-duplicates.js
 *
 * This script connects to the database and finds holdings where:
 * - Same portfolio has multiple isLatest:true records for the same position
 * - Identifies whether it's due to uniqueKey differences or upsert failure
 */

const { MongoClient } = require('mongodb');

// Database connection string (from settings)
const MONGO_URL = 'mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0';

async function findDuplicates() {
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
      bankId: cmbBank._id.toString(),
      isLatest: true
    });
    console.log(`Total CMB Monaco holdings with isLatest:true: ${totalCount}\n`);

    // Find duplicates by portfolioCode + ISIN (or securityName for cash)
    console.log('=== Looking for duplicates by portfolioCode + ISIN ===\n');

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
      { $sort: { count: -1, totalValue: -1 } }
    ]).toArray();

    if (duplicatesByIsin.length === 0) {
      console.log('No duplicates found by ISIN\n');
    } else {
      console.log(`Found ${duplicatesByIsin.length} sets of duplicates by ISIN:\n`);

      let totalDuplicateValue = 0;
      for (const dup of duplicatesByIsin) {
        console.log(`Portfolio: ${dup._id.portfolioCode}`);
        console.log(`ISIN: ${dup._id.isin}`);
        console.log(`Count: ${dup.count} (should be 1)`);
        console.log(`Total Value: ${dup.totalValue.toLocaleString('en-US', { style: 'currency', currency: 'EUR' })}`);
        console.log('Holdings:');

        // Check if uniqueKeys are different
        const uniqueKeys = new Set(dup.holdings.map(h => h.uniqueKey));
        console.log(`  Unique Keys: ${uniqueKeys.size} different`);

        for (const h of dup.holdings) {
          console.log(`  - ${h.securityName}: ${h.marketValue?.toLocaleString('en-US', { style: 'currency', currency: 'EUR' }) || 'N/A'}`);
          console.log(`    uniqueKey: ${h.uniqueKey?.substring(0, 20)}...`);
          console.log(`    snapshotDate: ${h.snapshotDate}`);
          console.log(`    processedAt: ${h.processedAt}`);
          console.log(`    sourceFile: ${h.sourceFile}`);
        }

        // Calculate extra value (duplicates)
        const extraValue = dup.totalValue - (dup.totalValue / dup.count);
        totalDuplicateValue += extraValue;
        console.log(`Extra value from duplicates: ${extraValue.toLocaleString('en-US', { style: 'currency', currency: 'EUR' })}`);
        console.log('');
      }

      console.log(`\nTotal extra value from all duplicates: ${totalDuplicateValue.toLocaleString('en-US', { style: 'currency', currency: 'EUR' })}`);
    }

    // Also check for duplicates in cash positions (no ISIN)
    console.log('\n=== Looking for duplicates in cash positions ===\n');

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
              processedAt: "$processedAt"
            }
          }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1, totalValue: -1 } }
    ]).toArray();

    if (cashDuplicates.length === 0) {
      console.log('No duplicates found in cash positions\n');
    } else {
      console.log(`Found ${cashDuplicates.length} sets of cash duplicates:\n`);

      for (const dup of cashDuplicates) {
        console.log(`Portfolio: ${dup._id.portfolioCode}`);
        console.log(`Currency: ${dup._id.currency}, Type: ${dup._id.securityType}`);
        console.log(`Count: ${dup.count}`);
        console.log(`Total Value: ${dup.totalValue.toLocaleString('en-US', { style: 'currency', currency: 'EUR' })}`);

        for (const h of dup.holdings) {
          console.log(`  - ${h.securityName}: ${h.marketValue?.toLocaleString('en-US', { style: 'currency', currency: 'EUR' }) || 'N/A'}`);
          console.log(`    uniqueKey: ${h.uniqueKey?.substring(0, 20)}...`);
        }
        console.log('');
      }
    }

    // Summary by portfolio
    console.log('\n=== Portfolio Value Summary ===\n');

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

findDuplicates();
