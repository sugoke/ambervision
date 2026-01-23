/**
 * SG Monaco Position File Parser
 *
 * Parses Societe Generale Monaco decrypted CSV position files
 *
 * Filename formats:
 *   - posit.YYYYMMDD.csv - positions (main securities file)
 *   - secur.YYYYMMDD.csv - securities reference data
 *   - price.YYYYMMDD.csv - price data
 *   - excha.YYYYMMDD.csv - exchange rates
 *   - trans.YYYYMMDD.csv - transactions
 *
 * File format: Pipe-delimited (|)
 */

import { SECURITY_TYPES } from '../constants/instrumentTypes.js';
import { OPERATION_TYPES } from '../constants/operationTypes.js';

export const SGMonacoParser = {
  /**
   * Bank identifier
   */
  bankName: 'Societe Generale Monaco',

  /**
   * Filename pattern for SG Monaco position files
   * Format: posit.YYYYMMDD.csv
   */
  filenamePattern: /^posit\.(\d{8})\.csv$/i,

  /**
   * Filename pattern for SG Monaco securities reference files
   */
  securitiesPattern: /^secur\.(\d{8})\.csv$/i,

  /**
   * Filename pattern for SG Monaco price files
   */
  pricePattern: /^price\.(\d{8})\.csv$/i,

  /**
   * Filename pattern for SG Monaco exchange rate files
   */
  fxRatesPattern: /^excha\.(\d{8})\.csv$/i,

  /**
   * Filename pattern for SG Monaco transaction files
   */
  transactionsPattern: /^trans\.(\d{8})\.csv$/i,

  /**
   * Check if filename matches SG Monaco position file pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Check if filename matches SG Monaco FX rates pattern
   */
  matchesFxRatesPattern(filename) {
    return this.fxRatesPattern.test(filename);
  },

  /**
   * Check if filename matches SG Monaco transactions pattern
   */
  matchesTransactionsPattern(filename) {
    return this.transactionsPattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: posit.YYYYMMDD.csv → Date object
   */
  extractFileDate(filename) {
    // Try all patterns
    let match = filename.match(this.filenamePattern);
    if (!match) match = filename.match(this.securitiesPattern);
    if (!match) match = filename.match(this.pricePattern);
    if (!match) match = filename.match(this.fxRatesPattern);
    if (!match) match = filename.match(this.transactionsPattern);

    if (!match) {
      throw new Error(`Filename does not match SG Monaco pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // 0-indexed
    const day = parseInt(dateStr.substring(6, 8));

    return new Date(year, month, day);
  },

  /**
   * Validate file content
   */
  validate(csvContent) {
    if (!csvContent || csvContent.trim().length === 0) {
      return { valid: false, error: 'Empty file content' };
    }

    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      return { valid: false, error: 'File has no data rows' };
    }

    return { valid: true };
  },

  /**
   * Parse CSV content with delimiter auto-detection
   * SG Monaco uses pipe (|) delimiter
   * @param {string} csvContent - Raw CSV content
   * @returns {Array} Array of row objects with column headers as keys
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');

    // Auto-detect delimiter - check for pipe first (SG Monaco uses pipe)
    const firstLine = lines[0];
    const delimiter = firstLine.includes('|') ? '|' :
                      firstLine.includes(';') ? ';' :
                      firstLine.includes('\t') ? '\t' : ',';

    // Parse headers
    const headers = firstLine.split(delimiter).map(h => h.trim().replace(/^"|"$/g, ''));

    console.log(`[SG_PARSER] Detected delimiter: "${delimiter}"`);
    console.log(`[SG_PARSER] CSV Headers (${headers.length}): ${headers.slice(0, 10).join(', ')}${headers.length > 10 ? '...' : ''}`);

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Handle quoted fields with delimiter inside
      const values = this.parseCSVLine(line, delimiter);
      const row = {};

      // Debug: Check for column count mismatch
      if (values.length !== headers.length) {
        console.log(`[SG_PARSER] Row ${i} column mismatch: ${values.length} values vs ${headers.length} headers`);
      }

      headers.forEach((header, index) => {
        row[header] = values[index] ? values[index].trim().replace(/^"|"$/g, '') : '';
      });

      rows.push(row);
    }

    return rows;
  },

  /**
   * Parse a single CSV line handling quoted fields
   */
  parseCSVLine(line, delimiter) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === delimiter && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current); // Last field

    return values;
  },

  /**
   * Parse number from string
   * SG Monaco uses standard decimal format (1234.56)
   */
  parseNumber(value) {
    if (!value || value === '') return null;

    let clean = String(value).replace(/"/g, '').trim();

    // Remove percentage symbol if present
    if (clean.endsWith('%')) {
      clean = clean.slice(0, -1);
    }

    const num = parseFloat(clean);
    return isNaN(num) ? null : num;
  },

  /**
   * Parse date from string
   * Supports: YYYYMMDD format (SG Monaco standard)
   */
  parseDate(dateStr) {
    if (!dateStr) return null;

    const clean = String(dateStr).trim();

    // YYYYMMDD format
    if (/^\d{8}$/.test(clean)) {
      const year = parseInt(clean.substring(0, 4));
      const month = parseInt(clean.substring(4, 6)) - 1;
      const day = parseInt(clean.substring(6, 8));
      return new Date(year, month, day);
    }

    return null;
  },

  /**
   * Parse FX rates file (excha.YYYYMMDD.csv)
   * @returns {Object} Map of currency code → EUR rate (multiply format for conversion TO EUR)
   *
   * SG Monaco FX format:
   *   CUR_COD|CUR_UNDERLYING|CUR_XRATE|CUR_XRATE_D
   *   USD|EUR|0.857928500|20260113
   *
   * CUR_XRATE is the rate to convert FROM CUR_COD TO EUR (multiply format)
   * Example: 100 USD × 0.857928500 = 85.79 EUR
   */
  parseFxRates(csvContent) {
    const rates = {};
    const rows = this.parseCSV(csvContent);

    console.log(`[SG_PARSER] Parsing FX rates from ${rows.length} rows`);

    for (const row of rows) {
      const currency = row.CUR_COD;
      const baseCurrency = row.CUR_UNDERLYING;
      const rate = this.parseNumber(row.CUR_XRATE);

      // Only store rates where base is EUR (CUR_UNDERLYING = EUR)
      if (currency && rate && baseCurrency === 'EUR' && currency !== 'EUR') {
        rates[currency] = rate;
      }
    }

    console.log(`[SG_PARSER] Parsed ${Object.keys(rates).length} FX rates to EUR`);
    return rates;
  },

  /**
   * Filename pattern for SG Monaco price files
   */
  pricesPattern: /^price\.(\d{8})\.csv$/i,

  /**
   * Check if filename matches SG Monaco prices pattern
   */
  matchesPricesPattern(filename) {
    return this.pricesPattern.test(filename);
  },

  /**
   * Parse price file (price.YYYYMMDD.csv)
   * @returns {Object} Map of ISIN → { price, currency, priceDate, calcRule }
   *
   * SG Monaco price format:
   *   INS_ISN_COD|INS_CUR|INS_PRICE_D|INS_CUR_PRI|INS_PRI_CALC_RULE
   *   XS2487830361|USD|20260113|1.128600000|Quote/100
   *
   * INS_PRI_CALC_RULE:
   *   - "Quote/100" = price in decimal format (1.0459 = 104.59%)
   *   - "Quote" = absolute price (87.82 USD for ETFs/stocks)
   */
  parsePrices(csvContent) {
    const prices = {};
    const rows = this.parseCSV(csvContent);

    console.log(`[SG_PARSER] Parsing prices from ${rows.length} rows`);

    for (const row of rows) {
      const isin = row.INS_ISN_COD;
      const currency = row.INS_CUR;
      const rawPrice = this.parseNumber(row.INS_CUR_PRI);
      const priceDate = this.parseDate(row.INS_PRICE_D);
      const calcRule = row.INS_PRI_CALC_RULE || '';

      if (isin && rawPrice !== null) {
        // Determine if this is a percentage price (Quote/100) or absolute (Quote)
        const isPercentage = calcRule.toLowerCase().includes('/100');

        prices[isin] = {
          price: rawPrice,           // Raw price value
          currency: currency,        // Instrument currency
          priceDate: priceDate,      // Price date
          calcRule: calcRule,        // Original calc rule
          isPercentage: isPercentage // true if Quote/100, false if Quote
        };
      }
    }

    console.log(`[SG_PARSER] Parsed ${Object.keys(prices).length} instrument prices`);
    return prices;
  },

  /**
   * Map SG security type to standard type
   *
   * SG Monaco INS_NATURE values from secur.csv:
   * - Cash Account
   * - Fund Share
   * - Fixed Income (bonds, structured products)
   * - Money Market
   */
  mapSecurityType(insNature, insType, insSubType, insName) {
    if (!insNature) return SECURITY_TYPES.UNKNOWN;

    const nature = String(insNature).toLowerCase().trim();
    const type = String(insType || '').toLowerCase();
    const subType = String(insSubType || '').toLowerCase();
    const name = String(insName || '').toLowerCase();

    // Cash accounts
    if (nature === 'cash account' || name.includes('cav')) {
      return SECURITY_TYPES.CASH;
    }

    // Money Market
    if (nature === 'money market' || type.includes('mm-')) {
      return SECURITY_TYPES.MONEY_MARKET;
    }

    // Funds
    if (nature === 'fund share') {
      // Check for ETF
      if (name.includes('etf') || type.includes('etf')) {
        return SECURITY_TYPES.ETF;
      }
      // Check for private equity
      if (subType.includes('private') || subType.includes('pe fund')) {
        return SECURITY_TYPES.PRIVATE_EQUITY;
      }
      return SECURITY_TYPES.FUND;
    }

    // Fixed Income - could be bonds or structured products
    if (nature === 'fixed income') {
      // Structured products have specific patterns in type/subtype
      // EQU-SPST = Structured Product Equity
      // BDS-SPBO = Structured Product Bonds
      // MSC-SPMS = Structured Product Miscellaneous
      if (type.includes('sp') || type.includes('struct') ||
          subType.includes('struc') || subType.includes('struct')) {
        return SECURITY_TYPES.STRUCTURED_PRODUCT;
      }
      // Otherwise it's a bond
      return SECURITY_TYPES.BOND;
    }

    console.log(`[SG_PARSER] Unknown security type - nature: ${insNature}, type: ${insType}, subType: ${insSubType}`);
    return SECURITY_TYPES.UNKNOWN;
  },

  /**
   * Check if this is a cash position
   */
  isCashPosition(row) {
    const insName = String(row.INS_NAME || '').toUpperCase();
    // CAV = Compte à Vue (current account)
    // M401 TIME DEPOS. CAL = Time deposits
    return insName === 'CAV' || insName.includes('TIME DEPOS');
  },

  /**
   * Normalize price to decimal format
   * SG Monaco stores prices in percentage format for bonds/structured products
   * POS_CST_PRI of 98.010000000 means 98.01%
   *
   * @param {number} rawValue - Raw price value
   * @param {boolean} isCash - Whether this is a cash position
   * @returns {number} Normalized price (1.0 = 100%)
   */
  normalizePrice(rawValue, isCash) {
    if (!rawValue && rawValue !== 0) return null;

    // Cash always 1.0
    if (isCash) return 1.0;

    // SG stores percentage prices as whole numbers (98.01 = 98.01%)
    // Normalize to decimal (0.9801 = 98.01%)
    if (rawValue > 10) {
      return rawValue / 100;
    }

    // Already in decimal format or small value
    return rawValue;
  },

  /**
   * Generate unique key for position
   */
  generateUniqueKey(portfolioCode, isin, internalCode, currency) {
    const crypto = require('crypto');

    // For positions with ISIN
    if (isin) {
      const key = `sg-monaco|${portfolioCode}|${isin}`;
      return crypto.createHash('sha256').update(key).digest('hex');
    }

    // For cash positions (no ISIN) - use internal code + currency
    if (internalCode) {
      const key = `sg-monaco|${portfolioCode}|CASH|${internalCode}|${currency}`;
      return crypto.createHash('sha256').update(key).digest('hex');
    }

    // Fallback
    const key = `sg-monaco|${portfolioCode}|${currency}|${Date.now()}`;
    return crypto.createHash('sha256').update(key).digest('hex');
  },

  /**
   * Parse positions file and return standardized holdings
   *
   * SG Monaco posit.csv columns:
   * - PTF_COD: Portfolio code (MC72132113)
   * - PTF_CLI_COD: Client code (FI416278)
   * - PTF_VAL_CUR: Portfolio valuation currency (EUR/USD)
   * - INS_NAME: Instrument name
   * - INS_INT_COD: Internal instrument code
   * - INS_ISN_COD: ISIN code
   * - POS_QTY: Quantity
   * - POS_MKT_VAL: Market value in portfolio currency
   * - POS_CST_PRI: Cost price (percentage format, 98.01 = 98.01%)
   * - POS_NET_CST_VAL: Net cost value
   * - POS_SPT_PRI: Spot price (percentage format)
   * - POS_CUR_SYS_EXG_RAT: Exchange rate to portfolio currency
   * - POS_SHT_CUR / POS_LNG_CUR: Position currency (short/long)
   * - POS_ACC_INT: Accrued interest
   * - POS_RATE_P: Interest rate percentage
   */
  parse(csvContent, options = {}) {
    const { bankId, bankName, sourceFile, fileDate, userId, fxRates = {}, prices = {} } = options;

    const validation = this.validate(csvContent);
    if (!validation.valid) {
      console.error(`[SG_PARSER] Validation failed: ${validation.error}`);
      return [];
    }

    const rows = this.parseCSV(csvContent);
    console.log(`[SG_PARSER] Parsing ${rows.length} position rows from ${sourceFile}`);
    console.log(`[SG_PARSER] Using ${Object.keys(prices).length} prices from price file`);

    const positions = [];

    for (const row of rows) {
      try {
        const position = this.mapToStandardSchema(row, {
          bankId,
          bankName,
          sourceFile,
          fileDate,
          userId,
          fxRates,
          prices
        });

        if (position) {
          positions.push(position);
        }
      } catch (error) {
        console.error(`[SG_PARSER] Error parsing row: ${error.message}`);
      }
    }

    console.log(`[SG_PARSER] Successfully parsed ${positions.length} positions`);
    return positions;
  },

  /**
   * Map row to standardized PMSHoldings schema
   */
  mapToStandardSchema(row, options) {
    const { bankId, bankName, sourceFile, fileDate, userId, fxRates, prices = {} } = options;

    // Check if this is a cash position
    const isCash = this.isCashPosition(row);

    // Extract values
    // Strip "MC" prefix from portfolio code (SG Monaco uses MC72132113, our system uses 72132113)
    const portfolioCode = (row.PTF_COD || '').replace(/^MC/i, '');
    const clientCode = row.PTF_CLI_COD || '';
    const portfolioCurrency = row.PTF_VAL_CUR || 'EUR';
    const isin = isCash ? null : (row.INS_ISN_COD || null);
    const internalCode = row.INS_INT_COD || '';
    const securityName = row.INS_NAME || '';
    const quantity = this.parseNumber(row.POS_QTY);
    const marketValue = this.parseNumber(row.POS_MKT_VAL);
    const costPrice = this.parseNumber(row.POS_CST_PRI);
    const netCostValue = this.parseNumber(row.POS_NET_CST_VAL);
    const grossCostValue = this.parseNumber(row.POS_GROS_CST_VAL);
    const spotPrice = this.parseNumber(row.POS_SPT_PRI);
    const exchangeRate = this.parseNumber(row.POS_CUR_SYS_EXG_RAT);
    const accruedInterest = this.parseNumber(row.POS_ACC_INT);
    const interestRate = this.parseNumber(row.POS_RATE_P);
    const positionDate = this.parseDate(row.POS_VAL_D);

    // Look up price and currency from price file (SG Monaco provides prices in separate file)
    const priceData = isin ? prices[isin] : null;

    // Helper: Extract currency from internal code for cash positions
    // Format: MC72132113-0013200-JPY → JPY
    const extractCurrencyFromInternalCode = (code) => {
      const match = code.match(/-([A-Z]{3})$/);
      return match ? match[1] : null;
    };

    // Determine position/instrument currency
    // For cash: prefer currency from INS_INT_COD (e.g., MC72132113-0013200-JPY → JPY)
    // For non-cash: prefer price file currency (INS_CUR), then position fields
    let instrumentCurrency;
    if (isCash) {
      instrumentCurrency = extractCurrencyFromInternalCode(internalCode) || row.POS_SHT_CUR || row.POS_LNG_CUR || portfolioCurrency;
    } else {
      instrumentCurrency = priceData?.currency || row.POS_SHT_CUR || row.POS_LNG_CUR || portfolioCurrency;
    }

    // Skip rows without essential data
    if (!quantity && !marketValue) {
      return null;
    }

    // Normalize cost price to decimal format
    const normalizedCostPrice = this.normalizePrice(costPrice, isCash);

    // Get market price from price file (INS_CUR_PRI)
    // Price file values are already in correct format:
    //   - Quote/100: decimal format (1.0459 = 104.59%)
    //   - Quote: absolute price (87.82 for ETFs)
    let normalizedMarketPrice = null;
    let priceType = isCash ? 'absolute' : 'percentage';
    let priceDate = positionDate || fileDate;

    if (priceData) {
      normalizedMarketPrice = priceData.price;
      priceDate = priceData.priceDate || priceDate;
      // If not Quote/100, it's an absolute price (ETFs, stocks)
      if (!priceData.isPercentage) {
        priceType = 'absolute';
      }
    } else if (!isCash) {
      // Fallback: calculate from marketValue / quantity if no price file data
      if (quantity && marketValue) {
        normalizedMarketPrice = marketValue / quantity;
      }
    } else {
      // Cash positions: price is 1.0
      normalizedMarketPrice = 1.0;
      priceType = 'absolute';
    }

    // Determine security type (will be overridden by SecurityResolver for positions with ISIN)
    // For cash, set explicitly since SecurityResolver can't classify without ISIN
    let securityType = null;
    if (isCash) {
      if (securityName.includes('TIME DEPOS')) {
        // M401 TIME DEPOS. CAL = Time deposits (fixed-term deposits, NOT money market funds)
        securityType = SECURITY_TYPES.TERM_DEPOSIT;
      } else {
        securityType = SECURITY_TYPES.CASH;
      }
    }

    // Calculate cost basis if not provided
    const costBasis = netCostValue || (quantity && normalizedCostPrice ? quantity * normalizedCostPrice : null);

    // Calculate unrealized P&L
    const unrealizedPnL = (marketValue !== null && costBasis !== null) ? marketValue - costBasis : null;
    const unrealizedPnLPercent = (unrealizedPnL !== null && costBasis !== null && costBasis !== 0)
      ? (unrealizedPnL / Math.abs(costBasis)) * 100
      : null;

    // Generate unique key
    const uniqueKey = this.generateUniqueKey(portfolioCode, isin, internalCode, instrumentCurrency);

    // Build bank FX rates for this holding (use instrument currency from price file)
    const holdingFxRates = {};
    if (instrumentCurrency && instrumentCurrency !== 'EUR' && fxRates[instrumentCurrency]) {
      holdingFxRates[instrumentCurrency] = fxRates[instrumentCurrency];
    }

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null, // Set by caller
      sourceFile,
      sourceFilePath: null,
      fileDate,
      dataDate: positionDate || fileDate,
      snapshotDate: positionDate || fileDate,
      processingDate: new Date(),

      // Account & Portfolio Information
      portfolioCode,
      clientCode,
      accountNumber: portfolioCode,
      thirdPartyCode: null,

      // Security Information
      isin,
      ticker: internalCode || null,
      securityName,
      securityType, // null for non-cash (SecurityResolver will classify), set for cash
      securityTypeCode: null, // SG doesn't provide type codes in posit file
      securityTypeDesc: null,

      // Position Data
      quantity,
      marketValue,
      marketValueOriginalCurrency: marketValue, // SG provides value in portfolio currency
      marketValueRefCcy: marketValue,
      marketValuePortfolioCurrency: marketValue,
      currency: instrumentCurrency, // From price file (INS_CUR) - instrument currency
      portfolioCurrency,

      // Pricing Information
      priceType, // 'percentage' for Quote/100, 'absolute' for Quote
      marketPrice: normalizedMarketPrice,
      priceDate,
      priceCurrency: instrumentCurrency,

      // Cost Information
      costPrice: normalizedCostPrice,
      costBasisOriginalCurrency: costBasis,
      costBasisPortfolioCurrency: costBasis,

      // Performance Metrics
      unrealizedPnL,
      unrealizedPnLPercent,

      // Accrued Interest
      accruedInterest,

      // Versioning
      uniqueKey,
      isLatest: true,
      isActive: true,
      version: 1,

      // Bank-Specific Fields
      bankSpecificData: {
        envCode: row.ENV_COD,
        envDate: row.ENV_DATE,
        positionDate: row.POS_VAL_D,
        lockReason: row.POS_LCK_REA,
        internalCode,
        sedolCode: row.INS_SED_COD,
        tekCode: row.INS_TEK_COD,
        contractNumber: row.POS_CONTR_NR,
        costExchangeRate: this.parseNumber(row.POS_CST_EXG_RAT),
        grossCostValue,
        forwardPrice: this.parseNumber(row.POS_FWD_PRI),
        expiryDate: row.POS_EXP_D,
        fees: this.parseNumber(row.POS_FEES),
        taxes: this.parseNumber(row.POS_TAXES),
        deposit: row.POS_DEPOSIT,
        depositAccount: row.POS_DEP_ACC,
        contractSize: this.parseNumber(row.INS_CONTRACT_SIZE),
        underlyingInternalCode: row.INS_UNDERL_INT_COD,
        underlyingIsin: row.INS_UNDERL_ISN_COD,
        underlyingSedol: row.INS_UNDERL_SED_COD,
        underlyingTek: row.INS_UNDERL_TEK_COD,
        interestRate,
        isCash
      },

      // Metadata
      userId,

      // Bank-provided FX rates
      bankFxRates: holdingFxRates
    };
  },

  /**
   * Parse transactions file (trans.YYYYMMDD.csv)
   *
   * SG Monaco trans.csv columns:
   * - PTF_COD: Portfolio code
   * - OPE_TYPE: Operation type (Income, Sell, etc.)
   * - OPE_NATURE: Operation nature (SEC-CPS_03 = coupon, SEC-RBT_02 = redemption)
   * - INS_ISN_COD: ISIN
   * - INS_NAME: Security name
   * - OPE_QTY: Quantity
   * - OPE_NET_AMOUNT: Net amount
   * - OPE_GROS_AMT: Gross amount
   * - OPE_OPER_DATE: Operation date
   * - OPE_VALUE_DATE: Value date
   * - OPE_CUR: Currency
   * - OPE_REMARKS: Description/remarks
   */
  parseOperations(csvContent, options = {}) {
    const { bankId, bankName, sourceFile, fileDate, userId } = options;

    // More lenient validation for operations - empty files are valid (no transactions)
    if (!csvContent || csvContent.trim().length === 0) {
      console.log(`[SG_PARSER] Empty operations file: ${sourceFile}`);
      return [];
    }

    const rows = this.parseCSV(csvContent);
    console.log(`[SG_PARSER] Parsing ${rows.length} transaction rows from ${sourceFile}`);

    const operations = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        console.log(`[SG_PARSER] Processing row ${i + 1}: OPE_TYPE=${row.OPE_TYPE}, OPE_NATURE=${row.OPE_NATURE}, OPE_LINE_TYPE=${row.OPE_LINE_TYPE}, INS_NAME=${row.INS_NAME}`);

        const operation = this.mapOperationToSchema(row, {
          bankId,
          bankName,
          sourceFile,
          fileDate,
          userId
        });

        if (operation) {
          console.log(`[SG_PARSER] Row ${i + 1} mapped: operationType=${operation.operationType}, isin=${operation.isin}, netAmount=${operation.netAmount}`);
          operations.push(operation);
        } else {
          console.log(`[SG_PARSER] Row ${i + 1} skipped: mapOperationToSchema returned null`);
        }
      } catch (error) {
        console.error(`[SG_PARSER] Error parsing operation row ${i + 1}: ${error.message}`);
      }
    }

    console.log(`[SG_PARSER] Successfully parsed ${operations.length} operations`);
    return operations;
  },

  /**
   * Map SG Monaco operation type to standardized operation type
   */
  mapOperationType(opeType, opeNature, opeRemarks) {
    // SG Monaco field mapping:
    // - OPE_TYPE contains the transaction code (SEC-CPS_03, SEC-RBT_02, etc.)
    // - OPE_NATURE contains the category (Income, Sell, Buy, etc.)
    const typeCode = String(opeType || '').toUpperCase();  // SEC-CPS_03, SEC-RBT_02
    const nature = String(opeNature || '').toLowerCase();   // income, sell, buy
    const remarks = String(opeRemarks || '').toUpperCase();

    // Coupon payments - OPE_NATURE=Income + OPE_TYPE contains CPS
    if (nature === 'income' && (typeCode.includes('CPS') || remarks.includes('COUPON'))) {
      return OPERATION_TYPES.COUPON;
    }

    // Dividends - OPE_NATURE=Income + OPE_TYPE contains DIV
    if (nature === 'income' && (typeCode.includes('DIV') || remarks.includes('DIVIDEND'))) {
      return OPERATION_TYPES.DIVIDEND;
    }

    // Redemptions / Maturities - OPE_NATURE=Sell + OPE_TYPE contains RBT
    if (nature === 'sell' && (typeCode.includes('RBT') || remarks.includes('REDEMPTION') || remarks.includes('MATURITY'))) {
      return OPERATION_TYPES.REDEMPTION;
    }

    // Sales
    if (nature === 'sell') {
      return OPERATION_TYPES.SELL;
    }

    // Purchases
    if (nature === 'buy' || nature === 'purchase') {
      return OPERATION_TYPES.BUY;
    }

    // Interest - OPE_NATURE=Income + OPE_TYPE contains INT
    if (nature === 'income' && (typeCode.includes('INT') || remarks.includes('INTEREST'))) {
      return OPERATION_TYPES.INTEREST;
    }

    // Generic income (fallback for other income types)
    if (nature === 'income') {
      return OPERATION_TYPES.COUPON; // Default income to coupon
    }

    // Income distributions (OPE_NATURE='Investment' but remarks indicate income)
    // Examples: "INCOME DISTRIBUTION KUBER CAPITAL TRUST..."
    if (remarks.includes('INCOME DISTRIBUTION') || remarks.includes('DISTRIBUTION')) {
      return OPERATION_TYPES.DIVIDEND; // Fund/trust distributions
    }

    // Fees
    if (typeCode.includes('FEE') || remarks.includes('FEE') || remarks.includes('COMMISSION')) {
      return OPERATION_TYPES.FEE;
    }

    // Tax
    if (typeCode.includes('TAX') || remarks.includes('TAX') || remarks.includes('WITHHOLD')) {
      return OPERATION_TYPES.TAX;
    }

    // Transfers
    if (nature === 'transfer' || typeCode.includes('TRF')) {
      return OPERATION_TYPES.TRANSFER_OUT;
    }

    // FX
    if (typeCode.includes('FX') || typeCode.includes('FOREX')) {
      return OPERATION_TYPES.FX_TRADE;
    }

    // Default to OTHER
    console.log(`[SG_PARSER] Unknown operation type: ${opeType}, nature: ${opeNature}`);
    return OPERATION_TYPES.OTHER;
  },

  /**
   * Map SG Monaco instrument nature to operation category
   * INS_NATURE values: Fixed Income, Fund Share, Cash Account, Money Market
   */
  mapOperationCategory(insNature) {
    if (!insNature) return null;

    const nature = String(insNature).toLowerCase().trim();

    if (nature === 'fixed income') {
      return 'BOND';
    }
    if (nature === 'fund share') {
      return 'FUND';
    }
    if (nature === 'cash account') {
      return 'CASH';
    }
    if (nature === 'money market') {
      return 'MONEY_MARKET';
    }

    return 'OTHER';
  },

  /**
   * Map operation row to standardized schema
   */
  mapOperationToSchema(row, options) {
    const { bankId, bankName, sourceFile, fileDate, userId } = options;

    // Debug: Log raw field values for key columns
    console.log(`[SG_PARSER] mapOperationToSchema raw values: INS_NAME=${row.INS_NAME}, OPE_TYPE=${row.OPE_TYPE}, OPE_NATURE=${row.OPE_NATURE}`);
    console.log(`[SG_PARSER]   Dates: OPE_OPER_DATE="${row.OPE_OPER_DATE}", OPE_VALUE_DATE="${row.OPE_VALUE_DATE}", OPE_ACCOUNT_DATE="${row.OPE_ACCOUNT_DATE}"`);
    console.log(`[SG_PARSER]   Amounts: OPE_NET_AMOUNT="${row.OPE_NET_AMOUNT}", OPE_GROS_AMT="${row.OPE_GROS_AMT}", OPE_QTY="${row.OPE_QTY}"`);
    console.log(`[SG_PARSER]   IDs: PTF_COD="${row.PTF_COD}", INS_ISN_COD="${row.INS_ISN_COD}", OPE_REF_CODE="${row.OPE_REF_CODE}"`);

    const operationDate = this.parseDate(row.OPE_OPER_DATE);
    const valueDate = this.parseDate(row.OPE_VALUE_DATE);
    const accountDate = this.parseDate(row.OPE_ACCOUNT_DATE);
    const quantity = this.parseNumber(row.OPE_QTY);
    const grossAmount = this.parseNumber(row.OPE_GROS_AMT);

    // Use OPE_CASH_AMOUNT1 for netAmount (cash perspective, correct sign)
    // OPE_NET_AMOUNT is from security perspective (negative for income/redemption)
    // OPE_CASH_AMOUNT1 is from cash perspective (positive for cash inflows)
    const cashAmount = this.parseNumber(row.OPE_CASH_AMOUNT1);
    const securityNetAmount = this.parseNumber(row.OPE_NET_AMOUNT);
    const netAmount = cashAmount || Math.abs(securityNetAmount) || 0;

    console.log(`[SG_PARSER]   Parsed dates: operationDate=${operationDate}, valueDate=${valueDate}, accountDate=${accountDate}`);
    console.log(`[SG_PARSER]   Parsed amounts: quantity=${quantity}, cashAmount=${cashAmount}, securityNetAmount=${securityNetAmount}, netAmount=${netAmount}`);

    // Skip rows without meaningful data
    if (!operationDate && !valueDate && !accountDate) {
      console.log(`[SG_PARSER]   SKIPPED: All date fields are null/empty`);
      return null;
    }

    // Strip "MC" prefix from portfolio code (SG Monaco uses MC72132113, our system uses 72132113)
    const portfolioCode = (row.PTF_COD || '').replace(/^MC/i, '');

    // Generate unique operation ID
    const crypto = require('crypto');
    const opKey = `sg-monaco|${portfolioCode}|${row.OPE_REF_CODE || ''}|${row.OPE_OPER_DATE}|${row.INS_ISN_COD || row.INS_INT_COD}`;
    const operationId = crypto.createHash('sha256').update(opKey).digest('hex').substring(0, 16);

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null,
      sourceFile,
      fileDate,
      processingDate: new Date(),

      // Operation Identifiers
      operationId,
      operationCode: row.OPE_REF_CODE || row.OPE_TYPE || 'UNKNOWN',  // Critical: Used for uniqueKey generation
      instrumentCode: row.INS_ISN_COD || row.INS_INT_COD || 'CASH',  // Critical: Used for uniqueKey generation
      externalReference: row.OPE_REF_CODE || null,

      // Account Information
      portfolioCode,
      clientCode: row.PTF_CLI_COD || '',
      accountNumber: portfolioCode || null,
      positionNumber: row.OPE_CONTR_NR || null,

      // Security Information
      isin: row.INS_ISN_COD || null,
      securityName: row.INS_NAME || null,
      assetClass: row.INS_NATURE || null,

      // Transaction Details
      operationType: this.mapOperationType(row.OPE_TYPE, row.OPE_NATURE, row.OPE_REMARKS),
      operationCategory: this.mapOperationCategory(row.INS_NATURE),
      operationTypeName: row.OPE_TYPE || null,
      transactionCategory: row.OPE_NATURE || null,
      transactionCategoryName: row.OPE_SUB_TYPE || null,
      description: row.OPE_REMARKS || null,
      originalOperationType: `${row.OPE_TYPE}|${row.OPE_NATURE}`,

      // Dates
      operationDate: operationDate || valueDate || accountDate || fileDate,
      transactionDate: operationDate,
      valueDate: valueDate,
      accountDate: accountDate,

      // Amounts
      quantity: Math.abs(quantity || 0), // Store as positive
      quantitySign: quantity < 0 ? -1 : 1,
      currency: row.OPE_CUR || row.INS_CUR || null,
      grossAmount: grossAmount,
      netAmount: netAmount,
      price: this.parseNumber(row.OPE_PRICE),
      quote: this.parseNumber(row.OPE_QUOTE),

      // Exchange rates
      exchangeRatePtf: this.parseNumber(row.OPE_EXG_RAT_PTF),
      exchangeRateIns: this.parseNumber(row.OPE_EXG_RAT_INS),
      exchangeRateTrad: this.parseNumber(row.OPE_EXG_RAT_TRAD),

      // Cash account details
      cashAccount1: row.OPE_CASH_ACCOUNT1 || null,
      cashAmount1: this.parseNumber(row.OPE_CASH_AMOUNT1),
      cashCurrency1: row.OPE_CASH_ACCT1_CUR || null,

      // Costs and taxes
      accruedAmount: this.parseNumber(row.OPE_ACCR_AMT),
      cost1: this.parseNumber(row.OPE_COST_1_AMT),
      cost1Currency: row.OPE_COST_1_CUR || null,
      tax1: this.parseNumber(row.OPE_TAX_1_AMT),
      tax1Currency: row.OPE_TAX_1_CUR || null,

      // Bank-Specific Data
      bankSpecificData: {
        envCode: row.ENV_COD,
        envDate: row.ENV_DATE,
        lineType: row.OPE_LINE_TYPE,
        opeNature: row.OPE_NATURE,
        opeSubType: row.OPE_SUB_TYPE,
        counterparty: row.OPE_CNT_PTY,
        market: row.OPE_MKT,
        intermediary: row.OPE_INTERMED,
        priCalcRule: row.OPE_PRI_CALC_RULE,
        deposit: row.OPE_DEPOSIT,
        contractSize: this.parseNumber(row.INS_CONTRACT_SIZE),
        underlyingIsin: row.INS_UNDERL_ISN_COD,
        interestRate: this.parseNumber(row.OPE_RATE_P),
        confirmationNumber: row.OPE_CN
      },

      // Metadata
      userId,
      isProcessed: false,
      createdAt: new Date()
    };
  }
};

export default SGMonacoParser;
