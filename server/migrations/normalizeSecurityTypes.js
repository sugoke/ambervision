/**
 * Migration Script: Normalize Security Types
 *
 * Migrates existing PMSHoldings data to use standardized Ambervision security types.
 *
 * Changes:
 * 1. DEPOSIT -> TERM_DEPOSIT (Andbank legacy)
 * 2. FOREX -> FX_FORWARD (Andbank legacy)
 * 3. MONEY_MARKET_FUND -> MONEY_MARKET (CMB Monaco legacy)
 * 4. Raw Julius Baer codes (13, 19, etc.) -> Proper SECURITY_TYPES
 * 5. null securityType with assetClass -> Infer from assetClass
 * 6. UNKNOWN securityType with known assetClass (etf, fund) -> Proper type
 *
 * Usage:
 * Run via Meteor method: Meteor.call('admin.migrateSecurityTypes')
 * Can be run safely multiple times (idempotent).
 */

import { Meteor } from 'meteor/meteor';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import {
  SECURITY_TYPES,
  LEGACY_SECURITY_TYPE_MAPPING,
  isValidSecurityType,
  getSecurityTypeFromAssetClass
} from '/imports/api/constants/instrumentTypes';

/**
 * Mapping of legacy security types to standardized values
 * Uses LEGACY_SECURITY_TYPE_MAPPING from instrumentTypes.js
 */
const MIGRATION_MAP = {
  // Andbank legacy names
  'DEPOSIT': SECURITY_TYPES.TERM_DEPOSIT,
  'FOREX': SECURITY_TYPES.FX_FORWARD,

  // CMB Monaco legacy names
  'MONEY_MARKET_FUND': SECURITY_TYPES.MONEY_MARKET,

  // Julius Baer INST_NAT_E raw codes
  '1': SECURITY_TYPES.EQUITY,
  '2': SECURITY_TYPES.BOND,
  '3': SECURITY_TYPES.FUND,
  '4': SECURITY_TYPES.CASH,
  '5': SECURITY_TYPES.OPTION,
  '6': SECURITY_TYPES.FUTURE,
  '7': SECURITY_TYPES.WARRANT,
  '13': SECURITY_TYPES.FUND,               // Fund Share
  '19': SECURITY_TYPES.STRUCTURED_PRODUCT  // Convertible/Structured Notes
};

/**
 * Run the security type normalization migration
 */
