import { MarketDataCacheCollection } from '/imports/api/marketDataCache';
import { ManualPriceTrackersCollection } from '/imports/api/manualPriceTrackers';
import { SharedEvaluationHelpers } from './sharedEvaluationHelpers';
import { getSplitAdjustedStrike } from '/imports/api/splitAdjustment';

/**
 * Reverse Convertible (Bond) Evaluation Helpers
 *
 * Shared utility functions for evaluating Reverse Convertible structured products on bond underlyings.
 *
 * Product Logic (Physical Delivery / Conversion Ratio model):
 * - Guaranteed coupon at maturity
 * - Strike level (% of par) - threshold for physical delivery
 * - Above strike: Cash settlement = 100% of denomination + coupon
 * - At or below strike: Physical delivery via Conversion Ratio + coupon
 *   Conversion Ratio = Denomination / ((Strike + Accrued Interest) / 100 x Par Amount)
 *   Delivery value as % = Final Fixing / (Strike + Accrued Interest) x 100
 */
export const ReverseConvertibleBondEvaluationHelpers = {
  /**
   * Extract underlying assets data with pricing and performance
   */
  async extractUnderlyingAssetsData(product) {
    const underlyingAssets = product.underlyingAssets || product.underlyings || [];
    if (underlyingAssets.length === 0) {
      console.warn('[Reverse Convertible Bond] No underlying assets found');
      return [];
    }

    const enrichedAssets = await Promise.all(
      underlyingAssets.map(async (asset) => {
        const ticker = asset.ticker || asset.symbol;
        const fullTicker = asset.fullTicker || `${ticker}.US`;

        // Get split-adjusted initial price (strike price from trade date)
        const splitResult = await getSplitAdjustedStrike(
          { ...asset, securityData: { ticker: fullTicker } },
          product
        );
        const initialPrice = splitResult.adjustedStrike;

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
          strikeLevel: asset.strikeLevel || 0,

          // Prices (pre-formatted as % of par — bond prices are expressed as % of par value)
          initialPrice,
          initialPriceFormatted: this.formatBondPrice(initialPrice),
          currentPrice,
          currentPriceFormatted: this.formatBondPrice(currentPrice),
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

          // Split adjustment info
          splitAdjustment: splitResult.factor !== 1.0 ? {
            factor: splitResult.factor,
            originalStrike: asset.initialPrice || asset.strike || asset.strikePrice,
            adjustedStrike: splitResult.adjustedStrike,
            splits: splitResult.splits
          } : null,

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
            console.log(`[Reverse Convertible Bond] Found data for ${altTicker} (fallback)`);
            break;
          }
        }
      }

      if (!cacheDoc || !cacheDoc.currentPrice) {
        // Fallback: check manual price tracker by ISIN
        const isin = asset.isin || asset.securityData?.isin;
        if (isin) {
          const manualTracker = await ManualPriceTrackersCollection.findOneAsync({
            isin,
            isActive: true,
            latestPrice: { $ne: null }
          });
          if (manualTracker) {
            console.log(`[Reverse Convertible Bond] Using manual scraper price for ${fullTicker} (${isin}): ${manualTracker.latestPrice}`);
            return {
              currentPrice: manualTracker.latestPrice,
              priceDate: manualTracker.lastScrapedAt,
              priceSource: 'manual_scraper',
              hasCurrentData: true
            };
          }
        }

        console.warn(`[Reverse Convertible Bond] No market data for ${fullTicker}`);
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
      console.error(`[Reverse Convertible Bond] Error fetching price for ${fullTicker}:`, error);
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

    const assetsArray = product.underlyingAssets || product.underlyings;
    if (assetsArray) {
      for (const asset of assetsArray) {
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
      console.error(`[Reverse Convertible Bond] Error fetching price at date for ${ticker}:`, error);
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
   * Calculate redemption value using physical delivery / conversion ratio model
   *
   * @param {Object} product - Product object
   * @param {number} finalBondPrice - Worst-of current bond price as % of par (e.g. 67.04)
   * @param {number} strikeLevel - Strike level as % of par (e.g. 72.45)
   * @param {number} couponRate - Guaranteed coupon rate (e.g. 5.0)
   * @param {number} accruedInterest - Accrued interest at redemption (% of par, e.g. 1.2)
   */
  calculateRedemption(product, finalBondPrice, strikeLevel, couponRate, accruedInterest) {
    const currency = product.currency || 'USD';
    const denomination = (product.structureParams || product.structureParameters || {}).denomination || 1000;
    const parAmount = (product.structureParams || product.structureParameters || {}).parAmount || 1000;

    // For bonds: final level IS the current bond price as % of par (not a relative performance)
    const finalLevel = finalBondPrice;

    // Check if bond price is above strike (both in % of par)
    const isAboveStrike = finalLevel > strikeLevel;
    const strikeBreached = !isAboveStrike;

    // Calculate conversion ratio
    const conversionRatio = denomination / ((strikeLevel + accruedInterest) / 100 * parAmount);

    let capitalComponent;
    let capitalExplanation;
    let formula;
    let settlementType;
    let deliveryValue = null;

    if (isAboveStrike) {
      // Above strike: Cash settlement = 100% of denomination
      capitalComponent = 100;
      settlementType = 'cash';
      capitalExplanation = `Bond level (${finalLevel.toFixed(2)}%) is above strike (${strikeLevel.toFixed(2)}%): cash settlement at 100%`;
      formula = `100% + ${couponRate.toFixed(1)}% = ${(100 + couponRate).toFixed(2)}%`;
    } else {
      // At or below strike: Physical delivery
      // Delivery value as % of denomination = Final Fixing / (Strike + Accrued Interest) x 100
      deliveryValue = (finalLevel / (strikeLevel + accruedInterest)) * 100;
      capitalComponent = deliveryValue;
      settlementType = 'physical_delivery';
      capitalExplanation = `Bond level (${finalLevel.toFixed(2)}%) is at/below strike (${strikeLevel.toFixed(2)}%): physical delivery via conversion ratio`;
      formula = `${finalLevel.toFixed(2)}% / (${strikeLevel.toFixed(2)}% + ${accruedInterest.toFixed(2)}%) x 100 + ${couponRate.toFixed(1)}% = ${(deliveryValue + couponRate).toFixed(2)}%`;
    }

    // Total = capital component + coupon (coupon is always paid)
    const totalValue = capitalComponent + couponRate;

    return {
      capitalComponent,
      capitalComponentFormatted: `${capitalComponent.toFixed(2)}%`,
      coupon: couponRate,
      couponFormatted: `${couponRate.toFixed(1)}%`,
      totalValue,
      totalValueFormatted: `${totalValue.toFixed(2)}%`,
      settlementType,
      strikeBreached,
      capitalExplanation,
      formula,
      conversionRatio,
      conversionRatioFormatted: conversionRatio.toFixed(4),
      deliveryValue,
      deliveryValueFormatted: deliveryValue !== null ? `${deliveryValue.toFixed(2)}%` : 'N/A'
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
   * Format bond price as % of par (e.g. 71.1644 → "71.16%")
   */
  formatBondPrice(price) {
    if (price === null || price === undefined) return 'N/A';
    return `${price.toFixed(2)}%`;
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
      return `Reverse Convertible (Bond) (${reverseConvertibleParams.strikeLevel}% strike)`;
    }

    const tickers = underlyings.map(u => u.ticker).join('/');
    const basketLabel = underlyings.length > 1 ? ' Basket' : '';

    return `${tickers}${basketLabel} Reverse Convertible (Bond) (${reverseConvertibleParams.strikeLevel}% strike, ${reverseConvertibleParams.couponRate}% coupon)`;
  }
};
