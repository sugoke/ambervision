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
  FX_FORWARD: 'fx_forward',
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
  [SECURITY_TYPES.FX_FORWARD]: ASSET_CLASSES.FX_FORWARD,  // Separate asset class for display/tracking
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
  [ASSET_CLASSES.FX_FORWARD]: 'FX Forwards',
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

/**
 * Get security type from asset class (reverse mapping).
 * Used when enrichment sets assetClass but not securityType.
 *
 * @param {string} assetClass - One of ASSET_CLASSES values (lowercase)
 * @returns {string} Corresponding SECURITY_TYPES value
 */
export function getSecurityTypeFromAssetClass(assetClass) {
  const mapping = {
    'equity': SECURITY_TYPES.EQUITY,
    'fixed_income': SECURITY_TYPES.BOND,
    'structured_product': SECURITY_TYPES.STRUCTURED_PRODUCT,
    'cash': SECURITY_TYPES.CASH,
    'time_deposit': SECURITY_TYPES.TERM_DEPOSIT,
    'monetary_products': SECURITY_TYPES.MONEY_MARKET,
    'derivatives': SECURITY_TYPES.OPTION,
    'commodities': SECURITY_TYPES.COMMODITY,
    'private_equity': SECURITY_TYPES.PRIVATE_EQUITY,
    'private_debt': SECURITY_TYPES.PRIVATE_DEBT,
    'fund': SECURITY_TYPES.FUND,
    'etf': SECURITY_TYPES.ETF,
    'other': SECURITY_TYPES.UNKNOWN
  };
  return mapping[assetClass] || SECURITY_TYPES.UNKNOWN;
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
  'DERIVATIVE': SECURITY_TYPES.OPTION,  // Generic derivative -> default to option

  // Julius Baer INST_NAT_E raw codes (stored in DB as securityType by legacy parser)
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
 * Normalize a potentially legacy security type to the standard value.
 * Used by migration script.
 *
 * @param {string} type - Potentially legacy security type
 * @returns {string} Normalized SECURITY_TYPES value
 */
export function normalizeSecurityType(type) {
  if (!type) return SECURITY_TYPES.UNKNOWN;

  // Convert to string in case it's a number
  const typeStr = String(type).trim();

  // Check for raw numeric codes first (e.g., "13", "19" from Julius Baer)
  if (LEGACY_SECURITY_TYPE_MAPPING[typeStr]) {
    return LEGACY_SECURITY_TYPE_MAPPING[typeStr];
  }

  const upperType = typeStr.toUpperCase();

  // If it's already a valid type, return as-is
  if (isValidSecurityType(upperType)) {
    return upperType;
  }

  // Check legacy mapping with uppercase
  if (LEGACY_SECURITY_TYPE_MAPPING[upperType]) {
    return LEGACY_SECURITY_TYPE_MAPPING[upperType];
  }

  // Return unknown if no match
  return SECURITY_TYPES.UNKNOWN;
}

// =============================================================================
// SECONDARY CLASSIFICATION (Fallback for UNKNOWN types)
// =============================================================================

/**
 * Structured product issuers - securities from these issuers are almost always structured products.
 */
const STRUCTURED_PRODUCT_ISSUERS = [
  'leonteq', 'vontobel', 'ubs', 'credit suisse', 'cs', 'julius baer',
  'societe generale', 'sg issuer', 'bnp paribas', 'barclays',
  'raiffeisen', 'zurcher kantonalbank', 'zkb', 'citigroup', 'morgan stanley',
  'goldman sachs', 'jpmorgan', 'hsbc', 'natixis', 'commerzbank', 'eba'
];

/**
 * Keywords that indicate structured products in security names.
 */
const STRUCTURED_PRODUCT_KEYWORDS = [
  'autocall', 'phoenix', 'express', 'reverse conv', 'rev conv', 'revconv',
  'barrier', 'cap prot', 'capital prot', 'bar.cap', 'cap.prot',
  'certificate', 'cert.', 'tracker', 'bonus', 'discount',
  'memory coupon', 'snowball', 'worst of', 'best of',
  'participation', 'yield enhancement', 'income note', 'linked note',
  'knock-in', 'knock-out', 'twin-win', 'athena', 'callable'
];

/**
 * Secondary classification function that applies heuristics when parser returns UNKNOWN.
 * This provides fallback classification based on:
 * 1. Security name keywords
 * 2. ISIN prefix patterns
 * 3. Known issuer names
 *
 * @param {object} holding - Holding object with isin, securityName, securityType, etc.
 * @returns {string} Best-effort security type classification
 */
export function classifyWithFallback(holding) {
  const currentType = holding.securityType || holding.type;

  // If already classified (not UNKNOWN), use existing classification
  if (currentType && currentType !== SECURITY_TYPES.UNKNOWN) {
    return currentType;
  }

  const isin = (holding.isin || '').toUpperCase();
  const name = (holding.securityName || holding.name || '').toLowerCase();
  const issuer = (holding.issuer || holding.bankSpecificData?.instrumentIssuer?.name || '').toLowerCase();

  // 1. NAME-BASED DETECTION: Structured Products
  for (const keyword of STRUCTURED_PRODUCT_KEYWORDS) {
    if (name.includes(keyword)) {
      console.log(`[CLASSIFY] ${isin}: Detected STRUCTURED_PRODUCT via keyword "${keyword}"`);
      return SECURITY_TYPES.STRUCTURED_PRODUCT;
    }
  }

  // 2. ISSUER-BASED DETECTION: Known structured product issuers
  for (const spIssuer of STRUCTURED_PRODUCT_ISSUERS) {
    if (name.includes(spIssuer) || issuer.includes(spIssuer)) {
      // Check if it has product-like characteristics (certificates, notes)
      if (name.includes('cert') || name.includes('note') || name.includes('bdc') ||
          name.includes('issue') || /\d{4}[-/]\d{2}[-/]\d{2}/.test(name)) { // Date pattern = maturity
        console.log(`[CLASSIFY] ${isin}: Detected STRUCTURED_PRODUCT via issuer "${spIssuer}"`);
        return SECURITY_TYPES.STRUCTURED_PRODUCT;
      }
    }
  }

  // 3. NAME-BASED DETECTION: ETFs
  if (name.includes('etf') || name.includes('exchange traded') ||
      name.includes('ishares') || name.includes('spdr') || name.includes('vanguard') ||
      name.includes('lyxor') || name.includes('amundi index') || name.includes('xtrackers')) {
    console.log(`[CLASSIFY] ${isin}: Detected ETF via name`);
    return SECURITY_TYPES.ETF;
  }

  // 4. NAME-BASED DETECTION: Funds
  if (name.includes('fund') || name.includes('fonds') || name.includes('sicav') ||
      name.includes('ucits') || name.includes('fcp') || name.includes('plc')) {
    console.log(`[CLASSIFY] ${isin}: Detected FUND via name`);
    return SECURITY_TYPES.FUND;
  }

  // 5. NAME-BASED DETECTION: Bonds
  if (name.includes('bond') || name.includes('oblig') || name.includes('treasury') ||
      name.includes('note ') && name.match(/\d{4}/) ||  // "Note 2025" pattern
      name.includes('tbill') || name.includes('gilt')) {
    console.log(`[CLASSIFY] ${isin}: Detected BOND via name`);
    return SECURITY_TYPES.BOND;
  }

  // 6. NAME-BASED DETECTION: Private Equity
  if (name.includes('private equity') || name.includes('buyout') ||
      name.includes('venture capital') || name.includes('pe fund') ||
      name.includes('growth equity')) {
    console.log(`[CLASSIFY] ${isin}: Detected PRIVATE_EQUITY via name`);
    return SECURITY_TYPES.PRIVATE_EQUITY;
  }

  // 7. ISIN PREFIX DETECTION (limited reliability, use as last resort)
  // XS prefix is common for structured products (Eurobond clearing)
  if (isin.startsWith('XS') && (name.includes('cert') || name.includes('note') ||
      name.includes('cap') || /\d{4}/.test(name))) {
    console.log(`[CLASSIFY] ${isin}: Detected STRUCTURED_PRODUCT via XS prefix + keywords`);
    return SECURITY_TYPES.STRUCTURED_PRODUCT;
  }

  // 8. If we still can't classify, return UNKNOWN
  console.log(`[CLASSIFY] ${isin}: Unable to classify, returning UNKNOWN`);
  return SECURITY_TYPES.UNKNOWN;
}
