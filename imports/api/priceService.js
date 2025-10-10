import { Meteor } from 'meteor/meteor';
import { UnderlyingPricesCollection } from './underlyingPrices.js';
// Note: We'll call the EOD API via Meteor method instead of direct import
import { ProductsCollection } from './products.js';
import { MarketDataCacheCollection } from './marketDataCache.js';

export class PriceService {
  constructor() {
    this.batchSize = 10; // Number of concurrent API calls
    this.retryAttempts = 3;
    this.retryDelay = 1000; // milliseconds
  }

  /**
   * Fetch historical prices for multiple tickers with intelligent caching
   * @param {string[]} tickers - Array of EOD ticker symbols
   * @param {Date} startDate - Start date for price data
   * @param {Date} endDate - End date for price data
   * @returns {Promise<Object>} - Results summary
   */
  async fetchHistoricalPrices(tickers, startDate, endDate) {
    // Fetching real historical prices
    
    const results = {
      tickers: tickers.length,
      totalDatesRequested: 0,
      cacheHits: 0,
      apiFetches: 0,
      errors: [],
      success: []
    };

    for (const ticker of tickers) {
      try {
        // Fetching real data from local database
        
        // Optimized ticker variants - try .US format first for better performance
        const tickerVariants = [];
        if (!ticker.includes('.')) {
          tickerVariants.push(`${ticker}.US`); // Try .US first for US stocks
          tickerVariants.push(ticker); // Fallback to original
        } else {
          tickerVariants.push(ticker);
          if (ticker.includes('.US')) {
            tickerVariants.push(ticker.replace('.US', '')); // Try without .US as fallback
          }
        }
        
        let priceData = null;
        let foundTicker = null;
        
        for (const tickerVariant of tickerVariants) {
          // Checking MarketDataCache
          const data = await MarketDataCacheCollection.find({
            $or: [
              { symbol: tickerVariant.split('.')[0], fullTicker: tickerVariant },
              { fullTicker: tickerVariant }
            ],
            date: { $gte: startDate, $lte: endDate }
          }, {
            sort: { date: 1 }
          }).fetchAsync();
          
          if (data && data.length > 0) {
            priceData = data;
            foundTicker = tickerVariant;
            break;
          }
        }
        
        if (priceData && priceData.length > 0) {
          // Found price records
          results.success.push({
            ticker,
            datesRequested: this.getBusinessDaysCount(startDate, endDate),
            cacheHits: priceData.length,
            apiFetches: 0,
            recordsFound: priceData.length,
            actualTicker: foundTicker
          });
        } else {
          // No price data found in date range
          results.errors.push({
            ticker,
            error: `No price data found for ticker ${ticker} (tried: ${tickerVariants.join(', ')}) in the specified date range`
          });
        }
      } catch (error) {
        results.errors.push({
          ticker,
          error: error.message
        });
      }
    }

    // Fetching completed
    return results;
  }

  /**
   * Fetch historical prices for a single ticker
   * @param {string} ticker - EOD ticker symbol
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} - Fetch results
   */
  async fetchTickerHistoricalPrices(ticker, startDate, endDate) {
    // Fetching ticker historical prices
    
    // With unified MarketDataCache approach, we simply check if data exists
    // If not, it means refresh market data needs to be run
    const datesRequested = this.getBusinessDaysCount(startDate, endDate);
    
    // Check if we already have data in MarketDataCacheCollection
    const tickerVariants = [];
    if (!ticker.includes('.')) {
      tickerVariants.push(`${ticker}.US`); // Try .US first
      tickerVariants.push(ticker); // Fallback
    } else {
      tickerVariants.push(ticker);
    }
    
    let cacheHits = 0;
    for (const tickerVariant of tickerVariants) {
      const existingData = await MarketDataCacheCollection.find({
        $or: [
          { symbol: tickerVariant.split('.')[0], fullTicker: tickerVariant },
          { fullTicker: tickerVariant }
        ],
        date: { $gte: startDate, $lte: endDate }
      }).countAsync();
      
      if (existingData > 0) {
        cacheHits = existingData;
        // Found cached data points
        break;
      }
    }
    
    const result = {
      datesRequested: datesRequested,
      cacheHits: cacheHits,
      apiFetches: 0
    };

    if (cacheHits >= datesRequested * 0.8) { // Allow for some missing weekends/holidays
      // Sufficient data cached
      return result;
    }

    // Insufficient data - refresh market data needed
    
    // Return the result without fetching - user needs to refresh market data
    return result;
  }

