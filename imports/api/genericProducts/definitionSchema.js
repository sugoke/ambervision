/**
 * Definition schema for composition-based products.
 *
 * A product definition is pure data composed of primitives. No product-family
 * names appear anywhere in the engine: every behaviour is expressed through
 * the discriminated unions below.
 *
 * Isomorphic and pure — used live by the builder form and again server-side
 * before save/evaluate.
 */

export const MEASURE_TYPES = ['rankSelect', 'aggregate', 'combine'];
export const RANK_MODES = ['worst', 'best', 'rank'];
export const UNIVERSES = ['active', 'all', 'locked'];
export const VALUE_OF = ['performance', 'lockedOrLive'];
export const AGGREGATE_FNS = ['min', 'max', 'mean', 'weightedMean', 'meanOfLockedOrLive'];
export const COMBINE_FNS = ['weightedSum', 'spread'];

export const CONDITION_TYPES = [
  'levelTest', 'stateTest', 'countTest', 'accumulatorTest',
  'externalEvent', 'and', 'or', 'not', 'always'
];
export const LEVEL_OPS = ['gte', 'gt', 'lte', 'lt'];

export const ACTION_TYPES = [
  'payCoupon', 'accrueToAccumulator', 'call', 'setState',
  'lockUnderlying', 'eliminateUnderlying', 'flagUnderlying'
];

export const MONITOR_SCOPES = ['measure', 'anyUnderlying', 'eachUnderlying'];
export const MONITOR_MODES = ['trigger', 'count'];
export const WINDOW_ANCHORS = ['tradeDate', 'valueDate', 'finalObservationDate', 'maturityDate'];

// 'performance' = close / initialFixing * 100 (equities); 'level' = raw series
// value (rates like a 3.52% CMS fixing) — no rebasing, initialFixing optional.
export const UNDERLYING_BASES = ['performance', 'level'];

// rate ref sources usable by payCoupon / accrueToAccumulator:
//   fixed / rowLevel                      — as before
//   measure {measureId, gearing, spread, floor, cap}
//                                         — floating coupon = clamp(g×m + s)
//   accrualFraction {rate, countAccumulatorId, observedDaysAccumulatorId}
//                                         — range accrual = rate × days-met/days-observed
export const RATE_SOURCES = ['fixed', 'rowLevel', 'measure', 'accrualFraction'];

export const PER_UNDERLYING_REGISTERS = ['locked', 'eliminated', 'flagged'];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Empty-but-valid skeleton the builder starts from.
 */
export function createEmptyDefinition() {
  return {
    identity: {
      isin: '',
      issuer: '',
      currency: 'USD',
      notional: 1000000,
      denomination: 1000,
      tradeDate: '',
      valueDate: '',
      finalObservationDate: '',
      maturityDate: '',
      settlement: 'cash'
    },
    underlyings: [],
    stateRegisters: {
      perUnderlying: {
        locked: { enabled: false },
        eliminated: { enabled: false },
        flagged: { enabled: false }
      },
      global: {
        knockedIn: { enabled: false, initial: false }
      },
      accumulators: []
    },
    measures: [],
    schedule: { rows: [], monitors: [] },
    events: [],
    terminalPayoff: {
      inputMeasureId: '',
      branches: [
        {
          condition: { type: 'always' },
          payoff: { base: 100, legs: [] }
        }
      ]
    }
  };
}

function isIsoDate(s) {
  return typeof s === 'string' && ISO_DATE_RE.test(s);
}

function collectConditionRefs(condition, refs) {
  if (!condition || typeof condition !== 'object') return;
  switch (condition.type) {
    case 'levelTest':
      refs.measureIds.push(condition.measureId);
      if (condition.level?.source === 'rowLevel') refs.rowLevelKeys.push(condition.level.key);
      break;
    case 'accumulatorTest':
      refs.accumulatorIds.push(condition.accumulatorId);
      break;
    case 'and':
    case 'or':
      (condition.conditions || []).forEach(c => collectConditionRefs(c, refs));
      break;
    case 'not':
      collectConditionRefs(condition.condition, refs);
      break;
    default:
      break;
  }
}

function collectRateRefs(ref, refs) {
  if (!ref || typeof ref !== 'object') return;
  if (ref.source === 'rowLevel') refs.rowLevelKeys.push(ref.key);
  else if (ref.source === 'measure') refs.measureIds.push(ref.measureId);
  else if (ref.source === 'accrualFraction') {
    refs.accumulatorIds.push(ref.countAccumulatorId, ref.observedDaysAccumulatorId);
    collectRateRefs(ref.rate, refs);
  }
}

