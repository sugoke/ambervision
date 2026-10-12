/**
 * Athena: no coupon during the life; each callable date redeems at its own amount
 * (base + n x coupon), the final payoff tiers decide at maturity. Returns on notional
 * and on the issue price. Reads athenaEvaluator's templateResults.
 */
import { underlyingsOf, basketModeLabel, couponPerPeriod, frequencyLabel, toIso, hasMissingPrices } from '../common.js';

const TYPE_KEYS = { 'Autocall': 'typeAutocall', 'No Autocall': 'typeNoCall', 'Final Redemption': 'typeFinal' };
const OUTCOME_KEYS = {
  autocalled: ['outAutocalled', 'pos'],
  matured: ['outRedeemed', 'pos'],
  not_called: ['outNotCalled', ''],
  not_callable: ['outNotCallable', ''],
  missing_data: ['outMissing', 'warn']
};

export default {
  templateKey: 'tplAthena',

  build({ results: r, product, status, f, t }) {
    const s = r.athenaStructure || {};
    const obs = r.observationAnalysis || {};
    const iv = r.indicativeMaturityValue || {};
    const observations = obs.observations || [];
    const pc = (v, d = 2) => (Number.isFinite(v) ? f.pctOf(v, d) : '—');
    const spc = (v) => (Number.isFinite(v) ? f.signedPctOf(v) : '—');
    const atRisk = Number.isFinite(s.capitalAtRiskLevel) ? s.capitalAtRiskLevel : null;
    const basketMode = product.basketMode || product.structureParams?.referencePerformance;
    const basketWord = /best/i.test(basketMode || '') ? t('basketBest') : /average|basket/i.test(basketMode || '') ? t('basketAvg') : t('basketWorst');

    const callLevels = observations.filter(o => o.isCallable && Number.isFinite(o.autocallLevel)).map(o => o.autocallLevel);
    const autocallText = !callLevels.length ? '—'
      : callLevels[0] === callLevels[callLevels.length - 1] ? f.pctOf(callLevels[0], 0)
        : t('stepDown', { from: f.pctOf(callLevels[0], 0), to: f.pctOf(callLevels[callLevels.length - 1], 0) });

    const headlineLabel = status.key === 'autocalled' ? t('autocallRedemption') : status.key === 'live' ? t('indicativeValue') : t('finalRedemption');
    const headline = Number.isFinite(iv.redemptionAmount) && (status.key !== 'live' || !hasMissingPrices(r)) ? {
      label: headlineLabel,
      value: f.pctOf(iv.redemptionAmount),
      caption: Number.isFinite(iv.returnOnIssuePrice) ? `${t('returnOnIssue')} ${f.signedPctOf(iv.returnOnIssuePrice)}` : null,
      tone: iv.returnOnIssuePrice >= 0 ? 'pos' : 'neg'
    } : null;

    // Next observation, as a sentence from the prediction's numbers
    const p = obs.nextObservationPrediction;
    let next = null;
    if (status.key === 'live' && p && p.date) {
      const vars = {
        level: Number.isFinite(p.currentBasketLevel) ? f.pctOf(100 + p.currentBasketLevel) : '—',
        autocall: Number.isFinite(p.autocallLevel) ? f.pctOf(p.autocallLevel, 0) : autocallText,
        redemption: pc(p.redemptionAmount),
        ret: spc(p.returnOnIssuePrice)
      };
      const sentence = p.outcomeType === 'autocall' ? 'athenaAutocall'
        : p.outcomeType === 'final_redemption' ? 'athenaFinal'
          : Number.isFinite(p.autocallLevel) ? 'athenaNoCall' : 'athenaNotCallable';
      next = {
        title: t('nextObservation'),
        value: f.dateLong(p.date),
        caption: Number.isFinite(p.daysUntil) ? t('nextIn', { days: p.daysUntil }) : null,
        text: t(sentence, vars),
        note: t('basedOnCurrent')
      };
    }

    const value = Number.isFinite(iv.redemptionAmount) ? {
      title: headlineLabel,
      rows: [
        ...(status.key === 'autocalled' ? [] : [
          { label: t('basketLevel'), value: Number.isFinite(iv.worstOfLevel) ? t('basketPerfOfInitial', { level: f.pctOf(iv.worstOfLevel) }) : '—' }
        ]),
        { label: t('colRedemption'), value: f.pctOf(iv.redemptionAmount), strong: true },
        { label: t('issuePrice'), value: pc(s.issuePrice) },
        { label: t('returnOnIssue'), value: spc(iv.returnOnIssuePrice), tone: iv.returnOnIssuePrice >= 0 ? 'pos' : 'neg' },
        { label: t('annualizedReturn'), value: spc(iv.annualizedReturn), tone: iv.annualizedReturn >= 0 ? 'pos' : 'neg' }
      ],
      text: status.key === 'autocalled' ? null : t('athenaValueText', {
        level: pc(iv.worstOfLevel),
        redemption: f.pctOf(iv.redemptionAmount),
        ret: spc(iv.returnOnIssuePrice),
        issue: pc(s.issuePrice),
        ann: spc(iv.annualizedReturn)
      })
    } : null;

    const tiers = {
      title: t('finalTiers'),
      rows: (s.tiers || []).map(tier => ({
        label: tier.rangeLabel,
        value: tier.formulaLabel,
        strong: !!tier.isActive,
        tone: tier.isActive ? 'pos' : ''
      }))
    };

    const today = toIso(new Date());
    const firstUpcoming = observations.findIndex(o => !o.hasOccurred);
    const scheduleRows = observations.map((o, i) => {
      const [key, tone] = OUTCOME_KEYS[o.outcome] || [i === firstUpcoming && status.key === 'live' ? 'outNext' : 'outUpcoming', ''];
      const pays = o.isCallable || o.isFinal;
      return {
        cells: {
          observation: f.dateShort(o.observationDate),
          payment: f.dateShort(o.paymentDate),
          type: t(TYPE_KEYS[o.observationType] || 'typeNoCall'),
          autocall: o.isCallable && Number.isFinite(o.autocallLevel) ? f.pctOf(o.autocallLevel, 0) : '—',
          redemption: pays && Number.isFinite(o.redemptionAmount) ? f.pctOf(o.redemptionAmount) : '—',
          ret: pays && Number.isFinite(o.returnOnIssuePrice) ? f.signedPctOf(o.returnOnIssuePrice) : '—',
          basket: o.hasOccurred && Number.isFinite(o.basketPerformance) ? f.signedPctOf(o.basketPerformance) : '—',
          outcome: t(key)
        },
        tone,
        highlight: i === firstUpcoming && status.key === 'live',
        upcoming: !o.hasOccurred,
        basketTone: o.hasOccurred && Number.isFinite(o.basketPerformance) ? (o.basketPerformance >= 0 ? 'pos' : 'neg') : '',
        past: toIso(o.observationDate) <= today
      };
    });

    return {
      headline,
      underlyings: underlyingsOf(r, f, t, { barrier: atRisk }),
      payoff: {
        title: t('titlePayoffAthena'),
        left: [tiers, ...(next ? [{ ...next, kind: 'callout' }] : [])],
        right: value ? [value] : []
      },
      schedule: scheduleRows.length ? {
        title: t('titleSchedule'),
        columns: [
          { key: 'observation', label: t('colObservation') },
          { key: 'payment', label: t('colPayment') },
          { key: 'type', label: t('colType') },
          { key: 'autocall', label: t('colAutocall'), align: 'right' },
          { key: 'redemption', label: t('colRedemption'), align: 'right' },
          { key: 'ret', label: t('colReturnIssue'), align: 'right' },
          { key: 'basket', label: t('colBasket'), align: 'right', toneFrom: 'basketTone' },
          { key: 'outcome', label: t('colOutcome'), toneFrom: 'tone' }
        ],
        rows: scheduleRows
      } : null,
      parameters: [
        { label: t('basket'), value: [basketModeLabel(basketMode, t), t('basketOf', { n: (r.underlyings || []).length })].filter(Boolean).join(' · ') },
        { label: t('issuePrice'), value: pc(s.issuePrice) },
        { label: t('autocallLevel'), value: autocallText },
        { label: t('couponAccrued'), value: Number.isFinite(s.couponRate) ? couponPerPeriod(s.couponRate, s.observationFrequency, f, t) : t('perDate') },
        { label: t('capitalAtRisk'), value: atRisk !== null ? f.pctOf(atRisk, 0) : '—' },
        { label: t('observationFrequency'), value: frequencyLabel(s.observationFrequency, t, { capitalize: true }) }
      ],
      howItWorks: [t('howAthena', { basket: basketWord, issue: pc(s.issuePrice) })]
    };
  }
};
