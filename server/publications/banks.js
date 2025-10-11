// Banks Publications
// Handles all bank and bank account related publications

import { Meteor } from 'meteor/meteor';
import { BanksCollection } from '/imports/api/banks';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';

// Publish banks for bank selection
Meteor.publish("banks", function () {
  return BanksCollection.find({ isActive: true }, { sort: { name: 1 } });
});

// Publish banks management (admin only)
Meteor.publish("banksManagement", function () {
  return BanksCollection.find({}, { sort: { name: 1 } });
});

// Publish user's bank accounts
Meteor.publish("userBankAccounts", async function (sessionId) {
  console.log('[userBankAccounts] Publication called with sessionId:', sessionId);

  if (!sessionId) {
    console.log('[userBankAccounts] No sessionId provided');
    return this.ready();
  }

  // Get session
  const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
  if (!session || !session.userId) {
    console.log('[userBankAccounts] No valid session found');
    return this.ready();
  }

  // Get user
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) {
    console.log('[userBankAccounts] No user found');
    return this.ready();
  }

  console.log('[userBankAccounts] User role:', user.role);

  // Admins and superadmins see ALL accounts
  if (user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN) {
    console.log('[userBankAccounts] Admin/Superadmin - returning all active accounts');
    return BankAccountsCollection.find({ isActive: true });
  }

  // Clients and RMs see only their own accounts
  console.log('[userBankAccounts] Client/RM - returning only user accounts for:', user._id);
  return BankAccountsCollection.find({ userId: user._id, isActive: true });
});

// Publish bank accounts (for allocation selection)
Meteor.publish("bankAccounts", async function () {
  // Get session from connection
  const sessionId = this.connection?.id;
  if (!sessionId) {
    return this.ready();
  }

  const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
  if (!session || !session.userId) {
    return this.ready();
  }

  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
    return this.ready();
  }

  return BankAccountsCollection.find({ isActive: true });
});






