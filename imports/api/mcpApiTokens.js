import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import crypto from 'crypto';
import { UsersCollection } from '/imports/api/users';

export const McpApiTokensCollection = new Mongo.Collection('mcpApiTokens');

export const MCP_TOKEN_PREFIX = 'amvs_';

if (Meteor.isServer) {
  McpApiTokensCollection.createIndex({ tokenHash: 1 }, { unique: true });
  McpApiTokensCollection.createIndex({ userId: 1 });
  McpApiTokensCollection.createIndex({ revokedAt: 1, expiresAt: 1 });
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export const McpTokenHelpers = {
  /**
   * Generate a new MCP API token for a user.
   * Raw token is only returned once — the caller MUST surface it to the user immediately.
   * Only the hash is persisted.
   */
  async generate(userId, name, ttlDays = null) {
    if (!userId) throw new Meteor.Error('invalid-user', 'userId required');
    if (!name || typeof name !== 'string') throw new Meteor.Error('invalid-name', 'name required');

    const rawToken = `${MCP_TOKEN_PREFIX}${Random.id(40)}`;
    const tokenHash = hashToken(rawToken);
    const prefix = rawToken.slice(0, MCP_TOKEN_PREFIX.length + 8); // e.g. "amvs_ab12cd34"
    const now = new Date();
    const expiresAt = ttlDays && Number(ttlDays) > 0
      ? new Date(now.getTime() + Number(ttlDays) * 24 * 60 * 60 * 1000)
      : null;

    const doc = {
      userId,
      tokenHash,
      prefix,
      name: name.trim().slice(0, 100),
      createdAt: now,
      lastUsedAt: null,
      expiresAt,
      revokedAt: null,
      revokedBy: null
    };

    const _id = await McpApiTokensCollection.insertAsync(doc);
    return { rawToken, tokenDoc: { _id, ...doc } };
  },

  /**
   * Validate a raw bearer token. Returns { tokenDoc, user } if valid, null otherwise.
   * Updates lastUsedAt on success (fire and forget).
   */
  async validate(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return null;
    if (!rawToken.startsWith(MCP_TOKEN_PREFIX)) return null;

    const tokenHash = hashToken(rawToken);
    const tokenDoc = await McpApiTokensCollection.findOneAsync({ tokenHash });
    if (!tokenDoc) return null;
    if (tokenDoc.revokedAt) return null;
    if (tokenDoc.expiresAt && tokenDoc.expiresAt.getTime() < Date.now()) return null;

    const user = await UsersCollection.findOneAsync(tokenDoc.userId);
    if (!user) return null;

    // Fire-and-forget lastUsedAt update
    McpApiTokensCollection.updateAsync(tokenDoc._id, {
      $set: { lastUsedAt: new Date() }
    }).catch(err => console.error('[MCP] Failed to update lastUsedAt:', err));

    return { tokenDoc, user };
  },

  async revoke(tokenId, byUserId) {
    const result = await McpApiTokensCollection.updateAsync(
      { _id: tokenId, revokedAt: null },
      { $set: { revokedAt: new Date(), revokedBy: byUserId || null } }
    );
    return result > 0;
  },

  /**
   * Return public metadata for a user's tokens.
   * Never returns tokenHash or the raw token.
   */
  async listForUser(userId) {
    const docs = await McpApiTokensCollection.find(
      { userId },
      {
        fields: { tokenHash: 0 },
        sort: { createdAt: -1 }
      }
    ).fetchAsync();
    return docs;
  }
};
