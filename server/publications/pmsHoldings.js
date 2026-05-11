// PMS Holdings Publications
// Handles all PMS holdings related publications

import { check, Match } from 'meteor/check';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { SessionsCollection } from '/imports/api/sessions';
import { resolveEntityId } from '/imports/utils/entityResolver';
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

    const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.COMPLIANCE;
    const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT;
    const isClient = currentUser.role === USER_ROLES.CLIENT;

    // Handle viewAsFilter for admins and RMs/Assistants
    if (viewAsFilter && (isAdmin || isRM)) {
      if (viewAsFilter.type === 'entity') {
        // Entity-based filter: show holdings for a specific client entity
        const entity = await ClientEntitiesCollection.findOneAsync(viewAsFilter.id);
        if (!entity) {
          console.log('[PMS_HOLDINGS] Entity not found:', viewAsFilter.id);
          return this.ready();
        }
        // For RMs, verify they manage this entity
        if (isRM) {
          const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
          if (!rmIds.includes(entity.relationshipManagerId)) {
            console.log('[PMS_HOLDINGS] RM does not manage entity:', viewAsFilter.id);
            return this.ready();
          }
        }
        // Find bank accounts owned by this entity OR where entity is a beneficial owner
        const entityAccounts = await BankAccountsCollection.find({
          $or: [
            { entityId: entity._id },
            { beneficialOwnerIds: entity._id },
            { beneficialOwnerId: entity._id }
          ],
          isActive: true
        }).fetchAsync();
        const accountNumbers = entityAccounts.map(a => a.accountNumber).filter(Boolean);

        // Filter by entityId, or by (bankId + portfolioCode) for each of the entity's accounts.
        // The per-account (bankId + portfolioCode) match catches holdings that haven't been
        // migrated to entityId yet, while staying scoped to accounts this entity actually owns.
        const orConditions = [
          { entityId: entity._id }
        ];
        if (entity.migratedFromUserId) {
          orConditions.push({ userId: entity.migratedFromUserId, entityId: { $exists: false } });
        }
        for (const acct of entityAccounts) {
          if (!acct.accountNumber || !acct.bankId) continue;
          const baseNum = acct.accountNumber.split('-')[0];
          // Pre-resolve actual portfolioCodes to avoid $regex inside $or (breaks oplog tailing)
          const codesForAccount = await PMSHoldingsCollection.rawCollection().distinct('portfolioCode', {
            portfolioCode: { $regex: `^${baseNum}` },
            bankId: acct.bankId
          });
          if (codesForAccount.length > 0) {
            orConditions.push({ bankId: acct.bankId, portfolioCode: { $in: codesForAccount } });
          }
        }
        queryFilter.$or = orConditions;
        console.log(`[PMS_HOLDINGS] Entity filter: ${entity._id}, accounts: ${JSON.stringify(accountNumbers)}, conditions: ${JSON.stringify(orConditions)}`);
      } else if (viewAsFilter.type === 'client') {
        // For RMs/Assistants, verify they have access to this client
        if (isRM) {
          const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
          const targetClient = await UsersCollection.findOneAsync({
            _id: viewAsFilter.id,
            relationshipManagerId: { $in: rmIds }
          });
          if (!targetClient) {
            console.log('[PMS_HOLDINGS] RM/Assistant does not have access to client:', viewAsFilter.id);
            return this.ready();
          }
        }
        // Filter by client userId (all accounts aggregated)
        queryFilter.userId = viewAsFilter.id;
      } else if (viewAsFilter.type === 'account') {
        // Filter by specific bank account
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          // For RMs/Assistants, verify they have access via entity or user
          if (isRM) {
            const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
            let hasAccess = false;
            // Check entity-based access
            if (bankAccount.entityId) {
              const entity = await ClientEntitiesCollection.findOneAsync(bankAccount.entityId);
              if (entity && rmIds.includes(entity.relationshipManagerId)) {
                hasAccess = true;
              }
            }
            // Fallback: check user-based access
            if (!hasAccess && bankAccount.userId) {
              const targetClient = await UsersCollection.findOneAsync({
                _id: bankAccount.userId,
                relationshipManagerId: { $in: rmIds }
              });
              if (targetClient) hasAccess = true;
            }
            if (!hasAccess) {
              console.log('[PMS_HOLDINGS] RM/Assistant does not have access to account owner:', bankAccount.entityId || bankAccount.userId);
              return this.ready();
            }
          }
          // Filter holdings by bankId + portfolioCode — this pair uniquely identifies the
          // account's holdings. Additional entity/user scoping would exclude un-migrated
          // records (e.g. CFM imports that only carry bankId + portfolioCode, or holdings
          // whose userId belongs to a legacy orphan record for the same account number).
          const baseAccountNumber = bankAccount.accountNumber.split('-')[0];
          queryFilter.portfolioCode = { $regex: `^${baseAccountNumber}(-|$)` };
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
        // Security: Verify the client owns this account (via entity access or direct userId)
        let ownsAccount = false;
        if (bankAccount) {
          if (bankAccount.userId === currentUser._id) {
            ownsAccount = true;
          } else if (bankAccount.entityId) {
            const { UserEntityAccessHelpers } = await import('../../imports/api/userEntityAccess.js');
            ownsAccount = await UserEntityAccessHelpers.hasAccess(currentUser._id, bankAccount.entityId);
          }
        }
        if (ownsAccount) {
          // Ownership has been verified above — bankId + portfolioCode alone is a safe scope
          // and avoids excluding un-migrated holdings (CFM imports, legacy orphan records).
          const baseAccountNumber = bankAccount.accountNumber.split('-')[0];
          queryFilter.portfolioCode = { $regex: `^${baseAccountNumber}(-|$)` };
          queryFilter.bankId = bankAccount.bankId;
          console.log('[PMS_HOLDINGS] Client filtering to own account:', bankAccount.accountNumber);
        } else {
          // If account not found or not owned by client, fall through to default client filter
          console.log('[PMS_HOLDINGS] Client viewAsFilter rejected - account not owned:', viewAsFilter.id);
          queryFilter.userId = currentUser._id;
        }
      } else {
        // For any other filter type from clients, default to their own holdings
        queryFilter.userId = currentUser._id;
      }
    }
    // Admins without filter - see all holdings
    else if (isAdmin) {
      // No additional filter - see all active holdings
    }
    // Relationship Managers without filter - see all assigned clients' holdings
    else if (isRM) {
      // Get entities assigned to this RM
      const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
      const assignedEntities = await ClientEntitiesCollection.find({
        relationshipManagerId: { $in: rmIds },
        isActive: true
      }).fetchAsync();
      const entityIds = assignedEntities.map(e => e._id);

      // Also include entities from accounts where RM is backup
      const backupAccounts = await BankAccountsCollection.find(
        { backupRmIds: { $in: rmIds }, isActive: true, entityId: { $exists: true } },
        { fields: { entityId: 1 } }
      ).fetchAsync();
      const backupEntityIds = backupAccounts.map(a => a.entityId).filter(Boolean);
      const allEntityIds = [...new Set([...entityIds, ...backupEntityIds])];

      // Also get legacy user-based clients
      const assignedClients = await UsersCollection.find({
        relationshipManagerId: { $in: rmIds }
      }).fetchAsync();
      const clientIds = assignedClients.map(c => c._id);
      clientIds.push(currentUser._id); // Include RM's own holdings

      // Match by entityId OR userId
      queryFilter.$or = [
        ...(allEntityIds.length > 0 ? [{ entityId: { $in: allEntityIds } }] : []),
        { userId: { $in: clientIds } }
      ];
    }
    // Clients - their own holdings via entity access or direct userId
    else if (isClient) {
      // Check entity access for this user
      const { UserEntityAccessHelpers } = await import('../../imports/api/userEntityAccess.js');
      const accessRecords = await UserEntityAccessHelpers.getUserEntities(currentUser._id);
      const entityIds = accessRecords.map(a => a.entityId);

      if (entityIds.length > 0) {
        queryFilter.$or = [
          { entityId: { $in: entityIds } },
          { userId: currentUser._id }
        ];
      } else {
        queryFilter.userId = currentUser._id;
      }
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
    const totalWithLatestFilter = await PMSHoldingsCollection.find(queryFilter).countAsync();
    console.log('[PMS_HOLDINGS] Publication diagnostic:', {
      queryFilter: JSON.stringify(queryFilter),
      totalWithLatestFilter
    });

    // Pre-fetch IDs then return simple cursor (avoids oplog issues with $or)
    if (queryFilter.$or) {
      const ids = (await PMSHoldingsCollection.find(queryFilter, { fields: { _id: 1 } }).fetchAsync()).map(d => d._id);
      console.log(`[PMS_HOLDINGS] $or resolved to ${ids.length} IDs for entity`);
      const simpleCursor = PMSHoldingsCollection.find({ _id: { $in: ids } }, { sort: { securityName: 1 } });
      // Use observeChanges pattern for async publication compatibility
      const pub = this;
      const handle = simpleCursor.observeChanges({
        added(id, fields) { pub.added('pmsHoldings', id, fields); },
        changed(id, fields) { pub.changed('pmsHoldings', id, fields); },
        removed(id) { pub.removed('pmsHoldings', id); }
      });
      this.ready();
      this.onStop(() => handle.stop());
      return;
    }

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

    const isSnapshotAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.COMPLIANCE;

    if (viewAsFilter && isSnapshotAdmin) {
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
    } else if (isSnapshotAdmin) {
      // No filter
    } else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT) {
      const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
      const assignedClients = await UsersCollection.find({
        relationshipManagerId: { $in: rmIds }
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

/**
 * Publication for holdings linked to a specific product by ISIN
 * Matches by isin field (primary) or linkedProductId (manual link, fallback)
 * Used by TemplateProductReport to show client positions from bank files
 */
Meteor.publish('pmsHoldings.byProduct', async function(isin, sessionId = null) {
  check(isin, Match.Maybe(String));
  check(sessionId, Match.Maybe(String));

  if (!isin) return this.ready();

  try {
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

    if (!currentUser) return this.ready();

    const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
    const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT;

    if (!isAdmin && !isRM) return this.ready();

    return PMSHoldingsCollection.find({
      isin,
      isLatest: true,
      isActive: true
    });
  } catch (error) {
    console.error('[pmsHoldings.byProduct] Error:', error);
    return this.ready();
  }
});
