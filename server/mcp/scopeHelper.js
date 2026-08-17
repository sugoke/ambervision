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
import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UserEntityAccessHelpers } from '/imports/api/userEntityAccess';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PortfolioSnapshotsCollection } from '/imports/api/portfolioSnapshots';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
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
    // Match the canonical selector (clientEntities.getEntitiesByRMs,
    // schedule.js): entities are linked to an RM via `assignedUserIds`, with
    // `relationshipManagerId` only a legacy fallback. Matching the deprecated
    // field alone made RMs whose entities use assignedUserIds see nothing.
    const entities = await ClientEntitiesCollection.find({
      $or: [
        { assignedUserIds: { $in: rmIds } },
        { relationshipManagerId: { $in: rmIds } }
      ],
      isActive: true,
      // Archiving does NOT clear isActive, so without this an archived client's
      // NAME still enters the scope (list_entities, Amber's prompt entity list)
      // even though its data is blocked by the holdings/allocations exclusions.
      // Same for the fictional demo client, which must only ever appear via an
      // explicit View As selection in the app — never in an assistant's scope.
      status: { $ne: 'archived' },
      isDemo: { $ne: true }
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
    // Access grants can outlive an entity's lifecycle: drop archived (and demo)
    // entities here so their names never enter a client's scope or prompt.
    if (entityIds.length > 0) {
      const live = await ClientEntitiesCollection.find(
        { _id: { $in: entityIds }, status: { $ne: 'archived' }, isDemo: { $ne: true } },
        { fields: { _id: 1 } }
      ).fetchAsync();
      allowedEntityIds = live.map(e => e._id);
    } else {
      allowedEntityIds = entityIds;
    }
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
      // Archived (closed) relationships are hidden everywhere, no exception —
      // refuse explicit drill-down too (matches the pmsHoldings publication).
      if (ClientEntityHelpers.isEntityArchived(entity)) {
        throw new Error(`Entity ${entityId} is archived`);
      }
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
      // Pre-resolve actual portfolio codes for these account bases. The suffix
      // `(-|$)` anchors the match to a whole account: base `504024` matches
      // `504024` and currency sub-accounts `504024-USD`, but NOT a different
      // client's `5040241`. Without the anchor an account base bleeds into every
      // neighbouring code sharing its prefix — a cross-client read. The web app
      // uses the same `(-|$)` anchor (tools.js:572, pmsHoldings.js:293).
      const regex = new RegExp('^(' + bases.map(escapeRegex).join('|') + ')(-|$)');
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
  // Return the scope predicate wrapped in a top-level $and, NEVER a bare
  // { $or: [...] }. Call sites spread this filter into a larger query object
  // and frequently add their own $or (e.g. an underlying/text match). A bare
  // $or here would be silently overwritten by the caller's $or — the exact
  // key-collision that dropped the owner predicate in get_underlying_exposure
  // and dumped every client's holdings. $and is an implicit-AND top-level key
  // that cannot collide with a spread-in $or, so the scope always survives.
  const scopeClause = or.length === 1 ? or[0] : { $or: or };
  return { $and: [scopeClause] };
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Scope filter for PMSHoldings */
// PMSHoldings and PortfolioSnapshots store every position/series TWICE: once per
// account and once as a per-user "CONSOLIDATED" roll-up copy (portfolioCode:
// 'CONSOLIDATED'), kept for the app's consolidated tab. The per-account rows are the
// source of truth; any aggregate that reads both counts the same money twice. The
// roll-ups also carry entityId/userId, so entity-scoped queries double just like
// admin ones. Every MCP consumer (external clients AND the in-process Amber chat)
// must therefore see only per-account rows — a tool that filters to one explicit
// account overrides portfolioCode at the top level, which composes safely with this.
const EXCLUDE_CONSOLIDATED = { portfolioCode: { $ne: 'CONSOLIDATED' } };

/** Scope filter for PMSHoldings */
export async function buildHoldingScopeFilter(scope) {
  const base = await buildEntityOrAccountMatchFilter(scope, PMSHoldingsCollection);
  // Archived (closed-relationship) clients' holdings are hidden everywhere, including
  // admin "see all" and explicit drill-down.
  const exclusion = await ClientEntityHelpers.archivedHoldingsSelector();
  const clauses = [base, EXCLUDE_CONSOLIDATED];
  if (exclusion.$nor) clauses.push(exclusion);
  return { $and: clauses };
}

/** Scope filter for PortfolioSnapshots.
 *  Archived clients intentionally stay IN snapshot history (it must reflect what was
 *  true at the time) — only the double-counting roll-ups are excluded. */
export async function buildSnapshotScopeFilter(scope) {
  const base = await buildEntityOrAccountMatchFilter(scope, PortfolioSnapshotsCollection);
  return { $and: [base, EXCLUDE_CONSOLIDATED] };
}

/**
 * Scope filter for PMSOperations (transactions). Resolves portfolio codes from
 * the operations collection itself — scoping via snapshots silently drops
 * transactions for accounts that never produced a snapshot.
 */
export async function buildOperationsScopeFilter(scope) {
  return buildEntityOrAccountMatchFilter(scope, PMSOperationsCollection);
}

/**
 * AND an archived-client exclusion onto an allocations query so closed relationships
 * never contribute to product visibility, exposure, or risk aggregations.
 */
export async function applyArchivedAllocationExclusion(query) {
  const exclusion = await ClientEntityHelpers.archivedAllocationsSelector();
  return exclusion.$nor ? { $and: [query, exclusion] } : query;
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
