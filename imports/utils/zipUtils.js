/**
 * ZIP Extraction Utilities
 *
 * Provides functions for extracting ZIP files, specifically designed for
 * bank file processing where ZIP files may contain subfolders.
 */

import AdmZip from 'adm-zip';
import path from 'path';
import fs from 'fs';

const LOG_PREFIX = '[ZIP_UTILS]';

/**
 * Extract a ZIP file to a specified output directory
 * @param {string} zipPath - Full path to the ZIP file
 * @param {string} outputDir - Directory to extract files to
 * @param {Object} options - Extraction options
 * @param {boolean} options.flattenSubfolders - If true, extracts files directly without preserving subfolder structure
 * @returns {Object} Result with extracted file paths
 */
export function extractZipFile(zipPath, outputDir, options = {}) {
  const { flattenSubfolders = false } = options;

  console.log(`${LOG_PREFIX} Extracting ZIP: ${zipPath}`);
  console.log(`${LOG_PREFIX} Output directory: ${outputDir}`);

  if (!fs.existsSync(zipPath)) {
    throw new Error(`ZIP file not found: ${zipPath}`);
  }

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`${LOG_PREFIX} Created output directory: ${outputDir}`);
  }

  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries();

  const extractedFiles = [];
  const skippedEntries = [];

  zipEntries.forEach(entry => {
    // Skip directories
    if (entry.isDirectory) {
      skippedEntries.push({ name: entry.entryName, reason: 'directory' });
      return;
    }

    const entryName = entry.entryName;
    let outputPath;

    if (flattenSubfolders) {
      // Extract file directly to output directory, ignoring any subfolder structure
      const fileName = path.basename(entryName);
      outputPath = path.join(outputDir, fileName);
    } else {
      // Preserve the subfolder structure
      outputPath = path.join(outputDir, entryName);
      const fileDir = path.dirname(outputPath);
      if (!fs.existsSync(fileDir)) {
        fs.mkdirSync(fileDir, { recursive: true });
      }
    }

    // Extract the file
    const content = entry.getData();
    fs.writeFileSync(outputPath, content);

    extractedFiles.push({
      originalPath: entryName,
      extractedPath: outputPath,
      fileName: path.basename(outputPath),
      size: content.length
    });

    console.log(`${LOG_PREFIX} Extracted: ${entryName} -> ${outputPath}`);
  });

  console.log(`${LOG_PREFIX} Extraction complete: ${extractedFiles.length} files extracted`);

  return {
    success: true,
    zipPath,
    outputDir,
    extractedFiles,
    skippedEntries,
    totalExtracted: extractedFiles.length
  };
}

/**
 * Extract date from Societe Generale ZIP filename
 * Format: FIMFILE_FIM_IO_AMBERLAKE_DDMMYYYY.zip
 * @param {string} filename - ZIP filename
 * @returns {Object|null} Date info or null if pattern doesn't match
 */
export function extractSGDateFromFilename(filename) {
  // Match pattern: FIMFILE_FIM_IO_AMBERLAKE_DDMMYYYY.zip
  const match = filename.match(/FIMFILE_FIM_IO_AMBERLAKE_(\d{2})(\d{2})(\d{4})\.zip$/i);

  if (!match) {
    return null;
  }

  const [, day, month, year] = match;

  return {
    day,
    month,
    year,
    dateString: `${day}${month}${year}`, // DDMMYYYY
    isoDate: `${year}-${month}-${day}`,  // YYYY-MM-DD
    folderName: `${day}${month}${year}`  // Use for folder naming
  };
}

/**
 * Check if a filename matches the Societe Generale ZIP pattern
 * @param {string} filename - Filename to check
 * @returns {boolean} True if filename matches SG pattern
 */
export function isSGZipFile(filename) {
  return /^FIMFILE_FIM_IO_AMBERLAKE_\d{8}\.zip$/i.test(filename);
}

/**
 * Extract a Societe Generale ZIP file with bank-specific handling
 * - Handles the FIM_IO_AMBERLAKE subfolder inside the ZIP
 * - Creates date-based output folder
 * - Flattens the subfolder structure
 *
 * @param {string} zipPath - Full path to the ZIP file
 * @param {string} baseOutputDir - Base directory for extraction (e.g., sg/prod/extracted)
 * @returns {Object} Extraction result
 */
