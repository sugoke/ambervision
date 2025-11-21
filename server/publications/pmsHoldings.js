// PMS Holdings Publications
// Handles all PMS holdings related publications

import { check, Match } from 'meteor/check';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';
import { Meteor } from 'meteor/meteor';

Meteor.publish('pmsHoldings', async function (sessionId = null, viewAsFilter = null, latestOnly = true, asOfDate = null) {
  check(sessionId, Match.Maybe(String));
  check(viewAsFilter, Match.Maybe(Match.ObjectIncluding({
    type: String,
    id: String
  })));
  check(latestOnly, Match.Maybe(Boolean));
  check(asOfDate, Match.Maybe(Date));

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
          queryFilter.portfolioCode = bankAccount.accountNumber;
          queryFilter.bankId = bankAccount.bankId;
        } else {
          // Account not found - return empty result
          return this.ready();
        }
      }
    }
    // Admins without filter - see all holdings
    else if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
      // No additional filter - see all active holdings
    }
    // Relationship Managers
    else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      // Get all clients assigned to this RM
      const assignedClients = await UsersCollection.find({
        relationshipManagerId: currentUser._id
      }).fetchAsync();
      const clientIds = assignedClients.map(c => c._id);
      clientIds.push(currentUser._id); // Include RM's own holdings

      queryFilter.userId = { $in: clientIds };
    }
    // Clients - only their own holdings
    else if (currentUser.role === USER_ROLES.CLIENT) {
      queryFilter.userId = currentUser._id;
    }

    // Handle asOfDate - view holdings as of a specific date
    if (asOfDate) {
      console.log(`[PMS_HOLDINGS] Querying holdings as of ${asOfDate.toISOString()}`);

      // Get all holdings up to this date
      queryFilter.snapshotDate = { $lte: asOfDate };

      const allHoldings = await PMSHoldingsCollection.find(queryFilter, {
        sort: { snapshotDate: -1, version: -1 }
      }).fetchAsync();

      // Group by uniqueKey and get latest version for each position
      const latestByKey = new Map();
      for (const holding of allHoldings) {
        if (!latestByKey.has(holding.uniqueKey)) {
          latestByKey.set(holding.uniqueKey, holding);
        }
      }

      const holdingIds = Array.from(latestByKey.values()).map(h => h._id);

      return PMSHoldingsCollection.find({
        _id: { $in: holdingIds }
      }, {
        sort: { securityName: 1 }
      });
    }

    // Show all historical versions (not filtered by date)
    if (!latestOnly) {
      return PMSHoldingsCollection.find(queryFilter, {
        sort: { snapshotDate: -1, version: -1, securityName: 1 }
      });
    }

    // Default: show only current latest versions
    queryFilter.isLatest = true;
    return PMSHoldingsCollection.find(queryFilter, {
      sort: { securityName: 1 }
    });

  } catch (error) {
    console.error('PMS holdings publication error:', error);
    return this.ready();
  }
});

/**
 * Publication for available snapshot dates
 * Returns distinct snapshot dates for date selector dropdown
 */
Meteor.publish('pmsHoldings.snapshotDates', async function (sessionId = null, viewAsFilter = null) {
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
      }
    } else if (this.userId) {
      currentUser = await UsersCollection.findOneAsync(this.userId);
    }

    if (!currentUser) {
      return this.ready();
    }

    // Build query filter based on role and viewAsFilter (same logic as main publication)
    let queryFilter = { isActive: true };

    if (viewAsFilter && (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN)) {
      if (viewAsFilter.type === 'client') {
        queryFilter.userId = viewAsFilter.id;
      } else if (viewAsFilter.type === 'account') {
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          queryFilter.userId = bankAccount.userId;
          queryFilter.portfolioCode = bankAccount.accountNumber;
          queryFilter.bankId = bankAccount.bankId;
        } else {
          return this.ready();
        }
      }
    } else if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
      // No filter
    } else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      const assignedClients = await UsersCollection.find({
        relationshipManagerId: currentUser._id
      }).fetchAsync();
      const clientIds = assignedClients.map(c => c._id);
      clientIds.push(currentUser._id);
      queryFilter.userId = { $in: clientIds };
    } else if (currentUser.role === USER_ROLES.CLIENT) {
      queryFilter.userId = currentUser._id;
    }

    // Get distinct snapshot dates using aggregation
    const pipeline = [
      { $match: queryFilter },
      {
        $group: {
          _id: '$snapshotDate',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 100 } // Last 100 snapshot dates
    ];

    const dates = await PMSHoldingsCollection.rawCollection()
      .aggregate(pipeline).toArray();

    // Publish as a synthetic collection
    dates.forEach((dateDoc, index) => {
      this.added('pmsHoldingsSnapshotDates', index.toString(), {
        date: dateDoc._id,
        holdingsCount: dateDoc.count
      });
    });

    this.ready();

  } catch (error) {
    console.error('PMS holdings snapshot dates publication error:', error);
    return this.ready();
  }
});
