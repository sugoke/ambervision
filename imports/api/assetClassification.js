/**
 * Asset classification — single source of truth
 *
 * Turns a holding into the granular category key that
 * `aggregateToFourCategories()` (accountProfiles.js) folds into the four
 * investment-profile buckets (cash / bonds / equities / alternative).
 *
 * This logic used to be copy-pasted in four places (portfolio snapshots, the
 * PMS screen, the portfolio review generator and the order pre-trade check).
 * They drifted: three of them treated an equity-linked barrier product as
 * equity risk while the snapshot builder still counted it as a bond, so the
 * allocation alert fired "Bonds: 78.6%" on an account holding nothing but
 * Phoenix autocallables. Every producer must call this module instead.
 *
 * Classification priority for a holding:
 *   1. Curated securities metadata (matched on ISIN)
 *   2. The holding's own enrichment fields (assetClass + structured product types)
 *   3. Heuristics on the raw bank security type / name
 */

// A structured product whose underlying we don't know is assumed equity-linked:
// that is by far the common case, and it is the prudent assumption because it
// keeps the position in the higher-risk bucket rather than hiding it in bonds.
export const DEFAULT_STRUCTURED_PRODUCT_UNDERLYING = 'equity_linked';

/**
 * Heuristic classification from the raw bank fields, used only when neither
 * the securities metadata nor the holding itself tells us what the position is.
 * @param {Object} holding - { securityType, securityName }
 * @returns {Object} { assetClass, subClass, protectionType }
 */
export const detectAssetClassFromSecurity = (holding = {}) => {
  const type = String(holding.securityType || '').trim().toLowerCase();
  const name = (holding.securityName || '').toLowerCase();

  const result = { assetClass: 'other', subClass: null, protectionType: null };

  // STRUCTURED PRODUCTS - check FIRST, some carry misleading bank type codes
  // Type 19 is Julius Baer's code for structured products/certificates
  const isStructuredByType = type === 'certificate' || type === 'structured' || type === '19';
  const isStructuredByIssuer = name.includes('sg issuer') || name.includes('julius baer express') ||
      name.includes('bnp paribas iss') || name.includes('raiffeisen ch') ||
      name.includes('banque intern') || name.includes('credit suisse ag') ||
      name.includes('credit agricole') || name.includes('citigroup') ||
      name.includes('ubs ag') || name.includes('vontobel');
  const isStructuredByName = name.includes('autocallable') || name.includes('phoenix') ||
      name.includes('orion') || name.includes('himalaya') || name.includes('reverse convertible') ||
      name.includes('bar.cap') || name.includes('barrier') || name.includes('express') ||
      name.includes('cap.prot') || name.includes('capital prot') ||
      (name.includes('cert') && !name.includes('certificate of deposit'));

  if (isStructuredByType || isStructuredByIssuer || isStructuredByName) {
    result.assetClass = 'structured_product';
    if (name.includes('capital guaranteed') || name.includes('cap.prot') ||
        name.includes('capital protection') || name.includes('100%')) {
      result.protectionType = 'capital_guaranteed_100';
    } else if (name.includes('bar.cap') || name.includes('barrier')) {
      result.protectionType = 'capital_protected_conditional';
    }
  } else if (type === '13' || name.includes('private equity') || name.includes('schroders capital') ||
      name.includes('kkr') || name.includes('blackstone')) {
    result.assetClass = 'private_equity';
  } else if (type === 'money_market_fund' || (name.includes('money market') && name.includes('fund'))) {
    result.assetClass = 'monetary_products';
  } else if (type === 'fund' || type === 'etf' || name.includes('sicav') || name.includes('ucits')) {
    result.assetClass = 'fund';
  } else if (type === '1' || type === 'equity' || type === 'stock') {
    result.assetClass = 'equity';
    result.subClass = (name.includes('fund') || name.includes('etf')) ? 'equity_fund' : 'direct_equity';
  } else if (type === '2' || type === 'bond' || name.includes('treasury')) {
    result.assetClass = 'fixed_income';
    result.subClass = name.includes('fund') ? 'fixed_income_fund' : 'direct_bond';
  } else if (type === 'cash') {
    result.assetClass = 'cash';
  } else if (type === 'term_deposit' || name.includes('term deposit') || name.includes('time deposit') || name.includes('fixed deposit')) {
    result.assetClass = 'time_deposit';
  } else if (name.includes('gold') || name.includes('commodity') || name.includes('metal')) {
    result.assetClass = 'commodities';
  }

  return result;
};

