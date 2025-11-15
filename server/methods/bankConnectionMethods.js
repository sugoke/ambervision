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
 * Validate session and ensure user is admin
 */
async function validateAdminSession(sessionId) {
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
   */
  async 'bankConnections.create'({ bankId, connectionName, connectionType, host, port, username, password, privateKeyPath, remotePath, sessionId }) {
    // Validate required fields
    check(bankId, String);
    check(connectionName, String);
    check(connectionType, String);
    check(host, String);
    check(username, String);
    check(sessionId, String);

    // Validate fields with defaults (client always sends these)
    check(port, Number);  // Client always sends a number (default: 22)
    check(remotePath, String);  // Client always sends a string (default: '/')

    // Validate optional fields that can be null
    check(password, Match.OneOf(String, null));
    check(privateKeyPath, Match.OneOf(String, null));

    // Validate admin access
    const user = await validateAdminSession(sessionId);

    // Verify bank exists
    const bank = await BanksCollection.findOneAsync(bankId);
    if (!bank) {
      throw new Meteor.Error('not-found', 'Bank not found');
    }

    // Create connection
    const connectionId = await BankConnectionHelpers.createConnection({
      bankId,
      connectionName,
      connectionType,
      host,
      port: port || 22,
      username,
      password,
      privateKeyPath,
      remotePath: remotePath || '/',
      userId: user._id
    });

    // Log the creation
    await BankConnectionLogHelpers.logConnectionAttempt({
      connectionId,
      bankId,
      connectionName,
      action: 'create',
      status: 'success',
      message: `Connection created by ${user.username}`,
      userId: user._id
    });

    console.log(`[BANK_CONNECTIONS] User ${user.username} created connection: ${connectionName}`);

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
        message: 'Connection test successful',
        metadata: { fileCount: result.fileCount },
        userId: user._id
      });

      console.log(`[BANK_CONNECTIONS] Connection test successful: ${connection.connectionName}`);

      return {
        success: true,
        message: 'Connection successful',
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
   * List files on remote SFTP server
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
      const files = await SFTPService.listFiles({
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        privateKeyPath: connection.privateKeyPath,
        timeout: 30000
      }, remotePath || connection.remotePath);

      // Log success
      await BankConnectionLogHelpers.logConnectionAttempt({
        connectionId,
        bankId: connection.bankId,
        connectionName: connection.connectionName,
        action: 'list',
        status: 'success',
        message: `Listed ${files.length} files`,
        metadata: { fileCount: files.length, remotePath: remotePath || connection.remotePath },
        userId: user._id
      });

      return {
        success: true,
        files,
        path: remotePath || connection.remotePath
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
   * Download a file from SFTP server
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
      const bankFolderPath = path.join(process.cwd(), 'bankfiles', sanitizedBankName);

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

          // Download new file
          console.log(`[BANK_CONNECTIONS] Downloading new file: ${file.name}`);
          await SFTPService.downloadFile({
            host: connection.host,
            port: connection.port || 22,
            username: connection.username,
            password: connection.password,
            privateKeyPath: connection.privateKeyPath
          }, remoteFilePath, localFilePath);

          newFiles.push(file.name);
          console.log(`[BANK_CONNECTIONS] Downloaded: ${file.name}`);

        } catch (fileError) {
          console.error(`[BANK_CONNECTIONS] Failed to download ${file.name}: ${fileError.message}`);
          failedFiles.push({ name: file.name, error: fileError.message });
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
          newFiles: newFiles.length,
          skippedFiles: skippedFiles.length,
          failedFiles: failedFiles.length,
          bankFolderPath: bankFolderPath
        },
        userId: user._id
      });

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
