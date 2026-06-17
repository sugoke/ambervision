/**
 * Migration: de-duplicate migration-leftover bank accounts (MERGE model).
 *
 * The userId->entity migration left ~20 account numbers with multiple active bankAccounts:
 * a legacy `userId`-based record and a current `entityId`-based record (a few groups also
 * carry a superseded `isActive:false` entity record). Post-migration edits (e.g. the
 * credit-line `authorizedOverdraft`) land on the entity record, so userId-anchored read
 * paths (cash monitor, account lists) read stale data from the legacy record.
 *
 * MERGE model (chosen over delete-and-refactor): collapse each group into ONE canonical
 * record that keeps the entity owner AND carries the legacy `userId`. Because the surviving
 * record has both `entityId` and `userId`, every existing read path — userId-based and
 * entity-based — still finds it, so NO app-wide read-path refactor is required. The
 * "entity maps to two userIds" problem (DONBERG 304435.001/.002) also disappears, since
 * `userId` lives on the per-account record, not the entity.
 *
 * Canonical record per group:
 *   - exactly one entity record  -> that record
 *   - several entity records      -> the one whose ClientEntity is isActive:true
 *                                    (the others are superseded duplicates to drop)
 *   - ambiguous (0 or >1 active)  -> conflict, skipped for manual handling
 *
 * Phases (superadmin Meteor methods):
 *   1. migration.dedupeBankAccountsDryRun       -> report only, NO writes. Run first.
 *   2. migration.dedupeBankAccountsMerge         -> reversible: stamp legacy userId onto the
 *        canonical record, carry forward missing fields, re-point allocations from every
 *        non-canonical record to the canonical one. Does NOT delete.
 *   3. migration.dedupeBankAccountsDeleteLegacy(sessionId, true) -> destructive: back up then
 *        delete the non-canonical bankAccounts, gated on zero remaining references.
 *
 * Idempotent. Verify in the running app between phases 2 and 3. Superseded *entity* records
 * (isActive:false, now account-less) are left for a separate cleanup.
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { AllocationsCollection } from '/imports/api/allocations';
import { EquityHoldingsCollection } from '/imports/api/equityHoldings';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';

const CARRY_FORWARD_FIELDS = ['authorizedOverdraft', 'comment', 'accountType', 'accountStructure'];
const BACKUP_COLLECTION = 'bankAccounts_dedupeBackup';

async function buildDedupeMapping() {
  const groups = await BankAccountsCollection.rawCollection().aggregate([
    { $match: { isActive: true } },
    { $group: { _id: { bankId: '$bankId', accountNumber: '$accountNumber' }, ids: { $push: '$$ROOT' } } },
    { $match: { 'ids.1': { $exists: true } } }
  ]).toArray();

  // Pre-load entity isActive for canonical selection among multiple entity records.
  const entityIds = [...new Set(groups.flatMap(g => g.ids.map(r => r.entityId).filter(Boolean)))];
  const entities = await ClientEntitiesCollection.find(
    { _id: { $in: entityIds } }, { fields: { isActive: 1 } }
  ).fetchAsync();
  const entityActive = new Map(entities.map(e => [e._id, e.isActive !== false]));

  const clean = [];
  const conflicts = [];

  for (const g of groups) {
    const records = g.ids;
    const entityRecords = records.filter(r => r.entityId);
    const legacyRecords = records.filter(r => r.userId && !r.entityId);

    let canonical = null;
    if (entityRecords.length === 1) {
      canonical = entityRecords[0];
    } else if (entityRecords.length > 1) {
      const activeOnes = entityRecords.filter(r => entityActive.get(r.entityId));
      if (activeOnes.length === 1) canonical = activeOnes[0];
    }

    if (canonical && legacyRecords.length >= 1) {
      const legacy = legacyRecords[0]; // groups observed have exactly one legacy record
      const drop = records.filter(r => r._id !== canonical._id);
      clean.push({
        bankId: g._id.bankId,
        accountNumber: g._id.accountNumber,
        canonical,
        legacy,
        dropIds: drop.map(r => r._id)
      });
    } else {
      conflicts.push({
        bankId: g._id.bankId,
        accountNumber: g._id.accountNumber,
        reason: !canonical ? 'cannot determine single canonical entity record' : 'no legacy record',
        recordIds: records.map(r => ({ _id: r._id, userId: r.userId, entityId: r.entityId }))
      });
    }
  }
  return { clean, conflicts };
}

async function countRefs(accountIds) {
  const allocations = await AllocationsCollection.find({ bankAccountId: { $in: accountIds } }).countAsync();
  const equityHoldings = await EquityHoldingsCollection.find({ bankAccountId: { $in: accountIds } }).countAsync();
  return { allocations, equityHoldings };
}

async function dryRun() {
  const { clean, conflicts } = await buildDedupeMapping();
  const report = [];
  for (const c of clean) {
    const refs = await countRefs(c.dropIds);
    report.push({
      accountNumber: c.accountNumber,
      canonicalId: c.canonical._id,
      canonicalEntityId: c.canonical.entityId,
      canonicalHasUserId: !!c.canonical.userId,
      legacyUserId: c.legacy.userId,
      dropIds: c.dropIds,
      refsToRepoint: refs,
      carryForward: CARRY_FORWARD_FIELDS.filter(f => (c.canonical[f] == null) && c.legacy[f] != null)
    });
  }
  console.log(`[DEDUPE_BA] Dry-run: ${clean.length} mergeable groups, ${conflicts.length} conflicts.`);
  return { mergeable: clean.length, conflictCount: conflicts.length, groups: report, conflicts };
}

async function merge() {
  const { clean, conflicts } = await buildDedupeMapping();
  const actions = [];
  for (const c of clean) {
    const set = { updatedAt: new Date() };
    // Stamp the legacy userId onto the canonical record so userId-based reads still resolve.
    if (!c.canonical.userId) set.userId = c.legacy.userId;
    // Carry forward fields the canonical record is missing (e.g. a credit line set on legacy).
    for (const f of CARRY_FORWARD_FIELDS) {
      if (c.canonical[f] == null && c.legacy[f] != null) set[f] = c.legacy[f];
    }
    await BankAccountsCollection.updateAsync(c.canonical._id, { $set: set });

    // Re-point allocation FKs from every dropped record to the canonical record.
    let repointed = 0;
    for (const dropId of c.dropIds) {
      const res = await AllocationsCollection.updateAsync(
        { bankAccountId: dropId }, { $set: { bankAccountId: c.canonical._id } }, { multi: true }
      );
      repointed += typeof res === 'number' ? res : (res?.numberAffected || 0);
    }
    actions.push({ accountNumber: c.accountNumber, canonicalId: c.canonical._id, set: Object.keys(set), allocationsRepointed: repointed });
  }
  console.log(`[DEDUPE_BA] Merge complete for ${clean.length} groups; ${conflicts.length} conflicts skipped.`);
  return { processed: clean.length, conflictsSkipped: conflicts.length, actions, conflicts };
}

async function deleteLegacy() {
  const { clean, conflicts } = await buildDedupeMapping();
  const deleted = [];
  const blocked = [];
  for (const c of clean) {
    const refs = await countRefs(c.dropIds);
    if (refs.allocations > 0 || refs.equityHoldings > 0) {
      blocked.push({ accountNumber: c.accountNumber, dropIds: c.dropIds, refs }); // run merge() first
      continue;
    }
    // Back up the records about to be deleted (reversibility).
    const docs = await BankAccountsCollection.find({ _id: { $in: c.dropIds } }).fetchAsync();
    if (docs.length) {
      await BankAccountsCollection.rawDatabase().collection(BACKUP_COLLECTION)
        .insertMany(docs.map(d => ({ ...d, _backedUpAt: new Date(), _account: c.accountNumber })));
    }
    await BankAccountsCollection.removeAsync({ _id: { $in: c.dropIds } });
    deleted.push({ accountNumber: c.accountNumber, dropIds: c.dropIds });
  }
  console.log(`[DEDUPE_BA] Deleted dups for ${deleted.length} groups; ${blocked.length} blocked; ${conflicts.length} conflicts skipped.`);
  return { deleted, blocked, conflictsSkipped: conflicts.length, backupCollection: BACKUP_COLLECTION };
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
  async 'migration.dedupeBankAccountsMerge'(sessionId) {
    check(sessionId, String);
    await requireSuperadmin(sessionId);
    return await merge();
  },
  async 'migration.dedupeBankAccountsDeleteLegacy'(sessionId, confirm) {
    check(sessionId, String);
    check(confirm, Match.OneOf(Boolean, undefined));
    await requireSuperadmin(sessionId);
    if (confirm !== true) throw new Meteor.Error('confirmation-required', 'Pass confirm=true to run the destructive delete phase');
    return await deleteLegacy();
  }
});

export { buildDedupeMapping, dryRun, merge, deleteLegacy };
