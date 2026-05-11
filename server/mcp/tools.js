/**
 * MCP tool handlers — read-only queries scoped to the authenticated user.
 *
 * Every tool resolves the user's scope via resolveMcpScope() and then applies
 * the resulting filter to raw Collection queries. Tools never subscribe to
 * Meteor publications — they issue direct findAsync() calls with scope merged in.
 */

import { z } from 'zod';

import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PortfolioSnapshotsCollection } from '/imports/api/portfolioSnapshots';
import { OrdersCollection } from '/imports/api/orders';
import { ProductsCollection } from '/imports/api/products';
import { AllocationsCollection } from '/imports/api/allocations';
import { CurrencyRateCacheCollection } from '/imports/api/currencyCache';
import { UsersCollection } from '/imports/api/users';
import { NotificationsCollection, EVENT_TYPE_NAMES } from '/imports/api/notifications';
import { ScheduleCollection } from '/imports/api/schedule';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { PortfolioSnapshotHelpers } from '/imports/api/portfolioSnapshots';
import { TemplateReportsCollection } from '/imports/api/templateReports';

import {
  calculateCashForHoldings,
  extractBankFxRates,
  mergeRatesMaps,
  buildRatesMap,
  convertToEUR
} from '/imports/api/helpers/cashCalculator';

