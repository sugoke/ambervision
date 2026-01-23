import { MarketDataHelpers, MarketDataCacheCollection } from '/imports/api/marketDataCache';
import { EODApiHelpers } from '/imports/api/eodApi';
import { CurrencyNormalization } from '/imports/utils/currencyNormalization';

/**
 * Orion Memory Evaluation Helpers
 *
 * Dedicated helper functions for Orion Memory template evaluation.
 * ISOLATED from other templates to prevent cross-template breaking changes.
 */
export const OrionEvaluationHelpers = {
  /**
   * Set redemption prices for redeemed Orion products
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
        console.error(`Orion: Failed to fetch redemption price for ${underlying.ticker}:`, error);
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
   * Get evaluation price for Orion products
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
   * Check if upper barrier was touched during product life (lookback)
   * Examines all daily closes from initial date to current/final observation
   */
  async checkBarrierTouchedInHistory(underlying, product, upperBarrier) {
    console.log(`[ORION BARRIER CHECK] Starting check for ${underlying?.ticker}`);
    console.log('[ORION BARRIER CHECK] Underlying object:', JSON.stringify(underlying, null, 2));
    console.log('[ORION BARRIER CHECK] Upper barrier:', upperBarrier);

    try {
      const tradeDate = new Date(product.tradeDate || product.issueDate || product.valueDate);
      const now = new Date();
      const finalObsDate = product.finalObservation || product.finalObservationDate;
      const maturityDate = product.maturity || product.maturityDate;

      console.log('[ORION BARRIER CHECK] Trade date:', tradeDate);
      console.log('[ORION BARRIER CHECK] Final obs:', finalObsDate);
      console.log('[ORION BARRIER CHECK] Maturity:', maturityDate);

      // Determine cutoff date: use final observation if passed, otherwise today
      const isFinalObsPassed = finalObsDate && new Date(finalObsDate) <= now;
      const isMaturityPassed = maturityDate && new Date(maturityDate) <= now;
      const cutoffDate = isFinalObsPassed ? new Date(finalObsDate) : (isMaturityPassed ? new Date(maturityDate) : now);

      console.log('[ORION BARRIER CHECK] Cutoff date:', cutoffDate);

      const fullTicker = underlying.securityData?.ticker || `${underlying.ticker}.US`;
      console.log('[ORION BARRIER CHECK] Full ticker:', fullTicker);

      // Get historical data from cache
      let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: fullTicker });
      console.log('[ORION BARRIER CHECK] Cache doc found:', !!cacheDoc);

      // Try alternative exchanges if not found
      if (!cacheDoc) {
        const symbol = fullTicker.split('.')[0];
        const exchanges = ['US', 'PA', 'DE', 'LSE', 'CO'];
        console.log('[ORION BARRIER CHECK] Trying alternative exchanges for:', symbol);
        for (const exchange of exchanges) {
          const altTicker = `${symbol}.${exchange}`;
          cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: altTicker });
          if (cacheDoc) {
            console.log('[ORION BARRIER CHECK] Found with alt ticker:', altTicker);
            break;
          }
        }
      }

      if (!cacheDoc || !cacheDoc.history || cacheDoc.history.length === 0) {
        console.warn(`[ORION BARRIER CHECK] ❌ No historical data found for ${fullTicker}, cannot check barrier touch`);
        return false;
      }

      console.log('[ORION BARRIER CHECK] History records available:', cacheDoc.history.length);

      const tradeDateStr = tradeDate.toISOString().split('T')[0];

      // IMPORTANT: Use STRIKE price as the reference, NOT the cache price on trade date
      // The strike is the contractual reference level that determines barrier hits
      // This matches the chart builder which also uses strike for rebasing
      const initialPrice = underlying.strike ||
                          (underlying.securityData?.tradeDatePrice?.price) ||
                          (underlying.securityData?.tradeDatePrice?.close) || 0;

      console.log('[ORION BARRIER CHECK] Initial price (strike):', underlying.strike);
      console.log('[ORION BARRIER CHECK] Initial price (used):', initialPrice);

      if (initialPrice === 0) {
        console.warn(`[ORION BARRIER CHECK] ❌ Initial price is 0 for ${fullTicker}, cannot check barrier`);
        return false;
      }

      const cutoffDateStr = cutoffDate.toISOString().split('T')[0];

      console.log('[ORION BARRIER CHECK] Date range:', tradeDateStr, 'to', cutoffDateStr);

      // Filter historical data within the relevant period
      let relevantHistory = cacheDoc.history.filter(record => {
        const recordDate = new Date(record.date).toISOString().split('T')[0];
        return recordDate >= tradeDateStr && recordDate <= cutoffDateStr;
      });

      console.log('[ORION BARRIER CHECK] Relevant history records:', relevantHistory.length);

      if (relevantHistory.length === 0) {
        console.warn(`[ORION BARRIER CHECK] ❌ No historical data in relevant period for ${fullTicker}`);
        return false;
      }

      // Normalize GBp to GBP for LSE stocks before barrier checking
      // LSE prices are quoted in pence, but barrier and strike are in pounds
      relevantHistory = CurrencyNormalization.normalizeHistoricalPrices(
        relevantHistory,
        initialPrice,
        fullTicker
      );

      // Check if any daily close reached or exceeded the upper barrier
      // upperBarrier is percentage (e.g., 150 means 150% of initial)
      const barrierPrice = initialPrice * (upperBarrier / 100);

      console.log('[ORION BARRIER CHECK] Barrier price:', barrierPrice, `(${upperBarrier}% of ${initialPrice})`);

      let maxPrice = 0;
      let maxDate = null;

      for (const record of relevantHistory) {
        const closePrice = record.adjustedClose || record.close;
        if (closePrice > maxPrice) {
          maxPrice = closePrice;
          maxDate = record.date;
        }
        if (closePrice >= barrierPrice) {
          console.log(`[ORION BARRIER CHECK] ✅ ${fullTicker} HIT barrier ${upperBarrier}% on ${record.date} (close: ${closePrice}, barrier: ${barrierPrice})`);
          return true;
        }
      }

      console.log(`[ORION BARRIER CHECK] ❌ ${fullTicker} did NOT hit barrier. Max price was ${maxPrice} on ${maxDate}, barrier was ${barrierPrice}`);
      return false;

    } catch (error) {
      console.error(`[ORION] Error checking barrier touch for ${underlying.ticker}:`, error);
      return false;
    }
  },

  /**
   * Format currency for Orion displays
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
   * Extract underlying assets data for Orion products
   */
  async extractUnderlyingAssetsData(product) {
    const underlyings = [];

    if (product.underlyings && Array.isArray(product.underlyings)) {
      for (const underlying of product.underlyings) {
        const initialPrice = underlying.strike ||
                           (underlying.securityData?.tradeDatePrice?.price) ||
                           (underlying.securityData?.tradeDatePrice?.close) || 0;

        // Ensure securityData exists
        if (!underlying.securityData) {
          underlying.securityData = {};
        }

        // Build list of ticker variants to try (exchange suffixes)
        const fullTicker = underlying.securityData?.ticker || `${underlying.ticker}.US`;
        const tickerVariants = [];

        // If ticker already has exchange suffix in securityData, try that first
        if (underlying.securityData?.ticker) {
          tickerVariants.push(underlying.securityData.ticker);
        }

        // Extract base ticker (without exchange suffix if present)
        const baseTicker = (underlying.ticker || '').split('.')[0];
        if (baseTicker) {
          // Try common exchanges
          tickerVariants.push(`${baseTicker}.US`);
          tickerVariants.push(`${baseTicker}.NASDAQ`);
          tickerVariants.push(`${baseTicker}.NYSE`);
          tickerVariants.push(`${baseTicker}.LSE`);
          tickerVariants.push(`${baseTicker}.PA`);
          tickerVariants.push(`${baseTicker}.DE`);
        }

        // Remove duplicates while preserving order
        const uniqueVariants = [...new Set(tickerVariants)];

        // Check if we need to fetch a fresh price
        const existingPrice = underlying.securityData.price;
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        const existingPriceDate = existingPrice?.date ? new Date(existingPrice.date).toISOString().split('T')[0] : null;
        const needsFreshPrice = !existingPrice || !existingPriceDate || existingPriceDate !== todayStr;

        // Track the currency for this underlying (default to USD)
        let underlyingCurrency = underlying.securityData?.currency || 'USD';

        if (needsFreshPrice) {
          console.log(`📊 Orion: Fetching fresh price for ${underlying.ticker} (existing price date: ${existingPriceDate || 'none'}, today: ${todayStr})`);

          let priceFound = false;
          for (const tickerVariant of uniqueVariants) {
            try {
              const cachedPrice = await MarketDataHelpers.getCurrentPrice(tickerVariant);

              if (cachedPrice && cachedPrice.price) {
                underlying.securityData.price = {
                  price: cachedPrice.price,
                  close: cachedPrice.price,
                  date: cachedPrice.date || new Date(),
                  source: 'market_data_cache',
                  ticker: tickerVariant
                };
                // Capture the currency from the cache
                underlyingCurrency = cachedPrice.currency || underlyingCurrency;
                underlying.securityData.currency = underlyingCurrency;
                console.log(`✅ Orion: Fetched price for ${tickerVariant}: ${cachedPrice.price} ${underlyingCurrency}`);
                priceFound = true;
                break;
              }
            } catch (error) {
              // Try next variant silently
            }
          }

          if (!priceFound) {
            console.warn(`⚠️ Orion: Could not fetch price for ${underlying.ticker} after trying: ${uniqueVariants.join(', ')}`);
          }
        }

        const evaluationPriceInfo = this.getEvaluationPrice(underlying, product);
        const usedTicker = underlying.securityData?.price?.ticker || fullTicker;

        // Normalize GBp to GBP for LSE stocks
        // LSE prices are quoted in pence (GBp), strikes are in pounds (GBP)
        const currentPrice = CurrencyNormalization.normalizePriceToGBP(
          evaluationPriceInfo.price,
          initialPrice,
          usedTicker
        );

        let performance = initialPrice > 0 ?
          ((currentPrice - initialPrice) / initialPrice) * 100 : 0;

        // Use the underlying's currency for display, not the product currency
        const displayCurrency = underlying.securityData?.currency || 'USD';

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

          // Use underlying's currency for price display
          currency: displayCurrency,
          initialPriceFormatted: this.formatCurrency(initialPrice, displayCurrency),
          currentPriceFormatted: this.formatCurrency(currentPrice, displayCurrency),
          performanceFormatted: (performance >= 0 ? '+' : '') + performance.toFixed(2) + '%',
          priceDateFormatted: evaluationPriceInfo.date ?
            new Date(evaluationPriceInfo.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            }) : null,

          hasCurrentData: !!(underlying.securityData?.price?.price),
          lastUpdated: new Date().toISOString(),

          fullTicker: usedTicker
        };

        underlyings.push(underlyingData);
      }
    }

    return underlyings;
  },

  /**
   * Build product status for Orion products
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
   * Calculate days to maturity for Orion products
   */
  calculateDaysToMaturity(product) {
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const today = new Date();
    const diffTime = maturityDate - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },

  /**
   * Check if Orion product has matured
   */
  checkIfMatured(product) {
    const maturityDate = new Date(product.maturity || product.maturityDate);
    return new Date() >= maturityDate;
  },

  /**
   * Get next observation date for Orion products
   */
  getNextObservationDate(product) {
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 3); // Default
    return nextDate;
  },

  /**
   * Generate product name for Orion products
   */
  generateProductName(product, underlyings, params) {
    if (!underlyings || underlyings.length === 0) {
      return product.title || product.productName || 'Unnamed Orion Product';
    }

    const tickers = underlyings.map(u => u.ticker);

    // Match dashboard logic: show first 2 + count if more than 2
    let tickerDisplay;
    if (tickers.length > 2) {
      tickerDisplay = `${tickers.slice(0, 2).join('/')} +${tickers.length - 2}`;
    } else {
      tickerDisplay = tickers.join('/');
    }

    return `${tickerDisplay} Orion`;
  }
};
