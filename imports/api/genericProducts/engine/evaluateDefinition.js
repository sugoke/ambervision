/**
 * Generic product evaluation — the chronological walk. Pure: no Meteor, no
 * database. Everything is a deterministic function of
 * (definition, externalEvents, series, evaluationDate).
 *
 * evaluateDefinition({ definition, externalEvents, series, evaluationDate })
 *   series:         { [underlyingId]: [{ date: 'YYYY-MM-DD', close: Number }] } sorted asc
 *   evaluationDate: 'YYYY-MM-DD'
 *
 * Returns the raw (unformatted) result:
 * {
 *   state, rowOutcomes, monitorOutcomes, cashflows, lifecycle,
 *   terminal, currentUnderlyings, issues
 * }
 */

import { resolveMeasures } from './measureResolver.js';
import { evaluateCondition, resolveLevelRef } from './conditionEvaluator.js';
import { executeActions } from './actionExecutor.js';

const STALE_TOLERANCE_DAYS = 7;

function daysBetween(isoA, isoB) {
  return Math.abs(Date.parse(isoB) - Date.parse(isoA)) / 86400000;
}

function createInitialState(definition) {
  const regs = definition.stateRegisters || {};
  const perUnderlying = {};
  for (const u of definition.underlyings || []) {
    perUnderlying[u.id] = {
      locked: false, lockedValue: null, lockedDate: null,
      eliminated: false, eliminatedDate: null,
      flagged: false, flaggedDate: null
    };
  }
  const global = {};
  for (const [name, cfg] of Object.entries(regs.global || {})) {
    if (cfg?.enabled) global[name] = { value: !!cfg.initial, setDate: null };
  }
  const accumulators = {};
  for (const acc of regs.accumulators || []) {
    accumulators[acc.id] = typeof acc.initial === 'number' ? acc.initial : 0;
  }
  return {
    perUnderlying,
    global,
    accumulators,
    terminated: { isTerminated: false, cause: null, date: null, redemptionPct: null },
    cashflows: [],
    history: []
  };
}

function buildPerfIndex(definition, series) {
  const index = {};
  for (const u of definition.underlyings || []) {
    const bars = series[u.id] || [];
    const isLevel = u.basis === 'level';
    const dates = [];
    const perfs = [];
    const byDate = new Map();
    for (const bar of bars) {
      let value;
      if (isLevel) {
        // Rate-level underlying: use the raw series value (rates can be
        // zero or negative), no rebasing against an initial fixing.
        if (bar.close === null || bar.close === undefined || Number.isNaN(bar.close)) continue;
        value = bar.close;
      } else {
        if (!(bar.close > 0) || !u.initialFixing) continue;
        value = (bar.close / u.initialFixing) * 100;
      }
      dates.push(bar.date);
      perfs.push(value);
      byDate.set(bar.date, value);
    }
    index[u.id] = { dates, perfs, byDate };
  }
  return index;
}

/**
 * Performance at (or last known before) a date. Returns
 * { value, actualDate, stale } or null when nothing usable exists.
 */
function perfAt(index, underlyingId, dateStr, toleranceDays = STALE_TOLERANCE_DAYS) {
  const idx = index[underlyingId];
  if (!idx || idx.dates.length === 0) return null;
  const exact = idx.byDate.get(dateStr);
  if (exact !== undefined) return { value: exact, actualDate: dateStr, stale: false };

  // binary search for last date <= dateStr
  let lo = 0, hi = idx.dates.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (idx.dates[mid] <= dateStr) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  if (found === -1) return null;
  const actualDate = idx.dates[found];
  if (daysBetween(actualDate, dateStr) > toleranceDays) return null;
  return { value: idx.perfs[found], actualDate, stale: true };
}

function resolveAnchor(value, identity) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return identity[value] || null;
}

/**
 * Piecewise payoff: base + sum of legs.
 * Leg = clamp(gearing * f(input - strike), floor, cap), f = abs when absolute.
 */
export function computePayoff(payoff, inputValue) {
  let total = payoff.base || 0;
  for (const leg of payoff.legs || []) {
    let raw = inputValue - (leg.strike || 0);
    if (leg.absolute) raw = Math.abs(raw);
    let v = (typeof leg.gearing === 'number' ? leg.gearing : 1) * raw;
    if (typeof leg.floor === 'number') v = Math.max(v, leg.floor);
    if (typeof leg.cap === 'number') v = Math.min(v, leg.cap);
    total += v;
  }
  return total;
}

