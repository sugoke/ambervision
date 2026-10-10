// Publications for the View As picker: the clients, entities and accounts a
// staff user may drill into — i.e. exactly their access scope.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { BankAccountsCollection, BANK_ACCOUNT_LIST_FIELDS } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { isStaff } from '../helpers/accessPolicy.js';
import { resolveScope, usersSelector, entitiesSelector, bankAccountsSelector } from '../helpers/accessScope.js';

const CLIENT_FIELDS = { email: 1, username: 1, role: 1, profile: 1, relationshipManagerId: 1 };
const ENTITY_FIELDS = { type: 1, profile: 1, relationshipManagerId: 1, assignedUserIds: 1, referenceCurrency: 1 };

// Client logins in scope
Meteor.publish('users.clients', async function(sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  return UsersCollection.find(
    { $and: [await usersSelector(scope), { role: USER_ROLES.CLIENT }] },
    { fields: CLIENT_FIELDS, sort: { 'profile.lastName': 1, 'profile.firstName': 1 } }
  );
});

// Bank accounts in scope (no KYC fields)
Meteor.publish('bankAccounts.all', async function(sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  return BankAccountsCollection.find(
    { $and: [bankAccountsSelector(scope), { isActive: true }] },
    { ...BANK_ACCOUNT_LIST_FIELDS, sort: { accountNumber: 1 } }
  );
});

// Banks (names for the filter) — any logged-in user
Meteor.publish('banks.all', async function(sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();
  return BanksCollection.find({});
});

// Client entities in scope
Meteor.publish('entities.forViewAs', async function(sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!isStaff(user)) return this.ready();

  const scope = await resolveScope(user);
  if (scope.denied) return this.ready();

  return ClientEntitiesCollection.find(
    { $and: [entitiesSelector(scope), { isActive: true }] },
    { fields: ENTITY_FIELDS, sort: { 'profile.lastName': 1, 'profile.firstName': 1, 'profile.companyName': 1 } }
  );
});
