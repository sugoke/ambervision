/**
 * Himalaya: on each observation the best underlying still in the basket is
 * recorded and removed; payout = capital + average of the recorded
 * performances, floored. Reads himalayaEvaluator's templateResults.
 */
import { underlyingsOf, headlineFor, frequencyLabel } from '../common.js';

export default {
  templateKey: 'tplHimalaya',

  build({ results: r, status, f, t }) {
    const s = r.himalayaStructure || {};
    const calc = r.himalayaCalculation || {};
    const history = calc.selectionHistory || [];
    const floor = Number.isFinite(s.floor) ? s.floor : null;
    const total = Number.isFinite(r.totalPayout) ? r.totalPayout : calc.finalPayout;
    const done = history.filter(h => h.status === 'frozen' || h.hasPassed).length;
    const firstPending = history.findIndex(h => !(h.status === 'frozen' || h.hasPassed));

    return {
      headline: headlineFor(total, { status, results: r, f, t }),
      underlyings: underlyingsOf(r, f, t, { withDistance: false }),
      payoff: {
        title: t('titlePayoffHimalaya'),
        left: [{
          title: t('selectionDone'),
          rows: history.filter(h => h.status === 'frozen' || h.hasPassed).map(h => ({
            label: `${f.dateShort(h.observationDate)} · ${h.selectedUnderlying || '—'}`,
            value: Number.isFinite(h.performance) ? f.signedPctOf(h.performance) : '—',
            tone: h.performance >= 0 ? 'pos' : 'neg'
          })).concat([{ label: t('observationsDone'), value: t('remainingObs', { done, total: history.length }) }])
        }],
        right: Number.isFinite(total) ? [{
          title: status.key === 'live' ? t('indicativeRedemption') : t('finalRedemption'),
          rows: [
            { label: t('averagePerformance'), value: Number.isFinite(r.averagePerformance) ? f.signedPctOf(r.averagePerformance) : '—' },
            { label: t('floor'), value: floor !== null ? f.pctOf(floor, 0) : '—' },
            { label: t('payout'), value: f.pctOf(total), strong: true },
            { label: t('pnl'), value: f.signedPctOf(total - 100), tone: total >= 100 ? 'pos' : 'neg' }
          ],
          text: t('himalayaText', { avg: Number.isFinite(r.averagePerformance) ? f.signedPctOf(r.averagePerformance) : '—', floor: floor !== null ? f.pctOf(floor, 0) : '—', payout: f.pctOf(total) })
        }] : []
      },
      schedule: history.length ? {
        title: t('titleSelection'),
        columns: [
          { key: 'number', label: t('colNumber') },
          { key: 'observation', label: t('colObservation') },
          { key: 'selected', label: t('colSelected') },
          { key: 'performance', label: t('colPerformance'), align: 'right', toneFrom: 'perfTone' },
          { key: 'remaining', label: t('colRemaining'), align: 'right' },
          { key: 'outcome', label: t('colOutcome'), toneFrom: 'tone' }
        ],
        rows: history.map((h, i) => {
          const passed = h.status === 'frozen' || h.hasPassed;
          return {
            cells: {
              number: String(h.observationNumber ?? i + 1),
              observation: f.dateShort(h.observationDate),
              selected: passed ? (h.selectedUnderlying || '—') : '—',
              performance: passed && Number.isFinite(h.performance) ? f.signedPctOf(h.performance) : '—',
              remaining: Number.isFinite(h.remainingUnderlyings) ? String(h.remainingUnderlyings) : '—',
              outcome: passed ? t('selFrozen') : i === firstPending && status.key === 'live' ? t('outNext') : t('selPending')
            },
            tone: passed ? 'pos' : '',
            perfTone: passed ? (h.performance >= 0 ? 'pos' : 'neg') : '',
            highlight: i === firstPending && status.key === 'live',
            upcoming: !passed
          };
        })
      } : null,
      parameters: [
        { label: t('basket'), value: t('basketOf', { n: (r.underlyings || []).length }) },
        { label: t('floor'), value: floor !== null ? f.pctOf(floor, 0) : '—' },
        { label: t('observationFrequency'), value: frequencyLabel(s.observationFrequency, t, { capitalize: true }) }
      ],
      howItWorks: [t('howHimalaya', { floor: floor !== null ? f.pctOf(floor, 0) : '—' })]
    };
  }
};
