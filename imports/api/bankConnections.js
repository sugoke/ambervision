import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

export const BankConnectionsCollection = new Mongo.Collection('bankConnections');

// Helper functions for bank connection management
export const BankConnectionHelpers = {
  /**
   * Create a new bank connection
   * Supports two types:
   * - 'sftp': Download files from remote SFTP server (requires host, username, credentials)
   * - 'local': Files uploaded by bank to local folder (requires localFolderName only)
   */
  async createConnection({
    bankId,
    connectionName,
    connectionType = 'sftp',
    host = null,
    port = 22,
    username = null,
    password = null,
    privateKeyPath = null,
    remotePath = '/',
    localFolderName = null,  // For 'local' type: folder name relative to bankfiles/
    userId
  }) {
    check(bankId, String);
    check(connectionName, String);
    check(connectionType, String);
    check(userId, String);

    // Validate based on connection type
    if (connectionType === 'sftp') {
      check(host, String);
      check(port, Number);
      check(username, String);
    } else if (connectionType === 'local') {
      check(localFolderName, String);
    }

    const connection = {
      bankId,
      connectionName,
      connectionType, // 'sftp', 'local'

      // SFTP connection details (null for local type)
      host,
      port,
      username,
      password, // Will be encrypted in production
      privateKeyPath, // Path to SSH private key on server
      remotePath, // Default directory on remote server

      // Local folder connection (null for sftp type)
      localFolderName, // Folder name relative to bankfiles/ directory

      // Status
      status: 'not_tested', // 'not_tested', 'connected', 'disconnected', 'error'
      isActive: true,
      lastConnection: null,
      lastConnectionAttempt: null,
      lastDownloadAt: null,      // Timestamp of last successful file download
      lastProcessedAt: null,     // Timestamp of last successful processing
      lastError: null,
      connectionCount: 0,

      // Metadata
      createdBy: userId,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const connectionId = await BankConnectionsCollection.insertAsync(connection);
    console.log(`[BANK_CONNECTIONS] Created ${connectionType} connection: ${connectionName} (${connectionId})`);

    return connectionId;
  },

  /**
   * Update connection status after test
   */
  async updateConnectionStatus(connectionId, { status, error = null, connected = false }) {
    check(connectionId, String);
    check(status, String);

    const update = {
      $set: {
        status,
        lastConnectionAttempt: new Date(),
        updatedAt: new Date(),
        lastError: error || null
      }
    };

    if (connected) {
      update.$set.lastConnection = new Date();
      update.$inc = { connectionCount: 1 };
    }

    await BankConnectionsCollection.updateAsync(connectionId, update);

    console.log(`[BANK_CONNECTIONS] Updated connection ${connectionId} status: ${status}`);

    return true;
  },

  /**
   * Update activity timestamps (last download, last processed)
   */
  async updateActivityTimestamps(connectionId, { downloadedAt = null, processedAt = null }) {
    check(connectionId, String);

    const update = { $set: { updatedAt: new Date() } };
    if (downloadedAt) update.$set.lastDownloadAt = downloadedAt;
    if (processedAt) update.$set.lastProcessedAt = processedAt;

    await BankConnectionsCollection.updateAsync(connectionId, update);

    console.log(`[BANK_CONNECTIONS] Updated activity timestamps for ${connectionId}`);

    return true;
  },

  /**
   * Update connection configuration
   */
  async updateConnection(connectionId, updates, userId) {
    check(connectionId, String);
    check(userId, String);

    const allowedFields = [
      'connectionName',
      'connectionType',
      'host',
      'port',
      'username',
      'password',
      'privateKeyPath',
      'remotePath',
      'localFolderName',
      'isActive'
    ];

    const updateData = {
      updatedAt: new Date(),
      updatedBy: userId
    };

    // Only update allowed fields
    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateData[key] = updates[key];
      }
    });

    await BankConnectionsCollection.updateAsync(connectionId, { $set: updateData });

    console.log(`[BANK_CONNECTIONS] Updated connection: ${connectionId}`);

    return true;
  },

  /**
   * Delete a connection (soft delete by setting isActive to false)
   */
  async deleteConnection(connectionId, userId) {
    check(connectionId, String);
    check(userId, String);

    await BankConnectionsCollection.updateAsync(connectionId, {
      $set: {
        isActive: false,
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[BANK_CONNECTIONS] Deleted connection: ${connectionId}`);

    return true;
  },

  /**
   * Get connection by ID
   */
  async getConnection(connectionId) {
    check(connectionId, String);
    return await BankConnectionsCollection.findOneAsync(connectionId);
  },

  /**
   * Get all active connections for a bank
   */
  async getConnectionsByBank(bankId) {
    check(bankId, String);
    return await BankConnectionsCollection.find({ bankId, isActive: true }).fetchAsync();
  }
};
