/**
 * Client Documents Publications
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClientDocumentsCollection } from '/imports/api/clientDocuments.js';
import { SessionsCollection } from '/imports/api/sessions.js';

/**
 * Publish documents for a specific client
 * Uses session-based authentication (sync for reactivity)
 */
Meteor.publish('clientDocuments', function (userId, sessionId) {
  check(userId, Match.Maybe(String));
  check(sessionId, Match.Maybe(String));

  console.log('[clientDocuments pub] Called with userId:', userId, 'sessionId:', sessionId?.substring(0, 8) + '...');

  // Session-based authentication
  if (!sessionId) {
    console.log('[clientDocuments pub] No sessionId, returning ready()');
    return this.ready();
  }

  // Use sync findOne to maintain reactivity
  const session = SessionsCollection.findOne({
    sessionId,
    isActive: true
  });

  if (!session) {
    console.log('[clientDocuments pub] No valid session found');
    return this.ready();
  }

  if (!userId) {
    console.log('[clientDocuments pub] No userId, returning ready()');
    return this.ready();
  }

  // Check what documents exist for this user
  const docCount = ClientDocumentsCollection.find({ userId }).count();
  console.log('[clientDocuments pub] Found', docCount, 'documents for userId:', userId);

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
