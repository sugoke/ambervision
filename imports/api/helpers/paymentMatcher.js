import { PMSOperationsCollection } from '../pmsOperations.js';
import { PMSHoldingsCollection } from '../pmsHoldings.js';

/**
 * Payment Matcher Helper
 *
 * Matches scheduled coupon payments from product templates
 * with actual PMS operations/transactions to verify payment receipt.
 */

// Cutoff date for PMS history - no operation data available before this date
const PMS_HISTORY_CUTOFF = new Date('2025-12-01');

/**
 * Check if an operation date is within acceptable range of scheduled payment date
 * Banks may process payments late, so we allow operations UP TO 7 days AFTER scheduled date
 * @param {Date|String} scheduledDate - Scheduled payment date from product
 * @param {Date|String} operationDate - Actual operation date from bank
 * @param {Number} daysAfterTolerance - Number of days after scheduled date to allow (default: 7)
 * @returns {Boolean}
 */
function datesMatch(scheduledDate, operationDate, daysAfterTolerance = 7) {
  if (!scheduledDate || !operationDate) return false;

  const scheduled = new Date(scheduledDate);
  const operation = new Date(operationDate);

  // Normalize to UTC midnight to avoid timezone issues
  const scheduledUTC = Date.UTC(scheduled.getFullYear(), scheduled.getMonth(), scheduled.getDate());
  const operationUTC = Date.UTC(operation.getFullYear(), operation.getMonth(), operation.getDate());

  // Calculate difference in days (operation - scheduled)
  // Positive = operation is AFTER scheduled (late payment - OK within tolerance)
  // Negative = operation is BEFORE scheduled (early payment - not expected)
  const daysDiff = (operationUTC - scheduledUTC) / (1000 * 60 * 60 * 24);

  const matches = daysDiff >= 0 && daysDiff <= daysAfterTolerance;
  const scheduledStr = `${scheduled.getFullYear()}-${String(scheduled.getMonth()+1).padStart(2,'0')}-${String(scheduled.getDate()).padStart(2,'0')}`;
  const operationStr = `${operation.getFullYear()}-${String(operation.getMonth()+1).padStart(2,'0')}-${String(operation.getDate()).padStart(2,'0')}`;
  console.log(`[PaymentMatcher] datesMatch: scheduled=${scheduledStr}, operation=${operationStr}, daysDiff=${daysDiff}, matches=${matches}`);

  // Allow same day (0) up to daysAfterTolerance days late
  return matches;
}

/**
 * Check if two amounts are within tolerance of each other
 * @param {Number} amount1 - First amount
 * @param {Number} amount2 - Second amount
 * @param {Number} tolerancePercent - Tolerance as percentage (default: 5%)
 * @returns {Boolean}
 */
function amountsMatch(amount1, amount2, tolerancePercent = 5) {
  if (!amount1 || !amount2) return false;

  const diff = Math.abs(amount1 - amount2);
  const avgAmount = (Math.abs(amount1) + Math.abs(amount2)) / 2;
  const diffPercent = (diff / avgAmount) * 100;

  return diffPercent <= tolerancePercent;
}

/**
 * Match a scheduled payment observation with actual PMS operations
 *
 * @param {Object} product - Product object with ISIN
 * @param {Object} observation - Observation schedule entry with paymentDate and couponPaid
 * @param {Array} pmsOperations - Array of PMS operations (pre-filtered by ISIN recommended)
 * @returns {Object} - { confirmed: Boolean, operation: Object|null, matchConfidence: String }
 */
