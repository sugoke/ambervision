import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Phoenix Chart Builder
 *
 * Generates chart configurations specific to Phoenix Autocallable products.
 * Charts include:
 * - Performance evolution vs autocall barrier
 * - Memory coupon visualization
 * - Protection barrier tracking
 */
export const PhoenixChartBuilder = {
  /**
   * Generate chart data for Phoenix product
   */
  async generateChartData(product, evaluation) {
    const phoenixParams = evaluation.phoenixStructure || {};
    const underlyingData = evaluation.underlyings || [];

    // Generate date labels from trade date to maturity
    const tradeDate = new Date(product.tradeDate || product.issueDate || '2024-02-02');
    const maturityDate = new Date(product.maturity || product.maturityDate || '2025-02-18');
    const today = new Date();

    // Generate daily date labels
    const labels = [];
    const currentDate = new Date(tradeDate);
    while (currentDate <= maturityDate) {
      labels.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Get observation dates
    const observationDates = [];
    if (product.observationSchedule && product.observationSchedule.length > 0) {
      product.observationSchedule.forEach(obs => {
        observationDates.push(new Date(obs.observationDate).toISOString().split('T')[0]);
      });
    }

    const observationAnalysis = evaluation.observationAnalysis;
    const datasets = [];

    // Define a color palette with distinct, vibrant colors for up to 10 underlyings
    const colorPalette = [
      '#3b82f6', // Blue
      '#f59e0b', // Amber
      '#8b5cf6', // Purple
      '#ec4899', // Pink
      '#14b8a6', // Teal
      '#f97316', // Orange
      '#06b6d4', // Cyan
      '#a855f7', // Violet
      '#22c55e', // Green
      '#ef4444'  // Red
    ];

    // Add underlying performance datasets
    if (underlyingData && underlyingData.length > 0) {
      for (let index = 0; index < underlyingData.length; index++) {
        const underlying = underlyingData[index];

        // Calculate current performance for synthetic data fallback
        const currentPerformance = underlying.performance || underlying.performancePercent || 0;

        // Generate performance data using actual stock prices rebased to 100
        const performanceData = await this.generateRebasedStockData(
          underlying.fullTicker || `${underlying.ticker}.US`,
          tradeDate,
          maturityDate,
          today,
          currentPerformance // Pass actual performance for synthetic data fallback
        );

        // Use color from palette, cycling if there are more underlyings than colors
        const color = colorPalette[index % colorPalette.length];

        datasets.push({
          label: `${underlying.ticker} (${underlying.name})`,
          data: performanceData,
          borderColor: color,
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

    // Add barrier lines
    const protectionBarrier = phoenixParams.protectionBarrier || 70;
    const couponBarrier = phoenixParams.couponBarrier || protectionBarrier;

    // Autocall barrier (step-down or static)
    if (observationAnalysis && observationAnalysis.observations && observationAnalysis.observations.length > 0) {
      const observations = observationAnalysis.observations;
      const callableObservations = observations.filter(obs => obs.isCallable && obs.autocallLevel !== null);

      if (callableObservations.length > 0) {
        const autocallBarrierData = [];

        observationDates.forEach((obsDateISO, index) => {
          const matchingObs = callableObservations.find(o =>
            new Date(o.observationDate).toISOString().split('T')[0] === obsDateISO
          );

          if (matchingObs) {
            const autocallLevel = matchingObs.autocallLevel;
            autocallBarrierData.push({ x: obsDateISO, y: autocallLevel });

            if (index < observationDates.length - 1) {
              const nextObsDate = new Date(observationDates[index + 1]);
              const dayBefore = new Date(nextObsDate);
              dayBefore.setDate(dayBefore.getDate() - 1);
              autocallBarrierData.push({ x: dayBefore.toISOString().split('T')[0], y: autocallLevel });
            } else {
              autocallBarrierData.push({ x: maturityDate.toISOString().split('T')[0], y: autocallLevel });
            }
          }
        });

        if (autocallBarrierData.length > 0) {
          datasets.push({
            label: 'Autocall Level (Step-down)',
            data: autocallBarrierData,
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
      }
    } else {
      const autocallBarrier = phoenixParams.autocallBarrier;
      if (autocallBarrier !== null && autocallBarrier !== undefined) {
        datasets.push({
          label: `Autocall Level (${autocallBarrier}%)`,
          data: labels.map(date => ({ x: date, y: autocallBarrier })),
          borderColor: '#10b981',
          backgroundColor: 'rgba(16, 185, 129, 0.15)',
          borderWidth: 2.5,
          borderDash: [8, 4],
          fill: 'origin',
          pointRadius: 0,
          tension: 0,
          order: 2,
          _needsGradient: true,
          _gradientType: 'autocall'
        });
      }
    }

    // Protection barrier
    datasets.push({
      label: `Protection Barrier (${protectionBarrier}%)`,
      data: labels.map(date => ({ x: date, y: protectionBarrier })),
      borderColor: '#ef4444',
      backgroundColor: 'rgba(239, 68, 68, 0.12)',
      borderWidth: 2.5,
      borderDash: [8, 4],
      fill: 'origin',
      pointRadius: 0,
      tension: 0,
      order: 3,
      _needsGradient: true,
      _gradientType: 'protection'
    });

    // Coupon barrier (if different)
    if (couponBarrier !== protectionBarrier) {
      datasets.push({
        label: `Coupon Barrier (${couponBarrier}%)`,
        data: labels.map(date => ({ x: date, y: couponBarrier })),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.08)',
        borderWidth: 2,
        borderDash: [12, 6],
        fill: false,
        pointRadius: 0,
        tension: 0,
        order: 4
      });
    }

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

    observationDates.forEach((obsDate, index) => {
      const isFinal = index === observationDates.length - 1;
      annotations[`observation_${index}`] = {
        type: 'line',
        xMin: obsDate,
        xMax: obsDate,
        borderColor: isFinal ? '#ef4444' : '#10b981',
        borderWidth: 2,
        borderDash: isFinal ? [] : [5, 5],
        label: {
          display: true,
          content: isFinal ? 'Final' : `Obs ${index + 1}`,
          position: 'start',
          yAdjust: -10,
          backgroundColor: isFinal ? '#ef4444' : '#10b981',
          color: '#ffffff',
          padding: 4,
          font: { size: 10 }
        }
      };
    });

    // Add coupon payment points from observation analysis
    console.log('💰 Phoenix Chart - Checking for coupon payments:');
    console.log('  - observationAnalysis exists:', !!observationAnalysis);
    console.log('  - observations array exists:', !!observationAnalysis?.observations);
    console.log('  - observations count:', observationAnalysis?.observations?.length || 0);

    if (observationAnalysis && observationAnalysis.observations) {
      observationAnalysis.observations.forEach((obs, index) => {
        console.log(`  - Obs ${index}: couponPaid=${obs.couponPaid}, basketPerformance=${obs.basketPerformance}`);

        // Add coupon payment dots
        if (obs.couponPaid && obs.couponPaid > 0) {
          const obsDateISO = observationDates[index];

          // Find the date index in labels array for xValue (Chart.js needs index for category scale)
          const dateIndex = labels.indexOf(obsDateISO);

          // Find the performance level at this observation date
          let yPosition = 110; // Default position above the 100% line

          // Try to get the actual performance level at this date if available
          if (obs.basketPerformance) {
            yPosition = Math.max(obs.basketPerformance + 5, 105); // Position above performance level
          }

          console.log(`  ✅ Adding coupon dot at ${obsDateISO} (index ${dateIndex}), y=${yPosition}, amount=${obs.couponPaid}`);

          annotations[`coupon_${index}`] = {
            type: 'point',
            xValue: dateIndex, // Use index for category scale, not date string
            yValue: yPosition,
            backgroundColor: '#f59e0b', // Orange for coupon
            borderColor: '#ffffff',
            borderWidth: 3,
            radius: 8,
            label: {
              display: true,
              content: `💰 ${obs.couponPaid.toFixed(1)}%`,
              position: 'top',
              yAdjust: -15,
              backgroundColor: '#f59e0b',
              color: '#ffffff',
              padding: 6,
              font: {
                size: 11,
                weight: 'bold'
              },
              borderRadius: 4
            }
          };
        }

        // Add memory lock flags - triangle annotations for each newly flagged underlying
        if (observationAnalysis.hasMemoryAutocall && obs.underlyingFlags && obs.underlyingFlags.length > 0) {
          const obsDateISO = observationDates[index];
          const dateIndex = labels.indexOf(obsDateISO);

          // Filter underlyings that were newly flagged at this observation
          const newlyFlagged = obs.underlyingFlags.filter(flag => flag.isNewFlag);

          if (newlyFlagged.length > 0 && dateIndex !== -1) {
            console.log(`  🔒 Adding memory lock triangles at ${obsDateISO}:`, newlyFlagged.map(f => f.ticker));

            // For each newly flagged underlying, add a triangle on its performance line
            newlyFlagged.forEach((flag, flagIndex) => {
              // Find the underlying's dataset to get its color and actual performance data
              const underlyingDataset = datasets.find(ds => ds.label.startsWith(flag.ticker));
              const underlyingColor = underlyingDataset?.borderColor || '#10b981';

              // Get the actual Y position from the underlying's chart data at this date
              let yPosition = 100; // Default fallback
              if (underlyingDataset && underlyingDataset.data && underlyingDataset.data.length > 0) {
                // Find the data point for this specific date in the underlying's dataset
                const dataPoint = underlyingDataset.data.find(point => {
                  // Compare date strings (data points have x: "YYYY-MM-DD")
                  return point.x === obsDateISO;
                });

                if (dataPoint && dataPoint.y !== undefined) {
                  yPosition = dataPoint.y; // Use the actual rebased performance value
                  console.log(`  🔒 Triangle for ${flag.ticker} at ${obsDateISO}: y=${yPosition} (from chart data)`);
                } else {
                  // Fallback: calculate from performance percentage
                  yPosition = 100 + flag.performance;
                  console.log(`  ⚠️ Triangle for ${flag.ticker} at ${obsDateISO}: using calculated y=${yPosition}`);
                }
              } else {
                yPosition = 100 + flag.performance;
                console.log(`  ⚠️ No dataset found for ${flag.ticker}, using calculated y=${yPosition}`);
              }

              // Use a point annotation with triangle style
              // Chart.js annotation plugin supports pointStyle for point annotations
              annotations[`memorylock_${index}_${flag.ticker}`] = {
                type: 'point',
                xValue: dateIndex,
                yValue: yPosition,
                backgroundColor: '#fbbf24', // Yellow/gold color for lock
                borderColor: '#ffffff',
                borderWidth: 3,
                radius: 12, // Size of the triangle (larger)
                // Point style configuration for triangle
                pointStyle: 'triangle',
                rotation: 0, // Point upward
                label: {
                  display: true,
                  content: `🔒 ${flag.ticker}`,
                  position: flagIndex % 2 === 0 ? 'start' : 'end', // Alternate label positions
                  yAdjust: flagIndex % 2 === 0 ? 12 : -12,
                  backgroundColor: '#fbbf24', // Yellow/gold label background
                  color: '#000000', // Black text for better contrast on yellow
                  padding: 4,
                  font: {
                    size: 9,
                    weight: 'bold'
                  },
                  borderRadius: 3
                },
                drawTime: 'afterDatasetsDraw',
                z: 10
              };
            });
          }
        }
      });
    }

    // Add autocall event indicator if product was called
    if (observationAnalysis && observationAnalysis.productCalled && observationAnalysis.callDate) {
      const callDateISO = new Date(observationAnalysis.callDate).toISOString().split('T')[0];
      const callDateIndex = labels.indexOf(callDateISO);

      // Find which observation triggered the autocall
      const callObservation = observationAnalysis.observations.find(obs => obs.productCalled);
      if (callObservation && callDateIndex !== -1) {
        const performance = callObservation.basketPerformance || 0;
        const autocallLevel = callObservation.autocallLevel || 100;

        // Add vertical line for redemption date
        annotations['redemption_line'] = {
          type: 'line',
          xMin: callDateISO,
          xMax: callDateISO,
          borderColor: '#fbbf24', // Gold color
          borderWidth: 3,
          borderDash: [5, 5],
          label: {
            display: true,
            content: 'REDEEMED',
            position: 'start',
            yAdjust: -10,
            backgroundColor: '#fbbf24',
            color: '#000000',
            padding: 6,
            font: {
              size: 11,
              weight: 'bold'
            },
            borderRadius: 4
          }
        };

        // Add a spectacular star-burst indicator at the autocall level
        annotations['autocall_event'] = {
          type: 'point',
          xValue: callDateIndex, // Use index for category scale
          yValue: Math.max(performance, autocallLevel + 5),
          backgroundColor: '#fbbf24', // Gold color
          borderColor: '#ffffff',
          borderWidth: 3,
          radius: 12,
          label: {
            display: true,
            content: `🚀 AUTOCALL! +${performance.toFixed(1)}%`,
            position: 'top',
            yAdjust: -25,
            backgroundColor: '#fbbf24',
            color: '#000000',
            padding: 8,
            font: {
              size: 12,
              weight: 'bold'
            },
            borderRadius: 6
          }
        };
      }
    }

    // Add maturity redemption line if product has matured (not autocalled)
    if (!observationAnalysis?.productCalled) {
      const currentStatus = evaluation.currentStatus;
      const hasMatured = currentStatus?.hasMatured || currentStatus?.productStatus === 'matured';

      if (hasMatured && currentStatus?.statusDetails?.maturedDate) {
        const maturityDateISO = new Date(currentStatus.statusDetails.maturedDate).toISOString().split('T')[0];

        // Add vertical line for maturity redemption date
        annotations['redemption_line'] = {
          type: 'line',
          xMin: maturityDateISO,
          xMax: maturityDateISO,
          borderColor: '#6366f1', // Blue color for maturity
          borderWidth: 3,
          borderDash: [5, 5],
          label: {
            display: true,
            content: 'MATURED',
            position: 'start',
            yAdjust: -10,
            backgroundColor: '#6366f1',
            color: '#ffffff',
            padding: 6,
            font: {
              size: 11,
              weight: 'bold'
            },
            borderRadius: 4
          }
        };
      }
    }

    const annotationKeys = Object.keys(annotations);
    const couponAnnotationKeys = annotationKeys.filter(k => k.startsWith('coupon_'));
    const memoryLockAnnotationKeys = annotationKeys.filter(k => k.startsWith('memorylock_'));
    console.log(`📊 Phoenix Chart Summary:`);
    console.log(`  - Total annotations: ${annotationKeys.length}`);
    console.log(`  - Coupon annotations: ${couponAnnotationKeys.length}`);
    console.log(`  - Memory Lock annotations: ${memoryLockAnnotationKeys.length}`);
    console.log(`  - Annotation keys:`, annotationKeys);

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

    // CRITICAL: Ensure protection barrier is fully visible with padding below it
    // If protection barrier exists, make sure Y-axis minimum is at least 10-15% below it
    if (protectionBarrier) {
      const barrierWithPadding = protectionBarrier - 15; // 15% padding below barrier
      minY = Math.min(minY, barrierWithPadding);
    }

    // Add padding to Y-axis range
    const yRange = maxY - minY;
    minY = Math.floor(minY - yRange * 0.05); // Reduced padding since we already added specific barrier padding
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
            text: `${product.title || 'Phoenix Autocallable'} - Performance Chart`,
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
        chartTitle: `${product.title || 'Phoenix Autocallable'} - Performance Chart`,
        chartType: 'phoenix_performance',
        generatedAt: new Date().toISOString()
      }
    };
  },

  /**
   * Generate rebased stock data (normalized to 100 at trade date)
   * @param {string} ticker - The stock ticker (e.g., "MRNA.US")
   * @param {Date} tradeDate - Product trade date
   * @param {Date} maturityDate - Product maturity date
   * @param {Date} today - Current date
   * @param {number} currentPerformance - Current performance percentage (e.g., -62.56 for -62.56%)
   */
  async generateRebasedStockData(ticker, tradeDate, maturityDate, today, currentPerformance = 0) {
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
        console.log(`📊 No market data cache for ${ticker}, using synthetic data with performance: ${currentPerformance}%`);
        return this.generateSyntheticData(tradeDate, maturityDate, today, currentPerformance);
      }

      const history = cacheDoc.history.filter(record => {
        const recordDate = new Date(record.date).toISOString().split('T')[0];
        return recordDate >= tradeDateStr && recordDate <= maturityDateStr;
      });

      if (history.length === 0) {
        console.log(`📊 No history data in range for ${ticker}, using synthetic data with performance: ${currentPerformance}%`);
        return this.generateSyntheticData(tradeDate, maturityDate, today, currentPerformance);
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
      return this.generateSyntheticData(tradeDate, maturityDate, today, currentPerformance);
    }
  },

  /**
   * Generate synthetic performance data as fallback
   * Uses actual performance from evaluation to create realistic chart data
   * @param {Date} tradeDate - Product trade date
   * @param {Date} maturityDate - Product maturity date
   * @param {Date} today - Current date
   * @param {number} targetPerformance - Target performance percentage at today (e.g., -62.56 for -62.56%)
   */
  generateSyntheticData(tradeDate, maturityDate, today, targetPerformance = 0) {
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
        // Use actual performance to create realistic progression
        // Performance is percentage change from 100 (e.g., -62.56 means final value of 37.44)
        const baseProgress = (targetPerformance * index) / Math.max(todayIndex, 1);
        // Add some volatility but scale it based on the magnitude of performance
        const volatilityScale = Math.min(Math.abs(targetPerformance) * 0.1, 5);
        const volatility = Math.sin(index * 0.15) * volatilityScale;
        return { x: date, y: 100 + baseProgress + volatility };
      } else {
        return null;
      }
    }).filter(point => point !== null);
  }
};
