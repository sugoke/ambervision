import { MarketDataCacheCollection } from '/imports/api/marketDataCache';
import { SharedEvaluationHelpers } from './sharedEvaluationHelpers';

/**
 * Reverse Convertible Evaluation Helpers
 *
 * Shared utility functions for evaluating Reverse Convertible structured products.
 *
 * Product Logic:
 * - Guaranteed coupon at maturity
 * - Capital protection barrier (e.g., 70%)
 * - Above barrier: 100% + coupon
 * - Below barrier: 100% + (performance × gearing) + coupon
 *   where gearing = 1 / (barrier_level / 100)
 */
export const ReverseConvertibleEvaluationHelpers = {
  /**
   * Extract underlying assets data with pricing and performance
   */
  async extractUnderlyingAssetsData(product) {
    const underlyingAssets = product.underlyingAssets || [];
    if (underlyingAssets.length === 0) {
      console.warn('[Reverse Convertible] No underlying assets found');
      return [];
    }

    const enrichedAssets = await Promise.all(
      underlyingAssets.map(async (asset) => {
        const ticker = asset.ticker || asset.symbol;
        const fullTicker = asset.fullTicker || `${ticker}.US`;

        // Get initial price (strike price from trade date)
        const initialPrice = asset.initialPrice || asset.strike || asset.strikePrice;

        // Get current/redemption price
        const { currentPrice, priceDate, priceSource, hasCurrentData } = await this.getCurrentPrice(
          fullTicker,
          product,
          asset
        );

        // Calculate performance
        const performance = initialPrice && currentPrice
          ? ((currentPrice - initialPrice) / initialPrice) * 100
          : 0;

        return {
          id: asset._id || asset.id,
          ticker,
          fullTicker,
          name: asset.name || asset.companyName || ticker,
          isin: asset.isin,
          exchange: asset.exchange || 'US',
          currency: asset.currency || product.currency || 'USD',

          // Prices (pre-formatted)
          initialPrice,
          initialPriceFormatted: this.formatCurrency(initialPrice, asset.currency || product.currency),
          currentPrice,
          currentPriceFormatted: this.formatCurrency(currentPrice, asset.currency || product.currency),
          priceDate,
          priceDateFormatted: priceDate ? new Date(priceDate).toLocaleDateString('en-US', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
          }) : null,
          priceSource,
          priceLevelLabel: this.getPriceLevelLabel(product),
          hasCurrentData,

          // Performance (pre-formatted)
          performance,
          performanceFormatted: `${performance >= 0 ? '+' : ''}${performance.toFixed(2)}%`,
          isPositive: performance >= 0,

          // Sparkline data
          sparklineData: await (async () => {
            try {
              return await SharedEvaluationHelpers.generateSparklineData(
                fullTicker,
                product.initialDate || product.tradeDate || product.valueDate,
                product
              ) || { hasData: false };
            } catch (err) {
              console.log(`[Sparkline] Could not generate for ${fullTicker}:`, err.message);
              return { hasData: false };
            }
          })()
        };
      })
    );

    return enrichedAssets;
  },

  /**
   * Get current price for an underlying
   */
  async getCurrentPrice(fullTicker, product, asset) {
    try {
      // Determine pricing date based on product status
      const pricingDate = this.getPricingDate(product);
      const isLive = product.productStatus === 'live' || !product.productStatus;

      // Try to fetch from market data cache
      let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker });

      // Fallback: try alternative exchanges
      if (!cacheDoc) {
        const symbol = fullTicker.split('.')[0];
        const exchanges = ['US', 'PA', 'DE', 'LSE', 'CO'];
        for (const exchange of exchanges) {
          const altTicker = `${symbol}.${exchange}`;
          cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: altTicker });
          if (cacheDoc) {
            console.log(`[Reverse Convertible] Found data for ${altTicker} (fallback)`);
            break;
          }
        }
      }

      if (!cacheDoc || !cacheDoc.currentPrice) {
        console.warn(`[Reverse Convertible] No market data for ${fullTicker}`);
        return {
          currentPrice: asset.initialPrice || 0,
          priceDate: null,
          priceSource: 'initial_fallback_error',
          hasCurrentData: false
        };
      }

      // For live products, use current price
      if (isLive) {
        return {
          currentPrice: cacheDoc.currentPrice || cacheDoc.lastPrice,
          priceDate: cacheDoc.priceDate || cacheDoc.lastUpdated,
          priceSource: 'live_market_data',
          hasCurrentData: true
        };
      }

      // For matured products, try to get historical price at maturity/redemption date
      const priceDateStr = new Date(pricingDate).toISOString().split('T')[0];
      if (cacheDoc.history && cacheDoc.history.length > 0) {
        const historicalPrice = cacheDoc.history.find(record =>
          new Date(record.date).toISOString().split('T')[0] === priceDateStr
        );

        if (historicalPrice) {
          return {
            currentPrice: historicalPrice.adjustedClose || historicalPrice.close,
            priceDate: pricingDate,
            priceSource: 'historical_redemption_date',
            hasCurrentData: true
          };
        }
      }

      // Fallback: use current price even for matured products
      return {
        currentPrice: cacheDoc.currentPrice || cacheDoc.lastPrice,
        priceDate: cacheDoc.priceDate || cacheDoc.lastUpdated,
        priceSource: 'current_market_fallback',
        hasCurrentData: true
      };

    } catch (error) {
      console.error(`[Reverse Convertible] Error fetching price for ${fullTicker}:`, error);
      return {
        currentPrice: asset.initialPrice || 0,
        priceDate: null,
        priceSource: 'error_fallback',
        hasCurrentData: false
      };
    }
  },

  /**
   * Determine pricing date (current date for live products, maturity date for matured)
   */
  getPricingDate(product) {
    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;

    if (!maturityDate) return now;

    const maturity = new Date(maturityDate);
    return now > maturity ? maturity : now;
  },

  /**
   * Get price level label (Current Level vs Redemption Level)
   */
  getPriceLevelLabel(product) {
    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;

    if (!maturityDate) return 'Current Level';

    const maturity = new Date(maturityDate);
    const hasMatured = now > maturity;

    return hasMatured ? 'Redemption Level' : 'Current Level';
  },

  /**
   * Set redemption prices for matured products
   */
  async setRedemptionPricesForProduct(product) {
    if (product.productStatus !== 'matured') return;

    const redemptionDate = new Date(product.maturity || product.maturityDate);
    const redemptionDateStr = redemptionDate.toISOString().split('T')[0];

    if (product.underlyingAssets) {
      for (const asset of product.underlyingAssets) {
        if (!asset.redemptionPrice) {
          const fullTicker = asset.fullTicker || `${asset.ticker}.US`;
          const historicalPrice = await this.getPriceAtDate(fullTicker, redemptionDate);

          if (historicalPrice) {
            asset.redemptionPrice = historicalPrice;
            asset.redemptionDate = redemptionDateStr;
          }
        }
      }
    }
  },

  /**
   * Get historical price at specific date
   */
  async getPriceAtDate(ticker, targetDate) {
    try {
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
        return null;
      }

      const targetDateStr = new Date(targetDate).toISOString().split('T')[0];
      const priceRecord = cacheDoc.history.find(record =>
        new Date(record.date).toISOString().split('T')[0] === targetDateStr
      );

      return priceRecord ? (priceRecord.adjustedClose || priceRecord.close) : null;
    } catch (error) {
      console.error(`[Reverse Convertible] Error fetching price at date for ${ticker}:`, error);
      return null;
    }
  },

  /**
   * Calculate basket performance (worst-of for multi-underlying)
   */
  calculateBasketPerformance(underlyings) {
    if (!underlyings || underlyings.length === 0) return null;

    // Worst-of: minimum performance across all underlyings
    const performances = underlyings.map(u => u.performance).filter(p => p !== null && p !== undefined);
    if (performances.length === 0) return null;

    return Math.min(...performances);
  },

  /**
   * Calculate redemption value
   */
  calculateRedemption(product, basketPerformance, capitalProtectionBarrier, couponRate, gearingFactor) {
    const currency = product.currency || 'USD';

    // Check if barrier is breached
    const barrierLevel = capitalProtectionBarrier - 100; // e.g., 70 → -30%
    const barrierBreached = basketPerformance < barrierLevel;

    let capitalComponent;
    let capitalExplanation;

    if (!barrierBreached) {
      // Above barrier: 100% capital back
      capitalComponent = 100;
      capitalExplanation = `Capital protected: ${capitalProtectionBarrier}% barrier not breached`;
    } else {
      // Below barrier: 100% + (performance × gearing)
      capitalComponent = 100 + (basketPerformance * gearingFactor);
      capitalExplanation = `Barrier breached: 100% + (${basketPerformance.toFixed(2)}% × ${gearingFactor.toFixed(2)})`;
    }

    // Add coupon
    const totalValue = capitalComponent + couponRate;

    return {
      capitalComponent,
      capitalComponentFormatted: `${capitalComponent.toFixed(2)}%`,
      coupon: couponRate,
      couponFormatted: `${couponRate.toFixed(1)}%`,
      totalValue,
      totalValueFormatted: `${totalValue.toFixed(2)}%`,
      barrierBreached,
      capitalExplanation,
      formula: barrierBreached
        ? `100% + (${basketPerformance.toFixed(2)}% × ${gearingFactor.toFixed(2)}) + ${couponRate.toFixed(1)}% = ${totalValue.toFixed(2)}%`
        : `100% + ${couponRate.toFixed(1)}% = ${totalValue.toFixed(2)}%`
    };
  },

  /**
   * Build product status
   */
  buildProductStatus(product) {
    const now = new Date();
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const hasMatured = now > maturityDate;

    const daysToMaturity = Math.ceil((maturityDate - now) / (1000 * 60 * 60 * 24));

    return {
      productStatus: hasMatured ? 'matured' : 'live',
      statusDetails: {
        hasMatured,
        maturityDate: product.maturity || product.maturityDate,
        maturityDateFormatted: maturityDate.toLocaleDateString('en-US', {
          day: '2-digit',
          month: 'short',
          year: 'numeric'
        })
      },
      evaluationDate: now,
      evaluationDateFormatted: now.toLocaleDateString('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
      }),
      daysToMaturity,
      daysToMaturityText: hasMatured
        ? `${Math.abs(daysToMaturity)} days (matured)`
        : `${daysToMaturity} days remaining`,
      hasMatured
    };
  },

  /**
   * Format currency
   */
  formatCurrency(amount, currency = 'USD') {
    if (amount === null || amount === undefined) return 'N/A';

    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

    return formatter.format(amount);
  },

  /**
   * Generate product name
   */
  generateProductName(underlyings, reverseConvertibleParams) {
    if (!underlyings || underlyings.length === 0) {
      return `Reverse Convertible (${reverseConvertibleParams.capitalProtectionBarrier}% protection)`;
    }

    const tickers = underlyings.map(u => u.ticker).join('/');
    const basketLabel = underlyings.length > 1 ? ' Basket' : '';

    return `${tickers}${basketLabel} Reverse Convertible (${reverseConvertibleParams.capitalProtectionBarrier}% protection, ${reverseConvertibleParams.couponRate}% coupon)`;
  }
};
