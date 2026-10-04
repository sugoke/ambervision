/**
 * Julius Baer Operation File Parser
 *
 * Parses Julius Baer CSV operation files (OPE) into the PMSOperations schema.
 *
 * Filename format: DDS########_DAILY_OPE_JB.YYYYMMDD.HHMMSS.EAM#######.CSV
 * Example: DDS03632510_DAILY_OPE_JB.20251117.031754.EAM3632510.CSV
 *
 * File format: semicolon-delimited CSV with header row. The same operation is repeated
 * in the daily files of following days; OPER_CODE is the bank's unique reference for it
 * (one OPER_CODE = one operation), so it is the operation's id.
 *
 * Julius Baer quirks:
 * - OP_NET_AMNT is already signed from the account's view (+ credit, − debit) and is
 *   expressed in NET_CURR (falls back to POS_CUR for securities moves).
 * - TYPE_NAME carries the operation wording; several cash wordings ("ACKZ Account
 *   Transfer", "SWIFTCTS Payment", "MONEY MARKET") only get their direction from the sign.
 * - "Securities transfer" moves securities in/out without cash: OP_NET_AMNT is the
 *   value of the securities, DEBIT/CREDIT is 0.
 * - DEBIT/CREDIT is the signed cash movement on the account; when present its sign wins
 *   over OP_NET_AMNT ("Third party fees" carry a positive net but are debits).
 * - INSTR_NAME is truncated to 20 characters; REMARK2 repeats it in full after the
 *   operation wording, so the full name is read from there.
 * - "6_B_LOAN" (loan drawdown / repayment) is financing, not a client flow: it stays OTHER.
 */

import { OPERATION_TYPES, directedType } from '../constants/operationTypes';
import { withStandard } from '../helpers/operationStandardizer';

// TYPE_NAME (lowercase) → type. Two-way wordings resolve their direction from the sign.
const TYPE_NAME_MAP = {
  'securities purchase': OPERATION_TYPES.BUY,
  'new issue purchase': OPERATION_TYPES.BUY,
  'securities sale': OPERATION_TYPES.SELL,
  'redemption': OPERATION_TYPES.REDEMPTION,
  'dt_early.redm.m': OPERATION_TYPES.REDEMPTION,
  'dt_spec.red': OPERATION_TYPES.REDEMPTION,
  'liquidation cash': OPERATION_TYPES.REDEMPTION,
  'interest payment': OPERATION_TYPES.COUPON,
  'cash dividend': OPERATION_TYPES.DIVIDEND,
  'dividend': OPERATION_TYPES.DIVIDEND,
  'payment of interest': OPERATION_TYPES.INTEREST,
  'debit interest': OPERATION_TYPES.INTEREST,
  'credit interest': OPERATION_TYPES.INTEREST,
  'correction of debit': OPERATION_TYPES.INTEREST,
  'option premium': OPERATION_TYPES.OPTION_PREMIUM,
  'acc. maintenance fee': OPERATION_TYPES.FEE,
  'safecustody fees': OPERATION_TYPES.FEE,
  'lombard file fee': OPERATION_TYPES.FEE,
  'third party fees': OPERATION_TYPES.FEE,
  'acr4 reverse of charges': OPERATION_TYPES.FEE,
  'taxes': OPERATION_TYPES.TAX,
  'money market': 'DEPOSIT',
  'ackz account transfer': 'TRANSFER',
  'swiftcts payment': 'PAYMENT',
  'swiftmxct payment': 'PAYMENT',
  'pacs.008 receipt of payment': 'PAYMENT'
};

