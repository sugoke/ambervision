import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const AccountProfilesCollection = new Mongo.Collection('accountProfiles');

/**
 * AccountProfiles Schema:
 * {
 *   _id: String,
 *   bankAccountId: String,      // Reference to BankAccountsCollection
 *   minCash: Number,            // 0-100 (min % for Cash/Short Term)
 *   maxCash: Number,            // 0-100 (max % for Cash/Short Term)
 *   minBonds: Number,           // 0-100 (min % for Bonds and similar)
 *   maxBonds: Number,           // 0-100 (max % for Bonds and similar)
 *   minEquities: Number,        // 0-100 (min % for Equities and similar)
 *   maxEquities: Number,        // 0-100 (max % for Equities and similar)
 *   minAlternative: Number,     // 0-100 (min % for Alternative investments)
 *   maxAlternative: Number,     // 0-100 (max % for Alternative investments)
 *   noProfile: Boolean,         // true = "No profile": not an investment account, no limits checked
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
    // A listed option is a derivative exposure, not the underlying asset class.
    // Note only BUY orders reach the allocation check, and the value booked is
    // the premium, not the notional the contract controls.
    case 'option':
      return 'alternative';
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
    case 'option':
      return 'other';
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

// The four asset-class categories of an investment profile.
// Field names are derived (min/max + key) so all profile code stays generic.
export const PROFILE_CATEGORIES = [
  { key: 'Cash', label: 'Cash', shortLabel: 'Cash', allocationKey: 'cash' },
  { key: 'Bonds', label: 'Bonds', shortLabel: 'Bonds', allocationKey: 'bonds' },
  { key: 'Equities', label: 'Equities', shortLabel: 'Equities', allocationKey: 'equities' },
  { key: 'Alternative', label: 'Alternative', shortLabel: 'Alt.', allocationKey: 'alternative' }
];

export const PROFILE_LIMIT_FIELDS = PROFILE_CATEGORIES.flatMap(c => [`min${c.key}`, `max${c.key}`]);

// Predefined profile templates
// Templates define maximum exposures; minimums default to 0 (no floor).
export const PROFILE_TEMPLATES = {
  'flexible-security': {
    name: 'Flexible Security',
    minCash: 0,
    maxCash: 100,
    minBonds: 0,
    maxBonds: 100,
    minEquities: 0,
    maxEquities: 0,
    minAlternative: 0,
    maxAlternative: 0
  },
  'flexible-conservative': {
    name: 'Flexible Conservative',
    minCash: 0,
    maxCash: 100,
    minBonds: 0,
    maxBonds: 100,
    minEquities: 0,
    maxEquities: 30,
    minAlternative: 0,
    maxAlternative: 0
  },
  'flexible-balanced': {
    name: 'Flexible Balanced',
    minCash: 0,
    maxCash: 100,
    minBonds: 0,
    maxBonds: 75,
    minEquities: 0,
    maxEquities: 50,
    minAlternative: 0,
    maxAlternative: 25
  },
  'flexible-dynamic': {
    name: 'Flexible Dynamic',
    minCash: 0,
    maxCash: 100,
    minBonds: 0,
    maxBonds: 100,
    minEquities: 0,
    maxEquities: 100,
    minAlternative: 0,
    maxAlternative: 100
  },
  'flexible': {
    name: 'Flexible',
    minCash: 0,
    maxCash: 0,
    minBonds: 0,
    maxBonds: 0,
    minEquities: 0,
    maxEquities: 0,
    minAlternative: 0,
    maxAlternative: 0
  }
};

// "No profile": the account is deliberately not run against an investment
// profile (current account, custody-only, ...). Stored as a profile document
// with noProfile: true so the choice is recorded; no limits apply to it.
export const NO_PROFILE_KEY = 'no-profile';
export const NO_PROFILE_NAME = 'No profile';

export const isNoProfile = (profile) => profile?.noProfile === true;

/**
 * The profile when it carries allocation limits to check against, else null.
 * Every limit check goes through this, so a "No profile" account is treated
 * exactly like an account without a profile.
 */
