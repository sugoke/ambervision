import { PhoenixEvaluationHelpers } from './phoenixEvaluationHelpers';
import { MarketDataCacheCollection } from '/imports/api/marketDataCache';
import { matchAllScheduledPayments } from '../helpers/paymentMatcher.js';

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

    // Extract underlying assets data with proper pricing hierarchy (includes news)
    const underlyingAssets = await PhoenixEvaluationHelpers.extractUnderlyingAssetsData(product);

    // Build observation analysis first (needed for memory autocall flags)
    const observationAnalysis = this.buildObservationSchedule
      ? await this.buildObservationSchedule(product, underlyingAssets, phoenixParams)
      : null;

    // Enhance underlyings with barrier status and chart data
    // IMPORTANT: Must be done BEFORE buildBasketAnalysis to ensure barrier status is calculated
    const enhancedUnderlyings = this.enhanceUnderlyingsWithChartData(underlyingAssets, phoenixParams, observationAnalysis);

    // Calculate indicative maturity value (hypothetical redemption if product matured today)
    const indicativeMaturityValue = PhoenixEvaluationHelpers.calculateIndicativeMaturityValue(
      product,
      underlyingAssets,
      observationAnalysis,
      phoenixParams,
      product.currency || 'USD'
    );

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

      // Current status evaluation (includes autocall detection)
      currentStatus: PhoenixEvaluationHelpers.buildProductStatus(product, observationAnalysis),

      // Phoenix-specific parameters
      phoenixStructure: phoenixParams,

      // Underlying assets data with proper pricing and chart data (includes memory autocall flags)
      underlyings: enhancedUnderlyings,

      // Basket analysis for chart visualization - uses enhanced underlyings with barrier status
      basketAnalysis: this.buildBasketAnalysis(enhancedUnderlyings, phoenixParams),

      // Observation analysis
      observationAnalysis,

      // Indicative maturity value (hypothetical value if product matured today)
      indicativeMaturityValue,

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
      couponBarrier: null,      // Separate coupon barrier (defaults to protectionBarrier if null)
      couponRate: 0,           // Default no coupon
      observationFrequency: 'quarterly',
      memoryCoupon: false,
      memoryAutocall: false,
      oneStarRating: false,     // Default no one star rating
      guaranteedCoupon: false   // Default no guaranteed coupon
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

      // Extract separate coupon barrier if defined (can be different from protection barrier)
      if (product.structureParams.couponBarrier !== undefined) {
        params.couponBarrier = product.structureParams.couponBarrier;
      } else if (product.structureParams.memoryBarrier !== undefined) {
        params.couponBarrier = product.structureParams.memoryBarrier;
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

      if (product.structureParams.guaranteedCoupon !== undefined) {
        params.guaranteedCoupon = product.structureParams.guaranteedCoupon;
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
          new Date(memoryAutocallFlaggedDate).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: '2-digit',
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
   * Generate observation schedule automatically if missing
   */
  generateObservationSchedule(product, phoenixParams) {
    const tradeDate = new Date(product.tradeDate || product.issueDate || product.valueDate);
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const frequency = phoenixParams.observationFrequency || 'quarterly';

    // Calculate interval in months
    const intervalMonths = {
      'monthly': 1,
      'quarterly': 3,
      'semi-annual': 6,
      'annually': 12
    }[frequency] || 3; // Default to quarterly

    const schedule = [];
    let currentDate = new Date(tradeDate);

    // Generate observations from trade date to maturity
    while (currentDate < maturityDate) {
      // Add interval months
      currentDate = new Date(currentDate);
      currentDate.setMonth(currentDate.getMonth() + intervalMonths);

      // Don't go past maturity
      if (currentDate > maturityDate) {
        currentDate = maturityDate;
      }

      schedule.push({
        observationDate: currentDate.toISOString(),
        valueDate: currentDate.toISOString(), // Same as observation date by default
        isCallable: true, // Phoenix products can autocall at any observation
        autocallLevel: phoenixParams.autocallBarrier || 100
      });

      // Break if we've reached maturity
      if (currentDate >= maturityDate) {
        break;
      }
    }

    console.log(`🔧 Phoenix: Generated ${schedule.length} observations for product (${frequency} frequency)`);
    return schedule;
  },

  /**
   * Build observation schedule analysis
   */
  async buildObservationSchedule(product, underlyings, phoenixParams) {
    let schedule = product.observationSchedule || [];

    // Generate schedule if missing
    if (schedule.length === 0) {
      console.log(`⚠️ Phoenix: Product missing observationSchedule, generating automatically`);
      schedule = this.generateObservationSchedule(product, phoenixParams);

      // If still empty after generation (shouldn't happen), return empty structure
      if (schedule.length === 0) {
        return {
          totalObservations: 0,
          nextObservation: null,
          observations: [],
          totalCouponsEarnedFormatted: PhoenixEvaluationHelpers.formatCouponPercentage(0, phoenixParams.couponRate),
          totalMemoryCouponsFormatted: PhoenixEvaluationHelpers.formatCouponPercentage(0, phoenixParams.couponRate),
          remainingObservations: 0,
          hasMemoryAutocall: phoenixParams.memoryAutocall || false,
          hasMemoryCoupon: phoenixParams.memoryCoupon || false,
          hasGuaranteedCoupon: phoenixParams.guaranteedCoupon || false,
          underlyingAutocallFlags: {}
        };
      }
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

    // Pre-fetch trade date prices for all underlyings (for consistent performance calculation)
    // This ensures the evaluator uses the same initial price as the chart builder
    const tradeDatePrices = {};
    for (const u of underlyings) {
      const fullTicker = u.fullTicker || `${u.ticker}.US`;
      const tradeDatePrice = await this.getPriceAtDate(fullTicker, tradeDate, tradeDate);
      tradeDatePrices[u.ticker] = tradeDatePrice || u.initialPrice || u.strike;
      console.log(`📊 Phoenix: Trade date price for ${fullTicker}: ${tradeDatePrices[u.ticker]} (market data: ${tradeDatePrice}, stored strike: ${u.strike})`);
    }

    // Process each observation
    for (const [i, obs] of schedule.entries()) {
      const obsDate = new Date(obs.observationDate);
      const today = new Date();
      const obsDateOnly = new Date(obsDate.getFullYear(), obsDate.getMonth(), obsDate.getDate());
      const todayOnly = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      // Determine if observation has occurred based on DATE, not data availability
      // An observation has occurred if its date is in the past
      const isPast = obsDateOnly < todayOnly;
      let basketLevel = null;
      let hasAllHistoricalData = true;
      const underlyingPerformances = []; // Store {ticker, performance, price} for each underlying

      // For past observations, try to fetch historical data to calculate basket level
      if (isPast && underlyings.length > 0) {
        // Try to fetch historical prices from MarketDataCacheCollection
        const performanceData = await Promise.all(
          underlyings.map(async (u) => {
            const fullTicker = u.fullTicker || `${u.ticker}.US`;
            const obsPrice = await this.getPriceAtDate(fullTicker, obsDate, tradeDate);

            // Use pre-fetched trade date price for consistent performance calculation
            // This ensures the evaluator uses the same initial price as the chart builder
            const initialPrice = tradeDatePrices[u.ticker];

            if (obsPrice && initialPrice) {
              const performance = ((obsPrice - initialPrice) / initialPrice) * 100;
              return {
                ticker: u.ticker,
                performance,
                price: obsPrice,
                initialPrice
              };
            }

            // Missing historical data - log but don't prevent observation from being marked as past
            console.warn(`⚠️ Missing historical price for ${fullTicker} at ${obsDate.toISOString().split('T')[0]} - data gap (observation still marked as occurred)`);
            hasAllHistoricalData = false;
            return null;
          })
        );

        // Filter out null entries and store valid performances
        const validPerformances = performanceData.filter(p => p !== null);
        if (hasAllHistoricalData && validPerformances.length === underlyings.length) {
          // Successfully retrieved all data - can calculate basket level
          underlyingPerformances.push(...validPerformances);
          basketLevel = Math.min(...validPerformances.map(p => p.performance));
        } else {
          // Could not retrieve complete data - basket level unknown but observation still occurred
          basketLevel = null;
          console.warn(`⚠️ Incomplete historical data for observation ${i + 1} on ${obsDate.toISOString().split('T')[0]} - basket level unknown`);
        }
      }

      // For future observations, basket level is unknown
      if (!isPast) {
        basketLevel = null; // Will be calculated when the date arrives
      }

      // Convert barrier levels to performance thresholds
      // autocallBarrier of 100 means 0% performance (100-100=0)
      // protectionBarrier of 70 means -30% performance (70-100=-30)
      const autocallThreshold = (phoenixParams.autocallBarrier || 100) - 100;
      // Use per-observation couponBarrier, fall back to global couponBarrier, then protectionBarrier
      const effectiveCouponBarrier = obs.couponBarrier || phoenixParams.couponBarrier || phoenixParams.protectionBarrier || 70;
      const couponThreshold = effectiveCouponBarrier - 100;

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

      // Check if guaranteed coupon feature is enabled
      const isGuaranteedCoupon = phoenixParams.guaranteedCoupon === true;

      // Determine if coupon is paid (chart builder expects number, not boolean)
      // Only evaluate if we have valid basket level data
      // For guaranteed coupons: pay as long as observation is past and product is alive
      // For regular coupons: require basket to be above coupon barrier
      const baseCouponPaid = isPast && basketLevel !== null && (isGuaranteedCoupon || basketAboveCouponBarrier)
        ? (phoenixParams.couponRate || 0)
        : 0;

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
      // Note: Memory coupon only applies if NOT guaranteed coupon (guaranteed coupons are always paid, so no need to store in memory)
      const memoryCouponAdded = !isGuaranteedCoupon && isPast && !baseCouponPaid && basketLevel !== null && !basketAboveCouponBarrier && (phoenixParams.memoryCoupon || false);
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
      // Only show in Memory column if coupon is being STORED (not paid)
      const couponInMemory = memoryCouponAdded ? (phoenixParams.couponRate || 0) : 0;

      // Memory Release Logic:
      // Memory coupons are released (paid out) whenever the basket returns ABOVE the coupon barrier
      // This happens at ANY observation where a coupon is paid, not just maturity/autocall
      // The accumulated memory gets added to the current coupon payment
      const isMemoryReleaseEvent = isPast && baseCouponPaid > 0 && totalMemoryCoupons > 0;

      // For display purposes: Memory column shows ONLY when coupon is stored in memory
      // When memory is released (paid out), it goes to the Coupon column, not Memory column
      // An observation can EITHER store a coupon in memory OR pay out (with accumulated memory) - never both
      const displayMemory = couponInMemory;

      // Calculate total coupon payout for this observation
      // When memory coupons are released, include accumulated memory in the coupon paid amount
      const couponPaid = baseCouponPaid + (isMemoryReleaseEvent ? totalMemoryCoupons : 0);
      const couponAmount = couponPaid;

      if (couponPaid > 0) {
        totalCouponsEarned += couponAmount;
      }

      // Reset memory bucket to 0 after memory coupons are paid out
      // This happens whenever the basket returns above coupon barrier and a coupon is paid
      if (isMemoryReleaseEvent) {
        totalMemoryCoupons = 0;
      }

      observations.push({
        observationDate: obs.observationDate,
        observationDateFormatted: new Date(obs.observationDate).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }),
        paymentDate: obs.valueDate,
        paymentDateFormatted: obs.valueDate ? new Date(obs.valueDate).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }) : null,
        observationType,
        basketLevel,
        basketLevelFormatted: basketLevel !== null ? `${basketLevel >= 0 ? '+' : ''}${basketLevel.toFixed(2)}%` : 'N/A (Missing Data)',
        basketPerformance: basketLevel, // For chart annotations
        basketAboveBarrier,
        couponPaid,
        couponAmount,
        couponAmountFormatted: PhoenixEvaluationHelpers.formatCouponPercentage(couponAmount, phoenixParams.couponRate),
        couponPaidFormatted: PhoenixEvaluationHelpers.formatCouponPercentage(couponPaid, phoenixParams.couponRate),
        memoryCouponAdded,
        couponInMemory: displayMemory,
        couponInMemoryFormatted: PhoenixEvaluationHelpers.formatCouponPercentage(displayMemory, phoenixParams.couponRate),
        autocalled,
        productCalled: autocalled, // For redemption detection
        autocallLevel: obs.isCallable ? (obs.autocallLevel || phoenixParams.autocallBarrier) : null,
        autocallLevelFormatted: obs.isCallable ? `${obs.autocallLevel || phoenixParams.autocallBarrier}%` : 'N/A',
        isCallable: obs.isCallable || false,
        isFinal: isFinalObservation, // Flag for final/maturity observation
        hasOccurred: isPast,
        status: isPast ? 'completed' : 'upcoming',
        // Memory Autocall tracking
        underlyingFlags, // Array of {ticker, performance, isFlagged, isNewFlag, flaggedDate}
        allUnderlyingsFlagged // Boolean: have all underlyings been flagged?
      });
    }

    // Calculate remaining observations
    // If product has been autocalled or matured, there are no remaining observations
    const hasMatured = observations.length > 0 && observations[observations.length - 1].status === 'completed';
    const remainingObservations = (productCalled || hasMatured) ? 0 : observations.filter(o => o.status === 'upcoming').length;

    // Calculate next observation prediction
    const nextObservationPrediction = await this.calculateNextObservationPrediction(
      product,
      underlyings,
      observations,
      phoenixParams,
      totalMemoryCoupons,
      underlyingAutocallFlags
    );

    console.log(`[PHOENIX] Next observation prediction for ${product._id}:`, {
      hasData: !!nextObservationPrediction,
      outcomeType: nextObservationPrediction?.outcomeType,
      displayText: nextObservationPrediction?.displayText,
      isLastObservation: nextObservationPrediction?.isLastObservation
    });

    // Match scheduled payments with actual PMS operations
    const enhancedObservations = await matchAllScheduledPayments(product, observations);

    return {
      totalObservations: schedule.length,
      observations: enhancedObservations,
      totalCouponsEarnedFormatted: PhoenixEvaluationHelpers.formatCouponPercentage(totalCouponsEarned, phoenixParams.couponRate),
      totalMemoryCouponsFormatted: PhoenixEvaluationHelpers.formatCouponPercentage(totalMemoryCoupons, phoenixParams.couponRate),
      totalCouponsEarned,
      totalMemoryCoupons,
      remainingObservations,
      hasMemoryAutocall: phoenixParams.memoryAutocall || false,
      hasMemoryCoupon: phoenixParams.memoryCoupon || false,
      hasGuaranteedCoupon: phoenixParams.guaranteedCoupon || false,
      isEarlyAutocall: productCalled,
      callDate,
      callDateFormatted: callDate ? new Date(callDate).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }) : null,
      isMaturedAtFinal: !productCalled && observations.length > 0 && observations[observations.length - 1].status === 'completed',
      nextObservation: PhoenixEvaluationHelpers.getNextObservationDate(product),
      // Memory Autocall tracking
      underlyingAutocallFlags, // {ticker: firstFlaggedDate}
      // Next observation prediction
      nextObservationPrediction
    };
  },

  /**
   * Calculate prediction for next observation based on current prices
   */
  async calculateNextObservationPrediction(product, underlyings, observations, phoenixParams, totalMemoryCoupons, underlyingAutocallFlags) {
    try {
      console.log(`[PHOENIX PRED] Calculating prediction for product ${product._id}:`, {
        observationCount: observations.length,
        upcomingCount: observations.filter(o => o.status === 'upcoming').length,
        completedCount: observations.filter(o => o.status === 'completed').length,
        underlyingCount: underlyings.length
      });

      // Find next upcoming observation or last observation if none upcoming
      let targetObservation = observations.find(obs => obs.status === 'upcoming' && !obs.hasOccurred);
      const isLastObservation = !targetObservation;

      if (isLastObservation && observations.length > 0) {
        // No upcoming observations - use last observation
        targetObservation = observations[observations.length - 1];
        console.log(`[PHOENIX PRED] No upcoming observations, using last observation:`, {
          date: targetObservation.observationDate,
          status: targetObservation.status
        });
      }

      if (!targetObservation) {
        // No observations at all
        console.log(`[PHOENIX PRED] No observations found, returning null`);
        return null;
      }

      console.log(`[PHOENIX PRED] Target observation:`, {
        date: targetObservation.observationDate,
        status: targetObservation.status,
        isLastObservation
      });

      // Get current underlying performances
      const underlyingPerformances = underlyings.map(u => ({
        ticker: u.ticker,
        currentPerformance: u.performance || 0,
        performanceFormatted: ((u.performance || 0) >= 0 ? '+' : '') + (u.performance || 0).toFixed(2) + '%'
      }));

      // Calculate current basket level (worst-of)
      const currentBasketLevel = Math.min(...underlyings.map(u => u.performance || 0));
      const currentBasketLevelFormatted = (currentBasketLevel >= 0 ? '+' : '') + currentBasketLevel.toFixed(2) + '%';

      // Get thresholds
      const protectionBarrier = phoenixParams.protectionBarrier || 70;
      const autocallBarrier = phoenixParams.autocallBarrier || 100;
      const couponRate = phoenixParams.couponRate || 0;

      // Use couponBarrier if defined, otherwise fall back to protectionBarrier
      const effectiveCouponBarrier = phoenixParams.couponBarrier || protectionBarrier;
      const couponThreshold = effectiveCouponBarrier - 100; // e.g., -30 for 70% barrier
      const autocallThreshold = autocallBarrier - 100; // e.g., 0 for 100% barrier

      // Check if guaranteed coupon feature is enabled
      const isGuaranteedCoupon = phoenixParams.guaranteedCoupon === true;

      // Calculate days until observation
      const today = new Date();
      const obsDate = new Date(targetObservation.observationDate);
      const daysUntil = Math.ceil((obsDate - today) / (1000 * 60 * 60 * 24));

      // Initialize prediction object
      const prediction = {
        date: targetObservation.observationDate,
        dateFormatted: PhoenixEvaluationHelpers.formatObservationDate(targetObservation.observationDate),
        daysUntil: daysUntil > 0 ? daysUntil : 0,
        isLastObservation,
        isFinalObservation: targetObservation.isFinal || false,

        currentBasketLevel,
        currentBasketLevelFormatted,

        couponWouldPay: false,
        couponAmount: 0,
        couponAmountFormatted: '',

        memoryWouldBeAdded: false,
        memoryAmountAdded: 0,
        memoryWouldBeReleased: false,
        totalMemoryCoupons,
        totalMemoryCouponsFormatted: PhoenixEvaluationHelpers.formatCouponPercentage(totalMemoryCoupons, couponRate),

        autocallWouldTrigger: false,
        autocallPrice: 0,
        autocallPriceFormatted: '',

        redemptionAmount: 0,
        redemptionAmountFormatted: '',

        underlyingPerformances,

        outcomeType: 'no_event',
        displayText: '',
        explanation: '',
        assumption: 'Based on current underlying prices'
      };

      // Determine outcome type based on current basket level

      // Check for autocall
      if (targetObservation.isCallable && currentBasketLevel >= autocallThreshold) {
        // Standard autocall
        prediction.autocallWouldTrigger = true;
        prediction.outcomeType = 'autocall';

        // Calculate autocall price: 100% + coupon + accumulated memory
        const autocallPrice = 100 + couponRate + totalMemoryCoupons;
        prediction.autocallPrice = autocallPrice;
        prediction.autocallPriceFormatted = `${autocallPrice.toFixed(2)}%`;

        prediction.couponWouldPay = true;
        prediction.couponAmount = couponRate;
        prediction.couponAmountFormatted = PhoenixEvaluationHelpers.formatPredictionCoupon(couponRate);

        if (totalMemoryCoupons > 0) {
          prediction.memoryWouldBeReleased = true;
          prediction.displayText = `${prediction.dateFormatted}; autocall; ${prediction.autocallPriceFormatted} (incl. ${prediction.totalMemoryCouponsFormatted} memory)`;
          prediction.explanation = `Basket at ${currentBasketLevelFormatted}. Above autocall barrier (${autocallBarrier}%), product would autocall at ${prediction.autocallPriceFormatted} including ${prediction.totalMemoryCouponsFormatted} memory coupons.`;
        } else {
          prediction.displayText = `${prediction.dateFormatted}; autocall; ${prediction.autocallPriceFormatted}`;
          prediction.explanation = `Basket at ${currentBasketLevelFormatted}. Above autocall barrier (${autocallBarrier}%), product would autocall at ${prediction.autocallPriceFormatted}.`;
        }
      }
      // Check for memory autocall (all underlyings flagged)
      else if (phoenixParams.memoryAutocall && targetObservation.isCallable) {
        const allFlagged = Object.keys(underlyingAutocallFlags || {}).length === underlyings.length;
        if (allFlagged) {
          prediction.autocallWouldTrigger = true;
          prediction.outcomeType = 'autocall';

          const autocallPrice = 100 + couponRate + totalMemoryCoupons;
          prediction.autocallPrice = autocallPrice;
          prediction.autocallPriceFormatted = `${autocallPrice.toFixed(2)}%`;

          prediction.displayText = `${prediction.dateFormatted}; memory autocall; ${prediction.autocallPriceFormatted}`;
          prediction.explanation = `All underlyings have reached autocall level at some point. Memory autocall would trigger at ${prediction.autocallPriceFormatted}.`;
        } else if (isGuaranteedCoupon || currentBasketLevel >= couponThreshold) {
          // Memory autocall conditions not met, but coupon would be paid (either guaranteed or above barrier)
          prediction.couponWouldPay = true;
          prediction.couponAmount = couponRate;
          prediction.couponAmountFormatted = PhoenixEvaluationHelpers.formatPredictionCoupon(couponRate);
          prediction.outcomeType = 'coupon';

          const explanationPrefix = isGuaranteedCoupon ? 'Guaranteed coupon' : `Basket at ${currentBasketLevelFormatted}. Above coupon barrier (${protectionBarrier}%)`;
          prediction.displayText = `${prediction.dateFormatted}; coupon; ${prediction.couponAmountFormatted}`;
          prediction.explanation = `${explanationPrefix}, would receive ${prediction.couponAmountFormatted} coupon.`;
        } else if (!isGuaranteedCoupon && phoenixParams.memoryCoupon) {
          // Below coupon barrier, add to memory (only if not guaranteed coupon)
          prediction.memoryWouldBeAdded = true;
          prediction.memoryAmountAdded = couponRate;
          prediction.outcomeType = 'memory_added';

          const newMemoryTotal = totalMemoryCoupons + couponRate;
          prediction.displayText = `${prediction.dateFormatted}; coupon; in memory (total: ${PhoenixEvaluationHelpers.formatPredictionCoupon(newMemoryTotal)})`;
          prediction.explanation = `Basket at ${currentBasketLevelFormatted}. Below coupon barrier (${protectionBarrier}%), ${PhoenixEvaluationHelpers.formatPredictionCoupon(couponRate)} would be added to memory (new total: ${PhoenixEvaluationHelpers.formatPredictionCoupon(newMemoryTotal)}).`;
        } else if (!isGuaranteedCoupon) {
          // No event (only if not guaranteed coupon)
          prediction.outcomeType = 'no_event';
          prediction.displayText = `${prediction.dateFormatted}; no event`;
          prediction.explanation = `Basket at ${currentBasketLevelFormatted}. Below coupon barrier (${protectionBarrier}%), no coupon would be paid.`;
        }
      }
      // Check for coupon payment (non-memory autocall case)
      else if (isGuaranteedCoupon || currentBasketLevel >= couponThreshold) {
        prediction.couponWouldPay = true;
        prediction.couponAmount = couponRate;
        prediction.couponAmountFormatted = PhoenixEvaluationHelpers.formatPredictionCoupon(couponRate);
        prediction.outcomeType = 'coupon';

        const explanationPrefix = isGuaranteedCoupon ? 'Guaranteed coupon' : `Basket at ${currentBasketLevelFormatted}. Above coupon barrier (${protectionBarrier}%)`;
        prediction.displayText = `${prediction.dateFormatted}; coupon; ${prediction.couponAmountFormatted}`;
        prediction.explanation = `${explanationPrefix}, would receive ${prediction.couponAmountFormatted} coupon.`;
      }
      // Memory coupon would be added (non-memory autocall case, only if not guaranteed)
      else if (!isGuaranteedCoupon && phoenixParams.memoryCoupon) {
        prediction.memoryWouldBeAdded = true;
        prediction.memoryAmountAdded = couponRate;
        prediction.outcomeType = 'memory_added';

        const newMemoryTotal = totalMemoryCoupons + couponRate;
        prediction.displayText = `${prediction.dateFormatted}; coupon; in memory (total: ${PhoenixEvaluationHelpers.formatPredictionCoupon(newMemoryTotal)})`;
        prediction.explanation = `Basket at ${currentBasketLevelFormatted}. Below coupon barrier (${protectionBarrier}%), ${PhoenixEvaluationHelpers.formatPredictionCoupon(couponRate)} would be added to memory (new total: ${PhoenixEvaluationHelpers.formatPredictionCoupon(newMemoryTotal)}).`;
      }
      // No event (only if not guaranteed coupon)
      else if (!isGuaranteedCoupon) {
        prediction.outcomeType = 'no_event';
        prediction.displayText = `${prediction.dateFormatted}; no event`;
        prediction.explanation = `Basket at ${currentBasketLevelFormatted}. Below coupon barrier (${protectionBarrier}%), no coupon would be paid.`;
      }

      // Handle final observation
      if (targetObservation.isFinal) {
        prediction.isFinalObservation = true;

        // Calculate capital return using proper geared loss formula
        let capitalReturn = 100;
        let capitalExplanation = '';

        const barrierThreshold = protectionBarrier - 100; // e.g., 70% barrier = -30% threshold

        if (currentBasketLevel >= barrierThreshold) {
          // Above protection barrier: full capital return
          capitalReturn = 100;
          capitalExplanation = `Basket at ${currentBasketLevelFormatted} (above ${protectionBarrier}% barrier) = 100% capital`;
        } else {
          // Below protection barrier: geared loss calculation
          const currentLevel = 100 + currentBasketLevel; // e.g., -40% perf = 60% level
          const breachAmount = protectionBarrier - currentLevel; // e.g., 70 - 60 = 10% breach
          const gearedLoss = breachAmount * (100 / protectionBarrier); // e.g., 10 × (100/70) = 14.29% loss
          capitalReturn = 100 - gearedLoss; // e.g., 100 - 14.29 = 85.71%
          capitalExplanation = `Basket at ${(currentLevel).toFixed(2)}% (below ${protectionBarrier}% barrier): breach ${breachAmount.toFixed(2)}% × (100/${protectionBarrier}) = loss ${gearedLoss.toFixed(2)}% → capital ${capitalReturn.toFixed(2)}%`;
        }

        // Calculate coupon components
        const couponsEarned = totalCouponsEarned || 0;
        const memoryCouponsAvailable = totalMemoryCoupons || 0;

        // Memory coupons only paid if above barrier at maturity
        const isAboveBarrier = currentBasketLevel >= barrierThreshold;
        const memoryCouponsPaid = isAboveBarrier ? memoryCouponsAvailable : 0;

        // Total redemption amount
        const redemptionAmount = capitalReturn + couponsEarned + memoryCouponsPaid;

        // Add detailed breakdown to prediction
        prediction.capitalReturn = capitalReturn;
        prediction.capitalReturnFormatted = `${capitalReturn.toFixed(2)}%`;
        prediction.capitalExplanation = capitalExplanation;

        prediction.couponsEarned = couponsEarned;
        prediction.couponsEarnedFormatted = PhoenixEvaluationHelpers.formatCouponPercentage(couponsEarned, couponRate);

        prediction.memoryCoupons = memoryCouponsPaid;
        prediction.memoryCouponsFormatted = PhoenixEvaluationHelpers.formatCouponPercentage(memoryCouponsPaid, couponRate);
        prediction.memoryCouponsForfeit = !isAboveBarrier && memoryCouponsAvailable > 0;
        prediction.memoryCouponsForfeitAmount = !isAboveBarrier ? memoryCouponsAvailable : 0;

        prediction.redemptionAmount = redemptionAmount;
        prediction.redemptionAmountFormatted = `${redemptionAmount.toFixed(2)}%`;
        prediction.outcomeType = 'final_redemption';

        // Display text
        if (memoryCouponsPaid > 0) {
          prediction.displayText = `${prediction.dateFormatted}; final redemption; ${prediction.redemptionAmountFormatted} (incl. ${prediction.memoryCouponsFormatted} memory)`;
        } else {
          prediction.displayText = `${prediction.dateFormatted}; final redemption; ${prediction.redemptionAmountFormatted}`;
        }

        // Explanation
        if (isAboveBarrier) {
          prediction.explanation = `Final observation. Basket at ${currentBasketLevelFormatted} (above ${protectionBarrier}% barrier). Total return: ${prediction.capitalReturnFormatted} capital + ${prediction.couponsEarnedFormatted} coupons${memoryCouponsPaid > 0 ? ` + ${prediction.memoryCouponsFormatted} memory` : ''} = ${prediction.redemptionAmountFormatted}.`;
        } else {
          prediction.explanation = `Final observation. Basket at ${currentBasketLevelFormatted} (below ${protectionBarrier}% barrier). Capital return ${prediction.capitalReturnFormatted} (geared loss applied)${couponsEarned > 0 ? ` + ${prediction.couponsEarnedFormatted} coupons` : ''}${prediction.memoryCouponsForfeit ? `. Memory coupons ${prediction.memoryCouponsFormatted} forfeited` : ''}.`;
        }
      }

      console.log(`[PHOENIX PRED] Prediction calculated successfully:`, {
        outcomeType: prediction.outcomeType,
        displayText: prediction.displayText,
        isLastObservation: prediction.isLastObservation,
        basketLevel: prediction.currentBasketLevel
      });

      return prediction;

    } catch (error) {
      console.error('[PHOENIX PRED] ❌ Error calculating next observation prediction:', error);
      console.error('[PHOENIX PRED] Error stack:', error.stack);
      return null;
    }
  }
};
