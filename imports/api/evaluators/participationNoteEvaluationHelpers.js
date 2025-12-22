import { MarketDataHelpers } from '/imports/api/marketDataCache';
import { EODApiHelpers } from '/imports/api/eodApi';

/**
 * Participation Note Evaluation Helpers
 *
 * Dedicated helper functions for Participation Note template evaluation.
 * ISOLATED from other templates to prevent cross-template breaking changes.
 *
 * Participation Note Structure:
 * - At maturity: investor receives performance of underlying(s) from predetermined strike
 * - Performance is multiplied by participation rate (e.g., 150% participation)
 * - Supports single underlying or basket (worst-of, best-of, average)
 * - Optional: Can be called at issuer's discretion (issuer call option)
 * - Payoff formula: 100% + (Underlying Performance × Participation Rate)
 */
export const ParticipationNoteEvaluationHelpers = {
  /**
   * Set trade date prices for all underlyings
   * This ensures we have proper initial prices for performance calculations
   */
  async setTradeDatePricesForProduct(product) {
    if (!product.underlyings || !Array.isArray(product.underlyings)) {
      return;
    }

    const tradeDate = product.tradeDate || product.valueDate;
    if (!tradeDate) {
      console.warn('Participation Note: No trade date found, cannot fetch historical prices');
      return;
    }

    const tradeDateObj = new Date(tradeDate);
    console.log(`📅 [Participation Note] Fetching trade date prices for ${tradeDateObj.toISOString().split('T')[0]}`);

    // Fetch trade date prices for each underlying
    for (const underlying of product.underlyings) {
      // Initialize securityData if it doesn't exist
      if (!underlying.securityData) {
        underlying.securityData = {};
      }

      let tradeDatePrice = null;

      try {
        const fullTicker = underlying.securityData.ticker || `${underlying.ticker}.US`;
        const historicalData = await MarketDataHelpers.getHistoricalData(
          fullTicker,
          tradeDateObj,
          tradeDateObj
        );

        if (historicalData && historicalData.length > 0) {
          tradeDatePrice = {
            price: historicalData[0].close,
            close: historicalData[0].close,
            date: historicalData[0].date,
            source: 'market_data_cache'
          };
          console.log(`✅ [Participation Note] Found trade date price for ${underlying.ticker}: ${tradeDatePrice.price}`);
        } else {
          console.warn(`⚠️ [Participation Note] No historical data found for ${underlying.ticker} on ${tradeDateObj.toISOString().split('T')[0]}`);
        }
      } catch (error) {
        console.error(`❌ [Participation Note] Failed to fetch trade date price for ${underlying.ticker}:`, error);
      }

      // If we have a trade date price, set it; otherwise try to use strike as fallback
      if (tradeDatePrice) {
        underlying.securityData.tradeDatePrice = tradeDatePrice;
      } else if (underlying.strike) {
        // Fallback: use strike as trade date price (assumes strike was set correctly at creation)
        underlying.securityData.tradeDatePrice = {
          price: underlying.strike,
          close: underlying.strike,
          date: tradeDateObj,
          source: 'strike_fallback'
        };
        console.log(`⚠️ [Participation Note] Using strike as fallback trade date price for ${underlying.ticker}: ${underlying.strike}`);
      }
    }
  },

  /**
   * Set redemption prices for redeemed Participation Note products
   */
  async setRedemptionPricesForProduct(product) {
    if (!product.underlyings || !Array.isArray(product.underlyings)) {
      return;
    }

    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;

    // Strip time components for date-only comparison
    const nowDateOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // Maturity is settlement date - product has matured ON or after this date
    const isMaturityPassed = maturityDate && (() => {
      const maturityDateOnly = new Date(new Date(maturityDate).getFullYear(), new Date(maturityDate).getMonth(), new Date(maturityDate).getDate());
      return maturityDateOnly <= nowDateOnly;
    })();

    // Check if product was called by issuer
    const issuerCallDate = product.structureParameters?.issuerCallDate || product.structure?.issuerCallDate;
    const isCalledByIssuer = issuerCallDate && (() => {
      const issuerCallDateOnly = new Date(new Date(issuerCallDate).getFullYear(), new Date(issuerCallDate).getMonth(), new Date(issuerCallDate).getDate());
      return issuerCallDateOnly <= nowDateOnly;
    })();

    // Use call date or maturity date for redemption
    const redemptionDate = isCalledByIssuer ? new Date(issuerCallDate) : (isMaturityPassed ? new Date(maturityDate) : null);

    if (!redemptionDate) {
      return;
    }

    // Set redemption prices for each underlying
    for (const underlying of product.underlyings) {
      // Initialize securityData if it doesn't exist
      if (!underlying.securityData) {
        underlying.securityData = {};
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
        console.error(`Participation Note: Failed to fetch redemption price for ${underlying.ticker}:`, error);
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
   * Get evaluation price for Participation Note products
   */
  getEvaluationPrice(underlying, product) {
    const now = new Date();
    const maturityDate = product.maturity || product.maturityDate;
    const issuerCallDate = product.structureParameters?.issuerCallDate || product.structure?.issuerCallDate;

    // Check if redeemed (matured or called)
    const isMatured = maturityDate && new Date(maturityDate) <= now;
    const isCalled = issuerCallDate && new Date(issuerCallDate) <= now;
    const isRedeemed = isMatured || isCalled;

    if (isRedeemed && underlying.securityData?.redemptionPrice) {
      return {
        price: underlying.securityData.redemptionPrice.price || underlying.securityData.redemptionPrice.close,
        source: isCalled ? 'issuer_call' : 'redemption',
        date: underlying.securityData.redemptionPrice.date || (isCalled ? issuerCallDate : maturityDate)
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
   * Calculate Participation Note redemption with participation rate and capital protection
   * Note: Capital guarantee only applies when product is called by issuer
   */
  calculateRedemption(product, basketPerformance, participationRate) {
    // Apply participation rate to performance
    const participatedPerformance = basketPerformance * (participationRate / 100);
    let rawRedemption = 100 + participatedPerformance;

    // Check if product has been called by issuer
    const structureParams = product.structureParams || product.structureParameters || {};
    const structure = product.structure || {};
    const issuerCallDate = structureParams.issuerCallDate || structure.issuerCallDate;
    const isCalled = issuerCallDate && new Date(issuerCallDate) <= new Date();

    // Capital guarantee only applies if product was called by issuer
    let protectionLevel = null;
    let hasProtection = false;
    let protectionApplied = false;
    let finalRedemption = rawRedemption;

    if (isCalled) {
      // Product was called - apply capital guarantee
      protectionLevel = structureParams.capitalGuarantee ||
                       structureParams.protectionBarrier ||
                       structureParams.capitalProtection ||
                       structure.capitalGuarantee ||
                       structure.protectionBarrier ||
                       structure.capitalProtection ||
                       null;

      // Also check in components (for drag-and-drop products)
      if (!protectionLevel && product.components && Array.isArray(product.components)) {
        const protectionComponent = product.components.find(c =>
          c.type === 'BARRIER' &&
          (c.barrier_type === 'protection' || c.barrier_type === 'capital_protection')
        );
        if (protectionComponent) {
          protectionLevel = protectionComponent.barrier_level || protectionComponent.value;
        }
      }

      // Apply protection floor if it exists
      if (protectionLevel !== null && protectionLevel !== undefined) {
        hasProtection = true;
        finalRedemption = Math.max(rawRedemption, protectionLevel);
        protectionApplied = rawRedemption < protectionLevel;
      }
    }

    // Build formula
    let formula;
    if (isCalled && protectionApplied) {
      formula = `Called by Issuer: Max(100% + (${basketPerformance.toFixed(2)}% × ${participationRate.toFixed(0)}%), ${protectionLevel.toFixed(0)}%) = ${finalRedemption.toFixed(2)}%`;
    } else if (isCalled && hasProtection) {
      formula = `Called by Issuer: 100% + (${basketPerformance.toFixed(2)}% × ${participationRate.toFixed(0)}%) = ${finalRedemption.toFixed(2)}% (guarantee at ${protectionLevel.toFixed(0)}%)`;
    } else {
      formula = `100% + (${basketPerformance.toFixed(2)}% × ${participationRate.toFixed(0)}%) = ${finalRedemption.toFixed(2)}%`;
    }

    return {
      redemption: finalRedemption,
      type: isCalled && protectionApplied ? 'called_with_guarantee' : (isCalled ? 'called' : 'participation'),
      formula: formula,
      rawPerformance: basketPerformance,
      participatedPerformance: participatedPerformance,
      participationRate: participationRate,
      hasProtection: hasProtection,
      protectionLevel: protectionLevel,
      protectionApplied: protectionApplied,
      rawRedemption: rawRedemption,
      isCalled: isCalled
    };
  },

  /**
   * Check if issuer has called the product
   */
  checkIssuerCall(product) {
    const now = new Date();
    const issuerCallDate = product.structureParameters?.issuerCallDate || product.structure?.issuerCallDate;
    let issuerCallPrice = product.structureParameters?.issuerCallPrice || product.structure?.issuerCallPrice;
    const issuerCallRebateRaw = product.structureParams?.issuerCallRebate || product.structureParameters?.issuerCallRebate || 0;
    const issuerCallRebateType = product.structureParams?.issuerCallRebateType || product.structureParameters?.issuerCallRebateType || 'fixed';

    if (!issuerCallDate) {
      return {
        hasCallOption: false,
        isCalled: false,
        callDate: null,
        callPrice: null,
        rebate: null,
        rebateType: null
      };
    }

    const isCalled = new Date(issuerCallDate) <= now;

    // Calculate actual rebate based on type
    let issuerCallRebate = issuerCallRebateRaw;
    let rebateCalculationDetails = null;

    if (issuerCallRebateType === 'per_annum' && issuerCallRebateRaw > 0) {
      // Calculate prorated rebate based on days held
      const tradeDate = product.tradeDate || product.valueDate;
      if (tradeDate) {
        const tradeDateObj = new Date(tradeDate);
        const callDateObj = new Date(issuerCallDate);
        const daysHeld = Math.ceil((callDateObj - tradeDateObj) / (1000 * 60 * 60 * 24));
        const yearsHeld = daysHeld / 365;

        // Prorate the annual rate
        issuerCallRebate = issuerCallRebateRaw * yearsHeld;

        rebateCalculationDetails = {
          annualRate: issuerCallRebateRaw,
          daysHeld: daysHeld,
          yearsHeld: yearsHeld,
          proratedRebate: issuerCallRebate
        };

        console.log(`[Participation Note] Prorated rebate calculation: ${issuerCallRebateRaw}% p.a. × ${daysHeld} days / 365 = ${issuerCallRebate.toFixed(2)}%`);
      }
    }

    // Track whether an explicit call price was set by user
    const hasExplicitCallPrice = !!issuerCallPrice;

    // If no explicit call price set, use 100% as base
    if (!issuerCallPrice) {
      issuerCallPrice = 100;
    }

    // Calculate total: call price + rebate (rebate is separate, never double-count)
    const totalReceived = issuerCallPrice + issuerCallRebate;

    return {
      hasCallOption: true,
      isCalled: isCalled,
      callDate: issuerCallDate,
      callDateFormatted: new Date(issuerCallDate).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }),
      callPrice: issuerCallPrice,
      callPriceFormatted: `${issuerCallPrice.toFixed(2)}%`,
      hasExplicitCallPrice: hasExplicitCallPrice,
      rebate: issuerCallRebate,
      rebateFormatted: issuerCallRebate > 0 ? `${issuerCallRebate.toFixed(2)}%` : null,
      rebateType: issuerCallRebateType,
      rebateCalculationDetails: rebateCalculationDetails,
      totalReceived: totalReceived,
      totalReceivedFormatted: `${totalReceived.toFixed(2)}%`
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
   */
  async extractUnderlyingAssetsData(product) {
    const underlyings = [];
    const currency = product.currency || 'USD';

    if (product.underlyings && Array.isArray(product.underlyings)) {
      // Process all underlyings sequentially to fetch news
      for (const [index, underlying] of product.underlyings.entries()) {
        // Priority: Use actual market price on trade date for accurate performance
        // Fall back to strike only if no historical data available
        const initialPrice = (underlying.securityData?.tradeDatePrice?.price) ||
                           (underlying.securityData?.tradeDatePrice?.close) ||
                           underlying.strike || 0;

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
      }
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

    // Check issuer call
    const callInfo = this.checkIssuerCall(product);

    const daysToMaturity = maturityDate
      ? Math.ceil((new Date(maturityDate) - now) / (1000 * 60 * 60 * 24))
      : null;

    let productStatus = 'live';
    let statusDetails = {};

    if (callInfo.isCalled) {
      productStatus = 'called';
      statusDetails = {
        callDate: callInfo.callDate,
        callDateFormatted: callInfo.callDateFormatted,
        callPrice: callInfo.callPrice,
        callPriceFormatted: callInfo.callPriceFormatted,
        calledBy: 'issuer'
      };
    } else if (isMaturityPassed) {
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
      isCalled: callInfo.isCalled,
      hasCallOption: callInfo.hasCallOption,
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
