// Schedule Publications
// Provides aggregated observation schedule data from all live products
// Last updated: 2025-10-10

console.log('🗓️ Loading schedule.js publication file...');

import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';

// Publication that aggregates all observations from live products
Meteor.publish("schedule.observations", async function (sessionId = null, viewAsFilter = null) {
  console.log('[SCHEDULE] Publication called with sessionId:', sessionId, 'viewAsFilter:', viewAsFilter);

  const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
  let currentUser = null;

  // Try to get user from session
  if (effectiveSessionId) {
    try {
      const session = await SessionHelpers.validateSession(effectiveSessionId);
      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);
        console.log('[SCHEDULE] User found:', currentUser.email, 'Role:', currentUser.role);
      }
    } catch (error) {
      console.log('[SCHEDULE] Session validation error:', error.message);
    }
  }

  // If no authenticated user, return empty (security)
  if (!currentUser) {
    console.log('[SCHEDULE] No authenticated user, returning empty');
    return this.ready();
  }

  // Determine which products the user has access to based on role
  let productQuery = {};
  // Allocations that define the *scope* of the current view — used to sum
  // nominal invested per product so the Nominal column reflects what the
  // filtered client/entity/account actually holds. Stays null for admin
  // views without a viewAs filter (no single-client context to aggregate).
  let scopedAllocations = null;

  const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
  const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT;

  // Handle View As filter for admins and RMs
  if (viewAsFilter && (isAdmin || isRM)) {
    console.log(`[SCHEDULE] ${currentUser.email} viewing as:`, viewAsFilter);

    if (viewAsFilter.type === 'entity') {
      // Entity-based filter: find products allocated to this entity
      const { BankAccountsCollection } = await import('/imports/api/bankAccounts');
      const { ClientEntitiesCollection } = await import('/imports/api/clientEntities');

      const entity = await ClientEntitiesCollection.findOneAsync(viewAsFilter.id);
      if (!entity) {
        console.log('[SCHEDULE] Entity not found:', viewAsFilter.id);
        return this.ready();
      }

      // For RMs, verify they manage this entity
      if (isRM) {
        const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
        if (!rmIds.includes(entity.relationshipManagerId) &&
            !(entity.assignedUserIds || []).some(id => rmIds.includes(id))) {
          console.log('[SCHEDULE] RM does not manage entity:', viewAsFilter.id);
          return this.ready();
        }
      }

      // Find bank accounts for this entity
      const entityAccounts = await BankAccountsCollection.find({
        $or: [
          { entityId: entity._id },
          { beneficialOwnerIds: entity._id },
          { beneficialOwnerId: entity._id }
        ],
        isActive: true
      }).fetchAsync();

      const bankAccountIds = entityAccounts.map(a => a._id);
      const userIdsFromAccounts = [...new Set(entityAccounts.map(a => a.userId).filter(Boolean))];

      // Also find ALL bank account records sharing the same account numbers
      // (legacy accounts for the same physical account may have different _ids)
      const accountNumbers = [...new Set(entityAccounts.map(a => a.accountNumber).filter(Boolean))];
      let allBankAccountIds = [...bankAccountIds];
      if (accountNumbers.length > 0) {
        const allAccountRecords = await BankAccountsCollection.find({
          accountNumber: { $in: accountNumbers }
        }).fetchAsync();
        allBankAccountIds = [...new Set([...bankAccountIds, ...allAccountRecords.map(a => a._id)])];
        // Also collect userIds from all matching account records
        allAccountRecords.forEach(a => {
          if (a.userId) userIdsFromAccounts.push(a.userId);
        });
      }
      const uniqueUserIds = [...new Set(userIdsFromAccounts)];

      // Build OR conditions to find allocations for this entity
      const orConditions = [];
      if (entity.migratedFromUserId) {
        orConditions.push({ clientId: entity.migratedFromUserId });
      }
      if (allBankAccountIds.length > 0) {
        orConditions.push({ bankAccountId: { $in: allBankAccountIds } });
      }
      if (uniqueUserIds.length > 0) {
        orConditions.push({ clientId: { $in: uniqueUserIds } });
      }

      if (orConditions.length === 0) {
        console.log('[SCHEDULE] No allocation paths found for entity:', viewAsFilter.id);
        return this.ready();
      }

      const allocations = await AllocationsCollection.find({
        $or: orConditions
      }).fetchAsync();

      const productIds = [...new Set(allocations.map(alloc => alloc.productId))];
      console.log(`[SCHEDULE] Entity filter: ${productIds.length} products for entity ${viewAsFilter.id}`);

      if (productIds.length === 0) {
        return this.ready();
      }

      productQuery = { _id: { $in: productIds } };
      scopedAllocations = allocations;

    } else {
      // Client or account filter
      let targetClientId = null;

      if (viewAsFilter.type === 'client') {
        targetClientId = viewAsFilter.id;
      } else if (viewAsFilter.type === 'account') {
        const { BankAccountsCollection } = await import('/imports/api/bankAccounts');
        const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (bankAccount) {
          targetClientId = bankAccount.userId;
        }
      }

      if (targetClientId) {
        // For RMs, verify access to this client
        if (isRM) {
          const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
          const targetClient = await UsersCollection.findOneAsync({
            _id: targetClientId,
            relationshipManagerId: { $in: rmIds }
          });
          if (!targetClient) {
            console.log('[SCHEDULE] RM does not have access to client:', targetClientId);
            return this.ready();
          }
        }

        const allocations = await AllocationsCollection.find({
          clientId: targetClientId
        }).fetchAsync();

        const productIds = [...new Set(allocations.map(alloc => alloc.productId))];
        console.log(`[SCHEDULE] Filtering to ${productIds.length} products for client ${targetClientId}`);

        if (productIds.length === 0) {
          return this.ready();
        }

        productQuery = { _id: { $in: productIds } };
        scopedAllocations = allocations;
      }
    }
  } else if (isAdmin) {
    // Admin sees all products (when not using View As)
    productQuery = {};
  } else if (isRM) {
    // RM/Assistant sees products of their assigned clients (legacy + entity-based)
    const rmIds = UserHelpers.getEffectiveRmIds(currentUser);

    // Legacy: users with relationshipManagerId
    const assignedClients = await UsersCollection.find({
      role: USER_ROLES.CLIENT,
      relationshipManagerId: { $in: rmIds }
    }).fetchAsync();
    const clientIds = assignedClients.map(client => client._id);

    // Entity-based: entities assigned to this RM
    const { ClientEntitiesCollection } = await import('/imports/api/clientEntities');
    const { BankAccountsCollection } = await import('/imports/api/bankAccounts');

    const rmEntities = await ClientEntitiesCollection.find({
      $or: [
        { assignedUserIds: { $in: rmIds } },
        { relationshipManagerId: { $in: rmIds } }
      ],
      isActive: true
    }).fetchAsync();

    const migratedUserIds = rmEntities.map(e => e.migratedFromUserId).filter(Boolean);
    const entityIds = rmEntities.map(e => e._id);

    // Get bank accounts for these entities
    let bankAccountIds = [];
    let bankAccountUserIds = [];
    if (entityIds.length > 0) {
      const entityAccounts = await BankAccountsCollection.find({
        entityId: { $in: entityIds },
        isActive: true
      }).fetchAsync();
      bankAccountIds = entityAccounts.map(a => a._id);
      bankAccountUserIds = entityAccounts.map(a => a.userId).filter(Boolean);
    }

    // Combine all client IDs
    const allClientIds = [...new Set([...clientIds, ...migratedUserIds, ...bankAccountUserIds])];

    if (allClientIds.length === 0 && bankAccountIds.length === 0) {
      return this.ready();
    }

    // Build allocation query
    const orConditions = [];
    if (allClientIds.length > 0) {
      orConditions.push({ clientId: { $in: allClientIds } });
    }
    if (bankAccountIds.length > 0) {
      orConditions.push({ bankAccountId: { $in: bankAccountIds } });
    }

    const clientAllocations = await AllocationsCollection.find(
      orConditions.length === 1 ? orConditions[0] : { $or: orConditions }
    ).fetchAsync();

    const productIds = [...new Set(clientAllocations.map(alloc => alloc.productId))];
    productQuery = { _id: { $in: productIds } };
    scopedAllocations = clientAllocations;
  } else if (currentUser.role === USER_ROLES.CLIENT) {
    // Client sees only products they have allocations in
    const userAllocations = await AllocationsCollection.find({
      clientId: currentUser._id
    }).fetchAsync();

    const productIds = [...new Set(userAllocations.map(alloc => alloc.productId))];
    if (productIds.length === 0) {
      return this.ready();
    }

    productQuery = { _id: { $in: productIds } };
    scopedAllocations = userAllocations;
  }

  // Fetch all products with observation schedules
  // Include all products the user has access to with observation schedules
  console.log('[SCHEDULE] Product query:', JSON.stringify(productQuery));

  const products = await ProductsCollection.find({
    ...productQuery,
    observationSchedule: { $exists: true, $ne: [] }
  }).fetchAsync();

  console.log('[SCHEDULE] Found', products.length, 'products with observationSchedule');

  // Aggregate nominal held by the scoped client/entity/account per product.
  // Null when no scope is defined (e.g. admin without a viewAs filter).
  const nominalByProduct = {};
  if (scopedAllocations) {
    for (const alloc of scopedAllocations) {
      const amount = Number(alloc.nominalInvested) || 0;
      if (!amount) continue;
      nominalByProduct[alloc.productId] = (nominalByProduct[alloc.productId] || 0) + amount;
    }
  }

  // Fetch template reports to get observation outcomes and predictions
  const { TemplateReportsCollection } = await import('/imports/api/templateReports');
  const productIds = products.map(p => p._id);
  const reports = await TemplateReportsCollection.find({
    productId: { $in: productIds }
  }).fetchAsync();

  // Create a map of productId -> observation analysis, next observation prediction, and redemption status
  const reportMap = {};
  const nextObservationPredictionMap = {};
  const productStatusMap = {}; // Track if product is called/matured
  reports.forEach(report => {
    console.log(`[SCHEDULE] Report for product ${report.productId}:`, {
      hasTemplateResults: !!report.templateResults,
      hasObservationAnalysis: !!report.templateResults?.observationAnalysis,
      hasNextPrediction: !!report.templateResults?.observationAnalysis?.nextObservationPrediction,
      predictionData: report.templateResults?.observationAnalysis?.nextObservationPrediction
    });

    if (report.templateResults?.observationAnalysis?.observations) {
      reportMap[report.productId] = report.templateResults.observationAnalysis.observations;
    }
    if (report.templateResults?.observationAnalysis?.nextObservationPrediction) {
      nextObservationPredictionMap[report.productId] = report.templateResults.observationAnalysis.nextObservationPrediction;
      console.log(`[SCHEDULE] ✅ Mapped prediction for product ${report.productId}:`, nextObservationPredictionMap[report.productId]);
    } else {
      console.log(`[SCHEDULE] ❌ No prediction found for product ${report.productId}`);
    }
    // Track product redemption/maturity status
    const obsAnalysis = report.templateResults?.observationAnalysis;
    if (obsAnalysis) {
      productStatusMap[report.productId] = {
        isEarlyAutocall: obsAnalysis.isEarlyAutocall || false,
        isMaturedAtFinal: obsAnalysis.isMaturedAtFinal || false,
        productCalled: obsAnalysis.productCalled || false
      };
    }
  });

  console.log('[SCHEDULE] Found', reports.length, 'reports for observation outcomes');
  console.log('[SCHEDULE] Found', Object.keys(nextObservationPredictionMap).length, 'next observation predictions');
  console.log('[SCHEDULE] Prediction map keys:', Object.keys(nextObservationPredictionMap));

  if (products.length > 0) {
    console.log('[SCHEDULE] Sample product:', {
      id: products[0]._id,
      title: products[0].title,
      hasSchedule: !!products[0].observationSchedule,
      scheduleLength: products[0].observationSchedule?.length
    });
  }

  // Process and publish observation schedule data
  const observations = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  products.forEach(product => {
    if (!product.observationSchedule || !Array.isArray(product.observationSchedule)) {
      return;
    }

    console.log('[SCHEDULE] Processing product:', product._id, 'Schedule items:', product.observationSchedule.length);

    // Get product status to check if autocalled
    const productStatus = productStatusMap[product._id] || { isEarlyAutocall: false, isMaturedAtFinal: false, productCalled: false };

    // If product was autocalled, find the autocall observation index from report data
    // so we can skip all subsequent observations
    let autocallObsIndex = -1;
    if (productStatus.isEarlyAutocall || productStatus.productCalled) {
      const reportObservations = reportMap[product._id];
      if (reportObservations) {
        autocallObsIndex = reportObservations.findIndex(o => o.productCalled || o.autocalled);
      }
    }

    product.observationSchedule.forEach((obs, index) => {
      // Skip observations after an autocall - they are cancelled
      if (autocallObsIndex !== -1 && index > autocallObsIndex) {
        return;
      }

      // Log the actual observation object to see its structure
      console.log('[SCHEDULE] Observation', index, ':', JSON.stringify(obs));

      // Try different possible field names for the date
      const dateValue = obs.date || obs.observationDate || obs.valueDate;

      if (!dateValue) {
        console.log('[SCHEDULE] WARNING: No date field found in observation', index, 'Fields:', Object.keys(obs));
        return;
      }

      const obsDate = new Date(dateValue);
      obsDate.setHours(0, 0, 0, 0);

      // Calculate days left (positive = future, negative = past)
      const diffTime = obsDate.getTime() - today.getTime();
      const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Format date for display
      const formattedDate = obsDate.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });

      // Format days left text
      let daysLeftText;
      let daysLeftColor;

      if (daysLeft < 0) {
        daysLeftText = `${Math.abs(daysLeft)} days ago`;
        daysLeftColor = 'muted';
      } else if (daysLeft === 0) {
        daysLeftText = 'Today';
        daysLeftColor = 'urgent';
      } else if (daysLeft <= 7) {
        daysLeftText = `${daysLeft} days`;
        daysLeftColor = 'urgent';
      } else if (daysLeft <= 30) {
        daysLeftText = `${daysLeft} days`;
        daysLeftColor = 'soon';
      } else {
        daysLeftText = `${daysLeft} days`;
        daysLeftColor = 'normal';
      }

      const isToday = daysLeft === 0;
      const isPast = daysLeft < 0;

      console.log('[SCHEDULE] Observation', index, 'date:', dateValue, 'Days left:', daysLeft, 'Past or Future:', isPast ? 'PAST' : 'FUTURE');

      // Try to find matching observation outcome from report
      let outcome = null;
      const reportObservations = reportMap[product._id];

      console.log('[SCHEDULE] Product:', product._id, 'Obs index:', index, 'Has report observations:', !!reportObservations);

      if (reportObservations && reportObservations.length > index) {
        const reportObs = reportObservations[index];
        // Verify it's the same observation by checking if dates match approximately
        const reportObsDate = new Date(reportObs.observationDate);
        reportObsDate.setHours(0, 0, 0, 0);

        const dateDiff = Math.abs(reportObsDate.getTime() - obsDate.getTime());
        console.log('[SCHEDULE] Date comparison - Report:', reportObsDate.toISOString(), 'Schedule:', obsDate.toISOString(), 'Diff (ms):', dateDiff);

        if (dateDiff < 86400000) { // Within 1 day
          outcome = {
            couponPaid: reportObs.couponPaid || 0,
            couponPaidFormatted: reportObs.couponPaidFormatted || null,
            productCalled: reportObs.productCalled || false,
            couponInMemory: reportObs.couponInMemory || 0,
            couponInMemoryFormatted: reportObs.couponInMemoryFormatted || null,
            hasOccurred: reportObs.hasOccurred || false
          };
          console.log('[SCHEDULE] Outcome matched:', outcome);
        } else {
          console.log('[SCHEDULE] Date mismatch - skipping outcome');
        }
      } else {
        console.log('[SCHEDULE] No report observations for product or index out of bounds');
      }

      // Get next observation prediction for this product
      const nextObservationPrediction = nextObservationPredictionMap[product._id] || null;
      // Get product redemption status
      const productStatus = productStatusMap[product._id] || { isEarlyAutocall: false, isMaturedAtFinal: false, productCalled: false };

      if (index === 0) {
        console.log(`[SCHEDULE PUB] Product ${product._id} has prediction:`, {
          hasData: !!nextObservationPrediction,
          outcomeType: nextObservationPrediction?.outcomeType,
          displayText: nextObservationPrediction?.displayText
        });
      }

      // Include ALL observations (both past and future) with pre-calculated values
      observations.push({
        _id: `${product._id}_obs_${index}`, // Unique ID for reactivity
        productId: product._id,
        productTitle: product.title || product.name || 'Untitled Product',
        productIsin: product.isin || product.ISIN || 'N/A',
        productCurrency: product.currency || null,
        clientNominal: nominalByProduct[product._id] ?? null,
        observationDate: dateValue,
        observationDateFormatted: formattedDate,
        observationType: obs.type || 'observation',
        isFinal: index === product.observationSchedule.length - 1,
        isCallable: obs.isCallable || false,
        couponRate: obs.couponRate || null,
        autocallLevel: obs.autocallLevel || null,
        observationIndex: index,
        daysLeft: daysLeft,
        daysLeftText: daysLeftText,
        daysLeftColor: daysLeftColor,
        isToday: isToday,
        isPast: isPast,
        // Observation outcome data (from report)
        outcome: outcome,
        // Next observation prediction (same for all observations of this product)
        // Only include if product is not already redeemed/called
        nextObservationPrediction: productStatus.isEarlyAutocall || productStatus.isMaturedAtFinal || productStatus.productCalled
          ? null
          : nextObservationPrediction,
        // Product redemption status flags
        productStatus: productStatus
      });
    });
  });

  // Sort observations by date (ascending)
  observations.sort((a, b) => new Date(a.observationDate) - new Date(b.observationDate));

  console.log('[SCHEDULE] Publishing', observations.length, 'observations');

  // Publish each observation to the client
  observations.forEach(obs => {
    this.added('observationSchedule', obs._id, obs);
  });

  this.ready();
  console.log('[SCHEDULE] Publication ready!');
});

