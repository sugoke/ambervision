import { RateEvaluationHelpers } from './rateEvaluationHelpers';

/**
 * Rate Evaluator
 *
 * Rate-linked, capital-protected coupon certificate with a Target Redemption
 * (TARN) feature. Reference example: BNP "10Y EUR Target Steepener Certificate"
 * (XS2519475037) — 100% capital protected; fixed coupons for the first N
 * periods, then a floating CMS steepener spread; auto-redeems when the
 * cumulative coupon reaches the target (e.g. 18%).
 *
 * This evaluator performs NO underlying-price lookups. The floating coupons are
 * supplied via optional product.couponFixings[] (manual fixings); periods with
 * no fixing are reported as "pending fixing".
 *
 * Template Type: rate
 */
export const RateEvaluator = {
  async generateReport(product, context) {
    console.log('📈 [Rate] Starting evaluation for product:', product._id);

    const params = this.extractParameters(product);
    const fixings = Array.isArray(product.couponFixings) ? product.couponFixings : [];

    const schedule = RateEvaluationHelpers.computeSchedule(product, params, fixings);
    const status = RateEvaluationHelpers.buildProductStatus(product, schedule);
    const timeline = this.buildTimeline(product);

    const freqLabel = this.getFrequencyLabel(params.couponFrequency);

    // Reference rates (synthetic underlyings — never priced).
    const referenceRates = (product.underlyings || []).map(u => ({
      name: u.name || u.companyName || u.ticker,
      ticker: u.ticker
    }));

    // Redemption: capital is protected; coupon component is the known cumulative
    // (or exactly the target if the TARN has triggered).
    const couponComponent = schedule.redeemed ? schedule.target : schedule.knownCumulative;
    const totalValue = params.capitalProtection + (couponComponent || 0);
    const redemptionFormula = schedule.redeemed
      ? `${params.capitalProtection.toFixed(0)}% + ${RateEvaluationHelpers.formatPct(schedule.target)} (target reached) = ${totalValue.toFixed(2)}%`
      : `${params.capitalProtection.toFixed(0)}% capital + coupons (${RateEvaluationHelpers.formatPct(couponComponent || 0)} known${schedule.anyPending ? ', floating pending' : ''})`;

    const report = {
      templateType: 'rate',
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

      rateStructure: {
        capitalProtection: params.capitalProtection,
        capitalProtectionFormatted: `${params.capitalProtection.toFixed(0)}%`,
        targetCoupon: params.targetCoupon,
        targetCouponFormatted: params.targetEnabled ? `${params.targetCoupon.toFixed(2)}%` : 'None',
        targetEnabled: params.targetEnabled,
        fixedCouponRate: params.fixedCouponRate,
        fixedCouponRateFormatted: `${params.fixedCouponRate.toFixed(2)}% p.a.`,
        fixedPeriods: params.fixedPeriods,
        couponFrequency: params.couponFrequency,
        couponFrequencyLabel: freqLabel,
        floatingFormulaLabel: params.floatingFormulaLabel
      },

      referenceRates,

      schedule: {
        periods: schedule.periods,
        totalPeriods: schedule.periods.length,
        knownCumulative: schedule.knownCumulative,
        knownCumulativeFormatted: RateEvaluationHelpers.formatPct(schedule.knownCumulative),
        anyPending: schedule.anyPending,
        targetProgressPct: schedule.targetProgressPct,
        targetProgressFormatted: schedule.targetProgressPct === null
          ? 'N/A'
          : `${schedule.targetProgressPct.toFixed(1)}%`
      },

      targetRedemption: {
        enabled: params.targetEnabled,
        reached: schedule.redeemed,
        redemptionPeriodIndex: schedule.redemptionPeriodIndex,
        redemptionDate: schedule.redemptionDate,
        redemptionDateFormatted: RateEvaluationHelpers.formatDate(schedule.redemptionDate),
        finalCoupon: schedule.finalCoupon,
        finalCouponFormatted: schedule.finalCoupon === null ? null : RateEvaluationHelpers.formatPct(schedule.finalCoupon),
        statusLabel: !params.targetEnabled
          ? 'No target redemption'
          : (schedule.redeemed ? 'Target reached — early redemption' : 'Target not yet reached')
      },

      redemption: {
        capitalComponent: params.capitalProtection,
        capitalComponentFormatted: `${params.capitalProtection.toFixed(2)}%`,
        couponComponent: couponComponent || 0,
        couponComponentFormatted: RateEvaluationHelpers.formatPct(couponComponent || 0),
        totalValue,
        totalValueFormatted: `${totalValue.toFixed(2)}%`,
        capitalProtected: true,
        formula: redemptionFormula
      },

      timeline,

      productDetails: {
        isin: product.isin || 'N/A',
        name: product.title || product.productName || 'Rate Certificate',
        currency: product.currency || 'EUR',
        notional: product.notional || 100,
        notionalFormatted: RateEvaluationHelpers.formatCurrency(product.notional || 100, product.currency || 'EUR')
      },

      generatedProductName: this.generateProductName(product, params)
    };

    console.log('📈 [Rate] Evaluation complete:', report.currentStatus.productStatus,
      `known cumulative ${report.schedule.knownCumulativeFormatted}`);
    return report;
  },

  extractParameters(product) {
    const sp = product.structureParams || product.structureParameters || {};
    const s = product.structure || {};

    const capitalProtection = sp.capitalProtection ?? sp.capitalProtectionLevel ?? s.capitalProtection ?? 100;
    const targetCoupon = sp.targetCoupon ?? sp.targetCouponPercentage ?? s.targetCoupon ?? 18;
    const targetEnabled = sp.targetRedemptionEnabled !== undefined
      ? !!sp.targetRedemptionEnabled
      : (targetCoupon !== null && targetCoupon !== undefined && Number(targetCoupon) > 0);
    const fixedCouponRate = sp.fixedCouponRate ?? sp.baseCouponRate ?? s.fixedCouponRate ?? 8.5;
    const fixedPeriods = sp.fixedPeriods ?? s.fixedPeriods ?? 8;
    const couponFrequency = (sp.couponFrequency ?? s.couponFrequency ?? 'quarterly').toLowerCase();
    const floatingFormulaLabel = sp.floatingFormulaLabel ?? s.floatingFormulaLabel
      ?? 'Max(EUR CMS 30Y − EUR CMS 5Y, 0%)';

    return {
      capitalProtection: Number(capitalProtection),
      targetCoupon: Number(targetCoupon),
      targetEnabled,
      fixedCouponRate: Number(fixedCouponRate),
      fixedPeriods: Number(fixedPeriods),
      couponFrequency,
      floatingFormulaLabel
    };
  },

  buildTimeline(product) {
    const f = (d) => RateEvaluationHelpers.formatDate(d);
    return {
      tradeDate: product.tradeDate,
      tradeDateFormatted: f(product.tradeDate),
      issueDate: product.valueDate || product.issueDate,
      issueDateFormatted: f(product.valueDate || product.issueDate),
      finalObservation: product.finalObservation || product.finalObservationDate,
      finalObservationFormatted: f(product.finalObservation || product.finalObservationDate),
      maturityDate: product.maturity || product.maturityDate,
      maturityDateFormatted: f(product.maturity || product.maturityDate)
    };
  },

  getFrequencyLabel(frequency) {
    switch ((frequency || 'quarterly').toLowerCase()) {
      case 'monthly': return 'Monthly';
      case 'quarterly': return 'Quarterly';
      case 'semi-annually':
      case 'semi_annual':
      case 'semiannual': return 'Semi-annually';
      case 'annually':
      case 'annual': return 'Annually';
      default: return frequency;
    }
  },

  generateProductName(product, params) {
    const rates = (product.underlyings || []).map(u => u.ticker).filter(Boolean);
    const label = rates.length ? rates.join(' / ') : 'Rate';
    return `${label} Target Steepener (${params.capitalProtection}% CP, ${params.targetEnabled ? params.targetCoupon + '% target' : 'no target'})`;
  }
};