function collectActionRefs(action, refs) {
  if (!action || typeof action !== 'object') return;
  switch (action.type) {
    case 'payCoupon':
      collectRateRefs(action.rate, refs);
      if (action.accumulatorId) refs.accumulatorIds.push(action.accumulatorId);
      break;
    case 'accrueToAccumulator':
      refs.accumulatorIds.push(action.accumulatorId);
      collectRateRefs(action.rate, refs);
      break;
    case 'call':
      if (action.redemptionLevel?.source === 'rowLevel') refs.rowLevelKeys.push(action.redemptionLevel.key);
      (action.plusAccumulators || []).forEach(a => refs.accumulatorIds.push(a));
      break;
    case 'lockUnderlying':
    case 'eliminateUnderlying':
    case 'flagUnderlying':
      if (action.selector?.source === 'measureSelection') refs.measureIds.push(action.selector.measureId);
      break;
    default:
      break;
  }
}

/**
 * Validate a definition. Returns { errors: [String], warnings: [String] }.
 * Errors block save/evaluate; warnings are informational.
 */
export function validateDefinition(definition) {
  const errors = [];
  const warnings = [];

  if (!definition || typeof definition !== 'object') {
    return { errors: ['Definition is missing'], warnings };
  }

  const { identity, underlyings, stateRegisters, measures, schedule, events, terminalPayoff } = definition;

  // --- Identity ---
  if (!identity) {
    errors.push('identity is required');
  } else {
    if (!identity.currency) errors.push('identity.currency is required');
    ['tradeDate', 'valueDate', 'finalObservationDate', 'maturityDate'].forEach(f => {
      if (!isIsoDate(identity[f])) errors.push(`identity.${f} must be a YYYY-MM-DD date`);
    });
    if (isIsoDate(identity.tradeDate) && isIsoDate(identity.valueDate) && identity.valueDate < identity.tradeDate) {
      errors.push('valueDate must be on or after tradeDate');
    }
    if (isIsoDate(identity.valueDate) && isIsoDate(identity.finalObservationDate) && identity.finalObservationDate < identity.valueDate) {
      errors.push('finalObservationDate must be on or after valueDate');
    }
    if (isIsoDate(identity.finalObservationDate) && isIsoDate(identity.maturityDate) && identity.maturityDate < identity.finalObservationDate) {
      errors.push('maturityDate must be on or after finalObservationDate');
    }
    if (!identity.isin) warnings.push('No ISIN set');
  }

  // --- Underlyings ---
  const underlyingIds = new Set();
  if (!Array.isArray(underlyings) || underlyings.length === 0) {
    errors.push('At least one underlying is required');
  } else {
    underlyings.forEach((u, i) => {
      if (!u.id) errors.push(`underlyings[${i}] is missing an id`);
      else if (underlyingIds.has(u.id)) errors.push(`Duplicate underlying id "${u.id}"`);
      else underlyingIds.add(u.id);
      if (!u.fullTicker) errors.push(`underlyings[${i}] (${u.ticker || u.id}) is missing fullTicker (e.g. AAPL.US)`);
      if (u.basis && !UNDERLYING_BASES.includes(u.basis)) errors.push(`underlyings[${i}] (${u.ticker || u.id}) has unknown basis "${u.basis}"`);
      if (u.basis !== 'level' && !(u.initialFixing > 0)) errors.push(`underlyings[${i}] (${u.ticker || u.id}) needs a positive initialFixing`);
    });
  }

  // --- State registers ---
  const accumulatorIds = new Set();
  (stateRegisters?.accumulators || []).forEach((a, i) => {
    if (!a.id) errors.push(`accumulators[${i}] is missing an id`);
    else if (accumulatorIds.has(a.id)) errors.push(`Duplicate accumulator id "${a.id}"`);
    else accumulatorIds.add(a.id);
  });

  // --- Measures ---
  const measureIds = new Set();
  (measures || []).forEach((m, i) => {
    if (!m.id) errors.push(`measures[${i}] is missing an id`);
    else if (measureIds.has(m.id)) errors.push(`Duplicate measure id "${m.id}"`);
    else measureIds.add(m.id);
    if (!MEASURE_TYPES.includes(m.type)) errors.push(`Measure "${m.id}" has unknown type "${m.type}"`);
    if (m.underlyingIds !== undefined) {
      if (!Array.isArray(m.underlyingIds) || m.underlyingIds.length === 0) {
        errors.push(`Measure "${m.id}" underlyingIds must be a non-empty array when set`);
      } else {
        m.underlyingIds.forEach(uid => {
          if (!underlyingIds.has(uid)) errors.push(`Measure "${m.id}" references unknown underlying "${uid}"`);
        });
      }
    }
    if (m.type === 'rankSelect' && !RANK_MODES.includes(m.mode)) errors.push(`Measure "${m.id}" has unknown mode "${m.mode}"`);
    if (m.type === 'aggregate' && !AGGREGATE_FNS.includes(m.fn)) errors.push(`Measure "${m.id}" has unknown fn "${m.fn}"`);
    if (m.type === 'combine') {
      if (!COMBINE_FNS.includes(m.fn)) errors.push(`Measure "${m.id}" has unknown fn "${m.fn}"`);
      (m.inputs || []).forEach(inp => {
        // combine inputs are checked after all ids are known (below)
        if (!inp.measureId) errors.push(`Measure "${m.id}" has an input with no measureId`);
      });
    }
  });
  (measures || []).forEach(m => {
    if (m.type === 'combine') {
      (m.inputs || []).forEach(inp => {
        if (inp.measureId && !measureIds.has(inp.measureId)) {
          errors.push(`Measure "${m.id}" references unknown measure "${inp.measureId}"`);
        }
      });
    }
  });

  // --- Events ---
  const eventIds = new Set();
  const eventRefs = {}; // eventId -> { measureIds, accumulatorIds, rowLevelKeys }
  (events || []).forEach((ev, i) => {
    if (!ev.id) errors.push(`events[${i}] is missing an id`);
    else if (eventIds.has(ev.id)) errors.push(`Duplicate event id "${ev.id}"`);
    else eventIds.add(ev.id);

    const refs = { measureIds: [], accumulatorIds: [], rowLevelKeys: [] };
    collectConditionRefs(ev.condition, refs);
    (ev.actions || []).forEach(a => collectActionRefs(a, refs));
    (ev.elseActions || []).forEach(a => collectActionRefs(a, refs));
    eventRefs[ev.id] = refs;

    refs.measureIds.forEach(id => {
      if (id && !measureIds.has(id)) errors.push(`Event "${ev.id}" references unknown measure "${id}"`);
    });
    refs.accumulatorIds.forEach(id => {
      if (id && !accumulatorIds.has(id)) errors.push(`Event "${ev.id}" references unknown accumulator "${id}"`);
    });
  });

  // --- Schedule rows ---
  const rowIds = new Set();
  const rows = schedule?.rows || [];
  rows.forEach((row, i) => {
    if (!row.id) errors.push(`schedule.rows[${i}] is missing an id`);
    else if (rowIds.has(row.id)) errors.push(`Duplicate schedule row id "${row.id}"`);
    else rowIds.add(row.id);
    if (!isIsoDate(row.observationDate)) errors.push(`schedule.rows[${i}] observationDate must be YYYY-MM-DD`);
    if (row.paymentDate && !isIsoDate(row.paymentDate)) errors.push(`schedule.rows[${i}] paymentDate must be YYYY-MM-DD`);
    (row.events || []).forEach(evId => {
      if (!eventIds.has(evId)) {
        errors.push(`Row "${row.id || i}" references unknown event "${evId}"`);
        return;
      }
      // Every rowLevel key an event uses must exist on every row that fires it
      (eventRefs[evId]?.rowLevelKeys || []).forEach(key => {
        if (row.levels?.[key] === undefined || row.levels?.[key] === null) {
          errors.push(`Row "${row.id || i}" fires event "${evId}" which needs level "${key}", but the row has no such level`);
        }
      });
    });
  });
  for (let i = 1; i < rows.length; i++) {
    if (rows[i - 1].observationDate && rows[i].observationDate && rows[i].observationDate < rows[i - 1].observationDate) {
      errors.push('Schedule rows must be sorted by observationDate');
      break;
    }
  }
  if (rows.length === 0) warnings.push('Schedule has no observation rows (terminal payoff only)');

  // --- Monitors ---
  (schedule?.monitors || []).forEach((mon, i) => {
    if (!mon.id) errors.push(`monitors[${i}] is missing an id`);
    if (!MONITOR_SCOPES.includes(mon.scope)) errors.push(`Monitor "${mon.id || i}" has unknown scope "${mon.scope}"`);
    if (mon.scope === 'measure' && !measureIds.has(mon.measureId)) {
      errors.push(`Monitor "${mon.id || i}" references unknown measure "${mon.measureId}"`);
    }
    const mode = mon.mode || 'trigger';
    if (!MONITOR_MODES.includes(mode)) errors.push(`Monitor "${mon.id || i}" has unknown mode "${mon.mode}"`);
    if (mode === 'count') {
      // Count monitors tally days a condition holds (range accruals)
      if (mon.scope !== 'measure') errors.push(`Monitor "${mon.id || i}" count mode requires scope "measure"`);
      if (!['below', 'above', 'inside', 'outside'].includes(mon.direction)) {
        errors.push(`Monitor "${mon.id || i}" count direction must be below/above/inside/outside`);
      }
      if (['inside', 'outside'].includes(mon.direction)) {
        if (typeof mon.levelHigh !== 'number') errors.push(`Monitor "${mon.id || i}" needs a numeric levelHigh for ${mon.direction} range`);
        else if (typeof mon.level === 'number' && mon.level > mon.levelHigh) errors.push(`Monitor "${mon.id || i}" level must be <= levelHigh`);
      }
      ['countAccumulatorId', 'observedDaysAccumulatorId'].forEach(f => {
        if (!mon[f]) errors.push(`Monitor "${mon.id || i}" count mode requires ${f}`);
        else if (!accumulatorIds.has(mon[f])) errors.push(`Monitor "${mon.id || i}" ${f} "${mon[f]}" is not a declared accumulator`);
      });
      if ((mon.onTrigger || []).length > 0) warnings.push(`Monitor "${mon.id || i}" is count mode — onTrigger actions are ignored`);
    } else if (!['below', 'above'].includes(mon.direction)) {
      errors.push(`Monitor "${mon.id || i}" direction must be below/above`);
    }
    if (typeof mon.level !== 'number') errors.push(`Monitor "${mon.id || i}" needs a numeric level`);
    ['from', 'to'].forEach(edge => {
      const v = mon.window?.[edge];
      if (!v || (!isIsoDate(v) && !WINDOW_ANCHORS.includes(v))) {
        errors.push(`Monitor "${mon.id || i}" window.${edge} must be a date or one of: ${WINDOW_ANCHORS.join(', ')}`);
      }
    });
    if (mode === 'trigger' && (!Array.isArray(mon.onTrigger) || mon.onTrigger.length === 0)) {
      warnings.push(`Monitor "${mon.id || i}" has no onTrigger actions`);
    }
    const refs = { measureIds: [], accumulatorIds: [], rowLevelKeys: [] };
    (mon.onTrigger || []).forEach(a => collectActionRefs(a, refs));
    refs.measureIds.forEach(id => {
      if (id && !measureIds.has(id)) errors.push(`Monitor "${mon.id || i}" references unknown measure "${id}"`);
    });
    refs.accumulatorIds.forEach(id => {
      if (id && !accumulatorIds.has(id)) errors.push(`Monitor "${mon.id || i}" references unknown accumulator "${id}"`);
    });
    if (refs.rowLevelKeys.length > 0) {
      errors.push(`Monitor "${mon.id || i}" actions cannot use rowLevel values (monitors run between rows)`);
    }
  });

  // --- Terminal payoff ---
  if (!terminalPayoff || !Array.isArray(terminalPayoff.branches) || terminalPayoff.branches.length === 0) {
    errors.push('terminalPayoff with at least one branch is required');
  } else {
    if (!terminalPayoff.inputMeasureId || !measureIds.has(terminalPayoff.inputMeasureId)) {
      errors.push(`terminalPayoff.inputMeasureId "${terminalPayoff.inputMeasureId}" is not a known measure`);
    }
    const hasAlways = terminalPayoff.branches.some(b => b.condition?.type === 'always');
    if (!hasAlways) errors.push('terminalPayoff must include a fallback branch with condition { type: "always" }');
    const refs = { measureIds: [], accumulatorIds: [], rowLevelKeys: [] };
    terminalPayoff.branches.forEach(b => collectConditionRefs(b.condition, refs));
    refs.measureIds.forEach(id => {
      if (id && !measureIds.has(id)) errors.push(`terminalPayoff references unknown measure "${id}"`);
    });
    if (refs.rowLevelKeys.length > 0) errors.push('terminalPayoff conditions cannot use rowLevel values');
    (terminalPayoff.plusAccumulators || []).forEach(id => {
      if (!accumulatorIds.has(id)) errors.push(`terminalPayoff references unknown accumulator "${id}"`);
    });
  }

  // --- State register usage sanity ---
  const perU = stateRegisters?.perUnderlying || {};
  const usesRegister = (regName, actionType) => {
    const all = [
      ...(events || []).flatMap(e => [...(e.actions || []), ...(e.elseActions || [])]),
      ...(schedule?.monitors || []).flatMap(m => m.onTrigger || [])
    ];
    return all.some(a => a.type === actionType);
  };
  if (usesRegister('locked', 'lockUnderlying') && !perU.locked?.enabled) {
    warnings.push('lockUnderlying is used but the "locked" register is not enabled — enabling it is implied');
  }
  if (usesRegister('eliminated', 'eliminateUnderlying') && !perU.eliminated?.enabled) {
    warnings.push('eliminateUnderlying is used but the "eliminated" register is not enabled — enabling it is implied');
  }

  return { errors, warnings };
}
