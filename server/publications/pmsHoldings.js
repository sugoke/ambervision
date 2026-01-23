// PMS Holdings Publications
// Handles all PMS holdings related publications

import { check, Match } from 'meteor/check';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';
import { Meteor } from 'meteor/meteor';

// Debug method to test full publication logic
Meteor.methods({
  'pmsHoldings.debugFullPublicationLogic': async function(asOfDateStr) {
    const asOfDate = new Date(asOfDateStr);

    // Step 0: Test basic collection access
    const basicCount = await PMSHoldingsCollection.find({}).countAsync();
    const activeCount = await PMSHoldingsCollection.find({ isActive: true }).countAsync();

    // Test date comparison
    const withDateCount = await PMSHoldingsCollection.find({
      isActive: true,
      snapshotDate: { $lte: asOfDate }
    }).countAsync();

    // Test raw collection
    const rawCount = await PMSHoldingsCollection.rawCollection().countDocuments({
      isActive: true,
      snapshotDate: { $lte: asOfDate }
    });

    const queryFilter = { isActive: true, snapshotDate: { $lte: asOfDate } };

    // Step 1: Count total holdings
    const totalCount = await PMSHoldingsCollection.find(queryFilter).countAsync();

    // Step 2: Fetch all holdings with sorting
    const allHoldings = await PMSHoldingsCollection.find(queryFilter, {
      sort: { snapshotDate: -1, version: -1 }
    }).fetchAsync();

    // Step 3: Group by uniqueKey
    const latestByKey = new Map();
    for (const holding of allHoldings) {
      if (!latestByKey.has(holding.uniqueKey)) {
        latestByKey.set(holding.uniqueKey, holding);
      }
    }

    // Step 4: Get IDs
    const holdingIds = Array.from(latestByKey.values()).map(h => h._id);

    // Step 5: Final query
    const finalCount = await PMSHoldingsCollection.find({
      _id: { $in: holdingIds }
    }).countAsync();

    // Get sample of final results
    const finalSample = await PMSHoldingsCollection.find({
      _id: { $in: holdingIds }
    }, { limit: 3 }).fetchAsync();

    return {
      // Diagnostic step 0 - collection access tests
      step0_basicCount: basicCount,
      step0_activeCount: activeCount,
      step0_withDateCount: withDateCount,
      step0_rawCount: rawCount,
      // Original steps
      step1_queryFilter: JSON.stringify(queryFilter),
      step2_totalFetched: allHoldings.length,
      step3_uniqueKeys: latestByKey.size,
      step4_holdingIds: holdingIds.length,
      step5_finalCount: finalCount,
      sampleNames: finalSample.map(h => h.securityName),
      sampleDates: finalSample.map(h => h.snapshotDate?.toISOString())
    };
  }
});

Meteor.publish('pmsHoldings', async function (sessionId = null, viewAsFilter = null, latestOnly = true, asOfDate = null) {
  // Log IMMEDIATELY to ensure we see publication being called
  console.log('[PMS_HOLDINGS] *** PUBLICATION ENTRY ***', new Date().toISOString());

  try {
    console.log('[PMS_HOLDINGS] Raw params:', {
      sessionId: sessionId ? 'present' : 'null',
      viewAsFilter: viewAsFilter ? JSON.stringify(viewAsFilter) : 'null',
      latestOnly,
      asOfDate: String(asOfDate),
      asOfDateType: typeof asOfDate,
      asOfDateIsDate: asOfDate instanceof Date
    });

    check(sessionId, Match.Maybe(String));
    check(viewAsFilter, Match.Maybe(Match.ObjectIncluding({
      type: String,
      id: String
    })));
    check(latestOnly, Match.Maybe(Boolean));
    // Accept Date, String, or null for asOfDate - convert strings to Date
    check(asOfDate, Match.Maybe(Match.OneOf(Date, String)));
    console.log('[PMS_HOLDINGS] All checks passed');
  } catch (checkError) {
    console.error('[PMS_HOLDINGS] Check failed:', checkError.message);
    throw checkError;
  }

  // Convert string to Date if needed
  let parsedAsOfDate = null;
  if (asOfDate) {
    parsedAsOfDate = asOfDate instanceof Date ? asOfDate : new Date(asOfDate);
    console.log('[PMS_HOLDINGS] asOfDate converted:', {
      original: asOfDate,
      type: typeof asOfDate,
      parsed: parsedAsOfDate?.toISOString?.(),
      isValidDate: parsedAsOfDate instanceof Date && !isNaN(parsedAsOfDate)
    });
  } else {
    console.log('[PMS_HOLDINGS] No asOfDate provided, will use latestOnly logic');
  }

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
          const baseAccountNumber = bankAccount.accountNumber.split('-')[0];
          queryFilter.portfolioCode = { $regex: `^${baseAccountNumber}(-|$)` };
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

    console.log('[PMS_HOLDINGS] After role check - queryFilter:', JSON.stringify(queryFilter));
    console.log('[PMS_HOLDINGS] parsedAsOfDate value:', parsedAsOfDate?.toISOString?.() || 'null');

    // Handle asOfDate - view holdings as of a specific date
    if (parsedAsOfDate) {
      console.log(`[PMS_HOLDINGS] ENTERING HISTORICAL PATH for date: ${parsedAsOfDate.toISOString()}`);

      // Get all holdings up to this date
      queryFilter.snapshotDate = { $lte: parsedAsOfDate };

      console.log('[PMS_HOLDINGS] Historical query filter:', JSON.stringify(queryFilter));

      // Use aggregation with allowDiskUse to handle large datasets
      // This avoids MongoDB's 32MB sort memory limit by allowing disk-based sorting
      const pipeline = [
        { $match: queryFilter },
        { $sort: { snapshotDate: -1, version: -1 } },
        {
          $group: {
            _id: '$uniqueKey',
            holdingId: { $first: '$_id' },
            snapshotDate: { $first: '$snapshotDate' }
          }
        }
      ];

      const latestByKey = await PMSHoldingsCollection.rawCollection()
        .aggregate(pipeline, { allowDiskUse: true })
        .toArray();

      const holdingIds = latestByKey.map(doc => doc.holdingId);
      console.log(`[PMS_HOLDINGS] Returning ${holdingIds.length} unique positions for historical view`);

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

    // Diagnostic logging
    const queryWithoutLatest = Object.fromEntries(Object.entries(queryFilter).filter(([key]) => key !== 'isLatest'));
    const totalWithoutLatestFilter = await PMSHoldingsCollection.find(queryWithoutLatest).countAsync();
    const totalWithLatestFilter = await PMSHoldingsCollection.find(queryFilter).countAsync();

    console.log('[PMS_HOLDINGS] Publication diagnostic:', {
      userId: currentUser._id,
      role: currentUser.role,
      queryFilter: JSON.stringify(queryFilter),
      totalWithoutLatestFilter,
      totalWithLatestFilter,
      filteredOut: totalWithoutLatestFilter - totalWithLatestFilter
    });

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
