/**
 * Entity Resolver Utility
 *
 * Provides dual-mode resolution between the old userId-based system
 * and the new entityId-based system during the migration transition.
 *
 * Usage pattern: prefer entityId, fallback to userId for unmigrated records.
 */

import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { UserEntityAccessCollection, UserEntityAccessHelpers } from '/imports/api/userEntityAccess';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';

/**
 * Resolve entityId from a userId (for backward compatibility)
 * Looks up the entity that was migrated from this userId
 * @param {string} userId
 * @returns {string|null} entityId
 */
export async function resolveEntityId(userId) {
  if (!userId) return null;

  // Try direct lookup via migration field
  const entity = await ClientEntitiesCollection.findOneAsync({
    migratedFromUserId: userId,
    isActive: true
  });

  if (entity) return entity._id;

  // Try via access grants (user might have access to an entity)
  const accessRecord = await UserEntityAccessCollection.findOneAsync({
    userId,
    isActive: true
  });

  return accessRecord ? accessRecord.entityId : null;
}

/**
 * Resolve userId from an entityId (for backward compatibility)
 * Returns the original userId that the entity was migrated from
 * @param {string} entityId
 * @returns {string|null} userId
 */
export async function resolveUserId(entityId) {
  if (!entityId) return null;

  const entity = await ClientEntitiesCollection.findOneAsync(entityId);
  return entity ? entity.migratedFromUserId : null;
}

/**
 * Get entity IDs accessible to a user based on their role
 * This is the entity-based equivalent of getFilteredClientIds
 * @param {Object} currentUser - The authenticated user
 * @param {Object} viewAsFilter - Optional filter {type: 'entity'|'client'|'account', id: String}
 * @returns {Array<String>} Array of entity IDs
 */
export async function getFilteredEntityIds(currentUser, viewAsFilter = null) {
  const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
  const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT;
  const isCompliance = currentUser.role === USER_ROLES.COMPLIANCE;
  const isClient = currentUser.role === USER_ROLES.CLIENT;

  // Client sees only entities they have access to
  if (isClient) {
    const entityIds = await UserEntityAccessHelpers.getEntityIdsForUser(currentUser._id);
    if (entityIds.length > 0) return entityIds;
    // Fallback: resolve from old userId-based system
    const entityId = await resolveEntityId(currentUser._id);
    return entityId ? [entityId] : [];
  }

  // If viewAsFilter is active
  if (viewAsFilter && (isAdmin || isRM || isCompliance)) {
    if (viewAsFilter.type === 'entity') {
      // Direct entity filter
      if (isRM) {
        // Verify RM has access to this entity
        const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
        const entity = await ClientEntitiesCollection.findOneAsync({
          _id: viewAsFilter.id,
          relationshipManagerId: { $in: rmIds }
        });
        if (!entity) return [];
      }
      return [viewAsFilter.id];
    }

    if (viewAsFilter.type === 'client') {
      // Backward compat: resolve client userId to entityId
      const entityId = await resolveEntityId(viewAsFilter.id);
      if (entityId) {
        if (isRM) {
          const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
          const entity = await ClientEntitiesCollection.findOneAsync({
            _id: entityId,
            relationshipManagerId: { $in: rmIds }
          });
          if (!entity) return [];
        }
        return [entityId];
      }
      return [];
    }

    if (viewAsFilter.type === 'account') {
      // Get the entity that owns this account
      const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      if (bankAccount) {
        const entityId = bankAccount.entityId || await resolveEntityId(bankAccount.userId);
        if (entityId) {
          if (isRM) {
            const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
            const entity = await ClientEntitiesCollection.findOneAsync({
              _id: entityId,
              relationshipManagerId: { $in: rmIds }
            });
            if (!entity) return [];
          }
          return [entityId];
        }
      }
      return [];
    }
  }

  // No filter — get all entities based on role
  if (isAdmin || isCompliance) {
    // Return null to signal "no filter needed" (all entities)
    return null;
  }

  if (isRM) {
    const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
    const entities = await ClientEntitiesCollection.find({
      relationshipManagerId: { $in: rmIds },
      isActive: true
    }, { fields: { _id: 1 } }).fetchAsync();
    return entities.map(e => e._id);
  }

  return [];
}

/**
 * Build a query filter for entityId with userId fallback
 * Returns a MongoDB query condition that matches records by entityId (preferred)
 * or userId (fallback for unmigrated records)
 * @param {Array<String>|null} entityIds - Array of entity IDs, or null for no filter
 * @param {Array<String>} userIds - Fallback userId array (from old system)
 * @returns {Object} MongoDB query conditions to merge into existing filter
 */
export function buildEntityOrUserFilter(entityIds, userIds = []) {
  if (entityIds === null) {
    // No filter needed (admin sees all)
    return {};
  }

  if (entityIds.length === 0 && userIds.length === 0) {
    // No access — return impossible filter
    return { _id: { $exists: false } };
  }

  // Prefer entityId, fallback to userId for unmigrated records
  const conditions = [];
  if (entityIds.length > 0) {
    conditions.push({ entityId: { $in: entityIds } });
  }
  if (userIds.length > 0) {
    conditions.push({ entityId: { $exists: false }, userId: { $in: userIds } });
  }

  return conditions.length === 1 ? conditions[0] : { $or: conditions };
}

/**
 * Build portfolio code to entityId mapping for a bank (replaces buildPortfolioUserMap)
 * Returns both entityId and userId for dual-write during transition
 * @param {string} bankId - Bank ID
 * @returns {Map<string, {entityId: string, userId: string}>}
 */
export async function buildPortfolioEntityMap(bankId) {
  const bankAccounts = await BankAccountsCollection.find({
    bankId,
    isActive: true
  }).fetchAsync();

  const map = new Map();
  for (const account of bankAccounts) {
    if (account.accountNumber) {
      map.set(account.accountNumber, {
        entityId: account.entityId || null,
        userId: account.userId || null
      });
    }
  }
  return map;
}

/**
 * Get entityId and userId from pre-built portfolio map (with normalization)
 * @param {string} portfolioCode - Portfolio code from bank file
 * @param {Map} portfolioEntityMap - Pre-built map from buildPortfolioEntityMap()
 * @returns {{entityId: string|null, userId: string|null}}
 */
export function getEntityIdFromMap(portfolioCode, portfolioEntityMap) {
  if (!portfolioCode) return { entityId: null, userId: null };
  const normalizedCode = portfolioCode.split('-')[0];
  return portfolioEntityMap.get(normalizedCode) || { entityId: null, userId: null };
}