export async function migrateSecurityTypes() {
  console.log('[SECURITY_TYPES_MIGRATION] Starting security type normalization...');

  const migrationResults = {
    totalProcessed: 0,
    updatedRecords: 0,
    byType: {},
    nullFixed: 0,
    unknownFixed: 0,
    errors: []
  };

  try {
    // =========================================================================
    // PHASE 1: Fix legacy/raw code types from MIGRATION_MAP
    // =========================================================================
    console.log('[SECURITY_TYPES_MIGRATION] Phase 1: Fixing legacy/raw code types...');

    for (const [oldType, newType] of Object.entries(MIGRATION_MAP)) {
      console.log(`[SECURITY_TYPES_MIGRATION] Processing: "${oldType}" -> ${newType}`);

      // Count records with the old type
      const count = await PMSHoldingsCollection.find({
        securityType: oldType
      }).countAsync();

      migrationResults.byType[oldType] = {
        found: count,
        updated: 0,
        newType: newType
      };

      if (count === 0) {
        console.log(`[SECURITY_TYPES_MIGRATION]   No records found with type: "${oldType}"`);
        continue;
      }

      console.log(`[SECURITY_TYPES_MIGRATION]   Found ${count} records with type: "${oldType}"`);

      // Update all records
      const updateResult = await PMSHoldingsCollection.updateAsync(
        { securityType: oldType },
        {
          $set: {
            securityType: newType,
            updatedAt: new Date(),
            migrationNote: `Security type normalized from "${oldType}" to ${newType} on ${new Date().toISOString()}`
          }
        },
        { multi: true }
      );

      migrationResults.byType[oldType].updated = updateResult;
      migrationResults.updatedRecords += updateResult;
      migrationResults.totalProcessed += count;

      console.log(`[SECURITY_TYPES_MIGRATION]   Updated ${updateResult} records: "${oldType}" -> ${newType}`);
    }

    // =========================================================================
    // PHASE 2: Fix null securityType where assetClass exists
    // =========================================================================
    console.log('[SECURITY_TYPES_MIGRATION] Phase 2: Fixing null securityType with known assetClass...');

    const nullWithAssetClass = await PMSHoldingsCollection.find({
      securityType: null,
      assetClass: { $ne: null, $exists: true }
    }).fetchAsync();

    console.log(`[SECURITY_TYPES_MIGRATION]   Found ${nullWithAssetClass.length} records with null securityType + assetClass`);

    for (const record of nullWithAssetClass) {
      const newType = getSecurityTypeFromAssetClass(record.assetClass);
      if (newType && newType !== SECURITY_TYPES.UNKNOWN) {
        await PMSHoldingsCollection.updateAsync(record._id, {
          $set: {
            securityType: newType,
            updatedAt: new Date(),
            migrationNote: `Security type inferred from assetClass "${record.assetClass}" -> ${newType} on ${new Date().toISOString()}`
          }
        });
        migrationResults.nullFixed++;
      }
    }

    console.log(`[SECURITY_TYPES_MIGRATION]   Fixed ${migrationResults.nullFixed} null securityType records`);

    // =========================================================================
    // PHASE 3: Fix UNKNOWN securityType where assetClass is specifically known
    // =========================================================================
    console.log('[SECURITY_TYPES_MIGRATION] Phase 3: Fixing UNKNOWN with known assetClass...');

    // Fix UNKNOWN -> ETF where assetClass is 'etf'
    const unknownEtfCount = await PMSHoldingsCollection.find({
      securityType: 'UNKNOWN',
      assetClass: 'etf'
    }).countAsync();

    if (unknownEtfCount > 0) {
      const etfResult = await PMSHoldingsCollection.updateAsync(
        { securityType: 'UNKNOWN', assetClass: 'etf' },
        {
          $set: {
            securityType: SECURITY_TYPES.ETF,
            updatedAt: new Date(),
            migrationNote: `Security type updated from UNKNOWN to ETF (assetClass=etf) on ${new Date().toISOString()}`
          }
        },
        { multi: true }
      );
      migrationResults.unknownFixed += etfResult;
      console.log(`[SECURITY_TYPES_MIGRATION]   Fixed ${etfResult} UNKNOWN -> ETF records`);
    }

    // Fix UNKNOWN -> FUND where assetClass is 'fund'
    const unknownFundCount = await PMSHoldingsCollection.find({
      securityType: 'UNKNOWN',
      assetClass: 'fund'
    }).countAsync();

    if (unknownFundCount > 0) {
      const fundResult = await PMSHoldingsCollection.updateAsync(
        { securityType: 'UNKNOWN', assetClass: 'fund' },
        {
          $set: {
            securityType: SECURITY_TYPES.FUND,
            updatedAt: new Date(),
            migrationNote: `Security type updated from UNKNOWN to FUND (assetClass=fund) on ${new Date().toISOString()}`
          }
        },
        { multi: true }
      );
      migrationResults.unknownFixed += fundResult;
      console.log(`[SECURITY_TYPES_MIGRATION]   Fixed ${fundResult} UNKNOWN -> FUND records`);
    }

    // =========================================================================
    // PHASE 4: Report remaining non-standard types
    // =========================================================================
    console.log('[SECURITY_TYPES_MIGRATION] Phase 4: Checking for remaining non-standard types...');

    const allTypes = await PMSHoldingsCollection.rawCollection().distinct('securityType');
    const nonStandardTypes = allTypes.filter(type => type !== null && !isValidSecurityType(type));

    if (nonStandardTypes.length > 0) {
      console.log('[SECURITY_TYPES_MIGRATION] Warning: Found remaining non-standard security types:');
      for (const type of nonStandardTypes) {
        const count = await PMSHoldingsCollection.find({ securityType: type }).countAsync();
        console.log(`[SECURITY_TYPES_MIGRATION]   - "${type}": ${count} records`);
        migrationResults.errors.push({
          type: 'non_standard_type',
          value: type,
          count: count,
          message: `Non-standard security type "${type}" still exists after migration`
        });
      }
    }

    // Check remaining null securityType
    const remainingNull = await PMSHoldingsCollection.find({ securityType: null }).countAsync();
    if (remainingNull > 0) {
      console.log(`[SECURITY_TYPES_MIGRATION] Warning: ${remainingNull} records still have null securityType`);
      migrationResults.errors.push({
        type: 'null_security_type',
        count: remainingNull,
        message: `${remainingNull} records still have null securityType (no assetClass to infer from)`
      });
    }

    // =========================================================================
    // SUMMARY
    // =========================================================================
    console.log('[SECURITY_TYPES_MIGRATION] ====================================');
    console.log('[SECURITY_TYPES_MIGRATION] Migration complete!');
    console.log('[SECURITY_TYPES_MIGRATION] Summary:');
    console.log(`[SECURITY_TYPES_MIGRATION]   Phase 1 - Legacy types fixed: ${migrationResults.updatedRecords}`);
    console.log(`[SECURITY_TYPES_MIGRATION]   Phase 2 - Null types fixed: ${migrationResults.nullFixed}`);
    console.log(`[SECURITY_TYPES_MIGRATION]   Phase 3 - UNKNOWN types fixed: ${migrationResults.unknownFixed}`);
    console.log(`[SECURITY_TYPES_MIGRATION]   Total updated: ${migrationResults.updatedRecords + migrationResults.nullFixed + migrationResults.unknownFixed}`);
    console.log('[SECURITY_TYPES_MIGRATION]   By legacy type:');
    for (const [oldType, stats] of Object.entries(migrationResults.byType)) {
      if (stats.found > 0) {
        console.log(`[SECURITY_TYPES_MIGRATION]     "${oldType}" -> ${stats.newType}: ${stats.updated}/${stats.found} updated`);
      }
    }
    if (migrationResults.errors.length > 0) {
      console.log(`[SECURITY_TYPES_MIGRATION]   Warnings: ${migrationResults.errors.length}`);
    }
    console.log('[SECURITY_TYPES_MIGRATION] ====================================');

    return {
      success: true,
      ...migrationResults
    };

  } catch (error) {
    console.error('[SECURITY_TYPES_MIGRATION] Migration failed:', error);
    migrationResults.errors.push({
      type: 'fatal_error',
      message: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Get a preview of what the migration will do (dry run)
 */
export async function previewSecurityTypesMigration() {
  console.log('[SECURITY_TYPES_MIGRATION] Preview (dry run)...');

  const preview = {
    phase1Changes: [],
    phase2Changes: { nullWithAssetClass: 0 },
    phase3Changes: { unknownEtf: 0, unknownFund: 0 },
    nonStandardTypes: [],
    remainingNull: 0
  };

  // Phase 1: Check each legacy type in MIGRATION_MAP
  for (const [oldType, newType] of Object.entries(MIGRATION_MAP)) {
    const count = await PMSHoldingsCollection.find({ securityType: oldType }).countAsync();
    if (count > 0) {
      preview.phase1Changes.push({
        from: oldType,
        to: newType,
        count: count
      });
    }
  }

  // Phase 2: Check null securityType with assetClass
  preview.phase2Changes.nullWithAssetClass = await PMSHoldingsCollection.find({
    securityType: null,
    assetClass: { $ne: null, $exists: true }
  }).countAsync();

  // Phase 3: Check UNKNOWN with specific assetClass
  preview.phase3Changes.unknownEtf = await PMSHoldingsCollection.find({
    securityType: 'UNKNOWN',
    assetClass: 'etf'
  }).countAsync();

  preview.phase3Changes.unknownFund = await PMSHoldingsCollection.find({
    securityType: 'UNKNOWN',
    assetClass: 'fund'
  }).countAsync();

  // Check for non-standard types
  const allTypes = await PMSHoldingsCollection.rawCollection().distinct('securityType');
  for (const type of allTypes) {
    if (type !== null && !isValidSecurityType(type) && !MIGRATION_MAP[type]) {
      const count = await PMSHoldingsCollection.find({ securityType: type }).countAsync();
      preview.nonStandardTypes.push({ type, count });
    }
  }

  // Check remaining null
  preview.remainingNull = await PMSHoldingsCollection.find({
    securityType: null,
    $or: [
      { assetClass: null },
      { assetClass: { $exists: false } }
    ]
  }).countAsync();

  // Log preview results
  console.log('[SECURITY_TYPES_MIGRATION] Preview results:');
  console.log('[SECURITY_TYPES_MIGRATION] Phase 1 - Legacy types to fix:');
  for (const change of preview.phase1Changes) {
    console.log(`[SECURITY_TYPES_MIGRATION]   "${change.from}" -> ${change.to}: ${change.count} records`);
  }
  console.log(`[SECURITY_TYPES_MIGRATION] Phase 2 - Null with assetClass: ${preview.phase2Changes.nullWithAssetClass} records`);
  console.log('[SECURITY_TYPES_MIGRATION] Phase 3 - UNKNOWN with known assetClass:');
  console.log(`[SECURITY_TYPES_MIGRATION]   UNKNOWN + etf: ${preview.phase3Changes.unknownEtf} records`);
  console.log(`[SECURITY_TYPES_MIGRATION]   UNKNOWN + fund: ${preview.phase3Changes.unknownFund} records`);
  if (preview.nonStandardTypes.length > 0) {
    console.log('[SECURITY_TYPES_MIGRATION] Additional non-standard types (not in MIGRATION_MAP):');
    for (const item of preview.nonStandardTypes) {
      console.log(`[SECURITY_TYPES_MIGRATION]   "${item.type}": ${item.count} records`);
    }
  }
  console.log(`[SECURITY_TYPES_MIGRATION] Remaining null (no assetClass): ${preview.remainingNull} records`);

  return preview;
}

// Create Meteor methods to run the migration
if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Preview what the security types migration will do
     */
    async 'admin.previewSecurityTypesMigration'() {
      // Only allow admins/superadmins
      const user = await Meteor.users.findOneAsync(this.userId);
      if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
        throw new Meteor.Error('not-authorized', 'Only administrators can run migrations');
      }

      console.log(`[SECURITY_TYPES_MIGRATION] Preview triggered by user: ${user.username}`);
      return await previewSecurityTypesMigration();
    },

    /**
     * Run the security types normalization migration
     */
    async 'admin.migrateSecurityTypes'() {
      // Only allow admins/superadmins
      const user = await Meteor.users.findOneAsync(this.userId);
      if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
        throw new Meteor.Error('not-authorized', 'Only administrators can run migrations');
      }

      console.log(`[SECURITY_TYPES_MIGRATION] Migration triggered by user: ${user.username}`);
      return await migrateSecurityTypes();
    }
  });
}
