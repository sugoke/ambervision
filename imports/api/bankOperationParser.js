import fs from 'fs';
import path from 'path';
import { AndbankOperationParser } from './parsers/andbankOperationParser.js';
import { CFMOperationParser } from './parsers/cfmOperationParser.js';
import { CFMFXParser } from './parsers/cfmFXParser.js';
import { CFMCashOperationParser } from './parsers/cfmCashOperationParser.js';
import { CMBMonacoParser } from './parsers/cmbMonacoParser.js';
import { SGMonacoParser } from './parsers/sgMonacoParser.js';
import { EDRMonacoOperationParser } from './parsers/edrMonacoOperationParser.js';
import { JuliusBaerOperationParser } from './parsers/juliusBaerOperationParser.js';

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
   * Recompute operationType and the std block of a stored operation whose source file
   * is no longer on disk, for banks whose parser can do it from the stored fields.
   * @returns {{ operationType, std, currency } | null}
   */
  restandardizeStored(operation, bankName = '') {
    if (/julius/i.test(bankName) || String(operation.sourceFile || '').includes('_JB.')) {
      return JuliusBaerOperationParser.restandardizeStored(operation);
    }
    return null;
  },

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
      console.log(`[BANK_OPERATIONS] All files in ${directoryPath}: ${files.join(', ')}`);

      const operationFiles = files.filter(f => {
        if (!f.toLowerCase().endsWith('.csv')) return false;

        // Early-exit pattern matching - check most specific patterns first
        const isSGTrans = SGMonacoParser.matchesTransactionsPattern(f);
        if (isSGTrans) {
          console.log(`[BANK_OPERATIONS] Found SG Monaco trans file: ${f}`);
          return true;  // trans.YYYYMMDD.csv
        }
        if (CMBMonacoParser.matchesOperationsPattern(f)) return true;  // TAM_mba_eam_evt_list_bu_mc_YYYYMMDD.csv
        if (AndbankOperationParser.matchesPattern(f)) return true;      // EX00YYYYMMDD_MVT_MNC.csv
        if (CFMOperationParser.matchesPattern(f)) return true;          // YYYYMMDD-X#######-LU-W#-mtit.csv
        if (CFMFXParser.matchesPattern(f)) return true;                 // YYYYMMDD-X#######-LU-W#-mfrx.csv
        if (CFMCashOperationParser.matchesPattern(f)) return true;      // YYYYMMDD-X#######-LU-W#-mesp.csv
        if (EDRMonacoOperationParser.matchesPattern(f)) return true;    // mvt_XXXXXXXX_YYYYMMDD.csv (EDR Monaco)
        if (f.includes('DAILY_OPE')) return true;                       // Julius Baer: DAILY_OPE

        return false;
      });

      console.log(`[BANK_OPERATIONS] Found ${operationFiles.length} operation files in ${path.basename(directoryPath)}`);

      if (operationFiles.length === 0) {
        console.warn(`[BANK_OPERATIONS] No operation files found in directory: ${directoryPath}`);
        console.warn(`[BANK_OPERATIONS] Looking for: trans.YYYYMMDD.csv (SG), TAM_mba_eam_evt_list_*.csv (CMB), DAILY_OPE*.csv (JB), *_MVT_MNC.csv (Andbank), *-mtit.csv (CFM), mvt_*_YYYYMMDD.csv (EDR)`);
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
      if (SGMonacoParser.matchesTransactionsPattern(latestFile)) {
        fileDate = SGMonacoParser.extractFileDate(latestFile);
      } else if (AndbankOperationParser.matchesPattern(latestFile)) {
        fileDate = AndbankOperationParser.extractFileDate(latestFile);
      } else if (CFMOperationParser.matchesPattern(latestFile)) {
        fileDate = CFMOperationParser.extractFileDate(latestFile);
      } else if (CFMFXParser.matchesPattern(latestFile)) {
        fileDate = CFMFXParser.extractFileDate(latestFile);
      } else if (CFMCashOperationParser.matchesPattern(latestFile)) {
        fileDate = CFMCashOperationParser.extractFileDate(latestFile);
      } else if (CMBMonacoParser.matchesOperationsPattern(latestFile)) {
        fileDate = CMBMonacoParser.extractFileDate(latestFile);
      } else if (EDRMonacoOperationParser.matchesPattern(latestFile)) {
        fileDate = EDRMonacoOperationParser.extractFileDate(latestFile);
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
      // Some banks (Andbank, EDR) write Latin-1; decoding those as UTF-8 garbles accents
      const rawBuffer = fs.readFileSync(filePath);
      const utf8Content = rawBuffer.toString('utf-8');
      const fileContent = utf8Content.includes('\uFFFD') ? rawBuffer.toString('latin1') : utf8Content;

      // Detect bank format and parse accordingly

      // Check for SG Monaco first (trans.YYYYMMDD.csv pattern)
      if (SGMonacoParser.matchesTransactionsPattern(latestFile)) {
        const operations = SGMonacoParser.parseOperations(fileContent, {
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

      // Check for Andbank (more specific pattern)
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

      // Check for CFM operations (mtit files)
      if (CFMOperationParser.matchesPattern(latestFile)) {
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

      // Check for CFM FX operations (mfrx files)
      if (CFMFXParser.matchesPattern(latestFile)) {
        const operations = CFMFXParser.parse(fileContent, {
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

      // Check for CFM cash operations (mesp files)
      if (CFMCashOperationParser.matchesPattern(latestFile)) {
        const operations = CFMCashOperationParser.parse(fileContent, {
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

      // Check for EDR Monaco operations (mvt_* files)
      if (EDRMonacoOperationParser.matchesPattern(latestFile) || bankName.toLowerCase().includes('rothschild')) {
        const operations = EDRMonacoOperationParser.parse(fileContent, {
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

      // Check for CFM by bank name (fallback)
      if (bankName.toLowerCase().includes('cfm')) {
        // Default to CFMOperationParser for mtit-style content
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
        const operations = JuliusBaerOperationParser.parse(fileContent, {
          ...options,
          bankId,
          sourceFile: latestFile,
          fileDate
        });
        return { operations, filename: latestFile, fileDate, totalRecords: operations.length };
      }

      return { error: 'Unsupported bank format' };

    } catch (error) {
      console.error('[BANK_OPERATIONS] Parse error:', error);
      return { error: error.message };
    }
  },

  /**
   * Parse ALL operation files in a directory (not just the latest)
   * This is important for transaction files which are incremental (each day's file contains only that day's transactions)
   * @param {string} directoryPath - Path to bank files directory
   * @param {object} options - { bankId, bankName, userId, seenFiles }
   * @returns {object} - { operations, processedFiles, totalRecords }
   */
  parseAllFiles(directoryPath, options = {}) {
    const { bankId, bankName = 'Unknown Bank', seenFiles = [] } = options;

    try {
      // Check if directory exists
      if (!fs.existsSync(directoryPath)) {
        return { error: `Directory not found: ${directoryPath}`, operations: [], processedFiles: [] };
      }

      // Get all CSV files and filter for operation files
      const files = fs.readdirSync(directoryPath);
      console.log(`[BANK_OPERATIONS] All files in ${directoryPath}: ${files.join(', ')}`);

      const operationFiles = files.filter(f => {
        if (!f.toLowerCase().endsWith('.csv')) return false;

        // Early-exit pattern matching - check most specific patterns first
        if (SGMonacoParser.matchesTransactionsPattern(f)) return true;
        if (CMBMonacoParser.matchesOperationsPattern(f)) return true;
        if (AndbankOperationParser.matchesPattern(f)) return true;
        if (CFMOperationParser.matchesPattern(f)) return true;
        if (CFMFXParser.matchesPattern(f)) return true;
        if (CFMCashOperationParser.matchesPattern(f)) return true;
        if (EDRMonacoOperationParser.matchesPattern(f)) return true;  // mvt_XXXXXXXX_YYYYMMDD.csv (EDR Monaco)
        if (f.includes('DAILY_OPE')) return true;

        return false;
      });

      console.log(`[BANK_OPERATIONS] Found ${operationFiles.length} operation files in ${path.basename(directoryPath)}`);

      if (operationFiles.length === 0) {
        console.warn(`[BANK_OPERATIONS] No operation files found in directory: ${directoryPath}`);
        return { operations: [], processedFiles: [], totalRecords: 0 };
      }

      // Filter out already-processed files
      const newFiles = operationFiles.filter(f => !seenFiles.includes(f));

      if (newFiles.length === 0) {
        console.log(`[BANK_OPERATIONS] All ${operationFiles.length} operation files have been processed already`);
        return { operations: [], processedFiles: [], totalRecords: 0, message: 'All files already processed' };
      }

      console.log(`[BANK_OPERATIONS] Processing ${newFiles.length} new operation files (${operationFiles.length - newFiles.length} already seen)`);

      // Sort files by date (oldest first) to process in chronological order
      newFiles.sort();

      // Parse each file and aggregate results
      const allOperations = [];
      const processedFiles = [];
      const failedFiles = [];

      for (const filename of newFiles) {
        console.log(`[BANK_OPERATIONS] Parsing file: ${filename}`);
        const result = this.parseSingleFile(path.join(directoryPath, filename), {
          ...options,
          sourceFile: filename
        });

        // A file that failed to read stays unseen so the next sync retries it; marking it
        // processed would log it as an empty file and lose its movements for good
        if (result.error) {
          console.error(`[BANK_OPERATIONS] Failed to parse ${filename}, will retry next sync: ${result.error}`);
          failedFiles.push({ filename, error: result.error });
          continue;
        }

        if (result.operations && result.operations.length > 0) {
          allOperations.push(...result.operations);
          console.log(`[BANK_OPERATIONS] Parsed ${result.operations.length} operations from ${filename}`);
        } else {
          console.log(`[BANK_OPERATIONS] No operations in ${filename} (empty file)`);
        }

        // Track as processed even if empty (to avoid re-processing)
        processedFiles.push(filename);
      }

      console.log(`[BANK_OPERATIONS] Total: ${allOperations.length} operations from ${processedFiles.length} files${failedFiles.length ? `, ${failedFiles.length} failed` : ''}`);

      return {
        operations: allOperations,
        processedFiles,
        failedFiles,
        totalRecords: allOperations.length
      };

    } catch (error) {
      console.error('[BANK_OPERATIONS] Parse all files error:', error);
      return { error: error.message, operations: [], processedFiles: [] };
    }
  },

  /**
   * Parse a single operation file
   * @param {string} filePath - Full path to the file
   * @param {object} options - { bankId, bankName, sourceFile, userId }
   * @returns {object} - { operations, filename, fileDate, totalRecords }
   */
  parseSingleFile(filePath, options = {}) {
    const { bankId, bankName = 'Unknown Bank', sourceFile } = options;
    const filename = sourceFile || path.basename(filePath);

    try {
      // Extract file date from filename
      let fileDate;
      if (SGMonacoParser.matchesTransactionsPattern(filename)) {
        fileDate = SGMonacoParser.extractFileDate(filename);
      } else if (AndbankOperationParser.matchesPattern(filename)) {
        fileDate = AndbankOperationParser.extractFileDate(filename);
      } else if (CFMOperationParser.matchesPattern(filename)) {
        fileDate = CFMOperationParser.extractFileDate(filename);
      } else if (CFMFXParser.matchesPattern(filename)) {
        fileDate = CFMFXParser.extractFileDate(filename);
      } else if (CFMCashOperationParser.matchesPattern(filename)) {
        fileDate = CFMCashOperationParser.extractFileDate(filename);
      } else if (CMBMonacoParser.matchesOperationsPattern(filename)) {
        fileDate = CMBMonacoParser.extractFileDate(filename);
      } else if (EDRMonacoOperationParser.matchesPattern(filename)) {
        fileDate = EDRMonacoOperationParser.extractFileDate(filename);
      } else {
        const dateMatch = filename.match(/\.(\d{8})\./);
        fileDate = dateMatch
          ? new Date(
              parseInt(dateMatch[1].substring(0, 4)),
              parseInt(dateMatch[1].substring(4, 6)) - 1,
              parseInt(dateMatch[1].substring(6, 8))
            )
          : new Date();
      }

      // Read file content (Andbank and EDR write Latin-1; decoding those as UTF-8 garbles accents)
      const rawBuffer = fs.readFileSync(filePath);
      const utf8Content = rawBuffer.toString('utf-8');
      const fileContent = utf8Content.includes('\uFFFD') ? rawBuffer.toString('latin1') : utf8Content;

      // Detect bank format and parse accordingly
      if (SGMonacoParser.matchesTransactionsPattern(filename)) {
        const operations = SGMonacoParser.parseOperations(fileContent, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          ...options
        });
        return { operations, filename, fileDate, totalRecords: operations.length };
      }

      if (bankName.toLowerCase().includes('andbank') || AndbankOperationParser.matchesPattern(filename)) {
        const operations = AndbankOperationParser.parse(fileContent, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          ...options
        });
        return { operations, filename, fileDate, totalRecords: operations.length };
      }

      if (CFMOperationParser.matchesPattern(filename)) {
        const operations = CFMOperationParser.parse(fileContent, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          ...options
        });
        return { operations, filename, fileDate, totalRecords: operations.length };
      }

      if (CFMFXParser.matchesPattern(filename)) {
        const operations = CFMFXParser.parse(fileContent, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          ...options
        });
        return { operations, filename, fileDate, totalRecords: operations.length };
      }

      if (CFMCashOperationParser.matchesPattern(filename)) {
        const operations = CFMCashOperationParser.parse(fileContent, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          ...options
        });
        return { operations, filename, fileDate, totalRecords: operations.length };
      }

      // EDR Monaco operations (mvt_* files)
      if (EDRMonacoOperationParser.matchesPattern(filename) || bankName.toLowerCase().includes('rothschild')) {
        const operations = EDRMonacoOperationParser.parse(fileContent, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          ...options
        });
        return { operations, filename, fileDate, totalRecords: operations.length };
      }

      if (bankName.toLowerCase().includes('cfm')) {
        const operations = CFMOperationParser.parse(fileContent, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          ...options
        });
        return { operations, filename, fileDate, totalRecords: operations.length };
      }

      if (bankName.toLowerCase().includes('cmb') || CMBMonacoParser.matchesOperationsPattern(filename)) {
        const operations = CMBMonacoParser.parseOperations(fileContent, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          ...options
        });
        return { operations, filename, fileDate, totalRecords: operations.length };
      }

      if (bankName.toLowerCase().includes('julius') || filename.includes('_JB.')) {
        const operations = JuliusBaerOperationParser.parse(fileContent, {
          ...options,
          bankId,
          sourceFile: filename,
          fileDate
        });
        return { operations, filename, fileDate, totalRecords: operations.length };
      }

      return { error: 'Unsupported bank format', operations: [], filename };

    } catch (error) {
      console.error(`[BANK_OPERATIONS] Error parsing ${filename}:`, error);
      return { error: error.message, operations: [], filename };
    }
  }
};
