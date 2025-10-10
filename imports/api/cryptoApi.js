import { HTTP } from 'meteor/http';

// Free crypto API helper for real-time prices
export const CryptoApiHelper = {
  // Free API endpoints for crypto prices
  APIS: {
    // CoinGecko API (free tier: 10-30 calls/minute)
    coingecko: {
      baseUrl: 'https://api.coingecko.com/api/v3',
      getPrice: (ids) => `/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true`,
      rateLimit: 3000 // 3 seconds between calls
    },
    // Binance public API (no key needed)
    binance: {
      baseUrl: 'https://api.binance.com/api/v3',
      ticker24hr: (symbol) => `/ticker/24hr?symbol=${symbol}`,
      rateLimit: 100 // 100ms between calls
    },
    // Coinbase public API
    coinbase: {
      baseUrl: 'https://api.coinbase.com/v2',
      spotPrice: (currencyPair) => `/exchange-rates?currency=${currencyPair}`,
      rateLimit: 1000 // 1 second between calls
    }
  },

  // Map EOD crypto symbols to free API symbols
  symbolMapping: {
    'BTC-USD.CC': { 
      coingecko: 'bitcoin',
      binance: 'BTCUSDT',
      coinbase: 'BTC'
    },
    'ETH-USD.CC': {
      coingecko: 'ethereum',
      binance: 'ETHUSDT',
      coinbase: 'ETH'
    }
  },

  // Get crypto price from CoinGecko
  async getFromCoinGecko(eodSymbol) {
    try {
      const mapping = this.symbolMapping[eodSymbol];
      if (!mapping || !mapping.coingecko) {
        // console.log(`CryptoApi: No CoinGecko mapping for ${eodSymbol}`);
        return null;
      }

      const url = `${this.APIS.coingecko.baseUrl}${this.APIS.coingecko.getPrice(mapping.coingecko)}`;
      // console.log(`CryptoApi: Fetching from CoinGecko for ${eodSymbol}`);

      const response = await HTTP.get(url);
      
      if (response.data && response.data[mapping.coingecko]) {
        const data = response.data[mapping.coingecko];
        const price = data.usd;
        const changePercent = data.usd_24h_change || 0;
        
        // Calculate change amount from percentage
        const previousPrice = price / (1 + changePercent / 100);
        const change = price - previousPrice;

        return {
          price: price,
          change: change,
          changePercent: changePercent,
          previousClose: previousPrice,
          volume: 0, // CoinGecko doesn't provide volume in this endpoint
          timestamp: new Date(data.last_updated_at * 1000),
          source: 'coingecko'
        };
      }

      return null;
    } catch (error) {
      console.error(`CryptoApi: CoinGecko error for ${eodSymbol}:`, error);
      return null;
    }
  },

  // Get crypto price from Binance
  async getFromBinance(eodSymbol) {
    try {
      const mapping = this.symbolMapping[eodSymbol];
      if (!mapping || !mapping.binance) {
        // console.log(`CryptoApi: No Binance mapping for ${eodSymbol}`);
        return null;
      }

      const url = `${this.APIS.binance.baseUrl}${this.APIS.binance.ticker24hr(mapping.binance)}`;
      // console.log(`CryptoApi: Fetching from Binance for ${eodSymbol}`);

      const response = await HTTP.get(url);
      
      if (response.data) {
        const data = response.data;
        const price = parseFloat(data.lastPrice);
        const change = parseFloat(data.priceChange);
        const changePercent = parseFloat(data.priceChangePercent);
        const volume = parseFloat(data.volume);
        const previousClose = parseFloat(data.prevClosePrice);

        return {
          price: price,
          change: change,
          changePercent: changePercent,
          previousClose: previousClose,
          volume: volume,
          timestamp: new Date(),
          source: 'binance'
        };
      }

      return null;
    } catch (error) {
      console.error(`CryptoApi: Binance error for ${eodSymbol}:`, error);
      return null;
    }
  },

  // Get crypto price with fallback through multiple APIs
  async getCryptoPrice(eodSymbol) {
    // console.log(`CryptoApi: Getting price for ${eodSymbol}`);

    // Try Binance first (fastest, most reliable)
    try {
      const binanceData = await this.getFromBinance(eodSymbol);
      if (binanceData) {
        // console.log(`CryptoApi: Successfully got ${eodSymbol} from Binance`);
        return binanceData;
      }
    } catch (error) {
      // console.log(`CryptoApi: Binance failed for ${eodSymbol}, trying CoinGecko`);
    }

    // Fallback to CoinGecko
    try {
      const coingeckoData = await this.getFromCoinGecko(eodSymbol);
      if (coingeckoData) {
        // console.log(`CryptoApi: Successfully got ${eodSymbol} from CoinGecko`);
        return coingeckoData;
      }
    } catch (error) {
      // console.log(`CryptoApi: CoinGecko also failed for ${eodSymbol}`);
    }

    // console.log(`CryptoApi: All APIs failed for ${eodSymbol}`);
    return null;
  },

  // Check if symbol is a crypto that we can fetch from free APIs
  isSupportedCrypto(eodSymbol) {
    return this.symbolMapping.hasOwnProperty(eodSymbol);
  }
};