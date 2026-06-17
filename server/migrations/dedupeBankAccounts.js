/**
 * Migration: de-duplicate migration-leftover bank accounts.
 *
 * The userId->entity migration left ~20 account numbers with TWO active bankAccounts:
 * a legacy `userId`-based record and a current `entityId`-based record (a few have 3).
 * Post-migration edits (e.g. credit-line `authorizedOverdraft`) land on the entity
 * record, so userId-anchored read paths (cash monitor, account lists) read stale data.
 *
 * Goal: keep ONE canonical entity record per account and retire the legacy duplicates.
 *
 * SAFETY — run in three guarded phases, each a superadmin Meteor method:
 *   1. migration.dedupeBankAccountsDryRun   -> report only, NO writes. Run this first.
 *   2. migration.dedupeBankAccountsConsolidate -> reversible prep: bridge identity
 *        (set entity.migratedFromUserId), carry forward fields the entity record lacks,
 *        and re-point allocations.bankAccountId from the legacy record to the entity one.
 *        Does NOT delete anything.
 *   3. migration.dedupeBankAccountsDeleteLegacy -> DESTRUCTIVE. Deletes the legacy
 *        records, but ONLY after asserting zero remaining references. DO NOT run until
 *        the userId-anchored read paths are entity-aware (see PREREQUISITE below) and
 *        phases 1-2 have been verified, ideally on a staging copy with a fresh mongodump.
 *
 * PREREQUISITE for phase 3 (code, not data): make every bankAccount-by-userId read path
 * entity-aware, otherwise deleting the legacy records makes accounts vanish from those
 * views. Known paths (grep `BankAccountsCollection.find({ ... userId`):
 *   imports/api/bankAccounts.js, imports/ui/BankAccountManagement.jsx,
 *   server/publications/accountProfiles.js, server/publications/equityHoldings.js,
 *   server/methods/rmDashboardMethods.js (getCashMonitoring already done),
 *   imports/api/portfolioReviewGenerator.js, server/main.js (~5176).
 *
 * MANUAL cases the auto-path SKIPS (flagged as conflicts in the dry-run):
 *   - An account whose group has >1 entity record (e.g. 640131, 8202150).
 *   - An entity that maps to DIFFERENT legacy userIds across accounts (e.g. DONBERG on
 *     304435.001 vs 304435.002) — a single migratedFromUserId cannot represent both.
 *
 * Idempotent: re-running skips already-bridged entities and already-re-pointed allocations.
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { AllocationsCollection } from '/imports/api/allocations';
import { EquityHoldingsCollection } from '/imports/api/equityHoldings';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';

// Fields worth carrying forward from the legacy record onto the entity record when the
// entity record is missing them (e.g. a credit line set only on the legacy account).
const CARRY_FORWARD_FIELDS = ['authorizedOverdraft', 'comment', 'accountType', 'accountStructure'];

/**
 * Build the de-dup mapping from current active bankAccounts.
 * Returns { clean: [...], conflicts: [...] } where each clean item is
 * { bankId, accountNumber, entity: <acct>, legacy: <acct> }.
 */
async function buildDedupeMapping() {
  const groups = await BankAccountsCollection.rawCollection().aggregate([
    { $match: { isActive: true } },
    { $group: { _id: { bankId: '$bankId', accountNumber: '$accountNumber' }, ids: { $push: '$$ROOT' } } },
    { $match: { 'ids.1': { $exists: true } } } // n > 1
  ]).toArray();

  const clean = [];
  const conflicts = [];

  for (const g of groups) {
    const records = g.ids;
    const entityRecords = records.filter(r => r.entityId);
    const legacyRecords = records.filter(r => r.userId && !r.entityId);

    if (entityRecords.length === 1 && legacyRecords.length === 1) {
      clean.push({
        bankId: g._id.bankId,
        accountNumber: g._id.accountNumber,
        entity: entityRecords[0],
        legacy: legacyRecords[0]
      });
    } else {
      conflicts.push({
        bankId: g._id.bankId,
        accountNumber: g._id.accountNumber,
        reason: entityRecords.length !== 1
          ? `${entityRecords.length} entity record(s)`
          : `${legacyRecords.length} legacy record(s)`,
        recordIds: records.map(r => ({ _id: r._id, userId: r.userId, entityId: r.entityId }))
      });
    }
  }

  // Cross-account conflict: an entity that would need >1 distinct migratedFromUserId.
  const entityToUserIds = new Map();
  for (const c of clean) {
    if (!entityToUserIds.has(c.entity.entityId)) entityToUserIds.set(c.entity.entityId, new Set());
    entityToUserIds.get(c.entity.entityId).add(c.legacy.userId);
  }
  const conflictingEntities = new Set(
    [...entityToUserIds.entries()].filter(([, set]) => set.size > 1).map(([eid]) => eid)
  );

  const cleanFinal = [];
  for (const c of clean) {
    if (conflictingEntities.has(c.entity.entityId)) {
      conflicts.push({
        bankId: c.bankId,
        accountNumber: c.accountNumber,
        reason: `entity ${c.entity.entityId} maps to multiple legacy userIds (migratedFromUserId conflict)`,
        recordIds: [{ _id: c.entity._id, entityId: c.entity.entityId }, { _id: c.legacy._id, userId: c.legacy.userId }]
      });
    } else {
      cleanFinal.push(c);
    }
  }

  return { clean: cleanFinal, conflicts };
}

