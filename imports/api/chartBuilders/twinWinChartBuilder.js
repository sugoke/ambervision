import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Twin Win Chart Builder
 *
 * Generates a performance-evolution chart for Twin Win products:
 *  - Rebased underlying / basket performance line(s)
 *  - Upper Barrier line (UB%)
 *  - Lower Barrier line (LB%)
 *  - Capital Protection line (100%)
 *  - Bonus floor line (CP + Bonus%)
 *  - Point markers for upper / lower barrier touch events
 */
export const TwinWinChartBuilder = {
  async generateChartData(product, evaluation) {
    const params = evaluation.twinWinStructure || {};
    const barriers = evaluation.barriers || {};
    const underlyingData = evaluation.underlyings || [];

    const tradeDate = new Date(product.tradeDate || product.valueDate || '2024-02-02');
    const maturityDate = new Date(product.maturity || product.maturityDate || '2025-02-18');
    const today = new Date();

    // Daily date labels from trade date to maturity
    const labels = [];
    const cursor = new Date(tradeDate);
    while (cursor <= maturityDate) {
      labels.push(cursor.toISOString().split('T')[0]);
      cursor.setDate(cursor.getDate() + 1);
    }

    const datasets = [];

    // Underlying / basket performance line(s)
    const basketType = (params.basketType || 'single').toLowerCase();
    const referenceForChart = basketType === 'best_of' ? 'best-of'
      : basketType === 'average' ? 'average'
      : 'worst-of';

    if (underlyingData && underlyingData.length > 0) {
      if (underlyingData.length === 1) {
        const u = underlyingData[0];
        const data = await this.generateRebasedStockData(
          u.fullTicker || `${u.ticker}.US`, tradeDate, maturityDate, today
        );
        datasets.push({
          label: `${u.ticker}`,
          data,
          borderColor: '#3b82f6',
          backgroundColor: 'transparent',
          borderWidth: 3,
          fill: false,
          pointRadius: 0,
          tension: 0.1,
          isPercentage: true,
          order: 1
        });
      } else {
        const all = [];
        for (const u of underlyingData) {
          const data = await this.generateRebasedStockData(
            u.fullTicker || `${u.ticker}.US`, tradeDate, maturityDate, today
          );
          all.push({ ticker: u.ticker, data });
        }
        const basketData = this.calculateBasketPerformance(all, referenceForChart);
        const basketLabel = referenceForChart === 'best-of' ? 'Best Performer'
          : referenceForChart === 'average' ? 'Average Performance'
          : 'Worst Performer';
        datasets.push({
          label: basketLabel,
          data: basketData,
          borderColor: '#3b82f6',
          backgroundColor: 'transparent',
          borderWidth: 3,
          fill: false,
          pointRadius: 0,
          tension: 0.1,
          isPercentage: true,
          order: 1
        });
      }
    }

    const upperBarrier = params.upperBarrier ?? 130;
    const lowerBarrier = params.lowerBarrier ?? 70;
    const capitalProtection = params.capitalProtection ?? 100;
    const bonusFloor = capitalProtection + (params.bonus ?? 15);

    // Upper barrier line
    datasets.push({
      label: `Upper Barrier (${upperBarrier.toFixed(0)}%)`,
      data: labels.map(date => ({ x: date, y: upperBarrier })),
      borderColor: '#f59e0b',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [10, 5],
      fill: false,
      pointRadius: 0,
      isPercentage: true,
      order: 2
    });

    // Lower barrier line
    datasets.push({
      label: `Lower Barrier (${lowerBarrier.toFixed(0)}%)`,
      data: labels.map(date => ({ x: date, y: lowerBarrier })),
      borderColor: '#ef4444',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [10, 5],
      fill: false,
      pointRadius: 0,
      isPercentage: true,
      order: 3
    });

    // Bonus floor line (minimum redemption)
    datasets.push({
      label: `Bonus Floor (${bonusFloor.toFixed(0)}%)`,
      data: labels.map(date => ({ x: date, y: bonusFloor })),
      borderColor: '#10b981',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [4, 4],
      fill: false,
      pointRadius: 0,
      isPercentage: true,
      order: 4
    });

    // Initial / capital protection reference line (100%)
    datasets.push({
      label: 'Initial Level (100%)',
      data: labels.map(date => ({ x: date, y: 100 })),
      borderColor: '#6b7280',
      backgroundColor: 'transparent',
      borderWidth: 1.5,
      borderDash: [2, 2],
      fill: false,
      pointRadius: 0,
      isPercentage: true,
      order: 5
    });

    // Vertical launch / maturity annotations
    const annotations = {
      tradeDate: {
        type: 'line', xMin: 0, xMax: 0,
        borderColor: '#374151', borderWidth: 2,
        label: { content: 'Launch', display: true, position: 'start', backgroundColor: '#374151', color: 'white', font: { size: 10, weight: 'bold' } }
      },
      maturityDate: {
        type: 'line', xMin: labels.length - 1, xMax: labels.length - 1,
        borderColor: '#374151', borderWidth: 2,
        label: { content: 'Maturity', display: true, position: 'end', backgroundColor: '#374151', color: 'white', font: { size: 10, weight: 'bold' } }
      }
    };

    // Barrier touch markers
    const addTouchMarker = (key, dateVal, yVal, color, text) => {
      if (!dateVal) return;
      const dStr = new Date(dateVal).toISOString().split('T')[0];
      const idx = labels.indexOf(dStr);
      if (idx < 0) return;
      annotations[key] = {
        type: 'point',
        xValue: idx,
        yValue: yVal,
        backgroundColor: color,
        borderColor: color,
        borderWidth: 2,
        radius: 8,
        label: { content: text, display: true, position: 'top', backgroundColor: color, color: 'white', font: { size: 11, weight: 'bold' }, padding: 6 }
      };
    };
    if (barriers.upperTouched) addTouchMarker('upperTouch', barriers.upperTouchDate, upperBarrier, '#f59e0b', 'Upper Touched');
    if (barriers.lowerTouched) addTouchMarker('lowerTouch', barriers.lowerTouchDate, lowerBarrier, '#ef4444', 'Lower Touched');

    const chartData = {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          title: {
            display: true,
            text: `${product.title || 'Twin Win'} - Performance Evolution`,
            font: { size: 16, weight: 'bold' },
            color: '#1f2937'
          },
          legend: {
            display: true,
            position: 'bottom',
            labels: { usePointStyle: true, padding: 15, font: { size: 11 } }
          },
          tooltip: {
            enabled: true,
            callbacks: {
              label: function(context) {
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
            ticks: { callback: function(value) { return value.toFixed(0) + '%'; } },
            grid: { display: true, color: 'rgba(209, 213, 219, 0.2)', drawBorder: false }
          }
        }
      },
      metadata: {
        productId: product._id,
        productTitle: product.title || product.productName || 'Twin Win',
        chartTitle: `${product.title || 'Twin Win'} - Performance Evolution`,
        chartType: 'twin_win_performance',
        templateId: 'twin_win',
        tradeDate: tradeDate.toISOString().split('T')[0],
        maturityDate: maturityDate.toISOString().split('T')[0],
        evaluationDate: new Date().toISOString(),
        hasMatured: new Date() >= maturityDate,
        upperBarrier,
        lowerBarrier,
        capitalProtection,
        bonusFloor,
        upperTouched: !!barriers.upperTouched,
        lowerTouched: !!barriers.lowerTouched,
        dataPoints: labels.length,
        underlyingCount: underlyingData.length,
        generatedAt: new Date().toISOString(),
        version: '1.0.0'
      }
    };

    return chartData;
  },

  /**
   * Aggregate per-date basket performance from rebased underlying series.
   */
  calculateBasketPerformance(allUnderlyingData, referenceType) {
    if (allUnderlyingData.length === 0) return [];

    const dateMap = new Map();
    for (const underlying of allUnderlyingData) {
      for (const point of underlying.data) {
        if (!dateMap.has(point.x)) dateMap.set(point.x, []);
        dateMap.get(point.x).push(point.y);
      }
    }

    const basketData = [];
    const sortedDates = Array.from(dateMap.keys()).sort();
    for (const date of sortedDates) {
      const values = dateMap.get(date);
      if (values.length === allUnderlyingData.length) {
        let basketValue;
        switch (referenceType) {
          case 'best-of': basketValue = Math.max(...values); break;
          case 'average': basketValue = values.reduce((s, v) => s + v, 0) / values.length; break;
          default: basketValue = Math.min(...values);
        }
        basketData.push({ x: date, y: basketValue });
      }
    }
    return basketData;
  },

  /**
   * Generate rebased stock data (normalized to 100 at trade date) from cached history.
   */
  async generateRebasedStockData(ticker, startDate, endDate, currentDate) {
    try {
      let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: ticker });
      if (!cacheDoc) {
        const symbol = ticker.split('.')[0];
        for (const exchange of ['US', 'PA', 'DE', 'LSE', 'CO']) {
          cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: `${symbol}.${exchange}` });
          if (cacheDoc) break;
        }
      }

      if (!cacheDoc || !cacheDoc.history || cacheDoc.history.length === 0) {
        console.warn(`🔁 Twin Win Chart: No historical data for ${ticker}`);
        return [];
      }

      const history = cacheDoc.history.slice().sort((a, b) => new Date(a.date) - new Date(b.date));
      const startDateStr = startDate.toISOString().split('T')[0];

      let initialPrice = null;
      for (const day of history) {
        const dayStr = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];
        if (dayStr >= startDateStr) { initialPrice = day.close; break; }
      }
      if (!initialPrice && history.length > 0) initialPrice = history[0].close;
      if (!initialPrice) return [];

      const endDateStr = endDate.toISOString().split('T')[0];
      const currentDateStr = currentDate.toISOString().split('T')[0];

      const performanceData = [];
      for (const day of history) {
        const dayStr = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];
        if (dayStr > currentDateStr) break;
        if (dayStr >= startDateStr && dayStr <= endDateStr) {
          const performance = ((day.close - initialPrice) / initialPrice) * 100;
          performanceData.push({ x: dayStr, y: 100 + performance });
        }
      }
      return performanceData;
    } catch (error) {
      console.error(`🔁 Twin Win Chart: Error generating data for ${ticker}:`, error);
      return [];
    }
  }
};
