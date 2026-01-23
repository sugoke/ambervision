import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { HTTP } from 'meteor/http';
import { CryptoApiHelper } from './cryptoApi';
import { MarketDataCacheCollection } from './marketDataCache';
import { validateTickerFormat, normalizeTickerSymbol, getExchangeName, extractExchange, normalizeExchangeForEOD } from '/imports/utils/tickerUtils';

// Ticker price cache collection
export const TickerPriceCacheCollection = new Mongo.Collection('tickerPriceCache');

// Ticker price cache schema
// {
//   _id: ObjectId,
//   symbol: String,          // e.g., "AAPL.US", "SPY.US", "EURUSD.FOREX"
//   price: Number,           // Current/last price
//   change: Number,          // Price change
//   changePercent: Number,   // Percentage change
//   previousClose: Number,   // Previous close price
//   volume: Number,          // Trading volume
//   timestamp: Date,         // When this data was fetched from EOD
//   lastUpdated: Date,       // When cache was last updated
//   expiresAt: Date,         // When this cache entry expires (2 minutes)
//   source: String           // 'eod' or 'fallback'
// }

if (Meteor.isServer) {
  // Create TTL index for automatic cleanup (expires after 2 minutes)
  TickerPriceCacheCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  
  // Create index for efficient symbol lookup
  TickerPriceCacheCollection.createIndex({ symbol: 1 });
}