export function evaluateDefinition({ definition, externalEvents = [], series, evaluationDate }) {
  const identity = definition.identity;
  const issues = [];
  const state = createInitialState(definition);
  const index = buildPerfIndex(definition, series);

  for (const u of definition.underlyings || []) {
    if (!index[u.id] || index[u.id].dates.length === 0) {
      issues.push({ code: 'NO_MARKET_DATA', severity: 'error', message: `No market data for ${u.ticker || u.id} (${u.fullTicker})` });
    }
  }

  const makeGetPerf = (dateStr) => (underlyingId) => {
    const r = perfAt(index, underlyingId, dateStr);
    return r ? r.value : null;
  };

  // ---- Build the chronological item stream: monitor days + schedule rows ----
  const monitors = (definition.schedule?.monitors || []).map(mon => ({
    mon,
    mode: mon.mode || 'trigger',
    from: resolveAnchor(mon.window?.from, identity),
    to: resolveAnchor(mon.window?.to, identity),
    firedIds: new Set(),        // underlying ids already triggered (eachUnderlying)
    firedOnce: false,
    triggers: [],
    closest: null,              // { value, date } extreme approach toward the level
    counted: 0,                 // count mode: total days the condition held
    observed: 0                 // count mode: total days a value was resolvable
  }));

  const tradingDates = new Set();
  if (monitors.length > 0) {
    const scanFrom = monitors.map(m => m.from).filter(Boolean).sort()[0];
    const maxTo = monitors.map(m => m.to).filter(Boolean).sort().pop();
    const scanTo = maxTo && maxTo < evaluationDate ? maxTo : evaluationDate;
    for (const u of definition.underlyings || []) {
      for (const d of index[u.id]?.dates || []) {
        if (d >= scanFrom && d <= scanTo) tradingDates.add(d);
      }
    }
  }

  const items = [];
  for (const d of tradingDates) items.push({ date: d, order: 0, kind: 'monitorDay' });
  for (const row of definition.schedule?.rows || []) {
    items.push({ date: row.observationDate, order: 1, kind: 'row', row });
  }
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.order - b.order));

  const rowOutcomes = [];
  const processedRowIds = new Set();

  const hasAcc = (st, id) => id && Object.prototype.hasOwnProperty.call(st.accumulators, id);

  // Range test for count-mode monitors
  const inRange = (mon, v) => {
    switch (mon.direction) {
      case 'below': return v <= mon.level;
      case 'above': return v >= mon.level;
      case 'inside': return v >= mon.level && v <= mon.levelHigh;
      case 'outside': return v < mon.level || v > mon.levelHigh;
      default: return false;
    }
  };

  const processMonitorDay = (dateStr) => {
    const getPerf = makeGetPerf(dateStr);
    for (const entry of monitors) {
      const { mon } = entry;
      if (!entry.from || !entry.to || dateStr < entry.from || dateStr > entry.to) continue;

      // Count mode: tally every day a value is resolvable and every day the
      // range condition holds. Accumulators feed accrualFraction coupons.
      if (entry.mode === 'count') {
        const measures = resolveMeasures(definition, getPerf, state);
        const value = measures[mon.measureId]?.value ?? null;
        if (value === null || value === undefined) continue;
        entry.observed += 1;
        if (hasAcc(state, mon.observedDaysAccumulatorId)) state.accumulators[mon.observedDaysAccumulatorId] += 1;
        if (inRange(mon, value)) {
          entry.counted += 1;
          if (hasAcc(state, mon.countAccumulatorId)) state.accumulators[mon.countAccumulatorId] += 1;
        }
        continue;
      }

      if (entry.firedOnce && mon.once !== false) continue;

      const checkValue = (value, underlyingId) => {
        if (value === null || value === undefined) return;
        // Track closest approach toward the barrier
        if (!entry.closest ||
            (mon.direction === 'below' ? value < entry.closest.value : value > entry.closest.value)) {
          entry.closest = { value, date: dateStr, underlyingId: underlyingId || null };
        }
        const touched = mon.direction === 'below' ? value <= mon.level : value >= mon.level;
        if (!touched) return;
        if (underlyingId && entry.firedIds.has(underlyingId)) return;

        entry.triggers.push({ date: dateStr, underlyingId: underlyingId || null, value });
        if (underlyingId) entry.firedIds.add(underlyingId);
        entry.firedOnce = true;

        const measures = resolveMeasures(definition, getPerf, state);
        executeActions(mon.onTrigger || [], {
          state, row: null, date: dateStr, measures, getPerf,
          triggeringUnderlyingId: underlyingId || null,
          source: `monitor:${mon.id}`
        });
      };

      if (mon.scope === 'measure') {
        const measures = resolveMeasures(definition, getPerf, state);
        checkValue(measures[mon.measureId]?.value ?? null, null);
      } else {
        for (const u of definition.underlyings || []) {
          if (entry.firedOnce && mon.once !== false) break;
          const reg = state.perUnderlying[u.id];
          if (mon.scope === 'eachUnderlying' && (reg?.locked || reg?.eliminated)) continue;
          const r = perfAt(index, u.id, dateStr, 0); // per-leaf monitors use actual closes only
          checkValue(r ? r.value : null, u.id);
        }
      }
    }
  };

  const processRow = (row) => {
    processedRowIds.add(row.id);
    const getPerf = makeGetPerf(row.observationDate);

    // Resolve fixings; a missing one makes the row undetermined
    let missing = null;
    let stale = false;
    for (const u of definition.underlyings || []) {
      const reg = state.perUnderlying[u.id];
      if (reg?.eliminated) continue;
      const r = perfAt(index, u.id, row.observationDate);
      if (!r) { missing = u; break; }
      if (r.stale) stale = true;
    }
    if (missing) {
      issues.push({
        code: 'MISSING_FIXING', severity: 'warning',
        message: `Row ${row.id} (${row.observationDate}): no fixing for ${missing.ticker || missing.id} within ${STALE_TOLERANCE_DAYS} days`
      });
      rowOutcomes.push({ rowId: row.id, observationDate: row.observationDate, paymentDate: row.paymentDate, levels: row.levels, status: 'undetermined', measures: {}, eventResults: [] });
      return;
    }
    if (stale) {
      issues.push({ code: 'STALE_FIXING', severity: 'info', message: `Row ${row.id} (${row.observationDate}): used a prior close (non-trading day)` });
    }

    const measures = resolveMeasures(definition, getPerf, state);
    const measureValues = {};
    for (const [id, m] of Object.entries(measures)) measureValues[id] = m.value;

    const eventResults = [];
    for (const evId of row.events || []) {
      if (state.terminated.isTerminated) break;
      const event = (definition.events || []).find(e => e.id === evId);
      if (!event) continue;
      const ctx = {
        measures, state, row, date: row.observationDate,
        externalEvents, getPerf, source: `row:${row.id}`
      };
      const conditionMet = evaluateCondition(event.condition, ctx);
      let actionsTaken = [];
      if (conditionMet === true) actionsTaken = executeActions(event.actions, ctx);
      else if (conditionMet === false) actionsTaken = executeActions(event.elseActions, ctx);
      eventResults.push({ eventId: evId, label: event.label, conditionMet, actionsTaken });
    }

    rowOutcomes.push({
      rowId: row.id, observationDate: row.observationDate, paymentDate: row.paymentDate,
      levels: row.levels, status: 'observed', measures: measureValues, eventResults
    });
  };

  // ---- Walk ----
  for (const item of items) {
    if (state.terminated.isTerminated) break;
    if (item.date > evaluationDate) break;
    if (item.kind === 'monitorDay') processMonitorDay(item.date);
    else processRow(item.row);
  }

  // Remaining rows: cancelled (after termination) or upcoming
  for (const row of definition.schedule?.rows || []) {
    if (processedRowIds.has(row.id)) continue;
    const status = state.terminated.isTerminated ? 'cancelled' : 'upcoming';
    rowOutcomes.push({
      rowId: row.id, observationDate: row.observationDate, paymentDate: row.paymentDate,
      levels: row.levels, status, measures: {}, eventResults: []
    });
  }
  rowOutcomes.sort((a, b) => (a.observationDate < b.observationDate ? -1 : 1));

  // ---- Current snapshot at evaluation date ----
  const getPerfNow = makeGetPerf(evaluationDate);
  const currentMeasures = resolveMeasures(definition, getPerfNow, state);
  const currentUnderlyings = (definition.underlyings || []).map(u => {
    const r = perfAt(index, u.id, evaluationDate);
    const idx = index[u.id];
    const lastBar = idx && idx.dates.length > 0 ? idx.dates[idx.dates.length - 1] : null;
    return {
      id: u.id, ticker: u.ticker, fullTicker: u.fullTicker, name: u.name,
      initialFixing: u.initialFixing,
      lastClose: r ? (r.value / 100) * u.initialFixing : null,
      lastCloseDate: r ? r.actualDate : lastBar,
      performance: r ? r.value : null,
      state: state.perUnderlying[u.id]
    };
  });

  // ---- Terminal payoff ----
  const finalDate = identity.finalObservationDate;
  const atOrPastFinal = evaluationDate >= finalDate;
  let terminal = { applied: false, indicative: false, branchIndex: null, inputValue: null, redemptionPct: null };

  if (!state.terminated.isTerminated && definition.terminalPayoff) {
    const asOf = atOrPastFinal ? finalDate : evaluationDate;
    const getPerfTerm = makeGetPerf(asOf);
    const termMeasures = resolveMeasures(definition, getPerfTerm, state);
    const inputValue = termMeasures[definition.terminalPayoff.inputMeasureId]?.value ?? null;

    if (inputValue === null) {
      if (atOrPastFinal) {
        issues.push({ code: 'MISSING_FIXING', severity: 'error', message: `Terminal payoff undetermined: no fixing at final observation ${finalDate}` });
      }
    } else {
      let matched = null;
      const branches = definition.terminalPayoff.branches || [];
      for (let i = 0; i < branches.length; i++) {
        const met = evaluateCondition(branches[i].condition, {
          measures: termMeasures, state, row: null, externalEvents, date: asOf
        });
        if (met === true) { matched = { index: i, branch: branches[i] }; break; }
      }
      if (matched) {
        let redemptionPct = computePayoff(matched.branch.payoff, inputValue);
        for (const accId of definition.terminalPayoff.plusAccumulators || []) {
          if (state.accumulators[accId] !== undefined) redemptionPct += state.accumulators[accId];
        }
        terminal = {
          applied: atOrPastFinal,
          indicative: !atOrPastFinal,
          branchIndex: matched.index,
          inputValue,
          redemptionPct
        };
        if (atOrPastFinal) {
          state.cashflows.push({
            date: identity.maturityDate, observationDate: finalDate,
            type: 'redemption', amountPct: redemptionPct, source: 'terminalPayoff'
          });
        }
      }
    }
  }

  // ---- Lifecycle ----
  let lifecycle;
  if (state.terminated.isTerminated) {
    lifecycle = { code: 'autocalled', date: state.terminated.date, redemptionPct: state.terminated.redemptionPct };
  } else if (atOrPastFinal) {
    lifecycle = { code: 'matured', date: finalDate, redemptionPct: terminal.applied ? terminal.redemptionPct : null };
  } else {
    const nextRow = rowOutcomes.find(r => r.status === 'upcoming');
    lifecycle = {
      code: 'live',
      nextObservationDate: nextRow ? nextRow.observationDate : finalDate,
      nextRowId: nextRow ? nextRow.rowId : null
    };
  }

  return {
    evaluationDate,
    state,
    rowOutcomes,
    monitorOutcomes: monitors.map(entry => ({
      monitorId: entry.mon.id,
      mode: entry.mode,
      direction: entry.mon.direction,
      level: entry.mon.level,
      levelHigh: entry.mon.levelHigh ?? null,
      scope: entry.mon.scope,
      window: { from: entry.from, to: entry.to },
      triggered: entry.triggers.length > 0,
      triggers: entry.triggers,
      closestApproach: entry.closest,
      counted: entry.counted,
      observed: entry.observed
    })),
    cashflows: state.cashflows,
    lifecycle,
    terminal,
    currentMeasures: Object.fromEntries(Object.entries(currentMeasures).map(([id, m]) => [id, m.value])),
    currentUnderlyings,
    issues
  };
}
