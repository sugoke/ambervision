import { PhoenixChartBuilder } from './phoenixChartBuilder';

/**
 * Athena Chart Builder
 *
 * Underlyings rebased to 100 on the evaluator's initial levels, the autocall level per
 * observation (step-down), the final payoff tier boundaries, observation lines labelled
 * with each date's redemption amount, and the autocall / maturity event.
 */
const COLORS = ['#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a855f7', '#22c55e', '#ef4444'];
const TIER_COLORS = ['#10b981', '#f59e0b', '#ef4444', '#b91c1c'];

const iso = (d) => new Date(d).toISOString().split('T')[0];

export const AthenaChartBuilder = {
  async generateChartData(product, evaluation) {
    const structure = evaluation.athenaStructure || {};
    const underlyings = evaluation.underlyings || [];
    const observationAnalysis = evaluation.observationAnalysis || {};
    const observations = observationAnalysis.observations || [];

    const tradeDate = new Date(product.tradeDate || product.issueDate);
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const today = new Date();

    const labels = [];
    for (const d = new Date(tradeDate); d <= maturityDate; d.setDate(d.getDate() + 1)) {
      labels.push(iso(d));
    }

    const datasets = [];
    for (const [index, u] of underlyings.entries()) {
      const data = await PhoenixChartBuilder.generateRebasedStockData(
        u.fullTicker || `${u.ticker}.US`,
        tradeDate,
        maturityDate,
        today,
        u.performance || 0,
        u.effectiveInitialPrice || u.initialPrice
      );
      datasets.push({
        label: `${u.ticker} (${u.name})`,
        data,
        borderColor: COLORS[index % COLORS.length],
        backgroundColor: 'transparent',
        borderWidth: 3,
        fill: false,
        pointRadius: 0,
        tension: 0.1,
        isPercentage: true,
        order: 1
      });
    }

    // Autocall level, held from each callable observation until the next one
    const scheduleDates = (product.observationSchedule || []).map(o => iso(o.observationDate));
    const autocallData = [];
    scheduleDates.forEach((date, i) => {
      const obs = observations.find(o => iso(o.observationDate) === date);
      if (!obs || !obs.isCallable || obs.autocallLevel === null) return;
      autocallData.push({ x: date, y: obs.autocallLevel });
      const nextDate = scheduleDates[i + 1];
      if (nextDate) {
        const dayBefore = new Date(nextDate);
        dayBefore.setDate(dayBefore.getDate() - 1);
        autocallData.push({ x: iso(dayBefore), y: obs.autocallLevel });
      }
    });
    if (autocallData.length > 0) {
      datasets.push({
        label: 'Autocall Level',
        data: autocallData,
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.15)',
        borderWidth: 2.5,
        borderDash: [8, 4],
        fill: 'origin',
        pointRadius: 0,
        tension: 0,
        stepped: 'before',
        order: 2,
        _needsGradient: true,
        _gradientType: 'autocall'
      });
    }

    // Final payoff tier boundaries
    const tierLevels = [];
    (structure.tiers || []).forEach((tier, i) => {
      if (!(tier.fromLevel > 0)) return;
      tierLevels.push(tier.fromLevel);
      // The boundary the capital is at risk below is shaded down to the axis
      const isRiskBoundary = tier.fromLevel === structure.capitalAtRiskLevel;
      datasets.push({
        label: `Final ${tier.rangeLabel} → ${tier.formulaLabel}`,
        data: labels.map(x => ({ x, y: tier.fromLevel })),
        borderColor: TIER_COLORS[Math.min(i, TIER_COLORS.length - 1)],
        backgroundColor: isRiskBoundary ? 'rgba(239, 68, 68, 0.10)' : 'transparent',
        borderWidth: 2,
        borderDash: [8, 4],
        fill: isRiskBoundary ? 'origin' : false,
        pointRadius: 0,
        tension: 0,
        order: 3
      });
    });

    const annotations = {
      initial_level: {
        type: 'line',
        yMin: 100,
        yMax: 100,
        borderColor: '#94a3b8',
        borderWidth: 1,
        borderDash: [3, 3],
        label: { display: true, content: 'Initial Level (100%)', position: 'end', backgroundColor: '#94a3b8', color: '#ffffff', padding: 4, font: { size: 9 } }
      }
    };

    observations.forEach((obs, index) => {
      const date = iso(obs.observationDate);
      const content = obs.isFinal
        ? 'Final'
        : obs.isCallable ? `Obs ${obs.periodNumber} · ${obs.redemptionAmountFormatted}` : `Obs ${obs.periodNumber}`;
      annotations[`observation_${index}`] = {
        type: 'line',
        xMin: date,
        xMax: date,
        borderColor: obs.isFinal ? '#ef4444' : obs.isCallable ? '#10b981' : '#94a3b8',
        borderWidth: 2,
        borderDash: obs.isFinal ? [] : [5, 5],
        label: {
          display: true,
          content,
          position: 'start',
          yAdjust: -10,
          backgroundColor: obs.isFinal ? '#ef4444' : obs.isCallable ? '#10b981' : '#94a3b8',
          color: '#ffffff',
          padding: 4,
          font: { size: 10 }
        }
      };
    });

    if (observationAnalysis.isEarlyAutocall && observationAnalysis.callDate) {
      const callIso = iso(observationAnalysis.callDate);
      const callIndex = labels.indexOf(callIso);
      const callObs = observations.find(o => o.autocalled);
      annotations.redemption_line = {
        type: 'line',
        xMin: callIso,
        xMax: callIso,
        borderColor: '#fbbf24',
        borderWidth: 3,
        borderDash: [5, 5],
        label: { display: true, content: 'REDEEMED', position: 'start', yAdjust: -10, backgroundColor: '#fbbf24', color: '#000000', padding: 6, font: { size: 11, weight: 'bold' }, borderRadius: 4 }
      };
      if (callObs && callIndex !== -1) {
        annotations.autocall_event = {
          type: 'point',
          xValue: callIndex,
          yValue: Math.max(100 + (callObs.basketPerformance || 0), (callObs.autocallLevel || 100) + 5),
          backgroundColor: '#fbbf24',
          borderColor: '#ffffff',
          borderWidth: 3,
          radius: 12,
          label: { display: true, content: `AUTOCALL at ${callObs.redemptionAmountFormatted}`, position: 'top', yAdjust: -25, backgroundColor: '#fbbf24', color: '#000000', padding: 8, font: { size: 12, weight: 'bold' }, borderRadius: 6 }
        };
      }
    } else if (observationAnalysis.isMaturedAtFinal) {
      const finalObs = observations[observations.length - 1];
      if (finalObs) {
        const finalIso = iso(finalObs.observationDate);
        annotations.redemption_line = {
          type: 'line',
          xMin: finalIso,
          xMax: finalIso,
          borderColor: '#6366f1',
          borderWidth: 3,
          borderDash: [5, 5],
          label: { display: true, content: `MATURED · ${finalObs.redemptionAmountFormatted}`, position: 'start', yAdjust: -10, backgroundColor: '#6366f1', color: '#ffffff', padding: 6, font: { size: 11, weight: 'bold' }, borderRadius: 4 }
        };
      }
    }

    // Y range: every series, plus room below the lowest tier boundary
    let minY = 100;
    let maxY = 100;
    datasets.forEach(ds => {
      (ds.data || []).forEach(p => {
        if (p && typeof p.y === 'number') {
          minY = Math.min(minY, p.y);
          maxY = Math.max(maxY, p.y);
        }
      });
    });
    if (tierLevels.length) minY = Math.min(minY, Math.min(...tierLevels) - 10);
    const yRange = maxY - minY;
    minY = Math.max(0, Math.floor(minY - yRange * 0.05));
    maxY = Math.ceil(maxY + yRange * 0.1);

    const title = `${product.title || 'Athena'} - Performance Chart`;

    return {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: { display: true, text: title, font: { size: 16, weight: 'bold' }, color: '#ffffff' },
          legend: { display: true, position: 'top', labels: { usePointStyle: true, padding: 15, color: '#ffffff', font: { size: 11 } } },
          annotation: { annotations }
        },
        scales: {
          x: {
            type: 'category',
            grid: { display: true, color: 'rgba(209, 213, 219, 0.2)', drawBorder: false },
            ticks: { maxRotation: 45, minRotation: 0, color: 'rgba(148, 163, 184, 0.8)', font: { size: 11 }, maxTicksLimit: 12 }
          },
          y: {
            type: 'linear',
            beginAtZero: false,
            min: minY,
            max: maxY,
            grid: { display: true, color: 'rgba(209, 213, 219, 0.2)', drawBorder: false },
            ticks: { color: 'rgba(148, 163, 184, 0.8)', font: { size: 11 } }
          }
        }
      },
      metadata: {
        productId: product._id,
        chartTitle: title,
        chartType: 'athena_performance',
        generatedAt: new Date().toISOString()
      }
    };
  }
};
