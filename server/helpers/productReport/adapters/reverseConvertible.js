/**
 * Reverse convertible: a coupon, and the capital repaid in full unless an
 * underlying ends below the protection barrier. Reads
 * reverseConvertibleEvaluator's templateResults.
 */
import { underlyingsOf, headlineFor } from '../common.js';

export default {
  templateKey: 'tplReverseConvertible',

  build({ results: r, status, f, t }) {
    const s = r.reverseConvertibleStructure || {};
    const red = r.redemption || {};
    const barrier = Number.isFinite(s.capitalProtectionBarrier) ? s.capitalProtectionBarrier : null;
    const pc = (v, d = 0) => (Number.isFinite(v) ? f.pctOf(v, d) : '—');
    const coupon = pc(s.couponRate, 2);

    return {
      headline: headlineFor(red.totalValue, { status, results: r, f, t }),
      underlyings: underlyingsOf(r, f, t, { barrier }),
      payoff: {
        title: t('titlePayoffRC'),
        left: [{
          title: t('protectionBarrier'),
          rows: [
            { label: t('protectionBarrier'), value: pc(barrier) },
            ...(Number.isFinite(s.strike) ? [{ label: t('strikeLevel'), value: pc(s.strike) }] : []),
            ...(Number.isFinite(s.gearingFactor) ? [{ label: t('gearing'), value: `${f.num(s.gearingFactor, 2)}×` }] : []),
            { label: t('status'), value: red.barrierBreached ? t('barrierBreached') : t('barSafe'), tone: red.barrierBreached ? 'neg' : 'pos' }
          ]
        }],
        right: Number.isFinite(red.totalValue) ? [{
          title: status.key === 'live' ? t('indicativeRedemption') : t('finalRedemption'),
          rows: [
            { label: t('capitalComponent'), value: pc(red.capitalComponent, 2) },
            { label: t('couponComponent'), value: pc(red.coupon, 2) },
            { label: t('totalValue'), value: f.pctOf(red.totalValue), strong: true },
            { label: t('pnl'), value: f.signedPctOf(red.totalValue - 100), tone: red.totalValue >= 100 ? 'pos' : 'neg' }
          ],
          text: red.barrierBreached ? t('rcBreached', { barrier: pc(barrier), capital: pc(red.capitalComponent, 2) }) : t('rcIntact', { barrier: pc(barrier) })
        }] : []
      },
      schedule: null,
      parameters: [
        { label: t('protectionBarrier'), value: pc(barrier) },
        { label: t('couponRate'), value: coupon },
        ...(Number.isFinite(s.strike) ? [{ label: t('strikeLevel'), value: pc(s.strike) }] : []),
        ...(Number.isFinite(s.gearingFactor) ? [{ label: t('gearing'), value: `${f.num(s.gearingFactor, 2)}×` }] : [])
      ],
      howItWorks: [t('howRC', { coupon, barrier: pc(barrier) })]
    };
  }
};
