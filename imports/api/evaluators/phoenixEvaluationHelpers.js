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

    // Strip time components for date-only comparison
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Final observation is a market date - data only available the NEXT day
    const isFinalObsPassed = finalObsDate && (() => {
      const finalObsDateOnly = new Date(new Date(finalObsDate).getFullYear(), new Date(finalObsDate).getMonth(), new Date(finalObsDate).getDate());
      return finalObsDateOnly < nowDateOnly;
    })();

    // Maturity is settlement date - product has matured ON or after this date
    const isMaturityPassed = maturityDate && (() => {
      const maturityDateOnly = new Date(new Date(maturityDate).getFullYear(), new Date(maturityDate).getMonth(), new Date(maturityDate).getDate());
      return maturityDateOnly <= nowDateOnly;
    })();

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
   * Detect decimal precision of a number (e.g., 3.0825 has 4 decimal places)
   */
  getDecimalPrecision(value) {
    if (!value || value === 0) return 2; // Default to 2 decimals

    const valueStr = value.toString();
    if (!valueStr.includes('.')) return 0; // No decimals

    const decimalPart = valueStr.split('.')[1];
    return decimalPart ? decimalPart.length : 0;
  },

  /**
   * Format coupon percentage with dynamic precision matching the coupon rate
   */
  formatCouponPercentage(amount, couponRate) {
    const precision = this.getDecimalPrecision(couponRate);
    return amount.toFixed(Math.max(precision, 2)) + '%'; // Minimum 2 decimals
  },

  /**
   * Extract underlying assets data for Phoenix products
   */
  async extractUnderlyingAssetsData(product) {
    const underlyings = [];
    const currency = product.currency || 'USD';

    if (product.underlyings && Array.isArray(product.underlyings)) {
      // Process all underlyings sequentially to fetch current prices and news
      for (const [index, underlying] of product.underlyings.entries()) {
        const initialPrice = underlying.strike ||
                           (underlying.securityData?.tradeDatePrice?.price) ||
                           (underlying.securityData?.tradeDatePrice?.close) || 0;

        // Fetch current price from market data cache if not already present
        if (!underlying.securityData) {
          underlying.securityData = {};
        }

        if (!underlying.securityData.price) {
          try {
            const fullTicker = underlying.securityData?.ticker || `${underlying.ticker}.US`;
            const cachedPrice = await MarketDataHelpers.getCurrentPrice(fullTicker);

            if (cachedPrice && cachedPrice.price) {
              underlying.securityData.price = {
                price: cachedPrice.price,
                close: cachedPrice.price,
                date: cachedPrice.date || new Date(),
                source: 'market_data_cache'
              };
              console.log(`✅ Phoenix: Fetched current price for ${fullTicker}: $${cachedPrice.price}`);
            } else {
              console.warn(`⚠️ Phoenix: No current price available for ${fullTicker}, using initial price as fallback`);
            }
          } catch (error) {
            console.warn(`⚠️ Phoenix: Failed to fetch current price for ${underlying.ticker}:`, error.message);
          }
        }

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
            new Date(evaluationPriceInfo.date).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric'
            }) : null,

          hasCurrentData: !!(underlying.securityData?.price?.price),
          lastUpdated: new Date().toISOString(),

          fullTicker: underlying.securityData?.ticker || `${underlying.ticker}.US`
        };

        underlyings.push(underlyingData);
      }
    }

    return underlyings;
  },

  /**
   * Build product status for Phoenix products
   *
   * @param {Object} product - The product document
   * @param {Object} observationAnalysis - Optional observation analysis with autocall detection
   */
  buildProductStatus(product, observationAnalysis = null) {
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

    // Check for early autocall FIRST (highest priority)
    if (observationAnalysis?.isEarlyAutocall && observationAnalysis?.callDate) {
      productStatus = 'autocalled';
      const callDate = new Date(observationAnalysis.callDate);
      const daysToCall = Math.ceil((callDate - now) / (1000 * 60 * 60 * 24));

      statusDetails = {
        autocallDate: observationAnalysis.callDate,
        autocallDateFormatted: callDate.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }),
        redemptionType: 'early_autocall',
        daysToCall: daysToCall,
        daysToCallText: daysToCall >= 0
          ? `${daysToCall} days`
          : `${Math.abs(daysToCall)} days (autocalled)`
      };
    }
    // Check for maturity (if not autocalled)
    else if (isMaturityPassed || isFinalObsPassed) {
      productStatus = 'matured';
      statusDetails = {
        maturedDate: maturityDate || finalObsDate,
        maturedDateFormatted: new Date(maturityDate || finalObsDate).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }),
        redemptionType: 'maturity'
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
      hasAutocalled: observationAnalysis?.isEarlyAutocall || false,
      evaluationDate: now,
      evaluationDateFormatted: now.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
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

    // Check if product has autocalled
    const hasAutocalled = observationSchedule?.isEarlyAutocall || false;

    if (hasMatured || hasAutocalled) {
      return null; // Don't calculate for matured or autocalled products
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
      couponsEarnedFormatted: this.formatCouponPercentage(totalCouponsEarned, phoenixParams.couponRate),

      memoryCoupons: memoryCouponsIncluded,
      memoryCouponsFormatted: this.formatCouponPercentage(memoryCouponsIncluded, phoenixParams.couponRate),
      hasMemoryCoupons: totalMemoryCoupons > 0,
      memoryCouponsForfeit: !isAboveBarrier && totalMemoryCoupons > 0,
      memoryCouponsForfeitAmount: !isAboveBarrier ? totalMemoryCoupons : 0,
      memoryCouponsForfeitFormatted: !isAboveBarrier ? this.formatCouponPercentage(totalMemoryCoupons, phoenixParams.couponRate) : '0%',

      totalValue: totalIndicativeValue,
      totalValueFormatted: totalIndicativeValue.toFixed(2) + '%',

      evaluationDate: now,
      evaluationDateFormatted: now.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
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
  },

  /**
   * Format date as "1st Dec 25" (ordinal day + abbreviated month + 2-digit year)
   */
  formatObservationDate(dateInput) {
    const date = new Date(dateInput);

    // Get day with ordinal suffix
    const day = date.getDate();
    const ordinalSuffix = (day) => {
      if (day > 3 && day < 21) return 'th'; // covers 11th-20th
      switch (day % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
      }
    };
    const dayWithOrdinal = `${day}${ordinalSuffix(day)}`;

    // Get abbreviated month name
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = monthNames[date.getMonth()];

    // Get 2-digit year
    const year = String(date.getFullYear()).slice(-2);

    return `${dayWithOrdinal} ${month} ${year}`;
  },

  /**
   * Format coupon percentage for predictions with 2-4 decimal places
   * Shows minimum 2 decimals, up to 4 if needed
   */
  formatPredictionCoupon(value) {
    // If value has significant digits beyond 2 decimals, show up to 4
    const rounded2 = Math.round(value * 100) / 100;
    const rounded4 = Math.round(value * 10000) / 10000;

    // If rounding to 2 decimals loses precision, use more decimals
    if (rounded2 !== rounded4) {
      // Check if we need 3 or 4 decimals
      const rounded3 = Math.round(value * 1000) / 1000;
      if (rounded3 !== rounded4) {
        return `${value.toFixed(4)}%`;
      }
      return `${value.toFixed(3)}%`;
    }

    // Always show at least 2 decimals
    return `${value.toFixed(2)}%`;
  }
};
