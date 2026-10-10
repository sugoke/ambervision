// Access scope — the single authority for "which client data may this user see".
//
// Every publication and method resolves a Scope once and builds its queries
// from the selectors below. No role string comparison or ownership check lives
// anywhere else: the role chain in resolveScope() ends with `denied`, so a role
// nobody wrote a branch for sees nothing, and every selector returns an
// impossible match for a denied scope.
//
// Data in this app is keyed three ways, and all three are covered:
//   1. entityId          — client entity (post-migration rows)
//   2. userId            — legacy login id (pre-migration rows, no entityId)
//   3. bankId+portfolioCode — bank-file rows stamped with neither
// Path 3 pre-resolves the actual portfolio codes per bank with an escaped,
// `(-|$)`-anchored regex so account `504024` matches itself and `504024-USD`,
// never another client's `5040241`, and so no $regex ends up inside a live
// cursor (oplog).
//
// Selectors always return `{ $and: [...] }`, never a bare `$or`: callers spread
// them into larger queries that often carry their own `$or`, and a key
// collision there silently drops the owner predicate.
import { Meteor } from 'meteor/meteor';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { ClientEntitiesCollection, ClientEntityHelpers, ENTITY_STATUSES } from '/imports/api/clientEntities';
import {
  BankAccountsCollection, accountHolderSelector, getAccountHolderIds, isAccountHolder
} from '/imports/api/bankAccounts';
import { UserEntityAccessCollection, UserEntityAccessHelpers } from '/imports/api/userEntityAccess';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PortfolioSnapshotsCollection } from '/imports/api/portfolioSnapshots';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { AllocationsCollection } from '/imports/api/allocations';
import { ProductsCollection } from '/imports/api/products';
import { parseViewAs } from '/imports/utils/viewAs';
import { accountBase, portfolioCodeRegexForBases, portfolioCodeMatches } from '/imports/utils/portfolioCode';
import {
  ACCESS_POLICY, SEE_ALL_ROLES, RM_LIKE_ROLES, PRODUCT_CATALOGUE_ROLES
} from './accessPolicy.js';

/** A selector that matches nothing. */
export const IMPOSSIBLE = Object.freeze({ _id: { $exists: false } });

const EXCLUDE_CONSOLIDATED = { portfolioCode: { $ne: 'CONSOLIDATED' } };

const uniq = (arr) => [...new Set((arr || []).filter(Boolean))];
const wrap = (clauses) => (clauses.length === 0 ? {} : { $and: clauses });

const LIVE_ENTITY = { isActive: true, status: { $ne: ENTITY_STATUSES.ARCHIVED }, isDemo: { $ne: true } };

// ---------------------------------------------------------------------------
// Scope resolution
// ---------------------------------------------------------------------------

function emptyScope(user, viewAs, extra = {}) {
  return {
    user, role: user?.role || null, isAdmin: false, denied: false, viewAs,
    scopedEntityId: null, entityIds: [], userIds: [], ownerIds: [],
    bankAccounts: [], bankAccountIds: [], rmIds: [],
    excludeConsolidated: false,
    ...extra
  };
}

function deniedScope(user, viewAs, reason) {
  if (reason) console.warn(`[accessScope] denied for ${user?._id} (${user?.role}): ${reason}`);
  return emptyScope(user, viewAs, { denied: true });
}

/** Account rows relevant to a scope, trimmed to the fields the selectors need. */
const ACCOUNT_FIELDS = {
  fields: { bankId: 1, accountNumber: 1, entityId: 1, holderEntityIds: 1, userId: 1,
            beneficialOwnerIds: 1, beneficialOwnerId: 1, isActive: 1 }
};

function accountMeta(a) {
  return {
    _id: a._id,
    bankId: a.bankId || null,
    accountNumber: a.accountNumber || null,
    accountNumberBase: accountBase(a.accountNumber),
    entityId: a.entityId || null,
    holderEntityIds: getAccountHolderIds(a),
    userId: a.userId || null,
    beneficialOwnerIds: uniq([...(a.beneficialOwnerIds || []), a.beneficialOwnerId])
  };
}

/**
 * Accounts belonging to a perimeter: held by one of its entities (primary or
 * co-holder), owned by one of its legacy users, beneficially owned by one of
 * its entities, or — for RM perimeters — covered by the RM as backup.
 */
