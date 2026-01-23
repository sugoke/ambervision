/**
 * GPG Decryption Utilities
 *
 * Provides functions for decrypting GPG-encrypted files using the system gpg command.
 * Uses the existing GPG keyring (no key management - keys must already be imported).
 *
 * Requirements:
 * - GPG must be installed on the system
 * - Private key must already exist in the user's keyring
 * - No passphrase prompts (use pinentry-mode loopback or pre-cached passphrase)
 *
 * Production environment:
 * - User: michael
 * - Keyring: /home/michael/.gnupg/
 * - Key: Amberlake Partners SG <mf@amberlakepartners.com>
 */

import { execSync, exec } from 'child_process';
import path from 'path';
import fs from 'fs';

const LOG_PREFIX = '[GPG_UTILS]';

/**
 * Check if GPG is available on the system
 * @returns {boolean} True if gpg command is available
 */
export function isGpgAvailable() {
  try {
    execSync('gpg --version', { stdio: 'pipe' });
    return true;
  } catch (error) {
    console.error(`${LOG_PREFIX} GPG not available: ${error.message}`);
    return false;
  }
}

/**
 * Get GPG version info
 * @returns {string} GPG version string
 */
export function getGpgVersion() {
  try {
    const output = execSync('gpg --version', { encoding: 'utf-8' });
    const firstLine = output.split('\n')[0];
    return firstLine;
  } catch (error) {
    return `Error: ${error.message}`;
  }
}

/**
 * Decrypt a single GPG-encrypted file
 *
 * @param {string} inputPath - Path to the encrypted .gpg file
 * @param {string} outputPath - Path for the decrypted output file
 * @param {Object} options - Decryption options
 * @param {string} options.gnupgHome - Custom GNUPGHOME directory (optional)
 * @param {boolean} options.overwrite - Overwrite existing output file (default: false)
 * @returns {Object} Result with success status and details
 */
