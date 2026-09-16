/**
 * KYC risk assessment moved from the client to the bank account (Sept 2026).
 *
 * Risk was previously assessed once per client (`clientEntities.kycRiskScore`,
 * or `users.profile.kycRiskScore` for pre-entity clients) and shown on the client
 * header and a client-level tab. It is now assessed per banking relationship:
 * each account has its own jurisdiction, product mix and review cycle, so a
 * client banking in two places carries two assessments with two review dates.
 *
 * This copies each existing client-level assessment onto that owner's active
 * accounts so nothing appears unassessed after the move. The client-level field
 * is deliberately LEFT IN PLACE — it is the record of what was assessed and when,
 * and the UI no longer reads it.
 *
 * Idempotent: an account that already has its own kycRiskScore is never touched,
 * so a second run (or a restart after a partial run) is a no-op.
 */

import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { BankAccountsCollection } from '/imports/api/bankAccounts';

export async function moveRiskScoreToAccounts() {
  try {
    const sources = [];

    const entities = await ClientEntitiesCollection.find(
      { kycRiskScore: { $exists: true, $ne: null } },
      { fields: { kycRiskScore: 1, kycRiskScoreHistory: 1, migratedFromUserId: 1 } }
    ).fetchAsync();
    for (const entity of entities) {
      sources.push({
        label: `entity ${entity._id}`,
        ownerIds: [entity._id, entity.migratedFromUserId].filter(Boolean),
        riskScore: entity.kycRiskScore,
        history: entity.kycRiskScoreHistory || []
      });
    }

    // Pre-entity clients kept the assessment on the user profile.
    const legacyUsers = await UsersCollection.find(
      { role: USER_ROLES.CLIENT, 'profile.kycRiskScore': { $exists: true, $ne: null } },
      { fields: { 'profile.kycRiskScore': 1 } }
    ).fetchAsync();
    for (const legacyUser of legacyUsers) {
      sources.push({
        label: `user ${legacyUser._id}`,
        ownerIds: [legacyUser._id],
        riskScore: legacyUser.profile.kycRiskScore,
        history: []
      });
    }

    if (sources.length === 0) return;

    let copied = 0;
    let skipped = 0;

    for (const source of sources) {
      // Accounts are filed under entityId post-migration but some legacy rows
      // still carry only userId, so match either.
      const accounts = await BankAccountsCollection.find({
        isActive: true,
        $or: [
          { entityId: { $in: source.ownerIds } },
          { userId: { $in: source.ownerIds } }
        ]
      }, { fields: { kycRiskScore: 1 } }).fetchAsync();

      for (const account of accounts) {
        if (account.kycRiskScore) { skipped++; continue; }
        await BankAccountsCollection.updateAsync(account._id, {
          $set: {
            kycRiskScore: source.riskScore,
            ...(source.history.length ? { kycRiskScoreHistory: source.history } : {}),
            updatedAt: new Date()
          }
        });
        copied++;
      }
    }

    if (copied || skipped) {
      console.log(`[moveRiskScoreToAccounts] Copied ${copied} client-level KYC assessment(s) onto bank accounts (${skipped} account(s) already had their own)`);
    }
  } catch (error) {
    console.error('[moveRiskScoreToAccounts] Migration failed:', error.message);
  }
}
