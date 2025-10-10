import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { EODApiHelpers } from './eodApi';
import { ProductsCollection } from './products';
import { UsersCollection } from './users';

/**
 * New MarketDataCache structure - One document per stock
 * 
 * BENEFITS:
 * - Single query to get all historical data for a stock
 * - Better performance for time-series operations
 * - Reduced network overhead 
 * - More efficient caching and subscriptions
 * - Easier to maintain and update
 * 
 * DOCUMENT STRUCTURE:
 * {
 *   _id: ObjectId,
 *   symbol: String,           // e.g., "AAPL"
 *   exchange: String,         // e.g., "NASDAQ"
 *   fullTicker: String,       // e.g., "AAPL.NASDAQ" (unique index)
 *   currency: String,         // e.g., "USD"
 *   dataSource: String,       // e.g., "EOD"
 *   
 *   // Metadata
 *   firstDate: Date,          // Earliest historical data point
 *   lastDate: Date,           // Most recent historical data point
 *   dataPoints: Number,       // Total number of historical records
 *   lastUpdated: Date,        // When this document was last updated
 *   
 *   // Historical data array (sorted by date ascending)
 *   history: [{
 *     date: Date,
 *     open: Number,
 *     high: Number,
 *     low: Number,
 *     close: Number,
 *     volume: Number,
 *     adjustedClose: Number
 *   }],
 *   
 *   // Performance cache for quick access
 *   cache: {
 *     latestPrice: Number,    // Most recent closing price
 *     latestDate: Date,       // Date of latest price
 *     high52Week: Number,     // 52-week high
 *     low52Week: Number,      // 52-week low
 *     sma20: Number,          // 20-day simple moving average
 *     sma50: Number,          // 50-day simple moving average
 *     sma200: Number          // 200-day simple moving average
 *   }
 * }
 */

export const MarketDataCacheCollection = 
  (typeof window !== 'undefined' && window.MarketDataCacheCollection) || 
  new Mongo.Collection('marketDataCache');

if (typeof window !== 'undefined') {
  window.MarketDataCacheCollection = MarketDataCacheCollection;
}

// Create indexes for efficient querying
if (Meteor.isServer) {
  // Note: Indexes are created in server/main.js startup to handle conflicts properly
}

// Helper functions
function calculateSMA(prices) {
  if (!prices || prices.length === 0) return null;
  const sum = prices.reduce((a, b) => a + b, 0);
  return sum / prices.length;
}

function calculate52WeekHighLow(history) {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  
  const yearData = history.filter(h => h.date >= oneYearAgo);
  if (yearData.length === 0) return { high: null, low: null };
  
  return {
    high: Math.max(...yearData.map(d => d.high)),
    low: Math.min(...yearData.map(d => d.low))
  };
}

