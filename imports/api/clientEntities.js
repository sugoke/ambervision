import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import { check, Match } from 'meteor/check';

// Client Entities collection
// Represents the actual account holders: physical persons, life insurance companies, corporations
// Separated from user accounts (login) to allow multiple users to view the same entity
export const ClientEntitiesCollection = new Mongo.Collection('clientEntities');

// Client entity schema structure:
// {
//   type: String (physical_person, company),
//   isInsurance: Boolean (true if this company is a life insurance company),
//   status: String (prospect, active, archived) - lifecycle status,
//   relationshipManagerId: String (DEPRECATED - use assignedUserIds),
//   assignedUserIds: [String] (array of RM/assistant userIds managing this entity),
//   referenceCurrency: String (USD, EUR, GBP, CHF, etc.),
//   profile: {
//     // physical_person:
//     firstName: String,
//     lastName: String,
//     birthday: Date,
//     familyMembers: [{ name: String, relationship: String, birthday: Date, _id: String }],
//     // company:
//     companyName: String,
//     registrationNumber: String,
//     // life_insurance:
//     companyName: String,
//     policyNumber: String,
//     // common:
//     preferredLanguage: String,
//     createdAt: Date,
//     updatedAt: Date
//   },
//   stakeholders: [{
//     _id: String,
//     role: String (beneficiary, director, ubo, signatory, shareholder),
//     name: String,
//     nationality: String,
//     ownershipPercentage: Number,
//     details: Object
//   }],
//   migratedFromUserId: String (original userId for rollback, null for new entities),
//   isActive: Boolean,
//   createdAt: Date,
//   updatedAt: Date
// }

// Entity lifecycle statuses
export const ENTITY_STATUSES = {
  PROSPECT: 'prospect',
  ACTIVE: 'active',
  ARCHIVED: 'archived'
};

// Entity types (life insurance companies are stored as 'company' with isInsurance flag)
export const ENTITY_TYPES = {
  PHYSICAL_PERSON: 'physical_person',
  COMPANY: 'company'
};

// Stakeholder roles
export const STAKEHOLDER_ROLES = {
  BENEFICIARY: 'beneficiary',
  DIRECTOR: 'director',
  UBO: 'ubo',
  SIGNATORY: 'signatory',
  SHAREHOLDER: 'shareholder'
};

// Helper functions for client entity management
export const ClientEntityHelpers = {
  // Get display name based on entity type
  getEntityDisplayName(entity) {
    if (!entity) return 'Unknown';
    switch (entity.type) {
      case ENTITY_TYPES.PHYSICAL_PERSON:
        return `${entity.profile?.firstName || ''} ${entity.profile?.lastName || ''}`.trim() || 'Unnamed Person';
      case ENTITY_TYPES.COMPANY:
        return entity.profile?.companyName || 'Unnamed Company';
      case 'life_insurance': // Legacy — treated as company
        return entity.profile?.companyName || 'Unnamed Company';
      default:
        return 'Unknown Entity';
    }
  },

  // Get entity type label for display
  getEntityTypeLabel(type) {
    switch (type) {
      case ENTITY_TYPES.PHYSICAL_PERSON: return 'Person';
      case ENTITY_TYPES.COMPANY: return 'Company';
      case 'life_insurance': return 'Company';
      default: return 'Unknown';
    }
  },

  // Get entity status display info (label + color)
  getEntityStatusDisplay(status) {
    switch (status) {
      case ENTITY_STATUSES.PROSPECT: return { label: 'Prospect', color: '#f59e0b' };
      case ENTITY_STATUSES.ARCHIVED: return { label: 'Archived', color: '#6b7280' };
      case ENTITY_STATUSES.ACTIVE:
      default:
        return { label: 'Active', color: '#10b981' };
    }
  },

  // Get entity by ID
  async getEntityById(entityId) {
    check(entityId, String);
    return await ClientEntitiesCollection.findOneAsync(entityId);
  },

  // Get all entities managed by a specific user (RM or assistant)
  getEntitiesByRM(rmUserId) {
    check(rmUserId, String);
    return ClientEntitiesCollection.find({
      $or: [
        { assignedUserIds: rmUserId },
        { relationshipManagerId: rmUserId } // Legacy fallback
      ],
      isActive: true
    }, { sort: { 'profile.lastName': 1, 'profile.firstName': 1, 'profile.companyName': 1 } });
  },

  // Get all entities managed by multiple users (for assistants)
  getEntitiesByRMs(rmUserIds) {
    check(rmUserIds, [String]);
    return ClientEntitiesCollection.find({
      $or: [
        { assignedUserIds: { $in: rmUserIds } },
        { relationshipManagerId: { $in: rmUserIds } } // Legacy fallback
      ],
      isActive: true
    }, { sort: { 'profile.lastName': 1, 'profile.firstName': 1, 'profile.companyName': 1 } });
  },

  // Get all active entities
  getAllEntities() {
    return ClientEntitiesCollection.find({
      isActive: true
    }, { sort: { 'profile.lastName': 1, 'profile.firstName': 1, 'profile.companyName': 1 } });
  },

  // Create a new client entity
  async createEntity({ type, profile, relationshipManagerId, assignedUserIds, referenceCurrency, stakeholders = [], migratedFromUserId = null, status = ENTITY_STATUSES.ACTIVE }) {
    check(type, Match.OneOf(...Object.values(ENTITY_TYPES), 'life_insurance'));
    check(profile, Object);

    // Build assignedUserIds from either the new array or legacy single RM
    const effectiveAssignedUserIds = assignedUserIds || (relationshipManagerId ? [relationshipManagerId] : []);

    const entityData = {
      type,
      status: Object.values(ENTITY_STATUSES).includes(status) ? status : ENTITY_STATUSES.ACTIVE,
      profile: {
        ...profile,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      assignedUserIds: effectiveAssignedUserIds,
      relationshipManagerId: effectiveAssignedUserIds[0] || null, // Legacy compat
      referenceCurrency: referenceCurrency || 'EUR',
      stakeholders: stakeholders.map(s => ({
        ...s,
        _id: s._id || Random.id()
      })),
      migratedFromUserId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return await ClientEntitiesCollection.insertAsync(entityData);
  },

  // Update an entity
  async updateEntity(entityId, updates) {
    check(entityId, String);
    check(updates, Object);

    const allowedFields = ['profile', 'relationshipManagerId', 'assignedUserIds', 'referenceCurrency', 'stakeholders', 'type', 'status', 'isInsurance'];
    const setUpdates = { updatedAt: new Date() };

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (field === 'profile') {
          // Merge profile fields rather than replacing entirely
          for (const [key, value] of Object.entries(updates.profile)) {
            setUpdates[`profile.${key}`] = value;
          }
          setUpdates['profile.updatedAt'] = new Date();
        } else {
          setUpdates[field] = updates[field];
        }
      }
    }

    return await ClientEntitiesCollection.updateAsync(entityId, { $set: setUpdates });
  },

  // Deactivate an entity (soft delete)
  async deactivateEntity(entityId) {
    check(entityId, String);
    return await ClientEntitiesCollection.updateAsync(entityId, {
      $set: { isActive: false, updatedAt: new Date() }
    });
  },

  // Find entity by migrated userId (for backward compatibility)
  async findByMigratedUserId(userId) {
    check(userId, String);
    return await ClientEntitiesCollection.findOneAsync({ migratedFromUserId: userId, isActive: true });
  }
};
