/**
 * Action execution — pure. Mutates the EvaluationState passed in ctx and
 * returns a description entry for every action taken (used by the report).
 *
 * ctx: {
 *   state:                    EvaluationState (mutated)
 *   row:                      current schedule row or null
 *   date:                     'YYYY-MM-DD' the action fires on
 *   measures:                 resolved measures at this date
 *   getPerf:                  (underlyingId) -> Number|null
 *   triggeringUnderlyingId:   set when fired from an eachUnderlying monitor
 *   source:                   'row:obs_3' | 'monitor:monKI' for the audit trail
 * }
 *
 * Reserved accumulator ids maintained automatically by payCoupon when declared:
 *   couponsPaidTotal (+= amount), couponsPaidCount (+= 1)
 */

import { resolveLevelRef } from './conditionEvaluator.js';

/**
 * Resolve a coupon/accrual rate reference to a number (or null if undetermined).
 * Returns { value, detail } — detail is populated for accrualFraction rates so
 * the report can show "4.00% × 58/62 days". Passed a mutate=true accrualFraction
 * consumes (zeroes) its counters after resolving.
 */
function resolveRateRef(ref, ctx, { consume = true } = {}) {
  if (!ref || typeof ref !== 'object') return { value: null };

  switch (ref.source) {
    case 'fixed':
    case 'rowLevel': {
      const v = resolveLevelRef(ref, ctx.row);
      return { value: v === undefined ? null : v };
    }
    case 'measure': {
      const m = ctx.measures[ref.measureId]?.value;
      if (m === null || m === undefined) return { value: null };
      let v = (typeof ref.gearing === 'number' ? ref.gearing : 1) * m + (ref.spread || 0);
      if (typeof ref.floor === 'number') v = Math.max(v, ref.floor);
      if (typeof ref.cap === 'number') v = Math.min(v, ref.cap);
      return { value: v };
    }
    case 'accrualFraction': {
      const base = resolveRateRef(ref.rate, ctx, { consume });
      if (base.value === null || base.value === undefined) return { value: null };
      const state = ctx.state;
      const counted = state.accumulators[ref.countAccumulatorId] ?? 0;
      const observed = state.accumulators[ref.observedDaysAccumulatorId] ?? 0;
      const fraction = observed > 0 ? counted / observed : 0;
      if (consume && ref.resetEachPeriod !== false) {
        if (hasAccumulator(state, ref.countAccumulatorId)) state.accumulators[ref.countAccumulatorId] = 0;
        if (hasAccumulator(state, ref.observedDaysAccumulatorId)) state.accumulators[ref.observedDaysAccumulatorId] = 0;
      }
      return { value: base.value * fraction, detail: { baseRate: base.value, counted, observed, fraction } };
    }
    default:
      return { value: null };
  }
}

function resolveSelector(selector, ctx) {
  if (!selector) return [];
  if (selector.source === 'triggering') {
    return ctx.triggeringUnderlyingId ? [ctx.triggeringUnderlyingId] : [];
  }
  if (selector.source === 'measureSelection') {
    return ctx.measures[selector.measureId]?.selectedIds || [];
  }
  return [];
}

function hasAccumulator(state, id) {
  return Object.prototype.hasOwnProperty.call(state.accumulators, id);
}

export function executeActions(actions, ctx) {
  const taken = [];
  for (const action of actions || []) {
    if (ctx.state.terminated.isTerminated) break;
    const entry = executeAction(action, ctx);
    if (entry) taken.push(entry);
  }
  return taken;
}

