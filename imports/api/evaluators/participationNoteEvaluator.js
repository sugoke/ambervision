import { ParticipationNoteEvaluationHelpers } from './participationNoteEvaluationHelpers';

/**
 * Participation Note Evaluator
 *
 * Evaluates Participation Note structured products.
 *
 * Product Structure:
 * - At maturity: investor receives performance of underlying(s) from predetermined strike
 * - Performance is multiplied by participation rate (e.g., 150% = 1.5x performance)
 * - Supports single underlying or basket (worst-of, best-of, average)
 * - Optional: Can be called at issuer's discretion (admin manually sets call date)
 * - Payoff formula: 100% + (Underlying Performance × Participation Rate)
 *
 * Template Type: participation_note
 */
export const ParticipationNoteEvaluator = {
  /**
   * Generate full Participation Note report
   */
  async generateReport(product, context) {
    console.log('📈 [Participation Note] Starting evaluation for product:', product._id);

    // Set trade date prices for initial price reference
    await ParticipationNoteEvaluationHelpers.setTradeDatePricesForProduct(product);

    // Set redemption prices if product has matured or been called
    await ParticipationNoteEvaluationHelpers.setRedemptionPricesForProduct(product);

    // Extract Participation Note structure parameters
    const participationParams = this.extractParticipationNoteParameters(product);
    console.log('📈 [Participation Note] Structure parameters:', participationParams);

    // Extract underlying assets data
    const underlyings = await ParticipationNoteEvaluationHelpers.extractUnderlyingAssetsData(product);
    console.log('📈 [Participation Note] Underlyings extracted:', underlyings.length);

    // Calculate basket performance
    const basketPerformance = ParticipationNoteEvaluationHelpers.calculateBasketPerformance(
      underlyings,
      participationParams.referencePerformance
    );
    console.log('📈 [Participation Note] Basket performance:', basketPerformance);

    // Check issuer call status
    const callStatus = ParticipationNoteEvaluationHelpers.checkIssuerCall(product);
    console.log('📈 [Participation Note] Issuer call status:', callStatus);

    // Calculate redemption with participation
    const redemptionCalc = ParticipationNoteEvaluationHelpers.calculateRedemption(
      product,
      basketPerformance || 0,
      participationParams.participationRate
    );
    console.log('📈 [Participation Note] Redemption calculation:', redemptionCalc);

    // Build product status
    const status = ParticipationNoteEvaluationHelpers.buildProductStatus(product);

    // Build formatted timeline dates
    const timeline = this.buildTimeline(product);

    // Generate report structure
    const report = {
      // Template metadata
      templateType: 'participation_note',
      templateVersion: '1.0.0',

      // Current status
      currentStatus: {
        productStatus: status.productStatus,
        statusDetails: status.statusDetails,
        evaluationDate: status.evaluationDate,
        evaluationDateFormatted: status.evaluationDateFormatted,
        daysToMaturity: status.daysToMaturity,
        daysToMaturityText: status.daysToMaturityText,
        hasMatured: status.hasMatured,
        isCalled: status.isCalled,
        hasCallOption: status.hasCallOption
      },

      // Participation Note structure
      participationStructure: {
        participationRate: participationParams.participationRate,
        participationRateFormatted: `${participationParams.participationRate.toFixed(0)}%`,
        strike: participationParams.strike,
        strikeFormatted: `${participationParams.strike.toFixed(0)}%`,
        referencePerformance: participationParams.referencePerformance,
        referencePerformanceLabel: this.getReferencePerformanceLabel(participationParams.referencePerformance)
      },

      // Issuer call information
      issuerCall: {
        hasCallOption: callStatus.hasCallOption,
        isCalled: callStatus.isCalled,
        callDate: callStatus.callDate,
        callDateFormatted: callStatus.callDateFormatted,
        callPrice: callStatus.callPrice,
        callPriceFormatted: callStatus.callPriceFormatted,
        rebate: callStatus.rebate,
        rebateFormatted: callStatus.rebateFormatted,
        status: callStatus.isCalled
          ? '✅ Called by Issuer'
          : callStatus.hasCallOption
            ? '⏳ Can be Called'
            : '❌ No Call Option'
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

      // Participation calculation
      participation: {
        rawPerformance: redemptionCalc.rawPerformance,
        rawPerformanceFormatted: `${(redemptionCalc.rawPerformance >= 0 ? '+' : '')}${redemptionCalc.rawPerformance.toFixed(2)}%`,
        participatedPerformance: redemptionCalc.participatedPerformance,
        participatedPerformanceFormatted: `${(redemptionCalc.participatedPerformance >= 0 ? '+' : '')}${redemptionCalc.participatedPerformance.toFixed(2)}%`,
        participationRate: redemptionCalc.participationRate,
        participationRateFormatted: `${redemptionCalc.participationRate.toFixed(0)}%`,
        formula: redemptionCalc.formula
      },

      // Redemption calculation
      redemption: {
        value: redemptionCalc.redemption,
        valueFormatted: `${redemptionCalc.redemption.toFixed(2)}%`,
        type: redemptionCalc.type,
        formula: redemptionCalc.formula,
        amountPer100: redemptionCalc.redemption,
        amountPer100Formatted: ParticipationNoteEvaluationHelpers.formatCurrency(
          redemptionCalc.redemption,
          product.currency || 'USD'
        ),
        isCalled: redemptionCalc.isCalled || false,
        hasProtection: redemptionCalc.hasProtection || false,
        protectionLevel: redemptionCalc.protectionLevel,
        protectionLevelFormatted: redemptionCalc.protectionLevel
          ? `${redemptionCalc.protectionLevel.toFixed(0)}%`
          : null,
        protectionApplied: redemptionCalc.protectionApplied || false,
        rawRedemption: redemptionCalc.rawRedemption,
        rawRedemptionFormatted: redemptionCalc.rawRedemption
          ? `${redemptionCalc.rawRedemption.toFixed(2)}%`
          : null
      },

      // Timeline
      timeline: timeline,

      // Product details (pre-formatted)
      productDetails: {
        isin: product.isin || 'N/A',
        name: product.title || product.productName || 'Participation Note',
        currency: product.currency || 'USD',
        notional: product.notional || 100,
        notionalFormatted: ParticipationNoteEvaluationHelpers.formatCurrency(
          product.notional || 100,
          product.currency || 'USD'
        )
      },

      // Generate a descriptive product name
      generatedProductName: this.generateProductName(underlyings, participationParams)
    };

    console.log('📈 [Participation Note] Evaluation complete');
    console.log('📈 [Participation Note] Underlyings with news:', underlyings.map(u => ({
      ticker: u.ticker,
      hasNews: !!u.news,
      newsCount: u.news?.length || 0,
      newsTitle: u.news?.[0]?.title
    })));
    return report;
  },

  /**
   * Extract Participation Note parameters from product
   */
  extractParticipationNoteParameters(product) {
    const structureParams = product.structureParams || product.structureParameters || {};
    const structure = product.structure || {};

    // Participation rate (percentage of performance to receive)
    const participationRate = structureParams.participationRate ||
                             structure.participationRate ||
                             100; // Default 100% (1:1 participation)

    // Strike level (reference point for performance calculation)
    const strike = structureParams.strike ||
                  structure.strike ||
                  100; // Default 100% (at-the-money)

    // Reference performance (worst-of, best-of, average)
    const referencePerformance = structureParams.referencePerformance ||
                                structure.referencePerformance ||
                                'worst-of';

    return {
      participationRate,
      strike,
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
      tradeDate: product.tradeDate,
      tradeDateFormatted: formatDate(product.tradeDate),
      valueDate: product.valueDate,
      valueDateFormatted: formatDate(product.valueDate),
      finalObservation: product.finalObservation || product.finalObservationDate,
      finalObservationFormatted: formatDate(product.finalObservation || product.finalObservationDate),
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
  },

  /**
   * Generate a descriptive product name
   */
  generateProductName(underlyings, params) {
    if (!underlyings || underlyings.length === 0) {
      return `Participation Note (${params.participationRate.toFixed(0)}%)`;
    }

    const tickers = underlyings.map(u => u.ticker).join('/');
    const basketLabel = underlyings.length > 1
      ? ` ${params.referencePerformance} basket`
      : '';

    return `${tickers}${basketLabel} Participation Note (${params.participationRate.toFixed(0)}% participation)`;
  }
};
