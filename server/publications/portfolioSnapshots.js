import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { ClientEntitiesCollection } from '../../imports/api/clientEntities.js';

/**
 * Publish portfolio snapshots for authorized users
 */
Meteor.publish('portfolioSnapshots', async function(sessionId, filters = {}, viewAsFilter = null) {
  check(sessionId, String);
  check(filters, Match.Optional(Object));
  check(viewAsFilter, Match.Optional(Match.ObjectIncluding({
    type: String,
    id: String
  })));

  // Validate session
  if (!sessionId) {
    console.log('[portfolioSnapshots] No session ID provided');
    return this.ready();
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    console.log('[portfolioSnapshots] Invalid session');
    return this.ready();
  }

  const currentUser = await UsersCollection.findOneAsync(session.userId);

  if (!currentUser) {
    console.log('[portfolioSnapshots] User not found');
    return this.ready();
  }

  console.log(`[portfolioSnapshots] Publishing snapshots for user: ${currentUser.username}, viewAs: ${viewAsFilter ? viewAsFilter.type : 'none'}`);

  // Build query based on role and viewAsFilter
  let query = {};

  const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
  const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT;

  // Admins/RMs with viewAsFilter
  if (viewAsFilter && (isAdmin || isRM)) {
    if (viewAsFilter.type === 'entity') {
      // Entity-based filter — find accounts owned by or beneficially owned by this entity
      const entity = await ClientEntitiesCollection.findOneAsync(viewAsFilter.id);
      if (!entity) return this.ready();
      if (isRM && entity.relationshipManagerId !== currentUser._id) return this.ready();
      const entityAccounts = await BankAccountsCollection.find({
        $or: [{ entityId: entity._id }, { beneficialOwnerIds: entity._id }, { beneficialOwnerId: entity._id }],
        isActive: true
      }).fetchAsync();
      const orConditions = [{ entityId: entity._id }];
      if (entity.migratedFromUserId) {
        orConditions.push({ userId: entity.migratedFromUserId });
      }
      for (const acct of entityAccounts) {
        const baseNum = acct.accountNumber.split('-')[0];
        orConditions.push({ portfolioCode: baseNum, bankId: acct.bankId });
      }
      query.$or = orConditions;
    } else if (viewAsFilter.type === 'client') {
      // Legacy client userId filter
      query.userId = viewAsFilter.id;
    } else if (viewAsFilter.type === 'account') {
      // Filter by specific bank account
      const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      if (!bankAccount) return this.ready();
      if (bankAccount.entityId) {
        query.$or = [
          { entityId: bankAccount.entityId },
          ...(bankAccount.userId ? [{ userId: bankAccount.userId }] : [])
        ];
      } else if (bankAccount.userId) {
        query.userId = bankAccount.userId;
      }
      query.portfolioCode = bankAccount.accountNumber;
      query.bankId = bankAccount.bankId;
    }
  }
  // Admins without filter - see all snapshots
  else if (isAdmin) {
    // No additional filter
  }
  // Relationship Managers / Assistants without filter
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
    const clientIds = [...new Set([...assignedClients.map(c => c._id), ...migratedUserIds])];

    if (entityIds.length > 0 || clientIds.length > 0) {
      const orConditions = [];
      if (entityIds.length > 0) orConditions.push({ entityId: { $in: entityIds } });
      if (clientIds.length > 0) orConditions.push({ userId: { $in: clientIds } });
      query.$or = orConditions;
    } else {
      return this.ready();
    }
  }
  // Regular clients - see only their own snapshots
  else {
    // Check entity access
    const entity = await ClientEntitiesCollection.findOneAsync({ migratedFromUserId: currentUser._id, isActive: true });
    if (entity) {
      query.$or = [{ entityId: entity._id }, { userId: currentUser._id }];
    } else {
      query.userId = currentUser._id;
    }
  }

  // Apply filters
  if (filters.portfolioCode) {
    query.portfolioCode = filters.portfolioCode;
  }

  if (filters.bankId) {
    query.bankId = filters.bankId;
  }

  if (filters.startDate || filters.endDate) {
    query.snapshotDate = {};
    if (filters.startDate) query.snapshotDate.$gte = new Date(filters.startDate);
    if (filters.endDate) query.snapshotDate.$lte = new Date(filters.endDate);
  }

  // Return cursor sorted by snapshot date
  return PortfolioSnapshotsCollection.find(query, {
    sort: { snapshotDate: -1 },
    limit: filters.limit || 365  // Default to last year of data
  });
});
