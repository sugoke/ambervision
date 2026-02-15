import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { BankConnectionsCollection, BankConnectionHelpers } from '../../imports/api/bankConnections.js';
import { BankConnectionLogHelpers } from '../../imports/api/bankConnectionLogs.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { SFTPService } from '../../imports/api/sftpService.js';
import { isSGZipFile, extractSGZipFile, findNewSGZipFiles } from '../../imports/utils/zipUtils.js';
import { decryptAllGpgFiles, isGpgAvailable } from '../../imports/utils/gpgUtils.js';
import fs from 'fs';
import path from 'path';

/**
 * Get the most recent file modification date from a folder
 * Used to determine when the bank last uploaded files for local connections
 */
function getLatestFileModificationDate(folderPath) {
  const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
  const fullPath = path.join(bankfilesRoot, folderPath);

  if (!fs.existsSync(fullPath)) return null;

  const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.csv'));
  if (files.length === 0) return null;

  let latestDate = null;
  files.forEach(file => {
    const stats = fs.statSync(path.join(fullPath, file));
    if (!latestDate || stats.mtime > latestDate) {
      latestDate = stats.mtime;
    }
  });
  return latestDate;
}

/**
 * Validate session and ensure user is admin
 */
async function validateAdminSession(sessionId) {
  // Allow system-cron bypass for CRON jobs
  if (sessionId === 'system-cron' || sessionId === 'system') {
    return { _id: 'system', username: 'system-cron', role: 'superadmin' };
  }

  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

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

Meteor.methods({
  /**
   * Create a new bank connection
   * Supports 'sftp' and 'local' connection types
   */
  async 'bankConnections.create'({ bankId, connectionName, connectionType, host, port, username, password, privateKeyPath, remotePath, localFolderName, sessionId }) {
    // Validate required fields (common to all types)
    check(bankId, String);
    check(connectionName, String);
    check(connectionType, String);
    check(sessionId, String);

    // Type-specific validation
    if (connectionType === 'sftp') {
      check(host, String);
      check(username, String);
      check(port, Match.OneOf(Number, undefined, null));
      check(remotePath, Match.OneOf(String, undefined, null));
      check(password, Match.OneOf(String, null, undefined));
      check(privateKeyPath, Match.OneOf(String, null, undefined));
    } else if (connectionType === 'local') {
      check(localFolderName, String);
    } else {
      throw new Meteor.Error('invalid-type', `Invalid connection type: ${connectionType}`);
    }

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Verify bank exists
    const bank = await BanksCollection.findOneAsync(bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    // Create connection with type-specific fields
    const connectionId = await BankConnectionHelpers.createConnection({
      bankId,
      connectionName,
      connectionType,
      // SFTP fields (null for local type)
      host: connectionType === 'sftp' ? host : null,
      port: connectionType === 'sftp' ? (port || 22) : 22,
      username: connectionType === 'sftp' ? username : null,
      password: connectionType === 'sftp' ? password : null,
      privateKeyPath: connectionType === 'sftp' ? privateKeyPath : null,
      remotePath: connectionType === 'sftp' ? (remotePath || '/') : '/',
      // Local folder field (null for sftp type)
      localFolderName: connectionType === 'local' ? localFolderName : null,
      userId: user._id
    });

    // Log the creation
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId,
      connectionName,
      action: 'create',
      status: 'success',
      message: `${connectionType} connection created by ${user.username}`,
      userId: user._id
    });

    console.log(`[BANK_CONNECTIONS] User ${user.username} created ${connectionType} connection: ${connectionName}`);

    return { success: true, connectionId };
  },

  /**
   * Update a bank connection
   */
  async 'bankConnections.update'({ connectionId, updates, sessionId }) {
    check(connectionId, String);
    check(updates, Object);
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Verify connection exists
    const connection = await BankConnectionHelpers.getConnection(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    // Update connection
    await BankConnectionHelpers.updateConnection(connectionId, updates, user._id);

    // Log the update
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName,
      action: 'update',
      status: 'success',
      message: `Connection updated by ${user.username}`,
      metadata: { updates },
      userId: user._id
    });

    return { success: true };
  },

  /**
   * Delete a bank connection
   */
  async 'bankConnections.delete'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Verify connection exists
    const connection = await BankConnectionHelpers.getConnection(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    // Delete connection (soft delete)
    await BankConnectionHelpers.deleteConnection(connectionId, user._id);

    // Log the deletion
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName,
      action: 'delete',
      status: 'success',
      message: `Connection deleted by ${user.username}`,
      userId: user._id
    });

    return { success: true };
  },

  /**
   * Test SFTP connection
   */
  async 'bankConnections.test'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Get connection details
    const connection = await BankConnectionHelpers.getConnection(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    console.log(`[BANK_CONNECTIONS] Testing connection: ${connection.connectionName}`);

    // Log test start
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName,
      action: 'test',
      status: 'started',
      message: `Connection test started by ${user.username}`,
      userId: user._id
    });

    try {
      // Test connection based on type
      let result;

      if (connection.connectionType === 'sftp') {
        result = await SFTPService.testConnection({
          host: connection.host,
          port: connection.port,
          username: connection.username,
          password: connection.password,
          privateKeyPath: connection.privateKeyPath,
          timeout: 30000
        });
      } else if (connection.connectionType === 'local') {
        // Test local folder connection - check if folder exists and is readable
        const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
        const folderPath = path.join(bankfilesRoot, connection.localFolderName);

        console.log(`[BANK_CONNECTIONS] Testing local folder: ${folderPath}`);

        if (!fs.existsSync(folderPath)) {
          throw new Error(`Local folder not found: ${folderPath}`);
        }

        // Try to read the folder
        const files = fs.readdirSync(folderPath);
        const fileCount = files.filter(f => {
          const stat = fs.statSync(path.join(folderPath, f));
          return stat.isFile();
        }).length;

        result = {
          fileCount,
          folderPath,
          timestamp: new Date()
        };
      } else {
        throw new Meteor.Error('not-implemented', `Connection type ${connection.connectionType} not yet supported`);
      }

      // Update connection status to connected
      await BankConnectionHelpers.updateConnectionStatus(connectionId, {
        status: 'connected',
        connected: true
      });

      // Log success
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'test',
        status: 'success',
        message: connection.connectionType === 'local' ? `Local folder accessible (${result.folderPath})` : 'Connection test successful',
        metadata: { fileCount: result.fileCount },
        userId: user._id
      });

      console.log(`[BANK_CONNECTIONS] Connection test successful: ${connection.connectionName}`);

      return {
        success: true,
        message: connection.connectionType === 'local' ? 'Local folder accessible' : 'Connection successful',
        fileCount: result.fileCount,
        timestamp: result.timestamp
      };

    } catch (error) {
      console.error(`[BANK_CONNECTIONS] Connection test failed: ${error.message}`);

      // Update connection status to error
      await BankConnectionHelpers.updateConnectionStatus(connectionId, {
        status: 'error',
        error: error.message,
        connected: false
      });

      // Log failure
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'test',
        status: 'failed',
        message: 'Connection test failed',
        error: error.message,
        userId: user._id
      });

      throw new Meteor.Error('connection-failed', error.message);
    }
  },

  /**
   * List files on remote SFTP server or local folder
   */
  async 'bankConnections.listFiles'({ connectionId, remotePath, sessionId }) {
    check(connectionId, String);
    check(remotePath, Match.OneOf(String, null, undefined));
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Get connection details
    const connection = await BankConnectionHelpers.getConnection(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    console.log(`[BANK_CONNECTIONS] Listing files: ${connection.connectionName}`);

    try {
      let files;
      let actualPath;

      if (connection.connectionType === 'sftp') {
        files = await SFTPService.listFiles({
          host: connection.host,
          port: connection.port,
          username: connection.username,
          password: connection.password,
          privateKeyPath: connection.privateKeyPath,
          timeout: 30000
        }, remotePath || connection.remotePath);
        actualPath = remotePath || connection.remotePath;
      } else if (connection.connectionType === 'local') {
        // List files from local folder
        const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
        const folderPath = path.join(bankfilesRoot, connection.localFolderName);
        // Return "/" as path - the actual folder is determined by localFolderName
        // This prevents path doubling when UI passes filePath to downloadFile
        actualPath = '/';

        if (!fs.existsSync(folderPath)) {
          throw new Error(`Local folder not found: ${folderPath}`);
        }

        const entries = fs.readdirSync(folderPath, { withFileTypes: true });
        files = entries.map(entry => {
          const fullPath = path.join(folderPath, entry.name);
          const stat = fs.statSync(fullPath);
          return {
            name: entry.name,
            isDirectory: entry.isDirectory(),
            size: stat.size,
            modified: stat.mtime
          };
        });
      } else {
        throw new Meteor.Error('not-implemented', `Connection type ${connection.connectionType} not supported`);
      }

      // Log success
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'list',
        status: 'success',
        message: `Listed ${files.length} files`,
        metadata: { fileCount: files.length, path: actualPath },
        userId: user._id
      });

      return {
        success: true,
        files,
        path: actualPath
      };

    } catch (error) {
      console.error(`[BANK_CONNECTIONS] File listing failed: ${error.message}`);

      // Log failure
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'list',
        status: 'failed',
        error: error.message,
        userId: user._id
      });

      throw new Meteor.Error('list-failed', error.message);
    }
  },

  /**
   * Download a file from bank connection
   * For SFTP: Downloads from remote server
   * For Local: Reads from local filesystem
   */
  async 'bankConnections.downloadFile'({ connectionId, filePath, sessionId }) {
    check(connectionId, String);
    check(filePath, String);
    check(sessionId, String);

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Get connection first (outside try block to avoid undefined reference in catch)
    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    try {
      console.log(`[BANK_CONNECTIONS] Downloading file: ${filePath} from connection ${connectionId}`);

      // Handle local connections - read file directly from filesystem
      if (connection.connectionType === 'local') {
        const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
        const fullPath = path.join(bankfilesRoot, connection.localFolderName, filePath);

        if (!fs.existsSync(fullPath)) {
          throw new Error(`File not found: ${filePath}`);
        }

        const fileBuffer = fs.readFileSync(fullPath);
        const fileName = path.basename(filePath);

        console.log(`[BANK_CONNECTIONS] Downloaded local file: ${fileName} (${fileBuffer.length} bytes)`);

        // Log success for local download
        await BankConnectionLogHelpers.logConnectionAttempt({
          connectionId,
          bankId: connection.bankId,
          connectionName: connection.connectionName,
          action: 'download',
          status: 'success',
          message: `Downloaded local file: ${filePath}`,
          metadata: { filePath, fileSize: fileBuffer.length },
          userId: user._id
        });

        return {
          success: true,
          fileBuffer: fileBuffer.toString('base64'),
          fileName: fileName
        };
      }

      // Download file using SFTP service (to buffer in memory)
      const fileBuffer = await SFTPService.downloadFileToBuffer({
        host: connection.host,
        port: connection.port || 22,
        username: connection.username,
        password: connection.password,
        privateKeyPath: connection.privateKeyPath
      }, filePath);

      // Log success
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'download',
        status: 'success',
        message: `Downloaded file: ${filePath}`,
        metadata: { filePath, fileSize: fileBuffer.length },
        userId: user._id
      });

      return {
        success: true,
        fileBuffer: fileBuffer.toString('base64'),
        fileName: filePath.split('/').pop()
      };

    } catch (error) {
      console.error(`[BANK_CONNECTIONS] File download failed: ${error.message}`);

      // Log failure (connection is guaranteed to be defined here)
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'download',
        status: 'failed',
        error: error.message,
        metadata: { filePath },
        userId: user._id
      });

      throw new Meteor.Error('download-failed', error.message);
    }
  },

  /**
   * Download all files from SFTP server to local bankfiles folder
   * For local connections, this simply lists existing files (no download needed)
   */
  async 'bankConnections.downloadAllFiles'({ connectionId, sessionId }) {
    check(connectionId, String);
    check(sessionId, String);
    this.unblock();

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Get connection first
    const connection = await BankConnectionsCollection.findOneAsync(connectionId);
    if (!connection) {
      throw new Meteor.Error('not-found', 'Connection not found');
    }

    // Get bank details for folder naming
    const bank = await BanksCollection.findOneAsync(connection.bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    console.log(`[BANK_CONNECTIONS] Starting download all files for: ${connection.connectionName}`);

    // Handle local connections - files are already in place, no download needed
    // Detect which files are NEW (haven't been seen before) - matches SFTP behavior
    if (connection.connectionType === 'local') {
      const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
      const folderPath = path.join(bankfilesRoot, connection.localFolderName);

      console.log(`[BANK_CONNECTIONS] Local connection - checking folder: ${folderPath}`);

      if (!fs.existsSync(folderPath)) {
        throw new Meteor.Error('folder-not-found', `Local folder not found: ${folderPath}`);
      }

      // Check if this is Societe Generale (requires ZIP extraction)
      const isSocieteGenerale = bank.name?.toLowerCase().includes('société générale') ||
                                 bank.name?.toLowerCase().includes('societe generale') ||
                                 bank.name?.toLowerCase().includes('sg monaco') ||
                                 connection.localFolderName?.includes('sg/');

      if (isSocieteGenerale) {
        // Societe Generale: Handle ZIP file extraction
        console.log(`[BANK_CONNECTIONS] Societe Generale detected - checking for ZIP files`);

        // Find new ZIP files that haven't been processed
        const seenLocalFiles = connection.seenLocalFiles || [];
        const newZipFiles = findNewSGZipFiles(folderPath, seenLocalFiles);

        if (newZipFiles.length === 0) {
          console.log(`[BANK_CONNECTIONS] SG: No new ZIP files to process`);

          // Log success (no new files)
          await BankConnectionLogHelpers.logConnectionAttempt({
            connectionId,
            bankId: connection.bankId,
            connectionName: connection.connectionName,
            action: 'download_all',
            status: 'success',
            message: `SG: No new ZIP files to process`,
            metadata: { totalZipFiles: 0, folderPath },
            userId: user._id
          });

          return {
            success: true,
            totalFiles: 0,
            newFiles: [],
            skippedFiles: seenLocalFiles,
            failedFiles: [],
            bankFolderPath: connection.localFolderName,
            message: 'SG: All ZIP files already processed'
          };
        }

        console.log(`[BANK_CONNECTIONS] SG: Found ${newZipFiles.length} new ZIP file(s) to process`);

        // Process each new ZIP file
        // Flow: Extract ZIP to temp -> Decrypt GPG files directly to decrypted/ -> Clean up temp
        const decryptedFilesAll = [];
        const processedZips = [];
        const failedZips = [];
        const decryptionErrors = [];

        // Determine folder paths
        const baseDir = path.join(bankfilesRoot, path.dirname(connection.localFolderName));
        const decryptedBasePath = path.join(baseDir, 'decrypted');
        const tempExtractPath = path.join(baseDir, 'temp_extract');

        // Ensure decrypted folder exists
        if (!fs.existsSync(decryptedBasePath)) {
          fs.mkdirSync(decryptedBasePath, { recursive: true });
          console.log(`[BANK_CONNECTIONS] SG: Created decrypted folder: ${decryptedBasePath}`);
        }

        // Check if GPG is available for decryption
        const gpgAvailable = isGpgAvailable();
        if (!gpgAvailable) {
          console.error(`[BANK_CONNECTIONS] SG: GPG not available - cannot process SG files without GPG`);
          throw new Meteor.Error('gpg-not-available', 'GPG is required to process Societe Generale files');
        }

        for (const zipInfo of newZipFiles) {
          try {
            console.log(`[BANK_CONNECTIONS] SG: Processing ZIP: ${zipInfo.filename}`);

            // Step 1: Extract ZIP to temp folder
            console.log(`[BANK_CONNECTIONS] SG: Step 1 - Extracting to temp...`);
            const extractResult = extractSGZipFile(zipInfo.fullPath, tempExtractPath);

            console.log(`[BANK_CONNECTIONS] SG: Extracted ${extractResult.totalExtracted} files`);
            console.log(`[BANK_CONNECTIONS] SG: GPG files: ${extractResult.gpgFiles.length}, Other files: ${extractResult.otherFiles.length}`);

            // Step 2: Decrypt GPG files directly to decrypted folder
            if (extractResult.gpgFiles.length > 0) {
              console.log(`[BANK_CONNECTIONS] SG: Step 2 - Decrypting ${extractResult.gpgFiles.length} GPG files...`);

              // The extracted files are in a date-based subfolder
              const extractedSubDir = path.join(tempExtractPath, extractResult.folderName);

              const decryptResult = decryptAllGpgFiles(extractedSubDir, decryptedBasePath, {
                preserveStructure: false, // Flatten to single directory
                overwrite: false // Idempotent - skip existing files
              });

              // Collect results
              decryptedFilesAll.push(...decryptResult.decrypted.map(d => d.outputPath));

              if (decryptResult.failed.length > 0) {
                decryptionErrors.push(...decryptResult.failed.map(f => ({
                  zipFile: zipInfo.filename,
                  gpgFile: path.basename(f.inputPath),
                  error: f.error
                })));
              }

              console.log(`[BANK_CONNECTIONS] SG: Decryption complete - ${decryptResult.decryptedCount} decrypted, ${decryptResult.skippedCount} skipped, ${decryptResult.failedCount} failed`);
            }

            // Step 3: Clean up temp extracted files (we don't need encrypted files)
            try {
              const extractedSubDir = path.join(tempExtractPath, extractResult.folderName);
              if (fs.existsSync(extractedSubDir)) {
                fs.rmSync(extractedSubDir, { recursive: true, force: true });
                console.log(`[BANK_CONNECTIONS] SG: Cleaned up temp folder: ${extractedSubDir}`);
              }
            } catch (cleanupErr) {
              console.warn(`[BANK_CONNECTIONS] SG: Failed to clean up temp folder: ${cleanupErr.message}`);
            }

            processedZips.push(zipInfo.filename);

          } catch (zipError) {
            console.error(`[BANK_CONNECTIONS] SG: Failed to process ${zipInfo.filename}: ${zipError.message}`);
            failedZips.push({ filename: zipInfo.filename, error: zipError.message });
          }
        }

        // Clean up temp_extract folder if empty
        try {
          if (fs.existsSync(tempExtractPath) && fs.readdirSync(tempExtractPath).length === 0) {
            fs.rmdirSync(tempExtractPath);
          }
        } catch (e) { /* ignore */ }

        // Update seenLocalFiles with processed ZIP filenames
        const updatedSeenFiles = [...seenLocalFiles, ...processedZips];
        await BankConnectionsCollection.updateAsync(connectionId, {
          $set: { seenLocalFiles: updatedSeenFiles }
        });

        // Determine overall status
        const hasErrors = failedZips.length > 0 || decryptionErrors.length > 0;

        // Log success
        await BankConnectionLogHelpers.logConnectionAttempt({
          connectionId,
          bankId: connection.bankId,
          connectionName: connection.connectionName,
          action: 'download_all',
          status: hasErrors ? 'partial' : 'success',
          message: `SG: Processed ${processedZips.length} ZIP(s), decrypted ${decryptedFilesAll.length} files`,
          metadata: {
            processedZips,
            failedZips,
            decryptedFiles: decryptedFilesAll.length,
            decryptionErrors: decryptionErrors.length,
            decryptedBasePath,
            gpgAvailable
          },
          userId: user._id
        });

        // Update lastDownloadAt
        const latestFileDate = getLatestFileModificationDate(connection.localFolderName);
        if (latestFileDate) {
          await BankConnectionHelpers.updateActivityTimestamps(connectionId, { downloadedAt: latestFileDate });
        }

        return {
          success: true,
          totalFiles: processedZips.length,
          newFiles: processedZips,
          decryptedFiles: decryptedFilesAll,
          skippedFiles: seenLocalFiles,
          failedFiles: failedZips,
          decryptionErrors: decryptionErrors,
          bankFolderPath: connection.localFolderName,
          decryptedPath: decryptedBasePath,
          gpgAvailable,
          message: `SG: Processed ${processedZips.length} ZIP(s), decrypted ${decryptedFilesAll.length} files`
        };
      }

      // Generic local connection handling (CFM, etc.)
      // List all files in folder
      const allFiles = fs.readdirSync(folderPath).filter(f => {
        const stat = fs.statSync(path.join(folderPath, f));
        return stat.isFile();
      });

      // Get previously seen files from connection record (matches SFTP behavior)
      // A file is "new" only if it hasn't been seen before, not based on database processing
      const seenLocalFiles = new Set(connection.seenLocalFiles || []);

      // Determine which files are "new" (haven't been seen before)
      const newFiles = [];
      const skippedFiles = [];

      allFiles.forEach(filename => {
        if (!seenLocalFiles.has(filename)) {
          newFiles.push(filename);
        } else {
          skippedFiles.push(filename);
        }
      });

      console.log(`[BANK_CONNECTIONS] Local connection ${connection.connectionName}: ${newFiles.length} new files, ${skippedFiles.length} already seen`);
      if (newFiles.length > 0) {
        console.log(`[BANK_CONNECTIONS] New files: ${newFiles.join(', ')}`);
      }

      // Update the seen files list with all current files
      // This ensures future syncs won't report these as new
      await BankConnectionsCollection.updateAsync(connectionId, {
        $set: { seenLocalFiles: allFiles }
      });

      // Log success
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'download_all',
        status: 'success',
        message: `Local folder - ${newFiles.length} new files, ${skippedFiles.length} already seen`,
        metadata: { totalFiles: allFiles.length, newFiles: newFiles.length, folderPath },
        userId: user._id
      });

      // Update lastDownloadAt for local connections - use latest file modification date
      // This represents when the bank last uploaded files to the folder
      const latestFileDate = getLatestFileModificationDate(connection.localFolderName);
      if (latestFileDate) {
        await BankConnectionHelpers.updateActivityTimestamps(connectionId, { downloadedAt: latestFileDate });
      }

      return {
        success: true,
        totalFiles: allFiles.length,
        newFiles: newFiles,
        skippedFiles: skippedFiles,
        failedFiles: [],
        bankFolderName: connection.localFolderName,
        message: newFiles.length > 0
          ? `Local folder - ${newFiles.length} new files to process`
          : 'Local folder - all files already seen'
      };
    }

    // SFTP connection - proceed with download
    // Log download start
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId: connection.bankId,
      connectionName: connection.connectionName,
      action: 'download_all',
      status: 'started',
      message: `Download all files started by ${user.username}`,
      userId: user._id
    });

    try {
      // Sanitize bank name for folder (remove special characters, spaces)
      const sanitizedBankName = bank.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');

      // Create bank folder path
      // Use environment variable for persistent storage, fallback to process.cwd()
      const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
      const bankFolderPath = path.join(bankfilesRoot, sanitizedBankName);

      console.log(`[BANK_CONNECTIONS] Bankfiles root: ${bankfilesRoot}`);
      console.log(`[BANK_CONNECTIONS] Download path: ${bankFolderPath}`);

      // Create folder if it doesn't exist
      if (!fs.existsSync(bankFolderPath)) {
        fs.mkdirSync(bankFolderPath, { recursive: true });
        console.log(`[BANK_CONNECTIONS] Created folder: ${bankFolderPath}`);
      }

      // Track results
      let newFiles = [];
      let skippedFiles = [];
      let failedFiles = [];
      let filesList = [];

      // Check if this is CMB Monaco (requires atomic download to prevent file deletion)
      const isCMBMonaco = bank.name?.toLowerCase().includes('cmb') ||
                          connection.host?.toLowerCase().includes('cmb');

      if (isCMBMonaco) {
        // CMB Monaco: Use atomic download (list + download in single SFTP session)
        // This prevents files from being deleted between list and download operations
        console.log(`[BANK_CONNECTIONS] Using ATOMIC download for CMB Monaco (prevents file deletion)`);

        // Get list of existing files to skip
        const existingFiles = new Set();
        if (fs.existsSync(bankFolderPath)) {
          fs.readdirSync(bankFolderPath).forEach(f => existingFiles.add(f));
        }

        const result = await SFTPService.downloadAllFilesAtomic(
          {
            host: connection.host,
            port: connection.port || 22,
            username: connection.username,
            password: connection.password,
            privateKeyPath: connection.privateKeyPath
          },
          connection.remotePath || '/',
          bankFolderPath,
          (filename) => {
            // Only download CSV files that don't already exist locally
            if (!filename.toLowerCase().endsWith('.csv')) {
              return false;
            }
            if (existingFiles.has(filename)) {
              skippedFiles.push(filename);
              return false;
            }
            return true;
          }
        );

        newFiles = result.downloadedFiles;
        failedFiles = result.errors.map(e => ({ name: e.file, error: e.error }));
        filesList = []; // Not used for atomic - set to empty

        console.log(`[BANK_CONNECTIONS] CMB Monaco atomic download complete: ${newFiles.length} new, ${skippedFiles.length} skipped, ${failedFiles.length} failed`);

      } else {
        // Standard two-stage download for other banks

        // List all files on SFTP server
        const files = await SFTPService.listFiles({
          host: connection.host,
          port: connection.port || 22,
          username: connection.username,
          password: connection.password,
          privateKeyPath: connection.privateKeyPath
        }, connection.remotePath || '/');

        // Filter out directories (only download files)
        filesList = files.filter(f => !f.isDirectory);

        console.log(`[BANK_CONNECTIONS] Found ${filesList.length} files on server`);

        // Download each file
        for (const file of filesList) {
          const localFilePath = path.join(bankFolderPath, file.name);
          const remoteFilePath = path.join(connection.remotePath || '/', file.name).replace(/\\/g, '/');

          try {
            // Check if file already exists
            if (fs.existsSync(localFilePath)) {
              console.log(`[BANK_CONNECTIONS] Skipping existing file: ${file.name}`);
              skippedFiles.push(file.name);
              continue;
            }

            // Download new file with retry logic
            const MAX_RETRIES = 3;
            const RETRY_DELAY = 2000; // 2 seconds
            let downloadSuccess = false;

            for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
              try {
                console.log(`[BANK_CONNECTIONS] Downloading ${file.name} (attempt ${attempt}/${MAX_RETRIES})`);
                await SFTPService.downloadFile({
                  host: connection.host,
                  port: connection.port || 22,
                  username: connection.username,
                  password: connection.password,
                  privateKeyPath: connection.privateKeyPath
                }, remoteFilePath, localFilePath);

                newFiles.push(file.name);
                console.log(`[BANK_CONNECTIONS] Downloaded: ${file.name}`);
                downloadSuccess = true;
                break; // Success, exit retry loop
              } catch (retryError) {
                console.warn(`[BANK_CONNECTIONS] Attempt ${attempt}/${MAX_RETRIES} failed for ${file.name}: ${retryError.message}`);

                if (attempt === MAX_RETRIES) {
                  // Final attempt failed - log detailed error
                  const errorDetails = {
                    name: file.name,
                    error: retryError.message,
                    errorCode: retryError.code || 'UNKNOWN',
                    remotePath: remoteFilePath,
                    fileSize: file.size || 'unknown',
                    attempts: attempt
                  };
                  console.error(`[BANK_CONNECTIONS] Failed to download ${file.name} after ${MAX_RETRIES} attempts:`, errorDetails);
                  failedFiles.push(errorDetails);
                } else {
                  // Wait before retrying
                  console.log(`[BANK_CONNECTIONS] Waiting ${RETRY_DELAY}ms before retry...`);
                  await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
                }
              }
            }

          } catch (fileError) {
            // Catch any unexpected errors outside the retry loop
            console.error(`[BANK_CONNECTIONS] Unexpected error for ${file.name}: ${fileError.message}`);
            failedFiles.push({ name: file.name, error: fileError.message, unexpected: true });
          }
        }
      }

      // Log success
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'download_all',
        status: 'success',
        message: `Downloaded ${newFiles.length} new files, skipped ${skippedFiles.length} existing`,
        metadata: {
          totalFiles: filesList.length,
          newFilesCount: newFiles.length,
          newFiles: newFiles,                    // Actual filenames downloaded
          skippedFilesCount: skippedFiles.length,
          skippedFiles: skippedFiles,            // Actual filenames skipped
          failedFilesCount: failedFiles.length,
          failedFiles: failedFiles,              // Array of {name, error}
          bankFolderPath: bankFolderPath
        },
        userId: user._id
      });

      // Update lastDownloadAt timestamp for SFTP connections when new files are downloaded
      if (newFiles.length > 0) {
        await BankConnectionHelpers.updateActivityTimestamps(connectionId, { downloadedAt: new Date() });
      }

      console.log(`[BANK_CONNECTIONS] Download all completed: ${newFiles.length} new, ${skippedFiles.length} skipped, ${failedFiles.length} failed`);

      return {
        success: true,
        totalFiles: filesList.length,
        newFiles,
        skippedFiles,
        failedFiles,
        bankFolderPath: sanitizedBankName
      };

    } catch (error) {
      console.error(`[BANK_CONNECTIONS] Download all failed: ${error.message}`);

      // Log failure
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'download_all',
        status: 'failed',
        error: error.message,
        userId: user._id
      });

      throw new Meteor.Error('download-all-failed', error.message);
    }
  },

  /**
   * Get connection logs
   */
  async 'bankConnections.getLogs'({ connectionId, limit, sessionId }) {
    check(connectionId, Match.Optional(String));
    check(limit, Match.Optional(Number));
    check(sessionId, String);

    // Validate admin access
    await validateAdminSession(sessionId);

    if (connectionId) {
      return await BankConnectionLogHelpers.getConnectionLogs(connectionId, limit || 50);
    } else {
      return await BankConnectionLogHelpers.getRecentLogs(limit || 100);
    }
  }
});
