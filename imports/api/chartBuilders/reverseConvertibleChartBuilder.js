import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Reverse Convertible Chart Builder
 *
 * Generates chart configurations specific to Reverse Convertible products.
 * Charts include:
 * - Performance evolution with protection barrier
 * - Capital protection barrier line
 * - Strike level reference line
 * - Maturity date marker
 * - Barrier breach zones
 */
export const ReverseConvertibleChartBuilder = {
  /**
   * Generate chart data for Reverse Convertible product
   */
  async generateChartData(product, evaluation) {
    const reverseConvertibleParams = evaluation.reverseConvertibleStructure || {};
    const underlyingData = evaluation.underlyings || [];

    console.log('📊 [Reverse Convertible Chart] Starting chart generation');
    console.log('📊 [Reverse Convertible Chart] Underlyings:', underlyingData.length, underlyingData.map(u => ({
      ticker: u.ticker,
      initialPrice: u.initialPrice
    })));

    // Generate date labels from trade date to maturity
    const tradeDate = new Date(product.tradeDate || product.valueDate || '2024-02-02');
    const maturityDate = new Date(product.maturity || product.maturityDate || '2025-02-18');
    const finalObservationDate = product.finalObservation || product.finalObservationDate
      ? new Date(product.finalObservation || product.finalObservationDate)
      : maturityDate;
    const today = new Date();

    console.log('📊 [Reverse Convertible Chart] Dates:', {
      tradeDate: tradeDate.toISOString().split('T')[0],
      finalObservationDate: finalObservationDate.toISOString().split('T')[0],
      maturityDate: maturityDate.toISOString().split('T')[0],
      today: today.toISOString().split('T')[0]
    });

    // Generate daily date labels
    const labels = [];
    const currentDate = new Date(tradeDate);
    // Extend to maturity to show remaining time on x-axis
    while (currentDate <= maturityDate) {
      labels.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const datasets = [];

    // Add underlying performance datasets
    const capitalProtectionBarrier = reverseConvertibleParams.capitalProtectionBarrier || 70;

    if (underlyingData && underlyingData.length > 0) {
      if (underlyingData.length === 1) {
        // Single underlying - show it directly
        const underlying = underlyingData[0];
        const performanceData = await this.generateRebasedStockData(
          underlying.fullTicker || `${underlying.ticker}.US`,
          tradeDate,
          maturityDate,
          today,
          underlying.initialPrice
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
        // Multiple underlyings - show each individual stock performance
        const colors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
        const allUnderlyingData = [];

        // Fetch and display all underlying data individually
        for (let i = 0; i < underlyingData.length; i++) {
          const underlying = underlyingData[i];
          const performanceData = await this.generateRebasedStockData(
            underlying.fullTicker || `${underlying.ticker}.US`,
            tradeDate,
            maturityDate,
            today,
            underlying.initialPrice
          );

          allUnderlyingData.push({
            ticker: underlying.ticker,
            data: performanceData
          });

          // Add individual stock line
          datasets.push({
            label: `${underlying.ticker}`,
            data: performanceData,
            borderColor: colors[i % colors.length],
            backgroundColor: 'transparent',
            borderWidth: 2.5,
            fill: false,
            pointRadius: 0,
            tension: 0.1,
            isPercentage: true,
            order: 1
          });
        }

        // Calculate and add worst-of basket performance
        const basketData = this.calculateWorstOfPerformance(allUnderlyingData);

        datasets.push({
          label: 'Worst-of Reference',
          data: basketData,
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

    // Add capital protection barrier line (horizontal at barrier level)
    datasets.push({
      label: `Protection Barrier (${capitalProtectionBarrier.toFixed(0)}%)`,
      data: labels.map(date => ({ x: date, y: capitalProtectionBarrier })),
      borderColor: '#ef4444',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0,
      isPercentage: true,
      order: 3
    });

    // Add strike level line (100% reference)
    datasets.push({
      label: 'Strike Level (100%)',
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
      // Final observation vertical line
      finalObservation: {
        type: 'line',
        xMin: Math.max(0, labels.indexOf(finalObservationDate.toISOString().split('T')[0])),
        xMax: Math.max(0, labels.indexOf(finalObservationDate.toISOString().split('T')[0])),
        borderColor: '#6b7280',
        borderWidth: 2,
        label: {
          content: 'Final Observation',
          display: true,
          position: 'center',
          backgroundColor: '#6b7280',
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
            text: `${product.title || 'Reverse Convertible'} - Performance Evolution`,
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
            },
            // Add 15% padding below barrier for better visibility
            suggestedMin: Math.min(capitalProtectionBarrier - 15, 30)
          }
        }
      },
      metadata: {
        productId: product._id,
        productTitle: product.title || product.productName || 'Reverse Convertible',
        chartTitle: `${product.title || 'Reverse Convertible'} - Performance Evolution`,
        chartType: 'reverse_convertible_performance',
        tradeDate: tradeDate.toISOString().split('T')[0],
        finalObservationDate: finalObservationDate.toISOString().split('T')[0],
        maturityDate: maturityDate.toISOString().split('T')[0],
        evaluationDate: new Date().toISOString(),
        hasMatured: new Date() >= maturityDate,
        capitalProtectionBarrier: capitalProtectionBarrier,
        couponRate: reverseConvertibleParams.couponRate,
        gearingFactor: reverseConvertibleParams.gearingFactor,
        dataPoints: labels.length,
        underlyingCount: underlyingData.length,
        generatedAt: new Date().toISOString(),
        version: '1.0.0'
      }
    };

    return chartData;
  },

  /**
   * Calculate worst-of basket performance
   */
  calculateWorstOfPerformance(allUnderlyingData) {
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

    // Calculate worst-of performance for each date
    const basketData = [];
    const sortedDates = Array.from(dateMap.keys()).sort();

    for (const date of sortedDates) {
      const values = dateMap.get(date);

      // Only calculate if we have data for all underlyings
      if (values.length === allUnderlyingData.length) {
        const worstValue = Math.min(...values);

        basketData.push({
          x: date,
          y: worstValue
        });
      }
    }

    return basketData;
  },

  /**
   * Generate rebased stock data (normalized to 100 at trade date)
   */
  async generateRebasedStockData(ticker, startDate, endDate, currentDate, strikePrice = null) {
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
            console.log(`📈 Reverse Convertible Chart: Found data for ${altTicker} (fallback from ${ticker})`);
            break;
          }
        }
      }

      if (!cacheDoc || !cacheDoc.history || cacheDoc.history.length === 0) {
        console.warn(`📈 Reverse Convertible Chart: No historical data for ${ticker}`);
        return [];
      }

      const history = cacheDoc.history;

      // Sort by date
      history.sort((a, b) => new Date(a.date) - new Date(b.date));

      const startDateStr = startDate.toISOString().split('T')[0];

      // Use strike price from evaluator to match table performance
      let initialPrice = strikePrice;
      let priceSource = 'strike_from_evaluator';

      // Fallback: use historical market price only if strike not provided
      if (!initialPrice) {
        priceSource = 'historical_market_price_fallback';
        for (const day of history) {
          const dayDateStr = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];
          if (dayDateStr >= startDateStr) {
            initialPrice = day.close;
            break;
          }
        }

        // Last fallback: use first available price
        if (!initialPrice && history.length > 0) {
          initialPrice = history[0].close;
          priceSource = 'first_available_price';
        }
      }

      if (!initialPrice) {
        console.warn(`📈 Reverse Convertible Chart: No initial price found for ${ticker}`);
        return [];
      }

      console.log(`📈 Reverse Convertible Chart: ${ticker} using ${priceSource}: ${initialPrice}`);

      // Generate rebased performance data
      const performanceData = [];
      const endDateStr = endDate.toISOString().split('T')[0];
      const currentDateStr = currentDate.toISOString().split('T')[0];

      // Start with synthetic point at 100 on trade date
      performanceData.push({
        x: startDateStr,
        y: 100
      });

      // Calculate all subsequent points using strike price as base
      for (const day of history) {
        const dayDateStr = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];

        // Skip dates before or ON trade date (already added synthetic point)
        if (dayDateStr <= startDateStr) {
          continue;
        }

        // Stop at current date (don't show future)
        if (dayDateStr > currentDateStr) {
          break;
        }

        // Stop at maturity date
        if (dayDateStr > endDateStr) {
          break;
        }

        // Rebase using strike price
        const rebasedLevel = (day.close / initialPrice) * 100;

        performanceData.push({
          x: dayDateStr,
          y: rebasedLevel
        });
      }

      console.log(`📈 Reverse Convertible Chart: Generated ${performanceData.length} data points for ${ticker}`);
      return performanceData;

    } catch (error) {
      console.error(`📈 Reverse Convertible Chart: Error generating data for ${ticker}:`, error);
      return [];
    }
  }
};