export function decryptGpgFile(inputPath, outputPath, options = {}) {
  const { gnupgHome, overwrite = false } = options;

  console.log(`${LOG_PREFIX} Decrypting: ${path.basename(inputPath)}`);

  // Validate input file exists
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input file not found: ${inputPath}`);
  }

  // Check if output already exists (idempotent behavior)
  if (fs.existsSync(outputPath) && !overwrite) {
    console.log(`${LOG_PREFIX} Output already exists, skipping: ${path.basename(outputPath)}`);
    return {
      success: true,
      skipped: true,
      inputPath,
      outputPath,
      message: 'Output file already exists'
    };
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`${LOG_PREFIX} Created output directory: ${outputDir}`);
  }

  // Build GPG command
  // --batch: Non-interactive mode (no prompts)
  // --yes: Assume yes to all questions (overwrite, etc.)
  // --pinentry-mode loopback: Allow passphrase from agent without GUI
  // --output: Output file path
  // --decrypt: Decrypt operation
  const gpgArgs = [
    '--batch',
    '--yes',
    '--pinentry-mode', 'loopback',
    '--output', outputPath,
    '--decrypt', inputPath
  ];

  // Add custom GNUPGHOME if specified
  let envVars = { ...process.env };
  if (gnupgHome) {
    envVars.GNUPGHOME = gnupgHome;
    console.log(`${LOG_PREFIX} Using GNUPGHOME: ${gnupgHome}`);
  }

  const command = `gpg ${gpgArgs.join(' ')}`;

  try {
    execSync(command, {
      encoding: 'utf-8',
      stdio: 'pipe',
      env: envVars
    });

    // Verify output was created
    if (!fs.existsSync(outputPath)) {
      throw new Error('Decryption completed but output file was not created');
    }

    const stats = fs.statSync(outputPath);
    console.log(`${LOG_PREFIX} Decrypted successfully: ${path.basename(outputPath)} (${stats.size} bytes)`);

    return {
      success: true,
      skipped: false,
      inputPath,
      outputPath,
      outputSize: stats.size,
      message: 'Decryption successful'
    };

  } catch (error) {
    // Parse GPG error message
    const errorMsg = error.stderr || error.message;
    console.error(`${LOG_PREFIX} Decryption failed for ${path.basename(inputPath)}: ${errorMsg}`);

    // Clean up partial output if it exists
    if (fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
      } catch (e) {
        // Ignore cleanup errors
      }
    }

    return {
      success: false,
      skipped: false,
      inputPath,
      outputPath,
      error: errorMsg,
      message: `Decryption failed: ${errorMsg}`
    };
  }
}

/**
 * Find all .gpg files recursively in a directory
 *
 * @param {string} dirPath - Directory to search
 * @returns {Array} List of full paths to .gpg files
 */
export function findGpgFiles(dirPath) {
  const gpgFiles = [];

  if (!fs.existsSync(dirPath)) {
    console.log(`${LOG_PREFIX} Directory does not exist: ${dirPath}`);
    return gpgFiles;
  }

  function scanDirectory(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        scanDirectory(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.gpg')) {
        gpgFiles.push(fullPath);
      }
    }
  }

  scanDirectory(dirPath);

  console.log(`${LOG_PREFIX} Found ${gpgFiles.length} GPG files in ${dirPath}`);
  return gpgFiles;
}

/**
 * Decrypt all GPG files in a directory to an output directory
 *
 * @param {string} inputDir - Directory containing .gpg files (searched recursively)
 * @param {string} outputDir - Directory for decrypted files
 * @param {Object} options - Decryption options
 * @param {boolean} options.preserveStructure - Preserve subdirectory structure (default: false)
 * @param {string} options.gnupgHome - Custom GNUPGHOME directory
 * @param {boolean} options.overwrite - Overwrite existing files (default: false)
 * @returns {Object} Summary of decryption results
 */
export function decryptAllGpgFiles(inputDir, outputDir, options = {}) {
  const { preserveStructure = false, gnupgHome, overwrite = false } = options;

  console.log(`${LOG_PREFIX} Starting batch decryption`);
  console.log(`${LOG_PREFIX} Input directory: ${inputDir}`);
  console.log(`${LOG_PREFIX} Output directory: ${outputDir}`);

  // Find all GPG files
  const gpgFiles = findGpgFiles(inputDir);

  if (gpgFiles.length === 0) {
    console.log(`${LOG_PREFIX} No GPG files found to decrypt`);
    return {
      success: true,
      totalFiles: 0,
      decrypted: [],
      skipped: [],
      failed: [],
      message: 'No GPG files found'
    };
  }

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`${LOG_PREFIX} Created output directory: ${outputDir}`);
  }

  const results = {
    decrypted: [],
    skipped: [],
    failed: []
  };

  for (const gpgFilePath of gpgFiles) {
    // Determine output filename (remove .gpg extension)
    const gpgFileName = path.basename(gpgFilePath);
    const decryptedFileName = gpgFileName.replace(/\.gpg$/i, '');

    let outputPath;

    if (preserveStructure) {
      // Preserve subdirectory structure
      const relativePath = path.relative(inputDir, gpgFilePath);
      const relativeDir = path.dirname(relativePath);
      const outputSubDir = path.join(outputDir, relativeDir);

      if (!fs.existsSync(outputSubDir)) {
        fs.mkdirSync(outputSubDir, { recursive: true });
      }

      outputPath = path.join(outputSubDir, decryptedFileName);
    } else {
      // Flatten to single directory
      outputPath = path.join(outputDir, decryptedFileName);
    }

    // Decrypt the file
    const result = decryptGpgFile(gpgFilePath, outputPath, { gnupgHome, overwrite });

    if (result.success) {
      if (result.skipped) {
        results.skipped.push(result);
      } else {
        results.decrypted.push(result);
      }
    } else {
      results.failed.push(result);
    }
  }

  const summary = {
    success: results.failed.length === 0,
    totalFiles: gpgFiles.length,
    decryptedCount: results.decrypted.length,
    skippedCount: results.skipped.length,
    failedCount: results.failed.length,
    decrypted: results.decrypted,
    skipped: results.skipped,
    failed: results.failed,
    message: `Processed ${gpgFiles.length} files: ${results.decrypted.length} decrypted, ${results.skipped.length} skipped, ${results.failed.length} failed`
  };

  console.log(`${LOG_PREFIX} Batch decryption complete: ${summary.message}`);

  return summary;
}

/**
 * Process a Societe Generale ZIP file completely:
 * 1. Extract ZIP to temp directory
 * 2. Find and decrypt all GPG files
 * 3. Output decrypted files to specified directory
 *
 * @param {string} zipPath - Path to the ZIP file
 * @param {string} extractedDir - Directory for extracted (encrypted) files
 * @param {string} decryptedDir - Directory for decrypted files
 * @param {Object} options - Processing options
 * @returns {Object} Processing result
 */
export async function processSGZipFile(zipPath, extractedDir, decryptedDir, options = {}) {
  const { gnupgHome } = options;
  const filename = path.basename(zipPath);

  console.log(`${LOG_PREFIX} Processing SG file: ${filename}`);
  console.log(`${LOG_PREFIX} Extract to: ${extractedDir}`);
  console.log(`${LOG_PREFIX} Decrypt to: ${decryptedDir}`);

  // Import extractSGZipFile dynamically to avoid circular dependency
  const { extractSGZipFile } = await import('./zipUtils.js');

  // Step 1: Extract ZIP
  console.log(`${LOG_PREFIX} Step 1: Extracting ZIP...`);
  const extractResult = extractSGZipFile(zipPath, extractedDir);

  if (!extractResult.success) {
    return {
      success: false,
      step: 'extraction',
      error: 'ZIP extraction failed',
      extractResult
    };
  }

  console.log(`${LOG_PREFIX} Extracted ${extractResult.totalExtracted} files`);

  // Step 2: Decrypt GPG files
  console.log(`${LOG_PREFIX} Step 2: Decrypting GPG files...`);

  // The extracted files are in a date-based subfolder
  const extractedSubDir = path.join(extractedDir, extractResult.folderName);

  const decryptResult = decryptAllGpgFiles(extractedSubDir, decryptedDir, {
    gnupgHome,
    preserveStructure: false, // Flatten to single directory
    overwrite: false // Idempotent - skip existing files
  });

  return {
    success: decryptResult.success,
    zipFile: filename,
    fileDate: extractResult.fileDate,
    extraction: {
      totalExtracted: extractResult.totalExtracted,
      gpgFiles: extractResult.gpgFiles.length,
      otherFiles: extractResult.otherFiles.length,
      extractedDir: extractedSubDir
    },
    decryption: {
      totalProcessed: decryptResult.totalFiles,
      decrypted: decryptResult.decryptedCount,
      skipped: decryptResult.skippedCount,
      failed: decryptResult.failedCount,
      decryptedDir: decryptedDir
    },
    decryptedFiles: decryptResult.decrypted.map(d => d.outputPath),
    failedFiles: decryptResult.failed,
    message: `Processed ${filename}: ${decryptResult.decryptedCount} files decrypted`
  };
}