import { resolveMcpScope, buildHoldingScopeFilter, buildSnapshotScopeFilter } from './scopeHelper.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(n) {
  if (typeof n !== 'number' || isNaN(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function textResult(obj) {
  return {
    content: [
      { type: 'text', text: JSON.stringify(obj, null, 2) }
    ]
  };
}

function errorResult(msg) {
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${msg}` }]
  };
}

/** Load currency FX rates map (EUR pivot) for cash calculations. */
async function loadEurRatesMap() {
  const cached = await CurrencyRateCacheCollection.find({}).fetchAsync();
  return buildRatesMap(cached);
}

/** Cache banks per tool invocation so we only fetch them once. */
async function loadBankNameMap() {
  const banks = await BanksCollection.find({}, { fields: { name: 1 } }).fetchAsync();
  return Object.fromEntries(banks.map(b => [b._id, b.name]));
}

/** Resolve a user-friendly bank name (fuzzy substring) to a bankId. Returns null if no match. */
async function resolveBankId(bankName) {
  if (!bankName) return null;
  const re = new RegExp(bankName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const bank = await BanksCollection.findOneAsync({ name: { $regex: re } }, { fields: { _id: 1 } });
  return bank ? bank._id : null;
}

/**
 * Group holdings by (bankId, portfolioCode) and produce a per-account balance sheet:
 *   [{ bankId, bank, accountNumber, totalBalanceEUR, cashEUR, securitiesEUR, referenceCurrency, positionsCount }]
 * Uses calculateCashForHoldings for cash classification so the definition matches cash-monitor / alerts.
 */
function buildPerAccountBalances(holdings, rates, bankNameMap) {
  const groups = new Map();
  for (const h of holdings) {
    const key = `${h.bankId || 'unknown'}|${h.portfolioCode || 'unknown'}`;
    if (!groups.has(key)) {
      groups.set(key, {
        bankId: h.bankId || null,
        bank: h.bankId ? (bankNameMap[h.bankId] || null) : null,
        accountNumber: h.portfolioCode || null,
        referenceCurrency: h.portfolioCurrency || null,
        _holdings: []
      });
    }
    groups.get(key)._holdings.push(h);
  }
  const out = [];
  for (const g of groups.values()) {
    const cash = calculateCashForHoldings(g._holdings, rates, new Set());
    let totalEUR = 0;
    for (const h of g._holdings) {
      const mv = h.marketValue;
      if (!mv || isNaN(mv)) continue;
      totalEUR += convertToEUR(mv, h.portfolioCurrency || h.currency || 'EUR', rates);
    }
    const cashEUR = cash.totalCashEquivalentEUR;
    out.push({
      bankId: g.bankId,
      bank: g.bank,
      accountNumber: g.accountNumber,
      referenceCurrency: g.referenceCurrency,
      totalBalanceEUR: totalEUR,
      cashEUR,
      pureCashEUR: cash.pureCashEUR,
      securitiesEUR: totalEUR - cashEUR,
      positionsCount: g._holdings.length
    });
  }
  out.sort((a, b) => (b.totalBalanceEUR || 0) - (a.totalBalanceEUR || 0));
  return out;
}

/**
 * Strip heavy UI-only fields from a report's enhanced underlying before
 * sending to the LLM. Reports include sparklineData (62+ daily prices) and
 * chartData (CSS / SVG styling) — neither is useful for reasoning.
 */
function compactReportUnderlying(u) {
  if (!u || typeof u !== 'object') return u;
  const { sparklineData, chartData, ...rest } = u;
  return rest;
}

/**
 * Strip heavy formatting fields from a report observation. The core fields
 * (date, autocallLevel, couponBarrier, basketLevel, status, couponPaid,
 * productCalled, isCallable, isFinal) are kept.
 */
function compactReportObservation(o) {
  if (!o || typeof o !== 'object') return o;
  return {
    observationDate: o.observationDate,
    paymentDate: o.paymentDate,
    observationType: o.observationType,
    status: o.status,
    isCallable: o.isCallable,
    isFinal: o.isFinal,
    hasOccurred: o.hasOccurred,
    autocallLevel: o.autocallLevel,
    basketLevel: o.basketLevel,
    basketAboveBarrier: o.basketAboveBarrier,
    couponPaid: o.couponPaid,
    couponAmount: o.couponAmount,
    memoryCouponAdded: o.memoryCouponAdded,
    couponInMemory: o.couponInMemory,
    autocalled: o.autocalled,
    productCalled: o.productCalled,
    paymentConfirmed: o.paymentConfirmed,
    matchMessage: o.matchMessage
  };
}

/** Compact holding view — no internal IDs, bank shown by name. */
function compactHolding(h, bankNameMap) {
  return {
    isin: h.isin || null,
    securityName: h.securityName || null,
    securityType: h.securityType || null,
    assetClass: h.assetClass || null,
    quantity: h.quantity ?? null,
    currency: h.currency || null,
    marketPrice: h.marketPrice ?? null,
    marketValue: h.marketValue ?? null,
    marketValueOriginalCurrency: h.marketValueOriginalCurrency ?? null,
    portfolioCurrency: h.portfolioCurrency || null,
    costPrice: h.costPrice ?? null,
    unrealizedPnL: h.unrealizedPnL ?? null,
    performance: h.performance ?? null,
    bank: h.bankId ? (bankNameMap[h.bankId] || null) : null,
    accountNumber: h.portfolioCode || null,
    asOf: h.snapshotDate || null
  };
}

function compactOrder(o, bankNameMap) {
  return {
    orderReference: o.orderReference,
    orderType: o.orderType,
    isin: o.isin,
    securityName: o.securityName,
    assetType: o.assetType,
    currency: o.currency,
    quantity: o.quantity,
    priceType: o.priceType,
    limitPrice: o.limitPrice ?? null,
    estimatedValue: o.estimatedValue ?? null,
    status: o.status,
    bank: o.bankId ? (bankNameMap[o.bankId] || null) : null,
    accountNumber: o.portfolioCode,
    underlyings: o.underlyings || null,
    executedQuantity: o.executedQuantity ?? null,
    executedPrice: o.executedPrice ?? null,
    executionDate: o.executionDate ?? null,
    sentAt: o.sentAt ?? null,
    createdAt: o.createdAt
  };
}

function compactProduct(p) {
  return {
    productId: p._id, // used as input to get_product_details
    title: p.title,
    isin: p.isin,
    templateId: p.templateId,
    issuer: p.issuer,
    currency: p.currency,
    tradeDate: p.tradeDate,
    maturityDate: p.maturityDate,
    underlyings: (p.underlyings || []).map(u => ({
      name: u.name || u.securityName,
      ticker: u.ticker || u.symbol,
      isin: u.isin
    })),
    structureParameters: p.structureParameters || null
  };
}

// ---- Tool definitions ---------------------------------------------------

/**
 * Registers all MCP tools on the given McpServer instance, bound to the given user.
 */
export function registerTools(mcpServer, user) {
  // whoami ----------------------------------------------------------------
  mcpServer.registerTool(
    'whoami',
    {
      description: 'Return the identity and role of the user the MCP token belongs to.',
      inputSchema: {}
    },
    async () => {
      const scope = await resolveMcpScope(user);
      return textResult({
        username: user.username,
        email: user.email,
        role: user.role,
        firstName: user.profile?.firstName || null,
        lastName: user.profile?.lastName || null,
        preferredLanguage: user.profile?.preferredLanguage || null,
        seesAllData: !!scope.isAdmin,
        entitiesInScope: scope.isAdmin ? 'all' : scope.entityIds.length
      });
    }
  );

  // list_entities ---------------------------------------------------------
  mcpServer.registerTool(
    'list_entities',
    {
      description: 'List client entities (people, companies) the user has access to. Use the returned id as entityId filter on other tools.',
      inputSchema: {
        search: z.string().optional().describe('Case-insensitive substring of entity name'),
        limit: z.number().optional().describe('Max results (default 50, max 200)')
      }
    },
    async ({ search, limit }) => {
      const scope = await resolveMcpScope(user);
      const query = { isActive: true };
      if (!scope.isAdmin) {
        if (scope.entityIds.length === 0) return textResult({ items: [], total: 0, hasMore: false });
        query._id = { $in: scope.entityIds };
      }
      if (search) {
        const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [
          { 'profile.firstName': re },
          { 'profile.lastName': re },
          { 'profile.companyName': re }
        ];
      }
      const lim = clampLimit(limit);
      const total = await ClientEntitiesCollection.find(query).countAsync();
      const entities = await ClientEntitiesCollection.find(query, { limit: lim, sort: { updatedAt: -1 } }).fetchAsync();
      return textResult({
        items: entities.map(e => ({
          entityId: e._id, // stable reference for passing to other tools
          name: ClientEntityHelpers.getEntityDisplayName(e),
          type: e.type,
          status: e.status,
          referenceCurrency: e.referenceCurrency
        })),
        total,
        hasMore: entities.length < total
      });
    }
  );

  // list_accounts ---------------------------------------------------------
  mcpServer.registerTool(
    'list_accounts',
    {
      description: 'List bank accounts the user has access to, optionally filtered by entity or bank name.',
      inputSchema: {
        entityId: z.string().optional(),
        bankName: z.string().optional().describe('Case-insensitive substring of the bank name (e.g. "CMB", "Julius Baer")'),
        activeOnly: z.boolean().optional().describe('Default true')
      }
    },
    async ({ entityId, bankName, activeOnly }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const query = {};
      if (activeOnly !== false) query.isActive = true;
      if (!scope.isAdmin) {
        const or = [];
        if (scope.entityIds.length > 0) or.push({ entityId: { $in: scope.entityIds } });
        if (scope.userIds.length > 0) or.push({ userId: { $in: scope.userIds }, entityId: { $exists: false } });
        if (or.length === 0) return textResult({ items: [], total: 0 });
        query.$or = or;
      }
      if (bankName) {
        const bankId = await resolveBankId(bankName);
        if (!bankId) return textResult({ items: [], total: 0, note: `No bank matching "${bankName}"` });
        query.bankId = bankId;
      }

      const accounts = await BankAccountsCollection.find(query, { sort: { createdAt: -1 } }).fetchAsync();
      const bankNameMap = await loadBankNameMap();

      // Compute per-account balances (cash + securities) so the LLM doesn't need a second call.
      const holdingFilter = { isActive: true, isLatest: true, ...(await buildHoldingScopeFilter(scope)) };
      const holdings = await PMSHoldingsCollection.find(holdingFilter).fetchAsync();
      const eodRates = await loadEurRatesMap();
      const bankRates = extractBankFxRates(holdings);
      const rates = mergeRatesMaps(eodRates, bankRates);
      const balances = buildPerAccountBalances(holdings, rates, bankNameMap);
      const balanceKey = (bankId, accountNumber) => `${bankId || ''}|${accountNumber || ''}`;
      const balanceByKey = new Map(
        balances.map(b => [balanceKey(b.bankId, b.accountNumber), b])
      );

      return textResult({
        items: accounts.map(a => {
          const bal = balanceByKey.get(balanceKey(a.bankId, a.accountNumber));
          return {
            bank: bankNameMap[a.bankId] || null,
            accountNumber: a.accountNumber,
            referenceCurrency: a.referenceCurrency,
            accountType: a.accountType,
            accountStructure: a.accountStructure,
            comment: a.comment || null,
            isActive: a.isActive,
            totalBalanceEUR: bal?.totalBalanceEUR ?? null,
            cashEUR: bal?.cashEUR ?? null,
            securitiesEUR: bal?.securitiesEUR ?? null,
            positionsCount: bal?.positionsCount ?? 0
          };
        }),
        total: accounts.length
      });
    }
  );

  // get_cash_balance ------------------------------------------------------
  mcpServer.registerTool(
    'get_cash_balance',
    {
      description: 'Cash-only balance (pure cash + monetary products + term deposits) in EUR, optionally scoped to an entity. For TOTAL balance (cash + securities together) use get_account_balance instead. Uses bank-provided FX rates merged with EOD rates.',
      inputSchema: {
        entityId: z.string().optional()
      }
    },
    async ({ entityId }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const holdingFilter = { isActive: true, isLatest: true, ...(await buildHoldingScopeFilter(scope)) };
      const holdings = await PMSHoldingsCollection.find(holdingFilter).fetchAsync();

      const eodRates = await loadEurRatesMap();
      const bankRates = extractBankFxRates(holdings);
      const rates = mergeRatesMaps(eodRates, bankRates);
      const cash = calculateCashForHoldings(holdings, rates, new Set());

      return textResult({
        asOf: new Date(),
        scope: entityId ? 'single entity' : 'all accessible entities',
        pureCashEUR: cash.pureCashEUR,
        totalCashEquivalentEUR: cash.totalCashEquivalentEUR,
        byCurrency: Object.values(cash.cashByCurrency).map(c => ({
          currency: c.currency,
          nativeTotal: c.totalValue,
          eurEquivalent: c.eurValue,
          positions: c.holdings.length
        })),
        breakdown: cash.pureCashBreakdown.map(b => ({
          name: b.name,
          currency: b.currency,
          nativeValue: b.originalValue,
          eurValue: b.eurValue,
          isPureCash: b.isPureCash,
          isTermDeposit: b.isTermDeposit,
          isMoneyMarket: b.isMoneyMarket
        }))
      });
    }
  );

  // get_account_balance ---------------------------------------------------
  mcpServer.registerTool(
    'get_account_balance',
    {
      description: 'Total account balance = cash + securities, broken down per bank account. Use this when a user asks "what is the balance of my X account" — it combines cash (pure cash, money market, term deposits) with invested securities (equities, structured products, bonds). Results are in EUR using bank-provided FX rates merged with EOD rates.',
      inputSchema: {
        entityId: z.string().optional().describe('Narrow to a single entity'),
        accountNumber: z.string().optional().describe('Narrow to a single portfolio code'),
        bankName: z.string().optional().describe('Case-insensitive substring of bank name')
      }
    },
    async ({ entityId, accountNumber, bankName }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const holdingFilter = { isActive: true, isLatest: true, ...(await buildHoldingScopeFilter(scope)) };
      if (accountNumber) holdingFilter.portfolioCode = accountNumber;
      if (bankName) {
        const bankId = await resolveBankId(bankName);
        if (!bankId) return textResult({ note: `No bank matching "${bankName}"`, totalBalanceEUR: 0, byAccount: [] });
        holdingFilter.bankId = bankId;
      }
      const holdings = await PMSHoldingsCollection.find(holdingFilter).fetchAsync();
      if (holdings.length === 0) {
        return textResult({
          asOf: new Date(),
          scope: entityId ? 'single entity' : 'all accessible entities',
          totalBalanceEUR: 0,
          totalSecuritiesEUR: 0,
          pureCashEUR: 0,
          totalCashEquivalentEUR: 0,
          byAccount: [],
          byCurrency: [],
          note: 'No holdings in scope'
        });
      }

      const eodRates = await loadEurRatesMap();
      const bankRates = extractBankFxRates(holdings);
      const rates = mergeRatesMaps(eodRates, bankRates);
      const bankNameMap = await loadBankNameMap();

      const cash = calculateCashForHoldings(holdings, rates, new Set());
      let totalEUR = 0;
      for (const h of holdings) {
        const mv = h.marketValue;
        if (!mv || isNaN(mv)) continue;
        totalEUR += convertToEUR(mv, h.portfolioCurrency || h.currency || 'EUR', rates);
      }

      const byAccount = buildPerAccountBalances(holdings, rates, bankNameMap);

      return textResult({
        asOf: new Date(),
        scope: entityId
          ? 'single entity'
          : (accountNumber ? `account ${accountNumber}` : 'all accessible accounts'),
        totalBalanceEUR: totalEUR,
        totalSecuritiesEUR: totalEUR - cash.totalCashEquivalentEUR,
        totalCashEquivalentEUR: cash.totalCashEquivalentEUR,
        pureCashEUR: cash.pureCashEUR,
        positionsCount: holdings.length,
        byAccount,
        byCurrency: Object.values(cash.cashByCurrency).map(c => ({
          currency: c.currency,
          nativeCashTotal: c.totalValue,
          cashEurEquivalent: c.eurValue
        }))
      });
    }
  );

  // get_portfolio_summary -------------------------------------------------
  mcpServer.registerTool(
    'get_portfolio_summary',
    {
      description: 'Top-level portfolio summary for the user or a specific entity: total market value in EUR, cash vs invested split, count of positions, and asset-class breakdown.',
      inputSchema: {
        entityId: z.string().optional()
      }
    },
    async ({ entityId }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const filter = { isActive: true, isLatest: true, ...(await buildHoldingScopeFilter(scope)) };
      const holdings = await PMSHoldingsCollection.find(filter).fetchAsync();

      const eodRates = await loadEurRatesMap();
      const bankRates = extractBankFxRates(holdings);
      const rates = mergeRatesMaps(eodRates, bankRates);

      const toEur = (v, ccy) => {
        if (!v || isNaN(v)) return 0;
        if (!ccy || ccy === 'EUR') return v;
        const r = rates[ccy];
        return r ? v * r : v;
      };

      const bankNameMap = await loadBankNameMap();
      let totalMvEur = 0;
      const byAssetClass = {};
      const byBank = {};
      for (const h of holdings) {
        const mv = toEur(h.marketValue, h.portfolioCurrency || h.currency);
        totalMvEur += mv;
        const ac = h.assetClass || 'unknown';
        byAssetClass[ac] = (byAssetClass[ac] || 0) + mv;
        if (h.bankId) {
          const name = bankNameMap[h.bankId] || 'Unknown bank';
          byBank[name] = (byBank[name] || 0) + mv;
        }
      }

      const cash = calculateCashForHoldings(holdings, rates, new Set());

      return textResult({
        asOf: new Date(),
        scope: entityId ? 'single entity' : 'all accessible entities',
        totalMarketValueEUR: totalMvEur,
        pureCashEUR: cash.pureCashEUR,
        totalCashEquivalentEUR: cash.totalCashEquivalentEUR,
        investedEUR: totalMvEur - cash.totalCashEquivalentEUR,
        positionsCount: holdings.length,
        byAssetClass: Object.entries(byAssetClass).map(([assetClass, eur]) => ({ assetClass, eur })),
        byBank: Object.entries(byBank).map(([bank, eur]) => ({ bank, eur }))
      });
    }
  );

  // list_holdings ---------------------------------------------------------
  mcpServer.registerTool(
    'list_holdings',
    {
      description: 'List individual positions in scope. Filter by entity, bank account number, bank name, asset class, ISIN or security name. Mirrors what the web app shows for the same scope.',
      inputSchema: {
        entityId: z.string().optional(),
        accountNumber: z.string().optional().describe('Bank account number (e.g. "5040241"). Matches the account and any sub-portfolios such as "5040241-1".'),
        bankName: z.string().optional().describe('Case-insensitive substring of bank name'),
        assetClass: z.string().optional(),
        isinContains: z.string().optional(),
        securityNameContains: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional()
      }
    },
    async ({ entityId, accountNumber, bankName, assetClass, isinContains, securityNameContains, limit, offset }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const filter = { isActive: true, isLatest: true, ...(await buildHoldingScopeFilter(scope)) };

      if (accountNumber) {
        const trimmed = String(accountNumber).trim();
        let matchingAccounts;
        if (scope.isAdmin) {
          matchingAccounts = await BankAccountsCollection.find(
            { isActive: true, accountNumber: trimmed },
            { fields: { bankId: 1, accountNumber: 1 } }
          ).fetchAsync();
        } else {
          matchingAccounts = scope.bankAccounts.filter(
            a => a.accountNumber === trimmed || a.accountNumberBase === trimmed
          );
        }
        if (matchingAccounts.length === 0) {
          return textResult({ items: [], total: 0, hasMore: false, note: `No account "${trimmed}" in your scope` });
        }
        const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        filter.portfolioCode = { $regex: `^${escaped}(-|$)` };
        const bankIds = [...new Set(matchingAccounts.map(a => a.bankId).filter(Boolean))];
        if (bankIds.length === 1) filter.bankId = bankIds[0];
        else if (bankIds.length > 1) filter.bankId = { $in: bankIds };
      }

      if (bankName) {
        const bankId = await resolveBankId(bankName);
        if (!bankId) return textResult({ items: [], total: 0, hasMore: false, note: `No bank matching "${bankName}"` });
        // Compose with any bankId set by accountNumber: if both narrow, the bank must match
        if (filter.bankId && filter.bankId !== bankId && !(filter.bankId.$in && filter.bankId.$in.includes(bankId))) {
          return textResult({ items: [], total: 0, hasMore: false, note: `Account does not belong to bank "${bankName}"` });
        }
        filter.bankId = bankId;
      }
      if (assetClass) filter.assetClass = assetClass;
      if (isinContains) filter.isin = { $regex: isinContains, $options: 'i' };
      if (securityNameContains) filter.securityName = { $regex: securityNameContains, $options: 'i' };

      const lim = clampLimit(limit);
      const skip = Math.max(0, Math.floor(offset || 0));
      const total = await PMSHoldingsCollection.find(filter).countAsync();
      const holdings = await PMSHoldingsCollection.find(filter, {
        sort: { marketValue: -1 },
        limit: lim,
        skip
      }).fetchAsync();

      const bankNameMap = await loadBankNameMap();
      return textResult({
        items: holdings.map(h => compactHolding(h, bankNameMap)),
        total,
        offset: skip,
        limit: lim,
        hasMore: skip + holdings.length < total
      });
    }
  );

  // list_orders -----------------------------------------------------------
  mcpServer.registerTool(
    'list_orders',
    {
      description: 'List orders (buy/sell trades) in the user\'s scope. Supports filtering by status, date range, and underlying security (ticker/ISIN/name).',
      inputSchema: {
        entityId: z.string().optional(),
        status: z.string().optional().describe('e.g. executed, pending, sent, cancelled'),
        from: z.string().optional().describe('ISO date for createdAt >='),
        to: z.string().optional().describe('ISO date for createdAt <='),
        productSearch: z.string().optional().describe('Substring matched against isin, securityName, underlyings'),
        limit: z.number().optional(),
        offset: z.number().optional()
      }
    },
    async ({ entityId, status, from, to, productSearch, limit, offset }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const query = {};
      if (!scope.isAdmin) {
        if (scope.clientIds.length === 0) return textResult({ items: [], total: 0, hasMore: false });
        query.clientId = { $in: scope.clientIds };
      }
      if (status) query.status = status;
      if (from || to) {
        query.createdAt = {};
        if (from) query.createdAt.$gte = new Date(from);
        if (to) query.createdAt.$lte = new Date(to);
      }
      if (productSearch) {
        const re = new RegExp(productSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        query.$or = [
          { isin: re },
          { securityName: re },
          { underlyings: re }
        ];
      }

      const lim = clampLimit(limit);
      const skip = Math.max(0, Math.floor(offset || 0));
      const total = await OrdersCollection.find(query).countAsync();
      const orders = await OrdersCollection.find(query, {
        sort: { createdAt: -1 },
        limit: lim,
        skip
      }).fetchAsync();

      const bankNameMap = await loadBankNameMap();
      return textResult({
        items: orders.map(o => compactOrder(o, bankNameMap)),
        total,
        offset: skip,
        limit: lim,
        hasMore: skip + orders.length < total
      });
    }
  );

  // search_products -------------------------------------------------------
  mcpServer.registerTool(
    'search_products',
    {
      description: 'Search structured products allocated to the user\'s accounts. Matches against title, ISIN, and underlying security names/tickers.',
      inputSchema: {
        query: z.string().describe('Free-text search across title, ISIN, and underlyings'),
        entityId: z.string().optional(),
        limit: z.number().optional()
      }
    },
    async ({ query: q, entityId, limit }) => {
      const scope = await resolveMcpScope(user, { entityId });

      // First find allocations in scope to get productIds
      const allocQuery = { status: { $in: ['active', 'matured', 'redeemed'] } };
      if (!scope.isAdmin) {
        if (scope.clientIds.length === 0) return textResult({ items: [], total: 0 });
        // Allocations link by clientId OR bankAccountId — cover both
        const scopedAccounts = await BankAccountsCollection.find({
          $or: [
            ...(scope.entityIds.length > 0 ? [{ entityId: { $in: scope.entityIds } }] : []),
            ...(scope.userIds.length > 0 ? [{ userId: { $in: scope.userIds } }] : [])
          ]
        }, { fields: { _id: 1 } }).fetchAsync();
        const accountIds = scopedAccounts.map(a => a._id);
        allocQuery.$or = [
          { clientId: { $in: scope.clientIds } },
          ...(accountIds.length > 0 ? [{ bankAccountId: { $in: accountIds } }] : [])
        ];
      }
      const allocations = await AllocationsCollection.find(allocQuery, { fields: { productId: 1 } }).fetchAsync();
      const productIds = [...new Set(allocations.map(a => a.productId))];
      if (productIds.length === 0) return textResult({ items: [], total: 0 });

      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const productQuery = {
        _id: { $in: productIds },
        $or: [
          { title: re },
          { isin: re },
          { 'underlyings.name': re },
          { 'underlyings.ticker': re },
          { 'underlyings.symbol': re },
          { 'underlyings.isin': re },
          { 'underlyings.securityName': re }
        ]
      };

      const lim = clampLimit(limit);
      const total = await ProductsCollection.find(productQuery).countAsync();
      const products = await ProductsCollection.find(productQuery, {
        sort: { tradeDate: -1 },
        limit: lim
      }).fetchAsync();

      return textResult({
        items: products.map(compactProduct),
        total,
        hasMore: products.length < total
      });
    }
  );

  // get_product_details ---------------------------------------------------
  mcpServer.registerTool(
    'get_product_details',
    {
      description: 'Full details of a structured product: structure parameters (coupon rate, barriers, memory flags), the observation schedule with autocall/coupon barrier per period, underlyings with strike + current price + performance, and the current basket level vs the next coupon barrier. Use this to answer "will the coupon trigger?", "at what level?", "is it autocallable next period?". Enforces scope — errors if user has no allocation.',
      inputSchema: {
        productId: z.string()
      }
    },
    async ({ productId }) => {
      const scope = await resolveMcpScope(user);

      // Scope allocations — must have at least one in user's scope
      const allocQuery = { productId };
      if (!scope.isAdmin) {
        if (scope.clientIds.length === 0) return errorResult('Product not in your access scope');
        const scopedAccounts = await BankAccountsCollection.find({
          $or: [
            ...(scope.entityIds.length > 0 ? [{ entityId: { $in: scope.entityIds } }] : []),
            ...(scope.userIds.length > 0 ? [{ userId: { $in: scope.userIds } }] : [])
          ]
        }, { fields: { _id: 1 } }).fetchAsync();
        const accountIds = scopedAccounts.map(a => a._id);
        allocQuery.$or = [
          { clientId: { $in: scope.clientIds } },
          ...(accountIds.length > 0 ? [{ bankAccountId: { $in: accountIds } }] : [])
        ];
      }
      const allocations = await AllocationsCollection.find(allocQuery).fetchAsync();
      if (!scope.isAdmin && allocations.length === 0) {
        return errorResult('Product not in your access scope');
      }

      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) return errorResult('Product not found');

      // Resolve each allocation's bank account to a friendly label
      const accountIds = [...new Set(allocations.map(a => a.bankAccountId).filter(Boolean))];
      const accounts = accountIds.length
        ? await BankAccountsCollection.find({ _id: { $in: accountIds } }, { fields: { bankId: 1, accountNumber: 1 } }).fetchAsync()
        : [];
      const bankNameMap = await loadBankNameMap();
      const accountLabel = {};
      for (const a of accounts) {
        accountLabel[a._id] = `${bankNameMap[a.bankId] || 'Unknown bank'} — ${a.accountNumber}`;
      }

      // --- Pre-computed report is the source of truth --------------------
      // The nightly cron generates a report with templateResults.{underlyings,
      // observationAnalysis, currentStatus, basketAnalysis} — every number
      // we surface is pre-calculated there. The MCP does ZERO arithmetic.
      const latestReport = await TemplateReportsCollection.findOneAsync(
        { productId },
        { sort: { evaluationDate: -1 } }
      );
      const tr = latestReport?.templateResults || null;

      // Fallback: raw product fields if no report exists yet.
      const productObsSchedule = Array.isArray(product.observationSchedule) ? product.observationSchedule : [];
      const productUnderlyings = Array.isArray(product.underlyings) ? product.underlyings : [];

      const underlyings = tr?.underlyings?.length
        ? tr.underlyings.map(compactReportUnderlying)             // pre-computed: performance, barrierStatus, isWorstPerforming, currentPrice, strike — strips sparklineData + chartData
        : productUnderlyings.map(u => ({
            name: u.name || u.securityData?.symbol || u.ticker || null,
            ticker: u.ticker || u.securityData?.symbol || null,
            isin: u.isin || null,
            strike: u.strike ?? null,
            currency: u.securityData?.currency || u.currency || null,
            note: 'fallback from product document — no evaluation report yet'
          }));

      const observationAnalysis = tr?.observationAnalysis || null;
      const schedule = observationAnalysis?.observations?.length
        ? observationAnalysis.observations.map(compactReportObservation) // pre-computed: status, basketLevel, barrier states, coupon triggered — strips underlyingFlags + formatting noise
        : productObsSchedule;                                     // raw schedule from termsheet extractor

      // Pre-computed prediction for the next observation ("will coupon trigger?")
      const nextObservation = observationAnalysis?.nextObservationPrediction
        || (observationAnalysis?.nextObservation ? { date: observationAnalysis.nextObservation } : null);

      const basketAnalysis = tr?.basketAnalysis || null;
      const currentStatus = tr?.currentStatus || null;
      const structureParams = tr?.phoenixStructure
        || tr?.orionStructure
        || tr?.sharkNoteStructure
        || tr?.participationStructure
        || product.structureParams
        || product.structureParameters
        || null;

      const persistedSchedule = await ScheduleCollection.findOneAsync({ productId }, { fields: { _id: 1, updatedAt: 1 } });

      const dataCompleteness = {
        hasLatestReport: !!latestReport,
        latestReportDate: latestReport?.evaluationDate || null,
        hasObservationAnalysis: !!observationAnalysis,
        hasNextObservationPrediction: !!observationAnalysis?.nextObservationPrediction,
        hasStructureParams: !!structureParams,
        hasObservationSchedule: (schedule?.length || 0) > 0,
        hasTermSheet: !!(product.termSheet && (product.termSheet.url || product.termSheet.filename)),
        hasPersistedSchedule: !!persistedSchedule,
        note: latestReport
          ? 'Data is pre-computed by the nightly evaluation cron. All numbers are from the report — no live calculation performed here.'
          : 'No evaluation report exists yet for this product. Schedule and structure are shown from the product document directly; coupon/autocall status is unknown until the nightly cron (00:30 CET) generates a report.'
      };

      return textResult({
        product: {
          productId: product._id,
          title: product.title,
          isin: product.isin,
          templateId: product.templateId || product.template,
          issuer: product.issuer,
          currency: product.currency,
          tradeDate: product.tradeDate,
          valueDate: product.valueDate,
          finalObservationDate: product.finalObservationDate || product.finalObservation,
          maturityDate: product.maturityDate || product.maturity,
          basketMode: product.basketMode || null,
          productStatus: product.productStatus || null,
          termSheet: product.termSheet ? { filename: product.termSheet.filename, uploadedAt: product.termSheet.uploadedAt } : null
        },
        structureParams,
        underlyings,
        basketAnalysis,
        currentStatus,
        schedule,
        nextObservation,
        allocations: allocations.map(a => ({
          account: a.bankAccountId ? (accountLabel[a.bankAccountId] || null) : null,
          nominalInvested: a.nominalInvested,
          purchasePrice: a.purchasePrice,
          quantity: a.quantity,
          status: a.status,
          allocatedAt: a.allocatedAt,
          redeemedAt: a.redeemedAt || null,
          redemptionPrice: a.redemptionPrice || null,
          redemptionValue: a.redemptionValue || null
        })),
        dataCompleteness
      });
    }
  );

  // get_portfolio_snapshots ----------------------------------------------
  mcpServer.registerTool(
    'get_portfolio_snapshots',
    {
      description: 'Historical portfolio snapshots (daily totals per account) — useful for evolution / timeline questions.',
      inputSchema: {
        entityId: z.string().optional(),
        bankName: z.string().optional().describe('Case-insensitive substring of bank name'),
        accountNumber: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().optional()
      }
    },
    async ({ entityId, bankName, accountNumber, from, to, limit }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const filter = { ...(await buildSnapshotScopeFilter(scope)) };
      if (bankName) {
        const bankId = await resolveBankId(bankName);
        if (!bankId) return textResult({ items: [], count: 0, note: `No bank matching "${bankName}"` });
        filter.bankId = bankId;
      }
      if (accountNumber) filter.portfolioCode = accountNumber;
      if (from || to) {
        filter.snapshotDate = {};
        if (from) filter.snapshotDate.$gte = new Date(from);
        if (to) filter.snapshotDate.$lte = new Date(to);
      }
      const lim = clampLimit(limit || 100);
      const snaps = await PortfolioSnapshotsCollection.find(filter, {
        sort: { snapshotDate: -1 },
        limit: lim
      }).fetchAsync();

      const bankNameMap = await loadBankNameMap();
      return textResult({
        items: snaps.map(s => ({
          snapshotDate: s.snapshotDate,
          bank: s.bankId ? (bankNameMap[s.bankId] || null) : null,
          accountNumber: s.portfolioCode,
          totalMarketValue: s.totalMarketValue ?? null,
          totalCash: s.totalCash ?? null,
          currency: s.currency || null
        })),
        count: snaps.length
      });
    }
  );

  // get_performance ------------------------------------------------------
  mcpServer.registerTool(
    'get_performance',
    {
      description: 'Portfolio performance (holding-period return) over standard periods (1M, 3M, 6M, YTD, 1Y, ALL). Sums totalAccountValue across accounts in scope at the first and last snapshot within each period.',
      inputSchema: {
        entityId: z.string().optional(),
        accountNumber: z.string().optional().describe('Limit to a single portfolio code'),
        periods: z.array(z.enum(['1M', '3M', '6M', 'YTD', '1Y', 'ALL'])).optional()
      }
    },
    async ({ entityId, accountNumber, periods }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const portfolioCodes = scope.bankAccounts.map(a => a.accountNumber).filter(Boolean);
      if (!scope.isAdmin && portfolioCodes.length === 0) {
        return textResult({ items: [], note: 'No accounts in scope' });
      }

      const requested = periods && periods.length ? periods : ['1M', '3M', '6M', 'YTD', '1Y', 'ALL'];
      const now = new Date();
      const periodStart = (p) => {
        switch (p) {
          case '1M': return new Date(now.getTime() - 30 * 86400e3);
          case '3M': return new Date(now.getTime() - 90 * 86400e3);
          case '6M': return new Date(now.getTime() - 180 * 86400e3);
          case 'YTD': return new Date(now.getFullYear(), 0, 1);
          case '1Y': return new Date(now.getTime() - 365 * 86400e3);
          case 'ALL': return null;
        }
      };

      // Scope snapshots the same way get_portfolio_snapshots does
      const scopeFilter = await buildSnapshotScopeFilter(scope);
      const baseQuery = { ...scopeFilter };
      if (accountNumber) baseQuery.portfolioCode = accountNumber;

      // Pull all relevant snapshots once and bucket by date (YYYY-MM-DD)
      const allSnaps = await PortfolioSnapshotsCollection.find(baseQuery, {
        fields: { snapshotDate: 1, portfolioCode: 1, totalAccountValue: 1, totalMarketValue: 1, totalCash: 1, currency: 1 },
        sort: { snapshotDate: 1 }
      }).fetchAsync();

      if (allSnaps.length === 0) {
        return textResult({ items: requested.map(p => ({ period: p, hasData: false })) });
      }

      // Group by date, sum totalAccountValue (fall back to totalMarketValue + totalCash)
      const valueOn = new Map(); // dateISO → total
      for (const s of allSnaps) {
        const key = s.snapshotDate.toISOString().split('T')[0];
        const v = (s.totalAccountValue ?? ((s.totalMarketValue || 0) + (s.totalCash || 0)));
        valueOn.set(key, (valueOn.get(key) || 0) + v);
      }
      const sortedDates = [...valueOn.keys()].sort();
      const valueAtOrAfter = (threshold) => {
        if (!threshold) {
          const d = sortedDates[0];
          return { date: d, value: valueOn.get(d) };
        }
        const iso = threshold.toISOString().split('T')[0];
        const d = sortedDates.find(x => x >= iso);
        if (!d) return null;
        return { date: d, value: valueOn.get(d) };
      };
      const latest = () => {
        const d = sortedDates[sortedDates.length - 1];
        return { date: d, value: valueOn.get(d) };
      };

      const results = requested.map(p => {
        const start = valueAtOrAfter(periodStart(p));
        const end = latest();
        if (!start || !end || start.value === 0) {
          return { period: p, hasData: false };
        }
        const ret = (end.value - start.value) / start.value;
        return {
          period: p,
          hasData: true,
          startDate: start.date,
          endDate: end.date,
          startValue: Number(start.value.toFixed(2)),
          endValue: Number(end.value.toFixed(2)),
          returnAmount: Number((end.value - start.value).toFixed(2)),
          returnPercent: Number((ret * 100).toFixed(2)),
          returnFormatted: `${ret >= 0 ? '+' : ''}${(ret * 100).toFixed(2)}%`
        };
      });

      return textResult({
        scope: entityId ? 'single entity' : (accountNumber ? `account ${accountNumber}` : 'all accessible accounts'),
        asOf: now,
        items: results
      });
    }
  );

  // get_upcoming_events --------------------------------------------------
  mcpServer.registerTool(
    'get_upcoming_events',
    {
      description: 'Upcoming product events (coupon dates, autocall observations, maturities) for products in the user\'s scope, within the next N days.',
      inputSchema: {
        entityId: z.string().optional(),
        daysAhead: z.number().optional().describe('Default 90'),
        types: z.array(z.enum(['coupon', 'observation', 'maturity', 'redemption', 'launch'])).optional()
      }
    },
    async ({ entityId, daysAhead, types }) => {
      const scope = await resolveMcpScope(user, { entityId });

      // Find product IDs in scope via allocations (same path as search_products)
      const allocQuery = { status: { $in: ['active', 'matured', 'redeemed'] } };
      if (!scope.isAdmin) {
        if (scope.clientIds.length === 0) return textResult({ items: [], count: 0 });
        const scopedAccountIds = scope.bankAccounts.map(a => a.accountNumber);
        const accounts = await BankAccountsCollection.find({
          $or: [
            ...(scope.entityIds.length > 0 ? [{ entityId: { $in: scope.entityIds } }] : []),
            ...(scope.userIds.length > 0 ? [{ userId: { $in: scope.userIds } }] : [])
          ]
        }, { fields: { _id: 1 } }).fetchAsync();
        const accountIds = accounts.map(a => a._id);
        allocQuery.$or = [
          { clientId: { $in: scope.clientIds } },
          ...(accountIds.length > 0 ? [{ bankAccountId: { $in: accountIds } }] : [])
        ];
      }
      const allocations = await AllocationsCollection.find(allocQuery, { fields: { productId: 1 } }).fetchAsync();
      const productIds = [...new Set(allocations.map(a => a.productId))];
      if (productIds.length === 0) return textResult({ items: [], count: 0 });

      const ahead = Math.max(1, Math.min(365 * 5, Math.floor(daysAhead || 90)));
      const now = new Date();
      const until = new Date(now.getTime() + ahead * 86400e3);
      const allowedTypes = (types && types.length) ? new Set(types) : null;

      // Three sources in priority order:
      //   1. ScheduleCollection (materialized timeline — rarely populated today)
      //   2. Latest Report's observationAnalysis.observations (pre-computed by the nightly cron)
      //   3. product.observationSchedule (raw schedule from termsheet extractor)
      const schedules = await ScheduleCollection.find(
        { productId: { $in: productIds } },
        { fields: { productId: 1, productName: 1, productIsin: 1, currency: 1, events: 1 } }
      ).fetchAsync();
      const scheduleByProduct = new Map(schedules.map(s => [s.productId, s]));

      const reports = await TemplateReportsCollection.find(
        { productId: { $in: productIds } },
        {
          sort: { evaluationDate: -1 },
          fields: {
            productId: 1, productName: 1, productIsin: 1, currency: 1,
            maturityDate: 1,
            'templateResults.observationAnalysis': 1
          }
        }
      ).fetchAsync();
      const latestReportByProduct = new Map();
      for (const r of reports) {
        if (!latestReportByProduct.has(r.productId)) latestReportByProduct.set(r.productId, r);
      }

      const products = await ProductsCollection.find(
        { _id: { $in: productIds } },
        { fields: { title: 1, isin: 1, currency: 1, observationSchedule: 1, maturityDate: 1, maturity: 1, finalObservationDate: 1, finalObservation: 1 } }
      ).fetchAsync();
      const productById = new Map(products.map(p => [p._id, p]));

      const items = [];
      const productsWithNoScheduleData = [];

      for (const productId of productIds) {
        const product = productById.get(productId);
        const productName = product?.title || null;
        const productIsin = product?.isin || null;
        const currency = product?.currency || null;
        let source = null;

        const sched = scheduleByProduct.get(productId);
        if (sched && (sched.events || []).length > 0) {
          source = 'schedule_collection';
          for (const ev of sched.events) {
            if (!ev.date) continue;
            const d = new Date(ev.date);
            if (d < now || d > until) continue;
            if (allowedTypes && !allowedTypes.has(ev.type)) continue;
            items.push({
              date: d,
              type: ev.type,
              product: sched.productName || productName,
              productIsin: sched.productIsin || productIsin,
              productId,
              description: ev.description || null,
              couponRate: ev.couponRate ?? null,
              redemptionAmount: ev.redemptionAmount ?? null,
              currency: sched.currency || currency,
              status: ev.status || 'upcoming',
              source
            });
          }
          continue;
        }

        const report = latestReportByProduct.get(productId);
        const reportObs = report?.templateResults?.observationAnalysis?.observations;
        if (Array.isArray(reportObs) && reportObs.length > 0) {
          source = 'evaluation_report';
          for (const obs of reportObs) {
            const dateField = obs.observationDate || obs.date;
            if (!dateField) continue;
            const d = new Date(dateField);
            if (d < now || d > until) continue;
            const obsType = obs.status === 'cancelled' ? 'observation' : 'observation';
            if (allowedTypes && !allowedTypes.has(obsType)) continue;
            items.push({
              date: d,
              type: obsType,
              product: report.productName || productName,
              productIsin: report.productIsin || productIsin,
              productId,
              description: obs.description || `Observation period ${obs.periodIndex ?? ''}`.trim(),
              couponBarrier: obs.couponBarrier ?? null,
              autocallLevel: obs.autocallLevel ?? null,
              isCallable: obs.isCallable ?? null,
              couponRate: obs.couponRate ?? null,
              status: obs.status || 'upcoming',
              currency: report.currency || currency,
              source
            });
          }
        } else if (Array.isArray(product?.observationSchedule) && product.observationSchedule.length > 0) {
          source = 'product_observation_schedule';
          for (const o of product.observationSchedule) {
            if (!o.observationDate) continue;
            const d = new Date(o.observationDate);
            if (d < now || d > until) continue;
            if (allowedTypes && !allowedTypes.has('observation')) continue;
            items.push({
              date: d,
              type: 'observation',
              product: productName,
              productIsin,
              productId,
              description: `Observation period ${o.periodIndex ?? ''}`.trim(),
              couponBarrier: o.couponBarrier ?? null,
              autocallLevel: o.autocallLevel ?? null,
              isCallable: o.isCallable ?? null,
              currency,
              status: 'upcoming',
              source
            });
          }
        } else {
          productsWithNoScheduleData.push({ productId, productIsin, productName });
        }

        // Synthetic maturity event (always add if in window)
        const maturityDate = product?.maturityDate || product?.maturity;
        if (maturityDate) {
          const m = new Date(maturityDate);
          if (m >= now && m <= until && (!allowedTypes || allowedTypes.has('maturity'))) {
            items.push({
              date: m,
              type: 'maturity',
              product: productName,
              productIsin,
              productId,
              description: 'Product maturity',
              currency,
              status: 'upcoming',
              source: source || 'product'
            });
          }
        }
      }

      items.sort((a, b) => new Date(a.date) - new Date(b.date));

      return textResult({
        asOf: now,
        daysAhead: ahead,
        count: items.length,
        items,
        productsWithNoScheduleData,
        note: 'All event data is pre-computed (either by termsheet extraction into product.observationSchedule or by the nightly evaluation cron into reports). No calculation is performed here.'
      });
    }
  );

  // list_alerts ----------------------------------------------------------
  mcpServer.registerTool(
    'list_alerts',
    {
      description: 'Notifications / alerts for the user (barrier touches, coupon paid, autocalls, overdrafts, etc.). Mirrors the AlertCenter in the web app.',
      inputSchema: {
        unreadOnly: z.boolean().optional().describe('Default true'),
        eventTypes: z.array(z.string()).optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().optional()
      }
    },
    async ({ unreadOnly, eventTypes, from, to, limit }) => {
      const alertEventTypes = [
        'barrier_breached', 'barrier_near', 'underlying_down_20',
        'coupon_paid', 'product_matured', 'autocall_triggered', 'early_redemption',
        'allocation_breach', 'unauthorized_overdraft'
      ];

      const query = {};
      const isAdmin = user.role === 'admin' || user.role === 'superadmin';
      if (!isAdmin) query.sentToUsers = user._id;

      query.eventType = (eventTypes && eventTypes.length) ? { $in: eventTypes } : { $in: alertEventTypes };
      if (unreadOnly !== false) query.readBy = { $ne: user._id };
      if (from || to) {
        query.createdAt = {};
        if (from) query.createdAt.$gte = new Date(from);
        if (to) query.createdAt.$lte = new Date(to);
      }

      const lim = clampLimit(limit);
      const total = await NotificationsCollection.find(query).countAsync();
      const notifs = await NotificationsCollection.find(query, {
        sort: { createdAt: -1 },
        limit: lim
      }).fetchAsync();

      return textResult({
        items: notifs.map(n => ({
          eventType: n.eventType,
          eventTypeLabel: EVENT_TYPE_NAMES[n.eventType] || n.eventType,
          summary: n.summary || null,
          product: n.productName || null,
          productIsin: n.productIsin || null,
          eventDate: n.eventDate || null,
          createdAt: n.createdAt,
          read: Array.isArray(n.readBy) && n.readBy.includes(user._id),
          data: n.eventData || null
        })),
        total,
        hasMore: notifs.length < total
      });
    }
  );

  // list_transactions ----------------------------------------------------
  mcpServer.registerTool(
    'list_transactions',
    {
      description: 'Bank transactions / operations (trades, dividends, coupons, transfers, fees) from PMS operation files. Scoped to the user\'s accounts.',
      inputSchema: {
        entityId: z.string().optional(),
        bankName: z.string().optional(),
        accountNumber: z.string().optional(),
        operationType: z.string().optional().describe('e.g. buy, sell, dividend, coupon, transfer'),
        isinContains: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        limit: z.number().optional(),
        offset: z.number().optional()
      }
    },
    async ({ entityId, bankName, accountNumber, operationType, isinContains, from, to, limit, offset }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const filter = { isActive: true, ...(await buildSnapshotScopeFilter(scope)) };
      if (bankName) {
        const bankId = await resolveBankId(bankName);
        if (!bankId) return textResult({ items: [], total: 0, hasMore: false, note: `No bank matching "${bankName}"` });
        filter.bankId = bankId;
      }
      if (accountNumber) filter.portfolioCode = accountNumber;
      if (operationType) filter.operationType = operationType;
      if (isinContains) filter.isin = { $regex: isinContains, $options: 'i' };
      if (from || to) {
        filter.operationDate = {};
        if (from) filter.operationDate.$gte = new Date(from);
        if (to) filter.operationDate.$lte = new Date(to);
      }

      const lim = clampLimit(limit);
      const skip = Math.max(0, Math.floor(offset || 0));
      const total = await PMSOperationsCollection.find(filter).countAsync();
      const ops = await PMSOperationsCollection.find(filter, {
        sort: { operationDate: -1 },
        limit: lim,
        skip
      }).fetchAsync();

      const bankNameMap = await loadBankNameMap();
      return textResult({
        items: ops.map(o => ({
          date: o.operationDate,
          type: o.operationType,
          typeLabel: o.operationTypeLabel || null,
          direction: o.direction || null,
          isin: o.isin || null,
          instrument: o.instrumentName || null,
          quantity: o.quantity ?? null,
          price: o.price ?? null,
          grossAmount: o.grossAmount ?? null,
          netAmount: o.netAmount ?? null,
          fees: o.totalFees ?? o.fees ?? null,
          currency: o.operationCurrency || null,
          settlementCurrency: o.settlementCurrency || null,
          bank: bankNameMap[o.bankId] || null,
          accountNumber: o.portfolioCode,
          text: o.text || null,
          isReversal: !!o.isReversal
        })),
        total,
        offset: skip,
        limit: lim,
        hasMore: skip + ops.length < total
      });
    }
  );

  // get_underlying_exposure ---------------------------------------------
  mcpServer.registerTool(
    'get_underlying_exposure',
    {
      description: 'Total exposure to a given underlying (ticker, name, or ISIN) across both direct holdings and structured-product underlyings in the user\'s scope.',
      inputSchema: {
        underlying: z.string().describe('Ticker, company name substring, or ISIN (e.g. "MSFT", "Microsoft", "US5949181045")'),
        entityId: z.string().optional()
      }
    },
    async ({ underlying, entityId }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const needle = String(underlying).trim();
      const baseTicker = needle.split('.')[0];
      const re = new RegExp(baseTicker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

      // 1. Direct holdings matching the underlying
      const holdingFilter = {
        isActive: true,
        isLatest: true,
        ...(await buildHoldingScopeFilter(scope)),
        $or: [
          { isin: needle },
          { securityName: re },
          { ticker: re }
        ]
      };
      const directHoldings = await PMSHoldingsCollection.find(holdingFilter, {
        fields: { isin: 1, securityName: 1, quantity: 1, marketValue: 1, currency: 1, bankId: 1, portfolioCode: 1 }
      }).fetchAsync();

      // 2. Structured products in scope that have this underlying
      // First, products allocated to user
      const allocQuery = { status: { $in: ['active'] } };
      if (!scope.isAdmin) {
        if (scope.clientIds.length === 0) {
          return textResult({
            underlying,
            directHoldings: [],
            structuredProductExposure: [],
            total: { directHoldings: 0, structuredProducts: 0 }
          });
        }
        const accounts = await BankAccountsCollection.find({
          $or: [
            ...(scope.entityIds.length > 0 ? [{ entityId: { $in: scope.entityIds } }] : []),
            ...(scope.userIds.length > 0 ? [{ userId: { $in: scope.userIds } }] : [])
          ]
        }, { fields: { _id: 1 } }).fetchAsync();
        const accountIds = accounts.map(a => a._id);
        allocQuery.$or = [
          { clientId: { $in: scope.clientIds } },
          ...(accountIds.length > 0 ? [{ bankAccountId: { $in: accountIds } }] : [])
        ];
      }
      const allocations = await AllocationsCollection.find(allocQuery).fetchAsync();
      const productIds = [...new Set(allocations.map(a => a.productId))];
      let structured = [];
      if (productIds.length > 0) {
        const productQuery = {
          _id: { $in: productIds },
          $or: [
            { 'underlyings.ticker': re },
            { 'underlyings.symbol': re },
            { 'underlyings.name': re },
            { 'underlyings.isin': needle },
            { 'underlyings.securityName': re }
          ]
        };
        const products = await ProductsCollection.find(productQuery, {
          fields: { title: 1, isin: 1, currency: 1, maturityDate: 1, underlyings: 1 }
        }).fetchAsync();

        // Sum allocated nominal per matching product
        const allocByProduct = new Map();
        for (const a of allocations) {
          if (!allocByProduct.has(a.productId)) allocByProduct.set(a.productId, []);
          allocByProduct.get(a.productId).push(a);
        }
        structured = products.map(p => {
          const allocs = allocByProduct.get(p._id) || [];
          const nominalTotal = allocs.reduce((s, a) => s + (a.nominalInvested || 0), 0);
          const matchedUnderlying = (p.underlyings || []).find(u =>
            (u.ticker && re.test(u.ticker)) ||
            (u.symbol && re.test(u.symbol)) ||
            (u.name && re.test(u.name)) ||
            (u.isin && u.isin === needle) ||
            (u.securityName && re.test(u.securityName))
          );
          return {
            product: p.title,
            productIsin: p.isin,
            productId: p._id,
            currency: p.currency,
            maturityDate: p.maturityDate,
            nominalInvested: nominalTotal,
            matchedUnderlying: matchedUnderlying ? {
              name: matchedUnderlying.name || matchedUnderlying.securityName || null,
              ticker: matchedUnderlying.ticker || matchedUnderlying.symbol || null,
              isin: matchedUnderlying.isin || null
            } : null
          };
        });
      }

      const bankNameMap = await loadBankNameMap();
      return textResult({
        underlying: needle,
        directHoldings: directHoldings.map(h => ({
          isin: h.isin,
          securityName: h.securityName,
          quantity: h.quantity,
          marketValue: h.marketValue,
          currency: h.currency,
          bank: bankNameMap[h.bankId] || null,
          accountNumber: h.portfolioCode
        })),
        structuredProductExposure: structured,
        total: {
          directHoldings: directHoldings.length,
          structuredProducts: structured.length,
          totalNominalInvested: structured.reduce((s, x) => s + (x.nominalInvested || 0), 0)
        }
      });
    }
  );

  // get_fx_rate ---------------------------------------------------------
  mcpServer.registerTool(
    'get_fx_rate',
    {
      description: 'Current FX rate for a currency pair (e.g. "EUR/USD"). Returns the most recent cached rate.',
      inputSchema: {
        pair: z.string().describe('Currency pair like "EUR/USD", "EURUSD", or "GBPJPY"')
      }
    },
    async ({ pair }) => {
      const normalized = String(pair).toUpperCase().replace(/[^A-Z]/g, '');
      if (normalized.length !== 6) {
        return errorResult(`Invalid pair "${pair}". Use "EUR/USD" format.`);
      }
      const pairKey = `${normalized}.FOREX`;
      const doc = await CurrencyRateCacheCollection.findOneAsync({ pair: pairKey });
      if (!doc) return errorResult(`No rate found for ${normalized.slice(0, 3)}/${normalized.slice(3)}`);
      return textResult({
        pair: `${normalized.slice(0, 3)}/${normalized.slice(3)}`,
        rate: doc.rate,
        change: doc.change ?? null,
        changePercent: doc.changePercent ?? null,
        asOf: doc.timestamp || doc.updatedAt || null,
        source: doc.source || null
      });
    }
  );

  // list_pending_orders -------------------------------------------------
  mcpServer.registerTool(
    'list_pending_orders',
    {
      description: 'Orders currently awaiting four-eyes validation in the user\'s scope. Most useful for RMs/admins reviewing the validation queue.',
      inputSchema: {
        entityId: z.string().optional(),
        limit: z.number().optional()
      }
    },
    async ({ entityId, limit }) => {
      const scope = await resolveMcpScope(user, { entityId });
      const query = { status: 'pending_validation' };
      if (!scope.isAdmin) {
        if (scope.clientIds.length === 0) return textResult({ items: [], total: 0 });
        query.clientId = { $in: scope.clientIds };
      }
      const lim = clampLimit(limit);
      const total = await OrdersCollection.find(query).countAsync();
      const orders = await OrdersCollection.find(query, {
        sort: { createdAt: 1 }, // oldest first — aging queue
        limit: lim
      }).fetchAsync();
      const bankNameMap = await loadBankNameMap();
      return textResult({
        items: orders.map(o => ({
          ...compactOrder(o, bankNameMap),
          ageHours: o.createdAt ? Math.round((Date.now() - new Date(o.createdAt).getTime()) / 3600e3) : null
        })),
        total,
        hasMore: orders.length < total
      });
    }
  );
}
