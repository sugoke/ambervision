/**
 * Shared Cash Calculator Helper
 *
 * Provides unified cash calculation logic for both:
 * - Cash Monitor (rmDashboardMethods.js)
 * - Negative Cash Notifications (bankPositionMethods.js)
 *
 * This ensures consistent values are shown across the application.
 */

/**
 * Extract bank-provided FX rates from holdings and convert to multiplier format
 * Bank rates are stored in "divide" format (EUR = amount / rate), but our
 * convertToEUR function uses "multiply" format (EUR = amount * rate).
 *
 * @param {Array} holdings - Array of PMSHoldings documents with bankFxRates field
 * @returns {Object} - Map of currency code to EUR conversion multiplier
 */
export const extractBankFxRates = (holdings) => {
  const bankRates = {};

  for (const holding of holdings) {
    if (holding.bankFxRates && typeof holding.bankFxRates === 'object') {
      for (const [currency, rate] of Object.entries(holding.bankFxRates)) {
        // Skip if already have a rate for this currency or if rate is invalid
        if (bankRates[currency] || !rate || rate === 0) continue;

        // Convert from "divide" format to "multiply" format
        // Bank stores: EUR = amount / rate
        // We need: EUR = amount * multiplier, so multiplier = 1 / rate
        bankRates[currency] = 1 / rate;
      }
    }
  }

  return bankRates;
};

/**
 * Merge bank-provided FX rates with EOD API rates
 * Bank rates take priority (for consistency with bank statements)
 *
 * @param {Object} eodRatesMap - Rates from buildRatesMap() using EOD API
 * @param {Object} bankRatesMap - Rates from extractBankFxRates()
 * @returns {Object} - Merged rates map with bank rates taking priority
 */
export const mergeRatesMaps = (eodRatesMap, bankRatesMap) => {
  const merged = { ...eodRatesMap };
  let bankRatesUsed = 0;
  const newCurrencies = [];

  for (const [currency, rate] of Object.entries(bankRatesMap)) {
    if (rate && rate !== 0) {
      if (!merged[currency]) {
        newCurrencies.push(currency);
      }
      // Bank rate takes priority
      merged[currency] = rate;
      bankRatesUsed++;
    }
  }

  // Log summary instead of individual rates
  if (bankRatesUsed > 0) {
    const newCurrenciesInfo = newCurrencies.length > 0
      ? ` (${newCurrencies.length} new: ${newCurrencies.slice(0, 5).join(', ')}${newCurrencies.length > 5 ? '...' : ''})`
      : '';
    console.log(`[CashCalculator] Merged ${bankRatesUsed} bank-provided FX rates${newCurrenciesInfo}`);
  }

  return merged;
};

/**
 * Convert a value to EUR using the rates map
 * @param {number} value - The value to convert
 * @param {string} currency - The source currency
 * @param {Object} ratesMap - Map of currency to EUR conversion rates
 * @returns {number} - Value in EUR
 */
export const convertToEUR = (value, currency, ratesMap) => {
  if (!value || isNaN(value)) return 0;
  if (currency === 'EUR') return value;

  const rate = ratesMap[currency];
  if (rate) {
    return value * rate;
  }

  // If no rate found, return original value (assume EUR or log warning)
  console.warn(`[CashCalculator] No EUR rate found for ${currency}, using value as-is`);
  return value;
};

/**
 * Build a rates map from currency rate cache entries
 * Handles CurrencyRateCacheCollection format with pairs like "EURUSD.FOREX"
 * @param {Array} currencyRates - Array of currency rate cache documents with pair and rate fields
 * @returns {Object} - Map of currency code to EUR conversion multiplier
 */
