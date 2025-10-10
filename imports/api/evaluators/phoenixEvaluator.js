import { PhoenixEvaluationHelpers } from './phoenixEvaluationHelpers';
import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Phoenix Autocallable Evaluator
 *
 * Handles evaluation logic specific to Phoenix Autocallable products.
 * Phoenix products feature:
 * - Autocall barriers (early redemption opportunities)
 * - Memory coupons
 * - Capital protection barriers
 * - Quarterly or custom observation frequencies
 */
export const PhoenixEvaluator = {
  /**
   * Generate report for Phoenix Autocallable product
   */
  async generateReport(product, context) {
    // Set redemption prices for redeemed products
    await PhoenixEvaluationHelpers.setRedemptionPricesForProduct(product);

    // Extract key Phoenix parameters from product structure
    const phoenixParams = this.extractPhoenixParameters(product);

    // Extract underlying assets data with proper pricing hierarchy
    const underlyingAssets = PhoenixEvaluationHelpers.extractUnderlyingAssetsData(product);

    // Build observation analysis first (needed for memory autocall flags)
    const observationAnalysis = this.buildObservationSchedule
      ? await this.buildObservationSchedule(product, underlyingAssets, phoenixParams)
      : null;

    // Create evaluation results
    const evaluation = {
      // Template identification
      templateType: 'phoenix_autocallable',
      templateVersion: '1.0.0',

      // Key product features detected
      features: {
        hasAutocall: phoenixParams.autocallBarrier > 0,
        hasMemoryCoupon: phoenixParams.couponRate > 0,
        hasProtection: phoenixParams.protectionBarrier > 0,
        observationFrequency: phoenixParams.observationFrequency || 'quarterly'
      },

      // Current status evaluation
      currentStatus: PhoenixEvaluationHelpers.buildProductStatus(product),

      // Phoenix-specific parameters
      phoenixStructure: phoenixParams,

      // Underlying assets data with proper pricing and chart data (includes memory autocall flags)
      underlyings: this.enhanceUnderlyingsWithChartData(underlyingAssets, phoenixParams, observationAnalysis),

      // Basket analysis for chart visualization
      basketAnalysis: this.buildBasketAnalysis(underlyingAssets, phoenixParams),

      // Observation analysis
      observationAnalysis,

      // Product name
      generatedProductName: PhoenixEvaluationHelpers.generateProductName(product, underlyingAssets, phoenixParams),

      // Legacy placeholder for compatibility
      placeholderResults: {
        message: 'Phoenix Autocallable evaluation completed',
        autocallTriggered: false,
        couponPayment: 0,
        capitalProtection: phoenixParams.protectionBarrier,
        explanation: `This Phoenix product has ${phoenixParams.autocallBarrier}% autocall barrier, ${phoenixParams.couponRate}% memory coupon, and ${phoenixParams.protectionBarrier}% capital protection.`
      }
    };

    return evaluation;
  },

  /**
   * Extract Phoenix Autocallable parameters from product structure
   */
  extractPhoenixParameters(product) {
    const params = {
      autocallBarrier: 100,     // Default 100% autocall level
      protectionBarrier: 70,    // Default 70% protection
      couponRate: 0,           // Default no coupon
      observationFrequency: 'quarterly',
      memoryCoupon: false,
      memoryAutocall: false,
      oneStarRating: false      // Default no one star rating
    };

    // Extract from payoffStructure if available
    if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
      product.payoffStructure.forEach(component => {
        // Look for autocall barrier
        if (component.type === 'barrier' && component.barrier_type === 'autocall') {
          params.autocallBarrier = component.barrier_level || 100;
        }

        // Look for protection barrier
        if (component.type === 'barrier' && component.barrier_type === 'protection') {
          params.protectionBarrier = component.barrier_level || 70;
        }

        // Look for coupon information
        if (component.type === 'action' && component.value && component.value.toLowerCase().includes('coupon')) {
          // Try to extract percentage from action value
          const match = component.value.match(/(\d+(?:\.\d+)?)\s*%/);
          if (match) {
            params.couponRate = parseFloat(match[1]);
          }
        }

        // Look for observation frequency
        if (component.type === 'observation') {
          if (component.column === 'quarterly') {
            params.observationFrequency = 'quarterly';
          } else if (component.column === 'monthly') {
            params.observationFrequency = 'monthly';
          } else if (component.column === 'annually') {
            params.observationFrequency = 'annually';
          }
        }
      });
    }

    // Override with structureParams if available (newer products)
    if (product.structureParams) {
      if (product.structureParams.autocallBarrierLevel) {
        params.autocallBarrier = product.structureParams.autocallBarrierLevel;
      }

      // Phoenix products should use protectionBarrierLevel as the primary parameter
      if (product.structureParams.protectionBarrierLevel) {
        params.protectionBarrier = product.structureParams.protectionBarrierLevel;
      } else {
        // Fallback for legacy products that may have other fields
        if (product.structureParams.protectionLevel) {
          params.protectionBarrier = product.structureParams.protectionLevel;
        } else if (product.structureParams.capitalProtection) {
          params.protectionBarrier = product.structureParams.capitalProtection;
        }
      }

      if (product.structureParams.couponRate !== undefined) {
        params.couponRate = product.structureParams.couponRate;
      }

      if (product.structureParams.memoryCoupon !== undefined) {
        params.memoryCoupon = product.structureParams.memoryCoupon;
      }

      if (product.structureParams.memoryAutocall !== undefined) {
        params.memoryAutocall = product.structureParams.memoryAutocall;
      }

      if (product.structureParams.oneStarRating !== undefined) {
        params.oneStarRating = product.structureParams.oneStarRating;
      }

      if (product.structureParams.couponFrequency) {
        params.observationFrequency = product.structureParams.couponFrequency;
      }
    }

    return params;
  },

  /**
   * Enhance underlyings with chart data for bar visualization
   */
  enhanceUnderlyingsWithChartData(underlyings, phoenixParams, observationAnalysis) {
    if (!underlyings || underlyings.length === 0) return underlyings;

    const protectionBarrier = phoenixParams.protectionBarrier || 70;

    // Find worst performing underlying
    const performances = underlyings.map(u => u.performance);
    const worstPerformance = Math.min(...performances);

    // Get memory autocall flags from observation analysis
    const underlyingAutocallFlags = observationAnalysis?.underlyingAutocallFlags || {};

    return underlyings.map(underlying => {
      const isWorstPerforming = underlying.performance === worstPerformance;
      const performance = underlying.performance || 0;
      const isPositive = performance >= 0;

      // Check if this underlying has been flagged for memory autocall
      const hasMemoryAutocallFlag = !!underlyingAutocallFlags[underlying.ticker];
      const memoryAutocallFlaggedDate = underlyingAutocallFlags[underlying.ticker] || null;

      // Calculate distance to barrier
      // Performance of 70% means current = 70% of initial
      // Protection barrier of 70% means barrier is at 70% of initial
      // Distance = current performance - (barrier - 100)
      // Example: performance = -20%, barrier = 70% => distance = -20 - (70-100) = -20 - (-30) = +10%
      const barrierLevel = protectionBarrier - 100; // e.g., 70 - 100 = -30%
      const distanceToBarrier = performance - barrierLevel;

      // Determine barrier status
      let barrierStatus = 'safe';
      let barrierStatusText = 'Safe';
      if (performance < barrierLevel) {
        barrierStatus = 'breached';
        barrierStatusText = 'Breached';
      } else if (distanceToBarrier < 10) { // Within 10% of barrier
        barrierStatus = 'near';
        barrierStatusText = 'Near Barrier';
      }

      // Calculate bar chart properties for performance visualization
      const chartData = {
        isPositive,
        width: '100px',
        // Bar height calculation: scale -50% to +50% range to 0-220px
        barHeight: `${Math.abs(performance) * 2.2}px`,
        zeroPoint: '110px', // Middle of 220px chart
        gradient: isPositive
          ? 'linear-gradient(180deg, #10b981 0%, #059669 100%)'
          : 'linear-gradient(180deg, #ef4444 0%, #dc2626 100%)',
        borderRadius: isPositive ? '6px 6px 0 0' : '0 0 6px 6px',
        border: isWorstPerforming ? '2px solid #ef4444' : 'none',
        boxShadow: isPositive
          ? '0 4px 12px rgba(16, 185, 129, 0.4)'
          : '0 4px 12px rgba(239, 68, 68, 0.4)'
      };

      return {
        ...underlying,
        isWorstPerforming,
        distanceToBarrier,
        distanceToBarrierFormatted: `${distanceToBarrier >= 0 ? '+' : ''}${distanceToBarrier.toFixed(1)}%`,
        barrierStatus,
        barrierStatusText,
        chartData,
        // Memory Autocall flag
        hasMemoryAutocallFlag,
        memoryAutocallFlaggedDate,
        memoryAutocallFlaggedDateFormatted: memoryAutocallFlaggedDate ?
          new Date(memoryAutocallFlaggedDate).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
          }) : null
      };
    });
  },

  /**
   * Build basket analysis including barrier chart configuration
   */
  buildBasketAnalysis(underlyings, phoenixParams) {
    if (!underlyings || underlyings.length === 0) return null;

    const protectionBarrier = phoenixParams.protectionBarrier || 70;

    // Count underlyings by barrier status
    const safeCount = underlyings.filter(u => u.barrierStatus === 'safe').length;
    const nearCount = underlyings.filter(u => u.barrierStatus === 'near').length;
    const breachedCount = underlyings.filter(u => u.barrierStatus === 'breached').length;

    // Determine overall status
    let overallStatus = 'All underlyings above protection barrier';
    if (breachedCount > 0) {
      overallStatus = `${breachedCount} underlying${breachedCount > 1 ? 's have' : ' has'} breached protection barrier`;
    } else if (nearCount > 0) {
      overallStatus = `${nearCount} underlying${nearCount > 1 ? 's are' : ' is'} near protection barrier`;
    }

    // Find critical distance (worst-of)
    const distances = underlyings.map(u => u.distanceToBarrier).filter(d => d !== undefined);
    const criticalDistance = distances.length > 0 ? Math.min(...distances) : 0;

    // Calculate barrier position in chart (50% range from -50 to +50)
    // Protection barrier of 70% means -30% from initial, position = 50 + 30 = 80% from top
    const barrierOffset = 100 - protectionBarrier;
    const barrierPosition = 50 + barrierOffset; // 50% is zero line

    return {
      protectionBarrier,
      criticalDistance,
      criticalDistanceFormatted: `${criticalDistance >= 0 ? '+' : ''}${criticalDistance.toFixed(1)}%`,
      safeCount,
      nearCount,
      breachedCount,
      overallStatus,
      barrierChartConfig: {
        position: barrierPosition,
        level: protectionBarrier,
        label: `${protectionBarrier}% Protection`
      }
    };
  },

  /**
   * Get historical price for a ticker at a specific date
   */
  async getPriceAtDate(ticker, targetDate, tradeDate) {
    try {
      const targetDateStr = new Date(targetDate).toISOString().split('T')[0];
      const tradeDateStr = new Date(tradeDate).toISOString().split('T')[0];

      console.log(`🔍 Fetching price for ${ticker} at ${targetDateStr}`);

      let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: ticker });

      // Try alternative exchanges if not found
      if (!cacheDoc) {
        const symbol = ticker.split('.')[0];
        const exchanges = ['US', 'PA', 'DE', 'LSE', 'CO'];
        for (const exchange of exchanges) {
          const altTicker = `${symbol}.${exchange}`;
          cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: altTicker });
          if (cacheDoc) {
            console.log(`✅ Found data for ${altTicker} (alternative ticker)`);
            break;
          }
        }
      } else {
        console.log(`✅ Found data for ${ticker}`);
      }

      if (!cacheDoc || !cacheDoc.history || cacheDoc.history.length === 0) {
        console.warn(`❌ No historical data found in MarketDataCacheCollection for ${ticker}`);
        return null;
      }

      // Find the exact date or closest prior date
      const priceRecord = cacheDoc.history.find(record =>
        new Date(record.date).toISOString().split('T')[0] === targetDateStr
      );

      if (priceRecord) {
        const price = priceRecord.adjustedClose || priceRecord.close;
        console.log(`✅ Found exact price for ${ticker} at ${targetDateStr}: $${price}`);
        return price;
      }

      // If exact date not found, try to find closest prior date
      const priorRecords = cacheDoc.history.filter(record => {
        const recordDate = new Date(record.date).toISOString().split('T')[0];
        return recordDate <= targetDateStr && recordDate >= tradeDateStr;
      });

      if (priorRecords.length > 0) {
        const closest = priorRecords[priorRecords.length - 1];
        const price = closest.adjustedClose || closest.close;
        const closestDate = new Date(closest.date).toISOString().split('T')[0];
        console.log(`✅ Using closest prior price for ${ticker}: $${price} from ${closestDate} (requested ${targetDateStr})`);
        return price;
      }

      console.warn(`❌ No price data found for ${ticker} between ${tradeDateStr} and ${targetDateStr}`);
      return null;
    } catch (error) {
      console.error(`❌ Error fetching price for ${ticker} at ${targetDate}:`, error);
      return null;
    }
  },

  /**
   * Build observation schedule analysis
   */
  async buildObservationSchedule(product, underlyings, phoenixParams) {
    const schedule = product.observationSchedule || [];

    if (schedule.length === 0) {
      return {
        totalObservations: 0,
        nextObservation: null,
        observations: [],
        totalCouponsEarnedFormatted: '0%',
        totalMemoryCouponsFormatted: '0%',
        remainingObservations: 0,
        hasMemoryAutocall: phoenixParams.memoryAutocall || false,
        hasMemoryCoupon: phoenixParams.memoryCoupon || false,
        underlyingAutocallFlags: {}
      };
    }

    const today = new Date();
    const tradeDate = new Date(product.tradeDate || product.issueDate);
    const observations = [];
    let totalCouponsEarned = 0;
    let totalMemoryCoupons = 0;
    let productCalled = false;
    let callDate = null;

    // Memory Autocall: Track which underlyings have reached autocall level (across any observation)
    const underlyingAutocallFlags = {}; // {ticker: firstFlaggedDate}

    // Process each observation
    for (const [i, obs] of schedule.entries()) {
      const obsDate = new Date(obs.observationDate);
      const isPast = obsDate <= today;

      // Calculate basket level (worst-of performance) at this observation date
      // AND per-underlying performance for memory autocall tracking
      let basketLevel = 0;
      let hasAllHistoricalData = true;
      const underlyingPerformances = []; // Store {ticker, performance, price} for each underlying

      if (underlyings.length > 0 && isPast) {
        // For past observations, fetch historical prices from MarketDataCacheCollection
        const performanceData = await Promise.all(
          underlyings.map(async (u) => {
            const fullTicker = u.fullTicker || `${u.ticker}.US`;
            const obsPrice = await this.getPriceAtDate(fullTicker, obsDate, tradeDate);
            const initialPrice = u.initialPrice || u.strike;

            if (obsPrice && initialPrice) {
              const performance = ((obsPrice - initialPrice) / initialPrice) * 100;
              return {
                ticker: u.ticker,
                performance,
                price: obsPrice,
                initialPrice
              };
            }

            // ❌ NO FALLBACK - Missing historical data is a data quality issue
            // Log warning for missing historical data
            console.warn(`⚠️ Missing historical price for ${fullTicker} at ${obsDate.toISOString().split('T')[0]} - skipping observation calculation`);
            hasAllHistoricalData = false;
            return null;
          })
        );

        // Filter out null entries and store valid performances
        const validPerformances = performanceData.filter(p => p !== null);
        if (hasAllHistoricalData && validPerformances.length === underlyings.length) {
          underlyingPerformances.push(...validPerformances);
          basketLevel = Math.min(...validPerformances.map(p => p.performance));
        } else {
          // Mark this observation as incomplete due to missing data
          basketLevel = null;
          console.warn(`⚠️ Incomplete historical data for observation ${i + 1} on ${obsDate.toISOString().split('T')[0]} - cannot determine basket level`);
        }
      }

      // For future observations, basket level is unknown
      if (!isPast) {
        basketLevel = 0; // Will be calculated when the date arrives
      }

      // Convert barrier levels to performance thresholds
      // autocallBarrier of 100 means 0% performance (100-100=0)
      // protectionBarrier of 70 means -30% performance (70-100=-30)
      const autocallThreshold = (phoenixParams.autocallBarrier || 100) - 100;
      const couponThreshold = (phoenixParams.protectionBarrier || 70) - 100;

      // Memory Autocall: Track per-underlying flags
      // IMPORTANT: Only flag underlyings during CALLABLE observations (not during coupon-only periods)
      const underlyingFlags = [];
      if (isPast && underlyingPerformances.length > 0) {
        for (const perf of underlyingPerformances) {
          const wasAlreadyFlagged = !!underlyingAutocallFlags[perf.ticker];

          // Only check for flagging if this is a callable observation
          let isFlagged = wasAlreadyFlagged; // Preserve existing flags
          let isNewFlag = false;

          if (obs.isCallable) {
            // This is a callable observation - check if underlying reaches autocall level
            const reachesAutocallLevel = perf.performance >= autocallThreshold;

            if (reachesAutocallLevel && !wasAlreadyFlagged) {
              // Flag this underlying for the first time
              underlyingAutocallFlags[perf.ticker] = obsDate.toISOString().split('T')[0];
              isFlagged = true;
              isNewFlag = true;
            } else if (reachesAutocallLevel) {
              // Already flagged, still above level
              isFlagged = true;
            }
          }

          underlyingFlags.push({
            ticker: perf.ticker,
            performance: perf.performance,
            performanceFormatted: `${perf.performance >= 0 ? '+' : ''}${perf.performance.toFixed(2)}%`,
            isFlagged,
            isNewFlag,
            flaggedDate: underlyingAutocallFlags[perf.ticker] || null,
            isCallableObservation: obs.isCallable || false
          });
        }
      } else if (!isPast) {
        // For future observations, show all underlyings with their current flag status
        for (const u of underlyings) {
          underlyingFlags.push({
            ticker: u.ticker,
            performance: null,
            performanceFormatted: 'TBD',
            isFlagged: !!underlyingAutocallFlags[u.ticker], // Show if already flagged
            isNewFlag: false,
            flaggedDate: underlyingAutocallFlags[u.ticker] || null,
            isCallableObservation: obs.isCallable || false
          });
        }
      }

      // Check if all underlyings have been flagged (memory autocall condition)
      const allUnderlyingsFlagged = underlyings.length > 0 &&
        Object.keys(underlyingAutocallFlags).length === underlyings.length;

      // Handle null basketLevel (missing historical data)
      const basketAboveBarrier = basketLevel !== null && basketLevel >= autocallThreshold;
      const basketAboveCouponBarrier = basketLevel !== null && basketLevel >= couponThreshold;

      // Determine if coupon is paid (chart builder expects number, not boolean)
      // Only evaluate if we have valid basket level data
      const couponPaid = isPast && basketLevel !== null && basketAboveCouponBarrier ? (phoenixParams.couponRate || 0) : 0;
      const couponAmount = couponPaid;

      if (couponPaid > 0) {
        totalCouponsEarned += couponAmount;
      }

      // Check for autocall - logic depends on memory autocall setting
      let autocalled = false;
      if (isPast && obs.isCallable && !productCalled) {
        if (phoenixParams.memoryAutocall) {
          // Memory Autocall: product autocalls when ALL underlyings have been flagged (can be on different dates)
          autocalled = allUnderlyingsFlagged;
        } else {
          // Standard Autocall: product autocalls when basket level is above barrier (all must be above on same date)
          autocalled = basketLevel !== null && basketAboveBarrier;
        }

        if (autocalled) {
          productCalled = true;
          callDate = obs.observationDate;
        }
      }

      // Memory coupon logic
      // Add to memory if: basket BELOW coupon barrier, product has memory feature, and it's a past observation
      const memoryCouponAdded = isPast && !couponPaid && basketLevel !== null && !basketAboveCouponBarrier && (phoenixParams.memoryCoupon || false);
      if (memoryCouponAdded) {
        totalMemoryCoupons += phoenixParams.couponRate || 0;
      }

      // Determine observation type
      const isFinalObservation = i === schedule.length - 1;
      let observationType = 'Coupon Only';
      if (obs.isCallable) {
        observationType = isFinalObservation ? 'Maturity & Coupon' : 'Autocall & Coupon';
      }

      // Calculate memory coupon amount for this observation
      const couponInMemory = memoryCouponAdded ? (phoenixParams.couponRate || 0) : 0;

      // For final observation or autocall, show cumulative memory coupons if any exist
      // BUT ONLY if the observation has occurred (isPast = true)
      const showCumulativeMemory = isPast && (isFinalObservation || autocalled) && totalMemoryCoupons > 0;
      const displayMemory = showCumulativeMemory ? totalMemoryCoupons : couponInMemory;

      observations.push({
        observationDate: obs.observationDate,
        observationDateFormatted: new Date(obs.observationDate).toLocaleDateString(),
        paymentDate: obs.valueDate,
        paymentDateFormatted: obs.valueDate ? new Date(obs.valueDate).toLocaleDateString() : null,
        observationType,
        basketLevel,
        basketLevelFormatted: basketLevel !== null ? `${basketLevel >= 0 ? '+' : ''}${basketLevel.toFixed(2)}%` : 'N/A (Missing Data)',
        basketPerformance: basketLevel, // For chart annotations
        basketAboveBarrier,
        couponPaid,
        couponAmount,
        couponAmountFormatted: `${couponAmount.toFixed(1)}%`,
        couponPaidFormatted: `${couponPaid.toFixed(1)}%`,
        memoryCouponAdded,
        couponInMemory: displayMemory,
        couponInMemoryFormatted: `${displayMemory.toFixed(1)}%`,
        autocalled,
        productCalled: autocalled, // For redemption detection
        autocallLevel: obs.isCallable ? (obs.autocallLevel || phoenixParams.autocallBarrier) : null,
        autocallLevelFormatted: obs.isCallable ? `${obs.autocallLevel || phoenixParams.autocallBarrier}%` : 'N/A',
        isCallable: obs.isCallable || false,
        hasOccurred: isPast,
        status: isPast ? 'completed' : 'upcoming',
        // Memory Autocall tracking
        underlyingFlags, // Array of {ticker, performance, isFlagged, isNewFlag, flaggedDate}
        allUnderlyingsFlagged // Boolean: have all underlyings been flagged?
      });
    }

    const remainingObservations = observations.filter(o => o.status === 'upcoming').length;

    return {
      totalObservations: schedule.length,
      observations,
      totalCouponsEarnedFormatted: `${totalCouponsEarned.toFixed(1)}%`,
      totalMemoryCouponsFormatted: `${totalMemoryCoupons.toFixed(1)}%`,
      totalCouponsEarned,
      totalMemoryCoupons,
      remainingObservations,
      hasMemoryAutocall: phoenixParams.memoryAutocall || false,
      hasMemoryCoupon: phoenixParams.memoryCoupon || false,
      isEarlyAutocall: productCalled,
      callDate,
      callDateFormatted: callDate ? new Date(callDate).toLocaleDateString() : null,
      isMaturedAtFinal: !productCalled && observations.length > 0 && observations[observations.length - 1].status === 'completed',
      nextObservation: PhoenixEvaluationHelpers.getNextObservationDate(product),
      // Memory Autocall tracking
      underlyingAutocallFlags // {ticker: firstFlaggedDate}
    };
  }
};
