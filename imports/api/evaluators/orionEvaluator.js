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
        // So compare performance to (barrier - 100) to check if crossed
        hitLowerBarrier: underlying.performance <= (lowerBarrier - 100),
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
        hasLowerBarrier: orionParams.lowerBarrier > 0,
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

    return {
      upperBarrier: structureParams.upperBarrier ?? structure.upperBarrier ?? 100,
      rebate: structureParams.rebate ?? structure.rebate ?? structureParams.couponRate ?? structure.couponRate ?? 8.0,
      capitalGuaranteed: structureParams.capitalGuaranteed ?? structure.capitalGuaranteed ?? 100,
      lowerBarrier: structureParams.lowerBarrier ?? structure.lowerBarrier ?? 70,
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
    // - Lower barrier provides protection: if basket performance < -(100 - lowerBarrier), investor loses
    const lowerBarrierThreshold = orionParams.lowerBarrier - 100; // e.g., 70% barrier = -30% threshold

    let capitalReturn = 100;
    let capitalExplanation = '';

    // Check if protection is intact (basket performance above lower barrier threshold)
    const worstPerforming = Math.min(...underlyings.map(u => u.performance));
    const protectionIntact = worstPerforming >= lowerBarrierThreshold;

    if (protectionIntact) {
      // Protection intact: investor gets 100% + basket considered performance
      capitalReturn = 100 + basketConsideredPerformance;
      capitalExplanation = `Capital protected (worst performer ${worstPerforming >= 0 ? '+' : ''}${worstPerforming.toFixed(2)}% above ${lowerBarrierThreshold}% barrier)`;
    } else {
      // Protection breached: investor bears the loss
      capitalReturn = 100 + worstPerforming;
      capitalExplanation = `Protection breached (worst performer ${worstPerforming.toFixed(2)}% below ${lowerBarrierThreshold}% barrier)`;
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

      // Protection status
      protectionIntact,
      protectionBarrier: orionParams.lowerBarrier,
      protectionBarrierFormatted: `${orionParams.lowerBarrier}%`,

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
