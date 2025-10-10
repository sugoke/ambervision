import { SharkNoteEvaluationHelpers } from './sharkNoteEvaluationHelpers';

/**
 * Shark Note Evaluator
 *
 * Evaluates Shark Note structured products.
 *
 * Product Structure:
 * - Upper barrier monitoring during product life (daily or periodic observation)
 * - If barrier touched at any point: redemption = 100% + fixed rebate value
 * - If barrier NOT touched: redemption = 100% + performance, floored at minimum level
 * - Supports single underlying or basket (worst-of, best-of, average)
 *
 * Template Type: shark_note
 */
export const SharkNoteEvaluator = {
  /**
   * Generate full Shark Note report
   */
  async generateReport(product, context) {
    console.log('🦈 [Shark Note] Starting evaluation for product:', product._id);

    // Set redemption prices if product has matured
    await SharkNoteEvaluationHelpers.setRedemptionPricesForProduct(product);

    // Extract Shark Note structure parameters
    const sharkParams = this.extractSharkNoteParameters(product);
    console.log('🦈 [Shark Note] Structure parameters:', sharkParams);

    // Extract underlying assets data
    const underlyings = SharkNoteEvaluationHelpers.extractUnderlyingAssetsData(product);
    console.log('🦈 [Shark Note] Underlyings extracted:', underlyings.length);

    // Calculate basket performance
    const basketPerformance = SharkNoteEvaluationHelpers.calculateBasketPerformance(
      underlyings,
      sharkParams.referencePerformance
    );
    console.log('🦈 [Shark Note] Basket performance:', basketPerformance);

    // Check if upper barrier was touched
    const barrierStatus = await SharkNoteEvaluationHelpers.checkBarrierTouch(
      product,
      sharkParams.upperBarrier
    );
    console.log('🦈 [Shark Note] Barrier status:', barrierStatus);

    // Calculate redemption
    const redemptionCalc = SharkNoteEvaluationHelpers.calculateRedemption(
      product,
      basketPerformance || 0,
      barrierStatus.touched,
      sharkParams.rebateValue,
      sharkParams.floorLevel
    );
    console.log('🦈 [Shark Note] Redemption calculation:', redemptionCalc);

    // Build product status
    const status = SharkNoteEvaluationHelpers.buildProductStatus(product);

    // Build formatted timeline dates
    const timeline = this.buildTimeline(product);

    // Generate report structure
    const report = {
      // Template metadata
      templateType: 'shark_note',
      templateVersion: '1.0.0',

      // Current status
      currentStatus: {
        productStatus: status.productStatus,
        evaluationDate: status.evaluationDate,
        evaluationDateFormatted: status.evaluationDateFormatted,
        daysToMaturity: status.daysToMaturity,
        daysToMaturityText: status.daysToMaturityText,
        hasMatured: status.hasMatured
      },

      // Shark Note structure
      sharkStructure: {
        upperBarrier: sharkParams.upperBarrier,
        upperBarrierFormatted: `${sharkParams.upperBarrier.toFixed(0)}%`,
        rebateValue: sharkParams.rebateValue,
        rebateValueFormatted: `${sharkParams.rebateValue.toFixed(1)}%`,
        floorLevel: sharkParams.floorLevel,
        floorLevelFormatted: `${sharkParams.floorLevel.toFixed(0)}%`,
        referencePerformance: sharkParams.referencePerformance,
        referencePerformanceLabel: this.getReferencePerformanceLabel(sharkParams.referencePerformance)
      },

      // Underlying assets
      underlyings: underlyings,

      // Basket performance
      basketPerformance: {
        current: basketPerformance,
        currentFormatted: basketPerformance !== null
          ? `${(basketPerformance >= 0 ? '+' : '')}${basketPerformance.toFixed(2)}%`
          : 'N/A',
        isPositive: basketPerformance !== null && basketPerformance >= 0
      },

      // Barrier touch status
      barrierTouch: {
        touched: barrierStatus.touched,
        touchDate: barrierStatus.touchDate,
        touchDateFormatted: barrierStatus.touchDate
          ? new Date(barrierStatus.touchDate).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            })
          : null,
        basketLevelAtTouch: barrierStatus.basketLevel,
        basketLevelAtTouchFormatted: barrierStatus.basketLevel !== null
          ? `${barrierStatus.basketLevel.toFixed(2)}%`
          : null,
        status: barrierStatus.touched ? '✅ Barrier Touched' : '⏳ Barrier Not Touched'
      },

      // Redemption calculation
      redemption: {
        value: redemptionCalc.redemption,
        valueFormatted: `${redemptionCalc.redemption.toFixed(2)}%`,
        type: redemptionCalc.type,
        formula: redemptionCalc.formula,
        amountPer100: redemptionCalc.redemption,
        amountPer100Formatted: SharkNoteEvaluationHelpers.formatCurrency(
          redemptionCalc.redemption,
          product.currency || 'USD'
        )
      },

      // Timeline
      timeline: timeline,

      // Product details (pre-formatted)
      productDetails: {
        isin: product.isin || 'N/A',
        name: product.title || product.productName || 'Shark Note',
        currency: product.currency || 'USD',
        notional: product.notional || 100,
        notionalFormatted: SharkNoteEvaluationHelpers.formatCurrency(
          product.notional || 100,
          product.currency || 'USD'
        )
      }
    };

    console.log('🦈 [Shark Note] Evaluation complete');
    return report;
  },

  /**
   * Extract Shark Note parameters from product
   */
  extractSharkNoteParameters(product) {
    const structureParams = product.structureParams || product.structureParameters || {};
    const structure = product.structure || {};

    // Upper barrier (knock-out level)
    const upperBarrier = structureParams.upperBarrier ||
                        structure.upperBarrier ||
                        140; // Default 140%

    // Rebate value (fixed payment if barrier touched)
    const rebateValue = structureParams.rebateValue ||
                       structure.rebateValue ||
                       structureParams.fixedRebate ||
                       structure.fixedRebate ||
                       10; // Default 10%

    // Floor level (minimum redemption if barrier not touched)
    const floorLevel = structureParams.floorLevel ||
                      structure.floorLevel ||
                      structureParams.floor ||
                      structure.floor ||
                      90; // Default 90%

    // Reference performance (worst-of, best-of, average)
    const referencePerformance = structureParams.referencePerformance ||
                                structure.referencePerformance ||
                                'worst-of';

    return {
      upperBarrier,
      rebateValue,
      floorLevel,
      referencePerformance
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
      tradeDate: product.tradeDate || product.valueDate,
      tradeDateFormatted: formatDate(product.tradeDate || product.valueDate),
      valueDate: product.valueDate || product.issueDate,
      valueDateFormatted: formatDate(product.valueDate || product.issueDate),
      maturityDate: product.maturity || product.maturityDate,
      maturityDateFormatted: formatDate(product.maturity || product.maturityDate)
    };
  },

  /**
   * Get reference performance label
   */
  getReferencePerformanceLabel(referenceType) {
    const labels = {
      'worst-of': 'Worst Performer',
      'best-of': 'Best Performer',
      'average': 'Average Performance'
    };
    return labels[referenceType] || 'Worst Performer';
  }
};