/**
 * Resolve what a holding actually is, from the best source available.
 * @param {Object} holding - A PMS holding (or any position-shaped object)
 * @param {Object} [metadata] - The SecuritiesMetadata record for holding.isin
 * @returns {Object} { assetClass, subClass, underlyingType, protectionType }
 */
export const classifyHolding = (holding = {}, metadata = null) => {
  let assetClass = 'other';
  let subClass = null;
  let underlyingType = null;
  let protectionType = null;

  // Priority 1: curated securities metadata
  if (metadata && metadata.assetClass) {
    assetClass = metadata.assetClass;
    subClass = metadata.assetSubClass || null;
    underlyingType = metadata.structuredProductUnderlyingType || null;
    protectionType = metadata.structuredProductProtectionType || null;
  }

  // Priority 2: the holding's own enrichment (Ambervision / bank-specific data)
  if (assetClass === 'other' && holding.assetClass) {
    assetClass = holding.assetClass;
    underlyingType = holding.structuredProductUnderlyingType ||
      holding.bankSpecificData?.structuredProductUnderlyingType || underlyingType;
    protectionType = holding.structuredProductProtectionType ||
      holding.bankSpecificData?.structuredProductProtectionType || protectionType;
  }

  // Priority 3: heuristics on the raw bank fields
  if (assetClass === 'other') {
    const detected = detectAssetClassFromSecurity(holding);
    assetClass = detected.assetClass;
    subClass = detected.subClass || subClass;
    protectionType = detected.protectionType || protectionType;
  }

  return { assetClass, subClass, underlyingType, protectionType };
};

/**
 * Build the granular breakdown key from a classification.
 *
 * Structured products key on protection first, because protection is what
 * decides the risk bucket — with one exception: conditional ("barrier")
 * protection is NOT capital protection. If the barrier breaks the investor is
 * long the underlying, so an equity-linked barrier product carries equity risk
 * and keeps its underlying in the key.
 *
 * @param {Object} classification - { assetClass, subClass, underlyingType, protectionType }
 * @returns {String} Category key, e.g. 'structured_product_equity_linked_barrier_protected'
 */
export const buildCategoryKey = ({ assetClass, subClass, underlyingType, protectionType } = {}) => {
  if (assetClass === 'structured_product') {
    if (protectionType === 'capital_guaranteed_100') {
      return 'structured_product_capital_guaranteed';
    }
    if (protectionType === 'capital_guaranteed_partial') {
      return 'structured_product_partial_guarantee';
    }
    if (protectionType === 'capital_protected_conditional') {
      const underlying = underlyingType || DEFAULT_STRUCTURED_PRODUCT_UNDERLYING;
      return underlying === 'equity_linked'
        ? 'structured_product_equity_linked_barrier_protected'
        : 'structured_product_barrier_protected';
    }
    if (underlyingType) {
      return `structured_product_${underlyingType}`;
    }
    return 'structured_product';
  }

  if (assetClass === 'equity' && subClass) return `equity_${subClass}`;
  if (assetClass === 'fixed_income' && subClass) return `fixed_income_${subClass}`;

  return assetClass;
};

/**
 * Convenience: classify a holding and return its breakdown key in one call.
 * @param {Object} holding
 * @param {Object} [metadata] - SecuritiesMetadata record for holding.isin
 * @returns {String} Category key
 */
export const getHoldingCategoryKey = (holding, metadata = null) =>
  buildCategoryKey(classifyHolding(holding, metadata));

/**
 * Accumulate holdings into a granular breakdown keyed by category.
 * @param {Array} holdings
 * @param {Object} [metadataByIsin] - Map of isin -> SecuritiesMetadata record
 * @returns {Object} { breakdown, totalValue }
 */
export const buildAssetClassBreakdown = (holdings = [], metadataByIsin = {}) => {
  const breakdown = {};
  let totalValue = 0;

  holdings.forEach(holding => {
    const key = getHoldingCategoryKey(holding, holding.isin ? metadataByIsin[holding.isin] : null);
    const marketValue = holding.marketValue || 0;
    breakdown[key] = (breakdown[key] || 0) + marketValue;
    totalValue += marketValue;
  });

  return { breakdown, totalValue };
};
