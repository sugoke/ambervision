import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Bonus Certificate Chart Builder
 *
 * Renders:
 *   - Each underlying as a rebased line (100 at trade date)
 *   - Worst-of / Best-of / Average reference line (if N > 1)
 *   - Horizontal lines: knock-in threshold, strike, bonus floor, cap (if enabled)
 *   - Vertical annotations: Launch, Final Observation, Maturity
 */
export const BonusCertificateChartBuilder = {
  async generateChartData(product, evaluation) {
    const params = evaluation.bonusCertificateStructure || {};
    const underlyingData = evaluation.underlyings || [];

    const tradeDate = new Date(product.tradeDate || product.valueDate || new Date());
    const maturityDate = new Date(product.maturity || product.maturityDate || tradeDate);
    const finalObservationDate = product.finalObservation || product.finalObservationDate
      ? new Date(product.finalObservation || product.finalObservationDate)
      : maturityDate;
    const today = new Date();

    // Generate daily date labels from trade date to maturity
    const labels = [];
    const cursor = new Date(tradeDate);
    while (cursor <= maturityDate) {
      labels.push(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }

    const datasets = [];
    const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
    const allUnderlyingSeries = [];

    if (underlyingData.length > 0) {
      for (let i = 0; i < underlyingData.length; i++) {
        const u = underlyingData[i];
        let performanceData = await this.generateRebasedStockData(
          u.fullTicker || `${u.ticker}.US`,
          tradeDate,
          maturityDate,
          today,
          u.initialPrice
        );

        // Fallback when EOD historical data is missing (e.g. Korean exchange
        // returns placeholders): synthesize a 2-point series from launch to
        // today using the evaluator's current price, so the user still sees
        // a visible line and the current performance.
        const todayStr = today.toISOString().split('T')[0];
        const hasRealHistory = performanceData.some(p => p.x > performanceData[0]?.x);
        if (!hasRealHistory && u.currentPrice && u.initialPrice && u.initialPrice > 0) {
          const currentPerf = (u.currentPrice / u.initialPrice) * 100;
          performanceData = [
            { x: tradeDate.toISOString().split('T')[0], y: 100 },
            { x: todayStr, y: currentPerf }
          ];
        }

        allUnderlyingSeries.push({ ticker: u.ticker, data: performanceData });

        // If we have only 1-2 points, show markers so the line is visible.
        const usePoints = performanceData.length <= 2;

        datasets.push({
          label: u.ticker,
          data: performanceData,
          borderColor: colors[i % colors.length],
          backgroundColor: 'transparent',
          borderWidth: underlyingData.length === 1 ? 3 : 2.5,
          fill: false,
          pointRadius: usePoints ? 4 : 0,
          pointBackgroundColor: colors[i % colors.length],
          tension: 0.1,
          isPercentage: true,
          order: 1
        });
      }

      // Basket reference (only if N > 1)
      if (underlyingData.length > 1) {
        const basketSeries = this.aggregateBasketSeries(allUnderlyingSeries, params.basketType);
        datasets.push({
          label: `${this.basketLineLabel(params.basketType)} Reference`,
          data: basketSeries,
          borderColor: '#6b7280',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [8, 4],
          fill: false,
          pointRadius: 0,
          tension: 0.1,
          isPercentage: true,
          order: 2
        });
      }
    }

    const barrierLevel = params.barrierLevel ?? 60;
    const strikeLevel = params.strikeLevel ?? 100;
    const bonusLevel = params.bonusLevel ?? 100;

    // Knock-in threshold (red dashed)
    datasets.push({
      label: `Knock-In Threshold (${barrierLevel.toFixed(0)}%)`,
      data: labels.map(date => ({ x: date, y: barrierLevel })),
      borderColor: '#ef4444',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0,
      isPercentage: true,
      order: 3
    });

    // Strike level (gray dotted)
    datasets.push({
      label: `Strike (${strikeLevel.toFixed(0)}%)`,
      data: labels.map(date => ({ x: date, y: strikeLevel })),
      borderColor: '#6b7280',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [2, 2],
      fill: false,
      pointRadius: 0,
      isPercentage: true,
      order: 4
    });

    // Bonus floor (green dashed) — only show if it differs from strike
    if (bonusLevel !== strikeLevel) {
      datasets.push({
        label: `Bonus Floor (${bonusLevel.toFixed(0)}%)`,
        data: labels.map(date => ({ x: date, y: bonusLevel })),
        borderColor: '#10b981',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [4, 4],
        fill: false,
        pointRadius: 0,
        isPercentage: true,
        order: 4
      });
    }

    // Cap line (blue dashed) — only when cap is enabled
    if (params.capEnabled && params.cap !== null && params.cap !== undefined) {
      const capRedemption = 100 + params.cap;
      datasets.push({
        label: `Cap (max redemption ${capRedemption.toFixed(0)}%)`,
        data: labels.map(date => ({ x: date, y: capRedemption })),
        borderColor: '#3b82f6',
        backgroundColor: 'transparent',
        borderWidth: 2,
        borderDash: [4, 4],
        fill: false,
        pointRadius: 0,
        isPercentage: true,
        order: 4
      });
    }

    const finalObsIdx = Math.max(0, labels.indexOf(finalObservationDate.toISOString().split('T')[0]));

    const annotations = {
      tradeDate: {
        type: 'line',
        xMin: 0, xMax: 0,
        borderColor: '#374151',
        borderWidth: 2,
        label: {
          content: 'Launch', display: true, position: 'start',
          backgroundColor: '#374151', color: 'white',
          font: { size: 10, weight: 'bold' }
        }
      },
      finalObservation: {
        type: 'line',
        xMin: finalObsIdx, xMax: finalObsIdx,
        borderColor: '#6b7280',
        borderWidth: 2,
        label: {
          content: 'Final Observation', display: true, position: 'center',
          backgroundColor: '#6b7280', color: 'white',
          font: { size: 10, weight: 'bold' }
        }
      },
      maturityDate: {
        type: 'line',
        xMin: labels.length - 1, xMax: labels.length - 1,
        borderColor: '#374151',
        borderWidth: 2,
        label: {
          content: 'Maturity', display: true, position: 'end',
          backgroundColor: '#374151', color: 'white',
          font: { size: 10, weight: 'bold' }
        }
      }
    };

    // y-axis range: force visibility of KI threshold and cap. Use `min`/`max`
    // (not `suggestedMin`/`suggestedMax`) so Chart.js doesn't crop the threshold
    // line off-screen when stock data stays above 100.
    const yMin = Math.max(0, Math.min(barrierLevel - 15, 30));
    const capCeiling = params.capEnabled && params.cap !== null && params.cap !== undefined
      ? 100 + params.cap + 15
      : strikeLevel + 30;
    const yMax = Math.max(capCeiling, strikeLevel + 30);

    return {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: {
            display: true,
            text: `${product.title || 'Bonus Certificate'} - Performance Evolution`,
            font: { size: 16, weight: 'bold' },
            color: '#e5e7eb'
          },
          legend: {
            display: true,
            position: 'bottom',
            labels: { usePointStyle: true, padding: 15, font: { size: 11 } }
          },
          tooltip: {
            enabled: true,
            callbacks: {
              label(context) {
                let label = context.dataset.label || '';
                if (label) label += ': ';
                if (context.parsed.y !== null) label += context.parsed.y.toFixed(2) + '%';
                return label;
              }
            }
          },
          annotation: { annotations }
        },
        scales: {
          x: {
            type: 'category',
            title: { display: true, text: 'Date', font: { size: 12, weight: 'bold' } },
            ticks: { maxRotation: 45, minRotation: 45, autoSkip: true, maxTicksLimit: 12 },
            grid: { display: true, color: 'rgba(209, 213, 219, 0.2)', drawBorder: false }
          },
          y: {
            title: { display: true, text: 'Performance (%)', font: { size: 12, weight: 'bold' } },
            ticks: { callback: (v) => v.toFixed(0) + '%' },
            grid: { display: true, color: 'rgba(209, 213, 219, 0.2)', drawBorder: false },
            min: yMin,
            max: yMax
          }
        }
      },
      metadata: {
        productId: product._id,
        productTitle: product.title || product.productName || 'Bonus Certificate',
        chartTitle: `${product.title || 'Bonus Certificate'} - Performance Evolution`,
        chartType: 'bonus_certificate_performance',
        tradeDate: tradeDate.toISOString().split('T')[0],
        finalObservationDate: finalObservationDate.toISOString().split('T')[0],
        maturityDate: maturityDate.toISOString().split('T')[0],
        evaluationDate: new Date().toISOString(),
        hasMatured: new Date() >= maturityDate,
        strikeLevel,
        bonusLevel,
        barrierLevel,
        barrierType: params.barrierType,
        participationRate: params.participationRate,
        capEnabled: params.capEnabled,
        cap: params.cap,
        basketType: params.basketType,
        dataPoints: labels.length,
        underlyingCount: underlyingData.length,
        generatedAt: new Date().toISOString(),
        version: '1.0.0'
      }
    };
  },

  basketLineLabel(basketType) {
    switch ((basketType || 'worst_of').toLowerCase()) {
      case 'best_of': return 'Best-of';
      case 'average': return 'Average';
      case 'single': return 'Single';
      case 'worst_of':
      default: return 'Worst-of';
    }
  },

  /**
   * Aggregate per-date basket performance across series.
   * Mirrors RC's calculateWorstOfPerformance but generic over basket type.
   */
  aggregateBasketSeries(allUnderlyingSeries, basketType) {
    if (allUnderlyingSeries.length === 0) return [];

    const dateMap = new Map();
    for (const s of allUnderlyingSeries) {
      for (const point of s.data) {
        if (!dateMap.has(point.x)) dateMap.set(point.x, []);
        dateMap.get(point.x).push(point.y);
      }
    }

    const aggregate = (values) => {
      switch ((basketType || 'worst_of').toLowerCase()) {
        case 'best_of': return Math.max(...values);
        case 'average': return values.reduce((s, v) => s + v, 0) / values.length;
        case 'single': return values[0];
        case 'worst_of':
        default: return Math.min(...values);
      }
    };

    const out = [];
    const sortedDates = Array.from(dateMap.keys()).sort();
    for (const date of sortedDates) {
      const values = dateMap.get(date);
      if (values.length === allUnderlyingSeries.length) {
        out.push({ x: date, y: aggregate(values) });
      }
    }
    return out;
  },

  /**
   * Generate rebased stock series (mirrors RC chart builder).
   */
  async generateRebasedStockData(ticker, startDate, endDate, currentDate, strikePrice = null) {
    try {
      let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: ticker });
      if (!cacheDoc) {
        const symbol = ticker.split('.')[0];
        for (const ex of ['US', 'PA', 'DE', 'LSE', 'CO']) {
          cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: `${symbol}.${ex}` });
          if (cacheDoc) break;
        }
      }
      if (!cacheDoc || !cacheDoc.history || cacheDoc.history.length === 0) return [];

      const history = [...cacheDoc.history].sort((a, b) => new Date(a.date) - new Date(b.date));
      const startDateStr = startDate.toISOString().split('T')[0];
      const endDateStr = endDate.toISOString().split('T')[0];
      const currentDateStr = currentDate.toISOString().split('T')[0];

      let initialPrice = strikePrice;
      if (!initialPrice) {
        for (const day of history) {
          const ds = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];
          if (ds >= startDateStr) { initialPrice = day.close; break; }
        }
        if (!initialPrice && history.length > 0) initialPrice = history[0].close;
      }
      if (!initialPrice) return [];

      const data = [{ x: startDateStr, y: 100 }];
      for (const day of history) {
        const ds = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];
        if (ds <= startDateStr) continue;
        if (ds > currentDateStr) break;
        if (ds > endDateStr) break;
        // Skip EOD placeholder values (e.g. 999999.9999) used when data isn't
        // really available for that day. These would otherwise cause spurious
        // dips/spikes in the rebased line.
        if (day.close == null || day.close === 0 || day.close >= 999999) continue;
        data.push({ x: ds, y: (day.close / initialPrice) * 100 });
      }
      return data;
    } catch (error) {
      console.error(`[Bonus Certificate Chart] Error generating data for ${ticker}:`, error);
      return [];
    }
  }
};
