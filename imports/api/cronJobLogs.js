import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';

/**
 * Cron Job Logs Collection
 *
 * Tracks execution history of scheduled jobs for monitoring and debugging
 *
 * DOCUMENT STRUCTURE:
 * {
 *   _id: ObjectId,
 *   jobName: String,           // Name of the cron job (e.g., "marketDataRefresh", "productReeval")
 *   status: String,            // "success", "error", "running"
 *   startTime: Date,           // When job started
 *   endTime: Date,             // When job completed
 *   duration: Number,          // Duration in milliseconds
 *
 *   // Job-specific data
 *   details: Object,           // Job-specific information
 *   errorMessage: String,      // Error message if status is "error"
 *   errorStack: String,        // Stack trace for debugging
 *
 *   // Statistics
 *   productsProcessed: Number, // For product re-evaluation jobs
 *   productsSucceeded: Number,
 *   productsFailed: Number,
 *   dataPointsFetched: Number, // For market data refresh jobs
 *   tickersProcessed: Number,
 *   tickersSucceeded: Number,
 *   tickersFailed: Number,
 *
 *   // Metadata
 *   triggeredBy: String,       // "cron" or userId if manually triggered
 *   serverInstance: String     // Server instance identifier
 * }
 */

export const CronJobLogsCollection = new Mongo.Collection('cronJobLogs');

if (Meteor.isServer) {
  // Create indexes for efficient querying
  Meteor.startup(() => {
    try {
      CronJobLogsCollection.createIndex({ jobName: 1, startTime: -1 });
      CronJobLogsCollection.createIndex({ status: 1 });
      CronJobLogsCollection.createIndex({ startTime: -1 });
    } catch (error) {
      console.error('Error creating cronJobLogs indexes:', error);
    }
  });

  // Auto-cleanup logs older than 90 days
  Meteor.setInterval(async () => {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    try {
      const removed = await CronJobLogsCollection.removeAsync({
        startTime: { $lt: ninetyDaysAgo }
      });
      if (removed > 0) {
        console.log(`Cleaned up ${removed} old cron job logs`);
      }
    } catch (error) {
      console.error('Error cleaning up old cron job logs:', error);
    }
  }, 24 * 60 * 60 * 1000); // Once per day
}

export const CronJobLogHelpers = {
  /**
   * Start a new job log entry
   */
  async startJob(jobName, triggeredBy = 'cron') {
    check(jobName, String);
    check(triggeredBy, String);

    const logEntry = {
      jobName,
      status: 'running',
      startTime: new Date(),
      triggeredBy,
      serverInstance: process.env.HOSTNAME || 'unknown'
    };

    const logId = await CronJobLogsCollection.insertAsync(logEntry);
    return logId;
  },

  /**
   * Complete a job log entry with success
   */
  async completeJob(logId, details = {}) {
    check(logId, String);
    check(details, Object);

    const endTime = new Date();
    const logEntry = await CronJobLogsCollection.findOneAsync(logId);
    const duration = logEntry ? (endTime - logEntry.startTime) : 0;

    await CronJobLogsCollection.updateAsync(logId, {
      $set: {
        status: 'success',
        endTime,
        duration,
        details,
        ...details // Spread to include stats like productsProcessed, etc.
      }
    });
  },

  /**
   * Mark a job log entry as failed
   */
  async failJob(logId, error, details = {}) {
    check(logId, String);
    check(details, Object);

    const endTime = new Date();
    const logEntry = await CronJobLogsCollection.findOneAsync(logId);
    const duration = logEntry ? (endTime - logEntry.startTime) : 0;

    await CronJobLogsCollection.updateAsync(logId, {
      $set: {
        status: 'error',
        endTime,
        duration,
        errorMessage: error.message || String(error),
        errorStack: error.stack || '',
        details
      }
    });
  },

  /**
   * Get recent logs for a specific job
   */
  async getRecentLogs(jobName = null, limit = 50) {
    check(jobName, Match.OneOf(String, null));
    check(limit, Number);

    const query = jobName ? { jobName } : {};

    return await CronJobLogsCollection.find(query, {
      sort: { startTime: -1 },
      limit
    }).fetchAsync();
  },

  /**
   * Get job statistics
   */
  async getJobStats(jobName, days = 30) {
    check(jobName, String);
    check(days, Number);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const logs = await CronJobLogsCollection.find({
      jobName,
      startTime: { $gte: since }
    }).fetchAsync();

    const successCount = logs.filter(l => l.status === 'success').length;
    const errorCount = logs.filter(l => l.status === 'error').length;
    const avgDuration = logs.length > 0
      ? logs.reduce((sum, l) => sum + (l.duration || 0), 0) / logs.length
      : 0;

    const lastRun = logs.length > 0 ? logs[0] : null;

    return {
      totalRuns: logs.length,
      successCount,
      errorCount,
      successRate: logs.length > 0 ? (successCount / logs.length) * 100 : 0,
      avgDuration: Math.round(avgDuration),
      lastRun: lastRun ? {
        startTime: lastRun.startTime,
        status: lastRun.status,
        duration: lastRun.duration
      } : null
    };
  },

  /**
   * Clean up old logs
   */
  async cleanupOldLogs(daysToKeep = 90) {
    check(daysToKeep, Number);

    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const removed = await CronJobLogsCollection.removeAsync({
      startTime: { $lt: cutoffDate }
    });

    return { removed };
  }
};

// Server-side methods
if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Get recent cron job logs
     */
    async 'cronJobLogs.getRecent'(jobName = null, limit = 50, sessionId) {
      check(jobName, Match.OneOf(String, null));
      check(limit, Number);
      check(sessionId, String);

      // Authenticate user
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
        throw new Meteor.Error('access-denied', 'Admin privileges required');
      }

      return await CronJobLogHelpers.getRecentLogs(jobName, limit);
    },

    /**
     * Get job statistics
     */
    async 'cronJobLogs.getStats'(jobName, days = 30, sessionId) {
      check(jobName, String);
      check(days, Number);
      check(sessionId, String);

      // Authenticate user
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
        throw new Meteor.Error('access-denied', 'Admin privileges required');
      }

      return await CronJobLogHelpers.getJobStats(jobName, days);
    },

    /**
     * Get all job statistics
     */
    async 'cronJobLogs.getAllStats'(sessionId) {
      check(sessionId, String);

      // Authenticate user
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
        throw new Meteor.Error('access-denied', 'Admin privileges required');
      }

      // Get stats for all known jobs
      const jobNames = ['marketDataRefresh', 'productRevaluation'];
      const stats = {};

      for (const jobName of jobNames) {
        stats[jobName] = await CronJobLogHelpers.getJobStats(jobName, 30);
      }

      return stats;
    },

    /**
     * Clean up old logs (superadmin only)
     */
    async 'cronJobLogs.cleanup'(daysToKeep, sessionId) {
      check(daysToKeep, Number);
      check(sessionId, String);

      // Authenticate user - only superadmin
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
      if (!currentUser || currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Superadmin privileges required');
      }

      return await CronJobLogHelpers.cleanupOldLogs(daysToKeep);
    }
  });
}