export function matchScheduledPayment(product, observation, pmsOperations = null) {
  // Validation
  if (!product || !product.isin) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'no-product-isin',
      error: 'Product missing ISIN'
    };
  }

  if (!observation || !observation.paymentDate) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'no-payment-date',
      error: 'Observation missing payment date'
    };
  }

  // Calculate expected coupon amount
  // observation.couponPaid is percentage (e.g., 3.5 for 3.5%)
  // Need to calculate absolute amount based on nominal value
  const expectedCouponPercent = observation.couponPaid || 0;

  if (expectedCouponPercent === 0) {
    // No coupon expected, nothing to match
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'no-coupon-expected',
      message: 'No coupon payment expected for this observation'
    };
  }

  // Query PMS operations if not provided
  let operations = pmsOperations;
  if (!operations) {
    // Match ANY operation with the same ISIN and positive amount (incoming payment)
    // Also match by operationType as fallback for banks that store amounts differently
    // Use toUpperCase() for consistent ISIN matching
    operations = PMSOperationsCollection.find({
      isin: product.isin.toUpperCase(),
      isActive: true,
      $or: [
        { grossAmount: { $gt: 0 } },
        { netAmount: { $gt: 0 } },
        { operationType: 'COUPON' },    // Direct type match (SG Monaco, etc.)
        { operationType: 'DIVIDEND' },  // Also catches dividend-style income
        { operationType: 'INTEREST' }   // Interest payments
      ]
    }).fetch();
  }

  if (!operations || operations.length === 0) {
    console.log(`[PaymentMatcher] matchScheduledPayment: No operations to match against`);
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'no-operations-found',
      message: 'No incoming payment operations found for this ISIN'
    };
  }

  // Try to find matching operation
  const paymentDate = new Date(observation.paymentDate);
  console.log(`[PaymentMatcher] matchScheduledPayment: raw paymentDate="${observation.paymentDate}", parsed=${paymentDate.toISOString()}, checking ${operations.length} operations`);

  let bestMatch = null;
  let bestMatchScore = 0;

  for (const operation of operations) {
    let score = 0;
    let matchDetails = {
      dateMatch: false,
      amountMatch: false
    };

    // Debug logging for each operation
    const opValueDate = operation.valueDate ? new Date(operation.valueDate).toISOString().split('T')[0] : 'null';
    console.log(`[PaymentMatcher]   Checking op: type=${operation.operationType}, valueDate=${opValueDate}, grossAmt=${operation.grossAmount}, netAmt=${operation.netAmount}`);

    // Check date match (operation.valueDate should match observation.paymentDate)
    // observation.paymentDate is the scheduled value/settlement date from the product
    // Banks may process payments late, so we check within 7-day window
    if (operation.valueDate && datesMatch(paymentDate, operation.valueDate, 7)) {
      matchDetails.dateMatch = true;

      // Calculate days difference for scoring
      const scheduled = new Date(paymentDate);
      const actual = new Date(operation.valueDate);
      const daysDiff = Math.floor((actual - scheduled) / (1000 * 60 * 60 * 24));

      // Score based on proximity: closer = higher score
      if (daysDiff === 0) {
        score += 50; // Same day - perfect match
      } else if (daysDiff <= 3) {
        score += 40; // 1-3 days late - very good
      } else {
        score += 30; // 4-7 days late - acceptable
      }
    }

    // Check amount match
    // Check both grossAmount and netAmount - different banks use different fields
    // Also check operationType as strong indicator for coupon payments
    const hasPositiveGrossAmount = operation.grossAmount && operation.grossAmount > 0;
    const hasPositiveNetAmount = operation.netAmount && operation.netAmount > 0;
    const isCouponType = ['COUPON', 'DIVIDEND', 'INTEREST'].includes(operation.operationType);

    if (hasPositiveGrossAmount || hasPositiveNetAmount) {
      score += 30;
      matchDetails.amountMatch = true;
    }

    // Bonus score for operationType match
    if (isCouponType) {
      score += 20;
      matchDetails.typeMatch = true;
    }

    // Also check operation date (transaction date) for additional confidence
    // Operation date may differ from value date
    if (operation.operationDate && datesMatch(paymentDate, operation.operationDate, 7)) {
      score += 10;
    }

    if (score > bestMatchScore) {
      bestMatchScore = score;
      bestMatch = {
        operation,
        matchDetails
      };
    }
  }

  // Determine match confidence based on score
  let matchConfidence = 'none';
  let confirmed = false;

  if (bestMatchScore >= 80) {
    matchConfidence = 'high';
    confirmed = true;
  } else if (bestMatchScore >= 50) {
    matchConfidence = 'medium';
    confirmed = true;
  } else if (bestMatchScore >= 30) {
    matchConfidence = 'low';
    confirmed = false; // Low confidence = not confirmed
  }

  console.log(`[PaymentMatcher] matchScheduledPayment result: bestScore=${bestMatchScore}, confidence=${matchConfidence}, confirmed=${confirmed}`);

  if (!bestMatch) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'none',
      message: 'No matching operation found'
    };
  }

  return {
    confirmed,
    operation: bestMatch.operation,
    matchConfidence,
    matchScore: bestMatchScore,
    matchDetails: bestMatch.matchDetails,
    confirmedPayment: confirmed ? {
      operationId: bestMatch.operation._id,
      actualAmount: bestMatch.operation.grossAmount,
      actualDate: bestMatch.operation.valueDate,
      transactionRef: bestMatch.operation.uniqueKey || bestMatch.operation._id,
      operationDate: bestMatch.operation.operationDate,
      netAmount: bestMatch.operation.netAmount,
      currency: bestMatch.operation.instrumentCurrency || product.currency
    } : null
  };
}

