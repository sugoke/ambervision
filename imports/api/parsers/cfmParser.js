/**
 * CFM (Credit Foncier de Monaco / Indosuez) Position File Parser
 *
 * Parses CFM CSV position files:
 * - POTI (Positions Titres) - Securities positions
 * - POES (Positions Espèces) - Cash and FX forward positions
 *
 * Filename format: YYYYMMDD-X#######-LU-W#-{type}.csv (X = letter prefix like L or A)
 * Example: 20251203-L0303591-LU-W5-poti.csv or 20260101-A0115523-LU-W5-poti.csv
 *
 * File format: Semicolon-delimited CSV with NO header row
 * Price type indicated by column R (index 17): 0=absolute, 1=percentage
 */

import { SECURITY_TYPES } from '../constants/instrumentTypes';

export const CFMParser = {
  /**
   * Bank identifier
   */
  bankName: 'CFM',

  /**
   * Filename pattern for CFM position files (poti = Positions Titres)
   */
  filenamePattern: /^(\d{8})-[A-Z]\d+-[A-Z]{2}-W\d+-poti\.csv$/i,

  /**
   * Filename pattern for CFM cash/FX position files (poes = Positions Espèces)
   */
  cashFilenamePattern: /^(\d{8})-[A-Z]\d+-[A-Z]{2}-W\d+-poes\.csv$/i,

  /**
   * Filename pattern for CFM FX rates files (crsc = Cours de Change)
   */
  fxRatesFilenamePattern: /^(\d{8})-[A-Z]\d+-[A-Z]{2}-W\d+-crsc\.csv$/i,

  /**
   * Check if filename matches CFM position file pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Check if filename matches CFM cash/FX position file pattern
   */
  matchesCashPattern(filename) {
    return this.cashFilenamePattern.test(filename);
  },

  /**
   * Check if filename matches CFM FX rates file pattern
   */
  matchesFxRatesPattern(filename) {
    return this.fxRatesFilenamePattern.test(filename);
  },

  /**
   * Parse CFM FX rates file (crsc.csv)
   * Format: CURRENCY;DATE;RATE;
   * Rate = units of currency per 1 EUR
   * Returns: Map of currency code -> rate (e.g., { ILS: 3.779303776658 })
   */
  parseFxRates(csvContent) {
    const rates = {};
    const lines = csvContent.trim().split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      const parts = trimmedLine.split(';');
      if (parts.length >= 3) {
        const currency = parts[0].trim().toUpperCase();
        const rate = parseFloat(parts[2]);

        if (currency && !isNaN(rate) && rate > 0) {
          rates[currency] = rate;
        }
      }
    }

    console.log(`[CFM_FX] Parsed ${Object.keys(rates).length} FX rates`);
    return rates;
  },

  /**
   * Convert amount from original currency to EUR using FX rates
   * @param {number} amount - Amount in original currency
   * @param {string} currency - Original currency code
   * @param {object} fxRates - FX rates map from parseFxRates()
   * @returns {number|null} - Amount in EUR, or null if rate not found
   */
  convertToEur(amount, currency, fxRates) {
    if (!amount && amount !== 0) return null;
    if (!currency || currency === 'EUR') return amount;
    if (!fxRates || !fxRates[currency]) {
      console.warn(`[CFM_FX] No FX rate found for ${currency}`);
      return null;
    }

    // Rate = units of currency per 1 EUR
    // So: EUR = amount / rate
    const eurAmount = amount / fxRates[currency];
    return eurAmount;
  },

  /**
   * Extract date from filename
   * Format: 20251203-L0303591-LU-W5-poti.csv
   * Returns: Date object
   */
  extractFileDate(filename) {
    const match = filename.match(/^(\d{8})/);
    if (!match) {
      throw new Error(`Filename does not match CFM pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    return this.parseDate(dateStr, 'YYYYMMDD');
  },

  /**
   * Column indices for CFM POTI files (no header row)
   */
  columns: {
    CLIENT_NUMBER: 0,        // A - N° d'intervenant
    FOLDER_NUMBER: 1,        // B - N° de dossier
    SECURITY_NUMBER: 2,      // C - N° de valeur (Telekurs)
    ISIN: 3,                 // D - N° ISIN
    SECURITY_NAME: 4,        // E - Libellé du nom du titre
    PORTFOLIO_WEIGHT: 5,     // F - Pondération dans le portefeuille
    SECURITY_TYPE_DESC: 6,   // G - Libellé du genre de titre
    CURRENCY: 7,             // H - Monnaie de négociation
    QUANTITY: 8,             // I - Quantité
    MARKET_PRICE: 9,         // J - Cours en devise de la position
    PURCHASE_VALUE: 10,      // K - Valeur brute d'achat en monnaie de position
    SECURITY_TYPE_CODE: 11,  // L - Code genre de titre
    PURCHASE_VALUE_LOCAL: 12,// M - Valeur brute d'achat en monnaie locale
    VALUATION_DATE: 13,      // N - Date du cours d'estimation (YYYYMMDD)
    AVG_PURCHASE_PRICE: 14,  // O - Cours moyen d'achat en monnaie de position
    AVG_PURCHASE_PRICE_PERF: 15, // P - Cours moyen d'achat en monnaie de performance
    ACCRUED_INTEREST: 16,    // Q - Intérêts courus en monnaie de position
    PRICE_TYPE: 17,          // R - Cours du titre exprimé en % (1) ou en monnaie (0)
    STATEMENT_DATE: 18       // S - Date d'arrêté (DDMMYYYY)
  },

  /**
   * Column indices for CFM POES files (cash/FX positions, no header row)
   * POES = Positions Espèces (Cash Positions)
   */
  cashColumns: {
    CLIENT_NUMBER: 0,        // A - N° d'intervenant
    ACCOUNT_ORDER: 1,        // B - N° d'ordre de compte
    ACCOUNT_TYPE: 2,         // C - Libellé du type de compte (COMPTE COURANT, CHANGE A TERME)
    CURRENCY: 3,             // D - Devise du compte
    PORTFOLIO_WEIGHT: 4,     // E - Pondération dans le portefeuille
    BALANCE_POSITION: 5,     // F - Solde en devise de position
    BALANCE_PERF: 6,         // G - Solde en devise de performance
    ACCRUED_INTEREST: 7,     // H - Intérêts courus
    IBAN: 8,                 // I - IBAN
    CAT_DETAIL: 9,           // J - Détail position CAT
    CAT_CURRENCY: 10,        // K - Devise position CAT
    STATEMENT_DATE: 11,      // L - Date d'arrêté (DDMMYYYY)
    REFERENCE: 12            // M - Reference (FX reference for forwards)
  },

  /**
   * Parse CSV content to array of arrays (no header row)
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 1) {
      throw new Error('CSV file is empty');
    }

    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      const values = line.split(';').map(v => v ? v.trim() : '');
      rows.push(values);
    }

    return rows;
  },

  /**
   * Map security type from CFM code to standard type
   * Uses SECURITY_TYPES constants from instrumentTypes.js
   *
   * CFM security type codes (Genre de titre):
   * - 410, 411: Equities
   * - 420-429: Funds (421=SICAV, 423=Fund shares)
   * - 200-209: Bonds (200=standard, 201=convertible)
   * - 300-399: Structured Products
   * - 100-199: Cash/Money market
   * - 500-599: Derivatives
   */
  mapSecurityType(code, description) {
    // First try mapping by code
    const codeMap = {
      // Equities
      '410': SECURITY_TYPES.EQUITY,         // Actions
      '411': SECURITY_TYPES.EQUITY,         // Actions privilégiées
      '412': SECURITY_TYPES.EQUITY,         // ADRs

      // ETFs (often in fund range but check description first)
      '430': SECURITY_TYPES.ETF,            // ETF
      '431': SECURITY_TYPES.ETF,            // ETF indices

      // Funds
      '420': SECURITY_TYPES.FUND,           // General fund
      '421': SECURITY_TYPES.FUND,           // PART FDS CT - SICAV
      '422': SECURITY_TYPES.FUND,           // UCITS
      '423': SECURITY_TYPES.FUND,           // PART FDS CT - GROUPE (Fund shares)
      '424': SECURITY_TYPES.MONEY_MARKET,   // Money market fund
      '425': SECURITY_TYPES.FUND,           // Alternative fund

      // Bonds
      '200': SECURITY_TYPES.BOND,           // Obligations
      '201': SECURITY_TYPES.BOND,           // Obligations convertibles
      '202': SECURITY_TYPES.BOND,           // Zero-coupon
      '203': SECURITY_TYPES.BOND,           // Perpetual

      // Structured Products
      '300': SECURITY_TYPES.STRUCTURED_PRODUCT, // Produits structurés
      '301': SECURITY_TYPES.STRUCTURED_PRODUCT, // Notes
      '302': SECURITY_TYPES.STRUCTURED_PRODUCT, // Certificates
      '303': SECURITY_TYPES.CERTIFICATE,    // Tracker certificates
      '310': SECURITY_TYPES.STRUCTURED_PRODUCT, // Autocallable
      '320': SECURITY_TYPES.STRUCTURED_PRODUCT, // Reverse convertible

      // Cash and deposits
      '100': SECURITY_TYPES.CASH,           // Liquidités
      '101': SECURITY_TYPES.TERM_DEPOSIT,   // Dépôt à terme
      '102': SECURITY_TYPES.TERM_DEPOSIT,   // Fiduciaire

      // Derivatives
      '500': SECURITY_TYPES.OPTION,         // Options
      '510': SECURITY_TYPES.FUTURE,         // Futures
      '520': SECURITY_TYPES.WARRANT,        // Warrants
      '530': SECURITY_TYPES.FX_FORWARD,     // FX Forwards

      // Private investments
      '600': SECURITY_TYPES.PRIVATE_EQUITY, // Private equity
      '610': SECURITY_TYPES.PRIVATE_DEBT,   // Private debt
    };

    if (code && codeMap[code]) {
      return codeMap[code];
    }

    // Try mapping by description keywords
    const descLower = (description || '').toLowerCase();

    // Check for ETF first (before fund)
    if (descLower.includes('etf') || descLower.includes('tracker')) {
      return SECURITY_TYPES.ETF;
    }
    if (descLower.includes('fonds') || descLower.includes('fund') || descLower.includes('sicav') || descLower.includes('part fds')) {
      return SECURITY_TYPES.FUND;
    }
    if (descLower.includes('action') || descLower.includes('equity') || descLower.includes('stock')) {
      return SECURITY_TYPES.EQUITY;
    }
    if (descLower.includes('oblig') || descLower.includes('bond')) {
      return SECURITY_TYPES.BOND;
    }
    if (descLower.includes('structur') || descLower.includes('note') || descLower.includes('certificat') ||
        descLower.includes('autocall') || descLower.includes('express') || descLower.includes('phoenix') ||
        descLower.includes('reverse') || descLower.includes('barrier')) {
      return SECURITY_TYPES.STRUCTURED_PRODUCT;
    }
    if (descLower.includes('private equity') || descLower.includes('pe ')) {
      return SECURITY_TYPES.PRIVATE_EQUITY;
    }
    if (descLower.includes('dépôt') || descLower.includes('depot') || descLower.includes('term')) {
      return SECURITY_TYPES.TERM_DEPOSIT;
    }

    // Log unknown codes for investigation
    if (code && code !== SECURITY_TYPES.UNKNOWN) {
      console.warn(`[CFM_PARSER] Unknown security type code: ${code}, description: ${description}`);
    }

    return SECURITY_TYPES.UNKNOWN;
  },

  /**
   * Parse number from string (handles European format if needed)
   */
  parseNumber(value) {
    if (!value || value === '') return null;

    // Remove spaces and convert to string
    const str = String(value).trim();

    // Handle explicit percentage strings (e.g., "66.41%")
    if (str.includes('%')) {
      const num = parseFloat(str.replace(/[,%]/g, ''));
      return isNaN(num) ? null : num / 100;
    }

    // CFM uses dot as decimal separator
    const num = parseFloat(str.replace(/,/g, ''));

    return isNaN(num) ? null : num;
  },

  /**
   * Parse date from string
   * Supports YYYYMMDD and DDMMYYYY formats
   */
  parseDate(value, format = 'auto') {
    if (!value || value === '') return null;

    const str = String(value).trim();

    // Handle 8-digit date strings
    if (str.length === 8 && /^\d{8}$/.test(str)) {
      // Auto-detect format based on value ranges
      const first4 = parseInt(str.substring(0, 4));
      const last4 = parseInt(str.substring(4, 8));

      if (format === 'YYYYMMDD' || (format === 'auto' && first4 > 1900 && first4 < 2100)) {
        // YYYYMMDD format
        const year = parseInt(str.substring(0, 4));
        const month = parseInt(str.substring(4, 6)) - 1;
        const day = parseInt(str.substring(6, 8));
        return new Date(year, month, day);
      } else if (format === 'DDMMYYYY' || format === 'auto') {
        // DDMMYYYY format
        const day = parseInt(str.substring(0, 2));
        const month = parseInt(str.substring(2, 4)) - 1;
        const year = parseInt(str.substring(4, 8));
        return new Date(year, month, day);
      }
    }

    // Try parsing as ISO date
    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date;
  },

  /**
   * Normalize price based on price type indicator
   * CFM explicitly tells us the price type in column R:
   * - 0 = absolute price (use as-is)
   * - 1 = percentage price (divide by 100 to get decimal)
   *
   * @param {number|null} rawValue - The parsed numeric value
   * @param {string|number} priceType - The price type indicator (0 or 1)
   * @param {string} fieldName - Field name for logging
   * @param {string} isin - ISIN for logging
   * @returns {number|null} - Normalized value in decimal format
   */
  normalizePrice(rawValue, priceType, fieldName, isin) {
    if (!rawValue && rawValue !== 0) return null;

    const isPercentageType = priceType === '1' || priceType === 1;

    if (isPercentageType) {
      // Percentage price: divide by 100 to get decimal
      // e.g., 66.91 → 0.6691 (represents 66.91%)
      const normalizedValue = rawValue / 100;

      console.log(`[CFM_PRICE_NORM] ${fieldName} - ISIN: ${isin}`);
      console.log(`  Raw value: ${rawValue}`);
      console.log(`  Price type: ${priceType} (percentage)`);
      console.log(`  Normalized: ${normalizedValue} (${(normalizedValue * 100).toFixed(2)}%)`);

      return normalizedValue;
    }

    // Absolute price: use as-is
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
   * Calculate unrealized P&L
   */
  calculateUnrealizedPnL(marketValue, costBasis) {
    if (!marketValue || !costBasis) return null;
    return marketValue - costBasis;
  },

  /**
   * Calculate unrealized P&L percentage
   */
  calculateUnrealizedPnLPercent(marketValue, costBasis) {
    if (!marketValue || !costBasis || costBasis === 0) return null;
    return ((marketValue - costBasis) / costBasis) * 100;
  },

  /**
   * Map CFM CSV row to standardized schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId, fxRates = {}) {
    const c = this.columns;

    // Get price type indicator (0=absolute, 1=percentage)
    const priceType = row[c.PRICE_TYPE] || '0';

    // Parse raw numeric values
    const rawMarketPrice = this.parseNumber(row[c.MARKET_PRICE]);
    const rawCostPrice = this.parseNumber(row[c.AVG_PURCHASE_PRICE]);
    const quantity = this.parseNumber(row[c.QUANTITY]);

    // Normalize prices using explicit price type indicator
    const normalizedMarketPrice = this.normalizePrice(
      rawMarketPrice,
      priceType,
      'MARKET_PRICE',
      row[c.ISIN]
    );

    const normalizedCostPrice = this.normalizePrice(
      rawCostPrice,
      priceType,
      'AVG_PURCHASE_PRICE',
      row[c.ISIN]
    );

    // Calculate market value
    const marketValue = quantity && rawMarketPrice ? quantity * rawMarketPrice : null;

    // Calculate cost basis from quantity × cost price
    // NOTE: PURCHASE_VALUE (column 10) contains market value, not purchase value!
    // So we must calculate cost basis ourselves
    const costBasisCalculated = this.calculateCostBasis(quantity, normalizedCostPrice);

    // Parse dates
    const valuationDate = this.parseDate(row[c.VALUATION_DATE], 'YYYYMMDD');
    const statementDate = this.parseDate(row[c.STATEMENT_DATE], 'DDMMYYYY');

    // Build account number from client + folder
    // Strip leading zeros from account number (e.g., 0640130 -> 640130)
    const clientNumber = row[c.CLIENT_NUMBER] || '';
    const folderNumber = row[c.FOLDER_NUMBER] || '';
    const accountNumber = clientNumber.replace(/^0+/, '') || clientNumber;

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null, // Will be set by caller
      sourceFile,
      sourceFilePath: null, // Will be set by caller
      fileDate,
      dataDate: statementDate || valuationDate || fileDate,
      processingDate: new Date(),

      // Account & Portfolio Information
      portfolioCode: accountNumber, // Without leading zeros
      accountNumber: accountNumber, // Without leading zeros
      thirdPartyCode: accountNumber,
      originalPortfolioCode: `${clientNumber}-${folderNumber}`, // Keep original with leading zeros

      // Security Information
      isin: row[c.ISIN] || null,
      ticker: row[c.SECURITY_NUMBER] || null, // Telekurs number
      securityName: row[c.SECURITY_NAME] || null,
      // securityType is now resolved by SecurityResolver from SecuritiesMetadata (single source of truth)
      // Set to null here - will be populated after parsing by bankPositionMethods.js
      securityType: null,
      // Store raw bank codes for classification hints
      securityTypeCode: row[c.SECURITY_TYPE_CODE] || null,
      securityTypeDesc: row[c.SECURITY_TYPE_DESC] || null,

      // Position Data
      quantity: quantity,
      marketValue: marketValue,
      marketValueNoAccruedInterest: null,
      marketValueOriginalCurrency: marketValue,
      bookValue: costBasisCalculated,
      currency: row[c.CURRENCY] || null,
      portfolioCurrency: row[c.CURRENCY] || null, // CFM doesn't separate these in POTI

      // Pricing Information
      priceType: priceType === '1' ? 'percentage' : 'absolute',
      marketPrice: normalizedMarketPrice,
      priceDate: valuationDate,
      priceCurrency: row[c.CURRENCY] || null,

      // Cost Price (normalized)
      costPrice: normalizedCostPrice,
      lastPrice: null,
      lastPriceCurrency: null,

      // Cost Basis (calculated from quantity × cost price)
      costBasisOriginalCurrency: costBasisCalculated,
      costBasisPortfolioCurrency: costBasisCalculated,

      // Performance Metrics
      unrealizedPnL: this.calculateUnrealizedPnL(marketValue, costBasisCalculated),
      unrealizedPnLPercent: this.calculateUnrealizedPnLPercent(marketValue, costBasisCalculated),

      // Bank-Specific Fields
      bankSpecificData: {
        telekursNumber: row[c.SECURITY_NUMBER],
        portfolioWeight: this.parseNumber(row[c.PORTFOLIO_WEIGHT]),
        securityTypeCode: row[c.SECURITY_TYPE_CODE],
        securityTypeDescription: row[c.SECURITY_TYPE_DESC],
        avgPurchasePricePerf: this.parseNumber(row[c.AVG_PURCHASE_PRICE_PERF]),
        purchaseValueLocal: this.parseNumber(row[c.PURCHASE_VALUE_LOCAL]),
        accruedInterest: this.parseNumber(row[c.ACCRUED_INTEREST]),
        priceTypeIndicator: priceType,
        folderNumber: folderNumber
      },

      // Metadata
      userId,
      isActive: true,
      version: 1,

      // Bank-provided FX rates (currency → EUR rate)
      // Used by cash calculator to ensure amounts match bank statements
      // CFM rates are "units of currency per 1 EUR", so to convert: EUR = amount / rate
      bankFxRates: fxRates,
    };
  },

  /**
   * Parse entire file
   * Returns array of standardized position objects
   */
  parse(csvContent, { bankId, bankName, sourceFile, fileDate, userId, fxRates = {} }) {
    console.log(`[CFM_PARSER] Parsing CFM file: ${sourceFile}`);

    // Parse CSV to array of arrays (no header row)
    const rows = this.parseCSV(csvContent);
    console.log(`[CFM_PARSER] Found ${rows.length} rows`);

    // Map each row to standard schema
    // Only include rows that have an ISIN
    const positions = rows
      .filter(row => {
        const isin = row[this.columns.ISIN];
        return isin && isin.trim().length > 0;
      })
      .map(row => this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId, fxRates));

    console.log(`[CFM_PARSER] Mapped ${positions.length} positions (${rows.length - positions.length} skipped - no ISIN)`);

    return positions;
  },

  /**
   * Validate file before parsing
   */
  validate(csvContent) {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 1) {
      return { valid: false, error: 'File is empty' };
    }

    // Check first row has expected number of columns
    const firstRow = lines[0].split(';');
    if (firstRow.length < 15) {
      return {
        valid: false,
        error: `Expected at least 15 columns, found ${firstRow.length}`
      };
    }

    // Verify ISIN column looks like ISINs
    const isin = firstRow[this.columns.ISIN];
    if (isin && isin.length === 12 && /^[A-Z]{2}/.test(isin)) {
      return { valid: true };
    }

    // If first row doesn't have valid ISIN, might be header or empty
    // Check if any row has valid ISIN
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const row = lines[i].split(';');
      const rowIsin = row[this.columns.ISIN];
      if (rowIsin && rowIsin.length === 12 && /^[A-Z]{2}/.test(rowIsin)) {
        return { valid: true };
      }
    }

    return {
      valid: false,
      error: 'No valid ISIN found in file - may not be a POTI positions file'
    };
  },

  /**
   * Map CFM POES (cash/FX) row to standardized schema
   * Handles both COMPTE COURANT (cash) and CHANGE A TERME (FX forwards)
   */
  mapCashToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId, fxRates = {}) {
    const c = this.cashColumns;

    // Parse balances
    // BALANCE_POSITION = balance in original currency (e.g., ILS 301,100)
    // BALANCE_PERF = balance in portfolio/performance currency (e.g., EUR 79,670.76)
    // CAT_DETAIL = notional amount for FX forwards
    let balanceOriginal = this.parseNumber(row[c.BALANCE_POSITION]);
    let balancePortfolio = this.parseNumber(row[c.BALANCE_PERF]);
    const notional = this.parseNumber(row[c.CAT_DETAIL]);
    const currency = row[c.CURRENCY] || 'EUR';
    const portfolioCurrency = row[c.CAT_CURRENCY] || 'EUR';
    const accountType = row[c.ACCOUNT_TYPE] || '';
    const isFxForward = accountType.toUpperCase().includes('CHANGE A TERME');

    // For FX forwards with zero balance, use notional amount
    if (isFxForward && (!balanceOriginal || balanceOriginal === 0) && notional) {
      balanceOriginal = notional;
      // Also try to convert notional to EUR if no portfolio balance
      if (!balancePortfolio && currency !== 'EUR') {
        balancePortfolio = this.convertToEur(notional, currency, fxRates);
      }
      console.log(`[CFM_FX_FORWARD] Using notional ${notional} ${currency} for FX forward (balance was 0)`);
    }

    // If no portfolio value from file, calculate using FX rates
    if (!balancePortfolio && balanceOriginal && currency !== 'EUR') {
      balancePortfolio = this.convertToEur(balanceOriginal, currency, fxRates);
      if (balancePortfolio) {
        console.log(`[CFM_FX] Converted ${currency} ${balanceOriginal.toFixed(2)} to EUR ${balancePortfolio.toFixed(2)} using rate ${fxRates[currency]}`);
      }
    }

    // Use portfolio currency value for marketValue, original for quantity
    const balance = balanceOriginal;

    // Determine security type based on account type
    // Uses SECURITY_TYPES constants from instrumentTypes.js
    // Note: isFxForward already defined above
    const isCash = accountType.toUpperCase().includes('COMPTE COURANT');
    const securityType = isCash ? SECURITY_TYPES.CASH : (isFxForward ? SECURITY_TYPES.FX_FORWARD : SECURITY_TYPES.CASH);

    // Build ticker and security name based on type
    let ticker, securityName;
    if (isFxForward) {
      const reference = row[c.REFERENCE] || '';
      ticker = reference || `FX_${currency}`;
      securityName = `FX Forward ${currency}`;
    } else {
      ticker = `CASH_${currency}`;
      securityName = `Cash ${currency}`;
    }

    // Parse dates - POES uses DDMMYYYY format but may be 7 digits (missing leading 0)
    let statementDateStr = row[c.STATEMENT_DATE] || '';
    // Pad to 8 digits if only 7 (e.g., 2122025 -> 02122025)
    if (statementDateStr.length === 7) {
      statementDateStr = '0' + statementDateStr;
    }
    const statementDate = this.parseDate(statementDateStr, 'DDMMYYYY');

    // Build account number - strip leading zeros
    const clientNumber = row[c.CLIENT_NUMBER] || '';
    const accountNumber = clientNumber.replace(/^0+/, '') || clientNumber;

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null, // Will be set by caller
      sourceFile,
      sourceFilePath: null, // Will be set by caller
      fileDate,
      dataDate: statementDate || fileDate,
      processingDate: new Date(),

      // Account & Portfolio Information
      portfolioCode: accountNumber,
      accountNumber: accountNumber,
      thirdPartyCode: accountNumber,
      originalPortfolioCode: clientNumber,

      // Security Information
      isin: null, // Cash and FX forwards don't have ISINs
      ticker: ticker,
      securityName: securityName,
      securityType: securityType,

      // Position Data
      quantity: balanceOriginal, // Original currency amount (e.g., ILS 301,100)
      marketValue: balancePortfolio || balanceOriginal, // EUR countervalue for display
      marketValueNoAccruedInterest: balancePortfolio || balanceOriginal,
      marketValueOriginalCurrency: balanceOriginal, // Original currency amount
      bookValue: balancePortfolio || balanceOriginal, // EUR countervalue
      currency: currency,
      portfolioCurrency: portfolioCurrency,

      // Pricing Information
      priceType: 'absolute',
      marketPrice: 1, // Cash is always 1:1 in its own currency
      priceDate: statementDate || fileDate,
      priceCurrency: currency,

      // Cost Price
      costPrice: 1,
      lastPrice: 1,
      lastPriceCurrency: currency,

      // Cost Basis
      costBasisOriginalCurrency: balanceOriginal,
      costBasisPortfolioCurrency: balancePortfolio || balanceOriginal,

      // Performance Metrics (cash has no performance)
      unrealizedPnL: 0,
      unrealizedPnLPercent: 0,

      // Bank-Specific Fields
      bankSpecificData: {
        accountOrder: row[c.ACCOUNT_ORDER],
        accountType: accountType,
        portfolioWeight: this.parseNumber(row[c.PORTFOLIO_WEIGHT]),
        balanceOriginal: balanceOriginal, // Original currency balance
        balancePerf: balancePortfolio, // Portfolio currency (EUR) balance
        accruedInterest: this.parseNumber(row[c.ACCRUED_INTEREST]),
        iban: row[c.IBAN],
        catDetail: this.parseNumber(row[c.CAT_DETAIL]),
        catCurrency: row[c.CAT_CURRENCY],
        reference: row[c.REFERENCE],
        // For FX forwards, include reference in instrumentDates for uniqueKey differentiation
        instrumentDates: isFxForward ? {
          reference: row[c.REFERENCE]  // e.g., FX0329536
        } : null
      },

      // Metadata
      userId,
      isActive: true,
      version: 1,

      // Bank-provided FX rates (currency → EUR rate)
      // Used by cash calculator to ensure amounts match bank statements
      // CFM rates are "units of currency per 1 EUR", so to convert: EUR = amount / rate
      bankFxRates: fxRates,
    };
  },

  /**
   * Parse POES (cash/FX) file
   * Returns array of standardized position objects for cash and FX forwards
   * @param {object} options.fxRates - FX rates from CRSC file for currency conversion
   */
  parseCash(csvContent, { bankId, bankName, sourceFile, fileDate, userId, fxRates = {} }) {
    console.log(`[CFM_PARSER] Parsing CFM cash/FX file: ${sourceFile}`);
    if (Object.keys(fxRates).length > 0) {
      console.log(`[CFM_PARSER] Using ${Object.keys(fxRates).length} FX rates for conversion`);
    }

    // Parse CSV to array of arrays (no header row)
    const rows = this.parseCSV(csvContent);
    console.log(`[CFM_PARSER] Found ${rows.length} cash/FX rows`);

    // Map each row to standard schema
    // Include FX forwards regardless of balance (they use notional amount)
    // For cash accounts, skip zero balance
    const positions = rows
      .filter(row => {
        const accountType = (row[this.cashColumns.ACCOUNT_TYPE] || '').toUpperCase();
        const isFxForward = accountType.includes('CHANGE A TERME');

        // Always include FX forwards - they use notional amount, not balance
        if (isFxForward) {
          const notional = this.parseNumber(row[this.cashColumns.CAT_DETAIL]);
          return notional !== null && notional !== 0;
        }

        // For cash accounts, skip zero balance
        const balance = this.parseNumber(row[this.cashColumns.BALANCE_POSITION]);
        return balance !== null && balance !== 0;
      })
      .map(row => this.mapCashToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId, fxRates));

    console.log(`[CFM_PARSER] Mapped ${positions.length} cash/FX positions (${rows.length - positions.length} skipped)`);

    return positions;
  },

  /**
   * Validate POES (cash/FX) file before parsing
   */
  validateCash(csvContent) {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 1) {
      return { valid: false, error: 'File is empty' };
    }

    // Check first row has expected number of columns for POES
    const firstRow = lines[0].split(';');
    if (firstRow.length < 10) {
      return {
        valid: false,
        error: `Expected at least 10 columns for POES file, found ${firstRow.length}`
      };
    }

    // Check if account type column looks like cash/FX account types
    const accountType = firstRow[this.cashColumns.ACCOUNT_TYPE] || '';
    if (accountType.includes('COMPTE') || accountType.includes('CHANGE')) {
      return { valid: true };
    }

    // Check other rows
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      const row = lines[i].split(';');
      const rowAccountType = row[this.cashColumns.ACCOUNT_TYPE] || '';
      if (rowAccountType.includes('COMPTE') || rowAccountType.includes('CHANGE')) {
        return { valid: true };
      }
    }

    return {
      valid: false,
      error: 'No valid account type found in file - may not be a POES cash file'
    };
  }
};
