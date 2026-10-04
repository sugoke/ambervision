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

import { OPERATION_TYPES, directedType } from '../constants/operationTypes';
import { withStandard } from '../helpers/operationStandardizer';

// EDR securities movements carry a 3-letter codeope1; cash movements only a numeric
// codeope3 whose wording (libelle) tells several things apart under one code.
const EDR_SECURITY_CODES = {
  CPS: OPERATION_TYPES.COUPON,             // Coupons (EXT.CPS = reversal, signed debit)
  DIV: OPERATION_TYPES.DIVIDEND,
  ACT: OPERATION_TYPES.BUY,                // Achat
  VCT: OPERATION_TYPES.SELL,               // Vente
  VTE: OPERATION_TYPES.SELL,
  RBT: OPERATION_TYPES.REDEMPTION,         // Remboursement
  ECH: OPERATION_TYPES.REDEMPTION,         // Echéance
  SBS: OPERATION_TYPES.SUBSCRIPTION,
  INT: OPERATION_TYPES.INTEREST,
  TDE: OPERATION_TYPES.TRANSFER_IN,        // Transfert dépositaire (entrée) — securities
  TDS: OPERATION_TYPES.TRANSFER_OUT,       // Transfert dépositaire (sortie) — securities
  LIV: OPERATION_TYPES.TRANSFER_IN,
  CNE: OPERATION_TYPES.CORPORATE_ACTION,   // Conversion (entrée)
  CNS: OPERATION_TYPES.CORPORATE_ACTION,   // Conversion (sortie)
  CNA: OPERATION_TYPES.CORPORATE_ACTION,   // Cost adjustment linked to a conversion
  CNV: OPERATION_TYPES.CORPORATE_ACTION,
  MCA: OPERATION_TYPES.CORPORATE_ACTION    // Modification du prix d'achat
};

// Securities moved without cash (the amount is the value of the securities)
const EDR_NO_CASH_CODES = new Set(['TDE', 'TDS', 'LIV', 'CNE', 'CNS', 'CNA', 'CNV', 'MCA']);

// Cash wordings (lowercase, accents stripped), first match wins
const EDR_CASH_WORDING = [
  [/^(dim|rbt)\.c/, OPERATION_TYPES.DEPOSIT_MATURITY],  // deposit repaid
  [/^cat\.c/, OPERATION_TYPES.DEPOSIT_PLACEMENT],       // call deposit placed
  [/^int\.c|interets? debiteurs?|interets? crediteurs?/, OPERATION_TYPES.INTEREST],
  [/prelevement forfaitaire|impot|retenue a la source/, OPERATION_TYPES.TAX],
  [/solde mensuel cb/, OPERATION_TYPES.CARD_PAYMENT],    // card statement settlement
  [/cotisation carte|frais|droits de garde|commission/, OPERATION_TYPES.FEE],
  [/nivellement de compte/, 'TRANSFER'],
  [/^virt|virement/, 'PAYMENT']
];

// Card purchases / refunds and cash withdrawals (codeope3)
const EDR_CARD_CODES = new Set(['247', '293', '237']);

const stripAccents = (str) => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

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
  mapOperationType(row, signedAmount) {
    const code1 = (row.OPERATION_CODE_1 || '').toUpperCase().trim();
    const code3 = (row.OPERATION_CODE_3 || '').trim();
    if (code1 && EDR_SECURITY_CODES[code1]) return EDR_SECURITY_CODES[code1];
    if (EDR_CARD_CODES.has(code3)) return OPERATION_TYPES.CARD_PAYMENT;

    const wording = stripAccents(`${row.DESCRIPTION || ''} ${row.OPERATION_LABEL_3 || ''}`).toLowerCase().trim();
    for (const [pattern, type] of EDR_CASH_WORDING) {
      if (pattern.test(wording)) return directedType(type, signedAmount);
    }
    // Unlabelled cash movement: a payment in or out
    if (row.GENRE_CODE === '001' || !row.ISIN || row.ISIN === 'N/A') return directedType('PAYMENT', signedAmount);
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
    const operationType = this.mapOperationType(row, signedAmount);
    const isin = row.ISIN && row.ISIN !== 'N/A' ? row.ISIN : null;
    const operationCategory = this.mapOperationCategory(row.GENRE_CODE, isin);

    // Build description from available fields
    const description = row.DESCRIPTION ||
                       `${row.OPERATION_LABEL_1 || ''} ${row.OPERATION_LABEL_3 || ''}`.trim() ||
                       'Unknown Operation';

    const code1 = (row.OPERATION_CODE_1 || '').toUpperCase().trim();
    // Securities descriptions read "CPS/ISSUER NAME" (or "EXT.CPS/..." for a reversal)
    const securityName = isin ? description.replace(/^[A-Z.]+\//, '') : null;

    const operation = {
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
      // One movement can have several lines (capital + interest of a deposit, both legs
      // of a card settlement); movement + entry number identifies one line. Securities
      // events carry movement 0 and fall back to the content-based key.
      operationId: row.MOVEMENT_ID && String(row.MOVEMENT_ID) !== '0'
        ? `${row.MOVEMENT_ID}|${row.ENTRY_NUMBER || ''}`
        : null,
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

    return withStandard(operation, {
      type: operationType,
      description,
      instrumentName: securityName,
      isin,
      quantity: isin ? quantity : null,
      price: isin ? price : null,
      amount: signedAmount,
      currency: row.CURRENCY,
      cashImpact: !EDR_NO_CASH_CODES.has(code1),
      fees: (fee1 || 0) + (fee2 || 0) + (fee3 || 0) + (fee4 || 0) + (fee5 || 0) + (fee6 || 0),
      taxes: (tax || 0) + (euTax || 0),
      accruedInterest: accruedCoupon,
      bankTypeCode: [row.OPERATION_CODE_1, row.OPERATION_CODE_3].filter(Boolean).join('/') || row.GENRE_CODE,
      bankTypeLabel: (row.OPERATION_LABEL_1 || row.OPERATION_LABEL_3 || '').trim() || null,
      reference: row.REFERENCE || row.MOVEMENT_ID
    });
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
