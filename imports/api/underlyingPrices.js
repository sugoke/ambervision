import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ProductsCollection } from './products.js';
import { MarketDataCacheCollection } from './marketDataCache.js';

export const UnderlyingPricesCollection = new Mongo.Collection('underlyingPrices');

// Server-side only code
if (Meteor.isServer) {
  // Create indexes for efficient querying
  UnderlyingPricesCollection.createIndex({ ticker: 1, date: 1 }, { unique: true });
  UnderlyingPricesCollection.createIndex({ ticker: 1 });
  UnderlyingPricesCollection.createIndex({ date: 1 });
  UnderlyingPricesCollection.createIndex({ lastUpdated: 1 });

  // Publications
  Meteor.publish('underlyingPrices', function(tickers, startDate, endDate) {
    check(tickers, [String]);
    check(startDate, Date);
    check(endDate, Date);

    return UnderlyingPricesCollection.find({
      ticker: { $in: tickers },
      date: { $gte: startDate, $lte: endDate }
    }, {
      sort: { ticker: 1, date: 1 }
    });
  });

  Meteor.publish('underlyingPricesForProduct', function(productId) {
    check(productId, String);
    
    const product = ProductsCollection.findOne(productId);
    if (!product || !product.underlyings) {
      return this.ready();
    }

    const tickers = product.underlyings.map(u => u.ticker).filter(Boolean);
    if (tickers.length === 0) {
      return this.ready();
    }

    const startDate = new Date(product.tradeDate);
    const endDate = product.maturityDate ? new Date(product.maturityDate) : new Date();

    return UnderlyingPricesCollection.find({
      ticker: { $in: tickers },
      date: { $gte: startDate, $lte: endDate }
    }, {
      sort: { ticker: 1, date: 1 }
    });
  });

  // Server methods for data management
  Meteor.methods({
    'underlyingPrices.insert': async function(priceData) {
      check(priceData, {
        ticker: String,
        date: Date,
        open: Number,
        high: Number,
        low: Number,
        close: Number,
        volume: Number,
        currency: String,
        exchange: String,
        source: String
      });

      const existingPrice = await UnderlyingPricesCollection.findOneAsync({
        ticker: priceData.ticker,
        date: priceData.date
      });

      if (existingPrice) {
        // Update existing record
        return UnderlyingPricesCollection.updateAsync(existingPrice._id, {
          $set: {
            ...priceData,
            lastUpdated: new Date()
          }
        });
      } else {
        // Insert new record
        return UnderlyingPricesCollection.insertAsync({
          ...priceData,
          lastUpdated: new Date()
        });
      }
    },

    'underlyingPrices.insertBatch': async function(pricesArray) {
      check(pricesArray, [Object]);

      const results = [];
      for (const priceData of pricesArray) {
        try {
          const result = await Meteor.callAsync('underlyingPrices.insert', priceData);
          results.push({ success: true, id: result });
        } catch (error) {
          results.push({ success: false, error: error.message, data: priceData });
        }
      }
      return results;
    },

    'underlyingPrices.getPrice': async function(ticker, date, priceType = 'close') {
      check(ticker, String);
      check(date, Date);
      check(priceType, String);


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
        
        // Look in MarketDataCacheCollection (populated by refresh button)
        const price = await MarketDataCacheCollection.findOneAsync({
          $or: [
            { symbol: tickerVariant.split('.')[0], fullTicker: tickerVariant },
            { fullTicker: tickerVariant }
          ],
          date: date
        });

        if (price) {
          return price[priceType] || price.close;
        }
      }

      return null;
    },

    'underlyingPrices.getPriceRange': async function(ticker, startDate, endDate) {
      check(ticker, String);
      check(startDate, Date);
      check(endDate, Date);


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
        
        // Look in MarketDataCacheCollection (populated by refresh button)
        const prices = await MarketDataCacheCollection.find({
          $or: [
            { symbol: tickerVariant.split('.')[0], fullTicker: tickerVariant },
            { fullTicker: tickerVariant }
          ],
          date: { $gte: startDate, $lte: endDate }
        }, {
          sort: { date: 1 }
        }).fetchAsync();

        if (prices && prices.length > 0) {
          // Convert to legacy format for compatibility
          return prices.map(price => ({
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

      return [];
    },

    'underlyingPrices.getMissingDates': async function(ticker, startDate, endDate) {
      check(ticker, String);
      check(startDate, Date);
      check(endDate, Date);

      // Get all existing dates for this ticker in the range
      const existingPrices = await UnderlyingPricesCollection.find({
        ticker,
        date: { $gte: startDate, $lte: endDate }
      }, {
        fields: { date: 1 },
        sort: { date: 1 }
      }).fetchAsync();

      // Ensure existingPrices is an array
      const pricesArray = Array.isArray(existingPrices) ? existingPrices : [];
      const existingDates = new Set(pricesArray.map(p => p.date.toISOString().split('T')[0]));
      
      // Generate all business days in the range
      const missingDates = [];
      const currentDate = new Date(startDate);
      
      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayOfWeek = currentDate.getDay();
        
        // Skip weekends (0 = Sunday, 6 = Saturday)
        if (dayOfWeek !== 0 && dayOfWeek !== 6 && !existingDates.has(dateStr)) {
          missingDates.push(new Date(currentDate));
        }
        
        currentDate.setDate(currentDate.getDate() + 1);
      }

      return missingDates;
    },

    'underlyingPrices.cleanup': function(daysToKeep = 365) {
      check(daysToKeep, Number);

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

      return UnderlyingPricesCollection.removeAsync({
        lastUpdated: { $lt: cutoffDate }
      });
    }
  });
}

// Schema definition for documentation and validation
export const UnderlyingPriceSchema = {
  ticker: String,           // EOD ticker format (e.g., "AAPL.US", "^GSPC")
  date: Date,              // Price date (market date, not fetch date)
  open: Number,            // Opening price
  high: Number,            // High price
  low: Number,             // Low price
  close: Number,           // Closing price (adjusted for splits/dividends)
  volume: Number,          // Trading volume
  currency: String,        // Price currency (USD, EUR, etc.)
  exchange: String,        // Exchange code (US, XETRA, LSE, etc.)
  source: String,          // Data source ('eod', 'manual', etc.)
  lastUpdated: Date        // When this record was last updated
};