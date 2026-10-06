/**
 * Rate note: fixed then floating coupons on reference rates, optional target
 * redemption, capital protection. No underlying prices. Reads rateEvaluator's
 * templateResults.
 */
import { headlineFor, frequencyLabel } from '../common.js';

const STATUS_KEYS = { paid: 'rsPaid', upcoming: 'rsUpcoming', pending_fixing: 'rsPending', redeemed: 'rsRedeemed', cancelled: 'rsCancelled' };

export default {
  templateKey: 'tplRate',

  build({ results: r, status, f, t }) {
    const s = r.rateStructure || {};
    const sched = r.schedule || {};
    const target = r.targetRedemption || {};
    const red = r.redemption || {};
    const periods = sched.periods || [];
    const pc = (v, d = 2) => (Number.isFinite(v) ? f.pctOf(v, d) : '—');
    const firstUpcoming = periods.findIndex(p => p.status === 'upcoming' || p.status === 'pending_fixing');

    return {
      headline: headlineFor(red.totalValue, { status, results: r, f, t }),
      underlyings: null,
      payoff: {
        title: t('titlePayoffRate'),
        left: [{
          title: t('couponsTotal'),
          rows: [
            { label: t('fixedCoupon'), value: Number.isFinite(s.fixedCouponRate) ? `${f.pctOf(s.fixedCouponRate)} p.a.` : '—' },
            ...(s.floatingFormulaLabel ? [{ label: t('floatingCoupon'), value: s.floatingFormulaLabel }] : []),
            ...((r.referenceRates || []).length ? [{ label: t('referenceRates'), value: r.referenceRates.map(x => x.name || x.ticker).join(', ') }] : []),
            ...(s.targetEnabled ? [
              { label: t('targetCoupon'), value: pc(s.targetCoupon) },
              { label: t('targetProgress'), value: Number.isFinite(sched.knownCumulative) ? pc(sched.knownCumulative) : (sched.knownCumulativeFormatted || '—') },
              ...(target.reached ? [{ label: t('status'), value: t('targetReached', { date: f.dateShort(target.redemptionDate) }), tone: 'pos' }] : [])
            ] : [])
          ]
        }],
        right: Number.isFinite(red.totalValue) ? [{
          title: status.key === 'live' ? t('indicativeRedemption') : t('finalRedemption'),
          rows: [
            { label: t('capitalComponent'), value: pc(red.capitalComponent) },
            { label: t('couponComponent'), value: pc(red.couponComponent) },
            { label: t('totalValue'), value: f.pctOf(red.totalValue), strong: true }
          ]
        }] : []
      },
      schedule: periods.length ? {
        title: t('titleCouponSchedule'),
        columns: [
          { key: 'period', label: t('colPeriod') },
          { key: 'observation', label: t('colObservation') },
          { key: 'payment', label: t('colPayment') },
          { key: 'type', label: t('colType') },
          { key: 'rate', label: t('colRate'), align: 'right' },
          { key: 'coupon', label: t('colPeriodCoupon'), align: 'right' },
          { key: 'cumulative', label: t('colCumulative'), align: 'right' },
          { key: 'outcome', label: t('colStatusShort'), toneFrom: 'tone' }
        ],
        rows: periods.map((p, i) => ({
          cells: {
            period: String(p.periodIndex ?? i + 1),
            observation: f.dateShort(p.observationDate),
            payment: f.dateShort(p.paymentDate),
            type: p.couponType === 'fixed' ? t('fixedCoupon') : t('floatingCoupon'),
            rate: pc(p.annualRatePa),
            coupon: pc(p.periodCoupon),
            cumulative: pc(p.cumulativeCoupon),
            outcome: t(STATUS_KEYS[p.status] || 'rsUpcoming')
          },
          tone: p.status === 'paid' ? 'pos' : p.status === 'redeemed' ? 'pos' : '',
          highlight: i === firstUpcoming && status.key === 'live',
          upcoming: p.status === 'upcoming' || p.status === 'pending_fixing'
        }))
      } : null,
      parameters: [
        { label: t('capitalProtection'), value: pc(s.capitalProtection, 0) },
        { label: t('fixedCoupon'), value: Number.isFinite(s.fixedCouponRate) ? `${f.pctOf(s.fixedCouponRate)} p.a.` : '—' },
        ...(s.floatingFormulaLabel ? [{ label: t('floatingCoupon'), value: s.floatingFormulaLabel }] : []),
        { label: t('couponFrequency'), value: frequencyLabel(s.couponFrequency, t, { capitalize: true }) },
        ...(s.targetEnabled ? [{ label: t('targetCoupon'), value: pc(s.targetCoupon) }] : [])
      ],
      howItWorks: []
    };
  }
};
