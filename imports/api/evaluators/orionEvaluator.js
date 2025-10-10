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
    const underlyingAssets = OrionEvaluationHelpers.extractUnderlyingAssetsData(product);

    // Evaluate barrier hits for each underlying and calculate considered performance
    const rebate = orionParams.rebate || orionParams.couponRate || 8.0;
    console.log('[ORION] Rebate value:', rebate);
    console.log('[ORION] Upper barrier:', orionParams.upperBarrier);

    const underlyingsWithBarriers = underlyingAssets.map(underlying => {
      const upperBarrier = orionParams.upperBarrier || 100;
      const lowerBarrier = orionParams.lowerBarrier || 70;
      const hitUpperBarrier = underlying.performance >= upperBarrier;

      // Considered performance: if hit upper barrier, use rebate; otherwise use real performance
      const consideredPerformance = hitUpperBarrier ? rebate : underlying.performance;
      const consideredPerformanceFormatted = hitUpperBarrier
        ? `+${rebate.toFixed(2)}%`
        : (underlying.performanceFormatted || `${underlying.performance >= 0 ? '+' : ''}${underlying.performance.toFixed(2)}%`);

      console.log('[ORION]', underlying.ticker, '- Performance:', underlying.performance, 'Hit barrier:', hitUpperBarrier, 'Considered:', consideredPerformanceFormatted);

      return {
        ...underlying,
        hitUpperBarrier,
        hitLowerBarrier: underlying.performance <= lowerBarrier,
        upperBarrier,
        lowerBarrier,
        consideredPerformance,
        consideredPerformanceFormatted
      };
    });

    // Calculate basket performance using considered values
    const totalConsideredPerformance = underlyingsWithBarriers.reduce((sum, u) => sum + u.consideredPerformance, 0);
    const basketConsideredPerformance = totalConsideredPerformance / underlyingsWithBarriers.length;
    const basketConsideredPerformanceFormatted = `${basketConsideredPerformance >= 0 ? '+' : ''}${basketConsideredPerformance.toFixed(2)}%`;

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
    const structureParams = product.structureParameters || {};

    return {
      upperBarrier: structureParams.upperBarrier || structure.upperBarrier || 100,
      rebate: structureParams.rebate || structure.rebate || structureParams.couponRate || structure.couponRate || 8.0,
      capitalGuaranteed: structureParams.capitalGuaranteed || structure.capitalGuaranteed || 100,
      lowerBarrier: structureParams.lowerBarrier || structure.lowerBarrier || 70,
      couponRate: structureParams.couponRate || structure.couponRate || structureParams.rebate || 0,
      observationFrequency: scheduleParams.observationFrequency || structure.observationFrequency || 'quarterly',
      memoryCoupon: structureParams.memoryCoupon !== false,
      memoryType: structureParams.memoryType || 'full'
    };
  }
};
