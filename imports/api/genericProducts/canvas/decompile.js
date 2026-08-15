/**
 * Definition → canvas model decompiler. Pure, isomorphic, TOTAL (never throws):
 * anything the palette cannot express round-trips through a `raw` chip.
 *
 * decompileDefinition(definition) -> { version, lines, meta }
 *
 * Used when opening a product that has no stored canvasModel (imported
 * examples, form-era saves). Canvas-authored products reload from canvasModel.
 */

import { newId, resetIds } from './canvasModel.js';
import { addByUnit } from './frequency.js';

function round2(x) { return Math.round(x * 100) / 100; }

function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}
function monthsBetween(a, b) {
  const [ya, ma] = a.split('-').map(Number);
  const [yb, mb] = b.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

/**
 * Infer a repeat step {unit, n} from the first two observation dates.
 * Prefers month/year cadence (calendar-aligned), else weekly, else daily.
 */
function inferStep(a, b) {
  const mB = monthsBetween(a, b);
  if (mB >= 1 && addByUnit(a, 'month', mB) === b) {
    if (mB % 12 === 0) return { unit: 'year', n: mB / 12 };
    return { unit: 'month', n: mB };
  }
  const gap = daysBetween(a, b);
  if (gap > 0 && gap % 7 === 0) return { unit: 'week', n: gap / 7 };
  if (gap > 0) return { unit: 'day', n: gap };
  return null;
}

// ---- reverse measure map: measureId -> ValueChip (+ raw stash) ----
function buildMeasureChips(definition) {
  const byId = {};
  (definition.measures || []).forEach(m => { byId[m.id] = m; });
  const cache = {};
  const rawMeasures = {};

  const stashRaw = (id) => {
    const m = byId[id];
    if (!m) return;
    rawMeasures[id] = m;
    if (m.type === 'combine') (m.inputs || []).forEach(inp => stashRaw(inp.measureId));
  };

  function chipFor(id) {
    if (id in cache) return cache[id];
    const m = byId[id];
    if (!m) { cache[id] = { kind: 'measureRef', measureId: id }; return cache[id]; }
    let chip;
    if (m.type === 'rankSelect' && (m.rank || 1) === 1 && m.mode === 'worst') {
      chip = { kind: 'worstOf', universe: m.universe, valueOf: m.valueOf || 'performance' };
    } else if (m.type === 'rankSelect' && (m.rank || 1) === 1 && m.mode === 'best') {
      chip = { kind: 'bestOf', universe: m.universe, valueOf: m.valueOf || 'performance' };
    } else if (m.type === 'aggregate' && m.fn === 'weightedMean') {
      chip = { kind: 'weightedBasket' };
    } else if (m.type === 'aggregate' && (m.fn === 'mean' || m.fn === 'meanOfLockedOrLive')) {
      if (m.underlyingIds && m.underlyingIds.length === 1) {
        chip = { kind: 'underlying', underlyingId: m.underlyingIds[0] };
      } else if (m.underlyingIds && m.underlyingIds.length > 1) {
        stashRaw(id); chip = { kind: 'measureRef', measureId: id };
      } else {
        chip = { kind: 'average', universe: m.universe, basis: m.fn === 'meanOfLockedOrLive' ? 'lockedOrLive' : 'live' };
      }
    } else if (m.type === 'combine' && m.fn === 'spread' && (m.inputs || []).length === 2) {
      chip = { kind: 'spread', left: chipFor(m.inputs[0].measureId), right: chipFor(m.inputs[1].measureId) };
    } else {
      stashRaw(id); chip = { kind: 'measureRef', measureId: id };
    }
    cache[id] = chip;
    return chip;
  }

  return { chipFor, rawMeasures };
}

export function decompileDefinition(definition) {
  resetIds();
  const { chipFor, rawMeasures } = buildMeasureChips(definition);

  const reverseRate = (ref) => {
    if (!ref) return { mode: 'fixed', value: 0 };
    switch (ref.source) {
      case 'fixed': return { mode: 'fixed', value: ref.value };
      case 'rowLevel': return { mode: 'levelRef', key: ref.key };
      case 'measure': {
        const out = { mode: 'measure', value: chipFor(ref.measureId) };
        if (ref.gearing !== undefined) out.gearing = ref.gearing;
        if (ref.spread !== undefined) out.spread = ref.spread;
        out.floor = ref.floor ?? null;
        out.cap = ref.cap ?? null;
        return out;
      }
      case 'accrualFraction':
        return { mode: 'accrualFraction', base: reverseRate(ref.rate), counterKey: ref.countAccumulatorId };
      default: return { mode: 'fixed', value: 0 };
    }
  };

  const reverseSelector = (sel) => {
    if (!sel || sel.source === 'triggering') return { kind: 'triggering' };
    if (sel.source === 'measureSelection') return { kind: 'valueChip', chip: chipFor(sel.measureId) };
    return { kind: 'triggering' };
  };

  const reverseCondition = (cond) => {
    if (!cond || cond.type === 'always') return { kind: 'always' };
    switch (cond.type) {
      case 'levelTest':
        return {
          kind: 'compare',
          left: chipFor(cond.measureId),
          op: cond.op,
          right: cond.level?.source === 'rowLevel' ? { kind: 'levelRef', key: cond.level.key } : { kind: 'number', value: cond.level?.value }
        };
      case 'and':
      case 'or':
        return { kind: 'group', op: cond.type, children: (cond.conditions || []).map(reverseCondition) };
      case 'not':
        return { kind: 'not', child: reverseCondition(cond.condition) };
      case 'stateTest':
        return { kind: 'stateIs', register: cond.register, expect: cond.expect };
      case 'countTest':
        return { kind: 'countIs', register: cond.perUnderlyingRegister, op: cond.op, count: cond.count };
      default:
        return { kind: 'raw', condition: cond };
    }
  };
  // Sentence/branch level: {type:'always'} means "no condition" (ALWAYS / OTHERWISE).
  const topCondition = (cond) => (!cond || cond.type === 'always') ? null : reverseCondition(cond);

  const reverseAction = (a) => {
    switch (a.type) {
      case 'payCoupon': {
        if (a.rate?.source === 'accrualFraction' && a.rate.observedDaysAccumulatorId !== `${a.rate.countAccumulatorId}Observed`) {
          return { kind: 'raw', action: a };
        }
        return { kind: 'payCoupon', rate: reverseRate(a.rate), memory: !!a.memory };
      }
      case 'accrueToAccumulator':
        if (a.accumulatorId === 'memoryCouponBalance') return { kind: 'addToMemory', rate: reverseRate(a.rate) };
        return { kind: 'raw', action: a };
      case 'call':
        return { kind: 'call', redemption: reverseRate(a.redemptionLevel), plusMemory: (a.plusAccumulators || []).includes('memoryCouponBalance') };
      case 'setState':
        if (a.register === 'knockedIn' && a.value === true) return { kind: 'knockIn' };
        return { kind: 'raw', action: a };
      case 'lockUnderlying':
        return { kind: 'lock', selector: reverseSelector(a.selector), lockValue: a.lockValue?.source === 'fixed' ? { mode: 'fixed', value: a.lockValue.value } : { mode: 'observed' } };
      case 'eliminateUnderlying':
        return { kind: 'eliminate', selector: reverseSelector(a.selector) };
      case 'flagUnderlying':
        return { kind: 'flag', selector: reverseSelector(a.selector) };
      default:
        return { kind: 'raw', action: a };
    }
  };

  // Event id -> Sentence
  const eventById = {};
  (definition.events || []).forEach(ev => { eventById[ev.id] = ev; });
  const sentenceFor = (eventId) => {
    const ev = eventById[eventId];
    if (!ev) return { id: newId('s'), label: '', condition: null, actions: [], elseActions: [] };
    return {
      id: newId('s'),
      label: ev.label || '',
      condition: topCondition(ev.condition),
      actions: (ev.actions || []).map(reverseAction),
      elseActions: (ev.elseActions || []).map(reverseAction)
    };
  };

  // ---- rows -> loop/single lines ----
  const rows = (definition.schedule?.rows || []).slice()
    .sort((a, b) => (a.observationDate < b.observationDate ? -1 : a.observationDate > b.observationDate ? 1 : 0));

  // group consecutive rows with identical events + level-key set
  const groups = [];
  for (const row of rows) {
    const evKey = JSON.stringify(row.events || []);
    const lvlKey = JSON.stringify(Object.keys(row.levels || {}).sort());
    const last = groups[groups.length - 1];
    if (last && last.evKey === evKey && last.lvlKey === lvlKey) last.rows.push(row);
    else groups.push({ evKey, lvlKey, rows: [row] });
  }

  const lines = [];

  const buildLoopColumns = (prefix) => {
    const keys = Object.keys(prefix[0].levels || {});
    return keys.map(key => {
      const vals = prefix.map(r => r.levels[key]);
      const initial = vals[0];
      let step = prefix.length >= 2 ? round2(vals[0] - vals[1]) : 0;
      let overrides = {};
      let misfits = 0;
      vals.forEach((v, i) => {
        if (Math.abs(v - round2(initial - step * i)) > 0.005) { overrides[i] = v; misfits++; }
      });
      if (misfits > prefix.length / 3) {
        step = 0;
        overrides = {};
        vals.forEach((v, i) => { if (Math.abs(v - initial) > 0.005) overrides[i] = v; });
      }
      return { key, initial, stepPerPeriod: step, overrides };
    });
  };

  for (const group of groups) {
    const sentences = JSON.parse(group.evKey).map(sentenceFor);
    let remaining = group.rows;
    while (remaining.length) {
      let emittedLoop = false;
      if (remaining.length >= 2) {
        const step = inferStep(remaining[0].observationDate, remaining[1].observationDate);
        if (step) {
          const lag0 = daysBetween(remaining[0].observationDate, remaining[0].paymentDate);
          let k = 1;
          while (k < remaining.length &&
                 addByUnit(remaining[0].observationDate, step.unit, k * step.n) === remaining[k].observationDate &&
                 daysBetween(remaining[k].observationDate, remaining[k].paymentDate) === lag0) {
            k++;
          }
          if (k >= 2) {
            const prefix = remaining.slice(0, k);
            // sentences are shared across the group; clone ids per loop to stay unique
            const loopSentences = sentences.map(s => ({ ...s, id: newId('s') }));
            lines.push({
              id: newId('ln'),
              lineType: 'loop',
              firstObservation: prefix[0].observationDate,
              frequencyUnit: step.unit,
              frequencyN: step.n,
              until: prefix[k - 1].observationDate,
              paymentLagDays: lag0,
              columns: buildLoopColumns(prefix),
              rules: loopSentences
            });
            remaining = remaining.slice(k);
            emittedLoop = true;
          }
        }
      }
      if (!emittedLoop) {
        const row = remaining[0];
        lines.push({
          id: newId('ln'),
          lineType: 'single',
          observationDate: row.observationDate,
          paymentDate: row.paymentDate,
          levels: { ...(row.levels || {}) },
          rules: sentences.map(s => ({ ...s, id: newId('s') }))
        });
        remaining = remaining.slice(1);
      }
    }
  }

  // ---- monitors -> anyDay / count lines ----
  const counterIds = new Set();
  for (const mon of definition.schedule?.monitors || []) {
    if ((mon.mode || 'trigger') === 'count') {
      counterIds.add(mon.countAccumulatorId);
      counterIds.add(mon.observedDaysAccumulatorId);
      lines.push({
        id: newId('ln'),
        lineType: 'count',
        window: { ...mon.window },
        subject: chipFor(mon.measureId),
        range: { low: mon.level, high: mon.levelHigh },
        counterKey: mon.countAccumulatorId
      });
    } else {
      const subject = mon.scope === 'anyUnderlying' ? { kind: 'anyUnderlying' }
        : mon.scope === 'eachUnderlying' ? { kind: 'eachUnderlying' }
        : chipFor(mon.measureId);
      lines.push({
        id: newId('ln'),
        lineType: 'anyDay',
        window: { ...mon.window },
        subject,
        comparison: mon.direction === 'above' ? 'touchesAbove' : 'touchesBelow',
        level: mon.level,
        once: mon.once !== false,
        actions: (mon.onTrigger || []).map(reverseAction)
      });
    }
  }

  // ---- terminal payoff -> final line ----
  const tp = definition.terminalPayoff || { inputMeasureId: '', branches: [] };
  lines.push({
    id: newId('ln'),
    lineType: 'final',
    inputValue: tp.inputMeasureId ? chipFor(tp.inputMeasureId) : null,
    plusMemory: (tp.plusAccumulators || []).includes('memoryCouponBalance'),
    branches: (tp.branches || []).map(b => ({
      id: newId('br'),
      condition: b.condition?.type === 'always' ? null : topCondition(b.condition),
      payoff: {
        base: b.payoff?.base ?? 0,
        legs: (b.payoff?.legs || []).map(l => ({
          strike: l.strike ?? 0, gearing: l.gearing ?? 1, floor: l.floor ?? null, cap: l.cap ?? null, absolute: !!l.absolute
        }))
      }
    }))
  });

  // ---- meta: extra accumulators (not re-derivable), raw measures ----
  const extraAccumulators = (definition.stateRegisters?.accumulators || []).filter(acc =>
    acc.id !== 'memoryCouponBalance' && !counterIds.has(acc.id)
  );

  return {
    version: 1,
    lines,
    meta: { extraAccumulators, rawMeasures }
  };
}