  /**
   * Fetch price data from local sources (MarketDataCache and UnderlyingPrices)
   * @param {string} ticker - Ticker symbol
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} - Price data array
   */
  async fetchFromEodApi(ticker, startDate, endDate) {
    // Fetching real data

    // First, check if we have data in MarketDataCache
    if (Meteor.isServer) {
      try {
        // Optimized ticker variants - try .US format first for better performance
        const tickerVariants = [];
        if (!ticker.includes('.')) {
          tickerVariants.push(`${ticker}.US`); // Try .US first for US stocks
          tickerVariants.push(ticker); // Fallback to original
        } else {
          tickerVariants.push(ticker);
        }

        for (const tickerVariant of tickerVariants) {
          const cachedData = await MarketDataCacheCollection.find({
            fullTicker: tickerVariant,
            date: {
              $gte: startDate,
              $lte: endDate
            }
          }, {
            sort: { date: 1 }
          }).fetchAsync();

          if (cachedData && cachedData.length > 0) {
            // Found cached data points
            
            // Transform cached data to match expected format
            const transformedData = cachedData.map(item => ({
              ticker: ticker, // Use original ticker
              date: item.date,
              open: item.open,
              high: item.high,
              low: item.low,
              close: item.close,
              volume: item.volume,
              currency: item.currency || this.extractCurrency(ticker),
              exchange: item.exchange || this.extractExchange(ticker),
              source: 'marketDataCache'
            }));

            return transformedData;
          }
        }

        // No data found in MarketDataCache, checking UnderlyingPrices collection
      } catch (error) {
      }
    }

    // Fallback to UnderlyingPrices collection with optimized ticker variants
    const tickerVariants = [];
    if (!ticker.includes('.')) {
      tickerVariants.push(`${ticker}.US`); // Try .US first
      tickerVariants.push(ticker); // Fallback to original
    } else {
      tickerVariants.push(ticker);
      if (ticker.includes('.US')) {
        tickerVariants.push(ticker.replace('.US', '')); // Try without .US as fallback
      }
    }

    for (const tickerVariant of tickerVariants) {
      try {
        const priceData = await Meteor.callAsync('underlyingPrices.getPriceRange', tickerVariant, startDate, endDate);
        if (priceData && priceData.length > 0) {
          // Found price records in UnderlyingPrices collection
          return priceData;
        }
      } catch (error) {
      }
    }
    
    // No real price data found in any local source
    return []; // Return empty array if not found in any variant
  }

  /**
   * Cache price data in the database
   * @param {string} ticker - Ticker symbol
   * @param {Array} priceData - Array of price objects
   */
  async cachePriceData(ticker, priceData) {
    if (!priceData || priceData.length === 0) return;

    // Caching price records
    
    try {
      const results = await Meteor.callAsync('underlyingPrices.insertBatch', priceData);
      const errors = results.filter(r => !r.success);
      
      if (errors.length > 0) {
      }
    } catch (error) {
    }
  }

