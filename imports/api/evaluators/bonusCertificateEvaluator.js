import { BonusCertificateEvaluationHelpers } from './bonusCertificateEvaluationHelpers';
import { SharedEvaluationHelpers } from './sharedEvaluationHelpers';

/**
 * Bonus Certificate Evaluator
 *
 * Evaluates the SSPA 1320/1330 family in one template by making participation, cap,
 * and barrier-monitoring style configurable.
 *
 * Payoff (no coupons; single payment at maturity):
 *   - No knock-in: Denom × [100% + max(0%, participation × basketPerf), capped if enabled]
 *   - Knock-in:    Denom × [100% + basketPerf]   (1:1 with underlying)
 *
 * Template Type: bonus_certificate
 */
export const BonusCertificateEvaluator = {
  async generateReport(product, context) {
    console.log('🎁 [Bonus Certificate] Starting evaluation for product:', product._id);

    // Set redemption prices when matured (reuses shared helper)
    try {
      await SharedEvaluationHelpers.setRedemptionPricesForProduct(product);
    } catch (e) {
      // Non-fatal — log and continue with what we have
      console.warn('[Bonus Certificate] setRedemptionPricesForProduct warning:', e?.message || e);
    }

    const params = this.extractParameters(product);
    console.log('🎁 [Bonus Certificate] Parameters:', params);

    // Use the shared extractor (reads product.underlyings — the canonical field)
    const underlyings = await SharedEvaluationHelpers.extractUnderlyingAssetsData(product);
    console.log('🎁 [Bonus Certificate] Underlyings extracted:', underlyings.length);

    // Resolve effective basket type: single underlying always overrides to 'single'
    const effectiveBasketType = underlyings.length <= 1 ? 'single' : (params.basketType || 'worst_of');

    // Enhanced underlyings with knock-in distance status
    const enhancedUnderlyings = this.enhanceUnderlyingsWithBarrierStatus(underlyings, params.barrierLevel);

    // Basket aggregate performance
    const basketPerformance = BonusCertificateEvaluationHelpers.aggregateBasketPerformance(
      underlyings,
      effectiveBasketType
    );

    // Knock-in evaluation (handles both European and American)
    const knockIn = await BonusCertificateEvaluationHelpers.evaluateKnockIn(
      underlyings,
      params,
      product
    );

    // Redemption calculation
    const redemptionCalc = BonusCertificateEvaluationHelpers.calculateRedemption(
      basketPerformance,
      params,
      knockIn.hasOccurred
    );

    const status = BonusCertificateEvaluationHelpers.buildProductStatus(product);
    const timeline = this.buildTimeline(product);

    // Derived display labels
    const variantLabel = params.capEnabled && params.cap !== null
      ? (params.participationRate !== 100 ? 'Capped Bonus Outperformance' : 'Capped Bonus')
      : (params.participationRate !== 100 ? 'Bonus Outperformance' : 'Bonus Certificate');

    const barrierTypeLabel = (params.barrierType || 'european').toLowerCase() === 'american'
      ? 'American (continuous)'
      : 'European (final only)';

    const maxRedemptionPct = params.capEnabled && params.cap !== null
      ? 100 + params.cap
      : null;

    const report = {
      templateType: 'bonus_certificate',
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

      bonusCertificateStructure: {
        strikeLevel: params.strikeLevel,
        strikeLevelFormatted: `${params.strikeLevel.toFixed(0)}%`,
        bonusLevel: params.bonusLevel,
        bonusLevelFormatted: `${params.bonusLevel.toFixed(0)}%`,
        barrierLevel: params.barrierLevel,
        barrierLevelFormatted: `${params.barrierLevel.toFixed(0)}%`,
        barrierType: params.barrierType,
        barrierTypeLabel,
        participationRate: params.participationRate,
        participationRateFormatted: `${params.participationRate.toFixed(0)}%`,
        capEnabled: params.capEnabled,
        cap: params.cap,
        capFormatted: params.capEnabled && params.cap !== null ? `+${params.cap.toFixed(0)}%` : 'Uncapped',
        maxRedemption: maxRedemptionPct,
        maxRedemptionFormatted: maxRedemptionPct !== null ? `${maxRedemptionPct.toFixed(0)}%` : '∞',
        basketType: effectiveBasketType,
        basketTypeLabel: this.getBasketTypeLabel(effectiveBasketType, underlyings.length),
        variantLabel
      },

      underlyings: enhancedUnderlyings,

      basketPerformance: {
        current: basketPerformance,
        currentFormatted: basketPerformance !== null
          ? `${basketPerformance >= 0 ? '+' : ''}${basketPerformance.toFixed(2)}%`
          : 'N/A',
        isPositive: basketPerformance !== null && basketPerformance >= 0
      },

      basketAnalysis: this.buildBasketAnalysis(enhancedUnderlyings, params),

      knockIn: {
        hasOccurred: knockIn.hasOccurred,
        observed: knockIn.observed,
        occurredAt: knockIn.occurredAt,
        occurredAtFormatted: knockIn.occurredAt
          ? new Date(knockIn.occurredAt).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' })
          : null,
        breachedTicker: knockIn.breachedTicker || null,
        type: knockIn.type,
        typeLabel: barrierTypeLabel,
        currentBasketPerf: knockIn.currentBasketPerf,
        currentDistance: knockIn.currentDistance,
        currentDistanceFormatted: knockIn.currentDistance !== null
          ? `${knockIn.currentDistance >= 0 ? '+' : ''}${knockIn.currentDistance.toFixed(2)}%`
          : 'N/A',
        statusLabel: knockIn.hasOccurred
          ? 'Knock-In Breached'
          : (knockIn.observed ? 'Knock-In Not Breached' : 'Not Yet Observable')
      },

      redemption: {
        scenario: redemptionCalc.scenario,
        scenarioLabel: this.getScenarioLabel(redemptionCalc.scenario),
        capitalComponent: redemptionCalc.capitalComponent,
        capitalComponentFormatted: redemptionCalc.capitalComponentFormatted,
        bonusOrUpside: redemptionCalc.bonusOrUpside,
        bonusOrUpsideFormatted: redemptionCalc.bonusOrUpsideFormatted,
        totalValue: redemptionCalc.totalValue,
        totalValueFormatted: redemptionCalc.totalValueFormatted,
        knockInOccurred: redemptionCalc.knockInOccurred,
        formula: redemptionCalc.formula
      },

      timeline,

      productDetails: {
        isin: product.isin || 'N/A',
        name: product.title || product.productName || 'Bonus Certificate',
        currency: product.currency || 'USD',
        notional: product.notional || 100,
        notionalFormatted: BonusCertificateEvaluationHelpers.formatCurrency(
          product.notional || 100,
          product.currency || 'USD'
        )
      },

      generatedProductName: BonusCertificateEvaluationHelpers.generateProductName(underlyings, {
        ...params,
        basketType: effectiveBasketType
      })
    };

    console.log('🎁 [Bonus Certificate] Evaluation complete');
    return report;
  },

  /**
   * Extract bonus certificate parameters from product with sensible fallbacks.
   * Reads from product.structureParams (primary) or product.structureParameters / structure (legacy).
   */
  extractParameters(product) {
    const sp = product.structureParams || product.structureParameters || {};
    const s = product.structure || {};

    const strikeLevel = sp.strikeLevel ?? s.strikeLevel ?? sp.strike ?? 100;
    const bonusLevel = sp.bonusLevel ?? s.bonusLevel ?? strikeLevel;
    const barrierLevel = sp.barrierLevel ?? sp.knockInThreshold ?? s.barrierLevel ?? 60;
    const barrierType = (sp.barrierType ?? s.barrierType ?? 'european').toLowerCase();
    const participationRate = sp.participationRate ?? s.participationRate ?? 100;
    const capEnabled = sp.capEnabled !== undefined ? !!sp.capEnabled : (sp.cap !== undefined && sp.cap !== null);
    const cap = capEnabled ? (sp.cap ?? s.cap ?? null) : null;
    const basketType = sp.basketType ?? s.basketType ?? 'worst_of';

    return {
      strikeLevel: Number(strikeLevel),
      bonusLevel: Number(bonusLevel),
      barrierLevel: Number(barrierLevel),
      barrierType,
      participationRate: Number(participationRate),
      capEnabled,
      cap: cap === null ? null : Number(cap),
      basketType
    };
  },

  /**
   * Enrich each underlying with KI distance/status, similar to RC's pattern.
   * For Bonus Certificate the threshold is `barrierLevel%` of initial (e.g. 60%) — i.e.
   * underlying performance must be at or below `barrierLevel - 100` (e.g. -40%).
   */
  enhanceUnderlyingsWithBarrierStatus(underlyings, barrierLevel) {
    if (!underlyings || underlyings.length === 0) return underlyings;

    const performances = underlyings.map(u => u.performance);
    const worstPerformance = Math.min(...performances);
    const barrierPerfLevel = barrierLevel - 100; // e.g. 60 → -40

    return underlyings.map(underlying => {
      const performance = underlying.performance || 0;
      const isWorstPerforming = underlying.performance === worstPerformance;
      const isPositive = performance >= 0;
      const distanceToBarrier = performance - barrierPerfLevel;

      let barrierStatus = 'safe';
      let barrierStatusText = 'Safe';
      if (performance <= barrierPerfLevel) {
        barrierStatus = 'breached';
        barrierStatusText = 'At/Below KI';
      } else if (distanceToBarrier < 10) {
        barrierStatus = 'near';
        barrierStatusText = 'Near KI';
      }

      return {
        ...underlying,
        isWorstPerforming,
        distanceToBarrier,
        distanceToBarrierFormatted: `${distanceToBarrier >= 0 ? '+' : ''}${distanceToBarrier.toFixed(1)}%`,
        barrierStatus,
        barrierStatusText
      };
    });
  },

  buildBasketAnalysis(underlyings, params) {
    if (!underlyings || underlyings.length === 0) return null;

    const barrierLevel = params.barrierLevel;
    const safeCount = underlyings.filter(u => u.barrierStatus === 'safe').length;
    const nearCount = underlyings.filter(u => u.barrierStatus === 'near').length;
    const breachedCount = underlyings.filter(u => u.barrierStatus === 'breached').length;

    let overallStatus = 'All underlyings above knock-in threshold';
    if (breachedCount > 0) {
      overallStatus = `${breachedCount} underlying${breachedCount > 1 ? 's are' : ' is'} at or below knock-in threshold`;
    } else if (nearCount > 0) {
      overallStatus = `${nearCount} underlying${nearCount > 1 ? 's are' : ' is'} near knock-in threshold`;
    }

    const distances = underlyings.map(u => u.distanceToBarrier).filter(d => d !== undefined);
    const criticalDistance = distances.length > 0 ? Math.min(...distances) : 0;

    return {
      barrierLevel,
      criticalDistance,
      criticalDistanceFormatted: `${criticalDistance >= 0 ? '+' : ''}${criticalDistance.toFixed(1)}%`,
      safeCount,
      nearCount,
      breachedCount,
      overallStatus
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
      case 'knock_in_breached': return 'Knock-in breached — 1:1 downside';
      case 'no_ki_capped': return 'No knock-in — capped outperformance';
      case 'no_ki_outperformance': return 'No knock-in — outperformance';
      case 'no_ki_bonus_floor': return 'No knock-in — bonus floor';
      default: return scenario;
    }
  }
};
