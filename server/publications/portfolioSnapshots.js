import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';

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

  // Admins and superadmins with viewAsFilter
  if (viewAsFilter && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN)) {
    if (viewAsFilter.type === 'client') {
      // Filter by client userId (all portfolios aggregated)
      query.userId = viewAsFilter.id;
    } else if (viewAsFilter.type === 'account') {
      // Filter by specific bank account
      const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      if (bankAccount) {
        query.userId = bankAccount.userId;
        query.portfolioCode = bankAccount.accountNumber;
        query.bankId = bankAccount.bankId;
      } else {
        // Account not found - return empty result
        console.log('[portfolioSnapshots] Account not found:', viewAsFilter.id);
        return this.ready();
      }
    }
  }
  // Admins without filter - see all snapshots
  else if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
    // No additional filter - see all snapshots (could be filtered by filters parameter)
  }
  // Relationship Managers
  else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
    // Get all clients assigned to this RM
    const assignedClients = await UsersCollection.find({
      relationshipManagerId: currentUser._id
    }).fetchAsync();

    const clientIds = assignedClients.map(c => c._id);

    if (clientIds.length > 0) {
      query.userId = { $in: clientIds };
    } else {
      // No assigned clients - return empty
      return this.ready();
    }
  }
  // Regular clients - see only their own snapshots
  else {
    query.userId = currentUser._id;
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
