// Fix ABNB.US ticker issue - Run with: meteor shell < fix-abnb.js

console.log('\n🔍 Starting ABNB.US diagnostic and fix...\n');

// Step 1: Clear all invalid prices from cache
Meteor.call('tickerCache.clearInvalidPrices', (err, result) => {
  if (err) {
    console.error('❌ Error clearing invalid prices:', err.message);
    return;
  }
  console.log(`✅ Step 1: Cleared ${result.removedCount} invalid cache entries\n`);

  // Step 2: Clear ABNB.US specifically
  Meteor.call('tickerCache.clear', 'ABNB.US', (err2, result2) => {
    if (err2) {
      console.error('❌ Error clearing ABNB.US:', err2.message);
      return;
    }
    console.log(`✅ Step 2: ${result2.message}\n`);

    // Step 3: Test direct EOD API call
    console.log('🔍 Step 3: Testing direct EOD API call for ABNB.US...\n');
    Meteor.call('test.eodDirectCall', 'ABNB.US', (err3, result3) => {
      if (err3) {
        console.error('❌ Error calling EOD API:', err3.message);
        return;
      }

      console.log('✅ Step 3: EOD API Response:');
      console.log('   URL:', result3.url);
      console.log('   Response Type:', result3.responseType);

      if (result3.helperParsedData) {
        console.log('   Price:', result3.helperParsedData.price);
        console.log('   Change:', result3.helperParsedData.change);
        console.log('   Change %:', result3.helperParsedData.changePercent);
        console.log('   Previous Close:', result3.helperParsedData.previousClose);
      } else {
        console.log('   ⚠️  No price data returned from API');
      }
      console.log('\n');

      // Step 4: Fetch fresh prices
      console.log('🔍 Step 4: Fetching fresh prices for ABNB.US...\n');
      Meteor.call('tickerCache.getPrices', ['ABNB.US'], (err4, result4) => {
        if (err4) {
          console.error('❌ Error fetching prices:', err4.message);
          return;
        }

        if (result4.success && result4.prices['ABNB.US']) {
          const abnbData = result4.prices['ABNB.US'];
          console.log('✅ Step 4: ABNB.US price fetched successfully!');
          console.log('   Price: $' + (abnbData.price || 'N/A'));
          console.log('   Change: ' + (abnbData.change || 'N/A'));
          console.log('   Change %: ' + (abnbData.changePercent || 'N/A') + '%');
          console.log('   Source:', abnbData.source || 'N/A');
          console.log('\n✅ SUCCESS! ABNB.US is now working correctly.');
          console.log('   Refresh your browser to see the updated price in the MarketTicker.\n');
        } else {
          console.log('⚠️  Step 4: ABNB.US not found in price fetch result');
          console.log('   This means the EOD API is not returning valid price data for ABNB.US');
          console.log('   Response:', JSON.stringify(result4, null, 2));
          console.log('\n❌ The ticker may not be valid or available on EOD Historical Data API.');
          console.log('   Check https://eodhd.com/financial-summary/ABNB.US to verify.\n');
        }
      });
    });
  });
});
