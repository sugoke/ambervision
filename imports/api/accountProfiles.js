import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const AccountProfilesCollection = new Mongo.Collection('accountProfiles');

/**
 * AccountProfiles Schema:
 * {
 *   _id: String,
 *   bankAccountId: String,      // Reference to BankAccountsCollection
 *   maxCash: Number,            // 0-100 (max % for Cash/Short Term)
 *   maxBonds: Number,           // 0-100 (max % for Bonds and similar)
 *   maxEquities: Number,        // 0-100 (max % for Equities and similar)
 *   maxAlternative: Number,     // 0-100 (max % for Alternative investments)
 *   lastUpdated: Date,
 *   updatedBy: String           // userId who made the change
 * }
 *
 * Asset Class Definitions:
 *
 * 1. Cash / Short Term (Monétaire/Court Terme):
 *    - Cash, Term deposits
 *    - Fixed or variable rate bonds ≤ 18 months
 *    - Money market funds
 *    - Structured products with guaranteed or protected capital ≤ 18 months
 *
 * 2. Bonds and Similar (Obligations et assimilées):
 *    - Fixed-rate or variable-rate bonds > 18 months
 *    - Convertible bonds
 *    - Bond funds
 *    - Structured products with capital guarantee or protection (any underlying)
 *    - Balanced funds if > 50% in bonds
 *
 * 3. Equities and Similar (Actions et assimilées):
 *    - Equities
 *    - Equity and balanced funds (if > 50% in equities)
 *    - Simple structured products with underlying equities
 *
 * 4. Alternative Investment (Gestion Alternative):
 *    - Derivatives (options, futures)
 *    - Hedge funds
 *    - Real estate
 *    - Commodities
 *    - Private equity
 *    - Speculative Forex trading
 *    - Other
 */

/**
 * Map order asset type to the 4 profile categories (cash, bonds, equities, alternative)
 * @param {String} assetType - ASSET_TYPES value from orders.js
 * @param {Object} options - { capitalProtected: Boolean }
 * @returns {String} - 'cash' | 'bonds' | 'equities' | 'alternative'
 */
export const mapOrderAssetTypeToProfileCategory = (assetType, options = {}) => {
  switch (assetType) {
    case 'equity':
    case 'etf':
      return 'equities';
    case 'bond':
      return 'bonds';
    case 'structured_product':
      return options.capitalProtected ? 'bonds' : 'equities';
    case 'fx':
    case 'term_deposit':
      return 'cash';
    case 'fund':
      return 'equities';
    case 'other':
      return 'alternative';
    default:
      return 'alternative';
  }
};

/**
 * Map order asset type to the granular breakdown key used by aggregateToFourCategories
 * @param {String} assetType - ASSET_TYPES value from orders.js
 * @param {Boolean} capitalProtected - Whether structured product has capital protection
 * @returns {String} - breakdown key (e.g. 'equity', 'fixed_income', 'structured_product_capital_guaranteed')
 */
export const getBreakdownKeyForAssetType = (assetType, capitalProtected) => {
  switch (assetType) {
    case 'equity':
    case 'etf':
      return 'equity';
    case 'bond':
      return 'fixed_income';
    case 'structured_product':
      return capitalProtected ? 'structured_product_capital_guaranteed' : 'structured_product_equity_linked';
    case 'term_deposit':
      return 'time_deposit';
    case 'fx':
      return 'cash';
    case 'fund':
      return 'equity';
    case 'other':
      return 'other';
    default:
      return 'other';
  }
};

// Predefined profile templates
export const PROFILE_TEMPLATES = {
  'flexible-security': {
    name: 'Flexible Security',
    maxCash: 100,
    maxBonds: 100,
    maxEquities: 0,
    maxAlternative: 0
  },
  'flexible-conservative': {
    name: 'Flexible Conservative',
    maxCash: 100,
    maxBonds: 100,
    maxEquities: 30,
    maxAlternative: 0
  },
  'flexible-balanced': {
    name: 'Flexible Balanced',
    maxCash: 100,
    maxBonds: 75,
    maxEquities: 50,
    maxAlternative: 25
  },
  'flexible-dynamic': {
    name: 'Flexible Dynamic',
    maxCash: 100,
    maxBonds: 100,
    maxEquities: 100,
    maxAlternative: 100
  },
  'flexible': {
    name: 'Flexible',
    maxCash: 0,
    maxBonds: 0,
    maxEquities: 0,
    maxAlternative: 0
  }
};

/**
 * Aggregate granular asset class breakdown into 4 main categories
 * @param {Object} breakdown - The assetClassBreakdown from portfolioSnapshot
 * @param {Number} totalValue - Total portfolio value
 * @returns {Object} { cash, bonds, equities, alternative } as percentages
 */
export const aggregateToFourCategories = (breakdown, totalValue) => {
  if (!breakdown || !totalValue || totalValue === 0) {
    return { cash: 0, bonds: 0, equities: 0, alternative: 0 };
  }

  let cash = 0;
  let bonds = 0;
  let equities = 0;
  let alternative = 0;

  for (const [category, value] of Object.entries(breakdown)) {
    const lowerCategory = category.toLowerCase();

    // Cash / Short Term (includes time deposits)
    if (lowerCategory === 'cash' ||
        lowerCategory === 'monetary_products' ||
        lowerCategory === 'time_deposit' ||
        lowerCategory.includes('money_market')) {
      cash += value;
    }
    // Alternative - check FIRST to catch private_equity before general equity check
    else if (lowerCategory === 'private_equity' ||
             lowerCategory === 'private_debt' ||
             lowerCategory === 'commodities' ||
             lowerCategory === 'real_estate' ||
             lowerCategory === 'hedge_fund' ||
             lowerCategory === 'derivatives' ||
             lowerCategory === 'other' ||
             lowerCategory === 'structured_product_commodities_linked' ||
             lowerCategory === 'structured_product_credit_linked') {
      alternative += value;
    }
    // Structured products with capital guarantee or protection -> Bonds
    // Per profile rules: "Structured products with capital guarantee or protection (any underlying)"
    else if (lowerCategory.includes('structured_product_capital_guaranteed') ||
             lowerCategory === 'structured_product_barrier_protected' ||
             lowerCategory === 'structured_product_partial_guarantee') {
      bonds += value;
    }
    // Fixed Income / Bonds
    else if (lowerCategory.includes('fixed_income') ||
             lowerCategory.includes('bond') ||
             lowerCategory === 'convertible') {
      bonds += value;
    }
    // Equities - includes equity-linked structured products (without capital protection)
    else if (lowerCategory.includes('equity') ||
             lowerCategory.includes('stock') ||
             lowerCategory === 'structured_product_equity_linked') {
      equities += value;
    }
    // Default: categorize remaining structured products to Equities
    // (most structured products are equity-linked by default)
    else if (lowerCategory.includes('structured_product')) {
      // Check for non-equity underlying types that should go to Alternative
      if (lowerCategory.includes('commodities') || lowerCategory.includes('credit')) {
        alternative += value;
      } else {
        // Equity-linked or unknown underlying -> Equities (safer default)
        equities += value;
      }
    }
    // Anything else goes to alternative
    else {
      alternative += value;
    }
  }

  // Convert to percentages
  return {
    cash: Math.round((cash / totalValue) * 100 * 100) / 100,
    bonds: Math.round((bonds / totalValue) * 100 * 100) / 100,
    equities: Math.round((equities / totalValue) * 100 * 100) / 100,
    alternative: Math.round((alternative / totalValue) * 100 * 100) / 100
  };
};
