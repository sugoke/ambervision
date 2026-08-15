/**
 * Canvas → definition compiler. Pure, deterministic, isomorphic (no Meteor).
 * Fully generic: labels map to primitives, never to product families.
 *
 * compileCanvas({ identity, underlyings, canvasModel }) -> definition
 */

import { addByUnit, loopStep, loopCount } from './frequency.js';

function round2(x) {
  return Math.round(x * 100) / 100;
}

// Exact arithmetic mirrored from examples/index.js + ScheduleSection so loop
// explosion reproduces authored schedules to the day.
function addMonthsIso(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
}
function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function sanitize(s) {
  return String(s).replace(/[^A-Za-z0-9]+/g, '_');
}

/** Content signature of a measure spec (excluding its id). */
function measureKey(spec) {
  if (spec.type === 'rankSelect') {
    return `rankSelect:${spec.mode}:${spec.rank || 1}:${spec.universe}:${spec.valueOf || 'performance'}:${(spec.underlyingIds || []).slice().sort().join(',')}`;
  }
  if (spec.type === 'aggregate') {
    return `aggregate:${spec.fn}:${spec.universe}:${(spec.underlyingIds || []).slice().sort().join(',')}`;
  }
  if (spec.type === 'combine') {
    return `combine:${spec.fn}:${spec.inputs.map(i => `${i.measureId}@${i.weight ?? 1}`).join(',')}`;
  }
  return JSON.stringify(spec);
}

function slugFor(spec) {
  if (spec.type === 'rankSelect') return sanitize(`m_${spec.mode}_${spec.universe}_${spec.valueOf || 'perf'}${spec.underlyingIds ? '_' + spec.underlyingIds.join('-') : ''}`);
  if (spec.type === 'aggregate') return sanitize(`m_${spec.fn}_${spec.universe}${spec.underlyingIds ? '_' + spec.underlyingIds.join('-') : ''}`);
  if (spec.type === 'combine') return sanitize(`m_${spec.fn}_${spec.inputs.map(i => i.measureId).join('-')}`);
  return sanitize('m_raw');
}

class Compiler {
  constructor(identity, underlyings, meta) {
    this.identity = identity;
    this.underlyings = underlyings || [];
    this.meta = meta || { extraAccumulators: [], rawMeasures: {} };
    this.measuresByKey = new Map();  // key -> id
    this.measures = [];              // emitted, in first-use order
    this.usedSlugs = new Set();
    // register/accumulator flags
    this.needKnockedIn = false;
    this.needLocked = false;
    this.needEliminated = false;
    this.needFlagged = false;
    this.needMemory = false;
    this.counterKeys = new Set();
  }

  emitMeasure(spec) {
    const key = measureKey(spec);
    if (this.measuresByKey.has(key)) return this.measuresByKey.get(key);
    let id = slugFor(spec);
    let n = 1;
    while (this.usedSlugs.has(id)) { id = `${slugFor(spec)}_${n++}`; }
    this.usedSlugs.add(id);
    this.measuresByKey.set(key, id);
    this.measures.push({ id, ...spec });
    return id;
  }

  // Re-emit a raw measure (and its combine dependencies) verbatim by id.
  emitRawMeasure(measureId) {
    if (this.measures.some(m => m.id === measureId)) return measureId;
    const raw = this.meta.rawMeasures?.[measureId];
    if (!raw) return measureId; // dangling; validation will catch it
    if (raw.type === 'combine') {
      (raw.inputs || []).forEach(inp => this.emitRawMeasure(inp.measureId));
    }
    this.usedSlugs.add(measureId);
    this.measures.push({ ...raw });
    return measureId;
  }

