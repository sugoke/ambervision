// Banks Publications
// Handles all bank and bank account related publications

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
Meteor.publish("userBankAccounts", function (userId) {
  if (!userId) return this.ready();
  return BankAccountsCollection.find({ userId: userId, isActive: true });
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