function perimeterAccountSelector({ entityIds, userIds, rmIds = [] }) {
  const or = [];
  if (entityIds.length > 0) {
    or.push({ entityId: { $in: entityIds } });
    or.push({ holderEntityIds: { $in: entityIds } });
    or.push({ beneficialOwnerIds: { $in: entityIds } });
    or.push({ beneficialOwnerId: { $in: entityIds } });
  }
  if (userIds.length > 0) or.push({ userId: { $in: userIds } });
  if (rmIds.length > 0 && ACCESS_POLICY.rmPerimeterIncludesBackupAccounts) {
    or.push({ backupRmIds: { $in: rmIds } });
    or.push({ relationshipManagerId: { $in: rmIds } });
  }
  if (or.length === 0) return null;
  return { isActive: true, $or: or };
}

/**
 * Legacy user ids that may be added from a set of accounts: only those of
 * accounts the perimeter HOLDS. A wrapper account reached through
 * beneficialOwnerIds carries a legacy userId shared by other clients' wrappers;
 * adding it would leak their accounts.
 */
function heldAccountUserIds(accounts, entityIds, userIds) {
  const ids = [];
  for (const a of accounts) {
    if (!a.userId) continue;
    const held = a.holderEntityIds.some(id => entityIds.includes(id)) || userIds.includes(a.userId);
    if (held) ids.push(a.userId);
  }
  return uniq(ids);
}

/**
 * The owner ids a View As filter points at, or null when the target does not
 * exist or is archived. Does NOT check whether the caller may see it.
 */
async function resolveViewAsTarget(viewAs) {
  if (!viewAs) return null;
  if (viewAs.type === 'entity') {
    const entity = await ClientEntitiesCollection.findOneAsync(viewAs.id, { fields: { migratedFromUserId: 1, status: 1, isDemo: 1 } });
    if (!entity || ClientEntityHelpers.isEntityArchived(entity)) return null;
    return { entityIds: [entity._id], userIds: uniq([entity.migratedFromUserId]), scopedEntityId: entity._id, account: null };
  }
  if (viewAs.type === 'client') {
    const linked = await ClientEntityHelpers.getLinkedClientIds(viewAs.id);
    const entities = await ClientEntitiesCollection.find(
      { _id: { $in: linked } }, { fields: { status: 1 } }
    ).fetchAsync();
    if (entities.some(e => ClientEntityHelpers.isEntityArchived(e))) return null;
    const entityIds = entities.map(e => e._id);
    const { userIds: archivedUserIds } = await ClientEntityHelpers.getArchivedOwnerIds();
    const userIds = linked.filter(id => !entityIds.includes(id) && !archivedUserIds.includes(id));
    if (entityIds.length === 0 && userIds.length === 0) return null;
    return { entityIds, userIds, scopedEntityId: entityIds[0] || null, account: null };
  }
  if (viewAs.type === 'account') {
    const account = await BankAccountsCollection.findOneAsync(viewAs.id, ACCOUNT_FIELDS);
    if (!account) return null;
    const meta = accountMeta(account);
    let entityIds = [];
    if (meta.holderEntityIds.length > 0) {
      const holders = await ClientEntitiesCollection.find(
        { _id: { $in: meta.holderEntityIds } }, { fields: { status: 1 } }
      ).fetchAsync();
      if (holders.some(h => ClientEntityHelpers.isEntityArchived(h))) return null;
      entityIds = holders.map(h => h._id);
    }
    const { userIds: archivedUserIds } = await ClientEntityHelpers.getArchivedOwnerIds();
    const userIds = meta.userId && !archivedUserIds.includes(meta.userId) ? [meta.userId] : [];
    if (entityIds.length === 0 && userIds.length === 0 && !meta.bankId) return null;
    return { entityIds, userIds, scopedEntityId: meta.entityId, account: meta };
  }
  return null;
}

/** Every record of the same physical account (bankId + accountNumber). */
async function siblingAccounts(account) {
  if (!account.bankId || !account.accountNumber) return [account];
  const rows = await BankAccountsCollection.find(
    { bankId: account.bankId, accountNumber: account.accountNumber }, ACCOUNT_FIELDS
  ).fetchAsync();
  const metas = rows.map(accountMeta);
  return metas.some(m => m._id === account._id) ? metas : [account, ...metas];
}

