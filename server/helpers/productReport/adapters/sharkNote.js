/**
 * Shark note: capital plus the performance, floored, unless the upper barrier
 * is touched: then capital plus a fixed rebate. Reads sharkNoteEvaluator's
 * templateResults.
 */
import { underlyingsOf, headlineFor, referenceLabel } from '../common.js';

export default {
  templateKey: 'tplShark',

  build({ results: r, status, f, t }) {
    const s = r.sharkStructure || {};
    const touch = r.barrierTouch || {};
    const red = r.redemption || {};
    const pc = (v, d = 0) => (Number.isFinite(v) ? f.pctOf(v, d) : '—');
    const upper = Number.isFinite(s.upperBarrier) ? s.upperBarrier : null;

    return {
      headline: headlineFor(red.value, { status, results: r, f, t }),
      underlyings: underlyingsOf(r, f, t, { barrier: upper, withDistance: false }),
      payoff: {
        title: t('titlePayoffShark'),
        left: [{
          title: t('upperBarrier'),
          rows: [
            { label: t('upperBarrier'), value: pc(upper) },
            { label: t('status'), value: touch.touched ? `${t('barrierTouched')} ${touch.touchDate ? t('touchedOn', { date: f.dateShort(touch.touchDate) }) : ''}`.trim() : t('barrierNotTouched'), tone: touch.touched ? 'warn' : '' },
            ...(Number.isFinite(r.basketPerformance?.current) ? [{ label: t('basketPerformance'), value: f.signedPctOf(r.basketPerformance.current), tone: r.basketPerformance.current >= 0 ? 'pos' : 'neg' }] : [])
          ]
        }],
        right: Number.isFinite(red.value) ? [{
          title: status.key === 'live' ? t('indicativeRedemption') : t('finalRedemption'),
          rows: [
            { label: t('redemptionValue'), value: f.pctOf(red.value), strong: true },
            { label: t('pnl'), value: f.signedPctOf(red.value - 100), tone: red.value >= 100 ? 'pos' : 'neg' }
          ],
          text: t('sharkText', { value: f.pctOf(red.value) })
        }] : []
      },
      schedule: null,
      parameters: [
        { label: t('upperBarrier'), value: pc(upper) },
        { label: t('rebate'), value: pc(s.rebateValue, 1) },
        { label: t('floor'), value: pc(s.floorLevel) },
        { label: t('basketPerformance'), value: referenceLabel(s.referencePerformance, t) }
      ],
      howItWorks: [t('howShark', { upper: pc(upper), rebate: pc(s.rebateValue, 1), floor: pc(s.floorLevel) })]
    };
  }
};
