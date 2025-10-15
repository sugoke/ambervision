import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';

/**
 * Amber Conversations Collection
 *
 * Stores chat conversations between users and Amber AI assistant.
 * Each conversation is scoped to a user and organized into sessions.
 *
 * DOCUMENT STRUCTURE:
 * {
 *   _id: ObjectId,
 *   userId: String,              // Owner of the conversation
 *   sessionId: String,            // Unique session identifier (UUID)
 *
 *   messages: [{
 *     _id: String,                // Message ID
 *     role: String,               // 'user' | 'assistant'
 *     content: String,            // Message content
 *     timestamp: Date,            // When message was sent
 *     tokens: {
 *       input: Number,            // Input tokens used
 *       output: Number,           // Output tokens used
 *       cached: Number            // Cached tokens (for Anthropic prompt caching)
 *     }
 *   }],
 *
 *   contextSummary: {
 *     productCount: Number,       // Number of products in user's scope
 *     dataScope: String,          // 'admin' | 'rm' | 'client'
 *     lastCacheRefresh: Date,     // When context was last rebuilt
 *     contextTokens: Number       // Size of cached context
 *   },
 *
 *   metadata: {
 *     userRole: String,           // User's role at time of conversation
 *     userEmail: String,          // User's email
 *     userName: String            // User's display name
 *   },
 *
 *   status: String,               // 'active' | 'archived'
 *
 *   createdAt: Date,
 *   updatedAt: Date,
 *   expiresAt: Date               // Auto-cleanup after 30 days
 * }
 */

export const AmberConversationsCollection = new Mongo.Collection('amberConversations');

// Server-side indexes and methods
if (Meteor.isServer) {
  const { SessionsCollection } = require('./sessions');
  const { UsersCollection } = require('./users');

  // Create indexes for efficient queries
  Meteor.startup(() => {
    AmberConversationsCollection.createIndexAsync({ userId: 1, createdAt: -1 });
    AmberConversationsCollection.createIndexAsync({ sessionId: 1 });
    AmberConversationsCollection.createIndexAsync({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  });

  // Publish user's conversations
  Meteor.publish('amber.conversations', async function(authSessionId, limit = 20) {
    check(authSessionId, String);
    check(limit, Number);

    // Validate session
    const session = await SessionsCollection.findOneAsync({
      sessionId: authSessionId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!session || !session.userId) {
      return this.ready();
    }

    return AmberConversationsCollection.find(
      { userId: session.userId, status: 'active' },
      {
        sort: { updatedAt: -1 },
        limit: Math.min(limit, 100) // Cap at 100
      }
    );
  });

  // Publish single conversation by session ID
  Meteor.publish('amber.conversation', async function(conversationId, authSessionId) {
    check(conversationId, String);
    check(authSessionId, String);

    // Validate session
    const session = await SessionsCollection.findOneAsync({
      sessionId: authSessionId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

    if (!session || !session.userId) {
      return this.ready();
    }

    return AmberConversationsCollection.find({
      sessionId: conversationId,
      userId: session.userId
    });
  });
}
