import { MarketDataHelpers } from '/imports/api/marketDataCache';
import { EODApiHelpers } from '/imports/api/eodApi';

/**
 * Phoenix Evaluation Helpers
 *
 * Dedicated helper functions for Phoenix Autocallable template evaluation.
 * ISOLATED from other templates to prevent cross-template breaking changes.
 */
export const PhoenixEvaluationHelpers = {
  /**
   * Set redemption prices for redeemed Phoenix products
   */
  async setRedemptionPricesForProduct(product) {
    if (!product.underlyings || !Array.isArray(product.underlyings)) {
      return;
    }

    const now = new Date();
    const finalObsDate = product.finalObservation || product.finalObservationDate;
    const maturityDate = product.maturity || product.maturityDate;

    const isFinalObsPassed = finalObsDate && new Date(finalObsDate) <= now;
    const isMaturityPassed = maturityDate && new Date(maturityDate) <= now;
    const isRedeemed = isFinalObsPassed || isMaturityPassed;

    if (!isRedeemed) {
      return;
    }

    // Determine redemption date
    let redemptionDate;
    if (isFinalObsPassed && isMaturityPassed) {
      redemptionDate = finalObsDate ? new Date(finalObsDate) : new Date(maturityDate);
    } else if (isFinalObsPassed) {
      redemptionDate = new Date(finalObsDate);
    } else if (isMaturityPassed) {
      redemptionDate = new Date(maturityDate);
    } else {
      return;
    }

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
        console.error(`Phoenix: Failed to fetch redemption price for ${underlying.ticker}:`, error);
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
        underlying.securityData.finalObservationPrice = redemptionPrice;
      }
    }
  },

  /**
   * Get evaluation price for Phoenix products
   */
  getEvaluationPrice(underlying, product) {
    const now = new Date();
    const finalObsDate = product.finalObservation || product.finalObservationDate;
    const maturityDate = product.maturity || product.maturityDate;

    const isRedeemed = (maturityDate && new Date(maturityDate) <= now) ||
                      (finalObsDate && new Date(finalObsDate) <= now);

    if (isRedeemed && underlying.securityData?.redemptionPrice) {
      return {
        price: underlying.securityData.redemptionPrice.price || underlying.securityData.redemptionPrice.close,
        source: 'redemption',
        date: underlying.securityData.redemptionPrice.date || maturityDate
      };
    }

    if (finalObsDate && new Date(finalObsDate) <= now && underlying.securityData?.finalObservationPrice) {
      return {
        price: underlying.securityData.finalObservationPrice.price || underlying.securityData.finalObservationPrice.close,
        source: 'final_observation',
        date: underlying.securityData.finalObservationPrice.date || finalObsDate
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
   * Format currency for Phoenix displays
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
   * Extract underlying assets data for Phoenix products
   */
  async extractUnderlyingAssetsData(product) {
    const underlyings = [];
    const currency = product.currency || 'USD';

    if (product.underlyings && Array.isArray(product.underlyings)) {
      // Process all underlyings sequentially to fetch news
      for (const [index, underlying] of product.underlyings.entries()) {
        const initialPrice = underlying.strike ||
                           (underlying.securityData?.tradeDatePrice?.price) ||
                           (underlying.securityData?.tradeDatePrice?.close) || 0;

        const evaluationPriceInfo = this.getEvaluationPrice(underlying, product);
        const currentPrice = evaluationPriceInfo.price;

        let performance = initialPrice > 0 ?
          ((currentPrice - initialPrice) / initialPrice) * 100 : 0;

        // Fetch latest news for this underlying
        let news = [];
        try {
          const fullTicker = underlying.securityData?.ticker || `${underlying.ticker}.US`;
          const [symbol, exchange] = fullTicker.includes('.') ? fullTicker.split('.') : [fullTicker, null];

          // Fetch 2 latest news articles from EOD API
          news = await EODApiHelpers.getSecurityNews(symbol, exchange, 2);
        } catch (error) {
          console.warn(`Phoenix: Failed to fetch news for ${underlying.ticker}:`, error.message);
          news = []; // Graceful fallback - empty array
        }

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

          fullTicker: underlying.securityData?.ticker || `${underlying.ticker}.US`,

          // Latest news articles
          news: news
        };

        underlyings.push(underlyingData);
      }
    }

    return underlyings;
  },

  /**
   * Build product status for Phoenix products
   */
  buildProductStatus(product) {
    const now = new Date();
    const finalObsDate = product.finalObservation || product.finalObservationDate;
    const maturityDate = product.maturity || product.maturityDate;

    const isFinalObsPassed = finalObsDate && new Date(finalObsDate) <= now;
    const isMaturityPassed = maturityDate && new Date(maturityDate) <= now;

    const daysToMaturity = this.calculateDaysToMaturity(product);
    const daysToFinalObs = finalObsDate ?
      Math.ceil((new Date(finalObsDate) - now) / (1000 * 60 * 60 * 24)) : null;

    let productStatus = 'live';
    let statusDetails = {};

    if (isMaturityPassed || isFinalObsPassed) {
      productStatus = 'matured';
      statusDetails = {
        maturedDate: maturityDate || finalObsDate,
        maturedDateFormatted: new Date(maturityDate || finalObsDate).toLocaleDateString('en-US', {
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
      daysToFinalObs,
      hasMatured: isMaturityPassed || isFinalObsPassed,
      evaluationDate: now,
      evaluationDateFormatted: now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    };
  },

  /**
   * Calculate days to maturity for Phoenix products
   */
  calculateDaysToMaturity(product) {
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const today = new Date();
    const diffTime = maturityDate - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },

  /**
   * Check if Phoenix product has matured
   */
  checkIfMatured(product) {
    const maturityDate = new Date(product.maturity || product.maturityDate);
    return new Date() >= maturityDate;
  },

  /**
   * Get next observation date for Phoenix products
   */
  getNextObservationDate(product) {
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 3); // Quarterly default
    return nextDate;
  },

  /**
   * Calculate indicative maturity value if product were to mature today
   * Shows hypothetical redemption: capital + earned coupons
   * Only for live Phoenix products
   */
  calculateIndicativeMaturityValue(product, underlyings, observationSchedule, phoenixParams, currency = 'USD') {
    // Only calculate for live products
    const now = new Date();
    const finalObsDate = product.finalObservation || product.finalObservationDate;
    const maturityDate = product.maturity || product.maturityDate;

    const isFinalObsPassed = finalObsDate && new Date(finalObsDate) <= now;
    const isMaturityPassed = maturityDate && new Date(maturityDate) <= now;
    const hasMatured = isFinalObsPassed || isMaturityPassed;

    if (hasMatured) {
      return null; // Don't calculate for matured products
    }

    if (!underlyings || underlyings.length === 0) {
      return null; // Can't calculate without underlyings
    }

    // Calculate worst-of basket performance (minimum performance among all underlyings)
    const basketPerformance = Math.min(...underlyings.map(u => u.performance || 0));

    // Protection barrier from phoenixParams (default 100% if not set)
    const protectionBarrier = phoenixParams?.protectionBarrier || 100;

    // Calculate current basket level (100 + performance)
    // Example: -35% performance means current level is 65% of strike
    const currentLevel = 100 + basketPerformance;

    // Calculate capital return based on protection barrier logic
    let capitalReturn;
    let capitalExplanation;

    if (basketPerformance >= (protectionBarrier - 100)) {
      // Above protection barrier: full capital return (100%)
      capitalReturn = 100;
      capitalExplanation = `Basket at ${currentLevel.toFixed(2)}% (above ${protectionBarrier}% barrier) = 100% capital`;
    } else {
      // Below protection barrier: geared loss calculation
      // Step 1: Calculate breach amount
      const breachAmount = protectionBarrier - currentLevel;
      // Step 2: Apply gearing factor (breach × 100/barrier)
      const gearedLoss = breachAmount * (100 / protectionBarrier);
      // Step 3: Calculate capital return
      capitalReturn = 100 - gearedLoss;
      // Example: barrier 70%, current 63.28% → breach 6.72% → loss 6.72×(100/70) = 9.6% → capital 90.4%
      capitalExplanation = `Basket at ${currentLevel.toFixed(2)}% (below ${protectionBarrier}% barrier): breach ${breachAmount.toFixed(2)}% × (100/${protectionBarrier}) = loss ${gearedLoss.toFixed(2)}% → capital ${capitalReturn.toFixed(2)}%`;
    }

    // Get coupons from observation schedule
    const totalCouponsEarned = observationSchedule?.totalCouponsEarned || 0;
    const totalMemoryCoupons = observationSchedule?.totalMemoryCoupons || 0;

    // Memory coupons are only paid if basket is above protection barrier at maturity
    // If below barrier, memory coupons are forfeited
    const isAboveBarrier = basketPerformance >= (protectionBarrier - 100);
    const memoryCouponsIncluded = isAboveBarrier ? totalMemoryCoupons : 0;

    // Calculate total indicative value
    const totalIndicativeValue = capitalReturn + totalCouponsEarned + memoryCouponsIncluded;

    // Return pre-formatted object for display
    return {
      isLive: true,
      basketPerformance: basketPerformance,
      basketPerformanceFormatted: (basketPerformance >= 0 ? '+' : '') + basketPerformance.toFixed(2) + '%',

      protectionBarrier: protectionBarrier,
      protectionBarrierFormatted: protectionBarrier.toFixed(0) + '%',

      capitalReturn: capitalReturn,
      capitalReturnFormatted: capitalReturn.toFixed(2) + '%',
      capitalExplanation: capitalExplanation,

      couponsEarned: totalCouponsEarned,
      couponsEarnedFormatted: totalCouponsEarned.toFixed(2) + '%',

      memoryCoupons: memoryCouponsIncluded,
      memoryCouponsFormatted: memoryCouponsIncluded.toFixed(2) + '%',
      hasMemoryCoupons: totalMemoryCoupons > 0,
      memoryCouponsForfeit: !isAboveBarrier && totalMemoryCoupons > 0,
      memoryCouponsForfeitAmount: !isAboveBarrier ? totalMemoryCoupons : 0,
      memoryCouponsForfeitFormatted: !isAboveBarrier ? totalMemoryCoupons.toFixed(2) + '%' : '0%',

      totalValue: totalIndicativeValue,
      totalValueFormatted: totalIndicativeValue.toFixed(2) + '%',

      evaluationDate: now,
      evaluationDateFormatted: now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    };
  },

  /**
   * Generate product name for Phoenix products
   */
  generateProductName(product, underlyings, params) {
    if (!underlyings || underlyings.length === 0) {
      return product.title || product.productName || 'Unnamed Phoenix Product';
    }

    const tickers = underlyings.map(u => u.ticker).join('/');
    return `${tickers} Phoenix Autocallable`;
  }
};