  measureForValue(chip) {
    if (!chip) return '';
    switch (chip.kind) {
      case 'worstOf':
        return this.emitMeasure({ type: 'rankSelect', mode: 'worst', rank: 1, universe: chip.universe || 'all', valueOf: chip.valueOf || 'performance' });
      case 'bestOf':
        return this.emitMeasure({ type: 'rankSelect', mode: 'best', rank: 1, universe: chip.universe || 'all', valueOf: chip.valueOf || 'performance' });
      case 'average':
        return this.emitMeasure({ type: 'aggregate', fn: chip.basis === 'lockedOrLive' ? 'meanOfLockedOrLive' : 'mean', universe: chip.universe || 'all' });
      case 'weightedBasket':
        return this.emitMeasure({ type: 'aggregate', fn: 'weightedMean', universe: 'all' });
      case 'underlying': {
        if (this.underlyings.length === 1) {
          return this.emitMeasure({ type: 'aggregate', fn: 'mean', universe: 'all' });
        }
        return this.emitMeasure({ type: 'aggregate', fn: 'mean', universe: 'all', underlyingIds: [chip.underlyingId] });
      }
      case 'spread': {
        const l = this.measureForValue(chip.left);
        const r = this.measureForValue(chip.right);
        return this.emitMeasure({ type: 'combine', fn: 'spread', inputs: [{ measureId: l, weight: 1 }, { measureId: r, weight: 1 }] });
      }
      case 'measureRef':
        return this.emitRawMeasure(chip.measureId);
      default:
        return '';
    }
  }

  compileRate(rate) {
    if (!rate) return { source: 'fixed', value: 0 };
    switch (rate.mode) {
      case 'fixed': return { source: 'fixed', value: rate.value };
      case 'levelRef': return { source: 'rowLevel', key: rate.key };
      case 'measure': {
        const out = { source: 'measure', measureId: this.measureForValue(rate.value) };
        if (rate.gearing !== undefined) out.gearing = rate.gearing;
        if (rate.spread !== undefined) out.spread = rate.spread;
        if (rate.floor !== undefined && rate.floor !== null) out.floor = rate.floor;
        if (rate.cap !== undefined && rate.cap !== null) out.cap = rate.cap;
        return out;
      }
      case 'accrualFraction':
        return {
          source: 'accrualFraction',
          rate: this.compileRate(rate.base),
          countAccumulatorId: rate.counterKey,
          observedDaysAccumulatorId: `${rate.counterKey}Observed`,
          resetEachPeriod: true
        };
      default: return { source: 'fixed', value: 0 };
    }
  }

  compileSelector(selector) {
    if (!selector || selector.kind === 'triggering') return { source: 'triggering' };
    if (selector.kind === 'valueChip') return { source: 'measureSelection', measureId: this.measureForValue(selector.chip) };
    return { source: 'triggering' };
  }

  compileCondition(node) {
    if (!node || node.kind === 'always') return { type: 'always' };
    switch (node.kind) {
      case 'compare': {
        const level = node.right?.kind === 'levelRef'
          ? { source: 'rowLevel', key: node.right.key }
          : { source: 'fixed', value: node.right?.value };
        return { type: 'levelTest', measureId: this.measureForValue(node.left), op: node.op, level };
      }
      case 'group':
        return { type: node.op, conditions: (node.children || []).map(c => this.compileCondition(c)) };
      case 'not':
        return { type: 'not', condition: this.compileCondition(node.child) };
      case 'stateIs':
        return { type: 'stateTest', register: node.register, expect: node.expect };
      case 'countIs':
        return { type: 'countTest', perUnderlyingRegister: node.register, op: node.op, count: node.count };
      case 'raw':
        return node.condition;
      default:
        return { type: 'always' };
    }
  }

