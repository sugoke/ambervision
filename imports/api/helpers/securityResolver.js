/**
 * Security Resolver Service
 *
 * SINGLE SOURCE OF TRUTH for security classification.
 * All security type resolution goes through this service.
 *
 * Flow:
 * 1. Check SecuritiesMetadataCollection for existing classification
 * 2. If not found or not classified, use ISINClassifier (AI + EOD API)
 * 3. Store result in SecuritiesMetadataCollection
 * 4. Return classification
 */

import { Meteor } from 'meteor/meteor';
import { SecuritiesMetadataCollection, SecuritiesMetadataHelpers } from '../securitiesMetadata';
import { ISINClassifierHelpers } from '../isinClassifier';
import { SECURITY_TYPES, ASSET_CLASSES, getAssetClassFromSecurityType } from '../constants/instrumentTypes';
import { validateISIN } from '../../utils/isinValidator';

/**
 * Map asset class to security type
 * Reverse of getAssetClassFromSecurityType
 */
function mapAssetClassToSecurityType(assetClass, securityName = '') {
  const mapping = {
    [ASSET_CLASSES.EQUITY]: SECURITY_TYPES.EQUITY,
    [ASSET_CLASSES.FIXED_INCOME]: SECURITY_TYPES.BOND,
    [ASSET_CLASSES.STRUCTURED_PRODUCT]: SECURITY_TYPES.STRUCTURED_PRODUCT,
    [ASSET_CLASSES.CASH]: SECURITY_TYPES.CASH,
    [ASSET_CLASSES.TIME_DEPOSIT]: SECURITY_TYPES.TERM_DEPOSIT,
    [ASSET_CLASSES.MONETARY_PRODUCTS]: SECURITY_TYPES.MONEY_MARKET,
    [ASSET_CLASSES.DERIVATIVES]: SECURITY_TYPES.OPTION,
    [ASSET_CLASSES.COMMODITIES]: SECURITY_TYPES.COMMODITY,
    [ASSET_CLASSES.PRIVATE_EQUITY]: SECURITY_TYPES.PRIVATE_EQUITY,
    [ASSET_CLASSES.PRIVATE_DEBT]: SECURITY_TYPES.PRIVATE_DEBT,
    [ASSET_CLASSES.OTHER]: SECURITY_TYPES.UNKNOWN
  };

  // Special handling for equity - check if it's ETF or Fund based on name
  if (assetClass === ASSET_CLASSES.EQUITY && securityName) {
    const nameLower = securityName.toLowerCase();
    if (nameLower.includes('etf') || nameLower.includes('ishares') ||
        nameLower.includes('spdr') || nameLower.includes('vanguard')) {
      return SECURITY_TYPES.ETF;
    }
    if (nameLower.includes('fund') || nameLower.includes('sicav') ||
        nameLower.includes('ucits') || nameLower.includes('fcp')) {
      return SECURITY_TYPES.FUND;
    }
  }

  // Special handling for fixed income - check if it's a fund
  if (assetClass === ASSET_CLASSES.FIXED_INCOME && securityName) {
    const nameLower = securityName.toLowerCase();
    if (nameLower.includes('fund') || nameLower.includes('sicav') || nameLower.includes('ucits')) {
      return SECURITY_TYPES.FUND;
    }
  }

  return mapping[assetClass] || SECURITY_TYPES.UNKNOWN;
}

/**
 * Build classification object from SecuritiesMetadata document
 */
function buildClassificationFromMetadata(metadata) {
  return {
    source: 'securities_metadata',
    isin: metadata.isin,
    securityName: metadata.securityName || '',
    securityType: mapAssetClassToSecurityType(metadata.assetClass, metadata.securityName),
    assetClass: metadata.assetClass || '',
    assetSubClass: metadata.assetSubClass || '',
    structuredProductUnderlyingType: metadata.structuredProductUnderlyingType || '',
    structuredProductProtectionType: metadata.structuredProductProtectionType || '',
    structuredProductType: metadata.structuredProductType || '',
    sector: metadata.sector || '',
    issuer: metadata.issuer || '',
    currency: metadata.currency || '',
    listingExchange: metadata.listingExchange || '',
    listingCountry: metadata.listingCountry || '',
    isClassified: metadata.isClassified || false,
    confidence: metadata.classificationConfidence || 100,
    classificationSource: metadata.classificationSource || 'manual'
  };
}

/**
 * Build classification object from ISINClassifier result
 */
function buildClassificationFromAI(isin, result) {
  const data = result.data || {};

  return {
    source: result.source || 'ai_analysis',
    isin: isin,
    securityName: data.securityName || '',
    securityType: mapAssetClassToSecurityType(data.assetClass, data.securityName),
    assetClass: data.assetClass || '',
    assetSubClass: data.assetSubClass || '',
    structuredProductUnderlyingType: data.structuredProductUnderlyingType || '',
    structuredProductProtectionType: data.structuredProductProtectionType || '',
    structuredProductType: data.productType || '',
    sector: data.sector || '',
    issuer: data.issuer || '',
    currency: data.currency || '',
    listingExchange: data.listingExchange || '',
    listingCountry: data.listingCountry || '',
    isClassified: !!data.assetClass,
    confidence: result.confidenceScore || 70,
    classificationSource: result.source || 'ai_analysis'
  };
}