/**
 * Match a redemption transaction for an autocalled observation
 *
 * When a product is autocalled (redeemed), there are typically TWO transactions:
 * 1. Coupon payment (handled by matchScheduledPayment)
 * 2. Redemption/principal return (handled by this function)
 *
 * @param {Object} product - Product object with ISIN
 * @param {Object} observation - Observation schedule entry with paymentDate and autocalled flag
 * @param {Array} redemptionOperations - Array of PMS operations filtered for redemptions
 * @returns {Object} - { confirmed: Boolean, operation: Object|null, matchConfidence: String }
 */
export function matchRedemptionTransaction(product, observation, redemptionOperations = null) {
  // Only check if this observation triggered an autocall or is a final maturity redemption
  if (!observation.autocalled && !observation.isFinal) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'not-redemption-event',
      message: 'This observation is not an autocall or maturity event'
    };
  }

  // For non-autocalled final observations, we need hasOccurred to be true
  if (observation.isFinal && !observation.autocalled && !observation.hasOccurred) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'future-maturity',
      message: 'Maturity has not occurred yet'
    };
  }

  // Validation
  if (!product || !product.isin) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'no-product-isin',
      error: 'Product missing ISIN'
    };
  }

  if (!observation || !observation.paymentDate) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'no-payment-date',
      error: 'Observation missing payment date'
    };
  }

  let operations = redemptionOperations;
  if (!operations) {
    // Query redemption-like operations with consistent ISIN case
    operations = PMSOperationsCollection.find({
      isin: product.isin.toUpperCase(),
      isActive: true,
      $or: [
        { operationType: 'REDEMPTION' },
        { operationType: 'SELL' },
        { quantity: { $lt: 0 } }
      ]
    }).fetch();
  }

  console.log(`[PaymentMatcher] matchRedemptionTransaction: ${operations.length} redemption ops for ISIN ${product.isin.toUpperCase()}`);

  if (!operations || operations.length === 0) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'no-redemption-operations',
      message: 'No redemption operations found for this ISIN'
    };
  }

  // Try to find matching redemption operation
  const paymentDate = new Date(observation.paymentDate);
  console.log(`[PaymentMatcher] matchRedemptionTransaction: Looking for redemption on ${paymentDate.toISOString().split('T')[0]}`);

  let bestMatch = null;
  let bestMatchScore = 0;

  for (const operation of operations) {
    let score = 0;
    let matchDetails = {
      dateMatch: false,
      typeMatch: false,
      quantityMatch: false,
      detailsMatch: false
    };

    // Debug logging for each redemption operation
    const opValueDate = operation.valueDate ? new Date(operation.valueDate).toISOString().split('T')[0] : 'null';
    console.log(`[PaymentMatcher]   Checking redemption op: type=${operation.operationType}, valueDate=${opValueDate}, qty=${operation.quantity}, netAmt=${operation.netAmount}`);

    // Check date match (same 7-day tolerance as coupon payments)
    if (operation.valueDate && datesMatch(paymentDate, operation.valueDate, 7)) {
      matchDetails.dateMatch = true;

      const scheduled = new Date(paymentDate);
      const actual = new Date(operation.valueDate);
      const daysDiff = Math.floor((actual - scheduled) / (1000 * 60 * 60 * 24));

      if (daysDiff === 0) {
        score += 50; // Same day - perfect match
      } else if (daysDiff <= 3) {
        score += 40; // 1-3 days late - very good
      } else {
        score += 30; // 4-7 days late - acceptable
      }
    }

    // Check operation type
    if (operation.operationType === 'REDEMPTION') {
      score += 30;
      matchDetails.typeMatch = true;
    } else if (operation.operationType === 'SELL') {
      score += 15; // SELL can indicate redemption
      matchDetails.typeMatch = true;
    }

    // Check details field for redemption keywords
    const details = (operation.details || '').toLowerCase();
    if (details.includes('redemption') || details.includes('call for redemption') ||
        details.includes('maturity') || details.includes('early call')) {
      score += 20;
      matchDetails.detailsMatch = true;
    }

    // Check quantity - negative indicates position sold/redeemed
    // Some banks (SG Monaco) store quantity as absolute value with REDEMPTION type
    if (operation.quantity) {
      if (operation.quantity < 0) {
        score += 10;  // Negative quantity = position sold
        matchDetails.quantityMatch = true;
      } else if (operation.operationType === 'REDEMPTION' && operation.quantity > 0) {
        score += 5;   // Positive quantity with REDEMPTION type (SG Monaco style)
        matchDetails.quantityMatch = true;
      }
    }

    // Check price around 1.00 (100% of nominal) - typical for redemptions
    if (operation.price && operation.price >= 0.95 && operation.price <= 1.05) {
      score += 10;
    }

    // Also check operation date for additional confidence
    if (operation.operationDate && datesMatch(paymentDate, operation.operationDate, 7)) {
      score += 10;
    }

    if (score > bestMatchScore) {
      bestMatchScore = score;
      bestMatch = {
        operation,
        matchDetails
      };
    }
  }

  // Determine match confidence based on score
  let matchConfidence = 'none';
  let confirmed = false;

  if (bestMatchScore >= 80) {
    matchConfidence = 'high';
    confirmed = true;
  } else if (bestMatchScore >= 50) {
    matchConfidence = 'medium';
    confirmed = true;
  } else if (bestMatchScore >= 30) {
    matchConfidence = 'low';
    confirmed = false;
  }

  console.log(`[PaymentMatcher] matchRedemptionTransaction result: bestScore=${bestMatchScore}, confidence=${matchConfidence}, confirmed=${confirmed}`);

  if (!bestMatch) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'none',
      message: 'No matching redemption operation found'
    };
  }

  return {
    confirmed,
    operation: bestMatch.operation,
    matchConfidence,
    matchScore: bestMatchScore,
    matchDetails: bestMatch.matchDetails,
    confirmedRedemption: confirmed ? {
      operationId: bestMatch.operation._id,
      actualAmount: bestMatch.operation.netAmount || bestMatch.operation.grossAmount,
      actualDate: bestMatch.operation.valueDate,
      transactionRef: bestMatch.operation.uniqueKey || bestMatch.operation._id,
      operationDate: bestMatch.operation.operationDate,
      quantity: bestMatch.operation.quantity,
      price: bestMatch.operation.price,
      currency: bestMatch.operation.instrumentCurrency || product.currency
    } : null
  };
}

