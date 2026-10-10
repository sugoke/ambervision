// Banks Publications
// Banks are reference data for any logged-in user; bank accounts are client
// data and go through the access scope.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { BanksCollection } from '/imports/api/banks';
import { BankAccountsCollection, BANK_ACCOUNT_LIST_FIELDS, accountHolderSelector } from '/imports/api/bankAccounts';
import { parseViewAs } from '/imports/utils/viewAs';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { isSeeAll, isStaff, ADMIN_ROLES } from '../helpers/accessPolicy.js';
import { resolveScope, bankAccountsSelector, isClientInScope } from '../helpers/accessScope.js';

// Active banks, for bank selection
Meteor.publish("banks", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();
  return BanksCollection.find({ isActive: true }, { sort: { name: 1 } });
});

// Every bank incl. inactive — admin only
Meteor.publish("banksManagement", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user || !ADMIN_ROLES.includes(user.role)) return this.ready();
  return BanksCollection.find({}, { sort: { name: 1 } });
});

/**
 * Bank accounts in the viewer's scope (optionally narrowed by View As).
 * The KYC risk assessment is never part of this list (GDPR minimisation);
 * it travels one owner at a time via `bankAccounts.details`.
 */
Meteor.publish("userBankAccounts", async function (sessionId, rawViewAs = null) {
  check(sessionId, Match.Maybe(String));
  const viewAs = parseViewAs(rawViewAs);

  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const scope = await resolveScope(user, viewAs);
  if (scope.denied) return this.ready();

  const query = { $and: [bankAccountsSelector(scope), { isActive: true }] };

  // Manual publish so the documents arrive before ready(), then observe.
  const self = this;
  const accounts = await BankAccountsCollection.find(query, BANK_ACCOUNT_LIST_FIELDS).fetchAsync();
  for (const account of accounts) {
    self.added('bankAccounts', account._id, account);
  }
  self.ready();

  const handle = await BankAccountsCollection.find(query, BANK_ACCOUNT_LIST_FIELDS).observeChanges({
    added(id, fields) {
      if (!accounts.find(a => a._id === id)) self.added('bankAccounts', id, fields);
    },
    changed(id, fields) { self.changed('bankAccounts', id, fields); },
    removed(id) { self.removed('bankAccounts', id); }
  });
  self.onStop(() => handle.stop());
});

// Active bank accounts for allocation selection — see-all roles only
Meteor.publish("bankAccounts", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isSeeAll(user)) return this.ready();
  return BankAccountsCollection.find({ isActive: true }, BANK_ACCOUNT_LIST_FIELDS);
});

// Active bank accounts for the admin management screens, within the viewer's scope
Meteor.publish('allBankAccounts', async function (sessionId) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  return BankAccountsCollection.find(
    { $and: [bankAccountsSelector(scope), { isActive: true }] },
    { sort: { createdAt: -1 }, ...BANK_ACCOUNT_LIST_FIELDS }
  );
});

/**
 * Full bank-account documents — including the KYC risk assessment — for the
 * accounts of ONE owner in the viewer's scope. The detail screen needs the risk
 * block for the client being viewed, while the list publications stay minimised.
 */
Meteor.publish('bankAccounts.details', async function (sessionId, ownerId) {
  check(sessionId, Match.Maybe(String));
  check(ownerId, Match.Maybe(String));
  if (!ownerId) return this.ready();

  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return this.ready();

  const scope = await resolveScope(user);
  if (!(await isClientInScope(scope, ownerId))) return this.ready();

  // Matches the owner as primary holder, co-holder of a joint account, or under
  // a legacy userId.
  return BankAccountsCollection.find({ ...accountHolderSelector([ownerId]), isActive: true });
});
