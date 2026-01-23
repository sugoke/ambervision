import { MarketDataHelpers } from '/imports/api/marketDataCache';
import { EODApiHelpers } from '/imports/api/eodApi';

/**
 * Shared Evaluation Helpers
 *
 * Common utility functions used across all template evaluators.
 * These functions handle pricing, status calculations, and data extraction
 * that are generic to all structured product templates.
 *
 * These helpers accept an optional `issueCollector` parameter to track
 * processing issues (missing data, stale prices, etc.) during evaluation.
 */

// Threshold for stale data warning (in days)
const STALE_DATA_THRESHOLD_DAYS = 5;
export const SharedEvaluationHelpers = {
  /**
   * Set redemption prices for redeemed products
   * This logic determines if the product has matured or been early autocalled
   * and sets the appropriate redemption/final observation prices
   *
   * @param {Object} product - The product to process
   * @param {Object} options - Optional parameters
   * @param {ProcessingIssueCollector} options.issueCollector - Optional issue collector
   */
  async setRedemptionPricesForProduct(product, options = {}) {
    const { issueCollector } = options;
    if (!product.underlyings || !Array.isArray(product.underlyings)) {
      return;
    }

    const now = new Date();
    const finalObsDate = product.finalObservation || product.finalObservationDate;
    const maturityDate = product.maturity || product.maturityDate;

    // Strip time components for date-only comparison
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Check if product has reached final observation (which means it's redeemed)
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

    // Helper function to format date for API lookup
    const formatDateForApi = (date) => {
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    // Determine redemption date - use the date that has actually passed
    let redemptionDate;
    if (isFinalObsPassed && isMaturityPassed) {
      // Both passed - use whichever is earlier (should be final obs)
      redemptionDate = finalObsDate ? new Date(finalObsDate) : new Date(maturityDate);
    } else if (isFinalObsPassed) {
      // Only final obs passed
      redemptionDate = new Date(finalObsDate);
    } else if (isMaturityPassed) {
      // Only maturity passed
      redemptionDate = new Date(maturityDate);
    } else {
      // Neither passed - should not reach here due to isRedeemed check
      return;
    }

    const redemptionDateStr = formatDateForApi(redemptionDate);

    // Set redemption prices for each underlying using market data cache as single source of truth
    for (const underlying of product.underlyings) {
      if (!underlying.securityData) {
        continue;
      }

      let redemptionPrice = null;

      // Query market data cache for exact redemption date price
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
        } else {
          console.warn(`No market data found in cache for ${underlying.ticker} on ${redemptionDateStr}`);
          // Add issue if collector provided
          if (issueCollector) {
            issueCollector.addIssue('MISSING_PRICE_DATA', {
              ticker: underlying.ticker,
              underlying: underlying.ticker
            });
          }
        }
      } catch (error) {
        console.error(`Failed to fetch redemption price from cache for ${underlying.ticker}:`, error);
        // Add issue if collector provided
        if (issueCollector) {
          issueCollector.addIssue('INVALID_PRICE_VALUE', {
            ticker: underlying.ticker,
            value: error.message,
            underlying: underlying.ticker
          });
        }
      }

      // Final fallback only if market data cache query failed
      if (!redemptionPrice && underlying.securityData.price) {
        console.warn(`Using current price as fallback for ${underlying.ticker} redemption (cache miss)`);
        redemptionPrice = {
          price: underlying.securityData.price.price || underlying.securityData.price.close,
          date: redemptionDate,
          source: 'fallback_current_price'
        };
      }

      if (redemptionPrice) {
        // Set both redemption price and final observation price for template system compatibility
        underlying.securityData.redemptionPrice = redemptionPrice;
        underlying.securityData.finalObservationPrice = redemptionPrice;
      }
    }
  },

  /**
   * Helper function to determine the correct evaluation price based on product status
   * Priority: redemption price > final observation price > live price
   */
  getEvaluationPrice(underlying, product) {
    const now = new Date();
    const finalObsDate = product.finalObservation || product.finalObservationDate;
    const maturityDate = product.maturity || product.maturityDate;

    // Check if product has been redeemed (matured or called early)
    const isRedeemed = (maturityDate && new Date(maturityDate) <= now) ||
                      (finalObsDate && new Date(finalObsDate) <= now);

    // 1. If product is redeemed, use redemption price (actual settlement price)
    if (isRedeemed && underlying.securityData?.redemptionPrice) {
      return {
        price: underlying.securityData.redemptionPrice.price || underlying.securityData.redemptionPrice.close,
        source: 'redemption',
        date: underlying.securityData.redemptionPrice.date || maturityDate
      };
    }

    // 2. If final observation date has passed, use final observation price
    if (finalObsDate && new Date(finalObsDate) <= now && underlying.securityData?.finalObservationPrice) {
      return {
        price: underlying.securityData.finalObservationPrice.price || underlying.securityData.finalObservationPrice.close,
        source: 'final_observation',
        date: underlying.securityData.finalObservationPrice.date || finalObsDate
      };
    }

    // 3. Otherwise, use live price (current market price)
    if (underlying.securityData?.price) {
      return {
        price: underlying.securityData.price.price || underlying.securityData.price.close,
        source: 'live',
        date: underlying.securityData.price.date || now
      };
    }

    // 4. Fallback to initial price
    const initialPrice = underlying.strike ||
                        (underlying.securityData?.tradeDatePrice?.price) || 0;
    return {
      price: initialPrice,
      source: 'initial_fallback',
      date: product.tradeDate || product.valueDate
    };
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
   * Generic extraction logic that works for all template types
   *
   * @param {Object} product - The product to extract underlyings from
   * @param {Object} options - Optional parameters
   * @param {ProcessingIssueCollector} options.issueCollector - Optional issue collector
   * @returns {Array} - Array of underlying data objects
   */
  async extractUnderlyingAssetsData(product, options = {}) {
    const { issueCollector } = options;
    const underlyings = [];
    const currency = product.currency || 'USD';

    if (product.underlyings && Array.isArray(product.underlyings)) {
      // Process all underlyings sequentially to fetch news
      for (const [index, underlying] of product.underlyings.entries()) {
        // Get initial price
        const initialPrice = underlying.strike ||
                           (underlying.securityData?.tradeDatePrice?.price) ||
                           (underlying.securityData?.tradeDatePrice?.close) || 0;

        // Get the correct evaluation price based on product status
        const evaluationPriceInfo = this.getEvaluationPrice(underlying, product);
        const currentPrice = evaluationPriceInfo.price;

        // Calculate performance since launch (normalized to initial level = 100%)
        let performance = initialPrice > 0 ?
          ((currentPrice - initialPrice) / initialPrice) * 100 : 0;

        // Issue detection for missing/stale price data
        if (issueCollector) {
          // Check for missing price data (using fallback)
          if (evaluationPriceInfo.source === 'initial_fallback') {
            issueCollector.addIssue('MISSING_PRICE_DATA', {
              ticker: underlying.ticker,
              underlying: underlying.ticker
            });
          }

          // Check for missing initial price
          if (!initialPrice || initialPrice === 0) {
            issueCollector.addIssue('MISSING_INITIAL_PRICE', {
              ticker: underlying.ticker,
              underlying: underlying.ticker
            });
          }

          // Check for stale price data (only if we have a price date)
          if (evaluationPriceInfo.date && evaluationPriceInfo.source === 'live') {
            const priceDate = new Date(evaluationPriceInfo.date);
            const now = new Date();
            const daysSinceUpdate = Math.floor((now - priceDate) / (1000 * 60 * 60 * 24));

            if (daysSinceUpdate > STALE_DATA_THRESHOLD_DAYS) {
              issueCollector.addIssue('STALE_PRICE_DATA', {
                ticker: underlying.ticker,
                days: daysSinceUpdate,
                underlying: underlying.ticker
              });
            }
          }
        }

        const underlyingData = {
          ticker: underlying.ticker,
          name: underlying.name || underlying.ticker,
          isin: underlying.isin || underlying.securityData?.isin || '',

          // Pricing information with proper hierarchy
          initialPrice: initialPrice,
          currentPrice: currentPrice,
          priceSource: evaluationPriceInfo.source,
          priceDate: evaluationPriceInfo.date,

          // Performance calculations
          performance: performance,
          isPositive: performance >= 0,

          // Pre-formatted displays for UI
          initialPriceFormatted: this.formatCurrency(initialPrice, currency),
          currentPriceFormatted: this.formatCurrency(currentPrice, currency),
          performanceFormatted: (performance >= 0 ? '+' : '') + performance.toFixed(2) + '%',
          priceDateFormatted: evaluationPriceInfo.date ?
            new Date(evaluationPriceInfo.date).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric'
            }) : null,

          // Market data status
          hasCurrentData: !!(underlying.securityData?.price?.price),
          lastUpdated: new Date().toISOString(),

          // Full ticker for API calls
          fullTicker: underlying.securityData?.ticker || `${underlying.ticker}.US`
        };

        underlyings.push(underlyingData);
      }
    }

    return underlyings;
  },

  /**
   * Build product status information
   * Determines if product is live, autocalled, or matured
   *
   * @param {Object} product - The product to check
   * @param {Object} options - Optional parameters
   * @param {ProcessingIssueCollector} options.issueCollector - Optional issue collector
   * @returns {Object} - Status information
   */
  buildProductStatus(product, options = {}) {
    const { issueCollector } = options;
    const now = new Date();
    const finalObsDate = product.finalObservation || product.finalObservationDate;
    const maturityDate = product.maturity || product.maturityDate;

    // Validate date configuration
    if (issueCollector) {
      if (!maturityDate) {
        issueCollector.addIssue('INVALID_DATE_CONFIGURATION', {
          field: 'maturityDate'
        });
      }
    }

    const isFinalObsPassed = finalObsDate && new Date(finalObsDate) <= now;
    const isMaturityPassed = maturityDate && new Date(maturityDate) <= now;

    const daysToMaturity = this.calculateDaysToMaturity(product);
    const daysToFinalObs = finalObsDate ?
      Math.ceil((new Date(finalObsDate) - now) / (1000 * 60 * 60 * 24)) : null;

    let productStatus = 'live';
    let statusDetails = {};

    // Product is matured when final observation has passed (not maturity date which is just settlement)
    if (isFinalObsPassed) {
      productStatus = 'matured';
      statusDetails = {
        maturedDate: finalObsDate || maturityDate,
        maturedDateFormatted: new Date(finalObsDate || maturityDate).toLocaleDateString('en-US', {
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
   * Calculate days to maturity
   */
  calculateDaysToMaturity(product) {
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const today = new Date();
    const diffTime = maturityDate - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  },

  /**
   * Check if product has matured
   */
  checkIfMatured(product) {
    const maturityDate = new Date(product.maturity || product.maturityDate);
    return new Date() >= maturityDate;
  },

  /**
   * Get next observation date (placeholder logic)
   */
  getNextObservationDate(product) {
    // This would be calculated based on observation schedule
    // For now, just return a future date
    const nextDate = new Date();
    nextDate.setMonth(nextDate.getMonth() + 3); // Quarterly
    return nextDate;
  },

  /**
   * Generate product name from underlyings and parameters
   */
  generateProductName(product, underlyings, params) {
    if (!underlyings || underlyings.length === 0) {
      return product.title || product.productName || 'Unnamed Product';
    }

    const tickers = underlyings.map(u => u.ticker).join('/');
    return `${tickers} Structured Product`;
  }
};
