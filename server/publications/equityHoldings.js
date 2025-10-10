// Equity Holdings Publications
// Handles all equity holdings related publications

import { check, Match } from 'meteor/check';
import { EquityHoldingsCollection } from '/imports/api/equityHoldings';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { Meteor } from 'meteor/meteor';

Meteor.publish('equityHoldings', async function (bankAccountId, sessionId = null) {
  check(bankAccountId, String);
  check(sessionId, Match.Optional(String));

  // console.log(`[EQUITY PUB] Request - bankAccountId: ${bankAccountId}, sessionId: ${sessionId}, userId: ${this.userId}`);

  if (!this.userId && !sessionId) {
    // console.log('[EQUITY PUB] No authentication provided - returning empty');
    return this.ready();
  }

  try {
    // Get current user with session-based authentication
    const currentUser = sessionId ?
      await Meteor.callAsync('auth.getCurrentUser', sessionId) :
      await UsersCollection.findOneAsync(this.userId);

    // console.log('[EQUITY PUB] Current user:', currentUser?._id, 'Role:', currentUser?.role);

    if (!currentUser) {
      // console.log('[EQUITY PUB] No valid user found');
      return this.ready();
    }

    // First, verify the bank account exists and user has access to it
    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    if (!bankAccount) {
      // console.log('Equity holdings publication: Bank account not found');
      return this.ready();
    }

    // Role-based access control
    let hasAccess = false;

    switch (currentUser.role) {
      case USER_ROLES.SUPERADMIN:
      case USER_ROLES.ADMIN:
        // Admins can see all equity holdings
        hasAccess = true;
        break;

      case USER_ROLES.RELATIONSHIP_MANAGER:
        // RMs can see holdings of their assigned clients' bank accounts
        const bankAccountOwner = await UsersCollection.findOneAsync(bankAccount.userId);
        hasAccess = bankAccountOwner && (
          bankAccountOwner.relationshipManagerId === currentUser._id ||
          bankAccount.userId === currentUser._id
        );
        break;

      case USER_ROLES.CLIENT:
        // Clients can only see their own equity holdings
        hasAccess = bankAccount.userId === currentUser._id;
        break;
    }

    if (!hasAccess) {
      // console.log('Equity holdings publication: Access denied');
      return this.ready();
    }

    // console.log(`[EQUITY PUB] Access granted for bank account ${bankAccountId}`);
    const holdings = await EquityHoldingsCollection.find({ bankAccountId }).fetchAsync();
    // console.log(`[EQUITY PUB] Returning ${holdings.length} holdings`);
    return EquityHoldingsCollection.find({ bankAccountId });

  } catch (error) {
    console.error('Equity holdings publication error:', error);
    return this.ready();
  }
});






