/**
 * Client Documents Publications
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClientDocumentsCollection } from '/imports/api/clientDocuments.js';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions.js';
import { UsersCollection } from '/imports/api/users.js';

// Client documents are KYC/PII: a bare valid session is not enough — the caller
// must be the client themselves or a staff member (mirrors clientDocuments.getDownloadUrl).
const STAFF_ROLES = ['admin', 'superadmin', 'compliance', 'rm', 'assistant'];

/**
 * Publish documents for a specific client
 * Uses async session validation with manual publish for Meteor 3.x compatibility
 */
Meteor.publish('clientDocuments', async function (userId, sessionId) {
  check(userId, Match.Maybe(String));
  check(sessionId, Match.Maybe(String));

  console.log('[clientDocuments pub] ====== SUBSCRIPTION CALLED ======');
  console.log('[clientDocuments pub] userId:', userId, 'sessionId:', sessionId?.substring(0, 8) + '...');

  // Quick validation. SECURITY: string-only sessionId — a selector object would match
  // a live session and, combined with staff role, leak KYC documents.
  if (typeof sessionId !== 'string' || sessionId.length === 0 || typeof userId !== 'string' || userId.length === 0) {
    console.log('[clientDocuments pub] Missing/invalid params, returning ready()');
    return this.ready();
  }

  // Async session validation for Meteor 3.x
  const session = await SessionHelpers.findByToken(sessionId);
  if (!session) {
    console.log('[clientDocuments pub] No valid session found');
    return this.ready();
  }

  // Authorize: the requested userId must be the caller themselves, or the caller
  // must be staff. Previously any valid session could read ANY user's documents
  // by passing an arbitrary userId (IDOR on KYC/identity documents).
  const currentUser = await UsersCollection.findOneAsync(session.userId);
  if (!currentUser) {
    return this.ready();
  }
  const isSelf = currentUser._id === userId;
  const isStaff = STAFF_ROLES.includes(currentUser.role);
  if (!isSelf && !isStaff) {
    console.log('[clientDocuments pub] Not authorized for userId:', userId);
    return this.ready();
  }

  return ClientDocumentsCollection.find({ userId });
});

/**
 * Publish all documents with expiration warnings (for dashboard alerts)
 * Only returns documents expiring within 3 months or already expired
 */
Meteor.publish('clientDocuments.expiring', function () {
  if (!this.userId) {
    return this.ready();
  }

  const threeMonthsFromNow = new Date();
  threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);

  // Get documents expiring soon or already expired
  return ClientDocumentsCollection.find({
    expirationDate: { $lte: threeMonthsFromNow }
  });
});

/**
 * Publish documents for multiple clients (for bulk views)
 */
Meteor.publish('clientDocuments.forUsers', function (userIds) {
  check(userIds, [String]);

  if (!this.userId) {
    return this.ready();
  }

  if (!userIds || userIds.length === 0) {
    return this.ready();
  }

  return ClientDocumentsCollection.find({ userId: { $in: userIds } });
});
