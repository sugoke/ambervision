import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { BankConnectionsCollection, BankConnectionHelpers } from '../../imports/api/bankConnections.js';
import { BankConnectionLogHelpers } from '../../imports/api/bankConnectionLogs.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { SessionsCollection, SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { isSystemSession } from '../systemAuth.js';
import { PMSHoldingsHelpers, PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { PMSOperationsHelpers, PMSOperationsCollection } from '../../imports/api/pmsOperations.js';
import { PortfolioSnapshotHelpers, PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { BankPositionParser } from '../../imports/api/bankPositionParser.js';
import { BankOperationParser } from '../../imports/api/bankOperationParser.js';
import { BankFileStructureHelpers } from '../../imports/api/bankFileStructures.js';
import { CFMParser } from '../../imports/api/parsers/cfmParser.js';
import { EDRMonacoParser } from '../../imports/api/parsers/edrMonacoParser.js';
import { NotificationHelpers } from '../../imports/api/notifications.js';
import { AccountProfilesCollection, aggregateToFourCategories } from '../../imports/api/accountProfiles.js';
import { SecuritiesMetadataCollection } from '../../imports/api/securitiesMetadata.js';
import { CurrencyRateCacheCollection } from '../../imports/api/currencyCache.js';
import { checkNegativeCash, buildRatesMap } from '../../imports/api/helpers/cashCalculator.js';
import { SecurityResolver } from '../../imports/api/helpers/securityResolver.js';
import { isValidSecurityType } from '../../imports/api/constants/instrumentTypes.js';
import { findNewSGZipFiles, extractSGZipFile } from '../../imports/utils/zipUtils.js';
import { decryptAllGpgFiles, isGpgAvailable } from '../../imports/utils/gpgUtils.js';
import { yieldToEventLoop } from '../../imports/utils/asyncHelpers.js';
import { buildPortfolioEntityMap, getEntityIdFromMap } from '../../imports/utils/entityResolver.js';
import { ClientEntityHelpers } from '../../imports/api/clientEntities.js';
import path from 'path';
import fs from 'fs';

/**
 * Check if ISIN needs re-enrichment from AmbervisionDB
 * Returns cached enrichment data if still valid, null if needs fresh lookup
 *
 * Optimization: Avoids redundant ProductsCollection queries when:
 * 1. Position was already enriched previously
 * 2. Source product hasn't been modified since last enrichment
 *
 * @param {string} isin - The ISIN to check
 * @param {Map} enrichmentCache - In-memory cache for current file processing
 * @returns {Object|null} Cached enrichment data or null if fresh lookup needed
 */
async function getCachedEnrichment(isin, enrichmentCache) {
  // Check in-memory cache first (same file processing - most efficient)
  if (enrichmentCache.has(isin)) {
    return enrichmentCache.get(isin);
  }

  // Check existing PMSHolding for this ISIN to see if already enriched
  const existingHolding = await PMSHoldingsCollection.findOneAsync({
    isin: isin,
    'bankSpecificData.autoEnriched': true
  }, {
    fields: {
      securityName: 1,
      assetClass: 1,
      structuredProductUnderlyingType: 1,
      structuredProductProtectionType: 1,
      bankSpecificData: 1
    },
    sort: { 'bankSpecificData.enrichedAt': -1 }
  });

  if (!existingHolding?.bankSpecificData?.autoEnriched) {
    return null; // Never enriched, needs fresh lookup
  }

  // Check if source product was updated after last enrichment
  const { ProductsCollection } = await import('../../imports/api/products.js');
  const sourceProduct = await ProductsCollection.findOneAsync(
    { isin: isin.toUpperCase() },
    { fields: { updatedAt: 1, title: 1 } }
  );

  if (!sourceProduct) {
    return null; // Product no longer exists in AmbervisionDB
  }

  const enrichedAt = existingHolding.bankSpecificData.enrichedAt;
  const productUpdatedAt = sourceProduct.updatedAt;

  // Re-enrich if product was updated after last enrichment
  if (productUpdatedAt && enrichedAt < productUpdatedAt) {
    console.log(`[BANK_POSITIONS] Re-enriching ${isin}: product updated since last enrichment`);
    return null;
  }

  // Return cached enrichment data - product hasn't changed
  return {
    source: 'cached',
    data: {
      securityName: existingHolding.bankSpecificData.ambervisionTitle || existingHolding.securityName,
      assetClass: existingHolding.assetClass || 'structured_product',
      structuredProductUnderlyingType: existingHolding.structuredProductUnderlyingType,
      structuredProductProtectionType: existingHolding.structuredProductProtectionType,
      productType: existingHolding.bankSpecificData.productType,
      issuer: existingHolding.bankSpecificData.issuer,
      capitalGuaranteed100: existingHolding.bankSpecificData.capitalGuaranteed100,
      capitalGuaranteedPartial: existingHolding.bankSpecificData.capitalGuaranteedPartial,
      barrierProtected: existingHolding.bankSpecificData.barrierProtected
    }
  };
}

/**
 * Validate session and ensure user is admin
 */
async function validateAdminSession(sessionId) {
  // Allow trusted in-process (cron) calls via the boot-generated system token.
  // The old hardcoded 'system-cron'/'system' strings let any client pass them
  // as a sessionId to gain superadmin — the token cannot be guessed from a browser.
  if (isSystemSession(sessionId)) {
    return { _id: 'system', username: 'system-cron', role: 'superadmin' };
  }

  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionHelpers.findByToken(sessionId);

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  if (user.role !== 'admin' && user.role !== 'superadmin') {
    throw new Meteor.Error('not-authorized', 'Admin access required');
  }

  return user;
}

/**
 * Find userId for a portfolio code by matching to bank accounts
 * @param {string} portfolioCode - Portfolio code from PMS file
 * @param {string} bankId - Bank ID
 * @returns {string|null} - userId if found, null otherwise
 */
async function findUserIdForPortfolioCode(portfolioCode, bankId) {
  if (!portfolioCode || !bankId) {
    return null;
  }

  // Normalize portfolio code: strip "-N" suffix that Julius Baer adds in PORTFOLIO column
  // Examples: "5040217-1" → "5040217", "5040241-1" → "5040241"
  // This is needed because operations files use PORTFOLIO column (with suffix),
  // but positions files use THIRD_CODE column (without suffix)
  const normalizedCode = portfolioCode.split('-')[0];

  const bankAccount = await BankAccountsCollection.findOneAsync({
    accountNumber: normalizedCode,
    bankId: bankId,
    isActive: true
  });

  return bankAccount ? bankAccount.userId : null;
}

/**
 * Build portfolio code to userId mapping for a bank (single DB query)
 * Replaces N individual queries with 1 bulk query + in-memory lookups
 * @param {string} bankId - Bank ID
 * @returns {Map<string, string>} - Map of portfolioCode → userId
 */
// DEPRECATED: Use buildPortfolioEntityMap from entityResolver.js instead.
// Kept for backward compatibility — returns userId-only map for accounts that have userId.
async function buildPortfolioUserMap(bankId) {
  const bankAccounts = await BankAccountsCollection.find({
    bankId: bankId,
    isActive: true
  }).fetchAsync();

  const map = new Map();
  for (const account of bankAccounts) {
    if (account.accountNumber && account.userId) {
      map.set(account.accountNumber, account.userId);
    }
  }
  return map;
}

/**
 * DEPRECATED: Use getEntityIdFromMap from entityResolver.js instead.
 */
function getUserIdFromMap(portfolioCode, portfolioUserMap) {
  if (!portfolioCode) return null;
  // Normalize: strip "-N" suffix (e.g., "5040217-1" → "5040217")
  const normalizedCode = portfolioCode.split('-')[0];
  return portfolioUserMap.get(normalizedCode) || null;
}

/**
 * Record what a bank file actually wrote for one (portfolio, snapshot day), so
 * PMSHoldingsHelpers.reconcileSnapshotKeys() can retire records that describe the
 * same positions under an outdated uniqueKey.
 *
 * IMPORTANT: uses the uniqueKey returned by upsertHolding() — the key genuinely
 * written — never a recomputed one. A recomputed key that differed by even one
 * input would make the reconciler treat the row it just wrote as stale.
 */
function trackWrittenSnapshot(writtenSnapshots, position, writtenUniqueKey) {
  if (!writtenSnapshots || !position?.portfolioCode || !writtenUniqueKey) return;

  const snapshotDate = position.dataDate || position.fileDate;
  if (!snapshotDate) return;

  const day = new Date(snapshotDate);
  if (Number.isNaN(day.getTime())) return;

  const dayStamp = day.toISOString().split('T')[0];
  const mapKey = `${position.portfolioCode}|${dayStamp}`;

  let entry = writtenSnapshots.get(mapKey);
  if (!entry) {
    entry = {
      portfolioCode: position.portfolioCode,
      snapshotDate: day,
      keys: new Set(),
      identities: new Set(),
      values: new Map()
    };
    writtenSnapshots.set(mapKey, entry);
  }

  entry.keys.add(writtenUniqueKey);
  const identity = PMSHoldingsHelpers.positionIdentity(position);
  if (identity) {
    entry.identities.add(identity);
    // Values let the reconciler verify a candidate really is the same position
    // written twice, rather than a different position sharing this identity
    entry.values.set(identity, {
      quantity: position.quantity,
      marketValue: position.marketValue
    });
  }
}

// How far back pms.getDayVariation looks for a portfolio's previous valuation.
// Wide enough to step over a long bank holiday, narrow enough to keep the
// aggregation on an index.
const DAY_VARIATION_LOOKBACK_DAYS = 30;

Meteor.methods({
  /**
   * Backfill CFM FX-forward holdings with their forward value date by joining
   * to FX_TRADE pmsOperations on portfolioCode + |amount|. Idempotent; safe to
   * re-run after each CFM import. Optionally scope by bankId/portfolioCode.
   */
  async 'pmsHoldings.backfillCfmFxForwardDates'({ sessionId, bankId = null, portfolioCode = null } = {}) {
    check(sessionId, String);
    check(bankId, Match.Maybe(String));
    check(portfolioCode, Match.Maybe(String));
    await validateAdminSession(sessionId);
    return await CFMParser.enrichFxForwardValueDates({
      PMSHoldingsCollection,
      PMSOperationsCollection,
      bankId: bankId || undefined,
      portfolioCode: portfolioCode || undefined
    });
  },

  /**
   * Process latest position file for a bank connection
   */
  async 'bankPositions.processLatest'({ connectionId, sessionId, forceReprocess = false }) {
    check(connectionId, String);
    check(sessionId, String);
    check(forceReprocess, Match.Maybe(Boolean));
    this.unblock();

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Get connection
    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    // Get bank details
    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    console.log(`[BANK_POSITIONS] Processing latest positions for: ${connection.connectionName}`);

    // Log processing start
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName,
      action: 'process_positions',
      status: 'started',
      message: `Position processing started by ${user.username}`,
      userId: user._id
    });

    try {
      // Build path to bank files directory
      // Use environment variable for persistent storage, fallback to process.cwd()
      const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');

      let bankFolderPath;
      if (connection.connectionType === 'local' && connection.localFolderName) {
        // For local connections, use the configured folder path
        bankFolderPath = path.join(bankfilesRoot, connection.localFolderName);

        // Special handling for Societe Generale: full pipeline (ZIP extract + GPG decrypt + parse)
        const isSocieteGenerale = bank.name?.toLowerCase().includes('société générale') ||
                                   bank.name?.toLowerCase().includes('societe generale') ||
                                   bank.name?.toLowerCase().includes('sg monaco') ||
                                   connection.localFolderName?.includes('sg/');

        if (isSocieteGenerale) {
          console.log(`[BANK_POSITIONS] SG detected - running full pipeline: extract → decrypt → parse`);

          const incomingPath = path.join(bankfilesRoot, connection.localFolderName);
          const baseDir = path.dirname(connection.localFolderName); // sg/prod
          const decryptedPath = path.join(bankfilesRoot, baseDir, 'decrypted');
          const tempExtractPath = path.join(bankfilesRoot, baseDir, 'temp_extract');

          // Track SG pipeline steps for error diagnostics
          const sgPipelineResult = {
            step: 'zip-scan',
            zipFilesFound: 0,
            zipFilesProcessed: 0,
            gpgFilesFound: 0,
            gpgFilesDecrypted: 0,
            gpgFilesSkipped: 0,
            csvFilesInDecrypted: 0,
            error: null,
            errorCode: null
          };

          // Step 1: Check for new ZIP files to process
          const seenLocalFiles = connection.seenLocalFiles || [];

          // Debug logging
          console.log(`[BANK_POSITIONS] SG: incomingPath = ${incomingPath}`);
          console.log(`[BANK_POSITIONS] SG: Path exists: ${fs.existsSync(incomingPath)}`);
          console.log(`[BANK_POSITIONS] SG: seenLocalFiles (${seenLocalFiles.length}):`, JSON.stringify(seenLocalFiles));

          // Check if incoming folder exists
          if (!fs.existsSync(incomingPath)) {
            sgPipelineResult.errorCode = 'incoming-folder-missing';
            sgPipelineResult.error = `Incoming folder does not exist: ${incomingPath}`;
            await BankConnectionsCollection.updateAsync(connectionId, {
              $set: { status: 'error', lastError: sgPipelineResult.error }
            });
            throw new Meteor.Error(sgPipelineResult.errorCode, sgPipelineResult.error);
          }

          const allFilesInDir = fs.readdirSync(incomingPath);
          console.log(`[BANK_POSITIONS] SG: All files in incoming dir:`, JSON.stringify(allFilesInDir));

          if (allFilesInDir.length === 0) {
            sgPipelineResult.errorCode = 'incoming-folder-empty';
            sgPipelineResult.error = 'Incoming folder exists but contains no files';
            await BankConnectionsCollection.updateAsync(connectionId, {
              $set: { status: 'error', lastError: sgPipelineResult.error }
            });
            throw new Meteor.Error(sgPipelineResult.errorCode, sgPipelineResult.error);
          }

          const newZipFiles = findNewSGZipFiles(incomingPath, seenLocalFiles, decryptedPath);
          sgPipelineResult.zipFilesFound = newZipFiles.length;

          if (newZipFiles.length > 0) {
            console.log(`[BANK_POSITIONS] SG: Found ${newZipFiles.length} new ZIP file(s) to process`);

            // Check GPG availability
            sgPipelineResult.step = 'gpg-check';
            if (!isGpgAvailable()) {
              sgPipelineResult.errorCode = 'gpg-not-available';
              sgPipelineResult.error = 'GPG is required to process Societe Generale files but is not available';
              await BankConnectionsCollection.updateAsync(connectionId, {
                $set: { status: 'error', lastError: sgPipelineResult.error }
              });
              throw new Meteor.Error(sgPipelineResult.errorCode, sgPipelineResult.error);
            }

            // Ensure decrypted folder exists
            if (!fs.existsSync(decryptedPath)) {
              fs.mkdirSync(decryptedPath, { recursive: true });
            }

            const processedZips = [];
            const failedZips = [];

            // Process each new ZIP
            sgPipelineResult.step = 'zip-extract';
            for (const zipInfo of newZipFiles) {
              try {
                console.log(`[BANK_POSITIONS] SG: Processing ZIP: ${zipInfo.filename}`);

                // Extract to temp
                const extractResult = extractSGZipFile(zipInfo.fullPath, tempExtractPath);
                console.log(`[BANK_POSITIONS] SG: Extracted ${extractResult.totalExtracted} files (${extractResult.gpgFiles.length} GPG)`);
                sgPipelineResult.gpgFilesFound += extractResult.gpgFiles.length;

                // Decrypt GPG files to decrypted folder
                if (extractResult.gpgFiles.length > 0) {
                  sgPipelineResult.step = 'gpg-decrypt';
                  const extractedSubDir = path.join(tempExtractPath, extractResult.folderName);
                  const decryptResult = decryptAllGpgFiles(extractedSubDir, decryptedPath, {
                    preserveStructure: false,
                    overwrite: false
                  });
                  console.log(`[BANK_POSITIONS] SG: Decrypted ${decryptResult.decryptedCount} files, skipped ${decryptResult.skippedCount}, failed ${decryptResult.failedCount || 0}`);
                  sgPipelineResult.gpgFilesDecrypted += decryptResult.decryptedCount;
                  sgPipelineResult.gpgFilesSkipped += decryptResult.skippedCount || 0;

                  // Check for decryption failures
                  if (decryptResult.failedCount > 0) {
                    console.warn(`[BANK_POSITIONS] SG: ${decryptResult.failedCount} GPG files failed to decrypt`);
                  }

                  // Clean up temp
                  if (fs.existsSync(extractedSubDir)) {
                    fs.rmSync(extractedSubDir, { recursive: true, force: true });
                  }
                }

                processedZips.push(zipInfo.filename);
                sgPipelineResult.zipFilesProcessed++;
              } catch (zipErr) {
                console.error(`[BANK_POSITIONS] SG: Failed to process ${zipInfo.filename}: ${zipErr.message}`);
                failedZips.push({ filename: zipInfo.filename, error: zipErr.message });
              }
            }

            // If ALL ZIPs failed to process, throw error
            if (processedZips.length === 0 && failedZips.length > 0) {
              sgPipelineResult.errorCode = 'zip-extraction-failed';
              sgPipelineResult.error = `All ZIP files failed to process: ${failedZips.map(f => f.filename).join(', ')}`;
              await BankConnectionsCollection.updateAsync(connectionId, {
                $set: { status: 'error', lastError: sgPipelineResult.error }
              });
              throw new Meteor.Error(sgPipelineResult.errorCode, sgPipelineResult.error);
            }

            // If GPG decryption yielded no files (and none were skipped because they already exist)
            if (sgPipelineResult.gpgFilesFound > 0 && sgPipelineResult.gpgFilesDecrypted === 0 && sgPipelineResult.gpgFilesSkipped === 0) {
              sgPipelineResult.errorCode = 'gpg-decryption-failed';
              sgPipelineResult.error = `GPG decryption failed for all ${sgPipelineResult.gpgFilesFound} encrypted files`;
              await BankConnectionsCollection.updateAsync(connectionId, {
                $set: { status: 'error', lastError: sgPipelineResult.error }
              });
              throw new Meteor.Error(sgPipelineResult.errorCode, sgPipelineResult.error);
            }

            // Log success when files were skipped (already decrypted previously)
            if (sgPipelineResult.gpgFilesSkipped > 0 && sgPipelineResult.gpgFilesDecrypted === 0) {
              console.log(`[BANK_POSITIONS] SG: All ${sgPipelineResult.gpgFilesSkipped} GPG files already decrypted - using existing CSV files`);
            }

            // Update seenLocalFiles
            if (processedZips.length > 0) {
              await BankConnectionsCollection.updateAsync(connectionId, {
                $set: { seenLocalFiles: [...seenLocalFiles, ...processedZips] }
              });
            }

            // Clean up temp folder if empty
            try {
              if (fs.existsSync(tempExtractPath) && fs.readdirSync(tempExtractPath).length === 0) {
                fs.rmdirSync(tempExtractPath);
              }
            } catch (e) { /* ignore */ }
          } else {
            console.log(`[BANK_POSITIONS] SG: No new ZIP files to process`);
          }

          // Verify decrypted folder has CSV files before parsing
          sgPipelineResult.step = 'verify-csv';
          if (fs.existsSync(decryptedPath)) {
            const decryptedFiles = fs.readdirSync(decryptedPath);
            sgPipelineResult.csvFilesInDecrypted = decryptedFiles.filter(f => f.endsWith('.csv')).length;
            console.log(`[BANK_POSITIONS] SG: Found ${sgPipelineResult.csvFilesInDecrypted} CSV files in decrypted folder`);
            console.log(`[BANK_POSITIONS] SG: Decrypted files:`, JSON.stringify(decryptedFiles));

            if (sgPipelineResult.csvFilesInDecrypted === 0) {
              sgPipelineResult.errorCode = 'no-csv-after-decrypt';
              sgPipelineResult.error = `No CSV files found in decrypted folder (${decryptedFiles.length} other files present)`;
              await BankConnectionsCollection.updateAsync(connectionId, {
                $set: { status: 'error', lastError: sgPipelineResult.error }
              });
              throw new Meteor.Error(sgPipelineResult.errorCode, sgPipelineResult.error);
            }
          } else {
            sgPipelineResult.errorCode = 'decrypted-folder-missing';
            sgPipelineResult.error = 'Decrypted folder does not exist';
            await BankConnectionsCollection.updateAsync(connectionId, {
              $set: { status: 'error', lastError: sgPipelineResult.error }
            });
            throw new Meteor.Error(sgPipelineResult.errorCode, sgPipelineResult.error);
          }

          // Now parse from decrypted folder
          bankFolderPath = decryptedPath;
          console.log(`[BANK_POSITIONS] SG: Parsing from decrypted folder: ${bankFolderPath}`);
          console.log(`[BANK_POSITIONS] SG Pipeline Result:`, JSON.stringify(sgPipelineResult));
        }
      } else {
        // For SFTP connections, use sanitized bank name
        const sanitizedBankName = bank.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        bankFolderPath = path.join(bankfilesRoot, sanitizedBankName);
      }

      console.log(`[BANK_POSITIONS] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[BANK_POSITIONS] Current working directory: ${process.cwd()}`);
      console.log(`[BANK_POSITIONS] Scanning directory: ${bankFolderPath}`);

      // Check if directory exists
      if (!fs.existsSync(bankFolderPath)) {
        console.error(`[BANK_POSITIONS] Directory does not exist: ${bankFolderPath}`);
        throw new Meteor.Error('directory-not-found', `Bank files directory not found: ${bankFolderPath}`);
      }

      // Parse latest file (without userId - will be matched later)
      const parseResult = BankPositionParser.parseLatestFile(bankFolderPath, {
        bankId: connection.bankId,
        bankName: bank.name,
        userId: null  // Will be matched to bank accounts
      });

      if (parseResult.error) {
        throw new Meteor.Error('no-files', parseResult.error);
      }

      const { positions, filename, fileDate, totalRecords, content, parser } = parseResult;

      console.log(`[BANK_POSITIONS] Parsed ${totalRecords} positions from ${filename}`);

      // Force reprocess: Delete existing records for this date before inserting new ones
      if (forceReprocess && fileDate) {
        console.log(`[BANK_POSITIONS] Force reprocess enabled - deleting existing records for ${fileDate.toISOString().split('T')[0]}`);
        const deleteResult = await PMSHoldingsCollection.removeAsync({
          bankId: connection.bankId,
          snapshotDate: fileDate
        });
        console.log(`[BANK_POSITIONS] Force reprocess: Deleted ${deleteResult} records for bankId=${connection.bankId}, date=${fileDate.toISOString().split('T')[0]}`);
      }

      // Check for CSV structure changes
      if (content && parser) {
        try {
          // Extract current file structure
          const delimiter = parser.filenamePattern ? ';' : ','; // Julius Baer uses semicolon
          const currentStructure = BankFileStructureHelpers.extractStructure(content, delimiter);

          if (currentStructure) {
            // Check for structure changes compared to previous file
            const structureChange = await BankFileStructureHelpers.checkStructureChange({
              bankId: connection.bankId,
              fileType: 'positions',
              currentStructure,
              currentFileDate: fileDate
            });

            if (structureChange) {
              // Create warning notification for admins
              console.warn(`[FILE_STRUCTURE] ${structureChange.message}`);
              console.warn(`[FILE_STRUCTURE] Warnings: ${structureChange.warnings.join(', ')}`);

              await NotificationHelpers.create({
                userId: user._id,
                type: 'warning',
                title: 'Bank File Structure Changed',
                message: `${bank.name}: ${structureChange.message}\n\nChanges detected:\n${structureChange.warnings.map(w => `• ${w}`).join('\n')}`,
                metadata: {
                  bankId: connection.bankId,
                  bankName: bank.name,
                  fileType: 'positions',
                  currentFile: filename,
                  previousFile: structureChange.previousFile,
                  warnings: structureChange.warnings,
                  currentHeaders: structureChange.currentHeaders,
                  previousHeaders: structureChange.previousHeaders
                }
              });
            }

            // Record current file structure for future comparisons
            await BankFileStructureHelpers.recordStructure({
              bankId: connection.bankId,
              bankName: bank.name,
              fileType: 'positions',
              filename,
              fileDate,
              csvContent: content,
              delimiter,
              userId: user._id
            });
          }
        } catch (structureError) {
          console.error(`[FILE_STRUCTURE] Error checking structure: ${structureError.message}`);
          // Don't fail processing if structure check fails
        }
      }

      // Save positions to database with automatic account matching
      let newRecords = 0;
      let updatedRecords = 0;
      let unchangedRecords = 0;
      let skippedRecords = 0;
      let unmappedPositions = 0;
      const errors = [];
      const unmappedPortfolioCodes = new Set();
      const processedUniqueKeys = new Set(); // Track uniqueKeys for sold position detection
      const processedPortfolioCodes = new Set(); // Track portfolios we processed for cleanup
      // Track what we wrote per (portfolio, snapshot day) for stale-uniqueKey reconciliation
      const writtenSnapshots = new Map();

      // Log all unique portfolio codes found in positions file for debugging
      const allPosPortfolioCodes = [...new Set(positions.map(pos => pos.portfolioCode))];
      console.log(`[BANK_POSITIONS] Found ${allPosPortfolioCodes.length} unique portfolio codes in positions file: ${allPosPortfolioCodes.join(', ')}`);

      // Build portfolio → entity/user map (single DB query, returns entityId + userId for each account)
      const portfolioEntityMap = await buildPortfolioEntityMap(connection.bankId);
      console.log(`[BANK_POSITIONS] Built portfolio map with ${portfolioEntityMap.size} accounts for bankId=${connection.bankId}`);

      // NOTE: Pre-processing cleanup was REMOVED to prevent isLatest flag corruption.
      // The upsertHolding() function in pmsHoldings.js handles per-uniqueKey versioning correctly:
      // - It marks old versions of THAT specific uniqueKey as isLatest=false
      // - It inserts new version with isLatest=true
      // This is atomic per-holding and cannot leave orphaned records if processing is interrupted.

      // In-memory cache for enrichment during this file's processing
      // Avoids redundant lookups when same ISIN appears multiple times in file
      const enrichmentCache = new Map();

      for (let i = 0; i < positions.length; i++) {
        await yieldToEventLoop(i, 25);
        const position = positions[i];
        try {
          // Match portfolio code to bank account (entity-primary, userId fallback)
          const accountMapping = getEntityIdFromMap(position.portfolioCode, portfolioEntityMap);

          if (!accountMapping.entityId && !accountMapping.userId) {
            // Skip positions without matching bank account
            unmappedPortfolioCodes.add(position.portfolioCode);
            unmappedPositions++;
            skippedRecords++;
            continue;
          }

          // Set entityId (primary) and userId (optional, for backward compat)
          if (accountMapping.entityId) {
            position.entityId = accountMapping.entityId;
          }
          if (accountMapping.userId) {
            position.userId = accountMapping.userId;
          }

          // Add connection ID and source file path
          position.connectionId = connectionId;
          position.sourceFilePath = path.join(bankFolderPath, filename);

          // Auto-enrich with internal product data if ISIN matches
          if (position.isin) {
            try {
              // Check cached enrichment first (avoids redundant DB queries)
              let productInfo = await getCachedEnrichment(position.isin, enrichmentCache);

              if (!productInfo) {
                // Fresh lookup needed - either never enriched or product was updated
                const { ISINClassifierHelpers } = await import('../../imports/api/isinClassifier.js');
                productInfo = await ISINClassifierHelpers.extractProductClassification(position.isin);

                // Cache for other positions in same file
                if (productInfo) {
                  enrichmentCache.set(position.isin, productInfo);
                }
              }

              if (productInfo && (productInfo.source === 'internal_product' || productInfo.source === 'cached')) {
                if (productInfo.source === 'cached') {
                  console.log(`[BANK_POSITIONS] Using cached enrichment for ${position.isin}: ${productInfo.data.securityName}`);
                } else {
                  console.log(`[BANK_POSITIONS] Auto-enriching ${position.isin} from internal product DB: ${productInfo.data.securityName}`);
                }

                // ALWAYS override with Ambervision product title for internal products
                // Bank-provided names are generic; Ambervision titles are our official product names
                position.securityName = productInfo.data.securityName;

                // Set assetClass from Ambervision classification
                position.assetClass = productInfo.data.assetClass || 'structured_product';

                // CRITICAL: Also set securityType from assetClass if not already set
                // This prevents raw bank codes (e.g., "19", "13") from being stored
                if (!position.securityType || !isValidSecurityType(position.securityType)) {
                  const { getSecurityTypeFromAssetClass } = await import('../../imports/api/constants/instrumentTypes.js');
                  position.securityType = getSecurityTypeFromAssetClass(position.assetClass);
                  console.log(`[BANK_POSITIONS] Set securityType from assetClass: ${position.assetClass} -> ${position.securityType}`);
                }

                // Set structured product classification fields directly on position for easy access
                position.structuredProductUnderlyingType = productInfo.data.structuredProductUnderlyingType;
                position.structuredProductProtectionType = productInfo.data.structuredProductProtectionType;

                // Store product metadata in bankSpecificData
                position.bankSpecificData = position.bankSpecificData || {};
                position.bankSpecificData.productType = productInfo.data.productType;
                position.bankSpecificData.issuer = productInfo.data.issuer;
                position.bankSpecificData.structuredProductUnderlyingType = productInfo.data.structuredProductUnderlyingType;
                position.bankSpecificData.structuredProductProtectionType = productInfo.data.structuredProductProtectionType;
                position.bankSpecificData.capitalGuaranteed100 = productInfo.data.capitalGuaranteed100;
                position.bankSpecificData.capitalGuaranteedPartial = productInfo.data.capitalGuaranteedPartial;
                position.bankSpecificData.barrierProtected = productInfo.data.barrierProtected;
                position.bankSpecificData.autoEnriched = true;
                position.bankSpecificData.enrichedAt = new Date();
                position.bankSpecificData.ambervisionTitle = productInfo.data.securityName;

                // AUTO-ALLOCATION: Create allocation if it doesn't exist
                try {
                  const { AllocationsCollection, AllocationHelpers } = await import('../../imports/api/allocations.js');
                  const { ProductsCollection } = await import('../../imports/api/products.js');

                  // Get the product
                  const matchedProduct = await ProductsCollection.findOneAsync({ isin: position.isin });

                  if (matchedProduct && userId) {
                    // Check if allocation already exists for this user/product
                    const existingAllocation = await AllocationsCollection.findOneAsync({
                      productId: matchedProduct._id,
                      clientId: userId
                    });

                    if (!existingAllocation) {
                      // Auto-create allocation
                      const allocationData = {
                        productId: matchedProduct._id,
                        clientId: userId,
                        bankAccountId: bankAccount._id,
                        nominalInvested: position.marketValue || 0,
                        purchasePrice: position.costPrice || 100, // Use cost price from bank
                        quantity: position.quantity || 0,
                        allocatedAt: new Date(),
                        allocatedBy: 'system',
                        status: 'active',
                        source: 'bank_auto',
                        autoAllocatedAt: new Date(),
                        autoAllocatedFromFile: filename,
                        lastSeenInBankFile: fileDate,
                        confirmedByAdmin: false,
                        notes: `Auto-allocated from bank file: ${filename}`,
                        isin: position.isin
                      };

                      const allocationId = await AllocationsCollection.insertAsync(allocationData);
                      console.log(`[AUTO_ALLOCATION] Created allocation ${allocationId} for ${position.isin} → user ${userId}`);
                    } else {
                      // Update last seen date
                      await AllocationHelpers.updateLastSeen(existingAllocation._id, fileDate);

                      // Update status if needed (reactivate if was redeemed but now appears again)
                      if (existingAllocation.status === 'redeemed') {
                        await AllocationsCollection.updateAsync(existingAllocation._id, {
                          $set: {
                            status: 'active',
                            lastSeenInBankFile: fileDate,
                            notes: `${existingAllocation.notes || ''} | Reappeared in bank file ${filename} on ${fileDate}`
                          }
                        });
                        console.log(`[AUTO_ALLOCATION] Reactivated allocation for ${position.isin} (was redeemed)`);
                      }
                    }
                  }
                } catch (allocationError) {
                  console.error(`[AUTO_ALLOCATION] Error creating allocation for ${position.isin}: ${allocationError.message}`);
                  // Don't fail the import
                }

                // UNIFIED PRICING: Extract price from bank file and upsert to product prices
                // Use bank file date (dataDate/fileDate) as the effective price date, NOT the internal
                // price date from the bank's price file (position.priceDate). Some banks (e.g. SG Monaco)
                // report stale INS_PRICE_D values that lag weeks behind the actual file date, causing
                // newer bank files to produce older price records. The file date represents when we
                // last received confirmation of this price from the bank.
                const effectivePriceDate = position.dataDate || fileDate || position.priceDate;
                if (position.marketPrice && effectivePriceDate) {
                  try {
                    const { ProductPriceHelpers } = await import('../../imports/api/productPrices.js');

                    // Convert decimal to percentage format ONLY for percentage-priced instruments
                    // PMSHoldings stores prices in decimal format (0.9677 = 96.77%)
                    // ProductPrices expects percentage format (96.77 = 96.77%)
                    const displayPrice = position.priceType === 'percentage'
                      ? position.marketPrice * 100  // 0.9677 → 96.77
                      : position.marketPrice;       // Keep absolute prices (equities) as-is

                    await ProductPriceHelpers.upsertProductPrice({
                      isin: position.isin,
                      price: displayPrice,
                      currency: position.priceCurrency || position.currency || 'USD',
                      priceDate: effectivePriceDate,
                      priceSource: 'bank_file',
                      uploadedBy: 'system',
                      sourceFile: filename,
                      bankFileDate: position.dataDate || fileDate,
                      metadata: {
                        bankName: bank.name,
                        portfolioCode: position.portfolioCode,
                        priceType: position.priceType
                      }
                    });
                  } catch (pricingError) {
                    console.error(`[UNIFIED_PRICING] Error upserting price for ${position.isin}: ${pricingError.message}`);
                    // Don't fail the import
                  }
                }
              }
            } catch (enrichError) {
              console.error(`[BANK_POSITIONS] Error enriching position: ${enrichError.message}`);
              // Continue without enrichment - don't fail the whole import
            }
          }

          // CENTRALIZED CLASSIFICATION: Use SecurityResolver for all positions
          // This ensures consistent classification from SecuritiesMetadata (single source of truth)
          if (position.isin) {
            try {
              // Check if already enriched from internal product
              const alreadyEnriched = position.bankSpecificData?.autoEnriched === true;

              if (!alreadyEnriched) {
                // Get classification from SecurityResolver (SecuritiesMetadata -> AI fallback)
                const classification = await SecurityResolver.resolveSecurityType(
                  position.isin,
                  {
                    securityName: position.securityName,
                    currency: position.currency
                  }
                );

                if (classification && classification.isClassified) {
                  // Apply classification from SecuritiesMetadata
                  position.securityType = classification.securityType;
                  position.assetClass = classification.assetClass;
                  position.structuredProductUnderlyingType = classification.structuredProductUnderlyingType || '';
                  position.structuredProductProtectionType = classification.structuredProductProtectionType || '';

                  // Store classification source in bankSpecificData
                  position.bankSpecificData = position.bankSpecificData || {};
                  position.bankSpecificData.classificationSource = classification.classificationSource || 'securities_metadata';
                  position.bankSpecificData.classificationConfidence = classification.confidence;

                  console.log(`[BANK_POSITIONS] Classified ${position.isin} via SecurityResolver: ${classification.assetClass} (${classification.securityType})`);
                }
              }
            } catch (classifyError) {
              console.error(`[BANK_POSITIONS] SecurityResolver error for ${position.isin}: ${classifyError.message}`);
              // Continue with parser-assigned type - don't fail the import
            }
          }

          // Upsert position
          const result = await PMSHoldingsHelpers.upsertHolding(position);

          // Track this position for sold position detection
          // Generate uniqueKey if not already set by parser (Julius Baer parser doesn't set it)
          const trackingUniqueKey = position.uniqueKey || PMSHoldingsHelpers.generateUniqueKey({
            bankId: connection.bankId,
            portfolioCode: position.portfolioCode,
            isin: position.isin,
            currency: position.currency,
            securityType: position.securityType,
            endDate: position.bankSpecificData?.instrumentDates?.endDate || position.bankSpecificData?.endDate,
            reference: position.bankSpecificData?.instrumentDates?.reference || position.bankSpecificData?.reference
          });
          if (trackingUniqueKey) {
            processedUniqueKeys.add(trackingUniqueKey);
          }
          if (position.portfolioCode && position.userId) {
            processedPortfolioCodes.add(position.portfolioCode);
          }

          // Record the key actually written, for stale-uniqueKey reconciliation below
          trackWrittenSnapshot(writtenSnapshots, position, result.uniqueKey);

          if (result.isNew) {
            newRecords++;
          } else if (result.updated) {
            updatedRecords++;
          } else {
            unchangedRecords++;
          }
        } catch (error) {
          console.error(`[BANK_POSITIONS] Error saving position: ${error.message}`);
          errors.push({
            portfolio: position.portfolioCode,
            isin: position.isin,
            error: error.message
          });
          skippedRecords++;
        }
      }

      // STALE UNIQUEKEY RECONCILIATION: retire records that hold the same positions
      // under an outdated uniqueKey, so a position is never counted twice.
      //
      // Needed because uniqueKey is parser-owned and its recipe changes (e.g. the CMB
      // sub-account fix). A reprocess then re-writes history under a new key while the
      // old-key records stay active, and the historical (asOfDate) view — which dedups
      // by uniqueKey — shows every position twice. Unlike the sold-position cleanup
      // below, this looks at ALL records for the processed days, not just isLatest.
      try {
        if (writtenSnapshots.size > 0) {
          const reconcile = await PMSHoldingsHelpers.reconcileSnapshotKeys({
            bankId: connection.bankId,
            written: writtenSnapshots
          });
          if (reconcile.recordsDeactivated > 0) {
            console.warn(
              `[BANK_POSITIONS] Stale uniqueKey duplicates cleared: ${reconcile.recordsDeactivated} record(s) ` +
              `across ${reconcile.groupsAffected} portfolio/day group(s)`
            );
          }
        }
      } catch (reconcileError) {
        // Never fail an import over reconciliation - the data itself is already written
        console.error(`[BANK_POSITIONS] Stale uniqueKey reconciliation failed: ${reconcileError.message}`);
      }

      // SOLD POSITION CLEANUP: Mark positions that are no longer in the bank file as inactive
      // This ensures PMS exactly matches today's bank statement
      console.log(`[BANK_POSITIONS] Checking for sold/transferred positions...`);
      let soldPositionsCount = 0;
      try {
        if (processedPortfolioCodes.size > 0 && processedUniqueKeys.size > 0) {
          // Find positions for these portfolios that are NOT in current file
          // These are positions that existed before but are now missing = sold/transferred/redeemed
          const stalePositions = await PMSHoldingsCollection.find({
            bankId: connection.bankId,
            portfolioCode: { $in: Array.from(processedPortfolioCodes) },
            isLatest: true,
            isActive: { $ne: false }, // Include positions where isActive is true or undefined
            uniqueKey: { $nin: Array.from(processedUniqueKeys) }
          }).fetchAsync();

          if (stalePositions.length > 0) {
            console.log(`[BANK_POSITIONS] Found ${stalePositions.length} positions to mark as sold/inactive`);

            for (let i = 0; i < stalePositions.length; i++) {
              await yieldToEventLoop(i, 20);
              const stale = stalePositions[i];

              // Detect rollover: another uniqueKey covers the same logical security in
              // the same portfolio (e.g. CFM FX forward closed under reference X and
              // reopened under reference Y). Identity key intentionally excludes the
              // rollover-varying part (reference / endDate) so the new leg matches.
              const rolloverMatch = await PMSHoldingsCollection.findOneAsync({
                bankId: connection.bankId,
                portfolioCode: stale.portfolioCode,
                isin: stale.isin || null,
                ticker: stale.ticker || null,
                currency: stale.currency,
                securityType: stale.securityType,
                isLatest: true,
                isActive: true,
                uniqueKey: { $ne: stale.uniqueKey }
              }, { fields: { _id: 1 } });

              // Mark the latest record as sold. If a rollover replacement exists,
              // also clear isLatest so the orphan can't pollute future "latest"
              // queries (incl. snapshot regeneration) with stale inflated values.
              const update = {
                isActive: false,
                soldAt: fileDate,
                soldReason: rolloverMatch ? 'replaced_by_rollover' : 'position_not_in_bank_file',
                updatedAt: new Date()
              };
              if (rolloverMatch) {
                update.isLatest = false;
                update.replacedAt = new Date();
              }
              await PMSHoldingsCollection.updateAsync(stale._id, { $set: update });

              // CRITICAL: Also mark ALL historical records with same uniqueKey as inactive
              // This prevents closed positions from appearing in historical snapshot queries
              const historicalUpdateCount = await PMSHoldingsCollection.updateAsync(
                {
                  uniqueKey: stale.uniqueKey,
                  _id: { $ne: stale._id },  // Exclude the already-updated latest record
                  isActive: { $ne: false }  // Only update records not already inactive
                },
                {
                  $set: {
                    isActive: false,
                    updatedAt: new Date()
                  }
                },
                { multi: true }
              );

              soldPositionsCount++;
              const histMsg = historicalUpdateCount > 0 ? ` (+${historicalUpdateCount} historical)` : '';
              console.log(`[BANK_POSITIONS] Marked as sold: ${stale.securityName || stale.isin || 'Unknown'} (${stale.portfolioCode})${histMsg}`);
            }
          } else {
            console.log(`[BANK_POSITIONS] No sold positions detected`);
          }
        }
      } catch (cleanupError) {
        console.error(`[BANK_POSITIONS] Error during stale position cleanup: ${cleanupError.message}`);
        // Don't fail the import
      }

      // LINK NEW POSITIONS TO PRODUCTS: a structured product is normally booked
      // days before the bank reports the position, and auto-allocation only ran
      // at product-creation time — so those positions never got an allocation and
      // the product dashboard showed a dash instead of the size. Sweeping here
      // links whatever this file just brought in.
      try {
        const { AllocationHelpers } = await import('../../imports/api/allocations.js');
        const linked = await AllocationHelpers.linkUnlinkedHoldings();
        if (linked.allocationsCreated > 0) {
          console.log(`[BANK_POSITIONS] Linked ${linked.allocationsCreated} new position(s) to ${linked.productsLinked} product(s)`);
        }
      } catch (linkError) {
        // Never fail an import over linking - the positions themselves are saved
        console.error(`[BANK_POSITIONS] Product linking failed: ${linkError.message}`);
      }

      // CFM FX-FORWARD VALUE DATES: join fx_forward holdings to FX_TRADE operations
      // by portfolioCode + |amount| so the Value Date column populates. No-op for
      // banks that don't produce fx_forward holdings.
      try {
        const fxEnrich = await CFMParser.enrichFxForwardValueDates({
          PMSHoldingsCollection,
          PMSOperationsCollection,
          bankId: connection.bankId
        });
        if (fxEnrich.matched > 0) {
          console.log(`[BANK_POSITIONS] FX forward dates enriched: ${fxEnrich.matched}/${fxEnrich.total} legs`);
        }
      } catch (fxEnrichError) {
        console.error(`[BANK_POSITIONS] FX forward date enrichment failed: ${fxEnrichError.message}`);
      }

      // EDR TERM-DEPOSIT TERM LABEL: EDR term deposits carry no forward maturity in
      // the positions file; classify them as rolling/call from their operations so
      // the UI shows a label instead of "N/A". Hard-scoped to EDR -> no-op otherwise.
      try {
        const depEnrich = await EDRMonacoParser.enrichTermDepositMaturity({
          PMSHoldingsCollection,
          PMSOperationsCollection,
          bankId: connection.bankId
        });
        if (depEnrich.matched > 0) {
          console.log(`[BANK_POSITIONS] EDR term-deposit terms enriched: ${depEnrich.matched}/${depEnrich.total}`);
        }
      } catch (depEnrichError) {
        console.error(`[BANK_POSITIONS] EDR term-deposit enrichment failed: ${depEnrichError.message}`);
      }

      // REDEMPTION DETECTION: Check for allocations whose products disappeared from bank file
      console.log(`[BANK_POSITIONS] Checking for redeemed products...`);
      try {
        const { AllocationsCollection, AllocationHelpers } = await import('../../imports/api/allocations.js');
        const { ProductsCollection } = await import('../../imports/api/products.js');

        // Step 1: Get all bank account IDs for this bank connection
        const bankAccountsForThisBank = await BankAccountsCollection.find({
          bankId: connection.bankId,
          isActive: true
        }).fetchAsync();
        const bankAccountIds = bankAccountsForThisBank.map(ba => ba._id);

        if (bankAccountIds.length === 0) {
          console.log(`[REDEMPTION] No bank accounts found for bankId=${connection.bankId}, skipping`);
        } else {
          // Step 2: Get all active allocations linked to accounts at this bank
          const activeAllocations = await AllocationsCollection.find({
            bankAccountId: { $in: bankAccountIds },
            status: 'active'
          }).fetchAsync();

          console.log(`[REDEMPTION] Found ${activeAllocations.length} active allocations for bank ${connection.bankId}`);

          // Step 3: Get ISINs present in current bank file
          const currentFileIsins = new Set(positions.map(p => p.isin).filter(Boolean));

          for (const allocation of activeAllocations) {
            // Resolve ISIN: prefer cached isin on allocation, fall back to product lookup
            let allocationIsin = allocation.isin;
            if (!allocationIsin) {
              const product = await ProductsCollection.findOneAsync(allocation.productId);
              allocationIsin = product?.isin;
            }

            if (!allocationIsin) continue;

            // Check if this ISIN is still present in the current bank file
            if (currentFileIsins.has(allocationIsin)) continue;

            // ISIN missing from file — verify no active holdings remain at this bank
            const remainingHoldings = await PMSHoldingsCollection.find({
              bankId: connection.bankId,
              isin: allocationIsin,
              isLatest: true,
              isActive: true
            }).countAsync();

            if (remainingHoldings > 0) {
              console.log(`[REDEMPTION] ISIN ${allocationIsin} missing from file but ${remainingHoldings} active holdings remain — skipping`);
              continue;
            }

            // Safety: skip manual allocations never seen in a bank file
            if (allocation.source === 'manual' && !allocation.lastSeenInBankFile) {
              console.log(`[REDEMPTION] Skipping manual allocation ${allocation._id} for ${allocationIsin} — never seen in bank file`);
              continue;
            }

            // Mark as redeemed
            await AllocationHelpers.markAsRedeemed(allocation._id, {
              redeemedAt: fileDate,
              redemptionPrice: null,
              redemptionValue: allocation.nominalInvested
            });

            console.log(`[REDEMPTION] Marked allocation ${allocation._id} as redeemed: ${allocationIsin} for client ${allocation.clientId}`);
          }
        }
      } catch (redemptionError) {
        console.error(`[REDEMPTION] Error detecting redemptions: ${redemptionError.message}`);
      }

      // Create portfolio snapshots for each portfolio (only for matched positions with userId)
      console.log(`[BANK_POSITIONS] Creating portfolio snapshots...`);

      // Group positions by portfolio code (matched positions — linked to a legacy userId
      // OR a client entity). Entity-only clients (created directly as entities, no legacy
      // userId) must still get snapshots.
      const positionsByPortfolio = positions
        .filter(pos => pos.userId || pos.entityId) // matched positions (userId or entity)
        .reduce((groups, pos) => {
          const portfolioCode = pos.portfolioCode || 'UNKNOWN';
          if (!groups[portfolioCode]) {
            groups[portfolioCode] = [];
          }
          groups[portfolioCode].push(pos);
          return groups;
        }, {});

      // Pre-fetch transfer operations ONCE for all portfolios (avoid repeated DB queries)
      const portfolioUserIds = [...new Set(Object.values(positionsByPortfolio).map(positions => positions[0]?.userId).filter(Boolean))];
      const transferOpsCache = await PMSOperationsCollection.find({
        userId: { $in: portfolioUserIds },
        operationType: 'TRANSFER',
        operationCategory: 'CASH'
      }).fetchAsync();

      // Create snapshot for each portfolio
      for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
        try {
          // Use userId from the positions (all positions in a portfolio belong to same user)
          const portfolioUserId = portfolioPositions[0].userId;

          await PortfolioSnapshotHelpers.createSnapshot({
            userId: portfolioUserId,
            entityId: portfolioPositions[0].entityId || null,
            bankId: connection.bankId,
            bankName: bank.name,
            connectionId,
            portfolioCode,
            accountNumber: portfolioPositions[0].accountNumber || null,
            snapshotDate: fileDate,
            fileDate,
            sourceFile: filename,
            holdings: portfolioPositions,
            transferOpsCache  // Pass pre-fetched operations
          });
        } catch (snapshotError) {
          console.error(`[BANK_POSITIONS] Error creating snapshot for ${portfolioCode}: ${snapshotError.message}`);
        }
      }

      // CHECK ALLOCATION LIMITS after creating snapshots
      console.log(`[BANK_POSITIONS] Checking allocation limits against investment profiles...`);
      // Resolve archived (closed-relationship) clients once. Their positions are still
      // stored above (soft-archive keeps history), but we raise NO alerts for them —
      // no negative-cash/overdraft and no allocation-breach notifications.
      const archivedExclusion = await ClientEntityHelpers.getArchivedExclusion();
      const archivedUserIdSet = new Set(archivedExclusion.userIds);
      const archivedEntityIdSet = new Set(archivedExclusion.entityIds);
      const archivedBankAccountIdSet = new Set(archivedExclusion.bankAccountIds);
      try {
        for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
          const portfolioUserId = portfolioPositions[0].userId;

          // Find the bank account for this portfolio
          const bankAccount = await BankAccountsCollection.findOneAsync({
            accountNumber: portfolioCode.split('-')[0], // Strip any suffix
            bankId: connection.bankId,
            isActive: true
          });

          if (!bankAccount) continue;

          // Skip all alerts for archived clients (closed relationships)
          if (archivedBankAccountIdSet.has(bankAccount._id) ||
              (bankAccount.entityId && archivedEntityIdSet.has(bankAccount.entityId)) ||
              (portfolioUserId && archivedUserIdSet.has(portfolioUserId))) {
            console.log(`[BANK_POSITIONS] Skipping alerts for archived client (portfolio ${portfolioCode})`);
            continue;
          }

          // Get the latest snapshot for this portfolio (needed for both negative cash and allocation checks)
          const snapshot = await PortfolioSnapshotsCollection.findOneAsync({
            userId: portfolioUserId,
            portfolioCode,
            bankId: connection.bankId
          }, { sort: { snapshotDate: -1 } });

          // CHECK FOR NEGATIVE CASH BALANCE using shared calculator (same as Cash Monitor)
          // Get ALL holdings for this portfolio
          const allHoldings = await PMSHoldingsCollection.find({
            portfolioCode,
            bankId: connection.bankId,
            isLatest: true
          }).fetchAsync();

          // Get currency rates for EUR conversion (same as Cash Monitor)
          const currencyRates = await CurrencyRateCacheCollection.find({
            expiresAt: { $gt: new Date() }
          }).fetchAsync();
          const ratesMap = buildRatesMap(currencyRates);

          // Get ISINs classified as cash equivalents (monetary products, time deposits)
          const cashEquivalentMetadata = await SecuritiesMetadataCollection.find({
            assetClass: { $in: ['monetary_products', 'time_deposit'] }
          }).fetchAsync();
          const cashEquivalentISINs = new Set(cashEquivalentMetadata.map(m => m.isin));

          // Use shared cash calculator (identical to Cash Monitor logic)
          const cashResult = checkNegativeCash(
            allHoldings,
            ratesMap,
            cashEquivalentISINs,
            bankAccount.authorizedOverdraft || 0,
            bankAccount.referenceCurrency || 'EUR'
          );

          // Log for debugging (using EUR values now)
          console.log(`[CASH_CHECK] Portfolio ${portfolioCode}: pureCashEUR=${cashResult.pureCashEUR.toFixed(2)}, authorizedOverdraftEUR=${cashResult.authorizedOverdraftEUR.toFixed(2)}, exceedsOverdraft=${cashResult.exceedsOverdraft}`);

          // Extract values for notification compatibility
          const negativeCurrencies = cashResult.negativeCurrencies;
          const authorizedOverdraft = bankAccount.authorizedOverdraft || 0;
          const excessOverdraft = cashResult.excessAmount;
          const shouldAlert = cashResult.exceedsOverdraft;

          if (shouldAlert) {
            // Get client info for notification
            const clientForCash = await UsersCollection.findOneAsync(portfolioUserId);
            const clientNameForCash = clientForCash?.profile?.firstName && clientForCash?.profile?.lastName
              ? `${clientForCash.profile.firstName} ${clientForCash.profile.lastName}`
              : clientForCash?.email || 'Unknown';

            // Build message with NET negative cash positions per currency
            const negativeDetails = negativeCurrencies.map(c => {
              const formatted = c.totalValue.toLocaleString('en-US', {
                style: 'currency',
                currency: c.currency
              });
              return `${c.currency}: ${formatted}`;
            }).join(', ');

            const overdraftInfo = authorizedOverdraft > 0
              ? ` (exceeds credit line of ${bankAccount.referenceCurrency || 'EUR'} ${authorizedOverdraft.toLocaleString()} by ${excessOverdraft.toLocaleString()})`
              : '';

            console.log(`[NEGATIVE_CASH] Account ${bankAccount.accountNumber} has negative cash positions: ${negativeDetails}${overdraftInfo}`);

            // Check for duplicate notification (same account, within 24 hours)
            const metadata = {
              bankAccountId: bankAccount._id,
              portfolioCode,
              clientId: portfolioUserId,
              clientName: clientNameForCash,
              negativeCashPositions: negativeCurrencies.map(c => ({
                currency: c.currency,
                amount: c.totalValue,
                amountEUR: c.eurValue
              })),
              totalCashBalanceEUR: cashResult.pureCashEUR,  // Now in EUR for consistency with Cash Monitor
              authorizedOverdraftEUR: cashResult.authorizedOverdraftEUR,
              excessOverdraftEUR: excessOverdraft,
              severity: 'critical'
            };

            const isDuplicate = await NotificationHelpers.checkUserNotificationDuplicate(
              'unauthorized_overdraft',
              metadata,
              24 // hours
            );

            if (!isDuplicate) {
              // Collect all users who should see this notification
              const recipientIds = new Set();

              // Get all admin and superadmin users
              const adminUsers = await UsersCollection.find({
                role: { $in: ['admin', 'superadmin'] }
              }).fetchAsync();
              adminUsers.forEach(admin => recipientIds.add(admin._id));

              // Add the client's relationship managers (account, entity or legacy login)
              const { resolveClientRmIds } = await import('/imports/api/notificationService.js');
              (await resolveClientRmIds({ clientIds: [portfolioUserId, bankAccount.entityId], bankAccountIds: [bankAccount._id] }))
                .forEach(id => recipientIds.add(id));

              // Create ONE notification for all relevant users
              if (recipientIds.size > 0) {
                await NotificationHelpers.createForMultipleUsers({
                  userIds: Array.from(recipientIds),
                  type: 'error',
                  title: 'Negative Cash Balance Alert',
                  message: `CRITICAL: ${clientNameForCash}'s account ${bank.name} ${bankAccount.accountNumber} has negative cash: ${negativeDetails}${overdraftInfo}`,
                  metadata,
                  eventType: 'unauthorized_overdraft'
                });
              }
            } else {
              console.log(`[NEGATIVE_CASH] Skipping duplicate notification for account ${bankAccount.accountNumber}`);
            }
          } else if (negativeCurrencies.length > 0 && excessOverdraft <= 0) {
            // Negative cash within authorized overdraft - log but don't alert
            console.log(`[NEGATIVE_CASH] Account ${bankAccount.accountNumber} has negative cash (EUR ${cashResult.totalNegativeCashEUR.toLocaleString()}) within authorized overdraft limit (${authorizedOverdraft.toLocaleString()})`);
            // Resolve any existing alerts since the overdraft is now within limits
            await NotificationHelpers.resolveUserNotifications('unauthorized_overdraft', {
              bankAccountId: bankAccount._id
            });
          } else {
            // No negative cash positions - resolve any existing alerts for this account
            await NotificationHelpers.resolveUserNotifications('unauthorized_overdraft', {
              bankAccountId: bankAccount._id
            });
          }

          // Get the account profile for allocation limit checks
          const accountProfile = await AccountProfilesCollection.findOneAsync({
            bankAccountId: bankAccount._id
          });

          // Skip allocation limit check if no profile set (but negative cash check already ran above)
          if (!accountProfile) continue;

          // For allocation checks, we need the snapshot with breakdown data
          if (!snapshot || !snapshot.assetClassBreakdown || !snapshot.totalAccountValue) continue;

          // Calculate current allocation
          const allocation = aggregateToFourCategories(snapshot.assetClassBreakdown, snapshot.totalAccountValue);

          // Check for breaches
          const breaches = [];

          if (allocation.cash > accountProfile.maxCash) {
            breaches.push({ category: 'Cash', current: allocation.cash.toFixed(1), limit: accountProfile.maxCash });
          }
          if (allocation.bonds > accountProfile.maxBonds) {
            breaches.push({ category: 'Bonds', current: allocation.bonds.toFixed(1), limit: accountProfile.maxBonds });
          }
          if (allocation.equities > accountProfile.maxEquities) {
            breaches.push({ category: 'Equities', current: allocation.equities.toFixed(1), limit: accountProfile.maxEquities });
          }
          if (allocation.alternative > accountProfile.maxAlternative) {
            breaches.push({ category: 'Alternative', current: allocation.alternative.toFixed(1), limit: accountProfile.maxAlternative });
          }

          if (breaches.length > 0) {
            console.log(`[ALLOCATION_BREACH] Account ${bankAccount.accountNumber} has ${breaches.length} breaches`);

            // Get client name for notification
            const client = await UsersCollection.findOneAsync(portfolioUserId);
            const clientName = client?.profile?.firstName && client?.profile?.lastName
              ? `${client.profile.firstName} ${client.profile.lastName}`
              : client?.email || 'Unknown';

            // Create notification for admin and the client's RM
            const breachDetails = breaches.map(b => `${b.category}: ${b.current}% (limit: ${b.limit}%)`).join(', ');

            // Notify the admin who processed the file
            await NotificationHelpers.create({
              userId: user._id,
              type: 'warning',
              title: 'Allocation Limit Breached',
              message: `${clientName}'s account ${bank.name} ${bankAccount.accountNumber} exceeds investment profile limits.\n\n${breachDetails}`,
              metadata: {
                bankAccountId: bankAccount._id,
                portfolioCode,
                clientId: portfolioUserId,
                clientName,
                breaches,
                allocation,
                profile: {
                  maxCash: accountProfile.maxCash,
                  maxBonds: accountProfile.maxBonds,
                  maxEquities: accountProfile.maxEquities,
                  maxAlternative: accountProfile.maxAlternative
                }
              },
              eventType: 'allocation_breach'
            });

            // Also notify the relationship manager if one is assigned
            // Also notify the client's relationship managers (account, entity or legacy login)
            const { resolveClientRmIds } = await import('/imports/api/notificationService.js');
            const breachRmIds = (await resolveClientRmIds({ clientIds: [portfolioUserId, bankAccount.entityId], bankAccountIds: [bankAccount._id] }))
              .filter(id => id !== user._id);
            for (const rmId of breachRmIds) {
              await NotificationHelpers.create({
                userId: rmId,
                type: 'warning',
                title: 'Allocation Limit Breached',
                message: `${clientName}'s account ${bank.name} ${bankAccount.accountNumber} exceeds investment profile limits.\n\n${breachDetails}`,
                metadata: {
                  bankAccountId: bankAccount._id,
                  portfolioCode,
                  clientId: portfolioUserId,
                  clientName,
                  breaches,
                  allocation,
                  profile: {
                    maxCash: accountProfile.maxCash,
                    maxBonds: accountProfile.maxBonds,
                    maxEquities: accountProfile.maxEquities,
                    maxAlternative: accountProfile.maxAlternative
                  }
                },
                eventType: 'allocation_breach'
              });
            }
          } else {
            // Back within the profile's limits - clear any standing breach alert
            // so a corrected (or reclassified) allocation doesn't keep warning.
            await NotificationHelpers.resolveUserNotifications('allocation_breach', {
              bankAccountId: bankAccount._id
            });
          }
        }
      } catch (breachCheckError) {
        console.error(`[BANK_POSITIONS] Error checking allocation limits: ${breachCheckError.message}`);
        // Don't fail the import if breach check fails
      }

      // Log success (before processing operations)
      let logMessage = `Processed ${totalRecords} positions: ${newRecords} new, ${updatedRecords} updated`;
      if (unmappedPositions > 0) {
        logMessage += `, ${unmappedPositions} skipped (unmapped)`;
      }
      if (soldPositionsCount > 0) {
        logMessage += `, ${soldPositionsCount} marked as sold`;
      }

      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_positions',
        status: 'success',
        message: logMessage,
        metadata: {
          filename,
          fileDate: fileDate.toISOString(),
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          soldPositions: soldPositionsCount,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : undefined,
          errors: errors.length > 0 ? errors : undefined
        },
        userId: user._id
      });

      if (unmappedPositions > 0) {
        console.log(
          `[BANK_POSITIONS] WARNING: ${unmappedPositions} positions skipped due to unmapped portfolio codes: ${Array.from(unmappedPortfolioCodes).join(', ')}`
        );
      }

      console.log(
        `[BANK_POSITIONS] Processing complete: ` +
        `${newRecords} new, ${updatedRecords} updated, ${unchangedRecords} unchanged, ${skippedRecords} skipped` +
        (soldPositionsCount > 0 ? `, ${soldPositionsCount} sold` : '')
      );

      // POST-PROCESSING VALIDATION: Verify isLatest flags are correct for processed uniqueKeys
      // This is a safety net to detect if upsertHolding had issues (orphans or duplicates)
      if (processedUniqueKeys.size > 0) {
        try {
          const orphanedKeys = [];
          const duplicateKeys = [];

          for (const uniqueKey of processedUniqueKeys) {
            const latestCount = await PMSHoldingsCollection.find({
              uniqueKey,
              isLatest: true
            }).countAsync();

            if (latestCount === 0) {
              orphanedKeys.push(uniqueKey);
            } else if (latestCount > 1) {
              // Race condition: multiple isLatest=true records for same uniqueKey
              duplicateKeys.push({ uniqueKey, count: latestCount });
            }
          }

          // Report orphaned keys (no isLatest=true)
          if (orphanedKeys.length > 0) {
            console.error(`[BANK_POSITIONS] WARNING: ${orphanedKeys.length} uniqueKeys have NO isLatest=true record! This should not happen.`);
            console.error(`[BANK_POSITIONS] Orphaned keys (first 5): ${orphanedKeys.slice(0, 5).join(', ')}`);
          }

          // Auto-fix duplicate keys (multiple isLatest=true) - caused by race conditions
          if (duplicateKeys.length > 0) {
            console.warn(`[BANK_POSITIONS] DUPLICATE DETECTED: ${duplicateKeys.length} uniqueKeys have multiple isLatest=true records. Auto-fixing...`);

            let fixedCount = 0;
            for (const { uniqueKey, count } of duplicateKeys) {
              try {
                const raceCheck = await PMSHoldingsHelpers.checkAndFixDuplicatesForKey(uniqueKey);
                if (raceCheck.fixedCount > 0) {
                  fixedCount += raceCheck.fixedCount;
                }
              } catch (fixError) {
                console.error(`[BANK_POSITIONS] Failed to fix duplicates for key ${uniqueKey.substring(0, 16)}...: ${fixError.message}`);
              }
            }

            console.log(`[BANK_POSITIONS] Auto-fixed ${fixedCount} duplicate isLatest records across ${duplicateKeys.length} uniqueKeys`);
          }

          // Final validation status
          if (orphanedKeys.length === 0 && duplicateKeys.length === 0) {
            console.log(`[BANK_POSITIONS] Validation passed: All ${processedUniqueKeys.size} processed uniqueKeys have exactly 1 isLatest=true record`);
          }
        } catch (validationError) {
          console.error(`[BANK_POSITIONS] Error during isLatest validation: ${validationError.message}`);
        }
      }

      // AUTO-LINK holdings to products and allocations
      // Only run if there are new or updated holdings (avoids unnecessary work)
      if (newRecords > 0 || updatedRecords > 0) {
        console.log(`[PMS_AUTO_LINK] Starting auto-linking for bankId=${connection.bankId}, fileDate=${fileDate.toISOString()}`);
        try {
          const linkingResult = await Meteor.callAsync('pmsHoldings.autoLinkOnImport', {
            bankId: connection.bankId,
            fileDate
          });

          if (linkingResult.success) {
            console.log(
              `[PMS_AUTO_LINK] Auto-linking complete: ` +
              `${linkingResult.linked} linked, ${linkingResult.noMatch} no match, ${linkingResult.failed} failed`
            );

            // Log auto-linking summary
            await BankConnectionLogHelpers.logConnectionAttempt({
              connectionId,
              bankId: connection.bankId,
              connectionName: connection.connectionName,
              action: 'auto_link_holdings',
              status: 'success',
              message: `Auto-linked ${linkingResult.linked} holdings to products/allocations`,
              metadata: {
                totalHoldings: linkingResult.total,
                linked: linkingResult.linked,
                noMatch: linkingResult.noMatch,
                failed: linkingResult.failed,
                fileDate: fileDate.toISOString()
              },
              userId: user._id
            });
          }
        } catch (linkingError) {
          console.error(`[PMS_AUTO_LINK] Auto-linking failed: ${linkingError.message}`);
        // Don't fail the import - linking can be done manually later
          await BankConnectionLogHelpers.logConnectionAttempt({
            connectionId,
            bankId: connection.bankId,
            connectionName: connection.connectionName,
            action: 'auto_link_holdings',
            status: 'failed',
            error: linkingError.message,
            userId: user._id
          });
        }
      } else {
        console.log(`[PMS_AUTO_LINK] Skipping auto-link (no new/updated holdings)`);
      }

      // ALSO PROCESS OPERATIONS
      console.log(`[BANK_OPERATIONS] Processing operations from same directory`);

      let operationsResult = { totalRecords: 0, newRecords: 0, updatedRecords: 0, skippedRecords: 0, unmappedOperations: 0 };

      try {
        // Use parseAllFiles to process ALL operation files (not just latest)
        // This is important for transaction files which are incremental
        const seenOperationFiles = connection.seenOperationFiles || [];
        const operationsParseResult = BankOperationParser.parseAllFiles(bankFolderPath, {
          bankId: connection.bankId,
          bankName: bank.name,
          userId: null,  // Will be matched to bank accounts
          seenFiles: seenOperationFiles
        });

        if (operationsParseResult.error) {
          console.warn(`[BANK_OPERATIONS] Parse error: ${operationsParseResult.error}`);
        }

        if (!operationsParseResult.error && operationsParseResult.operations) {
          const { operations, processedFiles } = operationsParseResult;
          console.log(`[BANK_OPERATIONS] Parsed ${operations.length} operations from ${processedFiles.length} files`);

          let opNew = 0;
          let opUpdated = 0;
          let opSkipped = 0;
          let opUnmapped = 0;
          const opUnmappedPortfolioCodes = new Set();

          // Log all unique portfolio codes found in operations file for debugging
          const allOpPortfolioCodes = [...new Set(operations.map(op => op.portfolioCode))];
          console.log(`[BANK_OPERATIONS] Found ${allOpPortfolioCodes.length} unique portfolio codes in operations file: ${allOpPortfolioCodes.join(', ')}`);

          // Reuse portfolioEntityMap from positions processing (or build if not available)
          const opPortfolioEntityMap = portfolioEntityMap || await buildPortfolioEntityMap(connection.bankId);

          for (const operation of operations) {
            try {
              // Match portfolio code to bank account (entity-primary, userId fallback)
              const opAccountMapping = getEntityIdFromMap(operation.portfolioCode, opPortfolioEntityMap);

              if (!opAccountMapping.entityId && !opAccountMapping.userId) {
                // Skip operations without matching bank account
                opUnmappedPortfolioCodes.add(operation.portfolioCode);
                opUnmapped++;
                opSkipped++;
                continue;
              }

              if (opAccountMapping.entityId) {
                operation.entityId = opAccountMapping.entityId;
              }
              if (opAccountMapping.userId) {
                operation.userId = opAccountMapping.userId;
              }

              operation.connectionId = connectionId;
              operation.sourceFilePath = path.join(bankFolderPath, operation.sourceFile || 'unknown');

              const result = await PMSOperationsHelpers.upsertOperation(operation);

              if (result.updated) {
                opUpdated++;
              } else {
                opNew++;
              }
            } catch (error) {
              console.error(`[BANK_OPERATIONS] Error saving operation: ${error.message}`);
              opSkipped++;
            }
          }

          operationsResult = {
            totalRecords: operations.length,
            newRecords: opNew,
            updatedRecords: opUpdated,
            skippedRecords: opSkipped,
            unmappedOperations: opUnmapped,
            unmappedPortfolioCodes: opUnmapped > 0 ? Array.from(opUnmappedPortfolioCodes) : undefined,
            processedFiles: processedFiles
          };

          // Update connection to track processed operation files
          if (processedFiles.length > 0) {
            const updatedSeenFiles = [...seenOperationFiles, ...processedFiles];
            await BankConnectionsCollection.updateAsync(connectionId, {
              $set: { seenOperationFiles: updatedSeenFiles }
            });
            console.log(`[BANK_OPERATIONS] Updated seenOperationFiles: ${processedFiles.join(', ')}`);
          }

          if (opUnmapped > 0) {
            console.log(
              `[BANK_OPERATIONS] WARNING: ${opUnmapped} operations skipped due to unmapped portfolio codes: ${Array.from(opUnmappedPortfolioCodes).join(', ')}`
            );
          }

          console.log(
            `[BANK_OPERATIONS] Operations complete: ` +
            `${opNew} new, ${opUpdated} updated, ${opSkipped} skipped`
          );

          // Log operations processing success
          const opLogMessage = opUnmapped > 0
            ? `Processed ${operations.length} operations: ${opNew} new, ${opUpdated} updated, ${opUnmapped} skipped (unmapped)`
            : `Processed ${operations.length} operations: ${opNew} new, ${opUpdated} updated`;

          await BankConnectionLogHelpers.logConnectionAttempt({
            connectionId,
            bankId: connection.bankId,
            connectionName: connection.connectionName,
            action: 'process_operations',
            status: 'success',
            message: opLogMessage,
            metadata: {
              processedFiles: processedFiles,
              totalRecords: operations.length,
              newRecords: opNew,
              updatedRecords: opUpdated,
              skippedRecords: opSkipped,
              unmappedOperations: opUnmapped,
              unmappedPortfolioCodes: opUnmapped > 0 ? Array.from(opUnmappedPortfolioCodes) : undefined
            },
            userId: user._id
          });
        } else {
          console.log(`[BANK_OPERATIONS] No new operations files to process`);
        }
      } catch (opError) {
        console.error(`[BANK_OPERATIONS] Operations processing error: ${opError.message}`);
      }

      // Log successful position processing with detailed stats
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_positions',
        status: 'success',
        message: `Processed ${filename}: ${newRecords} new, ${updatedRecords} updated, ${skippedRecords} skipped`,
        metadata: {
          filename,
          fileDate,
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          soldPositions: soldPositionsCount,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : [],
          errorsCount: errors.length
        },
        userId: user._id
      });

      // Update lastProcessedAt timestamp on successful processing
      await BankConnectionHelpers.updateActivityTimestamps(connectionId, { processedAt: new Date() });

      // Clear any previous error status on success
      await BankConnectionsCollection.updateAsync(connectionId, {
        $set: { status: 'connected', lastError: null }
      });

      return {
        success: true,
        positions: {
          filename,
          fileDate,
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          soldPositions: soldPositionsCount,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : undefined,
          errors
        },
        operations: operationsResult
      };

    } catch (error) {
      console.error(`[BANK_POSITIONS] Processing failed: ${error.message}`);

      // Update connection status with error (if not already set by SG pipeline)
      try {
        await BankConnectionsCollection.updateAsync(connectionId, {
          $set: { status: 'error', lastError: error.message }
        });
      } catch (updateErr) {
        console.error(`[BANK_POSITIONS] Failed to update connection error status: ${updateErr.message}`);
      }

      // Log failure
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_positions',
        status: 'failed',
        error: error.message,
        userId: user._id
      });

      // Re-throw with the original error code if it's a Meteor.Error, otherwise wrap it
      if (error.error) {
        throw error; // Already a Meteor.Error with specific code
      }
      throw new Meteor.Error('processing-failed', error.message);
    }
  },

  /**
   * Reprocess ALL operation/transaction files for a connection (superadmin only).
   *
   * Rebuilds the bank's transaction history from the source files. Needed after the
   * operations dedup-key fix: existing operations were stored under a key that collapsed
   * all same-day trades of a portfolio into one record. This re-parses every operation
   * file (ignoring the seen-file markers), clears the bank's existing operations, and
   * re-imports with the corrected per-transaction key. Positions/holdings are untouched.
   */
  async 'bankPositions.reprocessOperations'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);
    this.unblock();

    // Superadmin only — this rebuilds a bank's whole transaction history.
    const user = await validateAdminSession(sessionId);
    if (!user || user.role !== 'superadmin') {
      throw new Meteor.Error('not-authorized', 'Superadmin privileges required');
    }

    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) throw new Meteor.Error('not-found', 'Connection not found');
    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) throw new Meteor.Error('not-found', 'Bank not found');

    // Resolve the bank files folder exactly as processLatest does: local connections use the
    // configured folder; SFTP connections use the sanitized bank name (e.g. "CMB Monaco" ->
    // "cmb-monaco"). localFolderName is null for SFTP, so never fall back to connectionName.
    const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
    let bankFolderPath;
    if (connection.connectionType === 'local' && connection.localFolderName) {
      bankFolderPath = path.join(bankfilesRoot, connection.localFolderName);
    } else {
      const sanitizedBankName = bank.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      bankFolderPath = path.join(bankfilesRoot, sanitizedBankName);
    }

    // 1. Parse ALL operation files first (ignore seen markers). Do this BEFORE clearing so a
    //    parse failure never leaves the bank with no operations.
    const parseResult = BankOperationParser.parseAllFiles(bankFolderPath, {
      bankId: connection.bankId,
      bankName: bank.name,
      userId: null,
      seenFiles: []
    });
    if (parseResult.error) throw new Meteor.Error('parse-error', parseResult.error);
    const operations = parseResult.operations || [];

    // 2. Clear the bank's existing operations (stored under the old collapsed key).
    const cleared = await PMSOperationsCollection.removeAsync({ bankId: connection.bankId });

    // 3. Re-import with entity/userId matching and the corrected unique key.
    const portfolioEntityMap = await buildPortfolioEntityMap(connection.bankId);
    let opNew = 0, opUpdated = 0, opSkipped = 0, opUnmapped = 0;
    for (const operation of operations) {
      try {
        const mapping = getEntityIdFromMap(operation.portfolioCode, portfolioEntityMap);
        if (!mapping.entityId && !mapping.userId) { opUnmapped++; opSkipped++; continue; }
        if (mapping.entityId) operation.entityId = mapping.entityId;
        if (mapping.userId) operation.userId = mapping.userId;
        operation.connectionId = connectionId;
        operation.sourceFilePath = path.join(bankFolderPath, operation.sourceFile || 'unknown');
        const result = await PMSOperationsHelpers.upsertOperation(operation);
        if (result.updated) opUpdated++; else opNew++;
      } catch (e) {
        opSkipped++;
      }
    }

    // 4. Record the processed files as seen so normal syncs don't re-read them.
    const processedFiles = (parseResult.processedFiles || []).map(f => (typeof f === 'string' ? f : (f.filename || String(f))));
    await BankConnectionsCollection.updateAsync(connectionId, { $set: { seenOperationFiles: processedFiles } });

    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName,
      action: 'reprocess_operations',
      status: 'success',
      message: `Reprocessed operations: cleared ${cleared}, parsed ${operations.length} → ${opNew} new, ${opUpdated} merged, ${opSkipped} skipped (${opUnmapped} unmapped)`,
      userId: user._id
    });

    return { success: true, cleared, parsed: operations.length, opNew, opUpdated, opSkipped, opUnmapped, filesProcessed: processedFiles.length };
  },

  /**
   * Realign bankAccounts.referenceCurrency with the currency holdings are actually stored in
   * (superadmin only).
   *
   * Each holding's marketValue is converted by the parser into the holding's portfolioCurrency,
   * which is therefore the only currency that matches the displayed numbers. bankAccounts
   * .referenceCurrency is independent metadata that can drift (e.g. 302894.001 stored "USD" while
   * its holdings are EUR) and still feeds order-currency defaults and negative-cash checks. For
   * every account whose latest holdings share ONE portfolioCurrency that differs from a
   * referenceCurrency record, this updates that record. Mixed-currency portfolios are skipped and
   * reported for manual review. Read-only dry run unless apply=true. Holdings are never touched.
   */
  async 'bankAccounts.fixReferenceCurrencies'({ sessionId, apply = false } = {}) {
    check(sessionId, String);
    check(apply, Boolean);
    this.unblock();

    const user = await validateAdminSession(sessionId);
    if (!user || user.role !== 'superadmin') {
      throw new Meteor.Error('not-authorized', 'Superadmin privileges required');
    }

    // The single portfolioCurrency of an account's latest holdings, or null if absent/mixed.
    const holdingsCurrencyByAccount = await PMSHoldingsCollection.rawCollection().aggregate([
      { $match: { isLatest: true, portfolioCode: { $ne: null }, portfolioCurrency: { $ne: null } } },
      { $group: { _id: '$portfolioCode', currencies: { $addToSet: '$portfolioCurrency' } } }
    ]).toArray();

    const singleCurrencyMap = new Map();   // portfolioCode -> currency
    const mixedAccounts = [];
    for (const row of holdingsCurrencyByAccount) {
      if (row.currencies.length === 1) singleCurrencyMap.set(row._id, row.currencies[0]);
      else mixedAccounts.push({ portfolioCode: row._id, currencies: row.currencies });
    }

    const changes = [];
    for (const [accountNumber, holdingsCurrency] of singleCurrencyMap) {
      // Cover ALL records for this accountNumber (legacy-userId + entity duplicates).
      const records = await BankAccountsCollection.find({ accountNumber }).fetchAsync();
      for (const rec of records) {
        if (rec.referenceCurrency !== holdingsCurrency) {
          changes.push({ _id: rec._id, accountNumber, from: rec.referenceCurrency || null, to: holdingsCurrency });
        }
      }
    }

    if (apply) {
      for (const c of changes) {
        await BankAccountsCollection.updateAsync(c._id, { $set: { referenceCurrency: c.to } });
        console.log(`[fixReferenceCurrencies] ${c.accountNumber} (${c._id}): ${c.from} -> ${c.to}`);
      }
    }

    return {
      success: true,
      applied: apply,
      changedCount: changes.length,
      changes,
      skippedMixed: mixedAccounts
    };
  },

  /**
   * Get available position files for a connection
   */
  async 'bankPositions.getAvailableFiles'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    // Get connection and bank
    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    // Sanitize bank name
    const sanitizedBankName = bank.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    const bankFolderPath = path.join(process.cwd(), 'bankfiles', sanitizedBankName);

    // Find all position files
    const files = BankPositionParser.findPositionFiles(bankFolderPath);

    return {
      files: files.map(f => ({
        filename: f.filename,
        fileDate: f.fileDate,
        fileSize: f.fileSize,
        bankParser: f.bankParser
      })),
      directory: sanitizedBankName
    };
  },

  /**
   * Get holdings summary for a portfolio
   */
  async 'bankPositions.getPortfolioSummary'({ portfolioCode, bankId, sessionId }) {
    check(portfolioCode, String);
    check(bankId, Match.Optional(String));
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    const summary = await PMSHoldingsHelpers.getHoldingsSummary(portfolioCode);

    return {
      portfolioCode,
      summary,
      totalPositions: summary.length,
      totalMarketValue: summary.reduce((sum, s) => sum + (s.totalMarketValue || 0), 0)
    };
  },

  /**
   * Get latest holdings for a portfolio
   */
  async 'bankPositions.getLatestHoldings'({ portfolioCode, bankId, sessionId }) {
    check(portfolioCode, String);
    check(bankId, Match.Optional(String));
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    const holdings = await PMSHoldingsHelpers.getLatestHoldings(portfolioCode, bankId);

    return {
      portfolioCode,
      holdings,
      totalPositions: holdings.length,
      fileDate: holdings.length > 0 ? holdings[0].fileDate : null
    };
  },

  /**
   * Get dates that have files available but haven't been processed into PMSHoldings
   * Used for detecting gaps when bank files were missed
   */
  async 'bankPositions.getMissingDates'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);
    this.unblock();

    const user = await validateAdminSession(sessionId);

    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    // Build path to bank files
    const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
    let bankFolderPath;
    if (connection.connectionType === 'local' && connection.localFolderName) {
      bankFolderPath = path.join(bankfilesRoot, connection.localFolderName);

      // Special handling for Societe Generale: use decrypted folder
      const isSocieteGenerale = bank.name?.toLowerCase().includes('société générale') ||
                                 bank.name?.toLowerCase().includes('societe generale') ||
                                 bank.name?.toLowerCase().includes('sg monaco') ||
                                 connection.localFolderName?.includes('sg/');

      if (isSocieteGenerale) {
        const baseDir = path.dirname(connection.localFolderName);
        bankFolderPath = path.join(bankfilesRoot, baseDir, 'decrypted');
      }
    } else {
      const sanitizedBankName = bank.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      bankFolderPath = path.join(bankfilesRoot, sanitizedBankName);
    }

    // Get all available file dates from the directory
    const availableDates = BankPositionParser.getAvailableFileDates(bankFolderPath);

    if (availableDates.length === 0) {
      return { missingDates: [], availableDates: [], processedDates: [], connectionId };
    }

    // Get all processed FILE dates from PMSHoldings for this bank
    // Note: We compare against fileDate (from filename) not snapshotDate (from content)
    // because some banks (like CFM) name files with tomorrow's date but contain today's data
    // We use rawCollection for distinct() since Meteor's collection doesn't have it
    const processedFileDates = await PMSHoldingsCollection.rawCollection().distinct(
      'fileDate',
      { bankId: connection.bankId, isLatest: true }
    );

    // Normalize processed dates to YYYY-MM-DD strings for comparison
    const processedDateStrings = new Set(
      processedFileDates.map(d => new Date(d).toISOString().split('T')[0])
    );

    // Find missing dates (available in files but not processed)
    const missingDates = availableDates.filter(date => {
      const dateStr = date.toISOString().split('T')[0];
      return !processedDateStrings.has(dateStr);
    });

    console.log(`[BANK_POSITIONS] getMissingDates for ${connection.connectionName}: ${availableDates.length} file dates, ${processedFileDates.length} processed, ${missingDates.length} missing`);

    return {
      missingDates: missingDates.map(d => d.toISOString()),
      availableDates: availableDates.map(d => d.toISOString()),
      processedDates: Array.from(processedDateStrings),
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName
    };
  },

  /**
   * Process files for a specific date
   * Used for processing historical/missed dates
   */
  async 'bankPositions.processDate'({ connectionId, targetDate, sessionId }) {
    check(connectionId, String);
    check(targetDate, String); // ISO date string
    check(sessionId, String);
    this.unblock();

    const user = await validateAdminSession(sessionId);

    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    const dateToProcess = new Date(targetDate);
    const dateStr = dateToProcess.toISOString().split('T')[0];

    console.log(`[BANK_POSITIONS] Processing historical date ${dateStr} for: ${connection.connectionName}`);

    // Log processing start
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName,
      action: 'process_historical',
      status: 'started',
      message: `Historical processing for ${dateStr} started by ${user.username}`,
      metadata: { targetDate: dateStr },
      userId: user._id
    });

    try {
      // Build path
      const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
      let bankFolderPath;
      if (connection.connectionType === 'local' && connection.localFolderName) {
        bankFolderPath = path.join(bankfilesRoot, connection.localFolderName);

        // Special handling for Societe Generale: use decrypted folder
        const isSocieteGenerale = bank.name?.toLowerCase().includes('société générale') ||
                                   bank.name?.toLowerCase().includes('societe generale') ||
                                   bank.name?.toLowerCase().includes('sg monaco') ||
                                   connection.localFolderName?.includes('sg/');

        if (isSocieteGenerale) {
          const baseDir = path.dirname(connection.localFolderName);
          bankFolderPath = path.join(bankfilesRoot, baseDir, 'decrypted');
          console.log(`[BANK_POSITIONS] SG detected - using decrypted folder: ${bankFolderPath}`);
        }
      } else {
        const sanitizedBankName = bank.name
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        bankFolderPath = path.join(bankfilesRoot, sanitizedBankName);
      }

      // Parse files for the specific date using the new method
      const { refreshReferenceCurrencyOverrides } = await import('../helpers/referenceCurrencyOverrides.js');
      await refreshReferenceCurrencyOverrides();
      const parseResult = BankPositionParser.parseFilesForDate(bankFolderPath, dateToProcess, {
        bankId: connection.bankId,
        bankName: bank.name,
        userId: null
      });

      if (parseResult.error) {
        throw new Meteor.Error('no-files', parseResult.error);
      }

      const { positions, filename, fileDate, totalRecords } = parseResult;

      console.log(`[BANK_POSITIONS] Parsed ${totalRecords} positions for ${dateStr} from ${filename}`);

      // Process positions (same logic as processLatest)
      let newRecords = 0;
      let updatedRecords = 0;
      let unchangedRecords = 0;
      let skippedRecords = 0;
      let unmappedPositions = 0;
      const errors = [];
      const unmappedPortfolioCodes = new Set();
      const processedUniqueKeys = new Set();
      const processedPortfolioCodes = new Set();
      // Track what we wrote per (portfolio, snapshot day) for stale-uniqueKey reconciliation
      const writtenSnapshots = new Map();

      // In-memory cache for enrichment during this file's processing
      const enrichmentCache = new Map();

      // Build portfolio → entity/user map (single DB query)
      const portfolioEntityMap = await buildPortfolioEntityMap(connection.bankId);
      console.log(`[BANK_POSITIONS] Built portfolio map with ${portfolioEntityMap.size} accounts for historical processing`);

      for (let i = 0; i < positions.length; i++) {
        await yieldToEventLoop(i, 25);
        const position = positions[i];
        try {
          // Match portfolio code to bank account (entity-primary, userId fallback)
          const histAccountMapping = getEntityIdFromMap(position.portfolioCode, portfolioEntityMap);

          if (!histAccountMapping.entityId && !histAccountMapping.userId) {
            unmappedPortfolioCodes.add(position.portfolioCode);
            unmappedPositions++;
            skippedRecords++;
            continue;
          }

          if (histAccountMapping.entityId) {
            position.entityId = histAccountMapping.entityId;
          }
          if (histAccountMapping.userId) {
            position.userId = histAccountMapping.userId;
          }
          position.connectionId = connectionId;
          position.sourceFilePath = path.join(bankFolderPath, filename);

          // Auto-enrich with internal product data if ISIN matches
          if (position.isin) {
            try {
              // Check cached enrichment first (avoids redundant DB queries)
              let productInfo = await getCachedEnrichment(position.isin, enrichmentCache);

              if (!productInfo) {
                // Fresh lookup needed - either never enriched or product was updated
                const { ISINClassifierHelpers } = await import('../../imports/api/isinClassifier.js');
                productInfo = await ISINClassifierHelpers.extractProductClassification(position.isin);

                // Cache for other positions in same file
                if (productInfo) {
                  enrichmentCache.set(position.isin, productInfo);
                }
              }

              if (productInfo && (productInfo.source === 'internal_product' || productInfo.source === 'cached')) {
                if (productInfo.source === 'cached') {
                  console.log(`[BANK_POSITIONS] Using cached enrichment for ${position.isin}: ${productInfo.data.securityName}`);
                } else {
                  console.log(`[BANK_POSITIONS] Auto-enriching ${position.isin} from internal product DB: ${productInfo.data.securityName}`);
                }

                // ALWAYS override with Ambervision product title for internal products
                position.securityName = productInfo.data.securityName;
                position.assetClass = productInfo.data.assetClass || 'structured_product';

                // CRITICAL: Also set securityType from assetClass if not already set
                // This prevents raw bank codes (e.g., "19", "13") from being stored
                if (!position.securityType || !isValidSecurityType(position.securityType)) {
                  const { getSecurityTypeFromAssetClass } = await import('../../imports/api/constants/instrumentTypes.js');
                  position.securityType = getSecurityTypeFromAssetClass(position.assetClass);
                  console.log(`[BANK_POSITIONS] Set securityType from assetClass: ${position.assetClass} -> ${position.securityType}`);
                }

                // Store product metadata in bankSpecificData
                position.bankSpecificData = position.bankSpecificData || {};
                position.bankSpecificData.productType = productInfo.data.productType;
                position.bankSpecificData.issuer = productInfo.data.issuer;
                position.bankSpecificData.structuredProductUnderlyingType = productInfo.data.structuredProductUnderlyingType;
                position.bankSpecificData.structuredProductProtectionType = productInfo.data.structuredProductProtectionType;
                position.bankSpecificData.autoEnriched = true;
                position.bankSpecificData.enrichedAt = new Date();
                position.bankSpecificData.ambervisionTitle = productInfo.data.securityName;
              }
            } catch (enrichError) {
              console.error(`[BANK_POSITIONS] Error enriching position: ${enrichError.message}`);
            }
          }

          // CENTRALIZED CLASSIFICATION: Use SecurityResolver for all positions
          if (position.isin) {
            try {
              const alreadyEnriched = position.bankSpecificData?.autoEnriched === true;

              if (!alreadyEnriched) {
                const classification = await SecurityResolver.resolveSecurityType(
                  position.isin,
                  {
                    securityName: position.securityName,
                    currency: position.currency
                  }
                );

                if (classification && classification.isClassified) {
                  position.securityType = classification.securityType;
                  position.assetClass = classification.assetClass;
                  position.structuredProductUnderlyingType = classification.structuredProductUnderlyingType || '';
                  position.structuredProductProtectionType = classification.structuredProductProtectionType || '';

                  position.bankSpecificData = position.bankSpecificData || {};
                  position.bankSpecificData.classificationSource = classification.classificationSource || 'securities_metadata';
                  position.bankSpecificData.classificationConfidence = classification.confidence;
                }
              }
            } catch (classifyError) {
              console.error(`[BANK_POSITIONS] SecurityResolver error for ${position.isin}: ${classifyError.message}`);
            }
          }

          // Upsert position
          const result = await PMSHoldingsHelpers.upsertHolding(position);

          // Track for sold position detection
          const trackingUniqueKey = position.uniqueKey || PMSHoldingsHelpers.generateUniqueKey({
            bankId: connection.bankId,
            portfolioCode: position.portfolioCode,
            isin: position.isin,
            currency: position.currency,
            securityType: position.securityType,
            endDate: position.bankSpecificData?.instrumentDates?.endDate || position.bankSpecificData?.endDate,
            reference: position.bankSpecificData?.instrumentDates?.reference || position.bankSpecificData?.reference
          });
          if (trackingUniqueKey) {
            processedUniqueKeys.add(trackingUniqueKey);
          }
          if (position.portfolioCode && position.userId) {
            processedPortfolioCodes.add(position.portfolioCode);
          }

          // Record the key actually written, for stale-uniqueKey reconciliation below
          trackWrittenSnapshot(writtenSnapshots, position, result.uniqueKey);

          if (result.isNew) {
            newRecords++;
          } else if (result.updated) {
            updatedRecords++;
          } else {
            unchangedRecords++;
          }
        } catch (error) {
          console.error(`[BANK_POSITIONS] Error saving position for ${dateStr}: ${error.message}`);
          errors.push({
            portfolio: position.portfolioCode,
            isin: position.isin,
            error: error.message
          });
          skippedRecords++;
        }
      }

      // STALE UNIQUEKEY RECONCILIATION: this is the path that reprocesses historical
      // dates, so it is the one that re-writes old snapshots under a new uniqueKey.
      // Retire the superseded records here, before snapshots are rebuilt from them —
      // otherwise the snapshot totals double-count every affected position.
      try {
        if (writtenSnapshots.size > 0) {
          const reconcile = await PMSHoldingsHelpers.reconcileSnapshotKeys({
            bankId: connection.bankId,
            written: writtenSnapshots
          });
          if (reconcile.recordsDeactivated > 0) {
            console.warn(
              `[BANK_POSITIONS] Stale uniqueKey duplicates cleared: ${reconcile.recordsDeactivated} record(s) ` +
              `across ${reconcile.groupsAffected} portfolio/day group(s)`
            );
          }
        }
      } catch (reconcileError) {
        console.error(`[BANK_POSITIONS] Stale uniqueKey reconciliation failed: ${reconcileError.message}`);
      }

      // Create portfolio snapshots (matched positions — userId or entity; entity-only
      // clients must still get snapshots).
      const positionsByPortfolio = positions
        .filter(pos => pos.userId || pos.entityId)
        .reduce((groups, pos) => {
          const portfolioCode = pos.portfolioCode || 'UNKNOWN';
          if (!groups[portfolioCode]) {
            groups[portfolioCode] = [];
          }
          groups[portfolioCode].push(pos);
          return groups;
        }, {});

      // Pre-fetch transfer operations ONCE for all portfolios (avoid repeated DB queries)
      const portfolioUserIds = [...new Set(Object.values(positionsByPortfolio).map(positions => positions[0]?.userId).filter(Boolean))];
      const transferOpsCache = await PMSOperationsCollection.find({
        userId: { $in: portfolioUserIds },
        operationType: 'TRANSFER',
        operationCategory: 'CASH'
      }).fetchAsync();

      for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
        try {
          const portfolioUserId = portfolioPositions[0].userId;

          await PortfolioSnapshotHelpers.createSnapshot({
            userId: portfolioUserId,
            entityId: portfolioPositions[0].entityId || null,
            bankId: connection.bankId,
            bankName: bank.name,
            connectionId,
            portfolioCode,
            accountNumber: portfolioPositions[0].accountNumber || null,
            snapshotDate: fileDate,
            fileDate,
            sourceFile: filename,
            holdings: portfolioPositions,
            transferOpsCache  // Pass pre-fetched operations
          });
        } catch (snapshotError) {
          console.error(`[BANK_POSITIONS] Error creating snapshot for ${portfolioCode}: ${snapshotError.message}`);
        }
      }

      // CFM FX-FORWARD VALUE DATES: same enrichment as processLatest (no-op for non-CFM banks)
      try {
        const fxEnrich = await CFMParser.enrichFxForwardValueDates({
          PMSHoldingsCollection,
          PMSOperationsCollection,
          bankId: connection.bankId
        });
        if (fxEnrich.matched > 0) {
          console.log(`[BANK_POSITIONS] FX forward dates enriched (processDate): ${fxEnrich.matched}/${fxEnrich.total} legs`);
        }
      } catch (fxEnrichError) {
        console.error(`[BANK_POSITIONS] FX forward date enrichment failed: ${fxEnrichError.message}`);
      }

      // EDR TERM-DEPOSIT TERM LABEL: same enrichment as processLatest (no-op for non-EDR banks)
      try {
        const depEnrich = await EDRMonacoParser.enrichTermDepositMaturity({
          PMSHoldingsCollection,
          PMSOperationsCollection,
          bankId: connection.bankId
        });
        if (depEnrich.matched > 0) {
          console.log(`[BANK_POSITIONS] EDR term-deposit terms enriched (processDate): ${depEnrich.matched}/${depEnrich.total}`);
        }
      } catch (depEnrichError) {
        console.error(`[BANK_POSITIONS] EDR term-deposit enrichment failed: ${depEnrichError.message}`);
      }

      // Log success
      const logMessage = `Historical processing for ${dateStr}: ${newRecords} new, ${updatedRecords} updated` +
        (unmappedPositions > 0 ? `, ${unmappedPositions} skipped` : '');

      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_historical',
        status: 'success',
        message: logMessage,
        metadata: {
          targetDate: dateStr,
          filename,
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : undefined
        },
        userId: user._id
      });

      console.log(`[BANK_POSITIONS] Historical processing for ${dateStr} complete: ${newRecords} new, ${updatedRecords} updated`);

      return {
        success: true,
        targetDate: dateStr,
        filename,
        fileDate,
        totalRecords,
        newRecords,
        updatedRecords,
        unchangedRecords,
        skippedRecords,
        unmappedPositions,
        errors
      };

    } catch (error) {
      console.error(`[BANK_POSITIONS] Historical processing failed for ${dateStr}: ${error.message}`);

      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'process_historical',
        status: 'failed',
        error: error.message,
        metadata: { targetDate: dateStr },
        userId: user._id
      });

      throw new Meteor.Error('processing-failed', error.message);
    }
  },

  /**
   * Process all missing dates for a connection in chronological order
   * Automatically detects gaps and processes each missing date
   */
  async 'bankPositions.processMissingDates'({ connectionId, sessionId, maxDates = 30 }) {
    check(connectionId, String);
    check(sessionId, String);
    check(maxDates, Match.Optional(Number));
    this.unblock();

    const user = await validateAdminSession(sessionId);

    // Get missing dates
    const { missingDates, connectionName } = await Meteor.callAsync('bankPositions.getMissingDates', {
      connectionId,
      sessionId
    });

    if (missingDates.length === 0) {
      console.log(`[BANK_POSITIONS] No missing dates for connection ${connectionId}`);
      return { success: true, processedCount: 0, failedCount: 0, missingCount: 0, remainingCount: 0, results: [] };
    }

    console.log(`[BANK_POSITIONS] Found ${missingDates.length} missing dates for ${connectionName}, processing up to ${maxDates}`);

    // Limit the number of dates to process
    const datesToProcess = missingDates.slice(0, maxDates);

    // Process dates SEQUENTIALLY to avoid race conditions
    // Parallel processing caused duplicate version writes for the same holdings
    console.log(`[BANK_POSITIONS] Processing ${datesToProcess.length} missing dates sequentially`);

    const results = [];
    for (let i = 0; i < datesToProcess.length; i++) {
      await yieldToEventLoop(i, 1);
      const dateStr = datesToProcess[i];
      try {
        console.log(`[BANK_POSITIONS] Processing missing date: ${dateStr}`);

        const result = await Meteor.callAsync('bankPositions.processDate', {
          connectionId,
          targetDate: dateStr,
          sessionId
        });

        results.push({
          date: dateStr,
          success: true,
          newRecords: result.newRecords,
          updatedRecords: result.updatedRecords,
          totalRecords: result.totalRecords
        });

      } catch (error) {
        console.error(`[BANK_POSITIONS] Failed to process ${dateStr}: ${error.message}`);
        results.push({
          date: dateStr,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    console.log(`[BANK_POSITIONS] Missing dates processing complete: ${successCount} succeeded, ${failCount} failed, ${Math.max(0, missingDates.length - maxDates)} remaining`);

    return {
      success: true,
      processedCount: successCount,
      failedCount: failCount,
      missingCount: missingDates.length,
      remainingCount: Math.max(0, missingDates.length - maxDates),
      results
    };
  },

  /**
   * TEST METHOD: Process Julius Baer files directly from bankfiles/julius-baer/
   * Does not require a bank connection - for testing purposes only
   */
  async 'bankPositions.testProcessJuliusBaer'({ sessionId }) {
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    console.log(`[BANK_POSITIONS_TEST] Testing Julius Baer position processing`);

    // Log processing start
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId: 'TEST',
      bankId: 'TEST_JULIUS_BAER',
      connectionName: 'Julius Baer Test',
      action: 'test_process_positions',
      status: 'started',
      message: `Test position processing started by ${user.username}`,
      userId: user._id
    });

    try {
      // Build path to bank files directory
      // Use environment variable for persistent storage, fallback to process.cwd()
      const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
      const bankFolderPath = path.join(bankfilesRoot, 'julius-baer');

      console.log(`[BANK_POSITIONS_TEST] Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[BANK_POSITIONS_TEST] Current working directory: ${process.cwd()}`);
      console.log(`[BANK_POSITIONS_TEST] Scanning directory: ${bankFolderPath}`);

      // Parse latest file (without userId - will be matched later)
      const parseResult = BankPositionParser.parseLatestFile(bankFolderPath, {
        bankId: 'TEST_JULIUS_BAER',
        bankName: 'Julius Baer (Test)',
        userId: null  // Will be matched to bank accounts
      });

      if (parseResult.error) {
        throw new Meteor.Error('no-files', parseResult.error);
      }

      const { positions, filename, fileDate, totalRecords } = parseResult;

      console.log(`[BANK_POSITIONS_TEST] Parsed ${totalRecords} positions from ${filename}`);

      // Save positions to database with automatic account matching
      let newRecords = 0;
      let updatedRecords = 0;
      let unchangedRecords = 0;
      let skippedRecords = 0;
      let unmappedPositions = 0;
      const errors = [];
      const unmappedPortfolioCodes = new Set();

      for (const position of positions) {
        try {
          // Match portfolio code to bank account to find userId
          const userId = await findUserIdForPortfolioCode(position.portfolioCode, 'TEST_JULIUS_BAER');

          if (!userId) {
            // Skip positions without matching account
            console.log(`[BANK_POSITIONS_TEST] Skipping unmapped position: portfolio=${position.portfolioCode}, isin=${position.isin}`);
            unmappedPortfolioCodes.add(position.portfolioCode);
            unmappedPositions++;
            skippedRecords++;
            continue;
          }

          // Set the matched userId
          position.userId = userId;

          // Add test connection ID and source file path
          position.connectionId = 'TEST';
          position.sourceFilePath = path.join(bankFolderPath, filename);

          // CENTRALIZED CLASSIFICATION: Use SecurityResolver for all positions
          if (position.isin) {
            try {
              const classification = await SecurityResolver.resolveSecurityType(
                position.isin,
                {
                  securityName: position.securityName,
                  currency: position.currency
                }
              );

              if (classification && classification.isClassified) {
                position.securityType = classification.securityType;
                position.assetClass = classification.assetClass;
                position.structuredProductUnderlyingType = classification.structuredProductUnderlyingType || '';
                position.structuredProductProtectionType = classification.structuredProductProtectionType || '';

                position.bankSpecificData = position.bankSpecificData || {};
                position.bankSpecificData.classificationSource = classification.classificationSource || 'securities_metadata';
              }
            } catch (classifyError) {
              console.error(`[BANK_POSITIONS_TEST] SecurityResolver error: ${classifyError.message}`);
            }
          }

          // Upsert position
          const result = await PMSHoldingsHelpers.upsertHolding(position);

          if (result.isNew) {
            newRecords++;
          } else if (result.updated) {
            updatedRecords++;
          } else {
            unchangedRecords++;
          }
        } catch (error) {
          console.error(`[BANK_POSITIONS_TEST] Error saving position: ${error.message}`);
          errors.push({
            portfolio: position.portfolioCode,
            isin: position.isin,
            error: error.message
          });
          skippedRecords++;
        }
      }

      // Create portfolio snapshots for each portfolio (only for matched positions with userId)
      console.log(`[BANK_POSITIONS_TEST] Creating portfolio snapshots...`);

      // Group positions by portfolio code (matched positions — linked to a legacy userId
      // OR a client entity). Entity-only clients (created directly as entities, no legacy
      // userId) must still get snapshots.
      const positionsByPortfolio = positions
        .filter(pos => pos.userId || pos.entityId) // matched positions (userId or entity)
        .reduce((groups, pos) => {
          const portfolioCode = pos.portfolioCode || 'UNKNOWN';
          if (!groups[portfolioCode]) {
            groups[portfolioCode] = [];
          }
          groups[portfolioCode].push(pos);
          return groups;
        }, {});

      // Pre-fetch transfer operations ONCE for all portfolios (avoid repeated DB queries)
      const portfolioUserIds = [...new Set(Object.values(positionsByPortfolio).map(positions => positions[0]?.userId).filter(Boolean))];
      const transferOpsCache = await PMSOperationsCollection.find({
        userId: { $in: portfolioUserIds },
        operationType: 'TRANSFER',
        operationCategory: 'CASH'
      }).fetchAsync();

      // Create snapshot for each portfolio
      for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
        try {
          // Use userId from the positions (all positions in a portfolio belong to same user)
          const portfolioUserId = portfolioPositions[0].userId;

          await PortfolioSnapshotHelpers.createSnapshot({
            userId: portfolioUserId,
            bankId: 'TEST_JULIUS_BAER',
            bankName: 'Julius Baer (Test)',
            connectionId: 'TEST',
            portfolioCode,
            accountNumber: portfolioPositions[0].accountNumber || null,
            snapshotDate: fileDate,
            fileDate,
            sourceFile: filename,
            holdings: portfolioPositions,
            transferOpsCache  // Pass pre-fetched operations
          });
        } catch (snapshotError) {
          console.error(`[BANK_POSITIONS_TEST] Error creating snapshot for ${portfolioCode}: ${snapshotError.message}`);
        }
      }

      // CHECK ALLOCATION LIMITS after creating snapshots (TEST)
      console.log(`[BANK_POSITIONS_TEST] Checking allocation limits against investment profiles...`);
      try {
        for (const [portfolioCode, portfolioPositions] of Object.entries(positionsByPortfolio)) {
          const portfolioUserId = portfolioPositions[0].userId;

          // Find the bank account for this portfolio
          const testBankAccount = await BankAccountsCollection.findOneAsync({
            accountNumber: portfolioCode.split('-')[0],
            bankId: 'TEST_JULIUS_BAER',
            isActive: true
          });

          if (!testBankAccount) continue;

          // Get the account profile
          const accountProfile = await AccountProfilesCollection.findOneAsync({
            bankAccountId: testBankAccount._id
          });

          if (!accountProfile) continue;

          // Get the latest snapshot
          const snapshot = await PortfolioSnapshotsCollection.findOneAsync({
            userId: portfolioUserId,
            portfolioCode,
            bankId: 'TEST_JULIUS_BAER'
          }, { sort: { snapshotDate: -1 } });

          if (!snapshot || !snapshot.assetClassBreakdown || !snapshot.totalAccountValue) continue;

          // Calculate current allocation
          const allocation = aggregateToFourCategories(snapshot.assetClassBreakdown, snapshot.totalAccountValue);

          // Check for breaches
          const breaches = [];

          if (allocation.cash > accountProfile.maxCash) {
            breaches.push({ category: 'Cash', current: allocation.cash.toFixed(1), limit: accountProfile.maxCash });
          }
          if (allocation.bonds > accountProfile.maxBonds) {
            breaches.push({ category: 'Bonds', current: allocation.bonds.toFixed(1), limit: accountProfile.maxBonds });
          }
          if (allocation.equities > accountProfile.maxEquities) {
            breaches.push({ category: 'Equities', current: allocation.equities.toFixed(1), limit: accountProfile.maxEquities });
          }
          if (allocation.alternative > accountProfile.maxAlternative) {
            breaches.push({ category: 'Alternative', current: allocation.alternative.toFixed(1), limit: accountProfile.maxAlternative });
          }

          if (breaches.length > 0) {
            console.log(`[ALLOCATION_BREACH_TEST] Account ${testBankAccount.accountNumber} has ${breaches.length} breaches`);

            const client = await UsersCollection.findOneAsync(portfolioUserId);
            const clientName = client?.profile?.firstName && client?.profile?.lastName
              ? `${client.profile.firstName} ${client.profile.lastName}`
              : client?.email || 'Unknown';

            const breachDetails = breaches.map(b => `${b.category}: ${b.current}% (limit: ${b.limit}%)`).join(', ');

            await NotificationHelpers.create({
              userId: user._id,
              type: 'warning',
              title: 'Allocation Limit Breached',
              message: `${clientName}'s account Julius Baer ${testBankAccount.accountNumber} exceeds investment profile limits.\n\n${breachDetails}`,
              metadata: {
                bankAccountId: testBankAccount._id,
                portfolioCode,
                clientId: portfolioUserId,
                clientName,
                breaches,
                allocation
              },
              eventType: 'allocation_breach'
            });

            // Also notify the client's relationship managers (account, entity or legacy login)
            const { resolveClientRmIds } = await import('/imports/api/notificationService.js');
            const breachRmIds = (await resolveClientRmIds({ clientIds: [portfolioUserId, testBankAccount.entityId], bankAccountIds: [testBankAccount._id] }))
              .filter(id => id !== user._id);
            for (const rmId of breachRmIds) {
              await NotificationHelpers.create({
                userId: rmId,
                type: 'warning',
                title: 'Allocation Limit Breached',
                message: `${clientName}'s account Julius Baer ${testBankAccount.accountNumber} exceeds investment profile limits.\n\n${breachDetails}`,
                metadata: {
                  bankAccountId: testBankAccount._id,
                  portfolioCode,
                  clientId: portfolioUserId,
                  clientName,
                  breaches,
                  allocation
                },
                eventType: 'allocation_breach'
              });
            }
          } else {
            await NotificationHelpers.resolveUserNotifications('allocation_breach', {
              bankAccountId: testBankAccount._id
            });
          }
        }
      } catch (breachCheckError) {
        console.error(`[BANK_POSITIONS_TEST] Error checking allocation limits: ${breachCheckError.message}`);
      }

      // Log success
      const testLogMessage = unmappedPositions > 0
        ? `TEST: Processed ${totalRecords} positions: ${newRecords} new, ${updatedRecords} updated, ${unchangedRecords} unchanged, ${unmappedPositions} skipped (unmapped)`
        : `TEST: Processed ${totalRecords} positions: ${newRecords} new, ${updatedRecords} updated, ${unchangedRecords} unchanged`;

      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId: 'TEST',
        bankId: 'TEST_JULIUS_BAER',
        connectionName: 'Julius Baer Test',
        action: 'test_process_positions',
        status: 'success',
        message: testLogMessage,
        metadata: {
          filename,
          fileDate: fileDate.toISOString(),
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          unmappedPositions,
          unmappedPortfolioCodes: unmappedPositions > 0 ? Array.from(unmappedPortfolioCodes) : undefined,
          errors: errors.length > 0 ? errors : undefined
        },
        userId: user._id
      });

      if (unmappedPositions > 0) {
        console.log(
          `[BANK_POSITIONS_TEST] WARNING: ${unmappedPositions} positions skipped due to unmapped portfolio codes: ${Array.from(unmappedPortfolioCodes).join(', ')}`
        );
      }

      console.log(
        `[BANK_POSITIONS_TEST] Processing complete: ` +
        `${newRecords} new, ${updatedRecords} updated, ${unchangedRecords} unchanged, ${skippedRecords} skipped`
      );

      // AUTO-LINK holdings to products and allocations
      console.log(`[PMS_AUTO_LINK_TEST] Starting auto-linking for bankId=TEST_JULIUS_BAER, fileDate=${fileDate.toISOString()}`);
      try {
        const linkingResult = await Meteor.callAsync('pmsHoldings.autoLinkOnImport', {
          bankId: 'TEST_JULIUS_BAER',
          fileDate
        });

        if (linkingResult.success) {
          console.log(
            `[PMS_AUTO_LINK_TEST] Auto-linking complete: ` +
            `${linkingResult.linked} linked, ${linkingResult.noMatch} no match, ${linkingResult.failed} failed`
          );

          // Log auto-linking summary
          await BankConnectionLogHelpers.logConnectionAttempt({
            connectionId: 'TEST',
            bankId: 'TEST_JULIUS_BAER',
            connectionName: 'Julius Baer Test',
            action: 'auto_link_holdings',
            status: 'success',
            message: `Auto-linked ${linkingResult.linked} holdings to products/allocations`,
            metadata: {
              totalHoldings: linkingResult.total,
              linked: linkingResult.linked,
              noMatch: linkingResult.noMatch,
              failed: linkingResult.failed,
              fileDate: fileDate.toISOString()
            },
            userId: user._id
          });
        }
      } catch (linkingError) {
        console.error(`[PMS_AUTO_LINK_TEST] Auto-linking failed: ${linkingError.message}`);
        // Don't fail the import - linking can be done manually later
        await BankConnectionLogHelpers.logConnectionAttempt({
          connectionId: 'TEST',
          bankId: 'TEST_JULIUS_BAER',
          connectionName: 'Julius Baer Test',
          action: 'auto_link_holdings',
          status: 'failed',
          error: linkingError.message,
          userId: user._id
        });
      }

      // ALSO PROCESS OPERATIONS
      console.log(`[BANK_OPERATIONS_TEST] Processing operations from same directory`);

      let operationsResult = { totalRecords: 0, newRecords: 0, updatedRecords: 0, skippedRecords: 0, unmappedOperations: 0 };

      try {
        const operationsParseResult = BankOperationParser.parseLatestFile(bankFolderPath, {
          bankId: 'TEST_JULIUS_BAER',
          bankName: 'Julius Baer (Test)',
          userId: null  // Will be matched to bank accounts
        });

        if (!operationsParseResult.error && operationsParseResult.operations) {
          const { operations, filename: opFilename } = operationsParseResult;
          console.log(`[BANK_OPERATIONS_TEST] Parsed ${operations.length} operations from ${opFilename}`);

          let opNew = 0;
          let opUpdated = 0;
          let opSkipped = 0;
          let opUnmapped = 0;
          const opUnmappedPortfolioCodes = new Set();

          for (const operation of operations) {
            try {
              // Match portfolio code to bank account to find userId
              const userId = await findUserIdForPortfolioCode(operation.portfolioCode, 'TEST_JULIUS_BAER');

              if (!userId) {
                // Skip operations without matching account
                console.log(`[BANK_OPERATIONS_TEST] Skipping unmapped operation: portfolio=${operation.portfolioCode}, type=${operation.operationType}`);
                opUnmappedPortfolioCodes.add(operation.portfolioCode);
                opUnmapped++;
                opSkipped++;
                continue;
              }

              // Set the matched userId
              operation.userId = userId;

              operation.connectionId = 'TEST';
              operation.sourceFilePath = path.join(bankFolderPath, opFilename);

              const result = await PMSOperationsHelpers.upsertOperation(operation);

              if (result.updated) {
                opUpdated++;
              } else {
                opNew++;
              }
            } catch (error) {
              console.error(`[BANK_OPERATIONS_TEST] Error saving operation: ${error.message}`);
              opSkipped++;
            }
          }

          operationsResult = {
            totalRecords: operations.length,
            newRecords: opNew,
            updatedRecords: opUpdated,
            skippedRecords: opSkipped,
            unmappedOperations: opUnmapped,
            unmappedPortfolioCodes: opUnmapped > 0 ? Array.from(opUnmappedPortfolioCodes) : undefined,
            filename: opFilename
          };

          if (opUnmapped > 0) {
            console.log(
              `[BANK_OPERATIONS_TEST] WARNING: ${opUnmapped} operations skipped due to unmapped portfolio codes: ${Array.from(opUnmappedPortfolioCodes).join(', ')}`
            );
          }

          console.log(
            `[BANK_OPERATIONS_TEST] Operations complete: ` +
            `${opNew} new, ${opUpdated} updated, ${opSkipped} skipped`
          );
        } else {
          console.log(`[BANK_OPERATIONS_TEST] No operations file found or parse error`);
        }
      } catch (opError) {
        console.error(`[BANK_OPERATIONS_TEST] Operations processing error: ${opError.message}`);
      }

      return {
        success: true,
        positions: {
          filename,
          fileDate,
          totalRecords,
          newRecords,
          updatedRecords,
          unchangedRecords,
          skippedRecords,
          errors
        },
        operations: operationsResult
      };

    } catch (error) {
      console.error(`[BANK_POSITIONS_TEST] Processing failed: ${error.message}`);

      // Log failure
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId: 'TEST',
        bankId: 'TEST_JULIUS_BAER',
        connectionName: 'Julius Baer Test',
        action: 'test_process_positions',
        status: 'failed',
        error: error.message,
        userId: user._id
      });

      throw new Meteor.Error('processing-failed', error.message);
    }
  },

  /**
   * Get dates that have PMSHoldings data but no corresponding portfolioSnapshot
   * Used to detect missing snapshots that need to be regenerated
   */
  async 'bankPositions.getMissingSnapshotDates'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);
    this.unblock();

    const user = await validateAdminSession(sessionId);

    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    console.log(`[MISSING_SNAPSHOTS] Checking for missing snapshots for connection: ${connection.connectionName}`);

    // Get all unique snapshotDates from PMSHoldings for this bank
    // Group by userId and portfolioCode to match snapshot structure
    const holdingsDates = await PMSHoldingsCollection.rawCollection().aggregate([
      {
        $match: {
          bankId: connection.bankId,
          isLatest: true,  // Only check current versions
          userId: { $exists: true, $ne: null }  // Must have a mapped user
        }
      },
      {
        $group: {
          _id: {
            userId: '$userId',
            portfolioCode: '$portfolioCode',
            snapshotDate: {
              $dateToString: { format: '%Y-%m-%d', date: '$snapshotDate' }
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id.snapshotDate': 1 }
      }
    ]).toArray();

    console.log(`[MISSING_SNAPSHOTS] Found ${holdingsDates.length} unique (user, portfolio, date) combinations in PMSHoldings`);

    // Get all existing snapshot dates
    const existingSnapshots = await PortfolioSnapshotsCollection.rawCollection().aggregate([
      {
        $match: {
          bankId: connection.bankId
        }
      },
      {
        $group: {
          _id: {
            userId: '$userId',
            portfolioCode: '$portfolioCode',
            snapshotDate: {
              $dateToString: { format: '%Y-%m-%d', date: '$snapshotDate' }
            }
          }
        }
      }
    ]).toArray();

    // Create a set of existing snapshot keys for fast lookup
    const existingKeys = new Set(
      existingSnapshots.map(s => `${s._id.userId}|${s._id.portfolioCode}|${s._id.snapshotDate}`)
    );

    console.log(`[MISSING_SNAPSHOTS] Found ${existingKeys.size} existing snapshots`);

    // Find missing combinations
    const missingDates = holdingsDates
      .filter(h => !existingKeys.has(`${h._id.userId}|${h._id.portfolioCode}|${h._id.snapshotDate}`))
      .map(h => ({
        userId: h._id.userId,
        portfolioCode: h._id.portfolioCode,
        snapshotDate: h._id.snapshotDate,
        holdingsCount: h.count
      }));

    console.log(`[MISSING_SNAPSHOTS] Found ${missingDates.length} missing snapshot dates`);

    return {
      success: true,
      bankId: connection.bankId,
      totalHoldingsDates: holdingsDates.length,
      existingSnapshots: existingKeys.size,
      missingDates
    };
  },

  /**
   * Regenerate portfolio snapshots for dates that have PMSHoldings but no snapshot
   * This repairs gaps in the performance chart
   */
  async 'bankPositions.regenerateMissingSnapshots'({ connectionId, sessionId, maxDates = 30 }) {
    check(connectionId, String);
    check(sessionId, String);
    check(maxDates, Match.Maybe(Number));
    this.unblock();

    const user = await validateAdminSession(sessionId);

    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    // Get missing snapshot dates
    const { missingDates } = await Meteor.callAsync('bankPositions.getMissingSnapshotDates', {
      connectionId,
      sessionId
    });

    if (missingDates.length === 0) {
      console.log(`[REGENERATE_SNAPSHOTS] No missing snapshots to regenerate`);
      return {
        success: true,
        regenerated: 0,
        message: 'No missing snapshots'
      };
    }

    // Sort by date to process chronologically
    missingDates.sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

    // Limit the number of dates to process
    const datesToProcess = missingDates.slice(0, maxDates);

    console.log(`[REGENERATE_SNAPSHOTS] Regenerating ${datesToProcess.length} missing snapshots (of ${missingDates.length} total)`);

    // Pre-fetch transfer operations ONCE for all users to be processed
    const userIds = [...new Set(datesToProcess.map(d => d.userId))];
    const transferOpsCache = await PMSOperationsCollection.find({
      userId: { $in: userIds },
      operationType: 'TRANSFER',
      operationCategory: 'CASH'
    }).fetchAsync();

    let regenerated = 0;
    const errors = [];

    for (let i = 0; i < datesToProcess.length; i++) {
      await yieldToEventLoop(i, 5);
      const missing = datesToProcess[i];
      try {
        // Parse the date string back to a Date object
        const snapshotDate = new Date(missing.snapshotDate + 'T00:00:00.000Z');

        // Get all holdings for this user/portfolio/date
        const startOfDay = new Date(snapshotDate);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const endOfDay = new Date(snapshotDate);
        endOfDay.setUTCHours(23, 59, 59, 999);

        const allHoldings = await PMSHoldingsCollection.find({
          bankId: connection.bankId,
          userId: missing.userId,
          portfolioCode: missing.portfolioCode,
          snapshotDate: { $gte: startOfDay, $lte: endOfDay }
        }).fetchAsync();

        if (allHoldings.length === 0) {
          console.log(`[REGENERATE_SNAPSHOTS] No holdings found for ${missing.portfolioCode} on ${missing.snapshotDate}, skipping`);
          continue;
        }

        // Deduplicate by uniqueKey — keep only the latest version per uniqueKey for this date
        // This prevents inflated totals from duplicate holdings (e.g., after uniqueKey migrations)
        const byKey = new Map();
        for (const h of allHoldings) {
          const existing = byKey.get(h.uniqueKey);
          if (!existing || (h.version || 0) > (existing.version || 0)) {
            byKey.set(h.uniqueKey, h);
          }
        }
        const holdings = Array.from(byKey.values());

        // Get account info
        const accountNumber = holdings[0]?.accountNumber || null;

        // Create the snapshot. Carry entityId from the holdings so entity-only clients
        // (userId null) get readable snapshots — the performance read matches by entityId.
        await PortfolioSnapshotHelpers.createSnapshot({
          userId: missing.userId,
          entityId: holdings.find(h => h.entityId)?.entityId || null,
          bankId: connection.bankId,
          bankName: bank.name,
          connectionId,
          portfolioCode: missing.portfolioCode,
          accountNumber,
          snapshotDate,
          fileDate: holdings[0]?.fileDate || snapshotDate,
          sourceFile: `regenerated_from_holdings_${missing.snapshotDate}`,
          holdings,
          transferOpsCache  // Pass pre-fetched operations
        });

        regenerated++;
        console.log(`[REGENERATE_SNAPSHOTS] Regenerated snapshot for ${missing.portfolioCode} on ${missing.snapshotDate}`);

      } catch (error) {
        console.error(`[REGENERATE_SNAPSHOTS] Error regenerating snapshot for ${missing.portfolioCode} on ${missing.snapshotDate}: ${error.message}`);
        errors.push({
          portfolioCode: missing.portfolioCode,
          snapshotDate: missing.snapshotDate,
          error: error.message
        });
      }
    }

    console.log(`[REGENERATE_SNAPSHOTS] Complete: ${regenerated} regenerated, ${errors.length} errors`);

    return {
      success: true,
      regenerated,
      errors,
      remaining: missingDates.length - datesToProcess.length
    };
  },

  /**
   * Get data freshness status for all banks for a user or across all users (admin)
   * Returns freshness info per bank connection showing if data is current or stale
   */
  /**
   * One-day variation of the displayed portfolio total, in currency.
   *
   * "One day" is the previous date the BANK actually reported for each portfolio,
   * not calendar yesterday — so on a Monday it naturally compares against Friday,
   * and it steps over holidays and days a bank didn't deliver.
   *
   * Comparison is per portfolio and apples-to-apples: each portfolio is measured
   * against ITS OWN previous valuation, and a portfolio with no prior valuation
   * is left out of BOTH sides. Summing the whole perimeter across two dates
   * instead would read a bank whose file simply hasn't landed yet as a crash —
   * the same trap the RM dashboard's Day P&L had to solve.
   *
   * The client passes the exact (bankId, portfolioCode) pairs it is displaying and
   * the currency it displays them in, so the comparison covers what is on screen.
   */
  async 'pms.getDayVariation'({ sessionId, portfolioKeys, currency, asOfDate = null }) {
    check(sessionId, String);
    check(currency, String);
    check(asOfDate, Match.Maybe(Date));
    check(portfolioKeys, [{ bankId: String, portfolioCode: String }]);

    // The PMS page fires several methods at once; without this they queue behind
    // this one and the whole screen waits on a decorative figure.
    this.unblock();

    const session = await SessionHelpers.findByToken(sessionId);
    if (!session?.userId) throw new Meteor.Error('not-authorized', 'Invalid session');
    const currentUser = await UsersCollection.findOneAsync(session.userId);
    if (!currentUser) throw new Meteor.Error('not-authorized', 'User not found');

    // CONSOLIDATED rows are roll-up copies of the per-account rows; counting them
    // alongside their sources would double every position.
    const keys = portfolioKeys.filter(k => k.portfolioCode && k.portfolioCode !== 'CONSOLIDATED');
    if (keys.length === 0) return null;

    // SECURITY: the caller names the portfolios, so confirm they may see them.
    // Staff see every book; a client only the accounts they hold.
    const STAFF_ROLES = ['superadmin', 'admin', 'compliance', 'rm', 'assistant', 'staff'];
    if (!STAFF_ROLES.includes(currentUser.role)) {
      const { accountHolderSelector } = await import('/imports/api/bankAccounts.js');
      const owned = await BankAccountsCollection.find({
        ...accountHolderSelector([currentUser._id]),
        isActive: true
      }, { fields: { bankId: 1, accountNumber: 1 } }).fetchAsync();
      const allowed = new Set(owned.map(a => `${a.bankId}|${a.accountNumber}`));
      if (keys.some(k => !allowed.has(`${k.bankId}|${k.portfolioCode}`))) {
        throw new Meteor.Error('not-authorized', 'Not authorized for these portfolios');
      }
    }

    const { CurrencyRateCacheCollection } = await import('/imports/api/currencyCache.js');
    const rateCache = new Map();
    /** Rate to express `from` in the display currency, or null when unknown. */
    const rateTo = async (from) => {
      if (!from || from === currency) return 1;
      if (rateCache.has(from)) return rateCache.get(from);
      let rate = null;
      const direct = await CurrencyRateCacheCollection.findOneAsync({ pair: `${from}${currency}.FOREX` });
      if (direct?.rate) rate = direct.rate;
      else {
        const inverse = await CurrencyRateCacheCollection.findOneAsync({ pair: `${currency}${from}.FOREX` });
        if (inverse?.rate) rate = 1 / inverse.rate;
      }
      rateCache.set(from, rate);
      return rate;
    };

    // ONE aggregation for the whole perimeter. Querying per portfolio needed
    // three round trips each and took ~1.4s for a single account, so the
    // consolidated view never finished loading.
    //
    // Totals are summed per (portfolio, date, currency) on the headline's own
    // basis: net cash, debit balances included (a purchase booked before its
    // value date shows as negative cash; credit-line accounts are excluded at
    // account level, not by flooring). Flooring cash at zero here while the
    // snapshots net it produced a fake +26.67% day on a 1.5M account. Sorting
    // happens in JS on this already-small grouped output rather than in the
    // pipeline, which keeps it clear of Mongo's sort memory limit.
    //
    // The match is shaped for the portfolioCode + snapshotDate index: an $or over
    // {bankId, portfolioCode} pairs across ALL history scanned the collection and
    // never returned. Filtering by portfolioCode within a bounded window and
    // re-checking bankId in JS below is the same result, indexed.
    const requested = new Set(keys.map(k => `${k.bankId}|${k.portfolioCode}`));
    const codes = [...new Set(keys.map(k => k.portfolioCode))];
    // Only the two most recent valuations matter. A portfolio not valued within
    // this window has no meaningful one-day move to report anyway.
    const windowStart = new Date(asOfDate || Date.now());
    windowStart.setDate(windowStart.getDate() - DAY_VARIATION_LOOKBACK_DAYS);

    const grouped = await PMSHoldingsCollection.rawCollection().aggregate([
      {
        $match: {
          portfolioCode: { $in: codes },
          snapshotDate: {
            $gte: windowStart,
            ...(asOfDate ? { $lte: asOfDate } : {})
          },
          // A position must count on the days it was actually held. The
          // sold-position cleanup retroactively flags isActive:false on EVERY
          // historical record of a position that later left the bank file, so a
          // plain `isActive: true` erases it from the earlier side of the
          // comparison and invents a gain — two autocalls worth EUR 1,025,000
          // showed up as a fake +2.55% day.
          //
          // `soldAt` is the date it was found missing, so a record counts while
          // that date is still in the future. Rows deactivated for data-quality
          // reasons (stale uniqueKey duplicates, merges) carry no soldAt and stay
          // excluded, which keeps the duplicate protection intact.
          $expr: {
            $or: [
              { $eq: ['$isActive', true] },
              { $gt: [{ $ifNull: ['$soldAt', null] }, '$snapshotDate'] }
            ]
          }
        }
      },
      {
        $group: {
          _id: {
            bankId: '$bankId',
            portfolioCode: '$portfolioCode',
            date: '$snapshotDate',
            ccy: '$portfolioCurrency'
          },
          total: {
            $sum: {
              $ifNull: ['$marketValue', 0]
            }
          }
        }
      }
    ]).toArray();

    // portfolio -> date(ms) -> [{ ccy, total }]
    const byPortfolio = new Map();
    for (const row of grouped) {
      if (!row._id?.date) continue;
      const pKey = `${row._id.bankId}|${row._id.portfolioCode}`;
      // Two banks can reuse a portfolio code, so the bankId pairing is checked here.
      if (!requested.has(pKey)) continue;
      const dateMs = new Date(row._id.date).getTime();
      if (!byPortfolio.has(pKey)) byPortfolio.set(pKey, new Map());
      const dates = byPortfolio.get(pKey);
      if (!dates.has(dateMs)) dates.set(dateMs, []);
      dates.get(dateMs).push({ ccy: row._id.ccy, total: row.total || 0 });
    }

    let currentTotal = 0;
    let previousTotal = 0;
    let compared = 0;
    let currentDate = null;
    let previousDate = null;
    let unpricedCurrency = false;

    const convertBucket = async (bucket) => {
      let sum = 0;
      for (const part of bucket) {
        const rate = await rateTo(part.ccy);
        if (rate === null) { unpricedCurrency = true; return null; }
        sum += part.total * rate;
      }
      return sum;
    };

    for (const [, dates] of byPortfolio) {
      const sortedMs = [...dates.keys()].sort((a, b) => b - a);
      if (sortedMs.length < 2) continue;

      const ownMs = sortedMs[0];
      const priorMs = sortedMs[1];

      const nowValue = await convertBucket(dates.get(ownMs));
      const thenValue = await convertBucket(dates.get(priorMs));
      if (nowValue === null || thenValue === null) continue;

      currentTotal += nowValue;
      previousTotal += thenValue;
      compared++;
      if (currentDate === null || ownMs > currentDate) currentDate = ownMs;
      if (previousDate === null || priorMs > previousDate) previousDate = priorMs;
    }

    currentDate = currentDate === null ? null : new Date(currentDate);
    previousDate = previousDate === null ? null : new Date(previousDate);

    if (compared === 0 || !previousTotal) return null;

    const change = currentTotal - previousTotal;

    return {
      currency,
      currentDate,
      previousDate,
      currentTotal,
      previousTotal,
      change,
      changePercent: (change / previousTotal) * 100,
      // The caller shows a caveat when only part of the perimeter could be
      // compared (a bank whose file for the current date hasn't landed yet).
      comparedPortfolios: compared,
      totalPortfolios: keys.length,
      unpricedCurrency
    };
  },

  async 'pms.getDataFreshness'({ sessionId, userId }) {
    check(sessionId, String);
    check(userId, Match.Maybe(String));

    // Validate session
    const session = await SessionHelpers.findByToken(sessionId);

    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid session');
    }

    const currentUser = await UsersCollection.findOneAsync(session.userId);
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }

    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'superadmin';

    // Determine target user
    let targetUserId;
    if (userId && isAdmin) {
      targetUserId = userId;
    } else if (isAdmin && !userId) {
      // Admin without specific user - get all data
      targetUserId = null;
    } else {
      // Regular user - only their own data
      targetUserId = session.userId;
    }

    // Import freshness helper
    const { checkDataFreshness, formatDataDate, getFreshnessIcon } = await import('../../imports/api/helpers/dataFreshness.js');

    // Get all bank accounts for the user(s)
    const bankAccountQuery = targetUserId ? { userId: targetUserId } : {};
    console.log('[DataFreshness] bankAccountQuery:', bankAccountQuery, 'targetUserId:', targetUserId);
    const bankAccounts = await BankAccountsCollection.find(bankAccountQuery).fetchAsync();
    console.log('[DataFreshness] Found bankAccounts:', bankAccounts.length);

    // Get portfolio codes from bank accounts
    const portfolioCodes = bankAccounts.map(a => a.accountNumber).filter(Boolean);
    console.log('[DataFreshness] portfolioCodes:', portfolioCodes);

    // Build holdings query - if we have portfolio codes, use them; otherwise get all latest holdings
    // This ensures we show freshness even when bank accounts aren't properly linked
    let holdingsQuery;
    if (portfolioCodes.length > 0) {
      holdingsQuery = { portfolioCode: { $in: portfolioCodes }, isLatest: true };
    } else {
      // Fallback: get all latest holdings (for admin or if no bank accounts linked)
      console.log('[DataFreshness] No portfolio codes found, using fallback query for all holdings');
      holdingsQuery = { isLatest: true };
    }

    const allHoldings = await PMSHoldingsCollection.find(holdingsQuery, {
      fields: { bankId: 1, snapshotDate: 1, fileDate: 1, portfolioCode: 1 }
    }).fetchAsync();

    console.log('[DataFreshness] Found holdings:', allHoldings.length);

    // Group by bankId to find unique banks and their latest data dates
    const bankDataMap = {};
    for (const holding of allHoldings) {
      const bankId = holding.bankId;
      if (!bankId) continue;

      const dataDate = holding.snapshotDate || holding.fileDate;
      if (!bankDataMap[bankId] || (dataDate && dataDate > bankDataMap[bankId].dataDate)) {
        bankDataMap[bankId] = {
          bankId,
          dataDate,
          portfolioCode: holding.portfolioCode
        };
      }
    }

    const uniqueBankIds = Object.keys(bankDataMap);
    console.log('[DataFreshness] Unique banks from holdings:', uniqueBankIds);

    if (uniqueBankIds.length === 0) {
      console.log('[DataFreshness] No holdings found with bankId');
      return { banks: [], hasStaleData: false, hasErrors: false };
    }

    // Get banks info
    const banks = await BanksCollection.find({ _id: { $in: uniqueBankIds } }).fetchAsync();
    const bankMap = Object.fromEntries(banks.map(b => [b._id, b]));
    console.log('[DataFreshness] Found banks:', banks.map(b => b.name));

    // Optionally get connections for error status (if available)
    const connections = await BankConnectionsCollection.find({
      bankId: { $in: uniqueBankIds }
    }).fetchAsync();
    const connectionMap = Object.fromEntries(connections.map(c => [c.bankId, c]));

    // Build freshness results
    const freshnessResults = [];

    for (const bankId of uniqueBankIds) {
      const bank = bankMap[bankId];
      const bankData = bankDataMap[bankId];
      const connection = connectionMap[bankId];

      if (!bank) {
        console.log('[DataFreshness] Bank not found for bankId:', bankId);
        continue;
      }

      const dataDate = bankData.dataDate;
      const freshness = checkDataFreshness(dataDate);

      // Check for sync errors from connection (if exists)
      const hasError = connection && connection.lastError && connection.status === 'error';

      freshnessResults.push({
        bankId,
        bankName: bank.name,
        connectionId: connection?._id || bankId,
        connectionName: connection?.connectionName || bank.name,
        dataDate,
        dataDateFormatted: formatDataDate(dataDate),
        status: hasError ? 'error' : freshness.status,
        statusIcon: getFreshnessIcon(hasError ? 'error' : freshness.status),
        message: hasError ? (connection.lastError || 'Sync failed') : freshness.message,
        businessDaysOld: freshness.businessDaysOld,
        lastProcessedAt: connection?.lastProcessedAt,
        lastError: connection?.lastError
      });
    }

    // Sort by status (errors first, then stale, then fresh)
    const statusOrder = { error: 0, old: 1, stale: 2, fresh: 3 };
    freshnessResults.sort((a, b) => (statusOrder[a.status] || 99) - (statusOrder[b.status] || 99));

    // Calculate overall status
    const hasErrors = freshnessResults.some(r => r.status === 'error');
    const hasStaleData = freshnessResults.some(r => r.status === 'stale' || r.status === 'old');

    return {
      banks: freshnessResults,
      hasStaleData,
      hasErrors,
      expectedDate: formatDataDate(new Date()) // Today's expected data date
    };
  },

  /**
   * Reset SG Monaco operations tracking (temporary debug method)
   * Clears seenOperationFiles so trans files get reprocessed
   */
  async 'bank.resetSGOperationsTracking'() {
    console.log('[BANK_OPERATIONS] Resetting SG Monaco operations tracking...');

    // Clear seenOperationFiles for SG Monaco connection
    const updateResult = await BankConnectionsCollection.updateAsync(
      { connectionName: 'SG Monaco Local' },
      { $set: { seenOperationFiles: [] } }
    );
    console.log(`[BANK_OPERATIONS] Cleared seenOperationFiles: ${updateResult} connection(s) updated`);

    // Clear existing operations for SG Monaco
    const deleteResult = await PMSOperationsCollection.removeAsync({ bankName: 'Societe Generale Monaco' });
    console.log(`[BANK_OPERATIONS] Deleted ${deleteResult} SG Monaco operations`);

    return {
      success: true,
      connectionsUpdated: updateResult,
      operationsDeleted: deleteResult
    };
  },

  /**
   * Get price history sparkline data for a holding by ISIN
   * Strategy 1: ProductPricesCollection (structured products, bonds - stored by ISIN)
   * Strategy 2: MarketDataCacheCollection (equities - stored by fullTicker, resolved via EOD API)
   */
  async 'pms.getHoldingPriceHistory'({ isin, sessionId }) {
    check(isin, String);
    check(sessionId, String);

    // Validate session
    const session = await SessionHelpers.findByToken(sessionId);
    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid session');
    }

    const { ProductPricesCollection } = await import('../../imports/api/productPrices.js');
    const { MarketDataCacheCollection } = await import('../../imports/api/marketDataCache.js');

    // --- Strategy 1: ProductPricesCollection (structured products, bonds) ---
    // Prices are stored directly by ISIN
    const productPrices = await ProductPricesCollection.find(
      { isin: isin.toUpperCase(), isActive: true },
      { sort: { priceDate: 1 }, limit: 200 }
    ).fetchAsync();

    if (productPrices.length >= 2) {
      const prices = productPrices.map(p => ({
        date: new Date(p.priceDate).toISOString().split('T')[0],
        price: p.price
      }));
      const priceValues = prices.map(p => p.price);
      const firstPrice = priceValues[0];
      const lastPrice = priceValues[priceValues.length - 1];

      // Is this series stored as a decimal fraction of par (1.0146) or as percent
      // (101.46)? Judge it on the median, not on the first row: a handful of
      // legacy rows in the other scale would otherwise flip the verdict for the
      // whole series and rescale every point by 100. The median only moves if
      // most of the series really is in that scale.
      const sortedPrices = [...priceValues].filter(v => typeof v === 'number' && v > 0).sort((a, b) => a - b);
      const medianPrice = sortedPrices.length
        ? sortedPrices[Math.floor(sortedPrices.length / 2)]
        : firstPrice;

      return {
        hasData: true,
        source: 'productPrices',
        fullTicker: isin,
        currency: productPrices[0].currency || 'EUR',
        prices,
        minPrice: Math.min(...priceValues),
        maxPrice: Math.max(...priceValues),
        startDate: prices[0].date,
        endDate: prices[prices.length - 1].date,
        dataPoints: prices.length,
        isPositive: lastPrice >= firstPrice,
        firstPrice,
        lastPrice,
        isPercentagePrice: medianPrice <= 2 // values <= 2 are decimal percentages of par
      };
    }

    // --- Strategy 2: MarketDataCacheCollection (equities) ---
    // Need to resolve ISIN -> fullTicker via EOD API
    const { EODApiHelpers } = await import('../../imports/api/eodApi.js');
    let fullTicker = null;

    try {
      const searchResults = await EODApiHelpers.searchSecurities(isin, 5);
      if (searchResults && searchResults.length > 0) {
        const exactMatch = searchResults.find(r => r.ISIN === isin.toUpperCase());
        const match = exactMatch || searchResults[0];
        if (match && match.Code && match.Exchange) {
          fullTicker = `${match.Code}.${match.Exchange}`;
        }
      }
    } catch (e) {
      console.log(`[PMS_PRICE_HISTORY] EOD search failed for ${isin}:`, e.message);
    }

    // --- Strategy 3: PMSHoldings daily snapshots ---
    // Used for funds / alternative instruments that aren't in ProductsCollection and
    // don't resolve via EOD. We already store `marketPrice` per daily snapshot.
    const pmsHoldingsFallback = async () => {
      const holdings = await PMSHoldingsCollection.find(
        {
          isin: isin.toUpperCase(),
          portfolioCode: { $not: /CONSOLIDATED/i },
          marketPrice: { $exists: true, $ne: null }
        },
        {
          sort: { priceDate: 1 },
          fields: {
            marketPrice: 1,
            priceDate: 1,
            snapshotDate: 1,
            dataDate: 1,
            priceType: 1,
            priceCurrency: 1,
            currency: 1
          }
        }
      ).fetchAsync();

      if (holdings.length === 0) return null;

      // Deduplicate by date (YYYY-MM-DD) — first record per day wins.
      const byDate = new Map();
      for (const h of holdings) {
        const rawDate = h.priceDate || h.snapshotDate || h.dataDate;
        if (!rawDate || h.marketPrice == null) continue;
        const dateKey = new Date(rawDate).toISOString().split('T')[0];
        if (!byDate.has(dateKey)) {
          byDate.set(dateKey, { date: dateKey, price: h.marketPrice, ref: h });
        }
      }

      if (byDate.size < 2) return null;

      const entries = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
      const prices = entries.map(e => ({ date: e.date, price: e.price }));
      const priceValues = prices.map(p => p.price);
      const firstPrice = priceValues[0];
      const lastPrice = priceValues[priceValues.length - 1];
      const firstHolding = entries[0].ref;

      return {
        hasData: true,
        source: 'pmsHoldings',
        fullTicker: isin,
        currency: firstHolding.priceCurrency || firstHolding.currency || 'USD',
        prices,
        minPrice: Math.min(...priceValues),
        maxPrice: Math.max(...priceValues),
        startDate: prices[0].date,
        endDate: prices[prices.length - 1].date,
        dataPoints: prices.length,
        isPositive: lastPrice >= firstPrice,
        firstPrice,
        lastPrice,
        isPercentagePrice: firstHolding.priceType === 'percentage'
      };
    };

    if (!fullTicker) {
      const fallback = await pmsHoldingsFallback();
      if (fallback) return fallback;
      return { hasData: false, error: 'No price history available for this instrument' };
    }

    let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker });

    // Fallback: try alternate exchanges
    if (!cacheDoc) {
      const symbol = fullTicker.split('.')[0];
      const exchanges = ['US', 'PA', 'DE', 'LSE', 'CO', 'SW', 'AS', 'MI', 'MC', 'L', 'XETRA', 'ST', 'HE', 'OL', 'BR', 'VI', 'TA'];
      for (const exchange of exchanges) {
        const altTicker = `${symbol}.${exchange}`;
        cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: altTicker });
        if (cacheDoc) {
          fullTicker = altTicker;
          break;
        }
      }
    }

    // If still no cache data, try to fetch it
    if (!cacheDoc) {
      try {
        const { MarketDataHelpers } = await import('../../imports/api/marketDataCache.js');
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        await MarketDataHelpers.fetchAndCacheHistoricalData(fullTicker, oneYearAgo);
        cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker });
      } catch (e) {
        console.log(`[PMS_PRICE_HISTORY] Failed to fetch data for ${fullTicker}:`, e.message);
      }
    }

    if (!cacheDoc || !cacheDoc.history || cacheDoc.history.length === 0) {
      const fallback = await pmsHoldingsFallback();
      if (fallback) return fallback;
      return { hasData: false, error: 'No price history available' };
    }

    // Generate sparkline data from the last ~1 year of history

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    const oneYearAgoStr = oneYearAgo.toISOString().split('T')[0];

    const filtered = cacheDoc.history.filter(record => {
      const recordDate = new Date(record.date).toISOString().split('T')[0];
      return recordDate >= oneYearAgoStr;
    });

    if (filtered.length === 0) {
      const fallback = await pmsHoldingsFallback();
      if (fallback) return fallback;
      return { hasData: false, error: 'No recent price history' };
    }

    // Downsample to ~90 points
    const MAX_POINTS = 90;
    let sampled;
    if (filtered.length <= MAX_POINTS) {
      sampled = filtered;
    } else {
      const step = filtered.length / MAX_POINTS;
      sampled = [];
      for (let i = 0; i < MAX_POINTS; i++) {
        sampled.push(filtered[Math.floor(i * step)]);
      }
      sampled[sampled.length - 1] = filtered[filtered.length - 1];
    }

    const prices = sampled.map(r => ({
      date: new Date(r.date).toISOString().split('T')[0],
      price: r.adjustedClose || r.close
    }));

    const priceValues = prices.map(p => p.price);
    const firstPrice = priceValues[0];
    const lastPrice = priceValues[priceValues.length - 1];

    return {
      hasData: true,
      source: 'marketData',
      fullTicker,
      currency: cacheDoc.currency || 'USD',
      prices,
      minPrice: Math.min(...priceValues),
      maxPrice: Math.max(...priceValues),
      startDate: prices[0].date,
      endDate: prices[prices.length - 1].date,
      dataPoints: prices.length,
      isPositive: lastPrice >= firstPrice,
      firstPrice,
      lastPrice,
      isPercentagePrice: false
    };
  },

  /**
   * Backfill ProductPrices from historical PMSHoldings snapshots.
   * Promotes existing bank price data into ProductPricesCollection for a given ISIN
   * (or all product ISINs if no ISIN is specified).
   */
  async 'productPrices.backfillFromPMSSnapshots'({ isin, sessionId }) {
    check(sessionId, String);
    check(isin, Match.Maybe(String));

    const user = await validateAdminSession(sessionId);

    const { ProductPriceHelpers } = await import('../../imports/api/productPrices.js');
    const { ProductsCollection } = await import('../../imports/api/products.js');

    // Determine which ISINs to backfill
    let isinsToProcess = [];
    if (isin) {
      isinsToProcess = [isin.toUpperCase()];
    } else {
      // All ISINs from internal products
      const products = await ProductsCollection.find(
        { isin: { $exists: true, $ne: '' } },
        { fields: { isin: 1 } }
      ).fetchAsync();
      isinsToProcess = [...new Set(
        products.map(p => p.isin).filter(Boolean).map(i => i.toUpperCase())
      )];
    }

    console.log(`[PRICE_BACKFILL] Starting backfill for ${isinsToProcess.length} ISINs by ${user.username}`);

    let totalInserted = 0;
    let totalSkipped = 0;

    for (const targetIsin of isinsToProcess) {
      // Query ALL PMSHoldings snapshots for this ISIN, excluding CONSOLIDATED portfolios
      const holdings = await PMSHoldingsCollection.find(
        {
          isin: targetIsin,
          portfolioCode: { $not: /CONSOLIDATED/i }
        },
        { sort: { snapshotDate: 1 } }
      ).fetchAsync();

      if (holdings.length === 0) continue;

      // Deduplicate by snapshotDate - take the first record for each date
      const byDate = new Map();
      for (const h of holdings) {
        if (!h.snapshotDate || !h.marketPrice) continue;
        const dateKey = new Date(h.snapshotDate).toISOString().split('T')[0];
        if (!byDate.has(dateKey)) {
          byDate.set(dateKey, h);
        }
      }

      console.log(`[PRICE_BACKFILL] ${targetIsin}: ${byDate.size} unique dates from ${holdings.length} snapshots`);

      for (const [dateKey, holding] of byDate) {
        try {
          // Convert decimal → percentage for percentage-priced instruments
          // PMSHoldings stores in decimal (0.9677 = 96.77%), ProductPrices in percentage (96.77)
          const displayPrice = holding.priceType === 'percentage'
            ? holding.marketPrice * 100
            : holding.marketPrice;

          const priceDate = new Date(holding.snapshotDate);

          await ProductPriceHelpers.upsertProductPrice({
            isin: targetIsin,
            price: displayPrice,
            currency: holding.priceCurrency || holding.currency || 'USD',
            priceDate,
            priceSource: 'pms_snapshot_backfill',
            uploadedBy: user._id,
            sourceFile: `pms_backfill_${dateKey}`,
            bankFileDate: priceDate,
            metadata: {
              portfolioCode: holding.portfolioCode,
              priceType: holding.priceType,
              backfilledBy: user.username
            }
          });

          totalInserted++;
        } catch (e) {
          console.error(`[PRICE_BACKFILL] Error upserting ${targetIsin} on ${dateKey}: ${e.message}`);
          totalSkipped++;
        }
      }
    }

    console.log(`[PRICE_BACKFILL] Complete: ${totalInserted} upserted, ${totalSkipped} skipped`);

    return {
      success: true,
      isinsProcessed: isinsToProcess.length,
      totalInserted,
      totalSkipped
    };
  }
});
