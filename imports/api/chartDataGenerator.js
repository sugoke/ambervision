/**
 * ChartDataGenerator - Generic chart data generation system for structured products
 * 
 * ARCHITECTURE PRINCIPLE: All chart data is pre-calculated during report processing.
 * The UI never performs calculations - it only displays the pre-built chart object.
 * 
 * Features:
 * - Rebased underlying performance from initial to final date
 * - Time-aware chart display (shows progress line to today, extends axis to maturity)
 * - Vertical annotations for key dates (initial, final, observations)
 * - Generic event points (coupons, autocalls, memory events, barriers)
 * - Light grid and proper axis formatting
 * - Complete Chart.js configuration with all styling and plugins
 */
export class ChartDataGenerator {
  constructor() {
    this.version = '1.0.0';
    this.colors = {
      primary: ['#60a5fa', '#34d399', '#fbbf24', '#f87171', '#a78bfa', '#f472b6'],
      barriers: {
        protection: '#f87171',      // Light red for protection barrier
        autocall: '#34d399',        // Light green for autocall level
        coupon: '#fbbf24',          // Light orange for coupon barrier
        upper: '#a78bfa',           // Light purple for upper barriers
        reference: '#d1d5db'        // Light gray for reference lines
      },
      events: {
        couponPayment: '#34d399',   // Light green for coupon payments
        autocall: '#60a5fa',        // Light blue for autocalls
        barrier: '#f87171',         // Light red for barrier touches
        observation: '#d1d5db'      // Light gray for observations
      }
    };
  }

