/**
 * Migration Script: Add entityId to PMS Operations
 *
 * Operations created before the entity architecture migration only have userId.
 * This migration links them to entities via bankAccounts (portfolioCode → accountNumber → entityId).
 *
 * Run from Meteor shell:
 *   meteor shell
 *   > require('./server/migrations/migrateOperationsToEntities.js').migrateOperationsToEntities()
 *
 * Dry run (preview only):
 *   > require('./server/migrations/migrateOperationsToEntities.js').migrateOperationsToEntities({ dryRun: true })
 */

import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { PMSOperationsCollection } from '../../imports/api/pmsOperations.js';

export async function migrateOperationsToEntities({ dryRun = false } = {}) {
  console.log(`[OP_ENTITY_MIGRATION] Starting${dryRun ? ' (DRY RUN)' : ''}...`);

  // Step 1: Build mapping from accountNumber → entityId using bank accounts
  const bankAccounts = await BankAccountsCollection.find(
    { entityId: { $exists: true, $ne: null } },
    { fields: { accountNumber: 1, entityId: 1, bankId: 1 } }
  ).fetchAsync();

  // Map: accountNumber → entityId (prefer active entities, last one wins)
  const accountToEntity = {};
  for (const ba of bankAccounts) {
    accountToEntity[ba.accountNumber] = ba.entityId;
  }

  console.log(`[OP_ENTITY_MIGRATION] Built mapping for ${Object.keys(accountToEntity).length} accounts`);

  // Step 2: Find all operations without entityId
  const operations = await PMSOperationsCollection.find(
    { entityId: { $exists: false } },
    { fields: { portfolioCode: 1, userId: 1, bankId: 1 } }
  ).fetchAsync();

  console.log(`[OP_ENTITY_MIGRATION] Found ${operations.length} operations without entityId`);

  let matched = 0;
  let unmatched = 0;
  const unmatchedPortfolios = new Set();
  const bulkOps = [];

  for (const op of operations) {
    // Strip suffix (e.g., "5040241-1" → "5040241")
    const basePortfolio = op.portfolioCode ? op.portfolioCode.split('-')[0] : null;
    const entityId = basePortfolio ? accountToEntity[basePortfolio] : null;

    if (entityId) {
      matched++;
      bulkOps.push({
        updateOne: {
          filter: { _id: op._id },
          update: { $set: { entityId } }
        }
      });
    } else {
      unmatched++;
      if (basePortfolio) unmatchedPortfolios.add(basePortfolio);
    }
  }

  console.log(`[OP_ENTITY_MIGRATION] Matched: ${matched}, Unmatched: ${unmatched}`);
  if (unmatchedPortfolios.size > 0) {
    console.log(`[OP_ENTITY_MIGRATION] Unmatched portfolios: ${[...unmatchedPortfolios].join(', ')}`);
  }

  if (dryRun) {
    console.log('[OP_ENTITY_MIGRATION] DRY RUN complete — no changes made');
    return { matched, unmatched, unmatchedPortfolios: [...unmatchedPortfolios] };
  }

  // Step 3: Execute bulk update
  if (bulkOps.length > 0) {
    const result = await PMSOperationsCollection.rawCollection().bulkWrite(bulkOps, { ordered: false });
    console.log(`[OP_ENTITY_MIGRATION] Updated ${result.modifiedCount} operations`);
  }

  console.log('[OP_ENTITY_MIGRATION] Migration complete');
  return { matched, unmatched, unmatchedPortfolios: [...unmatchedPortfolios] };
}
