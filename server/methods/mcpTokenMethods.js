import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';
import { McpApiTokensCollection, McpTokenHelpers } from '/imports/api/mcpApiTokens';

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
