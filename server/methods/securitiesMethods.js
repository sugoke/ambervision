import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { SecuritiesMetadataCollection, SecuritiesMetadataHelpers } from '../../imports/api/securitiesMetadata.js';
import { PMSHoldingsCollection, PMSHoldingsHelpers } from '../../imports/api/pmsHoldings.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { ISINClassifierHelpers } from '../../imports/api/isinClassifier.js';
import { ProductsCollection } from '../../imports/api/products.js';
import { mapAssetClassToSecurityType } from '../../imports/api/helpers/securityResolver.js';
import { detectUnderlyingType } from '../../imports/api/helpers/underlyingTypeDetector.js';

/**
 * Validate session and ensure user is admin
 */
async function validateAdminSession(sessionId) {
  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  if (user.role !== 'admin' && user.role !== 'superadmin') {
    throw new Meteor.Error('not-authorized', 'Admin access required');
  }

  return user;
}

Meteor.methods({
  /**
   * Upsert security metadata (create or update classification)
   */
  async 'securitiesMetadata.upsert'({ isin, classificationData, sessionId }) {
    check(isin, String);
    check(classificationData, Object);
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    console.log(`[SECURITIES_METADATA] Upserting classification for ISIN: ${isin}`);
    console.log(`[SECURITIES_METADATA] Security name in received data: "${classificationData.securityName}"`);

    try {
      // Add user tracking
      const dataToSave = {
        ...classificationData,
        isin,
        classifiedBy: user._id,
        classifiedAt: new Date()
      };

      // Clear assetSubClass for basic asset classes to prevent unwanted sub-grouping in PMS
      // Only structured products and funds should have meaningful assetSubClass values
      const basicAssetClasses = ['fixed_income', 'equity', 'commodity', 'monetary_products', 'alternative', 'private_equity'];
      if (basicAssetClasses.includes(dataToSave.assetClass)) {
        dataToSave.assetSubClass = null;
        console.log(`[SECURITIES_METADATA] Cleared assetSubClass for basic asset class: ${dataToSave.assetClass}`);
      }

      console.log(`[SECURITIES_METADATA] Security name in dataToSave: "${dataToSave.securityName}"`);

      const result = await SecuritiesMetadataHelpers.upsertSecurityMetadata(dataToSave);

      console.log(`[SECURITIES_METADATA] ${result.updated ? 'Updated' : 'Created'} metadata for ${isin}`);

      // Propagate classification changes to all PMSHoldings with this ISIN
      // This ensures that when admin changes classification in SecuritiesBase,
      // all existing holdings are updated to reflect the new classification
      try {
        // Map assetClass to securityType using the same logic as SecurityResolver
        const securityType = mapAssetClassToSecurityType(
          dataToSave.assetClass,
          dataToSave.securityName || ''
        );

        const propagationResult = await PMSHoldingsHelpers.reclassifyByIsin(isin, {
          securityType,
          assetClass: dataToSave.assetClass,
          structuredProductUnderlyingType: dataToSave.structuredProductUnderlyingType,
          structuredProductProtectionType: dataToSave.structuredProductProtectionType,
          classifiedBy: 'admin'
        });
        console.log(`[SECURITIES_METADATA] Propagated classification to ${propagationResult.modifiedCount} PMSHoldings (securityType: ${securityType})`);
      } catch (propError) {
        // Log but don't fail the main operation - metadata saved successfully
        console.error(`[SECURITIES_METADATA] Warning: Failed to propagate to PMSHoldings: ${propError.message}`);
      }

      return {
        success: true,
        isin,
        updated: result.updated
      };

    } catch (error) {
      console.error(`[SECURITIES_METADATA] Upsert failed: ${error.message}`);
      throw new Meteor.Error('upsert-failed', error.message);
    }
  },

  /**
   * Bulk import securities from pmsHoldings collection AND Ambervision products
   * Extracts unique ISINs and creates basic metadata records
   */
  async 'securitiesMetadata.bulkImportFromPMS'({ sessionId }) {
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    console.log(`[SECURITIES_METADATA] Starting bulk import from pmsHoldings and Ambervision products`);

    try {
      // Get all unique securities from pmsHoldings
      const holdings = await PMSHoldingsCollection.find({
        isin: { $exists: true, $nin: [null, ''] }
      }).fetchAsync();

      // Group by ISIN to get unique securities
      const securitiesMap = new Map();

      holdings.forEach(holding => {
        if (!securitiesMap.has(holding.isin)) {
          // Extract enriched data from bankSpecificData if auto-enriched from Ambervision
          const bankData = holding.bankSpecificData || {};
          const isAmbervisionEnriched = bankData.autoEnriched === true;

          securitiesMap.set(holding.isin, {
            isin: holding.isin,
            // Use Ambervision title if enriched, otherwise use bank-provided name
            securityName: isAmbervisionEnriched ? (bankData.ambervisionTitle || holding.securityName) : (holding.securityName || 'Unknown'),
            securityType: holding.securityType || null,
            currency: holding.currency || null,
            // Use classification from PMSHoldings if available (set during enrichment)
            assetClass: holding.assetClass || '',
            // Carry over structured product classification from Ambervision enrichment
            structuredProductType: bankData.productType || null,
            structuredProductUnderlyingType: bankData.structuredProductUnderlyingType || null,
            structuredProductProtectionType: bankData.structuredProductProtectionType || null,
            issuer: bankData.issuer || null,
            capitalGuaranteed100: bankData.capitalGuaranteed100 || false,
            capitalGuaranteedPartial: bankData.capitalGuaranteedPartial || false,
            barrierProtected: bankData.barrierProtected || false,
            sector: '',
            listingExchange: '',
            notes: isAmbervisionEnriched ? 'Auto-classified from Ambervision product database' : ''
          });
        }
      });

      // ALSO import Ambervision products that have ISINs (even if not in PMS holdings)
      const products = await ProductsCollection.find({
        isin: { $exists: true, $nin: [null, ''] }
      }).fetchAsync();

      console.log(`[SECURITIES_METADATA] Found ${products.length} Ambervision products with ISINs`);

      let productsAdded = 0;
      products.forEach(product => {
        if (product.isin && !securitiesMap.has(product.isin)) {
          // Map templateId to structuredProductType
          const templateId = product.templateId || product.template || '';
          const templateLower = templateId.toLowerCase();

          let structuredProductType = 'other';
          if (templateLower.includes('phoenix') || templateLower.includes('autocall')) {
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

          // Determine underlying type
          let underlyingType = 'equity_linked';
          if (product.underlyings && product.underlyings.length > 0) {
            const firstUnderlying = product.underlyings[0];
            const ticker = firstUnderlying.ticker || firstUnderlying.symbol || '';
            if (ticker.includes('.BOND') || ticker.includes('BOND')) {
              underlyingType = 'fixed_income_linked';
            } else if (ticker.includes('.COMM') || ticker.includes('GOLD') || ticker.includes('OIL')) {
              underlyingType = 'commodities_linked';
            }
          }

          // Determine protection type
          let protectionType = 'capital_protected_conditional';
          if (product.capitalProtection === 100) {
            protectionType = 'capital_guaranteed_100';
          } else if (product.capitalProtection && product.capitalProtection > 0) {
            protectionType = 'capital_guaranteed_partial';
          }

          securitiesMap.set(product.isin, {
            isin: product.isin,
            securityName: product.title || `Structured Product ${product.isin}`,
            securityType: 'STRUCTURED_PRODUCT',
            currency: product.currency || null,
            assetClass: 'structured_product',
            structuredProductType: structuredProductType,
            structuredProductUnderlyingType: underlyingType,
            structuredProductProtectionType: protectionType,
            issuer: product.issuer || null,
            capitalGuaranteed100: protectionType === 'capital_guaranteed_100',
            capitalGuaranteedPartial: protectionType === 'capital_guaranteed_partial',
            barrierProtected: protectionType === 'capital_protected_conditional',
            sector: '',
            listingExchange: '',
            notes: `Auto-imported from Ambervision product (Template: ${templateId})`,
            sourceProductId: product._id,
            autoCreatedFromProduct: true
          });
          productsAdded++;
        }
      });

      console.log(`[SECURITIES_METADATA] Added ${productsAdded} additional products from Ambervision`);

      console.log(`[SECURITIES_METADATA] Found ${securitiesMap.size} unique securities`);

      let newCount = 0;
      let existingCount = 0;
      let updatedCount = 0;
      let errorCount = 0;
      const errors = [];

      // Import each security
      for (const [isin, securityData] of securitiesMap) {
        try {
          // Check if already exists
          const existing = await SecuritiesMetadataCollection.findOneAsync({ isin });

          if (!existing) {
            await SecuritiesMetadataCollection.insertAsync({
              ...securityData,
              isClassified: securityData.assetClass ? true : false,
              classifiedBy: securityData.assetClass ? 'system' : null,
              classifiedAt: securityData.assetClass ? new Date() : null,
              version: 1,
              createdAt: new Date(),
              updatedAt: new Date()
            });
            newCount++;
          } else {
            // Update existing unclassified securities with Ambervision data
            // Only update if: 1) existing is not classified, and 2) new data has classification
            const shouldUpdate = !existing.isClassified && securityData.assetClass;

            if (shouldUpdate) {
              await SecuritiesMetadataCollection.updateAsync(
                { _id: existing._id },
                {
                  $set: {
                    securityName: securityData.securityName,
                    assetClass: securityData.assetClass,
                    structuredProductType: securityData.structuredProductType,
                    structuredProductUnderlyingType: securityData.structuredProductUnderlyingType,
                    structuredProductProtectionType: securityData.structuredProductProtectionType,
                    issuer: securityData.issuer,
                    capitalGuaranteed100: securityData.capitalGuaranteed100,
                    capitalGuaranteedPartial: securityData.capitalGuaranteedPartial,
                    barrierProtected: securityData.barrierProtected,
                    notes: securityData.notes,
                    isClassified: true,
                    classifiedBy: 'system',
                    classifiedAt: new Date(),
                    updatedAt: new Date()
                  },
                  $inc: { version: 1 }
                }
              );
              updatedCount++;
              console.log(`[SECURITIES_METADATA] Updated ${isin} with Ambervision classification`);
            } else {
              existingCount++;
            }
          }
        } catch (error) {
          console.error(`[SECURITIES_METADATA] Error importing ${isin}: ${error.message}`);
          errors.push({
            isin,
            error: error.message
          });
          errorCount++;
        }
      }

      console.log(
        `[SECURITIES_METADATA] Import complete: ` +
        `${newCount} new, ${updatedCount} updated, ${existingCount} unchanged, ${errorCount} errors`
      );

      return {
        success: true,
        totalFound: securitiesMap.size,
        newSecurities: newCount,
        updatedSecurities: updatedCount,
        existingSecurities: existingCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error(`[SECURITIES_METADATA] Bulk import failed: ${error.message}`);
      throw new Meteor.Error('import-failed', error.message);
    }
  },

  /**
   * Delete security metadata
   */
  async 'securitiesMetadata.delete'({ isin, sessionId }) {
    check(isin, String);
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    console.log(`[SECURITIES_METADATA] Deleting metadata for ISIN: ${isin}`);

    try {
      await SecuritiesMetadataHelpers.deleteSecurityMetadata(isin);

      console.log(`[SECURITIES_METADATA] Deleted metadata for ${isin}`);

      return {
        success: true,
        isin
      };

    } catch (error) {
      console.error(`[SECURITIES_METADATA] Delete failed: ${error.message}`);
      throw new Meteor.Error('delete-failed', error.message);
    }
  },

  /**
   * Get security metadata by ISIN
   */
  async 'securitiesMetadata.get'({ isin, sessionId }) {
    check(isin, String);
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    return await SecuritiesMetadataHelpers.getSecurityMetadata(isin);
  },

  /**
   * Search securities
   */
  async 'securitiesMetadata.search'({ searchTerm, sessionId }) {
    check(searchTerm, String);
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    return await SecuritiesMetadataHelpers.searchSecurities(searchTerm);
  },

  /**
   * Get statistics
   */
  async 'securitiesMetadata.getStatistics'({ sessionId }) {
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    return await SecuritiesMetadataHelpers.getStatistics();
  },

  /**
   * Smart ISIN Classification
   * Uses three-tier lookup: Internal products → AI → Online databases
   */
  async 'securitiesMetadata.smartClassify'({ isin, existingData = {}, sessionId }) {
    // Log received parameters for debugging
    console.log('[SECURITIES_METADATA] Smart classify params:', {
      isin: isin,
      isinType: typeof isin,
      existingData: existingData,
      existingDataType: typeof existingData,
      sessionId: sessionId,
      sessionIdType: typeof sessionId
    });

    // Validate required parameters
    if (!isin) {
      throw new Meteor.Error('missing-isin', 'ISIN is required');
    }

    if (!sessionId) {
      throw new Meteor.Error('missing-session', 'Session ID is required. Please log in again.');
    }

    try {
      check(isin, String);
      check(existingData, Match.Maybe(Object));
      check(sessionId, String);
    } catch (checkError) {
      console.error('[SECURITIES_METADATA] Parameter validation failed:', checkError);
      throw new Meteor.Error('invalid-parameters', `Parameter validation failed: ${checkError.message}`);
    }

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    console.log(`[SECURITIES_METADATA] Smart classification requested for ISIN: ${isin}`);

    try {
      const result = await ISINClassifierHelpers.smartClassify(isin, existingData || {});

      console.log(
        `[SECURITIES_METADATA] Classification complete - Source: ${result.source}, ` +
        `Confidence: ${result.confidence} (${result.confidenceScore}%)`
      );

      return {
        success: true,
        isin,
        source: result.source,
        confidence: result.confidence,
        confidenceScore: result.confidenceScore,
        data: result.data,
        explanation: result.explanation
      };

    } catch (error) {
      console.error(`[SECURITIES_METADATA] Smart classification failed: ${error.message}`);
      throw new Meteor.Error('classification-failed', error.message);
    }
  },

  /**
   * Bulk classify securities from Ambervision structured products database
   * Then uses AI to classify remaining ISINs (stocks, bonds, funds)
   * Matches ISINs and auto-fills product name, issuer, and classification based on template type
   */
  async 'securitiesMetadata.bulkClassifyFromAmbervision'({ sessionId, useAIForUnmatched = true, overrideExisting = false }) {
    check(sessionId, String);
    check(useAIForUnmatched, Match.Optional(Boolean));
    check(overrideExisting, Match.Optional(Boolean));

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    console.log(`[SECURITIES_METADATA] Starting bulk classification from Ambervision products (AI fallback: ${useAIForUnmatched}, override existing: ${overrideExisting})`);

    try {
      // Get all securities with ISINs
      const securities = await SecuritiesMetadataCollection.find({
        isin: { $exists: true, $nin: [null, ''] }
      }).fetchAsync();

      console.log(`[SECURITIES_METADATA] Found ${securities.length} securities to check`);

      // Get all products with ISINs from Ambervision database
      const products = await ProductsCollection.find({
        isin: { $exists: true, $nin: [null, ''] }
      }).fetchAsync();

      console.log(`[SECURITIES_METADATA] Found ${products.length} Ambervision products`);

      // Build lookup map by ISIN
      const productsByIsin = new Map();
      products.forEach(product => {
        if (product.isin) {
          productsByIsin.set(product.isin.toUpperCase(), product);
        }
      });

      let matchedCount = 0;
      let updatedCount = 0;
      let aiClassifiedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const errors = [];
      const unmatchedSecurities = [];

      // Process each security - Phase 1: Ambervision matching
      for (const security of securities) {
        try {
          // Skip already classified securities unless overrideExisting is true
          if (security.isClassified && !overrideExisting) {
            skippedCount++;
            continue;
          }

          // Safety check for null/undefined isin
          if (!security.isin) {
            skippedCount++;
            continue;
          }

          const isin = security.isin.toUpperCase();
          const product = productsByIsin.get(isin);

          if (!product) {
            // Collect for AI classification if enabled (only if not already classified or override is enabled)
            if (useAIForUnmatched && (!security.isClassified || overrideExisting)) {
              unmatchedSecurities.push(security);
            } else {
              skippedCount++;
            }
            continue;
          }

          matchedCount++;

          // Determine classification based on template type and actual product data
          const templateType = product.templateId?.toLowerCase() || '';
          const structureParams = product.structureParams || product.structureParameters || {};
          const structure = product.structure || {};

          let assetClass = 'structured_product';
          // Default to equity_linked (most common) - will be overridden if we can determine from underlyings
          let underlyingType = 'equity_linked';
          // Default to conditional protection - will be overridden based on template type
          let protectionType = 'capital_protected_conditional';
          // Initialize to 'other' - will be set based on template matching
          let productType = 'other';

          // Determine underlying type from product underlyings
          if (product.underlyings && product.underlyings.length > 0) {
            // Analyze underlyings to determine type
            const underlyingTypes = product.underlyings.map(u => {
              const name = (u.name || '').toLowerCase();
              const type = (u.type || '').toLowerCase();
              const ticker = (u.ticker || u.symbol || '').toUpperCase();

              // Check for commodities
              if (name.includes('gold') || name.includes('silver') || name.includes('oil') ||
                  name.includes('copper') || ticker === 'GC' || ticker === 'SI' || ticker === 'CL') {
                return 'commodities_linked';
              }
              // Check for bonds/fixed income
              if (name.includes('bond') || name.includes('treasury') || type === 'bond' || type === 'fixed_income') {
                return 'fixed_income_linked';
              }
              // Check for credit
              if (name.includes('credit') || name.includes('cds')) {
                return 'credit_linked';
              }
              // Default to equity (most common)
              return 'equity_linked';
            });

            // Use the first detected type (most common is equity_linked anyway)
            underlyingType = underlyingTypes[0] || 'equity_linked';
          }

          // Determine protection type AND product type based on template
          // Use includes() to match template variants like "orion_memory", "phoenix_autocall", etc.
          if (templateType.includes('orion')) {
            productType = 'orion';
            // Orion: Check if capitalGuaranteed is 100%
            const orionCapitalGuaranteed = structureParams.capitalGuaranteed ?? structure.capitalGuaranteed ?? 100;
            if (orionCapitalGuaranteed >= 100) {
              protectionType = 'capital_guaranteed_100';
            } else if (orionCapitalGuaranteed > 0) {
              protectionType = 'capital_guaranteed_partial';
            } else {
              protectionType = 'capital_protected_conditional';
            }
          } else if (templateType.includes('phoenix') || templateType.includes('autocall')) {
            productType = 'phoenix';
            // Phoenix/Autocallable: Conditional protection via barrier
            protectionType = 'capital_protected_conditional';
          } else if (templateType.includes('himalaya')) {
            productType = 'himalaya';
            // Himalaya: Check floor level for protection type
            const himalayaFloor = structureParams.floor ?? structureParams.floorLevel ?? structure.floor ?? 100;
            if (himalayaFloor >= 100) {
              protectionType = 'capital_guaranteed_100';
            } else if (himalayaFloor > 0) {
              protectionType = 'capital_protected_conditional';
            }
          } else if (templateType.includes('participation')) {
            productType = 'participation_note';
            // Participation notes: Check for capital guarantee
            const participationGuarantee = structureParams.capitalGuarantee ??
                                           structureParams.protectionBarrier ??
                                           structureParams.capitalProtection ??
                                           structure.capitalProtection ?? 0;
            if (participationGuarantee >= 100) {
              protectionType = 'capital_guaranteed_100';
            } else if (participationGuarantee > 0) {
              protectionType = 'capital_protected_conditional';
            } else {
              protectionType = 'other_protection'; // No protection
            }
          } else if (templateType.includes('reverse')) {
            productType = 'reverse_convertible';
            // Reverse convertibles: Conditional protection via barrier
            protectionType = 'capital_protected_conditional';
          } else if (templateType.includes('shark')) {
            productType = 'shark_note';
            // Shark notes: Conditional protection
            protectionType = 'capital_protected_conditional';
          } else {
            // Unknown template: Check for any protection level in structure
            productType = templateType || 'other';
            const genericProtection = structureParams.capitalGuarantee ??
                                      structureParams.protectionBarrier ??
                                      structureParams.capitalProtection ?? 0;
            if (genericProtection >= 100) {
              protectionType = 'capital_guaranteed_100';
            } else if (genericProtection > 0) {
              protectionType = 'capital_protected_conditional';
            }
          }

          // Prepare classification data
          const classificationData = {
            isin: security.isin,
            securityName: product.title || security.securityName,
            assetClass,
            assetSubClass: underlyingType || null,
            structuredProductType: productType || null,
            structuredProductUnderlyingType: underlyingType || null,
            structuredProductProtectionType: protectionType || null,
            issuer: product.issuer || null,
            notes: security.notes
              ? `${security.notes}\n\nAuto-classified from Ambervision (Template: ${templateType})`
              : `Auto-classified from Ambervision (Template: ${templateType})`,
            classifiedBy: user._id,
            classifiedAt: new Date()
          };

          // Update security metadata
          await SecuritiesMetadataHelpers.upsertSecurityMetadata(classificationData);
          updatedCount++;

          console.log(
            `[SECURITIES_METADATA] Classified ${isin}: ${templateType} → ` +
            `${assetClass}${underlyingType ? ` / ${underlyingType}` : ''}${protectionType ? ` / ${protectionType}` : ''}`
          );

        } catch (error) {
          console.error(`[SECURITIES_METADATA] Error classifying ${security.isin}: ${error.message}`);
          errors.push({
            isin: security.isin,
            error: error.message
          });
          errorCount++;
        }
      }

      // Phase 2: AI Classification for unmatched securities
      if (useAIForUnmatched && unmatchedSecurities.length > 0) {
        console.log(`[SECURITIES_METADATA] Starting AI classification for ${unmatchedSecurities.length} unmatched securities`);

        for (const security of unmatchedSecurities) {
          try {
            // Use AI to classify this security
            console.log(`[SECURITIES_METADATA] AI classifying ${security.isin} (${security.securityName})`);

            const aiResult = await ISINClassifierHelpers.smartClassify(security.isin, {
              securityName: security.securityName,
              securityType: security.securityType,
              currency: security.currency
            });

            if (aiResult && aiResult.data) {
              // Prepare classification data from AI result
              const classificationData = {
                isin: security.isin,
                securityName: aiResult.data.securityName || security.securityName,
                assetClass: aiResult.data.assetClass || '',
                assetSubClass: aiResult.data.assetSubClass || null,
                structuredProductUnderlyingType: aiResult.data.structuredProductUnderlyingType || null,
                structuredProductProtectionType: aiResult.data.structuredProductProtectionType || null,
                sector: aiResult.data.sector || null,
                listingExchange: aiResult.data.listingExchange || null,
                issuer: aiResult.data.issuer || null,
                notes: security.notes
                  ? `${security.notes}\n\nAI-classified (${aiResult.source}, confidence: ${aiResult.confidence}): ${aiResult.explanation}`
                  : `AI-classified (${aiResult.source}, confidence: ${aiResult.confidence}): ${aiResult.explanation}`,
                classifiedBy: user._id,
                classifiedAt: new Date()
              };

              // Update security metadata
              await SecuritiesMetadataHelpers.upsertSecurityMetadata(classificationData);
              aiClassifiedCount++;
              updatedCount++;

              console.log(
                `[SECURITIES_METADATA] AI classified ${security.isin}: ${aiResult.data.assetClass} ` +
                `(confidence: ${aiResult.confidence}, source: ${aiResult.source})`
              );
            } else {
              skippedCount++;
              console.log(`[SECURITIES_METADATA] AI classification returned no data for ${security.isin}`);
            }

          } catch (error) {
            console.error(`[SECURITIES_METADATA] AI classification error for ${security.isin}: ${error.message}`);
            errors.push({
              isin: security.isin,
              error: `AI classification failed: ${error.message}`
            });
            errorCount++;
            skippedCount++;
          }

          // Add small delay between AI calls to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      console.log(
        `[SECURITIES_METADATA] Bulk classification complete: ` +
        `${matchedCount} Ambervision matched, ${aiClassifiedCount} AI classified, ` +
        `${updatedCount} total updated, ${skippedCount} skipped, ${errorCount} errors`
      );

      return {
        success: true,
        totalSecurities: securities.length,
        totalProducts: products.length,
        matchedCount,
        aiClassifiedCount,
        updatedCount,
        skippedCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error(`[SECURITIES_METADATA] Bulk classification failed: ${error.message}`);
      throw new Meteor.Error('bulk-classification-failed', error.message);
    }
  },

  /**
   * Bulk classify securities using AI ONLY (skip Ambervision lookup)
   * Classifies securities that are NOT in Ambervision products database
   */
  async 'securitiesMetadata.bulkClassifyAIOnly'({ sessionId }) {
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    console.log(`[SECURITIES_METADATA] Starting AI-only bulk classification (non-Ambervision securities)`);

    try {
      // Get all unclassified securities (using $ne: true to match false, null, undefined)
      // Use $nin to properly exclude both null and empty string (duplicate $ne keys don't work in JS objects)
      const unclassifiedSecurities = await SecuritiesMetadataCollection.find({
        isin: { $exists: true, $nin: [null, ''] },
        isClassified: { $ne: true }
      }).fetchAsync();

      console.log(`[SECURITIES_METADATA] Found ${unclassifiedSecurities.length} unclassified securities`);

      // Get all Ambervision product ISINs to exclude
      // Use $nin to properly exclude both null and empty string (duplicate $ne keys don't work in JS objects)
      const ambervisionProducts = await ProductsCollection.find({
        isin: { $exists: true, $nin: [null, ''] }
      }, { fields: { isin: 1 } }).fetchAsync();

      const ambervisionISINs = new Set(
        ambervisionProducts.filter(p => p.isin).map(p => p.isin.toUpperCase())
      );

      console.log(`[SECURITIES_METADATA] Excluding ${ambervisionISINs.size} Ambervision ISINs`);

      // Filter out securities that exist in Ambervision (also filter out any with null/empty isin as safety)
      const securitiesToClassify = unclassifiedSecurities.filter(
        s => s.isin && !ambervisionISINs.has(s.isin.toUpperCase())
      );

      console.log(`[SECURITIES_METADATA] ${securitiesToClassify.length} securities to classify via AI`);

      let aiClassifiedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;
      const errors = [];

      // Process each security with AI
      for (const security of securitiesToClassify) {
        try {
          console.log(`[SECURITIES_METADATA] AI classifying ${security.isin} (${security.securityName})`);

          const aiResult = await ISINClassifierHelpers.smartClassify(security.isin, {
            securityName: security.securityName,
            securityType: security.securityType,
            currency: security.currency
          });

          if (aiResult && aiResult.data) {
            // Prepare classification data from AI result
            const classificationData = {
              isin: security.isin,
              securityName: aiResult.data.securityName || security.securityName,
              assetClass: aiResult.data.assetClass || '',
              assetSubClass: aiResult.data.assetSubClass || null,
              structuredProductUnderlyingType: aiResult.data.structuredProductUnderlyingType || null,
              structuredProductProtectionType: aiResult.data.structuredProductProtectionType || null,
              sector: aiResult.data.sector || null,
              listingExchange: aiResult.data.listingExchange || null,
              issuer: aiResult.data.issuer || null,
              notes: security.notes
                ? `${security.notes}\n\nAI-classified (${aiResult.source}, confidence: ${aiResult.confidence}): ${aiResult.explanation}`
                : `AI-classified (${aiResult.source}, confidence: ${aiResult.confidence}): ${aiResult.explanation}`,
              classifiedBy: user._id,
              classifiedAt: new Date()
            };

            // Update security metadata
            await SecuritiesMetadataHelpers.upsertSecurityMetadata(classificationData);
            aiClassifiedCount++;

            console.log(
              `[SECURITIES_METADATA] AI classified ${security.isin}: ${aiResult.data.assetClass} ` +
              `(confidence: ${aiResult.confidence}, source: ${aiResult.source})`
            );
          } else {
            skippedCount++;
            console.log(`[SECURITIES_METADATA] AI classification returned no data for ${security.isin}`);
          }

        } catch (error) {
          console.error(`[SECURITIES_METADATA] AI classification error for ${security.isin}: ${error.message}`);
          errors.push({
            isin: security.isin,
            error: `AI classification failed: ${error.message}`
          });
          errorCount++;
        }

        // Add small delay between AI calls to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      console.log(
        `[SECURITIES_METADATA] AI-only bulk classification complete: ` +
        `${aiClassifiedCount} classified, ${skippedCount} skipped, ${errorCount} errors`
      );

      return {
        success: true,
        totalUnclassified: unclassifiedSecurities.length,
        excludedAmbervision: ambervisionISINs.size,
        toClassify: securitiesToClassify.length,
        aiClassifiedCount,
        skippedCount,
        errorCount,
        errors: errors.length > 0 ? errors : undefined
      };

    } catch (error) {
      console.error(`[SECURITIES_METADATA] AI-only bulk classification failed: ${error.message}`);
      throw new Meteor.Error('ai-classification-failed', error.message);
    }
  },

  /**
   * Get list of securities that can be classified from Ambervision
   * Returns array of { isin, securityName, productTitle } for progress tracking
   */
  async 'securitiesMetadata.getSecuritiesToClassifyFromAmbervision'({ sessionId, overrideExisting = false }) {
    check(sessionId, String);
    check(overrideExisting, Match.Optional(Boolean));

    await validateAdminSession(sessionId);

    // Get all securities with ISINs
    const query = {
      isin: { $exists: true, $nin: [null, ''] }
    };

    // If not overriding, only get unclassified
    if (!overrideExisting) {
      query.isClassified = { $ne: true };
    }

    const securities = await SecuritiesMetadataCollection.find(query).fetchAsync();

    // Get all products with ISINs from Ambervision database
    const products = await ProductsCollection.find({
      isin: { $exists: true, $nin: [null, ''] }
    }).fetchAsync();

    // Build lookup map by ISIN
    const productsByIsin = new Map();
    products.forEach(product => {
      if (product.isin) {
        productsByIsin.set(product.isin.toUpperCase(), product);
      }
    });

    // Filter securities that have matching Ambervision products (with null safety check)
    const securitiesToClassify = securities
      .filter(s => s.isin && productsByIsin.has(s.isin.toUpperCase()))
      .map(s => {
        const product = productsByIsin.get(s.isin.toUpperCase());
        return {
          isin: s.isin,
          securityName: s.securityName,
          productTitle: product.title || product.isin
        };
      });

    return {
      securities: securitiesToClassify,
      total: securitiesToClassify.length
    };
  },

  /**
   * Classify a single security from Ambervision product
   * Used for progress-tracked classification
   */
  async 'securitiesMetadata.classifySingleFromAmbervision'({ sessionId, isin }) {
    check(sessionId, String);
    check(isin, String);

    const user = await validateAdminSession(sessionId);

    // Get the security
    const security = await SecuritiesMetadataCollection.findOneAsync({
      isin: { $regex: new RegExp(`^${isin}$`, 'i') }
    });

    if (!security) {
      throw new Meteor.Error('not-found', `Security not found: ${isin}`);
    }

    // Get the matching Ambervision product
    const product = await ProductsCollection.findOneAsync({
      isin: { $regex: new RegExp(`^${isin}$`, 'i') }
    });

    if (!product) {
      throw new Meteor.Error('not-found', `Ambervision product not found: ${isin}`);
    }

    // Determine classification based on template type and actual product data
    const templateType = product.templateId?.toLowerCase() || '';
    const structureParams = product.structureParams || product.structureParameters || {};
    const structure = product.structure || {};

    let assetClass = 'structured_product';
    // Default to equity_linked (most common) - will be overridden if we can determine from underlyings
    let underlyingType = 'equity_linked';
    // Default to conditional protection - will be overridden based on template type
    let protectionType = 'capital_protected_conditional';
    // Initialize to 'other' - will be set based on template matching
    let productType = 'other';

    // Determine underlying type from product underlyings
    if (product.underlyings && product.underlyings.length > 0) {
      // Analyze underlyings to determine type
      const underlyingTypes = product.underlyings.map(u => {
        const name = (u.name || '').toLowerCase();
        const type = (u.type || '').toLowerCase();
        const ticker = (u.ticker || u.symbol || '').toUpperCase();

        // Check for commodities
        if (name.includes('gold') || name.includes('silver') || name.includes('oil') ||
            name.includes('copper') || ticker === 'GC' || ticker === 'SI' || ticker === 'CL') {
          return 'commodities_linked';
        }
        // Check for bonds/fixed income
        if (name.includes('bond') || name.includes('treasury') || type === 'bond' || type === 'fixed_income') {
          return 'fixed_income_linked';
        }
        // Check for credit
        if (name.includes('credit') || name.includes('cds')) {
          return 'credit_linked';
        }
        // Default to equity (most common)
        return 'equity_linked';
      });

      // Use the first detected type (most common is equity_linked anyway)
      underlyingType = underlyingTypes[0] || 'equity_linked';
    }

    // Determine protection type AND product type based on template
    // Use includes() to match template variants like "orion_memory", "phoenix_autocall", etc.
    if (templateType.includes('orion')) {
      productType = 'orion';
      // Orion: Check if capitalGuaranteed is 100%
      const orionCapitalGuaranteed = structureParams.capitalGuaranteed ?? structure.capitalGuaranteed ?? 100;
      if (orionCapitalGuaranteed >= 100) {
        protectionType = 'capital_guaranteed_100';
      } else if (orionCapitalGuaranteed > 0) {
        protectionType = 'capital_guaranteed_partial';
      } else {
        protectionType = 'capital_protected_conditional';
      }
    } else if (templateType.includes('phoenix') || templateType.includes('autocall')) {
      productType = 'phoenix';
      // Phoenix/Autocallable: Conditional protection via barrier
      protectionType = 'capital_protected_conditional';
    } else if (templateType.includes('himalaya')) {
      productType = 'himalaya';
      // Himalaya: Check floor level for protection type
      const himalayaFloor = structureParams.floor ?? structureParams.floorLevel ?? structure.floor ?? 100;
      if (himalayaFloor >= 100) {
        protectionType = 'capital_guaranteed_100';
      } else if (himalayaFloor > 0) {
        protectionType = 'capital_protected_conditional';
      }
    } else if (templateType.includes('participation')) {
      productType = 'participation_note';
      // Participation notes: Check for capital guarantee
      const participationGuarantee = structureParams.capitalGuarantee ??
                                     structureParams.protectionBarrier ??
                                     structureParams.capitalProtection ??
                                     structure.capitalProtection ?? 0;
      if (participationGuarantee >= 100) {
        protectionType = 'capital_guaranteed_100';
      } else if (participationGuarantee > 0) {
        protectionType = 'capital_protected_conditional';
      } else {
        protectionType = 'other_protection'; // No protection
      }
    } else if (templateType.includes('reverse')) {
      productType = 'reverse_convertible';
      // Reverse convertibles: Conditional protection via barrier
      protectionType = 'capital_protected_conditional';
    } else if (templateType.includes('shark')) {
      productType = 'shark_note';
      // Shark notes: Conditional protection
      protectionType = 'capital_protected_conditional';
    } else {
      // Unknown template: Check for any protection level in structure
      productType = templateType || 'other';
      const genericProtection = structureParams.capitalGuarantee ??
                                structureParams.protectionBarrier ??
                                structureParams.capitalProtection ?? 0;
      if (genericProtection >= 100) {
        protectionType = 'capital_guaranteed_100';
      } else if (genericProtection > 0) {
        protectionType = 'capital_protected_conditional';
      }
    }

    // Prepare classification data
    const classificationData = {
      isin: security.isin,
      securityName: product.title || security.securityName,
      assetClass,
      assetSubClass: underlyingType || null,
      structuredProductType: productType || null,
      structuredProductUnderlyingType: underlyingType || null,
      structuredProductProtectionType: protectionType || null,
      issuer: product.issuer || null,
      notes: security.notes
        ? `${security.notes}\n\nAuto-classified from Ambervision (Template: ${templateType})`
        : `Auto-classified from Ambervision (Template: ${templateType})`,
      classifiedBy: user._id,
      classifiedAt: new Date()
    };

    // Update security metadata
    await SecuritiesMetadataHelpers.upsertSecurityMetadata(classificationData);

    return {
      success: true,
      isin,
      productTitle: product.title,
      templateType,
      productType,
      assetClass,
      protectionType
    };
  },

  /**
   * Re-enrich structured products in SecuritiesMetadata from Ambervision products
   *
   * This method finds all structured products in SecuritiesMetadata that are missing
   * or have incorrect `structuredProductUnderlyingType` and updates them by looking
   * up the matching Ambervision product.
   *
   * Use case: After bank sync, structured products may appear as "Alternative" instead
   * of "Equities" because structuredProductUnderlyingType is not set. This method
   * fixes that by extracting underlying type from the Ambervision product data.
   *
   * @param {Object} options
   * @param {string} options.sessionId - Admin session ID (optional for server-side calls)
   * @param {boolean} options.forceUpdate - Update even if structuredProductUnderlyingType is already set
   * @returns {Object} - Summary of enrichment results
   */
  async 'securitiesMetadata.enrichFromProducts'({ sessionId, forceUpdate = false } = {}) {
    // Allow server-side calls without sessionId (e.g., from cron jobs)
    if (sessionId) {
      check(sessionId, String);
      await validateAdminSession(sessionId);
    }

    console.log(`[SECURITIES_METADATA] Starting re-enrichment from Ambervision products (forceUpdate: ${forceUpdate})`);

    try {
      // Build query for structured products
      const query = {
        assetClass: 'structured_product'
      };

      // If not forcing update, only get those missing structuredProductUnderlyingType
      if (!forceUpdate) {
        query.$or = [
          { structuredProductUnderlyingType: { $exists: false } },
          { structuredProductUnderlyingType: null },
          { structuredProductUnderlyingType: '' }
        ];
      }

      const structuredProducts = await SecuritiesMetadataCollection.find(query).fetchAsync();

      console.log(`[SECURITIES_METADATA] Found ${structuredProducts.length} structured products to check`);

      if (structuredProducts.length === 0) {
        return {
          success: true,
          totalChecked: 0,
          enriched: 0,
          skipped: 0,
          noProduct: 0,
          errors: 0
        };
      }

      // Get all Ambervision products with ISINs for matching
      const ambervisionProducts = await ProductsCollection.find({
        isin: { $exists: true, $nin: [null, ''] }
      }).fetchAsync();

      // Build lookup map by ISIN (case-insensitive)
      const productsByIsin = new Map();
      ambervisionProducts.forEach(product => {
        if (product.isin) {
          productsByIsin.set(product.isin.toUpperCase(), product);
        }
      });

      console.log(`[SECURITIES_METADATA] Loaded ${productsByIsin.size} Ambervision products for matching`);

      let enriched = 0;
      let skipped = 0;
      let noProduct = 0;
      let errors = 0;

      for (const security of structuredProducts) {
        try {
          if (!security.isin) {
            skipped++;
            continue;
          }

          // Find matching Ambervision product
          const product = productsByIsin.get(security.isin.toUpperCase());

          if (!product) {
            // No matching Ambervision product - skip
            noProduct++;
            continue;
          }

          // Detect underlying type using shared utility
          const underlyingType = detectUnderlyingType(product.underlyings);

          // Check if update is needed
          if (!forceUpdate && security.structuredProductUnderlyingType === underlyingType) {
            skipped++;
            continue;
          }

          // Update the security metadata
          await SecuritiesMetadataCollection.updateAsync(
            { _id: security._id },
            {
              $set: {
                structuredProductUnderlyingType: underlyingType,
                updatedAt: new Date()
              },
              $inc: { version: 1 }
            }
          );

          console.log(`[SECURITIES_METADATA] Enriched ${security.isin}: underlyingType = ${underlyingType}`);
          enriched++;

          // Also propagate to PMSHoldings if they exist
          try {
            const propagationResult = await PMSHoldingsCollection.updateAsync(
              { isin: security.isin },
              {
                $set: {
                  structuredProductUnderlyingType: underlyingType
                }
              },
              { multi: true }
            );

            if (propagationResult > 0) {
              console.log(`[SECURITIES_METADATA] Propagated to ${propagationResult} PMSHoldings`);
            }
          } catch (propError) {
            console.warn(`[SECURITIES_METADATA] Failed to propagate to PMSHoldings: ${propError.message}`);
          }

        } catch (error) {
          console.error(`[SECURITIES_METADATA] Error enriching ${security.isin}: ${error.message}`);
          errors++;
        }
      }

      const summary = {
        success: true,
        totalChecked: structuredProducts.length,
        enriched,
        skipped,
        noProduct,
        errors
      };

      console.log(`[SECURITIES_METADATA] Re-enrichment complete: ${enriched} enriched, ${skipped} skipped, ${noProduct} no matching product, ${errors} errors`);

      return summary;

    } catch (error) {
      console.error(`[SECURITIES_METADATA] Re-enrichment failed: ${error.message}`);
      throw new Meteor.Error('enrichment-failed', error.message);
    }
  },

  /**
   * Search securities for order creation (accessible by RM/Admin)
   * Searches across SecuritiesMetadata, Products, and PMS Holdings
   */
  async 'securities.search'({ query, limit = 15 }, sessionId) {
    check(query, String);
    check(limit, Match.Optional(Number));
    check(sessionId, String);

    // Validate session (not admin-only, but must be authenticated)
    const session = await SessionsCollection.findOneAsync({
      sessionId,
      isActive: true
    });

    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid session');
    }

    const user = await UsersCollection.findOneAsync(session.userId);

    if (!user) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }

    // Only RMs and Admins can search securities for orders
    if (!['rm', 'admin', 'superadmin'].includes(user.role)) {
      throw new Meteor.Error('not-authorized', 'Only RMs and Admins can search securities');
    }

    const searchQuery = query.trim().toUpperCase();
    if (searchQuery.length < 2) {
      return [];
    }

    const results = [];
    const seenISINs = new Set();

    // 1. Search in SecuritiesMetadata
    const metadataResults = await SecuritiesMetadataCollection.find({
      $or: [
        { isin: { $regex: searchQuery, $options: 'i' } },
        { securityName: { $regex: searchQuery, $options: 'i' } },
        { ticker: { $regex: searchQuery, $options: 'i' } }
      ]
    }, { limit: Math.ceil(limit / 2) }).fetchAsync();

    metadataResults.forEach(sec => {
      if (sec.isin && !seenISINs.has(sec.isin.toUpperCase())) {
        seenISINs.add(sec.isin.toUpperCase());
        results.push({
          _id: sec._id,
          isin: sec.isin,
          name: sec.securityName,
          ticker: sec.ticker,
          exchange: sec.listingExchange,
          currency: sec.currency,
          assetClass: sec.assetClass,
          source: 'metadata'
        });
      }
    });

    // 2. Search in Products (for structured products)
    if (results.length < limit) {
      const productResults = await ProductsCollection.find({
        $or: [
          { isin: { $regex: searchQuery, $options: 'i' } },
          { title: { $regex: searchQuery, $options: 'i' } }
        ]
      }, { limit: Math.ceil(limit / 2) }).fetchAsync();

      productResults.forEach(prod => {
        if (prod.isin && !seenISINs.has(prod.isin.toUpperCase())) {
          seenISINs.add(prod.isin.toUpperCase());
          results.push({
            _id: prod._id,
            isin: prod.isin,
            name: prod.title,
            currency: prod.currency || prod.parameters?.currency || 'USD',
            assetClass: 'structured_product',
            source: 'product'
          });
        }
      });
    }

    // 3. Search in PMSHoldings (for securities not in metadata)
    if (results.length < limit) {
      const holdingResults = await PMSHoldingsCollection.find({
        isLatest: true,
        $or: [
          { isin: { $regex: searchQuery, $options: 'i' } },
          { securityName: { $regex: searchQuery, $options: 'i' } }
        ]
      }, { limit: Math.ceil(limit / 2) }).fetchAsync();

      holdingResults.forEach(hold => {
        if (hold.isin && !seenISINs.has(hold.isin.toUpperCase())) {
          seenISINs.add(hold.isin.toUpperCase());
          results.push({
            _id: hold._id,
            isin: hold.isin,
            name: hold.securityName,
            currency: hold.currency,
            assetClass: hold.assetClass || hold.securityType,
            source: 'holding'
          });
        }
      });
    }

    return results.slice(0, limit);
  }
});
