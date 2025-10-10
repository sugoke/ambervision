import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Himalaya Chart Builder
 *
 * Generates chart configurations specific to Himalaya products.
 * Charts include:
 * - Performance evolution of all underlyings
 * - Vertical lines at each observation date
 * - Dots showing selected underlying at each observation
 */
export const HimalayaChartBuilder = {
  /**
   * Generate chart data for Himalaya product
   */
  async generateChartData(product, evaluation) {
    try {
      const himalayaCalculation = evaluation.himalayaCalculation || {};
      const selectionHistory = himalayaCalculation.selectionHistory || [];
      const underlyings = evaluation.underlyings || [];
      const himalayaStructure = evaluation.himalayaStructure || {};
      const observationDates = himalayaStructure.observationDates || [];

      // Debug: Check what fullTicker values we have
      const debugInfo = underlyings.map((u, i) => `${i}: ${u.ticker} -> ${u.fullTicker || 'NOT SET'}`).join('\n');
      console.log('📊 Himalaya Chart - Ticker Debug:\n' + debugInfo);

      // Also check what's in MarketDataCache
      const allCacheDocs = await MarketDataCacheCollection.find({}).fetchAsync();
      const cacheInfo = allCacheDocs.map(d => `${d.fullTicker} (${d.history?.length || 0} points)`).join(', ');
      console.log('📊 Available in cache: ' + cacheInfo);

      // Generate date labels from trade date to maturity
      const tradeDate = new Date(product.tradeDate || '2024-02-02');
      const maturityDate = new Date(product.maturity || product.maturityDate || '2025-02-18');
      const today = new Date();

      // Generate daily date labels
      const labels = [];
      const currentDate = new Date(tradeDate);
      while (currentDate <= maturityDate) {
        labels.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Create datasets for each underlying
      const datasets = [];

      // Color palette for underlyings
      const colors = [
        '#3b82f6', // Blue
        '#059669', // Green
        '#f59e0b', // Amber
        '#8b5cf6', // Purple
        '#ef4444', // Red
        '#06b6d4'  // Cyan
      ];

      // Add performance line for each underlying
      for (let i = 0; i < underlyings.length; i++) {
        const underlying = underlyings[i];

        // Use fullTicker, fall back to ticker with .US suffix
        const tickerForQuery = underlying.fullTicker || `${underlying.ticker}.US`;
        console.log(`📊 Himalaya Chart: Processing ${underlying.ticker}, using ticker: ${tickerForQuery}`);

        // Generate rebased performance data
        const performanceData = await this.generateRebasedStockData(
          tickerForQuery,
          tradeDate,
          maturityDate,
          today,
          i,  // Pass index as seed for unique synthetic data
          underlying  // Pass underlying data for accurate synthetic generation
        );

        // Find when this underlying was selected (if at all)
        const selectionRecord = selectionHistory.find(s => s.selectedUnderlying === underlying.ticker);
        const selectionDate = selectionRecord ? new Date(selectionRecord.observationDate).toISOString().split('T')[0] : null;

        if (selectionDate) {
          // Split data into before and after selection
          const beforeSelection = [];
          const afterSelection = [];
          let foundSplit = false;

          performanceData.forEach(point => {
            if (!foundSplit) {
              beforeSelection.push(point);
              if (point.x === selectionDate) {
                foundSplit = true;
                afterSelection.push(point); // Include the selection point in both
              }
            } else {
              afterSelection.push(point);
            }
          });

          // Before selection - full opacity
          datasets.push({
            label: `${underlying.ticker} (${underlying.name})`,
            data: beforeSelection,
            borderColor: colors[i % colors.length],
            backgroundColor: 'transparent',
            borderWidth: 3,
            fill: false,
            pointRadius: 0,
            tension: 0.1,
            isPercentage: true,
            order: 1
          });

          // After selection - 30% opacity (70% transparency)
          if (afterSelection.length > 0) {
            const colorWithAlpha = colors[i % colors.length] + '4D'; // Add 30% opacity (70% transparency)
            datasets.push({
              label: null, // No label for the faded segment
              data: afterSelection,
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
          // Not selected - full opacity throughout
          datasets.push({
            label: `${underlying.ticker} (${underlying.name})`,
            data: performanceData,
            borderColor: colors[i % colors.length],
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

      // Create Chart.js configuration
      const chartConfig = {
        type: 'line',
        data: {
          labels: labels,
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          backgroundColor: '#000000',
          interaction: {
            mode: 'index',
            intersect: false
          },
          plugins: {
            title: {
              display: true,
              text: `${product.title || 'Himalaya Product'} - Performance Evolution`,
              font: {
                size: 16,
                weight: 'bold'
              },
              color: '#ffffff',
              padding: {
                top: 10,
                bottom: 20
              }
            },
            legend: {
              display: true,
              position: 'top',
              labels: {
                usePointStyle: true,
                padding: 15,
                color: '#ffffff',
                font: {
                  size: 11
                }
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
                  return `${label}: ${value}`;
                }
              }
            },
            annotation: {
              annotations: this.buildAnnotations(
                observationDates,
                selectionHistory,
                tradeDate,
                maturityDate,
                labels,
                underlyings,
                datasets
              )
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
                font: {
                  size: 11
                },
                maxTicksLimit: 12
              }
            },
            y: {
              beginAtZero: false,
              grid: {
                display: true,
                color: 'rgba(209, 213, 219, 0.2)',
                drawBorder: false
              },
              ticks: {
                color: '#ffffff',
                font: {
                  size: 11
                },
                callback: function(value) {
                  return value + '%';
                }
              },
              title: {
                display: true,
                text: 'Performance (%)',
                color: '#ffffff',
                font: {
                  size: 12,
                  weight: 'bold'
                }
              }
            }
          }
        }
      };

      return {
        ...chartConfig,
        metadata: {
          productId: product._id,
          chartTitle: `${product.title || 'Himalaya Product'} - Performance Evolution`,
          chartType: 'himalaya_selection_timeline',
          generatedAt: new Date().toISOString(),
          observationCount: observationDates.length,
          underlyingCount: underlyings.length
        }
      };

    } catch (error) {
      console.error('❌ Error generating Himalaya chart:', error);
      return null;
    }
  },

  /**
   * Build annotations for observation dates and selections
   */
  buildAnnotations(observationDates, selectionHistory, tradeDate, maturityDate, labels, underlyings, datasets) {
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

    // Color palette (matching the datasets)
    const colors = [
      '#3b82f6', // Blue
      '#059669', // Green
      '#f59e0b', // Amber
      '#8b5cf6', // Purple
      '#ef4444', // Red
      '#06b6d4'  // Cyan
    ];

    // Add vertical line for launch date
    annotations.launchDate = {
      type: 'line',
      xMin: 0,
      xMax: 0,
      borderColor: '#374151',
      borderWidth: 2,
      borderDash: [5, 5],
      label: {
        display: true,
        content: 'Launch',
        position: 'start',
        backgroundColor: '#374151',
        color: 'white',
        font: {
          size: 10,
          weight: 'bold'
        },
        padding: 4
      }
    };

    // Add vertical lines and dots for each observation
    selectionHistory.forEach((selection, index) => {
      const obsDate = new Date(selection.observationDate).toISOString().split('T')[0];
      const dateIndex = labels.indexOf(obsDate);

      if (dateIndex !== -1) {
        // Vertical line for observation
        annotations[`obs_line_${index}`] = {
          type: 'line',
          xMin: dateIndex,
          xMax: dateIndex,
          borderColor: '#6b7280',
          borderWidth: 2,
          borderDash: [8, 4],
          label: {
            display: true,
            content: `Obs ${selection.observationNumber}`,
            position: 'start',
            backgroundColor: '#6b7280',
            color: 'white',
            font: {
              size: 9
            },
            padding: 3
          }
        };

        // Add dot for the selected underlying only
        const selectedUnderlyingIndex = underlyings.findIndex(u => u.ticker === selection.selectedUnderlying);
        if (selectedUnderlyingIndex !== -1) {
          // Find the data point by searching datasets with the matching label
          const selectedUnderlying = underlyings[selectedUnderlyingIndex];
          const expectedLabel = `${selectedUnderlying.ticker} (${selectedUnderlying.name})`;

          let dataPoint = null;
          for (const dataset of datasets) {
            if (dataset.label === expectedLabel && dataset.data) {
              const point = dataset.data.find(p => p.x === obsDate);
              if (point) {
                dataPoint = point;
                break;
              }
            }
          }

          if (dataPoint) {
            const lineColor = colors[selectedUnderlyingIndex % colors.length];

            annotations[`selection_${index}`] = {
              type: 'point',
              xValue: dateIndex,
              yValue: dataPoint.y,
              backgroundColor: lineColor,
              borderColor: 'white',
              borderWidth: 3,
              radius: 8,
              label: {
                display: true,
                content: `${selection.selectedUnderlying}\n${selection.performanceFormatted}`,
                position: 'top',
                backgroundColor: lineColor,
                color: 'white',
                font: {
                  size: 9,
                  weight: 'bold'
                },
                padding: 6,
                yAdjust: -10
              }
            };
          }
        }
      }
    });

    // Add vertical line for maturity
    const maturityDateStr = maturityDate.toISOString().split('T')[0];
    const maturityIndex = labels.indexOf(maturityDateStr);
    if (maturityIndex !== -1) {
      annotations.maturityDate = {
        type: 'line',
        xMin: maturityIndex,
        xMax: maturityIndex,
        borderColor: '#374151',
        borderWidth: 2,
        borderDash: [5, 5],
        label: {
          display: true,
          content: 'Maturity',
          position: 'end',
          backgroundColor: '#374151',
          color: 'white',
          font: {
            size: 10,
            weight: 'bold'
          },
          padding: 4
        }
      };
    }

    return annotations;
  },

  /**
   * Generate rebased stock data (normalized to 100 at trade date)
   */
  async generateRebasedStockData(ticker, tradeDate, maturityDate, today, seed = 0, underlyingData = null) {
    try {
      // Get historical prices from market data cache
      const tradeDateStr = tradeDate.toISOString().split('T')[0];
      const maturityDateStr = maturityDate.toISOString().split('T')[0];

      console.log(`📊 Himalaya Chart: Looking for historical data - Ticker: ${ticker}, From: ${tradeDateStr}, To: ${maturityDateStr}`);

      // Fetch market data cache document for this ticker
      let cacheDoc = await MarketDataCacheCollection.findOneAsync({
        fullTicker: ticker
      });

      // If not found, try to find by symbol only (in case exchange suffix is wrong)
      if (!cacheDoc) {
        const symbol = ticker.split('.')[0]; // Get just the ticker without exchange
        console.log(`⚠️ No cache for ${ticker}, trying to find ${symbol} with any exchange...`);

        // Try common exchanges
        const exchanges = ['US', 'PA', 'DE', 'LSE', 'CO'];
        for (const exchange of exchanges) {
          const altTicker = `${symbol}.${exchange}`;
          cacheDoc = await MarketDataCacheCollection.findOneAsync({
            fullTicker: altTicker
          });
          if (cacheDoc) {
            console.log(`✅ Found ${symbol} as ${altTicker} in cache`);
            break;
          }
        }
      }

      if (!cacheDoc) {
        console.log(`⚠️ No cache document found for ${ticker} or any variant`);
        return this.generateSyntheticData(tradeDate, maturityDate, today, seed, underlyingData);
      }

      // Check if history exists
      if (!cacheDoc.history || cacheDoc.history.length === 0) {
        console.log(`⚠️ Cache document exists but has no history array for ${ticker}`);
        return this.generateSyntheticData(tradeDate, maturityDate, today, seed, underlyingData);
      }

      console.log(`📊 Found cache for ${ticker} with ${cacheDoc.history.length} total records`);

      // Filter history for the date range
      const history = cacheDoc.history.filter(record => {
        const recordDate = new Date(record.date).toISOString().split('T')[0];
        return recordDate >= tradeDateStr && recordDate <= maturityDateStr;
      });

      console.log(`📊 Himalaya Chart: Found ${history.length} data points for ${ticker}`);

      if (history.length === 0) {
        console.log(`⚠️ No historical data in date range for ${ticker}, generating synthetic data based on actual performance`);
        return this.generateSyntheticData(tradeDate, maturityDate, today, seed, underlyingData);
      }

      // Get initial price (at trade date) - use adjustedClose
      const initialPriceRecord = history.find(p => {
        const recordDate = new Date(p.date).toISOString().split('T')[0];
        return recordDate === tradeDateStr;
      }) || history[0];
      const initialPrice = initialPriceRecord?.adjustedClose || initialPriceRecord?.close || 100;

      console.log(`📊 Initial price for ${ticker} on ${tradeDateStr}: ${initialPrice}`);

      // Rebase all prices to 100 at trade date
      const rebasedData = history.map(record => ({
        x: new Date(record.date).toISOString().split('T')[0],
        y: ((record.adjustedClose || record.close) / initialPrice) * 100
      }));

      return rebasedData;

    } catch (error) {
      console.error(`❌ Error fetching price data for ${ticker}:`, error);
      return this.generateSyntheticData(tradeDate, maturityDate, today, seed, underlyingData);
    }
  },

  /**
   * Generate synthetic performance data as fallback
   * Uses actual underlying performance if available, otherwise creates realistic patterns
   */
  generateSyntheticData(tradeDate, maturityDate, today, seed = 0, underlyingData = null) {
    const labels = [];
    const currentDate = new Date(tradeDate);

    while (currentDate <= maturityDate) {
      labels.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    const todayIndex = Math.floor((today - tradeDate) / (24 * 60 * 60 * 1000));

    // Calculate actual performance from underlying data if available
    let targetPerformance = 0;
    if (underlyingData) {
      const initialPrice = underlyingData.initialPrice || underlyingData.strike;
      const currentPrice = underlyingData.currentPrice;
      if (initialPrice && currentPrice) {
        // Calculate rebased performance (current price relative to initial, rebased to 100)
        targetPerformance = ((currentPrice / initialPrice) * 100) - 100;
        console.log(`📊 Using actual performance for ${underlyingData.ticker}: ${targetPerformance.toFixed(2)}% (${initialPrice} → ${currentPrice})`);
      }
    }

    // Use seed to create different volatility patterns
    const volatilityPhase = seed * Math.PI / 2;

    return labels.map((date, index) => {
      if (index === 0) {
        return { x: date, y: 100 };
      } else if (index <= todayIndex) {
        // Linear interpolation to target performance with volatility
        const progress = index / Math.max(todayIndex, 1);
        const baseValue = 100 + (targetPerformance * progress);
        const volatility = Math.sin(index * 0.1 + volatilityPhase) * 3;
        return { x: date, y: baseValue + volatility };
      } else {
        return null;
      }
    }).filter(point => point !== null);
  }
};