  compileAction(chip) {
    switch (chip.kind) {
      case 'payCoupon': {
        const out = { type: 'payCoupon', rate: this.compileRate(chip.rate), memory: !!chip.memory, guaranteed: false };
        if (chip.memory) { out.accumulatorId = 'memoryCouponBalance'; this.needMemory = true; }
        return out;
      }
      case 'addToMemory':
        this.needMemory = true;
        return { type: 'accrueToAccumulator', accumulatorId: 'memoryCouponBalance', rate: this.compileRate(chip.rate) };
      case 'call':
        if (chip.plusMemory) this.needMemory = true;
        return { type: 'call', redemptionLevel: this.compileRate(chip.redemption), plusAccumulators: chip.plusMemory ? ['memoryCouponBalance'] : [] };
      case 'knockIn':
        this.needKnockedIn = true;
        return { type: 'setState', register: 'knockedIn', value: true };
      case 'lock':
        this.needLocked = true;
        return { type: 'lockUnderlying', selector: this.compileSelector(chip.selector), lockValue: chip.lockValue?.mode === 'fixed' ? { source: 'fixed', value: chip.lockValue.value } : { source: 'observed' } };
      case 'eliminate':
        this.needEliminated = true;
        return { type: 'eliminateUnderlying', selector: this.compileSelector(chip.selector) };
      case 'flag':
        this.needFlagged = true;
        return { type: 'flagUnderlying', selector: this.compileSelector(chip.selector) };
      case 'raw':
        return chip.action;
      default:
        return null;
    }
  }

  // Scan a condition tree for register needs (state/count conditions).
  scanCondition(node) {
    if (!node) return;
    if (node.kind === 'stateIs' && node.register === 'knockedIn') this.needKnockedIn = true;
    if (node.kind === 'countIs') {
      if (node.register === 'locked') this.needLocked = true;
      if (node.register === 'eliminated') this.needEliminated = true;
      if (node.register === 'flagged') this.needFlagged = true;
    }
    if (node.kind === 'group') (node.children || []).forEach(c => this.scanCondition(c));
    if (node.kind === 'not') this.scanCondition(node.child);
  }
}

