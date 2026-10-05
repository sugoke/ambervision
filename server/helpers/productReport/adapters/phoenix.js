/**
 * Phoenix autocallable: coupons (with memory), autocall levels, protection at
 * maturity. Reads phoenixEvaluator's templateResults.
 */
import { underlyingsOf, basketModeLabel, couponPerPeriod, frequencyLabel, toIso } from '../common.js';

const TYPE_KEYS = { 'Coupon Only': 'typeCoupon', 'Autocall & Coupon': 'typeAutocallCoupon', 'Maturity & Coupon': 'typeFinal' };

export default {
  templateKey: 'tplPhoenix',

  build({ results: r, product, status, f, t }) {
    const s = r.phoenixStructure || {};
    const obs = r.observationAnalysis || {};
    const imv = r.indicativeMaturityValue || null;
    const observations = obs.observations || [];
    const protection = Number.isFinite(s.protectionBarrier) ? s.protectionBarrier : null;
    const couponBarrier = Number.isFinite(s.couponBarrier) ? s.couponBarrier : protection;
    const basketMode = product.basketMode || product.structureParams?.referencePerformance;
    const basketWord = /best/i.test(basketMode || '') ? t('basketBest') : /average|basket/i.test(basketMode || '') ? t('basketAvg') : t('basketWorst');

    // Autocall levels: one value, or a step-down from first to last callable date
    const callLevels = observations.filter(o => o.isCallable && Number.isFinite(o.autocallLevel)).map(o => o.autocallLevel);
    const autocallText = !callLevels.length ? (Number.isFinite(s.autocallBarrier) ? f.pctOf(s.autocallBarrier, 0) : '—')
      : callLevels[0] === callLevels[callLevels.length - 1] ? f.pctOf(callLevels[0], 0)
        : t('stepDown', { from: f.pctOf(callLevels[0], 0), to: f.pctOf(callLevels[callLevels.length - 1], 0) });

    // Headline: indicative value while live, final amount once closed
    const headlineLabel = status.key === 'autocalled' ? t('autocallRedemption') : status.key === 'live' ? t('indicativeValue') : t('finalRedemption');
    const headline = imv && Number.isFinite(imv.totalValue) ? {
      label: headlineLabel,
      value: f.pctOf(imv.totalValue),
      caption: Number.isFinite(imv.pnl) ? `${t('pnl')} ${f.signedPctOf(imv.pnl)}` : null,
      tone: imv.pnl >= 0 ? 'pos' : 'neg'
    } : null;

    const done = observations.filter(o => o.hasOccurred).length;

    // Next observation, as a sentence built from the prediction's numbers
    const p = obs.nextObservationPrediction;
    let next = null;
    if (status.key === 'live' && p && p.date) {
      const level = Number.isFinite(p.currentBasketLevel) ? f.pctOf(100 + p.currentBasketLevel) : '—';
      const vars = {
        level,
        barrier: Number.isFinite(couponBarrier) ? f.pctOf(couponBarrier, 0) : '—',
        coupon: f.pctOf(p.memoryAmountAdded || p.couponAmount || s.couponRate),
        total: f.pctOf(p.memoryWouldBeAdded ? (p.totalMemoryCoupons || 0) + (p.memoryAmountAdded || 0) : (p.totalMemoryCoupons || 0)),
        autocall: Number.isFinite(p.autocallLevel) ? f.pctOf(p.autocallLevel, 0) : autocallText,
        redemption: f.pctOf(p.redemptionAmount || p.autocallPrice || 100)
      };
      const sentence = {
        autocall: 'outcomeAutocall', coupon: p.memoryWouldBeReleased ? 'outcomeMemoryPaid' : 'outcomeCoupon',
        memory_added: 'outcomeMemoryAdded', final_redemption: 'outcomeFinal', no_event: 'outcomeNoEvent'
      }[p.outcomeType] || 'outcomeNoEvent';
      next = {
        title: t('nextObservation'),
        value: f.dateLong(p.date),
        caption: Number.isFinite(p.daysUntil) ? t('nextIn', { days: p.daysUntil }) : null,
        text: t(sentence, vars),
        note: t('basedOnCurrent')
      };
    }

    // Value block (indicative if live, actual once closed)
    let value = null;
    if (imv) {
      const basketLevel = Number.isFinite(imv.basketPerformance) ? 100 + imv.basketPerformance : null;
      // After an autocall the basket's level today no longer matters
      const rows = [
        ...(status.key === 'autocalled' ? [] : [
          { label: t('basketLevel'), value: basketLevel !== null ? t('basketPerfOfInitial', { level: f.pctOf(basketLevel) }) : '—' },
          { label: t('protectionBarrier'), value: protection !== null ? f.pctOf(protection, 0) : '—' }
        ]),
        { label: t('capitalReturn'), value: f.pctOf(imv.capitalReturn) },
        { label: t('couponsTotal'), value: f.pctOf(imv.couponsEarned) }
      ];
      if (imv.memoryCouponsForfeit && imv.memoryCouponsForfeitAmount > 0) rows.push({ label: t('memoryForfeit'), value: f.pctOf(imv.memoryCouponsForfeitAmount), muted: true });
      rows.push({ label: t('totalValue'), value: f.pctOf(imv.totalValue), strong: true });
      rows.push({ label: t('pnl'), value: f.signedPctOf(imv.pnl), tone: imv.pnl >= 0 ? 'pos' : 'neg' });
      const intact = basketLevel !== null && protection !== null && basketLevel >= protection;
      value = {
        title: headlineLabel,
        rows,
        text: status.key === 'autocalled' || basketLevel === null || protection === null ? null
          : t(intact ? 'capitalIntact' : 'capitalBelow', { level: f.pctOf(basketLevel), barrier: f.pctOf(protection, 0), capital: f.pctOf(imv.capitalReturn) })
      };
    }

    const coupons = {
      title: t('couponsTotal'),
      rows: [
        { label: t('couponRate'), value: couponPerPeriod(s.couponRate, s.observationFrequency || product.structureParams?.couponFrequency, f, t) },
        { label: t('couponsEarned'), value: f.pctOf(obs.totalCouponsEarned || 0), tone: obs.totalCouponsEarned > 0 ? 'pos' : '' },
        ...(s.memoryCoupon ? [{ label: t('couponsInMemory'), value: f.pctOf(obs.totalMemoryCoupons || 0), tone: obs.totalMemoryCoupons > 0 ? 'warn' : '' }] : []),
        { label: t('observationsDone'), value: t('remainingObs', { done, total: observations.length || obs.totalObservations || 0 }) }
      ]
    };

    // Schedule: one row per observation, outcome translated from the row's flags
    const today = toIso(new Date());
    const firstUpcoming = observations.findIndex(o => !o.hasOccurred);
    const scheduleRows = observations.map((o, i) => {
      let outcome; let tone = '';
      if (o.autocalled || o.productCalled) { outcome = t('outAutocalled'); tone = 'pos'; }
      else if (o.hasOccurred && o.couponPaid > 0) { outcome = t('outPaid'); tone = 'pos'; }
      else if (o.hasOccurred && o.memoryCouponAdded) { outcome = t('outMemory'); tone = 'warn'; }
      else if (o.hasOccurred) { outcome = o.isFinal ? t('outMatured') : t('outNone'); tone = 'neg'; }
      else { outcome = i === firstUpcoming && status.key === 'live' ? t('outNext') : t('outUpcoming'); }
      return {
        cells: {
          observation: f.dateShort(o.observationDate),
          payment: f.dateShort(o.paymentDate),
          type: t(TYPE_KEYS[o.observationType] || (o.isFinal ? 'typeFinal' : o.isCallable ? 'typeAutocallCoupon' : 'typeCoupon')),
          autocall: o.isCallable && Number.isFinite(o.autocallLevel) ? f.pctOf(o.autocallLevel, 0) : '—',
          basket: o.hasOccurred && Number.isFinite(o.basketPerformance ?? o.basketLevel) ? f.signedPctOf(o.basketPerformance ?? o.basketLevel) : '—',
          coupon: o.couponPaid > 0 ? f.pctOf(o.couponPaid) : '—',
          memory: o.couponInMemory > 0 ? f.pctOf(o.couponInMemory) : '—',
          outcome
        },
        tone,
        highlight: i === firstUpcoming && status.key === 'live',
        upcoming: !o.hasOccurred,
        basketTone: o.hasOccurred ? ((o.basketPerformance ?? o.basketLevel) >= 0 ? 'pos' : 'neg') : '',
        past: toIso(o.observationDate) <= today
      };
    });

    return {
      headline,
      underlyings: underlyingsOf(r, f, t, { barrier: protection }),
      payoff: {
        title: t('titlePayoffPhoenix'),
        left: [coupons, ...(next ? [{ ...next, kind: 'callout' }] : [])],
        right: value ? [value] : []
      },
      schedule: scheduleRows.length ? {
        title: t('titleSchedule'),
        columns: [
          { key: 'observation', label: t('colObservation') },
          { key: 'payment', label: t('colPayment') },
          { key: 'type', label: t('colType') },
          { key: 'autocall', label: t('colAutocall'), align: 'right' },
          { key: 'basket', label: t('colBasket'), align: 'right', toneFrom: 'basketTone' },
          { key: 'coupon', label: t('colCoupon'), align: 'right' },
          ...(s.memoryCoupon ? [{ key: 'memory', label: t('colMemory'), align: 'right' }] : []),
          { key: 'outcome', label: t('colOutcome'), toneFrom: 'tone' }
        ],
        rows: scheduleRows
      } : null,
      parameters: [
        { label: t('basket'), value: [basketModeLabel(basketMode, t), t('basketOf', { n: (r.underlyings || []).length })].filter(Boolean).join(' · ') },
        { label: t('autocallLevel'), value: autocallText },
        { label: t('protectionBarrier'), value: protection !== null ? f.pctOf(protection, 0) : '—' },
        { label: t('couponBarrier'), value: Number.isFinite(couponBarrier) ? f.pctOf(couponBarrier, 0) : '—' },
        { label: t('couponRate'), value: couponPerPeriod(s.couponRate, s.observationFrequency || product.structureParams?.couponFrequency, f, t) },
        { label: t('observationFrequency'), value: frequencyLabel(s.observationFrequency || product.structureParams?.couponFrequency, t, { capitalize: true }) },
        { label: t('memoryCoupon'), value: s.memoryCoupon ? t('yes') : t('no') },
        { label: t('memoryAutocall'), value: s.memoryAutocall ? t('yes') : t('no') },
        ...(s.guaranteedCoupon ? [{ label: t('guaranteedCoupon'), value: t('yes') }] : [])
      ],
      howItWorks: [t('howPhoenix', { basket: basketWord, memory: s.memoryCoupon ? t('howPhoenixMemory') : '', barrier: protection !== null ? f.pctOf(protection, 0) : '—' })]
    };
  }
};
