import { ReverseConvertibleEvaluationHelpers } from './reverseConvertibleEvaluationHelpers';

/**
 * Reverse Convertible Evaluator
 *
 * Evaluates Reverse Convertible structured products.
 *
 * Product Structure:
 * - Guaranteed coupon at maturity
 * - Capital protection barrier (e.g., 70%)
 * - Above barrier: 100% + coupon
 * - Below barrier: 100% + (performance × gearing) + coupon
 *   where gearing = 1 / (barrier_level / 100)
 *
 * Example:
 * - Barrier: 70%, Coupon: 3.5%
 * - Gearing: 1 / 0.70 = 1.43
 * - If underlying at 60% (−40% performance):
 *   → 100% + (−40% × 1.43) + 3.5% = 46.3%
 *
 * Template Type: reverse_convertible
 */
export const ReverseConvertibleEvaluator = {
  /**
   * Generate full Reverse Convertible report
   */
  async generateReport(product, context) {
    console.log('🔄 [Reverse Convertible] Starting evaluation for product:', product._id);

    // Set redemption prices for matured products
    await ReverseConvertibleEvaluationHelpers.setRedemptionPricesForProduct(product);

    // Extract Reverse Convertible structure parameters
    const reverseConvertibleParams = this.extractReverseConvertibleParameters(product);
    console.log('🔄 [Reverse Convertible] Structure parameters:', reverseConvertibleParams);

    // Extract underlying assets data with pricing
    const underlyings = await ReverseConvertibleEvaluationHelpers.extractUnderlyingAssetsData(product);
    console.log('🔄 [Reverse Convertible] Underlyings extracted:', underlyings.length);

    // Enhance underlyings with barrier status
    const enhancedUnderlyings = this.enhanceUnderlyingsWithBarrierStatus(
      underlyings,
      reverseConvertibleParams.capitalProtectionBarrier
    );

    // Calculate basket performance (worst-of)
    const basketPerformance = ReverseConvertibleEvaluationHelpers.calculateBasketPerformance(underlyings);
    console.log('🔄 [Reverse Convertible] Basket performance:', basketPerformance);

    // Calculate redemption value
    const redemptionCalc = ReverseConvertibleEvaluationHelpers.calculateRedemption(
      product,
      basketPerformance || 0,
      reverseConvertibleParams.capitalProtectionBarrier,
      reverseConvertibleParams.couponRate,
      reverseConvertibleParams.gearingFactor
    );
    console.log('🔄 [Reverse Convertible] Redemption calculation:', redemptionCalc);

    // Build basket analysis
    const basketAnalysis = this.buildBasketAnalysis(enhancedUnderlyings, reverseConvertibleParams);

    // Build product status
    const status = ReverseConvertibleEvaluationHelpers.buildProductStatus(product);

    // Build formatted timeline dates
    const timeline = this.buildTimeline(product);

    // Generate report structure
    const report = {
      // Template metadata
      templateType: 'reverse_convertible',
      templateVersion: '1.0.0',

      // Current status
      currentStatus: {
        productStatus: status.productStatus,
        statusDetails: status.statusDetails,
        evaluationDate: status.evaluationDate,
        evaluationDateFormatted: status.evaluationDateFormatted,
        daysToMaturity: status.daysToMaturity,
        daysToMaturityText: status.daysToMaturityText,
        hasMatured: status.hasMatured
      },

      // Reverse Convertible structure
      reverseConvertibleStructure: {
        capitalProtectionBarrier: reverseConvertibleParams.capitalProtectionBarrier,
        capitalProtectionBarrierFormatted: `${reverseConvertibleParams.capitalProtectionBarrier.toFixed(0)}%`,
        couponRate: reverseConvertibleParams.couponRate,
        couponRateFormatted: `${reverseConvertibleParams.couponRate.toFixed(1)}%`,
        strike: reverseConvertibleParams.strike,
        strikeFormatted: `${reverseConvertibleParams.strike.toFixed(0)}%`,
        gearingFactor: reverseConvertibleParams.gearingFactor,
        gearingFactorFormatted: `${reverseConvertibleParams.gearingFactor.toFixed(2)}x`,
        gearedDownside: reverseConvertibleParams.gearedDownside
      },

      // Underlying assets (with barrier status)
      underlyings: enhancedUnderlyings,

      // Basket performance
      basketPerformance: {
        current: basketPerformance,
        currentFormatted: basketPerformance !== null
          ? `${(basketPerformance >= 0 ? '+' : '')}${basketPerformance.toFixed(2)}%`
          : 'N/A',
        isPositive: basketPerformance !== null && basketPerformance >= 0
      },

      // Basket analysis (for barrier chart)
      basketAnalysis,

      // Redemption calculation
      redemption: {
        capitalComponent: redemptionCalc.capitalComponent,
        capitalComponentFormatted: redemptionCalc.capitalComponentFormatted,
        coupon: redemptionCalc.coupon,
        couponFormatted: redemptionCalc.couponFormatted,
        totalValue: redemptionCalc.totalValue,
        totalValueFormatted: redemptionCalc.totalValueFormatted,
        barrierBreached: redemptionCalc.barrierBreached,
        capitalExplanation: redemptionCalc.capitalExplanation,
        formula: redemptionCalc.formula
      },

      // Timeline
      timeline: timeline,

      // Product details (pre-formatted)
      productDetails: {
        isin: product.isin || 'N/A',
        name: product.title || product.productName || 'Reverse Convertible',
        currency: product.currency || 'USD',
        notional: product.notional || 100,
        notionalFormatted: ReverseConvertibleEvaluationHelpers.formatCurrency(
          product.notional || 100,
          product.currency || 'USD'
        )
      },

      // Generate a descriptive product name
      generatedProductName: ReverseConvertibleEvaluationHelpers.generateProductName(
        underlyings,
        reverseConvertibleParams
      )
    };

    console.log('🔄 [Reverse Convertible] Evaluation complete');
    console.log('🔄 [Reverse Convertible] Underlyings with news:', underlyings.map(u => ({
      ticker: u.ticker,
      hasNews: !!u.news,
      newsCount: u.news?.length || 0
    })));

    return report;
  },

  /**
   * Extract Reverse Convertible parameters from product
   */
  extractReverseConvertibleParameters(product) {
    const structureParams = product.structureParams || product.structureParameters || {};
    const structure = product.structure || {};

    // Capital protection barrier (percentage)
    const capitalProtectionBarrier = structureParams.capitalProtectionBarrier ||
                                     structureParams.protectionBarrier ||
                                     structureParams.protectionBarrierLevel ||
                                     structure.capitalProtectionBarrier ||
                                     structure.protectionBarrier ||
                                     70; // Default 70%

    // Coupon rate (percentage, guaranteed)
    const couponRate = structureParams.couponRate ||
                      structure.couponRate ||
                      0; // Default no coupon

    // Strike level (reference point for performance calculation)
    const strike = structureParams.strike ||
                  structure.strike ||
                  100; // Default 100% (at-the-money)

    // Calculate gearing factor: 1 / (barrier / 100)
    // Example: barrier 70% → gearing = 1 / 0.70 = 1.43x
    const gearingFactor = 1 / (capitalProtectionBarrier / 100);

    // Determine if gearedDownside is true (always true for reverse convertibles)
    const gearedDownside = true;

    return {
      capitalProtectionBarrier,
      couponRate,
      strike,
      gearingFactor,
      gearedDownside
    };
  },

  /**
   * Enhance underlyings with barrier status and chart data
   */
  enhanceUnderlyingsWithBarrierStatus(underlyings, capitalProtectionBarrier) {
    if (!underlyings || underlyings.length === 0) return underlyings;

    // Find worst performing underlying
    const performances = underlyings.map(u => u.performance);
    const worstPerformance = Math.min(...performances);

    return underlyings.map(underlying => {
      const isWorstPerforming = underlying.performance === worstPerformance;
      const performance = underlying.performance || 0;
      const isPositive = performance >= 0;

      // Calculate distance to barrier
      // Performance of -20%, barrier of 70% (i.e., -30%)
      // Distance = -20 - (-30) = +10% (safe)
      const barrierLevel = capitalProtectionBarrier - 100; // e.g., 70 - 100 = -30%
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

      // Calculate bar chart properties
      const chartData = {
        isPositive,
        width: '100px',
        barHeight: `${Math.abs(performance) * 2.2}px`,
        zeroPoint: '110px',
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
        chartData
      };
    });
  },

  /**
   * Build basket analysis including barrier chart configuration
   */
  buildBasketAnalysis(underlyings, reverseConvertibleParams) {
    if (!underlyings || underlyings.length === 0) return null;

    const capitalProtectionBarrier = reverseConvertibleParams.capitalProtectionBarrier || 70;

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

    // Calculate barrier position in chart
    const barrierOffset = 100 - capitalProtectionBarrier;
    const barrierPosition = 50 + barrierOffset;

    return {
      capitalProtectionBarrier,
      criticalDistance,
      criticalDistanceFormatted: `${criticalDistance >= 0 ? '+' : ''}${criticalDistance.toFixed(1)}%`,
      safeCount,
      nearCount,
      breachedCount,
      overallStatus,
      barrierChartConfig: {
        position: barrierPosition,
        level: capitalProtectionBarrier,
        label: `${capitalProtectionBarrier}% Protection`
      }
    };
  },

  /**
   * Build timeline dates
   */
  buildTimeline(product) {
    const formatDate = (date) => {
      if (!date) return 'N/A';
      return new Date(date).toLocaleDateString('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      });
    };

    return {
      tradeDate: product.tradeDate,
      tradeDateFormatted: formatDate(product.tradeDate),
      valueDate: product.valueDate || product.issueDate,
      valueDateFormatted: formatDate(product.valueDate || product.issueDate),
      finalObservation: product.finalObservation || product.finalObservationDate,
      finalObservationFormatted: formatDate(product.finalObservation || product.finalObservationDate),
      maturityDate: product.maturity || product.maturityDate,
      maturityDateFormatted: formatDate(product.maturity || product.maturityDate)
    };
  }
};
