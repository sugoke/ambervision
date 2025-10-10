import { MarketDataHelpers } from '/imports/api/marketDataCache';

/**
 * Shark Note Evaluation Helpers
 *
 * Dedicated helper functions for Shark Note template evaluation.
 * ISOLATED from other templates to prevent cross-template breaking changes.
 *
 * Shark Note Structure:
 * - Upper barrier observation during product life
 * - If barrier touched: redemption = 100 + fixed rebate
 * - If barrier NOT touched: redemption = 100 + performance, floored at minimum level
 * - Supports single underlying or basket (worst-of, best-of, average)
 */
export const SharkNoteEvaluationHelpers = {
  /**
   * Set redemption prices for redeemed Shark Note products
   */
  async setRedemptionPricesForProduct(product) {
    if (!product.underlyings || !Array.isArray(product.underlyings)) {
      return;
    }

    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;
    const isMaturityPassed = maturityDate && new Date(maturityDate) <= now;

    if (!isMaturityPassed) {
      return;
    }

    const redemptionDate = new Date(maturityDate);

    // Set redemption prices for each underlying
    for (const underlying of product.underlyings) {
      if (!underlying.securityData) {
        continue;
      }

      let redemptionPrice = null;

      try {
        const fullTicker = underlying.securityData.ticker || `${underlying.ticker}.US`;
        const historicalData = await MarketDataHelpers.getHistoricalData(
          fullTicker,
          redemptionDate,
          redemptionDate
        );

        if (historicalData && historicalData.length > 0) {
          redemptionPrice = {
            price: historicalData[0].close,
            date: historicalData[0].date,
            source: 'market_data_cache'
          };
        }
      } catch (error) {
        console.error(`Shark Note: Failed to fetch redemption price for ${underlying.ticker}:`, error);
      }

      if (!redemptionPrice && underlying.securityData.price) {
        redemptionPrice = {
          price: underlying.securityData.price.price || underlying.securityData.price.close,
          date: redemptionDate,
          source: 'fallback_current_price'
        };
      }

      if (redemptionPrice) {
        underlying.securityData.redemptionPrice = redemptionPrice;
        underlying.securityData.maturityPrice = redemptionPrice;
      }
    }
  },

  /**
   * Get evaluation price for Shark Note products
   */
  getEvaluationPrice(underlying, product) {
    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;
    const isRedeemed = maturityDate && new Date(maturityDate) <= now;

    if (isRedeemed && underlying.securityData?.redemptionPrice) {
      return {
        price: underlying.securityData.redemptionPrice.price || underlying.securityData.redemptionPrice.close,
        source: 'redemption',
        date: underlying.securityData.redemptionPrice.date || maturityDate
      };
    }

    if (underlying.securityData?.price) {
      return {
        price: underlying.securityData.price.price || underlying.securityData.price.close,
        source: 'live',
        date: underlying.securityData.price.date || now
      };
    }

    const initialPrice = underlying.strike || (underlying.securityData?.tradeDatePrice?.price) || 0;
    return {
      price: initialPrice,
      source: 'initial_fallback',
      date: product.tradeDate || product.valueDate
    };
  },

  /**
   * Calculate basket performance based on reference type
   */
  calculateBasketPerformance(underlyings, referenceType = 'worst-of') {
    if (!underlyings || underlyings.length === 0) {
      return null;
    }

    const performances = underlyings.map(u => u.performance).filter(p => p !== null && p !== undefined);

    if (performances.length === 0) {
      return null;
    }

    switch (referenceType) {
      case 'worst-of':
        return Math.min(...performances);
      case 'best-of':
        return Math.max(...performances);
      case 'average':
        return performances.reduce((sum, p) => sum + p, 0) / performances.length;
      default:
        return Math.min(...performances); // Default to worst-of
    }
  },

  /**
   * Check if upper barrier was touched during product life
   */
  async checkBarrierTouch(product, upperBarrierLevel) {
    if (!product.underlyings || product.underlyings.length === 0) {
      return { touched: false, touchDate: null, basketLevel: null };
    }

    const tradeDate = new Date(product.tradeDate || product.valueDate);
    const now = new Date();
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const endDate = maturityDate < now ? maturityDate : now;

    // Check barrier touch for each underlying
    let barrierTouched = false;
    let firstTouchDate = null;
    let touchBasketLevel = null;

    // Get historical data for all underlyings
    const underlyingHistories = [];

    for (const underlying of product.underlyings) {
      const fullTicker = underlying.securityData?.ticker || `${underlying.ticker}.US`;
      const initialPrice = underlying.strike || underlying.securityData?.tradeDatePrice?.price;

      if (!initialPrice) {
        console.warn(`Shark Note: No initial price for ${underlying.ticker}`);
        continue;
      }

      try {
        const historicalData = await MarketDataHelpers.getHistoricalData(
          fullTicker,
          tradeDate,
          endDate
        );

        if (historicalData && historicalData.length > 0) {
          underlyingHistories.push({
            ticker: underlying.ticker,
            initialPrice,
            history: historicalData
          });
        }
      } catch (error) {
        console.error(`Shark Note: Failed to fetch history for ${underlying.ticker}:`, error);
      }
    }

    if (underlyingHistories.length === 0) {
      return { touched: false, touchDate: null, basketLevel: null };
    }

    // Build a map of dates to basket performances
    const datePerformances = new Map();

    // Collect all unique dates
    const allDates = new Set();
    underlyingHistories.forEach(uh => {
      uh.history.forEach(day => {
        allDates.add(day.date);
      });
    });

    // For each date, calculate basket performance
    const referenceType = product.structureParams?.referencePerformance ||
                         product.structure?.referencePerformance ||
                         'worst-of';

    for (const dateStr of allDates) {
      const performances = [];

      for (const uh of underlyingHistories) {
        const dayData = uh.history.find(d => d.date === dateStr);
        if (dayData) {
          const performance = ((dayData.close - uh.initialPrice) / uh.initialPrice) * 100;
          performances.push(performance);
        }
      }

      if (performances.length === underlyingHistories.length) {
        let basketPerformance;
        switch (referenceType) {
          case 'worst-of':
            basketPerformance = Math.min(...performances);
            break;
          case 'best-of':
            basketPerformance = Math.max(...performances);
            break;
          case 'average':
            basketPerformance = performances.reduce((sum, p) => sum + p, 0) / performances.length;
            break;
          default:
            basketPerformance = Math.min(...performances);
        }

        datePerformances.set(dateStr, basketPerformance);

        // Check if barrier was touched
        if (basketPerformance >= upperBarrierLevel && !barrierTouched) {
          barrierTouched = true;
          firstTouchDate = dateStr;
          touchBasketLevel = basketPerformance;
        }
      }
    }

    return {
      touched: barrierTouched,
      touchDate: firstTouchDate,
      basketLevel: touchBasketLevel
    };
  },

  /**
   * Calculate Shark Note redemption
   */
  calculateRedemption(product, basketPerformance, barrierTouched, rebateValue, floorLevel) {
    if (barrierTouched) {
      // Barrier was touched - fixed rebate
      return {
        redemption: 100 + rebateValue,
        type: 'barrier_touched',
        formula: `100 + ${rebateValue.toFixed(1)}% (fixed rebate)`
      };
    } else {
      // Barrier not touched - performance with floor
      const rawRedemption = 100 + basketPerformance;
      const flooredRedemption = Math.max(rawRedemption, floorLevel);

      return {
        redemption: flooredRedemption,
        type: 'performance_floored',
        formula: flooredRedemption === floorLevel
          ? `Max(100 + ${basketPerformance.toFixed(2)}%, ${floorLevel.toFixed(0)}%) = ${floorLevel.toFixed(0)}% (floor applied)`
          : `100 + ${basketPerformance.toFixed(2)}% = ${rawRedemption.toFixed(2)}%`
      };
    }
  },

  /**
   * Format currency for display
   */
  formatCurrency(amount, currency) {
    const currencySymbols = {
      'USD': '$', 'EUR': '€', 'GBP': '£', 'JPY': '¥',
      'CHF': 'CHF ', 'DKK': 'DKK ', 'SEK': 'SEK ', 'NOK': 'NOK '
    };
    const symbol = currencySymbols[currency] || currency + ' ';

    if (amount >= 1000) {
      return symbol + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } else {
      return symbol + amount.toFixed(2);
    }
  },

  /**
   * Extract underlying assets data with proper pricing hierarchy
   */
  extractUnderlyingAssetsData(product) {
    const underlyings = [];
    const currency = product.currency || 'USD';

    if (product.underlyings && Array.isArray(product.underlyings)) {
      product.underlyings.forEach((underlying, index) => {
        const initialPrice = underlying.strike ||
                           (underlying.securityData?.tradeDatePrice?.price) ||
                           (underlying.securityData?.tradeDatePrice?.close) || 0;

        const evaluationPriceInfo = this.getEvaluationPrice(underlying, product);
        const currentPrice = evaluationPriceInfo.price;

        let performance = initialPrice > 0 ?
          ((currentPrice - initialPrice) / initialPrice) * 100 : 0;

        const underlyingData = {
          ticker: underlying.ticker,
          name: underlying.name || underlying.ticker,
          isin: underlying.isin || underlying.securityData?.isin || '',

          initialPrice: initialPrice,
          currentPrice: currentPrice,
          priceSource: evaluationPriceInfo.source,
          priceDate: evaluationPriceInfo.date,

          performance: performance,
          isPositive: performance >= 0,

          initialPriceFormatted: this.formatCurrency(initialPrice, currency),
          currentPriceFormatted: this.formatCurrency(currentPrice, currency),
          performanceFormatted: (performance >= 0 ? '+' : '') + performance.toFixed(2) + '%',
          priceDateFormatted: evaluationPriceInfo.date ?
            new Date(evaluationPriceInfo.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            }) : null,

          hasCurrentData: !!(underlying.securityData?.price?.price),
          lastUpdated: new Date().toISOString(),

          fullTicker: underlying.securityData?.ticker || `${underlying.ticker}.US`
        };

        underlyings.push(underlyingData);
      });
    }

    return underlyings;
  },

  /**
   * Build product status information
   */
  buildProductStatus(product) {
    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;
    const isMaturityPassed = maturityDate && new Date(maturityDate) <= now;

    const daysToMaturity = maturityDate
      ? Math.ceil((new Date(maturityDate) - now) / (1000 * 60 * 60 * 24))
      : null;

    let productStatus = 'live';
    let statusDetails = {};

    if (isMaturityPassed) {
      productStatus = 'matured';
      statusDetails = {
        maturedDate: maturityDate,
        maturedDateFormatted: new Date(maturityDate).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        })
      };
    }

    return {
      productStatus,
      statusDetails,
      daysToMaturity,
      daysToMaturityText: daysToMaturity >= 0
        ? `${daysToMaturity} days`
        : `${Math.abs(daysToMaturity)} days (matured)`,
      hasMatured: isMaturityPassed,
      evaluationDate: now,
      evaluationDateFormatted: now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    };
  }
};
