/**
 * Client Documents Publications
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClientDocumentsCollection } from '/imports/api/clientDocuments.js';
import { SessionsCollection } from '/imports/api/sessions.js';

/**
 * Publish documents for a specific client
 * Uses async session validation with manual publish for Meteor 3.x compatibility
 */
Meteor.publish('clientDocuments', async function (userId, sessionId) {
  check(userId, Match.Maybe(String));
  check(sessionId, Match.Maybe(String));

  console.log('[clientDocuments pub] ====== SUBSCRIPTION CALLED ======');
  console.log('[clientDocuments pub] userId:', userId, 'sessionId:', sessionId?.substring(0, 8) + '...');

  // Quick validation
  if (!sessionId || !userId) {
    console.log('[clientDocuments pub] Missing params, returning ready()');
    return this.ready();
  }

  // Async session validation for Meteor 3.x
  const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
  if (!session) {
    console.log('[clientDocuments pub] No valid session found');
    return this.ready();
  }
  console.log('[clientDocuments pub] Session valid for user:', session.userId);

  // Return documents cursor for the specified user
  const docCount = await ClientDocumentsCollection.find({ userId }).countAsync();
  console.log('[clientDocuments pub] Returning', docCount, 'documents for userId:', userId);

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
