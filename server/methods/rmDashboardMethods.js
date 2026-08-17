import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check, Match } from 'meteor/check';
import { HTTP } from 'meteor/http';
import { SessionsCollection, SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES, UserHelpers } from '../../imports/api/users.js';
import { ProductsCollection } from '../../imports/api/products.js';
import { AllocationsCollection } from '../../imports/api/allocations.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { AccountProfilesCollection, aggregateToFourCategories } from '../../imports/api/accountProfiles.js';
import { PortfolioSnapshotsCollection, filterSnapshotsByBankStartDate } from '../../imports/api/portfolioSnapshots.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { TickerPriceCacheCollection } from '../../imports/api/tickerCache.js';
import { NotificationsCollection } from '../../imports/api/notifications.js';
import { MarketDataCacheCollection } from '../../imports/api/marketDataCache.js';
import { SecuritiesMetadataCollection } from '../../imports/api/securitiesMetadata.js';
import { CurrencyRateCacheCollection, CurrencyCache } from '../../imports/api/currencyCache.js';
import { calculateCashForHoldings } from '../../imports/api/helpers/cashCalculator.js';
import { DashboardMetricsHelpers } from '../../imports/api/dashboardMetrics.js';
import { ClientEntitiesCollection, ClientEntityHelpers, ENTITY_STATUSES } from '../../imports/api/clientEntities.js';
import { UserEntityAccessHelpers } from '../../imports/api/userEntityAccess.js';
import { getFilteredEntityIds, buildEntityOrUserFilter } from '../../imports/utils/entityResolver.js';
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
  // SECURITY: string-only — a selector object like {$gt:""} would otherwise match
  // the first live session (NoSQL auth-bypass). Fail closed.
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }
  const session = await SessionHelpers.findByToken(sessionId);

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
    USER_ROLES.ASSISTANT,
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

  // Exclude archived (closed-relationship) clients from every dashboard view —
  // cash monitoring, alerts, etc. should never surface a client we've left.
  const { userIds: archivedUserIds } = await ClientEntityHelpers.getArchivedOwnerIds();

  // Admin/Superadmin/Compliance sees all clients
  if (currentUser.role === USER_ROLES.ADMIN ||
      currentUser.role === USER_ROLES.SUPERADMIN ||
      currentUser.role === USER_ROLES.COMPLIANCE) {
    return await UsersCollection.find({
      role: USER_ROLES.CLIENT,
      _id: { $nin: archivedUserIds }
    }).fetchAsync();
  }

  // RM/Assistant sees only assigned clients
  const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
  return await UsersCollection.find({
    role: USER_ROLES.CLIENT,
    relationshipManagerId: { $in: rmIds },
    _id: { $nin: archivedUserIds }
  }).fetchAsync();
}

/**
 * Helper function to get filtered client IDs based on viewAsFilter
 * Respects role-based access control and returns only IDs (not full user objects)
 * @param {Object} currentUser - The authenticated user
 * @param {Object} viewAsFilter - Optional filter {type: 'client'|'account', id: String}
 * @returns {Array<String>} Array of client IDs to filter by
 */
/**
 * Resolve the OWNER ids of the dashboard's data perimeter: a mixed array of legacy
 * userIds and entityIds. Both `allocations.clientId` and the owner stamps on
 * PMSHoldings hold either kind, so consumers match with `{ $in: ids }` (allocations)
 * or `$or: [{ userId: { $in } }, { entityId: { $in } }]` (holdings).
 *
 * View As support — the picker returns ENTITIES since the entity migration, and this
 * resolver's missing 'entity' branch used to fall through to "all assigned clients":
 * the dashboard silently showed the firm-wide picture while the user believed they
 * were scoped to one client.
 *
 * The fictional demo entity is allowed ONLY via an explicit entity selection (that is
 * its purpose); it never enters unscoped lists. Archived clients never appear at all.
 */
