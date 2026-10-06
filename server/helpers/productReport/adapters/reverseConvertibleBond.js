/**
 * Reverse convertible on a bond: coupon, then par in cash above the strike or
 * delivery of the bond at or below it. The bond is quoted in % of par.
 * Reads reverseConvertibleBondEvaluator's templateResults.
 */
import { underlyingsOf, headlineFor, hasMissingPrices, barrierTypeLabel } from '../common.js';

export default {
  templateKey: 'tplReverseConvertibleBond',

  build({ results: r, product, status, f, t }) {
    const s = r.reverseConvertibleStructure || {};
    const red = r.redemption || {};
    const bond = (r.underlyings || [])[0] || {};
    const missing = hasMissingPrices(r);
    const strike = Number.isFinite(s.strikeLevel) ? f.pctOf(s.strikeLevel) : '—';
    const coupon = Number.isFinite(s.couponRate) ? f.pctOf(s.couponRate, 3) : '—';
    const physical = red.settlementType === 'physical_delivery' || red.strikeBreached;
    const ccy = product.currency || '';

    return {
      headline: headlineFor(red.totalValue, { status, results: r, f, t }),
      underlyings: underlyingsOf(r, f, t, {
        priceAsPercent: true,
        barrier: Number.isFinite(s.strikeLevel) ? s.strikeLevel : null,
        distanceOf: (u) => u.distanceToStrike ?? u.distanceToBarrier,
        statusOf: (u) => (u.strikeStatus === 'breached' || u.barrierStatus === 'breached' ? { text: t('strikeBelow'), tone: 'neg' } : { text: t('strikeAbove'), tone: 'pos' })
      }),
      payoff: {
        title: t('titlePayoffRCB'),
        left: [{
          title: t('strikeLevel'),
          rows: [
            { label: t('strikeLevel'), value: strike },
            { label: t('bondLevel'), value: missing || !Number.isFinite(bond.currentPrice) ? '—' : f.pctOf(bond.currentPrice) },
            { label: t('distanceToStrike'), value: missing ? '—' : Number.isFinite(bond.distanceToStrike) ? f.signedPctOf(bond.distanceToStrike, 1) : '—' },
            { label: t('settlement'), value: missing ? '—' : physical ? t('settlePhysical') : t('settleCash') }
          ]
        }],
        right: missing ? [] : [{
          title: status.key === 'live' ? t('indicativeRedemption') : t('finalRedemption'),
          rows: [
            { label: physical ? t('settlePhysical') : t('capitalComponent'), value: Number.isFinite(red.capitalComponent) ? f.pctOf(red.capitalComponent) : '—' },
            { label: t('couponComponent'), value: coupon },
            { label: t('totalValue'), value: Number.isFinite(red.totalValue) ? f.pctOf(red.totalValue) : '—', strong: true }
          ],
          text: physical ? t('rcbPhysical', { strike, ratio: Number.isFinite(s.conversionRatio) ? f.num(s.conversionRatio, 4) : '—' }) : t('rcbCash', { strike })
        }]
      },
      schedule: null,
      parameters: [
        { label: t('strikeLevel'), value: strike },
        { label: t('couponRate'), value: coupon },
        ...(Number.isFinite(s.denomination) ? [{ label: t('denomination'), value: `${f.num(s.denomination, 0)} ${ccy}`.trim() }] : []),
        ...(Number.isFinite(s.conversionRatio) ? [{ label: t('conversionRatio'), value: f.num(s.conversionRatio, 4) }] : []),
        { label: t('barrierType'), value: barrierTypeLabel(s.barrierType, t) }
      ],
      howItWorks: [t('howRCB', { coupon, strike })]
    };
  }
};
