import { Meteor } from 'meteor/meteor';
import { BankConnectionsCollection } from '../../imports/api/bankConnections.js';
import { BankConnectionLogsCollection } from '../../imports/api/bankConnectionLogs.js';
import { CronJobLogsCollection } from '../../imports/api/cronJobLogs.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';

/**
 * Publish bank connections to admin users only
 */
Meteor.publish('bankConnections', async function (sessionId) {
  if (!sessionId) {
    console.log('[bankConnections] No sessionId provided');
    return this.ready();
  }

  // Find active session
  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    console.log('[bankConnections] No active session found');
    return this.ready();
  }

  // Get user
  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    console.log('[bankConnections] User not found');
    return this.ready();
  }

  // Only admins can access bank connections
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    console.log(`[bankConnections] User ${user.username} (${user.role}) not authorized`);
    return this.ready();
  }

  console.log(`[bankConnections] Publishing to admin user: ${user.username}`);

  // Return active connections
  return BankConnectionsCollection.find({ isActive: true });
});

/**
 * Publish bank connection logs
 */
Meteor.publish('bankConnectionLogs', async function (sessionId, connectionId = null, limit = 50) {
  if (!sessionId) {
    return this.ready();
  }

  // Find active session
  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    return this.ready();
  }

  // Get user
  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    return this.ready();
  }

  // Only admins can access logs
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    return this.ready();
  }

  // Return logs for specific connection or all logs
  if (connectionId) {
    return BankConnectionLogsCollection.find(
      { connectionId },
      { sort: { timestamp: -1 }, limit }
    );
  } else {
    return BankConnectionLogsCollection.find(
      {},
      { sort: { timestamp: -1 }, limit }
    );
  }
});

/**
 * Publish bank file sync CRON job logs
 */
Meteor.publish('bankFileSyncLogs', async function (sessionId, limit = 10) {
  if (!sessionId) {
    return this.ready();
  }

  // Find active session
  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    return this.ready();
  }

  // Get user
  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    return this.ready();
  }

  // Only admins can access logs
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    return this.ready();
  }

  // Return recent bankFileSync cron job logs
  return CronJobLogsCollection.find(
    { jobName: 'bankFileSync' },
    { sort: { startTime: -1 }, limit }
  );
});
