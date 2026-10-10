// Market Data Publications
// Market prices are reference data for any logged-in user; the raw cache is admin-only.

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { getSessionUser } from '../helpers/sessionAuth.js';
import { ADMIN_ROLES } from '../helpers/accessPolicy.js';

// Raw market data cache (admin only)
Meteor.publish("marketDataCache", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user || !ADMIN_ROLES.includes(user.role)) return this.ready();

  const { MarketDataCacheCollection } = require('/imports/api/marketDataCache');
  return MarketDataCacheCollection.find({}, { sort: { date: -1 }, limit: 1000 });
});

// Market data for the underlyings view
Meteor.publish("underlyingsMarketData", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const { MarketDataCacheCollection } = require('/imports/api/marketDataCache');
  return MarketDataCacheCollection.find({}, { sort: { timestamp: -1 }, limit: 500 });
});

// Ticker prices for the MarketTicker component
Meteor.publish("tickerPrices", async function (sessionId = null) {
  check(sessionId, Match.Maybe(String));
  const user = await getSessionUser(sessionId);
  if (!user) return this.ready();

  const { TickerPriceCacheCollection } = require('/imports/api/tickerCache');
  return TickerPriceCacheCollection.find({
    price: { $gt: 0 },
    expiresAt: { $gt: new Date() }
  }, {
    fields: {
      symbol: 1, price: 1, change: 1, changePercent: 1, previousClose: 1,
      source: 1, timestamp: 1, lastUpdated: 1
    },
    sort: { symbol: 1 }
  });
});
