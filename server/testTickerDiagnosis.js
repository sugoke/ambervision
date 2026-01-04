/**
 * Ticker Diagnosis Tool
 * Run with: Meteor.call('test.diagnoseTickers')
 */

import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';
import { normalizeTickerSymbol, validateTickerFormat, isKnownStock } from '/imports/utils/tickerUtils';
import { TickerCacheHelpers } from '/imports/api/tickerCache';

if (Meteor.isServer) {
  Meteor.methods({
    async 'test.diagnoseTickers'() {
      console.log('\n=== TICKER DIAGNOSIS REPORT ===\n');

      try {
        // Get all products
        const products = await ProductsCollection.find({}).fetchAsync();
        console.log(`Found ${products.length} products in database\n`);

        const allTickers = new Map();

        // Extract all tickers from products
        for (const product of products) {
          console.log(`\n📦 Product: ${product.title || product.name || product._id}`);
          console.log(`   ID: ${product._id}`);

          // Check underlyings array
          if (product.underlyings && Array.isArray(product.underlyings)) {
            console.log(`   Underlyings (${product.underlyings.length}):`);

            product.underlyings.forEach((u, i) => {
              const symbol = u.symbol || u.ticker;
              const name = u.name;

              if (symbol) {
                console.log(`     [${i}] ${symbol} (${name || 'no name'})`);

                // Validate format
                const validation = validateTickerFormat(symbol);
                if (!validation.valid) {
                  console.log(`         ❌ INVALID: ${validation.reason}`);
                } else if (validation.needsNormalization) {
                  const normalized = normalizeTickerSymbol(symbol, { name });
                  console.log(`         ⚠️  Needs normalization: ${symbol} → ${normalized}`);
                  allTickers.set(normalized, { original: symbol, name, product: product.title });
                } else {
                  console.log(`         ✅ Valid format`);
                  allTickers.set(symbol, { original: symbol, name, product: product.title });
                }

                // Check if known stock
                const known = isKnownStock(symbol);
                if (known) {
                  console.log(`         📚 Known stock in exchange map`);
                }
              }
            });
          }

          // Check payoffStructure
          if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
            product.payoffStructure.forEach((item, idx) => {
              if (item.definition?.security?.symbol) {
                const symbol = item.definition.security.symbol;
                const name = item.definition.security.name;
                console.log(`   PayoffStructure[${idx}].security: ${symbol} (${name || 'no name'})`);

                const validation = validateTickerFormat(symbol);
                if (!validation.valid) {
                  console.log(`     ❌ INVALID: ${validation.reason}`);
                } else {
                  const normalized = normalizeTickerSymbol(symbol, { name });
                  allTickers.set(normalized, { original: symbol, name, product: product.title });
                }
              }

              if (item.definition?.basket && Array.isArray(item.definition.basket)) {
                item.definition.basket.forEach((sec, secIdx) => {
                  if (sec.symbol) {
                    const symbol = sec.symbol;
                    const name = sec.name;
                    console.log(`   PayoffStructure[${idx}].basket[${secIdx}]: ${symbol} (${name || 'no name'})`);

                    const validation = validateTickerFormat(symbol);
                    if (!validation.valid) {
                      console.log(`     ❌ INVALID: ${validation.reason}`);
                    } else {
                      const normalized = normalizeTickerSymbol(symbol, { name });
                      allTickers.set(normalized, { original: symbol, name, product: product.title });
                    }
                  }
                });
              }
            });
          }
        }

        // Test all unique tickers with EOD API
        console.log(`\n\n=== TESTING ${allTickers.size} UNIQUE TICKERS WITH EOD API ===\n`);

        const results = {
          valid: [],
          invalid: []
        };

        for (const [ticker, info] of allTickers) {
          console.log(`Testing ${ticker} (${info.name})...`);

          try {
            const priceData = await TickerCacheHelpers.fetchPriceFromEOD(ticker);

            if (priceData && priceData.price > 0) {
              console.log(`  ✅ Valid - Price: $${priceData.price.toFixed(2)}`);
              results.valid.push({
                ticker,
                original: info.original,
                name: info.name,
                price: priceData.price,
                product: info.product
              });
            } else {
              console.log(`  ❌ No price data returned`);
              results.invalid.push({
                ticker,
                original: info.original,
                name: info.name,
                reason: 'No price data',
                product: info.product
              });
            }
          } catch (error) {
            console.log(`  ❌ Error: ${error.message}`);
            results.invalid.push({
              ticker,
              original: info.original,
              name: info.name,
              reason: error.message,
              product: info.product
            });
          }

          // Small delay
          await new Promise(resolve => setTimeout(resolve, 200));
        }

        // Summary
        console.log('\n\n=== SUMMARY ===');
        console.log(`✅ Valid tickers: ${results.valid.length}`);
        results.valid.forEach(t => {
          console.log(`   ${t.ticker} (${t.name}): $${t.price.toFixed(2)} - from "${t.product}"`);
        });

        console.log(`\n❌ Invalid tickers: ${results.invalid.length}`);
        results.invalid.forEach(t => {
          console.log(`   ${t.ticker} (${t.name}): ${t.reason} - from "${t.product}"`);

          // Suggest fix
          if (t.original !== t.ticker) {
            console.log(`      💡 Already normalized from: ${t.original}`);
          }
        });

        console.log('\n=== END DIAGNOSIS ===\n');

        return {
          totalProducts: products.length,
          totalTickers: allTickers.size,
          validCount: results.valid.length,
          invalidCount: results.invalid.length,
          valid: results.valid,
          invalid: results.invalid
        };

      } catch (error) {
        console.error('Diagnosis failed:', error);
        throw error;
      }
    }
  });
}
