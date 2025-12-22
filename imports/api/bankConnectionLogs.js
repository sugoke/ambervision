import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

export const BankConnectionLogsCollection = new Mongo.Collection('bankConnectionLogs');

// Helper functions for connection logging
export const BankConnectionLogHelpers = {
  /**
   * Log a connection attempt
   */
  async logConnectionAttempt({
    connectionId,
    bankId,
    connectionName,
    action, // 'test', 'download', 'upload', 'list'
    status, // 'started', 'success', 'failed'
    message = null,
    error = null,
    metadata = {},
    userId
  }) {
    check(connectionId, String);
    check(action, String);
    check(status, String);
    check(userId, String);

    const log = {
      connectionId,
      bankId,
      connectionName,
      action,
      status,
      message,
      error,
      metadata, // Store additional data like file count, duration, etc.
      userId,
      timestamp: new Date()
    };

    const logId = await BankConnectionLogsCollection.insertAsync(log);

    return logId;
  },

  /**
   * Get logs for a specific connection
   */
  async getConnectionLogs(connectionId, limit = 50) {
    check(connectionId, String);
    check(limit, Number);

    return await BankConnectionLogsCollection.find(
      { connectionId },
      { sort: { timestamp: -1 }, limit }
    ).fetchAsync();
  },

  /**
   * Get recent logs across all connections
   */
  async getRecentLogs(limit = 100) {
    check(limit, Number);

    return await BankConnectionLogsCollection.find(
      {},
      { sort: { timestamp: -1 }, limit }
    ).fetchAsync();
  },

  /**
   * Get failed connection attempts
   */
  async getFailedAttempts(connectionId = null, limit = 50) {
    check(limit, Number);

    const query = { status: 'failed' };
    if (connectionId) {
      query.connectionId = connectionId;
    }

    return await BankConnectionLogsCollection.find(
      query,
      { sort: { timestamp: -1 }, limit }
    ).fetchAsync();
  },

  /**
   * Clean up old logs (keep last N days)
   */
  async cleanupOldLogs(daysToKeep = 90) {
    check(daysToKeep, Number);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await BankConnectionLogsCollection.removeAsync({
      timestamp: { $lt: cutoffDate }
    });

    console.log(`[BANK_CONNECTION_LOGS] Cleaned up ${result} old logs (older than ${daysToKeep} days)`);

    return result;
  }
};
