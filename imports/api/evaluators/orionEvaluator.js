import { OrionEvaluationHelpers } from './orionEvaluationHelpers';

/**
 * Orion Memory Evaluator
 *
 * Handles evaluation logic specific to Orion Memory products.
 * Orion products feature:
 * - Upper barrier cap (rebate mechanism)
 * - Lower barrier protection
 * - Memory coupon structure
 * - Considered performance calculation (capped at rebate if upper barrier hit)
 */
export const OrionEvaluator = {
  /**
   * Generate report for Orion Memory product
   */
  async generateReport(product, context) {
    console.log('🔥🔥🔥 ORION MEMORY EVALUATOR CALLED FOR PRODUCT:', product._id);

    // Set redemption prices for redeemed products
    await OrionEvaluationHelpers.setRedemptionPricesForProduct(product);

    // Extract Orion-specific parameters
    const orionParams = this.extractOrionParameters(product);

    // Extract underlying assets data
    const underlyingAssets = await OrionEvaluationHelpers.extractUnderlyingAssetsData(product);

    // Evaluate barrier hits for each underlying and calculate considered performance
    const rebate = orionParams.rebate;
    console.log('[ORION] Rebate value:', rebate);
    console.log('[ORION] Upper barrier:', orionParams.upperBarrier);

    const underlyingsWithBarriers = await Promise.all(underlyingAssets.map(async (underlying) => {
      const upperBarrier = orionParams.upperBarrier;
      const lowerBarrier = orionParams.lowerBarrier;

      // Check if barrier was touched at any point in history (lookback mechanism)
      const hitUpperBarrier = await OrionEvaluationHelpers.checkBarrierTouchedInHistory(
        product.underlyings.find(u => u.ticker === underlying.ticker),
        product,
        upperBarrier
      );

      // Considered performance: if hit upper barrier, use rebate; otherwise use real performance
      const consideredPerformance = hitUpperBarrier ? rebate : underlying.performance;
      const consideredPerformanceFormatted = hitUpperBarrier
        ? `+${rebate.toFixed(2)}%`
        : (underlying.performanceFormatted || `${underlying.performance >= 0 ? '+' : ''}${underlying.performance.toFixed(2)}%`);

      console.log('[ORION]', underlying.ticker, '- Performance:', underlying.performance, 'Hit barrier:', hitUpperBarrier, 'Considered:', consideredPerformanceFormatted);

      return {
        ...underlying,
        hitUpperBarrier,
        // lowerBarrier of 70 means 70% of initial price (100% - 30% loss)
        // So compare performance to (barrier - 100) to check if crossed.
        // No barrier on this product => nothing can be breached.
        hitLowerBarrier: orionParams.hasLowerBarrier
          ? underlying.performance <= (lowerBarrier - 100)
          : false,
        upperBarrier,
        lowerBarrier,
        consideredPerformance,
        consideredPerformanceFormatted
      };
    }));

    // Calculate basket performance using considered values
    const totalConsideredPerformance = underlyingsWithBarriers.reduce((sum, u) => sum + u.consideredPerformance, 0);
    const basketConsideredPerformance = totalConsideredPerformance / underlyingsWithBarriers.length;
    const basketConsideredPerformanceFormatted = `${basketConsideredPerformance >= 0 ? '+' : ''}${basketConsideredPerformance.toFixed(2)}%`;

    // Calculate indicative maturity value (what the product would be worth if matured today)
    const indicativeMaturityValue = this.calculateIndicativeMaturityValue(
      underlyingsWithBarriers,
      orionParams,
      basketConsideredPerformance,
      product
    );

    // Create evaluation results
    const evaluation = {
      // Template identification
      templateType: 'orion_memory',
      templateVersion: '1.0.0',

      // Key product features
      features: {
        hasUpperBarrier: orionParams.upperBarrier > 0,
        hasLowerBarrier: orionParams.hasLowerBarrier,
        hasMemoryCoupon: orionParams.couponRate > 0,
        observationFrequency: orionParams.observationFrequency || 'quarterly'
      },

      // Current status
      currentStatus: OrionEvaluationHelpers.buildProductStatus(product),

      // Orion-specific structure
      orionStructure: orionParams,

      // Underlying assets with barrier evaluation
      underlyings: underlyingsWithBarriers,

      // Basket considered performance (for ORION display)
      basketConsideredPerformance,
      basketConsideredPerformanceFormatted,

      // Basket analysis for charts
      basketAnalysis: {
        protectionBarrier: orionParams.lowerBarrier,
        upperBarrier: orionParams.upperBarrier,
        rebateValue: rebate,
        averagePerformance: basketConsideredPerformance
      },

      // Indicative maturity value (current theoretical product value)
      indicativeMaturityValue,

      // Product name
      generatedProductName: OrionEvaluationHelpers.generateProductName(product, underlyingAssets, orionParams)
    };

    return evaluation;
  },

  /**
   * Extract Orion-specific parameters from product structure
   */
  extractOrionParameters(product) {
    const structure = product.structure || {};
    const scheduleParams = product.scheduleParameters || {};
    const structureParams = product.structureParams || product.structureParameters || {};

    // Protection (lower) barrier. Many Orion notes carry NO downside barrier at all —
    // a 100% capital-guaranteed Orion is protected by the guarantee, not by a barrier.
    // Never substitute a default here: an invented level would be reported as a real
    // product term. `null` means "this product has no protection barrier" and every
    // consumer must branch on hasLowerBarrier rather than assume a number.
    // `protectionBarrierLevel` is the field the designer / term-sheet extractor writes.
    const lowerBarrier = structureParams.lowerBarrier
      ?? structure.lowerBarrier
      ?? structureParams.protectionBarrierLevel
      ?? structure.protectionBarrierLevel
      ?? null;
    const hasLowerBarrier = lowerBarrier != null && lowerBarrier > 0;

    const upperBarrier = structureParams.upperBarrier ?? structure.upperBarrier ?? 100;
    const rebate = structureParams.rebate ?? structure.rebate ?? structureParams.couponRate ?? structure.couponRate ?? 8.0;
    const capitalGuaranteed = structureParams.capitalGuaranteed ?? structure.capitalGuaranteed ?? 100;

    return {
      upperBarrier,
      upperBarrierFormatted: `${upperBarrier}%`,
      rebate,
      rebateFormatted: `${rebate}%`,
      capitalGuaranteed,
      capitalGuaranteedFormatted: `${capitalGuaranteed}%`,
      lowerBarrier,
      hasLowerBarrier,
      // Display-ready: reports print this instead of composing `${lowerBarrier}%`,
      // which rendered a bare "-%" when the product had no barrier.
      lowerBarrierFormatted: hasLowerBarrier ? `${lowerBarrier}%` : '-',
      couponRate: structureParams.couponRate ?? structure.couponRate ?? structureParams.rebate ?? 0,
      observationFrequency: scheduleParams.observationFrequency ?? structure.observationFrequency ?? 'quarterly',
      memoryCoupon: structureParams.memoryCoupon !== false,
      memoryType: structureParams.memoryType ?? 'full'
    };
  },

  /**
   * Calculate indicative maturity value for Orion products
   * Shows what the product would return if it matured today
   */
  calculateIndicativeMaturityValue(underlyings, orionParams, basketConsideredPerformance, product) {
    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;
    const finalObsDate = product.finalObservation || product.finalObservationDate;

    const isMatured = (maturityDate && new Date(maturityDate) <= now) ||
                     (finalObsDate && new Date(finalObsDate) <= now);

    // For Orion products:
    // - Capital return = 100% + basket considered performance (capped at rebate if upper barrier hit)
    // - Where a lower barrier exists it provides protection: if the worst performer falls
    //   below -(100 - lowerBarrier), the investor bears the loss.
    // - Where NO lower barrier exists, downside is governed solely by the capital
    //   guarantee floor applied below. Nothing is protected *or* breached, so
    //   protectionIntact stays null and reports must not render a barrier status.
    const hasLowerBarrier = orionParams.hasLowerBarrier;
    const lowerBarrierThreshold = hasLowerBarrier ? orionParams.lowerBarrier - 100 : null;
    // ?? not ||: a product with an explicit 0% capital guarantee has NO floor.
    // `|| 100` turned that into full protection and reported a 100% redemption on
    // a product that can lose principal. Absent value still defaults to 100 in
    // extractOrionParameters().
    const minimumCapital = orionParams.capitalGuaranteed ?? 100;

    let capitalReturn = 100;
    let capitalExplanation = '';

    const worstPerforming = Math.min(...underlyings.map(u => u.performance));
    const protectionIntact = hasLowerBarrier ? worstPerforming >= lowerBarrierThreshold : null;

    if (!hasLowerBarrier) {
      // No protection barrier on this product: full participation in the basket's
      // considered performance, floored by the capital guarantee.
      capitalReturn = 100 + basketConsideredPerformance;
      capitalExplanation = `No protection barrier — capital floored at the ${minimumCapital}% guarantee`;
    } else if (protectionIntact) {
      // Protection intact: investor gets 100% + basket considered performance
      capitalReturn = 100 + basketConsideredPerformance;
      capitalExplanation = `Capital protected (worst performer ${worstPerforming >= 0 ? '+' : ''}${worstPerforming.toFixed(2)}% above ${lowerBarrierThreshold}% barrier)`;
    } else {
      // Protection breached: investor bears the loss
      capitalReturn = 100 + worstPerforming;
      capitalExplanation = `Protection breached (worst performer ${worstPerforming.toFixed(2)}% below ${lowerBarrierThreshold}% barrier)`;
    }

    // Apply minimum capital guarantee floor (e.g., 100% capital guarantee means min return is 100%)
    if (capitalReturn < minimumCapital) {
      capitalReturn = minimumCapital;
      capitalExplanation = hasLowerBarrier
        ? `Capital guaranteed at ${minimumCapital}% (barrier breached but principal protected by guarantee)`
        : `Capital guaranteed at ${minimumCapital}% (principal protected by guarantee)`;
    }

    // Count underlyings that hit upper barrier
    const hitBarrierCount = underlyings.filter(u => u.hitUpperBarrier).length;
    const allHitBarrier = hitBarrierCount === underlyings.length;
    const noneHitBarrier = hitBarrierCount === 0;

    // Total value
    const totalValue = capitalReturn;

    return {
      isLive: !isMatured,
      isMatured,

      // Capital return
      capitalReturn,
      capitalReturnFormatted: `${capitalReturn.toFixed(2)}%`,
      capitalExplanation,

      // Participation performance
      basketPerformance: basketConsideredPerformance,
      basketPerformanceFormatted: `${basketConsideredPerformance >= 0 ? '+' : ''}${basketConsideredPerformance.toFixed(2)}%`,

      // Upper barrier status
      hitBarrierCount,
      totalUnderlyings: underlyings.length,
      allHitBarrier,
      noneHitBarrier,
      barrierStatusText: allHitBarrier
        ? `All ${underlyings.length} underlyings hit upper barrier (capped at ${orionParams.rebate}%)`
        : noneHitBarrier
          ? `No underlyings hit upper barrier (full participation)`
          : `${hitBarrierCount}/${underlyings.length} underlyings hit upper barrier`,

      // Protection status — null barrier means the product has none; reports show '-'
      hasProtectionBarrier: hasLowerBarrier,
      protectionIntact,
      protectionBarrier: hasLowerBarrier ? orionParams.lowerBarrier : null,
      protectionBarrierFormatted: hasLowerBarrier ? `${orionParams.lowerBarrier}%` : '-',

      // Capital guarantee
      capitalGuaranteed: minimumCapital,
      capitalGuaranteedFormatted: `${minimumCapital}%`,
      hasCapitalGuarantee: minimumCapital > 0,

      // Upper barrier
      upperBarrier: orionParams.upperBarrier,
      upperBarrierFormatted: `${orionParams.upperBarrier}%`,
      rebate: orionParams.rebate,
      rebateFormatted: `${orionParams.rebate}%`,

      // Worst performer
      worstPerformer: worstPerforming,
      worstPerformerFormatted: `${worstPerforming >= 0 ? '+' : ''}${worstPerforming.toFixed(2)}%`,

      // Total value
      totalValue,
      totalValueFormatted: `${totalValue.toFixed(2)}%`,

      // Evaluation timestamp
      evaluationDate: now,
      evaluationDateFormatted: now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    };
  }
};
