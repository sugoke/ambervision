/**
 * Market Data Fetcher
 *
 * Fetches all required market data for structured product evaluation
 * from the MarketDataCache collection.
 *
 * CRITICAL ARCHITECTURAL PRINCIPLE:
 * - This module is the SINGLE SOURCE OF TRUTH for fetching market data
 * - NO FALLBACKS, NO PLACEHOLDERS, NO MOCK DATA
 * - If data is missing, throw explicit error - fail fast
 * - All prices must come from MarketDataCache
 */

import { Meteor } from 'meteor/meteor';
import { MarketDataCacheCollection } from './marketDataCache.js';

// Server-side test methods
if (Meteor.isServer) {
  Meteor.methods({
    async 'marketDataCache.checkForTicker'(ticker) {
      console.log(`[Test] Checking cache for ticker: ${ticker}`);
      const doc = await MarketDataCacheCollection.findOneAsync({ fullTicker: ticker });

      if (doc) {
        return {
          found: true,
          fullTicker: doc.fullTicker,
          symbol: doc.symbol,
          exchange: doc.cache?.exchange,
          historyCount: doc.cache?.history?.length || 0,
          firstDate: doc.cache?.firstDate,
          lastDate: doc.cache?.lastDate
        };
      }

      return { found: false, ticker };
    },

    async 'marketDataFetcher.testFetch'(ticker, date) {
      const { fetchPriceForDate } = await import('./marketDataFetcher.js');
      return await fetchPriceForDate(ticker, new Date(date));
    }
  });
}

/**
 * Fetch historical market data for a specific ticker and date
 *
 * MarketDataCache structure:
 * {
 *   fullTicker: "INTC.US",
 *   cache: {
 *     history: [
 *       { date: Date, open, high, low, close, volume, adjustedClose },
 *       ...
 *     ]
 *   }
 * }
 *
 * @param {string} ticker - Full ticker (e.g., "AAPL.US")
 * @param {Date} date - Target date
 * @returns {Object} Price data { price, date, source } or null if not found
 */
export async function fetchPriceForDate(ticker, date) {
  const dateStr = date.toISOString().split('T')[0];

  console.log(`[MarketDataFetcher] Fetching ${ticker} for ${dateStr}`);

  // Query MarketDataCache for ticker's full history document
  const cacheDoc = await MarketDataCacheCollection.findOneAsync({
    fullTicker: ticker
  });

  console.log(`[MarketDataFetcher] Query result for ${ticker}:`, {
    found: !!cacheDoc,
    hasHistory: !!cacheDoc?.history,
    historyLength: cacheDoc?.history?.length || 0
  });

  if (!cacheDoc || !cacheDoc.history) {
    console.warn(`[MarketDataFetcher] ❌ No history array found for ${ticker}`);
    console.warn(`[MarketDataFetcher] Available fields:`, Object.keys(cacheDoc || {}));
    return null;
  }

  console.log(`[MarketDataFetcher] Found ${cacheDoc.history.length} history entries for ${ticker}`);
  console.log(`[MarketDataFetcher] Date range: ${cacheDoc.firstDate} to ${cacheDoc.lastDate}`);

  // Search through history array for matching date
  const targetTime = date.getTime();
  const historyEntry = cacheDoc.history.find(entry => {
    const entryTime = new Date(entry.date).getTime();
    const entryDateStr = new Date(entry.date).toISOString().split('T')[0];
    const matches = entryDateStr === dateStr;

    if (matches) {
      console.log(`[MarketDataFetcher] Match found: ${entryDateStr} === ${dateStr}`);
    }

    return matches;
  });

  if (historyEntry) {
    console.log(`[MarketDataFetcher] ✅ Found ${ticker} on ${dateStr}: $${historyEntry.close}`);
    return {
      price: historyEntry.close,
      date: new Date(historyEntry.date),
      source: 'market_data_cache'
    };
  }

  // NO FALLBACKS - return null if not found
  console.warn(`[MarketDataFetcher] ❌ No data found for ${ticker} on ${dateStr}`);
  console.warn(`[MarketDataFetcher] Searched ${cacheDoc.history.length} entries`);

  // Log first and last few entries for debugging
  if (cacheDoc.history.length > 0) {
    const first3 = cacheDoc.history.slice(0, 3).map(e => new Date(e.date).toISOString().split('T')[0]);
    const last3 = cacheDoc.history.slice(-3).map(e => new Date(e.date).toISOString().split('T')[0]);
    console.warn(`[MarketDataFetcher] First 3 dates: ${first3.join(', ')}`);
    console.warn(`[MarketDataFetcher] Last 3 dates: ${last3.join(', ')}`);
  }

  return null;
}

/**
 * Fetch all required market data for a product
 * @param {Object} product - Product document with underlyings and observation schedule
 * @returns {Object} Complete price dataset
 * @throws {Meteor.Error} If any required data is missing
 */