export const TickerCacheHelpers = {
  // Cache duration in milliseconds (15 minutes)
  CACHE_DURATION: 15 * 60 * 1000,

  // Get cached ticker price
  async getCachedPrice(symbol) {
    try {
      const now = new Date();
      const cachedData = await TickerPriceCacheCollection.findOneAsync({
        symbol: symbol,
        expiresAt: { $gt: now },
        price: { $gt: 0 }  // Only return cache entries with valid prices
      });

      return cachedData;
    } catch (error) {
      console.error(`TickerCache: Error getting cached price for ${symbol}:`, error);
      return null;
    }
  },

  // Cache ticker price data
  async setCachedPrice(symbol, priceData, source = 'eod') {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.CACHE_DURATION);

      // Ensure we have valid numeric values
      const price = parseFloat(priceData.price);

      // CRITICAL: Don't cache if price is invalid (NaN, 0, or negative)
      if (isNaN(price) || price <= 0) {
        // Silently reject invalid prices - they're expected for some tickers
        return null;
      }

      const change = parseFloat(priceData.change) || 0;
      const changePercent = parseFloat(priceData.changePercent) || 0;
      const previousClose = parseFloat(priceData.previousClose) || 0;
      const volume = parseInt(priceData.volume) || 0;
      
      const cacheData = {
        symbol: symbol,
        price: price,
        change: change,
        changePercent: changePercent,
        previousClose: previousClose,
        volume: volume,
        timestamp: priceData.timestamp || now,
        lastUpdated: now,
        expiresAt: expiresAt,
        source: source
      };

      // Calculate change and changePercent if not provided or zero
      if ((cacheData.change === 0 || cacheData.changePercent === 0) && cacheData.price > 0 && cacheData.previousClose > 0) {
        cacheData.change = cacheData.price - cacheData.previousClose;
        cacheData.changePercent = (cacheData.change / cacheData.previousClose) * 100;
      }

      // Upsert (update if exists, insert if not)
      const result = await TickerPriceCacheCollection.upsertAsync(
        { symbol: symbol },
        { $set: cacheData }
      );

      // console.log(`TickerCache: Cached price for ${symbol}: $${cacheData.price.toFixed(2)} (change: ${cacheData.change.toFixed(2)}, ${cacheData.changePercent.toFixed(2)}%) [${source}]`);
      return result;
    } catch (error) {
      console.error(`TickerCache: Error caching price for ${symbol}:`, error);
      throw error;
    }
  },

  // Get multiple cached prices
  async getCachedPrices(symbols) {
    try {
      const now = new Date();
      const cachedData = await TickerPriceCacheCollection.find({
        symbol: { $in: symbols },
        expiresAt: { $gt: now },
        price: { $gt: 0 }  // Only return cache entries with valid prices
      }).fetchAsync();

      // Convert to map for easy lookup
      const priceMap = new Map();
      cachedData.forEach(data => {
        // Double-check price is valid (defense in depth)
        if (data.price && data.price > 0) {
          priceMap.set(data.symbol, {
            price: data.price,
            change: data.change,
            changePercent: data.changePercent,
            previousClose: data.previousClose,
            volume: data.volume,
            timestamp: data.timestamp,
            source: data.source,
            fallback: data.source === 'fallback'
          });
        }
      });

      return priceMap;
    } catch (error) {
      console.error('TickerCache: Error getting multiple cached prices:', error);
      return new Map();
    }
  },

  // Refresh ticker prices from EOD API
  async refreshTickerPrices(symbols) {
    const results = {
      cached: 0,
      fetched: 0,
      failed: 0,
      prices: new Map()
    };

    try {
      // Normalize all symbols for EOD API compatibility before processing
      const normalizedSymbols = symbols.map(symbol => normalizeExchangeForEOD(symbol));

      // Debug logging disabled for performance - uncomment if needed
      // console.log(`[TickerCache] refreshTickerPrices called with ${symbols.length} symbols`);

      // First check cache for valid entries (using normalized symbols)
      const cachedPrices = await this.getCachedPrices(normalizedSymbols);

      const symbolsToFetch = [];
      normalizedSymbols.forEach((normalizedSymbol, index) => {
        const originalSymbol = symbols[index];
        if (cachedPrices.has(normalizedSymbol)) {
          // Return with original symbol as key for client compatibility
          results.prices.set(originalSymbol, cachedPrices.get(normalizedSymbol));
          results.cached++;
        } else {
          symbolsToFetch.push(normalizedSymbol);
        }
      });

      // Only log summary if there are symbols to fetch
      if (symbolsToFetch.length > 0) {
        console.log(`[TickerCache] Fetching ${symbolsToFetch.length} prices (${results.cached} cached)`);
      }

      // Fetch remaining symbols from EOD API or free crypto APIs
      // Note: symbolsToFetch already contains normalized symbols
      for (const normalizedSymbol of symbolsToFetch) {
        // Find the original symbol for this normalized symbol
        const originalIndex = normalizedSymbols.indexOf(normalizedSymbol);
        const originalSymbol = symbols[originalIndex];

        // Per-symbol logging disabled - only log errors

        try {
          let priceData = null;
          let source = 'eod';

          // Check if this is a crypto symbol we can get from free APIs
          if (CryptoApiHelper.isSupportedCrypto(normalizedSymbol)) {
            priceData = await CryptoApiHelper.getCryptoPrice(normalizedSymbol);
            if (priceData) {
              source = priceData.source || 'crypto-api';
            }
          }

          // If not crypto or crypto API failed, try to get latest from MarketDataCache
          if (!priceData) {
            try {
              // Only use cache entries that have a valid close price (not null/undefined)
              const latestData = await MarketDataCacheCollection.findOneAsync(
                { fullTicker: normalizedSymbol, close: { $gt: 0 } },
                { sort: { date: -1 } }
              );

              if (latestData && latestData.close > 0) {
                priceData = {
                  price: latestData.close,
                  close: latestData.close,
                  change: latestData.close - latestData.previousClose || 0,
                  changePercent: latestData.previousClose ? ((latestData.close - latestData.previousClose) / latestData.previousClose * 100) : 0,
                  previousClose: latestData.previousClose || latestData.open,
                  volume: latestData.volume,
                  timestamp: latestData.date
                };
                source = 'market-cache';
              } else {
                // No valid cache data, fallback to EOD API
                priceData = await this.fetchPriceFromEOD(normalizedSymbol);
              }
            } catch (cacheError) {
              console.error(`TickerCache: Error accessing market data cache for ${normalizedSymbol}:`, cacheError);
              // Fallback to EOD API
              priceData = await this.fetchPriceFromEOD(normalizedSymbol);
            }
          }

          if (priceData) {
            const finalPrice = priceData.close || priceData.price || priceData.last;

            // Only log if there's a problem (price is invalid)
            if (!finalPrice || finalPrice <= 0) {
              console.log(`[TickerCache] ⚠️ ${normalizedSymbol}: Invalid price data`, {
                price: priceData.price,
                close: priceData.close,
                last: priceData.last,
                source: source
              });
            }

            // Cache with normalized symbol
            await this.setCachedPrice(normalizedSymbol, priceData, source);
            // Return with original symbol as key for client compatibility
            results.prices.set(originalSymbol, {
              price: finalPrice,
              change: priceData.change || 0,
              changePercent: priceData.changePercent || priceData.change_p || 0,
              previousClose: priceData.previousClose || priceData.previous_close,
              volume: priceData.volume || 0,
              timestamp: priceData.timestamp || new Date(),
              source: source,
              fallback: false
            });
            results.fetched++;
          } else {
            // No price data from any source - increment failed counter
            results.failed++;
          }
        } catch (error) {
          console.error(`TickerCache: Error fetching ${normalizedSymbol} (original: ${originalSymbol}):`, error);
          results.failed++;
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      return results;

    } catch (error) {
      console.error('SERVER: Error in refreshTickerPrices:', error);
      throw error;
    }
  },

  // Fetch single price from EOD API
  async fetchPriceFromEOD(symbol) {
    try {
      // First try real-time API
      let url = `https://eodhistoricaldata.com/api/real-time/${symbol}`;
      let params = {
        api_token: Meteor.settings.private?.EOD_API_TOKEN || '5c265eab2c9066.19444326',
        fmt: 'json'
      };

      let response;
      try {
        response = await HTTP.get(url, { params });
      } catch (realtimeError) {
        // Fallback to end-of-day API with latest data
        url = `https://eodhistoricaldata.com/api/eod/${symbol}`;
        params = {
          api_token: Meteor.settings.private?.EOD_API_TOKEN || '5c265eab2c9066.19444326',
          fmt: 'json',
          order: 'd',
          limit: 2 // Get last 2 days to calculate change
        };
        response = await HTTP.get(url, { params });
      }

      if (response.data) {
        // Handle different response formats from EOD API
        let data = response.data;
        let isEodFormat = false;

        // If response is an array (end-of-day format or indices)
        if (Array.isArray(data) && data.length > 0) {
          isEodFormat = true;
          // For EOD API, we have array of [{date, open, high, low, close, volume}...]
          const latestDay = data[0];
          const previousDay = data[1] || data[0];

          // Convert EOD format to price data format
          data = {
            close: latestDay.close,
            price: latestDay.close,
            previousClose: previousDay.close,
            change: latestDay.close - previousDay.close,
            change_p: previousDay.close > 0 ? ((latestDay.close - previousDay.close) / previousDay.close * 100) : 0,
            volume: latestDay.volume,
            timestamp: new Date(latestDay.date).getTime() / 1000,
            date: latestDay.date
          };
        }
        
        // Log the actual response structure for debugging
        // console.log(`TickerCache: Raw API response for ${symbol}:`, JSON.stringify(data, null, 2));
        
        // EOD real-time API typically returns these fields:
        // For stocks: { code, timestamp, gmtoffset, open, high, low, close, volume, previousClose, change, change_p }
        // For forex/commodities: might have different field names
        // For indices: might return array or have different structure
        
        // Try multiple field names for price, but skip "NA" values
        let priceValue = data.close || data.price || data.last || data.value || data.quote || data.last_trade || data.lastTrade;
        
        // Check if the value is "NA" or invalid
        if (priceValue === "NA" || priceValue === null || priceValue === undefined) {
          console.log(`[TickerCache] fetchPriceFromEOD: ${symbol} returned NA or invalid price, skipping API data`);
          return null;
        }

        const price = parseFloat(priceValue);
        if (isNaN(price) || price <= 0) {
          console.log(`[TickerCache] fetchPriceFromEOD: ${symbol} returned invalid numeric price: ${priceValue}`);
          return null;
        }

        
        // Parse other fields from EOD as-is (no recalculation)
        const previousCloseValue = data.previousClose || data.previous_close || data.prevClose || data.prev_close || data.yesterday_close;
        const previousClose = (previousCloseValue === "NA" || previousCloseValue === null || previousCloseValue === undefined) ? 
          null : parseFloat(previousCloseValue);
        
        const changeValue = data.change;
        const change = (changeValue === "NA" || changeValue === null || changeValue === undefined) ? 
          null : parseFloat(changeValue);
        
        const changePercentValue = data.change_p || data.changePercent || data.change_percent;
        const changePercent = (changePercentValue === "NA" || changePercentValue === null || changePercentValue === undefined) ? 
          null : parseFloat(changePercentValue);
        
        // Handle timestamp - EOD API timestamp is usually for the data date, not the API call time
        let priceTimestamp;
        if (data.timestamp) {
          // EOD timestamps are usually in seconds since epoch
          if (data.timestamp < 10000000000) {
            priceTimestamp = new Date(data.timestamp * 1000);
          } else {
            priceTimestamp = new Date(data.timestamp);
          }
        } else {
          // If no timestamp provided, assume it's the most recent trading day
          // For US markets, if it's before market open (9:30 AM ET), use previous day
          const now = new Date();
          const easternTime = new Date(now.toLocaleString("en-US", {timeZone: "America/New_York"}));
          const marketOpenHour = 9;
          const marketOpenMinute = 30;
          
          if (easternTime.getHours() < marketOpenHour || 
              (easternTime.getHours() === marketOpenHour && easternTime.getMinutes() < marketOpenMinute) ||
              easternTime.getDay() === 0 || easternTime.getDay() === 6) { // Weekend
            // Use previous trading day
            const previousDay = new Date(easternTime);
            previousDay.setDate(previousDay.getDate() - 1);
            // Skip weekends
            while (previousDay.getDay() === 0 || previousDay.getDay() === 6) {
              previousDay.setDate(previousDay.getDate() - 1);
            }
            priceTimestamp = previousDay;
          } else {
            priceTimestamp = easternTime;
          }
        }

        let normalizedChangePercent = changePercent;
        let normalizedChange = change;
        let normalizedPrevClose = previousClose;

        // Normalize absurd or missing percent: if > 50% or < -50%, try recompute
        const isAbsurd = (v) => typeof v === 'number' && Math.abs(v) > 50;
        const isValidNum = (v) => typeof v === 'number' && isFinite(v);

        if (!isValidNum(normalizedChangePercent) || isAbsurd(normalizedChangePercent)) {
          // If we have price and previousClose, recompute
          if (isValidNum(price) && isValidNum(normalizedPrevClose) && normalizedPrevClose > 0) {
            normalizedChange = isValidNum(normalizedChange) ? normalizedChange : (price - normalizedPrevClose);
            normalizedChangePercent = (normalizedChange / normalizedPrevClose) * 100;
          } else {
            // Try last two cached closes for this symbol to compute daily change
            const [symbolOnly, exchange] = symbol.includes('.') ? symbol.split('.') : [symbol, 'US'];
            const fullTicker = `${symbolOnly}.${exchange}`;
            const recent = await MarketDataCacheCollection.find({ fullTicker }, { sort: { date: -1 }, limit: 2 }).fetchAsync();
            if (recent && recent.length >= 1) {
              const lastClose = recent[0]?.close;
              const prevClose = recent[1]?.close || recent[0]?.close;
              if (isValidNum(lastClose) && isValidNum(prevClose) && prevClose > 0) {
                normalizedPrevClose = prevClose;
                normalizedChange = price - prevClose;
                normalizedChangePercent = (normalizedChange / prevClose) * 100;
              }
            }
          }
        }

        const resultData = {
          price: price,
          change: isValidNum(normalizedChange) ? normalizedChange : change,
          changePercent: isValidNum(normalizedChangePercent) ? normalizedChangePercent : changePercent,
          previousClose: isValidNum(normalizedPrevClose) ? normalizedPrevClose : previousClose,
          volume: data.volume || 0,
          timestamp: priceTimestamp
        };

        // Debug log for percentage calculation (disabled for performance)
        // console.log('TickerCache: Parsed price data', {
        //   symbol,
        //   price,
        //   previousClose: resultData.previousClose,
        //   change: resultData.change,
        //   changePercent: resultData.changePercent,
        //   raw: {
        //     change_p: data.change_p,
        //     changePercent: data.changePercent,
        //     change_percent: data.change_percent,
        //     previousClose: data.previousClose || data.previous_close || data.prevClose || data.prev_close || data.yesterday_close,
        //     timestamp: data.timestamp
        //   }
        // });
        
        return resultData;
      }
      
      return null;
    } catch (error) {
      console.error(`TickerCache: Error fetching price for ${symbol}:`, error);
      return null;
    }
  },

  // Clean expired cache entries with improved error handling
  async cleanExpiredCache() {
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        const now = new Date();
        // console.log(`TickerCache: Attempting cleanup (attempt ${attempts + 1}/${maxAttempts})`);
        
        // Add timeout to the database operation itself
        const cleanupPromise = TickerPriceCacheCollection.removeAsync({
          expiresAt: { $lt: now }
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database operation timeout')), 15000)
        );
        
        const result = await Promise.race([cleanupPromise, timeoutPromise]);
        
        const removed = result || 0;
        if (removed > 0) {
          // console.log(`TickerCache: Successfully cleaned ${removed} expired price cache entries`);
        } else {
          // console.log('TickerCache: No expired entries to clean');
        }
        
        return removed;
        
      } catch (error) {
        attempts++;
        console.error(`TickerCache: Cleanup attempt ${attempts} failed:`, error.message);
        
        if (attempts >= maxAttempts) {
          console.error('TickerCache: All cleanup attempts failed, giving up');
          return 0;
        }
        
        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, attempts) * 1000;
        // console.log(`TickerCache: Retrying cleanup in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return 0;
  },

  // Get cache statistics
  async getCacheStats() {
    try {
      const totalRecords = await TickerPriceCacheCollection.find({}).countAsync();
      const activeRecords = await TickerPriceCacheCollection.find({
        expiresAt: { $gt: new Date() }
      }).countAsync();
      
      const uniqueSymbols = await TickerPriceCacheCollection.rawCollection().distinct('symbol');
      
      return {
        totalRecords,
        activeRecords,
        expiredRecords: totalRecords - activeRecords,
        uniqueSymbols: uniqueSymbols.length,
        cacheDurationMinutes: this.CACHE_DURATION / (60 * 1000)
      };
    } catch (error) {
      console.error('TickerCache: Error getting cache stats:', error);
      return {
        totalRecords: 0,
        activeRecords: 0,
        expiredRecords: 0,
        uniqueSymbols: 0,
        cacheDurationMinutes: 15
      };
    }
  }
};

// Server-side methods
if (Meteor.isServer) {
  Meteor.methods({
    // Get cached ticker prices (for MarketTicker component)
    async 'tickerCache.getPrices'(symbols) {
      check(symbols, [String]);
      
      try {
        
        // Get cached prices or fetch from EOD if needed
        const results = await TickerCacheHelpers.refreshTickerPrices(symbols);
        
        // Convert map to object for easier client consumption
        const pricesObj = {};
        results.prices.forEach((data, symbol) => {
          pricesObj[symbol] = data;
        });
        
        const response = {
          success: true,
          prices: pricesObj,
          stats: {
            cached: results.cached,
            fetched: results.fetched,
            failed: results.failed,
            total: symbols.length
          }
        };
        
        // console.log('SERVER: Returning ticker prices for', Object.keys(pricesObj).length, 'symbols');
        
        return response;
      } catch (error) {
        console.error('SERVER: Error in getPrices method:', error);
        const errorResponse = {
          success: false,
          error: error.message,
          prices: {}
        };
        console.log('SERVER: Returning error response:', errorResponse);
        return errorResponse;
      }
    },

    // Manually refresh cache for specific symbols
    async 'tickerCache.refresh'(symbols = null) {
      check(symbols, Match.Optional(Match.OneOf([String], null)));
      
      try {
        const symbolsToRefresh = symbols || [
          'SPY.US', 'QQQ.US', 'STOXX50E.INDX', 'FCHI.INDX', 'GDAXI.INDX', 
          'EUR-USD.FOREX', 'BTC-USD.CC', 'GC.COM'
        ];
        
        const results = await TickerCacheHelpers.refreshTickerPrices(symbolsToRefresh);
        
        return {
          success: true,
          message: `Refreshed ${symbolsToRefresh.length} symbols`,
          stats: {
            cached: results.cached,
            fetched: results.fetched,
            failed: results.failed,
            total: symbolsToRefresh.length
          }
        };
      } catch (error) {
        console.error('TickerCache: Error in refresh method:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    // Get cache statistics
    async 'tickerCache.getStats'() {
      return await TickerCacheHelpers.getCacheStats();
    },

    // Clear ticker cache
    async 'tickerCache.clear'(symbol = null) {
      check(symbol, Match.Optional(Match.OneOf(String, null)));

      try {
        const query = symbol ? { symbol: symbol } : {};
        const removed = await TickerPriceCacheCollection.removeAsync(query);

        return {
          success: true,
          message: `Cleared ${removed} cache entries${symbol ? ` for ${symbol}` : ''}`,
          removedCount: removed
        };
      } catch (error) {
        console.error('TickerCache: Error clearing cache:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    // Clear invalid prices (price <= 0, null, or undefined) from cache
    async 'tickerCache.clearInvalidPrices'() {
      try {
        const removed = await TickerPriceCacheCollection.removeAsync({
          $or: [
            { price: { $lte: 0 } },
            { price: null },
            { price: { $exists: false } },
            { price: { $type: 'undefined' } }
          ]
        });

        console.log(`[TickerCache] Cleared ${removed} invalid price entries (price <= 0, null, or undefined)`);

        return {
          success: true,
          message: `Cleared ${removed} invalid price cache entries`,
          removedCount: removed
        };
      } catch (error) {
        console.error('TickerCache: Error clearing invalid prices:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    // Validate tickers with EOD API - check if they return valid price data
    async 'tickerCache.validateTickers'(symbols) {
      check(symbols, [String]);

      try {
        console.log(`[TickerValidation] Validating ${symbols.length} tickers with EOD API...`);
        const validTickers = [];
        const invalidTickers = [];

        // Test each ticker by attempting to fetch price data
        for (const symbol of symbols) {
          try {
            // First normalize exchange suffix for EOD compatibility
            const normalizedSymbol = normalizeExchangeForEOD(symbol);

            // Then validate format
            const formatValidation = validateTickerFormat(normalizedSymbol);
            if (!formatValidation.valid) {
              invalidTickers.push({
                symbol,
                normalizedSymbol,
                valid: false,
                reason: `Invalid format: ${formatValidation.reason}`,
                suggestion: 'Check if ticker contains spaces or is too long'
              });
              console.log(`  ✗ ${symbol} (${normalizedSymbol}): Invalid format (${formatValidation.reason})`);
              continue;
            }

            // Try to fetch price from EOD API using normalized symbol
            const priceData = await TickerCacheHelpers.fetchPriceFromEOD(normalizedSymbol);

            if (priceData && priceData.price > 0) {
              // Ticker is valid - has real price data
              const exchange = extractExchange(normalizedSymbol);
              const exchangeName = exchange ? getExchangeName(exchange) : 'Unknown';

              validTickers.push({
                symbol,  // Return original symbol
                normalizedSymbol,
                valid: true,
                price: priceData.price,
                exchange: exchangeName,
                reason: 'Valid price data from EOD'
              });
              console.log(`  ✓ ${symbol} → ${normalizedSymbol}: Valid (${exchangeName}, price: $${priceData.price.toFixed(2)})`);
            } else {
              // Ticker returned no valid price data
              const exchange = extractExchange(normalizedSymbol);
              let suggestion = 'Verify ticker symbol and exchange suffix';

              if (!exchange || exchange === 'US') {
                suggestion = 'May need correct exchange suffix (e.g., NOVO-B.CO for Danish stocks, SAP.F for German stocks)';
              }

              invalidTickers.push({
                symbol,
                normalizedSymbol,
                valid: false,
                reason: 'No valid price data from EOD API',
                suggestion: suggestion
              });
              console.log(`  ✗ ${symbol} → ${normalizedSymbol}: Invalid (no price data). ${suggestion}`);
            }
          } catch (error) {
            // Ticker fetch failed
            const normalizedSymbol = normalizeExchangeForEOD(symbol);
            let reason = `EOD API error: ${error.message}`;
            let suggestion = 'Check ticker symbol and exchange suffix';

            // Provide more specific suggestions based on error
            if (error.message.includes('404') || error.message.includes('not found')) {
              reason = 'Ticker not found on EOD API';
              suggestion = 'Verify ticker symbol or try different exchange suffix';
            } else if (error.message.includes('403') || error.message.includes('auth')) {
              reason = 'API authentication failed';
              suggestion = 'Check EOD API credentials or rate limits';
            }

            invalidTickers.push({
              symbol,
              normalizedSymbol,
              valid: false,
              reason: reason,
              suggestion: suggestion
            });
            console.log(`  ✗ ${symbol} → ${normalizedSymbol}: ${reason}. ${suggestion}`);
          }

          // Small delay to avoid overwhelming the API
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log(`[TickerValidation] Complete: ${validTickers.length} valid, ${invalidTickers.length} invalid`);

        // Log summary of invalid tickers with suggestions
        if (invalidTickers.length > 0) {
          console.log('[TickerValidation] Invalid tickers summary:');
          invalidTickers.forEach(t => {
            console.log(`  - ${t.symbol}: ${t.reason}`);
            if (t.suggestion) console.log(`    💡 ${t.suggestion}`);
          });
        }

        return {
          success: true,
          totalTested: symbols.length,
          validCount: validTickers.length,
          invalidCount: invalidTickers.length,
          validTickers: validTickers.map(t => t.symbol),
          invalidTickers: invalidTickers.map(t => ({
            symbol: t.symbol,
            reason: t.reason,
            suggestion: t.suggestion
          })),
          details: [...validTickers, ...invalidTickers]
        };
      } catch (error) {
        console.error('[TickerValidation] Validation failed:', error);
        return {
          success: false,
          error: error.message,
          validTickers: [],
          invalidTickers: []
        };
      }
    },

    // Test direct EOD API call for debugging
    async 'test.eodDirectCall'(symbol) {
      check(symbol, String);

      try {
        const url = `https://eodhistoricaldata.com/api/real-time/${symbol}`;
        const params = {
          api_token: Meteor.settings.private?.EOD_API_TOKEN || '5c265eab2c9066.19444326',
          fmt: 'json'
        };

        console.log(`TEST: Making direct API call to ${url}`);
        const response = await HTTP.get(url, { params });

        let data = response.data;
        let responseType = 'object';

        // Handle array responses
        if (Array.isArray(data)) {
          responseType = 'array';
          if (data.length > 0) {
            data = data[0];
          }
        }

        console.log(`TEST: Raw response for ${symbol} (type: ${responseType}):`, response.data);

        // Test the actual parsing logic
        const parsedByHelper = await TickerCacheHelpers.fetchPriceFromEOD(symbol);

        return {
          success: true,
          symbol: symbol,
          url: url,
          responseType: responseType,
          rawResponse: response.data,
          parsedData: {
            price: data?.close || data?.price || data?.last || data?.value,
            change: data?.change,
            changePercent: data?.change_p || data?.changePercent || data?.change_percent,
            previousClose: data?.previousClose || data?.previous_close || data?.prevClose,
            volume: data?.volume,
            timestamp: data?.timestamp,
            allFields: Object.keys(data || {})
          },
          helperParsedData: parsedByHelper,
          fallbackData: {
            SPY: { price: 450.25, change: 2.15 },
            QQQ: { price: 385.67, change: 1.85 },
            'SX5E.INDX': { price: 4850.20, change: 15.30 }
          }
        };
      } catch (error) {
        console.error(`TEST: Error calling EOD API for ${symbol}:`, error);
        return {
          success: false,
          symbol: symbol,
          error: error.message,
          errorDetails: error.response?.data || error
        };
      }
    }
  });

  // Start periodic cache cleanup (every hour with error resilience)
  if (Meteor.isServer) {
    Meteor.setInterval(async () => {
      try {
        // console.log('TickerCache: Starting periodic cleanup...');
        const startTime = Date.now();
        
        // Add timeout wrapper for cleanup operation
        const cleanupPromise = TickerCacheHelpers.cleanExpiredCache();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Cleanup timeout after 30 seconds')), 30000)
        );
        
        await Promise.race([cleanupPromise, timeoutPromise]);
        
        const duration = Date.now() - startTime;
        // console.log(`TickerCache: Periodic cleanup completed in ${duration}ms`);
        
      } catch (error) {
        console.error('TickerCache: Periodic cleanup failed:', error.message);
        // Don't re-throw to prevent interval from stopping
      }
    }, 60 * 60 * 1000); // 1 hour
    
    // console.log('TickerCache: Periodic cleanup interval started (every 1 hour)');
  }
}