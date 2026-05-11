/**
 * MCP scope helper
 *
 * Resolves the set of entity IDs, legacy user IDs, client IDs, and bank
 * accounts visible to an authenticated user. Mirrors the pmsHoldings
 * publication's three-way match:
 *   1. { entityId IN allowedEntityIds }
 *   2. { entityId absent, userId IN allowedUserIds }
 *   3. { bankId, portfolioCode IN <codes resolved from each entity's bank accounts> }
 *
 * #3 catches holdings imported by parsers that key only by portfolioCode
 * (CMB Monaco, CFM Indosuez) where entityId/userId may not be populated on
 * every row yet.
 *
 * Returned shape:
 *   {
 *     isAdmin,
 *     entityIds: Array|null,
 *     userIds:   Array,
 *     clientIds: Array,
 *     bankAccounts: Array<{ bankId, accountNumber, accountNumberBase }>
 *   }
 */

import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UserEntityAccessHelpers } from '/imports/api/userEntityAccess';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PortfolioSnapshotsCollection } from '/imports/api/portfolioSnapshots';
import { resolveEntityId, buildEntityOrUserFilter } from '/imports/utils/entityResolver';

export async function resolveMcpScope(user, { entityId = null } = {}) {
  if (!user) throw new Error('resolveMcpScope: user required');

  const isAdmin = [USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COMPLIANCE].includes(user.role);
  const isRM = user.role === USER_ROLES.RELATIONSHIP_MANAGER || user.role === USER_ROLES.ASSISTANT;
  const isClient = user.role === USER_ROLES.CLIENT;

  // Admin: sees everything (unless an entityId filter is supplied)
  if (isAdmin && !entityId) {
    return { isAdmin: true, entityIds: null, userIds: [], clientIds: [], bankAccounts: [] };
  }

  let allowedEntityIds = [];
  let allowedUserIds = [];

  if (isRM) {
    const rmIds = UserHelpers.getEffectiveRmIds(user);
    const entities = await ClientEntitiesCollection.find({
      relationshipManagerId: { $in: rmIds },
      isActive: true
    }, { fields: { _id: 1, migratedFromUserId: 1 } }).fetchAsync();
    allowedEntityIds = entities.map(e => e._id);
    const legacyClients = await UsersCollection.find(
      { relationshipManagerId: { $in: rmIds } },
      { fields: { _id: 1 } }
    ).fetchAsync();
    allowedUserIds = [
      ...entities.map(e => e.migratedFromUserId).filter(Boolean),
      ...legacyClients.map(c => c._id)
    ];
  } else if (isClient) {
    const entityIds = await UserEntityAccessHelpers.getEntityIdsForUser(user._id);
    if (entityIds.length === 0) {
      const resolved = await resolveEntityId(user._id);
      if (resolved) entityIds.push(resolved);
    }
    allowedEntityIds = entityIds;
    allowedUserIds = [user._id];
  } else if (isAdmin) {
    // Admin with entityId filter — narrowed below
  } else {
    return { isAdmin: false, entityIds: [], userIds: [], clientIds: [], bankAccounts: [] };
  }

  // Narrow to a specific entity (with authorization)
  if (entityId) {
    if (isAdmin) {
      const entity = await ClientEntitiesCollection.findOneAsync(entityId);
      if (!entity) throw new Error(`Entity ${entityId} not found`);
      allowedEntityIds = [entityId];
      allowedUserIds = entity.migratedFromUserId ? [entity.migratedFromUserId] : [];
    } else {
      if (!allowedEntityIds.includes(entityId)) {
        throw new Error(`Entity ${entityId} is not in your access scope`);
      }
      const entity = await ClientEntitiesCollection.findOneAsync(entityId);
      allowedEntityIds = [entityId];
      allowedUserIds = entity?.migratedFromUserId ? [entity.migratedFromUserId] : [];
    }
  }

  // Resolve bank accounts owned (or beneficially owned) by the in-scope entities,
  // plus any accounts directly owned by legacy users. This drives the third
  // match path for holdings keyed only by (bankId + portfolioCode).
  const accountQuery = { isActive: true, $or: [] };
  if (allowedEntityIds.length > 0) {
    accountQuery.$or.push({ entityId: { $in: allowedEntityIds } });
    accountQuery.$or.push({ beneficialOwnerIds: { $in: allowedEntityIds } });
    accountQuery.$or.push({ beneficialOwnerId: { $in: allowedEntityIds } });
  }
  if (allowedUserIds.length > 0) {
    accountQuery.$or.push({ userId: { $in: allowedUserIds } });
  }
  const bankAccounts = accountQuery.$or.length > 0
    ? await BankAccountsCollection.find(accountQuery, {
        fields: { bankId: 1, accountNumber: 1, entityId: 1, userId: 1 }
      }).fetchAsync()
    : [];

  const bankAccountMeta = bankAccounts
    .filter(a => a.bankId && a.accountNumber)
    .map(a => ({
      bankId: a.bankId,
      accountNumber: a.accountNumber,
      accountNumberBase: a.accountNumber.split('-')[0]
    }));

  const clientIds = [...new Set([...allowedEntityIds, ...allowedUserIds])];

  return {
    isAdmin: false,
    entityIds: allowedEntityIds,
    userIds: allowedUserIds,
    clientIds,
    bankAccounts: bankAccountMeta
  };
}

