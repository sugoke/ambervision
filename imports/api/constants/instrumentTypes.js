/**
 * AMBERVISION STANDARD TAXONOMY
 *
 * This file is the SINGLE SOURCE OF TRUTH for instrument classification.
 * All bank parsers MUST output one of these SECURITY_TYPES.
 * The UI uses ASSET_CLASSES for display and reporting.
 *
 * IMPORTANT: When adding a new bank parser, import SECURITY_TYPES from this file
 * and use these constants in your mapSecurityType() function.
 */

// =============================================================================
// SECURITY TYPES (Parser Output)
// =============================================================================
// These are the ONLY valid values for PMSHoldings.securityType
// All bank parsers must map their bank-specific codes to one of these values

export const SECURITY_TYPES = {
  // Equities
  EQUITY: 'EQUITY',                    // Common stocks, preferred stocks, ADRs
  ETF: 'ETF',                          // Exchange-traded funds

  // Fixed Income
  BOND: 'BOND',                        // Government, corporate, convertible, perpetual bonds

  // Funds
  FUND: 'FUND',                        // Mutual funds, UCITS, SICAVs, hedge funds
  MONEY_MARKET: 'MONEY_MARKET',        // Money market funds

  // Cash & Deposits
  CASH: 'CASH',                        // Current account balances, overnight deposits
  TERM_DEPOSIT: 'TERM_DEPOSIT',        // Fixed-term deposits, fiduciary deposits, time deposits

  // Structured Products
  STRUCTURED_PRODUCT: 'STRUCTURED_PRODUCT',  // Notes, linked products, autocallables, phoenix
  CERTIFICATE: 'CERTIFICATE',                 // Tracker certificates, bonus certificates

  // Derivatives
  OPTION: 'OPTION',                    // Call/put options
  FUTURE: 'FUTURE',                    // Futures contracts
  WARRANT: 'WARRANT',                  // Warrants
  FX_FORWARD: 'FX_FORWARD',            // Foreign exchange forwards

  // Alternatives
  COMMODITY: 'COMMODITY',              // Physical commodities, commodity funds
  PRIVATE_EQUITY: 'PRIVATE_EQUITY',    // PE funds, direct investments
  PRIVATE_DEBT: 'PRIVATE_DEBT',        // Private credit, direct lending

  // Catch-all
  UNKNOWN: 'UNKNOWN'                   // Unclassified instruments
};

// =============================================================================
// ASSET CLASSES (UI/Reporting Display)
// =============================================================================
// These are the display values used in the UI and reports
// Each security type maps to exactly one asset class

export const ASSET_CLASSES = {
  EQUITY: 'equity',
  FIXED_INCOME: 'fixed_income',
  STRUCTURED_PRODUCT: 'structured_product',
  CASH: 'cash',
  TIME_DEPOSIT: 'time_deposit',
  MONETARY_PRODUCTS: 'monetary_products',
  DERIVATIVES: 'derivatives',
  COMMODITIES: 'commodities',
  PRIVATE_EQUITY: 'private_equity',
  PRIVATE_DEBT: 'private_debt',
  OTHER: 'other'
};

// =============================================================================
// GUARANTEED MAPPING: securityType → assetClass
// =============================================================================
// This mapping is guaranteed - every security type has exactly one asset class
// NULL value means the mapping is context-dependent (handled in getAssetClassFromSecurityType)

export const SECURITY_TYPE_TO_ASSET_CLASS = {
  [SECURITY_TYPES.EQUITY]: ASSET_CLASSES.EQUITY,
  [SECURITY_TYPES.ETF]: ASSET_CLASSES.EQUITY,
  [SECURITY_TYPES.BOND]: ASSET_CLASSES.FIXED_INCOME,
  [SECURITY_TYPES.FUND]: null,  // Context-dependent: equity or fixed_income based on name
  [SECURITY_TYPES.MONEY_MARKET]: ASSET_CLASSES.MONETARY_PRODUCTS,
  [SECURITY_TYPES.CASH]: ASSET_CLASSES.CASH,
  [SECURITY_TYPES.TERM_DEPOSIT]: ASSET_CLASSES.TIME_DEPOSIT,
  [SECURITY_TYPES.STRUCTURED_PRODUCT]: ASSET_CLASSES.STRUCTURED_PRODUCT,
  [SECURITY_TYPES.CERTIFICATE]: ASSET_CLASSES.STRUCTURED_PRODUCT,
  [SECURITY_TYPES.OPTION]: ASSET_CLASSES.DERIVATIVES,
  [SECURITY_TYPES.FUTURE]: ASSET_CLASSES.DERIVATIVES,
  [SECURITY_TYPES.WARRANT]: ASSET_CLASSES.DERIVATIVES,
  [SECURITY_TYPES.FX_FORWARD]: ASSET_CLASSES.CASH,  // Treated as cash equivalent for allocation
  [SECURITY_TYPES.COMMODITY]: ASSET_CLASSES.COMMODITIES,
  [SECURITY_TYPES.PRIVATE_EQUITY]: ASSET_CLASSES.PRIVATE_EQUITY,
  [SECURITY_TYPES.PRIVATE_DEBT]: ASSET_CLASSES.PRIVATE_DEBT,
  [SECURITY_TYPES.UNKNOWN]: ASSET_CLASSES.OTHER
};

