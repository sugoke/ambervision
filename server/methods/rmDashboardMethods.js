import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';
import { HTTP } from 'meteor/http';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { ProductsCollection } from '../../imports/api/products.js';
import { AllocationsCollection } from '../../imports/api/allocations.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { AccountProfilesCollection, aggregateToFourCategories } from '../../imports/api/accountProfiles.js';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { TickerPriceCacheCollection } from '../../imports/api/tickerCache.js';
import { NotificationsCollection } from '../../imports/api/notifications.js';
import { MarketDataCacheCollection } from '../../imports/api/marketDataCache.js';
import { SecuritiesMetadataCollection } from '../../imports/api/securitiesMetadata.js';
import { CurrencyRateCacheCollection, CurrencyCache } from '../../imports/api/currencyCache.js';
import { calculateCashForHoldings } from '../../imports/api/helpers/cashCalculator.js';
import { INVESTMENT_QUOTES } from '../quotesData.js';

// Database collections for quotes system
const DailyQuoteCacheCollection = new Mongo.Collection('dailyQuoteCache');
const QuotesCollection = new Mongo.Collection('quotes');

// Seed the quotes collection on server startup (if empty)
Meteor.startup(async () => {
  const quoteCount = await QuotesCollection.find().countAsync();
  if (quoteCount === 0) {
    console.log('[Quotes] Seeding quotes collection with', INVESTMENT_QUOTES.length, 'quotes...');
    for (const quote of INVESTMENT_QUOTES) {
      await QuotesCollection.insertAsync(quote);
    }
    console.log('[Quotes] Seeding complete.');
  } else {
    console.log('[Quotes] Collection already has', quoteCount, 'quotes.');
  }
});

/**
 * Helper function to validate session and get current user
 */
async function validateRMSession(sessionId) {
  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const currentUser = await UsersCollection.findOneAsync(session.userId);

  if (!currentUser) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  // Allow both RM and Admin roles to access RM dashboard
  if (currentUser.role !== USER_ROLES.RELATIONSHIP_MANAGER &&
      currentUser.role !== USER_ROLES.ADMIN &&
      currentUser.role !== USER_ROLES.SUPERADMIN) {
    throw new Meteor.Error('not-authorized', 'Access restricted to relationship managers');
  }

  return currentUser;
}

/**
 * Helper function to get RM's assigned clients
 */
async function getAssignedClients(currentUser) {
  // Admin/Superadmin sees all clients
  if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
    return await UsersCollection.find({ role: USER_ROLES.CLIENT }).fetchAsync();
  }

  // RM sees only assigned clients
  return await UsersCollection.find({
    role: USER_ROLES.CLIENT,
    relationshipManagerId: currentUser._id
  }).fetchAsync();
}

/**
 * Build a map of currency rates from the cache collection
 */
function buildRatesMap(currencyRates) {
  const map = new Map();
  currencyRates.forEach(r => {
    if (r.rate) {
      map.set(r.pair, r.rate);
    }
  });
  return map;
}

/**
 * Convert amount from any currency to EUR
 * Uses USD as intermediate if needed
 */
