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
import { DashboardMetricsHelpers } from '../../imports/api/dashboardMetrics.js';
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
 * Allows RMs, Admins, Compliance, and Clients to access the dashboard
 * (data filtering is handled in individual methods based on role)
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

  // Allow all authenticated users to access the dashboard
  // Data filtering is handled per-role in individual methods
  const allowedRoles = [
    USER_ROLES.RELATIONSHIP_MANAGER,
    USER_ROLES.ADMIN,
    USER_ROLES.SUPERADMIN,
    USER_ROLES.COMPLIANCE,
    USER_ROLES.CLIENT
  ];

  if (!allowedRoles.includes(currentUser.role)) {
    throw new Meteor.Error('not-authorized', 'Access restricted');
  }

  return currentUser;
}

/**
 * Helper function to get RM's assigned clients
 * For clients, returns only themselves (so all queries filter to their own data)
 */
async function getAssignedClients(currentUser) {
  // Client sees only themselves
  if (currentUser.role === USER_ROLES.CLIENT) {
    return [currentUser];
  }

  // Admin/Superadmin/Compliance sees all clients
  if (currentUser.role === USER_ROLES.ADMIN ||
      currentUser.role === USER_ROLES.SUPERADMIN ||
      currentUser.role === USER_ROLES.COMPLIANCE) {
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

/**
 * Convert amount from EUR to any target currency
 * Uses USD as intermediate if needed
 */
function convertFromEUR(amountEUR, toCurrency, ratesMap) {
  if (!amountEUR) return 0;
  if (toCurrency === 'EUR') return amountEUR;

  // Try direct EUR pair first (e.g., EURUSD.FOREX, EURCHF.FOREX)
  // EUR/XXX rate means 1 EUR = rate XXX, so XXX = EUR * rate
  const directPair = `EUR${toCurrency}.FOREX`;
  if (ratesMap.has(directPair)) {
    return amountEUR * ratesMap.get(directPair);
  }

  // Try inverse pair (e.g., XXXEUR.FOREX) - less common
  const inversePair = `${toCurrency}EUR.FOREX`;
  if (ratesMap.has(inversePair)) {
    return amountEUR / ratesMap.get(inversePair);
  }

  // Convert via USD as intermediate
  // First convert EUR to USD
  const eurUsdRate = ratesMap.get('EURUSD.FOREX');
  if (!eurUsdRate) {
    console.warn('[AUM Conversion] No EURUSD rate available, returning EUR value');
    return amountEUR;
  }

  // EURUSD = 1 EUR in USD, so USD = EUR * rate
  const amountUSD = amountEUR * eurUsdRate;

  if (toCurrency === 'USD') {
    return amountUSD;
  }

  // Convert USD to target currency
  // Try USD/XXX pair (e.g., USDCHF.FOREX)
  const usdTargetPair = `USD${toCurrency}.FOREX`;
  if (ratesMap.has(usdTargetPair)) {
    return amountUSD * ratesMap.get(usdTargetPair);
  }

  // Try inverse XXX/USD pair (e.g., GBPUSD.FOREX)
  const targetUsdPair = `${toCurrency}USD.FOREX`;
  if (ratesMap.has(targetUsdPair)) {
    return amountUSD / ratesMap.get(targetUsdPair);
  }

  console.warn(`[AUM Conversion] No FX rate for ${toCurrency}, returning EUR value`);
  return amountEUR;
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

      // Deduplicate: keep only the latest notification per product per event type
      const seenProductEvents = new Map();
      for (const notification of barrierNotifications) {
        const key = `${notification.productId}-${notification.eventType}`;
        // Already sorted by createdAt desc, so first one seen is the latest
        if (!seenProductEvents.has(key)) {
          seenProductEvents.set(key, notification);
        }
      }

      // Map deduplicated notifications to alert format
      for (const notification of seenProductEvents.values()) {
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
   * @param {String} sessionId - User session ID
   * @param {String} targetCurrency - Currency to display AUM in (default: 'EUR')
   */
  async 'rmDashboard.getPortfolioSummary'(sessionId, targetCurrency = 'EUR') {
    check(sessionId, String);

    const currentUser = await validateRMSession(sessionId);
    const clients = await getAssignedClients(currentUser);
    const clientIds = clients.map(c => c._id);

    // For admin/superadmin requesting EUR, check pre-computed cache first
    const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
    if (isAdmin && targetCurrency === 'EUR') {
      const cached = await DashboardMetricsHelpers.getMetrics('global', 'aum_summary');
      if (cached) {
        console.log('[RM Dashboard] Using pre-computed AUM metrics from cache');

        // Product counts are quick to compute, fetch them fresh
        const products = await ProductsCollection.find({}).fetchAsync();
        const statusCounts = { live: 0, autocalled: 0, matured: 0 };
        products.forEach(p => {
          const status = p.productStatus || 'live';
          if (status === 'live') statusCounts.live++;
          else if (status === 'autocalled') statusCounts.autocalled++;
          else if (status === 'matured') statusCounts.matured++;
        });

        return {
          totalAUM: cached.totalAUM,
          aumChange: cached.aumChange,
          aumChangePercent: cached.aumChangePercent,
          previousAUM: cached.previousDayAUM,
          comparisonDateLabel: 'yesterday',
          clientCount: cached.clientCount || clients.length,
          liveProducts: statusCounts.live,
          autocalledProducts: statusCounts.autocalled,
          maturedProducts: statusCounts.matured,
          fromCache: true
        };
      }
    }

    try {
      // Fetch FX rates for currency conversion
      const currencyRates = await CurrencyRateCacheCollection.find({}).fetchAsync();
      const ratesMap = buildRatesMap(currencyRates);

      // For admin/superadmin, get ALL holdings; for RM get only their clients' holdings
      let totalAUMInEUR = 0;

      // Asset classes to include in AUM (cash and securities only)
      // Excludes: fx_forward (hedging, large notionals), derivatives (mark-to-market)
      const aumAssetClasses = [
        'cash', 'equity', 'fixed_income', 'structured_product',
        'time_deposit', 'monetary_products', 'commodities',
        'private_equity', 'private_debt',
        'etf',   // ETF positions
        'fund'   // Fund positions
      ];

      // Helper to sum holdings in EUR
      // Note: marketValue field is already in portfolio currency (EUR) from bank parsers
      // The 'currency' field represents the security's trading currency, not marketValue's currency
      const sumHoldingsInEUR = (holdings) => {
        return holdings.reduce((sum, h) => {
          // marketValue is already in EUR (PTF_MKT_VAL from bank files)
          // Do NOT convert - that would double-convert non-EUR securities
          return sum + (h.marketValue || 0);
        }, 0);
      };

      // Track current portfolios for later comparison with snapshots
      const currentPortfolioKeys = new Set();

      if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
        // Admin sees all holdings - sum market value from latest PMSHoldings
        // Include whitelisted asset classes + unclassified (null) holdings
        // Must match PMS publication filter: isActive: true, isLatest: true
        const allHoldings = await PMSHoldingsCollection.find({
          isActive: true,
          isLatest: true,
          marketValue: { $exists: true, $gt: 0 },
          $or: [
            { assetClass: { $in: aumAssetClasses } },
            { assetClass: null },
            { assetClass: { $exists: false } }
          ]
        }).fetchAsync();

        totalAUMInEUR = sumHoldingsInEUR(allHoldings);

        // Debug: Log holdings breakdown by portfolio/user
        const holdingsByPortfolio = {};
        allHoldings.forEach(h => {
          const key = `${h.portfolioCode || 'unknown'}|${h.bankId || 'unknown'}`;
          currentPortfolioKeys.add(key);
          if (!holdingsByPortfolio[key]) {
            holdingsByPortfolio[key] = { userId: h.userId, portfolioCode: h.portfolioCode, bankId: h.bankId, total: 0 };
          }
          holdingsByPortfolio[key].total += h.marketValue || 0;
        });
        console.log('[RM Dashboard] Current holdings by portfolio:');
        Object.values(holdingsByPortfolio).forEach(p => {
          console.log(`[RM Dashboard] Holdings - Portfolio: ${p.portfolioCode}, Bank: ${p.bankId}, User: ${p.userId}, Value: ${p.total.toLocaleString('en-US', { maximumFractionDigits: 2 })} EUR`);
        });
        console.log('[RM Dashboard] Total holdings user count:', new Set(Object.values(holdingsByPortfolio).map(p => p.userId)).size);
      } else if (clientIds.length > 0) {
        // RM sees only their clients' holdings
        // Include whitelisted asset classes + unclassified (null) holdings
        // Must match PMS publication filter: isActive: true, isLatest: true
        const clientHoldings = await PMSHoldingsCollection.find({
          userId: { $in: clientIds },
          isActive: true,
          isLatest: true,
          marketValue: { $exists: true, $gt: 0 },
          $or: [
            { assetClass: { $in: aumAssetClasses } },
            { assetClass: null },
            { assetClass: { $exists: false } }
          ]
        }).fetchAsync();

        totalAUMInEUR = sumHoldingsInEUR(clientHoldings);

        // Track current portfolios
        clientHoldings.forEach(h => {
          const key = `${h.portfolioCode || 'unknown'}|${h.bankId || 'unknown'}`;
          currentPortfolioKeys.add(key);
        });
      }

      // Convert EUR total to target currency
      const totalAUM = convertFromEUR(totalAUMInEUR, targetCurrency, ratesMap);

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

      // Calculate day-over-day AUM variation from snapshots
      let aumChange = 0;
      let aumChangePercent = 0;
      let previousAUM = null;
      let comparisonDateLabel = 'yesterday';

      // Debug: Log current AUM before snapshot comparison
      console.log('[RM Dashboard] Current AUM (EUR):', totalAUMInEUR.toLocaleString('en-US', { maximumFractionDigits: 2 }));

      try {
        // Get yesterday's date (normalized to midnight UTC)
        const yesterday = new Date();
        yesterday.setUTCDate(yesterday.getUTCDate() - 1);
        yesterday.setUTCHours(0, 0, 0, 0);

        console.log('[RM Dashboard] Yesterday date (UTC):', yesterday.toISOString());

        // For admin/superadmin, aggregate all portfolios; for RM, aggregate their clients only
        let snapshotQuery = { snapshotDate: yesterday };

        if (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN) {
          // RM sees only their clients' snapshots
          snapshotQuery.userId = { $in: clientIds };
        }

        // Get yesterday's aggregated AUM from snapshots (EXACT date match only - no fallback to old dates)
        // Filter: totalAccountValue > 0 to match current AUM logic (excludes liability/loan accounts)
        snapshotQuery.totalAccountValue = { $gt: 0 };
        const yesterdaySnapshots = await PortfolioSnapshotsCollection.find(snapshotQuery).fetchAsync();

        console.log('[RM Dashboard] Snapshots found for yesterday (positive values only):', yesterdaySnapshots.length);

        if (yesterdaySnapshots.length > 0) {
          // Build set of portfolios that have yesterday's snapshots
          const snapshotPortfolioKeys = new Set(
            yesterdaySnapshots.map(s => `${s.portfolioCode}|${s.bankId}`)
          );

          // Find which portfolios exist in BOTH current holdings AND yesterday's snapshots
          const matchedPortfolioKeys = [...currentPortfolioKeys].filter(key => snapshotPortfolioKeys.has(key));
          const missingFromSnapshots = [...currentPortfolioKeys].filter(key => !snapshotPortfolioKeys.has(key));

          if (missingFromSnapshots.length > 0) {
            console.log(`[RM Dashboard] ${missingFromSnapshots.length} portfolio(s) excluded from comparison (no yesterday snapshot):`);
            missingFromSnapshots.forEach(key => console.log(`[RM Dashboard]   - ${key}`));
          }

          if (matchedPortfolioKeys.length > 0) {
            // Filter yesterday's snapshots to only matched portfolios
            const matchedSnapshots = yesterdaySnapshots.filter(s => {
              const key = `${s.portfolioCode}|${s.bankId}`;
              return matchedPortfolioKeys.includes(key);
            });

            // Calculate previous AUM from matched snapshots only
            previousAUM = matchedSnapshots.reduce((sum, s) => sum + (s.totalAccountValue || 0), 0);

            // Calculate current AUM for ONLY the matched portfolios (apples-to-apples comparison)
            // We need to re-sum current holdings for matched portfolios only
            let matchedCurrentHoldings;
            if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) {
              matchedCurrentHoldings = await PMSHoldingsCollection.find({
                isActive: true,
                isLatest: true,
                marketValue: { $exists: true, $gt: 0 },
                $or: [
                  { assetClass: { $in: ['cash', 'equity', 'fixed_income', 'structured_product', 'time_deposit', 'monetary_products', 'commodities', 'private_equity', 'private_debt', 'etf', 'fund'] } },
                  { assetClass: null },
                  { assetClass: { $exists: false } }
                ]
              }).fetchAsync();
            } else {
              matchedCurrentHoldings = await PMSHoldingsCollection.find({
                userId: { $in: clientIds },
                isActive: true,
                isLatest: true,
                marketValue: { $exists: true, $gt: 0 },
                $or: [
                  { assetClass: { $in: ['cash', 'equity', 'fixed_income', 'structured_product', 'time_deposit', 'monetary_products', 'commodities', 'private_equity', 'private_debt', 'etf', 'fund'] } },
                  { assetClass: null },
                  { assetClass: { $exists: false } }
                ]
              }).fetchAsync();
            }

            // Filter to matched portfolios only
            const matchedCurrentAUMInEUR = matchedCurrentHoldings
              .filter(h => {
                const key = `${h.portfolioCode || 'unknown'}|${h.bankId || 'unknown'}`;
                return matchedPortfolioKeys.includes(key);
              })
              .reduce((sum, h) => sum + (h.marketValue || 0), 0);

            console.log(`[RM Dashboard] Matched portfolios: ${matchedPortfolioKeys.length}`);
            console.log(`[RM Dashboard] Previous AUM (matched, EUR): ${previousAUM.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
            console.log(`[RM Dashboard] Current AUM (matched, EUR): ${matchedCurrentAUMInEUR.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);

            // Convert to target currency if needed
            let matchedCurrentAUM = matchedCurrentAUMInEUR;
            if (targetCurrency !== 'EUR') {
              previousAUM = convertFromEUR(previousAUM, targetCurrency, ratesMap);
              matchedCurrentAUM = convertFromEUR(matchedCurrentAUMInEUR, targetCurrency, ratesMap);
            }

            // Calculate change using matched portfolios only
            aumChange = matchedCurrentAUM - previousAUM;
            aumChangePercent = previousAUM > 0 ? (aumChange / previousAUM) * 100 : 0;

            console.log('[RM Dashboard] AUM Change:', aumChange.toLocaleString('en-US', { maximumFractionDigits: 2 }), targetCurrency);
            console.log('[RM Dashboard] AUM Change %:', aumChangePercent.toFixed(2) + '%');
          } else {
            console.log('[RM Dashboard] No matching portfolios between current holdings and yesterday snapshots');
            previousAUM = null;
          }
        } else {
          console.log('[RM Dashboard] No snapshots found for yesterday');
        }
      } catch (snapshotError) {
        console.warn('[RM Dashboard] Could not calculate AUM variation:', snapshotError.message);
      }

      return {
        totalAUM,
        aumChange,
        aumChangePercent,
        previousAUM,
        comparisonDateLabel,  // 'yesterday' or specific date like '2026-01-20'
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
   * Get historical AUM data for mini chart
   * Uses PortfolioSnapshots aggregated across all portfolios
   * @param {String} sessionId - User session ID
   * @param {Number} days - Number of days of history (default: 90)
   * @param {String} targetCurrency - Currency for display (default: 'EUR')
   */
  async 'rmDashboard.getAUMHistory'(sessionId, days = 90, targetCurrency = 'EUR') {
    check(sessionId, String);
    check(days, Number);
    check(targetCurrency, String);

    const currentUser = await validateRMSession(sessionId);

    // For admin/superadmin requesting WTD (<=7 days) in EUR, check pre-computed cache first
    const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
    if (isAdmin && days <= 7 && targetCurrency === 'EUR') {
      const cached = await DashboardMetricsHelpers.getMetrics('global', 'aum_summary');
      if (cached?.wtdHistory && cached.wtdHistory.length > 0) {
        console.log('[RM Dashboard] Using pre-computed WTD history from cache');
        return {
          hasData: true,
          labels: cached.wtdHistory.map(s => s.date.toISOString().split('T')[0]),
          values: cached.wtdHistory.map(s => s.value),
          snapshots: cached.wtdHistory.map(s => ({
            date: s.date,
            value: s.value,
            portfolioCount: 0
          })),
          fromCache: true
        };
      }
    }

    try {
      // Calculate date range
      const endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      startDate.setHours(0, 0, 0, 0);

      // Fetch FX rates for currency conversion
      const currencyRates = await CurrencyRateCacheCollection.find({}).fetchAsync();
      const ratesMap = buildRatesMap(currencyRates);

      // Get all snapshots in date range, aggregated by date
      // For admin/superadmin: all portfolios
      // For RM: only their clients' portfolios
      let snapshots;

      if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.COMPLIANCE) {
        // Admin/Compliance sees all portfolios - aggregate by date
        snapshots = await PortfolioSnapshotsCollection.find({
          snapshotDate: { $gte: startDate, $lte: endDate }
        }, {
          sort: { snapshotDate: 1 }
        }).fetchAsync();
      } else {
        // RM sees only their clients' portfolios
        const clients = await getAssignedClients(currentUser);
        const clientIds = clients.map(c => c._id);

        if (clientIds.length === 0) {
          return { hasData: false, labels: [], values: [], snapshots: [] };
        }

        snapshots = await PortfolioSnapshotsCollection.find({
          userId: { $in: clientIds },
          snapshotDate: { $gte: startDate, $lte: endDate }
        }, {
          sort: { snapshotDate: 1 }
        }).fetchAsync();
      }

      if (snapshots.length === 0) {
        return { hasData: false, labels: [], values: [], snapshots: [] };
      }

      // Aggregate snapshots by date (sum all portfolios for each day)
      const dateMap = new Map();

      for (const snapshot of snapshots) {
        const dateKey = snapshot.snapshotDate.toISOString().split('T')[0];

        if (!dateMap.has(dateKey)) {
          dateMap.set(dateKey, {
            date: snapshot.snapshotDate,
            totalAccountValue: 0,
            portfolioCount: 0
          });
        }

        const entry = dateMap.get(dateKey);
        entry.totalAccountValue += (snapshot.totalAccountValue || 0);
        entry.portfolioCount += 1;
      }

      // Convert to sorted array
      const aggregatedSnapshots = Array.from(dateMap.values())
        .sort((a, b) => a.date - b.date);

      // Calculate current live AUM from PMSHoldings (same logic as getPortfolioSummary)
      // This ensures the chart's final point matches the displayed AUM
      const aumAssetClasses = [
        'cash', 'equity', 'fixed_income', 'structured_product',
        'time_deposit', 'monetary_products', 'commodities',
        'private_equity', 'private_debt', 'etf', 'fund'
      ];

      let liveAUMInEUR = 0;
      if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.COMPLIANCE) {
        const allHoldings = await PMSHoldingsCollection.find({
          isActive: true,
          isLatest: true,
          marketValue: { $exists: true, $gt: 0 },
          $or: [
            { assetClass: { $in: aumAssetClasses } },
            { assetClass: null },
            { assetClass: { $exists: false } }
          ]
        }).fetchAsync();
        liveAUMInEUR = allHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
      } else {
        const clients = await getAssignedClients(currentUser);
        const clientIds = clients.map(c => c._id);
        if (clientIds.length > 0) {
          const clientHoldings = await PMSHoldingsCollection.find({
            userId: { $in: clientIds },
            isActive: true,
            isLatest: true,
            marketValue: { $exists: true, $gt: 0 },
            $or: [
              { assetClass: { $in: aumAssetClasses } },
              { assetClass: null },
              { assetClass: { $exists: false } }
            ]
          }).fetchAsync();
          liveAUMInEUR = clientHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
        }
      }

      // Add/update today's entry with live AUM
      const todayKey = new Date().toISOString().split('T')[0];
      const existingTodayIndex = aggregatedSnapshots.findIndex(
        s => s.date.toISOString().split('T')[0] === todayKey
      );

      if (existingTodayIndex >= 0) {
        // Update today's value with live AUM
        aggregatedSnapshots[existingTodayIndex].totalAccountValue = liveAUMInEUR;
      } else {
        // Add today as new entry
        aggregatedSnapshots.push({
          date: new Date(),
          totalAccountValue: liveAUMInEUR,
          portfolioCount: 0
        });
      }

      // Format for chart
      const labels = aggregatedSnapshots.map(s => s.date.toISOString().split('T')[0]);
      const values = aggregatedSnapshots.map(s => {
        // Convert from EUR to target currency if needed
        return targetCurrency === 'EUR'
          ? s.totalAccountValue
          : convertFromEUR(s.totalAccountValue, targetCurrency, ratesMap);
      });

      return {
        hasData: true,
        labels,
        values,
        snapshots: aggregatedSnapshots.map(s => ({
          date: s.date,
          value: targetCurrency === 'EUR'
            ? s.totalAccountValue
            : convertFromEUR(s.totalAccountValue, targetCurrency, ratesMap),
          portfolioCount: s.portfolioCount
        }))
      };

    } catch (error) {
      console.error('[RM Dashboard] Error getting AUM history:', error);
      return { hasData: false, labels: [], values: [], snapshots: [] };
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
