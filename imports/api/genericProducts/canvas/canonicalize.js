/**
 * Canonicalize a definition for id-insensitive comparison. Round-tripping a
 * definition through decompile→compile regenerates ids (measures, rows,
 * events, monitors) — this normalizes both sides to content-derived names so
 * structural equality can be asserted.
 */

function round2(x) {
  return typeof x === 'number' ? Math.round(x * 1e6) / 1e6 : x;
}

// Recursive content signature of a measure (expands combine inputs by content).
function measureSig(m, byId, seen = new Set()) {
  if (!m) return 'null';
  if (m.type === 'rankSelect') {
    return `rankSelect|${m.mode}|${m.rank || 1}|${m.universe}|${m.valueOf || 'performance'}|${(m.underlyingIds || []).slice().sort().join(',')}`;
  }
  if (m.type === 'aggregate') {
    return `aggregate|${m.fn}|${m.universe}|${(m.underlyingIds || []).slice().sort().join(',')}`;
  }
  if (m.type === 'combine') {
    const inputs = (m.inputs || []).map(i => `${measureSig(byId[i.measureId], byId, seen)}@${i.weight ?? 1}`).join(',');
    return `combine|${m.fn}|${inputs}`;
  }
  return JSON.stringify(m);
}

export function canonicalize(definition) {
  const byId = {};
  (definition.measures || []).forEach(m => { byId[m.id] = m; });

  // measure id -> canonical name by sorted unique signature
  const sigOf = {};
  (definition.measures || []).forEach(m => { sigOf[m.id] = measureSig(m, byId); });
  const uniqueSigs = [...new Set(Object.values(sigOf))].sort();
  const sigToName = {};
  uniqueSigs.forEach((s, i) => { sigToName[s] = `M${i}`; });
  const measureName = (id) => (id in sigOf ? sigToName[sigOf[id]] : `MISSING(${id})`);

  // row id -> R<index by sorted date>
  const rows = (definition.schedule?.rows || []).slice()
    .sort((a, b) => (a.observationDate < b.observationDate ? -1 : a.observationDate > b.observationDate ? 1 : 0));
  const rowName = {};
  rows.forEach((r, i) => { rowName[r.id] = `R${i}`; });

  // monitor id -> N<index by signature>
  const monSig = (mon) => `${mon.mode || 'trigger'}|${mon.scope}|${mon.direction}|${mon.level}|${mon.levelHigh ?? ''}|${JSON.stringify(mon.window)}`;
  const monitors = (definition.schedule?.monitors || []).slice().sort((a, b) => (monSig(a) < monSig(b) ? -1 : 1));

  const canonRate = (r) => {
    if (!r) return r;
    if (r.source === 'measure') {
      const o = { source: 'measure', measureId: measureName(r.measureId), gearing: r.gearing ?? 1, spread: r.spread ?? 0 };
      if (r.floor !== undefined && r.floor !== null) o.floor = r.floor;
      if (r.cap !== undefined && r.cap !== null) o.cap = r.cap;
      return o;
    }
    if (r.source === 'accrualFraction') {
      return { source: 'accrualFraction', rate: canonRate(r.rate), countAccumulatorId: r.countAccumulatorId, observedDaysAccumulatorId: r.observedDaysAccumulatorId, resetEachPeriod: r.resetEachPeriod !== false };
    }
    if (r.source === 'fixed') return { source: 'fixed', value: round2(r.value) };
    return { ...r };
  };

  const canonCondition = (c) => {
    if (!c) return { type: 'always' };
    switch (c.type) {
      case 'levelTest': {
        const level = c.level?.source === 'rowLevel' ? { source: 'rowLevel', key: c.level.key } : { source: 'fixed', value: round2(c.level?.value) };
        return { type: 'levelTest', measureId: measureName(c.measureId), op: c.op, level };
      }
      case 'and':
      case 'or':
        return { type: c.type, conditions: (c.conditions || []).map(canonCondition) };
      case 'not':
        return { type: 'not', condition: canonCondition(c.condition) };
      case 'stateTest':
        return { type: 'stateTest', register: c.register, expect: !!c.expect };
      case 'countTest':
        return { type: 'countTest', perUnderlyingRegister: c.perUnderlyingRegister, op: c.op, count: c.count };
      default:
        return { ...c };
    }
  };

  const canonSelector = (s) => {
    if (!s) return s;
    if (s.source === 'measureSelection') return { source: 'measureSelection', measureId: measureName(s.measureId) };
    return { source: s.source };
  };

  const canonAction = (a) => {
    switch (a.type) {
      case 'payCoupon': {
        const o = { type: 'payCoupon', rate: canonRate(a.rate), memory: !!a.memory };
        if (a.memory) o.accumulatorId = a.accumulatorId;
        return o;
      }
      case 'accrueToAccumulator':
        return { type: 'accrueToAccumulator', accumulatorId: a.accumulatorId, rate: canonRate(a.rate) };
      case 'call':
        return { type: 'call', redemptionLevel: canonRate(a.redemptionLevel), plusAccumulators: (a.plusAccumulators || []).slice().sort() };
      case 'setState':
        return { type: 'setState', register: a.register, value: a.value };
      case 'lockUnderlying':
        return { type: 'lockUnderlying', selector: canonSelector(a.selector), lockValue: a.lockValue };
      case 'eliminateUnderlying':
        return { type: 'eliminateUnderlying', selector: canonSelector(a.selector) };
      case 'flagUnderlying':
        return { type: 'flagUnderlying', selector: canonSelector(a.selector) };
      default:
        return { ...a };
    }
  };

  // Events deduped by canonical content: two behaviourally-identical events
  // (e.g. a loop's rule and an identical single-line's rule after a schedule
  // splits) collapse to one canonical event. Row references map through content.
  const eventContent = {};
  (definition.events || []).forEach(ev => {
    eventContent[ev.id] = {
      condition: canonCondition(ev.condition),
      actions: (ev.actions || []).map(canonAction),
      elseActions: (ev.elseActions || []).map(canonAction)
    };
  });
  const contentKeyOf = {};
  (definition.events || []).forEach(ev => { contentKeyOf[ev.id] = JSON.stringify(sortKeys(eventContent[ev.id])); });
  const uniqueEventKeys = [...new Set(Object.values(contentKeyOf))].sort();
  const keyToName = {};
  uniqueEventKeys.forEach((k, i) => { keyToName[k] = `E${i}`; });
  const eventName = {};
  (definition.events || []).forEach(ev => { eventName[ev.id] = keyToName[contentKeyOf[ev.id]]; });

  const eventsCanon = {};
  (definition.events || []).forEach(ev => { eventsCanon[eventName[ev.id]] = eventContent[ev.id]; });

  const measuresCanon = {};
  (definition.measures || []).forEach(m => {
    const name = measureName(m.id);
    if (m.type === 'combine') {
      measuresCanon[name] = { type: 'combine', fn: m.fn, inputs: (m.inputs || []).map(i => ({ measureId: measureName(i.measureId), weight: i.weight ?? 1 })) };
    } else if (m.type === 'rankSelect') {
      measuresCanon[name] = { type: 'rankSelect', mode: m.mode, rank: m.rank || 1, universe: m.universe, valueOf: m.valueOf || 'performance', underlyingIds: (m.underlyingIds || []).slice().sort() };
    } else {
      measuresCanon[name] = { type: 'aggregate', fn: m.fn, universe: m.universe, underlyingIds: (m.underlyingIds || []).slice().sort() };
    }
  });

  return {
    underlyings: (definition.underlyings || []).map(u => ({
      id: u.id, fullTicker: u.fullTicker, basis: u.basis || 'performance', initialFixing: u.initialFixing ?? null, weight: u.weight ?? null
    })),
    stateRegisters: {
      perUnderlying: {
        locked: !!definition.stateRegisters?.perUnderlying?.locked?.enabled,
        eliminated: !!definition.stateRegisters?.perUnderlying?.eliminated?.enabled,
        flagged: !!definition.stateRegisters?.perUnderlying?.flagged?.enabled
      },
      knockedIn: !!definition.stateRegisters?.global?.knockedIn?.enabled,
      accumulators: (definition.stateRegisters?.accumulators || []).map(a => a.id).sort()
    },
    measures: measuresCanon,
    rows: rows.map(r => ({
      id: rowName[r.id],
      observationDate: r.observationDate,
      paymentDate: r.paymentDate,
      levels: Object.fromEntries(Object.entries(r.levels || {}).map(([k, v]) => [k, round2(v)])),
      events: (r.events || []).map(e => eventName[e])
    })),
    monitors: monitors.map(mon => ({
      mode: mon.mode || 'trigger',
      scope: mon.scope,
      measureId: mon.measureId ? measureName(mon.measureId) : null,
      direction: mon.direction,
      level: round2(mon.level),
      levelHigh: mon.levelHigh ?? null,
      window: mon.window,
      once: mon.once !== false,
      countAccumulatorId: mon.countAccumulatorId ?? null,
      observedDaysAccumulatorId: mon.observedDaysAccumulatorId ?? null,
      onTrigger: (mon.onTrigger || []).map(canonAction)
    })),
    events: eventsCanon,
    terminalPayoff: {
      inputMeasureId: measureName(definition.terminalPayoff?.inputMeasureId),
      plusAccumulators: (definition.terminalPayoff?.plusAccumulators || []).slice().sort(),
      branches: (definition.terminalPayoff?.branches || []).map(b => ({
        condition: canonCondition(b.condition),
        payoff: {
          base: round2(b.payoff?.base),
          legs: (b.payoff?.legs || []).map(l => ({
            strike: round2(l.strike ?? 0), gearing: round2(l.gearing ?? 1),
            floor: l.floor ?? null, cap: l.cap ?? null, absolute: !!l.absolute
          }))
        }
      }))
    }
  };
}

function sortKeys(obj) {
  if (Array.isArray(obj)) return obj.map(sortKeys);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj).sort()) out[k] = sortKeys(obj[k]);
    return out;
  }
  return obj;
}

export function canonicalJSON(definition) {
  return JSON.stringify(sortKeys(canonicalize(definition)));
}
