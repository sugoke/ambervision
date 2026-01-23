// PMS Operations Publications
// Handles all PMS operations/transactions related publications

import { check, Match } from 'meteor/check';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';
import { Meteor } from 'meteor/meteor';

// Debug method to check operations count
Meteor.methods({
  'pmsOperations.debugCount': async function() {
    const total = await PMSOperationsCollection.find({}).countAsync();
    const active = await PMSOperationsCollection.find({ isActive: true }).countAsync();
    const withBankId = await PMSOperationsCollection.find({ isActive: true, bankId: { $exists: true } }).countAsync();
    const sample = await PMSOperationsCollection.findOneAsync({ isActive: true });
    // Get distinct bankIds
    const bankIds = await PMSOperationsCollection.rawCollection().distinct('bankId', { isActive: true });
    return {
      total, active, withBankId,
      distinctBankIds: bankIds,
      sampleBankId: sample?.bankId || 'MISSING',
      samplePortfolio: sample?.portfolioCode || 'none'
    };
  }
});

Meteor.publish('pmsOperations', async function (sessionId = null, viewAsFilter = null) {
  check(sessionId, Match.Maybe(String));
  check(viewAsFilter, Match.Maybe(Match.ObjectIncluding({
    type: String,
    id: String
  })));

  if (!this.userId && !sessionId) {
    return this.ready();
  }

  try {
    // Get current user with session-based authentication
    let currentUser = null;

    if (sessionId) {
      const session = await SessionsCollection.findOneAsync({
        sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);

        // Update last used timestamp asynchronously (non-blocking)
        SessionsCollection.updateAsync(session._id, {
          $set: { lastUsed: new Date() }
        }).catch(err => console.error('Error updating session lastUsed:', err));
      }
    } else if (this.userId) {
      currentUser = await UsersCollection.findOneAsync(this.userId);
    }

    if (!currentUser) {
      return this.ready();
    }

    // Build query filter based on role and viewAsFilter
    let queryFilter = { isActive: true };

    // Admins and superadmins with viewAsFilter
    if (viewAsFilter && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN)) {
      if (viewAsFilter.type === 'client') {
        // Filter by client userId (all accounts aggregated)
        queryFilter.userId = viewAsFilter.id;
      } else if (viewAsFilter.type === 'account') {
        // Filter by specific bank account
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          queryFilter.userId = bankAccount.userId;
          // Match portfolioCode - strip suffix from bankAccount if present, use regex to match with/without suffix
          // Handles: "5040241", "5040241-1", "5040241200001" (JB long format)
          const baseAccountNumber = bankAccount.accountNumber.split('-')[0];
          queryFilter.portfolioCode = { $regex: `^${baseAccountNumber}` };
          queryFilter.bankId = bankAccount.bankId;
        } else {
          // Account not found - return empty result
          return this.ready();
        }
      }
    }
    // Admins without filter - see all operations
    else if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
      // No additional filter - see all active operations
    }
    // Relationship Managers
    else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      // Get all clients assigned to this RM
      const assignedClients = await UsersCollection.find({
        relationshipManagerId: currentUser._id
      }).fetchAsync();
      const clientIds = assignedClients.map(c => c._id);
      clientIds.push(currentUser._id); // Include RM's own operations

      queryFilter.userId = { $in: clientIds };
    }
    // Clients - only their own operations
    else if (currentUser.role === USER_ROLES.CLIENT) {
      queryFilter.userId = currentUser._id;
    }

    // Return operations sorted by date (most recent first)
    return PMSOperationsCollection.find(queryFilter, {
      sort: { operationDate: -1, inputDate: -1 }
    });

  } catch (error) {
    console.error('PMS operations publication error:', error);
    return this.ready();
  }
});