async function getFilteredClientIds(currentUser, viewAsFilter = null) {
  const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
  const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT;
  const isCompliance = currentUser.role === USER_ROLES.COMPLIANCE;
  const isClient = currentUser.role === USER_ROLES.CLIENT;

  // Client sees themselves plus any entities they hold access grants for
  if (isClient) {
    const { UserEntityAccessHelpers } = await import('/imports/api/userEntityAccess.js');
    const grantedIds = await UserEntityAccessHelpers.getEntityIdsForUser(currentUser._id);
    if (grantedIds.length === 0) return [currentUser._id];
    const liveEntities = await ClientEntitiesCollection.find(
      { _id: { $in: grantedIds }, status: { $ne: ENTITY_STATUSES.ARCHIVED }, isDemo: { $ne: true } },
      { fields: { _id: 1 } }
    ).fetchAsync();
    return [currentUser._id, ...liveEntities.map(e => e._id)];
  }

  // Archived (closed-relationship) clients are excluded everywhere — including
  // explicit viewAs drill-down. Resolve the archived legacy userIds once.
  const { userIds: archivedUserIds } = await ClientEntityHelpers.getArchivedOwnerIds();

  // RM access test shared by the entity branches below
  const rmHasEntityAccess = (entity) => {
    const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
    return (entity.assignedUserIds || []).some(id => rmIds.includes(id))
      || rmIds.includes(entity.relationshipManagerId);
  };

  // If viewAsFilter is active, narrow to that perimeter
  if (viewAsFilter && (isAdmin || isRM || isCompliance)) {
    if (viewAsFilter.type === 'entity') {
      const entity = await ClientEntitiesCollection.findOneAsync(viewAsFilter.id);
      if (!entity || ClientEntityHelpers.isEntityArchived(entity)) return [];
      if (isRM && !rmHasEntityAccess(entity)) {
        console.warn(`[getFilteredClientIds] RM/Assistant ${currentUser._id} attempted to access unauthorized entity ${viewAsFilter.id}`);
        return [];
      }
      // Pre-migration data (allocations, holdings) references the LEGACY userId, and
      // migratedFromUserId is absent on most entities. The durable link is the entity's
      // bank accounts, which carry both stamps on migrated accounts — collect every
      // linked legacy userId so the perimeter covers old and new records alike.
      const ids = [entity._id];
      if (entity.migratedFromUserId) ids.push(entity.migratedFromUserId);
      const linkedAccounts = await BankAccountsCollection.find(
        { entityId: entity._id, userId: { $exists: true, $ne: null } },
        { fields: { userId: 1 } }
      ).fetchAsync();
      for (const a of linkedAccounts) {
        if (a.userId && !ids.includes(a.userId) && !archivedUserIds.includes(a.userId)) ids.push(a.userId);
      }
      return ids;
    } else if (viewAsFilter.type === 'client') {
      // For RMs/Assistants, verify they have access to this client
      if (isRM) {
        const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
        const targetClient = await UsersCollection.findOneAsync({
          _id: viewAsFilter.id,
          relationshipManagerId: { $in: rmIds }
        });
        if (!targetClient) {
          console.warn(`[getFilteredClientIds] RM/Assistant ${currentUser._id} attempted to access unauthorized client ${viewAsFilter.id}`);
          return [];
        }
      }
      if (archivedUserIds.includes(viewAsFilter.id)) return [];
      return [viewAsFilter.id];
    } else if (viewAsFilter.type === 'account') {
      // The account's owner is its entity (post-migration) or its legacy user
      const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      if (!bankAccount) return [];
      if (bankAccount.entityId) {
        const entity = await ClientEntitiesCollection.findOneAsync(bankAccount.entityId);
        if (!entity || ClientEntityHelpers.isEntityArchived(entity)) return [];
        if (isRM && !rmHasEntityAccess(entity)) {
          console.warn(`[getFilteredClientIds] RM/Assistant ${currentUser._id} attempted to access unauthorized account ${viewAsFilter.id}`);
          return [];
        }
        const ids = [entity._id];
        if (entity.migratedFromUserId) ids.push(entity.migratedFromUserId);
        if (bankAccount.userId && !ids.includes(bankAccount.userId) && !archivedUserIds.includes(bankAccount.userId)) {
          ids.push(bankAccount.userId);
        }
        return ids;
      }
      // Legacy user-owned account
      if (isRM) {
        const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
        const targetClient = await UsersCollection.findOneAsync({
          _id: bankAccount.userId,
          relationshipManagerId: { $in: rmIds }
        });
        if (!targetClient) {
          console.warn(`[getFilteredClientIds] RM/Assistant ${currentUser._id} attempted to access unauthorized account ${viewAsFilter.id}`);
          return [];
        }
      }
      if (archivedUserIds.includes(bankAccount.userId)) return [];
      return bankAccount.userId ? [bankAccount.userId] : [];
    }
  }

  // No filter — the full perimeter: assigned client users PLUS live entities.
  // Entity-only clients (post-migration) have no userId, so without the entity ids
  // their allocations and holdings were invisible to every dashboard aggregate.
  const clients = await getAssignedClients(currentUser);
  const entityQuery = {
    isActive: true,
    status: { $ne: ENTITY_STATUSES.ARCHIVED },
    isDemo: { $ne: true }
  };
  if (isRM) {
    const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
    entityQuery.$or = [
      { assignedUserIds: { $in: rmIds } },
      { relationshipManagerId: { $in: rmIds } }
    ];
  }
  const entities = await ClientEntitiesCollection.find(entityQuery, { fields: { _id: 1 } }).fetchAsync();
  return [...clients.map(c => c._id), ...entities.map(e => e._id)];
}

/**
 * Account-level scope clauses for beneficially-owned (wrapper) accounts.
 *
 * Insurance-wrapper accounts (e.g. UTMOST) are legally owned by the wrapper
 * entity — holdings rows carry the WRAPPER's entityId and a legacy userId that
 * can span several wrappers with different beneficial owners. The client entity
 * appears only in the account's beneficialOwnerIds, so an owner-id perimeter
 * alone matches zero holdings (the "View as: Stanley → EUR 0" bug), and adding
 * the legacy userId would leak sibling wrapper accounts of OTHER clients.
 * The only safe join is per account: (bankId + portfolioCode), mirroring the
 * MCP scope resolver's third match path (server/mcp/scopeHelper.js).
 *
 * Returns clauses to OR into a holdings/snapshots owner-$or. Empty for most
 * perimeters (no beneficially-owned accounts).
 */
