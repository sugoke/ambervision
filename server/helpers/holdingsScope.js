// Holdings scope helper
//
// Resolves "which products are currently HELD" for a given user + view-as scope,
// using actual bank holdings (PMSHoldings) as the source of truth. Used to hide
// sold/matured products (which leave the holdings feed) from the Underlyings and
// Schedule sections.
//
// The scope-resolution branches below intentionally mirror the owner-filter in
// server/publications/pmsHoldings.js (entity / client / account / admin / RM /
// client), which is the canonical implementation. Keep the two in sync if the
// publication's access rules change. We do NOT import from the publication to
// avoid coupling a deploy-sensitive path; the logic is duplicated deliberately.

import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { ProductsCollection } from '/imports/api/products';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';

/**
 * Build the PMSHoldings query selector scoping to holdings the given user is
 * allowed to see under the given view-as filter.
 *
 * @returns {Promise<Object|null>} a Mongo selector, or null when the scope
 *   resolves to "no access / nothing" (caller should treat as empty result).
 */
async function buildHoldingsScopeSelector({ currentUser, viewAsFilter }) {
  if (!currentUser) return null;

  const queryFilter = { isActive: true };
  // The entity this view is drilled into, if any. A demo client's holdings are hidden
  // everywhere except here — selecting it in View As is the only context in which
  // fictional data is meant to be on screen.
  let scopedEntityId = null;

  const isAdmin = currentUser.role === USER_ROLES.ADMIN
    || currentUser.role === USER_ROLES.SUPERADMIN
    || currentUser.role === USER_ROLES.COMPLIANCE;
  const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER
    || currentUser.role === USER_ROLES.ASSISTANT;
  const isClient = currentUser.role === USER_ROLES.CLIENT;

  if (viewAsFilter && (isAdmin || isRM)) {
    if (viewAsFilter.type === 'entity') {
      const entity = await ClientEntitiesCollection.findOneAsync(viewAsFilter.id);
      if (!entity) return null;
      if (ClientEntityHelpers.isEntityArchived(entity)) return null;
      scopedEntityId = entity._id;
      if (isRM) {
        const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
        if (!rmIds.includes(entity.relationshipManagerId)) return null;
      }

      const entityAccounts = await BankAccountsCollection.find({
        $or: [
          { entityId: entity._id },
          { beneficialOwnerIds: entity._id },
          { beneficialOwnerId: entity._id }
        ],
        isActive: true
      }).fetchAsync();

      const orConditions = [{ entityId: entity._id }];
      if (entity.migratedFromUserId) {
        orConditions.push({ userId: entity.migratedFromUserId, entityId: { $exists: false } });
      }
      for (const acct of entityAccounts) {
        if (!acct.accountNumber || !acct.bankId) continue;
        const baseNum = acct.accountNumber.split('-')[0];
        const codesForAccount = await PMSHoldingsCollection.rawCollection().distinct('portfolioCode', {
          portfolioCode: { $regex: `^${baseNum}` },
          bankId: acct.bankId
        });
        if (codesForAccount.length > 0) {
          orConditions.push({ bankId: acct.bankId, portfolioCode: { $in: codesForAccount } });
        }
      }
      queryFilter.$or = orConditions;
    } else if (viewAsFilter.type === 'client') {
      if (isRM) {
        const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
        const targetClient = await UsersCollection.findOneAsync({
          _id: viewAsFilter.id,
          relationshipManagerId: { $in: rmIds }
        });
        if (!targetClient) return null;
      }
      queryFilter.userId = viewAsFilter.id;
    } else if (viewAsFilter.type === 'account') {
      const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      if (!bankAccount) return null;
      scopedEntityId = bankAccount.entityId || null;
      if (isRM) {
        const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
        let hasAccess = false;
        if (bankAccount.entityId) {
          const entity = await ClientEntitiesCollection.findOneAsync(bankAccount.entityId);
          if (entity && rmIds.includes(entity.relationshipManagerId)) hasAccess = true;
        }
        if (!hasAccess && bankAccount.userId) {
          const targetClient = await UsersCollection.findOneAsync({
            _id: bankAccount.userId,
            relationshipManagerId: { $in: rmIds }
          });
          if (targetClient) hasAccess = true;
        }
        if (!hasAccess) return null;
      }
      const baseAccountNumber = bankAccount.accountNumber.split('-')[0];
      queryFilter.portfolioCode = { $regex: `^${baseAccountNumber}(-|$)` };
      queryFilter.bankId = bankAccount.bankId;
    }
  } else if (viewAsFilter && isClient) {
    if (viewAsFilter.type === 'account') {
      const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      let ownsAccount = false;
      if (bankAccount) {
        if (bankAccount.userId === currentUser._id) {
          ownsAccount = true;
        } else if (bankAccount.entityId) {
          const { UserEntityAccessHelpers } = await import('/imports/api/userEntityAccess.js');
          ownsAccount = await UserEntityAccessHelpers.hasAccess(currentUser._id, bankAccount.entityId);
        }
      }
      if (ownsAccount) {
        const baseAccountNumber = bankAccount.accountNumber.split('-')[0];
        queryFilter.portfolioCode = { $regex: `^${baseAccountNumber}(-|$)` };
        queryFilter.bankId = bankAccount.bankId;
      } else {
        queryFilter.userId = currentUser._id;
      }
    } else {
      queryFilter.userId = currentUser._id;
    }
  } else if (isAdmin) {
    // No additional filter — all active holdings.
  } else if (isRM) {
    const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
    const assignedEntities = await ClientEntitiesCollection.find({
      relationshipManagerId: { $in: rmIds },
      isActive: true
    }).fetchAsync();
    const entityIds = assignedEntities.map(e => e._id);

    const backupAccounts = await BankAccountsCollection.find(
      { backupRmIds: { $in: rmIds }, isActive: true, entityId: { $exists: true } },
      { fields: { entityId: 1 } }
    ).fetchAsync();
    const backupEntityIds = backupAccounts.map(a => a.entityId).filter(Boolean);
    const allEntityIds = [...new Set([...entityIds, ...backupEntityIds])];

    const assignedClients = await UsersCollection.find({
      relationshipManagerId: { $in: rmIds }
    }).fetchAsync();
    const clientIds = assignedClients.map(c => c._id);
    clientIds.push(currentUser._id);

    queryFilter.$or = [
      ...(allEntityIds.length > 0 ? [{ entityId: { $in: allEntityIds } }] : []),
      { userId: { $in: clientIds } }
    ];
  } else if (isClient) {
    const { UserEntityAccessHelpers } = await import('/imports/api/userEntityAccess.js');
    const accessRecords = await UserEntityAccessHelpers.getUserEntities(currentUser._id);
    const entityIds = accessRecords.map(a => a.entityId);
    if (entityIds.length > 0) {
      queryFilter.$or = [
        { entityId: { $in: entityIds } },
        { userId: currentUser._id }
      ];
    } else {
      queryFilter.userId = currentUser._id;
    }
  }

  // Exclude holdings of archived (closed-relationship) clients from every path, and of
  // demo clients from every path except a drill-down into that demo client itself.
  const hiddenExclusion = await ClientEntityHelpers.hiddenHoldingsSelector({
    exceptEntityId: scopedEntityId
  });
  if (hiddenExclusion.$nor) {
    queryFilter.$nor = hiddenExclusion.$nor;
  }

  return queryFilter;
}

