/**
 * Parts of the product report that every payoff shares: status, timeline,
 * market price, underlyings table and bars, performance chart. Values come from
 * the evaluator's raw numbers and are formatted here for the report language.
 */
import { buildMultiLineChart, buildHBarChart } from '../reportKit/charts.js';

const toIso = (d) => {
  if (!d) return null;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? null : x.toISOString().slice(0, 10);
};
export { toIso };

const STATUS_KEYS = { live: 'statusLive', autocalled: 'statusAutocalled', matured: 'statusMatured', redeemed: 'statusRedeemed', called: 'statusCalled' };

/** Product status from the evaluation, translated, with a tone for the badge. */
export const statusOf = (templateResults, product, t) => {
  const s = templateResults?.currentStatus?.productStatus || product?.productStatus || 'live';
  const key = templateResults?.currentStatus?.isCalled ? 'called' : s;
  return { key, text: t(STATUS_KEYS[key] || 'statusLive'), tone: key === 'live' ? 'live' : 'closed' };
};

/** Trade, value, final observation and maturity dates (report timeline first, product fields otherwise). */
export const timelineOf = (product, templateResults, f, t, now) => {
  const tl = templateResults?.timeline || {};
  const today = toIso(now);
  const rows = [
    ['tradeDate', tl.tradeDate || product.tradeDate],
    ['valueDate', tl.valueDate || tl.issueDate || product.valueDate || product.issueDate],
    ['finalObservation', tl.finalObservation || product.finalObservation || product.finalObservationDate],
    ['maturity', tl.maturityDate || product.maturity || product.maturityDate]
  ].map(([key, value]) => ({ key, iso: toIso(value) })).filter(r => r.iso);
  return rows.map(r => ({ label: t(r.key), value: f.dateShort(r.iso), past: r.iso <= today }));
};

/** Last price on file (productPrices stores % of par, e.g. 60.44). */
export const priceOf = (price, status, f, t) => {
  if (!price || !Number.isFinite(price.price)) return null;
  const isPct = price.metadata?.priceType !== 'absolute';
  return {
    label: status.key === 'live' ? t('marketPrice') : t('finalPrice'),
    value: isPct ? `${f.pctOf(price.price)} ${t('ofPar')}` : f.num(price.price),
    caption: price.priceDate ? t('priceAsOf', { date: f.dateShort(price.priceDate) }) : null
  };
};

const BARRIER_KEYS = { safe: 'barSafe', near: 'barNear', breached: 'barBreached' };
const BARRIER_TONES = { safe: 'pos', near: 'warn', breached: 'neg' };

/**
 * Underlyings table and performance bars. `barrier` is the product's barrier as
 * a level (50 for 50%); the bars show it as a performance (−50%).
 */
export const underlyingsOf = (templateResults, f, t, { barrier = null, withDistance = true } = {}) => {
  const list = templateResults?.underlyings || [];
  if (!list.length) return null;
  const price = (v, ccy) => (Number.isFinite(v) ? `${f.num(v)} ${ccy || ''}`.trim() : '—');
  const rows = list.map(u => ({
    ticker: u.ticker || '',
    name: u.name || u.ticker || '—',
    initial: price(u.initialPrice ?? u.effectiveInitialPrice, u.currency),
    current: u.hasCurrentData === false ? '—' : price(u.currentPrice, u.currency),
    performance: Number.isFinite(u.performance) ? f.signedPctOf(u.performance) : '—',
    performanceTone: !Number.isFinite(u.performance) ? '' : u.performance >= 0 ? 'pos' : 'neg',
    distance: withDistance && Number.isFinite(u.distanceToBarrier) ? f.signedPctOf(u.distanceToBarrier, 1) : null,
    status: u.barrierStatus ? t(BARRIER_KEYS[u.barrierStatus] || 'barSafe') : null,
    statusTone: BARRIER_TONES[u.barrierStatus] || '',
    worst: !!u.isWorstPerforming
  }));
  const priceDates = [...new Set(list.map(u => toIso(u.priceDate)).filter(Boolean))].sort();
  const reference = Number.isFinite(barrier) ? barrier - 100 : null;
  const bars = buildHBarChart(list.map(u => ({
    label: u.ticker || u.name,
    value: u.performance,
    valueText: Number.isFinite(u.performance) ? f.signedPctOf(u.performance) : '—',
    tone: u.barrierStatus === 'breached' ? 'neg' : u.barrierStatus === 'near' ? 'warn' : (u.performance >= 0 ? 'pos' : 'neg')
  })), { reference, width: 400, labelWidth: 64, valueWidth: 70, rowHeight: list.length > 6 ? 22 : 28, tickFormat: (v) => f.signedPctOf(v, 0) });
  return {
    hasDistance: rows.some(r => r.distance),
    hasStatus: rows.some(r => r.status),
    rows,
    bars,
    barsCaption: Number.isFinite(barrier) ? t('performanceVsBarrier', { barrier: f.pctOf(barrier, 0) }) : null,
    priceCaption: priceDates.length ? t('priceDate', { date: f.dateShort(priceDates[priceDates.length - 1]) }) : null
  };
};