/**
 * Resolve what `user` may see, optionally narrowed by a View As filter.
 *
 * @param {object} user       the customUsers document
 * @param {object|null} viewAs  raw or parsed View As filter
 * @param {object} [opts]
 * @param {boolean} [opts.excludeConsolidated=false]  drop the per-user
 *        'CONSOLIDATED' roll-up rows from holdings/snapshot selectors (they
 *        double-count in aggregates; the PMS consolidated tab needs them)
 */
export async function resolveScope(user, viewAs = null, { excludeConsolidated = false } = {}) {
  if (!user || !user._id) return deniedScope(user, null, 'no user');

  let filter;
  try {
    filter = parseViewAs(viewAs);
  } catch (e) {
    return deniedScope(user, null, 'malformed viewAs');
  }

  const role = user.role;

  // --- see-all roles -------------------------------------------------------
  if (SEE_ALL_ROLES.includes(role)) {
    if (!filter) {
      return emptyScope(user, null, { isAdmin: true, excludeConsolidated });
    }
    const target = await resolveViewAsTarget(filter);
    if (!target) return deniedScope(user, filter, `viewAs target not found/archived ${filter.type}:${filter.id}`);
    return finishScope(user, filter, target, { rmIds: [], excludeConsolidated });
  }

  // --- RM / assistant: own perimeter ----------------------------------------
  if (RM_LIKE_ROLES.includes(role)) {
    const rmIds = UserHelpers.getEffectiveRmIds(user);
    if (rmIds.length === 0) return deniedScope(user, filter, 'assistant without assigned RMs');

    const { userIds: archivedUserIds } = await ClientEntityHelpers.getArchivedOwnerIds();

    const entities = await ClientEntitiesCollection.find({
      $or: [{ assignedUserIds: { $in: rmIds } }, { relationshipManagerId: { $in: rmIds } }],
      ...LIVE_ENTITY
    }, { fields: { _id: 1, migratedFromUserId: 1 } }).fetchAsync();
    let entityIds = entities.map(e => e._id);

    if (ACCESS_POLICY.rmPerimeterIncludesBackupAccounts) {
      const backup = await BankAccountsCollection.find(
        { $or: [{ backupRmIds: { $in: rmIds } }, { relationshipManagerId: { $in: rmIds } }], isActive: true },
        { fields: { entityId: 1, holderEntityIds: 1 } }
      ).fetchAsync();
      const backupEntityIds = uniq(backup.flatMap(getAccountHolderIds)).filter(id => !entityIds.includes(id));
      if (backupEntityIds.length > 0) {
        const live = await ClientEntitiesCollection.find(
          { _id: { $in: backupEntityIds }, ...LIVE_ENTITY }, { fields: { _id: 1 } }
        ).fetchAsync();
        entityIds = uniq([...entityIds, ...live.map(e => e._id)]);
      }
    }

    const legacyClients = await UsersCollection.find(
      { relationshipManagerId: { $in: rmIds } }, { fields: { _id: 1 } }
    ).fetchAsync();
    const userIds = uniq([
      ...entities.map(e => e.migratedFromUserId),
      ...legacyClients.map(c => c._id)
    ]).filter(id => !archivedUserIds.includes(id));

    const perimeter = { entityIds, userIds, rmIds };

    if (!filter) {
      return finishScope(user, null, { ...perimeter, scopedEntityId: null, account: null }, { rmIds, excludeConsolidated });
    }

    const target = await resolveViewAsTarget(filter);
    if (!target) return deniedScope(user, filter, `viewAs target not found/archived ${filter.type}:${filter.id}`);
    if (!(await targetInPerimeter(target, perimeter))) {
      return deniedScope(user, filter, `viewAs ${filter.type}:${filter.id} outside RM perimeter`);
    }
    return finishScope(user, filter, target, { rmIds, excludeConsolidated });
  }

  // --- client: own entities and accounts -------------------------------------
  if (role === USER_ROLES.CLIENT) {
    const granted = await UserEntityAccessHelpers.getEntityIdsForUser(user._id);
    const migrated = await ClientEntitiesCollection.find(
      { migratedFromUserId: user._id, isActive: true }, { fields: { _id: 1 } }
    ).fetchAsync();
    // The login's own entity can also be reached through a SOLE account that
    // carries its userId (most clients have no access grant). A joint account's
    // other holders are not this client.
    const ownAccounts = await BankAccountsCollection.find(
      { userId: user._id, isActive: true }, ACCOUNT_FIELDS
    ).fetchAsync();
    const soleHolderEntityIds = ownAccounts
      .filter(a => getAccountHolderIds(a).length === 1)
      .map(a => a.entityId);
    const candidateEntityIds = uniq([...granted, ...migrated.map(e => e._id), ...soleHolderEntityIds]);
    let entityIds = [];
    if (candidateEntityIds.length > 0) {
      const live = await ClientEntitiesCollection.find(
        { _id: { $in: candidateEntityIds }, status: { $ne: ENTITY_STATUSES.ARCHIVED }, isDemo: { $ne: true } },
        { fields: { _id: 1 } }
      ).fetchAsync();
      entityIds = live.map(e => e._id);
    }
    const userIds = [user._id];
    const own = { entityIds, userIds, rmIds: [] };

    if (filter && filter.type === 'account') {
      const target = await resolveViewAsTarget(filter);
      if (target && target.account && (await accountInPerimeter(target.account, own))) {
        return finishScope(user, filter, target, { rmIds: [], excludeConsolidated });
      }
    }
    // Any other filter from a client (a stale one restored from localStorage,
    // for instance) is ignored rather than denied: the client keeps seeing its
    // own data, never anyone else's.
    if (filter) console.warn(`[accessScope] client ${user._id} sent viewAs ${filter.type}:${filter.id}; ignored`);
    return finishScope(user, null, { ...own, scopedEntityId: null, account: null }, { rmIds: [], excludeConsolidated });
  }

  // --- every other role: nothing ---------------------------------------------
  return deniedScope(user, filter, `role ${role} has no client-data access`);
}