export function compileCanvas({ identity, underlyings, canvasModel }) {
  const meta = canvasModel?.meta || { extraAccumulators: [], rawMeasures: {} };
  const lines = canvasModel?.lines || [];
  const c = new Compiler(identity, underlyings, meta);

  const events = [];
  const rows = [];
  const monitors = [];
  let terminalPayoff = { inputMeasureId: '', branches: [{ condition: { type: 'always' }, payoff: { base: 100, legs: [] } }] };

  // Pre-scan conditions for register needs (compileAction sets action-driven needs).
  const scanSentence = (s) => c.scanCondition(s.condition);

  const compileSentenceToEvent = (line, sentence) => {
    const id = `ev_${sentence.id}`;
    scanSentence(sentence);
    events.push({
      id,
      label: sentence.label || '',
      condition: c.compileCondition(sentence.condition),
      actions: (sentence.actions || []).map(a => c.compileAction(a)).filter(Boolean),
      elseActions: (sentence.elseActions || []).map(a => c.compileAction(a)).filter(Boolean)
    });
    return id;
  };

  for (const line of lines) {
    if (line.lineType === 'loop') {
      const eventIds = (line.rules || []).map(s => compileSentenceToEvent(line, s));
      const { unit: freqUnit, n: freqN } = loopStep(line);
      const periods = loopCount(line, identity?.finalObservationDate);
      for (let i = 0; i < periods; i++) {
        // Per-period date overrides let the Schedule tab shift a single fixing
        // off the generated cadence (e.g. a holiday). Absent → generated dates.
        const obsOverride = line.dateOverrides ? line.dateOverrides[i] : undefined;
        const observationDate = obsOverride || addByUnit(line.firstObservation, freqUnit, i * freqN);
        const payOverride = line.paymentDateOverrides ? line.paymentDateOverrides[i] : undefined;
        const paymentDate = payOverride || addDaysIso(observationDate, line.paymentLagDays || 0);
        const levels = {};
        for (const col of line.columns || []) {
          const override = col.overrides ? col.overrides[i] : undefined;
          levels[col.key] = override !== undefined && override !== null
            ? override
            : round2((col.initial || 0) - (col.stepPerPeriod || 0) * i);
        }
        rows.push({
          id: `tmp_${line.id}_${i}`,
          observationDate,
          paymentDate,
          levels,
          events: [...eventIds]
        });
      }
    } else if (line.lineType === 'single') {
      const eventIds = (line.rules || []).map(s => compileSentenceToEvent(line, s));
      rows.push({
        id: `tmp_${line.id}`,
        observationDate: line.observationDate,
        paymentDate: line.paymentDate,
        levels: { ...(line.levels || {}) },
        events: eventIds
      });
    } else if (line.lineType === 'anyDay') {
      const subj = line.subject || {};
      const scope = subj.kind === 'anyUnderlying' ? 'anyUnderlying'
        : subj.kind === 'eachUnderlying' ? 'eachUnderlying' : 'measure';
      const mon = {
        id: `mon_${line.id}`,
        type: 'barrierMonitor',
        scope,
        direction: line.comparison === 'touchesAbove' ? 'above' : 'below',
        level: line.level,
        observation: 'continuous',
        window: { ...line.window },
        onTrigger: (line.actions || []).map(a => c.compileAction(a)).filter(Boolean),
        once: line.once !== false
      };
      if (scope === 'measure') mon.measureId = c.measureForValue(subj);
      monitors.push(mon);
    } else if (line.lineType === 'count') {
      const counterKey = line.counterKey;
      c.counterKeys.add(counterKey);
      monitors.push({
        id: `mon_${line.id}`,
        type: 'barrierMonitor',
        mode: 'count',
        scope: 'measure',
        measureId: c.measureForValue(line.subject),
        direction: 'inside',
        level: line.range?.low,
        levelHigh: line.range?.high,
        observation: 'continuous',
        window: { ...line.window },
        countAccumulatorId: counterKey,
        observedDaysAccumulatorId: `${counterKey}Observed`,
        once: false
      });
    } else if (line.lineType === 'final') {
      const inputMeasureId = line.inputValue ? c.measureForValue(line.inputValue) : '';
      const branches = (line.branches || []).map(b => ({
        condition: b.condition ? c.compileCondition(b.condition) : { type: 'always' },
        payoff: {
          base: b.payoff?.base ?? 0,
          legs: (b.payoff?.legs || []).map(l => ({
            type: 'linear', of: 'input',
            strike: l.strike ?? 0, gearing: l.gearing ?? 1,
            floor: l.floor ?? null, cap: l.cap ?? null, absolute: !!l.absolute
          }))
        }
      }));
      terminalPayoff = { inputMeasureId, branches: branches.length ? branches : terminalPayoff.branches };
      if (line.plusMemory) { terminalPayoff.plusAccumulators = ['memoryCouponBalance']; c.needMemory = true; }
    }
  }

  // Sort rows by date and assign stable obs_N ids.
  rows.sort((a, b) => (a.observationDate < b.observationDate ? -1 : a.observationDate > b.observationDate ? 1 : 0));
  rows.forEach((r, i) => { r.id = `obs_${i + 1}`; });

  // ---- Assemble state registers ----
  const perUnderlying = {
    locked: { enabled: c.needLocked },
    eliminated: { enabled: c.needEliminated },
    flagged: { enabled: c.needFlagged }
  };
  const global = { knockedIn: { enabled: c.needKnockedIn, initial: false } };

  const accumulators = [];
  const pushAcc = (id, initial = 0) => { if (id && !accumulators.some(a => a.id === id)) accumulators.push({ id, initial }); };
  if (c.needMemory) pushAcc('memoryCouponBalance', 0);
  for (const k of c.counterKeys) { pushAcc(k, 0); pushAcc(`${k}Observed`, 0); }
  for (const acc of meta.extraAccumulators || []) pushAcc(acc.id, acc.initial ?? 0);

  return {
    identity,
    underlyings,
    stateRegisters: { perUnderlying, global, accumulators },
    measures: c.measures,
    schedule: { rows, monitors },
    events,
    terminalPayoff
  };
}
