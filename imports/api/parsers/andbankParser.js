/**
 * Andbank Position File Parser
 *
 * Parses Andbank CSV position files and converts to standardized schema
 *
 * Filename format: EX00YYYYMMDD_POS_MNC.csv
 * Example: EX0020251128_POS_MNC.csv
 *
 * CSV Format: Comma-delimited, WITH headers (as of Nov 2025)
 * First row contains column headers, data starts from row 2
 *
 * Based on official Andbank Datafeed documentation (v1.0, 20/11/2024)
 * Updated Nov 2025: Added header row support
 */

import { SECURITY_TYPES } from '../constants/instrumentTypes';

export const AndbankParser = {
  /**
   * Bank identifier
   */
  bankName: 'Andbank',

  /**
   * Filename pattern for Andbank position files
   */
  filenamePattern: /^EX00(\d{8})_POS_MNC\.csv$/i,

  /**
   * Column indices (0-indexed, no headers)
   * Based on official Andbank Datafeed documentation
   */
  columns: {
    DATE: 0,                    // Position date (DD/MM/YYYY)
    PORTFOLIO_NUMBER: 1,        // Unique identifier
    ACCOUNT_NUMBER: 2,          // For cash positions
    CONTRACT_NUMBER: 3,         // For deposits, loans, forex
    ASSET_LABEL: 4,             // Asset name
    BALANCE: 5,                 // Quantity/amount
    ASSET_TYPE: 6,              // 0=Securities, 1=Cash, 2=Deposits, 3=Forex
    ISIN: 7,                    // ISIN code
    INTERNAL_CODE: 8,           // Custodian internal code
    ROW_CCY: 9,                 // Row currency (ISO)
    QUOTATION: 10,              // Market price (1 if cash)
    QUOTATION_DATE: 11,         // Price date (DD/MM/YYYY)
    ISSUE_DATE: 12,             // Issue date
    MATURITY_DATE: 13,          // Maturity date
    PORTFOLIO_CCY: 14,          // Portfolio currency (ISO)
    EXCH_RATE_PTF: 15,          // Row→Portfolio exchange rate
    MKT_VAL_ROW: 16,            // Market value in row currency
    ACCR_INT_ROW: 17,           // Accrued interest in row currency
    MKT_VAL_PTF: 18,            // Market value in portfolio currency
    ACCR_INT_PTF: 19,           // Accrued interest in portfolio currency
    CUSTODIAN_CCY: 20,          // Custodian currency (ISO)
    EXCH_RATE_CUST: 21,         // Row→Custodian exchange rate
    MKT_VAL_CUST: 22,           // Market value in custodian currency
    ACCR_INT_CUST: 23,          // Accrued interest in custodian currency
    COUPON_RATE: 24,            // Coupon rate for bonds
    INT_DEBTOR_RATE: 25,        // Interest debtor rate (for loans)
    INT_CREDITOR_RATE: 26,      // Interest creditor rate (for deposits)
    AVG_PRICE_ROW: 27,          // Average purchase price in row currency
    FX_RATE: 28,                // FX rate
    YIELD: 29,                  // Yield to maturity (not populated)
    QUOTATION_UNIT: 30,         // 2 or 4 = percentage, other = decimal
    SECURITY_TYPE_CODE: 31,     // 100=BONDS, 200=SHARES, etc.
    SECURITY_TYPE_DESC: 32,     // Text description
    AVG_PRICE_PTF: 33,          // Average purchase price in portfolio currency
    BOND_NAME: 34,              // Bond name or reference (swapped in Nov 2025 format)
    CONTRACT_LOT_SIZE: 35       // Contract/Lot size (swapped in Nov 2025 format)
  },

  /**
   * Check if filename matches Andbank pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: EX00YYYYMMDD_POS_MNC.csv
   * Returns: Date object
   */
  extractFileDate(filename) {
    const match = filename.match(this.filenamePattern);
    if (!match) {
      throw new Error(`Filename does not match Andbank pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // Month is 0-indexed
    const day = parseInt(dateStr.substring(6, 8));

    return new Date(year, month, day);
  },

  /**
   * Parse CSV content to array of objects
   * Andbank CSV has headers (as of Nov 2025) - always skip first row
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    const rows = [];

    // Always skip first line (header row)
    console.log('[ANDBANK_PARSER] Skipping header row');

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const values = line.split(',');
      const row = {};

      // Map values to column names using indices
      Object.entries(this.columns).forEach(([key, index]) => {
        row[key] = values[index] !== undefined ? values[index].trim() : '';
      });

      rows.push(row);
    }

    return rows;
  },

  /**
   * Map security type from Andbank official codes to standard type
   * Based on official Andbank Datafeed documentation
   * Uses SECURITY_TYPES constants from instrumentTypes.js
   */
  mapSecurityType(code) {
    const codeNum = parseInt(code) || 0;

    // Structured Products: 105, 106, 108, 110, 111, 600
    // Check these first as they overlap with bond range
    if (codeNum === 105 || codeNum === 106 || codeNum === 108) return SECURITY_TYPES.STRUCTURED_PRODUCT;
    if (codeNum === 110 || codeNum === 111) return SECURITY_TYPES.STRUCTURED_PRODUCT;
    if (codeNum === 600) return SECURITY_TYPES.STRUCTURED_PRODUCT;

    // Bonds: 100-109, 177
    if (codeNum >= 100 && codeNum < 110) return SECURITY_TYPES.BOND;
    if (codeNum === 177) return SECURITY_TYPES.BOND; // US Treasury

    // Equities: 200-259
    if (codeNum >= 200 && codeNum < 260) return SECURITY_TYPES.EQUITY;

    // Derivatives: 300-374
    // Map to most common derivative type (OPTION) as default
    if (codeNum >= 300 && codeNum < 375) return SECURITY_TYPES.OPTION;

    // Commodities/Currencies: 401-440
    if (codeNum >= 401 && codeNum < 450) return SECURITY_TYPES.COMMODITY;

    // Funds: 500-530
    if (codeNum >= 500 && codeNum < 531) return SECURITY_TYPES.FUND;

    return SECURITY_TYPES.UNKNOWN;
  },

  /**
   * Parse number from string (handles spaces for alignment)
   */
  parseNumber(value) {
    if (!value || value === '') return null;

    // Remove spaces and convert to string
    const str = String(value).trim();

    // Handle empty after trim
    if (str === '') return null;

    // Parse the number
    const num = parseFloat(str);

    return isNaN(num) ? null : num;
  },

  /**
   * Parse date from string (DD/MM/YYYY format)
   */
  parseDate(value) {
    if (!value || value === '') return null;

    const str = String(value).trim();
    if (str === '') return null;

    // Try DD/MM/YYYY format
    const parts = str.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1; // Month is 0-indexed
      const year = parseInt(parts[2]);

      if (!isNaN(day) && !isNaN(month) && !isNaN(year)) {
        return new Date(year, month, day);
      }
    }

    // Fallback: try parsing as ISO date
    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date;
  },

  /**
   * Check if quotation unit indicates percentage pricing
   * Per Andbank docs: 2 or 4 = percentage, other = decimal
   */
  isPercentagePricing(quotationUnit) {
    const unit = String(quotationUnit).trim();
    return unit === '2' || unit === '02' || unit === '4' || unit === '04';
  },

  /**
   * Normalize market price to decimal format
   *
   * Andbank uses QUOTATION_UNIT to indicate price format:
   * - 2 or 4 = percentage (bond prices as % of face value)
   * - other = decimal/absolute (equity prices)
   *
   * For bonds with percentage pricing:
   * - Market price is already in decimal format (1.000820 = 100.082%)
   * - No conversion needed
   *
   * For equities with absolute pricing:
   * - Price is absolute (26.28 = EUR 26.28)
   * - No conversion needed
   */
  normalizeMarketPrice(rawPrice, quotationUnit, assetType) {
    if (!rawPrice && rawPrice !== 0) return null;

    // Cash positions always return 1.0
    if (assetType === '1') return 1.0;

    // Market price is already in correct format
    // Percentage bonds: 1.000820 = 100.082%
    // Absolute equities: 26.28 = EUR 26.28
    return rawPrice;
  },

  /**
   * Normalize cost price to decimal format
   *
   * For bonds with percentage pricing:
   * - Cost price is in percentage format (96.373719 = 96.37%)
   * - Must divide by 100 to normalize to decimal
   *
   * For equities with absolute pricing:
   * - Price is absolute (30.576834 = EUR 30.58)
   * - No conversion needed
   */
  normalizeCostPrice(rawPrice, quotationUnit, assetType) {
    if (!rawPrice && rawPrice !== 0) return null;

    // Cash positions always return 1.0
    if (assetType === '1') return 1.0;

    // Check if percentage pricing
    if (this.isPercentagePricing(quotationUnit)) {
      // Cost price in percentage format - divide by 100
      return rawPrice / 100;
    }

    // Absolute pricing - no conversion
    return rawPrice;
  },

  /**
   * Calculate cost basis in original currency
   * Note: costPrice must be in normalized decimal format
   */
  calculateCostBasis(quantity, costPrice) {
    if (!quantity || !costPrice) return null;

    // Simple multiplication - costPrice is already normalized
    return quantity * costPrice;
  },

  /**
   * Calculate cost basis in portfolio currency using exchange rate
   */
  calculateCostBasisPortfolioCurrency(costBasisOriginalCurrency, exchangeRate) {
    if (!costBasisOriginalCurrency) return null;
    if (!exchangeRate || exchangeRate === 0) return costBasisOriginalCurrency;

    // Exchange rate converts from position currency to portfolio currency
    return costBasisOriginalCurrency * exchangeRate;
  },

  /**
   * Calculate unrealized P&L (absolute value)
   */
  calculateUnrealizedPnL(marketValue, costBasis) {
    if (!marketValue || !costBasis) return null;
    return marketValue - costBasis;
  },

  /**
   * Calculate unrealized P&L percentage
   */
  calculateUnrealizedPnLPercent(marketValue, costBasis) {
    if (!marketValue || !costBasis) return null;
    if (costBasis === 0) return null;

    const unrealizedPnL = marketValue - costBasis;
    return (unrealizedPnL / costBasis) * 100;
  },

  /**
   * Map Andbank CSV row to standardized schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    // Parse data date from CSV
    const dataDate = this.parseDate(row.DATE) || fileDate;

    // Determine asset type (0=Securities, 1=Cash, 2=Deposits, 3=Forex)
    const assetType = row.ASSET_TYPE || '0';
    const isCash = assetType === '1';
    const isDeposit = assetType === '2';
    const isForex = assetType === '3';
    const isSecurities = assetType === '0';

    // Get quotation unit for price format detection
    const quotationUnit = row.QUOTATION_UNIT || '';

    // Security type from official code
    const securityTypeCode = row.SECURITY_TYPE_CODE || '';
    const securityTypeDesc = row.SECURITY_TYPE_DESC || '';

    // Parse raw numeric values
    const rawMarketPrice = this.parseNumber(row.QUOTATION);
    const rawCostPrice = this.parseNumber(row.AVG_PRICE_ROW);
    const quantity = this.parseNumber(row.BALANCE);

    // Normalize prices based on quotation unit
    const normalizedMarketPrice = this.normalizeMarketPrice(rawMarketPrice, quotationUnit, assetType);
    const normalizedCostPrice = this.normalizeCostPrice(rawCostPrice, quotationUnit, assetType);

    // Parse exchange rate
    const exchangeRate = this.parseNumber(row.EXCH_RATE_PTF) || 1;

    // Calculate cost basis
    const costBasisOriginalCurrency = this.calculateCostBasis(quantity, normalizedCostPrice);
    const costBasisPortfolioCurrency = this.calculateCostBasisPortfolioCurrency(
      costBasisOriginalCurrency,
      exchangeRate
    );

    // Get market value from CSV (already calculated by bank)
    const marketValuePortfolioCurrency = this.parseNumber(row.MKT_VAL_PTF);

    // Determine security type for standardized output
    // Uses SECURITY_TYPES constants from instrumentTypes.js
    let securityType;
    if (isCash) {
      securityType = SECURITY_TYPES.CASH;
    } else if (isDeposit) {
      securityType = SECURITY_TYPES.TERM_DEPOSIT;  // Standardized from DEPOSIT
    } else if (isForex) {
      securityType = SECURITY_TYPES.FX_FORWARD;    // Standardized from FOREX
    } else {
      securityType = this.mapSecurityType(securityTypeCode);
    }

    // Determine price type based on quotation unit
    const isPercentage = this.isPercentagePricing(quotationUnit);

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null, // Will be set by caller
      sourceFile,
      sourceFilePath: null, // Will be set by caller
      fileDate,
      dataDate,
      processingDate: new Date(),

      // Account & Portfolio Information
      portfolioCode: row.PORTFOLIO_NUMBER || '',
      accountNumber: row.ACCOUNT_NUMBER || row.PORTFOLIO_NUMBER || null,
      thirdPartyCode: null,
      contractNumber: row.CONTRACT_NUMBER || null,

      // Security Information
      isin: row.ISIN || null,
      ticker: null, // Andbank doesn't provide ticker
      securityName: row.ASSET_LABEL || null,
      securityType,
      securityTypeCode,
      securityTypeDesc,
      bondName: row.BOND_NAME || row.CONTRACT_LOT_SIZE || null, // Bond name now in dedicated column (Nov 2025)

      // Position Data
      quantity,
      marketValue: marketValuePortfolioCurrency,
      marketValueNoAccruedInterest: marketValuePortfolioCurrency
        ? marketValuePortfolioCurrency - (this.parseNumber(row.ACCR_INT_PTF) || 0)
        : null,
      marketValueOriginalCurrency: this.parseNumber(row.MKT_VAL_ROW),
      bookValue: null,
      currency: row.ROW_CCY || null,
      portfolioCurrency: row.PORTFOLIO_CCY || null,

      // Pricing Information
      priceType: isPercentage ? 'percentage' : 'absolute',
      marketPrice: normalizedMarketPrice,
      priceDate: this.parseDate(row.QUOTATION_DATE),
      priceCurrency: row.ROW_CCY || null,
      quotationUnit,

      // Cost Price Information
      costPrice: normalizedCostPrice,
      costPricePortfolioCurrency: this.normalizeCostPrice(
        this.parseNumber(row.AVG_PRICE_PTF),
        quotationUnit,
        assetType
      ),

      // Cost Basis Calculations
      costBasisOriginalCurrency,
      costBasisPortfolioCurrency,

      // Performance Metrics
      unrealizedPnL: this.calculateUnrealizedPnL(marketValuePortfolioCurrency, costBasisPortfolioCurrency),
      unrealizedPnLPercent: this.calculateUnrealizedPnLPercent(marketValuePortfolioCurrency, costBasisPortfolioCurrency),

      // Bank-Specific Fields
      bankSpecificData: {
        internalCode: row.INTERNAL_CODE || null,
        assetType,
        quotationUnit,
        securityTypeCode,
        securityTypeDesc,
        couponRate: this.parseNumber(row.COUPON_RATE),
        interestDebtorRate: this.parseNumber(row.INT_DEBTOR_RATE),
        interestCreditorRate: this.parseNumber(row.INT_CREDITOR_RATE),
        yield: this.parseNumber(row.YIELD),
        fxRate: this.parseNumber(row.FX_RATE),
        issueDate: this.parseDate(row.ISSUE_DATE),
        maturityDate: this.parseDate(row.MATURITY_DATE),
        accruedInterest: {
          rowCurrency: this.parseNumber(row.ACCR_INT_ROW),
          portfolioCurrency: this.parseNumber(row.ACCR_INT_PTF),
          custodianCurrency: this.parseNumber(row.ACCR_INT_CUST)
        },
        exchangeRates: {
          rowToPortfolio: exchangeRate,
          rowToCustodian: this.parseNumber(row.EXCH_RATE_CUST)
        },
        custodianCurrency: row.CUSTODIAN_CCY || null,
        marketValueCustodian: this.parseNumber(row.MKT_VAL_CUST),
        contractLotSize: row.CONTRACT_LOT_SIZE || null
      },

      // Metadata
      userId,
      isActive: true,
      version: 1,

      // Bank-provided FX rates (currency → EUR rate)
      // Andbank provides per-position exchange rates
      // Rate meaning: how many portfolio currency units per 1 position currency (multiply to convert)
      // NOTE: Andbank uses MULTIPLICATION, unlike JB/CMB/CFM which use division
      // For uniformity, we store the INVERSE so all rates work with division: EUR = amount / rate
      bankFxRates: (() => {
        const positionCurrency = row.ROW_CCY;
        const portfolioCurrency = row.PORTFOLIO_CCY || 'EUR';
        const rate = this.parseNumber(row.EXCH_RATE_PTF);
        if (positionCurrency && rate && rate !== 0 && positionCurrency !== portfolioCurrency) {
          // Store inverse: Andbank rate is "multiply", convert to "divide" format
          return { [positionCurrency]: 1 / rate };
        }
        return {};
      })(),
    };
  },

  /**
   * Parse entire file
   * Returns array of standardized position objects
   */
  parse(csvContent, { bankId, bankName, sourceFile, fileDate, userId }) {
    console.log(`[ANDBANK_PARSER] Parsing Andbank file: ${sourceFile}`);

    // Parse CSV to array of objects
    const rows = this.parseCSV(csvContent);
    console.log(`[ANDBANK_PARSER] Found ${rows.length} rows`);

    // Map each row to standard schema
    // Include rows with ISIN OR cash/deposit/forex positions (which may not have ISIN)
    const positions = rows
      .filter(row => {
        const hasIsin = row.ISIN && row.ISIN.trim() !== '';
        const assetType = row.ASSET_TYPE || '0';
        const isCashOrDeposit = assetType === '1' || assetType === '2' || assetType === '3';
        const hasMarketValue = row.MKT_VAL_PTF && row.MKT_VAL_PTF.trim() !== '';
        return hasIsin || isCashOrDeposit || hasMarketValue;
      })
      .map(row => this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId));

    console.log(`[ANDBANK_PARSER] Mapped ${positions.length} positions (${rows.length - positions.length} skipped)`);

    return positions;
  },

  /**
   * Validate file before parsing
   * Files always have headers (as of Nov 2025)
   */
  validate(csvContent) {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 2) {
      return { valid: false, error: 'File must have header and at least one data row' };
    }

    // Check first data line (index 1) has expected number of columns (at least 36)
    const dataLine = lines[1];
    const columns = dataLine.split(',');

    if (columns.length < 36) {
      return {
        valid: false,
        error: `Expected at least 36 columns, found ${columns.length}`
      };
    }

    // Verify date format in first column of data row (DD/MM/YYYY)
    const dateValue = columns[0].trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateValue)) {
      return {
        valid: false,
        error: `First column of data row should be date in DD/MM/YYYY format, found: ${dateValue}`
      };
    }

    return { valid: true };
  }
};
