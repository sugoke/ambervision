import { Meteor } from 'meteor/meteor';
import { EVENT_TYPES } from './notifications';

/**
 * Event Detector Service
 *
 * Compares previous report with new report to detect significant events
 * that should trigger notifications.
 */

export const EventDetector = {
  /**
   * Detect events by comparing previous and current reports
   * @param {Object} previousReport - Previous template report (or null if first evaluation)
   * @param {Object} currentReport - Current template report
   * @param {Object} product - Product data
   * @returns {Array} - Array of detected events
   */
  detectEvents(previousReport, currentReport, product) {
    const events = [];

    if (!currentReport || !currentReport.templateResults) {
      return events;
    }

    const current = currentReport.templateResults;
    const previous = previousReport?.templateResults;

    // Extract observation analysis
    const currentObs = current.observationAnalysis;
    const previousObs = previous?.observationAnalysis;

    // Detect coupon payments
    if (currentObs && currentObs.observations) {
      const newCoupons = this.detectCouponPayments(previousObs, currentObs);
      events.push(...newCoupons);
    }

    // Detect autocalls
    if (currentObs) {
      const autocallEvent = this.detectAutocall(previousObs, currentObs, product);
      if (autocallEvent) {
        events.push(autocallEvent);
      }
    }

    // Detect barrier breaches
    const barrierEvents = this.detectBarrierEvents(previous, current, product);
    events.push(...barrierEvents);

    // Detect final observation
    const finalObsEvent = this.detectFinalObservation(previousObs, currentObs, product);
    if (finalObsEvent) {
      events.push(finalObsEvent);
    }

    // Detect product maturation
    const maturityEvent = this.detectMaturity(previous, current, product);
    if (maturityEvent) {
      events.push(maturityEvent);
    }

    // Detect memory coupon additions
    if (currentObs) {
      const memoryCouponEvents = this.detectMemoryCoupons(previousObs, currentObs, product);
      events.push(...memoryCouponEvents);
    }

    return events;
  },

  /**
   * Detect new coupon payments
   */
  detectCouponPayments(previousObs, currentObs) {
    const events = [];

    if (!currentObs || !currentObs.observations) {
      return events;
    }

    const previousObservations = previousObs?.observations || [];
    const currentObservations = currentObs.observations;

    // Check each observation
    currentObservations.forEach((currObs, index) => {
      const prevObs = previousObservations[index];

      // New coupon paid (wasn't paid before, is paid now)
      const wasPaid = prevObs?.couponPaid > 0;
      const isPaid = currObs.couponPaid > 0;

      if (!wasPaid && isPaid && currObs.hasOccurred) {
        events.push({
          type: EVENT_TYPES.COUPON_PAID,
          date: new Date(currObs.observationDate),
          observationDate: new Date(currObs.observationDate),
          data: {
            couponRate: currObs.couponPaid,
            couponRateFormatted: currObs.couponPaidFormatted,
            observationType: currObs.observationType,
            basketLevel: currObs.basketLevel,
            basketLevelFormatted: currObs.basketLevelFormatted,
            observationIndex: index + 1,
            totalObservations: currentObservations.length
          },
          summary: `Coupon payment of ${currObs.couponPaidFormatted} occurred on ${currObs.observationDateFormatted}`
        });
      }
    });

    return events;
  },

  /**
   * Detect autocall trigger
   */
  detectAutocall(previousObs, currentObs, product) {
    if (!currentObs || !currentObs.observations) {
      return null;
    }

    const wasAutocalled = previousObs?.isEarlyAutocall;
    const isAutocalled = currentObs.isEarlyAutocall;

    // New autocall
    if (!wasAutocalled && isAutocalled) {
      // Find which observation triggered the autocall
      const autocallObs = currentObs.observations.find(obs => obs.autocalled);

      if (autocallObs) {
        return {
          type: EVENT_TYPES.AUTOCALL_TRIGGERED,
          date: new Date(autocallObs.observationDate),
          observationDate: new Date(autocallObs.observationDate),
          data: {
            autocallLevel: autocallObs.autocallLevel,
            autocallLevelFormatted: autocallObs.autocallLevelFormatted,
            basketLevel: autocallObs.basketLevel,
            basketLevelFormatted: autocallObs.basketLevelFormatted,
            couponPaid: autocallObs.couponPaid,
            couponPaidFormatted: autocallObs.couponPaidFormatted,
            observationIndex: currentObs.observations.indexOf(autocallObs) + 1,
            redemptionDate: autocallObs.paymentDateFormatted || autocallObs.observationDateFormatted,
            hasMemoryAutocall: currentObs.hasMemoryAutocall
          },
          summary: `Product autocalled early on ${autocallObs.observationDateFormatted} at ${autocallObs.basketLevelFormatted}`
        };
      }
    }

    return null;
  },

  /**
   * Detect barrier breaches and recoveries
   */
  detectBarrierEvents(previous, current, product) {
    const events = [];

    if (!current.underlyings || !Array.isArray(current.underlyings)) {
      return events;
    }

    const previousUnderlyings = previous?.underlyings || [];

    current.underlyings.forEach((currUnderlying, index) => {
      const prevUnderlying = previousUnderlyings[index];

      if (!currUnderlying || !currUnderlying.barrierStatus) {
        return;
      }

      const wasBreached = prevUnderlying?.barrierStatus === 'breached';
      const isBreached = currUnderlying.barrierStatus === 'breached';

      const wasNear = prevUnderlying?.barrierStatus === 'near';
      const isNear = currUnderlying.barrierStatus === 'near';

      const wasSafe = prevUnderlying?.barrierStatus === 'safe';
      const isSafe = currUnderlying.barrierStatus === 'safe';

      // New barrier breach
      if (!wasBreached && isBreached) {
        events.push({
          type: EVENT_TYPES.BARRIER_BREACHED,
          date: new Date(),
          observationDate: null,
          data: {
            underlyingTicker: currUnderlying.ticker,
            underlyingName: currUnderlying.name,
            performance: currUnderlying.performance,
            performanceFormatted: currUnderlying.performanceFormatted,
            distanceToBarrier: currUnderlying.distanceToBarrier,
            distanceToBarrierFormatted: currUnderlying.distanceToBarrierFormatted,
            barrierLevel: current.phoenixStructure?.protectionBarrier || current.basketAnalysis?.protectionBarrier,
            currentPrice: currUnderlying.currentPrice,
            currentPriceFormatted: currUnderlying.currentPriceFormatted,
            isWorstPerforming: currUnderlying.isWorstPerforming
          },
          summary: `${currUnderlying.ticker} breached protection barrier at ${currUnderlying.performanceFormatted}`
        });
      }

      // Near barrier warning
      if (!wasNear && isNear && !isBreached) {
        events.push({
          type: EVENT_TYPES.BARRIER_NEAR,
          date: new Date(),
          observationDate: null,
          data: {
            underlyingTicker: currUnderlying.ticker,
            underlyingName: currUnderlying.name,
            performance: currUnderlying.performance,
            performanceFormatted: currUnderlying.performanceFormatted,
            distanceToBarrier: currUnderlying.distanceToBarrier,
            distanceToBarrierFormatted: currUnderlying.distanceToBarrierFormatted,
            barrierLevel: current.phoenixStructure?.protectionBarrier || current.basketAnalysis?.protectionBarrier
          },
          summary: `${currUnderlying.ticker} is near protection barrier at ${currUnderlying.performanceFormatted}`
        });
      }

      // Barrier recovery
      if (wasBreached && !isBreached) {
        events.push({
          type: EVENT_TYPES.BARRIER_RECOVERED,
          date: new Date(),
          observationDate: null,
          data: {
            underlyingTicker: currUnderlying.ticker,
            underlyingName: currUnderlying.name,
            performance: currUnderlying.performance,
            performanceFormatted: currUnderlying.performanceFormatted,
            distanceToBarrier: currUnderlying.distanceToBarrier,
            distanceToBarrierFormatted: currUnderlying.distanceToBarrierFormatted
          },
          summary: `${currUnderlying.ticker} recovered above protection barrier at ${currUnderlying.performanceFormatted}`
        });
      }
    });

    return events;
  },

  /**
   * Detect final observation
   */
  detectFinalObservation(previousObs, currentObs, product) {
    if (!currentObs || !currentObs.observations || currentObs.observations.length === 0) {
      return null;
    }

    const previousObservations = previousObs?.observations || [];
    const currentObservations = currentObs.observations;

    const finalObs = currentObservations[currentObservations.length - 1];
    const prevFinalObs = previousObservations[previousObservations.length - 1];

    // Final observation just occurred
    const wasCompleted = prevFinalObs?.status === 'completed';
    const isCompleted = finalObs.status === 'completed';

    if (!wasCompleted && isCompleted && !currentObs.isEarlyAutocall) {
      return {
        type: EVENT_TYPES.FINAL_OBSERVATION,
        date: new Date(finalObs.observationDate),
        observationDate: new Date(finalObs.observationDate),
        data: {
          observationType: finalObs.observationType,
          basketLevel: finalObs.basketLevel,
          basketLevelFormatted: finalObs.basketLevelFormatted,
          couponPaid: finalObs.couponPaid,
          couponPaidFormatted: finalObs.couponPaidFormatted,
          totalCouponsEarned: currentObs.totalCouponsEarned,
          totalCouponsEarnedFormatted: currentObs.totalCouponsEarnedFormatted,
          memoryCouponsEarned: currentObs.totalMemoryCoupons,
          memoryCouponsEarnedFormatted: currentObs.totalMemoryCouponsFormatted
        },
        summary: `Final observation completed on ${finalObs.observationDateFormatted} at ${finalObs.basketLevelFormatted}`
      };
    }

    return null;
  },

  /**
   * Detect product maturity
   */
  detectMaturity(previous, current, product) {
    if (!current.currentStatus) {
      return null;
    }

    const wasMatured = previous?.currentStatus?.productStatus === 'matured' ||
                      previous?.currentStatus?.productStatus === 'redeemed';
    const isMatured = current.currentStatus.productStatus === 'matured' ||
                     current.currentStatus.productStatus === 'redeemed';

    if (!wasMatured && isMatured) {
      return {
        type: EVENT_TYPES.PRODUCT_MATURED,
        date: new Date(),
        observationDate: null,
        data: {
          productStatus: current.currentStatus.productStatus,
          finalPerformance: current.underlyings?.[0]?.performance,
          finalPerformanceFormatted: current.underlyings?.[0]?.performanceFormatted,
          totalReturn: current.currentStatus.statusDetails?.totalReturn,
          maturityDate: product.maturity || product.maturityDate
        },
        summary: `Product reached maturity and has been redeemed`
      };
    }

    return null;
  },

  /**
   * Detect memory coupon additions
   */
  detectMemoryCoupons(previousObs, currentObs, product) {
    const events = [];

    if (!currentObs || !currentObs.observations || !currentObs.hasMemoryCoupon) {
      return events;
    }

    const previousObservations = previousObs?.observations || [];
    const currentObservations = currentObs.observations;

    currentObservations.forEach((currObs, index) => {
      const prevObs = previousObservations[index];

      // New memory coupon added
      const wasMemoryAdded = prevObs?.memoryCouponAdded;
      const isMemoryAdded = currObs.memoryCouponAdded;

      if (!wasMemoryAdded && isMemoryAdded && currObs.hasOccurred) {
        const phoenixStructure = currentReport?.templateResults?.phoenixStructure;
        const couponRate = phoenixStructure?.couponRate || 0;

        events.push({
          type: EVENT_TYPES.MEMORY_COUPON_ADDED,
          date: new Date(currObs.observationDate),
          observationDate: new Date(currObs.observationDate),
          data: {
            couponRate,
            couponRateFormatted: `${couponRate.toFixed(1)}%`,
            basketLevel: currObs.basketLevel,
            basketLevelFormatted: currObs.basketLevelFormatted,
            totalMemoryCoupons: currObs.couponInMemory,
            totalMemoryCouponsFormatted: currObs.couponInMemoryFormatted,
            observationIndex: index + 1
          },
          summary: `Coupon of ${couponRate.toFixed(1)}% added to memory on ${currObs.observationDateFormatted}`
        });
      }
    });

    return events;
  }
};
