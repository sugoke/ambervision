/**
 * Migration Script: Backfill SecuritiesMetadata from PMSHoldings
 *
 * This script populates SecuritiesMetadataCollection with classifications for all
 * existing ISINs in PMSHoldings. This enables the centralized classification system
 * where SecuritiesMetadata is the single source of truth for security types.
 *
 * Process:
 * 1. Collect all unique ISINs from PMSHoldings
 * 2. For each ISIN not already classified in SecuritiesMetadata:
 *    a. Try ISINClassifier.smartClassify() (internal products → AI → EOD API)
 *    b. Store result in SecuritiesMetadata
 * 3. Log progress and results
 *
 * Usage:
 * Run via Meteor method: Meteor.call('admin.backfillSecuritiesMetadata')
 * Preview first: Meteor.call('admin.previewSecuritiesMetadataBackfill')
 *
 * Can be run safely multiple times (idempotent) - already classified ISINs are skipped.
 */

import { Meteor } from 'meteor/meteor';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { SecuritiesMetadataCollection, SecuritiesMetadataHelpers } from '/imports/api/securitiesMetadata';
import { ISINClassifierHelpers } from '/imports/api/isinClassifier';
import { validateISIN } from '/imports/utils/isinValidator';

// Rate limiting settings
const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES_MS = 1000;
const DELAY_BETWEEN_AI_CALLS_MS = 300;

/**
 * Get all unique ISINs from PMSHoldings with their hints
 */
async function getUniqueIsinsFromHoldings() {
  console.log('[BACKFILL] Collecting unique ISINs from PMSHoldings...');

  const holdings = await PMSHoldingsCollection.find(
    { isin: { $exists: true, $ne: null, $ne: '' } },
    {
      fields: {
        isin: 1,
        securityName: 1,
        currency: 1,
        securityType: 1,
        bankName: 1
      }
    }
  ).fetchAsync();

  const uniqueIsins = new Map();

  for (const h of holdings) {
    const isin = (h.isin || '').trim().toUpperCase().replace(/\s/g, '');
    if (!isin) continue;

    // Validate ISIN format
    const validation = validateISIN(isin);
    if (!validation.valid) continue;

    // Keep first occurrence's hints (they're usually the same across holdings)
    if (!uniqueIsins.has(isin)) {
      uniqueIsins.set(isin, {
        securityName: h.securityName || '',
        currency: h.currency || '',
        existingType: h.securityType || '',
        bank: h.bankName || ''
      });
    }
  }

  console.log(`[BACKFILL] Found ${uniqueIsins.size} unique valid ISINs`);
  return uniqueIsins;
}

/**
 * Get ISINs that are already classified in SecuritiesMetadata
 */
async function getAlreadyClassifiedIsins(isins) {
  const existingMetadata = await SecuritiesMetadataCollection.find({
    isin: { $in: isins },
    isClassified: true,
    assetClass: { $exists: true, $ne: null, $ne: '' }
  }, {
    fields: { isin: 1 }
  }).fetchAsync();

  return new Set(existingMetadata.map(m => m.isin));
}

/**
 * Classify a single ISIN and store in SecuritiesMetadata
 */