  /**
   * Generate comprehensive chart data for a structured product
   * Creates a complete, self-contained chart object with all necessary data and configuration
   * @param {Object} product - Product configuration
   * @param {Object} evaluationResults - Evaluation results from rule engine
   * @param {Object} marketData - Market data context with prices and dates
   * @param {Object} options - Generation options (evaluationDate, etc.)
   * @returns {Promise<Object>} Complete chart data object for UI consumption
   */
  async generateChart(product, evaluationResults, marketData = null, options = {}) {
    try {
      const evaluationDate = new Date(options.evaluationDate || new Date());
      const today = new Date();
      
      // Generate date range (x-axis) - from initial date to final date
      const dateRange = this.generateDateRange(product, evaluationDate);
      
      // Generate rebased underlying performance datasets
      const underlyingData = await this.generateRebasedUnderlyingDatasets(product, dateRange, marketData, evaluationDate);      // Generate barrier level datasets
      const barrierData = this.generateBarrierDatasets(product, dateRange, evaluationResults);      // Generate vertical line annotations for key dates
      const verticalAnnotations = this.generateVerticalAnnotations(product, evaluationResults, dateRange);      // Generate event point annotations (coupons, autocalls, memory events)
      const eventAnnotations = this.generateEventPointAnnotations(product, evaluationResults, marketData, dateRange);      // Combine all datasets
      const allDatasets = [
        ...underlyingData.datasets,
        ...barrierData.datasets
      ];
      
      // Create complete Chart.js configuration with all styling and plugins
      const chartData = {
        // Chart.js configuration
        type: 'line',
        data: {
          labels: dateRange.labels,
          datasets: allDatasets
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
              text: `${product.title || product.productName} - Performance Chart`,
              font: { size: 16, weight: 'bold' },
              color: '#f3f4f6'
            },
            legend: {
              display: true,
              position: 'top',
              labels: {
                usePointStyle: true,
                padding: 15,
                color: '#d1d5db',
                font: { size: 12 },
                filter: (legendItem) => {
                  // Hide reference lines from legend if too many items
                  return !(allDatasets.length > 8 && legendItem.text.includes('Initial Level'));
                }
              }
            },
            tooltip: {
              enabled: true,
              backgroundColor: 'rgba(31, 41, 55, 0.9)',
              titleColor: '#ffffff',
              bodyColor: '#ffffff',
              borderColor: '#6b7280',
              borderWidth: 1,
              callbacks: {
                title: (context) => {
                  const date = new Date(context[0].label);
                  return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                  });
                },
                label: (context) => {
                  let label = context.dataset.label || '';
                  if (label) label += ': ';
                  if (context.parsed.y !== null) {
                    label += context.parsed.y.toFixed(2) + '%';
                  }
                  return label;
                }
              }
            },
            annotation: {
              annotations: {
                ...verticalAnnotations,
                ...eventAnnotations
              }
            }
          },
          scales: {
            x: {
              type: 'category',
              grid: {
                display: true,
                color: 'rgba(209, 213, 219, 0.1)',
                drawBorder: false
              },
              ticks: {
                maxRotation: 45,
                minRotation: 0,
                color: '#d1d5db',
                font: { size: 11 },
                maxTicksLimit: Math.min(12, Math.ceil(dateRange.labels.length / 30)), // Show roughly monthly ticks
                callback: (value, index, values) => {
                  const dateStr = dateRange.labels[index];
                  return this.formatXAxisLabel(dateStr, product, index, dateRange.labels.length);
                }
              }
            },
            y: {
              type: 'linear',
              beginAtZero: false,
              ...this.calculateYAxisRange(allDatasets),
              grid: {
                display: true,
                color: 'rgba(209, 213, 219, 0.1)',
                drawBorder: false
              },
              ticks: {
                color: '#d1d5db',
                font: { size: 11 },
                callback: (value) => value.toFixed(1) + '%'
              }
            }
          }
        },
        
        // Metadata for the chart component (not displayed but used by UI)
        metadata: {
          productId: product._id,
          productTitle: product.title || product.productName,
          productIsin: product.isin,
          chartTitle: `${product.title || product.productName} - Performance Evolution`,
          initialDate: product.tradeDate || product.valueDate,
          finalDate: product.maturity || product.maturityDate,
          evaluationDate: evaluationDate.toISOString(),
          todaysDate: today.toISOString(),
          timeToMaturity: this.calculateTimeToMaturity(product, evaluationDate),
          observationDates: this.extractObservationDates(product),
          couponDates: this.extractCouponDates(evaluationResults),
          eventDates: this.extractAllEventDates(evaluationResults),
          productType: this.detectProductType(product),
          hasMatured: evaluationDate >= new Date(product.maturity || product.maturityDate),
          dataPoints: dateRange.labels.length,
          underlyingCount: product.underlyings?.length || 0,
          barrierCount: barrierData.datasets.length,
          eventCount: Object.keys(eventAnnotations).length,
          generatedAt: new Date().toISOString(),
          version: '2.0.0'
        }
      };
      
      return chartData;
      
    } catch (error) {
      return {
        error: true,
        errorMessage: error.message,
        available: false,
        metadata: {
          productId: product._id,
          errorGenerated: true,
          generatedAt: new Date().toISOString()
        }
      };
    }
  }
  
  /**
   * Generate optimized date range for x-axis with smart sampling
   * Creates a timeline with first of month dates plus important observation dates
   * @param {Object} product - Product configuration
   * @param {Date} evaluationDate - Current evaluation date
   * @returns {Object} Date range with labels, dates, and metadata
   */
  generateDateRange(product, evaluationDate = new Date()) {
    // Validate product dates with fallbacks
    // Use Trade Date as the start date for all calculations (per user requirement)
    const startDateStr = product.tradeDate || product.valueDate || product.createdAt;
    const finalDateStr = product.finalObservation || product.maturity || product.maturityDate;
    
    if (!startDateStr) {
    }
    if (!finalDateStr) {
    }
    
    const startDate = startDateStr ? new Date(startDateStr) : new Date(evaluationDate);
    const finalDate = finalDateStr ? new Date(finalDateStr) : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
    const today = new Date();
    
    // Validate that dates are valid
    if (isNaN(startDate.getTime())) {
      startDate.setTime(today.getTime());
    }
    if (isNaN(finalDate.getTime())) {
      finalDate.setTime(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
    }
    
    // Chart should end at final date (no extension beyond maturity)
    const chartEndDate = finalDate;
    
    // Extract important observation dates from product structure
    const importantDates = this.extractImportantDates(product);
    
    // Generate ALL daily dates for data points (full price history)
    const dates = [];
    const labels = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= chartEndDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      dates.push(new Date(currentDate));
      labels.push(dateStr);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    
    return {
      dates,
      labels,
      startDate,
      finalDate,
      chartEndDate,
      evaluationDate,
      today,
      totalDays: labels.length,
      tradingDaysToMaturity: this.calculateTradingDays(today, finalDate),
      daysFromInitial: this.calculateTradingDays(startDate, today),
      hasMatured: evaluationDate >= finalDate,
      importantDates: importantDates.map(d => d.toISOString().split('T')[0])
    };
  }
  
  /**
   * Extract important dates from product structure (observations, barriers, etc.)
   * ONLY processes the actual drag-and-drop payoff structure mechanism
   * IGNORES hardcoded observationDates and observationFrequency fields
   * @param {Object} product - Product configuration
   * @returns {Array} Array of important Date objects
   */
  extractImportantDates(product) {
    const importantDates = [];
    
    try {
      
      // Extract observation dates from payoff structure ONLY
      if (product.payoffStructure) {
        product.payoffStructure.forEach(component => {
          // Look for observation components with specific dates
          if (component.type === 'observation' && component.date) {
            importantDates.push(new Date(component.date));
          }
          
          // Look for timing components
          if (component.type === 'timing' && component.date) {
            importantDates.push(new Date(component.date));
          }
          
          // Look for barrier observation dates (if explicitly set in component)
          if ((component.type === 'barrier' || component.type === 'autocall') && component.observationDate) {
            importantDates.push(new Date(component.observationDate));
          }
        });
      }
      
      // Extract from schedule if it exists (legacy support)
      if (product.schedule && Array.isArray(product.schedule)) {
        product.schedule.forEach(scheduleItem => {
          if (scheduleItem.date) {
            importantDates.push(new Date(scheduleItem.date));
          }
          if (scheduleItem.observationDate) {
            importantDates.push(new Date(scheduleItem.observationDate));
          }
        });
      }
      
      // COMPLETELY IGNORE hardcoded frequency fields
      
      // Filter out invalid dates and sort
      const validDates = importantDates.filter(date => !isNaN(date.getTime()));
      
      if (validDates.length === 0) {
      }
      return validDates.sort((a, b) => a - b);
      
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if product has quarterly observation structure
   * @param {Object} product - Product configuration
   * @returns {boolean} True if quarterly structure detected
   */
  hasQuarterlyStructure(product) {
    if (product.payoffStructure) {
      return product.payoffStructure.some(component => 
        component.label && component.label.toLowerCase().includes('quarterly')
      );
    }
    return false;
  }

  /**
   * Generate quarterly observation dates based on product launch
   * @param {Object} product - Product configuration
   * @returns {Array} Array of quarterly Date objects
   */
  generateQuarterlyDates(product) {
    const quarterlyDates = [];
    const startDate = new Date(product.tradeDate || product.valueDate || product.createdAt);
    const endDate = new Date(product.maturity || product.maturityDate);
    
    let currentQuarterDate = new Date(startDate);
    currentQuarterDate.setMonth(currentQuarterDate.getMonth() + 3);
    
    while (currentQuarterDate < endDate) {
      quarterlyDates.push(new Date(currentQuarterDate));
      currentQuarterDate.setMonth(currentQuarterDate.getMonth() + 3);
    }
    
    return quarterlyDates;
  }
  
  /**
   * Generate rebased underlying performance datasets (rebased to 100 at initial date)
   * Shows performance evolution from initial to final date, stopping at today if maturity is future
   * @param {Object} product - Product configuration  
   * @param {Object} dateRange - Date range information
   * @param {Object} marketData - Pre-fetched market data from rule engine
   * @param {Date} evaluationDate - Current evaluation date
   * @returns {Promise<Object>} Rebased underlying datasets with complete styling
   */
  async generateRebasedUnderlyingDatasets(product, dateRange, marketData = null, evaluationDate = new Date()) {
    const datasets = [];
    
    if (!product.underlyings || product.underlyings.length === 0) {      // Add 100% initial level reference line
      datasets.push(this.createReferenceLine(dateRange, '100%'));
      return { datasets };
    }
    
    // Check if we have market context data from rule engine evaluation
      return this.generateDatasetsFromMarketContext(product, dateRange, marketData, evaluationDate);
    }
    
    try {
      // Import price service for market data fetching
      const { PriceService } = await import('./priceService.js');
      const priceService = new PriceService();
      
      let colorIndex = 0;
      
      for (const underlying of product.underlyings) {
        if (!underlying.ticker) {
          continue;
        }        const rebasedData = [];
        let initialPrice = null;
        let initialDate = null;
        let dataPointsGenerated = 0;
        
        // Generate rebased performance data up to today (or evaluation date if earlier)
        const cutoffDate = new Date(Math.min(evaluationDate.getTime(), new Date().getTime()));
        
        for (const date of dateRange.dates) {
          // Stop generating price data after today/evaluation date
          if (date > cutoffDate) {
            break;
          }
          
          let price = null;
          
          // ALWAYS fetch historical price for each specific date
          // Pre-fetched market data only contains current/final prices, not historical
          price = await priceService.getPrice(underlying.ticker, date, 'close');
          
          // If price service fails, only then use current price as fallback (creates flat line warning)
          if (price === null && marketData && marketData.underlyings) {
            const underlyingMarketData = marketData.underlyings.find(u => u.ticker === underlying.ticker);
            if (underlyingMarketData && underlyingMarketData.currentPrice) {
              price = underlyingMarketData.currentPrice;
            }
          }
          
          if (price !== null && price > 0) {
            // Set initial price from first valid data point
            if (initialPrice === null) {
              initialPrice = price;
              initialDate = new Date(date);
            }
            
            // Calculate rebased performance (normalized to 100 at initial date)
            const rebasedPerformance = (price / initialPrice) * 100;
            rebasedData.push({
              x: date.toISOString().split('T')[0],
              y: Math.round(rebasedPerformance * 100) / 100 // Round to 2 decimal places
            });
            dataPointsGenerated++;
          }
        }
        
        if (rebasedData.length > 0) {
          const color = this.colors.primary[colorIndex % this.colors.primary.length];
          
          datasets.push({
            label: underlying.name || underlying.ticker,
            data: rebasedData,
            borderColor: color,
            backgroundColor: color + '20',
            borderWidth: 2.5,
            fill: false,
            tension: 0.1,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBorderWidth: 2,
            pointHoverBackgroundColor: color,
            isPercentage: true,
            order: 0, // Render on top of barrier fills
            // Additional metadata for the dataset
            underlyingTicker: underlying.ticker,
            underlyingName: underlying.name,
            initialPrice: initialPrice,
            initialDate: initialDate?.toISOString(),
            dataPoints: dataPointsGenerated,
            lastUpdate: new Date().toISOString()
          });          colorIndex++;
        } else {
        }
      }
      
      // Always add 100% reference line for initial level comparison
      datasets.push(this.createReferenceLine(dateRange, 'Initial Level (100%)'));    } catch (error) {
      // Add error dataset
      datasets.push(this.createErrorDataset(dateRange, 'Underlying Data Error'));
    }
    
    return { datasets };
  }
  
  /**
   * Legacy method maintained for backward compatibility
   * @deprecated Use generateRebasedUnderlyingDatasets instead
   */
  async generateUnderlyingDatasets(product, dateRange, options = {}) {
    const datasets = [];
    
    if (!product.underlyings || product.underlyings.length === 0) {      // Add 100% reference line when no underlyings
      datasets.push({
        label: 'Initial Level (100%)',
        data: dateRange.labels.map(label => ({ x: label, y: 100 })),
        borderColor: this.colors.barriers.reference,
        backgroundColor: this.colors.barriers.reference + '20',
        borderWidth: 1,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0,
        tension: 0,
        isPercentage: true
      });
      
      return { datasets };
    }
    
    try {
      // Get price service
      const { PriceService } = await import('./priceService.js');
      const priceService = new PriceService();
      
      let colorIndex = 0;
      
      for (const underlying of product.underlyings) {
        if (!underlying.ticker) continue;
        
        const priceData = [];
        let initialPrice = null;
        
        // Legacy implementation - basic price fetching
        for (const date of dateRange.dates) {
          if (date > dateRange.today) break;
          
          const price = await priceService.getPrice(underlying.ticker, date, 'close');
          
          if (price !== null) {
            if (initialPrice === null) {
              initialPrice = price;
            }
            
            // Rebase to 100
            const rebasedPrice = (price / initialPrice) * 100;
            priceData.push({
              x: date.toISOString().split('T')[0],
              y: Math.round(rebasedPrice * 100) / 100
            });
          }
        }
        
        if (priceData.length > 0) {
          datasets.push({
            label: underlying.name || underlying.ticker,
            data: priceData,
            borderColor: this.colors.primary[colorIndex % this.colors.primary.length],
            backgroundColor: this.colors.primary[colorIndex % this.colors.primary.length] + '20',
            borderWidth: 2,
            fill: false,
            tension: 0.1,
            pointRadius: 0,
            pointHoverRadius: 4,
            isPercentage: true
          });
          colorIndex++;
        }
      }
      
      // Add 100% reference line
      datasets.push({
        label: 'Initial Level (100%)',
        data: dateRange.labels.map(label => ({ x: label, y: 100 })),
        borderColor: this.colors.barriers.reference,
        backgroundColor: this.colors.barriers.reference + '20',
        borderWidth: 1,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0,
        tension: 0,
        isPercentage: true
      });
      
    } catch (error) {
    }
    
    return { datasets };
  }
  
  /**
   * Generate datasets from market context data (from rule engine evaluation)
   * Creates performance datasets using available market data for matured products
   * @param {Object} product - Product configuration  
   * @param {Object} dateRange - Date range information
   * @param {Object} marketData - Market context from rule engine evaluation
   * @param {Date} evaluationDate - Current evaluation date
   * @returns {Object} Rebased underlying datasets
   */
  generateDatasetsFromMarketContext(product, dateRange, marketData, evaluationDate) {
    const datasets = [];
    
    for (const underlying of product.underlyings) {
      if (!underlying.ticker && !underlying.symbol) {
        continue;
      }
      
      const symbol = underlying.ticker || underlying.symbol;
      const marketUnderlying = marketData.underlyings[symbol];
      
      if (!marketUnderlying) {
        continue;
      }      // Use trade price as the reference for chart rebasing
      const tradePrice = marketUnderlying.tradePrice || marketUnderlying.strike;
      const currentPrice = marketUnderlying.currentPrice || marketUnderlying.redemptionPrice;
      
      if (!tradePrice || !currentPrice) {
        continue;
      }
      
      // Use pre-prepared historical price data from market context
      const performanceData = [];      // Check if we have pre-prepared chart data from the market context
      if (marketUnderlying.chartData && marketUnderlying.chartData.length > 0) {        // Use the pre-calculated rebased performance data
        for (const pricePoint of marketUnderlying.chartData) {
          performanceData.push({
            x: pricePoint.date,
            y: pricePoint.rebasedPerformance
          });
        }        if (performanceData.length > 0) {
        }
      } else {
        
        // Fallback to simple start/end values if no historical data available
        const strikePrice = marketUnderlying.strikePrice || tradePrice;
        const startPerformance = (tradePrice / strikePrice) * 100;
        const endPerformance = (currentPrice / strikePrice) * 100;
        
        performanceData.push({ 
          x: dateRange.labels[0], 
          y: Math.round(startPerformance * 100) / 100 
        });
        performanceData.push({ 
          x: dateRange.labels[dateRange.labels.length-1], 
          y: Math.round(endPerformance * 100) / 100 
        });      }
      
      if (performanceData.length > 0) {
        const color = this.colors.primary[colorIndex % this.colors.primary.length];
        
        datasets.push({
          label: underlying.name || symbol,
          data: performanceData,
          borderColor: color,
          backgroundColor: color + '20',
          borderWidth: 2.5,
          fill: false,
          tension: 0.1,
          pointRadius: 0,
          pointHoverRadius: 4,
          isPercentage: true,
          order: 0 // Render on top of barrier fills
        });
        
        colorIndex++;
      }
    }
    
    if (datasets.length === 0) {    }
    
    return { datasets };
  }
  
  /**
   * Generate barrier level datasets
   * @param {Object} product - Product configuration
   * @param {Object} dateRange - Date range information
   * @param {Object} evaluationResults - Evaluation results
   * @returns {Object} Barrier datasets
   */
  generateBarrierDatasets(product, dateRange, evaluationResults) {
    const datasets = [];
    const barriers = this.extractBarrierLevels(product, evaluationResults);
    
    // Always add 100% reference line (initial level)
    datasets.push({
      label: 'Initial Level (100%)',
      data: dateRange.labels.map(label => ({ x: label, y: 100 })),
      borderColor: this.colors.barriers.reference,
      backgroundColor: this.colors.barriers.reference + '15',
      borderWidth: 1.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0,
      tension: 0,
      isPercentage: true,
      isReferenceLine: true
    });
    
    // Protection barrier (always show if detected, even at 100%)
    if (barriers.protection !== null) {
      const protectionData = this.generateDynamicBarrierData(
        barriers.protection, 
        'protection', 
        product, 
        dateRange, 
        evaluationResults
      );
      
      // Protection barrier line with gradient fill
      datasets.push({
        label: `Capital Protection Barrier`,
        data: protectionData,
        borderColor: this.colors.barriers.protection,
        backgroundColor: this.colors.barriers.protection + '30', // Semi-transparent fill
        borderWidth: 3, // Thicker line to distinguish from reference
        borderDash: [8, 3], // Different dash pattern
        fill: 'start', // Fill from line to bottom of chart
        pointRadius: 0,
        tension: 0,
        isPercentage: true,
        isBarrierLine: true,
        order: 1 // Behind stock lines
      });
    }
    
    // Autocall levels (can vary with step-down)
    if (barriers.autocall && barriers.autocall.length > 0) {
      const autocallData = this.generateDynamicBarrierData(
        barriers.autocall, 
        'autocall', 
        product, 
        dateRange, 
        evaluationResults
      );
      
      // Autocall barrier line with gradient fill
      datasets.push({
        label: 'Autocall Level',
        data: autocallData,
        borderColor: this.colors.barriers.autocall,
        backgroundColor: this.colors.barriers.autocall + '25', // Semi-transparent fill
        borderWidth: 2,
        borderDash: [10, 5],
        fill: 'origin', // Fill from line to bottom of chart (y=0)
        pointRadius: 0,
        tension: 0,
        isPercentage: true,
        isBarrierLine: true,
        order: 1 // Render first (behind all other datasets)
      });
    }
    
    // Coupon barriers (can vary with step-down)
    if (barriers.coupon && barriers.coupon.length > 0) {
      const couponData = this.generateStepDownData(barriers.coupon, dateRange, product);
      
      // Coupon barrier line with gradient fill
      datasets.push({
        label: 'Coupon Barrier',
        data: couponData,
        borderColor: this.colors.barriers.coupon,
        backgroundColor: this.colors.barriers.coupon + '20', // Semi-transparent fill
        borderWidth: 2,
        borderDash: [8, 4],
        fill: 'origin', // Fill from line to bottom of chart (y=0)
        pointRadius: 0,
        tension: 0,
        isPercentage: true,
        isBarrierLine: true,
        order: 1 // Render first (behind all other datasets)
      });
    }
    
    // Upper barriers (if present)
    if (barriers.upper !== null && barriers.upper !== 100) {
      datasets.push({
        label: `Upper Barrier (${barriers.upper}%)`,
        data: dateRange.labels.map(label => ({ x: label, y: barriers.upper })),
        borderColor: this.colors.barriers.upper,
        backgroundColor: this.colors.barriers.upper + '20',
        borderWidth: 2,
        borderDash: [3, 3],
        fill: false,
        pointRadius: 0,
        tension: 0,
        isPercentage: true,
        isBarrierLine: true
      });
    }
    
    // Add any additional important levels from evaluation results
    const additionalLevels = this.extractAdditionalBarrierLevels(evaluationResults);
    additionalLevels.forEach((levelInfo, index) => {
      if (levelInfo.level && levelInfo.level !== 100 && 
          !datasets.find(d => d.data.some(point => point.y === levelInfo.level))) {
        
        datasets.push({
          label: `${levelInfo.type} Level (${levelInfo.level}%)`,
          data: dateRange.labels.map(label => ({ x: label, y: levelInfo.level })),
          borderColor: levelInfo.color || '#9ca3af',
          backgroundColor: (levelInfo.color || '#9ca3af') + '20',
          borderWidth: 1.5,
          borderDash: [6, 3],
          fill: false,
          pointRadius: 0,
          tension: 0,
          isPercentage: true,
          isBarrierLine: true
        });
      }
    });    return { datasets };
  }
  
  /**
   * Generate vertical line annotations for all key dates
   * Creates vertical lines for initial date, final date, and all observation dates
   * Each line includes proper styling and descriptive labels
   * @param {Object} product - Product configuration
   * @param {Object} evaluationResults - Evaluation results
   * @param {Object} dateRange - Date range information for index calculation
   * @returns {Object} Vertical line annotations for Chart.js annotation plugin
   */
  generateVerticalAnnotations(product, evaluationResults, dateRange) {    const annotations = {};
    
    // Helper function to find date index in labels array
    const findDateIndex = (targetDate) => {
      if (!targetDate) return -1;
      
      const targetDateStr = new Date(targetDate).toISOString().split('T')[0];
      let index = dateRange.labels.findIndex(label => label === targetDateStr);
      
      // Fallback: find closest date if exact match fails
      if (index === -1) {
        const targetTime = new Date(targetDate).getTime();
        let closestIndex = -1;
        let closestDiff = Infinity;
        
        dateRange.labels.forEach((label, i) => {
          const labelTime = new Date(label).getTime();
          const diff = Math.abs(labelTime - targetTime);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestIndex = i;
          }
        });
        
        if (closestDiff < 7 * 24 * 60 * 60 * 1000) { // Within 7 days
          index = closestIndex;
        }
      }
      
      return index;
    };
    
    // Initial/Launch Date - Removed per user request
    // Launch date annotation has been disabled
    
    // Observation Dates - only show if explicitly defined
    const observationDates = this.extractObservationDates(product);    if (observationDates.length > 0) {
      observationDates.forEach((date, index) => {
        const obsIndex = findDateIndex(date);
        
        if (obsIndex !== -1) {
          const isFinalObservation = index === observationDates.length - 1;
          const label = isFinalObservation ? 'Final' : `Obs ${index + 1}`;
          const color = isFinalObservation ? '#f87171' : '#9ca3af';
          
          annotations[`observation_${index}`] = {
            type: 'line',
            xMin: obsIndex,
            xMax: obsIndex,
            borderColor: color,
            borderWidth: isFinalObservation ? 3 : 2,
            borderDash: isFinalObservation ? [8, 4] : [5, 5],
            label: {
              display: true,
              content: label,
              position: 'end',
              backgroundColor: color,
              color: 'white',
              font: { weight: 'bold', size: 11 },
              padding: { x: 8, y: 4 },
              borderRadius: 4,
              yAdjust: 0
            }
          };        }
      });
    } else {
    }
    
    // Final Observation Date - always show for all products
    const finalObservationDate = product.finalObservation || product.maturity || product.maturityDate;
    if (finalObservationDate) {
      const finalIndex = findDateIndex(finalObservationDate);
      
      if (finalIndex !== -1) {
        annotations.finalObservationDate = {
          type: 'line',
          xMin: finalIndex,
          xMax: finalIndex,
          borderColor: '#ef4444', // Red color for final observation date
          borderWidth: 3,
          borderDash: [10, 5], // Different dash pattern for prominence
          label: {
            display: true,
            content: 'Final',
            position: 'end',
            backgroundColor: '#ef4444',
            color: 'white',
            font: { weight: 'bold', size: 11 },
            padding: { x: 8, y: 4 },
            borderRadius: 4,
            yAdjust: 0
          }
        };      }
    }    return annotations;
  }
  
  /**
   * Legacy method maintained for backward compatibility
   * @deprecated Use generateVerticalAnnotations instead
   */
  generateVerticalLines(product, evaluationResults) {
    const annotations = {};
    
    // Get x-axis labels to find date positions (for Chart.js v3+ annotation plugin)
    const xLabels = this.generateDateRange(product).labels;
    
    // Initial date
    if (product.tradeDate) {
      let initialIndex = xLabels.findIndex(label => label === product.tradeDate);
      
      // If exact match fails, try date parsing
      if (initialIndex === -1) {
        initialIndex = xLabels.findIndex(label => {
          try {
            const labelDate = new Date(label);
            const targetDate = new Date(product.tradeDate);
            return labelDate.toDateString() === targetDate.toDateString();
          } catch (error) {
            return false;
          }
        });
      }
      
      // Initial date annotation removed per user request
    }
    
    // Observation dates (periodic)
    if (product.observationDates && product.observationDates.length > 0) {
      product.observationDates.forEach((date, index) => {
        const isFinal = index === product.observationDates.length - 1;
        let obsIndex = xLabels.findIndex(label => label === date);
        
        // If exact match fails, try date parsing
        if (obsIndex === -1) {
          obsIndex = xLabels.findIndex(label => {
            try {
              const labelDate = new Date(label);
              const targetDate = new Date(date);
              return labelDate.toDateString() === targetDate.toDateString();
            } catch (error) {
              return false;
            }
          });
        }
        
        if (obsIndex !== -1) {
          // For final observation, use "Final Date" label instead of "Final Obs"
          const label = isFinal ? 'Final Date' : `Obs ${index + 1}`;
          const backgroundColor = isFinal ? 'rgba(239, 68, 68, 0.8)' : this.colors.events.observation;
          const borderColor = isFinal ? 'rgba(239, 68, 68, 0.8)' : this.colors.events.observation;
          
          annotations[`observation_${index}`] = {
            type: 'line',
            xMin: obsIndex,
            xMax: obsIndex,
            borderColor: borderColor,
            borderWidth: isFinal ? 3 : 2,
            borderDash: isFinal ? [10, 5] : [5, 5],
            label: {
              enabled: true,
              content: label,
              position: 'end',
              backgroundColor: backgroundColor,
              color: 'white',
              font: { weight: 'bold' },
              padding: 6,
              borderRadius: 6,
              yAdjust: 0
            }
          };
        }
      });
    }
    
    // Skip separate Final Date annotation since final observation is now labeled as "Final Date"    return annotations;
  }
  
  /**
   * Generate generic event point annotations for significant events
   * Creates point markers for coupons, autocalls, barrier touches, memory events, etc.
   * All event types are handled generically without hardcoding specific product logic
   * @param {Object} product - Product configuration
   * @param {Object} evaluationResults - Evaluation results
   * @param {Object} marketData - Market data context
   * @param {Object} dateRange - Date range information
   * @returns {Object} Event point annotations for Chart.js annotation plugin
   */
  generateEventPointAnnotations(product, evaluationResults, marketData, dateRange) {    const annotations = {};
    let annotationCount = 0;
    
    // Helper function to find date index and y-position for events
    const createEventPoint = (eventDate, yLevel, eventType, eventData, color) => {
      const dateStr = new Date(eventDate).toISOString().split('T')[0];
      const xIndex = dateRange.labels.findIndex(label => label === dateStr);
      
      if (xIndex === -1) return null;
      
      return {
        type: 'point',
        xValue: xIndex,
        yValue: yLevel,
        backgroundColor: color,
        borderColor: color,
        borderWidth: 2,
        radius: eventType === 'autocall' ? 8 : 6,
        label: {
          display: true,
          content: eventData.description || eventType,
          backgroundColor: color,
          color: 'white',
          font: { weight: 'bold', size: 10 },
          padding: { x: 6, y: 3 },
          borderRadius: 4,
          position: eventData.labelPosition || 'top'
        },
        // Generic event metadata
        eventType: eventType,
        eventDate: eventDate,
        eventData: eventData
      };
    };
    
    // Extract coupon payment events
    const couponEvents = this.extractCouponEvents(evaluationResults, product);
    couponEvents.forEach((event, index) => {
      const annotation = createEventPoint(
        event.date,
        event.yLevel || 100,
        'coupon',
        {
          description: `Coupon: ${event.rate}%`,
          amount: event.amount,
          rate: event.rate,
          labelPosition: 'top'
        },
        this.colors.events.couponPayment
      );
      
      if (annotation) {
        annotations[`coupon_${index}`] = annotation;
        annotationCount++;
      }
    });
    
    // Extract autocall events
    const autocallEvents = this.extractAutocallEvents(evaluationResults, product);
    autocallEvents.forEach((event, index) => {
      const annotation = createEventPoint(
        event.date,
        event.triggerLevel || 100,
        'autocall',
        {
          description: `Autocall: ${event.payoff}%`,
          payoff: event.payoff,
          triggerLevel: event.triggerLevel,
          labelPosition: 'top'
        },
        this.colors.events.autocall
      );
      
      if (annotation) {
        annotations[`autocall_${index}`] = annotation;
        annotationCount++;
      }
    });
    
    // Extract barrier touch/breach events
    const barrierEvents = this.extractBarrierEvents(evaluationResults, product);
    barrierEvents.forEach((event, index) => {
      const annotation = createEventPoint(
        event.date,
        event.barrierLevel,
        'barrier_touch',
        {
          description: `${event.barrierType} Touch`,
          barrierType: event.barrierType,
          barrierLevel: event.barrierLevel,
          labelPosition: 'bottom'
        },
        this.colors.events.barrier
      );
      
      if (annotation) {
        annotations[`barrier_${index}`] = annotation;
        annotationCount++;
      }
    });
    
    // Extract memory events (for phoenix products)
    const memoryEvents = this.extractMemoryEvents(evaluationResults, product);
    memoryEvents.forEach((event, index) => {
      const annotation = createEventPoint(
        event.date,
        event.yLevel || 95,
        'memory',
        {
          description: `Memory: ${event.amount}%`,
          amount: event.amount,
          memoryType: event.type,
          labelPosition: 'top'
        },
        '#8b5cf6' // Purple for memory events
      );
      
      if (annotation) {
        annotations[`memory_${index}`] = annotation;
        annotationCount++;
      }
    });
    
    // Extract other generic events from evaluation results
    const genericEvents = this.extractGenericEvents(evaluationResults, product);
    genericEvents.forEach((event, index) => {
      const annotation = createEventPoint(
        event.date,
        event.yLevel || 100,
        event.type || 'event',
        {
          description: event.description || `${event.type} Event`,
          details: event.details,
          labelPosition: event.labelPosition || 'top'
        },
        event.color || '#6b7280'
      );
      
      if (annotation) {
        annotations[`event_${index}`] = annotation;
        annotationCount++;
      }
    });    return annotations;
  }
  
  /**
   * Legacy method maintained for backward compatibility
   * @deprecated Use generateEventPointAnnotations instead
   */
  generateEventMarkers(product, evaluationResults, dateRange) {
    const annotations = {};
    
    // Coupon payment events
    const couponPayments = this.extractCouponPayments(evaluationResults);
    couponPayments.forEach((payment, index) => {
      annotations[`coupon_${index}`] = {
        type: 'point',
        xValue: payment.date,
        yValue: payment.level || 50, // Position at relevant level
        backgroundColor: this.colors.events.couponPayment,
        borderColor: this.colors.events.couponPayment,
        borderWidth: 2,
        radius: 6,
        label: {
          enabled: true,
          content: `Coupon: ${payment.amount.toFixed(2)}%`,
          position: 'top'
        }
      };
    });
    
    // Barrier touch events
    const barrierTouches = this.extractBarrierTouches(evaluationResults);
    barrierTouches.forEach((touch, index) => {
      annotations[`barrier_touch_${index}`] = {
        type: 'point',
        xValue: touch.date,
        yValue: touch.level,
        backgroundColor: this.colors.events.barrier,
        borderColor: this.colors.events.barrier,
        borderWidth: 2,
        radius: 5,
        label: {
          enabled: true,
          content: `${touch.type} Touch`,
          position: 'bottom'
        }
      };
    });
    
    // Autocall events
    const autocalls = this.extractAutocalls(evaluationResults);
    autocalls.forEach((autocall, index) => {
      annotations[`autocall_${index}`] = {
        type: 'point',
        xValue: autocall.date,
        yValue: autocall.level,
        backgroundColor: this.colors.events.autocall,
        borderColor: this.colors.events.autocall,
        borderWidth: 3,
        radius: 8,
        label: {
          enabled: true,
          content: `Autocall: ${autocall.return}%`,
          position: 'top'
        }
      };
    });
    
    return annotations;
  }
  
  /**
   * Extract barrier levels from product structure
   * @param {Object} product - Product configuration
   * @param {Object} evaluationResults - Evaluation results
   * @returns {Object} Barrier levels
   */
  extractBarrierLevels(product, evaluationResults) {
    const barriers = {
      protection: null,
      autocall: [],
      coupon: [],
      upper: null
    };
    
    // Extract from evaluation results logic tree (contains actual barrier values used in evaluation)
    if (evaluationResults?.logicTree) {
      Object.values(evaluationResults.logicTree).forEach(sectionRules => {
        if (Array.isArray(sectionRules)) {
          sectionRules.forEach(rule => {
            if (rule.condition?.components) {
              rule.condition.components.forEach(component => {
                if (component.label?.toLowerCase().includes('protection') && component.value) {
                  const value = parseFloat(component.value);
                  if (!isNaN(value)) {
                    barriers.protection = value;
                  }
                } else if (component.label?.toLowerCase().includes('autocall') && component.value) {
                  const value = parseFloat(component.value);
                  if (!isNaN(value)) {
                    barriers.autocall.push({ date: null, level: value });
                  }
                }
              });
            }
          });
        }
      });
    }
    
    // Extract from payoff structure
    if (product.payoffStructure) {
      // Processing payoff structure components
      
      product.payoffStructure.forEach((component, index) => {
        // Processing component
        
        // More inclusive barrier detection (similar to reportGenerator)
        const isBarrierComponent = component.type === 'barrier' || 
                                  component.type === 'autocall' || 
                                  component.type === 'protection' ||
                                  component.type === 'comparison' || // Include comparison components
                                  component.label?.toLowerCase().includes('barrier') || 
                                  component.label?.toLowerCase().includes('protection') ||
                                  component.label?.toLowerCase().includes('autocall');
        
        if (isBarrierComponent) {
          // Found barrier component
          
          // Extract barrier value using multiple fallback methods
          let value = null;
          
          // Use explicit value if set and not empty, otherwise use defaultValue
          const effectiveValue = (component.value !== null && component.value !== undefined && component.value !== '') 
                                ? component.value 
                                : component.defaultValue;
          
          if (effectiveValue) {
            value = parseFloat(effectiveValue.toString().replace('%', ''));
          } else if (component.level) {
            value = parseFloat(component.level.toString().replace('%', ''));
          } else if (component.parameters?.level) {
            value = parseFloat(component.parameters.level.toString().replace('%', ''));
          }
          
          // Barrier value parsed
          // Barrier context analyzed
          
          if (!isNaN(value) && value !== null) {
            // For reporting purposes, show all barriers as reference lines on the chart
            // This includes both conditional barriers (IF thresholds) and unconditional barriers (continuous monitoring)
            if (component.label?.toLowerCase().includes('protection') || component.type === 'protection') {
              barriers.protection = value;
              // Added protection barrier
            } else if (component.label?.toLowerCase().includes('autocall') || component.type === 'autocall') {
              barriers.autocall.push({ date: null, level: value });
              // Added autocall barrier
            } else if (component.label?.toLowerCase().includes('upper')) {
              barriers.upper = value;
              // Added upper barrier
            } else if (component.label?.toLowerCase().includes('coupon')) {
              barriers.coupon.push({ date: null, level: value });
              // Added coupon barrier
            } else {
              // Generic barrier - don't make assumptions based on value alone
              // Check the component's context in the payoff structure
              if (component.label?.toLowerCase().includes('barrier')) {
                // If it's in the maturity section and there's a protection action, it's likely a protection barrier
                if (component.section === 'maturity') {
                  barriers.protection = value;
                  // Generic barrier in maturity section classified as protection
                } else {
                  // Otherwise, it could be an autocall barrier
                  barriers.autocall.push({ date: null, level: value });
                  // Generic barrier classified as autocall
                }
              }
            }
          } else {
            // Could not parse barrier value
          }
        }
      });
    }
    
    // Don't extract barriers from hardcoded product fields - only use what's actually in the payoff structure
    // Extracted barriers from payoff structure
    
    return barriers;
  }
  
  /**
   * Generate step-down data for barriers that change over time
   * @param {Array} barrierData - Array of {date, level} objects
   * @param {Object} dateRange - Date range information
   * @param {Object} product - Product configuration
   * @returns {Array} Chart data points
   */
  generateStepDownData(barrierData, dateRange, product) {
    const data = [];
    let currentLevelIndex = 0;
    
    for (const label of dateRange.labels) {
      const currentDate = new Date(label);
      
      // Find the appropriate barrier level for this date
      while (currentLevelIndex < barrierData.length - 1 && 
             currentDate >= new Date(barrierData[currentLevelIndex + 1].date)) {
        currentLevelIndex++;
      }
      
      const level = barrierData[currentLevelIndex]?.level || barrierData[0]?.level;
      if (level !== undefined) {
        data.push({ x: label, y: level });
      }
    }
    
    return data;
  }
  
  /**
   * Format x-axis labels for optimal readability
   * Shows important dates with descriptive labels and monthly markers
   * @param {string} label - Date label (YYYY-MM-DD)
   * @param {Object} product - Product configuration
   * @param {number} index - Label index in the array
   * @param {number} totalLabels - Total number of labels for optimization
   * @returns {string} Formatted label or empty string
   */
  formatXAxisLabel(label, product, index, totalLabels = 0) {
    // Show important dates
    const importantDates = [
      product.tradeDate,
      product.maturity || product.maturityDate,
      ...(product.observationDates || [])
    ].filter(Boolean);
    
    if (importantDates.includes(label)) {
      if (label === product.tradeDate) return 'Initial';
      if (label === (product.maturity || product.maturityDate)) return 'Maturity';
      const obsIndex = product.observationDates?.indexOf(label);
      if (obsIndex !== -1) {
        return obsIndex === product.observationDates.length - 1 ? 'Final' : `Obs ${obsIndex + 1}`;
      }
    }
    
    // Show monthly markers - optimize frequency based on total chart width
    const monthlyInterval = totalLabels > 365 ? 60 : 30; // Every 2 months if > 1 year data
    if (index % monthlyInterval === 0) {
      const date = new Date(label);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    return '';
  }
  
  /**
   * Detect product type for specialized handling
   * @param {Object} product - Product configuration
   * @returns {string} Product type
   */
  detectProductType(product) {
    if (!product.payoffStructure) return 'unknown';
    
    const hasAutocall = product.payoffStructure.some(c => 
      c.label?.toLowerCase().includes('autocall'));
    const hasProtection = product.payoffStructure.some(c => 
      c.label?.toLowerCase().includes('protection'));
    const hasCoupon = product.payoffStructure.some(c => 
      c.label?.toLowerCase().includes('coupon'));
    const hasMemory = product.payoffStructure.some(c => 
      c.label?.toLowerCase().includes('memory'));
    
    // Return feature-based classification instead of hardcoded product names
    const features = [];
    if (hasAutocall) features.push('autocall');
    if (hasProtection) features.push('protection');
    if (hasCoupon) features.push('coupon');
    if (hasMemory) features.push('memory');
    
    return features.length > 0 ? features.join('_') : 'basic';
  }
  
  // ============================================================================
  // UTILITY METHODS FOR CHART DATA GENERATION
  // ============================================================================
  
  /**
   * Create a reference line dataset (e.g., 100% initial level)
   */
  createReferenceLine(dateRange, label = 'Reference Line', level = 100) {
    return {
      label: label,
      data: dateRange.labels.map(dateLabel => ({ x: dateLabel, y: level })),
      borderColor: this.colors.barriers.reference,
      backgroundColor: this.colors.barriers.reference + '20',
      borderWidth: 1.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0,
      tension: 0,
      isPercentage: true,
      isReferenceLine: true
    };
  }
  
  /**
   * Create an error dataset when data generation fails
   */
  createErrorDataset(dateRange, label = 'Data Error') {
    return {
      label: label,
      data: dateRange.labels.map(dateLabel => ({ x: dateLabel, y: 100 })),
      borderColor: '#ef4444',
      backgroundColor: '#ef444420',
      borderWidth: 2,
      borderDash: [10, 5],
      fill: false,
      pointRadius: 0,
      tension: 0,
      isPercentage: true,
      isErrorDataset: true
    };
  }
  
  /**
   * Calculate trading days between two dates
   */
  calculateTradingDays(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    let tradingDays = 0;
    const currentDate = new Date(start);
    
    while (currentDate <= end) {
      // Count only weekdays (Monday = 1, Sunday = 0)
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        tradingDays++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return tradingDays;
  }
  
  /**
   * Calculate time to maturity in various formats
   */
  calculateTimeToMaturity(product, evaluationDate) {
    if (!product.maturity && !product.maturityDate) return null;
    
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const evalDate = new Date(evaluationDate);
    
    const diffTime = maturityDate.getTime() - evalDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return {
      totalDays: diffDays,
      tradingDays: this.calculateTradingDays(evalDate, maturityDate),
      months: Math.round(diffDays / 30.44),
      years: Math.round(diffDays / 365.25 * 10) / 10,
      hasMatured: diffDays <= 0,
      maturityDate: maturityDate.toISOString()
    };
  }
  
  // ============================================================================
  // EVENT EXTRACTION METHODS (GENERIC, PRODUCT-AGNOSTIC)
  // ============================================================================
  
  /**
   * Extract observation dates from product configuration
   * ONLY processes the actual drag-and-drop payoff structure mechanism
   * IGNORES hardcoded observationDates and observationFrequency fields
   */
  extractObservationDates(product) {
    const dates = [];
    
    
    // ONLY process payoff structure components (the actual mechanism)
    if (product.payoffStructure) {
      
      product.payoffStructure.forEach((component, index) => {
        // Only count components that are explicitly observation types with dates
        if (component.type === 'observation' && component.date) {
          dates.push(component.date);
        }
        // Check for timing components that represent observations
        if (component.type === 'timing' && component.date) {
          dates.push(component.date);
        }
        // Check for observation-related components with explicit dates
        if ((component.type === 'observation_date' || component.type === 'observation_trigger') && component.date) {
          dates.push(component.date);
        }
      });
      
      // Analyze the product structure to understand observation mechanism
      const sections = [...new Set(product.payoffStructure.map(c => c.section))];      const hasLifeSection = sections.includes('life');
      const hasMaturityOnly = sections.length === 1 && sections[0] === 'maturity';
      
      if (hasMaturityOnly) {
      } else if (hasLifeSection) {
      }
    }
    
    // Remove duplicates and sort
    const uniqueDates = [...new Set(dates)].sort();
    
    if (uniqueDates.length > 0) {
    } else {
    }
    
    return uniqueDates;
  }
  
  /**
   * Extract coupon dates from evaluation results and product structure
   */
  extractCouponDates(evaluationResults) {
    const dates = [];
    
    if (evaluationResults?.schedule?.events) {
      evaluationResults.schedule.events.forEach(event => {
        if (event.couponRate && event.couponRate > 0) {
          dates.push(event.date);
        }
      });
    }
    
    return dates.sort();
  }
  
  /**
   * Extract all event dates from evaluation results
   */
  extractAllEventDates(evaluationResults) {
    const events = [];
    
    if (evaluationResults?.schedule?.events) {
      evaluationResults.schedule.events.forEach(event => {
        events.push({
          date: event.date,
          type: event.type,
          description: event.description,
          hasActions: !!(event.couponRate || event.redemptionAmount)
        });
      });
    }
    
    return events;
  }
  
  /**
   * Extract coupon payment events for point annotations
   */
  extractCouponEvents(evaluationResults, product) {
    const events = [];
    
    if (evaluationResults?.schedule?.events) {
      evaluationResults.schedule.events.forEach(event => {
        if (event.couponRate && event.couponRate > 0) {
          events.push({
            date: event.date,
            rate: event.couponRate,
            amount: event.couponRate, // Same as rate for display
            yLevel: 50, // Position at 0% level
            type: 'coupon'
          });
        }
      });
    }
    
    // Also check payoff breakdown for coupon payments
    if (evaluationResults?.payoff?.breakdown) {
      evaluationResults.payoff.breakdown.forEach(item => {
        if (item.toLowerCase().includes('coupon')) {
          // Extract coupon information from breakdown text
          const match = item.match(/(\d+\.?\d*)%/);
          if (match) {
            events.push({
              date: evaluationResults.evaluationDate,
              rate: parseFloat(match[1]),
              amount: parseFloat(match[1]),
              yLevel: 50,
              type: 'coupon'
            });
          }
        }
      });
    }
    
    return events;
  }
  
  /**
   * Extract autocall events for point annotations
   */
  extractAutocallEvents(evaluationResults, product) {
    const events = [];
    
    // Check payoff breakdown for autocall information
    if (evaluationResults?.payoff?.breakdown) {
      evaluationResults.payoff.breakdown.forEach(item => {
        if (item.toLowerCase().includes('autocall')) {
          // Extract autocall payoff from breakdown
          const match = item.match(/(\d+\.?\d*)%/);
          if (match) {
            events.push({
              date: evaluationResults.evaluationDate,
              payoff: parseFloat(match[1]),
              triggerLevel: 100, // Default trigger level
              type: 'autocall'
            });
          }
        }
      });
    }
    
    // Check if product was redeemed early (indicates autocall)
    if (evaluationResults?.summary?.redeemedEarly) {
      events.push({
        date: evaluationResults.evaluationDate,
        payoff: evaluationResults.payoff?.totalPayout || 100,
        triggerLevel: 100,
        type: 'autocall'
      });
    }
    
    return events;
  }
  
  /**
   * Extract barrier touch/breach events
   */
  extractBarrierEvents(evaluationResults, product) {
    const events = [];
    
    // Check summary for barrier information
    if (evaluationResults?.summary) {
      const summary = evaluationResults.summary;
      
      // Protection barrier breach
      if (summary.barrierBreach || summary.protectionBreach) {
        events.push({
          date: evaluationResults.evaluationDate,
          barrierLevel: summary.barrierLevel || 70, // Default barrier level
          barrierType: 'Protection',
          type: 'barrier_breach'
        });
      }
      
      // Autocall barrier touch
      if (summary.autocallTriggered) {
        events.push({
          date: evaluationResults.evaluationDate,
          barrierLevel: 100, // Autocall typically at 100%
          barrierType: 'Autocall',
          type: 'barrier_touch'
        });
      }
    }
    
    return events;
  }
  
  /**
   * Extract memory events (for phoenix-type products)
   */
  extractMemoryEvents(evaluationResults, product) {
    const events = [];
    
    // Check payoff breakdown for memory-related information
    if (evaluationResults?.payoff?.breakdown) {
      evaluationResults.payoff.breakdown.forEach(item => {
        if (item.toLowerCase().includes('memory')) {
          const match = item.match(/(\d+\.?\d*)%/);
          if (match) {
            events.push({
              date: evaluationResults.evaluationDate,
              amount: parseFloat(match[1]),
              yLevel: 95, // Position near but below 100%
              type: 'memory'
            });
          }
        }
      });
    }
    
    return events;
  }
  
  /**
   * Extract other generic events from evaluation results
   */
  extractGenericEvents(evaluationResults, product) {
    const events = [];
    
    // Look for any other significant events in the evaluation results
    if (evaluationResults?.events) {
      evaluationResults.events.forEach(event => {
        events.push({
          date: event.date,
          type: event.type,
          description: event.description,
          yLevel: event.level || 100,
          color: event.color,
          labelPosition: event.labelPosition,
          details: event.details
        });
      });
    }
    
    return events;
  }
  
  /**
   * Extract additional important barrier levels from evaluation results
   * This method identifies any additional levels that should be displayed as horizontal lines
   * @param {Object} evaluationResults - Evaluation results
   * @returns {Array} Array of level objects with type, level, and color
   */
  extractAdditionalBarrierLevels(evaluationResults) {
    const levels = [];
    
    // Check summary for additional barrier information
    if (evaluationResults?.summary) {
      const summary = evaluationResults.summary;
      
      // Cap levels (if present)
      if (summary.capLevel && summary.capLevel !== 100) {
        levels.push({
          type: 'Cap',
          level: summary.capLevel,
          color: '#f59e0b' // Orange
        });
      }
      
      // Floor levels (if present)
      if (summary.floorLevel && summary.floorLevel !== 0) {
        levels.push({
          type: 'Floor',
          level: summary.floorLevel,
          color: '#059669' // Green
        });
      }
      
      // Strike levels from underlyings (normalized to percentage)
      if (summary.strikes) {
        summary.strikes.forEach((strike, index) => {
          if (strike && strike !== 100) {
            levels.push({
              type: `Strike ${index + 1}`,
              level: strike,
              color: '#6366f1' // Indigo
            });
          }
        });
      }
    }
    
    // Check payoff structure for any embedded barrier levels
    if (evaluationResults?.payoff?.breakdown) {
      evaluationResults.payoff.breakdown.forEach(item => {
        // Look for percentage levels mentioned in breakdown
        const matches = item.match(/(\d+\.?\d*)%/g);
        if (matches) {
          matches.forEach(match => {
            const level = parseFloat(match);
            if (level && level !== 100 && level > 0 && level < 200) {
              // Only add if not already present
              if (!levels.find(l => l.level === level)) {
                levels.push({
                  type: 'Threshold',
                  level: level,
                  color: '#6b7280' // Gray
                });
              }
            }
          });
        }
      });
    }
    
    // Check for trigger levels in payoff events
    if (evaluationResults?.events) {
      evaluationResults.events.forEach(event => {
        if (event.triggerLevel && event.triggerLevel !== 100) {
          if (!levels.find(l => l.level === event.triggerLevel)) {
            levels.push({
              type: 'Trigger',
              level: event.triggerLevel,
              color: '#dc2626' // Red
            });
          }
        }
      });
    }
    
    return levels;
  }
  
  // Legacy helper methods for backward compatibility
  extractCouponPayments(evaluationResults) {
    const events = this.extractCouponEvents(evaluationResults);
    return events.map(event => ({
      date: event.date,
      amount: event.amount,
      level: event.yLevel
    }));
  }
  
  extractCouponPaymentDates(evaluationResults) {
    return this.extractCouponPayments(evaluationResults).map(p => p.date);
  }
  
  extractBarrierTouches(evaluationResults) {
    // Extract from timeline or debug logs
    const touches = [];
    if (evaluationResults?.debug?.logs) {
      evaluationResults.debug.logs.forEach(log => {
        if (log.message?.includes('barrier') && log.message?.includes('touch')) {
          // Parse barrier touch events from logs
          touches.push({
            date: log.timestamp,
            type: 'barrier',
            level: 70 // Extract from log message
          });
        }
      });
    }
    return touches;
  }
  
  extractAutocalls(evaluationResults) {
    const autocalls = [];
    if (evaluationResults?.timeline?.events) {
      evaluationResults.timeline.events.forEach(event => {
        if (event.description?.includes('autocall')) {
          autocalls.push({
            date: event.date,
            level: 100, // Extract from event data
            return: event.totalPayoff || 0
          });
        }
      });
    }
    return autocalls;
  }

  /**
   * Calculate Y-axis range with symmetric 10% padding
   * @param {Array} datasets - Chart datasets containing the data points
   * @returns {Object} Object with min and max values for y-axis
   */
  calculateYAxisRange(datasets) {
    try {
      // Extract all numeric y values from all datasets
      const allYValues = datasets.flatMap(dataset => 
        dataset.data.filter(point => typeof point.y === 'number').map(point => point.y)
      );
      
      if (allYValues.length === 0) {
        return { min: 0, max: 100 };
      }
      
      const dataMin = Math.min(...allYValues);
      const dataMax = Math.max(...allYValues);
      const range = dataMax - dataMin;
      
      // Apply symmetric 10% padding above and below
      const padding = range * 0.10;
      const min = dataMin - padding;
      const max = dataMax + padding;
      
      
      return { min, max };
    } catch (error) {
      return { min: 0, max: 100 };
    }
  }

  /**
   * Generate flexible barrier data points that can change values over time periods
   * Supports dynamic barriers like step-down autocalls, quarterly changes, etc.
   * @param {Array|Object|number} barrierValue - Barrier configuration (can be single value or array of time-based values)
   * @param {string} barrierType - Type of barrier ('protection', 'autocall', 'coupon', etc.)
   * @param {Object} product - Product configuration
   * @param {Object} dateRange - Date range information
   * @param {Object} evaluationResults - Evaluation results for context
   * @returns {Array} Array of {x: date, y: barrierValue} data points
   */
  generateDynamicBarrierData(barrierValue, barrierType, product, dateRange, evaluationResults) {
    
    try {
      const dataPoints = [];
      
      // Handle different barrier value formats
      if (Array.isArray(barrierValue)) {
        // Array of time-based barrier values (e.g., step-down barriers)
        
        for (let i = 0; i < dateRange.labels.length; i++) {
          const currentDate = dateRange.labels[i];
          
          // Find applicable barrier value for this date
          let applicableValue = null;
          
          // Look for time-based barrier definitions
          for (const barrierDef of barrierValue) {
            if (barrierDef.startDate && barrierDef.endDate) {
              const startDate = new Date(barrierDef.startDate);
              const endDate = new Date(barrierDef.endDate);
              const currentDateObj = new Date(currentDate);
              
              if (currentDateObj >= startDate && currentDateObj <= endDate) {
                applicableValue = parseFloat(barrierDef.level || barrierDef.value || barrierDef);
                break;
              }
            } else if (barrierDef.quarter) {
              // Quarterly barrier changes
              const quarterStart = this.getQuarterStartDate(barrierDef.quarter, product);
              const quarterEnd = this.getQuarterEndDate(barrierDef.quarter, product);
              const currentDateObj = new Date(currentDate);
              
              if (currentDateObj >= quarterStart && currentDateObj <= quarterEnd) {
                applicableValue = parseFloat(barrierDef.level || barrierDef.value || barrierDef);
                break;
              }
            } else if (i < barrierValue.length) {
              // Use array index for equal time periods
              const periodIndex = Math.floor((i / dateRange.labels.length) * barrierValue.length);
              const barrierDef = barrierValue[periodIndex];
              applicableValue = parseFloat(barrierDef.level || barrierDef.value || barrierDef);
            }
          }
          
          // Fallback to first barrier value if no specific period found
          if (applicableValue === null && barrierValue.length > 0) {
            const firstBarrier = barrierValue[0];
            applicableValue = parseFloat(firstBarrier.level || firstBarrier.value || firstBarrier);
          }
          
          if (applicableValue !== null && !isNaN(applicableValue)) {
            dataPoints.push({ x: currentDate, y: applicableValue });
          }
        }
        
      } else if (typeof barrierValue === 'object' && barrierValue !== null) {
        // Single barrier object with level/value property
        const level = parseFloat(barrierValue.level || barrierValue.value || barrierValue);
        if (!isNaN(level)) {
          
          // Check if this barrier has step-down behavior
          if (barrierValue.stepDown && barrierValue.stepDownSchedule) {
            // Implement step-down logic
            for (let i = 0; i < dateRange.labels.length; i++) {
              const currentDate = dateRange.labels[i];
              const stepDownLevel = this.calculateStepDownLevel(currentDate, barrierValue.stepDownSchedule, level);
              dataPoints.push({ x: currentDate, y: stepDownLevel });
            }
          } else {
            // Static barrier level for all dates
            dataPoints.push(...dateRange.labels.map(label => ({ x: label, y: level })));
          }
        }
        
      } else {
        // Simple numeric value - same level for all dates
        const level = parseFloat(barrierValue);
        if (!isNaN(level)) {
          dataPoints.push(...dateRange.labels.map(label => ({ x: label, y: level })));
        }
      }
      
      // Validate that we have data points
      if (dataPoints.length === 0) {
        dataPoints.push(...dateRange.labels.map(label => ({ x: label, y: 100 })));
      }      return dataPoints;
      
    } catch (error) {
      // Fallback to 100% level for all dates
      return dateRange.labels.map(label => ({ x: label, y: 100 }));
    }
  }

  /**
   * Check if a date is an important date that should be shown on x-axis
   * @param {string} dateStr - Date string to check (YYYY-MM-DD)
   * @param {Object} product - Product configuration
   * @returns {boolean} True if date should be shown on x-axis
   */
  isImportantDate(dateStr, product) {
    if (!dateStr || !product) return false;
    
    try {
      const checkDate = new Date(dateStr).toISOString().split('T')[0];
      
      // Check if it's an observation date
      if (product.observationDates && Array.isArray(product.observationDates)) {
        const hasObsDate = product.observationDates.some(obsDate => {
          return new Date(obsDate).toISOString().split('T')[0] === checkDate;
        });
        if (hasObsDate) return true;
      }
      
      // Check payoff structure for timing components
      if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
        const hasImportantComponent = product.payoffStructure.some(component => {
          if ((component.type === 'observation' || component.type === 'timing') && component.date) {
            return new Date(component.date).toISOString().split('T')[0] === checkDate;
          }
          return false;
        });
        if (hasImportantComponent) return true;
      }
      
      // Check if it's trade date or maturity date
      if (product.tradeDate && new Date(product.tradeDate).toISOString().split('T')[0] === checkDate) return true;
      if (product.maturity && new Date(product.maturity).toISOString().split('T')[0] === checkDate) return true;
      if (product.maturityDate && new Date(product.maturityDate).toISOString().split('T')[0] === checkDate) return true;
      
    } catch (error) {
    }
    
    return false;
  }

  /**
   * Calculate step-down barrier level for a specific date
   * @param {string} currentDate - Current date
   * @param {Array} stepDownSchedule - Schedule of step-down periods
   * @param {number} initialLevel - Initial barrier level
   * @returns {number} Barrier level for the current date
   */
  calculateStepDownLevel(currentDate, stepDownSchedule, initialLevel) {
    const currentDateObj = new Date(currentDate);
    
    // Find the applicable step-down period
    for (const period of stepDownSchedule) {
      const startDate = new Date(period.startDate);
      const endDate = new Date(period.endDate);
      
      if (currentDateObj >= startDate && currentDateObj <= endDate) {
        return parseFloat(period.level);
      }
    }
    
    // Return initial level if no step-down period applies
    return initialLevel;
  }

  /**
   * Get quarter start date based on product launch date
   * @param {number} quarter - Quarter number (1, 2, 3, 4...)
   * @param {Object} product - Product configuration
   * @returns {Date} Quarter start date
   */
  getQuarterStartDate(quarter, product) {
    const launchDate = new Date(product.tradeDate || product.valueDate || product.createdAt);
    const quarterStart = new Date(launchDate);
    quarterStart.setMonth(launchDate.getMonth() + ((quarter - 1) * 3));
    return quarterStart;
  }

  /**
   * Get quarter end date based on product launch date
   * @param {number} quarter - Quarter number (1, 2, 3, 4...)
   * @param {Object} product - Product configuration
   * @returns {Date} Quarter end date
   */
  getQuarterEndDate(quarter, product) {
    const quarterStart = this.getQuarterStartDate(quarter, product);
    const quarterEnd = new Date(quarterStart);
    quarterEnd.setMonth(quarterStart.getMonth() + 3);
    quarterEnd.setDate(quarterEnd.getDate() - 1); // Last day of quarter
    return quarterEnd;
  }
}