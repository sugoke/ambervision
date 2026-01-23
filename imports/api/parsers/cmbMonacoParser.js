/**
 * CMB Monaco Position File Parser
 *
 * Parses CMB Monaco CSV position files and converts to standardized schema
 *
 * Filename format: TAM_mba_eam_pos_list_bu_mc_YYYYMMDD.csv
 * Example: TAM_mba_eam_pos_list_bu_mc_20251211.csv
 *
 * Date format in CSV: DDMMYYYY (e.g., 12122025 = December 12, 2025)
 */

import { SECURITY_TYPES } from '../constants/instrumentTypes';
import { mapCMBOperationType, OPERATION_TYPES } from '../constants/operationTypes';

export const CMBMonacoParser = {
  /**
   * Bank identifier
   */
  bankName: 'CMB Monaco',

  /**
   * Portfolio Reference Currency Cache
   * Populated during parsing by detectPortfolioReferenceCurrencies()
   * Maps Portfolio_Number (stripped) → detected reference currency
   */
  detectedReferenceCurrencies: {},

  /**
   * Manual override for portfolio reference currencies
   * Format: Portfolio_Number (stripped) → reference currency
   * These take precedence over auto-detection
   */
  portfolioReferenceCurrencyOverrides: {
    // Example overrides:
    // '302894.001': 'USD',
    // '304435.001': 'EUR',
  },

  /**
   * Detect portfolio reference currencies from cash positions
   *
   * When Position_Value === Cost_Value_in_Ref_Ccy for a cash position,
   * that position's currency IS the portfolio's reference currency.
   *
   * @param {Array} rows - Parsed CSV rows
   * @returns {Object} Map of portfolioNumber → referenceCurrency
   */
  detectPortfolioReferenceCurrencies(rows) {
    const detected = {};

    for (const row of rows) {
      // Only check cash positions
      if (row.Asset_Class_ID !== 'cash') continue;

      const portfolioNumber = this.stripLeadingZeros(row.Portfolio_Number);
      const positionCurrency = row.Ccy;
      const positionValue = this.parseNumber(row.Position_Value);
      const costRefValue = this.parseNumber(row.Cost_Value_in_Ref_Ccy);

      // Skip zero or null values
      if (!positionValue || positionValue === 0) continue;

      // If Position_Value equals Cost_Value_in_Ref_Ccy (within 0.01 tolerance for rounding),
      // this currency is the reference currency
      if (Math.abs(positionValue - costRefValue) < 0.01) {
        if (!detected[portfolioNumber]) {
          detected[portfolioNumber] = positionCurrency;
          console.log(`[CMB_PARSER] Auto-detected reference currency for ${portfolioNumber}: ${positionCurrency}`);
        }
      }
    }

    return detected;
  },

  /**
   * Get portfolio reference currency
   * Priority: 1) Manual override, 2) Auto-detected, 3) Default EUR
   */
  getPortfolioReferenceCurrency(portfolioNumber) {
    const stripped = this.stripLeadingZeros(portfolioNumber);

    // Check manual override first
    if (this.portfolioReferenceCurrencyOverrides[stripped]) {
      return this.portfolioReferenceCurrencyOverrides[stripped];
    }

    // Check auto-detected
    if (this.detectedReferenceCurrencies[stripped]) {
      return this.detectedReferenceCurrencies[stripped];
    }

    // Default to EUR
    return 'EUR';
  },

  /**
   * Filename pattern for CMB Monaco position files
   */
  filenamePattern: /^TAM_mba_eam_pos_list_bu_mc_(\d{8})\.csv$/i,

  /**
   * Filename pattern for CMB Monaco operations/events files
   */
  operationsPattern: /^TAM_mba_eam_evt_list_bu_mc_(\d{8})\.csv$/i,

  /**
   * Filename pattern for CMB Monaco FX rates files
   */
  fxRatesPattern: /^TAM_mba_eam_curry_xchng_bu_mc_(\d{8})\.csv$/i,

  /**
   * Filename pattern for CMB Monaco asset list files
   */
  assetListPattern: /^TAM_mba_eam_asset_list_bu_mc_(\d{8})\.csv$/i,

  /**
   * Filename pattern for CMB Monaco business partner files
   */
  businessPartnerPattern: /^TAM_mba_eam_bp_list_bu_mc_(\d{8})\.csv$/i,

  /**
   * Check if filename matches CMB Monaco position pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Check if filename matches CMB Monaco operations pattern
   */
  matchesOperationsPattern(filename) {
    return this.operationsPattern.test(filename);
  },

  /**
   * Check if filename matches CMB Monaco FX rates pattern
   */
  matchesFxRatesPattern(filename) {
    return this.fxRatesPattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: TAM_mba_eam_pos_list_bu_mc_YYYYMMDD.csv
   * Returns: Date object
   */
  extractFileDate(filename) {
    // Try positions pattern first
    let match = filename.match(this.filenamePattern);
    if (!match) {
      // Try operations pattern
      match = filename.match(this.operationsPattern);
    }
    if (!match) {
      // Try FX rates pattern
      match = filename.match(this.fxRatesPattern);
    }
    if (!match) {
      throw new Error(`Filename does not match CMB Monaco pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // Month is 0-indexed
    const day = parseInt(dateStr.substring(6, 8));

    return new Date(year, month, day);
  },

  /**
   * Parse CSV content to array of objects
   * CMB Monaco uses semicolon delimiter
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV file is empty or has no data rows');
    }

    // First line is headers - CMB Monaco uses semicolon delimiter
    const headers = lines[0].split(';').map(h => h.trim());

    // Parse remaining lines
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      const values = line.split(';');
      const row = {};

      headers.forEach((header, index) => {
        row[header] = values[index] ? values[index].trim() : '';
      });

      rows.push(row);
    }

    return rows;
  },

  /**
   * Map security type from CMB Monaco Asset_Type_ID to standard type
   * Uses SECURITY_TYPES constants from instrumentTypes.js
   *
   * CMB Monaco Asset_Type_ID values:
   * - shs_ord, shs_reg: Equities (ordinary/registered shares)
   * - bond_fix, bond_var: Bonds (fixed/variable rate)
   * - fd_var, fd_shs: Funds (variable/shares)
   * - fd_mm: Money market funds
   * - fd_etf: ETFs
   * - struct_*: Structured products
   * - cert_*: Certificates
   * - opt_*, war_*, fut_*: Derivatives
   * - pe_*, priv_eq_*: Private equity
   * - pd_*, priv_debt_*: Private debt
   * - dep_term, td_*: Term deposits
   * - fx_fwd, fwd_*: FX forwards
   * - cash_acc: Cash accounts
   */
  mapSecurityType(row) {
    // Allow both old API (two strings) and new API (row object)
    let assetTypeId, assetClassId, assetName;
    if (typeof row === 'object' && row !== null && !Array.isArray(row)) {
      assetTypeId = (row.Asset_Type_ID || '').toLowerCase();
      assetClassId = (row.Asset_Class_ID || '').toLowerCase();
      assetName = (row.Asset || row.Position || '').toLowerCase();
    } else {
      // Legacy: mapSecurityType(assetTypeId, assetClassId)
      assetTypeId = (arguments[0] || '').toString().toLowerCase();
      assetClassId = (arguments[1] || '').toString().toLowerCase();
      assetName = '';
    }

    // First check Asset_Class_ID for cash - this is the most reliable indicator
    if (assetClassId === 'cash') {
      return SECURITY_TYPES.CASH;
    }

    // PRIMARY: Explicit Asset_Type_ID mapping
    const typeMap = {
      // Equities
      'shs_ord': SECURITY_TYPES.EQUITY,
      'shs_reg': SECURITY_TYPES.EQUITY,
      'shs_prf': SECURITY_TYPES.EQUITY,    // Preferred shares
      'shares': SECURITY_TYPES.EQUITY,
      'equity': SECURITY_TYPES.EQUITY,

      // ETFs (check before general funds)
      'fd_etf': SECURITY_TYPES.ETF,
      'etf': SECURITY_TYPES.ETF,
      'etf_eq': SECURITY_TYPES.ETF,
      'etf_bd': SECURITY_TYPES.ETF,

      // Bonds
      'bond_fix': SECURITY_TYPES.BOND,
      'bond_var': SECURITY_TYPES.BOND,
      'bond_cvt': SECURITY_TYPES.BOND,     // Convertible bonds (actual bonds, not structured)
      'bond_zero': SECURITY_TYPES.BOND,    // Zero-coupon bonds
      'bonds': SECURITY_TYPES.BOND,

      // Funds
      'fd_var': SECURITY_TYPES.FUND,
      'fd_shs': SECURITY_TYPES.FUND,
      'fd_ucits': SECURITY_TYPES.FUND,
      'fund': SECURITY_TYPES.FUND,

      // Money Market
      'fd_mm': SECURITY_TYPES.MONEY_MARKET,
      'mm_fund': SECURITY_TYPES.MONEY_MARKET,

      // Structured Products (critical - these were missing!)
      'struct': SECURITY_TYPES.STRUCTURED_PRODUCT,
      'struct_note': SECURITY_TYPES.STRUCTURED_PRODUCT,
      'struct_prod': SECURITY_TYPES.STRUCTURED_PRODUCT,
      'structured': SECURITY_TYPES.STRUCTURED_PRODUCT,
      'sp_eq': SECURITY_TYPES.STRUCTURED_PRODUCT,       // Equity-linked
      'sp_bd': SECURITY_TYPES.STRUCTURED_PRODUCT,       // Bond-linked
      'sp_idx': SECURITY_TYPES.STRUCTURED_PRODUCT,      // Index-linked
      'note': SECURITY_TYPES.STRUCTURED_PRODUCT,
      'autocall': SECURITY_TYPES.STRUCTURED_PRODUCT,
      'phoenix': SECURITY_TYPES.STRUCTURED_PRODUCT,
      'reverse_conv': SECURITY_TYPES.STRUCTURED_PRODUCT,
      'rev_conv': SECURITY_TYPES.STRUCTURED_PRODUCT,

      // Certificates
      'cert': SECURITY_TYPES.CERTIFICATE,
      'cert_idx': SECURITY_TYPES.CERTIFICATE,
      'cert_trk': SECURITY_TYPES.CERTIFICATE,           // Tracker certificates
      'cert_bonus': SECURITY_TYPES.CERTIFICATE,
      'certificate': SECURITY_TYPES.CERTIFICATE,

      // Derivatives
      'opt_call': SECURITY_TYPES.OPTION,
      'opt_put': SECURITY_TYPES.OPTION,
      'option': SECURITY_TYPES.OPTION,
      'fut': SECURITY_TYPES.FUTURE,
      'future': SECURITY_TYPES.FUTURE,
      'war': SECURITY_TYPES.WARRANT,
      'warrant': SECURITY_TYPES.WARRANT,

      // FX Forwards
      'fx_fwd': SECURITY_TYPES.FX_FORWARD,
      'fwd': SECURITY_TYPES.FX_FORWARD,
      'forward': SECURITY_TYPES.FX_FORWARD,

      // Term Deposits
      'dep_term': SECURITY_TYPES.TERM_DEPOSIT,
      'td': SECURITY_TYPES.TERM_DEPOSIT,
      'term_deposit': SECURITY_TYPES.TERM_DEPOSIT,
      'fiduciary': SECURITY_TYPES.TERM_DEPOSIT,

      // Private Equity
      'pe': SECURITY_TYPES.PRIVATE_EQUITY,
      'priv_eq': SECURITY_TYPES.PRIVATE_EQUITY,
      'private_equity': SECURITY_TYPES.PRIVATE_EQUITY,

      // Private Debt
      'pd': SECURITY_TYPES.PRIVATE_DEBT,
      'priv_debt': SECURITY_TYPES.PRIVATE_DEBT,
      'private_debt': SECURITY_TYPES.PRIVATE_DEBT,

      // Commodities
      'comm': SECURITY_TYPES.COMMODITY,
      'commodity': SECURITY_TYPES.COMMODITY,
      'gold': SECURITY_TYPES.COMMODITY,
      'precious': SECURITY_TYPES.COMMODITY,

      // Cash (fallback if Asset_Class_ID check missed it)
      'cash_acc': SECURITY_TYPES.CASH,
      'cash': SECURITY_TYPES.CASH,

      // Other (to be skipped in filtering)
      'lmt_std': 'LIMIT',
      'sdbc': 'SAFE_DEPOSIT',
    };

    // Check explicit mapping first
    if (typeMap[assetTypeId]) {
      return typeMap[assetTypeId];
    }

    // SECONDARY: Partial matching for asset type ID
    if (assetTypeId.includes('struct') || assetTypeId.includes('sp_')) {
      return SECURITY_TYPES.STRUCTURED_PRODUCT;
    }
    if (assetTypeId.includes('cert')) {
      return SECURITY_TYPES.CERTIFICATE;
    }
    if (assetTypeId.includes('etf')) {
      return SECURITY_TYPES.ETF;
    }
    if (assetTypeId.includes('opt') || assetTypeId.includes('option')) {
      return SECURITY_TYPES.OPTION;
    }
    if (assetTypeId.includes('fut') || assetTypeId.includes('future')) {
      return SECURITY_TYPES.FUTURE;
    }
    if (assetTypeId.includes('war') || assetTypeId.includes('warrant')) {
      return SECURITY_TYPES.WARRANT;
    }
    if (assetTypeId.includes('fwd') || assetTypeId.includes('forward')) {
      return SECURITY_TYPES.FX_FORWARD;
    }
    if (assetTypeId.includes('priv') && assetTypeId.includes('eq')) {
      return SECURITY_TYPES.PRIVATE_EQUITY;
    }
    if (assetTypeId.includes('priv') && assetTypeId.includes('debt')) {
      return SECURITY_TYPES.PRIVATE_DEBT;
    }

    // TERTIARY: Name-based detection for structured products
    if (assetName) {
      const structuredKeywords = [
        'express', 'autocall', 'phoenix', 'reverse conv', 'barrier',
        'cap.prot', 'bar.cap', 'capital protected', 'yield enhancement',
        'certificate', 'cert.', 'structured note', 'linked note'
      ];
      if (structuredKeywords.some(kw => assetName.includes(kw))) {
        return SECURITY_TYPES.STRUCTURED_PRODUCT;
      }

      // ETF detection by name
      if (assetName.includes('etf') || assetName.includes('exchange traded')) {
        return SECURITY_TYPES.ETF;
      }

      // Private equity detection by name
      if (assetName.includes('private equity') || assetName.includes('buyout') ||
          assetName.includes('venture capital') || assetName.includes('pe fund')) {
        return SECURITY_TYPES.PRIVATE_EQUITY;
      }
    }

    // FALLBACK: Use Asset_Class_ID if no specific mapping
    if (assetClassId) {
      const classMap = {
        'equity': SECURITY_TYPES.EQUITY,
        'equities': SECURITY_TYPES.EQUITY,
        'bond': SECURITY_TYPES.BOND,
        'bonds': SECURITY_TYPES.BOND,
        'fixed_income': SECURITY_TYPES.BOND,
        'fund': SECURITY_TYPES.FUND,
        'funds': SECURITY_TYPES.FUND,
        'structured': SECURITY_TYPES.STRUCTURED_PRODUCT,
        'derivatives': SECURITY_TYPES.OPTION,
        'alternative': SECURITY_TYPES.FUND,
      };
      if (classMap[assetClassId]) {
        return classMap[assetClassId];
      }
    }

    // Log unknown types for investigation
    if (assetTypeId && assetTypeId !== 'unknown') {
      console.warn(`[CMB_PARSER] Unknown security type - Asset_Type_ID: ${assetTypeId}, Asset_Class_ID: ${assetClassId}, Name: ${assetName}`);
    }

    return SECURITY_TYPES.UNKNOWN;
  },

  /**
   * Check if asset type should be skipped (not a real position)
   */
  shouldSkipAssetType(assetTypeId) {
    const skipTypes = ['lmt_std', 'sdbc'];
    return skipTypes.includes(assetTypeId);
  },

  /**
   * Check if asset type uses percentage pricing
   */
  isPercentagePricing(assetTypeId) {
    // Bonds and structured products often use percentage pricing (99.43 = 99.43%)
    const percentageTypes = [
      'bond_fix', 'bond_var', 'bond_cvt', 'bond_zero',
      'struct', 'struct_note', 'struct_prod', 'structured',
      'sp_eq', 'sp_bd', 'sp_idx', 'note', 'autocall', 'phoenix',
      'reverse_conv', 'rev_conv',
      'cert', 'cert_idx', 'cert_trk', 'cert_bonus', 'certificate'
    ];
    const lowerAssetTypeId = (assetTypeId || '').toLowerCase();
    return percentageTypes.includes(lowerAssetTypeId) ||
           lowerAssetTypeId.includes('struct') ||
           lowerAssetTypeId.includes('cert') ||
           lowerAssetTypeId.includes('bond');
  },

  /**
   * Strip leading zeros from portfolio/client codes
   * CMB provides codes like "00302894" but system uses "302894"
   */
  stripLeadingZeros(value) {
    if (!value) return value;
    const str = String(value).trim();
    // Remove leading zeros but keep at least one digit
    return str.replace(/^0+/, '') || '0';
  },

  /**
   * Parse number from string (handles commas, spaces, etc.)
   */
  parseNumber(value) {
    if (!value || value === '') return null;

    // Remove spaces and convert to string
    const str = String(value).trim();

    // Handle explicit percentage strings (e.g., "66.41%")
    if (str.includes('%')) {
      const num = parseFloat(str.replace(/[,%]/g, ''));
      return isNaN(num) ? null : num / 100; // Already normalized to decimal
    }

    // Remove commas and parse
    const num = parseFloat(str.replace(/,/g, ''));

    return isNaN(num) ? null : num;
  },

  /**
   * Parse date from string (DDMMYYYY format - CMB Monaco specific)
   * Example: 12122025 = December 12, 2025
   */
  parseDate(value) {
    if (!value || value === '') return null;

    const str = String(value).trim();

    // CMB Monaco uses DDMMYYYY format
    if (str.length === 8) {
      const day = parseInt(str.substring(0, 2));
      const month = parseInt(str.substring(2, 4)) - 1; // Month is 0-indexed
      const year = parseInt(str.substring(4, 8));

      // Validate parsed values
      if (day >= 1 && day <= 31 && month >= 0 && month <= 11 && year >= 1900 && year <= 2100) {
        return new Date(year, month, day);
      }
    }

    // Try parsing as ISO date as fallback
    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date;
  },

  /**
   * Normalize price value based on asset type
   *
   * CMB Monaco price formats:
   * - Bonds (bond_fix): Percentage format (99.43 = 99.43%) → divide by 100
   * - Shares (shs_ord, shs_reg): Absolute price (192.8 EUR) → use as-is
   * - Funds (fd_var, fd_shs, fd_mm): Absolute price → use as-is
   * - Cash (cash_acc): Always 1.0
   *
   * @param {number|null} rawValue - The parsed numeric value from CSV
   * @param {string} assetTypeId - The Asset_Type_ID field value
   * @param {string} fieldName - Field name for logging
   * @param {string} isin - ISIN for logging
   * @returns {number|null} - Normalized value in decimal format
   */
  normalizePrice(rawValue, assetTypeId, fieldName, isin) {
    if (!rawValue && rawValue !== 0) return null;

    // Skip non-position types
    if (this.shouldSkipAssetType(assetTypeId)) return null;

    // Cash always 1.0
    if (assetTypeId === 'cash_acc') return 1.0;

    // Bonds use percentage pricing - divide by 100
    if (this.isPercentagePricing(assetTypeId)) {
      const normalizedValue = rawValue / 100;
      console.log(`[CMB_PRICE_NORM] ${fieldName} - ISIN: ${isin || 'N/A'}`);
      console.log(`  Raw value: ${rawValue}`);
      console.log(`  Asset type: ${assetTypeId} (percentage pricing)`);
      console.log(`  Normalized: ${normalizedValue} (${(normalizedValue * 100).toFixed(2)}%)`);
      return normalizedValue;
    }

    // All others (equities, funds) use absolute pricing - return as-is
    return rawValue;
  },

  /**
   * Calculate cost basis in original currency
   */
  calculateCostBasis(quantity, costPrice) {
    if (!quantity || !costPrice) return null;
    return quantity * costPrice;
  },

  /**
   * Calculate unrealized P&L (absolute value)
   */
  calculateUnrealizedPnL(marketValue, costBasis) {
    if (marketValue === null || marketValue === undefined) return null;
    if (costBasis === null || costBasis === undefined) return null;
    return marketValue - costBasis;
  },

  /**
   * Calculate unrealized P&L percentage
   */
  calculateUnrealizedPnLPercent(marketValue, costBasis) {
    if (marketValue === null || marketValue === undefined) return null;
    if (costBasis === null || costBasis === undefined || costBasis === 0) return null;

    const unrealizedPnL = marketValue - costBasis;
    return (unrealizedPnL / Math.abs(costBasis)) * 100;
  },

  /**
   * Generate unique key for position
   *
   * IMPORTANT: For positions WITH ISIN, use ISIN as primary identifier.
   * ISIN is stable across file versions while Position_Number can change.
   * This prevents duplicate holdings when Position_Number changes between files.
   *
   * For cash positions (no ISIN), use instrumentCode + currency as identifier.
   * Position_Number can vary for the same cash account across files.
   *
   * NOTE: portfolioCode is normalized to base client number (without .001/.002 suffix)
   * to handle inconsistent Portfolio_Number formats across different CMB files.
   * Some files have "00302894", others have "00302894.001" for the same portfolio.
   */
  generateUniqueKey(portfolioCode, isin, instrumentCode, currency, positionNumber) {
    const crypto = require('crypto');

    // Normalize portfolioCode to base client number (strip .XXX suffix)
    // This ensures consistent uniqueKeys regardless of file format variations
    // "302894.001" -> "302894", "302894" -> "302894"
    const basePortfolioCode = portfolioCode ? portfolioCode.split('.')[0] : portfolioCode;

    // For positions WITH ISIN: Use ISIN as primary identifier (most stable)
    // ISIN doesn't change between file versions, unlike Position_Number
    if (isin) {
      const key = `cmb-monaco|${basePortfolioCode}|${isin}`;
      return crypto.createHash('sha256').update(key).digest('hex');
    }

    // For cash positions (no ISIN): ALWAYS use instrumentCode + currency
    // This ensures consistent uniqueKeys regardless of whether positionNumber is present
    // Previously used positionNumber which caused duplicates when it was missing from some files
    // instrumentCode identifies the specific account type (e.g., USD-A, EUR-B)
    if (instrumentCode) {
      const key = `cmb-monaco|${basePortfolioCode}|CASH|${instrumentCode}|${currency}`;
      return crypto.createHash('sha256').update(key).digest('hex');
    }

    // Last resort fallback - use currency only
    const key = `cmb-monaco|${basePortfolioCode}|CASH|${currency}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  },

  /**
   * Check if this is a cash position based on Asset_Class_ID and position name patterns
   * @param {string} assetClassId - The asset class from the CSV
   * @param {object} row - Optional full row for name-based detection
   */
  isCashPosition(assetClassId, row = {}) {
    // Original check - exact 'cash' match
    if (assetClassId === 'cash') return true;

    // Additional cash-like asset classes
    const cashClasses = ['cash', 'current_account', 'credit_account', 'money_market', 'liquidity'];
    if (cashClasses.includes((assetClassId || '').toLowerCase())) return true;

    // Check position name for cash indicators (when no ISIN)
    if (!row.ISIN) {
      const positionName = (row.Position_Description || row.Instrument_Name || '').toLowerCase();
      // Keywords indicating cash accounts
      if (/\b(current account|credit account|cash account|deposit account|sight account)\b/i.test(positionName)) {
        return true;
      }
      // Account number pattern without ISIN (e.g., "12345678 EUR")
      const posDesc = (row.Position_Description || '').trim();
      if (/^\d{6,}\s+[A-Z]{3}$/i.test(posDesc)) {
        return true;
      }
    }

    return false;
  },

  /**
   * Map CMB Monaco CSV row to standardized schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId, fxRates = {}) {
    // Parse evaluation date from CSV (Evaluation_Date column in DDMMYYYY format)
    const evaluationDate = row.Evaluation_Date ? this.parseDate(row.Evaluation_Date) : fileDate;
    const priceDate = row.Date_Market_Price ? this.parseDate(row.Date_Market_Price) : evaluationDate;

    // Parse raw numeric values
    const rawCostPrice = this.parseNumber(row.Cost_Price);
    const rawMarketPrice = this.parseNumber(row.Market_Price);
    const quantity = this.parseNumber(row.Quantity);

    // Normalize prices based on asset type
    const assetTypeId = row.Asset_Type_ID || '';
    const assetClassId = row.Asset_Class_ID || '';
    const isCash = this.isCashPosition(assetClassId, row);

    const normalizedCostPrice = this.normalizePrice(
      rawCostPrice,
      assetTypeId,
      'Cost_Price',
      row.ISIN
    );
    const normalizedMarketPrice = this.normalizePrice(
      rawMarketPrice,
      assetTypeId,
      'Market_Price',
      row.ISIN
    );

    // Get values from CSV
    // Position_Value is in SECURITY currency (e.g., EUR for Airbus, SEK for SEK stocks)
    const marketValueSecCcy = this.parseNumber(row.Position_Value);
    // Cost_Value_in_Ref_Ccy is in portfolio REFERENCE currency (USD for USD portfolios, EUR for EUR portfolios)
    const costBasisRefCcy = this.parseNumber(row.Cost_Value_in_Ref_Ccy);

    // Calculate cost basis in SECURITY currency (quantity × normalized cost price)
    // This allows proper P&L calculation (apples to apples comparison)
    const costBasisSecCcy = this.calculateCostBasis(quantity, normalizedCostPrice);

    // Get portfolio reference currency (USD, EUR, CHF, etc.)
    // Use Portfolio_Number (sub-account) for lookup, not Client_Number
    const portfolioRefCurrency = this.getPortfolioReferenceCurrency(row.Portfolio_Number);

    // Convert market value from position currency to portfolio reference currency
    // FX rates format: From_Currency;To_Currency;Date;Quote where Quote is MULTIPLY to convert
    // Example: CNY;EUR;0.123053 means 1 CNY × 0.123053 = 0.123053 EUR
    // Example: EUR;CNY;8.126579 means 1 EUR × 8.126579 = 8.126579 CNY
    // The rates are reciprocal: 8.126579 × 0.123053 ≈ 1
    const positionCurrency = row.Ccy || 'EUR';
    let marketValueRefCcy = marketValueSecCcy; // Default: same if currencies match or no rate available

    if (positionCurrency !== portfolioRefCurrency && marketValueSecCcy !== null && marketValueSecCcy !== undefined) {
      // Look for direct rate: positionCurrency → portfolioRefCurrency
      if (fxRates[positionCurrency] && fxRates[positionCurrency][portfolioRefCurrency]) {
        const fxRate = fxRates[positionCurrency][portfolioRefCurrency];
        marketValueRefCcy = marketValueSecCcy * fxRate;
        // Only log for non-trivial conversions
        if (Math.abs(marketValueSecCcy) > 100) {
          console.log(`[CMB_PARSER] FX: ${marketValueSecCcy.toFixed(2)} ${positionCurrency} × ${fxRate} = ${marketValueRefCcy.toFixed(2)} ${portfolioRefCurrency}`);
        }
      }
      // Fallback: try inverse rate (portfolioRefCurrency → positionCurrency)
      else if (fxRates[portfolioRefCurrency] && fxRates[portfolioRefCurrency][positionCurrency]) {
        const inverseRate = fxRates[portfolioRefCurrency][positionCurrency];
        // Inverse rate: if we have EUR→CNY=8.126579, to convert CNY→EUR we divide by 8.126579
        marketValueRefCcy = marketValueSecCcy / inverseRate;
        if (Math.abs(marketValueSecCcy) > 100) {
          console.log(`[CMB_PARSER] FX (inverse): ${marketValueSecCcy.toFixed(2)} ${positionCurrency} / ${inverseRate} = ${marketValueRefCcy.toFixed(2)} ${portfolioRefCurrency}`);
        }
      }
      else {
        console.warn(`[CMB_PARSER] No FX rate for ${positionCurrency}→${portfolioRefCurrency}, using unconverted value`);
      }
    }

    // Determine price type
    const priceType = this.isPercentagePricing(assetTypeId) ? 'percentage' : 'absolute';

    // Normalize portfolio code from Portfolio_Number (sub-account)
    // Strip leading zeros: 00302894.001 -> 302894.001
    // Each sub-account is treated as a separate portfolio in the PMS
    const portfolioCode = this.stripLeadingZeros(row.Portfolio_Number) || '';
    const clientCode = this.stripLeadingZeros(row.Client_Number) || '';

    // For cash positions, the ISIN column contains an internal instrument code (like "61482"), not a real ISIN
    // We need to handle this specially for proper unique key generation and data mapping
    const instrumentCodeForCash = isCash ? (row.ISIN || row.Instrument_Code) : null;
    const realIsin = isCash ? null : (row.ISIN || null);
    const ticker = isCash ? instrumentCodeForCash : (row.Instrument_Code || null);

    // Generate unique key - use special format for cash positions
    const uniqueKey = this.generateUniqueKey(
      portfolioCode,
      realIsin,
      instrumentCodeForCash || row.Instrument_Code,
      row.Ccy,
      row.Position_Number
    );

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null, // Will be set by caller
      sourceFile,
      sourceFilePath: null, // Will be set by caller
      fileDate,
      dataDate: evaluationDate,
      snapshotDate: evaluationDate,
      processingDate: new Date(),

      // Account & Portfolio Information
      // portfolioCode is the sub-account (e.g., "302894.001") - each treated as separate portfolio
      portfolioCode: portfolioCode,
      clientCode: clientCode, // Parent client code (e.g., "302894")
      accountNumber: row.Portfolio_Number || null,
      thirdPartyCode: row.EAM_Key || null,

      // Security Information - cash positions don't have real ISINs
      isin: realIsin,
      ticker: ticker,
      securityName: row.Asset || null,
      // securityType: For positions WITH valid ISINs, set to null for SecurityResolver classification
      // For cash positions (no ISIN), set directly since SecurityResolver can't classify them
      securityType: isCash ? SECURITY_TYPES.CASH : null,
      // Store raw bank codes for classification hints (used by SecurityResolver if needed)
      securityTypeCode: row.Asset_Type_ID || null, // Bank's raw code
      securityTypeDesc: row.Asset_Class || null, // Bank's description

      // Position Data
      quantity: quantity,
      marketValue: marketValueRefCcy,              // In portfolio reference currency - used by UI for Portfolio Value column
      marketValueOriginalCurrency: marketValueSecCcy, // Position_Value is in security currency - used by UI for Market Value column
      marketValueRefCcy: marketValueRefCcy,        // Alias: Market value converted to portfolio reference currency
      marketValuePortfolioCurrency: marketValueRefCcy, // Alias: Market value in portfolio currency for display
      currency: row.Ccy || null,
      portfolioCurrency: portfolioRefCurrency, // Portfolio reference currency (USD, EUR, CHF, etc.)

      // Pricing Information
      priceType: priceType,
      marketPrice: normalizedMarketPrice,
      priceDate: priceDate,
      priceCurrency: row.Ccy || null,

      // Cost Information
      costPrice: normalizedCostPrice,

      // Cost Basis
      // costBasisOriginalCurrency: in SECURITY currency (calculated from qty × costPrice)
      // costBasisPortfolioCurrency: in REFERENCE currency (EUR, from Cost_Value_in_Ref_Ccy)
      costBasisOriginalCurrency: costBasisSecCcy,
      costBasisPortfolioCurrency: costBasisRefCcy,

      // Performance Metrics - calculated in portfolio reference currency for UI consistency
      // Other parsers (Julius Baer, Andbank) also calculate P&L in portfolio currency
      unrealizedPnL: this.calculateUnrealizedPnL(marketValueRefCcy, costBasisRefCcy),
      unrealizedPnLPercent: this.calculateUnrealizedPnLPercent(marketValueRefCcy, costBasisRefCcy),

      // Versioning
      uniqueKey: uniqueKey,
      isLatest: true,
      isActive: true,
      version: 1,

      // Bank-Specific Fields
      bankSpecificData: {
        clientNumber: row.Client_Number,
        portfolioNumber: row.Portfolio_Number,
        positionNumber: row.Position_Number,
        instrumentCode: row.Instrument_Code,
        rawIsinColumn: row.ISIN, // Raw value from ISIN column (may be instrument code for cash)
        isCash: isCash,
        assetClassId: assetClassId,
        assetClass: row.Asset_Class,
        assetTypeId: assetTypeId,
        assetType: row.Asset_Type,
        position: row.Position, // Full position description
        weightInPortfolio: this.parseNumber(row.Weight_in_portfolio),
        accruedInterest: this.parseNumber(row.Accrual_Interests),
        maturityDate: this.parseDate(row.Maturity_date),
        interestRate: this.parseNumber(row.Interest_rate),
        eamKey: row.EAM_Key,
        rawCostPrice: rawCostPrice,
        rawMarketPrice: rawMarketPrice
      },

      // Metadata
      userId,

      // Bank-provided FX rates (flattened to currency → portfolio reference currency rate)
      // Used by cash calculator to ensure amounts match bank statements
      // Format: { 'CNY': 8.126579, 'GBP': 0.8520, ... } (DIVIDE format: EUR = amount / rate)
      // Example: 100 CNY / 8.126579 = 12.31 EUR
      bankFxRates: Object.keys(fxRates).reduce((acc, fromCurrency) => {
        // CMB FX file uses MULTIPLY format (CNY;EUR = 0.123053 means CNY × 0.123053 = EUR)
        // Cash calculator expects DIVIDE format (EUR = amount / rate)
        // So we need to invert: store 1/rate for direct rates
        if (fxRates[fromCurrency] && fxRates[fromCurrency][portfolioRefCurrency]) {
          // Direct rate exists (e.g., CNY→EUR = 0.123053), invert to DIVIDE format
          acc[fromCurrency] = 1 / fxRates[fromCurrency][portfolioRefCurrency];
        }
        // For inverse rate (e.g., we have EUR→CNY but not CNY→EUR), use it directly
        else if (fxRates[portfolioRefCurrency] && fxRates[portfolioRefCurrency][fromCurrency]) {
          // EUR→CNY = 8.126579 is already in the right format (divide CNY by 8.126579 to get EUR)
          acc[fromCurrency] = fxRates[portfolioRefCurrency][fromCurrency];
        }
        return acc;
      }, {}),
    };
  },

  /**
   * Parse entire positions file
   * Returns array of standardized position objects
   */
  parse(csvContent, { bankId, bankName, sourceFile, fileDate, userId, fxRates = {} }) {
    console.log(`[CMB_PARSER] Parsing CMB Monaco positions file: ${sourceFile}`);
    console.log(`[CMB_PARSER] FX rates available for ${Object.keys(fxRates).length} currencies`);

    // Parse CSV to array of objects
    const rows = this.parseCSV(csvContent);
    console.log(`[CMB_PARSER] Found ${rows.length} rows`);

    // FIRST PASS: Detect portfolio reference currencies from cash positions
    // When Position_Value === Cost_Value_in_Ref_Ccy for a cash position,
    // that currency is the portfolio's reference currency
    this.detectedReferenceCurrencies = this.detectPortfolioReferenceCurrencies(rows);
    console.log(`[CMB_PARSER] Detected reference currencies:`, this.detectedReferenceCurrencies);

    // SECOND PASS: Filter and map rows
    const positions = [];
    let skippedNonPosition = 0;
    let skippedEmpty = 0;

    for (const row of rows) {
      // Skip non-position asset types (limits, safe deposit boxes)
      if (this.shouldSkipAssetType(row.Asset_Type_ID)) {
        skippedNonPosition++;
        continue;
      }

      // Skip rows without meaningful data
      const hasIsin = row.ISIN && row.ISIN.trim();
      const hasInstrumentCode = row.Instrument_Code && row.Instrument_Code.trim();
      const hasQuantity = row.Quantity && this.parseNumber(row.Quantity) !== null;
      const hasValue = row.Position_Value && this.parseNumber(row.Position_Value) !== null;

      // Must have either ISIN or instrument code, plus quantity or value
      if (!hasIsin && !hasInstrumentCode) {
        skippedEmpty++;
        continue;
      }

      if (!hasQuantity && !hasValue) {
        skippedEmpty++;
        continue;
      }

      positions.push(this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId, fxRates));
    }

    console.log(`[CMB_PARSER] Mapped ${positions.length} positions`);
    console.log(`[CMB_PARSER] Skipped: ${skippedNonPosition} non-positions (limits, safe deposit), ${skippedEmpty} empty/invalid`);

    return positions;
  },

  /**
   * Parse operations/events file (evt_list)
   * Returns array of operation objects
   */
  parseOperations(csvContent, { bankId, bankName, sourceFile, fileDate, userId }) {
    console.log(`[CMB_PARSER] Parsing CMB Monaco operations file: ${sourceFile}`);

    // Parse CSV to array of objects
    const rows = this.parseCSV(csvContent);
    console.log(`[CMB_PARSER] Found ${rows.length} operation rows`);

    const operations = rows.map(row => this.mapOperationToSchema(row, bankId, bankName, sourceFile, fileDate, userId));

    console.log(`[CMB_PARSER] Mapped ${operations.length} operations`);

    return operations;
  },

  /**
   * Map CMB Monaco operation row to standardized schema
   */
  mapOperationToSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    const transactionDate = this.parseDate(row.Transaction_Date);
    const valueDate = this.parseDate(row.Value_Date);
    const verificationDate = this.parseDate(row.Verification_Date);

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null,
      sourceFile,
      fileDate,
      processingDate: new Date(),

      // Operation Identifiers
      operationId: row.Order || null,
      externalReference: row.Order,

      // Account Information (strip leading zeros: 00302894.001 -> 302894.001)
      // Use Portfolio_Number for portfolioCode to match bank account format (302894.001)
      portfolioCode: this.stripLeadingZeros(row.Portfolio_Number) || '',
      clientCode: this.stripLeadingZeros(row.Client_Number) || '',
      accountNumber: row.Portfolio_Number || null,
      positionNumber: row.Position_Number || null,

      // Security Information
      isin: row.ISIN || null,
      securityName: row.Position || null,
      assetClass: row.Asset_Class || null,

      // Transaction Details
      // Map raw CMB codes to standardized Ambervision operation types
      operationType: mapCMBOperationType(
        row.Order_Type_ID,
        row.Meta_Type_ID,
        this.parseNumber(row.Net_amount) || this.parseNumber(row.Gross_Amount) || 0
      ),
      operationTypeName: row.Internal_Booking_Text || row.Order_Type || null,
      transactionCategory: row.Meta_Type_ID || null,
      transactionCategoryName: row.Meta_Type || null,
      description: row.Internal_Booking_Text || null,
      // Preserve original bank code for reference
      originalOperationType: row.Order_Type_ID || null,

      // Dates - operationDate is REQUIRED by schema validation
      operationDate: transactionDate || valueDate || verificationDate || fileDate,
      transactionDate: transactionDate,
      valueDate: valueDate,
      verificationDate: verificationDate,

      // Amounts
      quantity: this.parseNumber(row.Quantity),
      currency: row.Transaction_Currency || null,
      accountCurrency: row.Account_Currency || null,
      grossAmount: this.parseNumber(row.Gross_Amount),
      netAmount: this.parseNumber(row.Net_amount),
      fees: this.parseNumber(row.Costs),
      exchangeRate: this.parseNumber(row.Exchange_Rate),
      securityPrice: this.parseNumber(row.Security_Market_Price),
      assetLastPrice: this.parseNumber(row.Asset_Last_Price),
      accruedInterests: this.parseNumber(row.Accrued_Interests),
      withholdingTax: this.parseNumber(row.Withholding_Tax),

      // Additional Fields
      iban: row.IBAN || null,
      taxStamp: this.parseNumber(row.Tax_Stamp),
      maturityDate: this.parseDate(row.Maturity_Date),
      forwardRate: this.parseNumber(row.Forward_Rate),
      interestRate: this.parseNumber(row.Interest_Rate),
      calculationMethod: row.Calculation_method || null,

      // Bank-Specific Data
      bankSpecificData: {
        eamKey: row.EAM_Key,
        orderTypeId: row.Order_Type_ID,
        metaTypeId: row.Meta_Type_ID
      },

      // Metadata
      userId,
      isProcessed: false,
      createdAt: new Date()
    };
  },

  /**
   * Parse FX rates file (curry_xchng)
   * Returns object with currency rates
   */
  parseFxRates(csvContent) {
    console.log(`[CMB_PARSER] Parsing CMB Monaco FX rates file`);

    const rows = this.parseCSV(csvContent);
    const rates = {};

    for (const row of rows) {
      const fromCurrency = row.From_Currency;
      const toCurrency = row.To_Currency;
      const rate = this.parseNumber(row.Quote);

      if (fromCurrency && toCurrency && rate) {
        // Store rate as From_Currency → To_Currency
        if (!rates[fromCurrency]) {
          rates[fromCurrency] = {};
        }
        rates[fromCurrency][toCurrency] = rate;
      }
    }

    console.log(`[CMB_PARSER] Parsed FX rates for ${Object.keys(rates).length} base currencies`);

    return rates;
  },

  /**
   * Validate positions file before parsing
   */
  validate(csvContent) {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 2) {
      return { valid: false, error: 'File is empty or has no data rows' };
    }

    const headers = lines[0].split(';');
    const requiredHeaders = ['Client_Number', 'Portfolio_Number', 'Quantity'];

    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      return {
        valid: false,
        error: `Missing required headers: ${missingHeaders.join(', ')}`
      };
    }

    return { valid: true };
  },

  /**
   * Validate operations file before parsing
   */
  validateOperations(csvContent) {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 2) {
      return { valid: false, error: 'Operations file is empty or has no data rows' };
    }

    const headers = lines[0].split(';');
    const requiredHeaders = ['Order', 'Client_Number', 'Transaction_Date'];

    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      return {
        valid: false,
        error: `Missing required headers: ${missingHeaders.join(', ')}`
      };
    }

    return { valid: true };
  }
};
