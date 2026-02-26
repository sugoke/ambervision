import { ReverseConvertibleBondEvaluationHelpers } from './reverseConvertibleBondEvaluationHelpers';

/**
 * Reverse Convertible (Bond) Evaluator
 *
 * Evaluates Reverse Convertible structured products on bond underlyings.
 *
 * Product Structure (Physical Delivery / Conversion Ratio model):
 * - Guaranteed coupon at maturity
 * - Strike level (e.g., 72.45% of par)
 * - Above strike: Cash settlement = 100% of denomination + coupon
 * - At or below strike: Physical delivery via Conversion Ratio + coupon
 *   Conversion Ratio = Denomination / ((Strike + Accrued Interest) / 100 x Par Amount)
 *   Delivery value as % = Final Fixing / (Strike + Accrued Interest) x 100
 *
 * Template Type: reverse_convertible_bond
 */
export const ReverseConvertibleBondEvaluator = {
  /**
   * Generate full Reverse Convertible (Bond) report
   */
  async generateReport(product, context) {
    console.log('📜 [Reverse Convertible Bond] Starting evaluation for product:', product._id);

    // Set redemption prices for matured products
    await ReverseConvertibleBondEvaluationHelpers.setRedemptionPricesForProduct(product);

    // Extract Reverse Convertible structure parameters
    const reverseConvertibleParams = this.extractReverseConvertibleParameters(product);
    console.log('📜 [Reverse Convertible Bond] Structure parameters:', reverseConvertibleParams);

    // Extract underlying assets data with pricing
    const underlyings = await ReverseConvertibleBondEvaluationHelpers.extractUnderlyingAssetsData(product);
    console.log('📜 [Reverse Convertible Bond] Underlyings extracted:', underlyings.length);

    // Enhance underlyings with strike status
    // Use per-underlying strikeLevel if set (entered from termsheet), fall back to product-level parameter
    const productStrikeLevel = reverseConvertibleParams.strikeLevel;
    const enhancedUnderlyings = this.enhanceUnderlyingsWithStrikeStatus(
      underlyings,
      productStrikeLevel
    );

    // Calculate basket performance (worst-of) — used for display only
    const basketPerformance = ReverseConvertibleBondEvaluationHelpers.calculateBasketPerformance(underlyings);
    console.log('📜 [Reverse Convertible Bond] Basket performance:', basketPerformance);

    // Resolve effective strike level: per-underlying strikeLevel takes priority over product-level
    const effectiveStrikeLevel = underlyings[0]?.strikeLevel || reverseConvertibleParams.strikeLevel;

    // For bonds: redemption uses the actual worst-of current price (% of par), NOT relative performance.
    // Bond prices are already in % of par (e.g. 67.04), so we compare directly against the strike level.
    const worstCurrentBondPrice = underlyings.length > 0
      ? Math.min(...underlyings.map(u => u.currentPrice || 0))
      : 100;

    // Calculate redemption value
    const redemptionCalc = ReverseConvertibleBondEvaluationHelpers.calculateRedemption(
      product,
      worstCurrentBondPrice,
      effectiveStrikeLevel,
      reverseConvertibleParams.couponRate,
      reverseConvertibleParams.accruedInterestAtRedemption
    );
    console.log('📜 [Reverse Convertible Bond] Redemption calculation:', redemptionCalc);

    // Build basket analysis
    const basketAnalysis = this.buildBasketAnalysis(enhancedUnderlyings, reverseConvertibleParams);

    // Build product status
    const status = ReverseConvertibleBondEvaluationHelpers.buildProductStatus(product);

    // Build formatted timeline dates
    const timeline = this.buildTimeline(product);

    // Calculate conversion ratio using effective strike level
    const conversionRatio = reverseConvertibleParams.denomination /
      ((effectiveStrikeLevel + reverseConvertibleParams.accruedInterestAtRedemption) / 100 * reverseConvertibleParams.parAmount);

    // Generate report structure
    const report = {
      // Template metadata
      templateType: 'reverse_convertible_bond',
      templateVersion: '2.0.0',

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
        strikeLevel: effectiveStrikeLevel,
        strikeLevelFormatted: `${effectiveStrikeLevel.toFixed(2)}%`,
        couponRate: reverseConvertibleParams.couponRate,
        couponRateFormatted: `${reverseConvertibleParams.couponRate.toFixed(1)}%`,
        accruedInterestAtRedemption: reverseConvertibleParams.accruedInterestAtRedemption,
        accruedInterestFormatted: `${reverseConvertibleParams.accruedInterestAtRedemption.toFixed(2)}%`,
        parAmount: reverseConvertibleParams.parAmount,
        parAmountFormatted: ReverseConvertibleBondEvaluationHelpers.formatCurrency(
          reverseConvertibleParams.parAmount,
          product.currency || 'USD'
        ),
        denomination: reverseConvertibleParams.denomination,
        denominationFormatted: ReverseConvertibleBondEvaluationHelpers.formatCurrency(
          reverseConvertibleParams.denomination,
          product.currency || 'USD'
        ),
        conversionRatio,
        conversionRatioFormatted: conversionRatio.toFixed(4),
        barrierType: reverseConvertibleParams.barrierType
      },

      // Underlying assets (with strike status)
      underlyings: enhancedUnderlyings,

      // Basket performance
      basketPerformance: {
        current: basketPerformance,
        currentFormatted: basketPerformance !== null
          ? `${(basketPerformance >= 0 ? '+' : '')}${basketPerformance.toFixed(2)}%`
          : 'N/A',
        isPositive: basketPerformance !== null && basketPerformance >= 0
      },

      // Basket analysis (for strike chart)
      basketAnalysis,

      // Redemption calculation
      redemption: {
        capitalComponent: redemptionCalc.capitalComponent,
        capitalComponentFormatted: redemptionCalc.capitalComponentFormatted,
        coupon: redemptionCalc.coupon,
        couponFormatted: redemptionCalc.couponFormatted,
        totalValue: redemptionCalc.totalValue,
        totalValueFormatted: redemptionCalc.totalValueFormatted,
        settlementType: redemptionCalc.settlementType,
        settlementTypeLabel: redemptionCalc.settlementType === 'cash' ? 'Cash Settlement' : 'Physical Delivery',
        strikeBreached: redemptionCalc.strikeBreached,
        capitalExplanation: redemptionCalc.capitalExplanation,
        formula: redemptionCalc.formula,
        conversionRatio: redemptionCalc.conversionRatio,
        conversionRatioFormatted: redemptionCalc.conversionRatioFormatted,
        deliveryValue: redemptionCalc.deliveryValue,
        deliveryValueFormatted: redemptionCalc.deliveryValueFormatted
      },

      // Timeline
      timeline: timeline,

      // Product details (pre-formatted)
      productDetails: {
        isin: product.isin || 'N/A',
        name: product.title || product.productName || 'Reverse Convertible (Bond)',
        currency: product.currency || 'USD',
        notional: product.notional || 100,
        notionalFormatted: ReverseConvertibleBondEvaluationHelpers.formatCurrency(
          product.notional || 100,
          product.currency || 'USD'
        )
      },

      // Generate a descriptive product name
      generatedProductName: ReverseConvertibleBondEvaluationHelpers.generateProductName(
        underlyings,
        reverseConvertibleParams
      )
    };

    console.log('📜 [Reverse Convertible Bond] Evaluation complete');
    console.log('📜 [Reverse Convertible Bond] Underlyings with news:', underlyings.map(u => ({
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

    // Strike level (% of par) - threshold for physical delivery
    // Also check protectionBarrierLevel (legacy field name used by older products)
    const strikeLevel = structureParams.strikeLevel ||
                        structureParams.protectionBarrierLevel ||
                        structure.strikeLevel ||
                        100; // Default 100%

    // Coupon rate (percentage, guaranteed)
    const couponRate = structureParams.couponRate ||
                      structure.couponRate ||
                      0;

    // Accrued interest at redemption (% of par)
    const accruedInterestAtRedemption = structureParams.accruedInterestAtRedemption ||
                                        structure.accruedInterestAtRedemption ||
                                        0;

    // Par amount of one underlying bond
    const parAmount = structureParams.parAmount ||
                     structure.parAmount ||
                     1000;

    // Note denomination
    const denomination = structureParams.denomination ||
                        structure.denomination ||
                        1000;

    // Barrier observation type
    const barrierType = structureParams.barrierType ||
                       structure.barrierType ||
                       'european';

    return {
      strikeLevel,
      couponRate,
      accruedInterestAtRedemption,
      parAmount,
      denomination,
      barrierType
    };
  },

  /**
   * Enhance underlyings with strike status and chart data
   */
  enhanceUnderlyingsWithStrikeStatus(underlyings, productStrikeLevel) {
    if (!underlyings || underlyings.length === 0) return underlyings;

    // Find worst performing underlying
    const performances = underlyings.map(u => u.performance);
    const worstPerformance = Math.min(...performances);

    return underlyings.map(underlying => {
      const isWorstPerforming = underlying.performance === worstPerformance;
      const performance = underlying.performance || 0;
      const isPositive = performance >= 0;

      // Per-underlying strikeLevel takes priority over product-level parameter
      const strikeLevel = underlying.strikeLevel || productStrikeLevel;

      // Current level as % of par (using current price directly, since bond prices are % of par)
      // Distance to strike: how far current price is from strike level (both in % of par)
      const currentPrice = underlying.currentPrice || 0;
      const initialPrice = underlying.initialPrice || 0;
      const distanceToStrike = currentPrice - strikeLevel;

      // Determine strike status — compare current bond price directly against strike level (both % of par)
      let strikeStatus = 'safe';
      let strikeStatusText = 'Above Strike';
      if (currentPrice <= strikeLevel) {
        strikeStatus = 'breached';
        strikeStatusText = 'At/Below Strike';
      } else if (distanceToStrike < 5) {
        strikeStatus = 'near';
        strikeStatusText = 'Near Strike';
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
        strikeLevel,
        strikeLevelFormatted: `${strikeLevel.toFixed(2)}%`,
        isWorstPerforming,
        distanceToStrike,
        distanceToStrikeFormatted: `${distanceToStrike >= 0 ? '+' : ''}${distanceToStrike.toFixed(2)}%`,
        strikeStatus,
        strikeStatusText,
        distanceToBarrier: distanceToStrike,
        distanceToBarrierFormatted: `${distanceToStrike >= 0 ? '+' : ''}${distanceToStrike.toFixed(2)}%`,
        barrierStatus: strikeStatus,
        barrierStatusText: strikeStatusText,
        chartData
      };
    });
  },

  /**
   * Build basket analysis including strike chart configuration
   */
  buildBasketAnalysis(underlyings, reverseConvertibleParams) {
    if (!underlyings || underlyings.length === 0) return null;

    // Use first underlying's strikeLevel if set, otherwise product-level parameter
    const strikeLevel = underlyings[0]?.strikeLevel || reverseConvertibleParams.strikeLevel || 100;

    // Count underlyings by strike status
    const safeCount = underlyings.filter(u => u.strikeStatus === 'safe').length;
    const nearCount = underlyings.filter(u => u.strikeStatus === 'near').length;
    const breachedCount = underlyings.filter(u => u.strikeStatus === 'breached').length;

    // Determine overall status
    let overallStatus = 'All underlyings above strike level';
    if (breachedCount > 0) {
      overallStatus = `${breachedCount} underlying${breachedCount > 1 ? 's are' : ' is'} at or below strike level`;
    } else if (nearCount > 0) {
      overallStatus = `${nearCount} underlying${nearCount > 1 ? 's are' : ' is'} near strike level`;
    }

    // Find critical distance (worst-of)
    const distances = underlyings.map(u => u.distanceToStrike).filter(d => d !== undefined);
    const criticalDistance = distances.length > 0 ? Math.min(...distances) : 0;

    // Calculate strike position in chart
    const strikeOffset = 100 - strikeLevel;
    const strikePosition = 50 + strikeOffset;

    return {
      strikeLevel,
      criticalDistance,
      criticalDistanceFormatted: `${criticalDistance >= 0 ? '+' : ''}${criticalDistance.toFixed(1)}%`,
      safeCount,
      nearCount,
      breachedCount,
      overallStatus,
      strikeChartConfig: {
        position: strikePosition,
        level: strikeLevel,
        label: `${strikeLevel.toFixed(2)}% Strike`
      },
      // Keep backward compat field
      capitalProtectionBarrier: strikeLevel
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
