import { AthenaEvaluationHelpers as H } from './athenaEvaluationHelpers';
import { SharedEvaluationHelpers } from './sharedEvaluationHelpers';
import { PhoenixEvaluator } from './phoenixEvaluator';
import { PhoenixEvaluationHelpers } from './phoenixEvaluationHelpers';
import { matchAllScheduledPayments } from '../helpers/paymentMatcher.js';
import { hasRedemptionLadder, redemptionAmountFor } from '/imports/utils/scheduleGenerator.js';

/**
 * Athena Evaluator
 *
 * Worst-of autocallable with no periodic coupon: the coupon accrues and is paid only
 * inside the redemption amount, early or at maturity.
 *  - Autocall: on a callable observation, every underlying >= its autocall level ->
 *    the note redeems at that row's redemption amount (e.g. N x (80% + n x 10%)).
 *  - Final: the worst-of level selects a tier of structureParams.finalPayoffTiers.
 *  - Returns are shown on notional and on the issue price paid (structureParams.issuePrice).
 *
 * Every term comes from the product (schedule rows, tiers, issue price); nothing is
 * assumed here.
 *
 * Template Type: athena
 */
export const AthenaEvaluator = {
  async generateReport(product, context) {
    console.log('🦉 [Athena] Starting evaluation for product:', product._id);

    try {
      await SharedEvaluationHelpers.setRedemptionPricesForProduct(product);
    } catch (e) {
      console.warn('[Athena] setRedemptionPricesForProduct warning:', e?.message || e);
    }

    const params = this.extractParameters(product);
    const underlyings = await SharedEvaluationHelpers.extractUnderlyingAssetsData(product, { issueCollector: context?.issueCollector });

    const observationAnalysis = await this.buildObservationSchedule(product, underlyings, params, context?.issueCollector);

    // Current worst-of, measured on the same basis as the observations
    const currentLevels = underlyings.map(u => {
      const basis = u.effectiveInitialPrice || u.initialPrice;
      return basis > 0 && u.currentPrice > 0 ? (u.currentPrice / basis) * 100 : null;
    });
    const hasAllLevels = currentLevels.length > 0 && currentLevels.every(l => l !== null);
    const currentWorstLevel = hasAllLevels ? Math.min(...currentLevels) : null;

    // Barrier status per underlying against the level the capital is at risk from
    const riskParams = { protectionBarrier: params.capitalAtRiskLevel ?? params.finalBarrier ?? 0 };
    const enhancedUnderlyings = PhoenixEvaluator.enhanceUnderlyingsWithChartData(underlyings, riskParams, null);

    const currentStatus = PhoenixEvaluationHelpers.buildProductStatus(product, observationAnalysis);
    const indicativeMaturityValue = this.buildIndicativeValue(product, params, observationAnalysis, currentWorstLevel, currentStatus);
    const activeTierIndex = indicativeMaturityValue.activeTierIndex;

    const tickers = underlyings.map(u => u.ticker).join('/');

    const report = {
      templateType: 'athena',
      templateVersion: '1.0.0',

      features: {
        hasAutocall: params.callableCount > 0,
        hasMemoryCoupon: false,
        hasProtection: params.capitalAtRiskLevel !== null,
        observationFrequency: params.observationFrequency
      },

      currentStatus,

      athenaStructure: {
        issuePrice: params.issuePrice,
        issuePriceFormatted: H.formatLevel(params.issuePrice),
        tiers: H.describeTiers(params.finalPayoffTiers, activeTierIndex),
        finalBarrier: params.finalBarrier,
        finalBarrierFormatted: H.formatLevel(params.finalBarrier),
        capitalAtRiskLevel: params.capitalAtRiskLevel,
        capitalAtRiskLevelFormatted: H.formatLevel(params.capitalAtRiskLevel),
        // Same names as phoenixStructure, read by the event detector, risk and portfolio reviews
        protectionBarrier: params.capitalAtRiskLevel,
        autocallBarrier: params.firstAutocallLevel,
        autocallBarrierFormatted: H.formatLevel(params.firstAutocallLevel),
        couponRate: params.couponPerPeriod,
        couponPerPeriodFormatted: params.couponPerPeriod !== null ? H.formatLevel(params.couponPerPeriod) : null,
        redemptionBase: params.redemptionBase,
        observationFrequency: params.observationFrequency,
        basketTypeLabel: underlyings.length > 1 ? 'Worst-of' : 'Single underlying'
      },

      underlyings: enhancedUnderlyings,
      basketAnalysis: PhoenixEvaluator.buildBasketAnalysis(enhancedUnderlyings, riskParams),
      observationAnalysis,
      indicativeMaturityValue,

      generatedProductName: tickers ? `${tickers} Athena` : (product.title || 'Athena'),

      placeholderResults: {
        message: 'Athena evaluation completed',
        autocallTriggered: !!observationAnalysis.isEarlyAutocall,
        couponPayment: 0,
        capitalProtection: params.capitalAtRiskLevel
      }
    };

    console.log('🦉 [Athena] Evaluation complete:', currentStatus.productStatus, indicativeMaturityValue.redemptionAmountFormatted);
    return report;
  },

  /**
   * Terms from the product. The schedule rows carry autocall levels and amounts; the
   * schedule config is used only to fill an amount a row lacks.
   */
  extractParameters(product) {
    const sp = product.structureParams || product.structureParameters || {};
    const config = product.scheduleConfig || {};
    const schedule = product.observationSchedule || [];

    const issuePrice = sp.issuePrice !== undefined && sp.issuePrice !== null && sp.issuePrice !== '' && !isNaN(Number(sp.issuePrice))
      ? Number(sp.issuePrice)
      : 100;
    const finalPayoffTiers = H.normalizeTiers(sp.finalPayoffTiers);
    const callableRows = schedule.filter((row, i) => row.isCallable && i < schedule.length - 1);
    const firstAutocallLevel = callableRows.length ? Number(callableRows[0].autocallLevel) : null;
    const step = hasRedemptionLadder(config) && config.redemptionStep !== undefined && config.redemptionStep !== ''
      ? Number(config.redemptionStep)
      : null;

    return {
      issuePrice,
      finalPayoffTiers,
      finalBarrier: finalPayoffTiers.length ? finalPayoffTiers[0].fromLevel : null,
      capitalAtRiskLevel: H.capitalAtRiskLevel(finalPayoffTiers),
      firstAutocallLevel,
      callableCount: callableRows.length,
      couponPerPeriod: step,
      redemptionBase: hasRedemptionLadder(config) ? Number(config.redemptionBase ?? 100) : null,
      scheduleConfig: config,
      observationFrequency: config.frequency || sp.couponFrequency || null
    };
  },

  /** Redemption amount of a schedule row: the row's own, else the config ladder */
  rowRedemptionAmount(row, index, params) {
    const own = row.redemptionAmount;
    if (own !== undefined && own !== null && own !== '' && !isNaN(Number(own))) return Number(own);
    if (hasRedemptionLadder(params.scheduleConfig)) return redemptionAmountFor(index + 1, params.scheduleConfig);
    return null;
  },

  async buildObservationSchedule(product, underlyings, params, issueCollector = null) {
    const schedule = product.observationSchedule || [];
    const issueDate = product.valueDate || product.issueDate || product.tradeDate;
    const tradeDate = new Date(product.tradeDate || product.issueDate);

    if (schedule.length === 0) {
      issueCollector?.addIssue?.('INVALID_DATE_CONFIGURATION', { field: 'observationSchedule' });
    }

    // Same strike basis as Phoenix: term sheet strike, pence / split aware, mismatch flagged
    const initialPrices = underlyings.length
      ? await PhoenixEvaluator.resolveInitialPrices(underlyings, tradeDate, issueCollector)
      : {};

    const todayOnly = (() => { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); })();
    const observations = [];
    let productCalled = false;
    let callDate = null;
    let callPaymentDate = null;
    let callAmount = null;
    let finalPayout = null;
    let finalTierIndex = -1;

    for (const [i, obs] of schedule.entries()) {
      const obsDate = new Date(obs.observationDate);
      const obsDateOnly = new Date(obsDate.getFullYear(), obsDate.getMonth(), obsDate.getDate());
      const isToday = obsDateOnly.getTime() === todayOnly.getTime();
      let isPast = obsDateOnly < todayOnly;
      const isFinal = i === schedule.length - 1;

      // Worst-of level (% of initial) at the observation
      let worstLevel = null;
      const underlyingFlags = [];
      if ((isPast || isToday) && underlyings.length > 0 && !productCalled) {
        const levels = await Promise.all(underlyings.map(async (u) => {
          const fullTicker = u.fullTicker || `${u.ticker}.US`;
          const price = await PhoenixEvaluator.getPriceAtDate(fullTicker, obsDate, tradeDate, { exactOnly: isToday });
          const basis = initialPrices[u.ticker];
          return price && basis ? { ticker: u.ticker, level: (price / basis) * 100 } : null;
        }));
        if (levels.every(l => l !== null)) {
          worstLevel = Math.min(...levels.map(l => l.level));
          if (isToday) isPast = true;
          levels.forEach(l => underlyingFlags.push({
            ticker: l.ticker,
            performance: l.level - 100,
            performanceFormatted: H.formatPercent(l.level - 100, { signed: true }),
            isFlagged: obs.isCallable && obs.autocallLevel !== null && l.level >= Number(obs.autocallLevel),
            isCallableObservation: !!obs.isCallable
          }));
        } else if (!isToday) {
          console.warn(`⚠️ [Athena] Incomplete prices for observation ${i + 1} on ${obsDate.toISOString().split('T')[0]} — worst-of unknown`);
        }
      }

      const autocallLevel = obs.isCallable && obs.autocallLevel !== null && obs.autocallLevel !== undefined && obs.autocallLevel !== ''
        ? Number(obs.autocallLevel)
        : null;
      const scheduledAmount = this.rowRedemptionAmount(obs, i, params);
      const wasCalledBefore = productCalled;

      let autocalled = false;
      if (isPast && !isFinal && !productCalled && autocallLevel !== null && worstLevel !== null && worstLevel >= autocallLevel) {
        autocalled = true;
        productCalled = true;
        callDate = obs.observationDate;
        callPaymentDate = obs.valueDate;
        callAmount = scheduledAmount;
      }

      // Final observation: the tiers decide
      let redemptionAmount = scheduledAmount;
      let finalTier = null;
      if (isFinal && !productCalled) {
        if (isPast && worstLevel !== null) {
          const res = H.evaluateFinalTiers(worstLevel, params.finalPayoffTiers);
          finalPayout = res.payout;
          finalTierIndex = res.tierIndex;
          redemptionAmount = res.payout;
          finalTier = res.tier;
        } else {
          // Not fixed yet: show the amount of the top tier (worst-of at or above the final barrier)
          const top = params.finalPayoffTiers[0];
          redemptionAmount = top && top.type === 'fixed' ? top.amount : null;
        }
      }

      const paysHere = autocalled || (isFinal && isPast && !productCalled);
      const returnOnIssue = H.returnOnIssuePrice(redemptionAmount, params.issuePrice);
      const annualized = H.annualizedReturn(redemptionAmount, params.issuePrice, issueDate, obs.valueDate);

      let observationType = 'No Autocall';
      if (isFinal) observationType = 'Final Redemption';
      else if (obs.isCallable) observationType = 'Autocall';

      let outcome = 'upcoming';
      if (wasCalledBefore) outcome = 'cancelled';
      else if (autocalled) outcome = 'autocalled';
      else if (isFinal && isPast) outcome = 'matured';
      else if (isPast && worstLevel === null) outcome = 'missing_data';
      else if (isPast) outcome = obs.isCallable ? 'not_called' : 'not_callable';

      observations.push({
        observationDate: obs.observationDate,
        observationDateFormatted: H.formatDate(obs.observationDate),
        paymentDate: obs.valueDate,
        paymentDateFormatted: H.formatDate(obs.valueDate),
        observationType,
        periodNumber: i + 1,
        basketLevel: worstLevel !== null ? worstLevel - 100 : null,
        basketLevelFormatted: worstLevel !== null ? H.formatPercent(worstLevel - 100, { signed: true }) : (isPast ? 'N/A (Missing Data)' : 'TBD'),
        basketPerformance: worstLevel !== null ? worstLevel - 100 : null,
        worstOfLevel: worstLevel,
        worstOfLevelFormatted: worstLevel !== null ? H.formatPercent(worstLevel) : null,
        basketAboveBarrier: autocallLevel !== null && worstLevel !== null && worstLevel >= autocallLevel,
        // No coupon is ever paid on its own: it is inside the redemption amount
        couponPaid: 0,
        couponAmount: 0,
        couponPaidFormatted: '-',
        couponInMemory: 0,
        memoryCouponAdded: false,
        redemptionAmount,
        redemptionAmountFormatted: H.formatLevel(redemptionAmount),
        accruedCoupon: redemptionAmount !== null && params.redemptionBase !== null && !isFinal ? redemptionAmount - 100 : null,
        returnOnIssuePrice: returnOnIssue,
        returnOnIssuePriceFormatted: H.formatPercent(returnOnIssue, { signed: true }),
        annualizedReturnFormatted: H.formatPercent(annualized, { signed: true }),
        finalTierLabel: finalTier ? H.describeTierFormula(finalTier) : null,
        paysRedemption: paysHere,
        autocalled,
        productCalled: autocalled,
        autocallLevel,
        autocallLevelFormatted: autocallLevel !== null ? H.formatLevel(autocallLevel) : 'N/A',
        isCallable: !!obs.isCallable && !isFinal,
        isFinal,
        hasOccurred: isPast && !wasCalledBefore,
        outcome,
        status: wasCalledBefore ? 'cancelled' : (isPast ? 'completed' : 'upcoming'),
        underlyingFlags,
        allUnderlyingsFlagged: underlyingFlags.length > 0 && underlyingFlags.every(f => f.isFlagged)
      });
    }

    const last = observations[observations.length - 1];
    const isMaturedAtFinal = !productCalled && !!last && last.status === 'completed';
    const remainingObservations = (productCalled || isMaturedAtFinal) ? 0 : observations.filter(o => o.status === 'upcoming').length;

    const activeObservations = observations.filter(o => o.status !== 'cancelled');
    const nextObservationPrediction = this.predictNextObservation(product, underlyings, initialPrices, activeObservations, params, productCalled || isMaturedAtFinal);
    const enhancedObservations = await matchAllScheduledPayments(product, activeObservations);

    return {
      totalObservations: schedule.length,
      observations: enhancedObservations,
      totalCouponsEarned: 0,
      totalCouponsEarnedFormatted: '-',
      totalMemoryCoupons: 0,
      totalMemoryCouponsFormatted: '-',
      remainingObservations,
      hasMemoryAutocall: false,
      hasMemoryCoupon: false,
      hasGuaranteedCoupon: false,
      isEarlyAutocall: productCalled,
      callDate,
      callDateFormatted: H.formatDate(callDate),
      callPaymentDate,
      callPaymentDateFormatted: H.formatDate(callPaymentDate),
      callAmount,
      callAmountFormatted: H.formatLevel(callAmount),
      isMaturedAtFinal,
      finalPayout,
      finalPayoutFormatted: H.formatLevel(finalPayout),
      finalTierIndex,
      underlyingAutocallFlags: {},
      nextObservationPrediction
    };
  },

  /**
   * What the next observation would do at today's closes: autocall at the row's amount,
   * the final tier at maturity, or nothing.
   */
  predictNextObservation(product, underlyings, initialPrices, observations, params, isRedeemed) {
    if (isRedeemed) return null;
    const next = observations.find(o => o.status === 'upcoming');
    if (!next) return null;

    const levels = underlyings.map(u => {
      const basis = initialPrices[u.ticker];
      return basis > 0 && u.currentPrice > 0 ? { ticker: u.ticker, name: u.name, level: (u.currentPrice / basis) * 100 } : null;
    });
    if (levels.length === 0 || levels.some(l => l === null)) return null;
    const worst = Math.min(...levels.map(l => l.level));
    const issueDate = product.valueDate || product.issueDate || product.tradeDate;
    const daysUntil = Math.ceil((new Date(next.observationDate) - new Date()) / 86400000);

    let outcomeType = 'no_event';
    let amount = null;
    let displayText;
    let explanation;
    if (next.isFinal) {
      const res = H.evaluateFinalTiers(worst, params.finalPayoffTiers);
      amount = res.payout;
      outcomeType = 'final_redemption';
      displayText = `Final redemption at ${H.formatLevel(amount)}`;
      explanation = res.tier
        ? `Worst-of at ${H.formatPercent(worst)} of initial falls in the tier ${H.describeTierFormula(res.tier)}.`
        : `Worst-of at ${H.formatPercent(worst)} of initial is below every payoff tier.`;
    } else if (next.isCallable && next.autocallLevel !== null && worst >= next.autocallLevel) {
      amount = next.redemptionAmount;
      outcomeType = 'autocall';
      displayText = `Autocall at ${H.formatLevel(amount)}`;
      explanation = `Worst-of at ${H.formatPercent(worst)} of initial is at or above the ${H.formatLevel(next.autocallLevel)} autocall level.`;
    } else if (next.isCallable) {
      displayText = 'No autocall';
      explanation = `Worst-of at ${H.formatPercent(worst)} of initial is below the ${H.formatLevel(next.autocallLevel)} autocall level.`;
    } else {
      displayText = 'Not callable';
      explanation = 'This observation date has no autocall.';
    }

    const returnOnIssue = H.returnOnIssuePrice(amount, params.issuePrice);
    const annualized = H.annualizedReturn(amount, params.issuePrice, issueDate, next.paymentDate);

    return {
      date: next.observationDate,
      dateFormatted: next.observationDateFormatted,
      paymentDateFormatted: next.paymentDateFormatted,
      daysUntil,
      isLastObservation: next.isFinal,
      isFinalObservation: next.isFinal,
      currentBasketLevel: worst - 100,
      currentBasketLevelFormatted: H.formatPercent(worst - 100, { signed: true }),
      currentWorstOfLevelFormatted: H.formatPercent(worst),
      autocallLevel: next.autocallLevel,
      autocallLevelFormatted: next.autocallLevelFormatted,
      autocallWouldTrigger: outcomeType === 'autocall',
      couponWouldPay: false,
      redemptionAmount: amount,
      redemptionAmountFormatted: H.formatLevel(amount),
      autocallPriceFormatted: outcomeType === 'autocall' ? H.formatLevel(amount) : null,
      returnOnIssuePrice: returnOnIssue,
      returnOnIssuePriceFormatted: H.formatPercent(returnOnIssue, { signed: true }),
      annualizedReturn: annualized,
      annualizedReturnFormatted: H.formatPercent(annualized, { signed: true }),
      underlyingPerformances: levels.map(l => ({
        ticker: l.ticker,
        name: l.name,
        performance: l.level - 100,
        performanceFormatted: H.formatPercent(l.level - 100, { signed: true })
      })),
      outcomeType,
      displayText,
      explanation,
      assumption: 'Assuming closing prices on the observation date equal today\'s.'
    };
  },

  /**
   * Redemption the holder gets (autocalled / matured) or would get if the note matured
   * at today's worst-of (live), on notional and on the issue price.
   */
  buildIndicativeValue(product, params, observationAnalysis, currentWorstLevel, currentStatus) {
    const isAutocalled = !!observationAnalysis.isEarlyAutocall;
    const isMatured = !isAutocalled && !!observationAnalysis.isMaturedAtFinal;
    const isLive = !isAutocalled && !isMatured;
    const issueDate = product.valueDate || product.issueDate || product.tradeDate;
    const maturity = product.maturity || product.maturityDate;

    let amount = null;
    let tierIndex = -1;
    let level = currentWorstLevel;
    let endDate = maturity;
    let explanation;

    if (isAutocalled) {
      amount = observationAnalysis.callAmount;
      endDate = observationAnalysis.callPaymentDate || maturity;
      explanation = `Autocalled on ${observationAnalysis.callDateFormatted}: redeemed at ${H.formatLevel(amount)} of notional.`;
    } else if (isMatured) {
      amount = observationAnalysis.finalPayout;
      tierIndex = observationAnalysis.finalTierIndex;
      const finalObs = observationAnalysis.observations[observationAnalysis.observations.length - 1];
      level = finalObs?.worstOfLevel ?? null;
      explanation = `Matured with the worst-of at ${H.formatPercent(level)} of initial: redeemed at ${H.formatLevel(amount)} of notional.`;
    } else if (currentWorstLevel !== null) {
      const res = H.evaluateFinalTiers(currentWorstLevel, params.finalPayoffTiers);
      amount = res.payout;
      tierIndex = res.tierIndex;
      explanation = res.tier
        ? `If the note matured today, the worst-of at ${H.formatPercent(currentWorstLevel)} of initial would pay ${H.describeTierFormula(res.tier)} = ${H.formatLevel(amount)}.`
        : `If the note matured today, the worst-of at ${H.formatPercent(currentWorstLevel)} of initial would be below every payoff tier.`;
    }

    const returnOnIssue = H.returnOnIssuePrice(amount, params.issuePrice);
    const annualized = H.annualizedReturn(amount, params.issuePrice, issueDate, endDate);
    const pnl = amount !== null ? amount - 100 : null;

    return {
      isLive,
      isMatured,
      isAutocalled,
      basketPerformance: level !== null ? level - 100 : null,
      basketPerformanceFormatted: level !== null ? H.formatPercent(level - 100, { signed: true }) : 'N/A',
      worstOfLevel: level,
      worstOfLevelFormatted: H.formatPercent(level),
      activeTierIndex: tierIndex,
      redemptionAmount: amount,
      redemptionAmountFormatted: H.formatLevel(amount),
      capitalReturn: amount,
      capitalReturnFormatted: H.formatLevel(amount),
      capitalExplanation: explanation || 'Prices unavailable: the indicative redemption cannot be computed.',
      totalValue: amount,
      totalValueFormatted: H.formatLevel(amount),
      pnl,
      pnlFormatted: H.formatPercent(pnl, { signed: true }),
      pnlIsPositive: pnl !== null && pnl >= 0,
      issuePrice: params.issuePrice,
      issuePriceFormatted: H.formatLevel(params.issuePrice),
      returnOnIssuePrice: returnOnIssue,
      returnOnIssuePriceFormatted: H.formatPercent(returnOnIssue, { signed: true }),
      returnIsPositive: returnOnIssue !== null && returnOnIssue >= 0,
      annualizedReturn: annualized,
      annualizedReturnFormatted: H.formatPercent(annualized, { signed: true }),
      evaluationDateFormatted: currentStatus.evaluationDateFormatted
    };
  }
};