/**
 * Return the set of Products._id currently HELD within the given scope.
 *
 * "Held" = latest, active PMSHoldings snapshot with quantity > 0. Products are
 * matched to holdings by ISIN and by the holding's linkedProductId. Sold/matured
 * products (isActive:false or quantity 0) are naturally excluded.
 *
 * @returns {Promise<Set<string>>}
 */
export async function getHeldProductIdsForScope({ currentUser, viewAsFilter }) {
  const scopeSelector = await buildHoldingsScopeSelector({ currentUser, viewAsFilter });
  if (!scopeSelector) return new Set();

  const heldSelector = {
    ...scopeSelector,
    isLatest: true,
    quantity: { $gt: 0 }
  };

  const raw = PMSHoldingsCollection.rawCollection();
  const [heldIsins, linkedProductIds] = await Promise.all([
    raw.distinct('isin', { ...heldSelector, isin: { $nin: [null, ''] } }),
    raw.distinct('linkedProductId', { ...heldSelector, linkedProductId: { $nin: [null, ''] } })
  ]);

  const productIds = new Set();

  // linkedProductId values are Products._id references — include directly.
  for (const pid of linkedProductIds) {
    if (pid) productIds.add(String(pid));
  }

  // Map held ISINs → Products._id (ISINs are canonical uppercase).
  if (heldIsins.length > 0) {
    const products = await ProductsCollection.find(
      { isin: { $in: heldIsins } },
      { fields: { _id: 1 } }
    ).fetchAsync();
    for (const p of products) productIds.add(String(p._id));
  }

  return productIds;
}
