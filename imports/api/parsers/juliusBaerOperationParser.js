/**
 * Julius Baer Operation File Parser
 *
 * Parses Julius Baer CSV operation files (OPE) and converts to standardized schema
 *
 * Filename format: DDS########_DAILY_OPE_JB.YYYYMMDD.HHMMSS.EAM#######.CSV
 * Example: DDS03632510_DAILY_OPE_JB.20251117.031754.EAM3632510.CSV
 *
 * File format: Semicolon-delimited CSV with header row
 */

import { mapJuliusBaerOperationType, OPERATION_TYPES } from '../constants/operationTypes';

export const JuliusBaerOperationParser = {
  /**
   * Bank identifier
   */
  bankName: 'Julius Baer',

  /**
   * Filename pattern for Julius Baer operation files (OPE = Operations)
   */
  filenamePattern: /^DDS\d+_DAILY_OPE_JB\.(\d{8})\.\d+\.EAM\d+\.CSV$/i,

  /**
   * Check if filename matches Julius Baer operation file pattern
   */
  matchesPattern(filename) {
    return this.filenamePattern.test(filename);
  },

  /**
   * Extract date from filename
   * Format: DDS03632510_DAILY_OPE_JB.20251117.031754.EAM3632510.CSV
   * Returns: Date object
   */
  extractFileDate(filename) {
    const match = filename.match(this.filenamePattern);
    if (!match) {
      throw new Error(`Filename does not match Julius Baer OPE pattern: ${filename}`);
    }

    const dateStr = match[1]; // YYYYMMDD
    const year = parseInt(dateStr.substring(0, 4));
    const month = parseInt(dateStr.substring(4, 6)) - 1;
    const day = parseInt(dateStr.substring(6, 8));

    return new Date(year, month, day);
  },

  /**
   * Parse CSV content to array of objects (with header row)
   */
  parseCSV(csvContent) {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      return [];
    }

    // First line is headers
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
   * Parse number from string
   */
  parseNumber(value) {
    if (!value || value === '') return null;

    const str = String(value).trim();
    if (str === '') return null;

    // Handle percentage symbol if present
    const cleanedStr = str.replace(/%/g, '').replace(/,/g, '');
    const num = parseFloat(cleanedStr);

    return isNaN(num) ? null : num;
  },

  /**
   * Parse date from string (YYYYMMDD format)
   */
  parseDate(value) {
    if (!value || value === '') return null;

    const str = String(value).trim();
    if (str === '' || str.length !== 8 || !/^\d{8}$/.test(str)) return null;

    const year = parseInt(str.substring(0, 4));
    const month = parseInt(str.substring(4, 6)) - 1;
    const day = parseInt(str.substring(6, 8));

    const date = new Date(year, month, day);
    return isNaN(date.getTime()) ? null : date;
  },

  /**
   * Strip leading zeros from portfolio/account numbers
   */
  stripLeadingZeros(value) {
    if (!value) return '';
    return String(value).replace(/^0+/, '') || '0';
  },

  /**
   * Parse operations file
   * Returns array of operation objects in standardized schema
   */
  parseOperations(csvContent, { bankId, bankName, sourceFile, fileDate, userId }) {
    console.log(`[JB_OPE_PARSER] Parsing Julius Baer operations file: ${sourceFile}`);

    const rows = this.parseCSV(csvContent);
    console.log(`[JB_OPE_PARSER] Found ${rows.length} operation rows`);

    // Filter out empty rows
    const validRows = rows.filter(row => row.OPER_CODE || row.PORTFOLIO);

    const operations = validRows.map(row =>
      this.mapOperationToSchema(row, bankId, bankName, sourceFile, fileDate, userId)
    );

    console.log(`[JB_OPE_PARSER] Mapped ${operations.length} operations`);

    return operations;
  },

  /**
   * Map Julius Baer operation row to standardized schema
   */
  mapOperationToSchema(row, bankId, bankName, sourceFile, fileDate, userId) {
    const inputDate = this.parseDate(row.INPUT_DATE);
    const operDate = this.parseDate(row.OPER_DATE);
    const valueDate = this.parseDate(row.VALUE_DATE);
    const expirationDate = this.parseDate(row.EXPIRATION_DATE);
    const orderCreateDate = this.parseDate(row.ORD_CREA_DATE);
    const orderExecDate = this.parseDate(row.ORD_EXEC_DATE);

    // Calculate total fees
    const bankCommission = this.parseNumber(row.BANK_COMMISSION) || 0;
    const brokerFee = this.parseNumber(row.BROKER_FEE) || 0;
    const tax = this.parseNumber(row.TAX) || 0;
    const otherFee = this.parseNumber(row.OTHER_FEE) || 0;
    const finTxnTax = this.parseNumber(row.FIN_TXN_TAX) || 0;
    const totalFees = bankCommission + brokerFee + tax + otherFee + finTxnTax;

    // Determine net amount for direction detection
    const netAmount = this.parseNumber(row.OP_NET_AMNT) || this.parseNumber(row.SYS_NET_AMOUNT) || 0;

    return {
      // Source Information
      bankId,
      bankName,
      connectionId: null,
      sourceFile,
      fileDate,
      processingDate: new Date(),

      // Operation Identifiers
      operationId: row.OPER_CODE || null,
      externalReference: row.OPER_CODE || null,
      orderCode: row.ACC_CODE || null,

      // Account Information
      portfolioCode: this.stripLeadingZeros(row.PORTFOLIO),
      portfolioCurrency: row.PORTF_CCY || null,
      accountNumber: row.ACCOUNT || null,
      accountIban: row.ACCOUNT_IBAN || null,

      // Security Information
      isin: row.INSTR_ISIN || null,
      instrumentCode: row.INSTR_CODE || null,
      instrumentWkn: row.INSTR_WKN || null,
      securityName: row.INSTR_NAME || null,
      securityType: row.INSTR_TYPE_NAME || null,
      securitySubType: row.INSTR_SUBTYPE_NAME || null,
      securityCurrency: row.INSTR_CCY || null,

      // Transaction Details - Map to standardized operation type
      operationType: mapJuliusBaerOperationType(
        row.OPER_NATURE,
        row.TYPE_NAME,
        row.SUB_TYPE_NAME
      ),
      operationTypeName: row.TYPE_NAME || row.OPER_NATURE || null,
      operationSubType: row.SUB_TYPE_NAME || null,
      originalOperationType: row.OPER_NAT_CODE || null, // Preserve original code
      typeCode: row.TYPE_CODE || null,
      subTypeCode: row.SUB_TYPE_CODE || null,

      // Direction
      debitCredit: row['DEBIT/CREDIT'] || null,

      // Dates - operationDate is REQUIRED
      operationDate: operDate || valueDate || inputDate || fileDate,
      inputDate: inputDate,
      valueDate: valueDate,
      expirationDate: expirationDate,
      orderCreateDate: orderCreateDate,
      orderExecDate: orderExecDate,

      // Amounts
      quantity: this.parseNumber(row.QUANTITY),
      quote: this.parseNumber(row.QUOTE),
      currency: row.INSTR_U_CCY || row.INSTR_CCY || null,
      positionCurrency: row.POS_CUR || null,
      netCurrency: row.NET_CURR || null,
      accruedInterest: this.parseNumber(row.AI),
      grossAmount: this.parseNumber(row.GROSS_AMOUNT),
      netAmount: this.parseNumber(row.OP_NET_AMNT),
      systemNetAmount: this.parseNumber(row.SYS_NET_AMOUNT),

      // Fees breakdown
      bankCommission: this.parseNumber(row.BANK_COMMISSION),
      brokerFee: this.parseNumber(row.BROKER_FEE),
      tax: this.parseNumber(row.TAX),
      otherFee: this.parseNumber(row.OTHER_FEE),
      finTxnTax: this.parseNumber(row.FIN_TXN_TAX),
      totalFees: totalFees !== 0 ? totalFees : null,

      // Exchange rates
      accountExchangeRate: this.parseNumber(row.ACC_EXCH_RATE),
      instrumentExchangeRate: this.parseNumber(row.INSTR_EXCH_RATE),

      // Interest rate for bonds/deposits
      interestRate: this.parseNumber(row.INT_RATE),
      accrualRule: row.ACCRUAL_RULE || null,

      // Counterparty information
      counterparty: row.COUNTERPARTY || null,
      market: row.MARKET || null,
      payeeCounterparty: row.PAY_CTPY || null,
      payeeCountry: row.PAY_CTRY || null,
      payeeIban: row.IBAN_CTPY || null,
      payNote: row.PAY_NOTE || null,
      payRemark: row.PAY_REMARK || null,

      // Remarks
      remark: row.REMARK2 || null,

      // Adjustment information (for corporate actions)
      adjQuantity: this.parseNumber(row.ADJ_QUANTITY),
      adjDeposit: row.ADJ_DEPOSIT || null,
      adjInstrumentCode: row.ADJ_INSTR_CODE || null,
      adjInstrumentIsin: row.ADJ_INSTR_ISIN || null,
      adjInstrumentName: row.ADJ_INSTR_NAME || null,

      // Reversal information
      reversalOperNature: row.REV_OPER_NAT_E || null,
      reversalOperCode: row.REV_OPER_CODE || null,

      // Reference operation
      refOperNature: row.REF_NAT_E || null,
      refOperCode: row.REF_OPER_CODE || null,

      // Money market specific
      mmTotalAiPosCur: this.parseNumber(row.MM_TOT_AI_POS_CUR),

      // Company code
      companyCode: row.COMPANY_CODE || null,

      // Bank-Specific Data (preserve all raw fields)
      bankSpecificData: {
        operNatCode: row.OPER_NAT_CODE,
        operNature: row.OPER_NATURE,
        typeCode: row.TYPE_CODE,
        typeName: row.TYPE_NAME,
        subTypeCode: row.SUB_TYPE_CODE,
        subTypeName: row.SUB_TYPE_NAME,
        instrNatCode: row.INSTR_NAT_CODE,
        instrNature: row.INSTR_NATURE,
        instrType: row.INSTR_TYPE,
        instrTypeName: row.INSTR_TYPE_NAME,
        instrSubtype: row.INSTR_SUBTYPE,
        instrSubtypeName: row.INSTR_SUBTYPE_NAME,
        instrDenom: row.INSTR_DENOM,
        deposit: row.DEPOSIT,
        instrIban: row.INSTR_IBAN,
        instrFwdAcc: row.INSTR_FWD_ACC
      },

      // Metadata
      userId,
      isProcessed: false,
      createdAt: new Date()
    };
  },

  /**
   * Generate unique key for deduplication
   */
  generateUniqueKey(operation) {
    const crypto = require('crypto');
    const keyParts = [
      operation.bankId || '',
      operation.portfolioCode || '',
      operation.operationId || '',
      operation.operationDate ? operation.operationDate.toISOString().split('T')[0] : '',
      operation.isin || operation.instrumentCode || ''
    ];

    return crypto.createHash('sha256').update(keyParts.join('|')).digest('hex');
  },

  /**
   * Validate operations file before parsing
   */
  validate(csvContent) {
    const lines = csvContent.trim().split('\n');

    if (lines.length < 2) {
      return { valid: false, error: 'File is empty or has no data rows' };
    }

    const headers = lines[0].split(';').map(h => h.trim());
    const requiredHeaders = ['PORTFOLIO', 'OPER_DATE', 'OPER_CODE'];

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
