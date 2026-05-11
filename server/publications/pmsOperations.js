// PMS Operations Publications
// Handles all PMS operations/transactions related publications

import { check, Match } from 'meteor/check';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
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
      if (viewAsFilter.type === 'entity') {
        // Entity-based filter
        const entity = await ClientEntitiesCollection.findOneAsync(viewAsFilter.id);
        if (!entity) return this.ready();
        if (isRM && entity.relationshipManagerId !== currentUser._id) return this.ready();

        // Find bank accounts owned by this entity
        const entityAccounts = await BankAccountsCollection.find({
          $or: [
            { entityId: entity._id },
            { beneficialOwnerIds: entity._id },
            { beneficialOwnerId: entity._id }
          ],
          isActive: true
        }).fetchAsync();
        const accountNumbers = entityAccounts.map(a => a.accountNumber).filter(Boolean);

        // Build OR conditions: entityId, legacy userId, or portfolioCode match
        const orConditions = [
          { entityId: entity._id }
        ];
        if (entity.migratedFromUserId) {
          orConditions.push({ userId: entity.migratedFromUserId, entityId: { $exists: false } });
        }
        if (accountNumbers.length > 0) {
          // Match operations by portfolioCode (may have suffixes like -1)
          const portfolioRegexes = accountNumbers.map(num => {
            const base = num.split('-')[0];
            return { portfolioCode: { $regex: `^${base}` } };
          });
          orConditions.push(...portfolioRegexes);
        }
        queryFilter.$or = orConditions;
      } else if (viewAsFilter.type === 'client') {
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
        if (!bankAccount) return this.ready();
        // For RMs, verify access via user or entity
        if (isRM) {
          let hasAccess = false;
          if (bankAccount.userId) {
            const targetClient = await UsersCollection.findOneAsync({ _id: bankAccount.userId, relationshipManagerId: currentUser._id });
            if (targetClient) hasAccess = true;
          }
          if (!hasAccess && bankAccount.entityId) {
            const targetEntity = await ClientEntitiesCollection.findOneAsync({ _id: bankAccount.entityId, relationshipManagerId: currentUser._id });
            if (targetEntity) hasAccess = true;
          }
          if (!hasAccess) return this.ready();
        }
        // Build query with entity support
        if (bankAccount.entityId) {
          queryFilter.$or = [
            { entityId: bankAccount.entityId },
            ...(bankAccount.userId ? [{ userId: bankAccount.userId, entityId: { $exists: false } }] : [])
          ];
        } else if (bankAccount.userId) {
          queryFilter.userId = bankAccount.userId;
        }
        const baseAccountNumber = bankAccount.accountNumber.split('-')[0];
        queryFilter.portfolioCode = { $regex: `^${baseAccountNumber}` };
        queryFilter.bankId = bankAccount.bankId;
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
      // Get entity-based clients
      const rmEntities = await ClientEntitiesCollection.find(
        { relationshipManagerId: currentUser._id, isActive: true },
        { fields: { _id: 1, migratedFromUserId: 1 } }
      ).fetchAsync();
      const entityIds = rmEntities.map(e => e._id);
      const migratedUserIds = rmEntities.map(e => e.migratedFromUserId).filter(Boolean);

      // Get legacy user-based clients
      const assignedClients = await UsersCollection.find({ relationshipManagerId: currentUser._id }).fetchAsync();
      const clientIds = [...new Set([...assignedClients.map(c => c._id), ...migratedUserIds, currentUser._id])];

      // Also find portfolio codes from entity bank accounts (for legacy operations without entityId)
      const entityAccounts = await BankAccountsCollection.find({
        entityId: { $in: entityIds },
        isActive: true
      }, { fields: { accountNumber: 1 } }).fetchAsync();
      const portfolioRegexes = entityAccounts
        .map(a => a.accountNumber?.split('-')[0])
        .filter(Boolean)
        .map(base => ({ portfolioCode: { $regex: `^${base}` } }));

      const orConditions = [];
      if (entityIds.length > 0) orConditions.push({ entityId: { $in: entityIds } });
      if (clientIds.length > 0) orConditions.push({ userId: { $in: clientIds } });
      if (portfolioRegexes.length > 0) orConditions.push(...portfolioRegexes);
      queryFilter.$or = orConditions.length > 0 ? orConditions : [{ userId: currentUser._id }];
    }
    // Clients - only their own operations
    else if (isClient) {
      const entity = await ClientEntitiesCollection.findOneAsync({ migratedFromUserId: currentUser._id, isActive: true });
      if (entity) {
        queryFilter.$or = [{ entityId: entity._id }, { userId: currentUser._id }];
      } else {
        queryFilter.userId = currentUser._id;
      }
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
