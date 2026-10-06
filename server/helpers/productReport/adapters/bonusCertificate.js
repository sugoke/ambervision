/**
 * Bonus certificate: bonus level and participation above it unless the
 * knock-in barrier is breached, optionally capped. Reads
 * bonusCertificateEvaluator's templateResults.
 */
import { underlyingsOf, headlineFor, barrierTypeLabel } from '../common.js';

export default {
  templateKey: 'tplBonus',

  build({ results: r, status, f, t }) {
    const s = r.bonusCertificateStructure || {};
    const ki = r.knockIn || {};
    const red = r.redemption || {};
    const barrier = Number.isFinite(s.barrierLevel) ? s.barrierLevel : null;
    const pc = (v, d = 0) => (Number.isFinite(v) ? f.pctOf(v, d) : '—');
    const kiText = ki.hasOccurred ? t('kiOccurred', { date: f.dateShort(ki.occurredAt) })
      : (String(ki.type || s.barrierType).includes('european') && !ki.observed) ? t('kiNotYet') : t('kiNone');

    return {
      headline: headlineFor(red.totalValue, { status, results: r, f, t }),
      underlyings: underlyingsOf(r, f, t, { barrier }),
      payoff: {
        title: t('titlePayoffBonus'),
        left: [{
          title: t('knockIn'),
          rows: [
            { label: t('barrierLevel'), value: pc(barrier) },
            { label: t('barrierType'), value: barrierTypeLabel(ki.type || s.barrierType, t) },
            { label: t('status'), value: kiText, tone: ki.hasOccurred ? 'neg' : 'pos' },
            ...(Number.isFinite(ki.currentDistance) ? [{ label: t('colDistance'), value: f.signedPctOf(ki.currentDistance, 1) }] : [])
          ]
        }],
        right: Number.isFinite(red.totalValue) ? [{
          title: status.key === 'live' ? t('indicativeRedemption') : t('finalRedemption'),
          rows: [
            { label: t('capitalComponent'), value: pc(red.capitalComponent, 2) },
            { label: t('bonusOrUpside'), value: Number.isFinite(red.bonusOrUpside) ? f.signedPctOf(red.bonusOrUpside) : '—' },
            { label: t('totalValue'), value: f.pctOf(red.totalValue), strong: true },
            { label: t('pnl'), value: f.signedPctOf(red.totalValue - 100), tone: red.totalValue >= 100 ? 'pos' : 'neg' }
          ],
          text: t('bonusText', { total: f.pctOf(red.totalValue) })
        }] : []
      },
      schedule: null,
      parameters: [
        { label: t('strikeLevel'), value: pc(s.strikeLevel) },
        { label: t('bonusLevel'), value: pc(s.bonusLevel) },
        { label: t('barrierLevel'), value: pc(barrier) },
        { label: t('barrierType'), value: barrierTypeLabel(s.barrierType, t) },
        { label: t('participationRate'), value: pc(s.participationRate) },
        ...(s.capEnabled ? [{ label: t('cap'), value: Number.isFinite(s.cap) ? f.signedPctOf(s.cap, 0) : '—' }, { label: t('maxRedemption'), value: pc(s.maxRedemption) }] : [])
      ],
      howItWorks: [t('howBonus', { barrier: pc(barrier), bonus: pc(s.bonusLevel), rate: pc(s.participationRate), cap: s.capEnabled && Number.isFinite(s.maxRedemption) ? t('howBonusCap', { cap: pc(s.maxRedemption) }) : '' })]
    };
  }
};
