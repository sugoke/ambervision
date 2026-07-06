import { TwinWinEvaluationHelpers } from './twinWinEvaluationHelpers';
import { SharedEvaluationHelpers } from './sharedEvaluationHelpers';

/**
 * Twin Win Evaluator
 *
 * EUSIPA/SSPA 1135 — Capital Protection with Twin Win. Single payment at maturity.
 *
 * Payoff (perf = basket performance %, CP = capital protection, Bonus = floor,
 * LB/UB = lower/upper barriers observed American-continuous by default):
 *   1) Neither touched: CP + max(Bonus, |perf|)   ← gains in either direction
 *   2) Upper touched:   CP + max(Bonus, -perf)
 *   3) Lower touched:   CP + max(Bonus, perf)
 *   4) Both touched:    CP + Bonus
 *
 * Template Type: twin_win
 */
export const TwinWinEvaluator = {
  async generateReport(product, context) {
    console.log('🔁 [Twin Win] Starting evaluation for product:', product._id);

    // Set redemption prices when matured (reuses shared helper) — non-fatal.
    try {
      await SharedEvaluationHelpers.setRedemptionPricesForProduct(product);
    } catch (e) {
      console.warn('[Twin Win] setRedemptionPricesForProduct warning:', e?.message || e);
    }

    const params = this.extractParameters(product);
    console.log('🔁 [Twin Win] Parameters:', params);

    // Shared extractor reads product.underlyings — the canonical field.
    const underlyings = await SharedEvaluationHelpers.extractUnderlyingAssetsData(product);
    console.log('🔁 [Twin Win] Underlyings extracted:', underlyings.length);

    // Single underlying always overrides basket type to 'single'.
    const effectiveBasketType = underlyings.length <= 1 ? 'single' : (params.basketType || 'worst_of');
    const effectiveParams = { ...params, basketType: effectiveBasketType };

    const enhancedUnderlyings = TwinWinEvaluationHelpers.enhanceUnderlyingsWithBarrierStatus(
      underlyings,
      params.lowerBarrier,
      params.upperBarrier
    );

    const basketPerformance = TwinWinEvaluationHelpers.aggregateBasketPerformance(
      underlyings,
      effectiveBasketType
    );

    const barriers = await TwinWinEvaluationHelpers.evaluateDualBarrier(
      underlyings,
      effectiveParams,
      product
    );

    const redemptionCalc = TwinWinEvaluationHelpers.calculateRedemption(
      basketPerformance,
      effectiveParams,
      barriers
    );

    const status = TwinWinEvaluationHelpers.buildProductStatus(product);
    const timeline = this.buildTimeline(product);

    const barrierTypeLabel = (params.barrierType || 'american').toLowerCase() === 'american'
      ? 'American (continuous)'
      : 'European (final only)';

    const minRedemption = params.capitalProtection + params.bonus;

    const formatTouchDate = (d) => d
      ? new Date(d).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
      : null;

    const report = {
      templateType: 'twin_win',
      templateVersion: '1.0.0',

      currentStatus: {
        productStatus: status.productStatus,
        statusDetails: status.statusDetails,
        evaluationDate: status.evaluationDate,
        evaluationDateFormatted: status.evaluationDateFormatted,
        daysToMaturity: status.daysToMaturity,
        daysToMaturityText: status.daysToMaturityText,
        hasMatured: status.hasMatured
      },

      twinWinStructure: {
        capitalProtection: params.capitalProtection,
        capitalProtectionFormatted: `${params.capitalProtection.toFixed(0)}%`,
        bonus: params.bonus,
        bonusFormatted: `${params.bonus.toFixed(0)}%`,
        lowerBarrier: params.lowerBarrier,
        lowerBarrierFormatted: `${params.lowerBarrier.toFixed(0)}%`,
        upperBarrier: params.upperBarrier,
        upperBarrierFormatted: `${params.upperBarrier.toFixed(0)}%`,
        barrierType: params.barrierType,
        barrierTypeLabel,
        minRedemption,
        minRedemptionFormatted: `${minRedemption.toFixed(0)}%`,
        basketType: effectiveBasketType,
        basketTypeLabel: this.getBasketTypeLabel(effectiveBasketType, underlyings.length)
      },

      underlyings: enhancedUnderlyings,

      basketPerformance: {
        current: basketPerformance,
        currentFormatted: basketPerformance !== null
          ? `${basketPerformance >= 0 ? '+' : ''}${basketPerformance.toFixed(2)}%`
          : 'N/A',
        isPositive: basketPerformance !== null && basketPerformance >= 0
      },

      barriers: {
        upperTouched: !!barriers.upperTouched,
        lowerTouched: !!barriers.lowerTouched,
        observed: !!barriers.observed,
        type: barriers.type,
        typeLabel: barrierTypeLabel,
        upperTouchDate: barriers.upperTouchDate || null,
        upperTouchDateFormatted: formatTouchDate(barriers.upperTouchDate),
        lowerTouchDate: barriers.lowerTouchDate || null,
        lowerTouchDateFormatted: formatTouchDate(barriers.lowerTouchDate),
        breachedTickerUpper: barriers.breachedTickerUpper || null,
        breachedTickerLower: barriers.breachedTickerLower || null,
        upperStatusLabel: barriers.upperTouched ? 'Upper Barrier Touched'
          : (barriers.observed ? 'Upper Barrier Not Touched' : 'Not Yet Observable'),
        lowerStatusLabel: barriers.lowerTouched ? 'Lower Barrier Touched'
          : (barriers.observed ? 'Lower Barrier Not Touched' : 'Not Yet Observable')
      },

      redemption: {
        scenario: redemptionCalc.scenario,
        scenarioLabel: this.getScenarioLabel(redemptionCalc.scenario),
        capitalComponent: redemptionCalc.capitalComponent,
        capitalComponentFormatted: redemptionCalc.capitalComponentFormatted,
        participationComponent: redemptionCalc.participationComponent,
        participationComponentFormatted: redemptionCalc.participationComponentFormatted,
        totalValue: redemptionCalc.totalValue,
        totalValueFormatted: redemptionCalc.totalValueFormatted,
        formula: redemptionCalc.formula
      },

      timeline,

      productDetails: {
        isin: product.isin || 'N/A',
        name: product.title || product.productName || 'Twin Win',
        currency: product.currency || 'USD',
        notional: product.notional || 100,
        notionalFormatted: TwinWinEvaluationHelpers.formatCurrency(
          product.notional || 100,
          product.currency || 'USD'
        )
      },

      generatedProductName: TwinWinEvaluationHelpers.generateProductName(underlyings, effectiveParams)
    };

    console.log('🔁 [Twin Win] Evaluation complete:', report.redemption.scenario, report.redemption.totalValueFormatted);
    return report;
  },

  /**
   * Extract Twin Win parameters with sensible fallbacks.
   * Reads product.structureParams (primary) or structureParameters / structure (legacy).
   */
  extractParameters(product) {
    const sp = product.structureParams || product.structureParameters || {};
    const s = product.structure || {};

    const capitalProtection = sp.capitalProtection ?? sp.capitalProtectionLevel ?? sp.capitalGuarantee ?? s.capitalProtection ?? 100;
    const bonus = sp.bonus ?? sp.bonusCoupon ?? s.bonus ?? 15;
    const lowerBarrier = sp.lowerBarrier ?? s.lowerBarrier ?? 70;
    const upperBarrier = sp.upperBarrier ?? s.upperBarrier ?? 130;
    const barrierType = (sp.barrierType ?? s.barrierType ?? 'american').toLowerCase();
    // Accept legacy referencePerformance ('worst-of') as a basketType source.
    const refPerf = sp.referencePerformance ?? s.referencePerformance;
    const refAsBasket = refPerf ? String(refPerf).replace('-', '_') : undefined;
    const basketType = sp.basketType ?? s.basketType ?? refAsBasket ?? 'single';

    return {
      capitalProtection: Number(capitalProtection),
      bonus: Number(bonus),
      lowerBarrier: Number(lowerBarrier),
      upperBarrier: Number(upperBarrier),
      barrierType,
      basketType
    };
  },

  buildTimeline(product) {
    const formatDate = (date) => {
      if (!date) return 'N/A';
      return new Date(date).toLocaleDateString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric'
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
  },

  getBasketTypeLabel(basketType, underlyingCount) {
    if (underlyingCount <= 1) return 'Single underlying';
    switch ((basketType || 'worst_of').toLowerCase()) {
      case 'best_of': return 'Best-of basket';
      case 'average': return 'Average basket';
      case 'single': return 'Single underlying';
      case 'worst_of':
      default: return 'Worst-of basket';
    }
  },

  getScenarioLabel(scenario) {
    switch (scenario) {
      case 'no_touch': return 'No barrier touched — twin-win participation';
      case 'upper_touched': return 'Upper barrier touched — downside-converted gain';
      case 'lower_touched': return 'Lower barrier touched — upside participation';
      case 'both_touched': return 'Both barriers touched — bonus floor';
      default: return scenario;
    }
  }
};