export function extractSGZipFile(zipPath, baseOutputDir) {
  const filename = path.basename(zipPath);

  console.log(`${LOG_PREFIX} Processing SG ZIP file: ${filename}`);

  // Extract date from filename
  const dateInfo = extractSGDateFromFilename(filename);
  if (!dateInfo) {
    throw new Error(`Invalid SG ZIP filename format: ${filename}. Expected: FIMFILE_FIM_IO_AMBERLAKE_DDMMYYYY.zip`);
  }

  console.log(`${LOG_PREFIX} Extracted date: ${dateInfo.isoDate} (${dateInfo.folderName})`);

  // Create date-specific output folder
  const outputDir = path.join(baseOutputDir, dateInfo.folderName);

  // Extract with flattened subfolders (removes FIM_IO_AMBERLAKE subfolder)
  const result = extractZipFile(zipPath, outputDir, { flattenSubfolders: true });

  // Add SG-specific metadata
  return {
    ...result,
    bankType: 'societe-generale',
    fileDate: dateInfo.isoDate,
    folderName: dateInfo.folderName,
    gpgFiles: result.extractedFiles.filter(f => f.fileName.endsWith('.gpg')),
    otherFiles: result.extractedFiles.filter(f => !f.fileName.endsWith('.gpg'))
  };
}

/**
 * Find all SG ZIP files in a directory that need processing
 * A ZIP needs processing if:
 * 1. It's not in seenLocalFiles (never processed), OR
 * 2. It's in seenLocalFiles but its decrypted files are missing
 *
 * @param {string} folderPath - Directory to scan for ZIP files
 * @param {Set|Array} processedFiles - Set or array of already processed filenames
 * @param {string|null} decryptedPath - Path to decrypted folder (to check if files exist)
 * @returns {Array} List of ZIP files to process
 */
export function findNewSGZipFiles(folderPath, processedFiles = [], decryptedPath = null) {
  const processed = processedFiles instanceof Set ? processedFiles : new Set(processedFiles);

  if (!fs.existsSync(folderPath)) {
    console.log(`${LOG_PREFIX} Folder does not exist: ${folderPath}`);
    return [];
  }

  const allFiles = fs.readdirSync(folderPath);
  const zipFiles = allFiles.filter(f => isSGZipFile(f));

  // Filter to find ZIPs that need processing
  const newFiles = zipFiles.filter(f => {
    // Not in seenLocalFiles = definitely needs processing
    if (!processed.has(f)) {
      return true;
    }

    // In seenLocalFiles - check if decrypted files exist
    if (decryptedPath && fs.existsSync(decryptedPath)) {
      const dateInfo = extractSGDateFromFilename(f);
      if (dateInfo) {
        // Expected CSV filename: posit.YYYYMMDD.csv
        const expectedFile = `posit.${dateInfo.year}${dateInfo.month}${dateInfo.day}.csv`;
        const decryptedFilePath = path.join(decryptedPath, expectedFile);
        const decryptedExists = fs.existsSync(decryptedFilePath);

        if (!decryptedExists) {
          console.log(`${LOG_PREFIX} ZIP ${f} marked as seen but decrypted file missing (${expectedFile}) - will reprocess`);
          return true;
        }
      }
    }

    return false;
  });

  // Debug logging
  console.log(`${LOG_PREFIX} Scanning folder: ${folderPath}`);
  console.log(`${LOG_PREFIX} seenLocalFiles (${processed.size}):`, JSON.stringify([...processed]));
  console.log(`${LOG_PREFIX} All files in folder:`, JSON.stringify(allFiles));
  console.log(`${LOG_PREFIX} ZIP files matching SG pattern:`, JSON.stringify(zipFiles));
  console.log(`${LOG_PREFIX} Filtering - checking each ZIP against seenLocalFiles and decrypted folder...`);
  zipFiles.forEach(f => {
    const isSeen = processed.has(f);
    const needsReprocess = newFiles.some(nf => nf === f || (typeof nf === 'object' && nf.filename === f));
    console.log(`${LOG_PREFIX}   - ${f}: seen=${isSeen}, needsProcess=${!isSeen || needsReprocess}`);
  });
  console.log(`${LOG_PREFIX} Found ${zipFiles.length} SG ZIP files, ${newFiles.length} need processing`);

  return newFiles.map(filename => ({
    filename,
    fullPath: path.join(folderPath, filename),
    dateInfo: extractSGDateFromFilename(filename)
  }));
}
