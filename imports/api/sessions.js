import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Random } from 'meteor/random';

export const SessionsCollection = new Mongo.Collection('sessions');

if (Meteor.isServer) {
  // Create indexes for efficient querying
  SessionsCollection.createIndex({ sessionId: 1 }, { unique: true });
  SessionsCollection.createIndex({ userId: 1 });
  SessionsCollection.createIndex({ expiresAt: 1 });
  SessionsCollection.createIndex({ lastUsed: 1 });

  // Cleanup expired sessions every hour
  Meteor.setInterval(async () => {
    const now = new Date();
    const deletedCount = await SessionsCollection.removeAsync({
      expiresAt: { $lt: now }
    });
    
    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} expired sessions`);
    }
  }, 60 * 60 * 1000); // Every hour
}

export const SessionHelpers = {
  /**
   * Create a new session for a user
   * @param {string} userId - User ID
   * @param {boolean} rememberMe - Whether to create a long-lived session
   * @param {string} userAgent - Client's user agent
   * @param {string} ipAddress - Client's IP address
   * @returns {Object} Session data
   */
  async createSession(userId, rememberMe = false, userAgent = '', ipAddress = '') {
    const sessionId = Random.id(32); // More secure than Math.random()
    const now = new Date();
    
    // Short session: 7 days, Long session: 30 days (increased from 1 day)
    const expirationMs = rememberMe ? (30 * 24 * 60 * 60 * 1000) : (7 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(now.getTime() + expirationMs);
    
    const sessionData = {
      sessionId,
      userId,
      createdAt: now,
      lastUsed: now,
      expiresAt,
      rememberMe,
      userAgent: userAgent.substring(0, 500), // Limit length
      ipAddress,
      isActive: true
    };

    await SessionsCollection.insertAsync(sessionData);
    console.log(`Created ${rememberMe ? 'persistent' : 'temporary'} session for user ${userId}`);
    
    return sessionData;
  },

  /**
   * Validate and refresh a session
   * @param {string} sessionId - Session ID to validate
   * @returns {Object|null} Session data if valid, null if invalid
   */
  async validateSession(sessionId) {
    if (!sessionId) return null;

    const session = await SessionsCollection.findOneAsync({
      sessionId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!session) {
      return null;
    }

    // Update last used timestamp
    await SessionsCollection.updateAsync(session._id, {
      $set: { lastUsed: new Date() }
    });

    return session;
  },

  /**
   * Invalidate a specific session
   * @param {string} sessionId - Session ID to invalidate
   */
  async invalidateSession(sessionId) {
    await SessionsCollection.updateAsync(
      { sessionId },
      { $set: { isActive: false } }
    );
    console.log(`Invalidated session: ${sessionId}`);
  },

  /**
   * Invalidate all sessions for a user
   * @param {string} userId - User ID
   */
  async invalidateAllUserSessions(userId) {
    const result = await SessionsCollection.updateAsync(
      { userId, isActive: true },
      { $set: { isActive: false } },
      { multi: true }
    );
    console.log(`Invalidated ${result} sessions for user ${userId}`);
  },

  /**
   * Get active sessions for a user
   * @param {string} userId - User ID
   * @returns {Array} Active sessions
   */
  async getUserSessions(userId) {
    return await SessionsCollection.find({
      userId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    }, {
      sort: { lastUsed: -1 }
    }).fetchAsync();
  },

  /**
   * Clean up expired sessions manually
   */
  async cleanupExpiredSessions() {
    const now = new Date();
    const deletedCount = await SessionsCollection.removeAsync({
      $or: [
        { expiresAt: { $lt: now } },
        { isActive: false, lastUsed: { $lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } } // Remove inactive sessions older than 7 days
      ]
    });
    
    console.log(`Cleaned up ${deletedCount} expired/inactive sessions`);
    return deletedCount;
  }
};