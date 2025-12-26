/**
 * Andbank Operation File Parser
 *
 * Parses Andbank CSV operation/movement files
 *
 * Filename format: EX00YYYYMMDD_MVT_MNC.csv
 * Example: EX0020251128_MVT_MNC.csv
 *
 * CSV Format: Comma-delimited, WITH headers (as of Nov 2025)
 * First row contains column headers, data starts from row 2
 */

export const AndbankOperationParser = {
  /**
   * Bank identifier
   */
  bankName: 'Andbank',

  /**
   * Filename pattern for Andbank operation files
   */
  filenamePattern: /^EX00(\d{8})_MVT_MNC\.csv$/i,

  /**
   * Column mapping from header names to internal keys
   * Based on Nov 2025 file format
   */
  headerMapping: {
    'Portfolio number': 'PORTFOLIO_NUMBER',
    'Account number': 'ACCOUNT_NUMBER',
    'Transaction reference': 'TRANSACTION_REF',
    'Transaction label': 'TRANSACTION_LABEL',
    'Transaction type code': 'TRANSACTION_TYPE_CODE',
    'Transaction type label': 'TRANSACTION_TYPE_LABEL',
    'Movement type': 'MOVEMENT_TYPE',
    'Movement type label': 'MOVEMENT_TYPE_LABEL',
    'DebitCredit': 'DEBIT_CREDIT',
    'ISIN': 'ISIN',
    'Internal asset code': 'INTERNAL_ASSET_CODE',
    'Asset label': 'ASSET_LABEL',
    'Security currency': 'SECURITY_CCY',
    'Transaction Date': 'TRANSACTION_DATE',
    'Value Date': 'VALUE_DATE',
    'Reversal code': 'REVERSAL_CODE',
    'Quantity': 'QUANTITY',
    'Price': 'PRICE',
    'Transaction currency': 'TRANSACTION_CCY',
    'Amount in transaction currency': 'AMOUNT_TRANSACTION_CCY',
    'Portfolio Currency': 'PORTFOLIO_CCY',
    'Amount in portfolio currency': 'AMOUNT_PORTFOLIO_CCY',
    'Exchange rate': 'EXCHANGE_RATE',
    'Maturity Date': 'MATURITY_DATE',
    'Interest rate': 'INTEREST_RATE',
    'Contract number': 'CONTRACT_NUMBER',
    'Gross settlement amount': 'GROSS_SETTLEMENT',
    'Interests': 'INTERESTS',
    'Broker fees': 'BROKER_FEES',
    'Commission': 'COMMISSION',
    'Tax': 'TAX',
    'Fees': 'FEES',
    'VAT': 'VAT',
    'Net amount': 'NET_AMOUNT',
    'Security type': 'SECURITY_TYPE_CODE',
    'Security type description': 'SECURITY_TYPE_DESC',
    'Amount in security currency': 'AMOUNT_SECURITY_CCY'
  },

  /**
   * Check if filename matches Andbank MVT pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: EX00YYYYMMDD_MVT_MNC.csv
   * Returns: Date object
   */
  extractFileDate(filename) {
    const match = filename.match(this.filenamePattern);
    if (!match) {
      throw new Error(`Filename does not match Andbank MVT pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // Month is 0-indexed
    const day = parseInt(dateStr.substring(6, 8));

    return new Date(year, month, day);
  },

  /**
   * Parse CSV content using header row
   * Returns array of objects with standardized keys
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    const rows = [];

    if (lines.length < 1) {
      return rows;
    }

    // Parse header row
    const headers = lines[0].split(',').map(h => h.trim());
    console.log(`[ANDBANK_MVT] Found ${headers.length} headers`);

    // Map headers to internal keys
    const headerIndices = {};
    headers.forEach((header, index) => {
      const internalKey = this.headerMapping[header];
      if (internalKey) {
        headerIndices[internalKey] = index;
      }
    });

    // Parse data rows (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const values = line.split(',');
      const row = {};

      // Map values using header indices
      Object.entries(headerIndices).forEach(([key, index]) => {
        row[key] = values[index] !== undefined ? values[index].trim() : '';
      });

      rows.push(row);
    }

    return rows;
  },

  /**
   * Parse number from string
   */
  parseNumber(value) {
    if (!value || value === '') return null;
    const str = String(value).trim();
    if (str === '') return null;
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
   * Map transaction type to standardized operation type
   */
  mapOperationType(typeCode, typeLabel, movementType, movementLabel) {
    const label = (typeLabel || '').toLowerCase();
    const movLabel = (movementLabel || '').toLowerCase();

    // Buy/Sell
    if (label.includes('buy') || label.includes('purchase') || label.includes('achat')) {
      return 'BUY';
    }
    if (label.includes('sell') || label.includes('sale') || label.includes('vente')) {
      return 'SELL';
    }

    // Income
    if (label.includes('dividend')) {
      return 'DIVIDEND';
    }
    if (label.includes('coupon') || label.includes('interest')) {
      return 'COUPON';
    }

    // Fees
    if (label.includes('fee') || label.includes('commission') || label.includes('frais')) {
      return 'FEE';
    }

    // Transfers
    if (label.includes('transfer') || label.includes('virement') || label.includes('withdrawal') || label.includes('deposit')) {
      return 'TRANSFER';
    }

    // Redemption
    if (label.includes('redemption') || label.includes('maturity') || label.includes('remboursement')) {
      return 'REDEMPTION';
    }

    return 'OTHER';
  },

  /**
   * Map security type code to category
   */
  mapSecurityCategory(typeCode, typeDesc) {
    const code = parseInt(typeCode) || 0;
    const desc = (typeDesc || '').toLowerCase();

    // Bonds: 100-109
    if (code >= 100 && code < 110) return 'BOND';

    // Equities: 200-259
    if (code >= 200 && code < 260) return 'EQUITY';

    // Funds: 500-530
    if (code >= 500 && code < 531) return 'FUND';

    // Cash: 0
    if (code === 0 || desc.includes('cash')) return 'CASH';

    // Structured products: 600
    if (code === 600) return 'STRUCTURED_PRODUCT';

    return 'OTHER';
  },

  /**
   * Map row to standardized operation schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    // Parse dates
    const transactionDate = this.parseDate(row.TRANSACTION_DATE);
    const valueDate = this.parseDate(row.VALUE_DATE);
    const maturityDate = this.parseDate(row.MATURITY_DATE);

    // Parse amounts
    const quantity = this.parseNumber(row.QUANTITY);
    const price = this.parseNumber(row.PRICE);
    const amountTransactionCcy = this.parseNumber(row.AMOUNT_TRANSACTION_CCY);
    const amountPortfolioCcy = this.parseNumber(row.AMOUNT_PORTFOLIO_CCY);
    const grossSettlement = this.parseNumber(row.GROSS_SETTLEMENT);
    const interests = this.parseNumber(row.INTERESTS);
    const brokerFees = this.parseNumber(row.BROKER_FEES);
    const commission = this.parseNumber(row.COMMISSION);
    const tax = this.parseNumber(row.TAX);
    const fees = this.parseNumber(row.FEES);
    const vat = this.parseNumber(row.VAT);
    const netAmount = this.parseNumber(row.NET_AMOUNT);
    const exchangeRate = this.parseNumber(row.EXCHANGE_RATE);
    const interestRate = this.parseNumber(row.INTEREST_RATE);

    // Determine operation type and category
    const operationType = this.mapOperationType(
      row.TRANSACTION_TYPE_CODE,
      row.TRANSACTION_TYPE_LABEL,
      row.MOVEMENT_TYPE,
      row.MOVEMENT_TYPE_LABEL
    );
    const operationCategory = this.mapSecurityCategory(
      row.SECURITY_TYPE_CODE,
      row.SECURITY_TYPE_DESC
    );

    // Calculate total fees
    const totalFees = (brokerFees || 0) + (commission || 0) + (tax || 0) + (fees || 0) + (vat || 0);

    return {
      // Bank and portfolio identifiers
      bankId,
      bankName,
      portfolioCode: row.PORTFOLIO_NUMBER || '',
      accountNumber: row.ACCOUNT_NUMBER || null,
      portfolioCurrency: row.PORTFOLIO_CCY || 'EUR',
      userId, // Will be mapped from portfolioCode

      // Dates
      operationDate: transactionDate || valueDate || fileDate, // Required field for PMSOperations
      transactionDate,
      valueDate,
      maturityDate,
      fileDate,

      // Instrument details
      isin: row.ISIN || null,
      internalAssetCode: row.INTERNAL_ASSET_CODE || null,
      instrumentName: row.ASSET_LABEL || null,
      securityCurrency: row.SECURITY_CCY || null,
      securityTypeCode: row.SECURITY_TYPE_CODE || null,
      securityTypeDesc: row.SECURITY_TYPE_DESC || null,

      // Operation details
      operationType,
      operationCategory,
      operationCode: row.TRANSACTION_TYPE_CODE || row.MOVEMENT_TYPE || 'UNKNOWN', // For unique key generation
      instrumentCode: row.ISIN || row.INTERNAL_ASSET_CODE || null, // For unique key generation
      transactionRef: row.TRANSACTION_REF || null,
      transactionLabel: row.TRANSACTION_LABEL || null,
      transactionTypeCode: row.TRANSACTION_TYPE_CODE || null,
      transactionTypeLabel: row.TRANSACTION_TYPE_LABEL || null,
      movementType: row.MOVEMENT_TYPE || null,
      movementTypeLabel: row.MOVEMENT_TYPE_LABEL || null,
      debitCredit: row.DEBIT_CREDIT || null,
      reversalCode: row.REVERSAL_CODE || null,

      // Financial details
      quantity,
      price,
      grossAmount: grossSettlement,
      netAmount,
      amountTransactionCcy,
      amountPortfolioCcy,

      // Fees and charges
      interests,
      brokerFees,
      commission,
      tax,
      fees,
      vat,
      totalFees,

      // Additional info
      exchangeRate,
      interestRate,
      contractNumber: row.CONTRACT_NUMBER || null,

      // Metadata
      sourceFile,
      importedAt: new Date(),
      isActive: true,

      // Store original bank-specific data
      bankSpecificData: {
        amountSecurityCcy: this.parseNumber(row.AMOUNT_SECURITY_CCY),
        transactionCurrency: row.TRANSACTION_CCY || null
      }
    };
  },

  /**
   * Parse entire file
   * Returns array of standardized operation objects
   */
  parse(csvContent, { bankId, bankName, sourceFile, fileDate, userId }) {
    console.log(`[ANDBANK_MVT] Parsing Andbank operations file: ${sourceFile}`);

    // Parse CSV to array of objects
    const rows = this.parseCSV(csvContent);
    console.log(`[ANDBANK_MVT] Found ${rows.length} operation rows`);

    if (rows.length === 0) {
      console.log('[ANDBANK_MVT] No operations in file');
      return [];
    }

    // Map each row to standard schema
    const operations = rows
      .filter(row => {
        // Filter out empty rows
        const hasData = row.PORTFOLIO_NUMBER || row.ISIN || row.TRANSACTION_REF;
        return hasData;
      })
      .map(row => this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId));

    console.log(`[ANDBANK_MVT] Mapped ${operations.length} operations`);

    return operations;
  },

  /**
   * Validate file before parsing
   */
  validate(csvContent) {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 1) {
      return { valid: false, error: 'File is empty' };
    }

    // Check header row exists and has expected columns
    const headers = lines[0].split(',').map(h => h.trim());

    // Check for key columns
    const requiredHeaders = ['Portfolio number', 'Transaction Date', 'ISIN'];
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