// =============================================================================
// HUMAN-READABLE LABELS
// =============================================================================

export const SECURITY_TYPE_LABELS = {
  [SECURITY_TYPES.EQUITY]: 'Equity',
  [SECURITY_TYPES.ETF]: 'ETF',
  [SECURITY_TYPES.BOND]: 'Bond',
  [SECURITY_TYPES.FUND]: 'Fund',
  [SECURITY_TYPES.MONEY_MARKET]: 'Money Market',
  [SECURITY_TYPES.CASH]: 'Cash',
  [SECURITY_TYPES.TERM_DEPOSIT]: 'Term Deposit',
  [SECURITY_TYPES.STRUCTURED_PRODUCT]: 'Structured Product',
  [SECURITY_TYPES.CERTIFICATE]: 'Certificate',
  [SECURITY_TYPES.OPTION]: 'Option',
  [SECURITY_TYPES.FUTURE]: 'Future',
  [SECURITY_TYPES.WARRANT]: 'Warrant',
  [SECURITY_TYPES.FX_FORWARD]: 'FX Forward',
  [SECURITY_TYPES.COMMODITY]: 'Commodity',
  [SECURITY_TYPES.PRIVATE_EQUITY]: 'Private Equity',
  [SECURITY_TYPES.PRIVATE_DEBT]: 'Private Debt',
  [SECURITY_TYPES.UNKNOWN]: 'Unknown'
};

