import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

export const SecuritiesMetadataCollection = new Mongo.Collection('securitiesMetadata');

/**
 * Securities Metadata Collection
 *
 * Stores classification and metadata for securities from PMS holdings.
 * One document per unique ISIN.
 */

// Asset class options with hierarchical structure
export const ASSET_CLASSES = [
  { value: '', label: 'Not Classified' },
  { value: 'structured_product', label: 'Structured Products' },
  { value: 'equity', label: 'Equity' },
  { value: 'fixed_income', label: 'Fixed Income' },
  { value: 'private_equity', label: 'Private Equity' },
  { value: 'private_debt', label: 'Private Debt' },
  { value: 'commodities', label: 'Commodities' },
  { value: 'cash', label: 'Cash' },
  { value: 'time_deposit', label: 'Term Deposit' },
  { value: 'monetary_products', label: 'Monetary Products' },
  { value: 'other', label: 'Other' }
];

// Structured Product sub-classes by underlying type
export const STRUCTURED_PRODUCT_UNDERLYING_TYPES = [
  { value: '', label: 'Not Specified' },
  { value: 'equity_linked', label: 'Equity Linked' },
  { value: 'fixed_income_linked', label: 'Fixed Income Linked' },
  { value: 'credit_linked', label: 'Credit Linked' },
  { value: 'commodities_linked', label: 'Commodities Linked' }
];

// Structured Product sub-classes by capital protection level
export const STRUCTURED_PRODUCT_PROTECTION_TYPES = [
  { value: '', label: 'Not Specified' },
  { value: 'capital_guaranteed_100', label: '100% Capital Guaranteed' },
  { value: 'capital_guaranteed_partial', label: 'Capital Partially Guaranteed' },
  { value: 'capital_protected_conditional', label: 'Capital Protected Conditionally' },
  { value: 'other_protection', label: 'Others' }
];

// Structured Product types (template types from Ambervision)
export const STRUCTURED_PRODUCT_TYPES = [
  { value: '', label: 'Not Specified' },
  { value: 'orion', label: 'Orion (Capital Protected Note)' },
  { value: 'phoenix', label: 'Phoenix (Autocallable)' },
  { value: 'himalaya', label: 'Himalaya' },
  { value: 'participation_note', label: 'Participation Note' },
  { value: 'reverse_convertible', label: 'Reverse Convertible' },
  { value: 'reverse_convertible_bond', label: 'Reverse Convertible Bond' },
  { value: 'shark_note', label: 'Shark Note' },
  { value: 'autocallable', label: 'Autocallable' },
  { value: 'bonus_certificate', label: 'Bonus Certificate' },
  { value: 'discount_certificate', label: 'Discount Certificate' },
  { value: 'other', label: 'Other Structured Product' }
];

// Equity sub-classes
export const EQUITY_SUB_CLASSES = [
  { value: '', label: 'Not Specified' },
  { value: 'direct_equity', label: 'Direct' },
  { value: 'equity_fund', label: 'Funds' }
];

// Fixed Income sub-classes
export const FIXED_INCOME_SUB_CLASSES = [
  { value: '', label: 'Not Specified' },
  { value: 'direct_bond', label: 'Direct' },
  { value: 'fixed_income_fund', label: 'Funds' }
];

// Sector options (GICS)
export const SECTORS = [
  { value: '', label: 'Not Classified' },
  { value: 'technology', label: 'Technology' },
  { value: 'financials', label: 'Financials' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'consumer_discretionary', label: 'Consumer Discretionary' },
  { value: 'industrials', label: 'Industrials' },
  { value: 'energy', label: 'Energy' },
  { value: 'materials', label: 'Materials' },
  { value: 'consumer_staples', label: 'Consumer Staples' },
  { value: 'utilities', label: 'Utilities' },
  { value: 'real_estate', label: 'Real Estate' },
  { value: 'communication_services', label: 'Communication Services' }
];

