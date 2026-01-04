/**
 * Diagnostic: List all holding types in pmsHoldings
 */

const { MongoClient } = require('mongodb');

const MONGO_URL = 'mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0';

async function checkHoldingTypes() {
  const client = new MongoClient(MONGO_URL);

  try {
    await client.connect();
    console.log('Connected to database\n');

    const db = client.db('amberlake');
    const holdings = db.collection('pmsHoldings');

    // Get distinct security types
    console.log('=== Distinct Security Types ===\n');
    const types = await holdings.distinct('securityType');
    console.log('Security Types:', types);
    console.log(`Total: ${types.length} types\n`);

    // Count by security type
    console.log('=== Count by Security Type ===\n');
    const typeCounts = await holdings.aggregate([
      { $group: { _id: "$securityType", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    for (const t of typeCounts) {
      console.log(`${t._id || 'null'}: ${t.count} records`);
    }

    // Count by security type WITH isLatest: true
    console.log('\n=== Count by Security Type (isLatest: true only) ===\n');
    const latestTypeCounts = await holdings.aggregate([
      { $match: { isLatest: true } },
      { $group: { _id: "$securityType", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    for (const t of latestTypeCounts) {
      console.log(`${t._id || 'null'}: ${t.count} records`);
    }

    // Count by bank
    console.log('\n=== Count by Bank ===\n');
    const bankCounts = await holdings.aggregate([
      { $match: { isLatest: true } },
      { $group: { _id: "$bankName", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]).toArray();

    for (const b of bankCounts) {
      console.log(`${b._id || 'unknown'}: ${b.count} holdings`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.close();
    console.log('\nDatabase connection closed');
  }
}

checkHoldingTypes();
