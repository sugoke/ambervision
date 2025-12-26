/**
 * Edmond de Rothschild Monaco (EDR) Position File Parser
 *
 * Parses EDR Monaco CSV position files and converts to standardized schema
 *
 * Filename format: portef_XXXXXXXX_YYYYMMDD.csv
 * Example: portef_F14B2A5A_20251205.csv
 *
 * File format: Comma-delimited CSV with header row
 */

import { SECURITY_TYPES } from '../constants/instrumentTypes';

export const EDRMonacoParser = {
  /**
   * Bank identifier
   */
  bankName: 'Edmond de Rothschild',

  /**
   * Filename pattern for EDR Monaco position files
   */
  filenamePattern: /^portef_[A-F0-9]+_(\d{8})\.csv$/i,

  /**
   * Check if filename matches EDR Monaco pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: portef_F14B2A5A_20251205.csv
   * Returns: Date object
   */
  extractFileDate(filename) {
    const match = filename.match(this.filenamePattern);
    if (!match) {
      throw new Error(`Filename does not match EDR Monaco pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // Month is 0-indexed
    const day = parseInt(dateStr.substring(6, 8));

    return new Date(year, month, day);
  },

  /**
   * Parse CSV content to array of objects
   * EDR uses comma delimiter with quoted strings
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV file is empty or has no data rows');
    }

    // First line is headers
    const headers = this.parseCSVLine(lines[0]);

    // Parse remaining lines
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      const row = {};

      headers.forEach((header, index) => {
        row[header] = values[index] !== undefined ? values[index] : '';
      });

      rows.push(row);
    }

    return rows;
  },

  /**
   * Parse a single CSV line handling quoted values
   */
  parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    return values;
  },

  /**
   * Map security type from EDR genre code to standard type
   * EDR uses numeric genre codes:
   * - 001: Cash (positive balance)
   * - 002: Overdraft/negative balance
   * - 100: Bond
   * - 123: Structured Product
   * - 200: Equity
   * - 215: ETF
   * - 270: Certificate
   * - 408, 409: Term Deposit
   * Uses SECURITY_TYPES constants from instrumentTypes.js
   */
  mapSecurityType(genre, mb004) {
    // Remove quotes if present
    const cleanGenre = String(genre).replace(/"/g, '').trim();
    const cleanMb004 = String(mb004).replace(/"/g, '').trim();

    // mb004 = 4 indicates cash-related record
    if (cleanMb004 === '4') {
      return SECURITY_TYPES.CASH;
    }

    // mb004 = 3 indicates term deposit
    if (cleanMb004 === '3') {
      return SECURITY_TYPES.TERM_DEPOSIT;
    }

    const typeMap = {
      '001': SECURITY_TYPES.CASH,
      '002': SECURITY_TYPES.CASH, // Overdraft
      '100': SECURITY_TYPES.BOND,
      '123': SECURITY_TYPES.STRUCTURED_PRODUCT,
      '200': SECURITY_TYPES.EQUITY,
      '215': SECURITY_TYPES.ETF,
      '270': SECURITY_TYPES.CERTIFICATE,
      '408': SECURITY_TYPES.TERM_DEPOSIT,
      '409': SECURITY_TYPES.TERM_DEPOSIT
    };

    return typeMap[cleanGenre] || SECURITY_TYPES.UNKNOWN;
  },

  /**
   * Map currency code to ISO code
   * EDR uses numeric currency codes
   */
  mapCurrency(deviseCode) {
    const code = String(deviseCode).trim();

    const currencyMap = {
      '0': 'EUR',
      '1': 'EUR',
      '840': 'USD',
      '756': 'CHF',
      '826': 'GBP',
      '392': 'JPY'
    };

    // If it's already an ISO code (3 letters), return as-is
    if (/^[A-Z]{3}$/i.test(code)) {
      return code.toUpperCase();
    }

    return currencyMap[code] || 'EUR';
  },

  /**
   * Parse number from string
   */
  parseNumber(value) {
    if (!value || value === '') return null;

    // Remove quotes and spaces
    const str = String(value).replace(/"/g, '').trim();

    // Handle empty values
    if (str === '' || str === '0.00000000') return 0;

    // Parse the number
    const num = parseFloat(str.replace(/,/g, ''));

    return isNaN(num) ? null : num;
  },

  /**
   * Parse date from string
   * EDR uses DD/MM/YYYY format or "/  /" for empty dates
   */
  parseDate(value) {
    if (!value || value === '') return null;

    const str = String(value).replace(/"/g, '').trim();

    // Handle empty date format "/  /" or "/ /"
    if (str.includes('/  /') || str === '/ /' || str === '//' || str === '') {
      return null;
    }

    // Try DD/MM/YYYY format
    const parts = str.split('/');
    if (parts.length === 3) {
      const day = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1; // Month is 0-indexed
      const year = parseInt(parts[2]);

      if (!isNaN(day) && !isNaN(month) && !isNaN(year) && year > 1900) {
        return new Date(year, month, day);
      }
    }

    // Try YYYYMMDD format (from filename)
    if (str.length === 8 && /^\d{8}$/.test(str)) {
      const year = parseInt(str.substring(0, 4));
      const month = parseInt(str.substring(4, 6)) - 1;
      const day = parseInt(str.substring(6, 8));
      return new Date(year, month, day);
    }

    return null;
  },

  /**
   * Determine if price is in percentage format
   * For bonds and structured products, prices are typically in percentage (e.g., 92.86 = 92.86%)
   * Uses SECURITY_TYPES constants from instrumentTypes.js
   */
  isPercentagePrice(genre, securityType) {
    const percentageTypes = [
      SECURITY_TYPES.BOND,
      SECURITY_TYPES.STRUCTURED_PRODUCT,
      SECURITY_TYPES.CERTIFICATE,
      SECURITY_TYPES.TERM_DEPOSIT
    ];
    return percentageTypes.includes(securityType);
  },

  /**
   * Normalize price to decimal format
   * Converts percentage prices (92.86) to decimal (0.9286)
   * Uses SECURITY_TYPES constants from instrumentTypes.js
   */
  normalizePrice(rawValue, securityType) {
    if (!rawValue && rawValue !== 0) return null;

    // For equities and ETFs, price is absolute (share price)
    if (securityType === SECURITY_TYPES.EQUITY || securityType === SECURITY_TYPES.ETF) {
      return rawValue;
    }

    // For cash positions, no price normalization needed
    if (securityType === SECURITY_TYPES.CASH) {
      return rawValue;
    }

    // For bonds, structured products, certificates - price is in percentage format
    // Values >= 10 are assumed to be percentages (e.g., 92.86 = 92.86%)
    if (rawValue >= 10) {
      return rawValue / 100;
    }

    // Small values might already be in decimal format
    return rawValue;
  },

  /**
   * Calculate cost basis
   */
  calculateCostBasis(quantity, avgPurchasePrice, securityType) {
    if (!quantity || !avgPurchasePrice) return null;

    // For percentage-priced instruments, multiply by quantity
    // avgPurchasePrice is the average cost price from the bank
    if (this.isPercentagePrice(null, securityType)) {
      // If price is in percentage format (e.g., 98.235 = 98.235%)
      // Cost = quantity * (price / 100) for notional/nominal instruments
      const normalizedPrice = avgPurchasePrice >= 10 ? avgPurchasePrice / 100 : avgPurchasePrice;
      return quantity * normalizedPrice;
    }

    // For absolute-priced instruments (equities, ETFs)
    return quantity * avgPurchasePrice;
  },

  /**
   * Map EDR Monaco CSV row to standardized schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    const genre = row.genre;
    const mb004 = row.mb004;
    const securityType = this.mapSecurityType(genre, mb004);

    // Parse values
    const quantity = this.parseNumber(row.qte);
    const marketPrice = this.parseNumber(row.cours);
    const avgPurchasePrice = this.parseNumber(row.prix_moy_ach);
    const marketValueOriginal = this.parseNumber(row.mont_dev);
    const marketValueEur = this.parseNumber(row.mont_euro);
    const accruedInterest = this.parseNumber(row.int_euro);
    const resLatentFromBank = this.parseNumber(row.res_latent);
    const couponRate = this.parseNumber(row.taux);

    // Normalize prices
    const normalizedMarketPrice = this.normalizePrice(marketPrice, securityType);
    const normalizedCostPrice = this.normalizePrice(avgPurchasePrice, securityType);

    // Calculate cost basis in original currency
    const costBasisOriginal = this.calculateCostBasis(quantity, avgPurchasePrice, securityType);

    // Calculate cost basis in portfolio currency (EUR)
    // Derive exchange rate from market values if available
    let costBasisEur = costBasisOriginal;
    if (costBasisOriginal && marketValueEur && marketValueOriginal && marketValueOriginal !== 0) {
      // Calculate FX rate from market values: EUR_value / Original_value
      const fxRate = marketValueEur / marketValueOriginal;
      costBasisEur = costBasisOriginal * fxRate;
      console.log(`[EDR_PARSER] Converted cost basis for ${row.isin}: ${costBasisOriginal} × ${fxRate.toFixed(4)} = ${costBasisEur.toFixed(2)} EUR`);
    }

    // Calculate unrealized P&L in portfolio currency (EUR)
    // Use bank-provided res_latent if available and non-zero, otherwise calculate from market value - cost basis
    let unrealizedPnL = resLatentFromBank;
    if ((unrealizedPnL === null || unrealizedPnL === 0) && marketValueEur !== null && costBasisEur !== null) {
      // Calculate P&L from market value (EUR) minus cost basis (EUR)
      unrealizedPnL = marketValueEur - costBasisEur;
      console.log(`[EDR_PARSER] Calculated unrealizedPnL for ${row.isin}: ${marketValueEur.toFixed(2)} - ${costBasisEur.toFixed(2)} = ${unrealizedPnL.toFixed(2)} EUR`);
    }

    // Get currency
    const positionCurrency = row.devise || 'EUR';
    const securityCurrency = this.mapCurrency(row.devise_val);

    // Parse dates
    const dataDate = this.parseDate(row.date);
    const priceDate = this.parseDate(row.date_cours);
    const startDate = this.parseDate(row.date_dep);
    const maturityDate = this.parseDate(row.date_fin);
    const nextCouponDate = this.parseDate(row.date_coup);

    // Get security name - for cash it's empty, use description based on type
    let securityName = row.nom_val ? String(row.nom_val).replace(/"/g, '').trim() : null;
    if (!securityName && securityType === 'CASH') {
      securityName = positionCurrency === 'EUR' ? 'Cash EUR' : `Cash ${positionCurrency}`;
    }
    if (!securityName && securityType === 'TERM_DEPOSIT') {
      securityName = `Term Deposit ${positionCurrency}`;
    }

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null, // Will be set by caller
      sourceFile,
      sourceFilePath: null, // Will be set by caller
      fileDate,
      dataDate: dataDate || fileDate,
      processingDate: new Date(),

      // Account & Portfolio Information
      portfolioCode: String(row.kn005).replace(/"/g, '').trim(),
      accountNumber: String(row.kn005).replace(/"/g, '').trim(),

      // Security Information
      isin: row.isin ? String(row.isin).replace(/"/g, '').trim() : null,
      ticker: null, // EDR doesn't provide ticker
      securityName,
      securityType,

      // Position Data
      quantity,
      marketValue: marketValueEur, // Use EUR value as primary
      marketValueOriginalCurrency: marketValueOriginal,
      bookValue: costBasisEur, // Book value in portfolio currency (EUR)
      currency: positionCurrency,
      portfolioCurrency: 'EUR', // EDR Monaco uses EUR as base

      // Pricing Information
      priceType: this.isPercentagePrice(genre, securityType) ? 'percentage' : 'absolute',
      marketPrice: normalizedMarketPrice,
      priceDate,
      priceCurrency: securityCurrency,

      // Cost Basis
      costPrice: normalizedCostPrice,
      costBasisOriginalCurrency: costBasisOriginal,
      costBasisPortfolioCurrency: costBasisEur,

      // Performance Metrics
      unrealizedPnL,
      unrealizedPnLPercent: costBasisEur && costBasisEur !== 0 ? (unrealizedPnL / costBasisEur) * 100 : null,
      accruedInterest,

      // Bank-Specific Fields
      bankSpecificData: {
        genre,
        mb004,
        codeVal: row.code_val,
        deviseVal: row.devise_val,
        frequency: row.freq,
        couponRate,
        rubrique: row.rub,
        idCat: row.id_cat,
        instrumentDates: {
          beginDate: startDate,
          endDate: maturityDate,
          nextCouponDate
        }
      },

      // Metadata
      userId,
      isActive: true,
      version: 1
    };
  },

  /**
   * Parse entire file
   * Returns array of standardized position objects
   */
  parse(csvContent, { bankId, bankName, sourceFile, fileDate, userId }) {
    console.log(`[EDR_PARSER] Parsing EDR Monaco file: ${sourceFile}`);

    // Parse CSV to array of objects
    const rows = this.parseCSV(csvContent);
    console.log(`[EDR_PARSER] Found ${rows.length} rows`);

    // Map each row to standard schema
    // Include all rows - securities, cash, and term deposits
    const positions = rows
      .filter(row => {
        // Include rows with ISIN
        if (row.isin && String(row.isin).replace(/"/g, '').trim()) {
          return true;
        }
        // Include cash positions (mb004 = 4 or genre = 001/002)
        const mb004 = String(row.mb004).replace(/"/g, '').trim();
        const genre = String(row.genre).replace(/"/g, '').trim();
        if (mb004 === '4' || genre === '001' || genre === '002') {
          return true;
        }
        // Include term deposits (mb004 = 3 or genre = 408/409)
        if (mb004 === '3' || genre === '408' || genre === '409') {
          return true;
        }
        // Include if there's a market value
        const marketValue = this.parseNumber(row.mont_euro);
        if (marketValue && marketValue !== 0) {
          return true;
        }
        return false;
      })
      .map(row => this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId));

    console.log(`[EDR_PARSER] Mapped ${positions.length} positions`);

    return positions;
  },

  /**
   * Validate file before parsing
   */
  validate(csvContent) {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 2) {
      return { valid: false, error: 'File is empty or has no data rows' };
    }

    const headers = this.parseCSVLine(lines[0]);
    const requiredHeaders = ['genre', 'kn005', 'qte', 'mont_euro'];

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
