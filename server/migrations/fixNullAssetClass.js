/**
 * Migration Script: Fix Null Asset Class
 *
 * Fixes holdings that have null assetClass:
 * 1. Cash positions with securityType='CASH' but assetClass=null -> set to 'cash'
 * 2. Holdings with ISINs that have metadata classification -> copy assetClass from metadata
 *
 * Usage:
 * Run via Meteor method: Meteor.call('admin.fixNullAssetClass')
 * Can be run safely multiple times (idempotent).
 */

import { Meteor } from 'meteor/meteor';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { SecuritiesMetadataCollection } from '/imports/api/securitiesMetadata';

/**
 * Run the null asset class fix migration
 */
export async function fixNullAssetClass() {
  console.log('[FIX_NULL_ASSETCLASS] Starting migration...');

  const results = {
    cashPositionsFixed: 0,
    holdingsEnrichedFromMetadata: 0,
    errors: []
  };

  try {
    // =========================================================================
    // PHASE 1: Fix cash positions - derive assetClass from securityType
    // =========================================================================
    console.log('[FIX_NULL_ASSETCLASS] Phase 1: Fixing cash positions...');

    const cashUpdateResult = await PMSHoldingsCollection.rawCollection().updateMany(
      {
        securityType: 'CASH',
        $or: [
          { assetClass: null },
          { assetClass: { $exists: false } }
        ]
      },
      {
        $set: {
          assetClass: 'cash',
          updatedAt: new Date()
        }
      }
    );

    results.cashPositionsFixed = cashUpdateResult.modifiedCount || 0;
    console.log(`[FIX_NULL_ASSETCLASS] Fixed ${results.cashPositionsFixed} cash positions`);

    // =========================================================================
    // PHASE 2: Fix holdings with ISINs - enrich from securitiesMetadata
    // =========================================================================
    console.log('[FIX_NULL_ASSETCLASS] Phase 2: Enriching from securitiesMetadata...');

    // Find all holdings with ISIN but null assetClass
    const holdingsWithIsin = await PMSHoldingsCollection.find({
      isin: { $ne: null, $exists: true, $nin: ['', 'N/A'] },
      $or: [
        { assetClass: null },
        { assetClass: { $exists: false } }
      ]
    }).fetchAsync();

    console.log(`[FIX_NULL_ASSETCLASS] Found ${holdingsWithIsin.length} holdings with ISIN and null assetClass`);

    // Get unique ISINs
    const uniqueIsins = [...new Set(holdingsWithIsin.map(h => h.isin))];
    console.log(`[FIX_NULL_ASSETCLASS] Unique ISINs to lookup: ${uniqueIsins.length}`);

    // Batch lookup metadata for all ISINs
    const metadataRecords = await SecuritiesMetadataCollection.find({
      isin: { $in: uniqueIsins }
    }).fetchAsync();

    // Create ISIN -> metadata map
    const metadataMap = {};
    metadataRecords.forEach(m => {
      if (m.assetClass) {
        metadataMap[m.isin] = {
          assetClass: m.assetClass,
          securityType: m.securityType
        };
      }
    });

    console.log(`[FIX_NULL_ASSETCLASS] Found metadata for ${Object.keys(metadataMap).length} ISINs`);

    // Update holdings from metadata
    for (const holding of holdingsWithIsin) {
      const metadata = metadataMap[holding.isin];
      if (metadata) {
        try {
          const updateFields = {
            assetClass: metadata.assetClass,
            updatedAt: new Date()
          };

          // Also update securityType if it's null and metadata has it
          if (!holding.securityType && metadata.securityType) {
            updateFields.securityType = metadata.securityType;
          }

          await PMSHoldingsCollection.updateAsync(
            { _id: holding._id },
            { $set: updateFields }
          );

          results.holdingsEnrichedFromMetadata++;
          console.log(`[FIX_NULL_ASSETCLASS] Updated ${holding.securityName} (${holding.isin}) -> assetClass: ${metadata.assetClass}`);
        } catch (updateError) {
          results.errors.push({
            holdingId: holding._id,
            isin: holding.isin,
            error: updateError.message
          });
        }
      } else {
        console.log(`[FIX_NULL_ASSETCLASS] No metadata found for ISIN: ${holding.isin} (${holding.securityName})`);
      }
    }

    console.log(`[FIX_NULL_ASSETCLASS] Enriched ${results.holdingsEnrichedFromMetadata} holdings from metadata`);

    // =========================================================================
    // Summary
    // =========================================================================
    console.log('[FIX_NULL_ASSETCLASS] Migration complete!');
    console.log(`[FIX_NULL_ASSETCLASS] Summary:`);
    console.log(`  - Cash positions fixed: ${results.cashPositionsFixed}`);
    console.log(`  - Holdings enriched from metadata: ${results.holdingsEnrichedFromMetadata}`);
    console.log(`  - Errors: ${results.errors.length}`);

    return results;

  } catch (error) {
    console.error('[FIX_NULL_ASSETCLASS] Migration failed:', error);
    results.errors.push({ phase: 'general', error: error.message });
    return results;
  }
}

// Register as Meteor method for manual execution
if (Meteor.isServer) {
  Meteor.methods({
    async 'admin.fixNullAssetClass'() {
      // Only allow admins to run this
      const userId = this.userId;
      if (userId) {
        const { UsersCollection, USER_ROLES } = await import('/imports/api/users');
        const user = await UsersCollection.findOneAsync(userId);
        if (user?.role !== USER_ROLES.ADMIN && user?.role !== USER_ROLES.SUPERADMIN) {
          throw new Meteor.Error('not-authorized', 'Only admins can run migrations');
        }
      }

      return await fixNullAssetClass();
    }
  });
}
