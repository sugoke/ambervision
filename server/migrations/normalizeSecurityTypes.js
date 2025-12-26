/**
 * Migration Script: Normalize Security Types
 *
 * Migrates existing PMSHoldings data to use standardized Ambervision security types.
 *
 * Changes:
 * 1. DEPOSIT -> TERM_DEPOSIT (Andbank legacy)
 * 2. FOREX -> FX_FORWARD (Andbank legacy)
 * 3. MONEY_MARKET_FUND -> MONEY_MARKET (CMB Monaco legacy)
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
  isValidSecurityType
} from '/imports/api/constants/instrumentTypes';

/**
 * Mapping of legacy security types to standardized values
 */
const MIGRATION_MAP = {
  'DEPOSIT': SECURITY_TYPES.TERM_DEPOSIT,
  'FOREX': SECURITY_TYPES.FX_FORWARD,
  'MONEY_MARKET_FUND': SECURITY_TYPES.MONEY_MARKET
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
    errors: []
  };

  try {
    // Process each legacy type
    for (const [oldType, newType] of Object.entries(MIGRATION_MAP)) {
      console.log(`[SECURITY_TYPES_MIGRATION] Processing: ${oldType} -> ${newType}`);

      // Find all records with the old type
      const records = await PMSHoldingsCollection.find({
        securityType: oldType
      }).fetchAsync();

      migrationResults.byType[oldType] = {
        found: records.length,
        updated: 0,
        newType: newType
      };

      if (records.length === 0) {
        console.log(`[SECURITY_TYPES_MIGRATION]   No records found with type: ${oldType}`);
        continue;
      }

      console.log(`[SECURITY_TYPES_MIGRATION]   Found ${records.length} records with type: ${oldType}`);

      // Update all records
      const updateResult = await PMSHoldingsCollection.updateAsync(
        { securityType: oldType },
        {
          $set: {
            securityType: newType,
            updatedAt: new Date(),
            migrationNote: `Security type normalized from ${oldType} to ${newType} on ${new Date().toISOString()}`
          }
        },
        { multi: true }
      );

      migrationResults.byType[oldType].updated = updateResult;
      migrationResults.updatedRecords += updateResult;
      migrationResults.totalProcessed += records.length;

      console.log(`[SECURITY_TYPES_MIGRATION]   Updated ${updateResult} records: ${oldType} -> ${newType}`);
    }

    // Check for any other non-standard security types
    const allTypes = await PMSHoldingsCollection.rawCollection().distinct('securityType');
    const nonStandardTypes = allTypes.filter(type => !isValidSecurityType(type));

    if (nonStandardTypes.length > 0) {
      console.log('[SECURITY_TYPES_MIGRATION] Warning: Found non-standard security types not in migration map:');
      for (const type of nonStandardTypes) {
        const count = await PMSHoldingsCollection.find({ securityType: type }).countAsync();
        console.log(`[SECURITY_TYPES_MIGRATION]   - ${type}: ${count} records`);
        migrationResults.errors.push({
          type: 'non_standard_type',
          value: type,
          count: count,
          message: `Non-standard security type "${type}" not in migration map`
        });
      }
    }

    // Log summary
    console.log('[SECURITY_TYPES_MIGRATION] ====================================');
    console.log('[SECURITY_TYPES_MIGRATION] Migration complete!');
    console.log('[SECURITY_TYPES_MIGRATION] Summary:');
    console.log(`[SECURITY_TYPES_MIGRATION]   Total records processed: ${migrationResults.totalProcessed}`);
    console.log(`[SECURITY_TYPES_MIGRATION]   Total records updated: ${migrationResults.updatedRecords}`);
    console.log('[SECURITY_TYPES_MIGRATION]   By type:');
    for (const [oldType, stats] of Object.entries(migrationResults.byType)) {
      console.log(`[SECURITY_TYPES_MIGRATION]     ${oldType} -> ${stats.newType}: ${stats.updated}/${stats.found} updated`);
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
    changes: [],
    nonStandardTypes: []
  };

  // Check each legacy type
  for (const [oldType, newType] of Object.entries(MIGRATION_MAP)) {
    const count = await PMSHoldingsCollection.find({ securityType: oldType }).countAsync();
    if (count > 0) {
      preview.changes.push({
        from: oldType,
        to: newType,
        count: count
      });
    }
  }

  // Check for non-standard types
  const allTypes = await PMSHoldingsCollection.rawCollection().distinct('securityType');
  for (const type of allTypes) {
    if (!isValidSecurityType(type) && !MIGRATION_MAP[type]) {
      const count = await PMSHoldingsCollection.find({ securityType: type }).countAsync();
      preview.nonStandardTypes.push({ type, count });
    }
  }

  console.log('[SECURITY_TYPES_MIGRATION] Preview results:');
  console.log('[SECURITY_TYPES_MIGRATION] Planned changes:');
  for (const change of preview.changes) {
    console.log(`[SECURITY_TYPES_MIGRATION]   ${change.from} -> ${change.to}: ${change.count} records`);
  }
  if (preview.nonStandardTypes.length > 0) {
    console.log('[SECURITY_TYPES_MIGRATION] Non-standard types (will not be migrated):');
    for (const item of preview.nonStandardTypes) {
      console.log(`[SECURITY_TYPES_MIGRATION]   ${item.type}: ${item.count} records`);
    }
  }

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
