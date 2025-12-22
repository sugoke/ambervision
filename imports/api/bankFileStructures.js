import { Mongo } from 'meteor/mongo';

/**
 * Collection to track bank file structures over time
 * Used to detect when banks change their CSV format
 */
export const BankFileStructuresCollection = new Mongo.Collection('bankFileStructures');

/**
 * Schema for bank file structure tracking
 */
const BankFileStructureSchema = {
  bankId: String,              // Reference to bank
  bankName: String,            // Bank name for easy reference
  fileType: String,            // 'positions' or 'operations'
  filename: String,            // Name of the file
  fileDate: Date,              // Date from the file
  processingDate: Date,        // When file was processed

  // File structure details
  structure: {
    headers: [String],         // Array of column headers
    headerCount: Number,       // Number of columns
    delimiter: String,         // CSV delimiter (';' or ',')
    encoding: String,          // File encoding
    firstDataRow: Object       // First row of data (for quick comparison)
  },

  // Metadata
  userId: String,              // Who processed the file
  version: Number              // Schema version
};

/**
 * Helper functions for bank file structure tracking
 */
export const BankFileStructureHelpers = {
  /**
   * Extract structure information from CSV content
   */
  extractStructure(csvContent, delimiter = ';') {
    const lines = csvContent.trim().split('\n');
    if (lines.length < 2) {
      return null;
    }

    const headers = lines[0].split(delimiter).map(h => h.trim());
    const firstDataRow = {};

    if (lines.length > 1) {
      const values = lines[1].split(delimiter);
      headers.forEach((header, index) => {
        firstDataRow[header] = values[index] ? values[index].trim() : '';
      });
    }

    return {
      headers,
      headerCount: headers.length,
      delimiter,
      encoding: 'utf-8',
      firstDataRow
    };
  },

  /**
   * Record file structure after parsing
   */
  async recordStructure({ bankId, bankName, fileType, filename, fileDate, csvContent, delimiter, userId }) {
    const structure = this.extractStructure(csvContent, delimiter);

    if (!structure) {
      console.log('[FILE_STRUCTURE] Could not extract structure from file');
      return null;
    }

    const record = {
      bankId,
      bankName,
      fileType,
      filename,
      fileDate,
      processingDate: new Date(),
      structure,
      userId,
      version: 1
    };

    const existingRecord = await BankFileStructuresCollection.findOneAsync({
      bankId,
      fileType,
      fileDate
    });

    if (existingRecord) {
      // Update existing record
      await BankFileStructuresCollection.updateAsync(existingRecord._id, { $set: record });
      return existingRecord._id;
    } else {
      // Insert new record
      return await BankFileStructuresCollection.insertAsync(record);
    }
  },

  /**
   * Compare current file structure with previous file structure
   * Returns warning message if structure has changed, null otherwise
   */
  async checkStructureChange({ bankId, fileType, currentStructure, currentFileDate }) {
    // Find the most recent previous file (before current date)
    const previousRecord = await BankFileStructuresCollection.findOneAsync({
      bankId,
      fileType,
      fileDate: { $lt: currentFileDate }
    }, {
      sort: { fileDate: -1 }
    });

    if (!previousRecord) {
      console.log('[FILE_STRUCTURE] No previous file found for comparison');
      return null;
    }

    const previousStructure = previousRecord.structure;
    const warnings = [];

    // Check header count
    if (currentStructure.headerCount !== previousStructure.headerCount) {
      warnings.push(
        `Column count changed: ${previousStructure.headerCount} → ${currentStructure.headerCount}`
      );
    }

    // Check header names
    const currentHeaders = currentStructure.headers.join('|');
    const previousHeaders = previousStructure.headers.join('|');

    if (currentHeaders !== previousHeaders) {
      // Find added headers
      const addedHeaders = currentStructure.headers.filter(h => !previousStructure.headers.includes(h));
      if (addedHeaders.length > 0) {
        warnings.push(`New columns: ${addedHeaders.join(', ')}`);
      }

      // Find removed headers
      const removedHeaders = previousStructure.headers.filter(h => !currentStructure.headers.includes(h));
      if (removedHeaders.length > 0) {
        warnings.push(`Removed columns: ${removedHeaders.join(', ')}`);
      }

      // Find renamed/reordered headers
      const reorderedHeaders = [];
      currentStructure.headers.forEach((header, index) => {
        if (previousStructure.headers[index] && previousStructure.headers[index] !== header) {
          reorderedHeaders.push(`Position ${index + 1}: "${previousStructure.headers[index]}" → "${header}"`);
        }
      });

      if (reorderedHeaders.length > 0 && addedHeaders.length === 0 && removedHeaders.length === 0) {
        warnings.push(`Column order changed: ${reorderedHeaders.join(', ')}`);
      }
    }

    // Check delimiter
    if (currentStructure.delimiter !== previousStructure.delimiter) {
      warnings.push(
        `Delimiter changed: "${previousStructure.delimiter}" → "${currentStructure.delimiter}"`
      );
    }

    if (warnings.length === 0) {
      return null;
    }

    const previousDateStr = previousRecord.fileDate.toISOString().split('T')[0];
    const currentDateStr = currentFileDate.toISOString().split('T')[0];

    return {
      message: `⚠️ CSV structure changed from ${previousDateStr} to ${currentDateStr}`,
      warnings,
      previousFile: previousRecord.filename,
      previousDate: previousRecord.fileDate,
      previousHeaders: previousStructure.headers,
      currentHeaders: currentStructure.headers
    };
  }
};
