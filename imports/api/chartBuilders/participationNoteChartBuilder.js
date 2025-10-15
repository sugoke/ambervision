import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Participation Note Chart Builder
 *
 * Generates chart configurations specific to Participation Note products.
 * Charts include:
 * - Performance evolution with participation multiplier
 * - Strike level reference line
 * - Maturity payoff projection
 * - Issuer call date markers (if applicable)
 */
export const ParticipationNoteChartBuilder = {
  /**
   * Generate chart data for Participation Note product
   */
  async generateChartData(product, evaluation) {
    const participationParams = evaluation.participationStructure || {};
    const underlyingData = evaluation.underlyings || [];

    console.log('📊 [Participation Chart] Starting chart generation');
    console.log('📊 [Participation Chart] Underlyings:', underlyingData.length, underlyingData.map(u => ({ ticker: u.ticker, initialPrice: u.initialPrice })));

    // Generate date labels from trade date to maturity
    const tradeDate = new Date(product.tradeDate || product.valueDate || '2024-02-02');
    const maturityDate = new Date(product.maturity || product.maturityDate || '2025-02-18');
    const today = new Date();

    console.log('📊 [Participation Chart] Dates:', {
      tradeDate: tradeDate.toISOString().split('T')[0],
      maturityDate: maturityDate.toISOString().split('T')[0],
      today: today.toISOString().split('T')[0]
    });

    // Check issuer call date
    const issuerCallDate = evaluation.issuerCall?.callDate ?
      new Date(evaluation.issuerCall.callDate) : null;

    // Generate daily date labels
    const labels = [];
    const currentDate = new Date(tradeDate);
    while (currentDate <= maturityDate) {
      labels.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const datasets = [];

    // Add underlying performance datasets based on reference type
    const referencePerformance = participationParams.referencePerformance || 'worst-of';
    const participationRate = participationParams.participationRate || 100;

    if (underlyingData && underlyingData.length > 0) {
      if (underlyingData.length === 1) {
        // Single underlying - show it directly
        const underlying = underlyingData[0];
        const performanceData = await this.generateRebasedStockData(
          underlying.fullTicker || `${underlying.ticker}.US`,
          tradeDate,
          maturityDate,
          today,
          underlying.initialPrice  // Pass the strike price from evaluator
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

        // Add participated performance line (performance * participation rate)
        if (participationRate !== 100) {
          const participatedData = performanceData.map(point => ({
            x: point.x,
            y: 100 + ((point.y - 100) * (participationRate / 100))
          }));

          datasets.push({
            label: `${underlying.ticker} (${participationRate}% participation)`,
            data: participatedData,
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            borderWidth: 3,
            borderDash: [5, 3],
            fill: false,
            pointRadius: 0,
            tension: 0.1,
            isPercentage: true,
            order: 1
          });
        }
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
            underlying.initialPrice  // Pass the strike price from evaluator
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

          // Add participated performance line for this stock (if participation rate != 100%)
          if (participationRate !== 100) {
            const participatedData = performanceData.map(point => ({
              x: point.x,
              y: 100 + ((point.y - 100) * (participationRate / 100))
            }));

            datasets.push({
              label: `${underlying.ticker} (${participationRate}% participation)`,
              data: participatedData,
              borderColor: colors[i % colors.length],
              backgroundColor: 'transparent',
              borderWidth: 2.5,
              borderDash: [5, 3],
              fill: false,
              pointRadius: 0,
              tension: 0.1,
              isPercentage: true,
              order: 1
            });
          }
        }

        // Calculate and add basket performance based on reference type (as reference line)
        const basketData = this.calculateBasketPerformance(
          allUnderlyingData,
          referencePerformance
        );

        // Determine label based on reference type
        let basketLabel = 'Basket Reference';
        if (referencePerformance === 'worst-of') {
          basketLabel = 'Worst-of Reference';
        } else if (referencePerformance === 'best-of') {
          basketLabel = 'Best-of Reference';
        } else if (referencePerformance === 'average') {
          basketLabel = 'Average Reference';
        }

        // Add basket line as a subtle dashed reference line
        datasets.push({
          label: basketLabel,
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

    // Add strike level line (100% reference)
    const strike = participationParams.strike || 100;
    datasets.push({
      label: `Strike Level (${strike.toFixed(0)}%)`,
      data: labels.map(date => ({ x: date, y: strike })),
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

    // Add issuer call date marker if present
    if (issuerCallDate && issuerCallDate > tradeDate && issuerCallDate <= maturityDate) {
      const callDateStr = issuerCallDate.toISOString().split('T')[0];
      const callIndex = labels.indexOf(callDateStr);

      if (callIndex >= 0) {
        annotations.issuerCall = {
          type: 'line',
          xMin: callIndex,
          xMax: callIndex,
          borderColor: '#f59e0b',
          borderWidth: 2,
          label: {
            content: 'Issuer Call',
            display: true,
            position: 'center',
            backgroundColor: '#f59e0b',
            color: 'white',
            font: { size: 10, weight: 'bold' }
          }
        };

        // Add point annotation if call price is specified
        if (evaluation.issuerCall?.callPrice) {
          annotations.issuerCallPoint = {
            type: 'point',
            xValue: callIndex,
            yValue: evaluation.issuerCall.callPrice,
            backgroundColor: '#f59e0b',
            borderColor: '#f59e0b',
            borderWidth: 2,
            radius: 8,
            label: {
              content: `Call Price: ${evaluation.issuerCall.callPriceFormatted || ''}`,
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
            text: `${product.title || 'Participation Note'} - Performance Evolution`,
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
        productTitle: product.title || product.productName || 'Participation Note',
        chartTitle: `${product.title || 'Participation Note'} - Performance Evolution`,
        chartType: 'participation_note_performance',
        tradeDate: tradeDate.toISOString().split('T')[0],
        maturityDate: maturityDate.toISOString().split('T')[0],
        evaluationDate: new Date().toISOString(),
        hasMatured: new Date() >= maturityDate,
        participationRate: participationRate,
        strike: strike,
        hasCallOption: evaluation.issuerCall?.hasCallOption || false,
        isCalled: evaluation.issuerCall?.isCalled || false,
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
   *
   * @param {string} ticker - Full ticker symbol (e.g., "AA.US")
   * @param {Date} startDate - Trade/value date
   * @param {Date} endDate - Maturity date
   * @param {Date} currentDate - Current evaluation date
   * @param {number} strikePrice - Strike price from evaluator (optional, for consistency with table)
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
            console.log(`📈 Participation Note Chart: Found data for ${altTicker} (fallback from ${ticker})`);
            break;
          }
        }
      }

      if (!cacheDoc || !cacheDoc.history || cacheDoc.history.length === 0) {
        console.warn(`📈 Participation Note Chart: No historical data for ${ticker}`);
        return [];
      }

      const history = cacheDoc.history;

      // Sort by date
      history.sort((a, b) => new Date(a.date) - new Date(b.date));

      const startDateStr = startDate.toISOString().split('T')[0];

      // CRITICAL: Must use strike price from evaluator to match table performance
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
        console.warn(`📈 Participation Note Chart: No initial price found for ${ticker}`);
        return [];
      }

      console.log(`📈 Participation Note Chart: ${ticker} using ${priceSource}: ${initialPrice}`);

      // Generate rebased performance data
      const performanceData = [];
      const endDateStr = endDate.toISOString().split('T')[0];
      const currentDateStr = currentDate.toISOString().split('T')[0];

      // Start with synthetic point at 100 on trade date (represents strike price = 100)
      performanceData.push({
        x: startDateStr,
        y: 100
      });

      // Calculate all subsequent points using strike price as base
      // This matches table performance calculation: (current - strike) / strike * 100
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

        // Rebase using strike price: matches table formula
        // rebasedLevel = 100 + ((current - strike) / strike * 100)
        const rebasedLevel = (day.close / initialPrice) * 100;

        performanceData.push({
          x: dayDateStr,
          y: rebasedLevel
        });
      }

      console.log(`📈 Participation Note Chart: Generated ${performanceData.length} data points for ${ticker}`);
      return performanceData;

    } catch (error) {
      console.error(`📈 Participation Note Chart: Error generating data for ${ticker}:`, error);
      return [];
    }
  }
};
