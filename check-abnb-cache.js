// Check ABNB.US cache status
// Run with: meteor shell < check-abnb-cache.js

const { TickerPriceCacheCollection } = require('./imports/api/tickerCache');

console.log('\n🔍 Checking ABNB.US cache entries...\n');

TickerPriceCacheCollection.find({ symbol: 'ABNB.US' }).fetchAsync().then(results => {
  if (results.length === 0) {
    console.log('✅ No cache entries found for ABNB.US (cache is clean)');
    console.log('\n🔍 Now testing if EOD API returns valid data...\n');

    Meteor.call('test.eodDirectCall', 'ABNB.US', (err, result) => {
      if (err) {
        console.error('❌ Error:', err.message);
        return;
      }

      console.log('📡 EOD API Response:');
      console.log('   Raw Response:', JSON.stringify(result.rawResponse).substring(0, 200));
      console.log('   Parsed Price:', result.parsedData?.price);
      console.log('   All Fields:', result.parsedData?.allFields);
      console.log('   Helper Result:', result.helperParsedData);

      if (!result.helperParsedData || result.helperParsedData.price <= 0) {
        console.log('\n❌ PROBLEM FOUND: EOD API is not returning valid price data for ABNB.US');
        console.log('   This ticker may not be available or may need a different format.');
        console.log('\n💡 Try checking https://eodhd.com/financial-summary/ABNB.US');
      } else {
        console.log('\n✅ EOD API returns valid data. Refreshing cache...');
        Meteor.call('tickerCache.getPrices', ['ABNB.US'], (err2, result2) => {
          if (err2) {
            console.error('❌ Error refreshing:', err2.message);
            return;
          }
          console.log('✅ Cache refreshed:', result2.prices['ABNB.US']);
        });
      }
    });
  } else {
    console.log(`Found ${results.length} cache entry(ies) for ABNB.US:\n`);
    results.forEach((entry, i) => {
      console.log(`Entry ${i + 1}:`);
      console.log('   Symbol:', entry.symbol);
      console.log('   Price:', entry.price);
      console.log('   Change:', entry.change);
      console.log('   Change %:', entry.changePercent);
      console.log('   Source:', entry.source);
      console.log('   Timestamp:', entry.timestamp);
      console.log('   Expires:', entry.expiresAt);
      console.log('   Expired?', entry.expiresAt < new Date());

      if (!entry.price || entry.price <= 0) {
        console.log('   ⚠️  INVALID: Price is zero or null!');
      }
      console.log('');
    });

    console.log('\n🔧 Clearing invalid entries...');
    Meteor.call('tickerCache.clear', 'ABNB.US', (err, result) => {
      if (err) {
        console.error('❌ Error:', err.message);
        return;
      }
      console.log(`✅ Cleared ${result.removedCount} entry(ies)`);
      console.log('\n🔄 Refresh your browser to see the updated ticker.\n');
    });
  }
});
