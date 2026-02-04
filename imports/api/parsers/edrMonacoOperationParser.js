/**
 * Edmond de Rothschild Monaco Operation File Parser
 *
 * Parses EDR Monaco CSV operation/movement files
 *
 * Filename format: mvt_F14B2A5A_YYYYMMDD.csv
 * Example: mvt_F14B2A5A_20260122.csv
 *
 * CSV Format: Comma-delimited with headers
 * First row contains column headers, data starts from row 2
 */

import { OPERATION_TYPES } from '../constants/operationTypes';

export const EDRMonacoOperationParser = {
  /**
   * Bank identifier
   */
  bankName: 'Edmond de Rothschild',

  /**
   * Filename pattern for EDR Monaco operation files
   * Format: mvt_XXXXXXXX_YYYYMMDD.csv
   */
  filenamePattern: /^mvt_[A-Z0-9]+_(\d{8})\.csv$/i,

  /**
   * Column mapping from header names to internal keys
   */
  headerMapping: {
    'racine': 'PORTFOLIO_CODE',
    'genre': 'GENRE_CODE',
    'mouvement': 'MOVEMENT_ID',
    'ecriture': 'ENTRY_NUMBER',
    'reference': 'REFERENCE',
    'libelle': 'DESCRIPTION',
    'codeope1': 'OPERATION_CODE_1',
    'libope1': 'OPERATION_LABEL_1',
    'codeope2': 'OPERATION_CODE_2',
    'libope2': 'OPERATION_LABEL_2',
    'codeope3': 'OPERATION_CODE_3',
    'libope3': 'OPERATION_LABEL_3',
    'codeisin': 'ISIN',
    'devmvt': 'CURRENCY',
    'montant': 'AMOUNT',
    'sens': 'DIRECTION',
    'cours': 'PRICE',
    'coursbrk': 'BROKER_PRICE',
    'datesys': 'SYSTEM_DATE',
    'dateope': 'OPERATION_DATE',
    'dateval': 'VALUE_DATE',
    'extourne': 'REVERSAL_FLAG',
    'quantite': 'QUANTITY',
    'taux': 'RATE',
    'datecoup': 'COUPON_DATE',
    'dateech': 'MATURITY_DATE',
    'taxeeu': 'EU_TAX',
    'impots': 'TAX',
    'titfrs1': 'FEE_1',
    'titfrs2': 'FEE_2',
    'titfrs3': 'FEE_3',
    'titfrs4': 'FEE_4',
    'titfrs5': 'FEE_5',
    'titfrs6': 'FEE_6',
    'coupcouru': 'ACCRUED_COUPON',
    'code_val': 'SECURITY_CODE',
    'rub': 'CATEGORY',
    'id_cat': 'CATEGORY_ID'
  },

  /**
   * Operation code mappings for EDR
   * Based on codeope1, codeope3, and genre
   */
  operationCodeMap: {
    // codeope1 mappings
    'CPS': OPERATION_TYPES.COUPON,           // Coupons
    'ACT': OPERATION_TYPES.BUY,              // Achat (Buy)
    'VTE': OPERATION_TYPES.SELL,             // Vente (Sell)
    'DIV': OPERATION_TYPES.DIVIDEND,         // Dividende
    'INT': OPERATION_TYPES.INTEREST,         // Intérêts
    'RBT': OPERATION_TYPES.REDEMPTION,       // Remboursement
    'ECH': OPERATION_TYPES.REDEMPTION,       // Echéance (Maturity)
    'SBS': OPERATION_TYPES.SUBSCRIPTION,     // Souscription
    'LIV': OPERATION_TYPES.TRANSFER_IN,      // Livraison
    'VIR': OPERATION_TYPES.TRANSFER_OUT,     // Virement

    // codeope3 mappings (more specific)
    '247': OPERATION_TYPES.CARD_PAYMENT,     // ACHAT CB (Card Payment)
    '408': OPERATION_TYPES.TRANSFER_IN,      // DEPOT A PREAVIS (Deposit)
    '120': OPERATION_TYPES.TRANSFER_IN,      // ENTREE DE FONDS (Funds In)
    '121': OPERATION_TYPES.TRANSFER_OUT,     // SORTIE DE FONDS (Funds Out)
  },

  /**
   * Genre code to category mapping
   */
  genreCodeMap: {
    '001': 'CASH',                 // Cash operations
    '002': 'CARD',                 // Card payments
    '123': 'STRUCTURED_PRODUCT',   // Produits structurés
    '100': 'BOND',                 // Bonds
    '200': 'EQUITY',               // Equities
    '500': 'FUND',                 // Funds
  },

  /**
   * Check if filename matches EDR Monaco MVT pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: mvt_XXXXXXXX_YYYYMMDD.csv
   * Returns: Date object
   */
  extractFileDate(filename) {
    const match = filename.match(this.filenamePattern);
    if (!match) {
      throw new Error(`Filename does not match EDR Monaco MVT pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1; // Month is 0-indexed
    const day = parseInt(dateStr.substring(6, 8));

    return new Date(year, month, day);
  },

  /**
   * Parse CSV content with proper handling of quoted fields
   * Returns array of objects with standardized keys
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    const rows = [];

    if (lines.length < 1) {
      return rows;
    }

    // Parse header row
    const headers = this.parseCSVLine(lines[0]);
    console.log(`[EDR_MVT] Found ${headers.length} headers`);

    // Map headers to internal keys
    const headerIndices = {};
    headers.forEach((header, index) => {
      const cleanHeader = header.replace(/^"|"$/g, '').trim();
      const internalKey = this.headerMapping[cleanHeader];
      if (internalKey) {
        headerIndices[internalKey] = index;
      }
    });

    // Parse data rows (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const values = this.parseCSVLine(line);
      const row = {};

      // Map values using header indices
      Object.entries(headerIndices).forEach(([key, index]) => {
        let value = values[index] !== undefined ? values[index] : '';
        // Remove surrounding quotes if present
        value = value.replace(/^"|"$/g, '').trim();
        row[key] = value;
      });

      rows.push(row);
    }

    return rows;
  },

  /**
   * Parse a single CSV line handling quoted fields
   */
  parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
        current += char;
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
   * Parse number from string
   */
  parseNumber(value) {
    if (!value || value === '') return null;
    const str = String(value).trim();
    if (str === '' || str === 'N/A') return null;
    // Handle European number format (comma as decimal separator)
    const normalized = str.replace(/\s/g, '').replace(',', '.');
    const num = parseFloat(normalized);
    return isNaN(num) ? null : num;
  },

  /**
   * Parse date from YYYYMMDD format
   */
  parseDate(value) {
    if (!value || value === '' || value === ' ') return null;

    const str = String(value).trim();
    if (str === '' || str.length !== 8) return null;

    const year = parseInt(str.substring(0, 4));
    const month = parseInt(str.substring(4, 6)) - 1; // Month is 0-indexed
    const day = parseInt(str.substring(6, 8));

    if (isNaN(year) || isNaN(month) || isNaN(day)) return null;

    return new Date(year, month, day);
  },

  /**
   * Map operation codes to standardized operation type
   */
  mapOperationType(row) {
    const code1 = (row.OPERATION_CODE_1 || '').toUpperCase();
    const code3 = row.OPERATION_CODE_3 || '';
    const label1 = (row.OPERATION_LABEL_1 || '').toLowerCase();
    const label3 = (row.OPERATION_LABEL_3 || '').toLowerCase();
    const description = (row.DESCRIPTION || '').toLowerCase();
    const direction = row.DIRECTION;

    // Check codeope3 first (most specific)
    if (code3 && this.operationCodeMap[code3]) {
      return this.operationCodeMap[code3];
    }

    // Check codeope1
    if (code1 && this.operationCodeMap[code1]) {
      return this.operationCodeMap[code1];
    }

    // Check labels for keywords
    const allLabels = `${label1} ${label3} ${description}`;

    if (allLabels.includes('coupon') || allLabels.includes('cps')) {
      return OPERATION_TYPES.COUPON;
    }
    if (allLabels.includes('achat') || allLabels.includes('buy') || allLabels.includes('purchase')) {
      return OPERATION_TYPES.BUY;
    }
    if (allLabels.includes('vente') || allLabels.includes('sell') || allLabels.includes('sale')) {
      return OPERATION_TYPES.SELL;
    }
    if (allLabels.includes('dividende') || allLabels.includes('dividend')) {
      return OPERATION_TYPES.DIVIDEND;
    }
    if (allLabels.includes('interet') || allLabels.includes('interest') || allLabels.includes('int.')) {
      return OPERATION_TYPES.INTEREST;
    }
    if (allLabels.includes('remboursement') || allLabels.includes('redemption') || allLabels.includes('rbt')) {
      return OPERATION_TYPES.REDEMPTION;
    }
    if (allLabels.includes('echeance') || allLabels.includes('maturity')) {
      return OPERATION_TYPES.REDEMPTION;
    }
    if (allLabels.includes('depot') || allLabels.includes('deposit') || allLabels.includes('entree')) {
      return OPERATION_TYPES.TRANSFER_IN;
    }
    if (allLabels.includes('virement') || allLabels.includes('transfer') || allLabels.includes('sortie')) {
      return OPERATION_TYPES.TRANSFER_OUT;
    }
    if (allLabels.includes('cb') || allLabels.includes('carte') || allLabels.includes('card')) {
      return OPERATION_TYPES.CARD_PAYMENT;
    }
    if (allLabels.includes('frais') || allLabels.includes('commission') || allLabels.includes('fee')) {
      return OPERATION_TYPES.FEE;
    }
    if (allLabels.includes('impot') || allLabels.includes('tax') || allLabels.includes('prelevement')) {
      return OPERATION_TYPES.TAX;
    }

    // Default based on direction
    if (direction === 'C') {
      return OPERATION_TYPES.PAYMENT_IN;
    } else if (direction === 'D') {
      return OPERATION_TYPES.PAYMENT_OUT;
    }

    return OPERATION_TYPES.OTHER;
  },

  /**
   * Map genre code to operation category
   */
  mapOperationCategory(genreCode, isin) {
    if (this.genreCodeMap[genreCode]) {
      return this.genreCodeMap[genreCode];
    }

    // If has ISIN, it's a security operation
    if (isin && isin !== 'N/A' && isin.length > 0) {
      return 'SECURITY';
    }

    return 'OTHER';
  },

  /**
   * Map row to standardized operation schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    // Parse dates
    const operationDate = this.parseDate(row.OPERATION_DATE);
    const valueDate = this.parseDate(row.VALUE_DATE);
    const systemDate = this.parseDate(row.SYSTEM_DATE);
    const maturityDate = this.parseDate(row.MATURITY_DATE);
    const couponDate = this.parseDate(row.COUPON_DATE);

    // Parse amounts
    const amount = this.parseNumber(row.AMOUNT);
    const quantity = this.parseNumber(row.QUANTITY);
    const price = this.parseNumber(row.PRICE);
    const brokerPrice = this.parseNumber(row.BROKER_PRICE);
    const accruedCoupon = this.parseNumber(row.ACCRUED_COUPON);
    const tax = this.parseNumber(row.TAX);
    const euTax = this.parseNumber(row.EU_TAX);
    const fee1 = this.parseNumber(row.FEE_1);
    const fee2 = this.parseNumber(row.FEE_2);
    const fee3 = this.parseNumber(row.FEE_3);
    const fee4 = this.parseNumber(row.FEE_4);
    const fee5 = this.parseNumber(row.FEE_5);
    const fee6 = this.parseNumber(row.FEE_6);

    // Calculate total fees
    const totalFees = (fee1 || 0) + (fee2 || 0) + (fee3 || 0) +
                      (fee4 || 0) + (fee5 || 0) + (fee6 || 0) +
                      (tax || 0) + (euTax || 0);

    // Determine signed amount based on direction
    const direction = row.DIRECTION;
    const signedAmount = direction === 'D' ? -(amount || 0) : (amount || 0);

    // Determine operation type and category
    const operationType = this.mapOperationType(row);
    const isin = row.ISIN && row.ISIN !== 'N/A' ? row.ISIN : null;
    const operationCategory = this.mapOperationCategory(row.GENRE_CODE, isin);

    // Build description from available fields
    const description = row.DESCRIPTION ||
                       `${row.OPERATION_LABEL_1 || ''} ${row.OPERATION_LABEL_3 || ''}`.trim() ||
                       'Unknown Operation';

    return {
      // Bank and portfolio identifiers
      bankId,
      bankName,
      portfolioCode: row.PORTFOLIO_CODE || '',
      portfolioCurrency: row.CURRENCY || 'EUR',
      userId, // Will be mapped from portfolioCode

      // Dates
      operationDate: operationDate || valueDate || systemDate || fileDate,
      transactionDate: operationDate,
      valueDate,
      systemDate,
      maturityDate,
      couponDate,
      fileDate,

      // Instrument details
      isin,
      securityCode: row.SECURITY_CODE || null,
      instrumentName: description,

      // Operation details
      operationType,
      operationCategory,
      operationCode: row.OPERATION_CODE_1 || row.OPERATION_CODE_3 || row.GENRE_CODE || 'UNKNOWN',
      instrumentCode: isin || row.SECURITY_CODE || null,
      transactionRef: row.REFERENCE || null,
      movementId: row.MOVEMENT_ID || null,
      entryNumber: row.ENTRY_NUMBER || null,
      transactionLabel: description,
      operationCode1: row.OPERATION_CODE_1 || null,
      operationLabel1: row.OPERATION_LABEL_1 || null,
      operationCode2: row.OPERATION_CODE_2 || null,
      operationLabel2: row.OPERATION_LABEL_2 || null,
      operationCode3: row.OPERATION_CODE_3 || null,
      operationLabel3: row.OPERATION_LABEL_3 || null,
      genreCode: row.GENRE_CODE || null,
      direction,
      reversalFlag: row.REVERSAL_FLAG || '0',

      // Financial details
      quantity,
      price,
      brokerPrice,
      grossAmount: amount,
      netAmount: signedAmount,
      amount: signedAmount,
      currency: row.CURRENCY || 'EUR',

      // Fees and charges
      tax,
      euTax,
      fees: totalFees,
      totalFees,
      accruedCoupon,

      // Rate info
      rate: row.RATE || null,

      // Metadata
      sourceFile,
      importedAt: new Date(),
      isActive: true,

      // Store original bank-specific data
      bankSpecificData: {
        genreCode: row.GENRE_CODE,
        categoryCode: row.CATEGORY,
        categoryId: row.CATEGORY_ID,
        fee1, fee2, fee3, fee4, fee5, fee6
      }
    };
  },

  /**
   * Parse entire file
   * Returns array of standardized operation objects
   */
  parse(csvContent, { bankId, bankName, sourceFile, fileDate, userId }) {
    console.log(`[EDR_MVT] Parsing EDR Monaco operations file: ${sourceFile}`);

    // Parse CSV to array of objects
    const rows = this.parseCSV(csvContent);
    console.log(`[EDR_MVT] Found ${rows.length} operation rows`);

    if (rows.length === 0) {
      console.log('[EDR_MVT] No operations in file');
      return [];
    }

    // Map each row to standard schema
    const operations = rows
      .filter(row => {
        // Filter out empty rows
        const hasData = row.PORTFOLIO_CODE || row.MOVEMENT_ID || row.REFERENCE;
        return hasData;
      })
      .map(row => this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId));

    console.log(`[EDR_MVT] Mapped ${operations.length} operations`);

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
    const headers = this.parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());

    // Check for key columns
    const requiredHeaders = ['racine', 'dateope', 'montant'];
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
