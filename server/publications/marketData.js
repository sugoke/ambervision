// Market Data Publications
// Handles all market data related publications

import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { ProductPricesCollection } from '/imports/api/productPrices';

// Publish market data cache (admin only)
Meteor.publish("marketDataCache", async function () {
  const user = await UsersCollection.findOneAsync(this.userId);
  if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
    return this.ready();
  }

  // Import here to avoid circular dependency
  const { MarketDataCacheCollection } = require('/imports/api/marketDataCache');
  return MarketDataCacheCollection.find({}, {
    sort: { date: -1 },
    limit: 1000 // Limit for performance
  });
});

// Publish market data for underlyings view (public - for all authenticated users)
Meteor.publish("underlyingsMarketData", function () {
  // Import here to avoid circular dependency
  const { MarketDataCacheCollection } = require('/imports/api/marketDataCache');

  // Return only the latest market data for each symbol
  return MarketDataCacheCollection.find({}, {
    sort: { timestamp: -1 },
    limit: 500 // Reasonable limit for performance
  });
});

// Publish ticker prices for MarketTicker component (public - for all users)
Meteor.publish("tickerPrices", function () {
  // Import here to avoid circular dependency
  const { TickerPriceCacheCollection } = require('/imports/api/tickerCache');

  // Return only valid, non-expired ticker prices
  return TickerPriceCacheCollection.find({
    price: { $gt: 0 },              // Only valid prices
    expiresAt: { $gt: new Date() }  // Not expired
  }, {
    fields: {
      symbol: 1,
      price: 1,
      change: 1,
      changePercent: 1,
      previousClose: 1,
      source: 1,
      timestamp: 1,
      lastUpdated: 1
    },
    sort: { symbol: 1 }
  });
});






