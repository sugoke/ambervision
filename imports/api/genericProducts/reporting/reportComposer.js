/**
 * Report composer — turns a raw engine result into a fully display-ready
 * report document. Block presence is keyed by PRIMITIVE PRESENCE in the
 * definition, never by product family. Every displayed value is formatted
 * here; UI blocks only render.
 */

import { fmtDate, fmtLevel, fmtPerf, fmtRate, fmtMoney, fmtPrice } from './formatters.js';
import { buildChartConfig } from './chartBuilder.js';

export function measureLabel(measureId, definition) {
  const m = (definition.measures || []).find(x => x.id === measureId);
  if (!m) return measureId;
  if (m.type === 'rankSelect') {
    const mode = m.mode === 'rank' ? `rank ${m.rank}` : `${m.mode}-of`;
    return `${mode} (${m.universe || 'all'})`;
  }
  if (m.type === 'aggregate') return `${m.fn} (${m.universe || 'all'})`;
  if (m.type === 'combine') return m.fn;
  return measureId;
}

function levelRefToText(ref, definition) {
  if (!ref) return '?';
  if (ref.source === 'fixed') return fmtLevel(ref.value);
  if (ref.source === 'rowLevel') return `the row's ${ref.key}`;
  return '?';
}

const OP_TEXT = { gte: 'at or above', gt: 'above', lte: 'at or below', lt: 'below' };

export function conditionToText(condition, definition) {
  if (!condition) return '?';
  switch (condition.type) {
    case 'always': return 'always';
    case 'levelTest':
      return `${measureLabel(condition.measureId, definition)} is ${OP_TEXT[condition.op] || condition.op} ${levelRefToText(condition.level, definition)}`;
    case 'stateTest':
      return `${condition.register} is ${condition.expect ? 'true' : 'false'}`;
    case 'countTest':
      return `count of ${condition.perUnderlyingRegister} underlyings is ${OP_TEXT[condition.op] || condition.op} ${condition.count}`;
    case 'accumulatorTest':
      return `${condition.accumulatorId} is ${OP_TEXT[condition.op] || condition.op} ${condition.value}`;
    case 'externalEvent':
      return `external event "${condition.key}" has occurred`;
    case 'and':
      return (condition.conditions || []).map(c => conditionToText(c, definition)).join(' AND ');
    case 'or':
      return (condition.conditions || []).map(c => conditionToText(c, definition)).join(' OR ');
    case 'not':
      return `NOT (${conditionToText(condition.condition, definition)})`;
    default:
      return condition.type;
  }
}

export function payoffToText(payoff) {
  const parts = [];
  if (payoff.base) parts.push(fmtLevel(payoff.base));
  for (const leg of payoff.legs || []) {
    let core = leg.strike ? `(level − ${fmtLevel(leg.strike)})` : 'level';
    if (leg.absolute) core = `|${core}|`;
    let text = `${((leg.gearing ?? 1) * 100).toFixed(0)}% × ${core}`;
    const clamps = [];
    if (typeof leg.floor === 'number') clamps.push(`floor ${fmtRate(leg.floor)}`);
    if (typeof leg.cap === 'number') clamps.push(`cap ${fmtRate(leg.cap)}`);
    if (clamps.length) text += ` (${clamps.join(', ')})`;
    parts.push(text);
  }
  return parts.length ? parts.join(' + ') : '0%';
}

/**
 * Row-level keys used as LEVELS (referenced by levelTest conditions) vs used
 * as RATES (referenced by payCoupon/accrue rate refs). Derived from the
 * definition — generic, no hardcoded key names.
 */
