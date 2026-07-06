import { MarketDataCacheCollection } from '/imports/api/marketDataCache';

/**
 * Twin Win Evaluation Helpers
 *
 * Twin Win (EUSIPA/SSPA 1135 — Capital Protection with Twin Win).
 *
 * Payoff at maturity (single payment), with:
 *   CP    = capital protection level (e.g. 100%)
 *   Bonus = guaranteed floor (e.g. 15%)
 *   LB    = lower barrier (e.g. 70%)   — touched if the underlying trades AT/BELOW it
 *   UB    = upper barrier (e.g. 130%)  — touched if the underlying trades AT/ABOVE it
 *   perf  = basket performance in % (codebase convention: (final-initial)/initial*100,
 *           so perf=+20 means the underlying is at 120% of its initial level)
 *
 *   1) Neither barrier touched: Redemption = CP + max(Bonus, |perf|)   ("twin win")
 *   2) Upper touched, lower not: Redemption = CP + max(Bonus, -perf)
 *   3) Lower touched, upper not: Redemption = CP + max(Bonus, perf)
 *   4) Both touched:            Redemption = CP + Bonus
 *
 * Minimum redemption = CP + Bonus (e.g. 115%). Fully generic — adapts to any CP/Bonus/LB/UB.
 *
 * Barrier observation:
 *   - American (default): continuous/intraday over the whole life. Approximated from daily
 *     bars — an UPPER touch uses each day's `high`, a LOWER touch uses each day's `low`
 *     (falling back to `close` when high/low are unavailable). True intraday-high/low
 *     fidelity applies to single-underlying products; for baskets the touch is evaluated on
 *     the close-based basket reference level.
 *   - European: observed only at the final fixing — compare the basket level (100 + perf)
 *     against UB/LB.
 */
