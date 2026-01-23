import fs from 'fs';
import path from 'path';
import { JuliusBaerParser } from './parsers/juliusBaerParser.js';
import { AndbankParser } from './parsers/andbankParser.js';
import { CFMParser } from './parsers/cfmParser.js';
import { EDRMonacoParser } from './parsers/edrMonacoParser.js';
import { CMBMonacoParser } from './parsers/cmbMonacoParser.js';
import { SGMonacoParser } from './parsers/sgMonacoParser.js';

/**
 * Bank Position Parser Service
 *
 * Generic service for parsing bank-specific position files
 * and converting them to standardized schema.
 */

export const BankPositionParser = {
  /**
   * Registry of bank-specific parsers
   */
  parsers: {
    'julius-baer': JuliusBaerParser,
    'andbank': AndbankParser,
    'cfm': CFMParser,
    'edmond-de-rothschild': EDRMonacoParser,
    'cmb-monaco': CMBMonacoParser,
    'societe-generale': SGMonacoParser,
    'sg-monaco': SGMonacoParser,
    // Add more parsers here:
    // 'ubs': UBSParser,
    // 'credit-suisse': CreditSuisseParser,
  },

  /**
   * Get parser for a specific bank
   */
  getParser(bankName) {
    const key = bankName.toLowerCase().replace(/\s+/g, '-');
    return this.parsers[key];
  },

  /**
   * Find position files in a directory
   * Includes both securities position files (POTI) and cash/FX position files (POES)
   */
  findPositionFiles(directoryPath) {
    if (!fs.existsSync(directoryPath)) {
      return [];
    }

    const files = fs.readdirSync(directoryPath);

    // Try to match each file against known parser patterns
    const positionFiles = [];

    files.forEach(filename => {
      for (const [bankKey, parser] of Object.entries(this.parsers)) {
        // Check main pattern (securities positions)
        if (parser.matchesPattern(filename)) {
          const filePath = path.join(directoryPath, filename);
          const stats = fs.statSync(filePath);

          try {
            const fileDate = parser.extractFileDate(filename);

            positionFiles.push({
              filename,
              filePath,
              fileDate,
              fileSize: stats.size,
              bankParser: bankKey,
              fileType: 'securities', // Standard securities positions
              modified: stats.mtime
            });
          } catch (error) {
            console.error(`[BANK_PARSER] Error extracting date from ${filename}: ${error.message}`);
          }

          break; // File matched, no need to check other parsers
        }

        // Also check cash pattern if parser supports it (e.g., CFM POES files)
        if (parser.matchesCashPattern && parser.matchesCashPattern(filename)) {
          const filePath = path.join(directoryPath, filename);
          const stats = fs.statSync(filePath);

          try {
            const fileDate = parser.extractFileDate(filename);

            positionFiles.push({
              filename,
              filePath,
              fileDate,
              fileSize: stats.size,
              bankParser: bankKey,
              fileType: 'cash', // Cash/FX positions
              modified: stats.mtime
            });
          } catch (error) {
            console.error(`[BANK_PARSER] Error extracting date from cash file ${filename}: ${error.message}`);
          }

          break; // File matched, no need to check other parsers
        }

        // Also check FX rates pattern if parser supports it (e.g., CFM CRSC files)
        if (parser.matchesFxRatesPattern && parser.matchesFxRatesPattern(filename)) {
          const filePath = path.join(directoryPath, filename);
          const stats = fs.statSync(filePath);

          try {
            const fileDate = parser.extractFileDate(filename);

            positionFiles.push({
              filename,
              filePath,
              fileDate,
              fileSize: stats.size,
              bankParser: bankKey,
              fileType: 'fxrates', // FX exchange rates
              modified: stats.mtime
            });
          } catch (error) {
            console.error(`[BANK_PARSER] Error extracting date from FX rates file ${filename}: ${error.message}`);
          }

          break; // File matched, no need to check other parsers
        }

        // Also check prices pattern if parser supports it (e.g., SG Monaco price files)
        if (parser.matchesPricesPattern && parser.matchesPricesPattern(filename)) {
          const filePath = path.join(directoryPath, filename);
          const stats = fs.statSync(filePath);

          try {
            const fileDate = parser.extractFileDate(filename);

            positionFiles.push({
              filename,
              filePath,
              fileDate,
              fileSize: stats.size,
              bankParser: bankKey,
              fileType: 'prices', // Instrument prices
              modified: stats.mtime
            });
          } catch (error) {
            console.error(`[BANK_PARSER] Error extracting date from prices file ${filename}: ${error.message}`);
          }

          break; // File matched, no need to check other parsers
        }
      }
    });

    return positionFiles;
  },

  /**
   * Find latest position file for a bank (single file, securities only)
   */
  findLatestFile(directoryPath) {
    const files = this.findPositionFiles(directoryPath);

    if (files.length === 0) {
      return null;
    }

    // Filter to securities files only for backward compatibility
    const securitiesFiles = files.filter(f => f.fileType === 'securities');

    if (securitiesFiles.length === 0) {
      return null;
    }

    // Sort by file date descending
    securitiesFiles.sort((a, b) => b.fileDate.getTime() - a.fileDate.getTime());

    return securitiesFiles[0];
  },

  /**
   * Find all position files for the latest date (both securities and cash)
   * Returns array of files for the same date
   */
  findLatestFiles(directoryPath) {
    const files = this.findPositionFiles(directoryPath);

    if (files.length === 0) {
      return [];
    }

    // Sort by file date descending
    files.sort((a, b) => b.fileDate.getTime() - a.fileDate.getTime());

    // Get the latest date
    const latestDate = files[0].fileDate.toDateString();

    // Return all files from the latest date
    return files.filter(f => f.fileDate.toDateString() === latestDate);
  },

  /**
   * Get all unique file dates available in a directory
   * Returns sorted array of dates (oldest first for chronological processing)
   */
  getAvailableFileDates(directoryPath) {
    const files = this.findPositionFiles(directoryPath);

    if (files.length === 0) {
      return [];
    }

    // Extract unique dates using date string as key
    const dateMap = new Map();
    files.forEach(f => {
      const dateStr = f.fileDate.toISOString().split('T')[0];
      if (!dateMap.has(dateStr)) {
        dateMap.set(dateStr, f.fileDate);
      }
    });

    // Return sorted dates (oldest first for chronological processing)
    return Array.from(dateMap.values()).sort((a, b) => a.getTime() - b.getTime());
  },

  /**
   * Find all position files for a specific date
   * @param {string} directoryPath - Path to bank files directory
   * @param {Date} targetDate - Date to find files for
   * @returns {Array} - Files matching the target date
   */
  findFilesByDate(directoryPath, targetDate) {
    const files = this.findPositionFiles(directoryPath);

    if (files.length === 0) {
      return [];
    }

    // Normalize target date to YYYY-MM-DD string for comparison
    const targetDateStr = targetDate.toISOString().split('T')[0];

    // Filter files matching the target date
    return files.filter(f => {
      const fileDateStr = f.fileDate.toISOString().split('T')[0];
      return fileDateStr === targetDateStr;
    });
  },

  /**
   * Parse all files for a specific date (securities + cash + FX rates)
   * Similar to parseLatestFile but for a specific date instead of the latest
   * @param {string} directoryPath - Path to bank files directory
   * @param {Date} targetDate - Date to process files for
   * @param {object} options - Parsing options (bankId, bankName, userId)
   * @returns {object} - Parse result with positions, filename, fileDate, etc.
   */
  parseFilesForDate(directoryPath, targetDate, options = {}) {
    const filesForDate = this.findFilesByDate(directoryPath, targetDate);

    if (filesForDate.length === 0) {
      return {
        positions: [],
        filename: null,
        fileDate: targetDate,
        totalRecords: 0,
        error: `No files found for date: ${targetDate.toISOString().split('T')[0]}`
      };
    }

    // Separate file types
    const securitiesFiles = filesForDate.filter(f => f.fileType === 'securities');
    const cashFiles = filesForDate.filter(f => f.fileType === 'cash');
    const fxRatesFiles = filesForDate.filter(f => f.fileType === 'fxrates');
    const pricesFiles = filesForDate.filter(f => f.fileType === 'prices');

    console.log(`[BANK_PARSER] Files for ${targetDate.toISOString().split('T')[0]}: ${filesForDate.length} total (${securitiesFiles.length} securities, ${cashFiles.length} cash, ${fxRatesFiles.length} fxrates, ${pricesFiles.length} prices)`);

    // Parse FX rates file first if available
    let fxRates = {};
    if (fxRatesFiles.length > 0) {
      try {
        const fxFile = fxRatesFiles[0];
        const parser = this.parsers[fxFile.bankParser];
        if (parser && parser.parseFxRates) {
          const fxContent = this.readFile(fxFile.filePath);
          fxRates = parser.parseFxRates(fxContent);
          console.log(`[BANK_PARSER] Loaded ${Object.keys(fxRates).length} FX rates from ${fxFile.filename}`);
        }
      } catch (error) {
        console.error(`[BANK_PARSER] Error parsing FX rates file: ${error.message}`);
      }
    }

    // Parse prices file if available (SG Monaco provides prices in separate file)
    let prices = {};
    if (pricesFiles.length > 0) {
      try {
        const priceFile = pricesFiles[0];
        const parser = this.parsers[priceFile.bankParser];
        if (parser && parser.parsePrices) {
          const priceContent = this.readFile(priceFile.filePath);
          prices = parser.parsePrices(priceContent);
          console.log(`[BANK_PARSER] Loaded ${Object.keys(prices).length} prices from ${priceFile.filename}`);
        }
      } catch (error) {
        console.error(`[BANK_PARSER] Error parsing prices file: ${error.message}`);
      }
    }

    // Parse all files and combine positions
    let allPositions = [];
    let primaryFilename = null;
    let primaryFileDate = null;
    let primaryContent = null;
    let primaryParser = null;

    // Parse securities files first
    for (const file of securitiesFiles) {
      try {
        console.log(`[BANK_PARSER] Parsing securities file for ${targetDate.toISOString().split('T')[0]}: ${file.filename}`);
        const parser = this.parsers[file.bankParser];
        const result = this.parseFile(file.filePath, {
          ...options,
          parser,
          fileType: 'securities',
          fxRates,
          prices
        });

        allPositions = allPositions.concat(result.positions);

        // Use first securities file as primary
        if (!primaryFilename) {
          primaryFilename = result.filename;
          primaryFileDate = result.fileDate;
          primaryContent = result.content;
          primaryParser = result.parser;
        }
      } catch (error) {
        console.error(`[BANK_PARSER] Error parsing securities file ${file.filename}: ${error.message}`);
      }
    }

    // Parse cash files (with FX rates for currency conversion)
    for (const file of cashFiles) {
      try {
        console.log(`[BANK_PARSER] Parsing cash/FX file for ${targetDate.toISOString().split('T')[0]}: ${file.filename}`);
        const parser = this.parsers[file.bankParser];
        const result = this.parseFile(file.filePath, {
          ...options,
          parser,
          fileType: 'cash',
          fxRates
        });

        allPositions = allPositions.concat(result.positions);

        // If no securities file, use cash file as primary
        if (!primaryFilename) {
          primaryFilename = result.filename;
          primaryFileDate = result.fileDate;
          primaryContent = result.content;
          primaryParser = result.parser;
        }
      } catch (error) {
        console.error(`[BANK_PARSER] Error parsing cash file ${file.filename}: ${error.message}`);
      }
    }

    console.log(`[BANK_PARSER] Total positions parsed for ${targetDate.toISOString().split('T')[0]}: ${allPositions.length}`);

    return {
      positions: allPositions,
      filename: primaryFilename,
      fileDate: primaryFileDate,
      totalRecords: allPositions.length,
      content: primaryContent,
      parser: primaryParser,
      filesProcessed: filesForDate.map(f => ({ filename: f.filename, type: f.fileType }))
    };
  },

  /**
   * Read file content
   */
  readFile(filePath) {
    return fs.readFileSync(filePath, 'utf8');
  },

  /**
   * Parse a position file
   * @param {string} filePath - Path to the file
   * @param {object} options - Parsing options
   * @param {string} options.fileType - Type of file: 'securities' or 'cash'
   */
  parseFile(filePath, options = {}) {
    const {
      bankId,
      bankName,
      userId,
      parser = null,
      fileType = 'securities', // Default to securities for backward compatibility
      fxRates = {}, // FX rates for currency conversion (CFM)
      prices = {}   // Instrument prices (SG Monaco)
    } = options;

    console.log(`[BANK_PARSER] Parsing file: ${filePath} (type: ${fileType})`);

    // Read file content
    const content = this.readFile(filePath);
    const filename = path.basename(filePath);

    // Get parser (use provided parser or detect from filename)
    let bankParser = parser;
    let detectedFileType = fileType;

    if (!bankParser) {
      // Try to detect parser from filename
      for (const [bankKey, p] of Object.entries(this.parsers)) {
        if (p.matchesPattern(filename)) {
          bankParser = p;
          detectedFileType = 'securities';
          break;
        }
        // Also check cash pattern
        if (p.matchesCashPattern && p.matchesCashPattern(filename)) {
          bankParser = p;
          detectedFileType = 'cash';
          break;
        }
      }
    }

    if (!bankParser) {
      throw new Error(`No parser found for file: ${filename}`);
    }

    // Validate file based on type
    const validation = detectedFileType === 'cash' && bankParser.validateCash
      ? bankParser.validateCash(content)
      : bankParser.validate(content);

    if (!validation.valid) {
      throw new Error(`File validation failed: ${validation.error}`);
    }

    // Extract file date
    const fileDate = bankParser.extractFileDate(filename);

    // Parse file using appropriate method based on type
    const positions = detectedFileType === 'cash' && bankParser.parseCash
      ? bankParser.parseCash(content, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          userId,
          fxRates, // Pass FX rates for currency conversion
          prices   // Pass prices (SG Monaco)
        })
      : bankParser.parse(content, {
          bankId,
          bankName,
          sourceFile: filename,
          fileDate,
          userId,
          fxRates, // Pass FX rates for currency conversion (e.g., CMB Monaco)
          prices   // Pass prices (SG Monaco)
        });

    return {
      positions,
      filename,
      fileDate,
      fileType: detectedFileType,
      totalRecords: positions.length,
      content, // Include raw content for structure validation
      parser: bankParser // Include parser for delimiter info
    };
  },

  /**
   * Parse latest file from directory
   * Parses all files for the latest date (securities + cash) and combines results
   */
  parseLatestFile(directoryPath, options = {}) {
    // Check if directory exists
    if (!fs.existsSync(directoryPath)) {
      console.error(`[BANK_PARSER] Directory not found: ${directoryPath}`);
      return {
        positions: [],
        filename: null,
        fileDate: null,
        totalRecords: 0,
        error: 'Directory not found',
        errorCode: 'directory-not-found',
        errorDetails: { path: directoryPath }
      };
    }

    // List all files in directory for diagnostics
    const allFilesInDir = fs.readdirSync(directoryPath);
    const csvFilesInDir = allFilesInDir.filter(f => f.endsWith('.csv'));

    const latestFiles = this.findLatestFiles(directoryPath);

    if (latestFiles.length === 0) {
      // Provide diagnostic information about why no files matched
      const registeredParsers = Object.keys(this.parsers);

      let errorCode, errorMessage;
      if (csvFilesInDir.length === 0) {
        errorCode = 'no-csv-files';
        errorMessage = `No CSV files found in directory (${allFilesInDir.length} other files present)`;
      } else {
        errorCode = 'parser-no-match';
        errorMessage = `Found ${csvFilesInDir.length} CSV file(s) but none matched registered parser patterns`;
      }

      console.error(`[BANK_PARSER] ${errorMessage}`);
      console.error(`[BANK_PARSER] CSV files in dir: ${csvFilesInDir.slice(0, 10).join(', ')}${csvFilesInDir.length > 10 ? '...' : ''}`);
      console.error(`[BANK_PARSER] Registered parsers: ${registeredParsers.join(', ')}`);

      return {
        positions: [],
        filename: null,
        fileDate: null,
        totalRecords: 0,
        error: errorMessage,
        errorCode,
        errorDetails: {
          path: directoryPath,
          totalFiles: allFilesInDir.length,
          csvFiles: csvFilesInDir.length,
          csvFilenames: csvFilesInDir.slice(0, 5), // First 5 for debugging
          registeredParsers
        }
      };
    }

    // Separate securities, cash, FX rates, and prices files
    const securitiesFiles = latestFiles.filter(f => f.fileType === 'securities');
    const cashFiles = latestFiles.filter(f => f.fileType === 'cash');
    const fxRatesFiles = latestFiles.filter(f => f.fileType === 'fxrates');
    const pricesFiles = latestFiles.filter(f => f.fileType === 'prices');

    console.log(`[BANK_PARSER] Latest files: ${latestFiles.length} total (${securitiesFiles.length} securities, ${cashFiles.length} cash, ${fxRatesFiles.length} fxrates, ${pricesFiles.length} prices)`);

    // Parse FX rates file first if available (for CFM)
    let fxRates = {};
    if (fxRatesFiles.length > 0) {
      try {
        const fxFile = fxRatesFiles[0];
        const parser = this.parsers[fxFile.bankParser];
        if (parser && parser.parseFxRates) {
          const fxContent = this.readFile(fxFile.filePath);
          fxRates = parser.parseFxRates(fxContent);
          console.log(`[BANK_PARSER] Loaded ${Object.keys(fxRates).length} FX rates from ${fxFile.filename}`);
        }
      } catch (error) {
        console.error(`[BANK_PARSER] Error parsing FX rates file: ${error.message}`);
      }
    }

    // Parse prices file if available (SG Monaco provides prices in separate file)
    let prices = {};
    if (pricesFiles.length > 0) {
      try {
        const priceFile = pricesFiles[0];
        const parser = this.parsers[priceFile.bankParser];
        if (parser && parser.parsePrices) {
          const priceContent = this.readFile(priceFile.filePath);
          prices = parser.parsePrices(priceContent);
          console.log(`[BANK_PARSER] Loaded ${Object.keys(prices).length} prices from ${priceFile.filename}`);
        }
      } catch (error) {
        console.error(`[BANK_PARSER] Error parsing prices file: ${error.message}`);
      }
    }

    // Parse all files and combine positions
    let allPositions = [];
    let primaryFilename = null;
    let primaryFileDate = null;
    let primaryContent = null;
    let primaryParser = null;

    // Parse securities files first
    for (const file of securitiesFiles) {
      try {
        console.log(`[BANK_PARSER] Parsing securities file: ${file.filename}`);
        const parser = this.parsers[file.bankParser];
        const result = this.parseFile(file.filePath, {
          ...options,
          parser,
          fileType: 'securities',
          fxRates, // Pass FX rates for currency conversion (e.g., CMB Monaco)
          prices   // Pass prices for SG Monaco
        });

        allPositions = allPositions.concat(result.positions);

        // Use first securities file as primary
        if (!primaryFilename) {
          primaryFilename = result.filename;
          primaryFileDate = result.fileDate;
          primaryContent = result.content;
          primaryParser = result.parser;
        }
      } catch (error) {
        console.error(`[BANK_PARSER] Error parsing securities file ${file.filename}: ${error.message}`);
      }
    }

    // Parse cash files (with FX rates for currency conversion)
    for (const file of cashFiles) {
      try {
        console.log(`[BANK_PARSER] Parsing cash/FX file: ${file.filename}`);
        const parser = this.parsers[file.bankParser];
        const result = this.parseFile(file.filePath, {
          ...options,
          parser,
          fileType: 'cash',
          fxRates // Pass FX rates for currency conversion
        });

        allPositions = allPositions.concat(result.positions);

        // If no securities file, use cash file as primary
        if (!primaryFilename) {
          primaryFilename = result.filename;
          primaryFileDate = result.fileDate;
          primaryContent = result.content;
          primaryParser = result.parser;
        }
      } catch (error) {
        console.error(`[BANK_PARSER] Error parsing cash file ${file.filename}: ${error.message}`);
      }
    }

    console.log(`[BANK_PARSER] Total positions parsed: ${allPositions.length}`);

    // If no primary file was set (only FX rates files), use FX rates file date
    // This prevents null fileDate errors in downstream processing
    if (!primaryFileDate && fxRatesFiles.length > 0) {
      primaryFileDate = fxRatesFiles[0].fileDate;
      primaryFilename = fxRatesFiles[0].filename;
      console.log(`[BANK_PARSER] Using FX rates file date as primary: ${primaryFilename}`);
    }

    // Safety check: if we still have no fileDate but have files, this is an error
    if (!primaryFileDate && latestFiles.length > 0) {
      return {
        positions: [],
        filename: null,
        fileDate: null,
        totalRecords: 0,
        error: 'Failed to parse any position files - all files returned errors'
      };
    }

    return {
      positions: allPositions,
      filename: primaryFilename,
      fileDate: primaryFileDate,
      totalRecords: allPositions.length,
      content: primaryContent,
      parser: primaryParser,
      filesProcessed: latestFiles.map(f => ({ filename: f.filename, type: f.fileType }))
    };
  },

  /**
   * Get available banks (parsers)
   */
  getAvailableBanks() {
    return Object.keys(this.parsers).map(key => ({
      key,
      name: this.parsers[key].bankName,
      pattern: this.parsers[key].filenamePattern.toString()
    }));
  }
};