async function getBeneficialAccountClauses(clientIds) {
  if (!clientIds || clientIds.length === 0) return [];
  const accounts = await BankAccountsCollection.find({
    isActive: true,
    $or: [
      { beneficialOwnerIds: { $in: clientIds } },
      { beneficialOwnerId: { $in: clientIds } }
    ],
    // Accounts the perimeter owns directly are already covered by the
    // entityId/userId clauses
    entityId: { $nin: clientIds }
  }, { fields: { bankId: 1, accountNumber: 1 } }).fetchAsync();
  return accounts
    .filter(a => a.bankId && a.accountNumber)
    .map(a => ({
      bankId: a.bankId,
      // Anchor to the whole account: base and its sub-accounts (-USD, -1…),
      // never a neighbouring code sharing the prefix
      portfolioCode: {
        $regex: `^${a.accountNumber.split('-')[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-|$)`
      }
    }));
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
   * @param {String} sessionId - User session ID
   * @param {Object} viewAsFilter - Optional filter to view specific client/account
   */
  async 'rmDashboard.getAlerts'(sessionId, viewAsFilter = null) {
    // Read-only method: unblock so the dashboard's parallel calls don't
    // serialize on the server (they all arrive on one DDP connection)
    this.unblock();
    check(sessionId, String);
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const currentUser = await validateRMSession(sessionId);

    // Determine target client(s) based on viewAsFilter
    const clientIds = await getFilteredClientIds(currentUser, viewAsFilter);

    if (clientIds.length === 0) {
      return [];
    }

    // Fetch full client objects for profile breach checking
    const clients = await UsersCollection.find({ _id: { $in: clientIds } }).fetchAsync();

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

      // 4. Check investor profile breaches.
      // Batched (was an N+1: a sorted snapshot findOne + a profile findOne per
      // client): profiles come in one query, and only profiled clients get a
      // snapshot lookup — latest-per-user via $top, which unlike $sort+$group
      // doesn't blow the multiplanner memory limit on large collections.
      const clientProfiles = await AccountProfilesCollection.find({
        userId: { $in: clientIds }
      }).fetchAsync();
      const profilesByUser = new Map(clientProfiles.map(p => [p.userId, p]));
      let snapshotsByUser = new Map();
      if (profilesByUser.size > 0) {
        const latestSnapshots = await PortfolioSnapshotsCollection.rawCollection().aggregate([
          { $match: { userId: { $in: [...profilesByUser.keys()] } } },
          { $group: { _id: '$userId', doc: { $top: { sortBy: { snapshotDate: -1 }, output: '$$ROOT' } } } }
        ]).toArray();
        snapshotsByUser = new Map(latestSnapshots.map(d => [d._id, d.doc]));
      }

      for (const client of clients) {
        const profile = profilesByUser.get(client._id);
        if (!profile) continue;

        const snapshot = snapshotsByUser.get(client._id);
        if (!snapshot?.assetClassBreakdown || !snapshot.totalAccountValue) continue;

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
        $and: [{ $or: [{ userId: { $in: clientIds } }, { entityId: { $in: clientIds } }] }],
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
   * @param {Object} viewAsFilter - Optional filter to view specific client/account
   */
  async 'rmDashboard.getPortfolioSummary'(sessionId, targetCurrency = 'EUR', viewAsFilter = null) {
    this.unblock();
    check(sessionId, String);
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const currentUser = await validateRMSession(sessionId);

    // Determine target client(s) based on viewAsFilter
    const clientIds = await getFilteredClientIds(currentUser, viewAsFilter);

    // When View As targets a single ACCOUNT, the owner perimeter from
    // getFilteredClientIds silently widens the total to ALL of the client's
    // accounts. Restrict holdings to the selected account's bankId +
    // portfolioCode, mirroring server/publications/pmsHoldings.js, so the
    // dashboard total matches the PMS total for the same selection.
    let accountScope = null;
    if (viewAsFilter?.type === 'account' && clientIds.length > 0) {
      const scopedAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      if (scopedAccount?.accountNumber && scopedAccount.bankId) {
        const baseAccountNumber = scopedAccount.accountNumber.split('-')[0]
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        accountScope = {
          bankId: scopedAccount.bankId,
          portfolioCodeRegex: `^${baseAccountNumber}(-|$)`
        };
      }
    }

    // For admin/superadmin requesting EUR without viewAsFilter, check pre-computed cache first
    const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
    if (isAdmin && targetCurrency === 'EUR' && !viewAsFilter) {
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
          clientCount: cached.clientCount || clientIds.length,
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

      // Exclude assets of archived (closed-relationship) clients from AUM.
      // The excluded-owner list also carries the fictional demo client; when the View As
      // perimeter IS that owner (explicit selection — the demo's whole purpose), it must
      // not be re-excluded. getFilteredClientIds never returns archived ids, so removing
      // perimeter ids here only ever readmits the demo.
      const archivedOwners = await ClientEntityHelpers.getArchivedOwnerIds();
      if (viewAsFilter) {
        archivedOwners.entityIds = archivedOwners.entityIds.filter(id => !clientIds.includes(id));
        archivedOwners.userIds = archivedOwners.userIds.filter(id => !clientIds.includes(id));
      }
      const archivedHoldingFilter = {
        entityId: { $nin: archivedOwners.entityIds },
        userId: { $nin: archivedOwners.userIds }
      };
      // Filter snapshots on entityId too — entity-only clients (and the fictional demo
      // client) have no legacy userId, so userId alone would leave them in the AUM.
      const archivedSnapshotFilter = {
        userId: { $nin: archivedOwners.userIds },
        entityId: { $nin: archivedOwners.entityIds }
      };

      // For admin/superadmin, get ALL holdings; for RM get only their clients' holdings
      let totalAUMInEUR = 0;

      // Exclude non-investment accounts (credit lines, credit cards, spending accounts)
      // Only investment accounts should count toward AUM
      const NON_INVESTMENT_COMMENTS = ['Credit line', 'Credit Card', 'Credit account', 'Spending'];
      const nonInvestmentAccounts = await BankAccountsCollection.find({
        comment: { $in: NON_INVESTMENT_COMMENTS }
      }, { fields: { accountNumber: 1, bankId: 1 } }).fetchAsync();
      const excludedPortfolioCodes = nonInvestmentAccounts.map(a => a.accountNumber);

      // Asset classes to include in AUM. Matches the PMS Total Portfolio Value:
      // instruments + cash + deposits + 'other'. fx_forward is added separately below
      // (net MTM), and derivatives (none in data) remain excluded.
      const aumAssetClasses = [
        'cash', 'equity', 'fixed_income', 'structured_product',
        'time_deposit', 'monetary_products', 'commodities',
        'private_equity', 'private_debt',
        'etf',   // ETF positions
        'fund',  // Fund positions
        'other'  // Unclassified instruments (included so AUM matches PMS total)
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

      if ((currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) && !viewAsFilter) {
        // Unscoped admin sees all holdings - sum market value from latest PMSHoldings.
        // With a View As filter this branch must NOT run: fall through to the
        // perimeter-scoped query below like everyone else.
        // Include whitelisted asset classes + unclassified (null) holdings
        // Must match PMS publication filter: isActive: true, isLatest: true
        // Exclude CONSOLIDATED to avoid double-counting
        const allHoldings = await PMSHoldingsCollection.find({
          isActive: true,
          isLatest: true,
          marketValue: { $exists: true, $gt: 0 },
          portfolioCode: { $ne: 'CONSOLIDATED', $nin: excludedPortfolioCodes },
          ...archivedHoldingFilter,
          $or: [
            { assetClass: { $in: aumAssetClasses } },
            { assetClass: null },
            { assetClass: { $exists: false } }
          ]
        }, { fields: { marketValue: 1, portfolioCode: 1, bankId: 1, userId: 1 } }).fetchAsync();

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
        if (excludedPortfolioCodes.length > 0) {
          console.log('[RM Dashboard] Excluded non-investment accounts:', excludedPortfolioCodes.join(', '));
        }
      } else if (clientIds.length > 0) {
        // RM sees only their clients' holdings
        // Include whitelisted asset classes + unclassified (null) holdings
        // Must match PMS publication filter: isActive: true, isLatest: true
        // Exclude CONSOLIDATED and non-investment accounts.
        // Beneficially-owned wrapper accounts join by (bankId + portfolioCode) —
        // their holding rows carry the wrapper's ids, not the client's.
        const beneficialClauses = await getBeneficialAccountClauses(clientIds);
        const clientHoldingsQuery = {
          $and: [
            { $or: [{ userId: { $in: clientIds } }, { entityId: { $in: clientIds } }, ...beneficialClauses] },
            { userId: { $nin: archivedOwners.userIds } },
            { entityId: { $nin: archivedOwners.entityIds } }
          ],
          isActive: true,
          isLatest: true,
          marketValue: { $exists: true, $gt: 0 },
          portfolioCode: { $ne: 'CONSOLIDATED', $nin: excludedPortfolioCodes },
          $or: [
            { assetClass: { $in: aumAssetClasses } },
            { assetClass: null },
            { assetClass: { $exists: false } }
          ]
        };
        if (accountScope) {
          clientHoldingsQuery.bankId = accountScope.bankId;
          clientHoldingsQuery.portfolioCode = {
            $regex: accountScope.portfolioCodeRegex,
            $nin: excludedPortfolioCodes
          };
        }
        const clientHoldings = await PMSHoldingsCollection.find(clientHoldingsQuery, {
          fields: { marketValue: 1, portfolioCode: 1, bankId: 1, userId: 1 }
        }).fetchAsync();

        totalAUMInEUR = sumHoldingsInEUR(clientHoldings);

        // Track current portfolios
        clientHoldings.forEach(h => {
          const key = `${h.portfolioCode || 'unknown'}|${h.bankId || 'unknown'}`;
          currentPortfolioKeys.add(key);
        });
      }

      // FX forwards: include at NET mark-to-market (matches PMS Total Portfolio Value).
      // Summed separately because negative legs must NOT be excluded by marketValue > 0.
      if (isAdmin || clientIds.length > 0) {
        const fxForwardScope = (isAdmin && !viewAsFilter)
          ? { ...archivedHoldingFilter }
          : {
              $and: [
                {
                  $or: [
                    { userId: { $in: clientIds } },
                    { entityId: { $in: clientIds } },
                    ...(await getBeneficialAccountClauses(clientIds))
                  ]
                },
                { userId: { $nin: archivedOwners.userIds } },
                { entityId: { $nin: archivedOwners.entityIds } }
              ]
            };
        const fxForwardQuery = {
          isActive: true,
          isLatest: true,
          assetClass: 'fx_forward',
          portfolioCode: { $ne: 'CONSOLIDATED', $nin: excludedPortfolioCodes },
          ...fxForwardScope
        };
        if (accountScope) {
          fxForwardQuery.bankId = accountScope.bankId;
          fxForwardQuery.portfolioCode = {
            $regex: accountScope.portfolioCodeRegex,
            $nin: excludedPortfolioCodes
          };
        }
        const fxForwardHoldings = await PMSHoldingsCollection.find(fxForwardQuery, {
          fields: { marketValueNoAccruedInterest: 1, marketValue: 1 }
        }).fetchAsync();
        totalAUMInEUR += fxForwardHoldings.reduce((sum, h) => sum + (h.marketValueNoAccruedInterest || h.marketValue || 0), 0);
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
      let clientCount = clientIds.length;
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
        // Exclude CONSOLIDATED snapshots to avoid double-counting
        let snapshotQuery = { snapshotDate: yesterday, portfolioCode: { $ne: 'CONSOLIDATED' } };

        const adminUnscoped = (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN) && !viewAsFilter;
        if (!adminUnscoped) {
          // Scoped (RM, or admin with a View As filter): only the perimeter's snapshots
          snapshotQuery.$and = [
            {
              $or: [
                { userId: { $in: clientIds } },
                { entityId: { $in: clientIds } },
                ...(await getBeneficialAccountClauses(clientIds))
              ]
            },
            { userId: { $nin: archivedOwners.userIds } },
            { entityId: { $nin: archivedOwners.entityIds } }
          ];
        } else {
          // Unscoped admin: everything except archived (and demo, via getArchivedOwnerIds)
          snapshotQuery.userId = { $nin: archivedOwners.userIds };
          snapshotQuery.entityId = { $nin: archivedOwners.entityIds };
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
                portfolioCode: { $ne: 'CONSOLIDATED', $nin: excludedPortfolioCodes },
                ...archivedHoldingFilter,
                $or: [
                  { assetClass: { $in: ['cash', 'equity', 'fixed_income', 'structured_product', 'time_deposit', 'monetary_products', 'commodities', 'private_equity', 'private_debt', 'etf', 'fund'] } },
                  { assetClass: null },
                  { assetClass: { $exists: false } }
                ]
              }).fetchAsync();
            } else {
              matchedCurrentHoldings = await PMSHoldingsCollection.find({
                $and: [
                  { $or: [{ userId: { $in: clientIds } }, { entityId: { $in: clientIds } }] },
                  { userId: { $nin: archivedOwners.userIds } },
                  { entityId: { $nin: archivedOwners.entityIds } }
                ],
                isActive: true,
                isLatest: true,
                marketValue: { $exists: true, $gt: 0 },
                portfolioCode: { $ne: 'CONSOLIDATED', $nin: excludedPortfolioCodes },
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

      // Self-heal the global AUM cache: this method only reaches the live computation above
      // when the pre-computed cache is missing (e.g. it was cleared and the CMB-sync cron
      // hasn't rebuilt it yet). Persist the result so subsequent loads hit the cache instead
      // of recomputing on the fly. Guarded to the same scope the cached read uses.
      if (isAdmin && targetCurrency === 'EUR' && !viewAsFilter) {
        try {
          await DashboardMetricsHelpers.saveMetrics({
            metricType: 'aum_summary',
            scope: 'global',
            totalAUM,
            previousDayAUM: previousAUM,
            aumChange,
            aumChangePercent,
            clientCount,
            snapshotDate: new Date()
          });
        } catch (cacheErr) {
          console.warn('[RM Dashboard] Could not persist AUM cache (self-heal):', cacheErr.message);
        }
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
        clientCount: clientIds.length,
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
  async 'rmDashboard.getAUMHistory'(sessionId, days = 90, targetCurrency = 'EUR', viewAsFilter = null) {
    this.unblock();
    check(sessionId, String);
    check(days, Number);
    check(targetCurrency, String);
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const currentUser = await validateRMSession(sessionId);

    // Resolve the View As perimeter. Like getPortfolioSummary, an account-level
    // filter must ALSO restrict by bankId + portfolioCode — the owner ids alone
    // would widen the chart to all of the client's accounts.
    const hasViewFilter = !!viewAsFilter;
    let scopedClientIds = null;
    let accountScope = null;
    if (hasViewFilter) {
      scopedClientIds = await getFilteredClientIds(currentUser, viewAsFilter);
      if (scopedClientIds.length === 0) {
        return { hasData: false, labels: [], values: [], snapshots: [] };
      }
      if (viewAsFilter.type === 'account') {
        const scopedAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
        if (scopedAccount?.accountNumber && scopedAccount.bankId) {
          const baseAccountNumber = scopedAccount.accountNumber.split('-')[0]
            .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          accountScope = {
            bankId: scopedAccount.bankId,
            portfolioCodeRegex: `^${baseAccountNumber}(-|$)`
          };
        }
      }
    }

    // For admin/superadmin requesting WTD (<=7 days) in EUR without a View As
    // filter, check pre-computed cache first (the cache is global-perimeter only)
    const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
    if (isAdmin && days <= 7 && targetCurrency === 'EUR' && !hasViewFilter) {
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
      let rawSnapshots;

      if (hasViewFilter) {
        // View As perimeter (any role): only the selected client/account's snapshots.
        // Beneficially-owned wrapper accounts join by (bankId + portfolioCode).
        const snapshotQuery = {
          $or: [
            { userId: { $in: scopedClientIds } },
            { entityId: { $in: scopedClientIds } },
            ...(await getBeneficialAccountClauses(scopedClientIds))
          ],
          snapshotDate: { $gte: startDate, $lte: endDate },
          portfolioCode: { $ne: 'CONSOLIDATED' }
        };
        if (accountScope) {
          snapshotQuery.bankId = accountScope.bankId;
          snapshotQuery.portfolioCode = { $regex: accountScope.portfolioCodeRegex };
        }
        rawSnapshots = await PortfolioSnapshotsCollection.find(snapshotQuery, {
          sort: { snapshotDate: 1 }
        }).fetchAsync();
      } else if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.COMPLIANCE) {
        // Admin/Compliance sees all portfolios - aggregate by date
        // Exclude CONSOLIDATED snapshots to avoid double-counting, and exclude
        // archived (closed-relationship) clients so the AUM history line matches the
        // headline AUM (same approach as computeDashboardMetrics' WTD snapshots).
        // Exclude by entityId as well as userId: entity-only clients (and the fictional
        // demo client) carry no legacy userId, so a userId-only filter would let their
        // snapshots inflate the chart. $nin also matches documents missing the field,
        // so snapshots with neither owner stamp are unaffected.
        const { userIds: archivedUserIds, entityIds: archivedEntityIds } = await ClientEntityHelpers.getArchivedOwnerIds();
        rawSnapshots = await PortfolioSnapshotsCollection.find({
          snapshotDate: { $gte: startDate, $lte: endDate },
          portfolioCode: { $ne: 'CONSOLIDATED' },
          userId: { $nin: archivedUserIds },
          entityId: { $nin: archivedEntityIds }
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

        // Exclude CONSOLIDATED snapshots to avoid double-counting
        rawSnapshots = await PortfolioSnapshotsCollection.find({
          $or: [{ userId: { $in: clientIds } }, { entityId: { $in: clientIds } }],
          snapshotDate: { $gte: startDate, $lte: endDate },
          portfolioCode: { $ne: 'CONSOLIDATED' }
        }, {
          sort: { snapshotDate: 1 }
        }).fetchAsync();
      }

      // Filter out snapshots from banks with known bad historical data
      const snapshots = filterSnapshotsByBankStartDate(rawSnapshots);

      if (snapshots.length === 0) {
        return { hasData: false, labels: [], values: [], snapshots: [] };
      }

      // Aggregate snapshots by date (sum all portfolios for each day)
      // Skip weekends - banks don't report on weekends, so incomplete data causes chart dips
      const dateMap = new Map();

      for (const snapshot of snapshots) {
        const dayOfWeek = snapshot.snapshotDate.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue; // Skip Saturday/Sunday

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

      // Filter out days with incomplete portfolio coverage
      // (e.g., not all banks synced yet — causes artificial AUM dips)
      // Use both max-in-window and today's live count as reference to catch partial syncs
      const allEntries = Array.from(dateMap.values());
      const maxInWindow = Math.max(...allEntries.map(e => e.portfolioCount));

      // Count current live portfolios for a more accurate reference
      let livePortfolioCount = 0;
      try {
        let liveQuery;
        if (hasViewFilter) {
          // Scope the coverage reference to the View As perimeter — the global
          // portfolio count would make minThreshold reject every scoped day.
          liveQuery = {
            $or: [{ userId: { $in: scopedClientIds } }, { entityId: { $in: scopedClientIds } }],
            isActive: true,
            isLatest: true,
            portfolioCode: accountScope
              ? { $regex: accountScope.portfolioCodeRegex }
              : { $ne: 'CONSOLIDATED' }
          };
          if (accountScope) liveQuery.bankId = accountScope.bankId;
        } else {
          liveQuery = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.COMPLIANCE
            ? { isActive: true, isLatest: true, portfolioCode: { $ne: 'CONSOLIDATED' } }
            : { userId: { $in: (await getAssignedClients(currentUser)).map(c => c._id) }, isActive: true, isLatest: true, portfolioCode: { $ne: 'CONSOLIDATED' } };
        }
        const liveHoldings = await PMSHoldingsCollection.find(liveQuery, { fields: { portfolioCode: 1, bankId: 1 } }).fetchAsync();
        const liveKeys = new Set(liveHoldings.map(h => `${h.portfolioCode}|${h.bankId}`));
        livePortfolioCount = liveKeys.size;
      } catch (e) { /* fallback to max in window */ }

      const referenceCount = Math.max(maxInWindow, livePortfolioCount);
      const minThreshold = Math.floor(referenceCount * 0.8);

      const aggregatedSnapshots = allEntries
        .filter(e => e.portfolioCount >= minThreshold)
        .sort((a, b) => a.date - b.date);

      // Calculate current live AUM from PMSHoldings (same logic as getPortfolioSummary)
      // This ensures the chart's final point matches the displayed AUM
      const aumAssetClasses = [
        'cash', 'equity', 'fixed_income', 'structured_product',
        'time_deposit', 'monetary_products', 'commodities',
        'private_equity', 'private_debt', 'etf', 'fund',
        'other' // included so the final point matches getPortfolioSummary / PMS total
      ];

      const assetClassOr = [
        { assetClass: { $in: aumAssetClasses } },
        { assetClass: null },
        { assetClass: { $exists: false } }
      ];

      // The live "today" point must apply the SAME exclusions as the headline AUM
      // (getPortfolioSummary): archived/demo owners and non-investment accounts.
      // Without them the chart's final point jumps above the displayed AUM
      // (e.g. the fictional demo client's €30M inflating the line).
      const liveArchivedOwners = await ClientEntityHelpers.getArchivedOwnerIds();
      const liveNonInvestmentAccounts = await BankAccountsCollection.find(
        { comment: { $in: ['Credit line', 'Credit Card', 'Credit account', 'Spending'] } },
        { fields: { accountNumber: 1 } }
      ).fetchAsync();
      const liveExcludedPortfolioCodes = liveNonInvestmentAccounts.map(a => a.accountNumber);

      let liveAUMInEUR = 0;
      if (hasViewFilter) {
        // View As perimeter (any role): mirror getPortfolioSummary's scoping so the
        // chart's final point matches the headline AUM for the same selection
        const scopedQuery = {
          $and: [
            {
              $or: [
                { userId: { $in: scopedClientIds } },
                { entityId: { $in: scopedClientIds } },
                ...(await getBeneficialAccountClauses(scopedClientIds))
              ]
            },
            { $or: assetClassOr }
          ],
          isActive: true,
          isLatest: true,
          marketValue: { $exists: true, $gt: 0 },
          portfolioCode: { $ne: 'CONSOLIDATED' }
        };
        if (accountScope) {
          scopedQuery.bankId = accountScope.bankId;
          scopedQuery.portfolioCode = { $regex: accountScope.portfolioCodeRegex };
        }
        const scopedHoldings = await PMSHoldingsCollection.find(scopedQuery, {
          fields: { marketValue: 1 }
        }).fetchAsync();
        liveAUMInEUR = scopedHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
      } else if (currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.COMPLIANCE) {
        const allHoldings = await PMSHoldingsCollection.find({
          isActive: true,
          isLatest: true,
          marketValue: { $exists: true, $gt: 0 },
          portfolioCode: { $ne: 'CONSOLIDATED', $nin: liveExcludedPortfolioCodes },
          userId: { $nin: liveArchivedOwners.userIds },
          entityId: { $nin: liveArchivedOwners.entityIds },
          $or: assetClassOr
        }).fetchAsync();
        liveAUMInEUR = allHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
      } else {
        const clientIds = await getFilteredClientIds(currentUser);
        if (clientIds.length > 0) {
          // NOTE: $and is required — two $or keys in one object literal would
          // silently drop the client-perimeter clause (last key wins)
          const clientHoldings = await PMSHoldingsCollection.find({
            $and: [
              { $or: [{ userId: { $in: clientIds } }, { entityId: { $in: clientIds } }] },
              { $or: assetClassOr }
            ],
            isActive: true,
            isLatest: true,
            marketValue: { $exists: true, $gt: 0 },
            portfolioCode: { $ne: 'CONSOLIDATED', $nin: liveExcludedPortfolioCodes },
            userId: { $nin: liveArchivedOwners.userIds },
            entityId: { $nin: liveArchivedOwners.entityIds }
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
   * @param {String} sessionId - User session ID
   * @param {Object} viewAsFilter - Optional filter to view specific client/account
   */
  async 'rmDashboard.getBirthdays'(sessionId, viewAsFilter = null, limit = 5) {
    this.unblock();
    check(sessionId, String);
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));
    check(limit, Number);

    const currentUser = await validateRMSession(sessionId);
    const clientIds = await getFilteredClientIds(currentUser, viewAsFilter);

    // Get full client objects for birthday data. clientIds mixes legacy userIds and
    // entityIds; entities carry the same profile.birthday / familyMembers shape, and
    // most clients are entity-only now, so read both sources. Entities whose legacy
    // user is ALSO in the perimeter would duplicate — the seen-set below dedupes.
    const clients = clientIds.length > 0
      ? await UsersCollection.find({ _id: { $in: clientIds } }).fetchAsync()
      : [];
    const entityClients = clientIds.length > 0
      ? await ClientEntitiesCollection.find(
          { _id: { $in: clientIds }, type: 'physical_person' },
          { fields: { profile: 1 } }
        ).fetchAsync()
      : [];

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

    // Entity profiles: same birthday shape as user profiles.
    entityClients.forEach(entity => {
      if (entity.profile?.birthday) {
        const nextBday = getNextBirthday(entity.profile.birthday);
        const isToday = nextBday.toDateString() === today.toDateString();
        birthdays.push({
          name: `${entity.profile.firstName || ''} ${entity.profile.lastName || ''}`.trim() || 'Client',
          date: nextBday,
          dateFormatted: nextBday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
          daysUntil: formatDaysUntil(nextBday),
          isClient: true,
          isToday,
          clientId: entity._id,
          entityId: entity._id
        });
      }
      (entity.profile?.familyMembers || []).forEach(member => {
        if (member.birthday) {
          const nextBday = getNextBirthday(member.birthday);
          const isToday = nextBday.toDateString() === today.toDateString();
          birthdays.push({
            name: member.name,
            relationship: member.relationship,
            clientName: `${entity.profile?.firstName || ''} ${entity.profile?.lastName || ''}`.trim(),
            date: nextBday,
            dateFormatted: nextBday.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
            daysUntil: formatDaysUntil(nextBday),
            isClient: false,
            isToday,
            clientId: entity._id,
            entityId: entity._id
          });
        }
      });
    });

    // Sort by date (soonest first); dedupe the same person appearing via both their
    // legacy user record and their entity record (name + date identifies them).
    birthdays.sort((a, b) => a.date - b.date);
    const seen = new Set();
    const unique = birthdays.filter(b => {
      const key = `${b.name}|${b.date.toDateString()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return unique.slice(0, limit);
  },

  /**
   * Get watchlist for RM Dashboard
   * Auto-generated from unique underlyings across client products
   * @param {String} sessionId - User session ID
   * @param {Object} viewAsFilter - Optional filter to view specific client/account
   */
  async 'rmDashboard.getWatchlist'(sessionId, viewAsFilter = null) {
    this.unblock();
    check(sessionId, String);
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const currentUser = await validateRMSession(sessionId);
    const clientIds = await getFilteredClientIds(currentUser, viewAsFilter);

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

      // Get all products — only the underlyings are used, so don't pull the
      // full structured-product documents (schedules, rules, chart configs…)
      const products = await ProductsCollection.find({
        _id: { $in: productIds },
        productStatus: { $ne: 'matured' }
      }, { fields: { underlyings: 1 } }).fetchAsync();

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

      // Get prices from cache. Only the last two closes are read, so slice the
      // history array server-side — full histories are years of daily bars and
      // were the bulk of this method's cost.
      const tickers = Array.from(underlyingMap.keys());
      const prices = await MarketDataCacheCollection.find({
        fullTicker: { $in: tickers }
      }, {
        fields: { fullTicker: 1, price: 1, close: 1, lastUpdated: 1, history: { $slice: -2 } }
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
   * @param {String} sessionId - User session ID
   * @param {Number} limit - Max number of events to return
   * @param {Object} viewAsFilter - Optional filter to view specific client/account
   */
  async 'rmDashboard.getUpcomingEvents'(sessionId, limit = 2, viewAsFilter = null) {
    this.unblock();
    check(sessionId, String);
    check(limit, Number);
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const currentUser = await validateRMSession(sessionId);
    const clientIds = await getFilteredClientIds(currentUser, viewAsFilter);

    if (clientIds.length === 0) {
      return [];
    }

    try {
      // Exclude allocations of archived (closed-relationship) clients so their products'
      // observation events don't surface on the dashboard.
      const archivedAllocExclusion = await ClientEntityHelpers.hiddenAllocationsSelector({
        exceptEntityId: await ClientEntityHelpers.resolveScopedEntityId(viewAsFilter)
      });

      // Get all allocations for clients
      const allocations = await AllocationsCollection.find({
        clientId: { $in: clientIds },
        status: 'active',
        ...archivedAllocExclusion
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
   * @param {String} sessionId - User session ID
   * @param {Number} limit - Max number of activities to return
   * @param {Object} viewAsFilter - Optional filter to view specific client/account
   */
  async 'rmDashboard.getRecentActivity'(sessionId, limit = 5, viewAsFilter = null) {
    this.unblock();
    check(sessionId, String);
    check(limit, Number);
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const currentUser = await validateRMSession(sessionId);
    const clientIds = await getFilteredClientIds(currentUser, viewAsFilter);

    try {
      // Exclude allocations of archived (closed-relationship) clients so their products'
      // notifications don't surface in recent activity.
      const archivedAllocExclusion = await ClientEntityHelpers.hiddenAllocationsSelector({
        exceptEntityId: await ClientEntityHelpers.resolveScopedEntityId(viewAsFilter)
      });

      // Get allocations to find relevant products for these clients
      const allocations = await AllocationsCollection.find({
        clientId: { $in: clientIds },
        status: 'active',
        ...archivedAllocExclusion
      }).fetchAsync();
      const productIds = [...new Set(allocations.map(a => a.productId))];

      // Filter notifications to only those related to filtered client's products
      const query = productIds.length > 0
        ? { productId: { $in: productIds } }
        : {}; // Fallback to all if no products (shouldn't happen normally)

      const notifications = await NotificationsCollection.find(
        query,
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
    this.unblock();
    check(sessionId, String);

    // Validate session (any logged-in user can get the quote)
    const session = await SessionHelpers.findByToken(sessionId);

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
    this.unblock();
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
   * @param {String} sessionId - User session ID
   * @param {Object} viewAsFilter - Optional filter to view specific client/account
   */
  async 'rmDashboard.getCashMonitoring'(sessionId, viewAsFilter = null) {
    this.unblock();
    check(sessionId, String);
    check(viewAsFilter, Match.OneOf(Match.ObjectIncluding({
      type: String,
      id: String
    }), null, undefined));

    const currentUser = await validateRMSession(sessionId);
    const isAdmin = currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.SUPERADMIN;
    const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER;

    // One perimeter resolver for the whole dashboard: handles entity / client /
    // account View As (including entity-only clients with no legacy userId) plus
    // RM access checks and archived/demo exclusion. This method used to carry its
    // own copy that lacked the 'entity' branch, so an entity selection silently
    // fell back to the full book.
    const targetClientIds = await getFilteredClientIds(currentUser, viewAsFilter);

    if (targetClientIds.length === 0) {
      return { negativeCashAccounts: [], highCashAccounts: [] };
    }

    try {
      // Get bank accounts for target clients
      let bankAccounts;

      // If filtering by specific account, only get that account
      if (viewAsFilter && viewAsFilter.type === 'account') {
        bankAccounts = await BankAccountsCollection.find({
          _id: viewAsFilter.id,
          isActive: true
        }).fetchAsync();
      } else {
        // Get all accounts for the target owners — targetClientIds mixes legacy
        // userIds and entityIds, and accounts are stamped with one or the other.
        // Wrapper accounts carry the perimeter only in beneficialOwnerIds.
        bankAccounts = await BankAccountsCollection.find({
          $or: [
            { userId: { $in: targetClientIds } },
            { entityId: { $in: targetClientIds } },
            { beneficialOwnerIds: { $in: targetClientIds } },
            { beneficialOwnerId: { $in: targetClientIds } }
          ],
          isActive: true
        }).fetchAsync();
      }

      // De-duplicate migration leftovers: the same physical account (bankId + accountNumber)
      // can exist as BOTH a legacy userId record and a current entity record. The credit line
      // (authorizedOverdraft) is edited on the entity record post-migration, so reading the
      // legacy record gives a stale limit. Pull all sibling records sharing each key, then keep
      // one canonical record per account (entity preferred, then most recently updated), with the
      // effective overdraft = canonical's if set, otherwise any sibling's non-null value.
      {
        const keys = bankAccounts
          .filter(a => a.bankId && a.accountNumber)
          .map(a => ({ bankId: a.bankId, accountNumber: a.accountNumber }));
        if (keys.length > 0) {
          const siblings = await BankAccountsCollection.find({
            isActive: true,
            $or: keys.map(k => ({ bankId: k.bankId, accountNumber: k.accountNumber }))
          }).fetchAsync();
          const groups = new Map();
          for (const a of [...bankAccounts, ...siblings]) {
            const key = `${a.bankId}::${a.accountNumber}`;
            if (!groups.has(key)) groups.set(key, []);
            const g = groups.get(key);
            if (!g.some(x => x._id === a._id)) g.push(a);
          }
          bankAccounts = [...groups.values()].map(group => {
            const canonical = group.slice().sort((x, y) => {
              const ex = x.entityId ? 1 : 0, ey = y.entityId ? 1 : 0;
              if (ex !== ey) return ey - ex;
              return (y.updatedAt?.getTime?.() || 0) - (x.updatedAt?.getTime?.() || 0);
            })[0];
            const effectiveOverdraft = canonical.authorizedOverdraft
              || group.map(g => g.authorizedOverdraft).find(v => v)
              || canonical.authorizedOverdraft;
            return { ...canonical, authorizedOverdraft: effectiveOverdraft };
          });
        }
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

      // Batch the per-account lookups (holdings + display names): the previous
      // per-account queries were an N+1 that alone cost ~1s on the dashboard
      const accountNumbers = [...new Set(bankAccounts.map(a => a.accountNumber).filter(Boolean))];
      const allAccountHoldings = accountNumbers.length > 0
        ? await PMSHoldingsCollection.find({
            portfolioCode: { $in: accountNumbers },
            isLatest: true,
            isActive: { $ne: false }
          }).fetchAsync()
        : [];
      const holdingsByPortfolio = new Map();
      for (const h of allAccountHoldings) {
        if (!holdingsByPortfolio.has(h.portfolioCode)) holdingsByPortfolio.set(h.portfolioCode, []);
        holdingsByPortfolio.get(h.portfolioCode).push(h);
      }
      const nameEntityIds = [...new Set(bankAccounts.map(a => a.entityId).filter(Boolean))];
      const nameUserIds = [...new Set(bankAccounts.filter(a => !a.entityId && a.userId).map(a => a.userId))];
      const entitiesById = new Map(
        (await ClientEntitiesCollection.find({ _id: { $in: nameEntityIds } }).fetchAsync()).map(e => [e._id, e])
      );
      const usersById = new Map(
        (await UsersCollection.find({ _id: { $in: nameUserIds } }).fetchAsync()).map(u => [u._id, u])
      );

      for (const account of bankAccounts) {
        // Get holdings for this account
        const holdings = holdingsByPortfolio.get(account.accountNumber) || [];

        // Use shared cash calculator for consistent values across the app
        // Pass local convertToEUR function which uses the FOREX pairs Map format
        const cashResult = calculateCashForHoldings(holdings, ratesMap, cashEquivalentISINs, convertToEUR);
        const pureCashEUR = cashResult.pureCashEUR;
        const totalCashEquivalentEUR = cashResult.totalCashEquivalentEUR;
        const pureCashBreakdown = cashResult.pureCashBreakdown;
        const allCashBreakdown = cashResult.allCashBreakdown;

        // Get client info — entity-aware (canonical records may carry entityId, not userId)
        let clientName = 'Unknown';
        if (account.entityId) {
          const entity = entitiesById.get(account.entityId);
          clientName = entity ? ClientEntityHelpers.getEntityDisplayName(entity) : 'Unknown';
        } else if (account.userId) {
          const accountUser = usersById.get(account.userId);
          clientName = accountUser
            ? `${accountUser.profile?.firstName || ''} ${accountUser.profile?.lastName || ''}`.trim() || accountUser.email
            : 'Unknown';
        }

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
            clientId: account.userId || account.entityId,
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
            clientId: account.userId || account.entityId,
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
  },

  /**
   * Get unlinked structured products from PMS holdings
   * Admin/superadmin only — returns SP holdings not linked to any ProductsCollection entry
   */
  async 'products.getUnlinkedStructuredProducts'({ sessionId }) {
    check(sessionId, String);

    const currentUser = await validateRMSession(sessionId);

    if (currentUser.role !== 'admin' && currentUser.role !== 'superadmin') {
      throw new Meteor.Error('not-authorized', 'Admin access required');
    }

    try {
      // Get all ISINs known in ProductsCollection to exclude holdings that match
      const knownProducts = await ProductsCollection.find(
        { isin: { $exists: true, $ne: '' } },
        { fields: { isin: 1 } }
      ).fetchAsync();
      const knownIsins = new Set(knownProducts.map(p => p.isin).filter(Boolean));

      const holdings = await PMSHoldingsCollection.find({
        assetClass: { $in: ['structured_product', 'Structured Products'] },
        isLatest: true,
        isActive: true,
        portfolioCode: { $ne: 'CONSOLIDATED' },
        $or: [
          { linkingStatus: 'unlinked' },
          { linkingStatus: { $exists: false } },
          { linkedProductId: { $exists: false } },
          { linkedProductId: null }
        ]
      }).fetchAsync();

      // Filter out holdings whose ISIN matches a known product
      const unlinkedHoldings = holdings.filter(h => {
        const holdingIsin = h.isin || h.instrumentISIN || '';
        return !holdingIsin || !knownIsins.has(holdingIsin);
      });

      if (unlinkedHoldings.length === 0) return [];

      // Batch-resolve userIds to display names
      const userIds = [...new Set(unlinkedHoldings.map(h => h.userId).filter(Boolean))];
      const users = userIds.length > 0
        ? await UsersCollection.find({ _id: { $in: userIds } }).fetchAsync()
        : [];
      const userMap = {};
      users.forEach(u => {
        userMap[u._id] = u.displayName || `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email || u._id;
      });

      // Deduplicate by ISIN — keep one entry per ISIN, aggregate holder count
      const isinMap = {};
      for (const h of unlinkedHoldings) {
        const isin = h.isin || h.instrumentISIN || h._id;
        if (!isinMap[isin]) {
          isinMap[isin] = {
            _id: h._id,
            securityName: h.securityName || h.instrumentName || 'Unknown',
            isin: h.isin || h.instrumentISIN || '',
            bankName: h.bankName || '',
            currency: h.currency || h.positionCurrency || '',
            holders: 1
          };
        } else {
          isinMap[isin].holders += 1;
        }
      }

      const result = Object.values(isinMap);
      result.sort((a, b) => (a.securityName || '').localeCompare(b.securityName || ''));

      return result;
    } catch (error) {
      console.error('[RM Dashboard] Error getting unlinked structured products:', error);
      return [];
    }
  }
});