function executeAction(action, ctx) {
  const { state, row, date } = ctx;

  switch (action.type) {
    case 'payCoupon': {
      const resolved = resolveRateRef(action.rate, ctx);
      const rate = resolved.value;
      if (rate === null || rate === undefined) return { type: action.type, skipped: true, reason: 'rate unresolved' };
      let amount = rate;
      let memoryPaid = 0;
      if (action.memory && action.accumulatorId && hasAccumulator(state, action.accumulatorId)) {
        memoryPaid = state.accumulators[action.accumulatorId];
        amount += memoryPaid;
        state.accumulators[action.accumulatorId] = 0;
      }
      if (hasAccumulator(state, 'couponsPaidTotal')) state.accumulators.couponsPaidTotal += amount;
      if (hasAccumulator(state, 'couponsPaidCount')) state.accumulators.couponsPaidCount += 1;
      state.cashflows.push({
        date: row?.paymentDate || date,
        observationDate: date,
        type: 'coupon',
        amountPct: amount,
        rate,
        memoryPaid,
        accrual: resolved.detail || null,
        source: ctx.source
      });
      return { type: action.type, amountPct: amount, rate, memoryPaid, accrual: resolved.detail || null };
    }

    case 'accrueToAccumulator': {
      const resolved = resolveRateRef(action.rate, ctx);
      const rate = resolved.value;
      if (rate === null || rate === undefined) return { type: action.type, skipped: true, reason: 'rate unresolved' };
      if (!hasAccumulator(state, action.accumulatorId)) return { type: action.type, skipped: true, reason: 'unknown accumulator' };
      state.accumulators[action.accumulatorId] += rate;
      return { type: action.type, accumulatorId: action.accumulatorId, amountPct: rate, balance: state.accumulators[action.accumulatorId] };
    }

    case 'call': {
      const level = resolveLevelRef(action.redemptionLevel, row);
      if (level === null || level === undefined) return { type: action.type, skipped: true, reason: 'redemption level unresolved' };
      let redemptionPct = level;
      for (const accId of action.plusAccumulators || []) {
        if (hasAccumulator(state, accId)) {
          redemptionPct += state.accumulators[accId];
          state.accumulators[accId] = 0;
        }
      }
      state.terminated = {
        isTerminated: true,
        cause: 'called',
        date,
        paymentDate: row?.paymentDate || date,
        redemptionPct
      };
      state.cashflows.push({
        date: row?.paymentDate || date,
        observationDate: date,
        type: 'redemption',
        amountPct: redemptionPct,
        source: ctx.source
      });
      return { type: action.type, redemptionPct };
    }

    case 'setState': {
      const reg = state.global[action.register];
      if (!reg) return { type: action.type, skipped: true, reason: `unknown register ${action.register}` };
      const changed = reg.value !== action.value;
      reg.value = action.value;
      if (changed && action.value) reg.setDate = date;
      if (changed) {
        state.history.push({ date, type: 'setState', register: action.register, value: action.value, source: ctx.source });
      }
      return { type: action.type, register: action.register, value: action.value, changed };
    }

    case 'lockUnderlying': {
      const ids = resolveSelector(action.selector, ctx);
      const locked = [];
      for (const id of ids) {
        const reg = state.perUnderlying[id];
        if (!reg || reg.locked) continue;
        let lockValue = null;
        if (action.lockValue?.source === 'fixed') lockValue = action.lockValue.value;
        else lockValue = ctx.getPerf(id); // 'observed'
        if (lockValue === null || lockValue === undefined) continue;
        reg.locked = true;
        reg.lockedValue = lockValue;
        reg.lockedDate = date;
        locked.push({ underlyingId: id, lockValue });
        state.history.push({ date, type: 'lock', underlyingId: id, value: lockValue, source: ctx.source });
      }
      return { type: action.type, locked };
    }

    case 'eliminateUnderlying': {
      const ids = resolveSelector(action.selector, ctx);
      const eliminated = [];
      for (const id of ids) {
        const reg = state.perUnderlying[id];
        if (!reg || reg.eliminated) continue;
        reg.eliminated = true;
        reg.eliminatedDate = date;
        eliminated.push(id);
        state.history.push({ date, type: 'eliminate', underlyingId: id, source: ctx.source });
      }
      return { type: action.type, eliminated };
    }

    case 'flagUnderlying': {
      const ids = resolveSelector(action.selector, ctx);
      const flagged = [];
      for (const id of ids) {
        const reg = state.perUnderlying[id];
        if (!reg || reg.flagged) continue;
        reg.flagged = true;
        reg.flaggedDate = date;
        flagged.push(id);
        state.history.push({ date, type: 'flag', underlyingId: id, source: ctx.source });
      }
      return { type: action.type, flagged };
    }

    default:
      return { type: action.type, skipped: true, reason: 'unknown action type' };
  }
}