export function classifyRowLevelKeys(definition) {
  const levelKeys = new Set();
  const rateKeys = new Set();

  const walkCondition = (c) => {
    if (!c) return;
    if (c.type === 'levelTest' && c.level?.source === 'rowLevel') levelKeys.add(c.level.key);
    if (c.type === 'and' || c.type === 'or') (c.conditions || []).forEach(walkCondition);
    if (c.type === 'not') walkCondition(c.condition);
  };
  const walkRate = (r) => {
    if (!r) return;
    if (r.source === 'rowLevel') rateKeys.add(r.key);
    else if (r.source === 'accrualFraction') walkRate(r.rate);
  };
  const walkAction = (a) => {
    if (!a) return;
    if (a.type === 'payCoupon' || a.type === 'accrueToAccumulator') walkRate(a.rate);
    if (a.type === 'call' && a.redemptionLevel?.source === 'rowLevel') levelKeys.add(a.redemptionLevel.key);
  };

  for (const ev of definition.events || []) {
    walkCondition(ev.condition);
    (ev.actions || []).forEach(walkAction);
    (ev.elseActions || []).forEach(walkAction);
  }
  (definition.terminalPayoff?.branches || []).forEach(b => walkCondition(b.condition));
  return { levelKeys, rateKeys };
}

const ROW_STATUS_LABELS = {
  observed: { label: 'Observed', color: 'blue' },
  upcoming: { label: 'Upcoming', color: 'gray' },
  cancelled: { label: 'Cancelled', color: 'gray' },
  undetermined: { label: 'Undetermined', color: 'amber' }
};

function describeEventResult(er) {
  if (er.conditionMet === null) return { text: 'Undetermined (missing data)', tone: 'amber' };
  const acted = er.actionsTaken || [];
  const parts = [];
  for (const a of acted) {
    if (a.skipped) continue;
    switch (a.type) {
      case 'payCoupon': {
        let text = `Paid ${fmtRate(a.amountPct)}`;
        if (a.memoryPaid > 0) text += ` (incl. ${fmtRate(a.memoryPaid)} memory)`;
        if (a.accrual) text += ` (${fmtRate(a.accrual.baseRate)} × ${a.accrual.counted}/${a.accrual.observed} days in range)`;
        parts.push(text);
        break;
      }
      case 'accrueToAccumulator':
        parts.push(`Missed — ${fmtRate(a.amountPct)} accrued (balance ${fmtRate(a.balance)})`);
        break;
      case 'call':
        parts.push(`Called at ${fmtLevel(a.redemptionPct)}`);
        break;
      case 'setState':
        parts.push(`${a.register} → ${a.value}`);
        break;
      case 'lockUnderlying':
        parts.push((a.locked || []).map(l => `locked at ${fmtLevel(l.lockValue)}`).join(', ') || 'lock (no-op)');
        break;
      case 'eliminateUnderlying':
        parts.push((a.eliminated || []).length ? 'eliminated' : 'eliminate (no-op)');
        break;
      case 'flagUnderlying':
        parts.push((a.flagged || []).length ? 'flagged' : 'flag (no-op)');
        break;
      default:
        parts.push(a.type);
    }
  }
  if (parts.length === 0) {
    return er.conditionMet
      ? { text: 'Condition met', tone: 'green' }
      : { text: 'Condition not met', tone: 'gray' };
  }
  return { text: parts.join('; '), tone: er.conditionMet ? 'green' : 'amber' };
}

const LIFECYCLE_DISPLAY = {
  autocalled: { label: 'Called (early redemption)', color: 'green' },
  matured: { label: 'Matured', color: 'blue' },
  live: { label: 'Live', color: 'amber' }
};

