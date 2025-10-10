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






