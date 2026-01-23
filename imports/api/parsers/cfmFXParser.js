/**
 * CFM (Credit Foncier de Monaco / Indosuez) FX Movement Parser
 *
 * Parses CFM CSV FX movement files (MFRX - Mouvements Forex) and converts to standardized schema
 *
 * Filename format: YYYYMMDD-A#######-LU-W#-mfrx.csv
 * Example: 20260108-A0802232-LU-W5-mfrx.csv
 *
 * File format: Semicolon-delimited CSV with NO header row
 */

import { OPERATION_TYPES } from '../constants/operationTypes';

export const CFMFXParser = {
  /**
   * Bank identifier
   */
  bankName: 'CFM',

  /**
   * Filename pattern for CFM FX files (mfrx = Mouvements Forex)
   */
  filenamePattern: /^(\d{8})-[A-Z]\d+-[A-Z]{2}-W\d+-mfrx\.csv$/i,

  /**
   * Check if filename matches CFM FX file pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: 20260108-A0802232-LU-W5-mfrx.csv
   * Returns: Date object
   */
  extractFileDate(filename) {
    const match = filename.match(/^(\d{8})/);
    if (!match) {
      throw new Error(`Filename does not match CFM FX pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    return this.parseDate(dateStr, 'YYYYMMDD');
  },

  /**
   * Column indices for CFM MFRX files (no header row)
   * Based on analysis of mfrx file format
   */
  columns: {
    OPERATION_NUMBER: 0,      // A - FX operation number (FX0332645.001)
    CLIENT_NUMBER: 1,         // B - Client number (0640131)
    FOLDER_NUMBER: 2,         // C - Folder number (0000)
    CURRENCY: 3,              // D - Currency being bought/sold
    OPERATION_TYPE: 4,        // E - Operation type (CHANGE SPOT CLIENT)
    DIRECTION: 5,             // F - Direction (C=Credit, D=Debit)
    BASE_CURRENCY: 6,         // G - Base currency
    SETTLEMENT_CURRENCY: 7,   // H - Settlement currency
    OPERATION_DATE: 8,        // I - Operation date (DDMMYYYY)
    VALUE_DATE: 9,            // J - Value date (DDMMYYYY)
    AMOUNT: 10,               // K - Amount
    TEXT: 11,                 // L - Description text
    REFERENCE: 12,            // M - Reference number
    FIELD_13: 13,             // N - Empty/reserved
    FIELD_14: 14,             // O - Empty/reserved
    FX_RATE: 15,              // P - Exchange rate
    SECONDARY_RATE: 16,       // Q - Secondary rate (usually 0)
    TYPE_MARKER: 17,          // R - Type marker (T)
    CURRENCY_REPEAT: 18,      // S - Currency repeat
    FIELD_19: 19,             // T - Empty/reserved
    FIELD_20: 20,             // U - Empty/reserved
    FIELD_21: 21              // V - Empty/reserved
  },

  /**
   * Parse CSV content to array of arrays (no header row)
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 1) {
      return [];
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
   * Parse number from string
   */
  parseNumber(value) {
    if (!value || value === '') return null;

    const str = String(value).trim();
    if (str === '') return null;

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
    if (str === '') return null;

    // Handle 8-digit date strings
    if (str.length === 8 && /^\d{8}$/.test(str)) {
      const first4 = parseInt(str.substring(0, 4));

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
   * Map FX operation type from CFM description to standardized type
   */
  mapOperationType(operationType, direction) {
    const type = (operationType || '').toUpperCase();

    // All FX operations map to FX_TRADE
    if (type.includes('CHANGE SPOT') || type.includes('CHANGE A TERME') ||
        type.includes('FORWARD') || type.includes('CHANGE')) {
      return OPERATION_TYPES.FX_TRADE;
    }

    return OPERATION_TYPES.OTHER;
  },

  /**
   * Map CFM FX CSV row to standardized operation schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    const c = this.columns;

    // Parse dates
    const operationDate = this.parseDate(row[c.OPERATION_DATE], 'DDMMYYYY');
    const valueDate = this.parseDate(row[c.VALUE_DATE], 'DDMMYYYY');

    // Parse amounts
    const amount = this.parseNumber(row[c.AMOUNT]);
    const fxRate = this.parseNumber(row[c.FX_RATE]);

    // Determine operation type
    const operationType = this.mapOperationType(row[c.OPERATION_TYPE], row[c.DIRECTION]);

    // Build account number from client number
    // Strip leading zeros from account number (e.g., 0640130 -> 640130)
    const clientNumber = row[c.CLIENT_NUMBER] || '';
    const folderNumber = row[c.FOLDER_NUMBER] || '';
    const accountNumber = clientNumber.replace(/^0+/, '') || clientNumber;

    // Extract currencies
    const currency = row[c.CURRENCY] || '';
    const baseCurrency = row[c.BASE_CURRENCY] || '';
    const settlementCurrency = row[c.SETTLEMENT_CURRENCY] || '';

    return {
      // Bank and portfolio identifiers
      bankId,
      bankName,
      portfolioCode: accountNumber,
      accountNumber: accountNumber,
      folderNumber: folderNumber,
      portfolioCurrency: settlementCurrency || 'EUR',
      userId,

      // Dates
      operationDate,
      transactionDate: operationDate,
      valueDate,
      bookingDate: null,
      fileDate,

      // Instrument details (FX specific)
      isin: null,
      securityNumber: null,
      instrumentName: `FX ${currency}/${baseCurrency}`,
      securityCurrency: currency,
      securityType: 'FX',

      // Operation details
      operationType,
      operationCategory: 'FX',
      operationNumber: row[c.OPERATION_NUMBER] || null,
      operationTypeLabel: row[c.OPERATION_TYPE] || null,
      direction: row[c.DIRECTION] || null,
      operationCurrency: currency,
      settlementCurrency: settlementCurrency,
      baseCurrency: baseCurrency,
      text: row[c.TEXT] || null,

      // Financial details
      quantity: amount,
      amount: amount,
      price: fxRate,
      fxRate: fxRate,
      grossAmount: amount,
      netAmount: amount,

      // Fees (FX typically has no explicit fees in this format)
      fees: 0,
      commissions: 0,
      taxes: 0,
      totalFees: 0,

      // Reversal info
      isReversal: false,
      reversalNumber: null,

      // Reference
      reference: row[c.REFERENCE] || null,

      // Metadata
      sourceFile,
      importedAt: new Date(),
      isActive: true,

      // Store original bank-specific data
      bankSpecificData: {
        originalRow: row,
        typeMarker: row[c.TYPE_MARKER],
        currencyRepeat: row[c.CURRENCY_REPEAT]
      }
    };
  },

  /**
   * Parse entire file
   * Returns array of standardized operation objects
   */
  parse(csvContent, { bankId, bankName, sourceFile, fileDate, userId }) {
    console.log(`[CFM_FX] Parsing CFM FX file: ${sourceFile}`);

    // Parse CSV to array of arrays (no header row)
    const rows = this.parseCSV(csvContent);
    console.log(`[CFM_FX] Found ${rows.length} FX rows`);

    if (rows.length === 0) {
      console.log('[CFM_FX] No FX operations in file');
      return [];
    }

    // Map each row to standard schema
    // Include rows that have operation number or amount
    const operations = rows
      .filter(row => {
        const hasData = row[this.columns.OPERATION_NUMBER] || row[this.columns.AMOUNT];
        return hasData;
      })
      .map(row => this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId));

    console.log(`[CFM_FX] Mapped ${operations.length} FX operations (${rows.length - operations.length} skipped)`);

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

    // For files with at least one data row, check minimum columns
    const firstRow = lines[0].split(';');
    if (firstRow.length < 10) {
      return {
        valid: false,
        error: `Expected at least 10 columns, found ${firstRow.length}`
      };
    }

    return { valid: true };
  }
};
