// Schedule Publications
// Provides aggregated observation schedule data from all live products
// Last updated: 2025-10-10

console.log('🗓️ Loading schedule.js publication file...');

import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';

// Publication that aggregates all observations from live products
Meteor.publish("schedule.observations", async function (sessionId = null) {
  console.log('[SCHEDULE] Publication called with sessionId:', sessionId);

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

  if (currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.ADMIN) {
    // Admin sees all products
    productQuery = {};
  } else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
    // RM sees products of their assigned clients
    const assignedClients = await UsersCollection.find({
      role: USER_ROLES.CLIENT,
      relationshipManagerId: currentUser._id
    }).fetchAsync();

    const clientIds = assignedClients.map(client => client._id);
    if (clientIds.length === 0) {
      return this.ready();
    }

    const clientAllocations = await AllocationsCollection.find({
      clientId: { $in: clientIds }
    }).fetchAsync();

    const productIds = [...new Set(clientAllocations.map(alloc => alloc.productId))];
    productQuery = { _id: { $in: productIds } };
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
  }

  // Fetch all products with observation schedules
  // Include all products the user has access to with observation schedules
  console.log('[SCHEDULE] Product query:', JSON.stringify(productQuery));

  const products = await ProductsCollection.find({
    ...productQuery,
    observationSchedule: { $exists: true, $ne: [] }
  }).fetchAsync();

  console.log('[SCHEDULE] Found', products.length, 'products with observationSchedule');

  // Fetch reports to get observation outcomes
  const { ReportsCollection } = await import('/imports/api/reports');
  const productIds = products.map(p => p._id);
  const reports = await ReportsCollection.find({
    productId: { $in: productIds }
  }).fetchAsync();

  // Create a map of productId -> observation analysis
  const reportMap = {};
  reports.forEach(report => {
    if (report.templateResults?.observationAnalysis?.observations) {
      reportMap[report.productId] = report.templateResults.observationAnalysis.observations;
    }
  });

  console.log('[SCHEDULE] Found', reports.length, 'reports for observation outcomes');

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

    product.observationSchedule.forEach((obs, index) => {
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

      // Include ALL observations (both past and future) with pre-calculated values
      observations.push({
        _id: `${product._id}_obs_${index}`, // Unique ID for reactivity
        productId: product._id,
        productTitle: product.title || product.name || 'Untitled Product',
        productIsin: product.isin || product.ISIN || 'N/A',
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
        outcome: outcome
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