// Exchange options
export const EXCHANGES = [
  { value: '', label: 'Not Specified' },
  { value: 'SIX', label: 'SIX Swiss Exchange' },
  { value: 'NYSE', label: 'New York Stock Exchange' },
  { value: 'NASDAQ', label: 'NASDAQ' },
  { value: 'LSE', label: 'London Stock Exchange' },
  { value: 'Euronext', label: 'Euronext' },
  { value: 'Deutsche_Boerse', label: 'Deutsche Börse' },
  { value: 'TSE', label: 'Tokyo Stock Exchange' },
  { value: 'HKEX', label: 'Hong Kong Stock Exchange' },
  { value: 'SSE', label: 'Shanghai Stock Exchange' },
  { value: 'OTC', label: 'Over-the-Counter' }
];

/**
 * Get asset class label from value
 * @param {string} value - Asset class value (e.g., 'structured_product')
 * @returns {string} Label (e.g., 'Structured Products')
 */
export function getAssetClassLabel(value) {
  const assetClass = ASSET_CLASSES.find(ac => ac.value === value);
  return assetClass ? assetClass.label : value;
}

/**
 * Get granular category label from category key
 * Converts keys like 'equity_direct_equity' to 'Direct Equities'
 * @param {string} categoryKey - Category key (e.g., 'equity_direct_equity', 'structured_product_capital_guaranteed')
 * @returns {string} Display label
 */