export const JuliusBaerOperationParser = {
  bankName: 'Julius Baer',

  filenamePattern: /^DDS\d+_DAILY_OPE_JB\.(\d{8})\.\d+\.EAM\d+\.CSV$/i,

  matchesPattern(filename) {
    return this.filenamePattern.test(filename) || String(filename).includes('_JB.');
  },

  parseNumber(value) {
    if (value === null || value === undefined || String(value).trim() === '') return 0;
    const n = parseFloat(String(value).replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  },

  /**
   * Parse Julius Baer date format (YYYYMMDD or DD/MM/YYYY HH:MM:SS)
   */
  parseDate(dateStr) {
    if (!dateStr || dateStr.trim() === '') return null;
    const str = dateStr.trim();
    if (/^\d{8}$/.test(str)) {
      return new Date(parseInt(str.substring(0, 4)), parseInt(str.substring(4, 6)) - 1, parseInt(str.substring(6, 8)));
    }
    if (str.includes('/')) {
      const [datePart] = str.split(' ');
      const [day, month, year] = datePart.split('/');
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    }
    const d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  },

  /**
   * Map TYPE_NAME / SUB_TYPE_NAME to a standard type, using the signed net amount
   * for wordings that do not carry a direction.
   */
  mapOperationType(typeName, subtypeName, signedAmount) {
    const type = (typeName || '').toLowerCase().trim();
    const subtype = (subtypeName || '').toLowerCase().trim();

    if (type === 'securities transfer') {
      if (subtype.includes('out')) return OPERATION_TYPES.TRANSFER_OUT;
      if (subtype.includes('in')) return OPERATION_TYPES.TRANSFER_IN;
      return directedType('TRANSFER', signedAmount);
    }
    const mapped = TYPE_NAME_MAP[type];
    if (mapped) return directedType(mapped, signedAmount);
    return OPERATION_TYPES.OTHER;
  },

  mapOperationCategory(instrumentType) {
    const type = (instrumentType || '').toLowerCase();
    if (type.includes('equity') || type.includes('stock') || type.includes('share')) return 'EQUITY';
    if (type.includes('bond') || type.includes('fixed income')) return 'BOND';
    if (type.includes('cash') || type.includes('account') || type.includes('deposit')) return 'CASH';
    if (type.includes('cert') || type.includes('structured') || type.includes('convertible')) return 'STRUCTURED_PRODUCT';
    if (type.includes('fund')) return 'FUND';
    return 'OTHER';
  },

  /**
   * Parse a Julius Baer operations file.
   * @returns {Array} operations
   */
  parse(fileContent, options = {}) {
    const { bankId, sourceFile, fileDate, userId } = options;
    const lines = String(fileContent || '').trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(';').map(h => h.trim());
    const operations = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const values = line.split(';');
      const record = {};
      headers.forEach((header, index) => { record[header] = values[index] ? values[index].trim() : ''; });

      try {
        const operation = this.mapToSchema(record, { bankId, sourceFile, fileDate, userId });
        if (operation) operations.push(operation);
      } catch (error) {
        console.error(`[JB_OPERATIONS] Error parsing record ${i}: ${error.message}`);
      }
    }

    console.log(`[JB_OPERATIONS] ${operations.length} operations from ${sourceFile}`);
    return operations;
  },

  /**
   * Recompute type and std of an operation stored by an older parser version whose
   * source file is no longer on disk. The stored fields are the file's columns under
   * other names, so they are mapped back and run through the same mapping.
   * @returns {{ operationType, std, currency }}
   */
  restandardizeStored(op) {
    const record = {
      TYPE_NAME: op.operationTypeName || '',
      SUB_TYPE_NAME: op.operationSubtypeName || '',
      OP_NET_AMNT: String(op.netAmount ?? ''),
      GROSS_AMOUNT: String(op.grossAmount ?? ''),
      'DEBIT/CREDIT': op.bankSpecificData?.debitCredit || '',
      REMARK2: op.remark || '',
      INSTR_NAME: op.instrumentName || '',
      INSTR_ISIN: op.isin || '',
      INSTR_TYPE_NAME: op.instrumentType || '',
      INSTR_CCY: op.instrumentCurrency || '',
      NET_CURR: op.currency || op.instrumentCurrency || op.portfolioCurrency || '',
      QUANTITY: String(op.quantity ?? ''),
      QUOTE: String(op.price ?? ''),
      BANK_COMMISSION: String(op.bankCommission ?? ''),
      BROKER_FEE: String(op.brokerFee ?? ''),
      TAX: String(op.tax ?? ''),
      OTHER_FEE: String(op.otherFee ?? ''),
      OPER_CODE: op.operationCode || '',
      ACC_EXCH_RATE: String(op.bankSpecificData?.exchangeRate ?? ''),
      PORTFOLIO: op.portfolioCode
    };
    const mapped = this.mapToSchema(record, { bankId: op.bankId, sourceFile: op.sourceFile, fileDate: op.fileDate, userId: op.userId });
    return { operationType: mapped.operationType, std: mapped.std, currency: mapped.currency };
  },

  mapToSchema(record, { bankId, sourceFile, fileDate, userId }) {
    const inputDate = this.parseDate(record.INPUT_DATE);
    const operationDate = this.parseDate(record.OPER_DATE) || this.parseDate(record.VALUE_DATE) || inputDate || fileDate;
    const valueDate = this.parseDate(record.VALUE_DATE);

    const quantity = this.parseNumber(record.QUANTITY);
    const quote = this.parseNumber(record.QUOTE);
    const bankCommission = this.parseNumber(record.BANK_COMMISSION);
    const brokerFee = this.parseNumber(record.BROKER_FEE);
    const tax = this.parseNumber(record.TAX);
    const finTxnTax = this.parseNumber(record.FIN_TXN_TAX);
    const otherFee = this.parseNumber(record.OTHER_FEE);
    const grossAmount = this.parseNumber(record.GROSS_AMOUNT);
    const netAmount = this.parseNumber(record.OP_NET_AMNT);
    const operationCode = record.OPER_CODE?.trim() || null;

    const debitCredit = this.parseNumber(record['DEBIT/CREDIT']);
    const signedAmount = debitCredit !== 0 ? Math.sign(debitCredit) * Math.abs(netAmount) : netAmount;
    const remark = record.REMARK2?.trim() || '';
    const shortName = record.INSTR_NAME?.trim() || '';
    const nameAt = shortName ? remark.indexOf(shortName) : -1;
    const fullInstrumentName = nameAt >= 0 ? remark.slice(nameAt) : shortName;

    const typeName = record.TYPE_NAME?.trim() || '';
    const subtypeName = record.SUB_TYPE_NAME?.trim() || '';
    const operationType = this.mapOperationType(typeName, subtypeName, signedAmount);
    const isSecuritiesMove = typeName.toLowerCase() === 'securities transfer'
      || typeName.toLowerCase() === 'deposit transfer';

    const operation = {
      bankId,
      portfolioCode: record.PORTFOLIO?.trim() || 'UNKNOWN',
      portfolioCurrency: record.PORTF_CCY?.trim() || 'EUR',
      userId,

      inputDate,
      operationDate,
      valueDate,
      fileDate,

      // OPER_CODE is unique per operation (repeated unchanged across daily files)
      operationId: operationCode,

      instrumentCode: record.INSTR_CODE?.trim(),
      isin: record.INSTR_ISIN?.trim() || null,
      wkn: record.INSTR_WKN?.trim() || null,
      ticker: record.INSTR_ISIN?.trim() || record.INSTR_WKN?.trim() || null,
      instrumentName: record.INSTR_NAME?.trim() || 'Unknown',
      instrumentType: record.INSTR_TYPE_NAME?.trim(),
      instrumentSubtype: record.INSTR_SUBTYPE_NAME?.trim(),
      instrumentCurrency: record.INSTR_CCY?.trim() || 'EUR',
      currency: record.NET_CURR?.trim() || record.POS_CUR?.trim() || record.INSTR_CCY?.trim() || null,

      operationType,
      operationCategory: this.mapOperationCategory(record.INSTR_TYPE_NAME),
      operationTypeName: typeName || null,
      operationSubtypeName: subtypeName || null,
      operationCode,

      quantity,
      price: quote,
      grossAmount,
      netAmount,

      bankCommission,
      brokerFee,
      tax,
      otherFee,
      totalFees: bankCommission + brokerFee + tax + otherFee,

      account: record.ACCOUNT?.trim(),
      accountIban: record.ACCOUNT_IBAN?.trim(),
      counterparty: record.COUNTERPARTY?.trim(),
      market: record.MARKET?.trim(),
      remark: record.REMARK2?.trim(),

      sourceFile,
      importedAt: new Date(),
      isActive: true,

      bankSpecificData: {
        debitCredit: record['DEBIT/CREDIT']?.trim(),
        exchangeRate: this.parseNumber(record.ACC_EXCH_RATE) || 1,
        referenceCode: record.REF_OPER_CODE?.trim(),
        orderCreationDate: record.ORD_CREA_DATE?.trim(),
        orderExecutionDate: record.ORD_EXEC_DATE?.trim(),
        companyCode: record.COMPANY_CODE?.trim(),
        operNatureCode: record.OPER_NAT_CODE?.trim()
      }
    };

    return withStandard(operation, {
      type: operationType,
      description: remark || typeName,
      instrumentName: fullInstrumentName,
      isin: record.INSTR_ISIN,
      quantity,
      price: quote,
      amount: signedAmount,
      currency: operation.currency,
      cashImpact: !isSecuritiesMove,
      fees: bankCommission + brokerFee + otherFee,
      taxes: tax + finTxnTax,
      accruedInterest: this.parseNumber(record.AI),
      fxRate: this.parseNumber(record.ACC_EXCH_RATE) || null,
      bankTypeCode: [record.OPER_NAT_CODE, record.TYPE_CODE, record.SUB_TYPE_CODE].filter(Boolean).join('/'),
      bankTypeLabel: subtypeName ? `${typeName} – ${subtypeName}` : typeName,
      reference: operationCode
    });
  }
};