// Market Data Helpers for new structure
export const MarketDataHelpers = {
  /**
   * Get all unique stocks in cache
   */
  async getAllUniqueStocks() {
    return await MarketDataCacheCollection.find({}, {
      fields: {
        fullTicker: 1,
        symbol: 1,
        exchange: 1,
        currency: 1,
        'cache.latestDate': 1,
        firstDate: 1,
        dataPoints: 1
      }
    }).fetchAsync();
  },

  /**
   * Get oldest trade date for a specific stock
   */
  async getOldestTradeDateForStock(fullTicker) {
    check(fullTicker, String);
    
    const stock = await MarketDataCacheCollection.findOneAsync(
      { fullTicker },
      { fields: { firstDate: 1 } }
    );
    
    return stock ? stock.firstDate : null;
  },

  /**
   * Get historical data for a stock
   */
  async getHistoricalData(fullTicker, fromDate = null, toDate = null) {
    check(fullTicker, String);
    check(fromDate, Match.OneOf(Date, null));
    check(toDate, Match.OneOf(Date, null));

    const stock = await MarketDataCacheCollection.findOneAsync({ fullTicker });
    if (!stock) return null;

    let history = stock.history;
    
    if (fromDate || toDate) {
      history = history.filter(h => {
        if (fromDate && h.date < fromDate) return false;
        if (toDate && h.date > toDate) return false;
        return true;
      });
    }

    return history;
  },

  /**
   * Get cached data for a stock within a date range (legacy compatibility)
   */
  async getCachedData(fullTicker, fromDate = null, toDate = null, limit = null) {
    check(fullTicker, String);
    check(fromDate, Match.Optional(Date));
    check(toDate, Match.Optional(Date));
    check(limit, Match.Optional(Number));

    const history = await this.getHistoricalData(fullTicker, fromDate, toDate);
    if (!history) return [];

    // Apply limit if specified
    if (limit) {
      return history.slice(-limit); // Get most recent records
    }

    return history;
  },

  /**
   * Fetch and update historical data for a stock (new optimized version)
   */
  async fetchAndCacheHistoricalData(fullTicker, fromDate, toDate = null) {
    check(fullTicker, String);
    check(fromDate, Date);
    check(toDate, Match.OneOf(Date, null));

    const actualToDate = toDate || new Date();
    
    try {
      const [symbol, exchange] = fullTicker.split('.');
      if (!symbol || !exchange) {
        throw new Error(`Invalid fullTicker format: ${fullTicker}`);
      }


      // Convert exchange for EOD API
      let apiExchange = exchange;
      if (exchange === 'NASDAQ' || exchange === 'NYSE' || exchange === 'AMEX') {
        apiExchange = 'US';
      }

      // Fetch data from EOD API
      const historicalData = await EODApiHelpers.getHistoricalData(
        symbol, apiExchange, fromDate, actualToDate
      );

      if (!historicalData || historicalData.length === 0) {
        return { cached: 0, skipped: 0, errors: 0 };
      }

      // Get existing document or create new one
      let stockDoc = await MarketDataCacheCollection.findOneAsync({ fullTicker });
      
      if (!stockDoc) {
        // Create new document
        stockDoc = {
          symbol,
          exchange,
          fullTicker,
          currency: historicalData[0].currency || 'USD',
          dataSource: 'EOD',
          firstDate: null,
          lastDate: null,
          dataPoints: 0,
          lastUpdated: new Date(),
          history: [],
          cache: {}
        };
      }

      // Convert historical data to our format
      const newDataPoints = historicalData.map(day => ({
        date: new Date(day.date),
        open: parseFloat(day.open),
        high: parseFloat(day.high),
        low: parseFloat(day.low),
        close: parseFloat(day.close),
        volume: parseInt(day.volume),
        adjustedClose: parseFloat(day.adjusted_close || day.close)
      }));

      // Merge with existing history (avoid duplicates)
      const existingDates = new Set(stockDoc.history.map(h => h.date.getTime()));
      const uniqueNewPoints = newDataPoints.filter(p => !existingDates.has(p.date.getTime()));
      
      stockDoc.history = [...stockDoc.history, ...uniqueNewPoints]
        .sort((a, b) => a.date - b.date);

      // Update metadata
      stockDoc.firstDate = stockDoc.history[0]?.date || null;
      stockDoc.lastDate = stockDoc.history[stockDoc.history.length - 1]?.date || null;
      stockDoc.dataPoints = stockDoc.history.length;
      stockDoc.lastUpdated = new Date();

      // Update cache
      const latestData = stockDoc.history[stockDoc.history.length - 1];
      if (latestData) {
        const { high, low } = calculate52WeekHighLow(stockDoc.history);
        const prices = stockDoc.history.map(h => h.close);
        
        stockDoc.cache = {
          latestPrice: latestData.close,
          latestDate: latestData.date,
          high52Week: high,
          low52Week: low,
          sma20: calculateSMA(prices.slice(-20)),
          sma50: calculateSMA(prices.slice(-50)),
          sma200: calculateSMA(prices.slice(-200))
        };
      }

      // Upsert the document
      await MarketDataCacheCollection.upsertAsync(
        { fullTicker },
        { $set: stockDoc }
      );

      return { 
        cached: uniqueNewPoints.length, 
        skipped: 0, 
        errors: 0,
        totalPoints: stockDoc.dataPoints 
      };

    } catch (error) {
      throw new Meteor.Error('historical-update-failed', error.message);
    }
  },

  /**
   * Get cache statistics (updated for new structure)
   */
  async getCacheStats() {
    const stocks = await MarketDataCacheCollection.find({}, {
      fields: {
        fullTicker: 1,
        dataPoints: 1,
        firstDate: 1,
        lastDate: 1
      }
    }).fetchAsync();

    const totalDataPoints = stocks.reduce((sum, s) => sum + (s.dataPoints || 0), 0);
    const dates = stocks.flatMap(s => [s.firstDate, s.lastDate]).filter(Boolean);
    
    return {
      totalStocks: stocks.length,
      uniqueStockCount: stocks.length, // UI expects this field name
      totalDataPoints,
      totalRecords: totalDataPoints,   // UI expects this field name
      oldestDate: dates.length > 0 ? new Date(Math.min(...dates)) : null,
      newestDate: dates.length > 0 ? new Date(Math.max(...dates)) : null,
      stocks: stocks.map(s => s.fullTicker).sort()
    };
  },

  /**
   * Get current price for a stock (optimized for new structure)
   */
  async getCurrentPrice(fullTicker) {
    check(fullTicker, String);

    try {
      const stock = await MarketDataCacheCollection.findOneAsync(
        { fullTicker },
        { fields: { cache: 1, currency: 1 } }
      );

      if (stock && stock.cache && stock.cache.latestPrice) {
        const now = new Date();
        const timeDiff = now - stock.cache.latestDate;
        const fifteenMinutes = 15 * 60 * 1000;
        
        // Use cached price if recent enough
        if (timeDiff <= fifteenMinutes) {
          return {
            price: stock.cache.latestPrice,
            date: stock.cache.latestDate,
            source: 'cache',
            currency: stock.currency || 'USD'
          };
        }
      }

      // Fetch fresh price from API
      const [symbol, exchange] = fullTicker.split('.');
      let apiExchange = exchange;
      if (exchange === 'NASDAQ' || exchange === 'NYSE' || exchange === 'AMEX') {
        apiExchange = 'US';
      }
      
      const currentData = await EODApiHelpers.getRealTimePrice(symbol, apiExchange);
      
      if (currentData && (currentData.close || currentData.price)) {
        const price = parseFloat(currentData.close || currentData.price);
        const priceDate = new Date();
        
        // Update cache with new price
        await this.updateLatestPrice(fullTicker, price, priceDate);
        
        return {
          price: price,
          date: priceDate,
          source: 'api',
          currency: currentData.currency || stock?.currency || 'USD'
        };
      }

      // Fallback to cached data
      if (stock && stock.cache && stock.cache.latestPrice) {
        return {
          price: stock.cache.latestPrice,
          date: stock.cache.latestDate,
          source: 'cache_fallback',
          currency: stock.currency || 'USD'
        };
      }

      throw new Error(`No price data available for ${fullTicker}`);
    } catch (error) {
      throw new Meteor.Error('price-fetch-failed', error.message);
    }
  },

  /**
   * Update latest price in cache
   */
  async updateLatestPrice(fullTicker, price, date = new Date()) {
    check(fullTicker, String);
    check(price, Number);
    check(date, Date);

    await MarketDataCacheCollection.updateAsync(
      { fullTicker },
      {
        $set: {
          'cache.latestPrice': price,
          'cache.latestDate': date,
          lastUpdated: new Date()
        }
      }
    );
  },

  /**
   * Clear all cache data
   */
  async clearCache() {
    const result = await MarketDataCacheCollection.removeAsync({});
    return { removed: result };
  },

  // Get current prices for multiple stocks efficiently
  async getBatchPrices(fullTickers) {
    check(fullTickers, [String]);

    const results = {};

    for (const fullTicker of fullTickers) {
      try {
        const priceData = await this.getCurrentPrice(fullTicker);
        results[fullTicker] = priceData;
      } catch (error) {
        results[fullTicker] = { error: error.message };
      }
    }

    return results;
  },

  // Search for stocks using EOD API (for equity holdings stock selection)
  async searchStocksForPortfolio(query, limit = 20) {
    check(query, String);
    check(limit, Number);
    
    try {
      // Use EOD API to search for stocks
      const searchResults = await EODApiHelpers.searchSecurities(query, limit);
      
      // Filter and format results for portfolio use
      const filteredResults = searchResults
        .filter(stock => {
          const stockType = (stock.Type || '').toLowerCase();
          return stockType === 'common stock' || stockType === 'stock' || stockType === 'etf';
        })
        .map(stock => ({
          symbol: stock.Code,
          name: stock.Name,
          exchange: stock.Exchange,
          fullTicker: `${stock.Code}.${stock.Exchange}`,
          type: stock.Type,
          country: stock.Country,
          currency: stock.Currency || 'USD',
          isin: stock.ISIN
        }))
        .slice(0, limit);

      return filteredResults;
      
    } catch (error) {
      throw new Meteor.Error('stock-search-failed', 'Failed to search for stocks');
    }
  }
};