async function countLegacyReferences(legacyAccountId) {
  const allocs = await AllocationsCollection.find({ bankAccountId: legacyAccountId }).countAsync();
  const equities = await EquityHoldingsCollection.find({ bankAccountId: legacyAccountId }).countAsync();
  return { allocations: allocs, equityHoldings: equities };
}

/** Phase 1 — report only, no writes. */
async function dryRun() {
  const { clean, conflicts } = await buildDedupeMapping();
  const report = [];
  for (const c of clean) {
    const refs = await countLegacyReferences(c.legacy._id);
    report.push({
      accountNumber: c.accountNumber,
      bankId: c.bankId,
      entityAccountId: c.entity._id,
      entityId: c.entity.entityId,
      legacyAccountId: c.legacy._id,
      legacyUserId: c.legacy.userId,
      entityMigratedFromUserId: c.entity.migratedFromUserId || null,
      legacyAllocationRefs: refs.allocations,
      legacyEquityRefs: refs.equityHoldings,
      carryForward: CARRY_FORWARD_FIELDS.filter(f => (c.entity[f] === undefined || c.entity[f] === null) && c.legacy[f] != null)
    });
  }
  console.log(`[DEDUPE_BA] Dry-run: ${clean.length} clean groups, ${conflicts.length} conflicts (manual).`);
  return { cleanCount: clean.length, conflictCount: conflicts.length, clean: report, conflicts };
}

/** Phase 2 — reversible prep. Bridge identity, carry forward fields, re-point allocations. */
async function consolidate() {
  const { clean, conflicts } = await buildDedupeMapping();
  const actions = [];

  for (const c of clean) {
    const a = { accountNumber: c.accountNumber, bridged: false, carried: [], allocationsRepointed: 0 };

    // 1. Bridge identity: set migratedFromUserId if unset (idempotent).
    if (!c.entity.migratedFromUserId) {
      await ClientEntitiesCollection.updateAsync(c.entity.entityId, {
        $set: { migratedFromUserId: c.legacy.userId, updatedAt: new Date() }
      });
      a.bridged = true;
    }

    // 2. Carry forward fields the entity record is missing.
    const carry = {};
    for (const f of CARRY_FORWARD_FIELDS) {
      if ((c.entity[f] === undefined || c.entity[f] === null) && c.legacy[f] != null) {
        carry[f] = c.legacy[f];
        a.carried.push(f);
      }
    }
    if (Object.keys(carry).length > 0) {
      await BankAccountsCollection.updateAsync(c.entity._id, { $set: { ...carry, updatedAt: new Date() } });
    }

    // 3. Re-point allocation FK from the legacy account to the entity account.
    const res = await AllocationsCollection.updateAsync(
      { bankAccountId: c.legacy._id },
      { $set: { bankAccountId: c.entity._id } },
      { multi: true }
    );
    a.allocationsRepointed = typeof res === 'number' ? res : (res?.numberAffected || 0);

    actions.push(a);
  }

  console.log(`[DEDUPE_BA] Consolidate complete for ${clean.length} groups. Conflicts skipped: ${conflicts.length}.`);
  return { processed: clean.length, conflictsSkipped: conflicts.length, actions, conflicts };
}

/** Phase 3 — DESTRUCTIVE. Delete legacy records, gated on zero remaining references. */
async function deleteLegacy() {
  const { clean, conflicts } = await buildDedupeMapping();
  const deleted = [];
  const blocked = [];

  for (const c of clean) {
    const refs = await countLegacyReferences(c.legacy._id);
    if (refs.allocations > 0 || refs.equityHoldings > 0) {
      blocked.push({ accountNumber: c.accountNumber, legacyAccountId: c.legacy._id, refs });
      continue; // never delete a still-referenced record — run consolidate() first
    }
    await BankAccountsCollection.removeAsync(c.legacy._id);
    deleted.push({ accountNumber: c.accountNumber, legacyAccountId: c.legacy._id });
  }

  console.log(`[DEDUPE_BA] Deleted ${deleted.length} legacy records, ${blocked.length} blocked by refs, ${conflicts.length} conflicts skipped.`);
  return { deleted, blocked, conflictsSkipped: conflicts.length };
}

async function requireSuperadmin(sessionId) {
  const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
  if (!session) throw new Meteor.Error('not-authorized', 'Invalid session');
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user || user.role !== USER_ROLES.SUPERADMIN) {
    throw new Meteor.Error('not-authorized', 'Only superadmin can run this migration');
  }
}

Meteor.methods({
  async 'migration.dedupeBankAccountsDryRun'(sessionId) {
    check(sessionId, String);
    await requireSuperadmin(sessionId);
    return await dryRun();
  },
  async 'migration.dedupeBankAccountsConsolidate'(sessionId) {
    check(sessionId, String);
    await requireSuperadmin(sessionId);
    return await consolidate();
  },
  async 'migration.dedupeBankAccountsDeleteLegacy'(sessionId, confirm) {
    check(sessionId, String);
    check(confirm, Match.OneOf(Boolean, undefined));
    await requireSuperadmin(sessionId);
    if (confirm !== true) {
      throw new Meteor.Error('confirmation-required', 'Pass confirm=true to run the destructive delete phase');
    }
    return await deleteLegacy();
  }
});

export { buildDedupeMapping, dryRun, consolidate, deleteLegacy };
