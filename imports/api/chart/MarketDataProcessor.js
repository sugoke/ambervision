/**
 * MarketDataProcessor - Handles market data fetching and rebasing for charts
 * 
 * Responsibilities:
 * - Generate rebased underlying performance datasets
 * - Handle market data from rule engine context
 * - Fetch historical price data when needed
 * - Process and normalize performance data
 */
export class MarketDataProcessor {
  constructor() {
    this.version = '1.0.0';
    this.colors = {
      primary: [
        '#3b82f6',  // Blue
        '#f59e0b',  // Orange
        '#10b981',  // Green
        '#8b5cf6',  // Purple
        '#ef4444',  // Red
        '#06b6d4',  // Cyan
        '#ec4899',  // Pink
        '#84cc16',  // Lime
        '#6366f1',  // Indigo
        '#f97316'   // Deep Orange
      ],
      reference: '#d1d5db'
    };
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
    
    if (!product.underlyings || product.underlyings.length === 0) {
      // Add 100% initial level reference line
      datasets.push(this.createReferenceLine(dateRange, '100%'));
      return { datasets };
    }
    
    // Check if we have market context data from rule engine evaluation
    if (marketData && marketData.underlyings) {
      return this.generateDatasetsFromMarketContext(product, dateRange, marketData, evaluationDate);
    }
    
    try {
      // Import price service for market data fetching
      const { PriceService } = await import('../priceService.js');
      const priceService = new PriceService();
      
      let colorIndex = 0;
      
      for (const underlying of product.underlyings) {
        if (!underlying.ticker) {
          continue;
        }

        const rebasedData = [];
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
          });

          colorIndex++;
        } else {
        }
      }
      
      // Always add 100% reference line for initial level comparison
      datasets.push(this.createReferenceLine(dateRange, 'Initial Level (100%)'));
    } catch (error) {
      // Add error dataset
      datasets.push(this.createErrorDataset(dateRange, 'Underlying Data Error'));
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
    let colorIndex = 0;

    
    for (const underlying of product.underlyings) {
      if (!underlying.ticker && !underlying.symbol) {
        continue;
      }
      
      const symbol = underlying.ticker || underlying.symbol;
      const marketUnderlying = marketData.underlyings[symbol];
      
      if (!marketUnderlying) {
        continue;
      }

      // Use trade price as the reference for chart rebasing
      const tradePrice = marketUnderlying.tradePrice || marketUnderlying.strike;
      const currentPrice = marketUnderlying.currentPrice || marketUnderlying.redemptionPrice;
      
      if (!tradePrice || !currentPrice) {
        continue;
      }
      
      // Use pre-prepared historical price data from market context
      const performanceData = [];

      // Check if we have pre-prepared chart data from the market context
      if (marketUnderlying.chartData && marketUnderlying.chartData.length > 0) {
        // Use the pre-calculated rebased performance data
        for (const pricePoint of marketUnderlying.chartData) {
          performanceData.push({
            x: pricePoint.date,
            y: pricePoint.rebasedPerformance
          });
        }

        if (performanceData.length > 0) {
        }
      } else {

        // Fallback to simple start/end values if no historical data available
        const strikePrice = marketUnderlying.strikePrice || tradePrice;
        const startPerformance = (tradePrice / strikePrice) * 100;
        const endPerformance = (currentPrice / strikePrice) * 100;

        // Calculate cutoff date (today or evaluation date, whichever is earlier)
        const today = new Date();
        const cutoffDate = new Date(Math.min(evaluationDate.getTime(), today.getTime()));

        // Find the last date that is <= cutoffDate
        let endDateIndex = dateRange.labels.length - 1;
        for (let i = dateRange.labels.length - 1; i >= 0; i--) {
          const labelDate = new Date(dateRange.labels[i]);
          if (labelDate <= cutoffDate) {
            endDateIndex = i;
            break;
          }
        }

        performanceData.push({
          x: dateRange.labels[0],
          y: Math.round(startPerformance * 100) / 100
        });

        // Only add end point if it's different from start (and within cutoff date)
        if (endDateIndex > 0) {
          performanceData.push({
            x: dateRange.labels[endDateIndex],
            y: Math.round(endPerformance * 100) / 100
          });
        }
      }
      
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
    
    if (datasets.length === 0) {
      // Add reference line if no data
      datasets.push(this.createReferenceLine(dateRange, 'Initial Level (100%)'));
    }
    
    return { datasets };
  }

  /**
   * Legacy method maintained for backward compatibility
   * @deprecated Use generateRebasedUnderlyingDatasets instead
   */
  async generateUnderlyingDatasets(product, dateRange, options = {}) {
    const datasets = [];
    
    if (!product.underlyings || product.underlyings.length === 0) {
      // Add 100% reference line when no underlyings
      datasets.push({
        label: 'Initial Level (100%)',
        data: dateRange.labels.map(label => ({ x: label, y: 100 })),
        borderColor: this.colors.reference,
        backgroundColor: this.colors.reference + '20',
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
      const { PriceService } = await import('../priceService.js');
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
        borderColor: this.colors.reference,
        backgroundColor: this.colors.reference + '20',
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
   * Create a reference line dataset (e.g., 100% initial level)
   */
  createReferenceLine(dateRange, label = 'Reference Line', level = 100) {
    return {
      label: label,
      data: dateRange.labels.map(dateLabel => ({ x: dateLabel, y: level })),
      borderColor: this.colors.reference,
      backgroundColor: this.colors.reference + '20',
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
}