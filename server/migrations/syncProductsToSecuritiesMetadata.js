/**
 * Migration: Sync Products to Securities Metadata
 *
 * This migration backfills securitiesMetadata for all products that have ISINs
 * but are missing from the securitiesMetadata collection.
 *
 * Run this migration once to sync existing products, then new products will
 * be automatically synced via the products.save and products.update methods.
 */

import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';
import { SecuritiesMetadataCollection, SecuritiesMetadataHelpers } from '/imports/api/securitiesMetadata';
import { detectUnderlyingType } from '/imports/api/helpers/underlyingTypeDetector';

export const runSyncProductsToSecuritiesMetadata = async () => {
  console.log('[MIGRATION] Starting: Sync Products to Securities Metadata');

  // Find all products with ISINs
  const productsWithIsins = await ProductsCollection.find(
    { isin: { $exists: true, $ne: null, $ne: '' } },
    { fields: { _id: 1, isin: 1, title: 1, templateId: 1, template: 1, underlyings: 1, capitalProtection: 1 } }
  ).fetchAsync();

  console.log(`[MIGRATION] Found ${productsWithIsins.length} products with ISINs`);

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const product of productsWithIsins) {
    try {
      // Check if already exists in securitiesMetadata
      const existing = await SecuritiesMetadataCollection.findOneAsync({ isin: product.isin });

      // Skip if already exists and was not auto-created (manually classified)
      if (existing && !existing.autoCreatedFromProduct) {
        skipped++;
        continue;
      }

      // Map templateId to structuredProductType
      const templateId = product.templateId || product.template || '';
      const templateLower = templateId.toLowerCase();

      let structuredProductType = 'other';
      if (templateLower.includes('phoenix') || templateLower.includes('autocallable')) {
        structuredProductType = 'phoenix';
      } else if (templateLower.includes('orion')) {
        structuredProductType = 'orion';
      } else if (templateLower.includes('himalaya')) {
        structuredProductType = 'himalaya';
      } else if (templateLower.includes('participation')) {
        structuredProductType = 'participation_note';
      } else if (templateLower.includes('reverse_convertible_bond')) {
        structuredProductType = 'reverse_convertible_bond';
      } else if (templateLower.includes('reverse_convertible')) {
        structuredProductType = 'reverse_convertible';
      } else if (templateLower.includes('shark')) {
        structuredProductType = 'shark_note';
      }

      // Determine underlying type based on underlyings using shared utility
      // This properly detects equity-linked, fixed_income_linked, commodities_linked, etc.
      const underlyingType = detectUnderlyingType(product.underlyings);

      // Determine protection type from product structure
      let protectionType = 'capital_protected_conditional';
      if (product.capitalProtection === 100) {
        protectionType = 'capital_guaranteed_100';
      } else if (product.capitalProtection && product.capitalProtection > 0) {
        protectionType = 'capital_guaranteed_partial';
      }

      const securityMetadata = {
        isin: product.isin,
        securityName: product.title || `Structured Product ${product.isin}`,
        assetClass: 'structured_product',
        structuredProductType: structuredProductType,
        structuredProductUnderlyingType: underlyingType,
        structuredProductProtectionType: protectionType,
        sourceProductId: product._id,
        autoCreatedFromProduct: true
      };

      const result = await SecuritiesMetadataHelpers.upsertSecurityMetadata(securityMetadata);

      if (result.updated) {
        updated++;
      } else {
        created++;
      }
    } catch (error) {
      console.error(`[MIGRATION] Error processing product ${product._id} (ISIN: ${product.isin}):`, error.message);
      errors++;
    }
  }

  const summary = {
    totalProducts: productsWithIsins.length,
    created,
    updated,
    skipped,
    errors
  };

  console.log('[MIGRATION] Complete: Sync Products to Securities Metadata');
  console.log(`[MIGRATION] Summary: ${created} created, ${updated} updated, ${skipped} skipped (manually classified), ${errors} errors`);

  return summary;
};

// Register as a Meteor method for manual execution
if (Meteor.isServer) {
  Meteor.methods({
    async 'migration.syncProductsToSecuritiesMetadata'() {
      return await runSyncProductsToSecuritiesMetadata();
    }
  });
}
