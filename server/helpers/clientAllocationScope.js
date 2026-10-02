import { BankAccountsCollection, accountHolderSelector, getAccountHolderIds } from '/imports/api/bankAccounts';
import { getFilteredClientIds } from '../methods/rmDashboardMethods.js';

/**
 * Allocation selector for a CLIENT login: every allocation of the client, under
 * whichever owner key it was recorded with.
 *
 * Allocations are keyed by the legacy login id on older records and by the
 * client ENTITY id on newer ones (auto-allocation writes the entity), and they
 * always carry the bankAccountId. Matching `clientId: user._id` alone hid the
 * entity-keyed ones from the client's own login — Jagdeep Kapoor saw 18 of his
 * 22 products — while an admin "viewing as" the same client saw all of them.
 *
 * The perimeter is the one the PMS uses (the login plus entities it holds access
 * grants for), widened to the entities and accounts linked to the login through
 * its bank accounts: most clients have no grant, and the bank account (which
 * carries both the login id and the entity id) is the durable link.
 *
 * @returns {Promise<Object|null>} Mongo selector, or null when nothing is in scope
 */
export async function clientAllocationSelector(user) {
  const ownerIds = await getFilteredClientIds(user, null);

  const accounts = await BankAccountsCollection.find(
    { $or: [{ userId: user._id }, { isActive: true, ...accountHolderSelector(ownerIds) }] },
    { fields: { _id: 1, entityId: 1, holderEntityIds: 1, userId: 1 } }
  ).fetchAsync();

  // The login's own entity: the holder of a SOLE account carrying its userId.
  // A joint account's other holders are not this client — their allocations on
  // the joint account are reached through bankAccountId below, and their other
  // (private) allocations must stay out of scope.
  const ownEntityIds = accounts
    .filter(a => a.userId === user._id && getAccountHolderIds(a).length === 1)
    .map(a => a.entityId);
  const clientIds = [...new Set([...ownerIds, ...ownEntityIds].filter(Boolean))];
  const bankAccountIds = accounts.map(a => a._id);

  const orConditions = [];
  if (clientIds.length > 0) orConditions.push({ clientId: { $in: clientIds } });
  if (bankAccountIds.length > 0) orConditions.push({ bankAccountId: { $in: bankAccountIds } });
  if (orConditions.length === 0) return null;
  return orConditions.length === 1 ? orConditions[0] : { $or: orConditions };
}
