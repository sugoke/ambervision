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

export const CMBMonacoParser = {
  /**
   * Bank identifier
   */
  bankName: 'CMB Monaco',

  /**
   * Filename pattern for CMB Monaco position files
   */
  filenamePattern: /TAM_mba_eam_pos_list_bu_mc_(\d{8})\.csv/i,

  /**
   * Filename pattern for CMB Monaco operations/events files
   */
  operationsPattern: /TAM_mba_eam_evt_list_bu_mc_(\d{8})\.csv/i,

  /**
   * Filename pattern for CMB Monaco FX rates files
   */
  fxRatesPattern: /TAM_mba_eam_curry_xchng_bu_mc_(\d{8})\.csv/i,

  /**
   * Filename pattern for CMB Monaco asset list files
   */
  assetListPattern: /TAM_mba_eam_asset_list_bu_mc_(\d{8})\.csv/i,

  /**
   * Filename pattern for CMB Monaco business partner files
   */
  businessPartnerPattern: /TAM_mba_eam_bp_list_bu_mc_(\d{8})\.csv/i,

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
   */
  mapSecurityType(assetTypeId, assetClassId) {
    // First check Asset_Class_ID for cash - this is the most reliable indicator
    // Cash positions may have various Asset_Type_ID values but Asset_Class_ID is always 'cash'
    if (assetClassId === 'cash') {
      return 'CASH';
    }

    const typeMap = {
      // Shares
      'shs_ord': 'EQUITY',
      'shs_reg': 'EQUITY',
      // Bonds
      'bond_fix': 'BOND',
      'bond_var': 'BOND',
      // Funds
      'fd_var': 'FUND',
      'fd_shs': 'FUND',
      'fd_mm': 'MONEY_MARKET_FUND',
      // Cash (fallback if Asset_Class_ID check missed it)
      'cash_acc': 'CASH',
      // Other (to be skipped in filtering)
      'lmt_std': 'LIMIT',
      'sdbc': 'SAFE_DEPOSIT',
    };

    return typeMap[assetTypeId] || assetClassId?.toUpperCase() || 'UNKNOWN';
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
    // Bonds use percentage pricing (99.43 = 99.43%)
    const percentageTypes = ['bond_fix', 'bond_var'];
    return percentageTypes.includes(assetTypeId);
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
   * IMPORTANT: Uses Position_Number as primary identifier when available.
   * This ensures stable keys regardless of cash detection logic changes.
   * Without this, changing isCash detection would generate different keys
   * for the same position, causing duplicates instead of updates.
   */
  generateUniqueKey(portfolioCode, isin, instrumentCode, currency, positionNumber) {
    const crypto = require('crypto');

    // Use Position_Number as primary identifier when available
    // This ensures stable keys regardless of cash detection logic
    if (positionNumber) {
      const key = `cmb-monaco|${portfolioCode}|${positionNumber}`;
      return crypto.createHash('sha256').update(key).digest('hex');
    }

    // Fallback for positions without Position_Number
    if (isin) {
      const key = `cmb-monaco|${portfolioCode}|${isin}`;
      return crypto.createHash('sha256').update(key).digest('hex');
    }

    if (instrumentCode) {
      const key = `cmb-monaco|${portfolioCode}|${instrumentCode}|${currency}`;
      return crypto.createHash('sha256').update(key).digest('hex');
    }

    // Last resort fallback
    const key = `cmb-monaco|${portfolioCode}|unknown`;
    return crypto.createHash('sha256').update(key).digest('hex');
  },

  /**
   * Check if this is a cash position based on Asset_Class_ID
   */
  isCashPosition(assetClassId) {
    return assetClassId === 'cash';
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
    const isCash = this.isCashPosition(assetClassId);

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
    // Position_Value is in SECURITY currency (e.g., SEK for SEK stocks)
    const marketValueSecCcy = this.parseNumber(row.Position_Value);
    // Cost_Value_in_Ref_Ccy is in REFERENCE currency (EUR - portfolio base currency)
    const costBasisRefCcy = this.parseNumber(row.Cost_Value_in_Ref_Ccy);

    // Calculate cost basis in SECURITY currency (quantity × normalized cost price)
    // This allows proper P&L calculation (apples to apples comparison)
    const costBasisSecCcy = this.calculateCostBasis(quantity, normalizedCostPrice);

    // Convert market value to EUR using FX rates
    // FX rates format: CCY;EUR;Date;Quote where Quote is DIVIDE to get EUR
    // Example: USD;EUR;1.1755 means $1 / 1.1755 = €0.85
    const currency = row.Ccy || 'EUR';
    let marketValueRefCcy = marketValueSecCcy; // Default: same currency if EUR or no rate available

    if (currency !== 'EUR' && marketValueSecCcy !== null && marketValueSecCcy !== undefined) {
      if (fxRates[currency] && fxRates[currency]['EUR']) {
        const fxRate = fxRates[currency]['EUR'];
        marketValueRefCcy = marketValueSecCcy / fxRate;
        // Only log for non-trivial conversions
        if (Math.abs(marketValueSecCcy) > 100) {
          console.log(`[CMB_PARSER] FX: ${marketValueSecCcy.toFixed(2)} ${currency} / ${fxRate} = ${marketValueRefCcy.toFixed(2)} EUR`);
        }
      } else {
        console.warn(`[CMB_PARSER] No FX rate for ${currency}→EUR, using unconverted value`);
      }
    }

    // Determine price type
    const priceType = this.isPercentagePricing(assetTypeId) ? 'percentage' : 'absolute';

    // Normalize portfolio code (strip leading zeros: 00302894 -> 302894)
    const portfolioCode = this.stripLeadingZeros(row.Client_Number) || '';

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
      portfolioCode: portfolioCode,
      accountNumber: row.Portfolio_Number || null,
      thirdPartyCode: row.EAM_Key || null,

      // Security Information - cash positions don't have real ISINs
      isin: realIsin,
      ticker: ticker,
      securityName: row.Asset || null,
      securityType: this.mapSecurityType(assetTypeId, assetClassId),

      // Position Data
      quantity: quantity,
      marketValue: marketValueRefCcy,              // In portfolio currency (EUR) - used by UI for Portfolio Value column
      marketValueOriginalCurrency: marketValueSecCcy, // Position_Value is in security currency - used by UI for Market Value column
      marketValueRefCcy: marketValueRefCcy,        // Alias: Market value converted to EUR
      marketValuePortfolioCurrency: marketValueRefCcy, // Alias: Market value in EUR for display
      currency: row.Ccy || null,
      portfolioCurrency: 'EUR', // CMB Monaco reference currency is EUR

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

      // Performance Metrics - calculated in PORTFOLIO currency (EUR) for UI consistency
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

    // Filter and map rows
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

      // Account Information (strip leading zeros: 00302894 -> 302894)
      portfolioCode: this.stripLeadingZeros(row.Client_Number) || '',
      accountNumber: row.Portfolio_Number || null,
      positionNumber: row.Position_Number || null,

      // Security Information
      isin: row.ISIN || null,
      securityName: row.Position || null,
      assetClass: row.Asset_Class || null,

      // Transaction Details
      operationType: row.Order_Type_ID || null,
      operationTypeName: row.Order_Type || null,
      transactionCategory: row.Meta_Type_ID || null,
      transactionCategoryName: row.Meta_Type || null,
      description: row.Internal_Booking_Text || null,

      // Dates
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
