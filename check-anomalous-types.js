const { MongoClient } = require('mongodb');
const MONGO_URL = 'mongodb+srv://sugoke:sugoke14@cluster0.ixanxcb.mongodb.net/amberlake?retryWrites=true&w=majority&appName=Cluster0';

async function check() {
  const client = new MongoClient(MONGO_URL);
  try {
    await client.connect();
    const db = client.db('amberlake');
    const holdings = db.collection('pmsHoldings');

    // Find which banks have types '13' and '19'
    console.log('=== Holdings with type "13" ===\n');
    const type13 = await holdings.find({ securityType: '13', isLatest: true }).toArray();
    for (const h of type13) {
      console.log(`${h.bankName} | ${h.portfolioCode} | ${h.securityName?.substring(0, 50)} | ${h.isin || 'no ISIN'}`);
    }

    console.log('\n=== Holdings with type "19" ===\n');
    const type19 = await holdings.find({ securityType: '19', isLatest: true }).toArray();
    for (const h of type19) {
      console.log(`${h.bankName} | ${h.portfolioCode} | ${h.securityName?.substring(0, 50)} | ${h.isin || 'no ISIN'}`);
    }

    // Summary by bank
    console.log('\n=== Summary: Anomalous types by bank ===\n');
    const summary = await holdings.aggregate([
      { $match: { isLatest: true, securityType: { $in: ['13', '19'] } } },
      { $group: { _id: { bank: "$bankName", type: "$securityType" }, count: { $sum: 1 } } },
      { $sort: { "_id.bank": 1, "_id.type": 1 } }
    ]).toArray();

    for (const s of summary) {
      console.log(`${s._id.bank} | type "${s._id.type}": ${s.count} holdings`);
    }

  } finally {
    await client.close();
  }
}
check();
