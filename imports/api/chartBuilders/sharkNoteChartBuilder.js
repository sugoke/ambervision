import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Shark Note Chart Builder
 *
 * Generates chart configurations specific to Shark Note products.
 * Charts include:
 * - Performance evolution vs upper barrier
 * - Floor level visualization
 * - Barrier touch event markers
 */
export const SharkNoteChartBuilder = {
  /**
   * Generate chart data for Shark Note product
   */
  async generateChartData(product, evaluation) {
    const sharkParams = evaluation.sharkStructure || {};
    const underlyingData = evaluation.underlyings || [];

    // Generate date labels from trade date to maturity
    const tradeDate = new Date(product.tradeDate || product.valueDate || '2024-02-02');
    const maturityDate = new Date(product.maturity || product.maturityDate || '2025-02-18');
    const today = new Date();

    // Generate daily date labels
    const labels = [];
    const currentDate = new Date(tradeDate);
    while (currentDate <= maturityDate) {
      labels.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const datasets = [];

    // Add underlying performance datasets based on reference type
    const referencePerformance = sharkParams.referencePerformance || 'worst-of';

    if (underlyingData && underlyingData.length > 0) {
      if (underlyingData.length === 1) {
        // Single underlying - show it directly
        const underlying = underlyingData[0];
        const performanceData = await this.generateRebasedStockData(
          underlying.fullTicker || `${underlying.ticker}.US`,
          tradeDate,
          maturityDate,
          today
        );

        datasets.push({
          label: `${underlying.ticker}`,
          data: performanceData,
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
        // Multiple underlyings - generate basket performance based on reference type
        const allUnderlyingData = [];

        // Fetch all underlying data
        for (const underlying of underlyingData) {
          const performanceData = await this.generateRebasedStockData(
            underlying.fullTicker || `${underlying.ticker}.US`,
            tradeDate,
            maturityDate,
            today
          );
          allUnderlyingData.push({
            ticker: underlying.ticker,
            data: performanceData
          });
        }

        // Calculate basket performance based on reference type
        const basketData = this.calculateBasketPerformance(
          allUnderlyingData,
          referencePerformance
        );

        // Determine label based on reference type
        let basketLabel = 'Basket Performance';
        if (referencePerformance === 'worst-of') {
          basketLabel = 'Worst Performer';
        } else if (referencePerformance === 'best-of') {
          basketLabel = 'Best Performer';
        } else if (referencePerformance === 'average') {
          basketLabel = 'Average Performance';
        }

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

    // Add upper barrier line
    const upperBarrier = sharkParams.upperBarrier || 140;
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

    // Add floor level line
    const floorLevel = sharkParams.floorLevel || 90;
    datasets.push({
      label: `Floor Level (${floorLevel.toFixed(0)}%)`,
      data: labels.map(date => ({ x: date, y: floorLevel })),
      borderColor: '#ef4444',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0,
      isPercentage: true,
      order: 3
    });

    // Add 100% reference line
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
      order: 4
    });

    // Build annotations
    const annotations = {
      // Trade date vertical line
      tradeDate: {
        type: 'line',
        xMin: 0,
        xMax: 0,
        borderColor: '#374151',
        borderWidth: 2,
        label: {
          content: 'Launch',
          display: true,
          position: 'start',
          backgroundColor: '#374151',
          color: 'white',
          font: { size: 10, weight: 'bold' }
        }
      },
      // Maturity vertical line
      maturityDate: {
        type: 'line',
        xMin: labels.length - 1,
        xMax: labels.length - 1,
        borderColor: '#374151',
        borderWidth: 2,
        label: {
          content: 'Maturity',
          display: true,
          position: 'end',
          backgroundColor: '#374151',
          color: 'white',
          font: { size: 10, weight: 'bold' }
        }
      }
    };

    // Add barrier touch event marker if barrier was touched
    if (evaluation.barrierTouch?.touched && evaluation.barrierTouch?.touchDate) {
      const touchDateStr = new Date(evaluation.barrierTouch.touchDate).toISOString().split('T')[0];
      const touchIndex = labels.indexOf(touchDateStr);

      if (touchIndex >= 0) {
        annotations.barrierTouch = {
          type: 'point',
          xValue: touchIndex,
          yValue: evaluation.barrierTouch.basketLevelAtTouch || upperBarrier,
          backgroundColor: '#f59e0b',
          borderColor: '#f59e0b',
          borderWidth: 2,
          radius: 8,
          label: {
            content: `Barrier Touched: ${evaluation.barrierTouch.basketLevelAtTouchFormatted || ''}`,
            display: true,
            position: 'top',
            backgroundColor: '#f59e0b',
            color: 'white',
            font: { size: 11, weight: 'bold' },
            padding: 6
          }
        };
      }
    }

    // Chart configuration
    const chartData = {
      type: 'line',
      data: {
        labels,
        datasets
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
            text: `${product.title || 'Shark Note'} - Performance Evolution`,
            font: { size: 16, weight: 'bold' },
            color: '#1f2937'
          },
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              usePointStyle: true,
              padding: 15,
              font: { size: 11 }
            }
          },
          tooltip: {
            enabled: true,
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                if (context.parsed.y !== null) {
                  label += context.parsed.y.toFixed(2) + '%';
                }
                return label;
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
            title: {
              display: true,
              text: 'Date',
              font: { size: 12, weight: 'bold' }
            },
            ticks: {
              maxRotation: 45,
              minRotation: 45,
              autoSkip: true,
              maxTicksLimit: 12
            },
            grid: {
              display: true,
              color: 'rgba(209, 213, 219, 0.2)',
              drawBorder: false
            }
          },
          y: {
            title: {
              display: true,
              text: 'Performance (%)',
              font: { size: 12, weight: 'bold' }
            },
            ticks: {
              callback: function(value) {
                return value.toFixed(0) + '%';
              }
            },
            grid: {
              display: true,
              color: 'rgba(209, 213, 219, 0.2)',
              drawBorder: false
            }
          }
        }
      },
      metadata: {
        productId: product._id,
        productTitle: product.title || product.productName || 'Shark Note',
        chartTitle: `${product.title || 'Shark Note'} - Performance Evolution`,
        chartType: 'shark_note_performance',
        tradeDate: tradeDate.toISOString().split('T')[0],
        maturityDate: maturityDate.toISOString().split('T')[0],
        evaluationDate: new Date().toISOString(),
        hasMatured: new Date() >= maturityDate,
        upperBarrier: upperBarrier,
        floorLevel: floorLevel,
        barrierTouched: evaluation.barrierTouch?.touched || false,
        dataPoints: labels.length,
        underlyingCount: underlyingData.length,
        generatedAt: new Date().toISOString(),
        version: '1.0.0'
      }
    };

    return chartData;
  },

  /**
   * Calculate basket performance based on reference type
   */
  calculateBasketPerformance(allUnderlyingData, referenceType) {
    if (allUnderlyingData.length === 0) return [];

    // Get all unique dates across all underlyings
    const dateMap = new Map();

    // Collect all data points by date
    for (const underlying of allUnderlyingData) {
      for (const point of underlying.data) {
        if (!dateMap.has(point.x)) {
          dateMap.set(point.x, []);
        }
        dateMap.get(point.x).push(point.y);
      }
    }

    // Calculate basket performance for each date
    const basketData = [];
    const sortedDates = Array.from(dateMap.keys()).sort();

    for (const date of sortedDates) {
      const values = dateMap.get(date);

      // Only calculate if we have data for all underlyings
      if (values.length === allUnderlyingData.length) {
        let basketValue;

        switch (referenceType) {
          case 'worst-of':
            basketValue = Math.min(...values);
            break;
          case 'best-of':
            basketValue = Math.max(...values);
            break;
          case 'average':
            basketValue = values.reduce((sum, v) => sum + v, 0) / values.length;
            break;
          default:
            basketValue = Math.min(...values);
        }

        basketData.push({
          x: date,
          y: basketValue
        });
      }
    }

    return basketData;
  },

  /**
   * Generate rebased stock data (normalized to 100 at trade date)
   */
  async generateRebasedStockData(ticker, startDate, endDate, currentDate) {
    try {
      // Fetch historical data from market data cache with exchange fallback
      let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: ticker });

      // Fallback: try different exchanges
      if (!cacheDoc) {
        const symbol = ticker.split('.')[0];
        const exchanges = ['US', 'PA', 'DE', 'LSE', 'CO'];
        for (const exchange of exchanges) {
          const altTicker = `${symbol}.${exchange}`;
          cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: altTicker });
          if (cacheDoc) {
            console.log(`🦈 Shark Note Chart: Found data for ${altTicker} (fallback from ${ticker})`);
            break;
          }
        }
      }

      if (!cacheDoc || !cacheDoc.history || cacheDoc.history.length === 0) {
        console.warn(`🦈 Shark Note Chart: No historical data for ${ticker}`);
        return [];
      }

      const history = cacheDoc.history;

      // Sort by date
      history.sort((a, b) => new Date(a.date) - new Date(b.date));

      // Find initial price (closest to start date)
      const startDateStr = startDate.toISOString().split('T')[0];
      let initialPrice = null;
      let closestDate = null;

      for (const day of history) {
        const dayDateStr = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];
        if (dayDateStr >= startDateStr) {
          initialPrice = day.close;
          closestDate = dayDateStr;
          break;
        }
      }

      // Fallback: use first available price
      if (!initialPrice && history.length > 0) {
        initialPrice = history[0].close;
        closestDate = history[0].date;
      }

      if (!initialPrice) {
        console.warn(`🦈 Shark Note Chart: No initial price found for ${ticker}`);
        return [];
      }

      console.log(`🦈 Shark Note Chart: Initial price for ${ticker}: ${initialPrice} on ${closestDate}`);

      // Generate rebased performance data
      const performanceData = [];
      const endDateStr = endDate.toISOString().split('T')[0];
      const currentDateStr = currentDate.toISOString().split('T')[0];

      for (const day of history) {
        const dayDateStr = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];

        // Only include data up to current date (don't show future)
        if (dayDateStr > currentDateStr) {
          break;
        }

        // Only include data from start date onwards
        if (dayDateStr >= startDateStr && dayDateStr <= endDateStr) {
          const performance = ((day.close - initialPrice) / initialPrice) * 100;
          const rebasedLevel = 100 + performance;

          performanceData.push({
            x: dayDateStr,
            y: rebasedLevel
          });
        }
      }

      console.log(`🦈 Shark Note Chart: Generated ${performanceData.length} data points for ${ticker}`);
      return performanceData;

    } catch (error) {
      console.error(`🦈 Shark Note Chart: Error generating data for ${ticker}:`, error);
      return [];
    }
  }
};
