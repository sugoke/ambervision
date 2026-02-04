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

    const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
    const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER;
    const isClient = currentUser.role === USER_ROLES.CLIENT;

    // Handle viewAsFilter for admins and RMs
    if (viewAsFilter && (isAdmin || isRM)) {
      if (viewAsFilter.type === 'client') {
        // For RMs, verify they have access to this client
        if (isRM) {
          const targetClient = await UsersCollection.findOneAsync({
            _id: viewAsFilter.id,
            relationshipManagerId: currentUser._id
          });
          if (!targetClient) {
            console.log('[PMS_OPERATIONS] RM does not have access to client:', viewAsFilter.id);
            return this.ready();
          }
        }
        // Filter by client userId (all accounts aggregated)
        queryFilter.userId = viewAsFilter.id;
      } else if (viewAsFilter.type === 'account') {
        // Filter by specific bank account
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          // For RMs, verify they have access to this client
          if (isRM) {
            const targetClient = await UsersCollection.findOneAsync({
              _id: bankAccount.userId,
              relationshipManagerId: currentUser._id
            });
            if (!targetClient) {
              console.log('[PMS_OPERATIONS] RM does not have access to account owner:', bankAccount.userId);
              return this.ready();
            }
          }
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
    // Handle viewAsFilter for clients - only allow filtering to their OWN accounts
    else if (viewAsFilter && isClient) {
      if (viewAsFilter.type === 'account') {
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        // Security: Verify the client owns this account
        if (bankAccount && bankAccount.userId === currentUser._id) {
          queryFilter.userId = currentUser._id;
          const baseAccountNumber = bankAccount.accountNumber.split('-')[0];
          queryFilter.portfolioCode = { $regex: `^${baseAccountNumber}` };
          queryFilter.bankId = bankAccount.bankId;
          console.log('[PMS_OPERATIONS] Client filtering to own account:', bankAccount.accountNumber);
        } else {
          // If account not found or not owned by client, fall through to default client filter
          console.log('[PMS_OPERATIONS] Client viewAsFilter rejected - account not owned:', viewAsFilter.id);
          queryFilter.userId = currentUser._id;
        }
      } else {
        // For any other filter type from clients, default to their own operations
        queryFilter.userId = currentUser._id;
      }
    }
    // Admins without filter - see all operations
    else if (isAdmin) {
      // No additional filter - see all active operations
    }
    // Relationship Managers without filter - see all assigned clients' operations
    else if (isRM) {
      // Get all clients assigned to this RM
      const assignedClients = await UsersCollection.find({
        relationshipManagerId: currentUser._id
      }).fetchAsync();
      const clientIds = assignedClients.map(c => c._id);
      clientIds.push(currentUser._id); // Include RM's own operations

      queryFilter.userId = { $in: clientIds };
    }
    // Clients - only their own operations
    else if (isClient) {
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
