/**
 * Quick diagnostic to check if securityData.ticker exists in products
 * Run with: Meteor.call('test.checkSecurityData')
 */

import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';

if (Meteor.isServer) {
  Meteor.methods({
    async 'test.checkSecurityData'() {
      console.log('\n=== SECURITY DATA CHECK ===\n');

      try {
        const products = await ProductsCollection.find({}).fetchAsync();
        console.log(`Found ${products.length} products\n`);

        products.forEach(product => {
          console.log(`📦 Product: ${product.title || product.name || product._id}`);

          if (product.underlyings && Array.isArray(product.underlyings)) {
            console.log(`   Underlyings (${product.underlyings.length}):`);

            product.underlyings.forEach((u, i) => {
              console.log(`   [${i}] ${u.ticker || u.symbol}`);

              if (u.securityData?.ticker) {
                console.log(`       ✅ securityData.ticker = "${u.securityData.ticker}"`);
              } else {
                console.log(`       ❌ No securityData.ticker found`);
              }

              // Show full securityData if exists
              if (u.securityData) {
                console.log(`       Full securityData:`, JSON.stringify(u.securityData, null, 2));
              }
            });
          }
        });

        console.log('\n=== END CHECK ===\n');

      } catch (error) {
        console.error('Check failed:', error);
        throw error;
      }
    }
  });
}
