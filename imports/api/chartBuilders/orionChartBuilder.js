import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Orion Chart Builder
 *
 * Generates chart configurations specific to Orion Memory products.
 * Charts include:
 * - Individual underlying performances with upper barrier visualization
 * - Barrier hit detection and annotations
 * - 100% reference line (initial level)
 */
export const OrionChartBuilder = {
  /**
   * Generate chart data for Orion product
   */
  async generateChartData(product, evaluation) {
    const orionParams = evaluation.orionStructure || {};
    const underlyingData = evaluation.underlyings || [];
    const upperBarrier = orionParams.upperBarrier || 120;

    // Generate date labels from trade date to maturity
    const tradeDate = new Date(product.tradeDate || product.issueDate || '2024-02-02');
    const maturityDate = new Date(product.maturity || product.maturityDate || '2026-02-17');
    const today = new Date();

    // Generate daily date labels
    const labels = [];
    const currentDate = new Date(tradeDate);
    while (currentDate <= maturityDate) {
      labels.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const datasets = [];
    const barrierHitPoints = [];

    // Add underlying performance datasets with actual stock data
    if (underlyingData && underlyingData.length > 0) {
      const colors = ['#3b82f6', '#059669', '#f59e0b', '#ef4444'];
      for (let index = 0; index < underlyingData.length; index++) {
        const underlying = underlyingData[index];

        // Generate performance data using actual stock prices rebased to 100
        const performanceData = await this.generateRebasedStockData(
          underlying.fullTicker || `${underlying.ticker}.US`,
          tradeDate,
          maturityDate,
          today
        );

        // Check if barrier was hit and find first hit date
        let crossingDate = null;
        if (underlying.hitUpperBarrier && performanceData && performanceData.length > 0) {
          const firstHit = performanceData.find(point => point.y >= upperBarrier);
          if (firstHit) {
            crossingDate = firstHit.x;
            barrierHitPoints.push({
              ticker: underlying.ticker,
              date: firstHit.x,
              yValue: upperBarrier,  // Dot should be ON the barrier line
              color: colors[index % colors.length]
            });
          }
        }

        // Split data if crossing occurred to show transparency after barrier hit
        if (crossingDate) {
          const beforeCrossing = [];
          const afterCrossing = [];
          let foundCrossing = false;

          performanceData.forEach(point => {
            if (!foundCrossing) {
              beforeCrossing.push(point);
              if (point.x === crossingDate) {
                foundCrossing = true;
                afterCrossing.push(point); // Include crossing point in both segments
              }
            } else {
              afterCrossing.push(point);
            }
          });

          // Before crossing - full opacity
          datasets.push({
            label: `${underlying.ticker} (${underlying.name || underlying.companyName})`,
            data: beforeCrossing,
            borderColor: colors[index % colors.length],
            backgroundColor: 'transparent',
            borderWidth: 3,
            fill: false,
            pointRadius: 0,
            tension: 0.1,
            isPercentage: true,
            order: 1
          });

          // After crossing - 90% transparency (10% opacity)
          if (afterCrossing.length > 0) {
            const colorWithAlpha = colors[index % colors.length] + '1A'; // 10% opacity (90% transparency)
            datasets.push({
              label: null, // No label for the faded segment (avoids duplicate legend entries)
              data: afterCrossing,
              borderColor: colorWithAlpha,
              backgroundColor: 'transparent',
              borderWidth: 3,
              fill: false,
              pointRadius: 0,
              tension: 0.1,
              isPercentage: true,
              order: 1
            });
          }
        } else {
          // No barrier hit - full opacity throughout
          datasets.push({
            label: `${underlying.ticker} (${underlying.name || underlying.companyName})`,
            data: performanceData,
            borderColor: colors[index % colors.length],
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
    }

    // Add 100% reference line (initial level)
    datasets.push({
      label: '100% (Initial Level)',
      data: labels.map(date => ({ x: date, y: 100 })),
      borderColor: '#6b7280',
      borderDash: [5, 5],
      borderWidth: 1.5,
      fill: false,
      pointRadius: 0,
      isPercentage: true,
      order: 3
    });

    // Add upper barrier line
    datasets.push({
      label: `Upper Barrier (${upperBarrier}%)`,
      data: labels.map(date => ({ x: date, y: upperBarrier })),
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.15)',
      borderWidth: 2.5,
      borderDash: [8, 4],
      fill: 'origin',
      pointRadius: 0,
      isPercentage: true,
      order: 2,
      _needsGradient: true,
      _gradientType: 'autocall'
    });

    // Build annotations
    const annotations = {};

    // Add horizontal line at 100% (initial level)
    annotations['initial_level'] = {
      type: 'line',
      yMin: 100,
      yMax: 100,
      borderColor: '#94a3b8',
      borderWidth: 1,
      borderDash: [3, 3],
      label: {
        display: true,
        content: 'Initial Level (100%)',
        position: 'end',
        backgroundColor: '#94a3b8',
        color: '#ffffff',
        padding: 4,
        font: { size: 9 }
      }
    };

    // For Orion: Only show initial and final observation (no periodic observations)
    // Add initial observation line
    const tradeDateStr = tradeDate.toISOString().split('T')[0];
    annotations['initial_observation'] = {
      type: 'line',
      xMin: tradeDateStr,
      xMax: tradeDateStr,
      borderColor: '#10b981',
      borderWidth: 2,
      borderDash: [5, 5],
      label: {
        display: true,
        content: 'Initial',
        position: 'start',
        yAdjust: -10,
        backgroundColor: '#10b981',
        color: '#ffffff',
        padding: 4,
        font: { size: 10 }
      }
    };

    // Add final observation line
    const finalDateStr = new Date(product.finalObservation || product.maturity).toISOString().split('T')[0];
    annotations['final_observation'] = {
      type: 'line',
      xMin: finalDateStr,
      xMax: finalDateStr,
      borderColor: '#ef4444',
      borderWidth: 2,
      label: {
        display: true,
        content: 'Final',
        position: 'start',
        yAdjust: -10,
        backgroundColor: '#ef4444',
        color: '#ffffff',
        padding: 4,
        font: { size: 10 }
      }
    };

    // Add point annotations for barrier hits
    barrierHitPoints.forEach((hitPoint, index) => {
      annotations[`barrier_hit_${index}`] = {
        type: 'point',
        xValue: hitPoint.date,
        yValue: hitPoint.yValue,
        backgroundColor: hitPoint.color,
        borderColor: '#ffffff',
        borderWidth: 3,
        radius: 8,
        label: {
          display: true,
          content: `${hitPoint.ticker} hit ${upperBarrier}%`,
          position: 'top',
          yAdjust: -15,
          backgroundColor: hitPoint.color,
          color: '#ffffff',
          padding: 6,
          font: {
            size: 11,
            weight: 'bold'
          },
          borderRadius: 4
        }
      };
    });

    // Calculate dynamic Y-axis range
    let minY = 100;
    let maxY = 100;

    datasets.forEach(dataset => {
      if (dataset.isPercentage && dataset.data && dataset.data.length > 0) {
        const datasetMin = Math.min(...dataset.data.map(point => point.y || 100));
        const datasetMax = Math.max(...dataset.data.map(point => point.y || 0));
        minY = Math.min(minY, datasetMin);
        maxY = Math.max(maxY, datasetMax);
      }
    });

    // Add padding to Y-axis range
    const yRange = maxY - minY;
    minY = Math.floor(minY - yRange * 0.1);
    maxY = Math.ceil(maxY + yRange * 0.1);

    return {
      type: 'line',
      data: {
        labels: labels,
        datasets: datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          title: {
            display: true,
            text: `${product.title || 'Orion Memory'} - Performance Chart`,
            font: { size: 16, weight: 'bold' },
            color: '#ffffff'
          },
          legend: {
            display: true,
            position: 'top',
            labels: {
              usePointStyle: true,
              padding: 15,
              color: '#ffffff',
              font: { size: 11 }
            }
          },
          tooltip: {
            enabled: true,
            callbacks: {
              label: function(context) {
                const label = context.dataset.label || '';
                const value = context.parsed.y;
                if (context.dataset.isPercentage) {
                  const formatted = value >= 100
                    ? `+${(value - 100).toFixed(2)}%`
                    : `${(value - 100).toFixed(2)}%`;
                  return `${label}: ${formatted}`;
                }
                return `${label}: ${value.toFixed(2)}%`;
              }
            }
          },
          annotation: {
            annotations: annotations
          }
        },
        scales: {
          x: {
            type: 'category',
            grid: {
              display: true,
              color: 'rgba(209, 213, 219, 0.2)',
              drawBorder: false
            },
            ticks: {
              maxRotation: 45,
              minRotation: 0,
              color: '#ffffff',
              font: { size: 11 },
              maxTicksLimit: 12
            }
          },
          y: {
            type: 'linear',
            beginAtZero: false,
            min: minY,
            max: maxY,
            grid: {
              display: true,
              color: 'rgba(209, 213, 219, 0.2)',
              drawBorder: false
            },
            ticks: {
              color: '#ffffff',
              font: { size: 11 },
              callback: function(value) {
                return value + '%';
              }
            }
          }
        }
      },
      metadata: {
        productId: product._id,
        chartTitle: `${product.title || 'Orion Memory'} - Performance Chart`,
        chartType: 'orion_performance',
        generatedAt: new Date().toISOString()
      }
    };
  },

  /**
   * Generate rebased stock data (normalized to 100 at trade date)
   */
  async generateRebasedStockData(ticker, tradeDate, maturityDate, today) {
    try {
      const tradeDateStr = tradeDate.toISOString().split('T')[0];
      const maturityDateStr = maturityDate.toISOString().split('T')[0];

      let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: ticker });

      if (!cacheDoc) {
        const symbol = ticker.split('.')[0];
        const exchanges = ['US', 'PA', 'DE', 'LSE', 'CO'];
        for (const exchange of exchanges) {
          const altTicker = `${symbol}.${exchange}`;
          cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: altTicker });
          if (cacheDoc) break;
        }
      }

      if (!cacheDoc || !cacheDoc.history || cacheDoc.history.length === 0) {
        return this.generateSyntheticData(tradeDate, maturityDate, today);
      }

      const history = cacheDoc.history.filter(record => {
        const recordDate = new Date(record.date).toISOString().split('T')[0];
        return recordDate >= tradeDateStr && recordDate <= maturityDateStr;
      });

      if (history.length === 0) {
        return this.generateSyntheticData(tradeDate, maturityDate, today);
      }

      const initialPriceRecord = history.find(p =>
        new Date(p.date).toISOString().split('T')[0] === tradeDateStr
      ) || history[0];
      const initialPrice = initialPriceRecord?.adjustedClose || initialPriceRecord?.close || 100;

      return history.map(record => ({
        x: new Date(record.date).toISOString().split('T')[0],
        y: ((record.adjustedClose || record.close) / initialPrice) * 100
      }));

    } catch (error) {
      console.error(`❌ Error fetching price data for ${ticker}:`, error);
      return this.generateSyntheticData(tradeDate, maturityDate, today);
    }
  },

  /**
   * Generate synthetic performance data as fallback
   */
  generateSyntheticData(tradeDate, maturityDate, today) {
    const labels = [];
    const currentDate = new Date(tradeDate);

    while (currentDate <= maturityDate) {
      labels.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const todayIndex = Math.floor((today - tradeDate) / (24 * 60 * 60 * 1000));

    return labels.map((date, index) => {
      if (index === 0) {
        return { x: date, y: 100 };
      } else if (index <= todayIndex) {
        const baseProgress = (36.9 * index) / Math.max(todayIndex, 1);
        const volatility = Math.sin(index * 0.1) * 5;
        return { x: date, y: 100 + baseProgress + volatility };
      } else {
        return null;
      }
    }).filter(point => point !== null);
  }
};
