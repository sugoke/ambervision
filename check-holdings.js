const { MongoClient } = require('mongodb');

async function check() {
  const client = new MongoClient('mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0');
  await client.connect();
  const db = client.db('amberlake');

  // Get counts by fileDate for latest holdings
  const results = await db.collection('pmsHoldings').aggregate([
    { $match: { isLatest: true } },
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$fileDate' } },
      count: { $sum: 1 },
      totalValue: { $sum: '$marketValue' }
    }},
    { $sort: { _id: -1 } },
    { $limit: 10 }
  ]).toArray();

  console.log('Holdings by fileDate (isLatest=true):');
  results.forEach(r => {
    const val = r.totalValue ? r.totalValue.toLocaleString('en-US', {maximumFractionDigits: 0}) : '0';
    console.log(`  ${r._id}: ${r.count} holdings, Total: ${val}`);
  });

  // Check by bank for yesterday vs today
  console.log('\nYesterday breakdown by bank:');
  const yesterday = new Date('2025-12-03');

  const yesterdayByBank = await db.collection('pmsHoldings').aggregate([
    { $match: {
      isLatest: true,
      fileDate: { $gte: yesterday, $lt: new Date('2025-12-04') }
    }},
    { $group: {
      _id: '$bankId',
      count: { $sum: 1 },
      totalValue: { $sum: '$marketValue' }
    }}
  ]).toArray();

  // Get bank names
  const banks = await db.collection('banks').find({}).toArray();
  const bankMap = {};
  banks.forEach(b => bankMap[b._id] = b.name || b.slug);

  if (yesterdayByBank.length === 0) {
    console.log('  No holdings for yesterday');
  } else {
    yesterdayByBank.forEach(r => {
      const val = r.totalValue ? r.totalValue.toLocaleString('en-US', {maximumFractionDigits: 0}) : '0';
      console.log(`  ${bankMap[r._id] || r._id}: ${r.count} holdings, Total: ${val}`);
    });
  }

  console.log('\nToday breakdown by bank:');
  const today = new Date('2025-12-04');

  const todayByBank = await db.collection('pmsHoldings').aggregate([
    { $match: { isLatest: true, fileDate: { $gte: today } } },
    { $group: {
      _id: '$bankId',
      count: { $sum: 1 },
      totalValue: { $sum: '$marketValue' }
    }}
  ]).toArray();

  if (todayByBank.length === 0) {
    console.log('  No holdings for today');
  } else {
    todayByBank.forEach(r => {
      const val = r.totalValue ? r.totalValue.toLocaleString('en-US', {maximumFractionDigits: 0}) : '0';
      console.log(`  ${bankMap[r._id] || r._id}: ${r.count} holdings, Total: ${val}`);
    });
  }

  await client.close();
}
check().catch(console.error);