async function accountInPerimeter(account, perimeter) {
  const sel = perimeterAccountSelector(perimeter);
  if (!sel) return false;
  const hit = await BankAccountsCollection.findOneAsync({ _id: account._id, $and: [sel] }, { fields: { _id: 1 } });
  return !!hit;
}

async function targetInPerimeter(target, perimeter) {
  if (target.account) return accountInPerimeter(target.account, perimeter);
  if (target.entityIds.some(id => perimeter.entityIds.includes(id))) return true;
  if (target.userIds.some(id => perimeter.userIds.includes(id))) return true;
  return false;
}

/** Fill in bank accounts and owner ids for a resolved perimeter or target. */
async function finishScope(user, viewAs, target, { rmIds, excludeConsolidated }) {
  const entityIds = uniq(target.entityIds);
  let userIds = uniq(target.userIds);
  let accounts;

  if (target.account) {
    accounts = await siblingAccounts(target.account);
  } else {
    const sel = perimeterAccountSelector({ entityIds, userIds, rmIds: viewAs ? [] : rmIds });
    accounts = sel
      ? (await BankAccountsCollection.find(sel, ACCOUNT_FIELDS).fetchAsync()).map(accountMeta)
      : [];
  }

  const { userIds: archivedUserIds } = await ClientEntityHelpers.getArchivedOwnerIds();
  userIds = uniq([...userIds, ...heldAccountUserIds(accounts, entityIds, userIds)])
    .filter(id => !archivedUserIds.includes(id));

  return {
    user, role: user.role, isAdmin: false, denied: false, viewAs,
    scopedEntityId: target.scopedEntityId || null,
    entityIds, userIds,
    ownerIds: uniq([...entityIds, ...userIds]),
    bankAccounts: accounts,
    bankAccountIds: uniq(accounts.map(a => a._id)),
    rmIds: rmIds || [],
    excludeConsolidated
  };
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * Three-way owner match on a collection keyed by entityId / userId /
 * (bankId, portfolioCode). Returns a clause or IMPOSSIBLE.
 */
async function ownerClause(scope, Collection) {
  const or = [];
  if (scope.entityIds.length > 0) or.push({ entityId: { $in: scope.entityIds } });
  if (scope.userIds.length > 0) or.push({ entityId: { $exists: false }, userId: { $in: scope.userIds } });

  const byBank = new Map();
  for (const a of scope.bankAccounts) {
    if (!a.bankId || !a.accountNumberBase) continue;
    if (!byBank.has(a.bankId)) byBank.set(a.bankId, new Set());
    byBank.get(a.bankId).add(a.accountNumberBase);
  }
  for (const [bankId, bases] of byBank.entries()) {
    const regex = portfolioCodeRegexForBases([...bases]);
    if (!regex) continue;
    let codes;
    try {
      codes = await Collection.rawCollection().distinct('portfolioCode', { bankId, portfolioCode: { $regex: regex } });
    } catch (err) {
      console.error('[accessScope] distinct() failed, using anchored regex:', err?.message);
      or.push({ bankId, portfolioCode: { $regex: regex } });
      continue;
    }
    if (codes && codes.length > 0) or.push({ bankId, portfolioCode: { $in: codes } });
  }

  if (or.length === 0) return IMPOSSIBLE;
  return or.length === 1 ? or[0] : { $or: or };
}

async function positionsSelector(scope, Collection, { hideArchived, excludeConsolidated }) {
  if (scope.denied) return { $and: [IMPOSSIBLE] };
  const clauses = [];
  if (!scope.isAdmin) clauses.push(await ownerClause(scope, Collection));
  if (hideArchived) {
    const hidden = await ClientEntityHelpers.hiddenHoldingsSelector({ exceptEntityId: scope.scopedEntityId });
    if (hidden.$nor) clauses.push(hidden);
  }
  if (excludeConsolidated ?? scope.excludeConsolidated) clauses.push(EXCLUDE_CONSOLIDATED);
  return wrap(clauses);
}

/** PMSHoldings selector. */
export async function holdingsSelector(scope, opts = {}) {
  return positionsSelector(scope, PMSHoldingsCollection, { hideArchived: true, excludeConsolidated: opts.excludeConsolidated });
}

/** PMSOperations selector. */
export async function operationsSelector(scope, opts = {}) {
  return positionsSelector(scope, PMSOperationsCollection, { hideArchived: true, excludeConsolidated: opts.excludeConsolidated });
}

/**
 * PortfolioSnapshots selector. Archived clients stay in history (it must
 * reflect what was true at the time); demo clients are hidden unless the view
 * is drilled into the demo.
 */
export async function snapshotsSelector(scope, opts = {}) {
  if (scope.denied) return { $and: [IMPOSSIBLE] };
  const clauses = [];
  if (!scope.isAdmin) clauses.push(await ownerClause(scope, PortfolioSnapshotsCollection));
  const demo = await ClientEntityHelpers.getDemoExclusion();
  const viewingDemo = scope.scopedEntityId && demo.entityIds.includes(scope.scopedEntityId);
  if (!viewingDemo) {
    const nor = [];
    if (demo.entityIds.length > 0) nor.push({ entityId: { $in: demo.entityIds } });
    if (demo.userIds.length > 0) nor.push({ userId: { $in: demo.userIds } });
    if (nor.length > 0) clauses.push({ $nor: nor });
  }
  if (opts.excludeConsolidated ?? scope.excludeConsolidated) clauses.push(EXCLUDE_CONSOLIDATED);
  return wrap(clauses);
}

/** EquityHoldings selector (keyed by bankAccountId). */
export async function equityHoldingsSelector(scope) {
  if (scope.denied) return { $and: [IMPOSSIBLE] };
  const clauses = [];
  if (!scope.isAdmin) {
    clauses.push(scope.bankAccountIds.length > 0 ? { bankAccountId: { $in: scope.bankAccountIds } } : IMPOSSIBLE);
  }
  // Same hiding rule as positions: archived accounts always, demo accounts
  // unless the view is drilled into the demo client.
  const { bankAccountIds: archived } = await ClientEntityHelpers.getArchivedExclusion();
  const demo = await ClientEntityHelpers.getDemoExclusion();
  const viewingDemo = scope.scopedEntityId && demo.entityIds.includes(scope.scopedEntityId);
  const hiddenAccountIds = [...archived, ...(viewingDemo ? [] : demo.bankAccountIds)];
  if (hiddenAccountIds.length > 0) clauses.push({ bankAccountId: { $nin: hiddenAccountIds } });
  return wrap(clauses);
}

/** Allocations selector (keyed by clientId = entity or legacy user id, and bankAccountId). */
export async function allocationsSelector(scope) {
  if (scope.denied) return { $and: [IMPOSSIBLE] };
  const clauses = [];
  if (!scope.isAdmin) {
    const or = [];
    if (scope.ownerIds.length > 0) or.push({ clientId: { $in: scope.ownerIds } });
    if (scope.bankAccountIds.length > 0) or.push({ bankAccountId: { $in: scope.bankAccountIds } });
    clauses.push(or.length === 0 ? IMPOSSIBLE : (or.length === 1 ? or[0] : { $or: or }));
  }
  const hidden = await ClientEntityHelpers.hiddenAllocationsSelector({ exceptEntityId: scope.scopedEntityId });
  if (hidden.$nor) clauses.push(hidden);
  return wrap(clauses);
}

/** Orders selector for a scoped (non-order-book) viewer. */
export function ordersSelector(scope) {
  if (scope.denied) return { $and: [IMPOSSIBLE] };
  if (scope.isAdmin) return {};
  const or = [];
  if (scope.ownerIds.length > 0) or.push({ clientId: { $in: scope.ownerIds } });
  if (scope.bankAccountIds.length > 0) or.push({ bankAccountId: { $in: scope.bankAccountIds } });
  return { $and: [or.length === 0 ? IMPOSSIBLE : (or.length === 1 ? or[0] : { $or: or })] };
}

/** BankAccounts selector. */
export function bankAccountsSelector(scope) {
  if (scope.denied) return { $and: [IMPOSSIBLE] };
  if (scope.isAdmin) return {};
  return { $and: [scope.bankAccountIds.length > 0 ? { _id: { $in: scope.bankAccountIds } } : IMPOSSIBLE] };
}

/** ClientEntities selector. */
export function entitiesSelector(scope) {
  if (scope.denied) return { $and: [IMPOSSIBLE] };
  if (scope.isAdmin) return {};
  return { $and: [scope.entityIds.length > 0 ? { _id: { $in: scope.entityIds } } : IMPOSSIBLE] };
}

/**
 * customUsers selector for the CLIENT logins in scope: the perimeter's legacy
 * users plus every login holding an access grant on one of its entities.
 */
export async function usersSelector(scope) {
  if (scope.denied) return { $and: [IMPOSSIBLE] };
  if (scope.isAdmin) return {};
  const ids = [...scope.userIds];
  if (scope.entityIds.length > 0) {
    const grants = await UserEntityAccessCollection.find(
      { entityId: { $in: scope.entityIds }, isActive: true }, { fields: { userId: 1 } }
    ).fetchAsync();
    ids.push(...grants.map(g => g.userId));
  }
  const all = uniq(ids);
  return { $and: [all.length > 0 ? { _id: { $in: all } } : IMPOSSIBLE] };
}

// ---------------------------------------------------------------------------
// Products in scope
// ---------------------------------------------------------------------------

/**
 * Products the scope currently HOLDS (latest active bank position with
 * quantity > 0), matched by ISIN and by linkedProductId.
 */
export async function heldProductIds(scope) {
  if (scope.denied) return new Set();
  const sel = { $and: [await holdingsSelector(scope), { isActive: true, isLatest: true, quantity: { $gt: 0 } }] };
  const raw = PMSHoldingsCollection.rawCollection();
  const [isins, linked] = await Promise.all([
    raw.distinct('isin', { $and: [...sel.$and, { isin: { $nin: [null, ''] } }] }),
    raw.distinct('linkedProductId', { $and: [...sel.$and, { linkedProductId: { $nin: [null, ''] } }] })
  ]);
  const ids = new Set(linked.filter(Boolean).map(String));
  if (isins.length > 0) {
    const products = await ProductsCollection.find({ isin: { $in: isins } }, { fields: { _id: 1 } }).fetchAsync();
    for (const p of products) ids.add(String(p._id));
  }
  return ids;
}

/** Products the scope has an allocation on. */
export async function allocatedProductIds(scope) {
  if (scope.denied) return new Set();
  const ids = await AllocationsCollection.rawCollection().distinct('productId', await allocationsSelector(scope));
  return new Set(ids.filter(Boolean).map(String));
}

/** Union of held and allocated products; null means "every product" (admin). */
export async function productIdsInScope(scope) {
  if (scope.isAdmin) return null;
  if (scope.denied) return new Set();
  const [held, allocated] = await Promise.all([heldProductIds(scope), allocatedProductIds(scope)]);
  return new Set([...held, ...allocated]);
}

// ---------------------------------------------------------------------------
// Membership tests and assertions
// ---------------------------------------------------------------------------

const notAuthorized = (msg) => new Meteor.Error('not-authorized', msg);

export async function isEntityInScope(scope, entityId) {
  if (scope.denied || typeof entityId !== 'string' || !entityId) return false;
  if (scope.isAdmin) return true;
  return scope.entityIds.includes(entityId);
}

export async function assertEntityInScope(scope, entityId) {
  if (!(await isEntityInScope(scope, entityId))) throw notAuthorized('Entity is outside your access scope');
}

/** `clientId` may be an entity id or a legacy user id. */
export async function isClientInScope(scope, clientId) {
  if (scope.denied || typeof clientId !== 'string' || !clientId) return false;
  if (scope.isAdmin) return true;
  if (scope.ownerIds.includes(clientId)) return true;
  const linked = await ClientEntityHelpers.getLinkedClientIds(clientId);
  return linked.some(id => scope.ownerIds.includes(id));
}

export async function assertClientInScope(scope, clientId) {
  if (!(await isClientInScope(scope, clientId))) throw notAuthorized('Client is outside your access scope');
}

/** Returns the account document when it is in scope, null otherwise. */
export async function accountInScope(scope, bankAccountId) {
  if (scope.denied || typeof bankAccountId !== 'string' || !bankAccountId) return null;
  if (!scope.isAdmin && !scope.bankAccountIds.includes(bankAccountId)) return null;
  return BankAccountsCollection.findOneAsync(bankAccountId);
}

export async function assertAccountInScope(scope, bankAccountId) {
  const account = await accountInScope(scope, bankAccountId);
  if (!account) throw notAuthorized('Account is outside your access scope');
  return account;
}

/** True when (bankId, portfolioCode) belongs to an account in scope. `bankId` may be null. */
export function isPortfolioCodeInScope(scope, bankId, portfolioCode) {
  if (scope.denied || !portfolioCode) return false;
  if (scope.isAdmin) return true;
  return scope.bankAccounts.some(a =>
    (!bankId || a.bankId === bankId) && portfolioCodeMatches(a.accountNumberBase, portfolioCode)
  );
}

export function assertPortfolioCodeInScope(scope, bankId, portfolioCode) {
  if (!isPortfolioCodeInScope(scope, bankId, portfolioCode)) {
    throw notAuthorized('Portfolio is outside your access scope');
  }
}

/** Product master data is open to catalogue roles; clients only see held products. */
export async function isProductInScope(scope, productId) {
  if (scope.denied || typeof productId !== 'string' || !productId) return false;
  if (scope.isAdmin || PRODUCT_CATALOGUE_ROLES.includes(scope.role)) return true;
  if (!ACCESS_POLICY.clientProductFeedsHeldOnly) return true;
  const ids = await productIdsInScope(scope);
  return ids === null || ids.has(String(productId));
}

export async function assertProductInScope(scope, productId) {
  if (!(await isProductInScope(scope, productId))) throw notAuthorized('Product is outside your access scope');
}

/**
 * Account ↔ client consistency: does this bank account belong to `clientId`
 * (entity or legacy user id), as holder or beneficial owner?
 */
export async function accountBelongsToClient(account, clientId) {
  if (!account || typeof clientId !== 'string' || !clientId) return false;
  const linked = await ClientEntityHelpers.getLinkedClientIds(clientId);
  const ids = uniq([clientId, ...linked]);
  if (ids.some(id => isAccountHolder(account, id))) return true;
  const beneficial = uniq([...(account.beneficialOwnerIds || []), account.beneficialOwnerId]);
  return ids.some(id => beneficial.includes(id));
}

/** Convenience: the scope's accounts as a holder selector (joint-aware). */
export function scopeAccountHolderSelector(scope) {
  return accountHolderSelector(scope.ownerIds);
}
