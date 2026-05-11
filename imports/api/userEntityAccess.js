import { Mongo } from 'meteor/mongo';
import { check, Match } from 'meteor/check';

// User Entity Access collection
// Many-to-many relationship between user accounts (login) and client entities
// Allows multiple users to view the same entity without duplicating data
export const UserEntityAccessCollection = new Mongo.Collection('userEntityAccess');

// Schema structure:
// {
//   userId: String (reference to customUsers - the login account),
//   entityId: String (reference to clientEntities - the account holder),
//   accessLevel: String (full, readonly),
//   grantedBy: String (userId of superadmin/admin who granted access),
//   grantedAt: Date,
//   isActive: Boolean,
//   createdAt: Date,
//   updatedAt: Date
// }

export const ACCESS_LEVELS = {
  FULL: 'full',
  READONLY: 'readonly'
};

// Helper functions for access management
export const UserEntityAccessHelpers = {
  // Get all entity IDs a user has access to
  async getEntityIdsForUser(userId) {
    check(userId, String);
    const accessRecords = await UserEntityAccessCollection.find({
      userId,
      isActive: true
    }).fetchAsync();
    return accessRecords.map(r => r.entityId);
  },

  // Get all user IDs that have access to an entity
  async getUserIdsForEntity(entityId) {
    check(entityId, String);
    const accessRecords = await UserEntityAccessCollection.find({
      entityId,
      isActive: true
    }).fetchAsync();
    return accessRecords.map(r => r.userId);
  },

  // Get full access records for a user
  async getAccessRecordsForUser(userId) {
    check(userId, String);
    return await UserEntityAccessCollection.find({
      userId,
      isActive: true
    }).fetchAsync();
  },

  // Get full access records for an entity
  async getAccessRecordsForEntity(entityId) {
    check(entityId, String);
    return await UserEntityAccessCollection.find({
      entityId,
      isActive: true
    }).fetchAsync();
  },

  // Check if a user has access to an entity
  async hasAccess(userId, entityId) {
    check(userId, String);
    check(entityId, String);
    const record = await UserEntityAccessCollection.findOneAsync({
      userId,
      entityId,
      isActive: true
    });
    return !!record;
  },

  // Check access level
  async getAccessLevel(userId, entityId) {
    check(userId, String);
    check(entityId, String);
    const record = await UserEntityAccessCollection.findOneAsync({
      userId,
      entityId,
      isActive: true
    });
    return record ? record.accessLevel : null;
  },

  // Grant access to a user for an entity
  async grantAccess(userId, entityId, accessLevel, grantedBy) {
    check(userId, String);
    check(entityId, String);
    check(accessLevel, Match.OneOf(...Object.values(ACCESS_LEVELS)));
    check(grantedBy, String);

    // Check if access already exists
    const existing = await UserEntityAccessCollection.findOneAsync({
      userId,
      entityId
    });

    if (existing) {
      // Reactivate or update existing record
      return await UserEntityAccessCollection.updateAsync(existing._id, {
        $set: {
          accessLevel,
          grantedBy,
          grantedAt: new Date(),
          isActive: true,
          updatedAt: new Date()
        }
      });
    }

    // Create new access record
    return await UserEntityAccessCollection.insertAsync({
      userId,
      entityId,
      accessLevel,
      grantedBy,
      grantedAt: new Date(),
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  },

  // Revoke access
  async revokeAccess(userId, entityId) {
    check(userId, String);
    check(entityId, String);

    return await UserEntityAccessCollection.updateAsync(
      { userId, entityId, isActive: true },
      { $set: { isActive: false, updatedAt: new Date() } }
    );
  },

  // Revoke all access for a user
  async revokeAllAccessForUser(userId) {
    check(userId, String);
    const count = await UserEntityAccessCollection.updateAsync(
      { userId, isActive: true },
      { $set: { isActive: false, updatedAt: new Date() } },
      { multi: true }
    );
    return count;
  },

  // Revoke all access for an entity
  async revokeAllAccessForEntity(entityId) {
    check(entityId, String);
    const count = await UserEntityAccessCollection.updateAsync(
      { entityId, isActive: true },
      { $set: { isActive: false, updatedAt: new Date() } },
      { multi: true }
    );
    return count;
  }
};
