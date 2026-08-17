import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Random } from 'meteor/random';

export const SessionsCollection = new Mongo.Collection('sessions');

// SECURITY: session tokens are stored HASHED at rest. The raw token is a bearer
// credential held only by the client; the DB keeps SHA-256(token), so a DB/backup
// leak does not yield replayable sessions. All lookups go through hashToken() +
// findByToken(). (Meteor's Random.id token has ~136 bits of entropy, so a plain
// unsalted SHA-256 is sufficient here — no need for a slow KDF.)
let _crypto = null;
function hashToken(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return null;
  if (!_crypto) _crypto = require('crypto');
  return _crypto.createHash('sha256').update(rawToken).digest('hex');
}
export { hashToken };

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
    const rawToken = Random.id(32); // returned to the client; never stored raw
    const now = new Date();

    // Absolute lifetime. Shortened as XSS-exposure mitigation: the token lives in
    // localStorage (JS-readable, a DDP constraint), so a stolen token is only useful
    // until it expires — kept as short as is reasonable. Remember-me: 14d (was 30);
    // standard: 3d (was 7). Combined with the idle timeout in findByToken below.
    const expirationMs = rememberMe ? (14 * 24 * 60 * 60 * 1000) : (3 * 24 * 60 * 60 * 1000);
    const expiresAt = new Date(now.getTime() + expirationMs);

    // Persist the HASH; the raw token lives only on the client.
    const storedData = {
      sessionId: hashToken(rawToken),
      userId,
      createdAt: now,
      lastUsed: now,
      expiresAt,
      rememberMe,
      userAgent: userAgent.substring(0, 500), // Limit length
      ipAddress,
      isActive: true
    };

    await SessionsCollection.insertAsync(storedData);
    console.log(`Created ${rememberMe ? 'persistent' : 'temporary'} session for user ${userId}`);

    // Return the raw token to callers (login) so it can be handed to the client.
    return { ...storedData, sessionId: rawToken };
  },

  /**
   * Read-only lookup of an ACTIVE, unexpired session by its raw token. Central path
   * for every session lookup — hashes the token before querying so the DB is only ever
   * matched on the hash. Returns null on a non-string/empty/unknown token.
   */
  async findByToken(rawToken) {
    const hashed = hashToken(rawToken);
    if (!hashed) return null;
    const session = await SessionsCollection.findOneAsync({
      sessionId: hashed,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });
    if (!session) return null;

    // Idle timeout (XSS-exposure mitigation): a session unused for longer than
    // IDLE_TIMEOUT_MS is treated as dead, so an abandoned tab's stolen token stops
    // working even before its absolute expiry. Active users refresh lastUsed on every
    // validateSession call, so they are unaffected. Remember-me sessions get a longer
    // idle window (they are explicitly long-lived by the user's choice).
    const IDLE_TIMEOUT_MS = session.rememberMe
      ? (3 * 24 * 60 * 60 * 1000)   // 3 days idle for remember-me
      : (12 * 60 * 60 * 1000);      // 12 hours idle for standard sessions
    const lastUsed = session.lastUsed ? new Date(session.lastUsed).getTime() : 0;
    if (Date.now() - lastUsed > IDLE_TIMEOUT_MS) {
      // Passively retire it so it can't be used again.
      await SessionsCollection.updateAsync(session._id, { $set: { isActive: false } });
      return null;
    }
    return session;
  },

  /**
   * Validate and refresh a session
   * @param {string} sessionId - Session ID to validate
   * @returns {Object|null} Session data if valid, null if invalid
   */
  async validateSession(sessionId) {
    // SECURITY: string-only (reject {$gt:""}/{$ne:null} selector-injection) + hashed
    // lookup. Fail closed on anything else.
    const session = await this.findByToken(sessionId);
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
    // SECURITY: string-only + hashed lookup, else a selector object could invalidate
    // an arbitrary (or every) session — a logout/DoS vector.
    const hashed = hashToken(sessionId);
    if (!hashed) return;
    await SessionsCollection.updateAsync(
      { sessionId: hashed },
      { $set: { isActive: false } }
    );
    console.log('Invalidated a session');
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