export function getGranularCategoryLabel(categoryKey) {
  // Handle base asset classes (no sub-category)
  if (!categoryKey.includes('_')) {
    return getAssetClassLabel(categoryKey);
  }

  // Structured product categories by underlying + protection (e.g., "structured_product_equity_linked_capital_guaranteed_100")
  if (categoryKey.startsWith('structured_product_')) {
    const underlyingLabels = {
      'equity_linked': 'Equity Linked',
      'fixed_income_linked': 'Fixed Income Linked',
      'credit_linked': 'Credit Linked',
      'commodities_linked': 'Commodities Linked',
      'other': 'Other'
    };
    const protectionLabels = {
      'capital_guaranteed_100': '100% Capital Guaranteed',
      'capital_guaranteed_partial': 'Partially Guaranteed',
      'capital_protected_conditional': 'Conditionally Guaranteed',
      'other_protection': 'Other Protection',
      'other': 'Unclassified'
    };

    // Extract underlying and protection from key: "structured_product_{underlying}_{protection}"
    const suffix = categoryKey.replace('structured_product_', '');

    // Try to match known underlying types
    let underlyingKey = null;
    let protectionKey = null;

    for (const uk of Object.keys(underlyingLabels)) {
      if (suffix.startsWith(uk + '_')) {
        underlyingKey = uk;
        protectionKey = suffix.replace(uk + '_', '');
        break;
      }
    }

    if (underlyingKey && protectionKey) {
      const underlyingLabel = underlyingLabels[underlyingKey] || underlyingKey;
      const protectionLabel = protectionLabels[protectionKey] || protectionKey;
      return `${underlyingLabel} - ${protectionLabel}`;
    }

    // Fallback for legacy single-dimension keys
    if (underlyingLabels[suffix]) return underlyingLabels[suffix];
    if (protectionLabels[suffix]) return protectionLabels[suffix];

    // Legacy keys
    if (suffix === 'capital_guaranteed') return '100% Capital Guaranteed';
    if (suffix === 'partial_guarantee') return 'Partially Guaranteed';
    if (suffix === 'barrier_protected') return 'Conditionally Guaranteed';
    if (suffix === 'other_protection') return 'Other Structured Products';
  }

  // Equity granular categories
  if (categoryKey === 'equity_direct_equity') {
    return 'Direct Equities';
  }
  if (categoryKey === 'equity_equity_fund') {
    return 'Equity Funds';
  }

  // Fixed income granular categories
  if (categoryKey === 'fixed_income_direct_bond') {
    return 'Direct Bonds';
  }
  if (categoryKey === 'fixed_income_fixed_income_fund') {
    return 'Fixed Income Funds';
  }

  // Fallback: try to create a readable label
  const parts = categoryKey.split('_');
  return parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

// Helper functions for Securities Metadata management
export const SecuritiesMetadataHelpers = {
  /**
   * Create or update security metadata
   */
  async upsertSecurityMetadata(securityData) {
    check(securityData.isin, String);

    const now = new Date();

    console.log(`[SecuritiesMetadataHelpers] Upserting security: ${securityData.isin}, securityName: "${securityData.securityName}"`);

    // Check if record exists
    const existing = await SecuritiesMetadataCollection.findOneAsync({
      isin: securityData.isin
    });

    // Determine if classified
    const isClassified = !!(
      securityData.assetClass ||
      securityData.sector ||
      securityData.listingExchange
    );

    if (existing) {
      // Update existing record
      console.log(`[SecuritiesMetadataHelpers] Updating existing record, old securityName: "${existing.securityName}", new securityName: "${securityData.securityName}"`);

      await SecuritiesMetadataCollection.updateAsync(existing._id, {
        $set: {
          ...securityData,
          isClassified,
          lastReviewedAt: now,
          updatedAt: now,
          version: (existing.version || 0) + 1
        }
      });

      // Verify the update
      const updated = await SecuritiesMetadataCollection.findOneAsync({ _id: existing._id });
      console.log(`[SecuritiesMetadataHelpers] After update, securityName in DB: "${updated.securityName}"`);

      return { _id: existing._id, updated: true };
    } else {
      // Insert new record
      console.log(`[SecuritiesMetadataHelpers] Inserting new record with securityName: "${securityData.securityName}"`);

      const securityId = await SecuritiesMetadataCollection.insertAsync({
        ...securityData,
        isClassified,
        version: 1,
        createdAt: now,
        updatedAt: now
      });

      return { _id: securityId, updated: false };
    }
  },

  /**
   * Get security metadata by ISIN
   */
  async getSecurityMetadata(isin) {
    return await SecuritiesMetadataCollection.findOneAsync({ isin });
  },

  /**
   * Get all securities with optional filters
   */
  async getAllSecurities(options = {}) {
    const {
      isClassified,
      assetClass,
      limit = 100,
      skip = 0
    } = options;

    const query = {};
    if (isClassified !== undefined) query.isClassified = isClassified;
    if (assetClass) query.assetClass = assetClass;

    return await SecuritiesMetadataCollection.find(query, {
      limit,
      skip,
      sort: {
        isClassified: 1,  // Unclassified first
        securityName: 1
      }
    }).fetchAsync();
  },

  /**
   * Get statistics
   */
  async getStatistics() {
    const all = await SecuritiesMetadataCollection.find({}).fetchAsync();

    const stats = {
      total: all.length,
      classified: all.filter(s => s.isClassified).length,
      unclassified: all.filter(s => !s.isClassified).length,
      byAssetClass: {}
    };

    // Count by asset class
    all.forEach(security => {
      const assetClass = security.assetClass || 'unclassified';
      stats.byAssetClass[assetClass] = (stats.byAssetClass[assetClass] || 0) + 1;
    });

    return stats;
  },

  /**
   * Search securities by ISIN or name
   */
  async searchSecurities(searchTerm) {
    const regex = new RegExp(searchTerm, 'i');
    return await SecuritiesMetadataCollection.find({
      $or: [
        { isin: regex },
        { securityName: regex }
      ]
    }, {
      sort: { isClassified: 1, securityName: 1 },
      limit: 100
    }).fetchAsync();
  },

  /**
   * Soft delete security metadata
   */
  async deleteSecurityMetadata(isin) {
    return await SecuritiesMetadataCollection.removeAsync({ isin });
  }
};

// Create indexes on server startup
if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      // Unique index on ISIN
      await SecuritiesMetadataCollection.createIndexAsync(
        { isin: 1 },
        { unique: true }
      );

      // Compound index for common queries
      await SecuritiesMetadataCollection.createIndexAsync({
        isClassified: 1,
        isin: 1
      });

      // Index on asset class
      await SecuritiesMetadataCollection.createIndexAsync({
        assetClass: 1
      });

      // Index on security name for search
      await SecuritiesMetadataCollection.createIndexAsync({
        securityName: 1
      });

      console.log('[SECURITIES_METADATA] Indexes created successfully');
    } catch (error) {
      console.log('[SECURITIES_METADATA] Skipping index creation (might already exist)');
    }
  });
}