export const ASSET_CLASS_LABELS = {
  [ASSET_CLASSES.EQUITY]: 'Equity',
  [ASSET_CLASSES.FIXED_INCOME]: 'Fixed Income',
  [ASSET_CLASSES.STRUCTURED_PRODUCT]: 'Structured Products',
  [ASSET_CLASSES.CASH]: 'Cash',
  [ASSET_CLASSES.TIME_DEPOSIT]: 'Term Deposit',
  [ASSET_CLASSES.MONETARY_PRODUCTS]: 'Monetary Products',
  [ASSET_CLASSES.DERIVATIVES]: 'Derivatives',
  [ASSET_CLASSES.COMMODITIES]: 'Commodities',
  [ASSET_CLASSES.PRIVATE_EQUITY]: 'Private Equity',
  [ASSET_CLASSES.PRIVATE_DEBT]: 'Private Debt',
  [ASSET_CLASSES.OTHER]: 'Other'
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get asset class from security type.
 * Handles context-dependent cases like FUND.
 *
 * @param {string} securityType - One of SECURITY_TYPES values
 * @param {string} securityName - Optional security name for context-dependent mapping
 * @returns {string} One of ASSET_CLASSES values
 */
export function getAssetClassFromSecurityType(securityType, securityName = '') {
  // Direct mapping for most types
  const directMapping = SECURITY_TYPE_TO_ASSET_CLASS[securityType];
  if (directMapping !== null && directMapping !== undefined) {
    return directMapping;
  }

  // Context-dependent: FUND
  // Determine if it's an equity fund or fixed income fund based on name
  if (securityType === SECURITY_TYPES.FUND) {
    const nameLower = (securityName || '').toLowerCase();
    if (
      nameLower.includes('bond') ||
      nameLower.includes('fixed') ||
      nameLower.includes('income') ||
      nameLower.includes('obligat') ||  // French for bond
      nameLower.includes('credit') ||
      nameLower.includes('debt')
    ) {
      return ASSET_CLASSES.FIXED_INCOME;
    }
    // Default funds to equity (most common case)
    return ASSET_CLASSES.EQUITY;
  }

  return ASSET_CLASSES.OTHER;
}

/**
 * Validate that a security type is valid.
 *
 * @param {string} type - Security type to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidSecurityType(type) {
  return Object.values(SECURITY_TYPES).includes(type);
}

/**
 * Get a human-readable label for a security type.
 *
 * @param {string} type - One of SECURITY_TYPES values
 * @returns {string} Human-readable label
 */
export function getSecurityTypeLabel(type) {
  return SECURITY_TYPE_LABELS[type] || type || 'Unknown';
}

/**
 * Get a human-readable label for an asset class.
 *
 * @param {string} assetClass - One of ASSET_CLASSES values
 * @returns {string} Human-readable label
 */
export function getAssetClassLabel(assetClass) {
  return ASSET_CLASS_LABELS[assetClass] || assetClass || 'Other';
}

/**
 * Get asset sub-class for more granular categorization.
 * Used for equity (direct vs fund) and fixed income (direct vs fund).
 *
 * @param {string} assetClass - One of ASSET_CLASSES values
 * @param {string} securityType - One of SECURITY_TYPES values
 * @param {string} securityName - Optional security name for additional context
 * @returns {string|null} Sub-class value or null if not applicable
 */
export function getAssetSubClass(assetClass, securityType, securityName = '') {
  const nameLower = (securityName || '').toLowerCase();

  if (assetClass === ASSET_CLASSES.EQUITY) {
    // Distinguish between direct equities and equity funds
    if (securityType === SECURITY_TYPES.FUND ||
        securityType === SECURITY_TYPES.ETF ||
        nameLower.includes('fund') ||
        nameLower.includes('etf')) {
      return 'equity_fund';
    }
    return 'direct_equity';
  }

  if (assetClass === ASSET_CLASSES.FIXED_INCOME) {
    // Distinguish between direct bonds and bond funds
    if (securityType === SECURITY_TYPES.FUND ||
        nameLower.includes('fund')) {
      return 'fixed_income_fund';
    }
    return 'direct_bond';
  }

  return null;
}

// =============================================================================
// LEGACY VALUE MAPPING (for data migration)
// =============================================================================
// Maps old/inconsistent values to standardized SECURITY_TYPES
// Used by migration script to normalize existing data

export const LEGACY_SECURITY_TYPE_MAPPING = {
  // Andbank used different names
  'DEPOSIT': SECURITY_TYPES.TERM_DEPOSIT,
  'FOREX': SECURITY_TYPES.FX_FORWARD,

  // CMB Monaco used different names
  'MONEY_MARKET_FUND': SECURITY_TYPES.MONEY_MARKET,

  // Possible variations
  'TIME_DEPOSIT': SECURITY_TYPES.TERM_DEPOSIT,
  'FX': SECURITY_TYPES.FX_FORWARD,
  'STOCK': SECURITY_TYPES.EQUITY,
  'SHARE': SECURITY_TYPES.EQUITY,
  'SHARES': SECURITY_TYPES.EQUITY,
  'MUTUAL_FUND': SECURITY_TYPES.FUND,
  'SICAV': SECURITY_TYPES.FUND,
  'UCITS': SECURITY_TYPES.FUND,
  'STRUCTURED_NOTE': SECURITY_TYPES.STRUCTURED_PRODUCT,
  'NOTE': SECURITY_TYPES.STRUCTURED_PRODUCT,
  'DERIVATIVE': SECURITY_TYPES.OPTION  // Generic derivative -> default to option
};

/**
 * Normalize a potentially legacy security type to the standard value.
 * Used by migration script.
 *
 * @param {string} type - Potentially legacy security type
 * @returns {string} Normalized SECURITY_TYPES value
 */
export function normalizeSecurityType(type) {
  if (!type) return SECURITY_TYPES.UNKNOWN;

  const upperType = type.toUpperCase();

  // If it's already a valid type, return as-is
  if (isValidSecurityType(upperType)) {
    return upperType;
  }

  // Check legacy mapping
  if (LEGACY_SECURITY_TYPE_MAPPING[upperType]) {
    return LEGACY_SECURITY_TYPE_MAPPING[upperType];
  }

  // Return unknown if no match
  return SECURITY_TYPES.UNKNOWN;
}