  /**
   * Get price for a specific ticker and date (with cache lookup)
   * @param {string} ticker - Ticker symbol
   * @param {Date} date - Price date
   * @param {string} priceType - 'open', 'high', 'low', 'close'
   * @returns {Promise<number|null>} - Price value or null if not found
   */
  async getPrice(ticker, date, priceType = 'close') {
    // Ensure ticker is a string - skip non-string identifiers (like numeric IDs)
    if (typeof ticker !== 'string' || !ticker.trim()) {
      return null;
    }
    
    // Validate date - don't look up future prices
    const today = new Date();
    today.setHours(23, 59, 59, 999); // Include all of today
    
    if (date > today) {
      // Requesting future price data - return null immediately
      return null;
    }
    
    // First check MarketDataCache
    if (Meteor.isServer) {
      try {
        // For US stocks, use .US format directly to avoid unnecessary lookups
        const tickerVariants = [];
        if (!ticker.includes('.')) {
          // For tickers without exchange suffix, assume US stocks and use .US format first
          tickerVariants.push(`${ticker}.US`);
          tickerVariants.push(ticker); // Keep original as fallback
        } else {
          tickerVariants.push(ticker);
        }

        // Create date range for the specific day
        const startOfDay = new Date(date);
        startOfDay.setHours(0, 0, 0, 0);
        const endOfDay = new Date(date);
        endOfDay.setHours(23, 59, 59, 999);

        for (const tickerVariant of tickerVariants) {
          
          const cachedData = await MarketDataCacheCollection.findOneAsync({
            $or: [
              { symbol: tickerVariant.split('.')[0], fullTicker: tickerVariant },
              { fullTicker: tickerVariant }
            ],
            date: {
              $gte: startOfDay,
              $lte: endOfDay
            }
          });

          if (cachedData && cachedData[priceType]) {
            return cachedData[priceType];
          } else {
          }
        }
        
        // Try nearby dates if exact date not found (within 3 business days)
        const nearbyPrice = await this.findNearbyPrice(ticker, date, priceType, 3);
        if (nearbyPrice !== null) {
          return nearbyPrice.price;
        }
      } catch (error) {
      }
    }

    // Try to get real price from local database with optimized ticker variants
    const tickerVariants = [];
    if (!ticker.includes('.')) {
      // For tickers without exchange suffix, try .US first (most common)
      tickerVariants.push(`${ticker}.US`);
      tickerVariants.push(ticker); // Fallback to original
    } else {
      tickerVariants.push(ticker);
      if (ticker.includes('.US')) {
        tickerVariants.push(ticker.replace('.US', '')); // Try without .US as fallback
      }
    }

    for (const tickerVariant of tickerVariants) {
      try {
        const realPrice = await Meteor.callAsync('underlyingPrices.getPrice', tickerVariant, date, priceType);
        if (realPrice !== null) {
          // Found real price
          return realPrice;
        }
      } catch (error) {
      }
    }
    
    // No real price data found
    return null; // Return null if not found in any variant
  }

  /**
   * Get price range for a ticker
   * @param {string} ticker - Ticker symbol
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Array>} - Array of price objects
   */
  async getPriceRange(ticker, startDate, endDate) {
    // Looking for price range
    
    // Optimized ticker variants - try .US format first for better performance
    const tickerVariants = [];
    if (!ticker.includes('.')) {
      tickerVariants.push(`${ticker}.US`); // Try .US first for US stocks
      tickerVariants.push(ticker); // Fallback to original
    } else {
      tickerVariants.push(ticker);
      if (ticker.includes('.')) {
        tickerVariants.push(ticker.split('.')[0]); // Try without exchange suffix as fallback
      }
    }

    for (const tickerVariant of tickerVariants) {
      // Checking MarketDataCache
      
      const data = await MarketDataCacheCollection.find({
        $or: [
          { symbol: tickerVariant.split('.')[0], fullTicker: tickerVariant },
          { fullTicker: tickerVariant }
        ],
        date: { $gte: startDate, $lte: endDate }
      }, {
        sort: { date: 1 }
      }).fetchAsync();
      
      if (data && data.length > 0) {
        // Found price records
        // Convert to legacy format for compatibility
        return data.map(price => ({
          ticker: tickerVariant,
          date: price.date,
          open: price.open,
          high: price.high,
          low: price.low,
          close: price.close,
          volume: price.volume,
          adjustedClose: price.adjustedClose
        }));
      }
    }

    // No price data found - data may need to be refreshed
    return [];
  }

