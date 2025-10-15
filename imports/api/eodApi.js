import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';

// EOD Historical Data API configuration
const EOD_API_TOKEN = Meteor.settings.private?.EOD_API_TOKEN || '5c265eab2c9066.19444326';
const EOD_BASE_URL = 'https://eodhistoricaldata.com/api';

// Popular indices data with common aliases
const POPULAR_INDICES = [
  // US Indices
  { Code: 'SPX', Name: 'S&P 500 Index', Exchange: 'INDX', Country: 'US', Currency: 'USD', Type: 'Index', ISIN: 'US78378X1072' },
  { Code: 'IXIC', Name: 'NASDAQ Composite Index', Exchange: 'INDX', Country: 'US', Currency: 'USD', Type: 'Index', ISIN: 'US6311011026' },
  { Code: 'DJI', Name: 'Dow Jones Industrial Average', Exchange: 'INDX', Country: 'US', Currency: 'USD', Type: 'Index', ISIN: 'US2605661048' },
  { Code: 'NDX', Name: 'NASDAQ 100 Index', Exchange: 'INDX', Country: 'US', Currency: 'USD', Type: 'Index', ISIN: 'US6311011026' },
  { Code: 'RUT', Name: 'Russell 2000 Index', Exchange: 'INDX', Country: 'US', Currency: 'USD', Type: 'Index', ISIN: 'US83162U1051' },
  { Code: 'VIX', Name: 'CBOE Volatility Index', Exchange: 'INDX', Country: 'US', Currency: 'USD', Type: 'Index', ISIN: 'US1276301060' },
  
  // European Indices
  { Code: 'FTSE', Name: 'FTSE 100 Index', Exchange: 'INDX', Country: 'UK', Currency: 'GBP', Type: 'Index', ISIN: 'GB0001383545' },
  { Code: 'DAX', Name: 'DAX Index', Exchange: 'INDX', Country: 'DE', Currency: 'EUR', Type: 'Index', ISIN: 'DE0008469008' },
  { Code: 'CAC', Name: 'CAC 40 Index', Exchange: 'INDX', Country: 'FR', Currency: 'EUR', Type: 'Index', ISIN: 'FR0003500008' },
  { Code: 'STOXX50E', Name: 'Euro Stoxx 50 Index', Exchange: 'INDX', Country: 'EU', Currency: 'EUR', Type: 'Index', ISIN: 'EU0009658145' },
  { Code: 'SX5E', Name: 'Euro Stoxx 50 Index', Exchange: 'INDX', Country: 'EU', Currency: 'EUR', Type: 'Index', ISIN: 'EU0009658145' }, // Common alias
  
  // Asian Indices
  { Code: 'N225', Name: 'Nikkei 225 Index', Exchange: 'INDX', Country: 'JP', Currency: 'JPY', Type: 'Index', ISIN: 'XC0009692440' },
  { Code: 'HSI', Name: 'Hang Seng Index', Exchange: 'INDX', Country: 'HK', Currency: 'HKD', Type: 'Index', ISIN: 'HK0000004322' },
  { Code: 'AXJO', Name: 'ASX 200 Index', Exchange: 'INDX', Country: 'AU', Currency: 'AUD', Type: 'Index', ISIN: 'AU000000XJO2' },
  
  // Additional popular indices
  { Code: 'FCHI', Name: 'CAC 40 Index', Exchange: 'INDX', Country: 'FR', Currency: 'EUR', Type: 'Index', ISIN: 'FR0003500008' }, // Alternative CAC symbol
  { Code: 'GDAXI', Name: 'DAX Index', Exchange: 'INDX', Country: 'DE', Currency: 'EUR', Type: 'Index', ISIN: 'DE0008469008' }, // Alternative DAX symbol
  { Code: 'UKX', Name: 'FTSE 100 Index', Exchange: 'INDX', Country: 'UK', Currency: 'GBP', Type: 'Index', ISIN: 'GB0001383545' }, // Alternative FTSE symbol
];

