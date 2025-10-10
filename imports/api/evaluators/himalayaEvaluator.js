import { HimalayaEvaluationHelpers } from './himalayaEvaluationHelpers';

/**
 * Himalaya Evaluator
 *
 * Himalaya product logic:
 * - Basket of underlyings (stocks, indices)
 * - Number of observation dates = number of underlyings (including final)
 * - On each observation date: record best performing underlying, remove from future observations
 * - At final: average all recorded performances = final performance
 * - Payout floored at X% (default 100%)
 */
export const HimalayaEvaluator = {
  /**
   * Generate evaluation report for Himalaya products
   */
  async generateReport(product, context) {
    // 1. Set redemption prices for matured products
    await HimalayaEvaluationHelpers.setRedemptionPricesForProduct(product);

    // 2. Extract Himalaya-specific parameters
    const params = this.extractHimalayaParameters(product);

    // Debug: Check what strikes we have
    console.log('📊 Himalaya Evaluator - Checking underlying strikes:');
    if (product.underlyings) {
      product.underlyings.forEach(u => {
        console.log(`  ${u.ticker}: strike=${u.strike}, tradeDatePrice=${u.securityData?.tradeDatePrice?.price}`);
      });
    }

    // 3. Extract underlying assets with pricing
    const underlyings = HimalayaEvaluationHelpers.extractUnderlyingAssetsData(product);

    // 4. Calculate Himalaya-specific logic (use product.underlyings which has observationPrices)
    const himalayaCalculation = this.calculateHimalayaPerformance(product, params, product.underlyings || underlyings);

    // 5. Build product status
    const status = HimalayaEvaluationHelpers.buildProductStatus(product);

    // 6. Return standardized report structure
    return {
      templateType: 'himalaya',
      templateVersion: '1.0.0',

      features: {
        hasFloor: params.floor < 100,
        hasObservationSchedule: true,
        observationCount: params.observationDates?.length || 0,
        underlyingCount: underlyings.length
      },

      currentStatus: status,

      himalayaStructure: params,

      underlyings: underlyings,

      himalayaCalculation: himalayaCalculation,

      // Final performance and payout
      finalPerformance: himalayaCalculation.averagePerformance,
      finalPerformanceFormatted: `${himalayaCalculation.averagePerformance >= 0 ? '+' : ''}${himalayaCalculation.averagePerformance.toFixed(2)}%`,
      flooredPerformance: himalayaCalculation.flooredPerformance,
      flooredPerformanceFormatted: `${himalayaCalculation.flooredPerformance >= 0 ? '+' : ''}${himalayaCalculation.flooredPerformance.toFixed(2)}%`,
      finalPayout: himalayaCalculation.finalPayout,
      finalPayoutFormatted: `${himalayaCalculation.finalPayout.toFixed(2)}%`
    };
  },

  /**
   * Extract Himalaya-specific parameters from product
   */
  extractHimalayaParameters(product) {
    const structureParams = product.structureParams || product.structureParameters || {};
    const observationSchedule = product.observationSchedule || [];

    return {
      floor: structureParams.floor || structureParams.floorLevel || 100,
      observationDates: observationSchedule.map(obs => ({
        date: obs.observationDate || obs.date,
        valueDate: obs.valueDate,
        observationNumber: obs.observationNumber
      })),
      observationFrequency: structureParams.observationFrequency || 'custom'
    };
  },

  /**
   * Calculate Himalaya performance
   *
   * Algorithm:
   * 1. For each observation date, find best performing underlying
   * 2. Record that performance, remove underlying from next observations
   * 3. Continue until final observation
   * 4. Average all recorded performances
   * 5. Apply floor
   */
  calculateHimalayaPerformance(product, params, underlyings) {
    const observationDates = params.observationDates || [];
    const recordedPerformances = [];
    const selectionHistory = [];
    const availableUnderlyings = [...underlyings]; // Clone array

    // Process each observation date
    observationDates.forEach((observation, index) => {
      if (availableUnderlyings.length === 0) return;

      console.log(`\n🏔️ HIMALAYA Observation ${index + 1} - Date: ${observation.date}`);
      console.log(`📊 Available underlyings: ${availableUnderlyings.map(u => u.ticker).join(', ')}`);

      // Find best performing underlying from available ones AT THIS OBSERVATION DATE
      let bestUnderlying = availableUnderlyings[0];
      let bestPerformance = this.calculatePerformanceAtDate(bestUnderlying, observation.date);

      console.log(`\n   Evaluating performances at ${observation.date}:`);
      availableUnderlyings.forEach(underlying => {
        const performanceAtDate = this.calculatePerformanceAtDate(underlying, observation.date);
        const priceAtDate = this.getPriceAtDate(underlying, observation.date);
        const initialPrice = underlying.initialPrice || underlying.strike;

        console.log(`   ${underlying.ticker}: ${initialPrice.toFixed(2)} → ${priceAtDate.toFixed(2)} = ${performanceAtDate >= 0 ? '+' : ''}${performanceAtDate.toFixed(2)}%`);

        if (performanceAtDate > bestPerformance) {
          bestPerformance = performanceAtDate;
          bestUnderlying = underlying;
        }
      });

      // Get the price at this observation date for display
      const priceAtDate = this.getPriceAtDate(bestUnderlying, observation.date);

      console.log(`\n   ✅ SELECTED: ${bestUnderlying.ticker} with ${bestPerformance >= 0 ? '+' : ''}${bestPerformance.toFixed(2)}%`);
      console.log(`   🗑️ Removing ${bestUnderlying.ticker} from future observations\n`);

      // Record the selection
      recordedPerformances.push(bestPerformance);
      selectionHistory.push({
        observationNumber: index + 1,
        observationDate: observation.date,
        selectedUnderlying: bestUnderlying.ticker,
        selectedUnderlyingName: bestUnderlying.name,
        performance: bestPerformance,
        performanceFormatted: `${bestPerformance >= 0 ? '+' : ''}${bestPerformance.toFixed(2)}%`,
        remainingUnderlyings: availableUnderlyings.length - 1,
        initialLevel: bestUnderlying.initialPrice || bestUnderlying.strike,
        initialLevelFormatted: bestUnderlying.initialPriceFormatted || bestUnderlying.strikeFormatted,
        finalLevel: priceAtDate,
        finalLevelFormatted: priceAtDate ? `${priceAtDate.toFixed(2)}` : 'N/A'
      });

      // Remove selected underlying from future observations
      const removeIndex = availableUnderlyings.findIndex(u => u.ticker === bestUnderlying.ticker);
      if (removeIndex !== -1) {
        availableUnderlyings.splice(removeIndex, 1);
      }
    });

    // Calculate average performance
    const averagePerformance = recordedPerformances.length > 0
      ? recordedPerformances.reduce((sum, perf) => sum + perf, 0) / recordedPerformances.length
      : 0;

    // Apply floor
    const flooredPerformance = Math.max(averagePerformance, params.floor - 100);

    // Calculate final payout (100 + floored performance)
    const finalPayout = 100 + flooredPerformance;

    return {
      selectionHistory: selectionHistory,
      recordedPerformances: recordedPerformances,
      averagePerformance: averagePerformance,
      flooredPerformance: flooredPerformance,
      finalPayout: finalPayout,
      floorApplied: averagePerformance < (params.floor - 100)
    };
  },

  /**
   * Calculate performance at a specific observation date
   */
  calculatePerformanceAtDate(underlying, observationDate) {
    const initialPrice = underlying.initialPrice || underlying.strike;
    const priceAtDate = this.getPriceAtDate(underlying, observationDate);

    if (!initialPrice || !priceAtDate) {
      return 0;
    }

    return ((priceAtDate - initialPrice) / initialPrice) * 100;
  },

  /**
   * Get price at a specific observation date from securityData.observationPrices
   */
  getPriceAtDate(underlying, observationDate) {
    // Format the observation date to match the stored format (YYYY-MM-DD)
    const dateStr = typeof observationDate === 'string'
      ? observationDate.split('T')[0]
      : observationDate.toISOString().split('T')[0];

    // Try to get price from observationPrices
    if (underlying.securityData?.observationPrices?.[dateStr]) {
      return underlying.securityData.observationPrices[dateStr];
    }

    // Fallback to current price if observation price not available
    return underlying.currentPrice || 0;
  }
};