function convertToEUR(amount, fromCurrency, ratesMap) {
  if (!amount) return 0;
  if (fromCurrency === 'EUR') return amount;

  // Try direct EUR pair first (e.g., EURILS.FOREX)
  const directPair = `EUR${fromCurrency}.FOREX`;
  if (ratesMap.has(directPair)) {
    // EUR/XXX rate means 1 EUR = rate XXX, so EUR = amount / rate
    return amount / ratesMap.get(directPair);
  }

  // Try inverse pair (e.g., XXXEUR.FOREX) - less common
  const inversePair = `${fromCurrency}EUR.FOREX`;
  if (ratesMap.has(inversePair)) {
    return amount * ratesMap.get(inversePair);
  }

  // Convert via USD as intermediate
  let amountUSD;
  if (fromCurrency === 'USD') {
    amountUSD = amount;
  } else {
    // Try XXX/USD pair (e.g., GBPUSD.FOREX)
    const toUsdPair = `${fromCurrency}USD.FOREX`;
    if (ratesMap.has(toUsdPair)) {
      amountUSD = amount * ratesMap.get(toUsdPair);
    } else {
      // Try inverse USD/XXX pair (e.g., USDCHF.FOREX)
      const fromUsdPair = `USD${fromCurrency}.FOREX`;
      if (ratesMap.has(fromUsdPair)) {
        amountUSD = amount / ratesMap.get(fromUsdPair);
      } else {
        // Unknown currency - return as-is with warning
        console.warn(`[CashMonitoring] No FX rate for ${fromCurrency}, using amount as-is`);
        return amount;
      }
    }
  }

  // Convert USD to EUR using EURUSD rate
  const eurUsdRate = ratesMap.get('EURUSD.FOREX');
  if (!eurUsdRate) {
    console.warn('[CashMonitoring] No EURUSD rate available');
    return amountUSD;
  }

  // EURUSD = 1 EUR in USD, so EUR = USD / rate
  return amountUSD / eurUsdRate;
}

