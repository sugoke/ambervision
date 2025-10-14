import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';

// Password Reset Tokens collection
export const PasswordResetTokensCollection = new Mongo.Collection('passwordResetTokens');

// Token schema:
// {
//   token: String (32-character random ID),
//   userId: String (reference to customUsers._id),
//   email: String (user's email address),
//   createdAt: Date,
//   expiresAt: Date (1 hour from creation),
//   used: Boolean (whether token has been used),
//   usedAt: Date (when token was used)
// }

if (Meteor.isServer) {
  // Create indexes for efficient querying
  PasswordResetTokensCollection.createIndex({ token: 1 }, { unique: true });
  PasswordResetTokensCollection.createIndex({ userId: 1 });
  PasswordResetTokensCollection.createIndex({ email: 1 });
  PasswordResetTokensCollection.createIndex({ expiresAt: 1 });
  PasswordResetTokensCollection.createIndex({ used: 1 });

  // Cleanup expired tokens every hour
  Meteor.setInterval(async () => {
    const now = new Date();
    // Remove tokens that expired more than 24 hours ago
    const cutoffDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const deletedCount = await PasswordResetTokensCollection.removeAsync({
      expiresAt: { $lt: cutoffDate }
    });

    if (deletedCount > 0) {
      console.log(`Cleaned up ${deletedCount} expired password reset tokens`);
    }
  }, 60 * 60 * 1000); // Every hour
}

export const PasswordResetHelpers = {
  /**
   * Generate a new password reset token
   * @param {string} userId - User ID
   * @param {string} email - User email
   * @returns {Object} Token data with token string and expiration
   */
  async createResetToken(userId, email) {
    const token = Random.id(32); // 32-character secure random token
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour from now

    const tokenData = {
      token,
      userId,
      email,
      createdAt: now,
      expiresAt,
      used: false
    };

    await PasswordResetTokensCollection.insertAsync(tokenData);
    console.log(`Created password reset token for user ${userId} (${email})`);

    return {
      token,
      expiresAt
    };
  },

  /**
   * Validate a password reset token
   * @param {string} token - The reset token to validate
   * @returns {Object|null} Token data if valid, null if invalid/expired
   */
  async validateToken(token) {
    if (!token) return null;

    const tokenData = await PasswordResetTokensCollection.findOneAsync({
      token,
      used: false,
      expiresAt: { $gt: new Date() }
    });

    return tokenData;
  },

  /**
   * Mark a token as used
   * @param {string} token - The token to mark as used
   */
  async markTokenAsUsed(token) {
    await PasswordResetTokensCollection.updateAsync(
      { token },
      {
        $set: {
          used: true,
          usedAt: new Date()
        }
      }
    );
    console.log(`Marked password reset token as used: ${token}`);
  },

  /**
   * Invalidate all tokens for a user (e.g., after password change)
   * @param {string} userId - User ID
   */
  async invalidateUserTokens(userId) {
    const result = await PasswordResetTokensCollection.updateAsync(
      { userId, used: false },
      {
        $set: {
          used: true,
          usedAt: new Date()
        }
      },
      { multi: true }
    );

    if (result > 0) {
      console.log(`Invalidated ${result} password reset tokens for user ${userId}`);
    }
  },

  /**
   * Clean up expired tokens manually
   */
  async cleanupExpiredTokens() {
    const now = new Date();
    const deletedCount = await PasswordResetTokensCollection.removeAsync({
      expiresAt: { $lt: now }
    });

    console.log(`Cleaned up ${deletedCount} expired password reset tokens`);
    return deletedCount;
  }
};