export const SecurityResolver = {
  /**
   * Resolve security classification for a single ISIN
   *
   * @param {string} isin - The ISIN to classify
   * @param {object} hints - Optional hints from bank file (securityName, currency)
   * @returns {Promise<Object>} Classification with securityType, assetClass, etc.
   */
  async resolveSecurityType(isin, hints = {}) {
    if (!isin) {
      console.warn('[SecurityResolver] No ISIN provided');
      return {
        source: 'none',
        isin: null,
        securityType: SECURITY_TYPES.UNKNOWN,
        assetClass: ASSET_CLASSES.OTHER,
        isClassified: false
      };
    }

    // Clean and validate ISIN
    const cleanIsin = isin.trim().toUpperCase().replace(/\s/g, '');

    // Skip validation for non-standard identifiers (some banks use internal codes)
    const validation = validateISIN(cleanIsin);
    if (!validation.valid) {
      console.warn(`[SecurityResolver] Invalid ISIN format: ${cleanIsin} - ${validation.error}`);
      // Return hints-based classification if available
      return {
        source: 'invalid_isin',
        isin: cleanIsin,
        securityName: hints.securityName || '',
        securityType: SECURITY_TYPES.UNKNOWN,
        assetClass: ASSET_CLASSES.OTHER,
        isClassified: false
      };
    }

    console.log(`[SecurityResolver] Resolving: ${cleanIsin}`);

    // STEP 1: Check SecuritiesMetadataCollection
    try {
      const existing = await SecuritiesMetadataCollection.findOneAsync({ isin: cleanIsin });

      if (existing && existing.isClassified && existing.assetClass) {
        console.log(`[SecurityResolver] Found in SecuritiesMetadata: ${cleanIsin} -> ${existing.assetClass}`);
        return buildClassificationFromMetadata(existing);
      }

      if (existing) {
        console.log(`[SecurityResolver] Found in SecuritiesMetadata but not classified: ${cleanIsin}`);
      }
    } catch (error) {
      console.error(`[SecurityResolver] Error checking SecuritiesMetadata: ${error.message}`);
    }

    // STEP 2: Use ISINClassifier (AI + EOD API)
    console.log(`[SecurityResolver] Classifying via ISINClassifier: ${cleanIsin}`);

    try {
      const result = await ISINClassifierHelpers.smartClassify(cleanIsin, hints);
      const classification = buildClassificationFromAI(cleanIsin, result);

      console.log(`[SecurityResolver] ISINClassifier result: ${cleanIsin} -> ${classification.assetClass} (${classification.securityType})`);

      // STEP 3: Store in SecuritiesMetadataCollection
      try {
        await SecuritiesMetadataHelpers.upsertSecurityMetadata({
          isin: cleanIsin,
          securityName: classification.securityName || hints.securityName || '',
          assetClass: classification.assetClass,
          assetSubClass: classification.assetSubClass,
          structuredProductUnderlyingType: classification.structuredProductUnderlyingType,
          structuredProductProtectionType: classification.structuredProductProtectionType,
          structuredProductType: classification.structuredProductType,
          sector: classification.sector,
          issuer: classification.issuer,
          currency: classification.currency || hints.currency || '',
          listingExchange: classification.listingExchange,
          listingCountry: classification.listingCountry,
          isClassified: classification.isClassified,
          classificationSource: classification.classificationSource,
          classificationConfidence: classification.confidence,
          classifiedBy: 'security_resolver',
          classifiedAt: new Date()
        });
        console.log(`[SecurityResolver] Stored classification for: ${cleanIsin}`);
      } catch (storeError) {
        console.error(`[SecurityResolver] Error storing classification: ${storeError.message}`);
      }

      return classification;

    } catch (classifyError) {
      console.error(`[SecurityResolver] Classification failed for ${cleanIsin}: ${classifyError.message}`);

      // Return unknown classification
      return {
        source: 'classification_failed',
        isin: cleanIsin,
        securityName: hints.securityName || '',
        securityType: SECURITY_TYPES.UNKNOWN,
        assetClass: ASSET_CLASSES.OTHER,
        isClassified: false,
        error: classifyError.message
      };
    }
  },

  /**
   * Batch resolve multiple ISINs (for performance)
   *
   * @param {Array<string>} isins - Array of ISINs to classify
   * @param {Map<string, object>} hintsMap - Map of ISIN -> hints
   * @returns {Promise<Map<string, Object>>} Map of ISIN -> classification
   */
  async batchResolveSecurityTypes(isins, hintsMap = new Map()) {
    if (!isins || isins.length === 0) {
      return new Map();
    }

    // Clean and dedupe ISINs
    const cleanIsins = [...new Set(
      isins
        .filter(Boolean)
        .map(isin => isin.trim().toUpperCase().replace(/\s/g, ''))
    )];

    console.log(`[SecurityResolver] Batch resolving ${cleanIsins.length} unique ISINs`);

    const results = new Map();

    // STEP 1: Bulk lookup from SecuritiesMetadataCollection
    try {
      const existingMetadata = await SecuritiesMetadataCollection.find({
        isin: { $in: cleanIsins }
      }).fetchAsync();

      const metadataMap = new Map();
      existingMetadata.forEach(m => {
        if (m.isClassified && m.assetClass) {
          metadataMap.set(m.isin, m);
        }
      });

      console.log(`[SecurityResolver] Found ${metadataMap.size} already classified in SecuritiesMetadata`);

      // Add found classifications to results
      for (const [isin, metadata] of metadataMap) {
        results.set(isin, buildClassificationFromMetadata(metadata));
      }
    } catch (error) {
      console.error(`[SecurityResolver] Bulk lookup error: ${error.message}`);
    }

    // STEP 2: Classify missing ISINs
    const missingIsins = cleanIsins.filter(isin => !results.has(isin));

    if (missingIsins.length > 0) {
      console.log(`[SecurityResolver] Classifying ${missingIsins.length} missing ISINs`);

      // Process in batches to avoid overwhelming the AI API
      const BATCH_SIZE = 5;
      const DELAY_MS = 500; // Delay between batches to avoid rate limiting

      for (let i = 0; i < missingIsins.length; i += BATCH_SIZE) {
        const batch = missingIsins.slice(i, i + BATCH_SIZE);

        // Process batch in parallel
        const batchPromises = batch.map(async (isin) => {
          const hints = hintsMap.get(isin) || {};
          try {
            const classification = await this.resolveSecurityType(isin, hints);
            return { isin, classification };
          } catch (error) {
            console.error(`[SecurityResolver] Failed to classify ${isin}: ${error.message}`);
            return {
              isin,
              classification: {
                source: 'batch_error',
                isin,
                securityName: hints.securityName || '',
                securityType: SECURITY_TYPES.UNKNOWN,
                assetClass: ASSET_CLASSES.OTHER,
                isClassified: false
              }
            };
          }
        });

        const batchResults = await Promise.all(batchPromises);

        for (const { isin, classification } of batchResults) {
          results.set(isin, classification);
        }

        // Add delay between batches (except for last batch)
        if (i + BATCH_SIZE < missingIsins.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }
    }

    console.log(`[SecurityResolver] Batch complete: ${results.size} classifications`);
    return results;
  },

  /**
   * Force reclassify an ISIN (bypasses cache)
   *
   * @param {string} isin - The ISIN to reclassify
   * @param {object} hints - Optional hints
   * @returns {Promise<Object>} New classification
   */
  async forceReclassify(isin, hints = {}) {
    if (!isin) return null;

    const cleanIsin = isin.trim().toUpperCase().replace(/\s/g, '');
    console.log(`[SecurityResolver] Force reclassifying: ${cleanIsin}`);

    try {
      const result = await ISINClassifierHelpers.smartClassify(cleanIsin, hints);
      const classification = buildClassificationFromAI(cleanIsin, result);

      // Update SecuritiesMetadataCollection
      await SecuritiesMetadataHelpers.upsertSecurityMetadata({
        isin: cleanIsin,
        securityName: classification.securityName || hints.securityName || '',
        assetClass: classification.assetClass,
        assetSubClass: classification.assetSubClass,
        structuredProductUnderlyingType: classification.structuredProductUnderlyingType,
        structuredProductProtectionType: classification.structuredProductProtectionType,
        structuredProductType: classification.structuredProductType,
        sector: classification.sector,
        issuer: classification.issuer,
        currency: classification.currency || hints.currency || '',
        listingExchange: classification.listingExchange,
        listingCountry: classification.listingCountry,
        isClassified: classification.isClassified,
        classificationSource: classification.classificationSource,
        classificationConfidence: classification.confidence,
        classifiedBy: 'security_resolver_force',
        classifiedAt: new Date()
      });

      return classification;
    } catch (error) {
      console.error(`[SecurityResolver] Force reclassify failed: ${error.message}`);
      throw error;
    }
  },

  /**
   * Get classification without triggering AI classification
   * Only checks SecuritiesMetadataCollection
   *
   * @param {string} isin - The ISIN to lookup
   * @returns {Promise<Object|null>} Classification or null if not found
   */
  async getExistingClassification(isin) {
    if (!isin) return null;

    const cleanIsin = isin.trim().toUpperCase().replace(/\s/g, '');

    try {
      const metadata = await SecuritiesMetadataCollection.findOneAsync({ isin: cleanIsin });
      if (metadata && metadata.isClassified) {
        return buildClassificationFromMetadata(metadata);
      }
    } catch (error) {
      console.error(`[SecurityResolver] Lookup error: ${error.message}`);
    }

    return null;
  }
};

// Export helper function for use in other modules
export { mapAssetClassToSecurityType };