// EOD API Helper functions
export const EODApiHelpers = {
  // Search for securities by symbol/name with optimized API calls
  async searchSecurities(query, limit = 20) {
    if (!query || query.length < 2) {
      return [];
    }

    try {
      // First check if query matches any popular indices
      const indexMatches = POPULAR_INDICES.filter(index => 
        index.Code.toLowerCase().includes(query.toLowerCase()) ||
        index.Name.toLowerCase().includes(query.toLowerCase())
      );

      // Make multiple optimized API calls for specific asset types to exclude mutual funds
      const searchPromises = [];
      const assetTypes = ['stock', 'etf', 'index', 'commodity']; // Include commodities, exclude 'fund' to avoid mutual funds
      
      assetTypes.forEach(type => {
        const url = `${EOD_BASE_URL}/search/${encodeURIComponent(query)}`;
        const promise = HTTP.get(url, {
          params: {
            api_token: EOD_API_TOKEN,
            type: type, // Filter by specific asset type at API level
            limit: Math.ceil(limit / assetTypes.length), // Distribute limit across asset types
            fmt: 'json'
          }
        }).catch(err => {
          return { data: [] }; // Return empty data on error
        });
        searchPromises.push(promise);
      });

      // Wait for all API calls to complete
      const responses = await Promise.allSettled(searchPromises);
      let results = [];
      
      // Combine results from all asset type searches
      responses.forEach(response => {
        if (response.status === 'fulfilled' && response.value.data) {
          results = results.concat(response.value.data);
        }
      });

      // Combine with popular indices and remove duplicates
      const combined = [...indexMatches, ...results];
      const unique = combined.filter((item, index, arr) => 
        arr.findIndex(i => i.Code === item.Code && i.Exchange === item.Exchange) === index
      );

      // Sort results with prioritization:
      // 1. Indices first
      // 2. Currency priority (USD, EUR, GBP, JPY)
      // 3. Main exchanges (NYSE, NASDAQ, LSE, etc.) for stocks
      // 4. Other exchanges
      const prioritized = unique.sort((a, b) => {
        const aType = (a.Type || '').toLowerCase();
        const bType = (b.Type || '').toLowerCase();
        const aExchange = a.Exchange || '';
        const bExchange = b.Exchange || '';
        const aCurrency = a.Currency || '';
        const bCurrency = b.Currency || '';

        // Define currency priority order
        const currencyPriority = {
          'USD': 1,
          'EUR': 2,
          'GBP': 3,
          'JPY': 4
        };

        // Define main exchanges (major global exchanges)
        const mainExchanges = [
          'NYSE', 'NASDAQ', 'AMEX',  // US
          'LSE',                      // UK
          'TSE', 'TSX',              // Japan/Canada
          'XETRA', 'FWB',            // Germany
          'PA',                      // France (Euronext Paris)
          'AMS',                     // Netherlands (Euronext Amsterdam)
          'SWX',                     // Switzerland
          'HKG',                     // Hong Kong
          'ASX'                      // Australia
        ];

        // 1. Indices always come first
        if (aType.includes('index') && !bType.includes('index')) return -1;
        if (!aType.includes('index') && bType.includes('index')) return 1;

        // 2. Within same asset type, prioritize by currency (USD > EUR > GBP > JPY > others)
        const aCurrencyPriority = currencyPriority[aCurrency] || 999;
        const bCurrencyPriority = currencyPriority[bCurrency] || 999;
        
        if (aCurrencyPriority !== bCurrencyPriority) {
          return aCurrencyPriority - bCurrencyPriority;
        }

        // 3. Commodities come after currency prioritization (but still high priority)
        if (aType.includes('commodity') && !bType.includes('commodity') && !bType.includes('index')) return -1;
        if (!aType.includes('commodity') && bType.includes('commodity') && !aType.includes('index')) return 1;

        // 4. For stocks, prioritize main exchanges
        if (aType.includes('stock') || aType.includes('equity') || aType.includes('common')) {
          if (bType.includes('stock') || bType.includes('equity') || bType.includes('common')) {
            const aIsMain = mainExchanges.includes(aExchange);
            const bIsMain = mainExchanges.includes(bExchange);
            
            if (aIsMain && !bIsMain) return -1;
            if (!aIsMain && bIsMain) return 1;
            
            // Within main exchanges, sort alphabetically by exchange
            if (aIsMain && bIsMain) {
              return aExchange.localeCompare(bExchange);
            }
          }
        }

        // 5. ETFs after commodities and stocks from main exchanges
        if (aType.includes('etf') && !bType.includes('etf')) return 1;
        if (!aType.includes('etf') && bType.includes('etf')) return -1;

        // 6. Default alphabetical sort by symbol
        return (a.Code || '').localeCompare(b.Code || '');
      });

      return prioritized.slice(0, limit);
    } catch (error) {
      throw new Meteor.Error('eod-search-failed', 'Failed to search securities');
    }
  },

  // Get real-time price for a specific security
  async getRealTimePrice(symbol, exchange = null) {
    try {
      const ticker = exchange ? `${symbol}.${exchange}` : symbol;
      const url = `${EOD_BASE_URL}/real-time/${ticker}`;
      
      const response = await HTTP.get(url, {
        params: {
          api_token: EOD_API_TOKEN,
          fmt: 'json'
        }
      });
      
      // Process and enhance the response data
      if (response.data) {
        const data = response.data;
        
        // Get previous close from various possible fields
        const previousClose = data.previousClose || data.previous_close || data.prevClose || data.prev_close;
        const currentClose = data.close;
        
        // Calculate change manually if API returned 0 but we have different prices
        let calculatedChange = data.change;
        let calculatedChangePercent = data.change_p;
        
        if (currentClose && previousClose && (data.change === 0 || data.change === null || data.change === undefined)) {
          calculatedChange = currentClose - previousClose;
          if (previousClose > 0) {
            calculatedChangePercent = (calculatedChange / previousClose) * 100;
          }
        }
        
        // For European stocks with identical close/previousClose (likely stale data),
        // try to estimate change from intraday range
        if (calculatedChange === 0 && currentClose === previousClose && ticker.includes('.PA')) {
          const open = data.open;
          const high = data.high;
          const low = data.low;
          
          if (open && high && low && currentClose) {
            // If we have intraday data and the close is different from open,
            // use that as a proxy for change
            if (currentClose !== open) {
              calculatedChange = currentClose - open;
              if (open > 0) {
                calculatedChangePercent = (calculatedChange / open) * 100;
              }
            } else if (high !== low) {
              // If close = open but we have a range, estimate a small change
              // based on the day's volatility - assume close is closer to high if range > 1%
              const range = ((high - low) / low) * 100;
              if (range > 1) {
                // Estimate the stock moved positively (closer to high than low)
                calculatedChange = (high - currentClose) * 0.3; // Conservative estimate
                if (currentClose > 0) {
                  calculatedChangePercent = (calculatedChange / currentClose) * 100;
                }
              }
            }
          }
        }
        
        // Enhance the data with calculated values
        const enhancedData = {
          ...data,
          previousClose,
          change: calculatedChange,
          change_p: calculatedChangePercent
        };
        
        
        return enhancedData;
      }
      
      return response.data;
    } catch (error) {
      
      // Check if it's an API limit or auth error
      if (error.response && error.response.statusCode === 403) {
        throw new Meteor.Error('eod-auth-failed', 'API authentication failed or limit reached');
      } else if (error.response && error.response.statusCode === 404) {
        throw new Meteor.Error('eod-symbol-not-found', `Symbol ${symbol} not found`);
      }
      
      throw new Meteor.Error('eod-price-failed', `Failed to get real-time price: ${error.message}`);
    }
  },

  // Historical data cache (in-memory, resets on server restart)
  _historicalCache: new Map(),
  _cacheExpiry: 24 * 60 * 60 * 1000, // 24 hours in milliseconds

  // Get historical data for a security (range of dates)
  async getHistoricalData(symbol, exchange = null, fromDate, toDate = null) {
    try {
      const ticker = exchange ? `${symbol}.${exchange}` : symbol;
      
      // Format dates for API
      const formatDate = (date) => {
        if (!date) return null;
        return date.toISOString().split('T')[0];
      };
      
      const url = `${EOD_BASE_URL}/eod/${ticker}`;
      
      const params = {
        api_token: EOD_API_TOKEN,
        fmt: 'json',
        period: 'd',
        order: 'a' // Ascending order (oldest first)
      };

      if (fromDate) {
        params.from = formatDate(fromDate);
      }
      
      if (toDate) {
        params.to = formatDate(toDate);
      }


      const response = await HTTP.get(url, { params });
      
      const data = response.data;
      
      if (!data) {
        return [];
      }
      
      // Ensure data is array format
      const historicalData = Array.isArray(data) ? data : [data];
      
      
      return historicalData;
    } catch (error) {
      
      // Check for specific error types
      if (error.response) {
        
        if (error.response.statusCode === 403) {
          throw new Meteor.Error('eod-auth-failed', 'API authentication failed or limit reached');
        } else if (error.response.statusCode === 404) {
          throw new Meteor.Error('eod-symbol-not-found', `Symbol ${symbol}.${exchange} not found`);
        } else if (error.response.statusCode === 429) {
          throw new Meteor.Error('eod-rate-limit', 'API rate limit exceeded');
        }
      }
      
      throw new Meteor.Error('eod-historical-failed', `Failed to get historical data: ${error.message}`);
    }
  },

  // Get end-of-day price for a security with caching
  async getEndOfDayPrice(symbol, exchange = null, date = null) {
    try {
      const ticker = exchange ? `${symbol}.${exchange}` : symbol;
      
      // Create cache key - historical data for specific dates doesn't change
      const cacheKey = `${ticker}_${date || 'latest'}`;
      const now = Date.now();
      
      // Check cache first
      const cached = this._historicalCache.get(cacheKey);
      if (cached && (now - cached.timestamp) < this._cacheExpiry) {
        //        return cached.data;
      }
      
      const url = `${EOD_BASE_URL}/eod/${ticker}`;
      
      const params = {
        api_token: EOD_API_TOKEN,
        fmt: 'json',
        period: 'd',
        order: 'd'
      };

      if (date) {
        params.from = date;
        params.to = date;
      } else {
        // Get last trading day
        params.period = 'd';
        params.order = 'd';
      }

      const response = await HTTP.get(url, {
        params: params
      });

      const data = response.data;
      const result = Array.isArray(data) ? data[0] : data;
      
      // Cache the result
      this._historicalCache.set(cacheKey, {
        data: result,
        timestamp: now
      });
      
      // Clean up old cache entries periodically (keep last 1000 entries)
      if (this._historicalCache.size > 1000) {
        const entries = Array.from(this._historicalCache.entries());
        const sortedEntries = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        this._historicalCache.clear();
        sortedEntries.slice(0, 500).forEach(([key, value]) => {
          this._historicalCache.set(key, value);
        });
      }
      
      return result;
    } catch (error) {
      throw new Meteor.Error('eod-eod-failed', 'Failed to get end-of-day price');
    }
  },

  // Get supported exchanges
  async getExchanges() {
    try {
      const url = `${EOD_BASE_URL}/exchanges-list/`;
      const response = await HTTP.get(url, {
        params: {
          api_token: EOD_API_TOKEN,
          fmt: 'json'
        }
      });

      return response.data || [];
    } catch (error) {
      throw new Meteor.Error('eod-exchanges-failed', 'Failed to get exchanges');
    }
  },

  // Get asset type color coding
  getAssetTypeColor(type) {
    const normalizedType = (type || '').toLowerCase();
    
    if (normalizedType.includes('index')) {
      return { bg: '#e3f2fd', border: '#1976d2', text: '#1565c0' }; // Blue for indices
    } else if (normalizedType.includes('etf')) {
      return { bg: '#f3e5f5', border: '#7b1fa2', text: '#6a1b9a' }; // Purple for ETFs
    } else if (normalizedType.includes('stock') || normalizedType.includes('equity') || normalizedType.includes('common stock')) {
      return { bg: '#e8f5e8', border: '#388e3c', text: '#2e7d32' }; // Green for stocks
    } else if (normalizedType.includes('bond')) {
      return { bg: '#fff3e0', border: '#f57c00', text: '#ef6c00' }; // Orange for bonds
    } else if (normalizedType.includes('commodity')) {
      return { bg: '#fce4ec', border: '#c2185b', text: '#ad1457' }; // Pink for commodities
    } else if (normalizedType.includes('currency') || normalizedType.includes('forex')) {
      return { bg: '#e0f2f1', border: '#00695c', text: '#004d40' }; // Teal for currencies
    } else {
      return { bg: '#f5f5f5', border: '#757575', text: '#616161' }; // Gray for others
    }
  },

  // Format security display name
  formatSecurityDisplay(security) {
    const {
      Code: symbol,
      Name: name,
      Exchange: exchange,
      Country: country,
      Currency: currency,
      Type: type
    } = security;

    let displayName = name || symbol;
    if (displayName.length > 50) {
      displayName = displayName.substring(0, 47) + '...';
    }

    const exchangeInfo = exchange ? ` (${exchange})` : '';
    const currencyInfo = currency ? ` - ${currency}` : '';
    const countryInfo = country ? ` [${country}]` : '';
    const colors = this.getAssetTypeColor(type);

    return {
      primary: `${symbol}${exchangeInfo}`,
      secondary: displayName,
      details: `${type || 'Security'}${currencyInfo}${countryInfo}`,
      fullTicker: exchange ? `${symbol}.${exchange}` : symbol,
      symbol,
      exchange,
      currency,
      country,
      type,
      name,
      colors
    };
  },

  // Validate if a security ticker is valid
  async validateTicker(ticker) {
    try {
      const price = await this.getRealTimePrice(ticker);
      return price && price.code && price.code !== '404';
    } catch (error) {
      return false;
    }
  },

  // Get latest news for a specific security
  async getSecurityNews(symbol, exchange = null, limit = 2) {
    try {
      const ticker = exchange ? `${symbol}.${exchange}` : symbol;
      const url = `${EOD_BASE_URL}/news`;

      console.log(`[EOD News API] Fetching news for ticker: ${ticker} (symbol: ${symbol}, exchange: ${exchange})`);

      const response = await HTTP.get(url, {
        params: {
          api_token: EOD_API_TOKEN,
          s: ticker,
          limit: limit,
          fmt: 'json'
        }
      });

      console.log(`[EOD News API] Received ${response.data?.length || 0} news articles for ${ticker}`);

      const news = response.data || [];
      
      // Format news data for consistent structure
      return news.map(article => ({
        title: article.title,
        content: article.content,
        url: article.link,
        date: article.date,
        tags: article.tags || [],
        sentiment: article.sentiment || null,
        symbols: article.symbols || [ticker]
      }));
    } catch (error) {
      console.warn(`[EOD News API] Failed to fetch news for ${symbol}.${exchange}:`, error.message);
      if (error.response) {
        console.warn(`[EOD News API] Response status: ${error.response.statusCode}`);
        console.warn(`[EOD News API] Response data:`, error.response.data);
      }
      // Return empty array on error to prevent component crashes
      return [];
    }
  },

  // Get company logo with multiple fallback sources
  getCompanyLogo(symbol, exchange = null, companyName = '') {
    const cleanSymbol = symbol.replace(/\./g, '');
    const logoSources = [];
    
    // Primary source: EOD Historical Data logo API
    if (exchange) {
      logoSources.push(`https://eodhistoricaldata.com/img/logos/US/${cleanSymbol}.png`);
    }
    
    // Fallback sources with different formats and providers
    const logoToken = Meteor.settings.private?.LOGO_DEV_API_TOKEN || 'pk_X-1ZO13GSgeOoUrIuJ6GMQ';
    logoSources.push(
      // Financial modeling prep - most accurate for stock tickers
      `https://financialmodelingprep.com/image-stock/${cleanSymbol}.png`,
      // Alternative logo services
      `https://img.logo.dev/${cleanSymbol.toLowerCase()}.com?token=${logoToken}`
    );

    return {
      primary: logoSources[0],
      fallbacks: logoSources.slice(1),
      all: logoSources
    };
  }
};

