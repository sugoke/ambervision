/**
 * Participation note: capital plus a share of the reference performance, with
 * an optional protection level and issuer call. Reads
 * participationNoteEvaluator's templateResults.
 */
import { underlyingsOf, headlineFor, referenceLabel, toIso } from '../common.js';

export default {
  templateKey: 'tplParticipation',

  build({ results: r, status, f, t }) {
    const s = r.participationStructure || {};
    const part = r.participation || {};
    const red = r.redemption || {};
    const call = r.issuerCall || {};
    const imv = r.indicativeMaturityValue || {};
    const total = status.key === 'live' && Number.isFinite(imv.totalValue) ? imv.totalValue : red.value;
    const rate = Number.isFinite(s.participationRate) ? f.pctOf(s.participationRate, 0) : '—';
    const protection = red.hasProtection && Number.isFinite(red.protectionLevel) ? red.protectionLevel : null;
    const reference = referenceLabel(s.referencePerformance || imv.referencePerformance, t);

    const callBlock = call.hasCallOption ? {
      title: t('issuerCall'),
      rows: [
        { label: t('status'), value: call.isCalled ? t('calledOn', { date: f.dateShort(call.callDate) }) : t('notCalled'), tone: call.isCalled ? 'warn' : '' },
        ...(Number.isFinite(call.callPrice) ? [{ label: t('callPrice'), value: f.pctOf(call.callPrice) }] : []),
        ...(Number.isFinite(call.rebate) ? [{ label: t('rebate'), value: f.pctOf(call.rebate) }] : [])
      ]
    } : null;

    // Early-redemption (call) dates, when the schedule has any
    const callable = (r.observationSchedule || []).filter(o => o.isCallable);
    const today = toIso(new Date());

    return {
      headline: headlineFor(total, { status, results: r, f, t }),
      underlyings: underlyingsOf(r, f, t, { withDistance: false }),
      payoff: {
        title: t('titlePayoffParticipation'),
        left: [{
          title: t('participationRate'),
          rows: [
            { label: `${t('basketPerformance')} · ${reference}`, value: Number.isFinite(part.rawPerformance) ? f.signedPctOf(part.rawPerformance) : '—', tone: part.rawPerformance >= 0 ? 'pos' : 'neg' },
            { label: t('participationRate'), value: rate },
            { label: t('participatedPerformance'), value: Number.isFinite(part.participatedPerformance) ? f.signedPctOf(part.participatedPerformance) : '—', tone: part.participatedPerformance >= 0 ? 'pos' : 'neg' }
          ]
        }, ...(callBlock ? [callBlock] : [])],
        right: Number.isFinite(total) ? [{
          title: status.key === 'live' ? t('indicativeRedemption') : t('finalRedemption'),
          rows: [
            ...(Number.isFinite(red.rawRedemption) ? [{ label: t('rawRedemption'), value: f.pctOf(red.rawRedemption) }] : []),
            ...(protection !== null ? [{ label: t('protectionLevel'), value: f.pctOf(protection, 0) }] : []),
            { label: t('redemptionValue'), value: f.pctOf(total), strong: true },
            { label: t('pnl'), value: f.signedPctOf(total - 100), tone: total >= 100 ? 'pos' : 'neg' }
          ],
          text: red.protectionApplied && protection !== null && Number.isFinite(red.rawRedemption)
            ? t('partProtected', { raw: f.pctOf(red.rawRedemption), protection: f.pctOf(protection, 0), value: f.pctOf(total) })
            : t('partNormal', { value: f.pctOf(total) })
        }] : []
      },
      schedule: callable.length ? {
        title: t('titleCallSchedule'),
        columns: [
          { key: 'observation', label: t('colObservation') },
          { key: 'payment', label: t('colPayment') },
          { key: 'level', label: t('colAutocall'), align: 'right' },
          { key: 'rebate', label: t('colRebate'), align: 'right' }
        ],
        rows: callable.map(o => ({
          cells: {
            observation: f.dateShort(o.observationDate),
            payment: f.dateShort(o.valueDate),
            level: Number.isFinite(o.autocallLevel) ? f.pctOf(o.autocallLevel, 0) : '—',
            rebate: Number.isFinite(o.rebateAmount) && o.rebateAmount ? f.pctOf(o.rebateAmount) : '—'
          },
          upcoming: toIso(o.observationDate) > today
        }))
      } : null,
      parameters: [
        { label: t('participationRate'), value: rate },
        ...(Number.isFinite(s.strike) ? [{ label: t('strikeLevel'), value: f.pctOf(s.strike, 0) }] : []),
        { label: t('basketPerformance'), value: reference },
        ...(protection !== null ? [{ label: t('protectionLevel'), value: f.pctOf(protection, 0) }] : []),
        { label: t('issuerCall'), value: call.hasCallOption ? t('callable') : t('noCallOption') }
      ],
      howItWorks: [t('howParticipation', { rate, reference, protection: protection !== null ? t('howParticipationProtection', { protection: f.pctOf(protection, 0) }) : '' })]
    };
  }
};