export const buildRatesMap = (currencyRates) => {
  const ratesMap = {};

  // First pass: collect all FOREX pair rates
  const pairRates = {};
  currencyRates.forEach(entry => {
    if (entry.pair && entry.rate) {
      pairRates[entry.pair] = entry.rate;
    }
  });

  // Convert pairs to currency -> EUR multipliers
  // For EUR/XXX pairs (e.g., EURUSD.FOREX): 1 EUR = rate XXX, so XXX -> EUR = 1/rate
  // For XXX/USD pairs: need to go through USD intermediate

  // Direct EUR pairs first
  Object.keys(pairRates).forEach(pair => {
    const cleanPair = pair.replace('.FOREX', '');
    if (cleanPair.startsWith('EUR')) {
      // EUR is base currency (e.g., EURUSD = 1.08 means 1 EUR = 1.08 USD)
      const targetCurrency = cleanPair.substring(3);
      // To convert targetCurrency to EUR, divide by rate
      ratesMap[targetCurrency] = 1 / pairRates[pair];
    }
  });

  // Get USD to EUR rate (via EURUSD pair)
  const eurusdRate = pairRates['EURUSD.FOREX'];
  const usdToEur = eurusdRate ? 1 / eurusdRate : null;

  if (usdToEur) {
    ratesMap['USD'] = usdToEur;

    // Process XXX/USD pairs using USD as intermediate
    Object.keys(pairRates).forEach(pair => {
      const cleanPair = pair.replace('.FOREX', '');

      // Skip EUR pairs (already handled)
      if (cleanPair.startsWith('EUR')) return;

      if (cleanPair.endsWith('USD')) {
        // XXX/USD pair (e.g., GBPUSD = 1.27 means 1 GBP = 1.27 USD)
        const baseCurrency = cleanPair.substring(0, cleanPair.length - 3);
        if (!ratesMap[baseCurrency]) {
          // GBP -> USD -> EUR: amount * gbpusd * usdToEur
          ratesMap[baseCurrency] = pairRates[pair] * usdToEur;
        }
      } else if (cleanPair.startsWith('USD')) {
        // USD/XXX pair (e.g., USDCHF = 0.88 means 1 USD = 0.88 CHF)
        const targetCurrency = cleanPair.substring(3);
        if (!ratesMap[targetCurrency]) {
          // CHF -> USD -> EUR: amount / usdchf * usdToEur
          ratesMap[targetCurrency] = (1 / pairRates[pair]) * usdToEur;
        }
      }
    });
  }

  // EUR to EUR is always 1
  ratesMap['EUR'] = 1;
  return ratesMap;
};

/**
 * Calculate cash values for a set of holdings
 * Uses dual-path logic:
 * - pureCashEUR: Only pure CASH holdings (for negative balance detection)
 * - totalCashEquivalentEUR: Includes monetary products & time deposits (for high cash detection)
 *
 * @param {Array} holdings - Array of PMSHoldings documents
 * @param {Object|Map} ratesMap - Map of currency to EUR conversion rates (or FOREX pairs Map)
 * @param {Set} cashEquivalentISINs - Set of ISINs classified as cash equivalents
 * @param {Function} convertFn - Optional custom conversion function (value, currency, ratesMap) => eurValue
 * @returns {Object} - { pureCashEUR, totalCashEquivalentEUR, pureCashBreakdown, allCashBreakdown, cashByCurrency }
 */
export const calculateCashForHoldings = (holdings, ratesMap, cashEquivalentISINs = new Set(), convertFn = null) => {
  // Use custom conversion function if provided, otherwise use the built-in one
  const toEUR = convertFn || ((value, currency, rates) => convertToEUR(value, currency, rates));

  let pureCashEUR = 0;
  let totalCashEquivalentEUR = 0;
  const pureCashBreakdown = [];
  const allCashBreakdown = [];

  // Also aggregate by currency for notification messages
  const cashByCurrency = {};

  for (const holding of holdings) {
    // Check if pure cash (for negative cash alerts)
    const isPureCash = holding.securityType === 'CASH' ||
      (holding.securityType && /cash/i.test(holding.securityType)) ||
      holding.assetClass === 'cash' ||
      (holding.assetClass && /^cash$/i.test(holding.assetClass));

    // Check if cash equivalent (for high cash alerts - includes money market funds, time deposits)
    const isCashEquivalent = isPureCash ||
      (holding.isin && cashEquivalentISINs.has(holding.isin));

    if (isPureCash || isCashEquivalent) {
      // Use marketValue (already in portfolio currency) or quantity for cash
      const value = holding.marketValue || holding.quantity || 0;
      const currency = holding.portfolioCurrency || holding.currency || 'EUR';
      const eurValue = toEUR(value, currency, ratesMap);

      // Get the value in the position's original/native currency for display purposes
      const originalCurrencyValue = holding.marketValueOriginalCurrency ?? holding.marketValue ?? holding.quantity ?? 0;

      const breakdownItem = {
        name: holding.securityName || `Cash ${holding.currency}`,
        type: holding.securityType,
        assetClass: holding.assetClass,
        currency: holding.currency,
        originalValue: originalCurrencyValue,  // Value in native currency (not portfolio currency)
        eurValue,
        isPureCash,
        isCashEquivalent
      };

      if (isPureCash) {
        pureCashEUR += eurValue;
        pureCashBreakdown.push(breakdownItem);

        // Aggregate by currency for pure cash
        // Use holding.currency (native currency) as the key
        const curr = holding.currency || 'EUR';
        if (!cashByCurrency[curr]) {
          cashByCurrency[curr] = { currency: curr, totalValue: 0, eurValue: 0, holdings: [] };
        }
        // Use originalCurrencyValue (defined above) for the per-currency total
        // This ensures the notification shows the correct value in the native currency
        cashByCurrency[curr].totalValue += originalCurrencyValue;
        cashByCurrency[curr].eurValue += eurValue;
        cashByCurrency[curr].holdings.push(holding);
      }

      if (isCashEquivalent) {
        totalCashEquivalentEUR += eurValue;
        allCashBreakdown.push(breakdownItem);
      }
    }
  }

  // Find currencies with negative NET balance
  const negativeCurrencies = Object.values(cashByCurrency).filter(c => c.totalValue < 0);
  const totalNegativeCashEUR = negativeCurrencies.reduce((sum, c) => sum + Math.abs(c.eurValue), 0);

  return {
    pureCashEUR,
    totalCashEquivalentEUR,
    pureCashBreakdown,
    allCashBreakdown,
    cashByCurrency,
    negativeCurrencies,
    totalNegativeCashEUR
  };
};

