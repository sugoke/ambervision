/**
 * Orion: each underlying counts with its own performance unless it reaches the
 * upper barrier, then for the fixed rebate; capital guaranteed at maturity.
 * Reads orionEvaluator's templateResults.
 */
import { underlyingsOf, headlineFor, frequencyLabel } from '../common.js';

export default {
  templateKey: 'tplOrion',

  build({ results: r, status, f, t }) {
    const s = r.orionStructure || {};
    const imv = r.indicativeMaturityValue || {};
    const list = r.underlyings || [];
    const upper = Number.isFinite(s.upperBarrier) ? s.upperBarrier : null;
    const pctOrDash = (v, d = 2) => (Number.isFinite(v) ? f.pctOf(v, d) : '—');
    const hit = list.filter(u => u.hitUpperBarrier);
    const total = Number.isFinite(imv.totalValue) ? imv.totalValue : imv.capitalReturn;
    const vars = { upper: pctOrDash(upper, 0), rebate: pctOrDash(s.rebate, 1), guarantee: pctOrDash(s.capitalGuaranteed, 0) };

    return {
      headline: headlineFor(total, { status, results: r, f, t }),
      underlyings: underlyingsOf(r, f, t, {
        barrier: upper,
        withDistance: false,
        statusOf: (u) => (u.hitUpperBarrier ? { text: t('orionCapped'), tone: 'warn' } : { text: t('orionParticipating'), tone: 'pos' })
      }),
      payoff: {
        title: t('titlePayoffOrion'),
        left: [{
          title: t('countedPerformances'),
          rows: [
            ...list.map(u => ({ label: `${u.ticker || u.name}${u.hitUpperBarrier ? ` · ${t('orionCapped')}` : ''}`, value: Number.isFinite(u.consideredPerformance) ? f.signedPctOf(u.consideredPerformance) : '—', tone: u.consideredPerformance >= 0 ? 'pos' : 'neg' })),
            { label: t('basketCounted'), value: Number.isFinite(r.basketConsideredPerformance) ? f.signedPctOf(r.basketConsideredPerformance) : '—', strong: true }
          ]
        }],
        right: Number.isFinite(total) ? [{
          title: status.key === 'live' ? t('indicativeRedemption') : t('finalRedemption'),
          rows: [
            { label: t('capitalGuaranteed'), value: pctOrDash(s.capitalGuaranteed, 0) },
            { label: t('basketCounted'), value: Number.isFinite(r.basketConsideredPerformance) ? f.signedPctOf(r.basketConsideredPerformance) : '—' },
            { label: t('totalValue'), value: f.pctOf(total), strong: true },
            { label: t('pnl'), value: f.signedPctOf(total - 100), tone: total >= 100 ? 'pos' : 'neg' }
          ],
          text: hit.length ? t('orionSomeHit', { ...vars, n: hit.length, total: list.length }) : t('orionNoneHit', vars)
        }] : []
      },
      schedule: null,
      parameters: [
        { label: t('upperBarrier'), value: pctOrDash(upper, 0) },
        { label: t('rebate'), value: pctOrDash(s.rebate, 1) },
        { label: t('capitalGuaranteed'), value: pctOrDash(s.capitalGuaranteed, 0) },
        ...(s.hasLowerBarrier && Number.isFinite(s.lowerBarrier) ? [{ label: t('lowerBarrier'), value: f.pctOf(s.lowerBarrier, 0) }] : []),
        { label: t('observationFrequency'), value: frequencyLabel(s.observationFrequency, t, { capitalize: true }) },
        { label: t('basket'), value: t('basketOf', { n: list.length }) }
      ],
      howItWorks: [t('howOrion', vars)]
    };
  }
};
