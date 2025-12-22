import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { BankConnectionsCollection, BankConnectionHelpers } from '../../imports/api/bankConnections.js';
import { BankConnectionLogHelpers } from '../../imports/api/bankConnectionLogs.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { SFTPService } from '../../imports/api/sftpService.js';
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
    if (connection.connectionType === 'local') {
      const bankfilesRoot = process.env.BANKFILES_PATH || path.join(process.cwd(), 'bankfiles');
      const folderPath = path.join(bankfilesRoot, connection.localFolderName);

      console.log(`[BANK_CONNECTIONS] Local connection - checking folder: ${folderPath}`);

      if (!fs.existsSync(folderPath)) {
        throw new Meteor.Error('folder-not-found', `Local folder not found: ${folderPath}`);
      }

      // List existing files
      const files = fs.readdirSync(folderPath).filter(f => {
        const stat = fs.statSync(path.join(folderPath, f));
        return stat.isFile();
      });

      // Log success
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'download_all',
        status: 'success',
        message: `Local folder - ${files.length} files already in place`,
        metadata: { totalFiles: files.length, folderPath },
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
        totalFiles: files.length,
        newFiles: [],
        skippedFiles: files,
        failedFiles: [],
        bankFolderPath: connection.localFolderName,
        message: 'Local folder - files already in place'
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

      // List all files on SFTP server
      const files = await SFTPService.listFiles({
        host: connection.host,
        port: connection.port || 22,
        username: connection.username,
        password: connection.password,
        privateKeyPath: connection.privateKeyPath
      }, connection.remotePath || '/');

      // Filter out directories (only download files)
      const filesList = files.filter(f => !f.isDirectory);

      console.log(`[BANK_CONNECTIONS] Found ${filesList.length} files on server`);

      // Track results
      const newFiles = [];
      const skippedFiles = [];
      const failedFiles = [];

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
