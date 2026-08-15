/**
 * Condition evaluation — pure.
 *
 * evaluateCondition(condition, ctx) -> true | false | null
 * null means undetermined (a referenced measure has no value at this date).
 *
 * ctx: {
 *   measures:        { [id]: { value, selectedIds } }   resolved for the current date
 *   state:           EvaluationState
 *   row:             current schedule row or null
 *   externalEvents:  [{ key, date }]
 *   date:            'YYYY-MM-DD' current evaluation point
 * }
 */

const OPS = {
  gte: (a, b) => a >= b,
  gt: (a, b) => a > b,
  lte: (a, b) => a <= b,
  lt: (a, b) => a < b
};

export function resolveLevelRef(ref, row) {
  if (!ref) return null;
  if (ref.source === 'fixed') return ref.value;
  if (ref.source === 'rowLevel') {
    const v = row?.levels?.[ref.key];
    return v === undefined ? null : v;
  }
  return null;
}

export function evaluateCondition(condition, ctx) {
  if (!condition) return null;

  switch (condition.type) {
    case 'always':
      return true;

    case 'levelTest': {
      const measure = ctx.measures[condition.measureId];
      const value = measure ? measure.value : null;
      const level = resolveLevelRef(condition.level, ctx.row);
      if (value === null || value === undefined || level === null || level === undefined) return null;
      const op = OPS[condition.op];
      return op ? op(value, level) : null;
    }

    case 'stateTest': {
      const current = !!ctx.state.global[condition.register]?.value;
      return current === !!condition.expect;
    }

    case 'countTest': {
      const reg = condition.perUnderlyingRegister;
      const count = Object.values(ctx.state.perUnderlying)
        .filter(u => (reg === 'locked' ? u.locked : reg === 'eliminated' ? u.eliminated : u.flagged))
        .length;
      const op = OPS[condition.op];
      return op ? op(count, condition.count) : null;
    }

    case 'accumulatorTest': {
      const value = ctx.state.accumulators[condition.accumulatorId];
      if (value === undefined) return null;
      const op = OPS[condition.op];
      return op ? op(value, condition.value) : null;
    }

    case 'externalEvent': {
      const cutoff = condition.occurredOnOrBefore === 'observationDate' ? ctx.date : condition.occurredOnOrBefore;
      return (ctx.externalEvents || []).some(ev =>
        ev.key === condition.key && (!cutoff || ev.date <= cutoff)
      );
    }

    case 'and': {
      let sawNull = false;
      for (const c of condition.conditions || []) {
        const r = evaluateCondition(c, ctx);
        if (r === false) return false;
        if (r === null) sawNull = true;
      }
      return sawNull ? null : true;
    }

    case 'or': {
      let sawNull = false;
      for (const c of condition.conditions || []) {
        const r = evaluateCondition(c, ctx);
        if (r === true) return true;
        if (r === null) sawNull = true;
      }
      return sawNull ? null : false;
    }

    case 'not': {
      const r = evaluateCondition(condition.condition, ctx);
      return r === null ? null : !r;
    }

    default:
      return null;
  }
}
