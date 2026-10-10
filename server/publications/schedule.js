// Schedule Publications
// Aggregated observation schedule from the products in the viewer's scope.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { parseViewAs } from '/imports/utils/viewAs';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { resolveScope, allocationsSelector, heldProductIds as heldProductIdsForScope } from '../helpers/accessScope.js';

Meteor.publish("schedule.observations", async function (sessionId = null, rawViewAs = null) {
  check(sessionId, Match.Maybe(String));
  const viewAs = parseViewAs(rawViewAs);

  const currentUser = await getSessionUser(sessionId);
  if (!currentUser) return this.ready();

  const scope = await resolveScope(currentUser, viewAs);
  if (scope.denied) return this.ready();

  // Allocations that define the *scope* of the current view — used to sum
  // nominal invested per product so the Nominal column reflects what the
  // filtered client/entity/account actually holds. Stays null for a see-all
  // view without View As (no single-client context to aggregate).
  let scopedAllocations = null;
  let productSelector = {};

  if (!scope.isAdmin) {
    // Allocations are the durable record of what this scope held, so they
    // still cover positions the holdings feed has since dropped (a redeemed
    // product keeps its past observations; the loop below emits only those).
    scopedAllocations = await AllocationsCollection.find(await allocationsSelector(scope)).fetchAsync();
    const accessibleIds = [...new Set(scopedAllocations.map(a => String(a.productId)).filter(Boolean))];
    if (accessibleIds.length === 0) return this.ready();
    productSelector = { _id: { $in: accessibleIds } };
  }

  // Gate future observations by ACTUAL bank holdings (source of truth): a
  // sold/matured product leaves the holdings feed and never advertises a date
  // that will not be observed.
  const heldProductIds = await heldProductIdsForScope(scope);

  const products = await ProductsCollection.find({
    ...productSelector,
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

    // Still in the holdings feed, or a closed position kept for its history?
    // (see the scope note above the product query).
    const isHeld = heldProductIds.has(String(product._id));

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

      // A position that is no longer held keeps its history but not its future:
      // once the product is redeemed those observations never take place.
      if (!isHeld && !isPast) {
        return;
      }

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

