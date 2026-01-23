/**
 * Underlying Type Detector Utility
 *
 * Extracts the sophisticated underlying type detection logic into a shared utility
 * that can be used by:
 * - syncProductsToSecuritiesMetadata migration
 * - securitiesMethods.js bulk classification
 * - re-enrichment methods after bank sync
 *
 * This ensures consistent classification of structured products based on their
 * underlying assets, which determines whether they appear under Equities,
 * Fixed Income, Commodities, etc. in the 4-category allocation view.
 */

/**
 * Detect the underlying type from a product's underlyings array
 *
 * @param {Array} underlyings - Array of underlying objects from a product
 * @returns {string} - One of: 'equity_linked', 'fixed_income_linked', 'commodities_linked', 'credit_linked'
 *
 * @example
 * const underlyingType = detectUnderlyingType([
 *   { name: 'Apple Inc', ticker: 'AAPL', type: 'stock' }
 * ]);
 * // Returns: 'equity_linked'
 *
 * @example
 * const underlyingType = detectUnderlyingType([
 *   { name: 'Gold Spot', ticker: 'GC', type: 'commodity' }
 * ]);
 * // Returns: 'commodities_linked'
 */
export function detectUnderlyingType(underlyings) {
  // Default to equity_linked (most common for structured products)
  if (!underlyings || underlyings.length === 0) {
    return 'equity_linked';
  }

  // Analyze all underlyings and collect detected types
  const detectedTypes = underlyings.map(underlying => {
    const name = (underlying.name || '').toLowerCase();
    const type = (underlying.type || '').toLowerCase();
    const ticker = (underlying.ticker || underlying.symbol || '').toUpperCase();

    // Check for commodities
    // - Name keywords: gold, silver, oil, copper, platinum, palladium, natural gas
    // - Ticker codes: GC (gold), SI (silver), CL (crude oil), HG (copper)
    if (
      name.includes('gold') ||
      name.includes('silver') ||
      name.includes('oil') ||
      name.includes('copper') ||
      name.includes('platinum') ||
      name.includes('palladium') ||
      name.includes('natural gas') ||
      name.includes('brent') ||
      name.includes('wti') ||
      type === 'commodity' ||
      ticker === 'GC' ||
      ticker === 'SI' ||
      ticker === 'CL' ||
      ticker === 'HG' ||
      ticker === 'PL' ||
      ticker === 'PA' ||
      ticker === 'NG' ||
      ticker.includes('.COMM')
    ) {
      return 'commodities_linked';
    }

    // Check for bonds/fixed income
    // - Name keywords: bond, treasury, government, sovereign, corporate bond
    // - Type field: bond, fixed_income
    // - Ticker patterns: .BOND suffix
    if (
      name.includes('bond') ||
      name.includes('treasury') ||
      name.includes('government') ||
      name.includes('sovereign') ||
      name.includes('bund') ||
      name.includes('gilt') ||
      name.includes('oat') ||
      type === 'bond' ||
      type === 'fixed_income' ||
      ticker.includes('.BOND') ||
      ticker.includes('BOND')
    ) {
      return 'fixed_income_linked';
    }

    // Check for credit-linked (CDS, credit derivatives)
    // - Name keywords: credit, cds, credit default
    if (
      name.includes('credit') ||
      name.includes('cds') ||
      name.includes('credit default') ||
      type === 'credit' ||
      type === 'cds'
    ) {
      return 'credit_linked';
    }

    // Check for FX/currency-linked
    // - Name keywords: forex, currency, fx
    // - Ticker patterns: common currency pairs
    if (
      name.includes('forex') ||
      name.includes('currency') ||
      name.includes('fx ') ||
      type === 'fx' ||
      type === 'currency' ||
      ticker.includes('USD') && ticker.includes('EUR') ||
      ticker.includes('USD') && ticker.includes('JPY') ||
      ticker.includes('USD') && ticker.includes('GBP')
    ) {
      return 'fx_linked';
    }

    // Default to equity (stocks, indices, ETFs - most common)
    return 'equity_linked';
  });

  // Priority: If any underlying is non-equity, use that type
  // This handles mixed baskets where we want to flag the non-equity component
  // Priority order: commodities > fixed_income > credit > fx > equity
  if (detectedTypes.includes('commodities_linked')) {
    return 'commodities_linked';
  }
  if (detectedTypes.includes('fixed_income_linked')) {
    return 'fixed_income_linked';
  }
  if (detectedTypes.includes('credit_linked')) {
    return 'credit_linked';
  }
  if (detectedTypes.includes('fx_linked')) {
    return 'fx_linked';
  }

  // Default: equity_linked (most common for structured products)
  return 'equity_linked';
}

/**
 * Check if a single underlying is equity-based
 *
 * @param {Object} underlying - Single underlying object
 * @returns {boolean} - True if the underlying is equity-based
 */
export function isEquityUnderlying(underlying) {
  if (!underlying) return true; // Default to equity

  const name = (underlying.name || '').toLowerCase();
  const type = (underlying.type || '').toLowerCase();
  const ticker = (underlying.ticker || underlying.symbol || '').toUpperCase();

  // Check for non-equity indicators
  const isCommodity = name.includes('gold') || name.includes('silver') ||
                     name.includes('oil') || name.includes('copper') ||
                     ticker === 'GC' || ticker === 'SI' || ticker === 'CL';

  const isFixedIncome = name.includes('bond') || name.includes('treasury') ||
                        type === 'bond' || type === 'fixed_income';

  const isCredit = name.includes('credit') || name.includes('cds');

  const isFX = name.includes('forex') || name.includes('currency') ||
               type === 'fx' || type === 'currency';

  return !(isCommodity || isFixedIncome || isCredit || isFX);
}

/**
 * Get a human-readable label for the underlying type
 *
 * @param {string} underlyingType - The underlying type code
 * @returns {string} - Human-readable label
 */
export function getUnderlyingTypeLabel(underlyingType) {
  const labels = {
    'equity_linked': 'Equity-Linked',
    'fixed_income_linked': 'Fixed Income-Linked',
    'commodities_linked': 'Commodities-Linked',
    'credit_linked': 'Credit-Linked',
    'fx_linked': 'FX-Linked'
  };
  return labels[underlyingType] || 'Unknown';
}