export async function fetchAllPricesForProduct(product) {
  console.log(`[MarketDataFetcher] Fetching all prices for product ${product._id}`);

  // Extract all required dates
  const tradeDate = new Date(product.tradeDate);
  const finalObservation = product.finalObservation ? new Date(product.finalObservation) : null;
  const maturity = product.maturity ? new Date(product.maturity) : null;
  const observationSchedule = product.observationSchedule || [];

  // Determine redemption date (matured products use final observation or maturity)
  const now = new Date();
  const hasMatured = finalObservation && finalObservation <= now;
  const redemptionDate = hasMatured ? finalObservation : null;

  // Extract all observation dates
  const observationDates = observationSchedule.map(obs => new Date(obs.observationDate));

  // Build complete price dataset
  const priceData = {
    tradeDate: tradeDate,
    redemptionDate: redemptionDate,
    hasMatured: hasMatured,
    underlyings: []
  };

  // Fetch prices for each underlying
  for (const underlying of product.underlyings) {
    const ticker = underlying.ticker;
    const fullTicker = underlying.securityData?.ticker || `${ticker}.US`;

    console.log(`[MarketDataFetcher] Processing ${ticker} (${fullTicker})`);

    const underlyingData = {
      ticker: ticker,
      fullTicker: fullTicker,
      name: underlying.name,
      isin: underlying.isin,
      strike: underlying.strike,
      weight: underlying.weight
    };

    // 1. Fetch trade date (initial) price
    const initialPrice = await fetchPriceForDate(fullTicker, tradeDate);
    if (!initialPrice) {
      throw new Meteor.Error(
        'missing-initial-price',
        `Missing initial price for ${ticker} on trade date ${tradeDate.toISOString().split('T')[0]}`
      );
    }
    underlyingData.initialPrice = initialPrice;

    // 2. Fetch current/live price (for non-matured products)
    if (!hasMatured) {
      const currentPrice = await fetchPriceForDate(fullTicker, now);
      if (!currentPrice) {
        console.warn(`[MarketDataFetcher] Missing current price for ${ticker} - using latest available`);
        // For current price, we can use latest available from cache
        const latestEntry = await MarketDataCacheCollection.findOneAsync(
          { ticker: fullTicker },
          { sort: { date: -1 } }
        );

        if (latestEntry) {
          underlyingData.currentPrice = {
            price: latestEntry.close,
            date: latestEntry.date,
            source: 'market_data_cache_latest'
          };
        } else {
          throw new Meteor.Error(
            'missing-current-price',
            `No current price data available for ${ticker}`
          );
        }
      } else {
        underlyingData.currentPrice = currentPrice;
      }
    }

    // 3. Fetch observation date prices
    underlyingData.observationPrices = {};
    for (const obsDate of observationDates) {
      const obsDateStr = obsDate.toISOString().split('T')[0];
      const obsPrice = await fetchPriceForDate(fullTicker, obsDate);

      if (!obsPrice) {
        // Observation prices are critical - fail if missing
        throw new Meteor.Error(
          'missing-observation-price',
          `Missing observation price for ${ticker} on ${obsDateStr}`
        );
      }

      underlyingData.observationPrices[obsDateStr] = obsPrice;
    }

    // 4. Fetch redemption date price (for matured products)
    if (hasMatured && redemptionDate) {
      const redemptionDateStr = redemptionDate.toISOString().split('T')[0];
      const redemptionPrice = await fetchPriceForDate(fullTicker, redemptionDate);

      if (!redemptionPrice) {
        throw new Meteor.Error(
          'missing-redemption-price',
          `Missing redemption price for ${ticker} on ${redemptionDateStr}. Product cannot be evaluated.`
        );
      }

      underlyingData.redemptionPrice = redemptionPrice;
      underlyingData.finalObservationPrice = redemptionPrice; // Same as redemption for matured products
    }

    priceData.underlyings.push(underlyingData);
  }

  console.log(`[MarketDataFetcher] Successfully fetched all prices for ${priceData.underlyings.length} underlyings`);

  return priceData;
}

/**
 * Check if all required market data is available in cache
 * @param {Object} product - Product document
 * @returns {Object} { available: boolean, missing: Array }
 */
export async function checkMarketDataAvailability(product) {
  const missing = [];

  const tradeDate = new Date(product.tradeDate);
  const finalObservation = product.finalObservation ? new Date(product.finalObservation) : null;
  const observationSchedule = product.observationSchedule || [];
  const observationDates = observationSchedule.map(obs => new Date(obs.observationDate));

  for (const underlying of product.underlyings) {
    const fullTicker = underlying.securityData?.ticker || `${underlying.ticker}.US`;

    // Check trade date
    const initialPrice = await fetchPriceForDate(fullTicker, tradeDate);
    if (!initialPrice) {
      missing.push({
        ticker: underlying.ticker,
        date: tradeDate,
        type: 'initial'
      });
    }

    // Check observation dates
    for (const obsDate of observationDates) {
      const obsPrice = await fetchPriceForDate(fullTicker, obsDate);
      if (!obsPrice) {
        missing.push({
          ticker: underlying.ticker,
          date: obsDate,
          type: 'observation'
        });
      }
    }

    // Check final observation (if matured)
    const now = new Date();
    const hasMatured = finalObservation && finalObservation <= now;
    if (hasMatured) {
      const redemptionPrice = await fetchPriceForDate(fullTicker, finalObservation);
      if (!redemptionPrice) {
        missing.push({
          ticker: underlying.ticker,
          date: finalObservation,
          type: 'redemption'
        });
      }
    }
  }

  return {
    available: missing.length === 0,
    missing: missing
  };
}