Meteor.methods({
  /**
   * Get alerts for RM Dashboard
   * Includes: barrier breaches, barrier warnings, profile breaches, unknown products
   */
  async 'rmDashboard.getAlerts'(sessionId) {
    check(sessionId, String);

    const currentUser = await validateRMSession(sessionId);
    const clients = await getAssignedClients(currentUser);
    const clientIds = clients.map(c => c._id);

    if (clientIds.length === 0) {
      return [];
    }

    const alerts = [];

    try {
      // 1. Get all allocations for clients
      const allocations = await AllocationsCollection.find({
        clientId: { $in: clientIds },
        status: 'active'
      }).fetchAsync();

      const productIds = [...new Set(allocations.map(a => a.productId))];

      // 2. Get all products (needed for profile breaches later)
      const products = await ProductsCollection.find({
        _id: { $in: productIds }
      }).fetchAsync();

      // 3. Get barrier alerts from persisted notifications (created by cron jobs)
      // These have the actual createdAt timestamp from when the breach was first detected
      const barrierNotifications = await NotificationsCollection.find({
        eventType: { $in: ['barrier_breached', 'barrier_near'] },
        productId: { $in: productIds },
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
      }, {
        sort: { createdAt: -1 }
      }).fetchAsync();

      // Map notifications to alert format
      for (const notification of barrierNotifications) {
        alerts.push({
          type: notification.eventType === 'barrier_breached' ? 'barrier_breach' : 'barrier_warning',
          severity: notification.eventType === 'barrier_breached' ? 'critical' : 'warning',
          productId: notification.productId,
          productTitle: notification.productName,
          message: notification.summary || `Barrier alert for ${notification.productName}`,
          createdAt: notification.createdAt // Real timestamp from when breach was first detected
        });
      }

      // 4. Check investor profile breaches
      for (const client of clients) {
        // Get latest portfolio snapshot
        const snapshot = await PortfolioSnapshotsCollection.findOneAsync(
          { userId: client._id },
          { sort: { snapshotDate: -1 } }
        );

        if (!snapshot?.assetClassBreakdown || !snapshot.totalAccountValue) continue;

        // Get account profile limits
        const profile = await AccountProfilesCollection.findOneAsync({ userId: client._id });
        if (!profile) continue;

        // Aggregate to 4 categories
        const breakdown = aggregateToFourCategories(snapshot.assetClassBreakdown, snapshot.totalAccountValue);

        // Check each limit
        const clientName = `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || client.email;

        if (profile.maxCash && breakdown.cash > profile.maxCash) {
          alerts.push({
            type: 'profile_breach',
            severity: 'warning',
            clientId: client._id,
            clientName,
            category: 'Cash',
            limit: profile.maxCash,
            actual: breakdown.cash,
            message: `${clientName}: Cash at ${breakdown.cash.toFixed(1)}% (limit: ${profile.maxCash}%)`,
            createdAt: new Date()
          });
        }

        if (profile.maxBonds && breakdown.bonds > profile.maxBonds) {
          alerts.push({
            type: 'profile_breach',
            severity: 'warning',
            clientId: client._id,
            clientName,
            category: 'Bonds',
            limit: profile.maxBonds,
            actual: breakdown.bonds,
            message: `${clientName}: Bonds at ${breakdown.bonds.toFixed(1)}% (limit: ${profile.maxBonds}%)`,
            createdAt: new Date()
          });
        }

        if (profile.maxEquities && breakdown.equities > profile.maxEquities) {
          alerts.push({
            type: 'profile_breach',
            severity: 'warning',
            clientId: client._id,
            clientName,
            category: 'Equities',
            limit: profile.maxEquities,
            actual: breakdown.equities,
            message: `${clientName}: Equities at ${breakdown.equities.toFixed(1)}% (limit: ${profile.maxEquities}%)`,
            createdAt: new Date()
          });
        }

        if (profile.maxAlternative && breakdown.alternative > profile.maxAlternative) {
          alerts.push({
            type: 'profile_breach',
            severity: 'warning',
            clientId: client._id,
            clientName,
            category: 'Alternative',
            limit: profile.maxAlternative,
            actual: breakdown.alternative,
            message: `${clientName}: Alternative at ${breakdown.alternative.toFixed(1)}% (limit: ${profile.maxAlternative}%)`,
            createdAt: new Date()
          });
        }
      }

      // 6. Count unknown/unlinked structured products
      const unknownProducts = await PMSHoldingsCollection.find({
        userId: { $in: clientIds },
        isLatest: true,
        linkedProductId: { $exists: false },
        assetClass: { $in: ['structured_product', 'Structured Products'] }
      }).countAsync();

      if (unknownProducts > 0) {
        alerts.push({
          type: 'unknown_products',
          severity: 'info',
          count: unknownProducts,
          message: `${unknownProducts} unlinked structured product${unknownProducts > 1 ? 's' : ''}`,
          createdAt: new Date()
        });
      }

      // 7. Get unread notifications count
      const unreadCount = await NotificationsCollection.find({
        readBy: { $ne: currentUser._id },
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
      }).countAsync();

      if (unreadCount > 0) {
        alerts.push({
          type: 'unread_notifications',
          severity: 'info',
          count: unreadCount,
          message: `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`,
          createdAt: new Date()
        });
      }

    } catch (error) {
      console.error('[RM Dashboard] Error getting alerts:', error);
    }

    // Sort: critical first, then warning, then info
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return alerts;
  },

  /**
   * Get portfolio summary for RM Dashboard
   */
  async 'rmDashboard.getPortfolioSummary'(sessionId) {
    check(sessionId, String);

    const currentUser = await validateRMSession(sessionId);
    const clients = await getAssignedClients(currentUser);
    const clientIds = clients.map(c => c._id);

    try {
      // For admin/superadmin, get ALL holdings; for RM get only their clients' holdings
      let totalAUM = 0;

      if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
        // Admin sees all holdings - sum market value from latest PMSHoldings
        const allHoldings = await PMSHoldingsCollection.find({
          isLatest: true,
          marketValue: { $exists: true, $gt: 0 }
        }).fetchAsync();

        totalAUM = allHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
      } else if (clientIds.length > 0) {
        // RM sees only their clients' holdings
        const clientHoldings = await PMSHoldingsCollection.find({
          userId: { $in: clientIds },
          isLatest: true,
          marketValue: { $exists: true, $gt: 0 }
        }).fetchAsync();

        totalAUM = clientHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
      }

      // Get product counts by status
      let products = [];
      if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
        // Admin sees all products
        products = await ProductsCollection.find({}).fetchAsync();
      } else if (clientIds.length > 0) {
        const allocations = await AllocationsCollection.find({
          clientId: { $in: clientIds }
        }).fetchAsync();
        const productIds = [...new Set(allocations.map(a => a.productId))];
        products = await ProductsCollection.find({
          _id: { $in: productIds }
        }).fetchAsync();
      }

      const statusCounts = {
        live: 0,
        autocalled: 0,
        matured: 0
      };

      products.forEach(p => {
        const status = p.productStatus || 'live';
        if (status === 'live') statusCounts.live++;
        else if (status === 'autocalled') statusCounts.autocalled++;
        else if (status === 'matured') statusCounts.matured++;
      });

      // Client count: for admin all clients, for RM their assigned clients
      let clientCount = clients.length;
      if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
        clientCount = await UsersCollection.find({ role: USER_ROLES.CLIENT }).countAsync();
      }

      return {
        totalAUM,
        clientCount,
        liveProducts: statusCounts.live,
        autocalledProducts: statusCounts.autocalled,
        maturedProducts: statusCounts.matured
      };

    } catch (error) {
      console.error('[RM Dashboard] Error getting portfolio summary:', error);
      return {
        totalAUM: 0,
        clientCount: clients.length,
        liveProducts: 0,
        autocalledProducts: 0,
        maturedProducts: 0
      };
    }
  },

  /**
   * Get birthdays for RM Dashboard
   * Returns next upcoming birthdays (clients + family members)
   */
  async 'rmDashboard.getBirthdays'(sessionId, limit = 5) {
    check(sessionId, String);
    check(limit, Number);

    const currentUser = await validateRMSession(sessionId);
    const clients = await getAssignedClients(currentUser);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const birthdays = [];

    // Helper to get next occurrence of a birthday
    const getNextBirthday = (birthday) => {
      const bday = new Date(birthday);
      let nextBday = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());

      // If birthday already passed this year, use next year
      if (nextBday < today) {
        nextBday = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
      }
      return nextBday;
    };

    // Helper to format days until birthday
    const formatDaysUntil = (date) => {
      const diffTime = date - today;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 0) return 'Today';
      if (diffDays === 1) return 'Tomorrow';
      if (diffDays <= 7) return `${diffDays} days`;
      if (diffDays <= 30) return `${Math.ceil(diffDays / 7)} weeks`;
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };

    clients.forEach(client => {
      // Check client birthday
      if (client.profile?.birthday) {
        const nextBday = getNextBirthday(client.profile.birthday);
        const isToday = nextBday.toDateString() === today.toDateString();

        birthdays.push({
          name: `${client.profile.firstName || ''} ${client.profile.lastName || ''}`.trim() || client.email,
          date: nextBday,
          dateFormatted: nextBday.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
          }),
          daysUntil: formatDaysUntil(nextBday),
          isClient: true,
          isToday,
          clientId: client._id
        });
      }

      // Check family member birthdays
      (client.profile?.familyMembers || []).forEach(member => {
        if (member.birthday) {
          const nextBday = getNextBirthday(member.birthday);
          const isToday = nextBday.toDateString() === today.toDateString();

          birthdays.push({
            name: member.name,
            relationship: member.relationship,
            clientName: `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim(),
            date: nextBday,
            dateFormatted: nextBday.toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric'
            }),
            daysUntil: formatDaysUntil(nextBday),
            isClient: false,
            isToday,
            clientId: client._id
          });
        }
      });
    });

    // Sort by date (soonest first)
    birthdays.sort((a, b) => a.date - b.date);

    return birthdays.slice(0, limit);
  },

  /**
   * Get watchlist for RM Dashboard
   * Auto-generated from unique underlyings across client products
   */
  async 'rmDashboard.getWatchlist'(sessionId) {
    check(sessionId, String);

    const currentUser = await validateRMSession(sessionId);
    const clients = await getAssignedClients(currentUser);
    const clientIds = clients.map(c => c._id);

    if (clientIds.length === 0) {
      return [];
    }

    try {
      // Get all allocations for clients
      const allocations = await AllocationsCollection.find({
        clientId: { $in: clientIds },
        status: 'active'
      }).fetchAsync();

      const productIds = [...new Set(allocations.map(a => a.productId))];

      // Get all products
      const products = await ProductsCollection.find({
        _id: { $in: productIds },
        productStatus: { $ne: 'matured' }
      }).fetchAsync();

      // Extract unique underlyings
      const underlyingMap = new Map();
      products.forEach(p => {
        (p.underlyings || []).forEach(u => {
          const ticker = u.securityData?.ticker || `${u.ticker}.US`;
          if (!underlyingMap.has(ticker)) {
            underlyingMap.set(ticker, {
              ticker: u.ticker,
              fullTicker: ticker,
              name: u.name || u.ticker
            });
          }
        });
      });

      // Get prices from cache
      const tickers = Array.from(underlyingMap.keys());
      const prices = await MarketDataCacheCollection.find({
        fullTicker: { $in: tickers }
      }).fetchAsync();

      const watchlist = [];
      prices.forEach(p => {
        const underlying = underlyingMap.get(p.fullTicker);
        if (!underlying) return;

        const currentPrice = p.price?.close || p.close ||
          (p.history && p.history.length > 0 ? p.history[p.history.length - 1].close : null);

        const previousClose = p.price?.previousClose ||
          (p.history && p.history.length > 1 ? p.history[p.history.length - 2].close : currentPrice);

        const changePercent = previousClose && currentPrice ?
          ((currentPrice - previousClose) / previousClose) * 100 : 0;

        watchlist.push({
          symbol: underlying.ticker,
          fullTicker: p.fullTicker,
          name: underlying.name,
          price: currentPrice,
          changePercent,
          lastUpdated: p.price?.date || p.lastUpdated
        });
      });

      // Sort by absolute change (most volatile first)
      watchlist.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

      return watchlist.slice(0, 10); // Return top 10

    } catch (error) {
      console.error('[RM Dashboard] Error getting watchlist:', error);
      return [];
    }
  },

  /**
   * Get upcoming events for RM Dashboard
   * Returns next N observations across all products
   */
  async 'rmDashboard.getUpcomingEvents'(sessionId, limit = 2) {
    check(sessionId, String);
    check(limit, Number);

    const currentUser = await validateRMSession(sessionId);
    const clients = await getAssignedClients(currentUser);
    const clientIds = clients.map(c => c._id);

    if (clientIds.length === 0) {
      return [];
    }

    try {
      // Get all allocations for clients
      const allocations = await AllocationsCollection.find({
        clientId: { $in: clientIds },
        status: 'active'
      }).fetchAsync();

      const productIds = [...new Set(allocations.map(a => a.productId))];

      // Get all live products with observation schedules
      const products = await ProductsCollection.find({
        _id: { $in: productIds },
        productStatus: { $nin: ['matured', 'autocalled'] },
        observationSchedule: { $exists: true, $ne: [] }
      }).fetchAsync();

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const events = [];

      products.forEach(product => {
        (product.observationSchedule || []).forEach((obs, idx) => {
          const obsDate = new Date(obs.observationDate || obs.date);
          if (obsDate >= today) {
            const daysLeft = Math.ceil((obsDate - today) / (1000 * 60 * 60 * 24));
            const isFinal = idx === (product.observationSchedule.length - 1);

            events.push({
              productId: product._id,
              productTitle: product.title || product.productName,
              observationDate: obsDate,
              observationDateFormatted: obsDate.toLocaleDateString('en-GB', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
              }),
              daysLeft,
              daysLeftText: daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `${daysLeft} days`,
              daysLeftColor: daysLeft <= 7 ? 'urgent' : daysLeft <= 30 ? 'soon' : 'normal',
              isFinal,
              isCallable: obs.isCallable || false,
              eventType: isFinal ? 'Final Observation' : (obs.isCallable ? 'Autocall & Coupon' : 'Coupon Only')
            });
          }
        });
      });

      // Sort by date
      events.sort((a, b) => a.observationDate - b.observationDate);

      return events.slice(0, limit);

    } catch (error) {
      console.error('[RM Dashboard] Error getting upcoming events:', error);
      return [];
    }
  },

  /**
   * Get recent activity for RM Dashboard
   */
  async 'rmDashboard.getRecentActivity'(sessionId, limit = 5) {
    check(sessionId, String);
    check(limit, Number);

    const currentUser = await validateRMSession(sessionId);

    try {
      const notifications = await NotificationsCollection.find(
        {},
        {
          sort: { createdAt: -1 },
          limit
        }
      ).fetchAsync();

      return notifications.map(n => ({
        _id: n._id,
        type: n.eventType || n.type,
        // Handle both user-focused notifications (have title) and product-focused notifications (have productName/summary)
        title: n.title || n.productName || n.summary?.split('\n')[0] || 'Notification',
        message: n.message || n.body || n.summary,
        productId: n.productId,
        productTitle: n.productTitle || n.productName,
        createdAt: n.createdAt,
        isRead: n.readBy?.includes(currentUser._id)
      }));

    } catch (error) {
      console.error('[RM Dashboard] Error getting recent activity:', error);
      return [];
    }
  },

  /**
   * Get daily quote - randomly selects from 200 curated quotes
   * Same quote shown to all users for 24 hours (cached in database)
   */
  async 'rmDashboard.getDailyQuote'(sessionId) {
    check(sessionId, String);

    // Validate session (any logged-in user can get the quote)
    const session = await SessionsCollection.findOneAsync({
      sessionId,
      isActive: true
    });

    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid session');
    }

    // Get today's date string (for cache key)
    const today = new Date().toISOString().split('T')[0];

    // Check database cache first (same quote for all users for 24h)
    const cachedQuote = await DailyQuoteCacheCollection.findOneAsync({ date: today });
    if (cachedQuote && cachedQuote.quote) {
      return {
        quote: cachedQuote.quote,
        author: cachedQuote.author
      };
    }

    // Select a random quote from the collection
    const quoteCount = await QuotesCollection.find().countAsync();
    if (quoteCount === 0) {
      // Fallback if collection is empty
      return {
        quote: "The best investment you can make is in yourself.",
        author: "Warren Buffett"
      };
    }

    // Use MongoDB aggregation for efficient random selection
    const randomQuotes = await QuotesCollection.rawCollection()
      .aggregate([{ $sample: { size: 1 } }])
      .toArray();

    const selectedQuote = randomQuotes[0] || {
      quote: "Price is what you pay. Value is what you get.",
      author: "Warren Buffett"
    };

    // Cache the selected quote for today (all users see the same quote)
    await DailyQuoteCacheCollection.upsertAsync(
      { date: today },
      {
        $set: {
          date: today,
          quote: selectedQuote.quote,
          author: selectedQuote.author,
          selectedAt: new Date()
        }
      }
    );

    // Clean up old cached quotes (keep only last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    await DailyQuoteCacheCollection.removeAsync({
      selectedAt: { $lt: sevenDaysAgo }
    });

    console.log('[Quotes] Selected new daily quote:', selectedQuote.author);

    return {
      quote: selectedQuote.quote,
      author: selectedQuote.author
    };
  },

  /**
   * Clear the daily quote cache to force a new random selection
   * Admin/Superadmin only
   */
  async 'rmDashboard.clearQuoteCache'(sessionId) {
    check(sessionId, String);

    // Validate admin/superadmin session
    const currentUser = await validateRMSession(sessionId);
    if (currentUser.role !== USER_ROLES.ADMIN &&
        currentUser.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Admin access required');
    }

    // Clear all cached quotes
    const result = await DailyQuoteCacheCollection.removeAsync({});
    console.log('[RM Dashboard] Quote cache cleared by', currentUser.email, '- removed:', result);
    return { cleared: result };
  },

  /**
   * Get breach status for all clients
   * Returns a map of clientId -> true (has breach) / false (no breach)
   * Used by ClientsSection to show warning indicators
   */
  async 'rmDashboard.getClientBreachStatus'(sessionId) {
    check(sessionId, String);

    const currentUser = await validateRMSession(sessionId);
    const clients = await getAssignedClients(currentUser);

    const breachStatus = {};

    // Get all banks for name matching
    const allBanks = await BanksCollection.find({}).fetchAsync();
    const bankMap = {};
    allBanks.forEach(b => { bankMap[b._id] = b; });

    for (const client of clients) {
      breachStatus[client._id] = false;

      // Get client's bank accounts
      const bankAccounts = await BankAccountsCollection.find({ userId: client._id }).fetchAsync();

      for (const account of bankAccounts) {
        // Get account profile (limits)
        const profile = await AccountProfilesCollection.findOneAsync({ bankAccountId: account._id });
        if (!profile) continue;

        // Get matching portfolio snapshot
        const bank = bankMap[account.bankId];
        const bankName = bank?.name?.toLowerCase() || '';

        // Find matching snapshot by account number and bank
        const snapshot = await PortfolioSnapshotsCollection.findOneAsync({
          $or: [
            { portfolioCode: account.accountNumber },
            { accountNumber: account.accountNumber }
          ]
        }, { sort: { snapshotDate: -1 } });

        if (!snapshot?.assetClassBreakdown || !snapshot.totalAccountValue) continue;

        // Aggregate to 4 categories
        const breakdown = aggregateToFourCategories(snapshot.assetClassBreakdown, snapshot.totalAccountValue);

        // Check for any breach
        if ((profile.maxCash && breakdown.cash > profile.maxCash) ||
            (profile.maxBonds && breakdown.bonds > profile.maxBonds) ||
            (profile.maxEquities && breakdown.equities > profile.maxEquities) ||
            (profile.maxAlternative && breakdown.alternative > profile.maxAlternative)) {
          breachStatus[client._id] = true;
          break; // One breach is enough, no need to check more accounts
        }
      }
    }

    return breachStatus;
  },

  /**
   * Get cash monitoring data for RM Dashboard
   * Returns accounts with negative cash and accounts with high cash (>200k EUR)
   */
  async 'rmDashboard.getCashMonitoring'(sessionId) {
    check(sessionId, String);

    const currentUser = await validateRMSession(sessionId);
    const clients = await getAssignedClients(currentUser);
    const clientIds = clients.map(c => c._id);

    if (clientIds.length === 0) {
      return { negativeCashAccounts: [], highCashAccounts: [] };
    }

    try {
      // Get all bank accounts for these clients
      let bankAccounts;
      if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
        // Admin sees all accounts
        bankAccounts = await BankAccountsCollection.find({ isActive: true }).fetchAsync();
      } else {
        // RM sees only their clients' accounts
        bankAccounts = await BankAccountsCollection.find({
          userId: { $in: clientIds },
          isActive: true
        }).fetchAsync();
      }

      // Get all banks for name lookup
      const allBanks = await BanksCollection.find({}).fetchAsync();
      const bankMap = {};
      allBanks.forEach(b => { bankMap[b._id] = b; });

      // Get currency rates for conversion to EUR
      let currencyRates = await CurrencyRateCacheCollection.find({
        expiresAt: { $gt: new Date() }
      }).fetchAsync();

      // If cache is empty (e.g., first request after startup), trigger refresh
      if (currencyRates.length === 0) {
        console.log('[CashMonitoring] FX rate cache empty, triggering on-demand refresh...');
        try {
          await CurrencyCache.refreshCurrencyRates();
          currencyRates = await CurrencyRateCacheCollection.find({
            expiresAt: { $gt: new Date() }
          }).fetchAsync();
          console.log(`[CashMonitoring] FX rate refresh complete, ${currencyRates.length} rates available`);
        } catch (fxError) {
          console.error('[CashMonitoring] FX rate refresh failed:', fxError.message);
        }
      }

      const ratesMap = buildRatesMap(currencyRates);

      // Get ISINs classified as monetary_products or time_deposit
      const cashEquivalentMetadata = await SecuritiesMetadataCollection.find({
        assetClass: { $in: ['monetary_products', 'time_deposit'] }
      }).fetchAsync();
      const cashEquivalentISINs = new Set(cashEquivalentMetadata.map(m => m.isin));

      const negativeCashAccounts = [];
      const highCashAccounts = [];
      const HIGH_CASH_THRESHOLD = 200000; // 200k EUR

      for (const account of bankAccounts) {
        // Get holdings for this account
        const holdings = await PMSHoldingsCollection.find({
          portfolioCode: account.accountNumber,
          isLatest: true,
          isActive: { $ne: false }
        }).fetchAsync();

        // Use shared cash calculator for consistent values across the app
        // Pass local convertToEUR function which uses the FOREX pairs Map format
        const cashResult = calculateCashForHoldings(holdings, ratesMap, cashEquivalentISINs, convertToEUR);
        const pureCashEUR = cashResult.pureCashEUR;
        const totalCashEquivalentEUR = cashResult.totalCashEquivalentEUR;
        const pureCashBreakdown = cashResult.pureCashBreakdown;
        const allCashBreakdown = cashResult.allCashBreakdown;

        // Get client info
        const accountUser = await UsersCollection.findOneAsync(account.userId);
        const clientName = accountUser
          ? `${accountUser.profile?.firstName || ''} ${accountUser.profile?.lastName || ''}`.trim() || accountUser.email
          : 'Unknown';

        const bankName = bankMap[account.bankId]?.name || 'Unknown Bank';

        // Check for negative cash - use PURE CASH only (actionable overdraft)
        if (pureCashEUR < 0) {
          // Convert authorized overdraft to EUR for comparison
          const authorizedOverdraftEUR = account.authorizedOverdraft
            ? convertToEUR(account.authorizedOverdraft, account.referenceCurrency || 'EUR', ratesMap)
            : 0;

          const isWithinLimit = Math.abs(pureCashEUR) <= authorizedOverdraftEUR;
          const utilizationPercent = authorizedOverdraftEUR > 0
            ? (Math.abs(pureCashEUR) / authorizedOverdraftEUR) * 100
            : 100;

          negativeCashAccounts.push({
            accountId: account._id,
            accountNumber: account.accountNumber,
            clientId: account.userId,
            clientName,
            bankId: account.bankId,
            bankName,
            totalCashEUR: pureCashEUR,
            authorizedOverdraftEUR,
            isWithinLimit,
            utilizationPercent,
            breakdown: pureCashBreakdown
          });
        }

        // Check for high cash (>200k EUR) - use TOTAL CASH EQUIVALENTS (investment opportunity)
        if (totalCashEquivalentEUR > HIGH_CASH_THRESHOLD) {
          highCashAccounts.push({
            accountId: account._id,
            accountNumber: account.accountNumber,
            clientId: account.userId,
            clientName,
            bankId: account.bankId,
            bankName,
            totalCashEUR: totalCashEquivalentEUR,
            excessAmount: totalCashEquivalentEUR - HIGH_CASH_THRESHOLD,
            breakdown: allCashBreakdown
          });
        }
      }

      // Sort: most critical first for negative (most negative), highest cash first for high
      negativeCashAccounts.sort((a, b) => a.totalCashEUR - b.totalCashEUR);
      highCashAccounts.sort((a, b) => b.totalCashEUR - a.totalCashEUR);

      return { negativeCashAccounts, highCashAccounts };

    } catch (error) {
      console.error('[RM Dashboard] Error getting cash monitoring:', error);
      return { negativeCashAccounts: [], highCashAccounts: [] };
    }
  }
});