// Server-side methods for EOD API
if (Meteor.isServer) {
  Meteor.methods({
    // Enhanced search method with optimized API calls
    async 'eod.searchSecurities'(query, limit = 20) {
      // Validate input parameters
      if (typeof query !== 'string' || query.length < 2) {
        return [];
      }
      if (typeof limit !== 'number' || limit < 1 || limit > 50) {
        limit = 20; // Default safe limit
      }
      
      return await EODApiHelpers.searchSecurities(query, limit);
    },

    async 'eod.getRealTimePrice'(symbol, exchange = null) {
      return await EODApiHelpers.getRealTimePrice(symbol, exchange);
    },

    async 'eod.getHistoricalData'(symbol, exchange = null, fromDate, toDate = null) {
      return await EODApiHelpers.getHistoricalData(symbol, exchange, fromDate, toDate);
    },

    async 'eod.getEndOfDayPrice'(symbol, exchange = null, date = null) {
      return await EODApiHelpers.getEndOfDayPrice(symbol, exchange, date);
    },

    async 'eod.getExchanges'() {
      return await EODApiHelpers.getExchanges();
    },

    async 'eod.validateTicker'(ticker) {
      return await EODApiHelpers.validateTicker(ticker);
    },

    async 'eod.getSecurityNews'(symbol, exchange = null, limit = 2) {
      return await EODApiHelpers.getSecurityNews(symbol, exchange, limit);
    },

    // Comprehensive stock details method - reduces API calls by combining multiple requests
    async 'eod.getStockDetails'(options) {
      const { 
        symbol, 
        exchange = null, 
        includeRealTime = true, 
        includeNews = false, 
        newsLimit = 5, 
        historicalDates = [] 
      } = options;
      
      try {
        const promises = [];
        const result = {
          symbol,
          exchange,
          timestamp: new Date()
        };
        
        // Add real-time data request
        if (includeRealTime) {
          promises.push(
            EODApiHelpers.getRealTimePrice(symbol, exchange)
              .then(data => ({ type: 'realTime', data }))
              .catch(error => ({ type: 'realTime', error: error.message }))
          );
        }
        
        // Add news request
        if (includeNews) {
          promises.push(
            EODApiHelpers.getSecurityNews(symbol, exchange, newsLimit)
              .then(data => ({ type: 'news', data }))
              .catch(error => ({ type: 'news', error: error.message }))
          );
        }
        
        // Add historical data requests
        historicalDates.forEach((dateRequest, index) => {
          promises.push(
            EODApiHelpers.getEndOfDayPrice(symbol, exchange, dateRequest.date)
              .then(data => ({ type: 'historical', subType: dateRequest.type, data }))
              .catch(error => ({ type: 'historical', subType: dateRequest.type, error: error.message }))
          );
        });
        
        // Execute all requests in parallel
        const responses = await Promise.allSettled(promises);
        
        // Process responses
        const historical = {};
        
        responses.forEach((response, index) => {
          if (response.status === 'fulfilled' && response.value.data) {
            const { type, subType, data } = response.value;
            
            switch (type) {
              case 'realTime':
                result.realTime = data;
                break;
              case 'news':
                result.news = data;
                break;
              case 'historical':
                historical[subType] = data;
                break;
            }
          }
        });
        
        if (Object.keys(historical).length > 0) {
          result.historical = historical;
        }
        
        // Add logo information
        result.logo = EODApiHelpers.getCompanyLogo(symbol, exchange, options.companyName || '');
        
        return result;
        
      } catch (error) {
        throw new Meteor.Error('eod-stock-details-failed', `Failed to get stock details: ${error.message}`);
      }
    },

    // Get multiple prices (for exchange rates and market data)
    async 'eod.getMultiplePrices'(symbols) {
      if (!Array.isArray(symbols) || symbols.length === 0) {
        return { success: false, error: 'Invalid symbols array' };
      }

      try {
        // For exchange rates, we can use real-time API
        const results = {};
        const promises = symbols.map(async (symbol) => {
          try {
            const price = await EODApiHelpers.getRealTimePrice(symbol);
            
            if (price && typeof price === 'object') {
              results[symbol] = {
                price: price.close || price.price || null,
                change: price.change || null,
                changePercent: price.change_p || null,
                close: price.close || price.price || null,
                open: price.open || null,
                high: price.high || null,
                low: price.low || null,
                volume: price.volume || null,
                timestamp: price.timestamp || price.gmtoffset || null
              };
            } else {
              results[symbol] = null;
            }
          } catch (error) {
            results[symbol] = null;
          }
        });

        await Promise.allSettled(promises);

        return {
          success: true,
          data: results,
          stats: {
            requested: symbols.length,
            fetched: Object.values(results).filter(r => r !== null).length,
            failed: Object.values(results).filter(r => r === null).length,
            cached: 0 // Not using cache for this method
          }
        };
      } catch (error) {
        return { 
          success: false, 
          error: error.message,
          data: {}
        };
      }
    }
  });
}