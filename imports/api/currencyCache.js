import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { HTTP } from 'meteor/http';

// Currency exchange rate cache collection
export const CurrencyRateCacheCollection = new Mongo.Collection('currencyRateCache');

// Currency cache schema
// {
//   _id: ObjectId,
//   pair: String,            // e.g., "EURUSD.FOREX", "GBPUSD.FOREX"
//   rate: Number,            // Exchange rate
//   change: Number,          // Rate change
//   changePercent: Number,   // Percentage change
//   timestamp: Date,         // When this data was fetched from EOD
//   lastUpdated: Date,       // When cache was last updated
//   expiresAt: Date,         // When this cache entry expires (24 hours)
//   source: String           // 'eod' or 'fallback'
// }

if (Meteor.isServer) {
  // Create TTL index for automatic cleanup (expires after 24 hours)
  CurrencyRateCacheCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  
  // Create index for efficient pair lookup
  CurrencyRateCacheCollection.createIndex({ pair: 1 });
}

// Main currency pairs to cache using standard market conventions
const MAIN_CURRENCY_PAIRS = [
  'EURUSD.FOREX',  // EUR to USD (standard)
  'GBPUSD.FOREX',  // GBP to USD (standard)
  'USDCHF.FOREX',  // USD to CHF (standard - USD is base)
  'USDJPY.FOREX',  // USD to JPY (standard - USD is base)
  'USDCAD.FOREX',  // USD to CAD (standard - USD is base)
  'AUDUSD.FOREX',  // AUD to USD (standard)
  'NZDUSD.FOREX',  // NZD to USD (standard)
  'EURGBP.FOREX',  // EUR to GBP (standard - EUR is base)
  'EURJPY.FOREX',  // EUR to JPY (standard - EUR is base)
  'GBPJPY.FOREX',  // GBP to JPY (standard - GBP is base)
  'EURILS.FOREX'   // EUR to ILS (Israeli Shekel)
];

