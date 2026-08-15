import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';
import { McpApiTokensCollection, McpTokenHelpers } from '/imports/api/mcpApiTokens';
import { createRateLimiter } from '../mcp/rateLimit.js';

// Token creation is not a high-frequency action; cap it per user so a
// compromised session can't mint an unbounded number of long-lived tokens.
const createTokenRateLimit = createRateLimiter({ max: 10 });

async function resolveUserFromSession(sessionId) {
  const session = await SessionHelpers.validateSession(sessionId);
  if (!session) throw new Meteor.Error('not-authorized', 'Invalid or expired session');
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) throw new Meteor.Error('not-authorized', 'User not found');
  return user;
}

Meteor.methods({
  async 'mcpTokens.create'(sessionId, params) {
    check(sessionId, String);
    check(params, {
      name: String,
      ttlDays: Match.Maybe(Match.OneOf(Number, null))
    });

    const user = await resolveUserFromSession(sessionId);

    if (!createTokenRateLimit(user._id)) {
      throw new Meteor.Error('rate-limited', 'Too many tokens created recently. Try again shortly.');
    }

    // Durable audit record: a personal token carries the creator's full app
    // scope over MCP (an admin's token = whole-platform read), so token minting
    // is worth a reviewable log line.
    console.log(`[MCP][AUDIT] token created: user=${user._id} role=${user.role} name=${String(params.name).slice(0, 60)} ttlDays=${params.ttlDays ?? 'none'}`);

    const { rawToken, tokenDoc } = await McpTokenHelpers.generate(
      user._id,
      params.name,
      params.ttlDays
    );

    // Raw token returned ONCE. Never stored, never sent again.
    return {
      rawToken,
      _id: tokenDoc._id,
      prefix: tokenDoc.prefix,
      name: tokenDoc.name,
      createdAt: tokenDoc.createdAt,
      expiresAt: tokenDoc.expiresAt
    };
  },

  async 'mcpTokens.list'(sessionId) {
    check(sessionId, String);
    const user = await resolveUserFromSession(sessionId);
    return await McpTokenHelpers.listForUser(user._id);
  },

  async 'mcpTokens.revoke'(sessionId, tokenId) {
    check(sessionId, String);
    check(tokenId, String);

    const user = await resolveUserFromSession(sessionId);

    // Verify ownership before revoking
    const token = await McpApiTokensCollection.findOneAsync({ _id: tokenId });
    if (!token) throw new Meteor.Error('not-found', 'Token not found');
    if (token.userId !== user._id) {
      throw new Meteor.Error('not-authorized', 'You can only revoke your own tokens');
    }

    const ok = await McpTokenHelpers.revoke(tokenId, user._id);
    return { success: ok };
  }
});
