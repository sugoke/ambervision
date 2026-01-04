import fs from 'fs';
import path from 'path';
import { AndbankOperationParser } from './parsers/andbankOperationParser.js';
import { CFMOperationParser } from './parsers/cfmOperationParser.js';
import { CMBMonacoParser } from './parsers/cmbMonacoParser.js';

/**
 * Bank Operation File Parser
 *
 * Handles parsing of bank operation/transaction files from various banks
 * Currently supports:
 * - Julius Baer (JB) operations format
 * - Andbank (MVT_MNC) operations format
 */

export const BankOperationParser = {
  /**
   * Parse the latest operations file in a directory
   * @param {string} directoryPath - Path to bank files directory
   * @param {object} options - { bankId, bankName, userId }
   * @returns {object} - { operations, filename, fileDate, totalRecords }
   */
  parseLatestFile(directoryPath, options = {}) {
    const { bankId, bankName = 'Unknown Bank' } = options;

    try {
      // Check if directory exists
      if (!fs.existsSync(directoryPath)) {
        return { error: `Directory not found: ${directoryPath}` };
      }

      // Get all CSV files and filter for operation files using early-exit pattern matching
      const files = fs.readdirSync(directoryPath);

      const operationFiles = files.filter(f => {
        if (!f.toLowerCase().endsWith('.csv')) return false;

        // Early-exit pattern matching - check most specific patterns first
        if (CMBMonacoParser.matchesOperationsPattern(f)) return true;  // TAM_mba_eam_evt_list_bu_mc_YYYYMMDD.csv
        if (AndbankOperationParser.matchesPattern(f)) return true;      // EX00YYYYMMDD_MVT_MNC.csv
        if (CFMOperationParser.matchesPattern(f)) return true;          // YYYYMMDD-L#######-LU-W#-mtit.csv
        if (f.includes('DAILY_OPE')) return true;                       // Julius Baer: DAILY_OPE

        return false;
      });

      console.log(`[BANK_OPERATIONS] Found ${operationFiles.length} operation files in ${path.basename(directoryPath)}`);

      if (operationFiles.length === 0) {
        console.warn(`[BANK_OPERATIONS] No operation files found in directory: ${directoryPath}`);
        console.warn(`[BANK_OPERATIONS] Looking for files with pattern: DAILY_OPE and extension .csv`);
        return { error: 'No operation files found in directory' };
      }

      // Sort by filename (which includes date) and get latest
      operationFiles.sort();
      const latestFile = operationFiles[operationFiles.length - 1];
      const filePath = path.join(directoryPath, latestFile);

      console.log(`[BANK_OPERATIONS] Parsing latest file: ${latestFile}`);

      // Extract file date from filename
      let fileDate;

      // Check if it's an Andbank file
      if (AndbankOperationParser.matchesPattern(latestFile)) {
        fileDate = AndbankOperationParser.extractFileDate(latestFile);
      } else if (CFMOperationParser.matchesPattern(latestFile)) {
        fileDate = CFMOperationParser.extractFileDate(latestFile);
      } else if (CMBMonacoParser.matchesOperationsPattern(latestFile)) {
        fileDate = CMBMonacoParser.extractFileDate(latestFile);
      } else {
        // Julius Baer format: DAILY_OPE_JB.YYYYMMDD.HHMMSS.ACCOUNT.CSV
        const dateMatch = latestFile.match(/\.(\d{8})\./);
        fileDate = dateMatch
          ? new Date(
              parseInt(dateMatch[1].substring(0, 4)),
              parseInt(dateMatch[1].substring(4, 6)) - 1,
              parseInt(dateMatch[1].substring(6, 8))
            )
          : new Date();
      }

      // Read and parse CSV
      const fileContent = fs.readFileSync(filePath, 'utf-8');

      // Detect bank format and parse accordingly
      // Check for Andbank first (more specific pattern)
      if (bankName.toLowerCase().includes('andbank') || AndbankOperationParser.matchesPattern(latestFile)) {
        const operations = AndbankOperationParser.parse(fileContent, {
          bankId,
          bankName,
          sourceFile: latestFile,
          fileDate,
          ...options
        });
        return {
          operations,
          filename: latestFile,
          fileDate,
          totalRecords: operations.length
        };
      }

      // Check for CFM
      if (bankName.toLowerCase().includes('cfm') || CFMOperationParser.matchesPattern(latestFile)) {
        const operations = CFMOperationParser.parse(fileContent, {
          bankId,
          bankName,
          sourceFile: latestFile,
          fileDate,
          ...options
        });
        return {
          operations,
          filename: latestFile,
          fileDate,
          totalRecords: operations.length
        };
      }

      // Check for CMB Monaco
      if (bankName.toLowerCase().includes('cmb') || CMBMonacoParser.matchesOperationsPattern(latestFile)) {
        const operations = CMBMonacoParser.parseOperations(fileContent, {
          bankId,
          bankName,
          sourceFile: latestFile,
          fileDate,
          ...options
        });
        return {
          operations,
          filename: latestFile,
          fileDate,
          totalRecords: operations.length
        };
      }

      // Check for Julius Baer
      if (bankName.toLowerCase().includes('julius') || latestFile.includes('_JB.')) {
        return this.parseJuliusBaerOperations(fileContent, {
          bankId,
          filename: latestFile,
          fileDate,
          ...options
        });
      }

      return { error: 'Unsupported bank format' };

    } catch (error) {
      console.error('[BANK_OPERATIONS] Parse error:', error);
      return { error: error.message };
    }
  },

  /**
   * Parse Julius Baer operations format
   * Format: Semicolon-delimited CSV with specific columns
   */
  parseJuliusBaerOperations(fileContent, options = {}) {
    const { bankId, filename, fileDate, userId } = options;

    try {
      // Parse CSV manually (semicolon delimiter)
      const lines = fileContent.trim().split('\n');

      if (lines.length < 2) {
        return {
          operations: [],
          filename,
          fileDate,
          totalRecords: 0
        };
      }

      // First line is headers
      const headers = lines[0].split(';').map(h => h.trim());

      // Parse remaining lines
      const records = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip empty lines
        if (!line) {
          console.log(`[JB_OPERATIONS] Skipping empty line ${i}`);
          continue;
        }
        const values = line.split(';');
        const record = {};
        headers.forEach((header, index) => {
          record[header] = values[index] ? values[index].trim() : '';
        });
        records.push(record);
      }

      console.log(`[JB_OPERATIONS] Created ${records.length} records from ${lines.length - 1} CSV lines`);
      console.log(`[JB_OPERATIONS] Headers found (${headers.length}):`, headers.slice(0, 10).join(', '), '...');

      // Sample first record for diagnostics
      if (records.length > 0) {
        console.log(`[JB_OPERATIONS] Sample record fields:`, {
          PORTFOLIO: records[0].PORTFOLIO,
          OPER_DATE: records[0].OPER_DATE,
          TYPE_NAME: records[0].TYPE_NAME,
          INSTR_ISIN: records[0].INSTR_ISIN,
          INSTR_NAME: records[0].INSTR_NAME
        });
      }

      const operations = [];
      let recordsProcessed = 0;
      let recordsSkipped = 0;

      for (const record of records) {
        try {
          recordsProcessed++;

          // Parse dates
          const inputDate = this.parseJBDate(record.INPUT_DATE);
          const operationDate = this.parseJBDate(record.OPER_DATE);
          const valueDate = this.parseJBDate(record.VALUE_DATE);

          // Parse amounts
          const quantity = parseFloat(record.QUANTITY?.replace(/,/g, '') || 0);
          const quote = parseFloat(record.QUOTE?.replace(/,/g, '') || 0);
          const bankCommission = parseFloat(record.BANK_COMMISSION?.replace(/,/g, '') || 0);
          const brokerFee = parseFloat(record.BROKER_FEE?.replace(/,/g, '') || 0);
          const tax = parseFloat(record.TAX?.replace(/,/g, '') || 0);
          const otherFee = parseFloat(record.OTHER_FEE?.replace(/,/g, '') || 0);
          const grossAmount = parseFloat(record.GROSS_AMOUNT?.replace(/,/g, '') || 0);
          const netAmount = parseFloat(record.OP_NET_AMNT?.replace(/,/g, '') || 0);

          // Determine operation type and category
          const operationType = this.mapOperationType(record.TYPE_NAME, record.SUB_TYPE_NAME);
          const operationCategory = this.mapOperationCategory(record.INSTR_TYPE_NAME);

          // Build standardized operation object
          const operation = {
            // Bank and portfolio identifiers
            bankId,
            portfolioCode: record.PORTFOLIO?.trim() || 'UNKNOWN',
            portfolioCurrency: record.PORTF_CCY?.trim() || 'EUR',
            userId, // Will be mapped from portfolioCode

            // Dates
            inputDate,
            operationDate,
            valueDate,
            fileDate,

            // Instrument details
            instrumentCode: record.INSTR_CODE?.trim(),
            isin: record.INSTR_ISIN?.trim() || null,
            wkn: record.INSTR_WKN?.trim() || null,
            ticker: record.INSTR_ISIN?.trim() || record.INSTR_WKN?.trim() || null,
            instrumentName: record.INSTR_NAME?.trim() || 'Unknown',
            instrumentType: record.INSTR_TYPE_NAME?.trim(),
            instrumentSubtype: record.INSTR_SUBTYPE_NAME?.trim(),
            instrumentCurrency: record.INSTR_CCY?.trim() || 'EUR',

            // Operation details
            operationType, // Standardized: BUY, SELL, DIVIDEND, COUPON, FEE, TRANSFER, etc.
            operationCategory, // EQUITY, BOND, CASH, STRUCTURED_PRODUCT, etc.
            operationTypeName: record.TYPE_NAME?.trim(),
            operationSubtypeName: record.SUB_TYPE_NAME?.trim(),
            operationCode: record.OPER_CODE?.trim(),

            // Financial details
            quantity,
            price: quote,
            grossAmount,
            netAmount,

            // Fees and charges
            bankCommission,
            brokerFee,
            tax,
            otherFee,
            totalFees: bankCommission + brokerFee + tax + otherFee,

            // Additional info
            account: record.ACCOUNT?.trim(),
            accountIban: record.ACCOUNT_IBAN?.trim(),
            counterparty: record.COUNTERPARTY?.trim(),
            market: record.MARKET?.trim(),
            remark: record.REMARK2?.trim(),

            // Metadata
            sourceFile: filename,
            importedAt: new Date(),
            isActive: true,

            // Store original bank-specific data for reference
            bankSpecificData: {
              debitCredit: record['DEBIT/CREDIT']?.trim(),
              exchangeRate: parseFloat(record.ACC_EXCH_RATE?.replace(/,/g, '') || 1),
              referenceCode: record.REF_OPER_CODE?.trim(),
              orderCreationDate: record.ORD_CREA_DATE?.trim(),
              orderExecutionDate: record.ORD_EXEC_DATE?.trim(),
              companyCode: record.COMPANY_CODE?.trim()
            }
          };

          operations.push(operation);

        } catch (recordError) {
          recordsSkipped++;
          console.error(`[JB_OPERATIONS] ❌ Error parsing record ${recordsProcessed}:`, {
            error: recordError.message,
            stack: recordError.stack,
            recordSample: {
              PORTFOLIO: record.PORTFOLIO,
              OPER_DATE: record.OPER_DATE,
              TYPE_NAME: record.TYPE_NAME,
              INSTR_ISIN: record.INSTR_ISIN
            }
          });
        }
      }

      console.log(`[JB_OPERATIONS] ✅ Processing complete: ${operations.length} operations created, ${recordsSkipped} records skipped`);

      return {
        operations,
        filename,
        fileDate,
        totalRecords: operations.length
      };

    } catch (error) {
      console.error('[JB_OPERATIONS] Julius Baer parse error:', error);
      throw error;
    }
  },

  /**
   * Parse Julius Baer date format (YYYYMMDD or DD/MM/YYYY HH:MM:SS)
   */
  parseJBDate(dateStr) {
    if (!dateStr || dateStr.trim() === '') return null;

    try {
      const str = dateStr.trim();

      // Format: YYYYMMDD
      if (/^\d{8}$/.test(str)) {
        const year = parseInt(str.substring(0, 4));
        const month = parseInt(str.substring(4, 6)) - 1;
        const day = parseInt(str.substring(6, 8));
        return new Date(year, month, day);
      }

      // Format: DD/MM/YYYY HH:MM:SS
      if (str.includes('/')) {
        const [datePart] = str.split(' ');
        const [day, month, year] = datePart.split('/');
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      }

      return new Date(str);
    } catch (error) {
      console.error('[JB_OPERATIONS] Date parse error:', dateStr, error);
      return null;
    }
  },

  /**
   * Map bank operation type to standardized type
   */
  mapOperationType(typeName, subtypeName) {
    const type = (typeName || '').toLowerCase();
    const subtype = (subtypeName || '').toLowerCase();

    // Buy/Sell operations
    if (type.includes('buy') || subtype.includes('buy') || subtype.includes('purchase')) {
      return 'BUY';
    }
    if (type.includes('sell') || subtype.includes('sell') || subtype.includes('sale')) {
      return 'SELL';
    }

    // Income operations
    if (type.includes('dividend') || subtype.includes('dividend')) {
      return 'DIVIDEND';
    }
    if (type.includes('coupon') || subtype.includes('coupon') || type.includes('interest')) {
      return 'COUPON';
    }

    // Fee operations
    if (type.includes('fee') || subtype.includes('fee') || type.includes('commission')) {
      return 'FEE';
    }

    // Transfer operations
    if (type.includes('transfer') || type.includes('withdrawal') || type.includes('deposit')) {
      return 'TRANSFER';
    }

    // Redemption/Maturity
    if (type.includes('redemption') || type.includes('maturity')) {
      return 'REDEMPTION';
    }

    // Default
    return 'OTHER';
  },

  /**
   * Map instrument type to operation category
   */
  mapOperationCategory(instrumentType) {
    const type = (instrumentType || '').toLowerCase();

    if (type.includes('equity') || type.includes('stock') || type.includes('share')) {
      return 'EQUITY';
    }
    if (type.includes('bond') || type.includes('fixed income')) {
      return 'BOND';
    }
    if (type.includes('cash') || type.includes('account') || type.includes('deposit')) {
      return 'CASH';
    }
    if (type.includes('cert') || type.includes('structured') || type.includes('convertible')) {
      return 'STRUCTURED_PRODUCT';
    }
    if (type.includes('fund') || type.includes('etf')) {
      return 'FUND';
    }
    if (type.includes('derivative') || type.includes('option') || type.includes('future')) {
      return 'DERIVATIVE';
    }

    return 'OTHER';
  }
};
