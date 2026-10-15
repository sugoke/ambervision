/**
 * Term sheet audit: compare a product's stored parameters with the facts read
 * from its term sheet PDF, and check the product's own dates for coherence.
 *
 * Pure functions (no database, no network) so they can be tested on their own.
 * Every finding is { field, severity: 'error' | 'warn', product, termSheet, note }:
 *   error - a parameter that drives the evaluation disagrees with the document
 *   warn  - a difference worth a look (labelling, rounding, optional feature)
 * A value the term sheet does not state is never a finding.
 */

const DAY = 86400000;

export const isoDay = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DAY);
const num = (v) => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) ? n : null; };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const symbolOf = (u) => String(u.ticker || u.symbol || u.securityData?.symbol || '').split('.')[0].toUpperCase();
const finding = (field, severity, product, termSheet, note = null) => ({ field, severity, product, termSheet, note });

/** Words that carry no identity in a company name. */
const NAME_NOISE = new Set(['inc', 'corp', 'corporation', 'co', 'ltd', 'plc', 'sa', 'se', 'ag', 'nv', 'spa', 'the', 'group', 'holding', 'holdings', 'ord', 'class', 'a', 'b', 'adr', 'de', 'ab', 'asa']);
const nameTokens = (s) => norm(s).split(' ').filter(t => t && !NAME_NOISE.has(t));

function sameCompany(u, t) {
  const uIsin = String(u.isin || u.securityData?.isin || '').toUpperCase();
  if (uIsin && t.isin && uIsin === String(t.isin).toUpperCase()) return true;
  const sym = symbolOf(u);
  if (sym && t.ticker && sym === String(t.ticker).split(/[ .]/)[0].toUpperCase()) return true;
  const a = nameTokens(u.name || u.securityData?.name);
  const b = nameTokens(t.name);
  if (a.length === 0 || b.length === 0) return false;
  return a[0] === b[0] || b.includes(a[0]) || a.includes(b[0]);
}

/** Dates and ordering of the product itself. */
export function checkInternalDates(product) {
  const out = [];
  const trade = isoDay(product.tradeDate);
  const value = isoDay(product.valueDate);
  const final = isoDay(product.finalObservation || product.finalObservationDate);
  const maturity = isoDay(product.maturity || product.maturityDate);

  const ordered = [['tradeDate', trade], ['valueDate', value], ['finalObservation', final], ['maturity', maturity]].filter(([, d]) => d);
  for (let i = 1; i < ordered.length; i++) {
    if (ordered[i][1] < ordered[i - 1][1]) {
      out.push(finding(`dates.order`, 'error', `${ordered[i][0]} ${ordered[i][1]} before ${ordered[i - 1][0]} ${ordered[i - 1][1]}`, null, 'Dates out of order'));
    }
  }
  if (!trade) out.push(finding('tradeDate', 'error', null, null, 'Missing'));
  if (!final) out.push(finding('finalObservation', 'error', null, null, 'Missing'));
  if (!maturity) out.push(finding('maturity', 'error', null, null, 'Missing'));
  if (product.maturity && product.maturityDate && isoDay(product.maturity) !== isoDay(product.maturityDate)) {
    out.push(finding('maturity.fields', 'warn', `${isoDay(product.maturity)} vs ${isoDay(product.maturityDate)}`, null, 'maturity and maturityDate differ'));
  }
  if (product.finalObservation && product.finalObservationDate && isoDay(product.finalObservation) !== isoDay(product.finalObservationDate)) {
    out.push(finding('finalObservation.fields', 'warn', `${isoDay(product.finalObservation)} vs ${isoDay(product.finalObservationDate)}`, null, 'finalObservation and finalObservationDate differ'));
  }

  const obs = (product.observationSchedule || []).map(o => isoDay(o.observationDate)).filter(Boolean);
  const sorted = [...obs].sort();
  if (obs.some((d, i) => d !== sorted[i])) out.push(finding('observationSchedule.order', 'warn', 'not chronological', null));
  if (new Set(obs).size !== obs.length) out.push(finding('observationSchedule.duplicates', 'error', 'duplicate observation dates', null));
  if (trade && obs.some(d => d <= trade)) out.push(finding('observationSchedule.range', 'error', 'observation on or before the trade date', null));
  if (final && obs.some(d => d > final)) out.push(finding('observationSchedule.range', 'error', `observation after the final observation ${final}`, null));
  for (const o of product.observationSchedule || []) {
    const od = isoDay(o.observationDate), vd = isoDay(o.valueDate);
    if (od && vd && vd < od) out.push(finding('observationSchedule.valueDate', 'error', `payment ${vd} before observation ${od}`, null));
  }
  return out;
}

