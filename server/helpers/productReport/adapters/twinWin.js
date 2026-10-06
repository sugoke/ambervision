/**
 * Twin win: gains from the underlying's move in either direction between a
 * lower and an upper barrier; bonus and capital protection outside them.
 * Reads twinWinEvaluator's templateResults.
 */
import { underlyingsOf, headlineFor, barrierTypeLabel } from '../common.js';

export default {
  templateKey: 'tplTwinWin',

  build({ results: r, status, f, t }) {
    const s = r.twinWinStructure || {};
    const b = r.barriers || {};
    const red = r.redemption || {};
    const pc = (v, d = 0) => (Number.isFinite(v) ? f.pctOf(v, d) : '—');
    const touchedText = (touched, date) => (touched ? t('touched', { date: f.dateShort(date) }) : t('notTouched'));

    return {
      headline: headlineFor(red.totalValue, { status, results: r, f, t }),
      underlyings: underlyingsOf(r, f, t, {
        barrier: Number.isFinite(s.lowerBarrier) ? s.lowerBarrier : null,
        distanceOf: (u) => u.distanceToLower,
        distanceLabel: t('colDistanceLower'),
        statusOf: (u) => (u.barrierStatus === 'upper' ? { text: t('twAboveUpper'), tone: 'warn' }
          : u.barrierStatus === 'lower' ? { text: t('twBelowLower'), tone: 'neg' }
            : u.barrierStatus === 'near' ? { text: t('barNear'), tone: 'warn' } : { text: t('barSafe'), tone: 'pos' })
      }),
      payoff: {
        title: t('titlePayoffTwinWin'),
        left: [{
          title: t('barrierType'),
          rows: [
            { label: `${t('upperTouched')} · ${pc(s.upperBarrier)}`, value: touchedText(b.upperTouched, b.upperTouchDate), tone: b.upperTouched ? 'warn' : '' },
            { label: `${t('lowerTouched')} · ${pc(s.lowerBarrier)}`, value: touchedText(b.lowerTouched, b.lowerTouchDate), tone: b.lowerTouched ? 'warn' : '' },
            { label: t('barrierType'), value: barrierTypeLabel(b.type || s.barrierType, t) }
          ]
        }],
        right: Number.isFinite(red.totalValue) ? [{
          title: status.key === 'live' ? t('indicativeRedemption') : t('finalRedemption'),
          rows: [
            { label: t('capitalComponent'), value: pc(red.capitalComponent, 2) },
            { label: t('participationComponent'), value: Number.isFinite(red.participationComponent) ? f.signedPctOf(red.participationComponent) : '—' },
            { label: t('totalValue'), value: f.pctOf(red.totalValue), strong: true },
            { label: t('pnl'), value: f.signedPctOf(red.totalValue - 100), tone: red.totalValue >= 100 ? 'pos' : 'neg' }
          ],
          text: t('twinText', { total: f.pctOf(red.totalValue) })
        }] : []
      },
      schedule: null,
      parameters: [
        { label: t('capitalProtection'), value: pc(s.capitalProtection) },
        { label: t('bonus'), value: pc(s.bonus) },
        { label: t('lowerBarrier'), value: pc(s.lowerBarrier) },
        { label: t('upperBarrier'), value: pc(s.upperBarrier) },
        { label: t('barrierType'), value: barrierTypeLabel(s.barrierType, t) },
        { label: t('minRedemption'), value: pc(s.minRedemption) }
      ],
      howItWorks: [t('howTwinWin', { lower: pc(s.lowerBarrier), upper: pc(s.upperBarrier), bonus: pc(s.bonus), protection: pc(s.capitalProtection), min: pc(s.minRedemption) })]
    };
  }
};