/**
 * Build an $or-based filter for a collection with { entityId, userId, bankId, portfolioCode }
 * keyed rows (PMSHoldings, PortfolioSnapshots, PMSOperations). Handles the three-way match
 * used by the pmsHoldings publication.
 *
 * Pre-resolves portfolioCodes per (bankId, accountNumberBase) using Collection.distinct() to
 * avoid $regex inside $or (matches the publication's optimization).
 */
async function buildEntityOrAccountMatchFilter(scope, Collection) {
  if (scope.isAdmin && scope.entityIds === null) return {}; // admin sees all

  const or = [];
  if (scope.entityIds && scope.entityIds.length > 0) {
    or.push({ entityId: { $in: scope.entityIds } });
  }
  if (scope.userIds && scope.userIds.length > 0) {
    or.push({ entityId: { $exists: false }, userId: { $in: scope.userIds } });
  }

  // Third path: (bankId, portfolioCode) for each of the entity's accounts.
  // Group by bankId to keep the query count low.
  if (scope.bankAccounts && scope.bankAccounts.length > 0) {
    const rawColl = Collection.rawCollection();
    const byBank = new Map();
    for (const a of scope.bankAccounts) {
      if (!byBank.has(a.bankId)) byBank.set(a.bankId, new Set());
      byBank.get(a.bankId).add(a.accountNumberBase);
    }
    for (const [bankId, baseSet] of byBank.entries()) {
      const bases = [...baseSet];
      // Pre-resolve actual portfolio codes that start with any of these bases
      const regex = new RegExp('^(' + bases.map(escapeRegex).join('|') + ')');
      let codes;
      try {
        codes = await rawColl.distinct('portfolioCode', { bankId, portfolioCode: { $regex: regex } });
      } catch (err) {
        console.error('[MCP scope] distinct() failed, falling back to regex match:', err?.message);
        or.push({ bankId, portfolioCode: { $regex: regex } });
        continue;
      }
      if (codes && codes.length > 0) {
        or.push({ bankId, portfolioCode: { $in: codes } });
      }
    }
  }

  if (or.length === 0) {
    // No access — impossible filter
    return { _id: { $exists: false } };
  }
  return or.length === 1 ? or[0] : { $or: or };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Scope filter for PMSHoldings */
export async function buildHoldingScopeFilter(scope) {
  return buildEntityOrAccountMatchFilter(scope, PMSHoldingsCollection);
}

/** Scope filter for PortfolioSnapshots */
export async function buildSnapshotScopeFilter(scope) {
  return buildEntityOrAccountMatchFilter(scope, PortfolioSnapshotsCollection);
}

/**
 * Simple entityId/userId filter (no bankId path). Used where the target
 * collection has no bankId/portfolioCode fields (e.g. EquityHoldings is
 * keyed by bankAccountId instead).
 */
export function buildSimpleEntityOrUserFilter(scope) {
  if (scope.isAdmin && scope.entityIds === null) return {};
  return buildEntityOrUserFilter(scope.entityIds, scope.userIds);
}