/**
 * Match all observations in a schedule with PMS operations
 * Optimized to query operations once and reuse for all observations
 *
 * @param {Object} product - Product object with ISIN
 * @param {Array} observations - Array of observation schedule entries
 * @returns {Array} - Array of observations enhanced with payment confirmation data
 */
export async function matchAllScheduledPayments(product, observations) {
  if (!product || !product.isin || !observations || observations.length === 0) {
    return observations;
  }

  const isinUpper = product.isin.toUpperCase();
  const isinLower = product.isin.toLowerCase();
  const isinOriginal = product.isin;
  console.log(`[PaymentMatcher] matchAllScheduledPayments for ISIN: ${isinOriginal} (upper: ${isinUpper})`);

  // Query ALL operations for this product FIRST (not holdings)
  // For redeemed products, holdings may be deleted but operations still exist
  // Try multiple ISIN case variants to handle any storage differences
  let allOperations = await PMSOperationsCollection.find({
    isin: { $in: [isinOriginal, isinUpper, isinLower] },
    isActive: true
  }).fetchAsync();

  console.log(`[PaymentMatcher] Found ${allOperations.length} operations for ISIN variants [${isinOriginal}, ${isinUpper}, ${isinLower}]`);

  // If no operations found, check if product was ever in holdings as secondary check
  if (allOperations.length === 0) {
    const holdingsExist = await PMSHoldingsCollection.find({
      isin: isinUpper
    }).countAsync();

    if (holdingsExist === 0) {
      console.log(`[PaymentMatcher] No operations AND no holdings for ISIN ${isinUpper} - skipping verification`);
      // Product was never tracked in PMS at all
      return observations.map(obs => ({
        ...obs,
        paymentConfirmed: false,
        matchConfidence: 'no-pms-data',
        matchMessage: 'No PMS operations or holdings found for this ISIN'
      }));
    }

    // Holdings exist but no operations yet - payments not yet received
    console.log(`[PaymentMatcher] Holdings exist but no operations for ISIN ${isinUpper}`);
    return observations.map(obs => ({
      ...obs,
      paymentConfirmed: false,
      matchConfidence: 'no-operations',
      matchMessage: 'Product tracked in PMS but no payment operations found yet'
    }));
  }

  // Log operation details for debugging
  console.log(`[PaymentMatcher] Operations:`, allOperations.map(op => ({
    type: op.operationType,
    valueDate: op.valueDate,
    netAmount: op.netAmount,
    grossAmount: op.grossAmount
  })));

  // Separate operations into coupon (positive amounts OR coupon type) and redemption candidates
  const couponOperations = allOperations.filter(op =>
    (op.grossAmount && op.grossAmount > 0) ||
    (op.netAmount && op.netAmount > 0) ||
    op.operationType === 'COUPON' ||
    op.operationType === 'DIVIDEND' ||
    op.operationType === 'INTEREST'
  );

  const redemptionOperations = allOperations.filter(op =>
    op.operationType === 'REDEMPTION' ||
    op.operationType === 'SELL' ||
    (op.quantity && op.quantity < 0) ||
    (op.details && op.details.toLowerCase().includes('redemption'))
  );

  console.log(`[PaymentMatcher] Filtered: ${couponOperations.length} coupon ops, ${redemptionOperations.length} redemption ops`);

  // Match each observation
  const enhancedObservations = observations.map(obs => {
    const paymentDate = new Date(obs.paymentDate);

    // Skip payments before PMS history cutoff (no data available before Dec 2025)
    if (paymentDate < PMS_HISTORY_CUTOFF) {
      return {
        ...obs,
        paymentConfirmed: false,
        matchConfidence: 'skipped-before-cutoff',
        matchMessage: 'Payment date before PMS history availability (Dec 2025)',
        // Redemption fields
        redemptionConfirmed: false,
        redemptionMatchConfidence: 'skipped-before-cutoff'
      };
    }

    // Match coupon payment (existing logic)
    const couponMatchResult = matchScheduledPayment(product, obs, couponOperations);

    // Determine if coupon payment is past due
    const today = new Date();
    const isPastDue = paymentDate < today && !couponMatchResult.confirmed && obs.couponPaid > 0;

    // Match redemption transaction (NEW logic)
    // Only check if this is an autocall or final maturity observation
    let redemptionResult = {
      confirmed: false,
      matchConfidence: 'not-applicable',
      message: null
    };

    if (obs.autocalled || (obs.isFinal && obs.hasOccurred)) {
      redemptionResult = matchRedemptionTransaction(product, obs, redemptionOperations);
    }

    // Determine if redemption is past due
    const redemptionIsPastDue = paymentDate < today &&
      !redemptionResult.confirmed &&
      (obs.autocalled || (obs.isFinal && obs.hasOccurred));

    return {
      ...obs,
      // Coupon payment fields (existing)
      paymentConfirmed: couponMatchResult.confirmed,
      confirmedPayment: couponMatchResult.confirmedPayment,
      matchConfidence: couponMatchResult.matchConfidence,
      matchScore: couponMatchResult.matchScore,
      isPastDue,
      matchMessage: couponMatchResult.message || couponMatchResult.error || null,
      // Redemption fields (NEW)
      redemptionConfirmed: redemptionResult.confirmed,
      confirmedRedemption: redemptionResult.confirmedRedemption,
      redemptionMatchConfidence: redemptionResult.matchConfidence,
      redemptionMatchScore: redemptionResult.matchScore,
      redemptionIsPastDue,
      redemptionMatchMessage: redemptionResult.message || redemptionResult.error || null
    };
  });

  return enhancedObservations;
}

export const PaymentMatcherHelpers = {
  matchScheduledPayment,
  matchRedemptionTransaction,
  matchAllScheduledPayments,
  datesMatch,
  amountsMatch
};
