import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

/**
 * Server Logs Collection
 * Stores captured console output for real-time viewing in admin
 * TTL index auto-deletes logs after 20 minutes
 */
export const ServerLogsCollection = new Mongo.Collection('serverLogs');

// Create indexes on server startup
if (Meteor.isServer) {
  Meteor.startup(async () => {
    // TTL index - auto-delete logs older than 20 minutes (1200 seconds)
    await ServerLogsCollection.createIndexAsync(
      { createdAt: 1 },
      { expireAfterSeconds: 1200 }
    );

    // Index for efficient querying by level
    await ServerLogsCollection.createIndexAsync({ level: 1, createdAt: -1 });

    console.log('[SERVER_LOGS] Collection indexes created (20-min TTL)');
  });
}

/**
 * Helper to insert a log entry
 * @param {string} level - 'info', 'warn', 'error'
 * @param {string} message - Log message
 * @param {string} prefix - Optional prefix like [BANK_POSITIONS]
 */
export const ServerLogsHelpers = {
  async insert(level, message, prefix = null) {
    try {
      await ServerLogsCollection.insertAsync({
        level,
        message,
        prefix,
        createdAt: new Date()
      });
    } catch (err) {
      // Silent fail - don't break app if log insert fails
    }
  },

  /**
   * Extract prefix from log message (e.g., "[BANK_POSITIONS]")
   */
  extractPrefix(message) {
    const match = message.match(/^\[([A-Z_]+)\]/);
    return match ? match[1] : null;
  }
};
