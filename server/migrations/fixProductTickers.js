/**
 * Database Migration: Fix Product Ticker Symbols
 *
 * This script audits and fixes ticker symbols in all products to ensure:
 * 1. All tickers have proper exchange suffixes (e.g., AAPL.US, SAP.DE)
 * 2. Invalid ticker formats are identified and reported
 * 3. Company names are not stored as ticker symbols
 * 4. Nordic stocks (Danish, Swedish, Norwegian, Finnish) have correct exchanges
 *
 * Run this script via Meteor methods:
 * - Meteor.call('migration.auditProductTickers') - Dry run (report only)
 * - Meteor.call('migration.fixProductTickers') - Apply fixes
 */

import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';
import { normalizeTickerSymbol, validateTickerFormat, isKnownStock } from '/imports/utils/tickerUtils';

if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Audit all product tickers without making changes
     * Returns a report of issues found
     */
    async 'migration.auditProductTickers'() {
      try {
        console.log('[Migration] Starting product ticker audit...');

        const report = {
          totalProducts: 0,
          productsChecked: 0,
          productsWithIssues: 0,
          issuesFound: [],
          recommendations: [],
          summary: {}
        };

        // Fetch all products
        const products = await ProductsCollection.find({}).fetchAsync();
        report.totalProducts = products.length;

        console.log(`[Migration] Found ${products.length} products to audit`);

        // Check each product
        for (const product of products) {
          report.productsChecked++;
          const productIssues = [];

          // Check underlyings array
          if (product.underlyings && Array.isArray(product.underlyings)) {
            product.underlyings.forEach((underlying, index) => {
              const symbol = underlying.symbol || underlying.ticker;
              const name = underlying.name;

              if (symbol) {
                const validation = validateTickerFormat(symbol);

                if (!validation.valid) {
                  productIssues.push({
                    location: `underlyings[${index}]`,
                    currentSymbol: symbol,
                    name: name,
                    issue: validation.reason,
                    severity: 'high'
                  });
                } else if (validation.needsNormalization) {
                  const normalized = normalizeTickerSymbol(symbol, { name });
                  if (normalized && normalized !== symbol) {
                    productIssues.push({
                      location: `underlyings[${index}]`,
                      currentSymbol: symbol,
                      suggestedSymbol: normalized,
                      name: name,
                      issue: 'Missing exchange suffix',
                      severity: 'medium'
                    });
                  }
                }
              }
            });
          }

          // Check payoffStructure
          if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
            product.payoffStructure.forEach((item, itemIndex) => {
              // Check single security
              if (item.definition?.security?.symbol) {
                const symbol = item.definition.security.symbol;
                const name = item.definition.security.name;

                const validation = validateTickerFormat(symbol);

                if (!validation.valid) {
                  productIssues.push({
                    location: `payoffStructure[${itemIndex}].definition.security`,
                    currentSymbol: symbol,
                    name: name,
                    issue: validation.reason,
                    severity: 'high'
                  });
                } else if (validation.needsNormalization) {
                  const normalized = normalizeTickerSymbol(symbol, { name });
                  if (normalized && normalized !== symbol) {
                    productIssues.push({
                      location: `payoffStructure[${itemIndex}].definition.security`,
                      currentSymbol: symbol,
                      suggestedSymbol: normalized,
                      name: name,
                      issue: 'Missing exchange suffix',
                      severity: 'medium'
                    });
                  }
                }
              }

              // Check basket
              if (item.definition?.basket && Array.isArray(item.definition.basket)) {
                item.definition.basket.forEach((security, secIndex) => {
                  if (security.symbol) {
                    const symbol = security.symbol;
                    const name = security.name;

                    const validation = validateTickerFormat(symbol);

                    if (!validation.valid) {
                      productIssues.push({
                        location: `payoffStructure[${itemIndex}].definition.basket[${secIndex}]`,
                        currentSymbol: symbol,
                        name: name,
                        issue: validation.reason,
                        severity: 'high'
                      });
                    } else if (validation.needsNormalization) {
                      const normalized = normalizeTickerSymbol(symbol, { name });
                      if (normalized && normalized !== symbol) {
                        productIssues.push({
                          location: `payoffStructure[${itemIndex}].definition.basket[${secIndex}]`,
                          currentSymbol: symbol,
                          suggestedSymbol: normalized,
                          name: name,
                          issue: 'Missing exchange suffix',
                          severity: 'medium'
                        });
                      }
                    }
                  }
                });
              }
            });
          }

          // If product has issues, add to report
          if (productIssues.length > 0) {
            report.productsWithIssues++;
            report.issuesFound.push({
              productId: product._id,
              productName: product.title || product.name || 'Unnamed',
              issues: productIssues
            });
          }
        }

        // Generate summary
        const highSeverityCount = report.issuesFound.reduce((sum, p) =>
          sum + p.issues.filter(i => i.severity === 'high').length, 0
        );
        const mediumSeverityCount = report.issuesFound.reduce((sum, p) =>
          sum + p.issues.filter(i => i.severity === 'medium').length, 0
        );

        report.summary = {
          highSeverity: highSeverityCount,
          mediumSeverity: mediumSeverityCount,
          totalIssues: highSeverityCount + mediumSeverityCount
        };

        // Generate recommendations
        if (highSeverityCount > 0) {
          report.recommendations.push(
            `Found ${highSeverityCount} high-severity issues (invalid ticker formats). These should be fixed immediately.`
          );
        }
        if (mediumSeverityCount > 0) {
          report.recommendations.push(
            `Found ${mediumSeverityCount} medium-severity issues (missing exchange suffixes). Run migration.fixProductTickers to apply fixes.`
          );
        }
        if (report.productsWithIssues === 0) {
          report.recommendations.push('All product tickers are properly formatted!');
        }

        console.log('[Migration] Audit complete:');
        console.log(`  - Total products: ${report.totalProducts}`);
        console.log(`  - Products with issues: ${report.productsWithIssues}`);
        console.log(`  - High severity issues: ${highSeverityCount}`);
        console.log(`  - Medium severity issues: ${mediumSeverityCount}`);

        return report;

      } catch (error) {
        console.error('[Migration] Audit failed:', error);
        throw new Meteor.Error('migration-audit-failed', error.message);
      }
    },

    /**
     * Fix product tickers by applying normalization
     * Returns a report of changes made
     */
    async 'migration.fixProductTickers'() {
      try {
        console.log('[Migration] Starting product ticker fixes...');

        const report = {
          totalProducts: 0,
          productsUpdated: 0,
          tickersFixed: 0,
          changes: [],
          errors: []
        };

        // Fetch all products
        const products = await ProductsCollection.find({}).fetchAsync();
        report.totalProducts = products.length;

        console.log(`[Migration] Found ${products.length} products to process`);

        // Process each product
        for (const product of products) {
          let productModified = false;
          const productChanges = [];

          // Fix underlyings array
          if (product.underlyings && Array.isArray(product.underlyings)) {
            for (let i = 0; i < product.underlyings.length; i++) {
              const underlying = product.underlyings[i];
              const symbol = underlying.symbol || underlying.ticker;
              const name = underlying.name;

              if (symbol) {
                const validation = validateTickerFormat(symbol);

                if (validation.valid && validation.needsNormalization) {
                  const normalized = normalizeTickerSymbol(symbol, { name });

                  if (normalized && normalized !== symbol) {
                    // Update the symbol
                    if (underlying.symbol) {
                      product.underlyings[i].symbol = normalized;
                    }
                    if (underlying.ticker) {
                      product.underlyings[i].ticker = normalized;
                    }

                    productModified = true;
                    report.tickersFixed++;
                    productChanges.push({
                      location: `underlyings[${i}]`,
                      from: symbol,
                      to: normalized,
                      name: name
                    });
                  }
                }
              }
            }
          }

          // Fix payoffStructure
          if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
            for (let i = 0; i < product.payoffStructure.length; i++) {
              const item = product.payoffStructure[i];

              // Fix single security
              if (item.definition?.security?.symbol) {
                const symbol = item.definition.security.symbol;
                const name = item.definition.security.name;
                const validation = validateTickerFormat(symbol);

                if (validation.valid && validation.needsNormalization) {
                  const normalized = normalizeTickerSymbol(symbol, { name });

                  if (normalized && normalized !== symbol) {
                    product.payoffStructure[i].definition.security.symbol = normalized;
                    productModified = true;
                    report.tickersFixed++;
                    productChanges.push({
                      location: `payoffStructure[${i}].definition.security`,
                      from: symbol,
                      to: normalized,
                      name: name
                    });
                  }
                }
              }

              // Fix basket
              if (item.definition?.basket && Array.isArray(item.definition.basket)) {
                for (let j = 0; j < item.definition.basket.length; j++) {
                  const security = item.definition.basket[j];

                  if (security.symbol) {
                    const symbol = security.symbol;
                    const name = security.name;
                    const validation = validateTickerFormat(symbol);

                    if (validation.valid && validation.needsNormalization) {
                      const normalized = normalizeTickerSymbol(symbol, { name });

                      if (normalized && normalized !== symbol) {
                        product.payoffStructure[i].definition.basket[j].symbol = normalized;
                        productModified = true;
                        report.tickersFixed++;
                        productChanges.push({
                          location: `payoffStructure[${i}].definition.basket[${j}]`,
                          from: symbol,
                          to: normalized,
                          name: name
                        });
                      }
                    }
                  }
                }
              }
            }
          }

          // If product was modified, update in database
          if (productModified) {
            try {
              await ProductsCollection.updateAsync(product._id, {
                $set: {
                  underlyings: product.underlyings,
                  payoffStructure: product.payoffStructure,
                  // Add migration metadata
                  lastTickerMigration: new Date(),
                  tickerMigrationVersion: '1.0.0'
                }
              });

              report.productsUpdated++;
              report.changes.push({
                productId: product._id,
                productName: product.title || product.name || 'Unnamed',
                changes: productChanges
              });

              console.log(`[Migration] ✓ Fixed ${productChanges.length} tickers in product: ${product.title || product._id}`);
            } catch (error) {
              console.error(`[Migration] ✗ Failed to update product ${product._id}:`, error);
              report.errors.push({
                productId: product._id,
                error: error.message
              });
            }
          }
        }

        console.log('[Migration] Fix complete:');
        console.log(`  - Total products: ${report.totalProducts}`);
        console.log(`  - Products updated: ${report.productsUpdated}`);
        console.log(`  - Tickers fixed: ${report.tickersFixed}`);
        console.log(`  - Errors: ${report.errors.length}`);

        return report;

      } catch (error) {
        console.error('[Migration] Fix failed:', error);
        throw new Meteor.Error('migration-fix-failed', error.message);
      }
    }
  });
}
