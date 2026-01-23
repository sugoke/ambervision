/**
 * CFM (Credit Foncier de Monaco / Indosuez) Cash Operation Parser
 *
 * Parses CFM CSV cash movement files (MESP - Mouvements Espèces) and converts to standardized schema
 *
 * Filename format: YYYYMMDD-X#######-LU-W#-mesp.csv
 * Example: 20260108-A0802301-LU-W5-mesp.csv
 *
 * File format: Semicolon-delimited CSV with NO header row
 */

import { OPERATION_TYPES } from '../constants/operationTypes';

export const CFMCashOperationParser = {
  /**
   * Bank identifier
   */
  bankName: 'CFM',

  /**
   * Filename pattern for CFM cash movement files (mesp = Mouvements Espèces)
   */
  filenamePattern: /^(\d{8})-[A-Z]\d+-[A-Z]{2}-W\d+-mesp\.csv$/i,

  /**
   * Check if filename matches CFM cash movement file pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: 20260108-A0802301-LU-W5-mesp.csv
   * Returns: Date object
   */
  extractFileDate(filename) {
    const match = filename.match(/^(\d{8})/);
    if (!match) {
      throw new Error(`Filename does not match CFM MESP pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    return this.parseDate(dateStr, 'YYYYMMDD');
  },

  /**
   * Column indices for CFM MESP files (no header row)
   * Based on analysis of mesp file format
   */
  columns: {
    OPERATION_NUMBER: 0,      // A - Operation number (NB0634176.000)
    CLIENT_NUMBER: 1,         // B - Client number (0640130)
    FOLDER_NUMBER: 2,         // C - Folder number (0000)
    CURRENCY: 3,              // D - Currency (EUR)
    REFERENCE: 4,             // E - Reference/IBAN
    OPERATION_TYPE: 5,        // F - Operation type description
    DIRECTION: 6,             // G - Direction (C=Credit, D=Debit)
    DESCRIPTION: 7,           // H - Description (VIREMENT BJB SAS)
    OPERATION_CURRENCY: 8,    // I - Operation currency
    SETTLEMENT_CURRENCY: 9,   // J - Settlement currency
    OPERATION_DATE: 10,       // K - Operation date (DDMMYYYY)
    VALUE_DATE: 11,           // L - Value date
    BOOKING_DATE: 12,         // M - Booking date
    GROSS_AMOUNT: 13,         // N - Gross amount
    FEES: 14,                 // O - Fees
    NET_AMOUNT: 15,           // P - Net amount
    COUNTERPARTY: 16,         // Q - Counterparty name
    FIELD_17: 17,             // R - Reserved
    FIELD_18: 18,             // S - Reserved
    FIELD_19: 19,             // T - Reserved
    FIELD_20: 20,             // U - Reserved
    FIELD_21: 21,             // V - Reserved
    EXCHANGE_RATE: 22         // W - Exchange rate
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
   * Map cash operation type from CFM description to standardized type
   */
  mapOperationType(operationType, direction) {
    const type = (operationType || '').toUpperCase();
    const dir = (direction || '').toUpperCase();

    // Transfer operations
    if (type.includes('VIREMENT') || type.includes('TFT') || type.includes('CPTE A CPTE')) {
      if (dir === 'C') return OPERATION_TYPES.TRANSFER_IN;
      if (dir === 'D') return OPERATION_TYPES.TRANSFER_OUT;
      return OPERATION_TYPES.TRANSFER_OUT;
    }

    // Payment operations
    if (type.includes('PAIEMENT') || type.includes('PAYMENT')) {
      if (dir === 'C') return OPERATION_TYPES.PAYMENT_IN;
      if (dir === 'D') return OPERATION_TYPES.PAYMENT_OUT;
      return OPERATION_TYPES.PAYMENT_OUT;
    }

    // Fee operations
    if (type.includes('FRAIS') || type.includes('COMMISSION') || type.includes('FEE')) {
      return OPERATION_TYPES.FEE;
    }

    // Interest operations
    if (type.includes('INTERET') || type.includes('INTEREST')) {
      return OPERATION_TYPES.INTEREST;
    }

    // Default based on direction
    if (dir === 'C') return OPERATION_TYPES.PAYMENT_IN;
    if (dir === 'D') return OPERATION_TYPES.PAYMENT_OUT;

    return OPERATION_TYPES.OTHER;
  },

  /**
   * Map CFM MESP row to standardized operation schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    const c = this.columns;

    // Parse dates
    const operationDate = this.parseDate(row[c.OPERATION_DATE], 'DDMMYYYY');
    const valueDate = this.parseDate(row[c.VALUE_DATE], 'DDMMYYYY');
    const bookingDate = this.parseDate(row[c.BOOKING_DATE], 'DDMMYYYY');

    // Parse amounts
    const grossAmount = this.parseNumber(row[c.GROSS_AMOUNT]);
    const fees = this.parseNumber(row[c.FEES]);
    const netAmount = this.parseNumber(row[c.NET_AMOUNT]);
    const exchangeRate = this.parseNumber(row[c.EXCHANGE_RATE]);

    // Determine operation type
    const operationType = this.mapOperationType(row[c.OPERATION_TYPE], row[c.DIRECTION]);

    // Build account number from client number
    const clientNumber = row[c.CLIENT_NUMBER] || '';
    const folderNumber = row[c.FOLDER_NUMBER] || '';
    const accountNumber = clientNumber.replace(/^0+/, '') || clientNumber;

    const currency = row[c.CURRENCY] || 'EUR';
    const direction = row[c.DIRECTION] || '';

    // Determine sign based on direction
    const signedAmount = direction === 'D' ? -Math.abs(netAmount || grossAmount || 0) : Math.abs(netAmount || grossAmount || 0);

    return {
      // Bank and portfolio identifiers
      bankId,
      bankName,
      portfolioCode: accountNumber,
      accountNumber: accountNumber,
      folderNumber: folderNumber,
      portfolioCurrency: row[c.SETTLEMENT_CURRENCY] || 'EUR',
      userId,

      // Dates
      operationDate,
      transactionDate: operationDate,
      valueDate,
      bookingDate,
      fileDate,

      // Instrument details (Cash operations don't have securities)
      isin: null,
      securityNumber: null,
      instrumentName: `Cash ${currency}`,
      securityCurrency: currency,
      securityType: 'CASH',

      // Operation details
      operationType,
      operationCategory: 'CASH',
      operationNumber: row[c.OPERATION_NUMBER] || null,
      operationTypeLabel: row[c.OPERATION_TYPE] || null,
      direction: direction,
      operationCurrency: row[c.OPERATION_CURRENCY] || currency,
      settlementCurrency: row[c.SETTLEMENT_CURRENCY] || 'EUR',
      text: row[c.DESCRIPTION] || null,

      // Counterparty
      counterparty: row[c.COUNTERPARTY] || null,

      // Financial details
      quantity: signedAmount,
      amount: signedAmount,
      grossAmount: grossAmount,
      netAmount: netAmount || grossAmount,
      exchangeRate: exchangeRate,

      // Fees
      fees: fees || 0,
      commissions: 0,
      taxes: 0,
      totalFees: fees || 0,

      // Reference
      reference: row[c.REFERENCE] || null,

      // Metadata
      sourceFile,
      importedAt: new Date(),
      isActive: true,

      // Store original bank-specific data
      bankSpecificData: {
        originalRow: row
      }
    };
  },

  /**
   * Parse entire file
   * Returns array of standardized operation objects
   */
  parse(csvContent, { bankId, bankName, sourceFile, fileDate, userId }) {
    console.log(`[CFM_MESP] Parsing CFM cash operations file: ${sourceFile}`);

    // Parse CSV to array of arrays (no header row)
    const rows = this.parseCSV(csvContent);
    console.log(`[CFM_MESP] Found ${rows.length} cash operation rows`);

    if (rows.length === 0) {
      console.log('[CFM_MESP] No cash operations in file');
      return [];
    }

    // Map each row to standard schema
    const operations = rows
      .filter(row => {
        const hasData = row[this.columns.OPERATION_NUMBER] || row[this.columns.GROSS_AMOUNT];
        return hasData;
      })
      .map(row => this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId));

    console.log(`[CFM_MESP] Mapped ${operations.length} cash operations (${rows.length - operations.length} skipped)`);

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
