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

  // Calculate difference in days (operation - scheduled)
  // Positive = operation is AFTER scheduled (late payment - OK within tolerance)
  // Negative = operation is BEFORE scheduled (early payment - not expected)
  const daysDiff = (operation - scheduled) / (1000 * 60 * 60 * 24);

  // Allow same day (0) up to daysAfterTolerance days late
  return daysDiff >= 0 && daysDiff <= daysAfterTolerance;
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
    // Don't rely on operationType classification as banks differ
    operations = PMSOperationsCollection.find({
      isin: product.isin,
      isActive: true,
      $or: [
        { grossAmount: { $gt: 0 } },
        { netAmount: { $gt: 0 } }
      ]
    }).fetch();
  }

  if (!operations || operations.length === 0) {
    return {
      confirmed: false,
      operation: null,
      matchConfidence: 'no-operations-found',
      message: 'No incoming payment operations found for this ISIN'
    };
  }

  // Try to find matching operation
  const paymentDate = new Date(observation.paymentDate);

  let bestMatch = null;
  let bestMatchScore = 0;

  for (const operation of operations) {
    let score = 0;
    let matchDetails = {
      dateMatch: false,
      amountMatch: false
    };

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
    // For now, we just check if grossAmount is positive (coupon received)
    // In future, could calculate expected absolute amount from nominal * couponPercent
    if (operation.grossAmount && operation.grossAmount > 0) {
      score += 30;
      matchDetails.amountMatch = true;

      // Could add more sophisticated amount matching here
      // e.g., if we know the nominal value:
      // const expectedAmount = (nominalValue * expectedCouponPercent) / 100;
      // if (amountsMatch(operation.grossAmount, expectedAmount, 5)) {
      //   score += 20;
      // }
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

  // Check if product exists in any PMS holdings (account tracking)
  // Skip verification for products not tracked in PMS
  const holdingsExist = await PMSHoldingsCollection.find({
    isin: product.isin.toUpperCase(),
    isLatest: true,
    isActive: true
  }).countAsync();

  if (holdingsExist === 0) {
    // Product not in any PMS account - return observations without payment verification
    return observations.map(obs => ({
      ...obs,
      paymentConfirmed: false,
      matchConfidence: 'no-pms-holdings',
      matchMessage: 'Product not found in any PMS account'
    }));
  }

  // Query all operations with positive amounts for this product once
  // Match ANY operation with the same ISIN and positive amount (incoming payment)
  // Don't rely on operationType classification as banks differ
  const operations = await PMSOperationsCollection.find({
    isin: product.isin,
    isActive: true,
    $or: [
      { grossAmount: { $gt: 0 } },
      { netAmount: { $gt: 0 } }
    ]
  }).fetchAsync();

  // Match each observation
  const enhancedObservations = observations.map(obs => {
    const paymentDate = new Date(obs.paymentDate);

    // Skip coupons before PMS history cutoff (no data available before Dec 2025)
    if (paymentDate < PMS_HISTORY_CUTOFF) {
      return {
        ...obs,
        paymentConfirmed: false,
        matchConfidence: 'skipped-before-cutoff',
        matchMessage: 'Payment date before PMS history availability (Dec 2025)'
      };
    }

    const matchResult = matchScheduledPayment(product, obs, operations);

    // Determine if payment is past due (scheduled date passed but not confirmed)
    const today = new Date();
    const isPastDue = paymentDate < today && !matchResult.confirmed && obs.couponPaid > 0;

    return {
      ...obs,
      paymentConfirmed: matchResult.confirmed,
      confirmedPayment: matchResult.confirmedPayment,
      matchConfidence: matchResult.matchConfidence,
      matchScore: matchResult.matchScore,
      isPastDue,
      matchMessage: matchResult.message || matchResult.error || null
    };
  });

  return enhancedObservations;
}

export const PaymentMatcherHelpers = {
  matchScheduledPayment,
  matchAllScheduledPayments,
  datesMatch,
  amountsMatch
};
