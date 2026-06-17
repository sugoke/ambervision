import { MarketDataCacheCollection } from '/imports/api/marketDataCache';
import { ManualPriceTrackersCollection } from '/imports/api/manualPriceTrackers';
import { SharedEvaluationHelpers } from './sharedEvaluationHelpers';
import { getSplitAdjustedStrike } from '/imports/api/splitAdjustment';

/**
 * Bonus Certificate Evaluation Helpers
 *
 * Payoff logic:
 *   basketPerf = aggregate(perf_i)   // worst_of | best_of | average | single
 *   if knockIn has occurred:
 *     Redemption = Denom × (100% + basketPerf)            // 1:1 with underlying
 *   else:
 *     bonusOrUpside = max(0%, participationRate × basketPerf)
 *     if cap is set: bonusOrUpside = min(cap, bonusOrUpside)
 *     Redemption = Denom × (100% + bonusOrUpside)         // bonus floor at 100%
 *
 * Setting participation=100% and cap=null gives plain Bonus Certificate (SSPA 1320).
 * Termsheet 2 values (120% / 66%) give Capped Bonus Outperformance (SSPA 1330).
 */
export const BonusCertificateEvaluationHelpers = {
  /**
   * Extract underlying assets data with pricing and performance (mirrors RC helper).
   */
  async extractUnderlyingAssetsData(product) {
    const underlyingAssets = product.underlyingAssets || [];
    if (underlyingAssets.length === 0) {
      console.warn('[Bonus Certificate] No underlying assets found');
      return [];
    }

    const enrichedAssets = await Promise.all(
      underlyingAssets.map(async (asset) => {
        const ticker = asset.ticker || asset.symbol;
        const fullTicker = asset.fullTicker || `${ticker}.US`;

        const splitResult = await getSplitAdjustedStrike(
          { ...asset, securityData: { ticker: fullTicker } },
          product
        );
        const initialPrice = splitResult.adjustedStrike;

        const { currentPrice, priceDate, priceSource, hasCurrentData } = await this.getCurrentPrice(
          fullTicker,
          product,
          asset
        );

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

          initialPrice,
          initialPriceFormatted: this.formatCurrency(initialPrice, asset.currency || product.currency),
          currentPrice,
          currentPriceFormatted: this.formatCurrency(currentPrice, asset.currency || product.currency),
          priceDate,
          priceDateFormatted: priceDate ? new Date(priceDate).toLocaleDateString('en-US', {
            day: '2-digit', month: 'short', year: 'numeric'
          }) : null,
          priceSource,
          priceLevelLabel: this.getPriceLevelLabel(product),
          hasCurrentData,

          performance,
          performanceFormatted: `${performance >= 0 ? '+' : ''}${performance.toFixed(2)}%`,
          isPositive: performance >= 0,

          splitAdjustment: splitResult.factor !== 1.0 ? {
            factor: splitResult.factor,
            originalStrike: asset.initialPrice || asset.strike || asset.strikePrice,
            adjustedStrike: splitResult.adjustedStrike,
            splits: splitResult.splits
          } : null,

          sparklineData: await (async () => {
            try {
              return await SharedEvaluationHelpers.generateSparklineData(
                fullTicker,
                product.initialDate || product.tradeDate || product.valueDate,
                product
              ) || { hasData: false };
            } catch (err) {
              return { hasData: false };
            }
          })()
        };
      })
    );

    return enrichedAssets;
  },

  /**
   * Get current price for an underlying (mirrors RC helper).
   */
  async getCurrentPrice(fullTicker, product, asset) {
    try {
      const pricingDate = this.getPricingDate(product);
      const isLive = product.productStatus === 'live' || !product.productStatus;

      let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker });

      if (!cacheDoc) {
        const symbol = fullTicker.split('.')[0];
        const exchanges = ['US', 'PA', 'DE', 'LSE', 'CO'];
        for (const exchange of exchanges) {
          const altTicker = `${symbol}.${exchange}`;
          cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: altTicker });
          if (cacheDoc) break;
        }
      }

      if (!cacheDoc || !cacheDoc.currentPrice) {
        const isin = asset.isin || asset.securityData?.isin;
        if (isin) {
          const manualTracker = await ManualPriceTrackersCollection.findOneAsync({
            isin,
            isActive: true,
            latestPrice: { $ne: null }
          });
          if (manualTracker) {
            return {
              currentPrice: manualTracker.latestPrice,
              priceDate: manualTracker.lastScrapedAt,
              priceSource: 'manual_scraper',
              hasCurrentData: true
            };
          }
        }
        return {
          currentPrice: asset.initialPrice || 0,
          priceDate: null,
          priceSource: 'initial_fallback_error',
          hasCurrentData: false
        };
      }

      if (isLive) {
        return {
          currentPrice: cacheDoc.currentPrice || cacheDoc.lastPrice,
          priceDate: cacheDoc.priceDate || cacheDoc.lastUpdated,
          priceSource: 'live_market_data',
          hasCurrentData: true
        };
      }

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

      return {
        currentPrice: cacheDoc.currentPrice || cacheDoc.lastPrice,
        priceDate: cacheDoc.priceDate || cacheDoc.lastUpdated,
        priceSource: 'current_market_fallback',
        hasCurrentData: true
      };
    } catch (error) {
      console.error(`[Bonus Certificate] Error fetching price for ${fullTicker}:`, error);
      return {
        currentPrice: asset.initialPrice || 0,
        priceDate: null,
        priceSource: 'error_fallback',
        hasCurrentData: false
      };
    }
  },

  getPricingDate(product) {
    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;
    if (!maturityDate) return now;
    const maturity = new Date(maturityDate);
    return now > maturity ? maturity : now;
  },

  getPriceLevelLabel(product) {
    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;
    if (!maturityDate) return 'Current Level';
    return now > new Date(maturityDate) ? 'Redemption Level' : 'Current Level';
  },

  /**
   * Aggregate basket performance based on configured basket type.
   * Returns null if no valid performances.
   */
  aggregateBasketPerformance(underlyings, basketType) {
    if (!underlyings || underlyings.length === 0) return null;
    const performances = underlyings.map(u => u.performance).filter(p => p !== null && p !== undefined);
    if (performances.length === 0) return null;

    switch ((basketType || 'worst_of').toLowerCase()) {
      case 'best_of':
        return Math.max(...performances);
      case 'average':
        return performances.reduce((s, p) => s + p, 0) / performances.length;
      case 'single':
        return performances[0];
      case 'worst_of':
      default:
        return Math.min(...performances);
    }
  },

  /**
   * Evaluate whether a knock-in event has occurred.
   *
   * European: knock-in checked only at the final fixing date.
   *   - If product not yet at final fixing → not yet observable; we still surface the
   *     current basket level vs threshold so the user can see the safety margin.
   * American: checked on every business day between trade date and the final fixing date.
   *   - Scans each underlying's historical price series for any close at or below
   *     `barrierLevel%` of its initial price.
   */
  async evaluateKnockIn(underlyings, params, product) {
    const barrierLevel = params.barrierLevel; // percent (e.g. 60)
    const barrierType = (params.barrierType || 'european').toLowerCase();
    const barrierPerformanceThreshold = barrierLevel - 100; // e.g. 60 → -40%

    // For both types we also compute current distance for the report
    const currentBasketPerf = this.aggregateBasketPerformance(underlyings, params.basketType);
    const currentDistance = currentBasketPerf === null ? null : currentBasketPerf - barrierPerformanceThreshold;

    if (barrierType === 'european') {
      // Has the final fixing date passed?
      const finalObs = product.finalObservation || product.finalObservationDate;
      const now = new Date();
      const finalObsDate = finalObs ? new Date(finalObs) : null;
      const finalObsPassed = finalObsDate && finalObsDate <= now;

      if (!finalObsPassed) {
        return {
          hasOccurred: false,
          observed: false,
          occurredAt: null,
          type: 'european',
          currentDistance,
          currentBasketPerf
        };
      }

      // Final fixing passed → check basket at final
      const hasOccurred = currentBasketPerf !== null && currentBasketPerf <= barrierPerformanceThreshold;
      return {
        hasOccurred,
        observed: true,
        occurredAt: hasOccurred ? finalObsDate : null,
        type: 'european',
        currentDistance,
        currentBasketPerf
      };
    }

    // American: scan history for each underlying. Knock-in triggers on the first day
    // any single underlying closes at or below its barrier level.
    const tradeDate = product.tradeDate || product.valueDate || product.initialDate;
    const tradeDateStr = tradeDate ? new Date(tradeDate).toISOString().split('T')[0] : null;
    const endDate = product.finalObservation || product.finalObservationDate || product.maturity || product.maturityDate;
    const endDateStr = endDate ? new Date(endDate).toISOString().split('T')[0] : null;
    const todayStr = new Date().toISOString().split('T')[0];
    const scanEndStr = endDateStr && endDateStr < todayStr ? endDateStr : todayStr;

    let earliestBreach = null;
    let breachedTicker = null;

    for (const u of underlyings) {
      if (!u.fullTicker || !u.initialPrice) continue;
      const threshold = u.initialPrice * (barrierLevel / 100);

      let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: u.fullTicker });
      if (!cacheDoc) {
        const symbol = u.fullTicker.split('.')[0];
        for (const ex of ['US', 'PA', 'DE', 'LSE', 'CO']) {
          cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: `${symbol}.${ex}` });
          if (cacheDoc) break;
        }
      }
      if (!cacheDoc || !cacheDoc.history) continue;

      for (const day of cacheDoc.history) {
        const dayStr = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];
        if (tradeDateStr && dayStr < tradeDateStr) continue;
        if (dayStr > scanEndStr) break;
        const close = day.adjustedClose || day.close;
        if (close !== null && close !== undefined && close <= threshold) {
          if (!earliestBreach || dayStr < earliestBreach) {
            earliestBreach = dayStr;
            breachedTicker = u.ticker;
          }
          break; // first breach is sufficient for this underlying
        }
      }
    }

    return {
      hasOccurred: !!earliestBreach,
      observed: true,
      occurredAt: earliestBreach,
      breachedTicker,
      type: 'american',
      currentDistance,
      currentBasketPerf
    };
  },

  /**
   * Calculate redemption value (% of denomination).
   */
  calculateRedemption(basketPerformance, params, knockInOccurred) {
    const safeBasketPerf = basketPerformance === null || basketPerformance === undefined ? 0 : basketPerformance;
    const participationRate = params.participationRate !== undefined ? params.participationRate : 100;
    const capEnabled = !!params.capEnabled && params.cap !== null && params.cap !== undefined;
    const cap = capEnabled ? params.cap : null;

    let scenario;
    let bonusOrUpside;
    let totalValue;
    let formula;

    if (knockInOccurred) {
      // 1:1 with underlying (downside fully exposed)
      scenario = 'knock_in_breached';
      bonusOrUpside = safeBasketPerf;
      totalValue = 100 + safeBasketPerf;
      formula = `100% + (${safeBasketPerf.toFixed(2)}%) = ${totalValue.toFixed(2)}%`;
    } else {
      // Bonus floor active
      const leveredUpside = (participationRate / 100) * safeBasketPerf;
      let raw = Math.max(0, leveredUpside);
      if (capEnabled) {
        raw = Math.min(cap, raw);
      }
      bonusOrUpside = raw;
      totalValue = 100 + raw;
      scenario = (raw === 0) ? 'no_ki_bonus_floor' : (capEnabled && raw >= cap ? 'no_ki_capped' : 'no_ki_outperformance');
      const partLabel = `${participationRate.toFixed(0)}% × ${safeBasketPerf.toFixed(2)}%`;
      const capLabel = capEnabled ? `, capped at ${cap.toFixed(2)}%` : '';
      formula = `100% + max(0%, ${partLabel}${capLabel}) = ${totalValue.toFixed(2)}%`;
    }

    return {
      scenario,
      bonusOrUpside,
      bonusOrUpsideFormatted: `${bonusOrUpside >= 0 ? '+' : ''}${bonusOrUpside.toFixed(2)}%`,
      capitalComponent: knockInOccurred ? 100 + safeBasketPerf : 100,
      capitalComponentFormatted: knockInOccurred
        ? `${(100 + safeBasketPerf).toFixed(2)}%`
        : '100.00%',
      totalValue,
      totalValueFormatted: `${totalValue.toFixed(2)}%`,
      knockInOccurred,
      formula
    };
  },

  /**
   * Build product status block.
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
          day: '2-digit', month: 'short', year: 'numeric'
        })
      },
      evaluationDate: now,
      evaluationDateFormatted: now.toLocaleDateString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric'
      }),
      daysToMaturity,
      daysToMaturityText: hasMatured
        ? `${Math.abs(daysToMaturity)} days (matured)`
        : `${daysToMaturity} days remaining`,
      hasMatured
    };
  },

  formatCurrency(amount, currency = 'USD') {
    if (amount === null || amount === undefined) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  },

  /**
   * Generate descriptive product name.
   *   e.g. "TSLA Capped Bonus (60% KI European, 120%/+66%)"
   *        "STM/TTE/BNP/ENR Worst-of Bonus (70% KI American, 100%)"
   */
  generateProductName(underlyings, params) {
    const tickers = (underlyings || []).map(u => u.ticker).filter(Boolean);
    const tickerLabel = tickers.length === 0 ? 'Bonus Certificate' :
      (tickers.length === 1 ? tickers[0] : tickers.join('/'));

    const basketType = (params.basketType || (tickers.length > 1 ? 'worst_of' : 'single')).toLowerCase();
    const basketLabel = tickers.length > 1
      ? (basketType === 'worst_of' ? ' Worst-of'
        : basketType === 'best_of' ? ' Best-of'
        : basketType === 'average' ? ' Average'
        : '')
      : '';

    const variantLabel = params.capEnabled && params.cap !== null ? 'Capped Bonus' : 'Bonus';
    const participation = params.participationRate !== undefined ? params.participationRate : 100;
    const participationLabel = participation === 100 ? '' : ` ${participation.toFixed(0)}%`;
    const capLabel = params.capEnabled && params.cap !== null ? `/+${params.cap.toFixed(0)}%` : '';
    const barrierTypeLabel = (params.barrierType || 'european').toLowerCase() === 'american' ? 'American' : 'European';

    return `${tickerLabel}${basketLabel} ${variantLabel} (${params.barrierLevel}% KI ${barrierTypeLabel}${participationLabel ? ',' + participationLabel : ''}${capLabel})`;
  }
};
