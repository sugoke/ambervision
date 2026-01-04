import { Meteor } from 'meteor/meteor';
import { ServerLogsCollection } from '../../imports/api/serverLogs.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';

/**
 * Publish server logs to admin users only
 * Real-time updates via Meteor's oplog tailing
 */
Meteor.publish('serverLogs', async function (sessionId, limit = 1000) {
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

  // Only admins can access server logs
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    return this.ready();
  }

  // Return logs sorted by creation time (newest last for auto-scroll)
  return ServerLogsCollection.find({}, {
    sort: { createdAt: -1 },
    limit
  });
});