export function composeReport({ product, definition, raw, series, evaluatedBy }) {
  const identity = definition.identity;
  const currency = identity.currency || 'USD';
  const { levelKeys, rateKeys } = classifyRowLevelKeys(definition);
  const underlyingById = Object.fromEntries((definition.underlyings || []).map(u => [u.id, u]));
  const tickerOf = (id) => underlyingById[id]?.ticker || id;

  const blocks = [];

  // ---- status (always) ----
  const lc = LIFECYCLE_DISPLAY[raw.lifecycle.code] || { label: raw.lifecycle.code, color: 'gray' };
  const statusProps = {
    lifecycleLabel: lc.label,
    lifecycleColor: lc.color,
    evaluationDateFormatted: fmtDate(raw.evaluationDate)
  };
  if (raw.lifecycle.code === 'autocalled') {
    statusProps.detailLines = [
      `Called on ${fmtDate(raw.lifecycle.date)} at ${fmtLevel(raw.lifecycle.redemptionPct)}`,
      `Settlement ${fmtDate(raw.state.terminated.paymentDate)}`
    ];
  } else if (raw.lifecycle.code === 'matured') {
    statusProps.detailLines = [
      `Final observation ${fmtDate(identity.finalObservationDate)}`,
      raw.terminal.applied
        ? `Redemption ${fmtLevel(raw.terminal.redemptionPct)} (${fmtMoney((raw.terminal.redemptionPct / 100) * identity.notional, currency)}) settled ${fmtDate(identity.maturityDate)}`
        : 'Redemption undetermined (missing final fixing)'
    ];
  } else {
    statusProps.detailLines = [
      `Next observation ${fmtDate(raw.lifecycle.nextObservationDate)}`,
      raw.terminal.indicative && raw.terminal.redemptionPct !== null
        ? `Indicative redemption if final were today: ${fmtLevel(raw.terminal.redemptionPct)}`
        : null
    ].filter(Boolean);
  }
  blocks.push({ type: 'status', props: statusProps });

  // ---- underlyings ----
  if ((definition.underlyings || []).length > 0) {
    blocks.push({
      type: 'underlyings',
      props: {
        rows: raw.currentUnderlyings.map(u => {
          const badges = [];
          const st = u.state || {};
          if (st.locked) badges.push({ text: `Locked at ${fmtLevel(st.lockedValue)} (${fmtDate(st.lockedDate)})`, tone: 'purple' });
          if (st.eliminated) badges.push({ text: `Eliminated ${fmtDate(st.eliminatedDate)}`, tone: 'gray' });
          if (st.flagged) badges.push({ text: `Flagged ${fmtDate(st.flaggedDate)}`, tone: 'blue' });
          return {
            ticker: u.ticker,
            name: u.name || '',
            initialFixingFormatted: fmtPrice(u.initialFixing),
            lastCloseFormatted: fmtPrice(u.lastClose),
            lastCloseDateFormatted: fmtDate(u.lastCloseDate),
            levelFormatted: fmtLevel(u.performance),
            performanceFormatted: fmtPerf(u.performance),
            isPositive: u.performance !== null ? u.performance >= 100 : null,
            badges
          };
        })
      }
    });
  }

  // ---- chart ----
  const chartConfig = buildChartConfig({ definition, raw, series, levelKeys });
  if (chartConfig) blocks.push({ type: 'chart', props: { chartConfig } });

  // ---- schedule ----
  if ((definition.schedule?.rows || []).length > 0) {
    const allLevelKeys = [...new Set((definition.schedule.rows).flatMap(r => Object.keys(r.levels || {})))];
    blocks.push({
      type: 'schedule',
      props: {
        levelColumns: allLevelKeys,
        rows: raw.rowOutcomes.map(ro => {
          const status = ROW_STATUS_LABELS[ro.status] || { label: ro.status, color: 'gray' };
          return {
            observationDateFormatted: fmtDate(ro.observationDate),
            paymentDateFormatted: fmtDate(ro.paymentDate),
            levelsFormatted: allLevelKeys.map(k => {
              const v = ro.levels?.[k];
              if (v === undefined || v === null) return '—';
              return rateKeys.has(k) && !levelKeys.has(k) ? fmtRate(v) : fmtLevel(v);
            }),
            measuresFormatted: Object.entries(ro.measures || {})
              .map(([id, v]) => `${measureLabel(id, definition)}: ${fmtLevel(v)}`)
              .join(' · '),
            statusLabel: status.label,
            statusColor: status.color,
            eventOutcomes: (ro.eventResults || []).map(er => {
              const d = describeEventResult(er);
              return { label: er.label || er.eventId, text: d.text, tone: d.tone };
            })
          };
        })
      }
    });
  }

  // ---- coupons (any payCoupon action in the definition) ----
  const hasPayCoupon = [
    ...(definition.events || []).flatMap(e => [...(e.actions || []), ...(e.elseActions || [])]),
    ...((definition.schedule?.monitors || []).flatMap(m => m.onTrigger || []))
  ].some(a => a.type === 'payCoupon');
  if (hasPayCoupon) {
    const couponFlows = raw.cashflows.filter(c => c.type === 'coupon');
    const totalPct = couponFlows.reduce((s, c) => s + c.amountPct, 0);
    blocks.push({
      type: 'coupons',
      props: {
        totalFormatted: fmtRate(totalPct),
        totalMoneyFormatted: fmtMoney((totalPct / 100) * identity.notional, currency),
        countText: `${couponFlows.length} coupon${couponFlows.length === 1 ? '' : 's'} paid`,
        rows: couponFlows.map(c => ({
          observationDateFormatted: fmtDate(c.observationDate),
          paymentDateFormatted: fmtDate(c.date),
          amountFormatted: fmtRate(c.amountPct),
          moneyFormatted: fmtMoney((c.amountPct / 100) * identity.notional, currency),
          memoryNote: c.memoryPaid > 0
            ? `incl. ${fmtRate(c.memoryPaid)} memory`
            : c.accrual
              ? `${fmtRate(c.accrual.baseRate)} × ${c.accrual.counted}/${c.accrual.observed} days`
              : ''
        }))
      }
    });
  }

  // ---- barrier (any monitor, or any global register enabled) ----
  if ((definition.schedule?.monitors || []).length > 0) {
    blocks.push({
      type: 'barrier',
      props: {
        monitors: raw.monitorOutcomes.map(mo => {
          if (mo.mode === 'count') {
            const rangeText = ['inside', 'outside'].includes(mo.direction)
              ? `${mo.direction} [${fmtLevel(mo.level)}, ${fmtLevel(mo.levelHigh)}]`
              : `${mo.direction} ${fmtLevel(mo.level)}`;
            return {
              mode: 'count',
              title: `Accrual counter — days ${rangeText}`,
              styleText: `Daily count, ${fmtDate(mo.window.from)} → ${fmtDate(mo.window.to)}`,
              statusText: `${mo.counted} of ${mo.observed} observed days in range`,
              triggered: false,
              triggerLines: [],
              closestApproachText: '—'
            };
          }
          return {
            title: `${mo.direction === 'below' ? 'Lower' : 'Upper'} barrier at ${fmtLevel(mo.level)}`,
            styleText: `American (continuous), ${fmtDate(mo.window.from)} → ${fmtDate(mo.window.to)}`,
            scopeText: mo.scope === 'measure' ? 'on the basket measure' : 'per underlying',
            triggered: mo.triggered,
            statusText: mo.triggered
              ? `TOUCHED — first on ${fmtDate(mo.triggers[0]?.date)}${mo.triggers[0]?.underlyingId ? ` by ${tickerOf(mo.triggers[0].underlyingId)}` : ''}`
              : 'Not touched',
            triggerLines: mo.triggers.map(t =>
              `${fmtDate(t.date)}${t.underlyingId ? ` — ${tickerOf(t.underlyingId)}` : ''} at ${fmtLevel(t.value)}`
            ),
            closestApproachText: mo.closestApproach
              ? `${fmtLevel(mo.closestApproach.value)} on ${fmtDate(mo.closestApproach.date)}${mo.closestApproach.underlyingId ? ` (${tickerOf(mo.closestApproach.underlyingId)})` : ''}`
              : '—'
          };
        })
      }
    });
  }

  // ---- state registers (per-underlying registers enabled) ----
  const perU = definition.stateRegisters?.perUnderlying || {};
  const anyPerURegister = Object.values(perU).some(r => r?.enabled);
  if (anyPerURegister || (raw.state.history || []).length > 0) {
    if ((raw.state.history || []).length > 0) {
      blocks.push({
        type: 'stateRegisters',
        props: {
          entries: raw.state.history.map(h => {
            switch (h.type) {
              case 'lock': return `${fmtDate(h.date)} — ${tickerOf(h.underlyingId)} locked at ${fmtLevel(h.value)}`;
              case 'eliminate': return `${fmtDate(h.date)} — ${tickerOf(h.underlyingId)} eliminated from the basket`;
              case 'flag': return `${fmtDate(h.date)} — ${tickerOf(h.underlyingId)} flagged`;
              case 'setState': return `${fmtDate(h.date)} — ${h.register} set to ${h.value}`;
              default: return `${fmtDate(h.date)} — ${h.type}`;
            }
          })
        }
      });
    }
  }

  // ---- accumulators ----
  if ((definition.stateRegisters?.accumulators || []).length > 0) {
    blocks.push({
      type: 'accumulators',
      props: {
        rows: (definition.stateRegisters.accumulators).map(acc => ({
          id: acc.id,
          valueFormatted: fmtRate(raw.state.accumulators[acc.id] ?? 0)
        }))
      }
    });
  }

  // ---- payoff (always) ----
  blocks.push({
    type: 'payoff',
    props: {
      inputLabel: measureLabel(definition.terminalPayoff?.inputMeasureId, definition),
      inputValueFormatted: raw.terminal.inputValue !== null ? fmtLevel(raw.terminal.inputValue) : '—',
      isApplied: raw.terminal.applied,
      isIndicative: raw.terminal.indicative,
      redemptionFormatted: raw.terminal.redemptionPct !== null ? fmtLevel(raw.terminal.redemptionPct) : '—',
      redemptionMoneyFormatted: raw.terminal.redemptionPct !== null
        ? fmtMoney((raw.terminal.redemptionPct / 100) * identity.notional, currency) : '—',
      wasCalled: raw.lifecycle.code === 'autocalled',
      branches: (definition.terminalPayoff?.branches || []).map((b, i) => ({
        conditionText: b.condition?.type === 'always' ? 'Otherwise' : `If ${conditionToText(b.condition, definition)}`,
        payoffText: payoffToText(b.payoff),
        isActive: raw.terminal.branchIndex === i
      }))
    }
  });

  // ---- issues ----
  if ((raw.issues || []).length > 0) {
    blocks.push({
      type: 'issues',
      props: {
        rows: raw.issues.map(i => ({ severity: i.severity, message: i.message }))
      }
    });
  }

  // ---- json definition (always) ----
  blocks.push({ type: 'jsonDefinition', props: { json: JSON.stringify(definition, null, 2) } });

  return {
    productId: product._id,
    productName: product.name,
    isin: identity.isin || null,
    evaluationDate: raw.evaluationDate,
    evaluationDateFormatted: fmtDate(raw.evaluationDate),
    evaluatedBy,
    header: {
      name: product.name,
      isinFormatted: identity.isin || '—',
      issuer: identity.issuer || '—',
      currency,
      notionalFormatted: fmtMoney(identity.notional, currency),
      tradeDateFormatted: fmtDate(identity.tradeDate),
      valueDateFormatted: fmtDate(identity.valueDate),
      finalObservationFormatted: fmtDate(identity.finalObservationDate),
      maturityDateFormatted: fmtDate(identity.maturityDate),
      settlementLabel: identity.settlement === 'physical' ? 'Physical settlement' : 'Cash settlement'
    },
    lifecycle: {
      code: raw.lifecycle.code,
      label: lc.label,
      color: lc.color
    },
    blocks,
    definitionSnapshot: definition,
    rawSummary: {
      cashflowCount: raw.cashflows.length,
      issueCount: raw.issues.length
    },
    createdAt: new Date(),
    version: '1.0.0'
  };
}