/**
 * @param {Object} product - products document
 * @param {Object} facts - what the term sheet states (see PROMPT in run.js)
 * @param {Object} helpers - { protectionBarrierOf }
 */
export function compareWithTermSheet(product, facts, { protectionBarrierOf } = {}) {
  const out = [];
  const sp = product.structureParams || {};
  const sc = product.scheduleConfig || {};

  // Identity
  if (facts.isin && product.isin && String(facts.isin).toUpperCase().replace(/\s/g, '') !== String(product.isin).toUpperCase()) {
    out.push(finding('isin', 'error', product.isin, facts.isin));
  }
  if (facts.currency && product.currency && String(facts.currency).toUpperCase() !== String(product.currency).toUpperCase()) {
    out.push(finding('currency', 'error', product.currency, facts.currency));
  }
  if (facts.issuer && product.issuer) {
    const a = nameTokens(product.issuer), b = nameTokens(facts.issuer);
    if (a.length && b.length && !a.some(t => b.includes(t)) && !norm(facts.issuer).includes(norm(product.issuer)) && !norm(product.issuer).includes(norm(facts.issuer))) {
      out.push(finding('issuer', 'warn', product.issuer, facts.issuer, 'Issuer name differs (may be the guarantor or a parent entity)'));
    }
  }
  const denom = num(product.denomination);
  if (num(facts.denomination) != null && denom != null && num(facts.denomination) !== denom) {
    out.push(finding('denomination', 'warn', denom, facts.denomination));
  }

  // Dates
  const dates = [
    ['tradeDate', isoDay(product.tradeDate), isoDay(facts.tradeDate)],
    ['valueDate', isoDay(product.valueDate), isoDay(facts.valueDate)],
    ['finalObservation', isoDay(product.finalObservation || product.finalObservationDate), isoDay(facts.finalObservationDate)],
    ['maturity', isoDay(product.maturity || product.maturityDate), isoDay(facts.maturityDate)]
  ];
  for (const [field, mine, theirs] of dates) {
    if (theirs && mine !== theirs) out.push(finding(field, 'error', mine, theirs, mine ? `${dayDiff(mine, theirs)} days` : 'Missing in product'));
  }

  // Underlyings
  const tsUnd = Array.isArray(facts.underlyings) ? facts.underlyings : [];
  const pUnd = product.underlyings || [];
  if (tsUnd.length > 0) {
    const matchedTs = new Set();
    for (const u of pUnd) {
      const idx = tsUnd.findIndex((t, i) => !matchedTs.has(i) && sameCompany(u, t));
      if (idx < 0) {
        out.push(finding('underlying', 'error', `${symbolOf(u)} ${u.name || ''}`.trim(), null, 'In the product, not in the term sheet'));
        continue;
      }
      matchedTs.add(idx);
      const t = tsUnd[idx];
      const mine = num(u.strike ?? u.strikePrice);
      const theirs = num(t.initialReferencePrice);
      if (mine != null && theirs != null && theirs > 0) {
        const rel = Math.abs(mine - theirs) / theirs;
        if (rel > 0.005) {
          const ratio = mine / theirs;
          const scale = Math.abs(ratio - 100) < 1 || Math.abs(ratio - 0.01) < 0.0001 ? ' (looks like a pence/pound scale error)' : '';
          out.push(finding(`strike ${symbolOf(u)}`, 'error', mine, theirs, `${(rel * 100).toFixed(2)}% apart${scale}`));
        }
      }
    }
    tsUnd.forEach((t, i) => { if (!matchedTs.has(i)) out.push(finding('underlying', 'error', null, `${t.ticker || ''} ${t.name || ''}`.trim(), 'In the term sheet, not in the product')); });
  }

  // Levels, in % of the initial level
  const productBarrier = protectionBarrierOf ? protectionBarrierOf(product) : null;
  const tsBarrier = num(facts.protectionBarrierPct);
  if (tsBarrier != null && productBarrier != null && Math.abs(tsBarrier - productBarrier) > 0.01) {
    out.push(finding('protectionBarrier', 'error', productBarrier, tsBarrier));
  }
  const couponBarrier = num(sc.initialCouponBarrier ?? sp.couponBarrier);
  if (num(facts.couponBarrierPct) != null && couponBarrier != null && Math.abs(num(facts.couponBarrierPct) - couponBarrier) > 0.01) {
    out.push(finding('couponBarrier', 'error', couponBarrier, facts.couponBarrierPct));
  }
  const autocall = num(sc.initialAutocallLevel);
  if (num(facts.firstAutocallLevelPct) != null && autocall != null && Math.abs(num(facts.firstAutocallLevelPct) - autocall) > 0.01) {
    out.push(finding('autocallLevel', 'error', autocall, facts.firstAutocallLevelPct));
  }
  if (num(facts.autocallStepDownPct) != null && num(sc.stepDownValue) != null && Math.abs(Math.abs(num(facts.autocallStepDownPct)) - Math.abs(num(sc.stepDownValue))) > 0.01) {
    out.push(finding('autocallStepDown', 'warn', sc.stepDownValue, facts.autocallStepDownPct));
  }
  const coupon = num(sp.couponRate);
  if (coupon != null && (num(facts.couponPerPeriodPct) != null || num(facts.couponPerAnnumPct) != null)) {
    const ok = [facts.couponPerPeriodPct, facts.couponPerAnnumPct].some(c => num(c) != null && Math.abs(num(c) - coupon) <= 0.01);
    if (!ok) out.push(finding('couponRate', 'error', coupon, `${facts.couponPerPeriodPct ?? '?'} per period / ${facts.couponPerAnnumPct ?? '?'} p.a.`));
  }
  if (typeof facts.memoryCoupon === 'boolean' && typeof sp.memoryCoupon === 'boolean' && facts.memoryCoupon !== sp.memoryCoupon) {
    out.push(finding('memoryCoupon', 'error', sp.memoryCoupon, facts.memoryCoupon));
  }

  // Observation dates
  const tsObs = (Array.isArray(facts.observationDates) ? facts.observationDates : []).filter(o => isoDay(o.valuationDate));
  const pObs = product.observationSchedule || [];
  if (tsObs.length > 0 && pObs.length > 0) {
    const finalDay = isoDay(product.finalObservation || product.finalObservationDate);
    const mineSet = new Map(pObs.map(o => [isoDay(o.observationDate), o]));
    const theirSet = new Map(tsObs.map(o => [isoDay(o.valuationDate), o]));
    const missing = [...theirSet.keys()].filter(d => !mineSet.has(d) && d !== finalDay).sort();
    const extra = [...mineSet.keys()].filter(d => !theirSet.has(d) && d !== finalDay).sort();
    if (missing.length || extra.length) {
      out.push(finding('observationDates', 'error', `${mineSet.size} dates`, `${theirSet.size} dates`,
        [missing.length ? `missing in product: ${missing.join(', ')}` : null, extra.length ? `not in term sheet: ${extra.join(', ')}` : null].filter(Boolean).join(' | ')));
    }
    const payDiffs = [];
    for (const [d, o] of mineSet) {
      const t = theirSet.get(d);
      const mp = isoDay(o.valueDate), tp = isoDay(t?.paymentDate);
      if (t && mp && tp && mp !== tp) payDiffs.push(`${d}: ${mp} vs ${tp}`);
    }
    if (payDiffs.length) out.push(finding('paymentDates', 'error', null, null, payDiffs.join(' | ')));
  }
  return out;
}

export const hasErrors = (findings) => findings.some(f => f.severity === 'error');