async function classifyAndStore(isin, hints) {
  try {
    // Try AI classification
    const result = await ISINClassifierHelpers.smartClassify(isin, hints);
    const data = result.data || {};

    // Store in SecuritiesMetadata
    await SecuritiesMetadataHelpers.upsertSecurityMetadata({
      isin: isin,
      securityName: data.securityName || hints.securityName || '',
      assetClass: data.assetClass || '',
      assetSubClass: data.assetSubClass || '',
      structuredProductUnderlyingType: data.structuredProductUnderlyingType || '',
      structuredProductProtectionType: data.structuredProductProtectionType || '',
      structuredProductType: data.productType || '',
      sector: data.sector || '',
      issuer: data.issuer || '',
      currency: data.currency || hints.currency || '',
      listingExchange: data.listingExchange || '',
      listingCountry: data.listingCountry || '',
      isClassified: !!data.assetClass,
      classificationSource: result.source || 'migration',
      classificationConfidence: result.confidenceScore || 70,
      classifiedBy: 'backfill_migration',
      classifiedAt: new Date(),
      notes: `Backfilled on ${new Date().toISOString().split('T')[0]}. Source: ${result.source || 'unknown'}. ${data.notes || ''}`
    });

    return {
      success: true,
      assetClass: data.assetClass,
      source: result.source,
      confidence: result.confidenceScore
    };

  } catch (error) {
    console.error(`[BACKFILL] Failed to classify ${isin}: ${error.message}`);

    // Create unclassified record so we don't retry forever
    try {
      await SecuritiesMetadataHelpers.upsertSecurityMetadata({
        isin: isin,
        securityName: hints.securityName || '',
        currency: hints.currency || '',
        isClassified: false,
        classifiedBy: 'backfill_migration_failed',
        classifiedAt: new Date(),
        notes: `Classification failed: ${error.message}`
      });
    } catch (e) {
      // Ignore insert errors
    }

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Run the backfill migration
 */
export async function runBackfillMigration(options = {}) {
  const { dryRun = false, limit = 0 } = options;

  console.log('[BACKFILL] ====================================');
  console.log('[BACKFILL] Starting SecuritiesMetadata backfill...');
  console.log(`[BACKFILL] Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  if (limit > 0) console.log(`[BACKFILL] Limit: ${limit} ISINs`);
  console.log('[BACKFILL] ====================================');

  const stats = {
    startTime: new Date(),
    totalIsins: 0,
    alreadyClassified: 0,
    newlyClassified: 0,
    classificationFailed: 0,
    bySource: {},
    byAssetClass: {},
    errors: []
  };

  try {
    // Step 1: Get unique ISINs
    const uniqueIsins = await getUniqueIsinsFromHoldings();
    stats.totalIsins = uniqueIsins.size;

    // Step 2: Filter out already classified
    const isinList = Array.from(uniqueIsins.keys());
    const alreadyClassified = await getAlreadyClassifiedIsins(isinList);
    stats.alreadyClassified = alreadyClassified.size;

    // Get ISINs that need classification
    let toClassify = isinList.filter(isin => !alreadyClassified.has(isin));

    // Apply limit if specified
    if (limit > 0 && toClassify.length > limit) {
      toClassify = toClassify.slice(0, limit);
    }

    console.log(`[BACKFILL] Total ISINs: ${stats.totalIsins}`);
    console.log(`[BACKFILL] Already classified: ${stats.alreadyClassified}`);
    console.log(`[BACKFILL] To classify: ${toClassify.length}`);

    if (dryRun) {
      console.log('[BACKFILL] DRY RUN - no changes will be made');

      // Sample some ISINs to show what would be processed
      const sampleSize = Math.min(10, toClassify.length);
      console.log(`[BACKFILL] Sample of ISINs to classify:`);
      for (let i = 0; i < sampleSize; i++) {
        const isin = toClassify[i];
        const hints = uniqueIsins.get(isin);
        console.log(`[BACKFILL]   ${isin}: ${hints.securityName} (${hints.bank})`);
      }

      stats.endTime = new Date();
      stats.durationMs = stats.endTime - stats.startTime;
      return stats;
    }

    // Step 3: Classify in batches
    let processed = 0;

    for (let i = 0; i < toClassify.length; i += BATCH_SIZE) {
      const batch = toClassify.slice(i, i + BATCH_SIZE);
      console.log(`[BACKFILL] Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(toClassify.length / BATCH_SIZE)} (${batch.length} ISINs)`);

      for (const isin of batch) {
        const hints = uniqueIsins.get(isin);

        const result = await classifyAndStore(isin, hints);
        processed++;

        if (result.success) {
          stats.newlyClassified++;

          // Track by source
          const source = result.source || 'unknown';
          stats.bySource[source] = (stats.bySource[source] || 0) + 1;

          // Track by asset class
          const assetClass = result.assetClass || 'unknown';
          stats.byAssetClass[assetClass] = (stats.byAssetClass[assetClass] || 0) + 1;

        } else {
          stats.classificationFailed++;
          stats.errors.push({
            isin,
            error: result.error
          });
        }

        // Progress log every 10 ISINs
        if (processed % 10 === 0) {
          console.log(`[BACKFILL] Progress: ${processed}/${toClassify.length} (${stats.newlyClassified} classified, ${stats.classificationFailed} failed)`);
        }

        // Rate limiting between AI calls
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_AI_CALLS_MS));
      }

      // Delay between batches
      if (i + BATCH_SIZE < toClassify.length) {
        await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
      }
    }

    // Step 4: Log summary
    stats.endTime = new Date();
    stats.durationMs = stats.endTime - stats.startTime;
    stats.durationMinutes = Math.round(stats.durationMs / 1000 / 60 * 10) / 10;

    console.log('[BACKFILL] ====================================');
    console.log('[BACKFILL] Backfill complete!');
    console.log('[BACKFILL] Summary:');
    console.log(`[BACKFILL]   Total ISINs in PMSHoldings: ${stats.totalIsins}`);
    console.log(`[BACKFILL]   Already classified: ${stats.alreadyClassified}`);
    console.log(`[BACKFILL]   Newly classified: ${stats.newlyClassified}`);
    console.log(`[BACKFILL]   Failed: ${stats.classificationFailed}`);
    console.log(`[BACKFILL]   Duration: ${stats.durationMinutes} minutes`);
    console.log('[BACKFILL] By source:');
    for (const [source, count] of Object.entries(stats.bySource)) {
      console.log(`[BACKFILL]     ${source}: ${count}`);
    }
    console.log('[BACKFILL] By asset class:');
    for (const [assetClass, count] of Object.entries(stats.byAssetClass)) {
      console.log(`[BACKFILL]     ${assetClass}: ${count}`);
    }
    if (stats.errors.length > 0) {
      console.log(`[BACKFILL] Errors (${stats.errors.length}):`);
      for (const err of stats.errors.slice(0, 10)) {
        console.log(`[BACKFILL]     ${err.isin}: ${err.error}`);
      }
      if (stats.errors.length > 10) {
        console.log(`[BACKFILL]     ... and ${stats.errors.length - 10} more`);
      }
    }
    console.log('[BACKFILL] ====================================');

    return stats;

  } catch (error) {
    console.error('[BACKFILL] Migration failed:', error);
    stats.fatalError = error.message;
    stats.endTime = new Date();
    stats.durationMs = stats.endTime - stats.startTime;
    throw error;
  }
}

/**
 * Preview what the backfill will do (dry run)
 */
export async function previewBackfillMigration() {
  return await runBackfillMigration({ dryRun: true });
}

// Create Meteor methods to run the migration
if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Preview what the SecuritiesMetadata backfill will do
     */
    async 'admin.previewSecuritiesMetadataBackfill'() {
      const user = await Meteor.users.findOneAsync(this.userId);
      if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
        throw new Meteor.Error('not-authorized', 'Only administrators can run migrations');
      }

      console.log(`[BACKFILL] Preview triggered by user: ${user.username}`);
      return await previewBackfillMigration();
    },

    /**
     * Run the SecuritiesMetadata backfill migration
     */
    async 'admin.backfillSecuritiesMetadata'(options = {}) {
      const user = await Meteor.users.findOneAsync(this.userId);
      if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
        throw new Meteor.Error('not-authorized', 'Only administrators can run migrations');
      }

      console.log(`[BACKFILL] Migration triggered by user: ${user.username}`);
      return await runBackfillMigration(options);
    },

    /**
     * Run backfill for a limited number of ISINs (for testing)
     */
    async 'admin.backfillSecuritiesMetadataLimited'(limit = 10) {
      const user = await Meteor.users.findOneAsync(this.userId);
      if (!user || (user.role !== 'admin' && user.role !== 'superadmin')) {
        throw new Meteor.Error('not-authorized', 'Only administrators can run migrations');
      }

      console.log(`[BACKFILL] Limited migration (${limit}) triggered by user: ${user.username}`);
      return await runBackfillMigration({ limit });
    }
  });
}
