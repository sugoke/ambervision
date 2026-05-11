// Equity Holdings Publications
// Handles all equity holdings related publications

import { check, Match } from 'meteor/check';
import { EquityHoldingsCollection } from '/imports/api/equityHoldings';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { SessionsCollection } from '/imports/api/sessions';
import { Meteor } from 'meteor/meteor';

Meteor.publish('equityHoldings', async function (sessionId = null, viewAsFilter = null) {
  check(sessionId, Match.Maybe(String));
  check(viewAsFilter, Match.Maybe(Match.ObjectIncluding({
    type: String,
    id: String
  })));

  console.log(`[EQUITY PUB] Request - sessionId: ${sessionId}, viewAsFilter:`, viewAsFilter);

  if (!this.userId && !sessionId) {
    console.log('[EQUITY PUB] No authentication provided - returning empty');
    return this.ready();
  }

  try {
    // Get current user with session-based authentication
    let currentUser = null;

    if (sessionId) {
      // Query SessionsCollection with async method
      const session = await SessionsCollection.findOneAsync({
        sessionId,
        isActive: true,
        expiresAt: { $gt: new Date() }
      });

      console.log('[EQUITY PUB] Session found:', !!session, session ? `userId: ${session.userId}` : 'null');

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

    console.log('[EQUITY PUB] Current user:', currentUser?._id, 'Role:', currentUser?.role);

    if (!currentUser) {
      console.log('[EQUITY PUB] No valid user found - returning empty');
      return this.ready();
    }

    // Build query filter based on role and viewAsFilter
    let queryFilter = {};

    // Admins and superadmins with viewAsFilter
    if (viewAsFilter && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN)) {
      if (viewAsFilter.type === 'entity') {
        // Entity-based filter: find bank accounts owned by this entity
        const entityAccounts = await BankAccountsCollection.find({
          $or: [
            { entityId: viewAsFilter.id },
            // Fallback for unmigrated accounts
            ...(() => {
              const entity = Promise.await(ClientEntitiesCollection.findOneAsync(viewAsFilter.id));
              return entity?.migratedFromUserId ? [{ userId: entity.migratedFromUserId }] : [];
            })()
          ],
          isActive: true
        }).fetchAsync();
        const accountIds = entityAccounts.map(acc => acc._id);
        if (accountIds.length === 0) return this.ready();
        queryFilter = { bankAccountId: { $in: accountIds } };
      } else if (viewAsFilter.type === 'client') {
        // Get all bank accounts for the selected client
        const clientAccounts = await BankAccountsCollection.find({
          userId: viewAsFilter.id,
          isActive: true
        }).fetchAsync();
        const accountIds = clientAccounts.map(acc => acc._id);

        if (accountIds.length === 0) {
          console.log('[EQUITY PUB] No bank accounts found for client');
          return this.ready();
        }

        queryFilter = { bankAccountId: { $in: accountIds } };
        console.log(`[EQUITY PUB] Admin viewing client ${viewAsFilter.id} - ${accountIds.length} accounts`);
      } else if (viewAsFilter.type === 'account') {
        // Get holdings for specific bank account
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (!bankAccount) {
          console.log('[EQUITY PUB] Bank account not found');
          return this.ready();
        }

        queryFilter = { bankAccountId: viewAsFilter.id };
        console.log(`[EQUITY PUB] Admin viewing specific account ${viewAsFilter.id}`);
      }
    }
    // Admins without filter - see all holdings
    else if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
      queryFilter = {};
      console.log('[EQUITY PUB] Admin viewing all holdings');
    }
    // Relationship Managers
    else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT) {
      // Get accounts for entity-based clients
      const rmEntities = await ClientEntitiesCollection.find(
        { relationshipManagerId: currentUser._id, isActive: true },
        { fields: { _id: 1, migratedFromUserId: 1 } }
      ).fetchAsync();
      const entityIds = rmEntities.map(e => e._id);
      const migratedUserIds = rmEntities.map(e => e.migratedFromUserId).filter(Boolean);

      // Get accounts for legacy user-based clients
      const assignedClients = await UsersCollection.find({ relationshipManagerId: currentUser._id }).fetchAsync();
      const clientIds = [...new Set([...assignedClients.map(c => c._id), ...migratedUserIds, currentUser._id])];

      const accessibleAccounts = await BankAccountsCollection.find({
        $or: [
          { entityId: { $in: entityIds } },
          { userId: { $in: clientIds } }
        ],
        isActive: true
      }).fetchAsync();
      const accountIds = accessibleAccounts.map(acc => acc._id);

      queryFilter = { bankAccountId: { $in: accountIds } };
      console.log(`[EQUITY PUB] RM viewing ${accountIds.length} accessible accounts`);
    }
    // Clients - only their own holdings
    else if (currentUser.role === USER_ROLES.CLIENT) {
      const entity = await ClientEntitiesCollection.findOneAsync({ migratedFromUserId: currentUser._id, isActive: true });
      const accountQuery = entity
        ? { $or: [{ entityId: entity._id }, { userId: currentUser._id }], isActive: true }
        : { userId: currentUser._id, isActive: true };
      const userAccounts = await BankAccountsCollection.find(accountQuery).fetchAsync();
      const accountIds = userAccounts.map(acc => acc._id);

      queryFilter = { bankAccountId: { $in: accountIds } };
      console.log(`[EQUITY PUB] Client viewing ${accountIds.length} own accounts`);
    }

    const holdingsCount = await EquityHoldingsCollection.find(queryFilter).countAsync();
    console.log(`[EQUITY PUB] Returning ${holdingsCount} holdings with filter:`, queryFilter);
    return EquityHoldingsCollection.find(queryFilter);

  } catch (error) {
    console.error('Equity holdings publication error:', error);
    return this.ready();
  }
});






