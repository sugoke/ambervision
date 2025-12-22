/**
 * Julius Baer Position File Parser
 *
 * Parses Julius Baer CSV position files and converts to standardized schema
 *
 * Filename format: DDS03632510_DAILY_POS_JB.YYYYMMDD.HHMMSS.EAM3632510.CSV
 * Example: DDS03632510_DAILY_POS_JB.20251114.050635.EAM3632510.CSV
 */

export const JuliusBaerParser = {
  /**
   * Bank identifier
   */
  bankName: 'Julius Baer',

  /**
   * Filename pattern for Julius Baer position files
   */
  filenamePattern: /DDS\d+_DAILY_POS_JB\.(\d{8})\.(\d{6})\.EAM\d+\.CSV/i,

  /**
   * Check if filename matches Julius Baer pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: DDS03632510_DAILY_POS_JB.20251114.050635.EAM3632510.CSV
   * Returns: Date object
   */
  extractFileDate(filename) {
    const match = filename.match(this.filenamePattern);
    if (!match) {
      throw new Error(`Filename does not match Julius Baer pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // Month is 0-indexed
    const day = parseInt(dateStr.substring(6, 8));

    return new Date(year, month, day);
  },

  /**
   * Parse CSV content to array of objects
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('CSV file is empty or has no data rows');
    }

    // First line is headers - Julius Baer uses semicolon delimiter
    const headers = lines[0].split(';').map(h => h.trim());

    // Parse remaining lines
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(';');
      const row = {};

      headers.forEach((header, index) => {
        row[header] = values[index] ? values[index].trim() : '';
      });

      rows.push(row);
    }

    return rows;
  },

  /**
   * Map security type from Julius Baer to standard type
   */
  mapSecurityType(jbType) {
    const typeMap = {
      // Text-based types
      'Stock': 'EQUITY',
      'Bond': 'BOND',
      'Fund': 'FUND',
      'ETF': 'ETF',
      'Cash': 'CASH',
      'Option': 'OPTION',
      'Future': 'FUTURE',
      'Warrant': 'WARRANT',
      // Numeric codes used by Julius Baer
      '1': 'EQUITY',
      '2': 'BOND',
      '3': 'FUND',
      '4': 'CASH',
      '5': 'OPTION',
      '6': 'FUTURE',
      '7': 'WARRANT'
    };

    return typeMap[jbType] || jbType || 'UNKNOWN';
  },

  /**
   * Parse number from string (handles percentages, commas, etc.)
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
   * Parse date from string (YYYYMMDD format)
   */
  parseDate(value) {
    if (!value || value === '') return null;

    const str = String(value).trim();

    // Try YYYYMMDD format
    if (str.length === 8) {
      const year = parseInt(str.substring(0, 4));
      const month = parseInt(str.substring(4, 6)) - 1;
      const day = parseInt(str.substring(6, 8));
      return new Date(year, month, day);
    }

    // Try parsing as ISO date
    const date = new Date(str);
    return isNaN(date.getTime()) ? null : date;
  },

  /**
   * Calculate cost basis in original currency
   * Note: costPrice must be in normalized decimal format (e.g., 0.6691 = 66.91%)
   */
  calculateCostBasis(quantity, costPrice) {
    if (!quantity || !costPrice) return null;

    // Simple multiplication - costPrice is already normalized to decimal format
    // by the normalizePrice function (e.g., 1.0 = 100% for percentage-priced instruments)
    return quantity * costPrice;
  },

  /**
   * Calculate cost basis in portfolio currency using exchange rate
   */
  calculateCostBasisPortfolioCurrency(costBasisOriginalCurrency, costExchangeRate) {
    if (!costBasisOriginalCurrency) return null;
    if (!costExchangeRate || costExchangeRate === 0) return costBasisOriginalCurrency; // Fallback if no exchange rate

    // COST_EXCH_RATE represents units of original currency per 1 unit of portfolio currency
    // Formula: costBasisPortfolioCurrency = (COST_PRICE × QUANTITY) ÷ COST_EXCH_RATE
    return costBasisOriginalCurrency / costExchangeRate;
  },

  /**
   * Calculate unrealized P&L (absolute value)
   * Uses portfolio currency market value and cost basis
   */
  calculateUnrealizedPnL(marketValuePortfolioCurrency, costBasisPortfolioCurrency) {
    if (!marketValuePortfolioCurrency || !costBasisPortfolioCurrency) return null;

    return marketValuePortfolioCurrency - costBasisPortfolioCurrency;
  },

  /**
   * Calculate unrealized P&L percentage
   */
  calculateUnrealizedPnLPercent(marketValuePortfolioCurrency, costBasisPortfolioCurrency) {
    if (!marketValuePortfolioCurrency || !costBasisPortfolioCurrency) return null;

    if (costBasisPortfolioCurrency === 0) return null;

    const unrealizedPnL = marketValuePortfolioCurrency - costBasisPortfolioCurrency;
    return (unrealizedPnL / costBasisPortfolioCurrency) * 100;
  },

  /**
   * Normalize price value with smart format detection
   * Julius Baer CSV files are inconsistent:
   * - POS_PRICE: Often in percentage format (66.91 = 66.91%)
   * - COST_PRICE: Often already in decimal format (0.727 = 72.7%)
   *
   * @param {number|null} rawValue - The parsed numeric value from CSV
   * @param {string} posCalc - The POS_CALC field value ('% or other)
   * @param {string} fieldName - Field name for logging (e.g., 'POS_PRICE', 'COST_PRICE')
   * @param {string} isin - ISIN for logging
   * @returns {number|null} - Normalized value in decimal format (e.g., 0.6691 = 66.91%)
   */
  normalizePrice(rawValue, posCalc, fieldName, isin) {
    if (!rawValue && rawValue !== 0) return null;

    const isPercentageType = posCalc === '%';

    // If not a percentage type, return as-is (absolute price)
    if (!isPercentageType) {
      return rawValue;
    }

    // Smart detection for percentage-priced instruments
    // Heuristic: If value >= 10, it's in percentage format (needs ÷100)
    //            If value < 10, it's likely already in decimal format (use as-is)
    //
    // Examples:
    // - 66.91 >= 10 → divide by 100 → 0.6691 (66.91%)
    // - 100.0 >= 10 → divide by 100 → 1.0 (100%)
    // - 0.727 < 10 → use as-is → 0.727 (72.7%)
    // - 0.05 < 10 → use as-is → 0.05 (5%)
    // - 5.0 < 10 → use as-is → 5.0 (500%) - edge case but handled
    //
    // For very high values (> 10), we can be confident they're percentages
    const needsDivision = rawValue >= 10;
    const normalizedValue = needsDivision ? rawValue / 100 : rawValue;

    // Log for debugging percentage normalization
    if (isin) {
      console.log(`[JB_PRICE_NORM] ${fieldName} - ISIN: ${isin}`);
      console.log(`  Raw value: ${rawValue}`);
      console.log(`  POS_CALC: ${posCalc}`);
      console.log(`  Needs division: ${needsDivision} (threshold: value >= 10)`);
      console.log(`  Normalized: ${normalizedValue} (${(normalizedValue * 100).toFixed(2)}%)`);
    }

    return normalizedValue;
  },

  /**
   * Map Julius Baer CSV row to standardized schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    // Parse data date from CSV (FROM_DATE column in Julius Baer format: YYYYMMDD)
    const dataDate = row.FROM_DATE ? this.parseDate(row.FROM_DATE) : fileDate;

    // Parse raw numeric values
    const rawCostPrice = this.parseNumber(row.COST_PRICE);
    const rawMarketPrice = this.parseNumber(row.POS_PRICE);

    // Normalize prices using smart detection
    const normalizedCostPrice = this.normalizePrice(
      rawCostPrice,
      row.POS_CALC,
      'COST_PRICE',
      row.INSTR_ISIN_CODE
    );

    const normalizedMarketPrice = this.normalizePrice(
      rawMarketPrice,
      row.POS_CALC,
      'POS_PRICE',
      row.INSTR_ISIN_CODE
    );

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null, // Will be set by caller
      sourceFile,
      sourceFilePath: null, // Will be set by caller
      fileDate,
      dataDate, // Date from the CSV data itself (e.g., FROM_DATE column)
      processingDate: new Date(),

      // Account & Portfolio Information
      portfolioCode: row.THIRD_CODE || '', // Second column: THIRD_CODE (used as account identifier)
      accountNumber: row.THIRD_CODE || null, // Second column: THIRD_CODE
      thirdPartyCode: row.THIRD_CODE || null,
      originalPortfolioCode: row.PORTFOLIO_CODE || null, // First column: Original PORTFOLIO_CODE (preserved for reference)

      // Security Information
      isin: row.INSTR_ISIN_CODE || null,
      ticker: row.INSTR_SAT_CODE || null,
      securityName: row.INSTR_NAME || null,
      securityType: this.mapSecurityType(row.INST_NAT_E),

      // Position Data
      quantity: this.parseNumber(row.QUANTITY),
      marketValue: this.parseNumber(row.PTF_MKT_VAL), // Portfolio currency market value (Column AN)
      marketValueNoAccruedInterest: this.parseNumber(row.PTF_MKT_VAL_NOAI), // Portfolio currency market value without accrued interest
      marketValueOriginalCurrency: this.parseNumber(row.POS_MKT_VAL), // Market value in position's original currency (Column AM)
      bookValue: null, // Not directly available in JB file
      currency: row.POS_PRICE_CCY_ISO || row.POS_PRICE_CCY || row.INSTR_REF_CCY_ISO || row.INSTR_REF_CCY || row.POS_CCY_ISO || row.POS_CCY || null,
      portfolioCurrency: row.PTF_CCY_ISO || row.PORTFOLIO_CCY || null, // Account's base currency (EUR, USD, CHF, etc.)

      // Pricing Information
      // Prices are normalized using the normalizePrice function above
      // This ensures consistent decimal storage format across all price fields
      priceType: row.POS_CALC === '%' ? 'percentage' : 'absolute', // Extract from POS_CALC field
      marketPrice: normalizedMarketPrice,
      priceDate: this.parseDate(row.POS_PRICE_DATE),
      priceCurrency: row.POS_PRICE_CCY_ISO || null,

      // Additional Pricing
      // costPrice is pre-calculated above using normalizePrice function
      costPrice: normalizedCostPrice,
      lastPrice: this.parseNumber(row.LAST_PRICE_MKT_CODE),
      lastPriceCurrency: row.LAST_PRICE_CCY_ISO || null,

      // Cost Basis Calculations (in both currencies)
      // Uses normalized costPrice (already in decimal format)
      costBasisOriginalCurrency: this.calculateCostBasis(
        this.parseNumber(row.QUANTITY),
        normalizedCostPrice
      ),
      costBasisPortfolioCurrency: this.calculateCostBasisPortfolioCurrency(
        this.calculateCostBasis(
          this.parseNumber(row.QUANTITY),
          normalizedCostPrice
        ),
        this.parseNumber(row.COST_EXCH_RATE)
      ),

      // Performance Metrics (calculated using portfolio currency values)
      // Uses normalized costPrice (already in decimal format)
      unrealizedPnL: this.calculateUnrealizedPnL(
        this.parseNumber(row.PTF_MKT_VAL),
        this.calculateCostBasisPortfolioCurrency(
          this.calculateCostBasis(
            this.parseNumber(row.QUANTITY),
            normalizedCostPrice
          ),
          this.parseNumber(row.COST_EXCH_RATE)
        )
      ),
      unrealizedPnLPercent: this.calculateUnrealizedPnLPercent(
        this.parseNumber(row.PTF_MKT_VAL),
        this.calculateCostBasisPortfolioCurrency(
          this.calculateCostBasis(
            this.parseNumber(row.QUANTITY),
            normalizedCostPrice
          ),
          this.parseNumber(row.COST_EXCH_RATE)
        )
      ),

      // Bank-Specific Fields (store all additional data)
      bankSpecificData: {
        instrumentCode: row.INSTR_CODE,
        instrumentSubtype: row.INSTR_SUBTYPE_NAME,
        instrumentDenomination: row.INSTR_DENOM,
        instrumentMarketCode: row.INSTR_MARKET_CODE,
        instrumentRating: {
          moody: row.INSTR_RATING_MOODY,
          sp: row.INSTR_RATING_SP,
          investmentGrade: row.INSTR_INVEST_GRADE
        },
        instrumentIssuer: {
          name: row.INSTR_ISSUER_NAME,
          riskCountry: row.INSTR_ISS_RISK_CTRY,
          residentCountry: row.INSTR_ISS_RESID_CTRY
        },
        instrumentDates: {
          beginDate: this.parseDate(row.INSTR_BEGIN_DATE),
          endDate: this.parseDate(row.INSTR_END_DATE)
        },
        interestRate: this.parseNumber(row.INSTR_INTEREST_RATE),
        accruedInterest: this.parseNumber(row.PTF_ACCR_INT),
        exchangeRates: {
          positionExchangeRate: this.parseNumber(row.PTF_POS_CCY_EXCH),
          priceExchangeRate: this.parseNumber(row.PRICE_EXCH_RATE),
          costExchangeRate: this.parseNumber(row.COST_EXCH_RATE)
        },
        sector: {
          code: row.INSTR_SECTOR_CODE,
          name: row.INSTR_SECTOR_NAME
        },
        depositCode: row.DEPOSIT_CODE,
        accountingCode: row.ACCOUNTING_CODE
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
    console.log(`[JB_PARSER] Parsing Julius Baer file: ${sourceFile}`);

    // Parse CSV to array of objects
    const rows = this.parseCSV(csvContent);
    console.log(`[JB_PARSER] Found ${rows.length} rows`);

    // Map each row to standard schema
    // Include rows with ISIN OR cash positions (which may not have ISIN)
    const positions = rows
      .filter(row => row.INSTR_ISIN_CODE || row.INST_NAT_E === 'Cash' || row.PTF_MKT_VAL)
      .map(row => this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId));

    console.log(`[JB_PARSER] Mapped ${positions.length} positions (${rows.length - positions.length} skipped - no ISIN or cash)`);

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

    const headers = lines[0].split(';');
    const requiredHeaders = ['PORTFOLIO_CODE', 'INSTR_ISIN_CODE', 'QUANTITY'];

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