  /**
   * Find nearby price if exact date is not available
   * @param {string} ticker - Ticker symbol
   * @param {Date} targetDate - Target date
   * @param {string} priceType - Price type (open, high, low, close)
   * @param {number} maxDaysBack - Maximum days to look back
   * @returns {Promise<Object|null>} - Price object with price and date, or null
   */
  async findNearbyPrice(ticker, targetDate, priceType = 'close', maxDaysBack = 3) {
    const tickerVariants = [];
    if (!ticker.includes('.')) {
      tickerVariants.push(`${ticker}.US`); // Try .US first
      tickerVariants.push(ticker); // Fallback
    } else {
      tickerVariants.push(ticker);
      if (ticker.includes('.US')) {
        tickerVariants.push(ticker.replace('.US', '')); // Try without .US as fallback
      }
    }

    // Look for price data within maxDaysBack business days
    for (let daysBack = 1; daysBack <= maxDaysBack; daysBack++) {
      const checkDate = new Date(targetDate);
      checkDate.setDate(checkDate.getDate() - daysBack);
      
      // Skip weekends
      if (checkDate.getDay() === 0 || checkDate.getDay() === 6) {
        continue;
      }

      const startOfDay = new Date(checkDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(checkDate);
      endOfDay.setHours(23, 59, 59, 999);

      for (const tickerVariant of tickerVariants) {
        try {
          const priceRecord = await MarketDataCacheCollection.findOneAsync({
            $or: [
              { symbol: tickerVariant.split('.')[0], fullTicker: tickerVariant },
              { fullTicker: tickerVariant }
            ],
            date: { $gte: startOfDay, $lte: endOfDay }
          });

          if (priceRecord && priceRecord[priceType]) {
            return {
              price: priceRecord[priceType],
              date: checkDate.toISOString().split('T')[0],
              daysBack
            };
          }
        } catch (error) {
        }
      }
    }

    return null;
  }

  /**
   * Check if date is a business day (Monday-Friday)
   * @param {Date} date - Date to check
   * @returns {boolean} - True if business day
   */
  isBusinessDay(date) {
    const day = date.getDay();
    return day >= 1 && day <= 5; // Monday = 1, Friday = 5
  }

  /**
   * Get next business day
   * @param {Date} date - Starting date
   * @returns {Date} - Next business day
   */
  getNextBusinessDay(date) {
    const nextDay = new Date(date);
    nextDay.setDate(nextDay.getDate() + 1);
    
    while (!this.isBusinessDay(nextDay)) {
      nextDay.setDate(nextDay.getDate() + 1);
    }
    
    return nextDay;
  }

  /**
   * Get previous business day
   * @param {Date} date - Starting date
   * @returns {Date} - Previous business day
   */
  getPreviousBusinessDay(date) {
    const prevDay = new Date(date);
    prevDay.setDate(prevDay.getDate() - 1);
    
    while (!this.isBusinessDay(prevDay)) {
      prevDay.setDate(prevDay.getDate() - 1);
    }
    
    return prevDay;
  }

  /**
   * Utility: Extract currency from ticker symbol
   * @param {string} ticker - Ticker symbol (e.g., "AAPL.US", "BMW.XETRA")
   * @returns {string} - Currency code
   */
  extractCurrency(ticker) {
    if (ticker.includes('.US') || ticker.includes('.NASDAQ') || ticker.includes('.NYSE')) {
      return 'USD';
    } else if (ticker.includes('.XETRA') || ticker.includes('.F')) {
      return 'EUR';
    } else if (ticker.includes('.LSE') || ticker.includes('.L')) {
      return 'GBP';
    } else if (ticker.includes('.TO')) {
      return 'CAD';
    } else if (ticker.includes('.T')) {
      return 'JPY';
    }
    return 'USD'; // Default fallback
  }

  /**
   * Utility: Extract exchange from ticker symbol
   * @param {string} ticker - Ticker symbol
   * @returns {string} - Exchange code
   */
  extractExchange(ticker) {
    const parts = ticker.split('.');
    return parts.length > 1 ? parts[1] : 'US';
  }

  /**
   * Utility: Group dates into continuous ranges for efficient API calls
   * @param {Date[]} dates - Array of dates
   * @returns {Array} - Array of {start, end} ranges
   */
  groupDatesIntoRanges(dates) {
    if (dates.length === 0) return [];

    const sorted = dates.sort((a, b) => a - b);
    const ranges = [];
    let rangeStart = sorted[0];
    let rangeEnd = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      const currentDate = sorted[i];
      const dayDiff = (currentDate - rangeEnd) / (1000 * 60 * 60 * 24);

      if (dayDiff <= 3) { // Within 3 days, continue range
        rangeEnd = currentDate;
      } else { // Gap too large, start new range
        ranges.push({ start: rangeStart, end: rangeEnd });
        rangeStart = currentDate;
        rangeEnd = currentDate;
      }
    }

    ranges.push({ start: rangeStart, end: rangeEnd });
    return ranges;
  }

