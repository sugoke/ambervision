/**
 * Joint accounts: retire the combined "A & B" pseudo-entities (Sept 2026).
 *
 * A joint account used to be represented in one of two lossy ways:
 *   1. one bankAccounts row PER co-holder, sharing (bankId, accountNumber) — so
 *      the account was counted twice and the bank's holdings, stamped with only
 *      one holder's id, were invisible to the other; or
 *   2. a single combined client entity, e.g. "David  & Bethany WARKENTIN", which
 *      put a person who does not exist into the client list, with their own KYC,
 *      risk assessment and documents.
 *
 * A joint account is now ONE row whose `holderEntityIds` lists every holder
 * (see imports/api/bankAccounts.js). This migration converts the legacy shapes:
 *
 *   - A combined entity whose first name reads "X & Y" is split: the real people
 *     are matched to existing entities by (firstName, lastName) where possible,
 *     and created as bare physical persons where not. Only the NAME is carried
 *     over — KYC, dates of birth and nationalities are not inventable and stay
 *     for a human to fill in.
 *   - Duplicate rows for the same (bankId, accountNumber) are merged into the
 *     row that the bank's holdings actually point at, so no holdings are orphaned.
 *   - The combined entity is archived (isActive:false, status 'archived'). It is
 *     never deleted: orders, documents and snapshots may still reference its id.
 *
 * Idempotent: once an account carries holderEntityIds and the combined entity is
 * archived, a second run does nothing.
 */

import { ClientEntitiesCollection, ENTITY_TYPES } from '/imports/api/clientEntities';
import { BankAccountsCollection, buildJointAccountName } from '/imports/api/bankAccounts';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';

// "David  & Bethany" / "Eric et Christine" / "Ann and Bob" — the separators a
// combined entity name uses.
//
// Deliberately narrow. "and"/"et" must be a whitespace-delimited word, so a real
// first name like "Jean-Et" or "Etienne" is never split; only "&" and "+" may sit
// flush against the names. Company names ("Smith & Sons") are out of scope
// because only physical persons are considered.
const COMBINED_NAME = /(?:\s+(?:and|et)\s+|\s*[&+]\s*)/i;

function splitCombinedFirstName(firstName) {
  const parts = String(firstName || '')
    .split(COMBINED_NAME)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : null;
}

export async function splitJointAccountEntities() {
  try {
    const combined = await ClientEntitiesCollection.find({
      type: ENTITY_TYPES.PHYSICAL_PERSON,
      isActive: true,
      'profile.firstName': { $regex: COMBINED_NAME.source, $options: 'i' }
    }).fetchAsync();

    if (combined.length === 0) return;

    let split = 0;
    let created = 0;
    let merged = 0;

    for (const entity of combined) {
      const firstNames = splitCombinedFirstName(entity.profile?.firstName);
      if (!firstNames) continue;
      const lastName = (entity.profile?.lastName || '').trim();
      if (!lastName) continue;

      // Resolve each real person: reuse an existing entity with that exact name,
      // otherwise create a bare one. Matching is case-insensitive and anchored so
      // "Beth" never matches "Bethany".
      const holderIds = [];
      for (const firstName of firstNames) {
        const escaped = firstName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const existing = await ClientEntitiesCollection.findOneAsync({
          _id: { $ne: entity._id },
          type: ENTITY_TYPES.PHYSICAL_PERSON,
          'profile.firstName': { $regex: `^${escaped}$`, $options: 'i' },
          'profile.lastName': { $regex: `^${lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' }
        });

        if (existing) {
          holderIds.push(existing._id);
          continue;
        }

        const newId = await ClientEntitiesCollection.insertAsync({
          type: ENTITY_TYPES.PHYSICAL_PERSON,
          profile: { firstName, lastName, updatedAt: new Date() },
          // Everything else is inherited from the combined record only where it
          // is not personal: the RM relationship is, the KYC block is not.
          relationshipManagerId: entity.relationshipManagerId || null,
          assignedUserIds: entity.assignedUserIds || [],
          referenceCurrency: entity.referenceCurrency || 'EUR',
          status: entity.status || 'active',
          stakeholders: [],
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          splitFromCombinedEntityId: entity._id
        });
        holderIds.push(newId);
        created++;
      }

      if (holderIds.length < 2) continue;

      const holderDocs = [];
      for (const id of holderIds) {
        holderDocs.push(await ClientEntitiesCollection.findOneAsync(id));
      }

      // Every account the combined entity held, plus any sibling row filed under
      // one of the real holders for the same (bankId, accountNumber).
      const combinedAccounts = await BankAccountsCollection.find({
        entityId: entity._id,
        isActive: true
      }).fetchAsync();

      for (const account of combinedAccounts) {
        const siblings = await BankAccountsCollection.find({
          _id: { $ne: account._id },
          bankId: account.bankId,
          accountNumber: account.accountNumber,
          isActive: true
        }).fetchAsync();

        // Keep the row the bank's holdings actually point at — deactivating that
        // one would orphan the positions.
        let keeper = account;
        for (const sibling of siblings) {
          const holdingCount = await PMSHoldingsCollection.find({
            $or: [{ entityId: sibling.entityId }, { userId: sibling.userId }],
            portfolioCode: account.accountNumber
          }, { limit: 1 }).countAsync();
          if (holdingCount > 0) { keeper = sibling; break; }
        }

        const holderSet = [...new Set([
          keeper.entityId,
          ...holderIds
        ].filter(Boolean))].filter(id => id !== entity._id);

        // Don't lose an assessment that happens to sit on a row being retired.
        const losingRows = [account, ...siblings].filter(r => r._id !== keeper._id);
        const inheritedRiskScore = keeper.kycRiskScore
          ? null
          : losingRows.find(r => r.kycRiskScore)?.kycRiskScore || null;

        await BankAccountsCollection.updateAsync(keeper._id, {
          $set: {
            entityId: holderSet[0],
            holderEntityIds: holderSet,
            name: buildJointAccountName(holderDocs),
            ...(inheritedRiskScore ? { kycRiskScore: inheritedRiskScore } : {}),
            updatedAt: new Date()
          }
        });

        // Retire the duplicate rows for the same real account.
        for (const row of [account, ...siblings]) {
          if (row._id === keeper._id) continue;
          await BankAccountsCollection.updateAsync(row._id, {
            $set: { isActive: false, mergedIntoAccountId: keeper._id, updatedAt: new Date() }
          });
          merged++;
        }
      }

      await ClientEntitiesCollection.updateAsync(entity._id, {
        $set: {
          isActive: false,
          status: 'archived',
          splitIntoEntityIds: holderIds,
          updatedAt: new Date()
        }
      });
      split++;
    }

    if (split) {
      console.log(`[splitJointAccountEntities] Split ${split} combined client entit(ies) into individual holders (${created} created, ${merged} duplicate account row(s) merged)`);
    }
  } catch (error) {
    console.error('[splitJointAccountEntities] Migration failed:', error.message);
  }
}
