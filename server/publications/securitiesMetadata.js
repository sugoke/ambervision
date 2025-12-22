import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { SecuritiesMetadataCollection } from '../../imports/api/securitiesMetadata.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';

/**
 * Publish securities metadata for admin users
 */
Meteor.publish('securitiesMetadata', async function(sessionId, filters = {}) {
  check(sessionId, String);
  check(filters, Match.Optional(Object));

  // Validate session
  if (!sessionId) {
    console.log('[securitiesMetadata] No session ID provided');
    return this.ready();
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    console.log('[securitiesMetadata] Invalid session');
    return this.ready();
  }

  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    console.log('[securitiesMetadata] User not found');
    return this.ready();
  }

  // Only publish to admin and superadmin
  if (user.role !== 'admin' && user.role !== 'superadmin') {
    console.log('[securitiesMetadata] Not an admin user');
    return this.ready();
  }

  console.log(`[securitiesMetadata] Publishing securities metadata for admin user: ${user.username}`);

  // Build query from filters
  const query = {};

  if (filters.isClassified !== undefined) {
    // Use $ne: true for false case to also match documents where isClassified doesn't exist
    if (filters.isClassified === true) {
      query.isClassified = true;
    } else {
      query.isClassified = { $ne: true };
    }
  }

  if (filters.assetClass) {
    query.assetClass = filters.assetClass;
  }

  if (filters.searchTerm) {
    const regex = new RegExp(filters.searchTerm, 'i');
    query.$or = [
      { isin: regex },
      { securityName: regex }
    ];
  }

  // Return cursor with sorting: unclassified first
  return SecuritiesMetadataCollection.find(query, {
    sort: {
      isClassified: 1,  // false (0) before true (1) - unclassified first
      securityName: 1
    }
  });
});