// Server-side methods
if (Meteor.isServer) {
  Meteor.methods({
    // Main method to refresh market data cache
    async 'marketData.refreshCache'(options = {}, sessionId = null) {
      check(options, Match.OneOf(Object, null, undefined));
      check(sessionId, Match.OneOf(String, null, undefined));
      
      // Get current user with session-based authentication
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'Must be logged in to refresh cache');
      }

      const {
        symbols = [],        // Array of fullTickers to refresh
        fromDate = null,     // Start date for historical data
        toDate = null,       // End date for historical data
        forceRefresh = false // Whether to refresh existing cached data
      } = options;

      try {
        let results = [];

        if (symbols.length === 0) {
          // If no specific symbols provided, refresh data for products in the system
          const products = await ProductsCollection.find({}, { 
            fields: { 
              underlyings: 1, 
              baskets: 1, 
              tradeDate: 1, 
              valueDate: 1,
              // New template-based structure fields
              payoffStructure: 1,
              structure: 1
            } 
          }).fetchAsync();
          const uniqueTickers = new Set();
          const productDates = [];
          
          // Track earliest date for each underlying ticker
          const tickerDates = new Map(); // fullTicker -> earliest date
          
          // Helper function to add ticker with product date
          const addTickerWithDate = (fullTicker, productDate) => {
            if (fullTicker && productDate) {
              const currentEarliestDate = tickerDates.get(fullTicker);
              if (!currentEarliestDate || productDate < currentEarliestDate) {
                tickerDates.set(fullTicker, productDate);
              }
            }
            uniqueTickers.add(fullTicker);
          };
          
          products.forEach(product => {
            // Determine the product's trade/value date
            let productDate = null;
            if (product.tradeDate) {
              productDate = new Date(product.tradeDate);
            } else if (product.valueDate) {
              productDate = new Date(product.valueDate);
            }
            
            if (productDate) {
              productDates.push(productDate);
            }
            
            // Extract underlyings from new template-based structure
            if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
              product.payoffStructure.forEach(component => {
                // Look for underlying or basket components in the payoff structure
                if (component.type === 'underlying' || component.type === 'basket') {
                  // Extract ticker information from component
                  // PRIORITY: Use securityData.ticker if available (has correct exchange)
                  if (component.securityData && component.securityData.ticker) {
                    addTickerWithDate(component.securityData.ticker, productDate);
                  } else if (component.ticker) {
                    let fullTicker = component.ticker;
                    if (!fullTicker.includes('.')) {
                      // Apply exchange mapping based on ISIN or default to US
                      let exchange = '.US';
                      if (component.isin) {
                        const isinCountry = component.isin.substring(0, 2);
                        switch (isinCountry) {
                          case 'FR': exchange = '.PA'; break;
                          case 'DE': exchange = '.DE'; break;
                          case 'GB': exchange = '.L'; break;
                          case 'NL': exchange = '.AS'; break;
                          case 'IT': exchange = '.MI'; break;
                          case 'ES': exchange = '.MC'; break;
                          case 'CH': exchange = '.SW'; break;
                          case 'CA': exchange = '.TO'; break;
                          default: exchange = '.US'; break;
                        }
                      }
                      fullTicker = `${component.ticker}${exchange}`;
                    }
                    addTickerWithDate(fullTicker, productDate);
                  }
                  
                  // If it's a basket component, extract securities
                  if (component.securities && Array.isArray(component.securities)) {
                    component.securities.forEach(security => {
                      // PRIORITY: Use securityData.ticker if available (has correct exchange)
                      if (security.securityData && security.securityData.ticker) {
                        addTickerWithDate(security.securityData.ticker, productDate);
                      } else if (security.ticker) {
                        let fullTicker = security.ticker;
                        if (!fullTicker.includes('.')) {
                          let exchange = '.US';
                          if (security.isin) {
                            const isinCountry = security.isin.substring(0, 2);
                            switch (isinCountry) {
                              case 'FR': exchange = '.PA'; break;
                              case 'DE': exchange = '.DE'; break;
                              case 'GB': exchange = '.L'; break;
                              case 'NL': exchange = '.AS'; break;
                              case 'IT': exchange = '.MI'; break;
                              case 'ES': exchange = '.MC'; break;
                              case 'CH': exchange = '.SW'; break;
                              case 'CA': exchange = '.TO'; break;
                              default: exchange = '.US'; break;
                            }
                          }
                          fullTicker = `${security.ticker}${exchange}`;
                        }
                        addTickerWithDate(fullTicker, productDate);
                      }
                    });
                  }
                }
              });
            }
            
            // Legacy: Also check old structure for underlyings
            if (product.underlyings && Array.isArray(product.underlyings)) {
              product.underlyings.forEach(underlying => {
                // Check for various ticker formats used in the system
                let ticker = null;

                // ONLY use validated ticker from EOD autocomplete - NEVER reconstruct from ISIN
                if (underlying.fullTicker) {
                  ticker = underlying.fullTicker;
                } else if (underlying.securityData && underlying.securityData.ticker) {
                  // Use validated ticker from autocomplete (has correct exchange from EOD API)
                  ticker = underlying.securityData.ticker;
                } else if (underlying.ticker && underlying.ticker.includes('.')) {
                  // Only use ticker if it already has exchange suffix (validated)
                  ticker = underlying.ticker;
                } else if (underlying.securityData && underlying.securityData.symbol && underlying.securityData.exchange) {
                  // Construct from validated exchange data (from EOD API)
                  const symbol = underlying.securityData.symbol;
                  const exchange = underlying.securityData.exchange;
                  ticker = exchange ? `${symbol}.${exchange}` : symbol;
                }
                
                if (ticker) {
                  addTickerWithDate(ticker, productDate);
                }
              });
            }
            
            // Also check the structure field (droppedItems) for underlyings
            if (product.structure && typeof product.structure === 'object') {
              // The structure contains sections like { life: [], maturity: [], ... }
              Object.values(product.structure).forEach(sectionItems => {
                if (Array.isArray(sectionItems)) {
                  sectionItems.forEach(component => {
                    if (component.type === 'underlying' || component.type === 'basket') {
                      // Extract ticker information from component
                      if (component.ticker) {
                        let fullTicker = component.ticker;
                        if (!fullTicker.includes('.')) {
                          let exchange = '.US';
                          if (component.isin) {
                            const isinCountry = component.isin.substring(0, 2);
                            switch (isinCountry) {
                              case 'FR': exchange = '.PA'; break;
                              case 'DE': exchange = '.DE'; break;
                              case 'GB': exchange = '.L'; break;
                              case 'NL': exchange = '.AS'; break;
                              case 'IT': exchange = '.MI'; break;
                              case 'ES': exchange = '.MC'; break;
                              case 'CH': exchange = '.SW'; break;
                              case 'CA': exchange = '.TO'; break;
                              default: exchange = '.US'; break;
                            }
                          }
                          fullTicker = `${component.ticker}${exchange}`;
                        }
                        addTickerWithDate(fullTicker, productDate);
                      }
                      
                      // Extract from securities array if present
                      if (component.securities && Array.isArray(component.securities)) {
                        component.securities.forEach(security => {
                          if (security.ticker) {
                            let fullTicker = security.ticker;
                            if (!fullTicker.includes('.')) {
                              let exchange = '.US';
                              if (security.isin) {
                                const isinCountry = security.isin.substring(0, 2);
                                switch (isinCountry) {
                                  case 'FR': exchange = '.PA'; break;
                                  case 'DE': exchange = '.DE'; break;
                                  case 'GB': exchange = '.L'; break;
                                  case 'NL': exchange = '.AS'; break;
                                  case 'IT': exchange = '.MI'; break;
                                  case 'ES': exchange = '.MC'; break;
                                  case 'CH': exchange = '.SW'; break;
                                  case 'CA': exchange = '.TO'; break;
                                  default: exchange = '.US'; break;
                                }
                              }
                              fullTicker = `${security.ticker}${exchange}`;
                            }
                            addTickerWithDate(fullTicker, productDate);
                          }
                        });
                      }
                    }
                  });
                }
              });
            }
            
            // Legacy: Also check baskets for securities
            if (product.baskets && Array.isArray(product.baskets)) {
              product.baskets.forEach(basket => {
                if (basket.securities && Array.isArray(basket.securities)) {
                  basket.securities.forEach(security => {
                    let ticker = null;
                    
                    if (security.fullTicker) {
                      ticker = security.fullTicker;
                    } else if (security.ticker) {
                      // Apply same ISIN-based exchange mapping for basket securities
                      if (!security.ticker.includes('.')) {
                        let exchange = '.US'; // Default
                        if (security.isin) {
                          const isinCountry = security.isin.substring(0, 2);
                          switch (isinCountry) {
                            case 'FR': exchange = '.PA'; break; // France -> Paris
                            case 'DE': exchange = '.DE'; break; // Germany -> XETRA
                            case 'GB': exchange = '.L'; break;  // UK -> London
                            case 'NL': exchange = '.AS'; break; // Netherlands -> Amsterdam
                            case 'IT': exchange = '.MI'; break; // Italy -> Milan
                            case 'ES': exchange = '.MC'; break; // Spain -> Madrid
                            case 'CH': exchange = '.SW'; break; // Switzerland -> Swiss
                            case 'CA': exchange = '.TO'; break; // Canada -> Toronto
                            default: exchange = '.US'; break;   // Default to US
                          }
                        }
                        ticker = `${security.ticker}${exchange}`;
                      } else {
                        ticker = security.ticker;
                      }
                    } else if (security.securityData && security.securityData.symbol) {
                      const symbol = security.securityData.symbol;
                      if (!symbol.includes('.')) {
                        let exchangeSuffix = '.US'; // Default
                        if (security.isin) {
                          const isinCountry = security.isin.substring(0, 2);
                          switch (isinCountry) {
                            case 'FR': exchangeSuffix = '.PA'; break; // France -> Paris
                            case 'DE': exchangeSuffix = '.DE'; break; // Germany -> XETRA
                            case 'GB': exchangeSuffix = '.L'; break;  // UK -> London
                            case 'NL': exchangeSuffix = '.AS'; break; // Netherlands -> Amsterdam
                            case 'IT': exchangeSuffix = '.MI'; break; // Italy -> Milan
                            case 'ES': exchangeSuffix = '.MC'; break; // Spain -> Madrid
                            case 'CH': exchangeSuffix = '.SW'; break; // Switzerland -> Swiss
                            case 'CA': exchangeSuffix = '.TO'; break; // Canada -> Toronto
                            default: exchangeSuffix = '.US'; break;   // Default to US
                          }
                        }
                        ticker = `${symbol}${exchangeSuffix}`;
                      } else {
                        ticker = symbol;
                      }
                    }
                    
                    if (ticker) {
                      addTickerWithDate(ticker, productDate);
                    }
                  });
                }
              });
            }
          });

          const tickersArray = Array.from(uniqueTickers);

          for (const fullTicker of tickersArray) {
            try {
              // Use the specific earliest date for this ticker, or default
              let earliestDateForTicker = tickerDates.get(fullTicker);
              if (!earliestDateForTicker) {
                // Fallback to global earliest or default
                if (productDates.length > 0) {
                  earliestDateForTicker = new Date(Math.min(...productDates));
                } else {
                  earliestDateForTicker = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
                }
              }
              
              // Add buffer before the earliest date
              const bufferedDate = new Date(earliestDateForTicker);
              bufferedDate.setDate(bufferedDate.getDate() - 30);
              
              const defaultFromDate = fromDate ? new Date(fromDate) : bufferedDate;
              const result = await MarketDataHelpers.fetchAndCacheHistoricalData(
                fullTicker, 
                defaultFromDate, 
                toDate && toDate !== null && toDate !== undefined ? new Date(toDate) : null
              );
              results.push({ fullTicker, ...result });
            } catch (error) {
              results.push({ fullTicker, error: error.message, errorDetails: error.reason || error.error || 'Unknown error' });
            }
          }
        } else {
          // Refresh specific symbols - also check product dates for historical context
          
          // Get earliest product date for context
          const products = await ProductsCollection.find({}, { 
            fields: { tradeDate: 1, valueDate: 1 } 
          }).fetchAsync();
          
          const productDates = [];
          products.forEach(product => {
            if (product.tradeDate) {
              productDates.push(new Date(product.tradeDate));
            } else if (product.valueDate) {
              productDates.push(new Date(product.valueDate));
            }
          });
          
          let earliestDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
          if (productDates.length > 0) {
            earliestDate = new Date(Math.min(...productDates));
            earliestDate.setDate(earliestDate.getDate() - 30);          }
          
          for (const fullTicker of symbols) {
            try {
              const defaultFromDate = fromDate ? new Date(fromDate) : earliestDate;
              const result = await MarketDataHelpers.fetchAndCacheHistoricalData(
                fullTicker, 
                defaultFromDate, 
                toDate && toDate !== null && toDate !== undefined ? new Date(toDate) : null
              );
              results.push({ fullTicker, ...result });
            } catch (error) {
              results.push({ fullTicker, error: error.message });
            }
          }
        }

        const summary = results.reduce((acc, result) => {
          if (result.error) {
            acc.errors++;
          } else {
            acc.cached += result.cached || 0;
            acc.skipped += result.skipped || 0;
          }
          return acc;
        }, { cached: 0, skipped: 0, errors: 0 });

        
        return {
          success: true,
          summary,
          details: results
        };

      } catch (error) {
        throw new Meteor.Error('cache-refresh-failed', `Cache refresh failed: ${error.message}`);
      }
    },

    // Get cache statistics
    async 'marketData.getStats'() {
      return await MarketDataHelpers.getCacheStats();
    },

    // Get cached data for a specific stock
    async 'marketData.getCachedData'(fullTicker, fromDate = null, toDate = null, limit = 100) {
      check(fullTicker, String);
      check(fromDate, Match.Optional(String));
      check(toDate, Match.Optional(String));
      check(limit, Match.Optional(Number));

      const actualFromDate = fromDate ? new Date(fromDate) : null;
      const actualToDate = toDate ? new Date(toDate) : null;

      return await MarketDataHelpers.getCachedData(fullTicker, actualFromDate, actualToDate, limit);
    },

    // Clear cached data
    async 'marketData.clearCache'(fullTicker = null, sessionId = null) {
      check(fullTicker, Match.OneOf(String, null, undefined));
      check(sessionId, Match.OneOf(String, null, undefined));
      
      // Get current user with session-based authentication
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'Must be logged in to clear cache');
      }

      // Only allow admins to clear cache
      if (currentUser.role !== 'admin' && currentUser.role !== 'superadmin') {
        throw new Meteor.Error('access-denied', 'Only administrators can clear cache');
      }

      try {
        if (fullTicker) {
          // Clear cache for specific stock
          const result = await MarketDataCacheCollection.removeAsync({ fullTicker });
          return { cleared: result, fullTicker };
        } else {
          // Clear entire cache
          const result = await MarketDataCacheCollection.removeAsync({});
          return { cleared: result, fullTicker: 'ALL' };
        }
      } catch (error) {
        throw new Meteor.Error('cache-clear-failed', `Failed to clear cache: ${error.message}`);
      }
    }
  });
}