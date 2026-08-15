/**
 * Measure resolution — pure.
 *
 * Measures are named nodes referenced by id from conditions, actions, and the
 * terminal payoff. All values are on the performance basis:
 * close / initialFixing * 100 (100 = flat).
 *
 * resolveMeasures(definition, getPerf, state) returns:
 *   { [measureId]: { value: Number|null, selectedIds: [underlyingId] } }
 *
 * getPerf(underlyingId) -> Number|null  (live performance at the current date)
 * A null value means the measure is undetermined at this date (missing fixing).
 */

function universeIds(definition, state, universe, underlyingIds) {
  return definition.underlyings
    .map(u => u.id)
    .filter(id => !underlyingIds || underlyingIds.includes(id))
    .filter(id => {
      const reg = state.perUnderlying[id] || {};
      if (universe === 'active') return !reg.eliminated;
      if (universe === 'locked') return !!reg.locked;
      return true; // 'all'
    });
}

function valueFor(id, state, getPerf, useLockedOrLive) {
  const reg = state.perUnderlying[id] || {};
  if (useLockedOrLive && reg.locked && reg.lockedValue !== null && reg.lockedValue !== undefined) {
    return reg.lockedValue;
  }
  return getPerf(id);
}

function resolveRankSelect(measure, definition, state, getPerf) {
  const ids = universeIds(definition, state, measure.universe || 'all', measure.underlyingIds);
  if (ids.length === 0) return { value: null, selectedIds: [] };

  const useLockedOrLive = measure.valueOf === 'lockedOrLive';
  const entries = [];
  for (const id of ids) {
    const v = valueFor(id, state, getPerf, useLockedOrLive);
    if (v === null || v === undefined) return { value: null, selectedIds: [] };
    entries.push({ id, value: v });
  }

  entries.sort((a, b) => b.value - a.value); // best first
  let picked;
  if (measure.mode === 'worst') picked = entries[entries.length - 1];
  else if (measure.mode === 'best') picked = entries[0];
  else picked = entries[Math.min(Math.max((measure.rank || 1) - 1, 0), entries.length - 1)];

  return { value: picked.value, selectedIds: [picked.id] };
}

function resolveAggregate(measure, definition, state, getPerf) {
  const ids = universeIds(definition, state, measure.universe || 'all', measure.underlyingIds);
  if (ids.length === 0) return { value: null, selectedIds: [] };

  const useLockedOrLive = measure.fn === 'meanOfLockedOrLive';
  const values = [];
  const weights = [];
  for (const id of ids) {
    const v = valueFor(id, state, getPerf, useLockedOrLive);
    if (v === null || v === undefined) return { value: null, selectedIds: [] };
    values.push(v);
    const u = definition.underlyings.find(x => x.id === id);
    weights.push(u && typeof u.weight === 'number' ? u.weight : 1);
  }

  let value;
  switch (measure.fn) {
    case 'min': value = Math.min(...values); break;
    case 'max': value = Math.max(...values); break;
    case 'mean':
    case 'meanOfLockedOrLive':
      value = values.reduce((s, v) => s + v, 0) / values.length;
      break;
    case 'weightedMean': {
      const totalW = weights.reduce((s, w) => s + w, 0);
      value = totalW === 0 ? null : values.reduce((s, v, i) => s + v * weights[i], 0) / totalW;
      break;
    }
    default: value = null;
  }
  return { value, selectedIds: ids };
}

function resolveCombine(measure, resolved) {
  const inputs = measure.inputs || [];
  const inputValues = inputs.map(inp => resolved[inp.measureId]?.value);
  if (inputValues.some(v => v === null || v === undefined)) return { value: null, selectedIds: [] };

  let value;
  if (measure.fn === 'spread') {
    value = inputValues.length >= 2 ? inputValues[0] - inputValues[1] : null;
  } else { // weightedSum
    value = inputs.reduce((s, inp, i) => s + inputValues[i] * (typeof inp.weight === 'number' ? inp.weight : 1), 0);
  }
  return { value, selectedIds: [] };
}

export function resolveMeasures(definition, getPerf, state) {
  const resolved = {};
  const measures = definition.measures || [];

  // Non-combine measures first, then combines (which may reference them).
  // Combines referencing combines resolve in listed order.
  for (const m of measures) {
    if (m.type === 'rankSelect') resolved[m.id] = resolveRankSelect(m, definition, state, getPerf);
    else if (m.type === 'aggregate') resolved[m.id] = resolveAggregate(m, definition, state, getPerf);
  }
  for (const m of measures) {
    if (m.type === 'combine') resolved[m.id] = resolveCombine(m, resolved);
  }
  return resolved;
}

/**
 * Resolve a single measure by id at the current date (used by monitors).
 */
export function resolveMeasure(measureId, definition, getPerf, state) {
  return resolveMeasures(definition, getPerf, state)[measureId] || { value: null, selectedIds: [] };
}