// Series colours of the report palette; product levels keep their meaning
const SERIES_COLORS = ['#1A2B40', '#DD772A', '#5E7FA3', '#A9561A', '#7D93AD', '#C9A27E', '#3E5A7A', '#B9B2A6'];
const LEVELS = [
  { re: /protection|capital|knock|barri[eè]re basse|lower/i, key: 'protectionBarrier', color: '#C76A5A' },
  { re: /autocall|call level|rappel/i, key: 'autocallLevel', color: '#2E7559' },
  { re: /coupon/i, key: 'couponBarrier', color: '#DD772A' }
];

/**
 * Performance chart from the stored chart data (chartData collection): only
 * the series and dates are used; colours, labels and axes are the report's.
 */
export const chartOf = (chartDoc, f, t) => {
  const datasets = chartDoc?.data?.datasets || [];
  const labels = chartDoc?.data?.labels || [];
  if (!datasets.length || labels.length < 2) return null;
  let colorIndex = 0;
  const legend = [];
  const series = datasets.map(ds => {
    const points = (ds.data || []).map((p, i) => (p && typeof p === 'object'
      ? { date: toIso(p.x), value: Number(p.y) }
      : { date: toIso(labels[i]), value: Number(p) }));
    const dashed = Array.isArray(ds.borderDash) && ds.borderDash.length > 0;
    let label = String(ds.label || '');
    let color;
    if (dashed) {
      const level = LEVELS.find(l => l.re.test(label));
      color = level ? level.color : '#9A9389';
      // "Protection Barrier (50%)" → translated name; a level in brackets is
      // kept, wording such as "(Step-down)" is dropped
      if (level) { const m = label.match(/\(([^)]*%[^)]*)\)/); label = `${t(level.key)}${m ? ` (${m[1]})` : ''}`; }
    } else {
      color = SERIES_COLORS[colorIndex % SERIES_COLORS.length];
      colorIndex += 1;
    }
    legend.push({ label, color, dashed });
    return { label, color, dashed, points };
  });
  const annotations = chartDoc?.options?.plugins?.annotation?.annotations || {};
  let obs = 0;
  const markers = Object.values(annotations)
    .filter(a => a && a.type === 'line' && a.xMin && a.xMin === a.xMax)
    .map(a => ({ date: toIso(a.xMin), label: /^obs/i.test(a.label?.content || '') ? t('obsShort', { n: ++obs }) : '' }));
  const chart = buildMultiLineChart({
    range: [toIso(labels[0]), toIso(labels[labels.length - 1])],
    series,
    markers,
    tickFormat: (v) => f.num(v, 0),
    monthLabel: (m) => f.monthAbbr(m)
  }, { width: 1011, height: 440 });
  return chart ? { chart, legend } : null;
};

export const basketModeLabel = (mode, t) => {
  const m = String(mode || '').toLowerCase();
  if (m.includes('worst')) return t('worstOf');
  if (m.includes('best')) return t('bestOf');
  if (m.includes('average') || m.includes('basket')) return t('average');
  return null;
};

const FREQ = { monthly: ['freqMonthly', 'periodMonth', 12], quarterly: ['freqQuarterly', 'periodQuarter', 4], 'semi-annual': ['freqSemiannual', 'periodSemester', 2], semiannual: ['freqSemiannual', 'periodSemester', 2], annual: ['freqAnnual', 'periodYear', 1], yearly: ['freqAnnual', 'periodYear', 1] };

/** "4.00% per quarter (16.00% p.a.)" from a per-period rate and a frequency. */
export const couponPerPeriod = (rate, frequency, f, t) => {
  if (!Number.isFinite(rate)) return '—';
  const fq = FREQ[String(frequency || '').toLowerCase()];
  if (!fq) return f.pctOf(rate);
  const perPeriod = t('perPeriod', { rate: f.pctOf(rate), period: t(fq[1]) });
  return fq[2] > 1 ? `${perPeriod} (${f.pctOf(rate * fq[2])} p.a.)` : perPeriod;
};

export const frequencyLabel = (frequency, t, { capitalize = false } = {}) => {
  const fq = FREQ[String(frequency || '').toLowerCase()];
  const text = fq ? t(fq[0]) : (frequency || '—');
  return capitalize ? text.charAt(0).toUpperCase() + text.slice(1) : text;
};