export const CurrencyCache = {
  // Cache duration in milliseconds (24 hours)
  CACHE_DURATION: 24 * 60 * 60 * 1000,

  // Get cached exchange rate
  async getCachedRate(pair) {
    try {
      const now = new Date();
      const cachedData = await CurrencyRateCacheCollection.findOneAsync({
        pair: pair,
        expiresAt: { $gt: now }
      });
      
      return cachedData;
    } catch (error) {
      console.error(`CurrencyCache: Error getting cached rate for ${pair}:`, error);
      return null;
    }
  },

  // Cache exchange rate data
  async setCachedRate(pair, rateData, source = 'eod') {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + this.CACHE_DURATION);
      
      const cacheData = {
        pair: pair,
        rate: rateData.rate || rateData.close || rateData.price || 0,
        change: rateData.change || 0,
        changePercent: rateData.changePercent || rateData.change_p || 0,
        timestamp: rateData.timestamp || now,
        lastUpdated: now,
        expiresAt: expiresAt,
        source: source
      };

      // Upsert (update if exists, insert if not)
      const result = await CurrencyRateCacheCollection.upsertAsync(
        { pair: pair },
        { $set: cacheData }
      );

      // console.log(`CurrencyCache: Cached rate for ${pair}: ${cacheData.rate} (${source})`);
      return result;
    } catch (error) {
      console.error(`CurrencyCache: Error caching rate for ${pair}:`, error);
      throw error;
    }
  },

  // Get multiple cached rates
  async getCachedRates(pairs) {
    try {
      const now = new Date();
      const cachedData = await CurrencyRateCacheCollection.find({
        pair: { $in: pairs },
        expiresAt: { $gt: now }
      }).fetchAsync();
      
      // Convert to map for easy lookup
      const rateMap = new Map();
      cachedData.forEach(data => {
        rateMap.set(data.pair, {
          rate: data.rate,
          change: data.change,
          changePercent: data.changePercent,
          timestamp: data.timestamp,
          source: data.source,
          fallback: data.source === 'fallback'
        });
      });
      
      return rateMap;
    } catch (error) {
      console.error('CurrencyCache: Error getting multiple cached rates:', error);
      return new Map();
    }
  },

  // Fetch single rate from EOD API
  async fetchRateFromEOD(pair) {
    try {
      const url = `https://eodhistoricaldata.com/api/real-time/${pair}`;
      const params = {
        api_token: Meteor.settings.private?.EOD_API_TOKEN || '5c265eab2c9066.19444326',
        fmt: 'json'
      };

      // console.log(`CurrencyCache: Fetching exchange rate for ${pair}`);
      const response = await HTTP.get(url, { params });
      
      if (response.data && typeof response.data === 'object') {
        return {
          rate: response.data.close || response.data.price || response.data.last,
          change: response.data.change,
          changePercent: response.data.change_p,
          timestamp: new Date()
        };
      }
      
      return null;
    } catch (error) {
      console.error(`CurrencyCache: Error fetching rate for ${pair}:`, error);
      return null;
    }
  },

  // Refresh currency rates from EOD API
  async refreshCurrencyRates(pairs = MAIN_CURRENCY_PAIRS) {
    const results = {
      cached: 0,
      fetched: 0,
      failed: 0,
      rates: new Map()
    };

    try {
      // console.log(`CurrencyCache: Refreshing rates for ${pairs.length} currency pairs`);

      // First check cache for valid entries
      const cachedRates = await this.getCachedRates(pairs);
      
      const pairsToFetch = [];
      pairs.forEach(pair => {
        if (cachedRates.has(pair)) {
          results.rates.set(pair, cachedRates.get(pair));
          results.cached++;
          // console.log(`CurrencyCache: Using cached rate for ${pair}`);
        } else {
          pairsToFetch.push(pair);
        }
      });

      // Fetch remaining pairs from EOD API
      for (const pair of pairsToFetch) {
        try {
          const rateData = await this.fetchRateFromEOD(pair);
          if (rateData) {
            await this.setCachedRate(pair, rateData, 'eod');
            results.rates.set(pair, {
              rate: rateData.rate,
              change: rateData.change || 0,
              changePercent: rateData.changePercent || 0,
              timestamp: new Date(),
              source: 'eod',
              fallback: false
            });
            results.fetched++;
          } else {
            results.failed++;
          }
        } catch (error) {
          console.error(`CurrencyCache: Failed to fetch ${pair}:`, error);
          results.failed++;
        }

        // Small delay to avoid overwhelming the API
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // console.log(`CurrencyCache: Refresh complete - ${results.cached} cached, ${results.fetched} fetched, ${results.failed} failed`);
      return results;

    } catch (error) {
      console.error('CurrencyCache: Error refreshing currency rates:', error);
      throw error;
    }
  },

  // Get all main currency rates (for Dashboard)
  async getMainCurrencyRates() {
    try {
      const results = await this.refreshCurrencyRates(MAIN_CURRENCY_PAIRS);
      
      // Convert map to object for easier client consumption
      const ratesObj = {};
      results.rates.forEach((data, pair) => {
        ratesObj[pair] = data.rate;
      });
      
      return {
        success: true,
        rates: ratesObj,
        stats: {
          cached: results.cached,
          fetched: results.fetched,
          failed: results.failed,
          total: MAIN_CURRENCY_PAIRS.length
        }
      };
    } catch (error) {
      console.error('CurrencyCache: Error getting main currency rates:', error);
      return {
        success: false,
        error: error.message,
        rates: {}
      };
    }
  },

  // Clean expired cache entries with improved error handling
  async cleanExpiredCache() {
    let attempts = 0;
    const maxAttempts = 3;
    
    while (attempts < maxAttempts) {
      try {
        const now = new Date();
        console.log(`CurrencyCache: Attempting cleanup (attempt ${attempts + 1}/${maxAttempts})`);
        
        // Add timeout to the database operation itself
        const cleanupPromise = CurrencyRateCacheCollection.removeAsync({
          expiresAt: { $lt: now }
        });
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database operation timeout')), 15000)
        );
        
        const result = await Promise.race([cleanupPromise, timeoutPromise]);
        
        const removed = result || 0;
        if (removed > 0) {
          console.log(`CurrencyCache: Successfully cleaned ${removed} expired rate cache entries`);
        } else {
          console.log('CurrencyCache: No expired entries to clean');
        }
        
        return removed;
        
      } catch (error) {
        attempts++;
        console.error(`CurrencyCache: Cleanup attempt ${attempts} failed:`, error.message);
        
        if (attempts >= maxAttempts) {
          console.error('CurrencyCache: All cleanup attempts failed, giving up');
          return 0;
        }
        
        // Wait before retrying (exponential backoff)
        const delay = Math.pow(2, attempts) * 1000;
        console.log(`CurrencyCache: Retrying cleanup in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    return 0;
  },

  // Get cache statistics
  async getCacheStats() {
    try {
      const totalRecords = await CurrencyRateCacheCollection.find({}).countAsync();
      const activeRecords = await CurrencyRateCacheCollection.find({
        expiresAt: { $gt: new Date() }
      }).countAsync();
      
      const uniquePairs = await CurrencyRateCacheCollection.rawCollection().distinct('pair');
      
      return {
        totalRecords,
        activeRecords,
        expiredRecords: totalRecords - activeRecords,
        uniquePairs: uniquePairs.length,
        cacheDurationHours: this.CACHE_DURATION / (60 * 60 * 1000)
      };
    } catch (error) {
      console.error('CurrencyCache: Error getting cache stats:', error);
      return {
        totalRecords: 0,
        activeRecords: 0,
        expiredRecords: 0,
        uniquePairs: 0,
        cacheDurationHours: 24
      };
    }
  }
};

// Server-side methods
if (Meteor.isServer) {
  Meteor.methods({
    // Get main currency exchange rates (for Dashboard)
    async 'currencyCache.getMainRates'() {
      return await CurrencyCache.getMainCurrencyRates();
    },

    // Get specific currency rates
    async 'currencyCache.getRates'(pairs) {
      check(pairs, [String]);
      
      try {
        const results = await CurrencyCache.refreshCurrencyRates(pairs);
        
        // Convert map to object for easier client consumption
        const ratesObj = {};
        results.rates.forEach((data, pair) => {
          ratesObj[pair] = data.rate;
        });
        
        return {
          success: true,
          rates: ratesObj,
          stats: {
            cached: results.cached,
            fetched: results.fetched,
            failed: results.failed,
            total: pairs.length
          }
        };
      } catch (error) {
        console.error('CurrencyCache: Error in getRates method:', error);
        return {
          success: false,
          error: error.message,
          rates: {}
        };
      }
    },

    // Manually refresh cache for specific pairs
    async 'currencyCache.refresh'(pairs = null) {
      check(pairs, Match.Optional(Match.OneOf([String], null)));
      
      try {
        const pairsToRefresh = pairs || MAIN_CURRENCY_PAIRS;
        const results = await CurrencyCache.refreshCurrencyRates(pairsToRefresh);
        
        return {
          success: true,
          message: `Refreshed ${pairsToRefresh.length} currency pairs`,
          stats: {
            cached: results.cached,
            fetched: results.fetched,
            failed: results.failed,
            total: pairsToRefresh.length
          }
        };
      } catch (error) {
        console.error('CurrencyCache: Error in refresh method:', error);
        return {
          success: false,
          error: error.message
        };
      }
    },

    // Get cache statistics
    async 'currencyCache.getStats'() {
      return await CurrencyCache.getCacheStats();
    },

    // Clear currency cache
    async 'currencyCache.clear'(pair = null) {
      check(pair, Match.Optional(Match.OneOf(String, null)));
      
      try {
        const query = pair ? { pair: pair } : {};
        const removed = await CurrencyRateCacheCollection.removeAsync(query);
        
        return {
          success: true,
          message: `Cleared ${removed} cache entries${pair ? ` for ${pair}` : ''}`,
          removedCount: removed
        };
      } catch (error) {
        console.error('CurrencyCache: Error clearing cache:', error);
        return {
          success: false,
          error: error.message
        };
      }
    }
  });

  // Start periodic cache refresh (once per day)
  if (Meteor.isServer) {
    // Initial fetch on server startup (with delay to let server fully start)
    Meteor.setTimeout(async () => {
      try {
        await CurrencyCache.refreshCurrencyRates();
        console.log('CurrencyCache: Initial warmup completed');
      } catch (error) {
        console.error('CurrencyCache: Initial cache warmup failed:', error);
      }
    }, 5000); // 5 second delay
    
    // Periodic refresh every 24 hours (once per day)
    Meteor.setInterval(async () => {
      try {
        await CurrencyCache.refreshCurrencyRates();
        console.log('CurrencyCache: Daily refresh completed');
      } catch (error) {
        console.error('CurrencyCache: Daily refresh failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  // Periodic cache cleanup (every hour with error resilience)
  if (Meteor.isServer) {
    Meteor.setInterval(async () => {
      try {
        console.log('CurrencyCache: Starting periodic cleanup...');
        const startTime = Date.now();
        
        // Add timeout wrapper for cleanup operation
        const cleanupPromise = CurrencyCache.cleanExpiredCache();
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Cleanup timeout after 30 seconds')), 30000)
        );
        
        await Promise.race([cleanupPromise, timeoutPromise]);
        
        const duration = Date.now() - startTime;
        console.log(`CurrencyCache: Periodic cleanup completed in ${duration}ms`);
        
      } catch (error) {
        console.error('CurrencyCache: Periodic cleanup failed:', error.message);
        // Don't re-throw to prevent interval from stopping
      }
    }, 60 * 60 * 1000); // 1 hour
    
    console.log('CurrencyCache: Periodic cleanup interval started (every 1 hour)');
  }
}