export const limitsProfile = (profile) => (profile && !isNoProfile(profile) ? profile : null);

// Mongo selector part excluding "No profile" documents from limit checks
export const WITH_LIMITS_SELECTOR = { noProfile: { $ne: true } };

/**
 * Read a profile limit, defaulting to 0 when the field is absent
 * (profiles created before minimums existed have no min* fields).
 */
export const getProfileLimit = (profile, field) => {
  const value = profile?.[field];
  return typeof value === 'number' ? value : 0;
};

/**
 * Format a category's min-max range for display, e.g. "0 - 75%"
 */
export const formatProfileRange = (profile, categoryKey) => {
  const min = getProfileLimit(profile, `min${categoryKey}`);
  const max = getProfileLimit(profile, `max${categoryKey}`);
  return `${min}% - ${max}%`;
};

/**
 * Derive profile name: use stored name first, then match against known templates
 */
export const getProfileName = (profile) => {
  if (!profile) return null;
  if (isNoProfile(profile)) return NO_PROFILE_NAME;
  if (profile.profileName) return profile.profileName;
  const match = Object.entries(PROFILE_TEMPLATES).find(([, tpl]) =>
    PROFILE_LIMIT_FIELDS.every(field => getProfileLimit(tpl, field) === getProfileLimit(profile, field))
  );
  return match ? match[1].name : 'Custom';
};

/**
 * Which profile bucket a structured-product category key belongs to.
 *
 * Keys are produced by buildCategoryKey() in assetClassification.js, e.g.
 * 'structured_product_capital_guaranteed', 'structured_product_equity_linked',
 * 'structured_product_equity_linked_barrier_protected'.
 *
 * Rule (profile classification): only an *unconditional* capital guarantee or
 * protection makes a structured product bond-like. Conditional ("barrier")
 * protection does not — if the barrier breaks the investor is long the
 * underlying — so an equity-linked barrier product belongs with the equities.
 *
 * @param {String} categoryKey - lower-cased category key
 * @returns {String} 'cash' | 'bonds' | 'equities' | 'alternative'
 */
export const classifyStructuredProductKey = (categoryKey) => {
  const key = String(categoryKey || '').toLowerCase();

  // Unconditional capital guarantee / protection -> Bonds
  if (key.includes('capital_guaranteed') || key.includes('partial_guarantee')) {
    return 'bonds';
  }

  // Non-equity underlyings
  if (key.includes('commodities') || key.includes('credit')) {
    return 'alternative';
  }
  if (key.includes('fixed_income')) {
    return 'bonds';
  }

  // Legacy key with no underlying recorded: kept bond-like for the non-equity
  // case it now exclusively marks (equity-linked barrier products carry their
  // underlying in the key instead).
  if (key === 'structured_product_barrier_protected') {
    return 'bonds';
  }

  // Equity-linked (barrier protected or not) and unknown -> Equities
  return 'equities';
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
    // Structured products - resolved by their own rules (protection + underlying)
    else if (lowerCategory.startsWith('structured_product')) {
      const spCategory = classifyStructuredProductKey(lowerCategory);
      if (spCategory === 'bonds') bonds += value;
      else if (spCategory === 'alternative') alternative += value;
      else equities += value;
    }
    // Alternative - check before the general equity check so private_equity
    // isn't swallowed by the 'equity' substring match
    else if (lowerCategory === 'private_equity' ||
             lowerCategory === 'private_debt' ||
             lowerCategory === 'commodities' ||
             lowerCategory === 'real_estate' ||
             lowerCategory === 'hedge_fund' ||
             lowerCategory === 'derivatives' ||
             lowerCategory === 'other') {
      alternative += value;
    }
    // Fixed Income / Bonds
    else if (lowerCategory.includes('fixed_income') ||
             lowerCategory.includes('bond') ||
             lowerCategory === 'convertible') {
      bonds += value;
    }
    // Equities
    else if (lowerCategory.includes('equity') ||
             lowerCategory.includes('stock')) {
      equities += value;
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
