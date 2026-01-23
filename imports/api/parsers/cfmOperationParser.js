/**
 * CFM (Credit Foncier de Monaco / Indosuez) Operation File Parser
 *
 * Parses CFM CSV operation files (MTIT - Mouvements Titres) and converts to standardized schema
 *
 * Filename format: YYYYMMDD-L#######-LU-W#-mtit.csv
 * Example: 20251203-L0302552-LU-W5-mtit.csv
 *
 * File format: Semicolon-delimited CSV with NO header row
 */

import { OPERATION_TYPES, mapCFMOperationType } from '../constants/operationTypes';

export const CFMOperationParser = {
  /**
   * Bank identifier
   */
  bankName: 'CFM',

  /**
   * Filename pattern for CFM operation files (mtit = Mouvements Titres)
   */
  filenamePattern: /^(\d{8})-[A-Z]\d+-[A-Z]{2}-W\d+-mtit\.csv$/i,

  /**
   * Check if filename matches CFM operation file pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: 20251203-L0302552-LU-W5-mtit.csv
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
   * Column indices for CFM MTIT files (no header row)
   * Based on MTI (520) format from CFM documentation
   */
  columns: {
    OPERATION_NUMBER: 0,      // A - Numéro opération
    CLIENT_NUMBER: 1,         // B - Numéro de client
    FOLDER_NUMBER: 2,         // C - Numéro de dossier
    SECURITY_NUMBER: 3,       // D - Numéro de valeur
    OPERATION_TYPE: 4,        // E - Libellé du type d'opération
    OPERATION_CURRENCY: 5,    // F - Monnaie opération
    SETTLEMENT_CURRENCY: 6,   // G - Monnaie de décompte
    OPERATION_DATE: 7,        // H - Date d'opération
    VALUE_DATE: 8,            // I - Date valeur
    BOOKING_DATE: 9,          // J - Date de comptabilisation
    QUANTITY: 10,             // K - Quantité
    SECURITY_CURRENCY: 11,    // L - Devise du titre
    UNIT_PRICE: 12,           // M - Prix unitaire
    GROSS_AMOUNT: 13,         // N - Montant brut
    ACCRUED_INTEREST: 14,     // O - Intérêts courus
    FEES: 15,                 // P - Frais
    COMMISSIONS: 16,          // Q - Commissions
    TAXES: 17,                // R - Taxes / impôt anticipé
    NET_AMOUNT: 18,           // S - Montant net
    PURCHASE_PRICE: 19,       // T - Cours d'achat
    TEXT: 20,                 // U - Texte
    REVERSALS: 21,            // V - Extournes
    REVERSAL_NUMBER: 22,      // W - Numéro d'extourne
    ISIN: 23,                 // X - Numéro d'ISIN réel
    SECURITY_TYPE: 24,        // Y - Genre de titre
    DIRECTION: 25,            // Z - Sens de l'opération
    TAX_FIN_TRANS: 26,        // AA - Taxes transactions financières
    EXTRA_FEES: 27,           // AB - FCMP - Frais Complémentaires
    LOCAL_FEES: 28,           // AC - FR - Frais Locaux
    WITHHOLDING: 29,          // AD - DDT - Retenues
    FOREIGN_TAX: 30,          // AE - ISE - Impôts source Etr
    OTHER_TAX: 31,            // AF - TAX - Taxes
    FOREIGN_FEES: 32,         // AG - CET - Frais Etr
    EU_WITHHOLDING: 33,       // AH - UE - Retenue UE
    VBRS_TAX: 34,             // AI - TAX-BRS - Taxe VBRS
    FISCAL_RETENTION: 35,     // AJ - Ret Fisc - Retenue Fiscale
    ORDER_NUMBER: 36,         // AK - Numéro d'ordre OB
    QUANTITY_TYPE: 37         // AL - Type de quantité
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
   * Map operation type from CFM description to standardized type
   * Uses centralized mapping from operationTypes.js constants
   */
  mapOperationType(operationType, direction) {
    return mapCFMOperationType(operationType, direction);
  },

  /**
   * Map security type to category
   */
  mapSecurityCategory(securityType) {
    const type = (securityType || '').toLowerCase();

    if (type.includes('action') || type.includes('equity') || type.includes('stock')) {
      return 'EQUITY';
    }
    if (type.includes('oblig') || type.includes('bond')) {
      return 'BOND';
    }
    if (type.includes('fond') || type.includes('fund') || type.includes('sicav') || type.includes('fcp')) {
      return 'FUND';
    }
    if (type.includes('structur') || type.includes('certif')) {
      return 'STRUCTURED_PRODUCT';
    }
    if (type.includes('option') || type.includes('future') || type.includes('deriv')) {
      return 'DERIVATIVE';
    }

    return 'OTHER';
  },

  /**
   * Map CFM CSV row to standardized operation schema
   */
  mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    const c = this.columns;

    // Parse dates
    const operationDate = this.parseDate(row[c.OPERATION_DATE], 'DDMMYYYY');
    const valueDate = this.parseDate(row[c.VALUE_DATE], 'DDMMYYYY');
    const bookingDate = this.parseDate(row[c.BOOKING_DATE], 'DDMMYYYY');

    // Parse amounts
    const quantity = this.parseNumber(row[c.QUANTITY]);
    const unitPrice = this.parseNumber(row[c.UNIT_PRICE]);
    const grossAmount = this.parseNumber(row[c.GROSS_AMOUNT]);
    const netAmount = this.parseNumber(row[c.NET_AMOUNT]);
    const accruedInterest = this.parseNumber(row[c.ACCRUED_INTEREST]);
    const fees = this.parseNumber(row[c.FEES]);
    const commissions = this.parseNumber(row[c.COMMISSIONS]);
    const taxes = this.parseNumber(row[c.TAXES]);
    const purchasePrice = this.parseNumber(row[c.PURCHASE_PRICE]);

    // Additional fees
    const taxFinTrans = this.parseNumber(row[c.TAX_FIN_TRANS]);
    const extraFees = this.parseNumber(row[c.EXTRA_FEES]);
    const localFees = this.parseNumber(row[c.LOCAL_FEES]);
    const withholding = this.parseNumber(row[c.WITHHOLDING]);
    const foreignTax = this.parseNumber(row[c.FOREIGN_TAX]);
    const otherTax = this.parseNumber(row[c.OTHER_TAX]);
    const foreignFees = this.parseNumber(row[c.FOREIGN_FEES]);
    const euWithholding = this.parseNumber(row[c.EU_WITHHOLDING]);
    const vbrsTax = this.parseNumber(row[c.VBRS_TAX]);
    const fiscalRetention = this.parseNumber(row[c.FISCAL_RETENTION]);

    // Calculate total fees
    const totalFees = (fees || 0) + (commissions || 0) + (taxes || 0) +
      (taxFinTrans || 0) + (extraFees || 0) + (localFees || 0) +
      (foreignFees || 0) + (foreignTax || 0) + (otherTax || 0);

    // Determine operation type and category
    const operationType = this.mapOperationType(row[c.OPERATION_TYPE], row[c.DIRECTION]);
    const operationCategory = this.mapSecurityCategory(row[c.SECURITY_TYPE]);

    // Build account number from client + folder
    // Strip leading zeros from account number (e.g., 0640130 -> 640130)
    const clientNumber = row[c.CLIENT_NUMBER] || '';
    const folderNumber = row[c.FOLDER_NUMBER] || '';
    const accountNumber = clientNumber.replace(/^0+/, '') || clientNumber;

    return {
      // Bank and portfolio identifiers
      bankId,
      bankName,
      portfolioCode: accountNumber, // Without leading zeros
      accountNumber: accountNumber, // Without leading zeros
      folderNumber: folderNumber,
      portfolioCurrency: row[c.SETTLEMENT_CURRENCY] || row[c.OPERATION_CURRENCY] || 'EUR',
      userId,

      // Dates
      operationDate,
      transactionDate: operationDate,
      valueDate,
      bookingDate,
      fileDate,

      // Instrument details
      isin: row[c.ISIN] || null,
      securityNumber: row[c.SECURITY_NUMBER] || null,
      instrumentName: null, // Not in MTIT file, would need to lookup from VALE
      securityCurrency: row[c.SECURITY_CURRENCY] || null,
      securityType: row[c.SECURITY_TYPE] || null,

      // Operation details
      operationType,
      operationCategory,
      operationNumber: row[c.OPERATION_NUMBER] || null,
      operationTypeLabel: row[c.OPERATION_TYPE] || null,
      direction: row[c.DIRECTION] || null,
      operationCurrency: row[c.OPERATION_CURRENCY] || null,
      settlementCurrency: row[c.SETTLEMENT_CURRENCY] || null,
      text: row[c.TEXT] || null,

      // Reversal info
      isReversal: row[c.REVERSALS] === 'O' || row[c.REVERSALS] === '1',
      reversalNumber: row[c.REVERSAL_NUMBER] || null,

      // Financial details
      quantity,
      price: unitPrice,
      purchasePrice,
      grossAmount,
      netAmount,
      accruedInterest,

      // Fees and charges
      fees,
      commissions,
      taxes,
      totalFees,

      // Additional fees breakdown
      additionalFees: {
        taxFinancialTransactions: taxFinTrans,
        extraFees: extraFees,
        localFees: localFees,
        withholding: withholding,
        foreignTax: foreignTax,
        otherTax: otherTax,
        foreignFees: foreignFees,
        euWithholding: euWithholding,
        vbrsTax: vbrsTax,
        fiscalRetention: fiscalRetention
      },

      // Order info
      orderNumber: row[c.ORDER_NUMBER] || null,
      quantityType: row[c.QUANTITY_TYPE] || null,

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
    console.log(`[CFM_MVT] Parsing CFM operations file: ${sourceFile}`);

    // Parse CSV to array of arrays (no header row)
    const rows = this.parseCSV(csvContent);
    console.log(`[CFM_MVT] Found ${rows.length} operation rows`);

    if (rows.length === 0) {
      console.log('[CFM_MVT] No operations in file');
      return [];
    }

    // Map each row to standard schema
    // Include rows that have operation number or ISIN
    const operations = rows
      .filter(row => {
        const hasData = row[this.columns.OPERATION_NUMBER] || row[this.columns.ISIN];
        return hasData;
      })
      .map(row => this.mapToStandardSchema(row, bankId, bankName, sourceFile, fileDate, userId));

    console.log(`[CFM_MVT] Mapped ${operations.length} operations (${rows.length - operations.length} skipped)`);

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