  /**
   * Utility: Count business days between dates
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {number} - Number of business days
   */
  getBusinessDaysCount(startDate, endDate) {
    let count = 0;
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) { // Not weekend
        count++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return count;
  }

  /**
   * Utility: Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Server-side methods
if (Meteor.isServer) {
  const priceService = new PriceService();

  Meteor.methods({
    'priceService.fetchHistoricalPrices': async function(tickers, startDate, endDate) {
      return await priceService.fetchHistoricalPrices(tickers, startDate, endDate);
    },

    'priceService.getPrice': async function(ticker, date, priceType = 'close') {
      return await priceService.getPrice(ticker, date, priceType);
    },

    'priceService.getPriceRange': async function(ticker, startDate, endDate) {
      return await priceService.getPriceRange(ticker, startDate, endDate);
    },

    /**
     * Diagnose price data availability for a ticker
     */
    'priceService.diagnosePriceData': async function(ticker) {
      // Diagnosing price data
      
      const tickerVariants = [];
      if (!ticker.includes('.')) {
        tickerVariants.push(`${ticker}.US`); // Try .US first
        tickerVariants.push(ticker); // Fallback
      } else {
        tickerVariants.push(ticker);
        if (ticker.includes('.US')) {
          tickerVariants.push(ticker.replace('.US', '')); // Try without .US as fallback
        }
      }

      const diagnostics = {
        requestedTicker: ticker,
        variants: tickerVariants,
        results: []
      };

      for (const variant of tickerVariants) {
        try {
          const recentRecords = await MarketDataCacheCollection.find({
            $or: [
              { symbol: variant.split('.')[0], fullTicker: variant },
              { fullTicker: variant }
            ]
          }, {
            sort: { date: -1 },
            limit: 10
          }).fetchAsync();

          const totalRecords = await MarketDataCacheCollection.find({
            $or: [
              { symbol: variant.split('.')[0], fullTicker: variant },
              { fullTicker: variant }
            ]
          }).countAsync();

          diagnostics.results.push({
            variant,
            totalRecords,
            recentRecords: recentRecords.map(r => ({
              date: r.date.toISOString().split('T')[0],
              close: r.close,
              volume: r.volume
            })),
            latestDate: recentRecords.length > 0 ? recentRecords[0].date.toISOString().split('T')[0] : null,
            oldestDate: recentRecords.length > 0 ? recentRecords[recentRecords.length - 1].date.toISOString().split('T')[0] : null
          });
        } catch (error) {
          diagnostics.results.push({
            variant,
            error: error.message
          });
        }
      }

      // Diagnostics complete
      return diagnostics;
    }
  });
}