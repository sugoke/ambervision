/**
 * Chart builder — emits a complete, JSON-serializable Chart.js config that is
 * embedded in the report document (no chartData collection write, no
 * functions). The client GenericChart component renders it as-is.
 *
 * Content is derived purely from the definition + engine result:
 *  - one rebased performance line per underlying (100 = initial)
 *  - one dashed horizontal line per barrier monitor
 *  - one stepped dashed line per row-level key used as a LEVEL (autocall
 *    ladders, coupon barriers — detected from the conditions, not by name)
 *  - point annotations for coupons paid, locks, eliminations, KI touches
 *  - vertical lines at launch, evaluation date, final observation
 */

const PALETTE = ['#0ea5e9', '#8b5cf6', '#f59e0b', '#10b981', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];
const LEVEL_LINE_COLORS = ['#ef4444', '#22c55e', '#eab308', '#a855f7', '#64748b'];
const MAX_POINTS = 800;

export function buildChartConfig({ definition, raw, series, levelKeys }) {
  const identity = definition.identity;
  const underlyings = definition.underlyings || [];
  if (underlyings.length === 0) return null;

  const startDate = identity.valueDate;
  const terminatedDate = raw.state.terminated.isTerminated ? raw.state.terminated.date : null;
  const dataEnd = terminatedDate || (raw.evaluationDate < identity.finalObservationDate ? raw.evaluationDate : identity.finalObservationDate);

  // Union of trading dates in range
  const dateSet = new Set();
  for (const u of underlyings) {
    for (const bar of series[u.id] || []) {
      if (bar.date >= startDate && bar.date <= dataEnd) dateSet.add(bar.date);
    }
  }
  if (dateSet.size === 0) return null;

  // Extend the axis with upcoming observation dates so remaining time is visible
  const importantDates = new Set();
  for (const row of definition.schedule?.rows || []) {
    if (row.observationDate >= startDate) {
      importantDates.add(row.observationDate);
      if (row.observationDate > dataEnd && !terminatedDate) dateSet.add(row.observationDate);
    }
  }
  if (!terminatedDate && identity.finalObservationDate > dataEnd) dateSet.add(identity.finalObservationDate);
  for (const h of raw.state.history || []) importantDates.add(h.date);
  for (const c of raw.cashflows || []) if (c.observationDate) importantDates.add(c.observationDate);

  let labels = [...dateSet].sort();
  if (labels.length > MAX_POINTS) {
    const step = Math.ceil(labels.length / MAX_POINTS);
    labels = labels.filter((d, i) => i % step === 0 || importantDates.has(d) || i === labels.length - 1);
  }
  const labelIndex = new Map(labels.map((d, i) => [d, i]));

  // ---- Underlying performance lines ----
  const datasets = underlyings.map((u, i) => {
    const isLevel = u.basis === 'level';
    const byDate = new Map((series[u.id] || []).map(b => [b.date, isLevel ? b.close : (b.close / u.initialFixing) * 100]));
    return {
      label: u.ticker || u.id,
      data: labels.map(d => {
        const v = byDate.get(d);
        return v === undefined ? null : Math.round(v * 100) / 100;
      }),
      borderColor: PALETTE[i % PALETTE.length],
      backgroundColor: PALETTE[i % PALETTE.length] + '20',
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 3,
      spanGaps: true,
      tension: 0.1,
      fill: false
    };
  });

  // ---- Barrier monitor lines ----
  let levelColorIdx = 0;
  const barrierLine = (label, level, color) => {
    datasets.push({
      label,
      data: labels.map(() => level),
      borderColor: color,
      borderDash: [6, 6],
      borderWidth: 1.5,
      pointRadius: 0,
      fill: false
    });
    levelColorIdx++;
  };
  for (const mon of definition.schedule?.monitors || []) {
    if ((mon.mode || 'trigger') === 'count' && ['inside', 'outside'].includes(mon.direction)) {
      // Range accrual: draw both bounds of the accrual corridor
      barrierLine(`Accrual low (${mon.level})`, mon.level, '#22c55e');
      barrierLine(`Accrual high (${mon.levelHigh})`, mon.levelHigh, '#22c55e');
    } else {
      const color = mon.direction === 'below' ? '#ef4444' : '#22c55e';
      barrierLine(`${mon.direction === 'below' ? 'Lower' : 'Upper'} barrier (${mon.level})`, mon.level, color);
    }
  }

  // ---- Stepped level ladders from schedule rows (generic: keys used as levels) ----
  const rows = (definition.schedule?.rows || []).slice().sort((a, b) => (a.observationDate < b.observationDate ? -1 : 1));
  for (const key of levelKeys || []) {
    const rowsWithKey = rows.filter(r => typeof r.levels?.[key] === 'number');
    if (rowsWithKey.length === 0) continue;
    const color = LEVEL_LINE_COLORS[levelColorIdx % LEVEL_LINE_COLORS.length];
    levelColorIdx++;
    datasets.push({
      label: key,
      data: labels.map(d => {
        // level applicable at date d = level of the next observation on/after d
        const next = rowsWithKey.find(r => r.observationDate >= d);
        return next ? next.levels[key] : null;
      }),
      borderColor: color,
      borderDash: [3, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      stepped: true,
      spanGaps: false,
      fill: false
    });
  }

  // ---- Annotations ----
  const annotations = {};
  const addVLine = (id, date, text, color) => {
    const idx = labelIndex.get(date);
    if (idx === undefined) return;
    annotations[id] = {
      type: 'line', xMin: idx, xMax: idx,
      borderColor: color, borderWidth: 1, borderDash: [2, 3],
      label: { display: true, content: text, position: 'start', backgroundColor: color, color: '#ffffff', font: { size: 10 } }
    };
  };
  addVLine('launch', labels[0], 'Launch', '#64748b');
  if (!terminatedDate) {
    const evalIdx = labels.filter(d => d <= raw.evaluationDate).length - 1;
    if (evalIdx >= 0 && raw.evaluationDate < identity.finalObservationDate) {
      addVLine('evaluation', labels[evalIdx], 'Today', '#0ea5e9');
    }
    addVLine('final', identity.finalObservationDate, 'Final', '#94a3b8');
  } else {
    addVLine('called', terminatedDate, 'Called', '#10b981');
  }

  let pointIdx = 0;
  const addPoint = (date, yValue, color, content) => {
    const idx = labelIndex.get(date);
    if (idx === undefined || yValue === null || yValue === undefined) return;
    annotations[`pt_${pointIdx++}`] = {
      type: 'point', xValue: idx, yValue: Math.round(yValue * 100) / 100,
      backgroundColor: color, borderColor: '#ffffff', borderWidth: 1, radius: 5,
      label: { display: false, content }
    };
  };

  // Coupons paid: point at the observation-date measure level of that row
  const rowByDate = new Map(raw.rowOutcomes.map(ro => [ro.observationDate, ro]));
  for (const c of raw.cashflows || []) {
    if (c.type !== 'coupon') continue;
    const ro = rowByDate.get(c.observationDate);
    const y = ro ? Object.values(ro.measures || {})[0] : null;
    addPoint(c.observationDate, y ?? 102, '#10b981', `Coupon ${c.amountPct}%`);
  }
  // Locks / eliminations / state flips
  for (const h of raw.state.history || []) {
    if (h.type === 'lock') addPoint(h.date, h.value, '#a855f7', 'Lock');
    else if (h.type === 'setState' && h.value) {
      const mo = (raw.monitorOutcomes || []).find(m => m.triggers.some(t => t.date === h.date));
      addPoint(h.date, mo ? mo.level : null, '#ef4444', h.register);
    }
  }

  return {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      backgroundColor: '#0f172a',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#cbd5e1', boxWidth: 18, font: { size: 11 } } },
        annotation: { annotations },
        tooltip: { backgroundColor: '#1e293b', titleColor: '#f1f5f9', bodyColor: '#cbd5e1' }
      },
      scales: {
        x: {
          ticks: { color: '#94a3b8', maxTicksLimit: 12, maxRotation: 0, font: { size: 10 } },
          grid: { color: 'rgba(148, 163, 184, 0.08)' }
        },
        y: {
          title: { display: true, text: 'Level (% of initial)', color: '#94a3b8', font: { size: 11 } },
          ticks: { color: '#94a3b8', font: { size: 10 } },
          grid: { color: 'rgba(148, 163, 184, 0.08)' }
        }
      }
    }
  };
}
