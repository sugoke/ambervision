/**
 * Migration: Update CMB Monaco holdings to use ISIN-based uniqueKey
 *
 * This ensures the versioning logic works correctly with the new uniqueKey format
 */

const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const MONGO_URL = 'mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0';

// Generate uniqueKey matching the new CMB parser logic
function generateUniqueKey(portfolioCode, isin, positionNumber, instrumentCode, currency) {
  // For positions WITH ISIN: Use ISIN as primary identifier (most stable)
  if (isin) {
    const key = `cmb-monaco|${portfolioCode}|${isin}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  // For cash positions (no ISIN): Use Position_Number if available
  if (positionNumber) {
    const key = `cmb-monaco|${portfolioCode}|${positionNumber}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  // Fallback for positions without ISIN or Position_Number
  if (instrumentCode) {
    const key = `cmb-monaco|${portfolioCode}|${instrumentCode}|${currency}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  // Last resort fallback
  const key = `cmb-monaco|${portfolioCode}|unknown`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function migrateUniqueKeys() {
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

    // Get all CMB holdings
    const allHoldings = await holdings.find({
      bankId: cmbBank._id.toString()
    }).toArray();

    console.log(`Found ${allHoldings.length} total CMB holdings\n`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (const holding of allHoldings) {
      const portfolioCode = holding.portfolioCode;
      const isin = holding.isin;
      const positionNumber = holding.bankSpecificData?.positionNumber;
      const instrumentCode = holding.bankSpecificData?.instrumentCode;
      const currency = holding.currency;

      // Generate new uniqueKey using the updated logic
      const newUniqueKey = generateUniqueKey(portfolioCode, isin, positionNumber, instrumentCode, currency);

      if (holding.uniqueKey !== newUniqueKey) {
        await holdings.updateOne(
          { _id: holding._id },
          { $set: { uniqueKey: newUniqueKey } }
        );
        updatedCount++;

        if (updatedCount <= 5) {
          console.log(`Updated: ${holding.securityName}`);
          console.log(`  Old key: ${holding.uniqueKey?.substring(0, 16)}...`);
          console.log(`  New key: ${newUniqueKey.substring(0, 16)}...`);
          console.log(`  ISIN: ${isin || 'N/A'}, PosNum: ${positionNumber || 'N/A'}`);
        }
      } else {
        skippedCount++;
      }
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Total holdings: ${allHoldings.length}`);
    console.log(`Updated: ${updatedCount}`);
    console.log(`Skipped (already correct): ${skippedCount}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('\nDatabase connection closed');
  }
}

migrateUniqueKeys();