/**
 * High-level function to check if an account has negative cash exceeding overdraft
 *
 * @param {Array} holdings - Array of PMSHoldings documents
 * @param {Object} ratesMap - Map of currency to EUR conversion rates (from EOD API)
 * @param {Set} cashEquivalentISINs - Set of ISINs classified as cash equivalents
 * @param {number} authorizedOverdraft - Authorized overdraft amount
 * @param {string} overdraftCurrency - Currency of the authorized overdraft
 * @returns {Object} - { hasNegativeCash, exceedsOverdraft, excessAmount, details }
 */
export const checkNegativeCash = (holdings, ratesMap, cashEquivalentISINs, authorizedOverdraft = 0, overdraftCurrency = 'EUR') => {
  // Extract bank-provided FX rates from holdings and merge with EOD rates
  // Bank rates take priority for consistency with bank statements
  const bankRates = extractBankFxRates(holdings);
  const mergedRatesMap = mergeRatesMaps(ratesMap, bankRates);

  const cashResult = calculateCashForHoldings(holdings, mergedRatesMap, cashEquivalentISINs);

  // Convert authorized overdraft to EUR for comparison
  const authorizedOverdraftEUR = convertToEUR(authorizedOverdraft, overdraftCurrency, mergedRatesMap);

  const hasNegativeCash = cashResult.pureCashEUR < 0;
  const exceedsOverdraft = hasNegativeCash && Math.abs(cashResult.pureCashEUR) > authorizedOverdraftEUR;
  const excessAmount = exceedsOverdraft ? Math.abs(cashResult.pureCashEUR) - authorizedOverdraftEUR : 0;

  return {
    hasNegativeCash,
    exceedsOverdraft,
    excessAmount,
    pureCashEUR: cashResult.pureCashEUR,
    totalCashEquivalentEUR: cashResult.totalCashEquivalentEUR,
    authorizedOverdraftEUR,
    negativeCurrencies: cashResult.negativeCurrencies,
    totalNegativeCashEUR: cashResult.totalNegativeCashEUR,
    breakdown: cashResult.pureCashBreakdown,
    cashByCurrency: cashResult.cashByCurrency
  };
};

/**
 * Check if an account has high cash (above threshold)
 *
 * @param {Array} holdings - Array of PMSHoldings documents
 * @param {Object} ratesMap - Map of currency to EUR conversion rates (from EOD API)
 * @param {Set} cashEquivalentISINs - Set of ISINs classified as cash equivalents
 * @param {number} threshold - Threshold in EUR (default 200,000)
 * @returns {Object} - { hasHighCash, excessAmount, totalCashEUR, breakdown }
 */
export const checkHighCash = (holdings, ratesMap, cashEquivalentISINs, threshold = 200000) => {
  // Extract bank-provided FX rates from holdings and merge with EOD rates
  const bankRates = extractBankFxRates(holdings);
  const mergedRatesMap = mergeRatesMaps(ratesMap, bankRates);

  const cashResult = calculateCashForHoldings(holdings, mergedRatesMap, cashEquivalentISINs);

  const hasHighCash = cashResult.totalCashEquivalentEUR > threshold;
  const excessAmount = hasHighCash ? cashResult.totalCashEquivalentEUR - threshold : 0;

  return {
    hasHighCash,
    excessAmount,
    totalCashEUR: cashResult.totalCashEquivalentEUR,
    breakdown: cashResult.allCashBreakdown
  };
};