export const TwinWinEvaluationHelpers = {
  /**
   * Aggregate basket performance based on configured basket type. Returns null if no data.
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
   * Enrich each underlying with its distance to the lower and upper barriers + status.
   * Distances are in performance points (e.g. LB 70% → barrierPerf -30%).
   */
  enhanceUnderlyingsWithBarrierStatus(underlyings, lowerBarrier, upperBarrier) {
    if (!underlyings || underlyings.length === 0) return underlyings;

    const lowerPerf = lowerBarrier - 100;  // e.g. 70 → -30
    const upperPerf = upperBarrier - 100;  // e.g. 130 → +30

    return underlyings.map(underlying => {
      const performance = underlying.performance || 0;
      const isPositive = performance >= 0;
      const distanceToLower = performance - lowerPerf; // >0 = above the lower barrier
      const distanceToUpper = upperPerf - performance; // >0 = below the upper barrier

      // Status reflects proximity to whichever barrier is closest to being touched
      let barrierStatus = 'safe';
      let barrierStatusText = 'Within range';
      if (performance <= lowerPerf) {
        barrierStatus = 'lower';
        barrierStatusText = 'At/Below Lower';
      } else if (performance >= upperPerf) {
        barrierStatus = 'upper';
        barrierStatusText = 'At/Above Upper';
      } else if (distanceToLower < 10 || distanceToUpper < 10) {
        barrierStatus = 'near';
        barrierStatusText = 'Near barrier';
      }

      return {
        ...underlying,
        distanceToLower,
        distanceToLowerFormatted: `${distanceToLower >= 0 ? '+' : ''}${distanceToLower.toFixed(1)}%`,
        distanceToUpper,
        distanceToUpperFormatted: `${distanceToUpper >= 0 ? '+' : ''}${distanceToUpper.toFixed(1)}%`,
        barrierStatus,
        barrierStatusText
      };
    });
  },

  /**
   * Fetch a ticker's cached daily history with exchange fallback.
   */
  async getHistory(fullTicker) {
    if (!fullTicker) return null;
    let cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker });
    if (!cacheDoc) {
      const symbol = fullTicker.split('.')[0];
      for (const ex of ['US', 'PA', 'DE', 'LSE', 'CO']) {
        cacheDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker: `${symbol}.${ex}` });
        if (cacheDoc) break;
      }
    }
    return cacheDoc && cacheDoc.history ? cacheDoc.history : null;
  },

  /**
   * Evaluate the upper AND lower barrier across the product life.
   * Returns { upperTouched, lowerTouched, upperTouchDate, lowerTouchDate,
   *           breachedTickerUpper, breachedTickerLower, observed, type }.
   */
  async evaluateDualBarrier(underlyings, params, product) {
    const { lowerBarrier, upperBarrier } = params;
    const barrierType = (params.barrierType || 'american').toLowerCase();

    if (barrierType === 'european') {
      // Observed only at final fixing: compare the basket level vs the barriers.
      const finalObs = product.finalObservation || product.finalObservationDate;
      const now = new Date();
      const finalObsDate = finalObs ? new Date(finalObs) : null;
      const finalObsPassed = finalObsDate && finalObsDate <= now;

      if (!finalObsPassed) {
        return {
          upperTouched: false,
          lowerTouched: false,
          upperTouchDate: null,
          lowerTouchDate: null,
          observed: false,
          type: 'european'
        };
      }

      const perf = this.aggregateBasketPerformance(underlyings, params.basketType);
      const level = perf === null ? 100 : 100 + perf; // basket level in %
      return {
        upperTouched: level >= upperBarrier,
        lowerTouched: level <= lowerBarrier,
        upperTouchDate: level >= upperBarrier ? finalObsDate : null,
        lowerTouchDate: level <= lowerBarrier ? finalObsDate : null,
        observed: true,
        type: 'european'
      };
    }

    // American (continuous). Scan daily bars between trade date and min(finalObs, today).
    const tradeDate = product.tradeDate || product.valueDate || product.initialDate;
    const tradeDateStr = tradeDate ? new Date(tradeDate).toISOString().split('T')[0] : null;
    const endDate = product.finalObservation || product.finalObservationDate || product.maturity || product.maturityDate;
    const endDateStr = endDate ? new Date(endDate).toISOString().split('T')[0] : null;
    const todayStr = new Date().toISOString().split('T')[0];
    const scanEndStr = endDateStr && endDateStr < todayStr ? endDateStr : todayStr;

    const isSingle = underlyings.length <= 1;

    if (isSingle) {
      // True intraday approximation using daily high (upper) / low (lower).
      const u = underlyings[0];
      const result = {
        upperTouched: false, lowerTouched: false,
        upperTouchDate: null, lowerTouchDate: null,
        breachedTickerUpper: null, breachedTickerLower: null,
        observed: true, type: 'american'
      };
      if (!u || !u.fullTicker || !u.initialPrice) return result;

      const history = await this.getHistory(u.fullTicker);
      if (!history) return result;

      const upperThreshold = u.initialPrice * (upperBarrier / 100);
      const lowerThreshold = u.initialPrice * (lowerBarrier / 100);

      for (const day of history) {
        const dayStr = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];
        if (tradeDateStr && dayStr < tradeDateStr) continue;
        if (dayStr > scanEndStr) break;

        const high = (day.high !== null && day.high !== undefined) ? day.high : day.close;
        const low = (day.low !== null && day.low !== undefined) ? day.low : day.close;

        if (!result.upperTouched && high !== null && high !== undefined && high >= upperThreshold) {
          result.upperTouched = true;
          result.upperTouchDate = dayStr;
          result.breachedTickerUpper = u.ticker;
        }
        if (!result.lowerTouched && low !== null && low !== undefined && low <= lowerThreshold) {
          result.lowerTouched = true;
          result.lowerTouchDate = dayStr;
          result.breachedTickerLower = u.ticker;
        }
        if (result.upperTouched && result.lowerTouched) break;
      }
      return result;
    }

    // Basket: build a close-based daily basket reference level, then scan it.
    const series = await this.buildBasketLevelSeries(underlyings, params.basketType, tradeDateStr, scanEndStr);
    const result = {
      upperTouched: false, lowerTouched: false,
      upperTouchDate: null, lowerTouchDate: null,
      breachedTickerUpper: null, breachedTickerLower: null,
      observed: true, type: 'american'
    };
    for (const point of series) {
      if (!result.upperTouched && point.level >= upperBarrier) {
        result.upperTouched = true;
        result.upperTouchDate = point.date;
      }
      if (!result.lowerTouched && point.level <= lowerBarrier) {
        result.lowerTouched = true;
        result.lowerTouchDate = point.date;
      }
      if (result.upperTouched && result.lowerTouched) break;
    }
    return result;
  },

  /**
   * Build a daily basket reference level series (close-based), rebased to 100 at each
   * underlying's initial price and aggregated per basketType. Only dates where every
   * underlying has data are included.
   */
  async buildBasketLevelSeries(underlyings, basketType, tradeDateStr, scanEndStr) {
    const perTicker = [];
    for (const u of underlyings) {
      if (!u.fullTicker || !u.initialPrice) return [];
      const history = await this.getHistory(u.fullTicker);
      if (!history) return [];
      const map = new Map();
      for (const day of history) {
        const dayStr = typeof day.date === 'string' ? day.date : new Date(day.date).toISOString().split('T')[0];
        if (tradeDateStr && dayStr < tradeDateStr) continue;
        if (dayStr > scanEndStr) continue;
        const close = day.adjustedClose || day.close;
        if (close === null || close === undefined) continue;
        map.set(dayStr, 100 + ((close - u.initialPrice) / u.initialPrice) * 100);
      }
      perTicker.push(map);
    }

    const aggregate = (basketType || 'worst_of').toLowerCase();
    const allDates = Array.from(new Set(perTicker.flatMap(m => Array.from(m.keys())))).sort();
    const series = [];
    for (const date of allDates) {
      const levels = perTicker.map(m => m.get(date));
      if (levels.some(v => v === undefined)) continue; // require all underlyings on this date
      let level;
      switch (aggregate) {
        case 'best_of': level = Math.max(...levels); break;
        case 'average': level = levels.reduce((s, v) => s + v, 0) / levels.length; break;
        case 'worst_of':
        default: level = Math.min(...levels);
      }
      series.push({ date, level });
    }
    return series;
  },

  /**
   * Calculate redemption value (% of denomination) via the 4-case Twin Win formula.
   */
  calculateRedemption(basketPerformance, params, barriers) {
    const perf = (basketPerformance === null || basketPerformance === undefined) ? 0 : basketPerformance;
    const CP = params.capitalProtection;
    const bonus = params.bonus;
    const upper = !!barriers.upperTouched;
    const lower = !!barriers.lowerTouched;

    let scenario;
    let participationComponent;
    let formula;

    if (!upper && !lower) {
      scenario = 'no_touch';
      participationComponent = Math.max(bonus, perf, -perf);
      formula = `${CP.toFixed(0)}% + max(${bonus.toFixed(0)}%, |${perf.toFixed(2)}%|) = ${(CP + participationComponent).toFixed(2)}%`;
    } else if (upper && !lower) {
      scenario = 'upper_touched';
      participationComponent = Math.max(bonus, -perf);
      formula = `${CP.toFixed(0)}% + max(${bonus.toFixed(0)}%, ${(-perf).toFixed(2)}%) = ${(CP + participationComponent).toFixed(2)}%`;
    } else if (!upper && lower) {
      scenario = 'lower_touched';
      participationComponent = Math.max(bonus, perf);
      formula = `${CP.toFixed(0)}% + max(${bonus.toFixed(0)}%, ${perf.toFixed(2)}%) = ${(CP + participationComponent).toFixed(2)}%`;
    } else {
      scenario = 'both_touched';
      participationComponent = bonus;
      formula = `${CP.toFixed(0)}% + ${bonus.toFixed(0)}% (Bonus) = ${(CP + bonus).toFixed(2)}%`;
    }

    const totalValue = CP + participationComponent;

    return {
      scenario,
      capitalComponent: CP,
      capitalComponentFormatted: `${CP.toFixed(2)}%`,
      participationComponent,
      participationComponentFormatted: `${participationComponent >= 0 ? '+' : ''}${participationComponent.toFixed(2)}%`,
      totalValue,
      totalValueFormatted: `${totalValue.toFixed(2)}%`,
      formula
    };
  },

  /**
   * Build product status block (live / matured + days to maturity).
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
   * Generate a descriptive product name, e.g.
   *   "URA Twin Win (100% CP, 15% Bonus, 70%/130% American)"
   *   "AAPL/MSFT Worst-of Twin Win (100% CP, 15% Bonus, 70%/130% American)"
   */
  generateProductName(underlyings, params) {
    const tickers = (underlyings || []).map(u => u.ticker).filter(Boolean);
    const tickerLabel = tickers.length === 0 ? 'Twin Win'
      : (tickers.length === 1 ? tickers[0] : tickers.join('/'));

    const basketType = (params.basketType || (tickers.length > 1 ? 'worst_of' : 'single')).toLowerCase();
    const basketLabel = tickers.length > 1
      ? (basketType === 'worst_of' ? ' Worst-of'
        : basketType === 'best_of' ? ' Best-of'
        : basketType === 'average' ? ' Average'
        : '')
      : '';

    const barrierTypeLabel = (params.barrierType || 'american').toLowerCase() === 'american' ? 'American' : 'European';

    return `${tickerLabel}${basketLabel} Twin Win (${params.capitalProtection}% CP, ${params.bonus}% Bonus, ${params.lowerBarrier}%/${params.upperBarrier}% ${barrierTypeLabel})`;
  }
};
