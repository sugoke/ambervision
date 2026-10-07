import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import fs from 'fs';
import path from 'path';
import { Random } from 'meteor/random';
import { SessionsCollection, SessionHelpers } from '../../imports/api/sessions.js';
import { issueDocumentToken } from '../documentAccess.js';
import { getOrderTracesDir } from '/imports/api/documentStorage.js';
import { promoteOrderTermsheetToProduct, TERMSHEET_SOURCES as PRODUCT_TERMSHEET_SOURCES } from '../helpers/termsheetSync.js';
import { generatePDFFromHTML } from '../helpers/pdfHelper.js';
import { UsersCollection, UserHelpers } from '../../imports/api/users.js';
import { BanksCollection, BankHelpers } from '../../imports/api/banks.js';
import { BankAccountsCollection, getAuthorizedEmails, accountAllowsOrders } from '../../imports/api/bankAccounts.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { ProductsCollection } from '../../imports/api/products.js';
import { PMSOperationsCollection } from '../../imports/api/pmsOperations.js';
import { OrdersCollection, ORDER_STATUSES, ASSET_TYPES, PRICE_TYPES, TRADE_MODES, ORDER_SOURCE_TYPES, TERMSHEET_STATUSES, EMAIL_TRACE_TYPES, EMAIL_TRACE_LABELS, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, TERMSHEET_EVIDENCE_TYPES, FX_SUBTYPES, TERM_DEPOSIT_TENORS, EXECUTION_TYPE_LABELS, OPTION_TYPES, DEFAULT_OPTION_CONTRACT_SIZE, TERMINAL_ORDER_STATUSES, isPlaceholderIsin, OrderHelpers, OrderFormatters, quotesPriceAsPercent, isShortCall, computeShortCallCoverage, computeOrderEstimatedValue, optionContractDescription, getOrderHealthCheck, HEALTH_FILTER_ANY, TICKET_KINDS, AT_BANK_ORDER_STATUSES, MULTI_INSTANCE_TRACE_TYPES, VALIDITY_TYPES, isModifiableOrder, remainingOrderQuantity } from '../../imports/api/orders.js';
import { EODApiHelpers } from '../../imports/api/eodApi.js';
import { AuditLog } from '/imports/api/auditLog';
import { OrderCountersCollection, OrderCounterHelpers } from '../../imports/api/orderCounters.js';
import { EmailService, EMAIL, emailShell, emailKvTable, emailParagraph, emailButton } from '../../imports/api/emailService.js';
import { AccountProfilesCollection, aggregateToFourCategories, getBreakdownKeyForAssetType, mapOrderAssetTypeToProfileCategory, getProfileName, limitsProfile, isNoProfile } from '../../imports/api/accountProfiles.js';
import { getHoldingCategoryKey } from '../../imports/api/assetClassification.js';
import { SecuritiesMetadataCollection } from '../../imports/api/securitiesMetadata.js';
import { IssuersCollection } from '../../imports/api/issuers.js';
import { isProductCapitalProtected } from '../../imports/api/helpers/productProtection.js';
import {
  isPureCashHolding,
  isCashEquivalentHolding
} from '../../imports/api/helpers/cashCalculator.js';
import {
  getMessage as graphGetMessage,
  getMessageMime as graphGetMessageMime,
  createDraft,
  sendDraft,
  addLargeAttachment,
  findSentByInternetMessageId,
  getMessagesByConversationId,
  searchMessages,
  INLINE_ATTACHMENT_LIMIT
} from '../msgraph/graphClient.js';
import { getGraphConfig } from '../msgraph/config.js';
import { getPublicStatus } from '../msgraph/accountStore.js';
import { createRateLimiter } from '../mcp/rateLimit.js';

/**
 * Order Management Server Methods
 */

/**
 * Trace types that may be supplied inline when an order is created, so the order is
 * inserted with its evidence already attached. Termsheet evidence that drives a status
 * transition is excluded on purpose — it goes through orders.advanceTermsheetWithEvidence.
 */
const CREATION_TRACE_TYPES = [
  EMAIL_TRACE_TYPES.CLIENT_ORDER,
  EMAIL_TRACE_TYPES.INITIAL_TERMSHEET,
  // Structured products: the order as sent to the issuer, checked at four-eyes review
  EMAIL_TRACE_TYPES.ORDER_TO_ISSUER
];

const creationAttachmentPattern = Match.Maybe([{
  traceType: Match.Where(x => CREATION_TRACE_TYPES.includes(x)),
  fileName: String,
  base64Data: String,
  mimeType: Match.Maybe(String)
}]);

/**
 * Evidence shared by every order of a bulk. A client instruction is never shared:
 * it belongs to exactly one client, so each row names its own file. Only the
 * termsheet and the order to the issuer (identical for the whole block) may ride here.
 */
const sharedCreationAttachmentPattern = Match.Maybe([{
  traceType: Match.Where(x => x === EMAIL_TRACE_TYPES.INITIAL_TERMSHEET || x === EMAIL_TRACE_TYPES.ORDER_TO_ISSUER),
  fileName: String,
  base64Data: String,
  mimeType: Match.Maybe(String)
}]);

/**
 * Client instruction files of a bulk, uploaded once and referenced by key from the
 * rows, so one email covering two accounts of the same owner travels once.
 */
const bulkClientOrderFilesPattern = Match.Maybe([{
  key: String,
  fileName: String,
  base64Data: String,
  mimeType: Match.Maybe(String)
}]);

const TERMSHEET_MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.eml': 'message/rfc822',
  '.msg': 'application/vnd.ms-outlook'
};

/**
 * The heading of the instrument section, in both PDF generators.
 */
function instrumentSectionHeading(order) {
  if (order?.assetType === ASSET_TYPES.FX) return 'FX Details';
  if (order?.assetType === ASSET_TYPES.TERM_DEPOSIT) return 'Term Deposit Details';
  if (order?.assetType === ASSET_TYPES.OPTION) return 'Option Details';
  return 'Security Details';
}

/**
 * The option contract as PDF info-rows. Both generators render the same
 * fragment, so the audit trail can never ship without the strike the
 * confirmation carried.
 */
function optionDetailRowsHtml(order) {
  return optionDetailRows(order).map(([label, value]) => `
      <div class="info-row">
        <span class="info-label">${label}</span>
        <span class="info-value">${value}</span>
      </div>`).join('');
}

/**
 * Does this order carry a real ISIN?
 *
 * FX, term deposits and listed options store a placeholder ('FX' / 'TD' /
 * 'OPT'). Printing "ISIN: OPT" on a ticket sent to a bank is worse than
 * printing nothing, so every document drops the row for these.
 */
function hasRealIsin(order) {
  return !!order?.isin && !isPlaceholderIsin(order.isin);
}

/** What `quantity` counts, for the asset type. */
function quantityLabelFor(order) {
  if (order?.assetType === ASSET_TYPES.STRUCTURED_PRODUCT) return 'Nominal';
  if (order?.assetType === ASSET_TYPES.TERM_DEPOSIT || order?.assetType === ASSET_TYPES.FX) return 'Amount';
  if (order?.assetType === ASSET_TYPES.OPTION) return 'Contracts';
  return 'Quantity';
}

/**
 * Contract rows for an option, shared by both emails and both PDFs so the
 * ticket, the confirmation and the audit trail always describe the same trade.
 * Returns [] for anything that isn't an option.
 */
function optionDetailRows(order) {
  if (!order || order.assetType !== ASSET_TYPES.OPTION) return [];
  const rows = [];
  if (order.optionUnderlyingName || order.optionUnderlyingIsin) {
    rows.push(['Underlying', `${order.optionUnderlyingName || ''}${order.optionUnderlyingIsin ? ` (${order.optionUnderlyingIsin})` : ''}`.trim()]);
  }
  if (order.optionType) rows.push(['Call / Put', order.optionType.toUpperCase()]);
  if (order.optionStrike != null) rows.push(['Strike', String(order.optionStrike)]);
  if (order.optionExpiry) rows.push(['Expiry', OrderFormatters.formatDate(order.optionExpiry)]);
  if (order.optionContractSize) {
    const shares = (order.quantity || 0) * order.optionContractSize;
    rows.push(['Contract Size', `${order.optionContractSize} shares${shares ? ` (${OrderFormatters.formatQuantity(shares)} in total)` : ''}`]);
  }
  if (order.optionExchange) rows.push(['Exchange', order.optionExchange]);
  if (order.optionContractSymbol) rows.push(['Contract Symbol', order.optionContractSymbol]);
  if (order.optionQuoteAtEntry && (order.optionQuoteAtEntry.bid != null || order.optionQuoteAtEntry.last != null)) {
    const q = order.optionQuoteAtEntry;
    const parts = [];
    if (q.bid != null && q.ask != null) parts.push(`bid ${q.bid} / ask ${q.ask}`);
    else if (q.last != null) parts.push(`last ${q.last}`);
    if (q.impliedVolatility != null) parts.push(`IV ${Number(q.impliedVolatility).toFixed(1)}%`);
    if (q.updatedAt) parts.push(`as of ${q.updatedAt}`);
    rows.push(['Reference Premium', parts.join(', ')]);
  }
  return rows;
}

/**
 * The issuer record for a structured-product order, or null.
 *
 * Only the fallback behind the order's own issuerContact snapshot -
 * OrderHelpers.resolveIssuerContact decides which one wins.
 */
async function loadOrderIssuer(order) {
  if (!order || order.assetType !== ASSET_TYPES.STRUCTURED_PRODUCT || !order.issuerId) return null;
  try {
    return await IssuersCollection.findOneAsync(order.issuerId);
  } catch (err) {
    console.error(`[ORDERS] Failed to load issuer ${order.issuerId}:`, err.message);
    return null;
  }
}

/**
 * Load the initial termsheet attachment for a structured-product order, if available.
 * Returns { name, content, contentType } with content base64-encoded, or null.
 */
function loadInitialTermsheetAttachment(order) {
  if (!order || order.assetType !== ASSET_TYPES.STRUCTURED_PRODUCT) return null;
  const trace = (order.emailTraces || []).find(t => t.traceType === EMAIL_TRACE_TYPES.INITIAL_TERMSHEET);
  if (!trace?.filePath) return null;
  try {
    if (!fs.existsSync(trace.filePath)) {
      console.warn(`[ORDERS] Termsheet file missing on disk for order ${order.orderReference}: ${trace.filePath}`);
      return null;
    }
    const buffer = fs.readFileSync(trace.filePath);
    const fileName = trace.fileName || `termsheet_${order.orderReference}.pdf`;
    const ext = path.extname(fileName).toLowerCase();
    return {
      name: fileName,
      content: buffer.toString('base64'),
      contentType: TERMSHEET_MIME_BY_EXT[ext] || 'application/octet-stream'
    };
  } catch (err) {
    console.error(`[ORDERS] Failed to read termsheet for order ${order.orderReference}:`, err);
    return null;
  }
}

/**
 * Latest active non-cash positions for one bank account.
 *
 * Shared by the sell-order position picker and the short-call coverage check so
 * both ask the same question of the same rows. The userId-then-bankId fallback
 * is load-bearing, not defensive: accounts created after the entity migration
 * carry no userId, and for those only the bankId branch returns anything.
 */
async function findAccountHoldings(resolved, bankAccount) {
  const holdingsQuery = {
    isActive: true,
    isLatest: true,
    portfolioCode: { $regex: new RegExp('^' + bankAccount.accountNumber.split('-')[0]) },
    assetClass: { $nin: ['cash', 'liquidity', 'Cash', 'Liquidity', 'CASH'] },
    securityName: { $not: /^(cash|liquidity|compte|konto)/i }
  };
  const holdingsOpts = {
    fields: {
      isin: 1, securityName: 1, quantity: 1, marketValue: 1,
      currency: 1, assetClass: 1, marketPrice: 1, snapshotDate: 1
    },
    sort: { securityName: 1 }
  };

  let holdings = await PMSHoldingsCollection.find(
    { ...holdingsQuery, userId: resolved.holdingsUserId }, holdingsOpts
  ).fetchAsync();
  if (holdings.length === 0) {
    holdings = await PMSHoldingsCollection.find(
      { ...holdingsQuery, bankId: bankAccount.bankId }, holdingsOpts
    ).fetchAsync();
  }
  return holdings;
}

/**
 * Contracts already written against an underlying in this account by other
 * live short-call orders.
 *
 * Without this, two 750-contract calls each look covered against 150,000 shares
 * while together they are twice the position. Cancelled and rejected orders drop
 * out via TERMINAL_ORDER_STATUSES.
 */
async function committedShortCallContracts({ bankAccountId, underlyingIsin, excludeOrderId }) {
  if (!bankAccountId || !underlyingIsin) return { contracts: 0, orderRefs: [] };

  const others = await OrdersCollection.find({
    assetType: ASSET_TYPES.OPTION,
    optionType: OPTION_TYPES.CALL,
    orderType: 'sell',
    bankAccountId,
    optionUnderlyingIsin: underlyingIsin,
    status: { $nin: TERMINAL_ORDER_STATUSES },
    ...(excludeOrderId ? { _id: { $ne: excludeOrderId } } : {})
  }, { fields: { quantity: 1, optionContractSize: 1, orderReference: 1 } }).fetchAsync();

  return {
    contracts: others.reduce((sum, o) => sum + (o.quantity || 0), 0),
    orderRefs: others.map(o => o.orderReference).filter(Boolean)
  };
}

/**
 * Does the account hold enough of the underlying to cover this short call?
 *
 * Returns the stored `coverageCheck` shape, or null when the order isn't a
 * short call. Never throws for a business reason - coverage flags, it does not
 * block, so a failure here must not stop an order being raised.
 */
async function resolveShortCallCoverage({ resolved, bankAccount, order, excludeOrderId }) {
  const holdings = await findAccountHoldings(resolved, bankAccount);
  const { contracts: committedContracts, orderRefs } = await committedShortCallContracts({
    bankAccountId: bankAccount._id,
    underlyingIsin: order.optionUnderlyingIsin,
    excludeOrderId
  });

  const contractSize = order.optionContractSize || DEFAULT_OPTION_CONTRACT_SIZE;
  const maths = computeShortCallCoverage({
    contracts: order.quantity,
    contractSize,
    underlyingIsin: order.optionUnderlyingIsin,
    holdings,
    committedContracts
  });

  // The valuation date behind heldShares, so a stale comparison is visible
  // rather than silently trusted.
  const matching = holdings.filter(h =>
    String(h.isin || '').toUpperCase() === String(order.optionUnderlyingIsin || '').toUpperCase());
  const holdingsAsOf = matching.reduce(
    (latest, h) => (h.snapshotDate && (!latest || h.snapshotDate > latest) ? h.snapshotDate : latest),
    null
  );

  return {
    kind: 'short_call',
    underlyingIsin: order.optionUnderlyingIsin || null,
    underlyingName: order.optionUnderlyingName || (matching[0] && matching[0].securityName) || null,
    contracts: order.quantity,
    contractSize,
    ...maths,
    holdingsAsOf,
    committedOrderRefs: orderRefs,
    checkedAt: new Date()
  };
}

// How far back an order on the same security and account counts as "recent" in
// the order modal's duplicate warning. Bank files catch up within a few days.
const RECENT_ORDER_DAYS = 7;

/**
 * Validate session and return user info
 * @param {String} sessionId - Session ID
 * @returns {Object} - { user, userId, userDisplayName }
 */
async function validateSession(sessionId) {
  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionHelpers.findByToken(sessionId);

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid or expired session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  const fn = user.profile?.firstName || '';
  const ln = user.profile?.lastName || '';
  const userDisplayName = `${fn} ${ln}`.trim() || user.username || user._id;

  return { user, userId: user._id, userDisplayName };
}

/**
 * Validate that user has permission to place orders (RM, Admin, or Superadmin only)
 * @param {Object} user - User object
 */
function validateOrderPermission(user) {
  if (!OrderHelpers.canPlaceOrders(user.role)) {
    throw new Meteor.Error('not-authorized', 'Only RMs and Admins can place orders');
  }
}

// How long a review lock stays "fresh". After this, another reviewer may
// take it over — protects against a closed-tab claim permablocking an order.
const REVIEW_LOCK_TTL_MS = 5 * 60 * 1000;

/**
 * Validate that user can access a specific order
 * @param {Object} order - Order object
 * @param {Object} user - User object
 */
async function validateOrderAccess(order, user) {
  if (!order) {
    throw new Meteor.Error('not-found', 'Order not found');
  }

  // Admins, superadmins, and compliance can access all orders
  if (user.role === 'admin' || user.role === 'superadmin' || user.role === 'compliance') {
    return true;
  }

  // 'Can validate any order': a validator may review and validate an order awaiting
  // validation for ANY client, not only those they manage. This only opens orders
  // that are in the four-eyes queue - it gives no other rights on other RMs' orders.
  const AWAITING_VALIDATION = [ORDER_STATUSES.PENDING_VALIDATION, ORDER_STATUSES.PENDING_MODIFICATION];
  if (user.canValidateAnyOrder === true
      && (user.canValidateOrders === true || user.role === 'compliance')
      && AWAITING_VALIDATION.includes(order.status)) {
    return true;
  }

  // RMs/Assistants can access orders for their clients (user-based or entity-based)
  if (user.role === 'rm' || user.role === 'assistant') {
    const rmIds = UserHelpers.getEffectiveRmIds(user);
    // Check user-based client
    const client = await UsersCollection.findOneAsync(order.clientId);
    if (client && rmIds.includes(client.relationshipManagerId)) {
      return true;
    }
    // Check entity-based client. Match the canonical selector: an entity is
    // linked to an RM via `assignedUserIds`, with `relationshipManagerId` only a
    // legacy fallback. Matching the deprecated field alone wrongly denied RMs
    // whose entities use assignedUserIds.
    const { ClientEntitiesCollection: EntCol } = require('../../imports/api/clientEntities.js');
    const entity = await EntCol.findOneAsync({
      $or: [
        ...(order.entityId ? [{ _id: order.entityId }] : []),
        { _id: order.clientId },
        { migratedFromUserId: order.clientId }
      ],
      isActive: true
    });
    if (entity && (
      rmIds.includes(entity.relationshipManagerId) ||
      (entity.assignedUserIds || []).some(id => rmIds.includes(id))
    )) {
      return true;
    }
  }

  throw new Meteor.Error('not-authorized', 'You do not have access to this order');
}

/**
 * Resolve a clientId that may be a user ID or entity ID.
 * Returns { holdingsUserId, relationshipManagerId, profile, entityId }
 */
async function resolveClientId(clientId) {
  // Try user first
  const userClient = await UsersCollection.findOneAsync(clientId);
  if (userClient) {
    return {
      holdingsUserId: clientId,
      relationshipManagerId: userClient.relationshipManagerId,
      profile: userClient.profile,
      entityId: null
    };
  }

  // Try entity (direct ID or migratedFromUserId)
  const { ClientEntitiesCollection: EntCol } = require('../../imports/api/clientEntities.js');
  let entity = await EntCol.findOneAsync({ _id: clientId, isActive: true });
  if (!entity) {
    entity = await EntCol.findOneAsync({ migratedFromUserId: clientId, isActive: true });
  }

  if (entity) {
    return {
      holdingsUserId: entity.migratedFromUserId || clientId,
      relationshipManagerId: entity.relationshipManagerId,
      profile: entity.profile,
      entityId: entity._id
    };
  }

  throw new Meteor.Error('invalid-client', 'Client not found');
}

/**
 * Check allocation impact of a new order against profile limits.
 * Reusable by both the preview method and inline in orders.create.
 */
async function checkAllocationImpact({ bankAccountId, clientId, assetType, estimatedValue, capitalProtected }) {
  const storedProfile = await AccountProfilesCollection.findOneAsync({ bankAccountId });
  // "No profile" accounts have no limits to check, like accounts without a profile
  const profile = limitsProfile(storedProfile);
  if (!profile) {
    return { hasProfile: false, noProfile: isNoProfile(storedProfile), hasBreaches: false };
  }

  const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
  if (!bankAccount) {
    return { hasProfile: true, hasBreaches: false };
  }

  // Resolve client for holdings lookup
  let holdingsUserId = clientId;
  try {
    const resolved = await resolveClientId(clientId);
    holdingsUserId = resolved.holdingsUserId;
  } catch (e) {
    // If client can't be resolved, return without breach check
    return { hasProfile: true, hasBreaches: false };
  }

  // Get all holdings for this account (including cash)
  const portfolioRegex = new RegExp('^' + bankAccount.accountNumber.split('-')[0]);
  let holdings = await PMSHoldingsCollection.find({
    userId: holdingsUserId,
    isActive: true,
    isLatest: true,
    portfolioCode: { $regex: portfolioRegex }
  }).fetchAsync();
  // Fallback: try by bankId + portfolioCode for entity-based accounts
  if (holdings.length === 0) {
    holdings = await PMSHoldingsCollection.find({
      bankId: bankAccount.bankId,
      isActive: true,
      isLatest: true,
      portfolioCode: { $regex: portfolioRegex }
    }).fetchAsync();
  }

  // Separate cash and investment holdings
  const cashHoldings = holdings.filter(h => {
    const ac = (h.assetClass || '').toLowerCase();
    const name = (h.securityName || '').toLowerCase();
    return ac === 'cash' || ac === 'liquidity' || /^(cash|liquidity|compte|konto)/i.test(name);
  });
  const investmentHoldings = holdings.filter(h => {
    const ac = (h.assetClass || '').toLowerCase();
    const name = (h.securityName || '').toLowerCase();
    return !(ac === 'cash' || ac === 'liquidity' || /^(cash|liquidity|compte|konto)/i.test(name));
  });

  // Build assetClassBreakdown from holdings (mirrors portfolioSnapshots.js logic)
  const assetClassBreakdown = {};
  const cashTotal = cashHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
  if (cashTotal > 0) {
    assetClassBreakdown['cash'] = cashTotal;
  }

  // Batch lookup securities metadata
  const isins = [...new Set(investmentHoldings.map(h => h.isin).filter(Boolean))];
  const metadataMap = {};
  if (isins.length > 0) {
    const metadataRecords = await SecuritiesMetadataCollection.find({
      isin: { $in: isins }
    }).fetchAsync();
    metadataRecords.forEach(record => { metadataMap[record.isin] = record; });
  }

  // Classification lives in assetClassification.js - shared with the snapshot
  // builder, the PMS screen and the portfolio review generator.
  investmentHoldings.forEach(h => {
    const categoryKey = getHoldingCategoryKey(h, h.isin ? metadataMap[h.isin] : null);
    assetClassBreakdown[categoryKey] = (assetClassBreakdown[categoryKey] || 0) + (h.marketValue || 0);
  });

  const totalValue = Object.values(assetClassBreakdown).reduce((sum, v) => sum + v, 0);
  if (totalValue === 0) {
    return { hasProfile: true, hasBreaches: false };
  }

  // Current allocation
  const currentAllocation = aggregateToFourCategories(assetClassBreakdown, totalValue);

  // Projected allocation: add estimated value to the appropriate breakdown key
  const breakdownKey = getBreakdownKeyForAssetType(assetType, !!capitalProtected);
  const projectedBreakdown = { ...assetClassBreakdown };
  projectedBreakdown[breakdownKey] = (projectedBreakdown[breakdownKey] || 0) + estimatedValue;
  const projectedTotal = totalValue + estimatedValue;
  const projectedAllocation = aggregateToFourCategories(projectedBreakdown, projectedTotal);

  // Compare against limits
  const profileLimits = {
    maxCash: profile.maxCash,
    maxBonds: profile.maxBonds,
    maxEquities: profile.maxEquities,
    maxAlternative: profile.maxAlternative
  };

  const breaches = [];
  const checks = [
    { category: 'cash', projected: projectedAllocation.cash, current: currentAllocation.cash, limit: profile.maxCash },
    { category: 'bonds', projected: projectedAllocation.bonds, current: currentAllocation.bonds, limit: profile.maxBonds },
    { category: 'equities', projected: projectedAllocation.equities, current: currentAllocation.equities, limit: profile.maxEquities },
    { category: 'alternative', projected: projectedAllocation.alternative, current: currentAllocation.alternative, limit: profile.maxAlternative }
  ];

  for (const c of checks) {
    if (c.projected > c.limit) {
      breaches.push(c);
    }
  }

  const orderCategory = mapOrderAssetTypeToProfileCategory(assetType, { capitalProtected: !!capitalProtected });

  return {
    hasProfile: true,
    hasBreaches: breaches.length > 0,
    profileName: getProfileName(profile),
    currentAllocation,
    projectedAllocation,
    profileLimits,
    breaches,
    orderCategory
  };
}

// ---------------------------------------------------------------------------
// Amendments & cancellations of live orders (four-eyes)
//
// Both go through `pendingModification` (kind 'amend' | 'cancel'): the RM files
// the request with the client's instruction, a second validator applies it, and
// if the bank already had the order the validator then sends it an amendment /
// cancellation ticket. Until that ticket is out, `pendingBankNotice` says so.
// ---------------------------------------------------------------------------

const isOrderValidator = (user) => user.canValidateOrders === true || user.role === 'compliance';

/**
 * A priced order must carry its price: a limit (or stop-limit) order without a
 * limit, or a stop order without a stop, reaches the bank as an instruction it
 * cannot execute — or worse, executes "at market" by default.
 */
const assertOrderPriceLevels = ({ priceType, limitPrice, stopPrice }) => {
  const positive = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if ((priceType === PRICE_TYPES.LIMIT || priceType === PRICE_TYPES.STOP_LIMIT) && !positive(limitPrice)) {
    throw new Meteor.Error('missing-limit-price', 'A limit order needs a limit price above zero');
  }
  if ((priceType === PRICE_TYPES.STOP_LOSS || priceType === PRICE_TYPES.STOP_LIMIT) && !positive(stopPrice)) {
    throw new Meteor.Error('missing-stop-price', 'A stop order needs a stop price above zero');
  }
};

/** A change can only be requested on a live order with nothing else in flight. */
const assertOrderChangeable = (order) => {
  if (!isModifiableOrder(order)) {
    throw new Meteor.Error('invalid-operation',
      'Only live orders (validated, transmitted or partially executed) can be modified or cancelled');
  }
  // A second change before the first reached the bank would describe a
  // "previous" state the bank never saw.
  if (order.pendingBankNotice) {
    throw new Meteor.Error('bank-notice-pending',
      `The previous ${order.pendingBankNotice.kind === TICKET_KINDS.CANCEL ? 'cancellation' : 'amendment'} has not been sent to the bank yet — send it first.`);
  }
};

/** Store the client's instruction for a change request next to the order's traces. */
const saveChangeInstructionFile = (orderId, file, prefix) => {
  try {
    const ordersDir = path.join(getOrderTracesDir(), orderId);
    if (!fs.existsSync(ordersDir)) {
      fs.mkdirSync(ordersDir, { recursive: true });
    }
    const ext = path.extname(file.fileName).toLowerCase();
    const storedFileName = `${prefix}_${Date.now()}${ext}`;
    const filePath = path.join(ordersDir, storedFileName);
    fs.writeFileSync(filePath, Buffer.from(file.base64Data, 'base64'));
    return {
      fileName: file.fileName,
      mimeType: file.mimeType,
      filePath,
      storedFileName
    };
  } catch (err) {
    console.error('[ORDERS] Error saving change instruction file:', err);
    throw new Meteor.Error('file-system-error', 'Failed to save client instruction file');
  }
};

/** Put a change request on the order and tell the validators. */
const fileOrderChangeRequest = async ({ order, kind, oldValues, newValues, reason, instructionFile, userId, userDisplayName }) => {
  const pendingModification = {
    _id: Random.id(),
    kind,
    requestedBy: userId,
    requestedByName: userDisplayName,
    requestedAt: new Date(),
    reason: reason || null,
    oldValues,
    newValues,
    instructionFile,
    statusBeforeModification: order.status,
    status: 'pending' // pending | validated | rejected
  };

  // Compare-and-set on the status so two simultaneous requests cannot both land
  const updated = await OrdersCollection.updateAsync(
    { _id: order._id, status: order.status },
    {
      $set: {
        status: ORDER_STATUSES.PENDING_MODIFICATION,
        pendingModification,
        updatedAt: new Date(),
        updatedBy: userId
      }
    }
  );
  if (!updated) {
    throw new Meteor.Error('conflict', 'The order changed in the meantime — please refresh and try again.');
  }

  const isCancel = kind === TICKET_KINDS.CANCEL;
  console.log(`[ORDERS] ${isCancel ? 'Cancellation' : 'Modification'} requested on order ${order.orderReference} by ${userDisplayName} (${userId}) - reason: ${reason || 'none'}`);

  AuditLog.record({
    actorUserId: userId,
    action: isCancel ? 'order.cancellation.requested' : 'order.modification.requested',
    targetType: 'order',
    targetId: order._id,
    meta: { orderReference: order.orderReference, reason: reason || null, ...(isCancel ? {} : { newValues }) }
  });

  try {
    const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
    const validators = await UsersCollection.find({
      $or: [{ canValidateOrders: true }, { role: 'compliance' }],
      _id: { $ne: userId },
      role: { $in: ['superadmin', 'admin', 'rm', 'compliance', 'staff'] }
    }).fetchAsync();

    for (const validator of validators) {
      await NotificationHelpers.create({
        userId: validator._id,
        type: 'warning',
        title: isCancel ? 'Order Cancellation Pending' : 'Order Modification Pending',
        message: `${userDisplayName} requested ${isCancel ? 'the cancellation of' : 'a modification on'} order ${order.orderReference} (${order.securityName}).`,
        metadata: { orderId: order._id, orderReference: order.orderReference },
        eventType: EVENT_TYPES.ORDER_CREATED
      });
    }
  } catch (notifError) {
    console.error('[ORDERS] Error sending change-request notification:', notifError);
  }

  return pendingModification;
};

/**
 * limitHistory entry for a processed change request. Quantity / validity keys
 * are only written when the request carried them: older requests predate those
 * fields, and an absent key is how describeOrderChange knows it wasn't changed.
 */
const buildChangeHistoryEntry = (mod) => {
  const o = mod.oldValues || {};
  const n = mod.newValues || {};
  const entry = {
    _id: Random.id(),
    kind: mod.kind || TICKET_KINDS.AMEND,
    changedAt: mod.requestedAt,
    changedBy: mod.requestedBy,
    changedByName: mod.requestedByName,
    reason: mod.reason,
    instructionFile: mod.instructionFile ? {
      fileName: mod.instructionFile.fileName,
      storedFileName: mod.instructionFile.storedFileName
    } : null
  };
  if (entry.kind === TICKET_KINDS.CANCEL) return entry;

  Object.assign(entry, {
    price: o.limitPrice ?? null,
    priceType: o.priceType ?? null,
    stopLossPrice: o.stopLossPrice ?? null,
    takeProfitPrice: o.takeProfitPrice ?? null,
    newPrice: n.limitPrice ?? null,
    newPriceType: n.priceType ?? null,
    newStopLossPrice: n.stopLossPrice ?? null,
    newTakeProfitPrice: n.takeProfitPrice ?? null
  });
  if ('quantity' in n) {
    entry.quantity = o.quantity ?? null;
    entry.newQuantity = n.quantity ?? null;
  }
  if ('validityType' in n) {
    entry.validityType = o.validityType ?? null;
    entry.validityDate = o.validityDate ?? null;
    entry.newValidityType = n.validityType ?? null;
    entry.newValidityDate = n.validityDate ?? null;
  }
  return entry;
};

/** The latest validated change the bank still has to be told about, if any. */
const findPendingNoticeEntry = (order) => {
  const historyId = order?.pendingBankNotice?.historyId;
  if (!historyId) return null;
  return (order.limitHistory || []).find(entry => entry._id === historyId) || null;
};

/**
 * Record that an amendment / cancellation notice reached the bank: stamp the
 * history entry and clear pendingBankNotice. No-op if nothing was pending.
 */
const markBankNoticeSent = async ({ order, sentMethod, userId, traceId = null }) => {
  const historyId = order?.pendingBankNotice?.historyId;
  if (!historyId) return;
  const sentAt = new Date();
  await OrdersCollection.updateAsync(
    { _id: order._id, 'limitHistory._id': historyId },
    {
      $set: {
        'limitHistory.$.bankNotice.sentAt': sentAt,
        'limitHistory.$.bankNotice.sentMethod': sentMethod,
        'limitHistory.$.bankNotice.sentBy': userId,
        ...(traceId ? { 'limitHistory.$.bankNotice.traceId': traceId } : {}),
        pendingBankNotice: null,
        updatedAt: sentAt,
        updatedBy: userId
      }
    }
  );
  AuditLog.record({
    actorUserId: userId,
    action: 'order.bankNotice.sent',
    targetType: 'order',
    targetId: order._id,
    meta: { orderReference: order.orderReference, kind: order.pendingBankNotice.kind, via: sentMethod }
  });
};

/** Trace type a bank ticket of this kind is filed under. */
const traceTypeForTicket = (ticketKind) => (
  ticketKind === TICKET_KINDS.CANCEL ? EMAIL_TRACE_TYPES.CANCELLATION_TO_BANK
    : ticketKind === TICKET_KINDS.AMEND ? EMAIL_TRACE_TYPES.AMENDMENT_TO_BANK
      : EMAIL_TRACE_TYPES.ORDER_TO_BANK
);

/**
 * An amendment / cancellation ticket can only be built while the order has a
 * notice of that kind pending — it describes a specific validated change.
 */
const assertTicketKindSendable = (order, ticketKind) => {
  if (!ticketKind || ticketKind === TICKET_KINDS.ORDER) return;
  if (order.pendingBankNotice?.kind !== ticketKind || !findPendingNoticeEntry(order)) {
    throw new Meteor.Error('invalid-operation',
      `This order has no validated ${ticketKind === TICKET_KINDS.CANCEL ? 'cancellation' : 'amendment'} waiting to be sent to the bank.`);
  }
};

/**
 * The original order ticket must not go out while a change request is under
 * review (sending would move the order to TRANSMITTED underneath it), nor for
 * a cancelled order.
 */
const assertOriginalTicketSendable = (order, ticketKind) => {
  if (ticketKind && ticketKind !== TICKET_KINDS.ORDER) return;
  if (order.status === ORDER_STATUSES.PENDING_MODIFICATION) {
    throw new Meteor.Error('invalid-operation', 'A modification or cancellation of this order is awaiting validation — validate or reject it first.');
  }
  if (order.status === ORDER_STATUSES.CANCELLED) {
    throw new Meteor.Error('invalid-operation', 'This order is cancelled.');
  }
};

Meteor.methods({
  /**
   * Generate next order reference number
   */
  async 'orders.generateReference'({ sessionId }) {
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    validateOrderPermission(user);

    return await OrderCounterHelpers.generateNextReference();
  },

  /**
   * Create a new order
   */
  async 'orders.create'({ orderData, attachments, sessionId }) {
    check(sessionId, String);
    check(attachments, creationAttachmentPattern);
    check(orderData, {
      orderType: Match.Where(x => ['buy', 'sell'].includes(x)),
      isin: String,
      securityName: String,
      assetType: Match.Where(x => Object.values(ASSET_TYPES).includes(x)),
      currency: String,
      quantity: Number,
      priceType: Match.Where(x => Object.values(PRICE_TYPES).includes(x)),
      limitPrice: Match.Maybe(Number),
      estimatedValue: Match.Maybe(Number),
      clientId: String,
      bankAccountId: String,
      portfolioCode: Match.Maybe(String),
      sourceHoldingId: Match.Maybe(String),
      forceWithoutSourceHolding: Match.Maybe(Boolean),
      notes: Match.Maybe(String),
      bankComment: Match.Maybe(String),
      bulkOrderGroupId: Match.Maybe(String),
      broker: Match.Maybe(String),
      issuerId: Match.Maybe(String),
      settlementCurrency: Match.Maybe(String),
      underlyings: Match.Maybe(String),
      tradeMode: Match.Maybe(Match.Where(x => Object.values(TRADE_MODES).includes(x))),
      // FX-specific fields
      fxSubtype: Match.Maybe(Match.Where(x => Object.values(FX_SUBTYPES).includes(x))),
      fxPair: Match.Maybe(String),
      fxBuyCurrency: Match.Maybe(String),
      fxSellCurrency: Match.Maybe(String),
      fxRate: Match.Maybe(Number),
      fxAmountCurrency: Match.Maybe(String),
      fxForwardDate: Match.Maybe(String),
      fxValueDate: Match.Maybe(String),
      stopPrice: Match.Maybe(Number),
      stopLossPrice: Match.Maybe(Number),
      takeProfitPrice: Match.Maybe(Number),
      // Validity
      validityType: Match.Maybe(String),
      validityDate: Match.Maybe(String),
      // Attached TP/SL legs
      attachedTakeProfit: Match.Maybe(Number),
      attachedStopLoss: Match.Maybe(Number),
      // Term Deposit-specific fields
      depositTenor: Match.Maybe(String),
      depositCurrency: Match.Maybe(String),
      depositMaturityDate: Match.Maybe(String),
      depositAction: Match.Maybe(String),

      // Listed option fields. `quantity` carries the number of CONTRACTS.
      optionType: Match.Maybe(Match.Where(x => Object.values(OPTION_TYPES).includes(x))),
      optionStrike: Match.Maybe(Number),
      optionExpiry: Match.Maybe(String),
      optionContractSize: Match.Maybe(Number),
      optionUnderlyingIsin: Match.Maybe(String),
      optionUnderlyingName: Match.Maybe(String),
      optionUnderlyingTicker: Match.Maybe(String),
      optionExchange: Match.Maybe(String),
      optionContractSymbol: Match.Maybe(String),
      optionQuoteAtEntry: Match.Maybe(Match.ObjectIncluding({
        bid: Match.Maybe(Match.OneOf(Number, null)),
        ask: Match.Maybe(Match.OneOf(Number, null)),
        last: Match.Maybe(Match.OneOf(Number, null)),
        mid: Match.Maybe(Match.OneOf(Number, null)),
        impliedVolatility: Match.Maybe(Match.OneOf(Number, null)),
        delta: Match.Maybe(Match.OneOf(Number, null)),
        openInterest: Match.Maybe(Match.OneOf(Number, null)),
        updatedAt: Match.Maybe(Match.OneOf(String, null)),
        source: Match.Maybe(String)
      })),
      // Optional reason when the desk writes a call the position doesn't cover.
      coverageJustification: Match.Maybe(String),
      // Allocation check
      capitalProtected: Match.Maybe(Boolean),
      allocationJustification: Match.Maybe(String),
      // Fund quantity mode (units vs nominal cash amount)
      fundQuantityMode: Match.Maybe(Match.Where(x => ['units', 'nominal'].includes(x))),
      // Order source (email or phone)
      orderSource: Match.Maybe(String),
      phoneCallTime: Match.Maybe(String),
      phoneCallLine: Match.Maybe(String),
      // Execution type
      executionType: Match.Maybe(String),
      // Creator attests they will attach the client order trace later
      clientOrderDeferred: Match.Maybe(Boolean)
    });

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    // Validate bank account exists
    const bankAccount = await BankAccountsCollection.findOneAsync({
      _id: orderData.bankAccountId,
      isActive: true
    });
    if (!bankAccount) {
      throw new Meteor.Error('invalid-account', 'Bank account not found');
    }
    // Without a power of attorney the firm may only view the account.
    if (!accountAllowsOrders(bankAccount)) {
      throw new Meteor.Error('view-only-account', 'This account is view only: no power of attorney to place orders on it');
    }

    // Resolve client: try user first, then entity (via bank account's entityId or direct lookup)
    const { ClientEntitiesCollection: EntCol } = require('../../imports/api/clientEntities.js');
    let client = await UsersCollection.findOneAsync(orderData.clientId);
    let resolvedEntityId = bankAccount.entityId || null;

    if (!client) {
      // clientId might be an entity ID directly, or linked via migratedFromUserId
      let entity = await EntCol.findOneAsync({ _id: orderData.clientId, isActive: true });
      if (!entity) {
        entity = await EntCol.findOneAsync({ migratedFromUserId: orderData.clientId, isActive: true });
      }
      if (!entity && bankAccount.entityId) {
        entity = await EntCol.findOneAsync({ _id: bankAccount.entityId, isActive: true });
      }
      if (!entity) {
        throw new Meteor.Error('invalid-client', 'Client not found');
      }
      resolvedEntityId = entity._id;
      // Create minimal client-like object from entity
      client = {
        _id: entity.migratedFromUserId || entity._id,
        profile: entity.profile,
        role: 'client',
        email: null,
        _entityId: entity._id
      };
    }

    // For SELL orders, validate position against the PMS holding.
    //
    // Skipped for term-deposit decreases and for listed options: neither has a
    // PMS holding to point at. A written option creates the position rather than
    // consuming one, so demanding a sourceHoldingId would reject every short
    // call and put outright. Short calls are instead covered by the
    // coverageCheck below, which flags rather than blocks.
    const sellNeedsSourceHolding = orderData.assetType !== ASSET_TYPES.TERM_DEPOSIT
      && orderData.assetType !== ASSET_TYPES.OPTION;
    if (orderData.orderType === 'sell' && sellNeedsSourceHolding) {
      if (!orderData.sourceHoldingId) {
        if (!orderData.forceWithoutSourceHolding) {
          throw new Meteor.Error('invalid-order', 'Source holding required for sell orders');
        }
        // Operator has explicitly forced this sell — bank-side accounting discrepancy.
        // Skip the position validation entirely.
      } else {
        const validation = await OrderHelpers.validateSellOrder(
          orderData.sourceHoldingId,
          orderData.quantity
        );

        if (!validation.valid) {
          throw new Meteor.Error('invalid-quantity', validation.error);
        }
      }
    }

    // Generate order reference
    const orderReference = await OrderCounterHelpers.generateNextReference();

    // Get bank info for the order
    const bank = await BanksCollection.findOneAsync(bankAccount.bankId);

    // Auto-generate wealth ambassador name from creating user
    const waInitials = `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.email || '';

    // Auto-determine trade mode
    const tradeMode = orderData.tradeMode || (orderData.bulkOrderGroupId ? TRADE_MODES.BLOCK : TRADE_MODES.INDIVIDUAL);

    // Snapshot the issuer's contact details onto the order. The issuer record can be
    // edited or deactivated later, so the order keeps the coordinates that were in
    // force when it was placed (and the audit trail stays truthful).
    let issuerSnapshot = { issuerName: null, issuerContact: null };
    if (orderData.issuerId) {
      const issuer = await IssuersCollection.findOneAsync(orderData.issuerId);
      if (!issuer) {
        throw new Meteor.Error('invalid-issuer', 'Selected issuer no longer exists');
      }
      issuerSnapshot = {
        issuerName: issuer.name || null,
        issuerContact: {
          name: issuer.contactName || null,
          email: issuer.contactEmail || null,
          phone: issuer.contactPhone || null,
          code: issuer.code || null,
          capturedAt: new Date()
        }
      };
    }

    // Create order document
    assertOrderPriceLevels(orderData);
    const hasLimitPrice = orderData.priceType === 'limit' || orderData.priceType === 'stop_limit';
    const order = {
      orderReference,
      orderType: orderData.orderType,
      isin: orderData.isin.toUpperCase(),
      securityName: orderData.securityName,
      assetType: orderData.assetType,
      currency: orderData.currency.toUpperCase(),
      quantity: orderData.quantity,
      priceType: orderData.priceType,
      limitPrice: hasLimitPrice ? orderData.limitPrice : null,
      // Typed or computed in the ticket; when the ticket sent none, derive it from
      // the order's own nominal and limit price so every priced order carries one.
      estimatedValue: orderData.estimatedValue || computeOrderEstimatedValue({
        ...orderData,
        limitPrice: hasLimitPrice ? orderData.limitPrice : null
      }),
      clientId: client._id,
      entityId: resolvedEntityId,
      clientName: client.profile?.companyName || `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || 'Unknown',
      bankAccountId: orderData.bankAccountId,
      bankId: bankAccount.bankId,
      portfolioCode: orderData.portfolioCode || bankAccount.accountNumber,
      sourceHoldingId: orderData.orderType === 'sell' ? (orderData.sourceHoldingId || null) : null,
      forceWithoutSourceHolding: orderData.orderType === 'sell' && !orderData.sourceHoldingId && orderData.forceWithoutSourceHolding ? true : false,
      status: ORDER_STATUSES.PENDING_VALIDATION,
      executedQuantity: 0,
      notes: orderData.notes || null,
      bulkOrderGroupId: orderData.bulkOrderGroupId || null,
      wealthAmbassador: waInitials,
      createdByName: userDisplayName,
      broker: orderData.broker || null,
      issuerId: orderData.issuerId || null,
      issuerName: issuerSnapshot.issuerName,
      issuerContact: issuerSnapshot.issuerContact,
      bankComment: orderData.bankComment || null,
      settlementCurrency: orderData.settlementCurrency || null,
      underlyings: orderData.underlyings || null,
      tradeMode,
      // FX-specific fields
      fxSubtype: orderData.fxSubtype || null,
      fxPair: orderData.fxPair || null,
      fxBuyCurrency: orderData.fxBuyCurrency || null,
      fxSellCurrency: orderData.fxSellCurrency || null,
      fxRate: orderData.fxRate || null,
      fxAmountCurrency: orderData.fxAmountCurrency || null,
      fxForwardDate: orderData.fxForwardDate ? new Date(orderData.fxForwardDate) : null,
      fxValueDate: orderData.fxValueDate ? new Date(orderData.fxValueDate) : null,
      stopPrice: orderData.stopPrice || null,
      stopLossPrice: orderData.stopLossPrice || null,
      takeProfitPrice: orderData.takeProfitPrice || null,
      // Term Deposit-specific fields
      depositTenor: orderData.depositTenor || null,
      depositCurrency: orderData.depositCurrency || null,
      depositMaturityDate: orderData.depositMaturityDate ? new Date(orderData.depositMaturityDate) : null,
      depositAction: orderData.depositAction || null,
      // Validity
      validityType: orderData.validityType || null,
      validityDate: orderData.validityDate ? new Date(orderData.validityDate) : null,
      // Fund quantity mode (units vs nominal cash amount; only set for fund orders)
      ...(orderData.assetType === 'fund' && orderData.fundQuantityMode
        ? { fundQuantityMode: orderData.fundQuantityMode }
        : {}),
      // Listed option contract. Spread conditionally rather than written as
      // `x || null` like the FX/TD fields above, so non-option orders don't each
      // carry eight permanent nulls.
      ...(orderData.assetType === ASSET_TYPES.OPTION ? {
        optionType: orderData.optionType || null,
        optionStrike: orderData.optionStrike ?? null,
        optionExpiry: orderData.optionExpiry ? new Date(orderData.optionExpiry) : null,
        optionContractSize: orderData.optionContractSize || DEFAULT_OPTION_CONTRACT_SIZE,
        optionUnderlyingIsin: orderData.optionUnderlyingIsin || null,
        optionUnderlyingName: orderData.optionUnderlyingName || null,
        optionUnderlyingTicker: orderData.optionUnderlyingTicker || null,
        optionExchange: orderData.optionExchange || null,
        // Only when the contract came from the chain. Typed contracts have no
        // OCC symbol and no reference quote, and writing nulls would make the
        // two cases indistinguishable.
        ...(orderData.optionContractSymbol ? { optionContractSymbol: orderData.optionContractSymbol } : {}),
        ...(orderData.optionQuoteAtEntry ? { optionQuoteAtEntry: { ...orderData.optionQuoteAtEntry, source: orderData.optionQuoteAtEntry.source || 'eod' } } : {})
      } : {}),
      // Order source (email or phone)
      orderSource: orderData.orderSource || 'email',
      ...(orderData.phoneCallTime ? { phoneCallTime: orderData.phoneCallTime } : {}),
      ...(orderData.phoneCallLine ? { phoneCallLine: orderData.phoneCallLine } : {}),
      // Execution type
      executionType: orderData.executionType || 'to_execute',
      // Creator promised to attach the client order later (mobile/technical bypass)
      ...(orderData.clientOrderDeferred
        ? { clientOrderDeferred: { by: userId, byName: userDisplayName, at: new Date() } }
        : {}),
      // Linked order group (set when TP/SL legs are attached)
      linkedOrderGroup: null,
      linkedOrderType: null,
      parentOrderRef: null,
      // Limit modification history
      limitHistory: [],
      createdAt: new Date(),
      createdBy: userId,
      updatedAt: new Date(),
      updatedBy: userId
    };

    // Allocation compliance check (buy orders only, non-blocking)
    if (orderData.orderType === 'buy' && orderData.estimatedValue) {
      try {
        const allocationResult = await checkAllocationImpact({
          bankAccountId: orderData.bankAccountId,
          clientId: orderData.clientId,
          assetType: orderData.assetType,
          estimatedValue: orderData.estimatedValue,
          capitalProtected: orderData.capitalProtected
        });
        if (allocationResult.hasProfile && allocationResult.hasBreaches) {
          order.allocationWarning = {
            breaches: allocationResult.breaches,
            profileName: allocationResult.profileName,
            currentAllocation: allocationResult.currentAllocation,
            projectedAllocation: allocationResult.projectedAllocation,
            profileLimits: allocationResult.profileLimits,
            orderCategory: allocationResult.orderCategory,
            checkedAt: new Date(),
            ...(orderData.allocationJustification ? { justification: orderData.allocationJustification } : {})
          };
          console.log(`[ORDERS] Allocation warning on ${orderReference}: ${allocationResult.breaches.map(b => `${b.category} ${b.projected.toFixed(1)}%>${b.limit}%`).join(', ')}`);
        }
      } catch (allocErr) {
        console.error('[ORDERS] Allocation check error (non-blocking):', allocErr.message);
      }
    }

    // Short-call cover (non-blocking, flags only). Recorded server-side: the
    // modal's panel is a preview, and a client-computed number must never become
    // the audit record.
    if (isShortCall(order)) {
      try {
        const bankAccount = await BankAccountsCollection.findOneAsync(orderData.bankAccountId);
        if (bankAccount) {
          const resolvedClient = await resolveClientId(orderData.clientId);
          order.coverageCheck = {
            ...(await resolveShortCallCoverage({ resolved: resolvedClient, bankAccount, order })),
            ...(orderData.coverageJustification
              ? { justification: orderData.coverageJustification }
              : {})
          };
          if (!order.coverageCheck.isCovered) {
            console.log(`[ORDERS] Uncovered short call on ${orderReference}: ` +
              `${order.coverageCheck.requiredShares} required, ${order.coverageCheck.availableShares} available ` +
              `(${order.coverageCheck.heldShares} held less ${order.coverageCheck.committedShares} already written)`);
          }
        }
      } catch (coverErr) {
        // Coverage flags, it never blocks - a failure here must not stop the order.
        console.error('[ORDERS] Short-call coverage check error (non-blocking):', coverErr.message);
      }
    }

    // Get source position quantity for sell orders
    if (orderData.orderType === 'sell' && orderData.sourceHoldingId) {
      const holding = await PMSHoldingsCollection.findOneAsync(orderData.sourceHoldingId);
      if (holding) {
        order.sourcePositionQuantity = holding.quantity;
      }
    }

    // If attached TP/SL legs, set up linked group
    const hasLinkedOrders = orderData.attachedTakeProfit || orderData.attachedStopLoss;
    if (hasLinkedOrders) {
      order.linkedOrderGroup = orderReference;
    }

    // Creation-time evidence (client order email, initial termsheet) is written to disk
    // and embedded in the document BEFORE the insert, so an order never becomes visible
    // — nor triggers the "pending validation" notification — without the files it was
    // created with. Uploading them in a second round-trip after the insert left a window
    // (seconds, for a large .eml) in which the second pair of eyes could open the order
    // and find no evidence; the window never closed at all if that upload failed or the
    // creator's tab was closed. A rejected attachment now fails the whole creation.
    const orderId = Random.id();
    order._id = orderId;
    order.emailTraces = [];
    // An order keeps one trace per type, and writeTraceFileToOrder deletes the
    // previous file of that type from disk. Two attachments of the same type at
    // creation would therefore silently drop evidence — refuse instead.
    const seenTraceTypes = new Set();
    for (const attachment of (attachments || [])) {
      if (seenTraceTypes.has(attachment.traceType)) {
        throw new Meteor.Error(
          'duplicate-attachment-type',
          `Only one ${EMAIL_TRACE_LABELS[attachment.traceType] || attachment.traceType} file can be attached at creation`
        );
      }
      seenTraceTypes.add(attachment.traceType);
    }
    const writeCreationTraces = async (targetOrder) => {
      for (const attachment of (attachments || [])) {
        const trace = await writeTraceFileToOrder({
          order: targetOrder,
          traceType: attachment.traceType,
          fileName: attachment.fileName,
          base64Data: attachment.base64Data,
          mimeType: attachment.mimeType,
          userId,
          userDisplayName
        });
        // One trace per type: mirror writeTraceFileToOrder's replace semantics locally
        targetOrder.emailTraces = targetOrder.emailTraces
          .filter(t => t.traceType !== attachment.traceType)
          .concat(trace);
      }
    };
    await writeCreationTraces(order);

    await OrdersCollection.insertAsync(order);

    console.log(`[ORDERS] Created order ${orderReference} (${orderId}) by ${userDisplayName} (${userId})`);

    // A structured-product order always carries the termsheet PDF. If a product
    // exists for that ISIN with no term sheet of its own, give it this copy so
    // the product report's Term Sheet button resolves instead of dead-ending.
    // Never blocks order creation — the order's own evidence is already safe.
    const initialTermsheet = (attachments || []).find(
      a => a.traceType === EMAIL_TRACE_TYPES.INITIAL_TERMSHEET
    );
    if (initialTermsheet && order.isin) {
      Meteor.defer(() => promoteOrderTermsheetToProduct({
        isin: order.isin,
        fileName: initialTermsheet.fileName,
        base64Data: initialTermsheet.base64Data,
        source: PRODUCT_TERMSHEET_SOURCES.ORDER_INITIAL,
        userId
      }));
    }

    // Save phone number to user profile for future defaults
    if (orderData.phoneCallLine && orderData.phoneCallLine.trim()) {
      try {
        await UsersCollection.updateAsync(userId, { $set: { 'profile.phoneNumber': orderData.phoneCallLine.trim() } });
      } catch (e) { /* non-blocking */ }
    }

    // Create linked Take Profit order
    if (orderData.attachedTakeProfit) {
      const tpRef = `${orderReference}-TP`;
      const tpOrder = {
        ...order,
        // Own id and own copies of the creation evidence — sharing the parent's
        // filePath would let a delete on one leg orphan the other's trace.
        _id: Random.id(),
        emailTraces: [],
        orderReference: tpRef,
        priceType: PRICE_TYPES.TAKE_PROFIT,
        limitPrice: orderData.attachedTakeProfit,
        stopPrice: null,
        linkedOrderGroup: orderReference,
        linkedOrderType: 'take_profit',
        parentOrderRef: orderReference,
        notes: `Take Profit leg for ${orderReference}${order.notes ? '. ' + order.notes : ''}`,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await writeCreationTraces(tpOrder);
      const tpId = await OrdersCollection.insertAsync(tpOrder);
      console.log(`[ORDERS] Created linked TP order ${tpRef} (${tpId}) for ${orderReference}`);
    }

    // Create linked Stop Loss order
    if (orderData.attachedStopLoss) {
      const slRef = `${orderReference}-SL`;
      const slOrder = {
        ...order,
        // Own id and own copies of the creation evidence (see TP leg above)
        _id: Random.id(),
        emailTraces: [],
        orderReference: slRef,
        priceType: PRICE_TYPES.STOP_LOSS,
        limitPrice: null,
        stopPrice: orderData.attachedStopLoss,
        linkedOrderGroup: orderReference,
        linkedOrderType: 'stop_loss',
        parentOrderRef: orderReference,
        notes: `Stop Loss leg for ${orderReference}${order.notes ? '. ' + order.notes : ''}`,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await writeCreationTraces(slOrder);
      const slId = await OrdersCollection.insertAsync(slOrder);
      console.log(`[ORDERS] Created linked SL order ${slRef} (${slId}) for ${orderReference}`);
    }

    // Notify users with canValidateOrders permission (excluding the creator)
    try {
      const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
      const validators = await UsersCollection.find({
        canValidateOrders: true,
        _id: { $ne: userId },
        role: { $in: ['superadmin', 'admin', 'rm', 'compliance', 'staff'] }
      }).fetchAsync();

      if (validators.length > 0) {
        const validatorIds = validators.map(v => v._id);
        await NotificationHelpers.createForMultipleUsers({
          userIds: validatorIds,
          type: 'warning',
          title: 'Order Pending Validation',
          message: `Order ${orderReference} (${order.securityName}) created by ${userDisplayName} requires validation.`,
          metadata: { orderId, orderReference },
          eventType: EVENT_TYPES.ORDER_PENDING_VALIDATION
        });
      }
    } catch (notifError) {
      console.error('[ORDERS] Error sending validation notification:', notifError);
    }

    // Send email to RM, backup RMs, and superadmins
    try {
      const recipientIds = new Set();
      if (bankAccount.relationshipManagerId) recipientIds.add(bankAccount.relationshipManagerId);
      if (Array.isArray(bankAccount.backupRmIds)) {
        bankAccount.backupRmIds.forEach(id => id && recipientIds.add(id));
      }
      const superadmins = await UsersCollection.find(
        { role: 'superadmin' },
        { fields: { _id: 1, email: 1, username: 1, profile: 1 } }
      ).fetchAsync();
      superadmins.forEach(sa => recipientIds.add(sa._id));
      recipientIds.delete(userId); // never notify the creator

      if (recipientIds.size > 0) {
        const recipientUsers = await UsersCollection.find(
          { _id: { $in: [...recipientIds] } },
          { fields: { _id: 1, email: 1, username: 1, profile: 1, role: 1 } }
        ).fetchAsync();
        const { canReceiveAlertEmails } = await import('/imports/constants/notificationPreferences');
        const toList = recipientUsers
          .filter(canReceiveAlertEmails) // staff only, whatever an account's RM fields hold
          .map(u => {
            const email = u.email || u.username;
            if (!email) return null;
            const name = `${u.profile?.firstName || ''} ${u.profile?.lastName || ''}`.trim() || email;
            return { email, name };
          })
          .filter(Boolean);

        if (toList.length > 0) {
          const accountLabel = bankAccount.name || bankAccount.accountNumber || order.portfolioCode || '';
          const isStructuredProduct = order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT;
          const quantityLabel = quantityLabelFor(order);
          const priceDisplay = order.limitPrice
            ? (isStructuredProduct
                ? `${Number(order.limitPrice).toFixed(2)}%`
                : OrderFormatters.formatWithCurrency(order.limitPrice, order.currency))
            : null;
          const orderBookUrl = Meteor.absoluteUrl('#order-book');
          const subject = `[Pending Validation] ${orderReference} — ${order.securityName || ''}`.trim();
          const pendingRows = [
            ['Direction', String(OrderFormatters.orderDirectionLabel(order)).toUpperCase(), order.orderType === 'buy' ? EMAIL.success : EMAIL.danger],
            [hasRealIsin(order) ? 'Security' : 'Description', order.securityName || ''],
            ...(hasRealIsin(order) ? [['ISIN', `<span style="font-family: Consolas, 'Courier New', monospace;">${order.isin || ''}</span>`]] : []),
            ...optionDetailRows(order),
            [quantityLabel, OrderFormatters.formatQuantity(order.quantity), EMAIL.amberText],
            ...(priceDisplay ? [['Price', priceDisplay]] : []),
            ...(order.estimatedValue ? [['Estimated Value', OrderFormatters.formatWithCurrency(order.estimatedValue, order.currency)]] : []),
            ...(order.broker ? [['Broker', order.broker]] : []),
            ['Client', order.clientName || ''],
            ['Account', accountLabel],
            // The whole point of the flag: the validator sees it before opening
            // the blotter.
            ...(order.coverageCheck && !order.coverageCheck.isCovered
              ? [['Cover', `UNCOVERED SHORT CALL - short by ${OrderFormatters.formatQuantity(order.coverageCheck.shortfallShares)} shares` +
                  (order.coverageCheck.justification ? ` (reason given: ${order.coverageCheck.justification})` : ''), EMAIL.danger]]
              : []),
            ...(order.coverageCheck && order.coverageCheck.isCovered
              ? [['Cover', `Covered - ${OrderFormatters.formatQuantity(order.coverageCheck.heldShares)} shares held`, EMAIL.success]]
              : [])
          ];
          const html = emailShell({
            title: 'Order Pending Validation',
            subtitle: orderReference,
            bodyHtml: `${emailParagraph(`${userDisplayName} just created an order that requires four-eyes validation. Please review it in the Orders blotter.`)}${emailKvTable(pendingRows)}${emailButton(orderBookUrl, 'Open Order Book →')}`,
            signatureName: userDisplayName,
            footerNote: 'This is an automated order notification. Please do not reply to this message.'
          });
          // Derived from the same rows as the HTML rather than written out
          // again. The hand-maintained copy had already drifted - it printed the
          // raw orderType where the HTML printed the direction label, and an
          // ISIN row for FX and term deposits that have none.
          const text = `
Order Pending Validation: ${orderReference}

${userDisplayName} just created an order that requires four-eyes validation.

${pendingRows.map(([label, value]) => `${label}: ${String(value).replace(/<[^>]*>/g, '')}`).join('\n')}

Please review it in the Orders blotter:
${orderBookUrl}

Best regards,
${userDisplayName}
          `.trim();

          await EmailService.sendEmail({ subject, html, text, to: toList });
          console.log(`[ORDERS] Pending-validation email sent to ${toList.length} recipient(s) for ${orderReference}: ${toList.map(r => r.email).join(', ')}`);
        }
      }
    } catch (emailErr) {
      console.error('[ORDERS] Error sending pending-validation email:', emailErr);
    }

    return {
      orderId,
      orderReference,
      order: { ...order, _id: orderId }
    };
  },

  /**
   * Create multiple orders in bulk (same security to multiple accounts)
   */
  async 'orders.createBulk'({ bulkOrderData, attachments, clientOrderFiles, sessionId }) {
    check(sessionId, String);
    // Evidence shared by every order in the block: the termsheet only. A client
    // instruction belongs to one client — sending it here used to copy the same
    // email onto every account and, since an order keeps one trace per type, left
    // each order holding whichever file was dropped last.
    check(attachments, sharedCreationAttachmentPattern);
    // Per-client instructions, keyed so rows of the same owner can share one file.
    check(clientOrderFiles, bulkClientOrderFilesPattern);
    check(bulkOrderData, {
      orderType: Match.Where(x => ['buy', 'sell'].includes(x)),
      isin: String,
      securityName: String,
      assetType: Match.Where(x => Object.values(ASSET_TYPES).includes(x)),
      currency: String,
      priceType: Match.Where(x => Object.values(PRICE_TYPES).includes(x)),
      limitPrice: Match.Maybe(Number),
      // Consideration for the whole block; prorated onto each row by nominal
      // so every order carries its own share for the allocation check.
      estimatedValue: Match.Maybe(Number),
      capitalProtected: Match.Maybe(Boolean),
      notes: Match.Maybe(String),
      // Already forwarded to orders.create via sharedFields below
      bankComment: Match.Maybe(String),
      broker: Match.Maybe(String),
      issuerId: Match.Maybe(String),
      settlementCurrency: Match.Maybe(String),
      underlyings: Match.Maybe(String),
      // FX-specific fields (passed through to individual orders)
      fxSubtype: Match.Maybe(Match.Where(x => Object.values(FX_SUBTYPES).includes(x))),
      fxPair: Match.Maybe(String),
      fxBuyCurrency: Match.Maybe(String),
      fxSellCurrency: Match.Maybe(String),
      fxRate: Match.Maybe(Number),
      fxAmountCurrency: Match.Maybe(String),
      fxForwardDate: Match.Maybe(String),
      fxValueDate: Match.Maybe(String),
      stopPrice: Match.Maybe(Number),
      stopLossPrice: Match.Maybe(Number),
      takeProfitPrice: Match.Maybe(Number),
      // Term Deposit-specific fields
      depositTenor: Match.Maybe(String),
      depositCurrency: Match.Maybe(String),
      depositMaturityDate: Match.Maybe(String),
      depositAction: Match.Maybe(String),
      // Listed option fields (the contract is shared across the block; only the
      // contract count varies per row)
      optionType: Match.Maybe(Match.Where(x => Object.values(OPTION_TYPES).includes(x))),
      optionStrike: Match.Maybe(Number),
      optionExpiry: Match.Maybe(String),
      optionContractSize: Match.Maybe(Number),
      optionUnderlyingIsin: Match.Maybe(String),
      optionUnderlyingName: Match.Maybe(String),
      optionUnderlyingTicker: Match.Maybe(String),
      optionExchange: Match.Maybe(String),
      optionContractSymbol: Match.Maybe(String),
      optionQuoteAtEntry: Match.Maybe(Match.ObjectIncluding({
        bid: Match.Maybe(Match.OneOf(Number, null)),
        ask: Match.Maybe(Match.OneOf(Number, null)),
        last: Match.Maybe(Match.OneOf(Number, null)),
        mid: Match.Maybe(Match.OneOf(Number, null)),
        impliedVolatility: Match.Maybe(Match.OneOf(Number, null)),
        delta: Match.Maybe(Match.OneOf(Number, null)),
        openInterest: Match.Maybe(Match.OneOf(Number, null)),
        updatedAt: Match.Maybe(Match.OneOf(String, null)),
        source: Match.Maybe(String)
      })),
      // Order source (email or phone)
      orderSource: Match.Maybe(String),
      phoneCallTime: Match.Maybe(String),
      phoneCallLine: Match.Maybe(String),
      // Execution type
      executionType: Match.Maybe(String),
      // Validity
      validityType: Match.Maybe(String),
      validityDate: Match.Maybe(String),
      // Fund quantity mode (units vs nominal cash amount)
      fundQuantityMode: Match.Maybe(Match.Where(x => ['units', 'nominal'].includes(x))),
      orders: [{
        clientId: String,
        // Resolved server-side from the bank account by orders.create; accepted here
        // because the client sends it with the row.
        entityId: Match.Maybe(String),
        bankAccountId: String,
        portfolioCode: Match.Maybe(String),
        quantity: Number,
        estimatedValue: Match.Maybe(Number),
        sourceHoldingId: Match.Maybe(String),
        // Evidence specific to this account (per-account client order email)
        attachments: creationAttachmentPattern,
        // Key into clientOrderFiles — this client's own instruction email
        clientOrderFileKey: Match.Maybe(String),
        // Phone instruction taken for this client (overrides the block defaults)
        phoneCallTime: Match.Maybe(String),
        phoneCallLine: Match.Maybe(String)
      }]
    });

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    if (!bulkOrderData.orders || bulkOrderData.orders.length === 0) {
      throw new Meteor.Error('invalid-order', 'At least one order is required');
    }
    // Checked up front so a block without its price fails before any row is created
    assertOrderPriceLevels(bulkOrderData);

    const filesByKey = new Map((clientOrderFiles || []).map(f => [f.key, f]));
    const isPhoneSource = bulkOrderData.orderSource === ORDER_SOURCE_TYPES.PHONE;

    // Generate unique bulk group ID
    const bulkOrderGroupId = `BULK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const createdOrders = [];
    const errors = [];
    const blockQuantity = bulkOrderData.orders.reduce((sum, o) => sum + (o.quantity || 0), 0);

    for (let i = 0; i < bulkOrderData.orders.length; i++) {
      const individualOrder = bulkOrderData.orders[i];

      try {
        // Every client must carry their own instruction. This mirrors the modal's
        // step check so a hand-built payload cannot slip a row through without one.
        const rowHasClientOrder = (individualOrder.attachments || [])
          .some(a => a.traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER);
        let rowClientOrder = null;
        if (individualOrder.clientOrderFileKey) {
          const file = filesByKey.get(individualOrder.clientOrderFileKey);
          if (!file) {
            throw new Meteor.Error('unknown-client-order-file', 'Unknown client instruction file for this account');
          }
          rowClientOrder = {
            traceType: EMAIL_TRACE_TYPES.CLIENT_ORDER,
            fileName: file.fileName,
            base64Data: file.base64Data,
            mimeType: file.mimeType
          };
        }
        if (isPhoneSource) {
          if (!individualOrder.phoneCallTime && !bulkOrderData.phoneCallTime) {
            throw new Meteor.Error('missing-phone-instruction', 'Call time is required for this account');
          }
        } else if (!rowClientOrder && !rowHasClientOrder) {
          throw new Meteor.Error('missing-client-order', 'A client instruction is required for this account');
        }

        // Build individual order data with shared fields
        const sharedFields = {
          orderType: bulkOrderData.orderType,
          isin: bulkOrderData.isin,
          securityName: bulkOrderData.securityName,
          assetType: bulkOrderData.assetType,
          currency: bulkOrderData.currency,
          priceType: bulkOrderData.priceType,
          limitPrice: bulkOrderData.limitPrice,
          notes: bulkOrderData.notes,
          bankComment: bulkOrderData.bankComment,
          broker: bulkOrderData.broker,
          issuerId: bulkOrderData.issuerId,
          settlementCurrency: bulkOrderData.settlementCurrency,
          underlyings: bulkOrderData.underlyings,
          capitalProtected: bulkOrderData.capitalProtected,
          tradeMode: TRADE_MODES.BLOCK,
          bulkOrderGroupId
        };
        // orders.create checks its payload with Match.Maybe(...) per key, but the
        // check package tests a key that is PRESENT with an undefined value against
        // the inner pattern — so a block without notes failed every row with
        // "Expected string, got undefined in field notes". Drop the blanks.
        Object.keys(sharedFields).forEach(key => {
          if (sharedFields[key] === undefined) delete sharedFields[key];
        });
        // Row's share of the block consideration, by nominal. A row that names
        // its own estimate keeps it.
        if (individualOrder.estimatedValue == null && bulkOrderData.estimatedValue > 0 && blockQuantity > 0) {
          const share = bulkOrderData.estimatedValue * (individualOrder.quantity / blockQuantity);
          sharedFields.estimatedValue = Math.round(share * 100) / 100;
        }
        // Pass through FX/TD fields if present
        if (bulkOrderData.fxSubtype) sharedFields.fxSubtype = bulkOrderData.fxSubtype;
        if (bulkOrderData.fxPair) sharedFields.fxPair = bulkOrderData.fxPair;
        if (bulkOrderData.fxBuyCurrency) sharedFields.fxBuyCurrency = bulkOrderData.fxBuyCurrency;
        if (bulkOrderData.fxSellCurrency) sharedFields.fxSellCurrency = bulkOrderData.fxSellCurrency;
        if (bulkOrderData.fxRate) sharedFields.fxRate = bulkOrderData.fxRate;
        if (bulkOrderData.fxAmountCurrency) sharedFields.fxAmountCurrency = bulkOrderData.fxAmountCurrency;
        if (bulkOrderData.fxForwardDate) sharedFields.fxForwardDate = bulkOrderData.fxForwardDate;
        if (bulkOrderData.fxValueDate) sharedFields.fxValueDate = bulkOrderData.fxValueDate;
        if (bulkOrderData.stopPrice) sharedFields.stopPrice = bulkOrderData.stopPrice;
        if (bulkOrderData.stopLossPrice) sharedFields.stopLossPrice = bulkOrderData.stopLossPrice;
        if (bulkOrderData.takeProfitPrice) sharedFields.takeProfitPrice = bulkOrderData.takeProfitPrice;
        if (bulkOrderData.depositTenor) sharedFields.depositTenor = bulkOrderData.depositTenor;
        if (bulkOrderData.depositCurrency) sharedFields.depositCurrency = bulkOrderData.depositCurrency;
        if (bulkOrderData.depositMaturityDate) sharedFields.depositMaturityDate = bulkOrderData.depositMaturityDate;
        if (bulkOrderData.depositAction) sharedFields.depositAction = bulkOrderData.depositAction;
        if (bulkOrderData.orderSource) sharedFields.orderSource = bulkOrderData.orderSource;
        if (bulkOrderData.phoneCallTime) sharedFields.phoneCallTime = bulkOrderData.phoneCallTime;
        if (bulkOrderData.phoneCallLine) sharedFields.phoneCallLine = bulkOrderData.phoneCallLine;
        if (bulkOrderData.executionType) sharedFields.executionType = bulkOrderData.executionType;
        if (bulkOrderData.validityType) sharedFields.validityType = bulkOrderData.validityType;
        if (bulkOrderData.validityDate) sharedFields.validityDate = bulkOrderData.validityDate;
        if (bulkOrderData.fundQuantityMode) sharedFields.fundQuantityMode = bulkOrderData.fundQuantityMode;
        // Listed option contract - shared by the whole block; only the number of
        // contracts differs per row. Each row's coverage is snapshotted for free
        // because every row goes through orders.create.
        if (bulkOrderData.optionType) sharedFields.optionType = bulkOrderData.optionType;
        if (bulkOrderData.optionStrike != null) sharedFields.optionStrike = bulkOrderData.optionStrike;
        if (bulkOrderData.optionExpiry) sharedFields.optionExpiry = bulkOrderData.optionExpiry;
        if (bulkOrderData.optionContractSize) sharedFields.optionContractSize = bulkOrderData.optionContractSize;
        if (bulkOrderData.optionUnderlyingIsin) sharedFields.optionUnderlyingIsin = bulkOrderData.optionUnderlyingIsin;
        if (bulkOrderData.optionUnderlyingName) sharedFields.optionUnderlyingName = bulkOrderData.optionUnderlyingName;
        if (bulkOrderData.optionUnderlyingTicker) sharedFields.optionUnderlyingTicker = bulkOrderData.optionUnderlyingTicker;
        if (bulkOrderData.optionExchange) sharedFields.optionExchange = bulkOrderData.optionExchange;
        if (bulkOrderData.optionContractSymbol) sharedFields.optionContractSymbol = bulkOrderData.optionContractSymbol;
        if (bulkOrderData.optionQuoteAtEntry) sharedFields.optionQuoteAtEntry = bulkOrderData.optionQuoteAtEntry;

        // entityId and attachments are not part of the orders.create payload shape:
        // the entity is resolved from the bank account, and the files are passed
        // alongside so each order is inserted with its evidence already attached.
        const {
          entityId: _rowEntityId,
          attachments: rowAttachments,
          clientOrderFileKey: _rowFileKey,
          ...rowFields
        } = individualOrder;

        const result = await Meteor.callAsync('orders.create', {
          orderData: {
            ...sharedFields,
            ...rowFields
          },
          attachments: [
            ...(attachments || []),
            ...(rowAttachments || []),
            ...(rowClientOrder ? [rowClientOrder] : [])
          ],
          sessionId
        });

        createdOrders.push(result);
      } catch (error) {
        errors.push({
          index: i,
          clientId: individualOrder.clientId,
          error: error.reason || error.message
        });
      }
    }

    console.log(`[ORDERS] Created bulk order group ${bulkOrderGroupId}: ${createdOrders.length} orders, ${errors.length} errors`);

    return {
      bulkOrderGroupId,
      createdOrders,
      errors,
      totalCreated: createdOrders.length,
      totalErrors: errors.length
    };
  },

  /**
   * Update order status
   */
  async 'orders.updateStatus'({ orderId, status, executionData, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(status, Match.Where(x => Object.values(ORDER_STATUSES).includes(x)));
    check(executionData, Match.Maybe({
      executedQuantity: Match.Maybe(Number),
      executedPrice: Match.Maybe(Number),
      executionDate: Match.Maybe(Date),
      linkedHoldingId: Match.Maybe(String)
    }));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Structured products cannot move to an executed status until the final signed termsheet is uploaded
    if ((status === ORDER_STATUSES.EXECUTED || status === ORDER_STATUSES.PARTIALLY_EXECUTED)
        && order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT
        && order.termsheetStatus !== TERMSHEET_STATUSES.SIGNED) {
      throw new Meteor.Error('missing-termsheet', 'Final signed termsheet must be uploaded before this structured product order can be marked executed');
    }

    const updateData = {
      status,
      updatedAt: new Date(),
      updatedBy: userId
    };

    // Handle execution data
    if (executionData) {
      if (executionData.executedQuantity !== undefined) {
        updateData.executedQuantity = executionData.executedQuantity;
      }
      if (executionData.executedPrice !== undefined) {
        updateData.executedPrice = executionData.executedPrice;
      }
      if (executionData.executionDate) {
        updateData.executionDate = executionData.executionDate;
      }
      if (executionData.linkedHoldingId) {
        updateData.linkedHoldingId = executionData.linkedHoldingId;
      }
    }

    await OrdersCollection.updateAsync(orderId, { $set: updateData });

    console.log(`[ORDERS] Updated order ${order.orderReference} status to ${status} by ${userDisplayName} (${userId})`);

    return { success: true, orderId, newStatus: status };
  },

  /**
   * Cancel an order
   */
  async 'orders.cancel'({ orderId, reason, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(reason, Match.Maybe(String));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Direct cancel only while the bank has not received the order. Once it
    // has, the cancellation goes through four-eyes and a ticket to the bank
    // (orders.requestCancellation).
    const cancellableDirectly = [
      ORDER_STATUSES.DRAFT,
      ORDER_STATUSES.PENDING_VALIDATION,
      ORDER_STATUSES.REVISION_REQUESTED,
      ORDER_STATUSES.PENDING
    ];
    if (!cancellableDirectly.includes(order.status)) {
      throw new Meteor.Error('invalid-operation',
        AT_BANK_ORDER_STATUSES.includes(order.status)
          ? 'The bank already has this order — request a cancellation instead, so a cancellation ticket is sent.'
          : 'This order can no longer be cancelled');
    }

    const updated = await OrdersCollection.updateAsync(
      { _id: orderId, status: order.status },
      {
        $set: {
          status: ORDER_STATUSES.CANCELLED,
          cancelledAt: new Date(),
          cancelledBy: userId,
          cancellationReason: reason || null,
          updatedAt: new Date(),
          updatedBy: userId
        }
      }
    );
    if (!updated) {
      throw new Meteor.Error('conflict', 'The order changed in the meantime — please refresh and try again.');
    }

    AuditLog.record({
      actorUserId: userId,
      actorRole: user.role || null,
      action: 'order.cancelled',
      targetType: 'order',
      targetId: orderId,
      meta: { orderReference: order.orderReference, previousStatus: order.status, reason: reason || null }
    });

    console.log(`[ORDERS] Cancelled order ${order.orderReference} by ${userDisplayName} (${userId})`);

    return { success: true, orderId };
  },

  /**
   * Update an order (only pending orders can be updated)
   */
  async 'orders.update'({ orderId, updateData, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(updateData, {
      isin: Match.Maybe(String),
      securityName: Match.Maybe(String),
      assetType: Match.Maybe(Match.Where(x => Object.values(ASSET_TYPES).includes(x))),
      currency: Match.Maybe(String),
      quantity: Match.Maybe(Number),
      priceType: Match.Maybe(Match.Where(x => Object.values(PRICE_TYPES).includes(x))),
      limitPrice: Match.Maybe(Number),
      notes: Match.Maybe(String),
      broker: Match.Maybe(String),
      settlementCurrency: Match.Maybe(String),
      underlyings: Match.Maybe(String),
      fxRate: Match.Maybe(Number),
      fxForwardDate: Match.Maybe(String),
      fxValueDate: Match.Maybe(String),
      stopLossPrice: Match.Maybe(Number),
      takeProfitPrice: Match.Maybe(Number),
      depositTenor: Match.Maybe(String),
      depositMaturityDate: Match.Maybe(String),
      depositAction: Match.Maybe(String),
      // Listed option contract - revisable during four-eyes review so a
      // fat-fingered strike or expiry can be corrected rather than re-keyed.
      optionType: Match.Maybe(Match.Where(x => Object.values(OPTION_TYPES).includes(x))),
      optionStrike: Match.Maybe(Number),
      optionExpiry: Match.Maybe(String),
      optionContractSize: Match.Maybe(Number)
    });

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Only pending, pending_validation, or revision_requested orders can be updated
    if (order.status !== ORDER_STATUSES.PENDING &&
        order.status !== ORDER_STATUSES.PENDING_VALIDATION &&
        order.status !== ORDER_STATUSES.REVISION_REQUESTED) {
      throw new Meteor.Error('invalid-operation', 'Only pending or revision-requested orders can be updated');
    }

    // Four-eyes integrity: a sent-back order may only be revised by its original
    // creator (mirrors orders.resubmitForValidation), so a validator can't both
    // request changes and make them.
    if (order.status === ORDER_STATUSES.REVISION_REQUESTED && order.createdBy !== userId) {
      throw new Meteor.Error('not-authorized', 'Only the original creator can revise this order');
    }

    const updateFields = {
      updatedAt: new Date(),
      updatedBy: userId
    };

    if (updateData.isin !== undefined) {
      updateFields.isin = updateData.isin.toUpperCase();
    }
    if (updateData.securityName !== undefined) {
      updateFields.securityName = updateData.securityName;
    }
    if (updateData.assetType !== undefined) {
      updateFields.assetType = updateData.assetType;
    }
    if (updateData.currency !== undefined) {
      updateFields.currency = updateData.currency.toUpperCase();
    }
    if (updateData.quantity !== undefined) {
      updateFields.quantity = updateData.quantity;
    }
    if (updateData.priceType !== undefined) {
      updateFields.priceType = updateData.priceType;
      // Clear limit price if switching to market
      if (updateData.priceType === 'market') {
        updateFields.limitPrice = null;
      }
    }
    if (updateData.limitPrice !== undefined && updateData.priceType !== 'market') {
      updateFields.limitPrice = updateData.limitPrice;
    }
    if (updateData.notes !== undefined) {
      updateFields.notes = updateData.notes || null;
    }
    if (updateData.broker !== undefined) {
      updateFields.broker = updateData.broker || null;
    }
    if (updateData.settlementCurrency !== undefined) {
      updateFields.settlementCurrency = updateData.settlementCurrency || null;
    }
    if (updateData.underlyings !== undefined) {
      updateFields.underlyings = updateData.underlyings || null;
    }
    if (updateData.fxRate !== undefined) {
      updateFields.fxRate = updateData.fxRate || null;
    }
    if (updateData.fxForwardDate !== undefined) {
      updateFields.fxForwardDate = updateData.fxForwardDate ? new Date(updateData.fxForwardDate) : null;
    }
    if (updateData.fxValueDate !== undefined) {
      updateFields.fxValueDate = updateData.fxValueDate ? new Date(updateData.fxValueDate) : null;
    }
    if (updateData.stopLossPrice !== undefined) {
      updateFields.stopLossPrice = updateData.stopLossPrice || null;
    }
    if (updateData.takeProfitPrice !== undefined) {
      updateFields.takeProfitPrice = updateData.takeProfitPrice || null;
    }
    if (updateData.depositTenor !== undefined) {
      updateFields.depositTenor = updateData.depositTenor || null;
    }
    if (updateData.depositMaturityDate !== undefined) {
      updateFields.depositMaturityDate = updateData.depositMaturityDate ? new Date(updateData.depositMaturityDate) : null;
    }
    if (updateData.optionType !== undefined) {
      updateFields.optionType = updateData.optionType || null;
    }
    if (updateData.optionStrike !== undefined) {
      updateFields.optionStrike = updateData.optionStrike ?? null;
    }
    if (updateData.optionExpiry !== undefined) {
      updateFields.optionExpiry = updateData.optionExpiry ? new Date(updateData.optionExpiry) : null;
    }
    if (updateData.optionContractSize !== undefined) {
      updateFields.optionContractSize = updateData.optionContractSize || DEFAULT_OPTION_CONTRACT_SIZE;
    }
    if ((updateData.optionType !== undefined || updateData.optionStrike !== undefined || updateData.optionExpiry !== undefined)
      && order.optionContractSymbol) {
      // The OCC symbol encodes type, strike and expiry. Once any of them is
      // edited it names a different contract, and the quote that came with it
      // is for that other contract too.
      updateFields.optionContractSymbol = null;
      updateFields.optionQuoteAtEntry = null;
    }

    // An option's securityName IS the contract, composed at entry. Correcting a
    // fat-fingered strike or expiry without recomposing it would leave the name
    // on the blotter, the ticket and both PDFs describing the old contract.
    const contractChanged = updateData.optionType !== undefined
      || updateData.optionStrike !== undefined
      || updateData.optionExpiry !== undefined
      || updateData.optionContractSize !== undefined;
    if (contractChanged && (updateFields.assetType || order.assetType) === ASSET_TYPES.OPTION) {
      const recomposed = optionContractDescription({ ...order, ...updateFields });
      if (recomposed) updateFields.securityName = recomposed;
    }

    // Re-snapshot the cover when a revision changes what has to be delivered.
    // Leaving the original snapshot would show the validator cover for a
    // contract count that no longer exists.
    const revised = { ...order, ...updateFields };
    // An edit must not leave a limit / stop order without its price
    assertOrderPriceLevels(revised);

    // Keep the estimated value in line with a revised nominal or price - the
    // ticket, the PDFs and the allocation check all read it.
    const valueInputsChanged = ['quantity', 'limitPrice', 'priceType', 'assetType', 'optionContractSize']
      .some(key => updateData[key] !== undefined);
    if (valueInputsChanged) {
      const recomputed = computeOrderEstimatedValue(revised);
      if (recomputed !== null) updateFields.estimatedValue = recomputed;
    }
    const coverInputsChanged = updateData.quantity !== undefined
      || updateData.optionContractSize !== undefined
      || updateData.optionType !== undefined;
    if (coverInputsChanged && isShortCall(revised)) {
      try {
        const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
        if (bankAccount) {
          const resolvedClient = await resolveClientId(order.clientId);
          updateFields.coverageCheck = {
            ...(await resolveShortCallCoverage({
              resolved: resolvedClient,
              bankAccount,
              order: revised,
              // Don't let the order count its own contracts against itself.
              excludeOrderId: orderId
            })),
            ...(order.coverageCheck?.justification
              ? { justification: order.coverageCheck.justification }
              : {})
          };
        }
      } catch (coverErr) {
        console.error('[ORDERS] Short-call coverage re-check error (non-blocking):', coverErr.message);
      }
    }

    await OrdersCollection.updateAsync(orderId, { $set: updateFields });

    console.log(`[ORDERS] Updated order ${order.orderReference} by ${userDisplayName} (${userId})`);

    return { success: true, orderId };
  },

  /**
   * Delete an order (only pending orders can be deleted)
   */
  async 'orders.delete'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Only pending, pending_validation, or revision_requested orders can be deleted
    if (order.status !== ORDER_STATUSES.PENDING &&
        order.status !== ORDER_STATUSES.PENDING_VALIDATION &&
        order.status !== ORDER_STATUSES.REVISION_REQUESTED) {
      throw new Meteor.Error('invalid-operation', 'Only pending or revision-requested orders can be deleted');
    }

    // Four-eyes integrity: a sent-back order may only be discarded by its original creator
    if (order.status === ORDER_STATUSES.REVISION_REQUESTED && order.createdBy !== userId) {
      throw new Meteor.Error('not-authorized', 'Only the original creator can delete this order');
    }

    await OrdersCollection.removeAsync(orderId);

    console.log(`[ORDERS] Deleted order ${order.orderReference} by ${userDisplayName} (${userId})`);

    return { success: true, orderId, orderReference: order.orderReference };
  },

  /**
   * Request a modification of a live order (four-eyes: goes to PENDING_MODIFICATION).
   * Covers the price fields, quantity and validity. Requires the client's
   * instruction. Once validated, an order the bank already has gets an
   * amendment ticket (see orders.validateModification).
   */
  async 'orders.updateLimit'({ orderId, priceType, limitPrice, stopLossPrice, takeProfitPrice, quantity, validityType, validityDate, reason, clientInstructionFile, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(priceType, Match.Maybe(Match.Where(x => Object.values(PRICE_TYPES).includes(x))));
    check(limitPrice, Match.Maybe(Number));
    check(stopLossPrice, Match.Maybe(Number));
    check(takeProfitPrice, Match.Maybe(Number));
    check(quantity, Match.Maybe(Number));
    check(validityType, Match.Maybe(Match.Where(x => Object.values(VALIDITY_TYPES).includes(x))));
    check(validityDate, Match.Maybe(Match.OneOf(Date, String)));
    check(reason, Match.Maybe(String));
    check(clientInstructionFile, Match.Maybe({
      fileName: String,
      base64Data: String,
      mimeType: String
    }));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);
    assertOrderChangeable(order);

    if (!clientInstructionFile) {
      throw new Meteor.Error('missing-attachment', 'Client instruction email is required for modifications');
    }

    // Proposed values: anything not supplied keeps the order's current value
    const newPriceType = priceType || order.priceType;
    const newValidityType = validityType || order.validityType || null;
    let newValidityDate = null;
    if (newValidityType === VALIDITY_TYPES.GTD) {
      const raw = validityDate !== undefined && validityDate !== null ? validityDate : order.validityDate;
      newValidityDate = raw ? new Date(raw) : null;
    }
    const newValues = {
      priceType: newPriceType,
      limitPrice: newPriceType === PRICE_TYPES.MARKET ? null : (limitPrice !== undefined && limitPrice !== null ? limitPrice : (order.limitPrice ?? null)),
      stopLossPrice: stopLossPrice !== undefined ? stopLossPrice : (order.stopLossPrice ?? null),
      takeProfitPrice: takeProfitPrice !== undefined ? takeProfitPrice : (order.takeProfitPrice ?? null),
      quantity: quantity !== undefined && quantity !== null ? quantity : order.quantity,
      validityType: newValidityType,
      validityDate: newValidityDate
    };
    const oldValues = {
      priceType: order.priceType,
      limitPrice: order.limitPrice ?? null,
      stopLossPrice: order.stopLossPrice ?? null,
      takeProfitPrice: order.takeProfitPrice ?? null,
      quantity: order.quantity,
      validityType: order.validityType || null,
      validityDate: order.validityDate || null
    };

    assertOrderPriceLevels({ ...newValues, stopPrice: order.stopPrice ?? order.stopLossPrice ?? null });
    if (!(newValues.quantity > 0)) {
      throw new Meteor.Error('invalid-quantity', 'Quantity must be above zero');
    }
    const executed = Number(order.executedQuantity) || 0;
    if (executed > 0 && newValues.quantity <= executed) {
      throw new Meteor.Error('invalid-quantity', `Quantity must stay above the ${executed} already executed — to stop the rest, cancel the order instead`);
    }
    if (newValues.validityType === VALIDITY_TYPES.GTD) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      if (!newValues.validityDate || Number.isNaN(newValues.validityDate.getTime()) || newValues.validityDate < startOfToday) {
        throw new Meteor.Error('invalid-validity', 'A Good Till Date order needs a validity date from today on');
      }
    }

    const sameDate = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
    const changed = Object.keys(newValues).some(key => (
      key === 'validityDate' ? !sameDate(oldValues[key], newValues[key]) : (oldValues[key] ?? null) !== (newValues[key] ?? null)
    ));
    if (!changed) {
      throw new Meteor.Error('no-change', 'The proposed values are the same as the current order');
    }

    const instructionFile = saveChangeInstructionFile(orderId, clientInstructionFile, 'modification_instruction');

    await fileOrderChangeRequest({
      order,
      kind: TICKET_KINDS.AMEND,
      oldValues,
      newValues,
      reason,
      instructionFile,
      userId,
      userDisplayName
    });

    return { success: true, orderId };
  },

  /**
   * Request the cancellation of a live order (four-eyes: goes to PENDING_MODIFICATION).
   * Requires the client's instruction. Once validated, an order the bank
   * already has gets a cancellation ticket.
   */
  async 'orders.requestCancellation'({ orderId, reason, clientInstructionFile, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(reason, Match.Maybe(String));
    check(clientInstructionFile, Match.Maybe({
      fileName: String,
      base64Data: String,
      mimeType: String
    }));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);
    assertOrderChangeable(order);

    if (!clientInstructionFile) {
      throw new Meteor.Error('missing-attachment', 'Client instruction email is required for a cancellation');
    }

    const instructionFile = saveChangeInstructionFile(orderId, clientInstructionFile, 'cancellation_instruction');

    await fileOrderChangeRequest({
      order,
      kind: TICKET_KINDS.CANCEL,
      oldValues: {
        quantity: order.quantity,
        executedQuantity: order.executedQuantity || 0
      },
      newValues: {},
      reason,
      instructionFile,
      userId,
      userDisplayName
    });

    return { success: true, orderId };
  },

  /**
   * Validate a pending modification or cancellation (four-eyes: apply it).
   * When the bank already had the order, returns the amendment / cancellation
   * ticket ({ pdfData, emailData, ticketKind }) for the validator to send, the
   * same way orders.validate hands back the original order ticket.
   */
  async 'orders.validateModification'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    // May render the ticket PDF — don't hold the caller's other calls behind it
    this.unblock();

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    if (!isOrderValidator(user)) {
      throw new Meteor.Error('not-authorized', 'You do not have order validation permission');
    }

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) throw new Meteor.Error('not-found', 'Order not found');
    await validateOrderAccess(order, user);

    if (order.status !== ORDER_STATUSES.PENDING_MODIFICATION || !order.pendingModification) {
      throw new Meteor.Error('invalid-operation', 'Order has no pending modification');
    }

    // Four-eyes: requester cannot validate their own request
    if (order.pendingModification.requestedBy === userId) {
      throw new Meteor.Error('four-eyes-violation', 'You cannot validate your own request (four-eyes principle)');
    }

    const mod = order.pendingModification;
    const kind = mod.kind || TICKET_KINDS.AMEND;
    const isCancel = kind === TICKET_KINDS.CANCEL;
    const now = new Date();

    // The bank already has the order: the change only takes effect once it is
    // told, so the validated entry carries a bank notice still to be sent.
    const bankHasOrder = AT_BANK_ORDER_STATUSES.includes(mod.statusBeforeModification);

    const historyEntry = {
      ...buildChangeHistoryEntry(mod),
      validatedAt: now,
      validatedBy: userId,
      validatedByName: userDisplayName,
      ...(bankHasOrder ? { bankNotice: { required: true, sentAt: null } } : {})
    };

    let changeSet;
    if (isCancel) {
      changeSet = {
        status: ORDER_STATUSES.CANCELLED,
        cancelledAt: now,
        cancelledBy: mod.requestedBy,
        cancellationReason: mod.reason || null,
        cancellationValidatedBy: userId
      };
    } else {
      const n = mod.newValues;
      changeSet = {
        status: mod.statusBeforeModification,
        priceType: n.priceType,
        limitPrice: n.limitPrice,
        stopLossPrice: n.stopLossPrice,
        takeProfitPrice: n.takeProfitPrice
      };
      if ('quantity' in n) changeSet.quantity = n.quantity;
      if ('validityType' in n) {
        changeSet.validityType = n.validityType;
        changeSet.validityDate = n.validityDate;
      }
      const estimatedValue = computeOrderEstimatedValue({
        ...order,
        quantity: changeSet.quantity ?? order.quantity,
        limitPrice: changeSet.limitPrice
      });
      if (estimatedValue !== null) changeSet.estimatedValue = estimatedValue;
    }

    // Apply — atomic compare-and-set against the PENDING_MODIFICATION status +
    // review-lock claim, so two simultaneous validators cannot both apply it.
    const lockStaleBefore = new Date(Date.now() - REVIEW_LOCK_TTL_MS);
    const updateResult = await OrdersCollection.rawCollection().findOneAndUpdate(
      {
        _id: orderId,
        status: ORDER_STATUSES.PENDING_MODIFICATION,
        $or: [
          { reviewingBy: { $in: [null, userId] } },
          { reviewingBy: { $exists: false } },
          { reviewingAt: { $lt: lockStaleBefore } }
        ]
      },
      {
        $set: {
          ...changeSet,
          pendingModification: null,
          pendingBankNotice: bankHasOrder ? { kind, historyId: historyEntry._id, validatedAt: now } : null,
          updatedAt: now,
          updatedBy: userId
        },
        $push: { limitHistory: historyEntry },
        $unset: {
          reviewingBy: '',
          reviewingByName: '',
          reviewingAt: ''
        }
      },
      // includeResultMetadata: true keeps the legacy { value, ok } shape.
      // MongoDB Node driver v6 otherwise returns the document directly, so
      // updateResult.value would be undefined even on success — which made
      // every claim/validate/modify wrongly report "locked-by-other".
      { returnDocument: 'after', includeResultMetadata: true }
    );

    if (!updateResult.value) {
      const current = await OrdersCollection.findOneAsync(orderId);
      if (!current) throw new Meteor.Error('not-found', 'Order not found');
      if (current.status !== ORDER_STATUSES.PENDING_MODIFICATION) {
        throw new Meteor.Error('already-validated', 'This request was already processed.');
      }
      if (current.reviewingBy && current.reviewingBy !== userId) {
        const whoLabel = current.reviewingByName || 'another user';
        throw new Meteor.Error('locked-by-other', `This order is currently being reviewed by ${whoLabel}.`);
      }
      throw new Meteor.Error('validation-failed', 'Could not validate this request — please refresh and try again.');
    }

    console.log(`[ORDERS] ${isCancel ? 'Cancellation' : 'Modification'} validated on order ${order.orderReference} by ${userDisplayName} (${userId})${bankHasOrder ? ' — bank notice pending' : ''}`);

    AuditLog.record({
      actorUserId: userId,
      actorRole: user.role || null,
      action: isCancel ? 'order.cancellation.validated' : 'order.modification.validated',
      targetType: 'order',
      targetId: orderId,
      meta: { orderReference: order.orderReference, requestedBy: mod.requestedBy, bankNoticeRequired: bankHasOrder }
    });

    // Notify the requester
    try {
      const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
      await NotificationHelpers.create({
        userId: mod.requestedBy,
        type: 'success',
        title: isCancel ? 'Cancellation Validated' : 'Modification Validated',
        message: `Your ${isCancel ? 'cancellation' : 'modification'} of order ${order.orderReference} (${order.securityName}) has been validated by ${userDisplayName}.`,
        metadata: { orderId, orderReference: order.orderReference },
        eventType: EVENT_TYPES.ORDER_VALIDATED
      });
    } catch (notifError) {
      console.error('[ORDERS] Error sending modification validation notification:', notifError);
    }

    if (!bankHasOrder) {
      return { success: true, orderId, ticketKind: kind };
    }

    // Hand the validator the ticket to send. If this fails the change still
    // stands and pendingBankNotice keeps the "send to bank" action available.
    try {
      const payload = await buildOrderEmailPayload(updateResult.value, user, { ticketKind: kind });
      return { success: true, orderId, ticketKind: kind, ...payload };
    } catch (err) {
      console.error(`[ORDERS] Could not build the ${kind} ticket for ${order.orderReference}:`, err);
      return { success: true, orderId, ticketKind: kind, ticketError: err.reason || err.message };
    }
  },

  /**
   * Reject a pending modification or cancellation (revert to previous status)
   */
  async 'orders.rejectModification'({ orderId, reason, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(reason, Match.Maybe(String));

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    if (!isOrderValidator(user)) {
      throw new Meteor.Error('not-authorized', 'You do not have order validation permission');
    }

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) throw new Meteor.Error('not-found', 'Order not found');
    await validateOrderAccess(order, user);

    if (order.status !== ORDER_STATUSES.PENDING_MODIFICATION || !order.pendingModification) {
      throw new Meteor.Error('invalid-operation', 'Order has no pending modification');
    }

    const mod = order.pendingModification;
    const isCancel = mod.kind === TICKET_KINDS.CANCEL;

    const historyEntry = {
      ...buildChangeHistoryEntry(mod),
      rejectedAt: new Date(),
      rejectedBy: userId,
      rejectedByName: userDisplayName,
      rejectionReason: reason || null,
      status: 'rejected'
    };

    // Revert to previous status without applying changes
    const updated = await OrdersCollection.updateAsync(
      { _id: orderId, status: ORDER_STATUSES.PENDING_MODIFICATION },
      {
        $set: {
          status: mod.statusBeforeModification,
          pendingModification: null,
          updatedAt: new Date(),
          updatedBy: userId
        },
        $push: { limitHistory: historyEntry }
      }
    );
    if (!updated) {
      throw new Meteor.Error('already-validated', 'This request was already processed.');
    }

    console.log(`[ORDERS] ${isCancel ? 'Cancellation' : 'Modification'} rejected on order ${order.orderReference} by ${userDisplayName} (${userId}) - reason: ${reason || 'N/A'}`);

    AuditLog.record({
      actorUserId: userId,
      actorRole: user.role || null,
      action: isCancel ? 'order.cancellation.rejected' : 'order.modification.rejected',
      targetType: 'order',
      targetId: orderId,
      meta: { orderReference: order.orderReference, reason: reason || null }
    });

    // Notify the requester
    try {
      const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
      await NotificationHelpers.create({
        userId: mod.requestedBy,
        type: 'error',
        title: isCancel ? 'Cancellation Rejected' : 'Modification Rejected',
        message: `Your ${isCancel ? 'cancellation' : 'modification'} of order ${order.orderReference} was rejected by ${userDisplayName}.${reason ? ` Reason: ${reason}` : ''}`,
        metadata: { orderId, orderReference: order.orderReference, reason },
        eventType: EVENT_TYPES.ORDER_REJECTED
      });
    } catch (notifError) {
      console.error('[ORDERS] Error sending modification rejection notification:', notifError);
    }

    return { success: true, orderId };
  },

  /**
   * Mark order as sent (after email)
   */
  async 'orders.markSent'({ orderId, sentTo, sentMethod, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(sentTo, String);
    check(sentMethod, Match.Where(x => ['mailto', 'sendpulse'].includes(x)));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (order.status === ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Cannot mark as sent while pending validation');
    }

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: ORDER_STATUSES.SENT,
        sentAt: new Date(),
        sentTo,
        sentMethod,
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Marked order ${order.orderReference} as sent to ${sentTo} by ${userDisplayName} (${userId})`);

    return { success: true, orderId };
  },

  /**
   * Mark order as executed
   */
  /**
   * Inline update of executedPrice from the order blotter.
   * Allowed on executed / partially_executed orders only. Pushes the previous
   * value to executedPriceHistory for audit. Optionally accepts a reason.
   */
  async 'orders.setExecutedPrice'({ orderId, executedPrice, reason, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(executedPrice, Number);
    check(reason, Match.Maybe(String));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (order.status !== ORDER_STATUSES.EXECUTED && order.status !== ORDER_STATUSES.PARTIALLY_EXECUTED) {
      throw new Meteor.Error('invalid-operation', 'Execution price can only be set on executed or partially executed orders');
    }

    const previousPrice = order.executedPrice ?? null;
    if (previousPrice !== null && previousPrice === executedPrice) {
      return { success: true, orderId, unchanged: true };
    }

    const historyEntry = {
      previousPrice,
      newPrice: executedPrice,
      changedBy: userId,
      changedByName: userDisplayName,
      changedAt: new Date(),
      reason: reason || null
    };

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        executedPrice,
        updatedAt: new Date(),
        updatedBy: userId
      },
      $push: { executedPriceHistory: historyEntry }
    });

    console.log(`[ORDERS] Exec price updated for ${order.orderReference}: ${previousPrice} → ${executedPrice} by ${userDisplayName}`);

    return { success: true, orderId, previousPrice, newPrice: executedPrice };
  },

  async 'orders.markExecuted'({ orderId, executionData, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(executionData, {
      executedQuantity: Number,
      executedPrice: Match.Maybe(Number),
      executionDate: Match.Maybe(Date),
      linkedHoldingId: Match.Maybe(String)
    });

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (order.status === ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Cannot mark as executed while pending validation');
    }

    // For transmitted orders, require bank confirmation email
    if (order.status === ORDER_STATUSES.TRANSMITTED) {
      const hasBankConfirmation = order.emailTraces?.some(t => t.traceType === 'bank_confirmation');
      if (!hasBankConfirmation) {
        throw new Meteor.Error('missing-trace', 'Please attach the bank execution email before marking as executed');
      }
    }

    // BUY structured products cannot be marked executed until the final (signed)
    // termsheet is uploaded. Sell orders never require a termsheet.
    if (order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT && order.orderType === 'buy' && order.termsheetStatus !== TERMSHEET_STATUSES.SIGNED) {
      throw new Meteor.Error('missing-termsheet', 'Final signed termsheet must be uploaded before this structured product order can be marked executed');
    }

    // Determine status based on executed quantity
    let newStatus = ORDER_STATUSES.EXECUTED;
    if (executionData.executedQuantity < order.quantity) {
      newStatus = ORDER_STATUSES.PARTIALLY_EXECUTED;
    }

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: newStatus,
        executedQuantity: executionData.executedQuantity,
        executedPrice: executionData.executedPrice || null,
        executionDate: executionData.executionDate || new Date(),
        linkedHoldingId: executionData.linkedHoldingId || null,
        executedBy: userId,
        executedByName: userDisplayName,
        executedAt: new Date(),
        settlementStatus: 'pending',
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Marked order ${order.orderReference} as ${newStatus} by ${userDisplayName} (${userId})`);

    return { success: true, orderId, newStatus };
  },

  /**
   * Force-settle an order (manual override for edge cases)
   */
  async 'orders.forceSettle'({ orderId, reason, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(reason, Match.Maybe(String));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (order.status !== ORDER_STATUSES.EXECUTED && order.status !== ORDER_STATUSES.PARTIALLY_EXECUTED) {
      throw new Meteor.Error('invalid-operation', 'Only executed orders can be marked as settled');
    }

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        settlementStatus: 'forced',
        settlementForcedBy: userId,
        settlementForcedByName: userDisplayName,
        settlementForcedAt: new Date(),
        settlementForcedReason: reason || null,
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Force-settled order ${order.orderReference} by ${userDisplayName}: ${reason || 'no reason'}`);

    return { success: true };
  },

  /**
   * Revert termsheet status back to "none" for structured product orders.
   * Forward transitions (none -> sent, sent -> signed) require evidence and must
   * go through orders.advanceTermsheetWithEvidence. The trace files are kept on
   * revert as audit history.
   */
  async 'orders.updateTermsheetStatus'({ orderId, termsheetStatus, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(termsheetStatus, Match.Where(x => Object.values(TERMSHEET_STATUSES).includes(x)));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (order.assetType !== ASSET_TYPES.STRUCTURED_PRODUCT) {
      throw new Meteor.Error('invalid-operation', 'Termsheet status is only applicable to structured products');
    }

    if (termsheetStatus !== TERMSHEET_STATUSES.NONE) {
      throw new Meteor.Error('invalid-operation', 'Forward termsheet transitions require evidence. Use orders.advanceTermsheetWithEvidence.');
    }

    const now = new Date();
    await OrdersCollection.updateAsync(orderId, {
      $set: {
        termsheetStatus,
        termsheetUpdatedBy: userDisplayName,
        termsheetUpdatedAt: now,
        updatedAt: now,
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Reverted termsheet status to "${termsheetStatus}" for order ${order.orderReference} by ${userDisplayName} (${userId})`);

    return { success: true, orderId, termsheetStatus };
  },

  /**
   * Advance termsheet status to "sent" or "signed" with mandatory evidence file.
   * Atomically writes the evidence file (replacing any prior evidence of the same
   * type) and updates the termsheet status fields. If the file write fails, no DB
   * mutation happens.
   */
  async 'orders.advanceTermsheetWithEvidence'({ orderId, targetStatus, fileName, base64Data, mimeType, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(fileName, String);
    check(base64Data, String);
    check(mimeType, String);
    check(targetStatus, Match.Where(x => x === TERMSHEET_STATUSES.SENT || x === TERMSHEET_STATUSES.SIGNED));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (order.assetType !== ASSET_TYPES.STRUCTURED_PRODUCT) {
      throw new Meteor.Error('invalid-operation', 'Termsheet status is only applicable to structured products');
    }

    const traceType = targetStatus === TERMSHEET_STATUSES.SIGNED
      ? EMAIL_TRACE_TYPES.TERMSHEET_SIGNED
      : EMAIL_TRACE_TYPES.TERMSHEET_SENT;

    const trace = await writeTraceFileToOrder({
      order,
      traceType,
      fileName,
      base64Data,
      mimeType,
      userId,
      userDisplayName,
      acceptedExtensions: TERMSHEET_EVIDENCE_TYPES
    });

    // The unified "Signed Termsheet" tile treats a legacy 'termsheet' trace as signed
    // evidence — replace it too when new signed evidence lands, so one file remains.
    if (traceType === EMAIL_TRACE_TYPES.TERMSHEET_SIGNED) {
      const legacyTrace = (order.emailTraces || []).find(t => t.traceType === EMAIL_TRACE_TYPES.TERMSHEET);
      if (legacyTrace) {
        try {
          if (legacyTrace.filePath && fs.existsSync(legacyTrace.filePath)) {
            fs.unlinkSync(legacyTrace.filePath);
            console.log(`   Deleted legacy termsheet trace file: ${legacyTrace.filePath}`);
          }
        } catch (err) {
          console.error('Error deleting legacy termsheet trace file:', err);
        }
        await OrdersCollection.updateAsync(orderId, {
          $pull: { emailTraces: { _id: legacyTrace._id } }
        });
      }
    }

    const now = new Date();
    await OrdersCollection.updateAsync(orderId, {
      $push: { emailTraces: trace },
      $set: {
        termsheetStatus: targetStatus,
        termsheetUpdatedBy: userDisplayName,
        termsheetUpdatedAt: now,
        updatedAt: now,
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Advanced termsheet to "${targetStatus}" for order ${order.orderReference} by ${userDisplayName} (${userId}) with evidence ${trace.storedFileName}`);

    // The signed termsheet is the definitive document for the ISIN, so it
    // supersedes whatever the product currently shows (see termsheetSync.js).
    // The "sent" evidence is often the covering email rather than the document
    // itself, so it is not promoted.
    if (traceType === EMAIL_TRACE_TYPES.TERMSHEET_SIGNED && order.isin) {
      Meteor.defer(() => promoteOrderTermsheetToProduct({
        isin: order.isin,
        fileName,
        base64Data,
        source: PRODUCT_TERMSHEET_SOURCES.ORDER_SIGNED,
        userId
      }));
    }

    return { success: true, orderId, termsheetStatus: targetStatus, traceId: trace._id };
  },

  /**
   * Get order details with enriched data
   */
  async 'orders.get'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Enrich with related data (supports both user-based and entity-based clients)
    let client = await UsersCollection.findOneAsync(order.clientId);
    if (!client && (order.entityId || order.clientId)) {
      const { ClientEntitiesCollection: EntCol } = require('../../imports/api/clientEntities.js');
      const entity = await EntCol.findOneAsync({ $or: [
        ...(order.entityId ? [{ _id: order.entityId }] : []),
        { _id: order.clientId },
        { migratedFromUserId: order.clientId }
      ].filter(Boolean), isActive: true });
      if (entity) {
        client = { _id: entity._id, profile: entity.profile, username: null };
      }
    }
    const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
    const bank = await BanksCollection.findOneAsync(order.bankId);

    return {
      order: OrderHelpers.formatOrderDetails(order),
      client: client ? {
        _id: client._id,
        firstName: client.profile?.firstName,
        lastName: client.profile?.lastName,
        companyName: client.profile?.companyName,
        // Logins carry the address in `email`; entity-only clients in profile.email
        email: client.email || client.profile?.email || client.username
      } : (order.clientName ? { _id: order.clientId, firstName: order.clientName, lastName: '', email: null } : null),
      bankAccount: bankAccount ? {
        _id: bankAccount._id,
        accountNumber: bankAccount.accountNumber,
        referenceCurrency: bankAccount.referenceCurrency
      } : null,
      bank: bank ? {
        _id: bank._id,
        name: bank.name,
        deskEmail: bank.deskEmail
      } : null,
      // Where an order email for this order would go (desk chosen by asset type)
      resolvedDesk: bank ? (() => {
        const r = BankHelpers.resolveOrderRecipients(bank, order.assetType);
        return { to: r.to, deskLabel: r.deskLabel, matched: r.matched };
      })() : null
    };
  },

  /**
   * List orders with filters and pagination
   */
  async 'orders.list'({ filters = {}, pagination = {}, sessionId }) {
    check(sessionId, String);
    check(filters, {
      status: Match.Maybe(Match.OneOf(String, [String])),
      clientId: Match.Maybe(String),
      bankId: Match.Maybe(String),
      dateFrom: Match.Maybe(Date),
      dateTo: Match.Maybe(Date),
      search: Match.Maybe(String),
      bulkOrderGroupId: Match.Maybe(String),
      validatedByName: Match.Maybe(String),
      missingTermsheet: Match.Maybe(Boolean),
      // Health-check filter from the order book summary bar: HEALTH_FILTER_ANY
      // keeps every incomplete order, otherwise the name of one missing item
      // ("Termsheet signed", "Exec price", ...) as reported by getOrderHealthCheck.
      healthMissing: Match.Maybe(String)
    });
    check(pagination, {
      limit: Match.Maybe(Number),
      skip: Match.Maybe(Number),
      sortField: Match.Maybe(String),
      sortOrder: Match.Maybe(Number)
    });

    const { user } = await validateSession(sessionId);

    // Build query
    const query = {};

    // Role-based filtering
    if (user.role === 'client') {
      // Clients only see their own orders
      query.clientId = user._id;
    }
    // All staff (admin, superadmin, compliance, rm, assistant) see every order

    // Apply filters
    if (filters.status) {
      query.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
    } else {
      // Default: hide orders that are still in the validation workflow — those
      // appear in the separate "Orders Pending Validation" banner above the
      // order book table. The user can still surface them explicitly via the
      // status dropdown.
      query.status = {
        $nin: [
          ORDER_STATUSES.PENDING_VALIDATION,
          ORDER_STATUSES.PENDING_MODIFICATION,
          ORDER_STATUSES.REVISION_REQUESTED
        ]
      };
    }

    if (filters.clientId) {
      // One client can hold several accounts and, across the entity migration,
      // several ids: orders may be filed under the entity id or under a legacy
      // user id it absorbed. Filter on all of them so picking a client in the
      // blotter returns every order of theirs.
      const { ClientEntityHelpers: CEH } = require('../../imports/api/clientEntities.js');
      const linkedIds = await CEH.getLinkedClientIds(filters.clientId);
      query.clientId = linkedIds.length > 1 ? { $in: linkedIds } : filters.clientId;
    }

    if (filters.bankId) {
      query.bankId = filters.bankId;
    }

    if (filters.bulkOrderGroupId) {
      query.bulkOrderGroupId = filters.bulkOrderGroupId;
    }

    if (filters.validatedByName) {
      query.validatedByName = filters.validatedByName;
    }

    // Missing termsheet: only BUY structured products whose termsheet has not
    // yet been sent/signed (status 'none' or never set). Sell orders never
    // require a termsheet. Triggered by clicking the "TS" column header.
    if (filters.missingTermsheet) {
      query.assetType = ASSET_TYPES.STRUCTURED_PRODUCT;
      query.orderType = 'buy';
      query.termsheetStatus = { $in: [TERMSHEET_STATUSES.NONE, null] };
    }

    if (filters.dateFrom || filters.dateTo) {
      query.createdAt = {};
      if (filters.dateFrom) {
        query.createdAt.$gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        query.createdAt.$lte = filters.dateTo;
      }
    }

    if (filters.search) {
      const searchRegex = new RegExp(filters.search, 'i');
      query.$or = [
        { orderReference: searchRegex },
        { securityName: searchRegex },
        { displayName: searchRegex },
        { isin: searchRegex }
      ];
    }

    // Build sort
    const sortField = pagination.sortField || 'createdAt';
    const sortOrder = pagination.sortOrder || -1;
    const sort = { [sortField]: sortOrder };

    const limit = pagination.limit || 50;
    const skip = pagination.skip || 0;

    let total;
    let orders;
    let healthSource = null;
    if (filters.healthMissing) {
      // The health check depends on status, traces and termsheet state together,
      // so it cannot be expressed as a Mongo selector. Evaluate it over the
      // whole match and paginate in memory — the order book is a few thousand
      // rows at most, and the filter narrows the other criteria first.
      const wantAny = filters.healthMissing === HEALTH_FILTER_ANY;
      const candidates = await OrdersCollection.find(query, { sort }).fetchAsync();
      healthSource = candidates;
      const matching = candidates.filter(o => {
        const h = getOrderHealthCheck(o);
        if (h.max === 0 || h.score === h.max) return false;
        return wantAny || h.missing.includes(filters.healthMissing);
      });
      total = matching.length;
      orders = matching.slice(skip, skip + limit);
    } else {
      total = await OrdersCollection.find(query).countAsync();
      orders = await OrdersCollection.find(query, { sort, limit, skip }).fetchAsync();
    }

    // Completeness summary over the WHOLE filtered set, deliberately ignoring
    // filters.healthMissing: these counts are the health filter's own controls,
    // so they have to stay put while it is toggled. They used to be computed on
    // the client from the loaded page, which made "Termsheet signed: 9" read 18
    // the moment you clicked it — the page had simply refilled with 20 orders
    // that were all missing a termsheet.
    const healthDocs = healthSource || await OrdersCollection.find(query, {
      fields: {
        status: 1, assetType: 1, orderType: 1, orderSource: 1,
        emailTraces: 1, pendingModification: 1, validatedAt: 1,
        termsheetStatus: 1, executedPrice: 1
      }
    }).fetchAsync();

    const healthStats = healthDocs.reduce((acc, o) => {
      const h = getOrderHealthCheck(o);
      if (h.max === 0) return acc;               // terminal / nothing to check
      if (h.score === h.max) acc.complete += 1;
      else {
        acc.incomplete += 1;
        h.missing.forEach(m => { acc.missingCounts[m] = (acc.missingCounts[m] || 0) + 1; });
      }
      return acc;
    }, { complete: 0, incomplete: 0, missingCounts: {} });

    // Ambervision product titles for structured products: the desk types a
    // short label on the order ("Ph+"), the product record carries the full
    // name. One batched query; ISINs without a product simply get no title.
    const orderIsins = [...new Set(orders.map(o => o.isin).filter(Boolean))];
    const productTitleByIsin = new Map();
    if (orderIsins.length > 0) {
      const titled = await ProductsCollection.find(
        { isin: { $in: orderIsins } },
        { fields: { isin: 1, title: 1 } }
      ).fetchAsync();
      for (const p of titled) {
        if (p.isin && p.title) productTitleByIsin.set(p.isin, p.title);
      }
    }

    // Enrich orders with client, bank, and creator names
    const { ClientEntitiesCollection: EntColList } = require('../../imports/api/clientEntities.js');
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      let client = await UsersCollection.findOneAsync(order.clientId);
      if (!client) {
        // Try entity lookup
        const entity = await EntColList.findOneAsync({ $or: [
          ...(order.entityId ? [{ _id: order.entityId }] : []),
          { _id: order.clientId },
          { migratedFromUserId: order.clientId }
        ], isActive: true });
        if (entity) client = { profile: entity.profile };
      }
      const bank = await BanksCollection.findOneAsync(order.bankId);
      const creator = await UsersCollection.findOneAsync(order.createdBy);
      const bankAccount = order.bankAccountId ? await BankAccountsCollection.findOneAsync(order.bankAccountId) : null;

      const clientName = client
        ? (client.profile?.companyName || `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || 'Unknown')
        : (order.clientName || 'Unknown');

      return {
        ...OrderHelpers.formatOrderDetails(order),
        clientName,
        bankName: bank?.name || 'Unknown',
        createdByName: creator ? `${creator.profile?.firstName || ''} ${creator.profile?.lastName || ''}`.trim() : 'Unknown',
        accountNumber: bankAccount?.accountNumber || order.portfolioCode || '',
        accountName: bankAccount?.name || '',
        productTitle: (order.isin && productTitleByIsin.get(order.isin)) || null
      };
    }));

    return {
      orders: enrichedOrders,
      total,
      page: Math.floor(skip / limit) + 1,
      totalPages: Math.ceil(total / limit),
      healthStats
    };
  },

  /**
   * Generate PDF for order confirmation
   * Uses the shared PDF helper for consistent PDF generation
   */
  async 'orders.generatePDF'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // PDF can be generated for any status

    // Get related data
    const client = await UsersCollection.findOneAsync(order.clientId);
    const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
    const bank = await BanksCollection.findOneAsync(order.bankId);
    const createdByUser = await UsersCollection.findOneAsync(order.createdBy);

    // Build HTML for PDF
    const html = generateOrderPDFHTML(order, client, bankAccount, bank, createdByUser, await loadOrderIssuer(order));

    console.log(`[ORDERS] Generating PDF for order: ${order.orderReference} by ${userDisplayName}`);

    try {
      // Use shared PDF helper which handles buffer/base64 conversion properly
      const result = await generatePDFFromHTML(html, {
        format: 'A4',
        marginTop: '10mm',
        marginRight: '15mm',
        marginBottom: '10mm',
        marginLeft: '15mm'
      });

      console.log('[ORDERS] PDF generated successfully for order:', order.orderReference);

      // Return { pdfData: base64String }
      return result;
    } catch (error) {
      console.error('[ORDERS] Error generating PDF:', error);
      throw new Meteor.Error('pdf-generation-failed', `Failed to generate PDF: ${error.message}`);
    }
  },

  /**
   * Generate Audit Trail PDF for an order
   * Includes order ticket, chronological lifecycle timeline, and attached documents
   */
  async 'orders.generateAuditTrailPDF'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Get related data
    const client = await UsersCollection.findOneAsync(order.clientId);
    const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
    const bank = await BanksCollection.findOneAsync(order.bankId);
    const createdByUser = await UsersCollection.findOneAsync(order.createdBy);

    // Build audit timeline
    const timeline = buildAuditTimeline(order);

    // Parse email trace contents
    const parsedTraces = await parseEmailTraceContents(order);

    // Build HTML
    const html = generateAuditTrailPDFHTML(order, client, bankAccount, bank, createdByUser, timeline, parsedTraces);

    console.log(`[ORDERS] Generating Audit Trail PDF for order: ${order.orderReference} by ${userDisplayName}`);

    try {
      const result = await generatePDFFromHTML(html, {
        format: 'A4',
        marginTop: '10mm',
        marginRight: '15mm',
        marginBottom: '10mm',
        marginLeft: '15mm'
      });

      console.log('[ORDERS] Audit Trail PDF generated successfully for order:', order.orderReference);
      return result;
    } catch (error) {
      console.error('[ORDERS] Error generating Audit Trail PDF:', error);
      throw new Meteor.Error('pdf-generation-failed', `Failed to generate Audit Trail PDF: ${error.message}`);
    }
  },

  /**
   * Get email data for mailto link
   */
  async 'orders.getEmailData'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    const client = await UsersCollection.findOneAsync(order.clientId);
    const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
    const bank = await BanksCollection.findOneAsync(order.bankId);

    const liveIssuer = await loadOrderIssuer(order);
    const recipients = BankHelpers.resolveOrderRecipients(bank, order.assetType);
    const subject = OrderHelpers.generateEmailSubject(order, liveIssuer);
    const body = OrderHelpers.generateEmailBody(order, client, bank, bankAccount, liveIssuer, recipients.deskLabel);

    return {
      to: recipients.to,
      cc: recipients.cc.join(';'),
      deskLabel: recipients.deskLabel,
      subject,
      body,
      orderReference: order.orderReference
    };
  },

  /**
   * Prepare email data + PDF for an order (returns data for .eml generation client-side)
   */
  async 'orders.prepareEmail'({ orderId, sessionId, ticketKind }) {
    check(orderId, String);
    check(sessionId, String);
    check(ticketKind, Match.Maybe(Match.Where(x => Object.values(TICKET_KINDS).includes(x))));

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (order.status === ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Cannot prepare email for orders pending validation');
    }
    assertOriginalTicketSendable(order, ticketKind);

    const payload = await buildOrderEmailPayload(order, user, { ticketKind: ticketKind || TICKET_KINDS.ORDER });
    return { success: true, ...payload };
  },

  /**
   * Send order email with PDF attachment via SendPulse
   */
  async 'orders.sendEmailWithPDF'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Cannot send email for orders pending validation
    if (order.status === ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Cannot send email for orders pending validation');
    }

    // Get related data
    const client = await UsersCollection.findOneAsync(order.clientId);
    const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
    const bank = await BanksCollection.findOneAsync(order.bankId);
    const createdByUser = await UsersCollection.findOneAsync(order.createdBy);

    const recipients = BankHelpers.resolveOrderRecipients(bank, order.assetType);
    if (!recipients.to) {
      throw new Meteor.Error('no-desk-email', `Bank does not have a desk email configured for ${order.assetType} orders`);
    }

    console.log(`[ORDERS] Generating PDF and sending email for order: ${order.orderReference} by ${userDisplayName}`);

    // Step 1: Generate PDF
    const html = generateOrderPDFHTML(order, client, bankAccount, bank, createdByUser, await loadOrderIssuer(order));
    const pdfResult = await generatePDFFromHTML(html, {
      format: 'A4',
      marginTop: '10mm',
      marginRight: '15mm',
      marginBottom: '10mm',
      marginLeft: '15mm'
    });

    // Step 2: Prepare email content
    const liveIssuer = await loadOrderIssuer(order);
    const subject = OrderHelpers.generateEmailSubject(order, liveIssuer);
    const clientName = client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown';

    const isStructuredProduct = order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT;

    // Issuer coordinates, resolved the way every order email resolves them
    // (OrderHelpers.resolveIssuerContact): the creation-time snapshot wins, the
    // live issuer record is the fallback for pre-snapshot orders.
    const issuer = OrderHelpers.resolveIssuerContact(order, liveIssuer);
    const issuerContactHtml = OrderHelpers.hasIssuerCoordinates(issuer) ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin: 20px 0 0;">
                <tr>
                  <td style="padding: 16px 20px; background-color: ${EMAIL.paper}; border: 1px solid ${EMAIL.hairline}; border-left: 3px solid ${EMAIL.amber}; border-radius: 8px;">
                    <div style="font-size: 11px; font-weight: 600; color: ${EMAIL.muted}; text-transform: uppercase; letter-spacing: 1.4px; margin-bottom: 8px;">Issuer Contact &mdash; ${issuer.name}</div>
                    ${issuer.contactName ? `<div style="font-size: 14px; color: ${EMAIL.ink};">${issuer.contactName}</div>` : ''}
                    ${issuer.contactEmail ? `<div style="font-size: 13px; color: ${EMAIL.body};">${issuer.contactEmail}</div>` : ''}
                    ${issuer.contactPhone ? `<div style="font-size: 13px; color: ${EMAIL.body};">${issuer.contactPhone}</div>` : ''}
                  </td>
                </tr>
              </table>` : '';
    const issuerContactText = OrderHelpers.hasIssuerCoordinates(issuer)
      ? `\nIssuer Contact (${issuer.name}):\n${issuer.contactName ? issuer.contactName + '\n' : ''}${issuer.contactEmail ? issuer.contactEmail + '\n' : ''}${issuer.contactPhone ? issuer.contactPhone + '\n' : ''}`
      : '';
    const quantityLabel = quantityLabelFor(order);
    const priceCellHtml = order.limitPrice
      ? (isStructuredProduct
          ? `${Number(order.limitPrice).toFixed(2)}%`
          : OrderFormatters.formatWithCurrency(order.limitPrice, order.currency))
      : null;

    const confirmationRows = [
      ['Order Type', `<span style="display: inline-block; padding: 4px 12px; border-radius: 12px; background-color: ${order.orderType === 'buy' ? '#EAF3EE' : '#F9EDEB'}; color: ${order.orderType === 'buy' ? EMAIL.success : EMAIL.danger}; font-weight: 600; text-transform: uppercase; font-size: 12px;">${OrderFormatters.orderDirectionLabel(order)}</span>`],
      [hasRealIsin(order) ? 'Security' : 'Description', order.securityName],
      ...(hasRealIsin(order) ? [['ISIN', `<span style="font-family: Consolas, 'Courier New', monospace;">${order.isin}</span>`]] : []),
      ...optionDetailRows(order),
      [quantityLabel, OrderFormatters.formatQuantity(order.quantity), EMAIL.amberText],
      ...(isStructuredProduct
        ? (priceCellHtml ? [['Price', priceCellHtml]] : [])
        : order.assetType === 'term_deposit' ? []
        : [
            ['Price Type', order.priceType === 'market' ? 'Market' : 'Limit'],
            ...(order.priceType === 'limit' && priceCellHtml ? [['Limit Price', priceCellHtml]] : []),
            ...(order.validityType ? [['Validity', order.validityType === 'gtc' ? 'Good Till Canceled' : order.validityType === 'gtd' ? `Good Till ${order.validityDate ? OrderFormatters.formatDate(order.validityDate) : 'Date'}` : 'Day Order']] : [])
          ]),
      ...(order.broker ? [['Broker', order.broker]] : []),
      ['Client', clientName],
      ['Account', bankAccount?.accountNumber || order.portfolioCode || 'N/A']
    ];

    const emailHtml = emailShell({
      title: 'Order Confirmation',
      subtitle: order.orderReference,
      bodyHtml: `${emailKvTable(confirmationRows)}${issuerContactHtml}
              <p style="margin: 20px 0 0; color: ${EMAIL.muted}; font-size: 13px; text-align: center;">Please find the full order confirmation attached as PDF.</p>`,
      signatureName: userDisplayName,
      footerNote: 'This order confirmation was sent via Ambervision by Amberlake Partners.'
    });

    // Same rows as the HTML, stripped of markup, so the plain-text part of the
    // confirmation can never describe a different trade from the HTML one.
    const emailText = `
Order Confirmation: ${order.orderReference}

${confirmationRows.map(([label, value]) => `${label}: ${String(value).replace(/<[^>]*>/g, '').trim()}`).join('\n')}
${order.notes ? `\nNotes: ${order.notes}` : ''}
${issuerContactText}
Please find the full order confirmation attached as PDF.

Best regards,
${userDisplayName}
    `.trim();

    // Step 3: Send email with PDF attachment (and termsheet for structured products)
    const attachments = [{
      name: `${order.orderReference}.pdf`,
      content: pdfResult.pdfData,
      isBase64: true
    }];

    // For structured products, attach the initial termsheet uploaded at order creation
    const termsheetAttachment = loadInitialTermsheetAttachment(order);
    if (termsheetAttachment) {
      attachments.push({
        name: termsheetAttachment.name,
        content: termsheetAttachment.content,
        isBase64: true
      });
    }

    try {
      await EmailService.sendEmail({
        subject,
        html: emailHtml,
        text: emailText,
        to: [{ email: recipients.to, name: recipients.matched ? `${bank.name} - ${recipients.deskLabel}` : bank.name }],
        attachments
      });

      console.log(`[ORDERS] Email sent successfully to: ${recipients.to} (${recipients.deskLabel}) by ${userDisplayName}`);

      // Step 4: Mark order as sent
      await OrdersCollection.updateAsync(orderId, {
        $set: {
          status: ORDER_STATUSES.SENT,
          sentAt: new Date(),
          sentTo: recipients.to,
          sentMethod: 'sendpulse',
          updatedAt: new Date(),
          updatedBy: userId
        }
      });

      return {
        success: true,
        orderId,
        sentTo: recipients.to,
        orderReference: order.orderReference
      };

    } catch (emailError) {
      console.error('[ORDERS] Error sending email:', emailError);
      throw new Meteor.Error('email-failed', `Failed to send email: ${emailError.message}`);
    }
  },

  /**
   * Check if an order has been booked in the PMS by matching against PMSOperations
   */
  async 'orders.checkBooking'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    return await matchOrderToOperations(order);
  },

  /**
   * Batch check booking status for multiple orders (called on page load)
   */
  async 'orders.batchCheckBooking'({ orderIds, sessionId }) {
    check(orderIds, [String]);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    validateOrderPermission(user);

    const results = {};
    const orders = await OrdersCollection.find({ _id: { $in: orderIds } }).fetchAsync();

    for (const order of orders) {
      try {
        results[order._id] = await matchOrderToOperations(order);
      } catch (err) {
        results[order._id] = { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: err.message };
      }
    }

    return results;
  },

  /**
   * Claim a pending-validation order for review. Sets a soft lock with a
   * 5-minute TTL so other reviewers see "Being reviewed by …" and their
   * Validate button is disabled. Returns the resulting reviewer info.
   *
   * Idempotent: re-claiming your own lock refreshes it.
   * Stale-takeover: if the existing claim is older than the TTL, anyone can
   * take it over.
   */
  async 'orders.claimForReview'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    if (!user.canValidateOrders && user.role !== 'compliance') {
      throw new Meteor.Error('not-authorized', 'You do not have order validation permission');
    }

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) throw new Meteor.Error('not-found', 'Order not found');
    await validateOrderAccess(order, user);

    // Four-eyes: the order's own creator must never hold the review lock. They
    // cannot validate it anyway, and claiming it would soft-block every other
    // validator for the full TTL window — exactly the situation that leaves an
    // order un-validatable by anyone.
    if (order.createdBy === userId) {
      throw new Meteor.Error('four-eyes-violation', 'You cannot review your own order (four-eyes principle)');
    }

    const lockStaleBefore = new Date(Date.now() - REVIEW_LOCK_TTL_MS);
    const updateResult = await OrdersCollection.rawCollection().findOneAndUpdate(
      {
        _id: orderId,
        $or: [
          { reviewingBy: { $in: [null, userId] } },
          { reviewingBy: { $exists: false } },
          { reviewingAt: { $lt: lockStaleBefore } }
        ]
      },
      {
        $set: {
          reviewingBy: userId,
          reviewingByName: userDisplayName,
          reviewingAt: new Date()
        }
      },
      // includeResultMetadata: true keeps the legacy { value, ok } shape.
      // MongoDB Node driver v6 otherwise returns the document directly, so
      // updateResult.value would be undefined even on success — which made
      // every claim/validate/modify wrongly report "locked-by-other".
      { returnDocument: 'after', includeResultMetadata: true }
    );

    if (!updateResult.value) {
      const current = await OrdersCollection.findOneAsync(orderId);
      const whoLabel = current?.reviewingByName || 'another user';
      const since = current?.reviewingAt
        ? new Date(current.reviewingAt).toLocaleTimeString('en-US', { timeZone: OrderFormatters.DISPLAY_TIMEZONE, hour: '2-digit', minute: '2-digit' })
        : '';
      throw new Meteor.Error(
        'locked-by-other',
        `This order is currently being reviewed by ${whoLabel}${since ? ` since ${since}` : ''}.`
      );
    }

    return {
      reviewingBy: userId,
      reviewingByName: userDisplayName,
      reviewingAt: updateResult.value.reviewingAt
    };
  },

  /**
   * Release a review lock you hold. No-op if you don't hold it.
   */
  async 'orders.releaseReview'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { userId } = await validateSession(sessionId);

    await OrdersCollection.rawCollection().updateOne(
      { _id: orderId, reviewingBy: userId },
      {
        $unset: {
          reviewingBy: '',
          reviewingByName: '',
          reviewingAt: ''
        }
      }
    );

    return { released: true };
  },

  /**
   * Claim the review lock on every pending member of a bulk in one round-trip.
   * Members the caller created are skipped (four-eyes), members locked by
   * someone else are reported rather than thrown, so a validator can still
   * review the rest of the block.
   */
  async 'orders.claimBulkForReview'({ bulkOrderGroupId, sessionId }) {
    check(bulkOrderGroupId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    if (!user.canValidateOrders && user.role !== 'compliance') {
      throw new Meteor.Error('not-authorized', 'You do not have order validation permission');
    }

    const members = await OrdersCollection.find({
      bulkOrderGroupId,
      status: ORDER_STATUSES.PENDING_VALIDATION
    }).fetchAsync();
    if (members.length === 0) {
      throw new Meteor.Error('not-found', 'No order of this block is pending validation');
    }

    const lockStaleBefore = new Date(Date.now() - REVIEW_LOCK_TTL_MS);
    const claimed = [];
    const lockedByOther = [];
    const skippedOwn = [];

    for (const order of members) {
      await validateOrderAccess(order, user);
      if (order.createdBy === userId) {
        skippedOwn.push(order._id);
        continue;
      }
      const updateResult = await OrdersCollection.rawCollection().findOneAndUpdate(
        {
          _id: order._id,
          $or: [
            { reviewingBy: { $in: [null, userId] } },
            { reviewingBy: { $exists: false } },
            { reviewingAt: { $lt: lockStaleBefore } }
          ]
        },
        { $set: { reviewingBy: userId, reviewingByName: userDisplayName, reviewingAt: new Date() } },
        { returnDocument: 'after', includeResultMetadata: true }
      );
      if (updateResult.value) {
        claimed.push(order._id);
      } else {
        const current = await OrdersCollection.findOneAsync(order._id);
        lockedByOther.push({
          orderId: order._id,
          orderReference: order.orderReference,
          reviewingByName: current?.reviewingByName || 'another user'
        });
      }
    }

    return { claimed, lockedByOther, skippedOwn };
  },

  /**
   * Release every review lock the caller holds on a bulk. No-op for locks held
   * by others.
   */
  async 'orders.releaseBulkReview'({ bulkOrderGroupId, sessionId }) {
    check(bulkOrderGroupId, String);
    check(sessionId, String);

    const { userId } = await validateSession(sessionId);

    const result = await OrdersCollection.rawCollection().updateMany(
      { bulkOrderGroupId, reviewingBy: userId },
      { $unset: { reviewingBy: '', reviewingByName: '', reviewingAt: '' } }
    );

    return { released: result.modifiedCount || 0 };
  },

  /**
   * Validate several members of a bulk in one call. Each order still goes
   * through orders.validate, so the four-eyes, attestation, access and
   * atomic-transition rules live in exactly one place; this method only
   * loops, aggregates, and returns one email payload per client.
   *
   * Sequential on purpose: each validation renders a PDF, and N concurrent
   * renders would starve the browser pool.
   */
  async 'orders.validateBulk'({ bulkOrderGroupId, orderIds, attestations, sessionId }) {
    check(bulkOrderGroupId, String);
    check(orderIds, [String]);
    check(attestations, Match.Maybe(Object));
    check(sessionId, String);

    // N PDF renders — do not hold up the caller's other method calls.
    this.unblock();

    await validateSession(sessionId);

    const members = await OrdersCollection.find(
      { _id: { $in: orderIds }, bulkOrderGroupId },
      { fields: { _id: 1, orderReference: 1 } }
    ).fetchAsync();
    const memberRefs = new Map(members.map(m => [m._id, m.orderReference]));

    const results = [];
    const errors = [];
    let termsheet = null;

    for (const orderId of orderIds) {
      if (!memberRefs.has(orderId)) {
        errors.push({ orderId, orderReference: null, error: 'Order does not belong to this block' });
        continue;
      }
      try {
        const result = await Meteor.callAsync('orders.validate', {
          orderId,
          sessionId,
          emailComparedAttestation: !!(attestations && attestations[orderId])
        });
        // Every member of a bulk carries the same termsheet; return it once.
        if (!termsheet && result.termsheet) termsheet = result.termsheet;
        results.push({
          orderId,
          orderReference: result.orderReference,
          pdfData: result.pdfData,
          emailData: result.emailData
        });
      } catch (error) {
        errors.push({
          orderId,
          orderReference: memberRefs.get(orderId),
          error: error.reason || error.message
        });
      }
    }

    console.log(`[ORDERS] Bulk validation ${bulkOrderGroupId}: ${results.length} validated, ${errors.length} errors`);

    return { results, errors, termsheet };
  },

  /**
   * Validate an order (four-eyes principle: move from PENDING_VALIDATION → PENDING)
   * Enforces: validator !== creator, validator has canValidateOrders permission,
   * and the review-lock claim mechanism — only the user holding the lock (or
   * one with a stale-takeover-eligible empty/expired lock) can validate.
   *
   * The status transition itself is an atomic compare-and-set so two
   * simultaneous clicks cannot both succeed; the second click gets a clear
   * "already validated by [name]" error rather than triggering a duplicate
   * send to the bank.
   */
  async 'orders.validate'({ orderId, sessionId, emailComparedAttestation }) {
    check(orderId, String);
    check(sessionId, String);
    check(emailComparedAttestation, Match.Maybe(Boolean));

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    // Check permission (compliance role always has validation rights)
    if (!user.canValidateOrders && user.role !== 'compliance') {
      throw new Meteor.Error('not-authorized', 'You do not have order validation permission');
    }

    // GDPR accountability: order validation is a four-eyes control decision.
    const auditValidation = (outcome) => AuditLog.record({
      actorUserId: userId,
      actorRole: user.role,
      action: outcome,
      targetType: 'order',
      targetId: orderId
    });

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) {
      throw new Meteor.Error('not-found', 'Order not found');
    }

    if (order.status !== ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Order is not pending validation');
    }

    // The account may have been switched to view only after the order was entered.
    const validationAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
    if (validationAccount && !accountAllowsOrders(validationAccount)) {
      throw new Meteor.Error('view-only-account', 'This account is view only: no power of attorney to place orders on it');
    }

    // RMs/Assistants can only validate orders for their own clients
    await validateOrderAccess(order, user);

    // Four-eyes: creator cannot validate their own order
    if (order.createdBy === userId) {
      throw new Meteor.Error('four-eyes-violation', 'You cannot validate your own order (four-eyes principle)');
    }

    // When no client-order trace is attached, the validator must explicitly
    // attest that they have compared the order to the original client instruction.
    const hasClientOrderTrace = (order.emailTraces || []).some(t => t.traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER);
    if (!hasClientOrderTrace && !emailComparedAttestation) {
      throw new Meteor.Error(
        'attestation-required',
        'You must confirm you compared this order to the original client instruction'
      );
    }

    // Atomic transition: only one caller can flip the order out of
    // PENDING_VALIDATION. The match condition also requires the review lock
    // to be either ours, absent, or stale (>5 min old) — preventing another
    // reviewer who currently holds a fresh lock from racing us.
    const lockStaleBefore = new Date(Date.now() - REVIEW_LOCK_TTL_MS);
    const validateSet = {
      status: ORDER_STATUSES.PENDING,
      validatedBy: userId,
      validatedByName: userDisplayName,
      validatedAt: new Date(),
      updatedAt: new Date(),
      updatedBy: userId
    };
    if (!hasClientOrderTrace) {
      validateSet.validationAttestation = {
        emailCompared: true,
        by: userId,
        byName: userDisplayName,
        at: new Date()
      };
    }
    const updateResult = await OrdersCollection.rawCollection().findOneAndUpdate(
      {
        _id: orderId,
        status: ORDER_STATUSES.PENDING_VALIDATION,
        $or: [
          { reviewingBy: { $in: [null, userId] } },
          { reviewingBy: { $exists: false } },
          { reviewingAt: { $lt: lockStaleBefore } }
        ]
      },
      {
        $set: validateSet,
        $unset: {
          reviewingBy: '',
          reviewingByName: '',
          reviewingAt: ''
        }
      },
      // includeResultMetadata: true keeps the legacy { value, ok } shape.
      // MongoDB Node driver v6 otherwise returns the document directly, so
      // updateResult.value would be undefined even on success — which made
      // every claim/validate/modify wrongly report "locked-by-other".
      { returnDocument: 'after', includeResultMetadata: true }
    );

    if (!updateResult.value) {
      // Re-read to see why the atomic update failed and craft a precise error
      const current = await OrdersCollection.findOneAsync(orderId);
      if (!current) {
        throw new Meteor.Error('not-found', 'Order not found');
      }
      if (current.status !== ORDER_STATUSES.PENDING_VALIDATION) {
        const whoLabel = current.validatedByName || 'another user';
        throw new Meteor.Error('already-validated', `This order was already validated by ${whoLabel}.`);
      }
      if (current.reviewingBy && current.reviewingBy !== userId) {
        const whoLabel = current.reviewingByName || 'another user';
        throw new Meteor.Error('locked-by-other', `This order is currently being reviewed by ${whoLabel}.`);
      }
      throw new Meteor.Error('validation-failed', 'Could not validate this order — please refresh and try again.');
    }

    console.log(`[ORDERS] Validated order ${order.orderReference} by ${userDisplayName} (${userId})`);
    await auditValidation('order.validated');

    // Generate PDF and prepare email data for Outlook
    let pdfData = null;
    let emailData = null;
    try {
      // Shared with orders.prepareEmail and orders.sendViaGraph. This path used
      // to build its own copy WITHOUT the live issuer, so the mail handed over at
      // validation could carry a different subject/body than the same order's
      // resend — going through one builder removes that divergence.
      const payload = await buildOrderEmailPayload(order, user);
      pdfData = payload.pdfData;
      emailData = payload.emailData;

      console.log(`[ORDERS] PDF generated and email data prepared for order ${order.orderReference}`);
    } catch (pdfError) {
      console.error('[ORDERS] Error generating PDF during validation:', pdfError);
      // Don't fail the validation if PDF generation fails
    }

    // Notify the creator that their order was validated
    try {
      const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
      await NotificationHelpers.create({
        userId: order.createdBy,
        type: 'success',
        title: 'Order Validated',
        message: `Your order ${order.orderReference} (${order.securityName}) has been validated by ${userDisplayName}.`,
        metadata: { orderId, orderReference: order.orderReference },
        eventType: EVENT_TYPES.ORDER_VALIDATED
      });
    } catch (notifError) {
      console.error('[ORDERS] Error sending validation notification:', notifError);
    }

    const termsheet = loadInitialTermsheetAttachment(order);

    return {
      success: true,
      orderId,
      orderReference: order.orderReference,
      newStatus: ORDER_STATUSES.PENDING,
      pdfData,
      emailData,
      termsheet
    };
  },

  /**
   * Confirm order was transmitted to bank (move from PENDING → TRANSMITTED)
   */
  async 'orders.confirmTransmitted'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) {
      throw new Meteor.Error('not-found', 'Order not found');
    }
    await validateOrderAccess(order, user);

    if (order.status !== ORDER_STATUSES.PENDING) {
      throw new Meteor.Error('invalid-operation', 'Order is not in pending status');
    }

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: ORDER_STATUSES.TRANSMITTED,
        transmittedBy: userId,
        transmittedByName: userDisplayName,
        transmittedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Order ${order.orderReference} marked as transmitted by ${userDisplayName} (${userId})`);

    return { success: true, orderId, newStatus: ORDER_STATUSES.TRANSMITTED };
  },

  // NOTE: 'orders.openEmlFile' was removed. It wrote a client-supplied filename
  // into a shell `exec` command and an unchecked `path.join`, allowing command
  // injection / arbitrary file write on the server. It had no client caller
  // (the .eml flow builds and downloads the file client-side).

  /**
   * Reject an order validation (move from PENDING_VALIDATION → REJECTED), or reject an
   * already-validated order that hasn't been transmitted to the bank yet (PENDING → REJECTED).
   * The latter is the safety valve for a mistake caught after four-eyes validation but before
   * the order ever reaches the bank — it must go through this audited path, not a silent Modify
   * or a hard Delete, so the correction is re-entered as a brand new order rather than patched
   * in place.
   */
  async 'orders.rejectValidation'({ orderId, reason, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(reason, Match.Maybe(String));

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    // Check permission (compliance role always has validation rights)
    if (!user.canValidateOrders && user.role !== 'compliance') {
      throw new Meteor.Error('not-authorized', 'You do not have order validation permission');
    }

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) {
      throw new Meteor.Error('not-found', 'Order not found');
    }

    const isPostValidationReject = order.status === ORDER_STATUSES.PENDING;
    if (order.status !== ORDER_STATUSES.PENDING_VALIDATION && !isPostValidationReject) {
      throw new Meteor.Error('invalid-operation', 'Order is not pending validation');
    }

    // Rejecting an order that's already been validated undoes an approval that already
    // happened — require a reason for the audit trail (pre-validation rejection stays optional).
    if (isPostValidationReject && (!reason || !reason.trim())) {
      throw new Meteor.Error('reason-required', 'A rejection reason is required to reject a validated order');
    }

    // RMs/Assistants can only reject orders for their own clients
    await validateOrderAccess(order, user);

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: ORDER_STATUSES.REJECTED,
        rejectedBy: userId,
        rejectedByName: userDisplayName,
        rejectedAt: new Date(),
        rejectionReason: reason || null,
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Rejected order ${order.orderReference} by ${userDisplayName} (${userId}) - Reason: ${reason || 'N/A'}`);
    await AuditLog.record({
      actorUserId: userId,
      actorRole: user.role,
      action: 'order.rejected',
      targetType: 'order',
      targetId: orderId
    });

    // Notify the creator that their order was rejected
    try {
      const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
      await NotificationHelpers.create({
        userId: order.createdBy,
        type: 'error',
        title: 'Order Rejected',
        message: `Your order ${order.orderReference} (${order.securityName}) was rejected by ${userDisplayName}.${reason ? ` Reason: ${reason}` : ''}`,
        metadata: { orderId, orderReference: order.orderReference, reason },
        eventType: EVENT_TYPES.ORDER_REJECTED
      });
    } catch (notifError) {
      console.error('[ORDERS] Error sending rejection notification:', notifError);
    }

    return { success: true, orderId };
  },

  /**
   * Request revision - send order back to creator for modifications
   * Validator asks the original input person to revise and resubmit
   */
  async 'orders.requestRevision'({ orderId, reason, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(reason, Match.Maybe(String));

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    if (!user.canValidateOrders && user.role !== 'compliance') {
      throw new Meteor.Error('not-authorized', 'You do not have order validation permission');
    }

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) {
      throw new Meteor.Error('not-found', 'Order not found');
    }

    if (order.status !== ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Order is not pending validation');
    }

    // RMs/Assistants can only act on orders for their own clients
    await validateOrderAccess(order, user);

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: ORDER_STATUSES.REVISION_REQUESTED,
        revisionRequestedBy: userId,
        revisionRequestedByName: userDisplayName,
        revisionRequestedAt: new Date(),
        revisionReason: reason || null,
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Revision requested for order ${order.orderReference} by ${userDisplayName} (${userId}) - Reason: ${reason || 'N/A'}`);

    // Notify the creator to revise their order
    try {
      const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
      await NotificationHelpers.create({
        userId: order.createdBy,
        type: 'warning',
        title: 'Order Revision Requested',
        message: `${userDisplayName} requests you revise order ${order.orderReference} (${order.securityName}).${reason ? ` Note: ${reason}` : ''}`,
        metadata: { orderId, orderReference: order.orderReference, reason },
        eventType: EVENT_TYPES.ORDER_REVISION_REQUESTED || 'order_revision_requested'
      });
    } catch (notifError) {
      console.error('[ORDERS] Error sending revision notification:', notifError);
    }

    return { success: true, orderId };
  },

  /**
   * Resubmit a revised order - creator sends it back for validation
   */
  async 'orders.resubmitForValidation'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) {
      throw new Meteor.Error('not-found', 'Order not found');
    }

    if (order.status !== ORDER_STATUSES.REVISION_REQUESTED) {
      throw new Meteor.Error('invalid-operation', 'Order is not in revision requested status');
    }

    // Only the original creator can resubmit
    if (order.createdBy !== userId) {
      throw new Meteor.Error('not-authorized', 'Only the original creator can resubmit this order');
    }

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: ORDER_STATUSES.PENDING_VALIDATION,
        revisionResubmittedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Order ${order.orderReference} resubmitted for validation by ${userDisplayName} (${userId})`);

    // Notify validators
    try {
      const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
      const validators = await UsersCollection.find({
        canValidateOrders: true,
        _id: { $ne: userId },
        role: { $in: ['superadmin', 'admin', 'rm', 'compliance', 'staff'] }
      }).fetchAsync();

      if (validators.length > 0) {
        await NotificationHelpers.createForMultipleUsers({
          userIds: validators.map(v => v._id),
          type: 'warning',
          title: 'Revised Order Pending Validation',
          message: `Order ${order.orderReference} (${order.securityName}) has been revised by ${userDisplayName} and requires validation.`,
          metadata: { orderId, orderReference: order.orderReference },
          eventType: EVENT_TYPES.ORDER_PENDING_VALIDATION
        });
      }
    } catch (notifError) {
      console.error('[ORDERS] Error sending resubmit notification:', notifError);
    }

    return { success: true, orderId };
  },

  /**
   * Distinct validators of orders the current user is allowed to see (for the order book filter)
   */
  async 'orders.distinctValidators'({ sessionId }) {
    check(sessionId, String);

    const { user } = await validateSession(sessionId);

    // Reuse the same role-based scoping as orders.list
    const query = { validatedByName: { $exists: true, $ne: null } };
    if (user.role === 'client') {
      query.clientId = user._id;
    }
    // All staff see every validator name

    const names = await OrdersCollection.rawCollection().distinct('validatedByName', query);
    return names.filter(Boolean).sort((a, b) => a.localeCompare(b));
  },

  /**
   * List orders pending validation (for the validation blotter)
   */
  async 'orders.listPendingValidation'({ sessionId }) {
    check(sessionId, String);

    const { user } = await validateSession(sessionId);

    // All staff can see the blotter (validate/reject buttons require canValidateOrders on the client)
    const staffRoles = ['superadmin', 'admin', 'rm', 'compliance', 'staff'];
    if (!staffRoles.includes(user.role)) {
      return { orders: [] };
    }

    const query = { status: { $in: [ORDER_STATUSES.PENDING_VALIDATION, ORDER_STATUSES.PENDING_MODIFICATION, ORDER_STATUSES.REVISION_REQUESTED] } };

    // All staff see the full pending-validation blotter; the validate/reject
    // buttons remain gated by canValidateOrders client-side.

    const orders = await OrdersCollection.find(
      query,
      { sort: { createdAt: -1 } }
    ).fetchAsync();

    // Enrich orders with client and bank names
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      const client = await UsersCollection.findOneAsync(order.clientId);
      const bank = await BanksCollection.findOneAsync(order.bankId);
      const creator = await UsersCollection.findOneAsync(order.createdBy);
      const creatorName = creator
        ? `${creator.profile?.firstName || ''} ${creator.profile?.lastName || ''}`.trim()
        : 'Unknown';

      return {
        ...OrderHelpers.formatOrderDetails(order),
        clientName: client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown',
        bankName: bank?.name || 'Unknown',
        createdByName: creatorName
      };
    }));

    return { orders: enrichedOrders };
  }
});

/**
 * Convert a PMS-sourced price into the convention the order model uses for
 * limitPrice/executedPrice. Percentage-quoted instruments arrive as decimals
 * from some sources (parsers normalise pmsHoldings prices to 1.0001 = 100.01 %,
 * and a price derived from grossAmount / nominal is cash-per-unit-of-nominal)
 * and as percent from others (CMB operation rows carry price 100 = 100 %).
 *
 * Disambiguation is corroborated against the operation's own cash leg rather
 * than guessed from magnitude: |cash| / |nominal| × 100 is the percent of par
 * the bank actually settled, so whichever reading of `price` sits closer to it
 * wins. The two candidate readings are 100× apart while the cash check is only
 * off by fees/accrued interest (well under 1 %), so the comparison is decisive
 * — and unlike a magnitude cut-off it stays correct for a distressed bond
 * genuinely trading at 5 % of par.
 *
 * Falls back to a magnitude test only when no cash leg is available, mirroring
 * the parser-level heuristic (a value already in percent range is left alone,
 * so an unnormalised price isn't inflated to 10 000 %).
 */
function toOrderPriceConvention(price, assetType, cashAmount, nominalQuantity) {
  if (typeof price !== 'number' || !isFinite(price) || price === 0) return price;
  if (!quotesPriceAsPercent(assetType)) return price;

  const cash = Math.abs(cashAmount || 0);
  const nominal = Math.abs(nominalQuantity || 0);
  if (cash > 0 && nominal > 0) {
    const settledPercent = (cash / nominal) * 100;
    if (isFinite(settledPercent) && settledPercent > 0) {
      const asPercentError = Math.abs(Math.abs(price) - settledPercent) / settledPercent;
      const asDecimalError = Math.abs(Math.abs(price) * 100 - settledPercent) / settledPercent;
      return asDecimalError < asPercentError ? price * 100 : price;
    }
  }

  return Math.abs(price) < 10 ? price * 100 : price;
}

/**
 * Match an order against PMSOperations to detect if it was booked
 */
/**
 * Days after the order in which its booking is looked for. Funds dealing
 * monthly or on notice are booked weeks after the order: the bank first takes
 * the cash as a subscription prepayment and delivers the units after the NAV.
 */
function settlementWindowDays(order) {
  return order.assetType === ASSET_TYPES.FUND ? 75 : 30;
}

/**
 * Fallback when no pmsOperations row matches: look for a freshly-appeared
 * pmsHoldings row covering the same ISIN/portfolio. Only confirms if the
 * holding is NEW (no earlier snapshot with this uniqueKey) — otherwise the
 * costPrice is a blend that doesn't represent this specific order's execution.
 *
 * Returns the same shape as matchOrderToOperations or null when no fit.
 */
async function tryHoldingsFallback(order, escapedCode, orderDate) {
  const windowStart = new Date(orderDate);
  windowStart.setDate(windowStart.getDate() - 2);
  const windowEnd = new Date(orderDate);
  windowEnd.setDate(windowEnd.getDate() + settlementWindowDays(order));

  // Find the earliest holding for this ISIN+portfolio in the window.
  const candidateHoldings = await PMSHoldingsCollection.find({
    isin: order.isin,
    portfolioCode: { $regex: `^${escapedCode}` },
    snapshotDate: { $gte: windowStart, $lte: windowEnd },
    quantity: { $ne: 0 }
  }, {
    sort: { snapshotDate: 1 },
    limit: 5
  }).fetchAsync();

  if (candidateHoldings.length === 0) return null;
  const earliest = candidateHoldings[0];
  if (!earliest.costPrice || earliest.costPrice === 0) return null;

  // Confirm this is truly a new position (no prior snapshot for the same
  // uniqueKey before our window) — otherwise costPrice is a blend.
  if (earliest.uniqueKey) {
    const priorCount = await PMSHoldingsCollection.find({
      uniqueKey: earliest.uniqueKey,
      snapshotDate: { $lt: windowStart }
    }, { limit: 1 }).countAsync();
    if (priorCount > 0) return null;
  }

  // Quantity sanity: order qty should be in the same ballpark as the holding
  // (within 5%). Avoids matching against an unrelated lot that happened to
  // appear at the same time.
  const holdingQty = Math.abs(earliest.quantity);
  const orderQty = Math.abs(order.quantity || 0);
  const qtyRatio = orderQty > 0 && holdingQty > 0
    ? Math.min(orderQty, holdingQty) / Math.max(orderQty, holdingQty)
    : 0;
  if (qtyRatio < 0.95) return null;

  // Quotation-convention translation. Bank parsers normalise percentage-quoted
  // instruments to decimals in pmsHoldings (1.0001 = 100.01 % of par), whereas
  // orders carry those same prices as percent of par (limitPrice 100 = 100 %).
  // Copying costPrice through untranslated made an executed structured product
  // display as "1.00 %" instead of "100.01 %". The cash leg keeps using the
  // decimal price, since quantity × decimal price is the currency amount.
  const cashAmount = Math.abs(holdingQty * earliest.costPrice);
  const executionPrice = toOrderPriceConvention(earliest.costPrice, order.assetType, cashAmount, holdingQty);

  return {
    bookingStatus: 'confirmed',
    matchedOperation: {
      operationDate: earliest.snapshotDate,
      quantity: earliest.quantity,
      price: executionPrice,
      grossAmount: -cashAmount * (order.orderType === 'buy' ? 1 : -1),
      operationCode: null,
      instrumentName: earliest.securityName || null,
      remark: 'Synthesised from pmsHoldings (no operation row delivered)',
      operationType: 'HOLDINGS_FALLBACK'
    },
    confidence: 'holdings_fallback',
    reason: `Position appeared on ${earliest.snapshotDate.toISOString().split('T')[0]} at cost ${executionPrice} ${quotesPriceAsPercent(order.assetType) ? '%' : (earliest.currency || '')} — no transaction row in PMS but holding is fresh.`
  };
}

/**
 * The legs, currencies and quoted rate of one FX_TRADE operation, read from its
 * harmonized `std` block so the same rules hold for every bank. A row is one leg
 * (std.currency / std.amount) unless the parser listed both legs in std.fxLegs.
 * Records stored before `std` existed fall back to their raw fields.
 */
function fxOperationView(op) {
  const std = op.std || {};
  const upper = (c) => (typeof c === 'string' && /^[A-Za-z]{3}$/.test(c.trim()) ? c.trim().toUpperCase() : null);
  let legs = (std.fxLegs || []).map(l => ({ currency: upper(l.currency), amount: Math.abs(l.amount || 0) }));
  if (legs.length === 0) {
    const currency = upper(std.currency || op.currency || op.operationCurrency);
    const amount = [std.amount, op.netAmount, op.grossAmount, op.amount, op.quantity]
      .map(v => Math.abs(Number(v) || 0)).find(v => v > 0) || 0;
    legs = [{ currency, amount }];
  }
  legs = legs.filter(l => l.currency && l.amount > 0);
  const base = upper(std.fxBaseCurrency);
  const quote = upper(std.fxQuoteCurrency);
  const currencies = new Set([
    ...legs.map(l => l.currency),
    ...(std.fxCurrencies || []).map(upper),
    base, quote,
    upper(op.operationCurrency), upper(op.settlementCurrency), upper(op.baseCurrency)
  ].filter(Boolean));
  const rate = Number(std.fxRate || op.fxRate) || null;
  return { legs, currencies, rate, base: base && quote ? base : null, quote: base && quote ? quote : null };
}

/**
 * Executed rate of a deal, expressed in the order's pair (1 pairBase = rate pairQuote).
 * In order of reliability:
 *   1. the bank's dealt rate when it says which way it is quoted;
 *   2. the ratio of the two settled legs;
 *   3. the bank's rate with no stated orientation, turned the way that makes one
 *      leg convert into the order's amount;
 *   4. that rate as given.
 */
function fxDealRate(deal, pairBase, pairQuote, orderAmount, amountCurrency) {
  const { rate } = deal;
  if (rate && deal.base && deal.quote) {
    if (deal.base === pairBase && deal.quote === pairQuote) return rate;
    if (deal.base === pairQuote && deal.quote === pairBase) return 1 / rate;
  }
  const legIn = (c) => deal.legs.find(l => l.currency === c);
  const baseLeg = legIn(pairBase);
  const quoteLeg = legIn(pairQuote);
  if (baseLeg && quoteLeg) return quoteLeg.amount / baseLeg.amount;
  if (!rate) return null;
  if (orderAmount > 0) {
    // Order amount in the quote currency, leg in the base: quote = base × rate(B/Q)
    if (baseLeg && amountCurrency === pairQuote) {
      return Math.abs(baseLeg.amount * rate - orderAmount) <= Math.abs(baseLeg.amount / rate - orderAmount) ? rate : 1 / rate;
    }
    // Order amount in the base currency, leg in the quote: base = quote / rate(B/Q)
    if (quoteLeg && amountCurrency === pairBase) {
      return Math.abs(quoteLeg.amount / rate - orderAmount) <= Math.abs(quoteLeg.amount * rate - orderAmount) ? rate : 1 / rate;
    }
  }
  return rate;
}

/**
 * Settlement matcher for FX orders. FX trades have no ISIN, so the bank's
 * FX_TRADE operations of the portfolio are grouped into deals (same day and bank
 * reference: banks that book one row per currency leg give both rows the same
 * reference) and a deal matches on: the order's currency pair, the notional (the
 * leg in the order's amount currency, or the other leg converted at the deal
 * rate), and proximity to the value/forward date. The executed rate is the deal's
 * rate in the order's pair (see fxDealRate). Bank-agnostic: it reads the `std`
 * block every parser writes. Returns the same shape as matchOrderToOperations.
 */
async function matchFxOrderToOperations(order) {
  const escapedCode = order.portfolioCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const orderDate = order.createdAt || new Date();
  const valueDate = order.fxForwardDate || order.fxValueDate || null;

  const windowStart = new Date(orderDate);
  windowStart.setDate(windowStart.getDate() - 5);
  let windowEnd = new Date(orderDate);
  windowEnd.setDate(windowEnd.getDate() + 30);
  // Forwards settle on a value date that can be well beyond the +30d window.
  if (valueDate) {
    const vd = new Date(valueDate);
    vd.setDate(vd.getDate() + 5);
    if (vd > windowEnd) windowEnd = vd;
  }

  const ops = await PMSOperationsCollection.find({
    portfolioCode: { $regex: `^${escapedCode}` },
    operationType: 'FX_TRADE',
    operationDate: { $gte: windowStart, $lte: windowEnd },
    isActive: true
  }, { sort: { operationDate: -1 }, limit: 50 }).fetchAsync();

  if (ops.length === 0) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'No matching FX_TRADE operations found' };
  }

  // Order pair: fxPair "EUR/USD" is 1 EUR = rate USD; buy/sell currencies as fallback
  const [pairBase, pairQuote] = (order.fxPair && order.fxPair.includes('/')
    ? order.fxPair.split('/')
    : [order.fxBuyCurrency, order.fxSellCurrency]).map(c => (c || '').trim().toUpperCase());
  const pairKnown = !!(pairBase && pairQuote);
  const amountCurrency = (order.fxAmountCurrency || pairBase || '').toUpperCase();
  const orderAmount = Math.abs(order.quantity || 0);
  const refDate = valueDate ? new Date(valueDate) : new Date(orderDate);

  // Group the rows into deals
  const deals = new Map();
  for (const op of ops) {
    const day = new Date(op.operationDate).toISOString().slice(0, 10);
    const ref = op.std?.reference || op.operationNumber || op.operationCode || op.externalReference || op._id;
    const key = `${day}|${ref}`;
    if (!deals.has(key)) deals.set(key, { ops: [], legs: [], currencies: new Set(), rate: null, base: null, quote: null });
    const deal = deals.get(key);
    const view = fxOperationView(op);
    deal.ops.push(op);
    view.currencies.forEach(c => deal.currencies.add(c));
    for (const leg of view.legs) {
      const same = deal.legs.find(l => l.currency === leg.currency);
      if (!same) deal.legs.push({ ...leg });
      else same.amount = Math.max(same.amount, leg.amount); // a leg repeated, not added
    }
    if (view.rate && (!deal.rate || (view.base && !deal.base))) {
      deal.rate = view.rate; deal.base = view.base; deal.quote = view.quote;
    }
  }

  let best = null, bestScore = 0, bestRatio = 0, bestRate = null;
  for (const deal of deals.values()) {
    // The order's currency pair must align with the deal's currencies.
    if (pairKnown && !(deal.currencies.has(pairBase) && deal.currencies.has(pairQuote))) continue;
    // Credit the pair only when we actually verified it; otherwise amount + date must carry the match.
    let score = pairKnown ? 30 : 0;

    const dealRate = pairKnown ? fxDealRate(deal, pairBase, pairQuote, orderAmount, amountCurrency) : deal.rate;

    // Notional: the leg in the order's amount currency, else the other leg at the deal rate
    let dealAmount = deal.legs.find(l => l.currency === amountCurrency)?.amount || null;
    if (!dealAmount && dealRate && pairKnown) {
      const baseLeg = deal.legs.find(l => l.currency === pairBase);
      const quoteLeg = deal.legs.find(l => l.currency === pairQuote);
      if (amountCurrency === pairQuote && baseLeg) dealAmount = baseLeg.amount * dealRate;
      else if (amountCurrency === pairBase && quoteLeg) dealAmount = quoteLeg.amount / dealRate;
    }
    const ratio = orderAmount > 0 && dealAmount > 0
      ? Math.min(orderAmount, dealAmount) / Math.max(orderAmount, dealAmount)
      : 0;
    if (ratio >= 0.99) score += 50;
    else if (ratio >= 0.95) score += 35;
    else if (ratio >= 0.90) score += 20;

    const op0 = deal.ops[0];
    const daysDiff = Math.abs((new Date(op0.valueDate || op0.operationDate) - refDate) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 2) score += 25;
    else if (daysDiff <= 7) score += 15;
    else if (daysDiff <= 21) score += 5;

    if (score > bestScore) { bestScore = score; best = deal; bestRatio = ratio; bestRate = dealRate; }
  }

  if (!best) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'No FX operation with a matching currency pair found' };
  }

  // Require both an aligned pair and a tight amount match to auto-confirm.
  if (!(bestScore >= 70 && bestRatio >= 0.95)) {
    return {
      bookingStatus: bestScore >= 45 ? 'likely' : 'none',
      matchedOperation: null,
      confidence: bestScore >= 45 ? 'close_match' : null,
      reason: 'No confident FX match found'
    };
  }

  const op0 = best.ops[0];
  const opDate = op0.valueDate || op0.operationDate;
  const executedRate = bestRate ? Math.round(bestRate * 1e8) / 1e8 : (order.fxRate || null);
  const reference = op0.std?.reference || op0.operationNumber || op0.operationCode || '';
  return {
    bookingStatus: 'confirmed',
    matchedOperation: {
      operationDate: opDate,
      quantity: order.quantity,                       // FX "quantity" is the notional
      price: executedRate,                            // executed rate, in the order's pair
      grossAmount: op0.grossAmount || op0.amount || null,
      operationCode: reference || null,
      instrumentName: order.fxPair || null,
      remark: `Matched FX_TRADE ${reference}`.trim(),
      operationType: 'FX_TRADE'
    },
    confidence: 'fx_operation_match',
    reason: `Matching FX_TRADE operation found${order.fxPair ? ` (${order.fxPair}${executedRate ? ` ${executedRate}` : ''})` : ''}${opDate ? ` on ${new Date(opDate).toISOString().split('T')[0]}` : ''}.`
  };
}

/**
 * Settlement matcher for term-deposit orders. Term deposits carry no ISIN and
 * banks emit no dedicated TD operation type, so settlement is confirmed when a
 * matching TERM_DEPOSIT holding appears in PMSHoldings (the bank's own
 * statement): same portfolio, same currency, matching amount, and — when both
 * are present — a maturity date close to the order's. Placements/increases show
 * up this way; decreases/withdrawals (which don't add a position) fall back to
 * manual force-settle. Returns the same shape as matchOrderToOperations.
 */
async function matchTermDepositToHoldings(order) {
  const escapedCode = order.portfolioCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const orderDate = order.createdAt || new Date();
  const windowStart = new Date(orderDate);
  windowStart.setDate(windowStart.getDate() - 2);
  const windowEnd = new Date(orderDate);
  windowEnd.setDate(windowEnd.getDate() + 30);

  const depositCcy = (order.depositCurrency || order.currency || '').toUpperCase();

  const holdings = await PMSHoldingsCollection.find({
    portfolioCode: { $regex: `^${escapedCode}` },
    securityType: 'TERM_DEPOSIT',
    snapshotDate: { $gte: windowStart, $lte: windowEnd },
    quantity: { $ne: 0 }
  }, { sort: { snapshotDate: 1 }, limit: 25 }).fetchAsync();

  if (holdings.length === 0) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'No matching term-deposit holding found' };
  }

  const orderAmount = Math.abs(order.quantity || 0);
  let best = null, bestRatio = 0;
  for (const h of holdings) {
    if (depositCcy && (h.currency || '').toUpperCase() !== depositCcy) continue;

    // The principal may live on quantity, marketValue, or nominalValue depending
    // on the bank parser — compare against all and take the best ratio.
    const amts = [Math.abs(h.quantity || 0), Math.abs(h.marketValue || 0), Math.abs(h.nominalValue || 0)].filter(a => a > 0);
    let ratio = 0;
    if (orderAmount > 0) for (const a of amts) ratio = Math.max(ratio, Math.min(orderAmount, a) / Math.max(orderAmount, a));

    // Maturity corroboration when both dates exist (soft — only rejects a clear mismatch).
    let maturityOk = true;
    if (order.depositMaturityDate && h.endDate) {
      const dd = Math.abs((new Date(h.endDate) - new Date(order.depositMaturityDate)) / (1000 * 60 * 60 * 24));
      maturityOk = dd <= 5;
    }

    if (maturityOk && ratio > bestRatio) { bestRatio = ratio; best = h; }
  }

  if (!best || bestRatio < 0.95) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'No confident term-deposit holding match found' };
  }

  return {
    bookingStatus: 'confirmed',
    matchedOperation: {
      operationDate: best.snapshotDate,
      quantity: order.quantity,
      price: null,                       // term deposits have no execution price
      grossAmount: null,
      operationCode: null,
      instrumentName: best.securityName || best.reference || 'Term Deposit',
      remark: 'Confirmed from term-deposit holding appearance in PMS',
      operationType: 'TERM_DEPOSIT_HOLDING'
    },
    confidence: 'td_holding_match',
    reason: `Term deposit appeared in holdings on ${new Date(best.snapshotDate).toISOString().split('T')[0]}${best.currency ? ` (${best.currency} ${Math.abs(best.quantity || 0)})` : ''}.`
  };
}

export async function matchOrderToOperations(order) {
  if (!order.portfolioCode) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'Missing portfolio code' };
  }

  // FX trades and term deposits carry no matchable ISIN, so they route to their
  // own settlement matchers (FX → FX_TRADE operations; TD → holding appearance).
  if (order.assetType === ASSET_TYPES.FX) {
    return matchFxOrderToOperations(order);
  }
  if (order.assetType === ASSET_TYPES.TERM_DEPOSIT) {
    return matchTermDepositToHoldings(order);
  }
  // Listed options carry the placeholder ISIN 'OPT', which is truthy - without
  // this branch the missing-ISIN guard below lets them through and every option
  // runs a full operations query against a literal 'OPT' that can never match.
  // There is no option feed, so there is nothing to settle against.
  if (order.assetType === ASSET_TYPES.OPTION) {
    return {
      bookingStatus: 'none',
      matchedOperation: null,
      confidence: null,
      reason: 'Options are not settlement-matched'
    };
  }

  if (!order.isin) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'Missing ISIN' };
  }

  // Build operation type filter based on order type. We include 'OTHER'
  // because some bank parsers fall back to OTHER for executions they
  // couldn't categorise (e.g. CMB Monaco equity buys booked as OTHER). The
  // grossAmount sign is used downstream to confirm direction.
  const opTypes = order.orderType === 'buy'
    ? ['BUY', 'SUBSCRIPTION', 'OTHER']
    : ['SELL', 'REDEMPTION', 'OTHER'];

  // Date window: 5 days before order to settlementWindowDays after
  const orderDate = order.createdAt || new Date();
  const windowStart = new Date(orderDate);
  windowStart.setDate(windowStart.getDate() - 5);
  const windowEnd = new Date(orderDate);
  windowEnd.setDate(windowEnd.getDate() + settlementWindowDays(order));

  // Escape special regex chars in portfolioCode and match with prefix
  const escapedCode = order.portfolioCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const operations = await PMSOperationsCollection.find({
    isin: order.isin,
    portfolioCode: { $regex: `^${escapedCode}` },
    operationType: { $in: opTypes },
    operationDate: { $gte: windowStart, $lte: windowEnd },
    isActive: true
  }, {
    sort: { operationDate: -1 },
    limit: 10
  }).fetchAsync();

  // Holdings-based fallback. Some bank parsers (notably CMB) reliably deliver
  // the position file but drop the corresponding event/transaction rows, so
  // the executed buy/sell never lands in pmsOperations even though the
  // position is sitting right there with a fresh cost price. When that
  // happens, treat a newly-appearing PMSHoldings row near the order date as
  // an execution source.
  if (operations.length === 0) {
    const holdingsFallback = await tryHoldingsFallback(order, escapedCode, orderDate);
    if (holdingsFallback) return holdingsFallback;
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'No matching operations found' };
  }

  // For OTHER-typed candidates, require the gross-amount sign to match the
  // order direction (buy → debit/negative, sell → credit/positive). Without
  // this, an unrelated dividend or fee tagged OTHER for the same ISIN could
  // hijack the match.
  const expectedSign = order.orderType === 'buy' ? -1 : 1;
  const filteredOps = operations.filter(op => {
    if (op.operationType !== 'OTHER') return true;
    const gross = op.grossAmount != null ? op.grossAmount : op.netAmount;
    if (gross == null || gross === 0) return false;
    return Math.sign(gross) === expectedSign;
  });

  if (filteredOps.length === 0) {
    const holdingsFallback = await tryHoldingsFallback(order, escapedCode, orderDate);
    if (holdingsFallback) return holdingsFallback;
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'No matching operations found' };
  }

  // Score each match
  let bestMatch = null;
  let bestScore = 0;

  for (const op of filteredOps) {
    let score = 0;

    // Magnitude similarity. For structured-product orders `order.quantity`
    // holds the notional in currency while `op.quantity` holds units, so we
    // also compare the order's notional against op.grossAmount/netAmount and
    // take whichever ratio is highest.
    const opQty = Math.abs(op.quantity || 0);
    const orderQty = Math.abs(order.quantity || 0);
    const opAmount = Math.abs(op.grossAmount || op.netAmount || 0);
    const orderAmount = Math.abs(order.estimatedValue || order.quantity || 0);

    const qtyRatio = orderQty > 0 && opQty > 0
      ? Math.min(opQty, orderQty) / Math.max(opQty, orderQty)
      : 0;
    const amountRatio = orderAmount > 0 && opAmount > 0
      ? Math.min(orderAmount, opAmount) / Math.max(orderAmount, opAmount)
      : 0;
    const bestRatio = Math.max(qtyRatio, amountRatio);

    if (bestRatio >= 0.99) {
      score += 50; // Exact match
    } else if (bestRatio >= 0.90) {
      score += 30; // Within 10%
    } else if (bestRatio >= 0.70) {
      score += 10; // Within 30%
    }

    // Date proximity (closer = better)
    const daysDiff = Math.abs((op.operationDate - orderDate) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 2) {
      score += 30;
    } else if (daysDiff <= 7) {
      score += 20;
    } else if (daysDiff <= 14) {
      score += 10;
    }

    // ISIN exact match bonus (already filtered but confirms)
    score += 10;

    if (score > bestScore) {
      bestScore = score;
      bestMatch = op;
    }
  }

  if (!bestMatch) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'No matching operations found' };
  }

  // Determine status based on score
  const opQty = Math.abs(bestMatch.quantity || 0);
  const orderQty = Math.abs(order.quantity || 0);
  const opAmount = Math.abs(bestMatch.grossAmount || bestMatch.netAmount || 0);
  const orderAmount = Math.abs(order.estimatedValue || order.quantity || 0);
  const qtyRatio = orderQty > 0 && opQty > 0
    ? Math.min(opQty, orderQty) / Math.max(opQty, orderQty)
    : 0;
  const amountRatio = orderAmount > 0 && opAmount > 0
    ? Math.min(orderAmount, opAmount) / Math.max(orderAmount, opAmount)
    : 0;
  const isExact = Math.max(qtyRatio, amountRatio) >= 0.99;

  let bookingStatus, confidence;
  if (bestScore >= 70 && isExact) {
    bookingStatus = 'confirmed';
    confidence = 'exact_match';
  } else if (bestScore >= 40) {
    bookingStatus = 'likely';
    confidence = 'close_match';
  } else {
    bookingStatus = 'none';
    confidence = null;
  }

  const fmtQty = (bestMatch.quantity || 0).toLocaleString('en-US');
  const fmtDate = bestMatch.operationDate
    ? new Date(bestMatch.operationDate).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : 'N/A';

  // Derive per-unit price from grossAmount when the parser didn't populate
  // op.price (common for OTHER-typed ops and some bank statements that only
  // carry the cash leg).
  let resolvedPrice = bestMatch.price || bestMatch.quote;
  let resolvedQuantity = bestMatch.quantity;
  if (resolvedPrice == null && bestMatch.quantity && bestMatch.grossAmount) {
    const qty = Math.abs(bestMatch.quantity);
    const gross = Math.abs(bestMatch.grossAmount);
    if (qty > 0) resolvedPrice = gross / qty;
  }

  // Structured-product unit-vs-notional reconciliation.
  // For SPs the order stores `quantity` as nominal currency (e.g. 750 000
  // EUR notional) while some bank parsers store the op as
  // `quantity = units, price = absolute EUR per unit` (e.g. 750 units at
  // 1276.7 EUR each = 127.67 % of a 1000 EUR-nominal note). Without
  // translation the executedPrice ends up displayed as "1276.70 %" — wrong.
  // Detect the unit-pricing case via the order/op quantity ratio and convert
  // price to % of par and quantity to the order's notional units.
  if (order.assetType === 'structured_product' && order.quantity && bestMatch.quantity) {
    const opQtyAbs = Math.abs(bestMatch.quantity);
    if (opQtyAbs > 0) {
      const unitNominal = order.quantity / opQtyAbs;
      // Unit nominal must be a clean round multiple (typical SP notes are
      // 1, 100, 1 000, 10 000) and large enough to indicate unit pricing.
      if (unitNominal >= 100 && Math.abs(unitNominal - Math.round(unitNominal)) < 0.001) {
        if (resolvedPrice != null) {
          resolvedPrice = (resolvedPrice * 100) / Math.round(unitNominal);
        }
        // Express quantity in the order's notional terms so executedQuantity
        // stays consistent with the user-entered `quantity` field.
        resolvedQuantity = order.quantity * Math.sign(bestMatch.quantity);
      }
    }
  }

  // Quotation-convention translation for percent-quoted instruments
  // (structured products, bonds). Two ways a decimal fraction of par can reach
  // us instead of a percent: a bank parser that normalised op.price to decimal
  // (1.0001 = 100.01 %), and the grossAmount / quantity derivation above, which
  // yields cash-per-nominal-unit (40 223.62 / 40 000 = 1.00559). Orders quote
  // these prices as percent of par, so a raw decimal displayed as "1.01 %"
  // instead of "100.56 %". Values already in percent range are left alone.
  resolvedPrice = toOrderPriceConvention(
    resolvedPrice,
    order.assetType,
    bestMatch.grossAmount != null ? bestMatch.grossAmount : bestMatch.netAmount,
    resolvedQuantity != null ? resolvedQuantity : bestMatch.quantity
  );

  return {
    bookingStatus,
    matchedOperation: {
      operationDate: bestMatch.operationDate,
      quantity: resolvedQuantity,
      price: resolvedPrice,
      grossAmount: bestMatch.grossAmount,
      operationCode: bestMatch.operationCode,
      instrumentName: bestMatch.instrumentName,
      remark: bestMatch.remark,
      operationType: bestMatch.operationType
    },
    confidence,
    reason: bookingStatus !== 'none'
      ? `Matching ${bestMatch.operationType} operation found: ${fmtQty} units on ${fmtDate}`
      : 'No confident match found'
  };
}

/**
 * Get base path for order file storage.
 * Resolved by imports/api/documentStorage.js, the same module the
 * /order_traces endpoint reads from.
 */
const getOrdersBasePath = () => getOrderTracesDir();

/**
 * Ensure order directory exists
 */
const ensureOrderDirectory = (orderId) => {
  const basePath = getOrdersBasePath();
  const orderDir = path.join(basePath, orderId);

  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
  }

  if (!fs.existsSync(orderDir)) {
    fs.mkdirSync(orderDir, { recursive: true });
  }

  return orderDir;
};

/**
 * Write a trace file to disk for an order, replacing any prior trace of the same type.
 * Performs the disk write and the $pull of the prior trace, but does NOT $push the new
 * trace — the caller is responsible for combining the $push with whatever other $set
 * fields are needed (status changes, termsheet status, etc.) so the final DB mutation
 * is atomic.
 */
const writeTraceFileToOrder = async ({
  order,
  traceType,
  fileName,
  base64Data,
  mimeType,
  userId,
  userDisplayName,
  acceptedExtensions = EMAIL_TRACE_ACCEPTED_TYPES
}) => {
  const ext = path.extname(fileName).toLowerCase();
  if (!acceptedExtensions.includes(ext)) {
    throw new Meteor.Error('invalid-file-type', `File type ${ext} is not accepted. Accepted types: ${acceptedExtensions.join(', ')}`);
  }

  const estimatedSize = Math.ceil(base64Data.length * 0.75);
  if (estimatedSize > EMAIL_TRACE_MAX_SIZE) {
    throw new Meteor.Error('file-too-large', `File exceeds maximum size of 15MB`);
  }

  const timestamp = Date.now();
  const storedFileName = `${traceType}_${timestamp}${ext}`;
  const orderDir = ensureOrderDirectory(order._id);
  const filePath = path.join(orderDir, storedFileName);

  console.log(`[ORDERS] Writing trace: ${traceType} for order ${order.orderReference} by ${userDisplayName} (${userId})`);
  console.log(`   File: ${fileName} -> ${storedFileName}`);

  // Remove existing trace of same type (file from disk + entry from DB) if it exists.
  // Amendment / cancellation notices accumulate instead: each one is evidence.
  const existingTraces = order.emailTraces || [];
  const existingTrace = MULTI_INSTANCE_TRACE_TYPES.has(traceType)
    ? null
    : existingTraces.find(t => t.traceType === traceType);
  if (existingTrace) {
    try {
      if (existingTrace.filePath && fs.existsSync(existingTrace.filePath)) {
        fs.unlinkSync(existingTrace.filePath);
        console.log(`   Deleted old trace: ${existingTrace.filePath}`);
      }
    } catch (err) {
      console.error('Error deleting old trace file:', err);
    }

    await OrdersCollection.updateAsync(order._id, {
      $pull: { emailTraces: { _id: existingTrace._id } }
    });
  }

  try {
    const buffer = Buffer.from(base64Data, 'base64');
    fs.writeFileSync(filePath, buffer);
    console.log(`   Trace saved: ${filePath} (${buffer.length} bytes)`);
  } catch (error) {
    console.error('Error saving trace file:', error);
    throw new Meteor.Error('file-system-error', 'Failed to save trace file');
  }

  return {
    _id: Random.id(),
    traceType,
    traceMode: 'file',
    fileName,
    storedFileName,
    filePath,
    mimeType: mimeType || 'application/octet-stream',
    fileSize: estimatedSize,
    uploadedAt: new Date(),
    uploadedBy: userId
  };
};

// Sending is low-frequency per user; this only exists to bound a runaway client.
const graphSendRateLimit = createRateLimiter({ max: 30 });

/**
 * Split a recipient string (the app joins with ';') into validated addresses.
 * Anything that is not plausibly an address is dropped rather than handed to
 * Graph, which would reject the whole message for one bad entry.
 */
const parseRecipientList = (value) => {
  if (!value) return [];
  const parts = String(value).split(/[;,]/).map(s => s.trim()).filter(Boolean);
  const valid = parts.filter(a => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a));
  const dropped = parts.filter(a => !valid.includes(a));
  if (dropped.length) console.warn(`[ORDERS] Ignoring malformed recipient(s): ${dropped.join(', ')}`);
  // De-duplicate case-insensitively, keeping first spelling.
  const seen = new Set();
  return valid.filter(a => {
    const k = a.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 50);
};

/**
 * Fetch the just-sent message back out of Sent Items and store it as the
 * order_to_bank trace.
 *
 * Two things make this fiddly. Sending invalidates the draft id, so the message
 * has to be found by internetMessageId; and Exchange materialises the Sent Items
 * copy a second or two later, hence the retries. Failure is non-fatal — the mail
 * has already left, so this records `pending` and returns false rather than
 * making a successful send look like a failed one.
 *
 * Worth noting the trace is the POST-transport copy, after mail-flow rules have
 * applied disclaimers or rewriting: better evidence than the .eml draft, which
 * was never itself the thing that got sent.
 */
const attachSentCopyAsTrace = async ({ order, userId, userDisplayName, internetMessageId, traceType = EMAIL_TRACE_TYPES.ORDER_TO_BANK, historyId = null }) => {
  if (!internetMessageId) return false;
  const isOriginalOrderMail = traceType === EMAIL_TRACE_TYPES.ORDER_TO_BANK;

  // Exchange usually materialises the Sent Items copy within a couple of
  // seconds, but under load it has taken far longer — and giving up early is
  // what leaves an order sent with no evidence on file. This all runs in the
  // background, so a slow success beats a fast `pending`.
  const delays = [1500, 3000, 6000, 15000, 30000];
  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, delays[attempt]));
    try {
      const sent = await findSentByInternetMessageId(userId, internetMessageId);
      if (!sent) continue;

      const mime = await graphGetMessageMime(userId, sent.id, { maxBytes: EMAIL_TRACE_MAX_SIZE });
      const fresh = await OrdersCollection.findOneAsync(order._id);

      const trace = await writeTraceFileToOrder({
        order: fresh,
        traceType,
        fileName: `${fresh.orderReference}_${traceType}.eml`,
        base64Data: mime.toString('base64'),
        mimeType: 'message/rfc822',
        userId,
        userDisplayName
      });
      trace.source = 'graph';
      trace.graph = {
        messageId: sent.id,
        internetMessageId: sent.internetMessageId || internetMessageId,
        conversationId: sent.conversationId || null,
        receivedDateTime: sent.sentDateTime ? new Date(sent.sentDateTime) : null,
        fromAddress: null
      };

      await pushTraceAndAdvance({ order: fresh, trace, traceType, userId });
      if (isOriginalOrderMail) {
        await OrdersCollection.updateAsync(order._id, { $set: { 'graphSend.sentTraceStatus': 'attached' } });
      } else if (historyId) {
        await OrdersCollection.updateAsync(
          { _id: order._id, 'limitHistory._id': historyId },
          { $set: { 'limitHistory.$.bankNotice.traceId': trace._id } }
        );
      }

      console.log(`[ORDERS] Sent copy auto-filed as ${traceType} trace for ${fresh.orderReference}`);
      return true;
    } catch (err) {
      console.warn(`[ORDERS] Could not auto-file sent copy (attempt ${attempt + 1}):`, err.message);
    }
  }

  console.warn(`[ORDERS] Sent copy for ${order.orderReference} not filed — left pending`);
  return false;
};

/**
 * Find messages in an order's mail thread that look like the bank replying.
 *
 * Three rules, evaluated together so a weakness in one is covered by another:
 *   1. conversationId matches — exact, and the usual case.
 *   2. In-Reply-To / References cites our internetMessageId — survives a subject
 *      rewrite, which is precisely when conversationId stops matching.
 *   3. The sender's domain matches the desk we mailed and the subject carries
 *      the order reference — catches a reply sent as a fresh message.
 *
 * Excluded: anything from the sender themselves (our own Sent Items copy and
 * any chasers), and anything predating the send.
 */
const findOrderReplies = async (order) => {
  const send = order.graphSend;
  if (!send?.conversationId && !send?.internetMessageId) return [];

  const senderUserId = send.sentBy;
  const sentAt = send.sentAt ? new Date(send.sentAt) : null;
  const ownMailbox = (send.mailbox || '').toLowerCase();
  const deskDomains = String(order.sentTo || '')
    .split(/[;,]/).map(s => s.trim().toLowerCase().split('@')[1]).filter(Boolean);

  let messages = [];
  if (send.conversationId) {
    messages = await getMessagesByConversationId(senderUserId, send.conversationId, {
      sinceIso: sentAt ? sentAt.toISOString() : undefined
    });
  }

  const citesOurMessage = (m) => {
    if (!send.internetMessageId) return false;
    const headers = m.internetMessageHeaders || [];
    return headers.some(h =>
      ['In-Reply-To', 'References'].includes(h.name) &&
      String(h.value || '').includes(send.internetMessageId)
    );
  };

  const fromDesk = (m) => {
    const address = (m.from?.emailAddress?.address || '').toLowerCase();
    if (!address) return false;
    const domain = address.split('@')[1];
    return deskDomains.includes(domain) &&
      String(m.subject || '').includes(order.orderReference);
  };

  return messages.filter(m => {
    const address = (m.from?.emailAddress?.address || '').toLowerCase();
    if (ownMailbox && address === ownMailbox) return false; // our own sent copy
    if (sentAt && m.receivedDateTime && new Date(m.receivedDateTime) <= sentAt) return false;
    return Boolean(m.conversationId === send.conversationId || citesOurMessage(m) || fromDesk(m));
  });
};

/**
 * Background sweep for bank replies to orders sent through Outlook.
 *
 * Notifies; never attaches. Same reasoning as orders.checkGraphReplies — a
 * bank_confirmation trace advances the order to EXECUTED, which is not a call
 * to make from a keyword match on an inbound mail.
 *
 * Polling rather than Graph change-notification webhooks, deliberately: those
 * need a public unauthenticated endpoint on a deliberately hardened app, a
 * 10-second validation handshake, and per-user subscriptions renewed inside
 * three days that fail SILENTLY when a renewal is missed. For a workflow where
 * a ten-minute delay costs nothing, that is a lot of machinery pointed at the
 * wrong risk.
 *
 * Exported for the cron job; safe to call manually (crons are disabled on dev
 * instances via CRON_DISABLED, and manual triggers still work).
 */
export async function scanForBankReplies({ lookbackDays = 14 } = {}) {
  const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);

  const orders = await OrdersCollection.find({
    status: ORDER_STATUSES.TRANSMITTED,
    'graphSend.conversationId': { $exists: true, $ne: null },
    'graphSend.sentAt': { $gte: since }
  }, { limit: 200 }).fetchAsync();

  if (orders.length === 0) return { scanned: 0, notified: 0 };

  const { NotificationHelpers } = await import('../../imports/api/notifications.js');
  let notified = 0;

  for (const order of orders) {
    try {
      const alreadySeen = new Set(order.graphSend?.notifiedReplyIds || []);
      const replies = await findOrderReplies(order);
      const fresh = replies.filter(m => !alreadySeen.has(m.id));
      if (fresh.length === 0) continue;

      const first = fresh[0];
      await NotificationHelpers.create({
        userId: order.graphSend.sentBy,
        type: 'info',
        title: 'Bank replied to an order',
        message: `${first.from?.emailAddress?.address || 'The bank'} replied on order ${order.orderReference} `
          + `(${order.securityName || ''}). Review it and attach it as the bank confirmation if appropriate.`,
        metadata: {
          orderId: order._id,
          orderReference: order.orderReference,
          graphMessageId: first.id
        }
      });

      // Persist what we have already raised, so the next sweep does not
      // re-notify the same reply every ten minutes.
      await OrdersCollection.updateAsync(order._id, {
        $set: { 'graphSend.lastReplyScanAt': new Date() },
        $addToSet: { 'graphSend.notifiedReplyIds': { $each: fresh.map(m => m.id) } }
      });
      notified += 1;
    } catch (err) {
      // One user's expired mailbox connection must not stop the sweep.
      console.warn(`[ORDERS] Reply scan failed for ${order.orderReference}:`, err.message);
    }
  }

  console.log(`[ORDERS] Bank-reply scan: ${orders.length} order(s) checked, ${notified} notification(s) raised`);
  return { scanned: orders.length, notified };
}

/**
 * Build everything needed to mail an order to its bank: the order PDF, the
 * recipients, the subject and body, and the initial termsheet attachment.
 *
 * Single source for orders.prepareEmail, orders.validate and orders.sendViaGraph.
 * These three previously each assembled it, and a third copy for the Graph path
 * is exactly how the .eml draft and the Graph-sent mail would quietly drift
 * apart — which, for an order confirmation, is a compliance problem rather than
 * a cosmetic one.
 */
const buildOrderEmailPayload = async (order, sender = null, { ticketKind = TICKET_KINDS.ORDER } = {}) => {
  const client = await UsersCollection.findOneAsync(order.clientId);
  const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
  const bank = await BanksCollection.findOneAsync(order.bankId);
  const createdByUser = await UsersCollection.findOneAsync(order.createdBy);

  // An amendment / cancellation ticket describes the validated change the bank
  // has not been told about yet.
  const ticket = buildTicketContext(order, ticketKind);

  const html = generateOrderPDFHTML(order, client, bankAccount, bank, createdByUser, await loadOrderIssuer(order), ticket);
  const pdfResult = await generatePDFFromHTML(html, {
    format: 'A4', marginTop: '10mm', marginRight: '15mm', marginBottom: '10mm', marginLeft: '15mm'
  });

  // The recipient desk depends on the order's asset type (e.g. FX orders go to
  // the bank's FX team) — see BankHelpers.resolveOrderRecipients.
  const liveIssuer = await loadOrderIssuer(order);
  const recipients = BankHelpers.resolveOrderRecipients(bank, order.assetType);
  const subject = OrderHelpers.generateEmailSubject(order, liveIssuer, ticketKind);
  const body = OrderHelpers.generateEmailBody(order, client, bank, bankAccount, liveIssuer, recipients.deskLabel, {
    ticketKind,
    change: ticket?.change
  });

  // CC: bank + desk CC addresses, the order creator, and whoever is sending it
  // now — under four-eyes the sender is usually the validator, not the creator,
  // and they get a copy of every order that leaves under their name.
  const ccList = [...recipients.cc];
  const addCc = (email) => {
    const address = email?.trim?.().toLowerCase();
    if (address && !ccList.some(existing => existing.toLowerCase() === address)) ccList.push(address);
  };
  addCc(createdByUser?.email);
  addCc(sender?.email);

  if (!recipients.to) {
    console.warn(`[ORDERS] Bank ${bank?.name || order.bankId} has no desk email for asset type ${order.assetType}`);
  }

  return {
    orderReference: order.orderReference,
    ticketKind,
    // Attachment / draft file name: "2026-00143" or "2026-00143-AMEND-1"
    fileReference: ticket ? ticket.fileReference : order.orderReference,
    pdfData: pdfResult.pdfData,
    emailData: {
      to: recipients.to,
      cc: ccList.join(';'),
      subject,
      body,
      deskLabel: recipients.deskLabel,
      bankName: bank?.name || '',
      assetType: order.assetType
    },
    // The desk already has the termsheet from the original order
    termsheet: ticket ? null : loadInitialTermsheetAttachment(order)
  };
};

/**
 * What an amendment / cancellation ticket needs: the pending change, its
 * sequence number among the bank notices, and the file reference. Null for the
 * original order ticket.
 */
const buildTicketContext = (order, ticketKind) => {
  if (!ticketKind || ticketKind === TICKET_KINDS.ORDER) return null;
  assertTicketKindSendable(order, ticketKind);
  const change = findPendingNoticeEntry(order);
  if (ticketKind === TICKET_KINDS.CANCEL) {
    return { kind: ticketKind, change, sequence: 1, fileReference: `${order.orderReference}-CANCEL` };
  }
  const notices = (order.limitHistory || []).filter(e => e.kind !== TICKET_KINDS.CANCEL && e.bankNotice?.required);
  const sequence = Math.max(1, notices.findIndex(e => e._id === change._id) + 1);
  return { kind: ticketKind, change, sequence, fileReference: `${order.orderReference}-AMEND-${sequence}` };
};

/**
 * Turn a mail subject into a safe .eml filename.
 *
 * The subject is attacker-influenced free text that becomes part of a path, so
 * strip path separators, Windows-reserved characters and control codes, then
 * cap the length. Always forces .eml, which is what Graph actually returns.
 */
const graphTraceFileName = (subject, traceType) => {
  const cleaned = String(subject || '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[ -]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  const base = cleaned || `${traceType}_${new Date().toISOString().slice(0, 10)}`;
  return `${base}.eml`;
};

/**
 * Attach a written trace to its order and apply the status side effects.
 *
 * Shared by the drag-and-drop upload and the Outlook picker so the two cannot
 * drift apart: these transitions (and the clientOrderDeferred clear) are
 * compliance-visible, and having two copies of them is how they end up
 * disagreeing.
 */
const pushTraceAndAdvance = async ({ order, trace, traceType, userId }) => {
  const updateFields = { updatedAt: new Date(), updatedBy: userId };

  // The original order mail only moves an order forward into TRANSMITTED; it
  // must not resurrect a cancelled order or undo a fill / a change in review.
  const noTransmitAdvance = [
    ORDER_STATUSES.EXECUTED,
    ORDER_STATUSES.PARTIALLY_EXECUTED,
    ORDER_STATUSES.CANCELLED,
    ORDER_STATUSES.REJECTED,
    ORDER_STATUSES.PENDING_MODIFICATION
  ];
  if (traceType === EMAIL_TRACE_TYPES.ORDER_TO_BANK && !noTransmitAdvance.includes(order.status)) {
    updateFields.status = ORDER_STATUSES.TRANSMITTED;
    updateFields.transmittedAt = new Date();
    console.log(`[ORDERS] Auto-advancing order ${order.orderReference} to TRANSMITTED (order-to-bank email attached)`);
  } else if (traceType === EMAIL_TRACE_TYPES.BANK_CONFIRMATION) {
    updateFields.status = ORDER_STATUSES.EXECUTED;
    updateFields.executedAt = new Date();
    console.log(`[ORDERS] Auto-advancing order ${order.orderReference} to EXECUTED (bank confirmation attached)`);
  }

  // Clear deferred-attach flag once the creator's promised client-order trace lands
  const updateOp = {
    $push: { emailTraces: trace },
    $set: updateFields
  };
  if (traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER && order.clientOrderDeferred) {
    updateOp.$unset = { clientOrderDeferred: '' };
  }

  await OrdersCollection.updateAsync(order._id, updateOp);

  // The sent amendment / cancellation mail filed back on the order (the .eml
  // route) is what proves the bank was told: close the pending notice.
  if (order.pendingBankNotice && traceTypeForTicket(order.pendingBankNotice.kind) === traceType) {
    await markBankNoticeSent({ order, sentMethod: 'trace', userId, traceId: trace._id });
  }
};

/**
 * Email Trace Management Methods
 */
Meteor.methods({
  /**
   * Upload an email trace file for an order
   */
  async 'orders.uploadEmailTrace'({ orderId, traceType, fileName, base64Data, mimeType, sessionId }) {
    check(orderId, String);
    check(traceType, Match.Where(x => Object.values(EMAIL_TRACE_TYPES).includes(x)));
    check(fileName, String);
    check(base64Data, String);
    check(mimeType, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Termsheet evidence has its own dedicated method that requires status transition
    if (traceType === EMAIL_TRACE_TYPES.TERMSHEET_SENT || traceType === EMAIL_TRACE_TYPES.TERMSHEET_SIGNED) {
      throw new Meteor.Error('invalid-operation', 'Use orders.advanceTermsheetWithEvidence to upload termsheet evidence');
    }

    const trace = await writeTraceFileToOrder({
      order,
      traceType,
      fileName,
      base64Data,
      mimeType,
      userId,
      userDisplayName
    });
    const traceId = trace._id;

    await pushTraceAndAdvance({ order, trace, traceType, userId });

    console.log(`[ORDERS] Email trace uploaded: ${traceType} for order ${order.orderReference} (${traceId}) by ${userDisplayName} (${userId})`);

    return { success: true, traceId, trace };
  },

  /**
   * Attach a message picked from the user's Outlook mailbox as an order trace.
   *
   * Lives here rather than in msGraphMethods.js because validateSession,
   * validateOrderPermission, validateOrderAccess and writeTraceFileToOrder are
   * module-private to this file — the Graph modules stay a pure transport layer.
   *
   * Graph returns the message as RFC-822 MIME, which is exactly a .eml, so the
   * stored trace is indistinguishable from a dragged-in .eml and everything
   * downstream (parseEmailTrace, TracePreview, aiComplianceCheck, the audit
   * PDF) works on it unchanged. The .msg blind spot simply does not arise.
   */
  async 'orders.attachGraphMessageAsTrace'({ orderId, traceType, messageId, sessionId }) {
    check(orderId, String);
    check(traceType, Match.Where(x => Object.values(EMAIL_TRACE_TYPES).includes(x)));
    check(messageId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Same carve-out as the upload path: termsheet evidence has a dedicated
    // method that also drives the termsheet status transition.
    if (traceType === EMAIL_TRACE_TYPES.TERMSHEET_SENT || traceType === EMAIL_TRACE_TYPES.TERMSHEET_SIGNED) {
      throw new Meteor.Error('invalid-operation', 'Use orders.advanceTermsheetWithEvidence to upload termsheet evidence');
    }

    const message = await graphGetMessage(userId, messageId, {
      select: 'id,subject,from,receivedDateTime,hasAttachments,conversationId,internetMessageId'
    });

    let mimeBuffer;
    try {
      mimeBuffer = await graphGetMessageMime(userId, messageId, { maxBytes: EMAIL_TRACE_MAX_SIZE });
    } catch (err) {
      if (err.error === 'msgraph-too-large') {
        throw new Meteor.Error(
          'file-too-large',
          `This email (with its attachments) exceeds the ${Math.round(EMAIL_TRACE_MAX_SIZE / 1024 / 1024)}MB limit for order traces. ` +
          'Forward it without the large attachments, or save it as a .msg and drag it in.'
        );
      }
      throw err;
    }

    const trace = await writeTraceFileToOrder({
      order,
      traceType,
      fileName: graphTraceFileName(message.subject, traceType),
      base64Data: mimeBuffer.toString('base64'),
      mimeType: 'message/rfc822',
      userId,
      userDisplayName
    });

    // Provenance, so a trace can later be traced back to the actual mailbox item.
    trace.source = 'graph';
    trace.graph = {
      messageId: message.id || messageId,
      internetMessageId: message.internetMessageId || null,
      conversationId: message.conversationId || null,
      receivedDateTime: message.receivedDateTime ? new Date(message.receivedDateTime) : null,
      fromAddress: message.from?.emailAddress?.address || null
    };

    await pushTraceAndAdvance({ order, trace, traceType, userId });

    AuditLog.record({
      actorUserId: userId,
      actorRole: user.role || null,
      action: 'order.trace.graphAttach',
      targetType: 'order',
      targetId: orderId,
      meta: { traceType, from: trace.graph.fromAddress, subject: (message.subject || '').slice(0, 120) }
    });

    console.log(`[ORDERS] Outlook message attached: ${traceType} for order ${order.orderReference} (${trace._id}) by ${userDisplayName} (${userId})`);

    return { success: true, traceId: trace._id, trace };
  },

  /**
   * Send the order to the bank from the user's own Outlook mailbox.
   *
   * The whole payload is rebuilt server-side; the client may only override the
   * recipients, subject and body from the preview. A client-supplied PDF would
   * mean the document of record was whatever the browser chose to send.
   */
  async 'orders.sendViaGraph'({ orderId, sessionId, overrides, ticketKind }) {
    check(orderId, String);
    check(sessionId, String);
    check(ticketKind, Match.Maybe(Match.Where(x => Object.values(TICKET_KINDS).includes(x))));
    check(overrides, Match.Maybe({
      to: Match.Maybe(String),
      cc: Match.Maybe(String),
      subject: Match.Maybe(String),
      body: Match.Maybe(String)
    }));

    // A PDF render plus several Graph round-trips — do not hold up the caller's
    // other method calls behind it.
    this.unblock();

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (order.status === ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Cannot send an order that is still pending validation');
    }
    const kind = ticketKind || TICKET_KINDS.ORDER;
    const isChangeNotice = kind !== TICKET_KINDS.ORDER;
    assertOriginalTicketSendable(order, kind);
    if (!graphSendRateLimit(userId)) {
      throw new Meteor.Error('rate-limited', 'Too many sends in a short time. Please wait a moment.');
    }

    // Throws for an amend/cancel ticket when no such change is pending
    const payload = await buildOrderEmailPayload(order, user, { ticketKind: kind });
    const noticeHistoryId = order.pendingBankNotice?.historyId || null;
    const o = overrides || {};

    const toList = parseRecipientList(o.to !== undefined ? o.to : payload.emailData.to);
    const ccList = parseRecipientList(o.cc !== undefined ? o.cc : payload.emailData.cc);
    if (toList.length === 0) {
      throw new Meteor.Error('no-recipient', 'This order has no recipient. Add the desk address in Bank Management, or type one in the preview.');
    }

    const subject = String(o.subject ?? payload.emailData.subject ?? '').slice(0, 255);
    const body = String(o.body ?? payload.emailData.body ?? '').slice(0, 50000);

    const archiveBcc = getGraphConfig().archiveBcc;

    // Attachments small enough to ride along with the draft; anything larger is
    // added afterwards through an upload session.
    const attachments = [];
    const large = [];
    const addAttachment = (name, contentBytes, contentType) => {
      if (!contentBytes) return;
      const target = Buffer.byteLength(contentBytes, 'base64') > INLINE_ATTACHMENT_LIMIT ? large : attachments;
      target.push({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name,
        contentType: contentType || 'application/octet-stream',
        contentBytes
      });
    };
    addAttachment(`${payload.fileReference || order.orderReference}.pdf`, payload.pdfData, 'application/pdf');
    if (payload.termsheet) {
      addAttachment(payload.termsheet.name, payload.termsheet.content, payload.termsheet.contentType);
    }

    const draft = await createDraft(userId, {
      subject,
      // Plain text: the existing body is \n-joined text, and Text sidesteps a
      // whole class of HTML-escaping bugs in figures and ISINs.
      body: { contentType: 'Text', content: body },
      toRecipients: toList.map(address => ({ emailAddress: { address } })),
      ccRecipients: ccList.map(address => ({ emailAddress: { address } })),
      ...(archiveBcc ? { bccRecipients: [{ emailAddress: { address: archiveBcc } }] } : {}),
      ...(attachments.length ? { attachments } : {})
    });

    for (const attachment of large) {
      await addLargeAttachment(userId, draft.id, attachment);
    }

    await sendDraft(userId, draft.id);

    const sentAt = new Date();

    if (isChangeNotice) {
      // The original send (status, graphSend, reply tracking) is left as is:
      // this notice is recorded on its limitHistory entry instead.
      await markBankNoticeSent({ order, sentMethod: 'graph', userId });

      AuditLog.record({
        actorUserId: userId,
        actorRole: user.role || null,
        action: 'order.email.sent',
        targetType: 'order',
        targetId: orderId,
        meta: { via: 'graph', ticketKind: kind, to: toList.join('; '), subject: subject.slice(0, 120) }
      });

      console.log(`[ORDERS] ${kind === TICKET_KINDS.CANCEL ? 'Cancellation' : 'Amendment'} of ${order.orderReference} sent via Outlook by ${userDisplayName} (${userId}) to ${toList.join('; ')}`);

      attachSentCopyAsTrace({
        order,
        userId,
        userDisplayName,
        internetMessageId: draft.internetMessageId,
        traceType: traceTypeForTicket(kind),
        historyId: noticeHistoryId
      }).catch(err => console.error('[ORDERS] Auto-filing the sent copy failed:', err.message));

      return {
        success: true,
        orderReference: order.orderReference,
        ticketKind: kind,
        sentTo: toList.join('; '),
        conversationId: draft.conversationId || null,
        traceAttached: 'pending'
      };
    }

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: order.status === ORDER_STATUSES.EXECUTED ? order.status : ORDER_STATUSES.TRANSMITTED,
        ...(order.status === ORDER_STATUSES.EXECUTED ? {} : { transmittedAt: sentAt }),
        sentAt,
        sentTo: toList.join('; '),
        sentMethod: 'graph',
        graphSend: {
          draftId: draft.id,
          internetMessageId: draft.internetMessageId || null,
          conversationId: draft.conversationId || null,
          mailbox: (await getPublicStatus(userId))?.microsoftEmail || null,
          sentBy: userId,
          sentAt,
          sentTraceStatus: 'pending'
        },
        updatedAt: sentAt,
        updatedBy: userId
      }
    });

    AuditLog.record({
      actorUserId: userId,
      actorRole: user.role || null,
      action: 'order.email.sent',
      targetType: 'order',
      targetId: orderId,
      meta: { via: 'graph', to: toList.join('; '), subject: subject.slice(0, 120) }
    });

    console.log(`[ORDERS] Order ${order.orderReference} sent via Outlook by ${userDisplayName} (${userId}) to ${toList.join('; ')}`);

    // File the sent copy as the order_to_bank trace. Deliberately NOT awaited:
    // Exchange takes a moment to materialise the Sent Items copy, so awaiting
    // would hold the response — and spin the user's preview — for up to ten
    // seconds after the mail has already gone. The order is reactive, so the
    // trace tile fills in on its own; `graphSend.sentTraceStatus` records
    // whether it ever did.
    attachSentCopyAsTrace({
      order, userId, userDisplayName, internetMessageId: draft.internetMessageId
    }).catch(err => console.error('[ORDERS] Auto-filing the sent copy failed:', err.message));

    return {
      success: true,
      orderReference: order.orderReference,
      sentTo: toList.join('; '),
      conversationId: draft.conversationId || null,
      traceAttached: 'pending'
    };
  },

  /**
   * Look for the bank's reply to an order sent through Outlook.
   *
   * Returns candidates for a human to confirm; it deliberately does NOT attach
   * anything. A bank_confirmation trace auto-advances the order to EXECUTED
   * (see pushTraceAndAdvance), and a reply is just as likely to be a question
   * about the order as a confirmation of it — so the state change stays a
   * decision, not a guess. Attaching goes through orders.attachGraphMessageAsTrace
   * once the user picks one.
   */
  async 'orders.checkGraphReplies'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    this.unblock();

    const { user, userId } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (!order.graphSend?.conversationId && !order.graphSend?.internetMessageId) {
      throw new Meteor.Error('not-sent-via-graph',
        'This order was not sent through Outlook, so there is no mail thread to follow.');
    }
    // The thread lives in the mailbox that sent it; another user's token cannot see it.
    if (order.graphSend.sentBy !== userId) {
      throw new Meteor.Error('not-sender',
        `This order was sent from ${order.graphSend.mailbox || 'another user\'s mailbox'}, so only they can check its replies.`);
    }

    const replies = await findOrderReplies(order);

    await OrdersCollection.updateAsync(orderId, {
      $set: { 'graphSend.lastReplyScanAt': new Date() }
    });

    return {
      success: true,
      replies: replies.map(m => ({
        id: m.id,
        subject: m.subject || '(no subject)',
        fromName: m.from?.emailAddress?.name || m.from?.emailAddress?.address || '',
        fromAddress: m.from?.emailAddress?.address || '',
        receivedDateTime: m.receivedDateTime || null,
        hasAttachments: Boolean(m.hasAttachments),
        preview: (m.bodyPreview || '').slice(0, 160),
        isRead: true
      }))
    };
  },

  /**
   * File the mail that was sent to the bank as this order's order_to_bank
   * trace, without anyone dragging it anywhere.
   *
   * Two routes in, both automatic:
   *   - the order went out through Graph and the post-send filing did not land
   *     (Exchange can be slow to materialise the Sent Items copy) — retry it by
   *     internetMessageId, which is exact;
   *   - the order went out some other way (the .eml draft, an Outlook hand-off
   *     on a phone) — find it in the sender's Sent Items by the order reference,
   *     which every generated subject carries.
   *
   * Returns { attached, reason } and never throws for "nothing found": this is
   * called on opening an order, where a failure is not an error.
   */
  async 'orders.autoAttachOrderToBank'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    this.unblock();

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    const alreadyFiled = (order.emailTraces || []).some(t => t.traceType === EMAIL_TRACE_TYPES.ORDER_TO_BANK);
    if (alreadyFiled) return { attached: false, reason: 'already-filed' };

    // Only the mailbox that sent it can see the message.
    if (order.graphSend?.sentBy && order.graphSend.sentBy !== userId) {
      return { attached: false, reason: 'other-mailbox' };
    }

    // 1. Sent through Graph: the message id is exact, so retry that first.
    if (order.graphSend?.internetMessageId) {
      const filed = await attachSentCopyAsTrace({
        order,
        userId,
        userDisplayName,
        internetMessageId: order.graphSend.internetMessageId
      });
      if (filed) return { attached: true, reason: 'graph-sent-copy' };
    }

    // 2. Otherwise look for it in Sent Items. The subject of every order mail
    //    carries the reference ("Order: 2026-00143 - …"), which is unique.
    let candidates;
    try {
      const result = await searchMessages(userId, {
        query: order.orderReference,
        folderId: 'sentitems',
        top: 10
      });
      candidates = result.messages || [];
    } catch (error) {
      console.warn('[ORDERS] Auto-attach search failed:', error.message);
      return { attached: false, reason: 'search-failed' };
    }

    const reference = String(order.orderReference || '').toLowerCase();
    if (!reference) return { attached: false, reason: 'no-reference' };

    const sentAfter = order.createdAt ? new Date(order.createdAt).getTime() : 0;
    const match = candidates
      .filter(m => String(m.subject || '').toLowerCase().includes(reference))
      // An amendment / cancellation notice carries the reference too, but it is not the original order mail
      .filter(m => !/^\s*((re|fw|fwd):\s*)*(amendment|cancellation):/i.test(String(m.subject || '')))
      .filter(m => !sentAfter || new Date(m.sentDateTime || m.receivedDateTime || 0).getTime() >= sentAfter)
      // Newest first: a resend supersedes the original.
      .sort((a, b) => new Date(b.sentDateTime || b.receivedDateTime || 0) - new Date(a.sentDateTime || a.receivedDateTime || 0))[0];

    if (!match) return { attached: false, reason: 'not-found' };

    try {
      const mime = await graphGetMessageMime(userId, match.id, { maxBytes: EMAIL_TRACE_MAX_SIZE });
      const fresh = await OrdersCollection.findOneAsync(orderId);
      const trace = await writeTraceFileToOrder({
        order: fresh,
        traceType: EMAIL_TRACE_TYPES.ORDER_TO_BANK,
        fileName: `${fresh.orderReference}_order_to_bank.eml`,
        base64Data: mime.toString('base64'),
        mimeType: 'message/rfc822',
        userId,
        userDisplayName
      });
      trace.source = 'graph';
      trace.graph = {
        messageId: match.id,
        internetMessageId: match.internetMessageId || null,
        conversationId: match.conversationId || null,
        receivedDateTime: match.sentDateTime ? new Date(match.sentDateTime) : null,
        fromAddress: null
      };
      await pushTraceAndAdvance({ order: fresh, trace, traceType: EMAIL_TRACE_TYPES.ORDER_TO_BANK, userId });
      console.log(`[ORDERS] Auto-filed the sent mail as order_to_bank for ${fresh.orderReference} (found in Sent Items)`);
      return { attached: true, reason: 'sent-items-match', subject: match.subject || '' };
    } catch (error) {
      console.warn('[ORDERS] Auto-attach could not store the message:', error.message);
      return { attached: false, reason: 'store-failed' };
    }
  },

  /**
   * Delete an email trace from an order
   */
  async 'orders.deleteEmailTrace'({ orderId, traceId, sessionId }) {
    check(orderId, String);
    check(traceId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    const traces = order.emailTraces || [];
    const trace = traces.find(t => t._id === traceId);
    if (!trace) {
      throw new Meteor.Error('not-found', 'Email trace not found');
    }

    // Delete file from disk (only for file traces, not phone traces)
    if (trace.filePath && trace.traceMode !== 'phone') {
      try {
        if (fs.existsSync(trace.filePath)) {
          fs.unlinkSync(trace.filePath);
          console.log(`[ORDERS] Deleted trace file: ${trace.filePath}`);
        }
      } catch (err) {
        console.error('Error deleting trace file:', err);
      }
    }

    // Remove from order document
    const updateSet = { updatedAt: new Date(), updatedBy: userId };

    // Revert status if the deleted trace was what caused the auto-advance
    const remainingTraces = traces.filter(t => t._id !== traceId);
    const hasBankConfirmation = remainingTraces.some(t => t.traceType === EMAIL_TRACE_TYPES.BANK_CONFIRMATION);
    const hasOrderToBank = remainingTraces.some(t => t.traceType === EMAIL_TRACE_TYPES.ORDER_TO_BANK);

    if (trace.traceType === EMAIL_TRACE_TYPES.BANK_CONFIRMATION && order.status === ORDER_STATUSES.EXECUTED && !hasBankConfirmation) {
      // Removed the bank confirmation that caused EXECUTED → revert to TRANSMITTED or PENDING
      updateSet.status = hasOrderToBank ? ORDER_STATUSES.TRANSMITTED : ORDER_STATUSES.PENDING;
      console.log(`[ORDERS] Reverting order ${order.orderReference} from EXECUTED to ${updateSet.status} (bank confirmation removed)`);
    } else if (trace.traceType === EMAIL_TRACE_TYPES.ORDER_TO_BANK && order.status === ORDER_STATUSES.TRANSMITTED && !hasOrderToBank) {
      // Removed the order-to-bank that caused TRANSMITTED → revert to PENDING
      updateSet.status = ORDER_STATUSES.PENDING;
      console.log(`[ORDERS] Reverting order ${order.orderReference} from TRANSMITTED to PENDING (order-to-bank removed)`);
    }

    // Termsheet evidence is linked to the termsheet status indicator: removing the
    // evidence that justified the current status reverts the status accordingly.
    // Legacy 'termsheet' traces count as signed evidence (pre-unification uploads).
    const signedEvidenceTypes = [EMAIL_TRACE_TYPES.TERMSHEET_SIGNED, EMAIL_TRACE_TYPES.TERMSHEET];
    const hasSignedEvidence = remainingTraces.some(t => signedEvidenceTypes.includes(t.traceType));
    const hasSentEvidence = remainingTraces.some(t => t.traceType === EMAIL_TRACE_TYPES.TERMSHEET_SENT);

    if (signedEvidenceTypes.includes(trace.traceType)
        && order.termsheetStatus === TERMSHEET_STATUSES.SIGNED
        && !hasSignedEvidence) {
      updateSet.termsheetStatus = hasSentEvidence ? TERMSHEET_STATUSES.SENT : TERMSHEET_STATUSES.NONE;
      updateSet.termsheetUpdatedBy = userDisplayName;
      updateSet.termsheetUpdatedAt = new Date();
      console.log(`[ORDERS] Reverting termsheet status of order ${order.orderReference} from SIGNED to ${updateSet.termsheetStatus} (signed evidence removed)`);
    } else if (trace.traceType === EMAIL_TRACE_TYPES.TERMSHEET_SENT
        && order.termsheetStatus === TERMSHEET_STATUSES.SENT
        && !hasSentEvidence) {
      updateSet.termsheetStatus = TERMSHEET_STATUSES.NONE;
      updateSet.termsheetUpdatedBy = userDisplayName;
      updateSet.termsheetUpdatedAt = new Date();
      console.log(`[ORDERS] Reverting termsheet status of order ${order.orderReference} from SENT to NONE (sent evidence removed)`);
    }

    await OrdersCollection.updateAsync(orderId, {
      $pull: { emailTraces: { _id: traceId } },
      $set: updateSet
    });

    console.log(`[ORDERS] Email trace deleted: ${trace.traceType} from order ${order.orderReference} by ${userDisplayName} (${userId})`);

    return { success: true };
  },

  /**
   * Save a phone call trace for an order
   */
  async 'orders.savePhoneTrace'({ orderId, traceType, phoneCallTime, phoneCaller, phoneCallee, phoneNotes, sessionId }) {
    check(orderId, String);
    check(traceType, Match.Where(x => Object.values(EMAIL_TRACE_TYPES).includes(x)));
    check(phoneCallTime, String);
    check(phoneCaller, String);
    check(phoneCallee, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Remove existing trace of same type if exists (amendment / cancellation
    // notices accumulate instead — each one is evidence)
    const existingTraces = order.emailTraces || [];
    const existingTrace = MULTI_INSTANCE_TRACE_TYPES.has(traceType)
      ? null
      : existingTraces.find(t => t.traceType === traceType);
    if (existingTrace) {
      // If it was a file trace, delete the file from disk
      if (existingTrace.filePath && existingTrace.traceMode !== 'phone') {
        try {
          if (fs.existsSync(existingTrace.filePath)) {
            fs.unlinkSync(existingTrace.filePath);
          }
        } catch (err) {
          console.error('Error deleting old trace file:', err);
        }
      }
      await OrdersCollection.updateAsync(orderId, {
        $pull: { emailTraces: { _id: existingTrace._id } }
      });
    }

    const traceId = Random.id();
    const trace = {
      _id: traceId,
      traceType,
      traceMode: 'phone',
      phoneCallTime: new Date(phoneCallTime),
      phoneCaller,
      phoneCallee,
      phoneNotes: phoneNotes || '',
      loggedAt: new Date(),
      loggedBy: userId
    };

    // Same status side effects as a file trace
    await pushTraceAndAdvance({ order, trace, traceType, userId });

    console.log(`[ORDERS] Phone trace saved: ${traceType} for order ${order.orderReference} (${traceId}) by ${userDisplayName} (${userId})`);

    return { success: true, traceId, trace };
  },

  /**
   * Get download URL for an email trace
   */
  async 'orders.getEmailTraceUrl'({ orderId, traceId, sessionId }) {
    check(orderId, String);
    check(traceId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    const traces = order.emailTraces || [];
    const trace = traces.find(t => t._id === traceId);
    if (!trace) {
      throw new Meteor.Error('not-found', 'Email trace not found');
    }

    // The /order_traces endpoint requires a single-use capability token bound
    // to the path — the URL alone is no longer sufficient.
    const filePath = `/order_traces/${orderId}/${trace.storedFileName}`;
    const token = await issueDocumentToken(filePath, user._id);
    return `${filePath}?dl=${token}`;
  },

  /**
   * Signed download URLs for every email trace (and the pending-modification
   * instruction file) of an order, keyed by storedFileName. Used by the review
   * blotter whose inline img/iframe previews render synchronously and so need
   * the tokens resolved when the review panel opens.
   */
  async 'orders.getEmailTraceSignedUrls'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    const urls = {};
    const mint = async (storedFileName) => {
      if (!storedFileName || urls[storedFileName]) return;
      const filePath = `/order_traces/${orderId}/${storedFileName}`;
      urls[storedFileName] = `${filePath}?dl=${await issueDocumentToken(filePath, user._id)}`;
    };
    for (const t of (order.emailTraces || [])) await mint(t.storedFileName);
    if (order.pendingModification?.instructionFile?.storedFileName) {
      await mint(order.pendingModification.instructionFile.storedFileName);
    }
    return urls;
  },

  /**
   * Parse an .eml email trace and return its HTML/text content for inline preview
   */
  /**
   * Position check for the four-eyes review of a sell: what the account holds,
   * what other open sells already take from it, and what is left after this
   * one - so a validator can see the order does not sell more than is held.
   * Held quantity comes from the latest bank file; when the position is not
   * found there, the snapshot taken at order entry is used and labelled so.
   */
  // Position in the account once this order (and the other open orders on the
  // same position) is done: buys add to what is held, sells take from it.
  async 'orders.getPositionAfterTrade'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    const isSell = order.orderType === 'sell';
    if (!['buy', 'sell'].includes(order.orderType) || !order.isin || !order.bankAccountId) return null;

    let heldQuantity = null;
    let heldSource = null;
    let heldAsOf = null;
    const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
    if (bankAccount?.accountNumber) {
      const resolved = await resolveClientId(order.clientId);
      const holdings = await findAccountHoldings(resolved, bankAccount);
      const matches = holdings.filter(h => (h.isin || '').toUpperCase() === order.isin.toUpperCase());
      if (matches.length > 0) {
        heldQuantity = matches.reduce((sum, h) => sum + (Number(h.quantity) || 0), 0);
        heldSource = 'bank_file';
        heldAsOf = matches.map(h => h.snapshotDate).filter(Boolean)
          .reduce((latest, d) => (!latest || new Date(d) > new Date(latest) ? d : latest), null);
      }
    }
    if (heldQuantity === null && typeof order.sourcePositionQuantity === 'number') {
      heldQuantity = order.sourcePositionQuantity;
      heldSource = 'order_entry';
      heldAsOf = order.createdAt || null;
    }
    // A buy can open a new position: nothing held is a real zero
    if (heldQuantity === null && !isSell) {
      heldQuantity = 0;
      heldSource = 'none';
    }
    if (heldQuantity === null) return { found: false };

    // Orders on the same position that are live but not executed yet: the bank
    // file does not reflect them, so they still move what is held.
    const openStatuses = [
      ORDER_STATUSES.PENDING_VALIDATION, ORDER_STATUSES.PENDING, ORDER_STATUSES.PENDING_MODIFICATION,
      ORDER_STATUSES.REVISION_REQUESTED, ORDER_STATUSES.TRANSMITTED, ORDER_STATUSES.SENT,
      ORDER_STATUSES.PARTIALLY_EXECUTED
    ];
    const otherOrders = await OrdersCollection.find({
      _id: { $ne: order._id },
      bankAccountId: order.bankAccountId,
      isin: order.isin,
      orderType: { $in: ['buy', 'sell'] },
      status: { $in: openStatuses }
    }, { fields: { orderReference: 1, orderType: 1, quantity: 1, executedQuantity: 1, status: 1 } }).fetchAsync();
    const openQty = (o) => Math.max((Number(o.quantity) || 0) - (Number(o.executedQuantity) || 0), 0);
    const otherSells = otherOrders.filter(o => o.orderType === 'sell');
    const otherBuys = otherOrders.filter(o => o.orderType === 'buy');
    const otherOpenSellQuantity = otherSells.reduce((sum, o) => sum + openQty(o), 0);
    const otherOpenBuyQuantity = otherBuys.reduce((sum, o) => sum + openQty(o), 0);

    const orderQuantity = openQty(order);
    const remainingQuantity = heldQuantity + otherOpenBuyQuantity - otherOpenSellQuantity
      + (isSell ? -orderQuantity : orderQuantity);
    const fmt = (q) => OrderFormatters.formatQuantity(q);

    return {
      found: true,
      heldSource,
      heldAsOf,
      heldQuantityFormatted: fmt(heldQuantity),
      heldAsOfFormatted: heldAsOf ? OrderFormatters.formatDate(heldAsOf) : null,
      heldSourceLabel: heldSource === 'bank_file' ? 'Latest bank file' : heldSource === 'none' ? 'Not held in this account (new position)' : 'Snapshot at order entry',
      isSell,
      otherOpenSellQuantityFormatted: otherOpenSellQuantity > 0 ? fmt(otherOpenSellQuantity) : null,
      otherOpenSellRefs: otherSells.map(o => o.orderReference),
      otherOpenBuyQuantityFormatted: otherOpenBuyQuantity > 0 ? fmt(otherOpenBuyQuantity) : null,
      otherOpenBuyRefs: otherBuys.map(o => o.orderReference),
      orderQuantityFormatted: fmt(orderQuantity),
      remainingQuantityFormatted: fmt(remainingQuantity),
      isFullExit: remainingQuantity === 0,
      exceedsPosition: remainingQuantity < 0
    };
  },

  async 'orders.parseEmailTrace'({ orderId, traceId, sessionId }) {
    check(orderId, String);
    check(traceId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    let trace;
    // Check if this is a modification instruction file request
    if (traceId.startsWith('mod_') && order.pendingModification?.instructionFile) {
      trace = order.pendingModification.instructionFile;
    } else {
      const traces = order.emailTraces || [];
      trace = traces.find(t => t._id === traceId);
    }
    if (!trace) {
      throw new Meteor.Error('not-found', 'Email trace not found');
    }

    const ext = (trace.fileName || '').toLowerCase();
    if (!ext.endsWith('.eml')) {
      throw new Meteor.Error('unsupported', 'Only .eml files can be parsed for preview');
    }

    try {
      const { simpleParser } = require('mailparser');
      const filePath = trace.filePath;
      const fileContent = fs.readFileSync(filePath);
      const parsed = await simpleParser(fileContent);

      return {
        success: true,
        from: parsed.from?.text || '',
        to: parsed.to?.text || '',
        subject: parsed.subject || '',
        date: parsed.date ? parsed.date.toISOString() : null,
        html: parsed.html || null,
        text: parsed.text || '',
        hasAttachments: (parsed.attachments || []).length > 0,
        attachmentNames: (parsed.attachments || []).map(a => a.filename || 'unnamed')
      };
    } catch (err) {
      console.error(`[ORDERS] Error parsing .eml trace ${traceId}:`, err);
      throw new Meteor.Error('parse-error', 'Failed to parse email file');
    }
  },

  /**
   * AI compliance check — compare client email content against order details
   * Spots incoherences between what the client asked and what was inputted
   */
  async 'orders.aiComplianceCheck'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) throw new Meteor.Error('not-found', 'Order not found');
    await validateOrderAccess(order, user);

    const ANTHROPIC_API_KEY = Meteor.settings.private?.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_API_KEY) {
      throw new Meteor.Error('config-error', 'Anthropic API key not configured');
    }

    // Gather email content from all traces
    let emailContent = '';
    const senderAddresses = new Set(); // lowercase, from: addresses collected across traces
    const traces = order.emailTraces || [];
    for (const trace of traces) {
      if (!trace.filePath || !fs.existsSync(trace.filePath)) continue;
      const ext = (trace.fileName || '').toLowerCase();
      try {
        if (ext.endsWith('.eml')) {
          const { simpleParser } = require('mailparser');
          const parsed = await simpleParser(fs.readFileSync(trace.filePath));
          emailContent += `--- Email: ${trace.fileName} ---\n`;
          emailContent += `From: ${parsed.from?.text || ''}\n`;
          emailContent += `To: ${parsed.to?.text || ''}\n`;
          emailContent += `Subject: ${parsed.subject || ''}\n`;
          emailContent += `Date: ${parsed.date || ''}\n\n`;
          emailContent += parsed.text || '';
          emailContent += '\n\n';

          // Collect sender addresses for the deterministic authorized-email check below
          const fromValues = parsed.from?.value || [];
          for (const v of fromValues) {
            if (v.address) senderAddresses.add(v.address.trim().toLowerCase());
          }
        } else if (ext.endsWith('.pdf')) {
          // For PDFs, extract text if possible
          try {
            const pdfParse = require('pdf-parse');
            const pdfData = await pdfParse(fs.readFileSync(trace.filePath));
            emailContent += `--- PDF: ${trace.fileName} ---\n`;
            emailContent += pdfData.text || '[Could not extract text]';
            emailContent += '\n\n';
          } catch (pdfErr) {
            emailContent += `--- PDF: ${trace.fileName} (could not extract text) ---\n\n`;
          }
        } else {
          // Plain text / HTML files
          const content = fs.readFileSync(trace.filePath, 'utf8');
          emailContent += `--- File: ${trace.fileName} ---\n`;
          emailContent += content.replace(/<[^>]+>/g, ' ').substring(0, 5000);
          emailContent += '\n\n';
        }
      } catch (err) {
        console.warn(`[AI_CHECK] Could not read trace ${trace.fileName}:`, err.message);
      }
    }

    if (!emailContent.trim()) {
      return { success: true, result: { status: 'no_email', message: 'No client email content found to compare against.' } };
    }

    // Build order summary for comparison
    const client = await UsersCollection.findOneAsync(order.clientId);
    const clientName = client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''} ${client.profile?.companyName || ''}`.trim() : 'Unknown';
    const bank = await BanksCollection.findOneAsync(order.bankId);
    const bankAccount = order.bankAccountId
      ? await BankAccountsCollection.findOneAsync(order.bankAccountId)
      : null;

    // Deterministic authorized-email check: compare email sender(s) vs. bank account's authorized contacts
    const buildAuthorizedEmailCheck = () => {
      const authorizedSet = new Set(getAuthorizedEmails(bankAccount).map(e => e.toLowerCase()));

      if (authorizedSet.size === 0) {
        return {
          field: 'Authorized email',
          status: 'warning',
          detail: 'No authorized email configured on this bank account — cannot verify sender.'
        };
      }
      if (senderAddresses.size === 0) {
        return {
          field: 'Authorized email',
          status: 'warning',
          detail: 'No sender address found in the email traces.'
        };
      }
      const matched = [...senderAddresses].some(addr => authorizedSet.has(addr));
      if (matched) {
        return {
          field: 'Authorized email',
          status: 'ok',
          detail: `Sender matches an authorized email on the bank account.`
        };
      }
      return {
        field: 'Authorized email',
        status: 'mismatch',
        detail: `Sender (${[...senderAddresses].join(', ')}) does not match the account's authorized email(s) (${[...authorizedSet].join(', ')}).`
      };
    };
    const authorizedEmailCheck = buildAuthorizedEmailCheck();

    const isStructuredProduct = order.assetType === 'structured_product';

    // FX orders don't trade a security: they buy one currency and sell another.
    // The pair is stored as BUY/SELL (fxLegs resolves the explicit leg fields
    // first), the quantity is denominated in fxAmountCurrency, and there is no
    // ISIN — the summary must state all of this explicitly or the model
    // misreads the order (e.g. assumes the quantity is in the buy currency).
    const isFx = order.assetType === 'fx';
    const fxLegs = isFx ? OrderFormatters.fxLegs(order) : null;
    const fxAmountCcy = isFx ? (order.fxAmountCurrency || order.currency) : null;

    // Listed options need the same treatment as FX, for the same reason: the
    // quantity is in contracts, not shares, and the ISIN is the placeholder
    // 'OPT'. Left unsaid, the model reads "Quantity: 200" against a client
    // email saying 20,000 shares and reports a mismatch that isn't one.
    const isOption = order.assetType === ASSET_TYPES.OPTION;
    const optionSize = isOption ? (order.optionContractSize || DEFAULT_OPTION_CONTRACT_SIZE) : null;
    const optionShares = isOption ? (order.quantity || 0) * optionSize : null;

    const orderSummary = [
      `Order Reference: ${order.orderReference}`,
      isFx && fxLegs
        ? `Direction: BUY ${fxLegs.buy} / SELL ${fxLegs.sell} (client converts ${fxLegs.sell} into ${fxLegs.buy})`
        : `Direction: ${order.orderType?.toUpperCase()} (${order.orderType === 'buy' ? 'Purchase' : 'Sale'})`,
      `Security: ${order.securityName}`,
      isFx ? 'ISIN: none (FX trades have no ISIN)'
        : isOption ? "ISIN: none (listed options are identified by underlying/type/strike/expiry; the order stores the placeholder 'OPT')"
        : `ISIN: ${order.isin}`,
      `Asset Type: ${order.assetType}`,
      isFx
        ? `Amount: ${order.quantity} ${fxAmountCcy} (the amount is denominated in ${fxAmountCcy})`
        : isOption
        ? `Quantity: ${order.quantity} CONTRACTS (each contract covers ${optionSize} shares, so ${optionShares} shares in total)`
        : `Quantity: ${order.quantity}`,
      isOption && order.optionUnderlyingName ? `Option Underlying: ${order.optionUnderlyingName}${order.optionUnderlyingIsin ? ` (${order.optionUnderlyingIsin})` : ''}` : null,
      isOption && order.optionType ? `Option Type: ${order.optionType.toUpperCase()}` : null,
      isOption && order.optionStrike != null ? `Strike: ${order.optionStrike}` : null,
      isOption && order.optionExpiry ? `Expiry: ${OrderFormatters.formatDate(order.optionExpiry)}` : null,
      isOption && order.optionExchange ? `Exchange: ${order.optionExchange}` : null,
      order.assetType === 'fund' && order.fundQuantityMode ? `Fund Quantity Mode: ${order.fundQuantityMode}` : null,
      isFx && fxLegs
        ? `Buy Currency: ${fxLegs.buy}\nSell Currency: ${fxLegs.sell}`
        : `Currency: ${order.currency}`,
      `Price Type: ${order.priceType}`,
      order.limitPrice ? `Limit Price: ${order.limitPrice}` : null,
      order.stopPrice ? `Stop Price: ${order.stopPrice}` : null,
      order.estimatedValue ? `Estimated Value: ${order.estimatedValue} ${order.currency}` : null,
      // GDPR data minimisation: the LLM does not need the client's identity —
      // the authorized-sender check is deterministic (buildAuthorizedEmailCheck)
      // and identity fields are rendered locally. Account number is masked.
      `Client: [the client]`,
      `Bank: ${bank?.name || 'Unknown'}`,
      `Account: ${order.portfolioCode ? `***${String(order.portfolioCode).slice(-3)}` : 'N/A'}`,
      order.settlementCurrency ? `Settlement Currency: ${order.settlementCurrency}` : null,
      order.broker ? `Broker: ${order.broker}` : null,
      order.notes ? `Notes: ${order.notes}` : null,
      // FX specific
      order.fxPair ? `FX Pair: ${order.fxPair} (buy/sell convention: buy ${order.fxPair.split('/')[0]}, sell ${order.fxPair.split('/')[1] || ''})` : null,
      order.fxSubtype ? `FX Type: ${order.fxSubtype}` : null,
      order.fxRate ? `FX Rate: ${order.fxRate}` : null,
      order.fxValueDate ? `Value Date: ${OrderFormatters.formatDate(order.fxValueDate)}` : null,
      // Validity
      order.validityType ? `Validity: ${order.validityType === 'gtc' ? 'Good Till Canceled' : order.validityType === 'gtd' ? `Good Till ${order.validityDate ? OrderFormatters.formatDate(order.validityDate) : 'Date'}` : 'Day Order'}` : null,
    ].filter(Boolean).join('\n');

    const optionGuidance = isOption ? `

LISTED OPTION SEMANTICS (this order is an option contract — READ CAREFULLY):
- The order's Quantity is a number of CONTRACTS (${order.quantity}), not a number of shares. Each contract covers ${optionSize} shares, so the order represents ${optionShares} shares of the underlying. A client email saying "${optionShares} shares" or "${order.quantity} contracts" or "${order.quantity} lots" ALL match this quantity — do not flag a mismatch on the difference between contracts and shares.
- Options have NO ISIN. Do not expect one and do not flag a missing ISIN. The contract is identified by underlying, call/put, strike and expiry — verify those against the email instead.
- "Price" on an option order is the PREMIUM per share of the option, not the underlying's price and not the strike. Do not compare it to the strike.
- BUY means the client pays the premium; SELL means the client writes the option and receives it.` : '';

    let fxGuidance = '';
    if (isFx && fxLegs) {
      fxGuidance = `

FX ORDER SEMANTICS (this order is an FX conversion — READ CAREFULLY):
- This order BUYS ${fxLegs.buy} and SELLS ${fxLegs.sell}: the client converts ${fxLegs.sell} into ${fxLegs.buy}.
- FX orders have NO ISIN. Do not expect one and do not flag a missing ISIN. Instead verify the currency pair: the currency being bought and the currency being sold.
- The order amount (${order.quantity} ${fxAmountCcy}) is denominated in ${fxAmountCcy} — the currency being ${fxAmountCcy === fxLegs.sell ? 'SOLD' : 'BOUGHT'}. If the client states an amount in ${fxAmountCcy} (e.g. "${fxAmountCcy} 20k"), that matches this amount field directly; only flag Amount if the email states an amount in a currency or size that contradicts it.
- Clients state economic intent, not pair conventions: "convert ${fxLegs.sell} to ${fxLegs.buy}", "sell ${fxLegs.sell}", "buy ${fxLegs.buy}", "switch our ${fxLegs.sell} into ${fxLegs.buy}" are ALL CONSISTENT with this order. Only flag a Direction mismatch if the client's intended conversion is the OPPOSITE (they want to sell ${fxLegs.buy} / receive ${fxLegs.sell}).
- In your checks, use field "Direction" to state which currency is bought and which is sold and whether that matches the client's intent, and field "Amount" for the amount and its currency.`;
    } else if (isFx) {
      fxGuidance = `

FX ORDER SEMANTICS (this order is an FX conversion — READ CAREFULLY):
- The pair is written BUY/SELL: the first currency is bought, the second is sold. FX orders have NO ISIN — do not flag a missing ISIN.
- Clients describe the economic intent ("convert X to Y", "sell X", "buy Y") rather than the pair. Only flag a Direction mismatch if the client's intent is the OPPOSITE of the entered legs.`;
    }

    const prompt = `You are a compliance officer at Amberlake Partners, a wealth-management advisory firm. Amberlake proposes investments to clients by email; clients then reply with their approval, often briefly ("ok", "ok pour moi", "yes", "accepted", "go", "perfect"). You must compare the client's instruction against the order that was entered into the system and identify real discrepancies.

KEY CONTEXT — READ CAREFULLY:
- Amberlake Partners IS the firm running this system. Emails sent FROM @amberlakepartners.com to the client are Amberlake's advisory proposals, NOT third-party intermediary issues. Do not flag "is Amberlake authorized" — Amberlake is the advisor and the question is moot.
- The client typically replies on top of a long email thread (their reply is usually short and the proposal details are in quoted text BELOW their reply, or earlier in the thread). You MUST read the whole thread, including quoted/forwarded portions, before judging completeness. A short "ok" approving a fully-detailed proposal earlier in the thread IS a complete instruction, not a vague approval.
- Authorized signatories for the account are configured separately on the bank account (authorizedEmails / authorizedPhone). A separate deterministic check already verifies the sender against those fields — do NOT re-flag the authorized-email match in your output (it will be added automatically).
- Price for structured products is in % of par (e.g., 100 means 100% of nominal), not in currency units.

MULTI-ORDER EMAILS — IMPORTANT:
- A single client email frequently covers SEVERAL distinct orders sent together (the client groups multiple transactions in one approval). The same email file is then attached to each of those orders for traceability.
- You are checking ONE order at a time. The email may legitimately reference other securities, ISINs, quantities, or directions that belong to sibling orders, NOT this one.
- Your job is to confirm that THIS order's details (direction, security/ISIN, quantity, price, currency) are present and consistent somewhere in the email/thread. Do NOT flag a mismatch just because the email also discusses other transactions that don't match this order. Only flag a mismatch if THIS specific order's instruction is absent or contradicted.

PRICE/QUANTITY GUIDELINES:
- For structured products: "Price" in the order = % of par. The notional/face value is the "Quantity" field (e.g., 750,000 EUR notional at 100% = 750,000 EUR).
- For equities/ETFs: Quantity = number of shares; Price = per-share currency price.
- For funds: the "Quantity" field can represent either a number of UNITS or a NOMINAL cash amount, depending on the order's "Fund Quantity Mode". If the email says e.g. "subscribe 100,000 EUR" and the order is in nominal mode with quantity 100000, that's a match — do NOT flag the absence of a unit count.
- An exact quantity in the email is required. A range (e.g., "500k–750k") is a proposal, not an instruction; treat as a warning if the order's quantity falls within the range and was confirmed; treat as mismatch if outside.${isStructuredProduct ? `

TERM SHEET ISIN CHECK (structured product order):
- This order is a STRUCTURED PRODUCT. A term sheet PDF should be attached among the email traces (look for "--- PDF: ..." sections in the content below).
- If a term sheet PDF is present, find the ISIN printed in it (commonly labelled "ISIN", "Valor", "Security identifier", or shown near the product name) and verify it equals the order ISIN (${order.isin}).
- Add a check with field "Term sheet ISIN":
    - status "ok" if the PDF's ISIN matches the order's ISIN.
    - status "mismatch" if the PDF's ISIN differs from the order's ISIN — this is a serious red flag.
    - status "warning" if no term sheet PDF is attached, or if the PDF text doesn't contain an extractable ISIN.
- Quote the ISIN you found in the detail field.` : ''}${fxGuidance}${optionGuidance}

ORDER ENTERED IN SYSTEM:
${orderSummary}

CLIENT EMAIL/INSTRUCTION (full thread, may include quoted text below the reply${isStructuredProduct ? '; PDF attachments such as the term sheet are also included as "--- PDF: ..." sections' : ''}; email addresses are redacted as [email] — the sender-authorization check is done separately, do not comment on redacted addresses):
${emailContent.substring(0, 12000).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]')}

Analyze and respond with a JSON object (no markdown, just raw JSON):
{
  "status": "match" | "warning" | "mismatch",
  "confidence": 0-100,
  "summary": "One sentence overall assessment",
  "checks": [
    {
      "field": "field name (e.g. ${isFx ? 'Direction, Currency Pair, Amount, Rate, Value Date' : isOption ? 'Direction, Underlying, Call/Put, Strike, Expiry, Contracts, Premium' : `Direction, Security, Quantity, Price, Currency, Settlement Date${isStructuredProduct ? ', Term sheet ISIN' : ''}`})",
      "status": "ok" | "warning" | "mismatch",
      "detail": "Brief explanation grounded in the email thread"
    }
  ],
  "notes": "Any additional observations"
}

Important:
- Read the FULL thread before judging. Look in quoted/forwarded portions for the proposal details that the client is approving.
- Do NOT include an "Authorized email" check — that is added separately.
- Do NOT question whether Amberlake Partners is an authorized intermediary — Amberlake IS the firm.
- Do NOT flag a mismatch because the email references additional securities/orders other than this one — multi-order emails are normal.
${isFx
  ? '- Compare direction (which currency is bought and which is sold), currency pair, amount (and the currency it is denominated in), rate if stated, and value date. FX orders have no ISIN — never flag one as missing. Missing fields → warning, not mismatch.'
  : isOption
  ? '- Compare direction (buy/sell), underlying, call/put, strike, expiry, number of contracts and premium. Options have no ISIN — never flag one as missing. Missing fields → warning, not mismatch.'
  : '- Compare direction (buy/sell), security/ISIN, quantity, price, currency. Missing fields → warning, not mismatch.'}
- Be concise. Focus on real discrepancies between the order and what the client (or the proposal they approved) specified.`;

    try {
      console.log(`[AI_CHECK] Running compliance check for order ${order.orderReference}`);

      const response = await HTTP.post('https://api.anthropic.com/v1/messages', {
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        data: {
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }]
        }
      });

      const textContent = response.data?.content
        ?.filter(block => block.type === 'text')
        ?.map(block => block.text)
        ?.join('') || '';

      // Parse JSON from response
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        // Prepend deterministic authorized-email check so it shows first in the UI
        result.checks = Array.isArray(result.checks) ? result.checks : [];
        result.checks = [authorizedEmailCheck, ...result.checks];
        // Escalate overall status on a hard mismatch of the authorized email
        if (authorizedEmailCheck.status === 'mismatch') {
          result.status = 'mismatch';
        } else if (authorizedEmailCheck.status === 'warning' && result.status === 'match') {
          result.status = 'warning';
        }
        console.log(`[AI_CHECK] Order ${order.orderReference}: ${result.status} (confidence: ${result.confidence}%) — authorizedEmail: ${authorizedEmailCheck.status}`);
        return { success: true, result };
      }

      return {
        success: true,
        result: {
          status: authorizedEmailCheck.status === 'mismatch' ? 'mismatch' : 'warning',
          summary: 'Could not parse AI response',
          notes: textContent,
          checks: [authorizedEmailCheck],
          confidence: 0
        }
      };
    } catch (err) {
      console.error(`[AI_CHECK] Error for order ${order.orderReference}:`, err.message);
      throw new Meteor.Error('ai-error', `AI check failed: ${err.message}`);
    }
  }
});

/**
 * Top-of-ticket block for an amendment / cancellation: what the bank must do,
 * which original instruction it refers to, and (amendment) every changed field.
 */
function buildTicketBannerHTML(order, ticket) {
  const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const originalSentAt = order.transmittedAt || order.sentAt;
  const sentOn = originalSentAt ? ` transmitted on ${OrderFormatters.formatDate(originalSentAt)}` : '';
  const ticketDate = OrderFormatters.formatDateTime(ticket.change?.validatedAt || new Date());

  if (ticket.kind === TICKET_KINDS.CANCEL) {
    const remaining = Math.max(0, (Number(order.quantity) || 0) - (Number(order.executedQuantity) || 0));
    const executed = Number(order.executedQuantity) || 0;
    return `
  <div class="ticket-banner cancel">
    <div class="ticket-banner-title">CANCELLATION OF ORDER ${esc(order.orderReference)}</div>
    <div class="ticket-banner-text">Please <strong>cancel</strong> our order instruction Ref. <strong>${esc(order.orderReference)}</strong>${sentOn}. Issued ${ticketDate}.</div>
    <table class="ticket-changes">
      <tbody>
        <tr><td>Quantity to cancel</td><td class="new-value">${esc(OrderFormatters.formatQuantity(remaining))}</td></tr>
        ${executed > 0 ? `<tr><td>Already executed (not affected)</td><td>${esc(OrderFormatters.formatQuantity(executed))} of ${esc(OrderFormatters.formatQuantity(order.quantity))}</td></tr>` : ''}
      </tbody>
    </table>
  </div>`;
  }

  const rows = OrderHelpers.describeOrderChange(ticket.change, order);
  return `
  <div class="ticket-banner">
    <div class="ticket-banner-title">AMENDMENT No. ${ticket.sequence} OF ORDER ${esc(order.orderReference)}</div>
    <div class="ticket-banner-text">This amends our order instruction Ref. <strong>${esc(order.orderReference)}</strong>${sentOn}. Issued ${ticketDate}. All other terms are unchanged; the order below shows the amended terms.</div>
    <table class="ticket-changes">
      <thead><tr><th>Field</th><th>Previous</th><th>Amended</th></tr></thead>
      <tbody>
        ${rows.map(row => `<tr><td>${esc(row.label)}</td><td>${esc(row.from)}</td><td class="new-value">${esc(row.to)}</td></tr>`).join('')}
      </tbody>
    </table>
  </div>`;
}

/**
 * Generate HTML for Order Confirmation PDF
 */
function generateOrderPDFHTML(order, client, bankAccount, bank, createdByUser, liveIssuer = null, ticket = null) {
  const orderDate = OrderFormatters.formatDateTime(order.createdAt);
  // ticket: null for the original order instruction, or the amendment /
  // cancellation context from buildTicketContext.
  const isCancelTicket = ticket?.kind === TICKET_KINDS.CANCEL;
  const isAmendTicket = ticket?.kind === TICKET_KINDS.AMEND;
  const ticketTitle = isCancelTicket ? 'Order Cancellation' : isAmendTicket ? 'Order Amendment' : 'Order Confirmation';
  const ticketBanner = ticket ? buildTicketBannerHTML(order, ticket) : '';
  // Rejected requests never reached the bank, so they stay off its ticket
  const bankVisibleHistory = (order.limitHistory || []).filter(entry => !entry.rejectedAt && entry.status !== 'rejected');
  // Structured products are dealt directly with the issuer, so the ticket
  // carries the same coordinates as the covering email — the desk works from
  // the PDF once the mail is filed, and shouldn't have to go back to it.
  const issuer = OrderHelpers.resolveIssuerContact(order, liveIssuer);
  const showIssuer = !!(issuer && (issuer.name || OrderHelpers.hasIssuerCoordinates(issuer)));
  // Use bank account name first, then resolve client/entity name
  const clientName = bankAccount?.name
    || (client?.profile?.companyName)
    || (client?.profile?.firstName || client?.profile?.lastName
      ? `${client.profile.firstName || ''} ${client.profile.lastName || ''}`.trim()
      : null)
    || order.clientName
    || 'Unknown';
  const createdByName = createdByUser ? `${createdByUser.profile?.firstName || ''} ${createdByUser.profile?.lastName || ''}`.trim() : 'System';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ticketTitle} - ${order.orderReference}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11pt;
      line-height: 1.5;
      color: #1f2937;
      background: white;
      padding: 20px 40px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0ea5e9;
      padding-bottom: 20px;
      margin-bottom: 30px;
    }
    .logo {
      font-size: 24pt;
      font-weight: 700;
      color: #0ea5e9;
    }
    .logo-sub {
      font-size: 10pt;
      color: #6b7280;
      margin-top: 4px;
    }
    .order-info {
      text-align: right;
    }
    .order-ref {
      font-size: 14pt;
      font-weight: 600;
      color: #1f2937;
    }
    .order-date {
      font-size: 10pt;
      color: #6b7280;
      margin-top: 4px;
    }
    .order-type {
      display: inline-block;
      padding: 6px 16px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 12pt;
      margin-top: 8px;
      color: white;
      background: ${order.orderType === 'buy' ? '#10b981' : '#ef4444'};
    }
    h2 {
      font-size: 12pt;
      font-weight: 600;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 8px;
      margin: 24px 0 16px 0;
    }
    .section {
      margin-bottom: 24px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px 32px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .info-row.full-width {
      grid-column: 1 / -1;
    }
    .info-label {
      color: #6b7280;
      font-size: 10pt;
    }
    .info-value {
      font-weight: 500;
      color: #1f2937;
      text-align: right;
    }
    .highlight {
      background: #f0f9ff;
      padding: 16px;
      border-radius: 8px;
      border-left: 4px solid #0ea5e9;
    }
    .highlight-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .highlight-row:last-child {
      margin-bottom: 0;
    }
    .highlight-label {
      font-weight: 500;
      color: #374151;
    }
    .highlight-value {
      font-weight: 600;
      color: #0ea5e9;
      font-size: 12pt;
    }
    .execution-type {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 10pt;
      margin-top: 6px;
    }
    .execution-type.to-execute {
      background: #dbeafe;
      color: #1d4ed8;
    }
    .execution-type.pre-executed {
      background: #fef3c7;
      color: #92400e;
    }
    .allocation-warning {
      background: #fef3c7;
      padding: 16px;
      border-radius: 8px;
      border-left: 4px solid #f59e0b;
      margin-top: 20px;
    }
    .allocation-warning .warning-title {
      font-weight: 600;
      color: #92400e;
      margin-bottom: 8px;
      font-size: 11pt;
    }
    .allocation-warning .breach-item {
      font-size: 10pt;
      color: #78350f;
      margin-bottom: 4px;
    }
    .allocation-warning .justification {
      margin-top: 8px;
      font-size: 10pt;
      color: #78350f;
      font-style: italic;
    }
    .notes {
      background: #fef3c7;
      padding: 16px;
      border-radius: 8px;
      border-left: 4px solid #f59e0b;
      margin-top: 20px;
    }
    .notes-title {
      font-weight: 600;
      color: #92400e;
      margin-bottom: 8px;
    }
    .notes-content {
      color: #78350f;
      font-size: 10pt;
      white-space: pre-wrap;
    }
    .footer {
      margin-top: 20px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 9pt;
      color: #9ca3af;
      text-align: center;
    }
    .footer-line {
      margin-bottom: 4px;
    }
    .ticket-banner {
      margin: 0 0 18px;
      padding: 14px 16px;
      border-radius: 6px;
      border: 2px solid #b45309;
      background: #fffbeb;
    }
    .ticket-banner.cancel {
      border-color: #b91c1c;
      background: #fef2f2;
    }
    .ticket-banner-title {
      font-size: 14pt;
      font-weight: 700;
      letter-spacing: 0.5px;
      color: #92400e;
      margin-bottom: 6px;
    }
    .ticket-banner.cancel .ticket-banner-title {
      color: #991b1b;
    }
    .ticket-banner-text {
      font-size: 10.5pt;
      margin-bottom: 8px;
    }
    .ticket-changes {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5pt;
    }
    .ticket-changes th {
      text-align: left;
      padding: 5px 8px;
      color: #6b7280;
      border-bottom: 1px solid #e5e7eb;
    }
    .ticket-changes td {
      padding: 5px 8px;
      border-bottom: 1px solid #f3f4f6;
    }
    .ticket-changes td.new-value {
      font-weight: 700;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <img src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png" alt="Amberlake Partners" style="height: 40px; object-fit: contain;" />
    </div>
    <div class="order-info">
      <div class="order-ref">${order.orderReference}</div>
      <div class="order-date">${orderDate}</div>
      <div class="order-type">${(order.assetType === 'term_deposit' ? OrderFormatters.orderDirectionLabel(order) : (order.orderType || '')).toUpperCase()}</div>
      <div class="execution-type ${order.executionType === 'pre_executed' ? 'pre-executed' : 'to-execute'}">${ticket ? ticketTitle.toUpperCase() : (EXECUTION_TYPE_LABELS[order.executionType] || 'Order to be Executed')}</div>
    </div>
  </div>

  ${ticketBanner}

  <div class="section">
    <h2>Account Information</h2>
    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Account Name</span>
        <span class="info-value">${clientName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Bank</span>
        <span class="info-value">${bank?.name || 'N/A'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Account Number</span>
        <span class="info-value">${bankAccount?.accountNumber || order.portfolioCode || 'N/A'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Reference Currency</span>
        <span class="info-value">${bankAccount?.referenceCurrency || order.currency}</span>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>${instrumentSectionHeading(order)}</h2>
    <div class="info-grid">
      <div class="info-row full-width">
        <span class="info-label">${hasRealIsin(order) ? 'Security Name' : 'Description'}</span>
        <span class="info-value">${order.securityName}</span>
      </div>
      ${order.assetType === 'fx' && order.fxPair ? `
      <div class="info-row">
        <span class="info-label">FX Pair</span>
        <span class="info-value">${order.fxPair}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Direction</span>
        <span class="info-value">${OrderFormatters.fxDirectionLabel(order)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">FX Type</span>
        <span class="info-value">${order.fxSubtype === 'forward' ? 'Forward' : 'Spot'}</span>
      </div>
      ${order.fxAmountCurrency ? `
      <div class="info-row">
        <span class="info-label">Amount</span>
        <span class="info-value">${OrderFormatters.formatFxAmount(order.quantity, order.fxAmountCurrency)} ${order.fxAmountCurrency}</span>
      </div>
      ` : ''}
      ${order.fxRate ? `
      <div class="info-row">
        <span class="info-label">Rate</span>
        <span class="info-value">${order.fxRate.toFixed(4)}</span>
      </div>
      ` : ''}
      ${order.limitPrice ? `
      <div class="info-row">
        <span class="info-label">Limit Price</span>
        <span class="info-value">${order.limitPrice.toFixed(4)}</span>
      </div>
      ` : ''}
      ${order.stopLossPrice ? `
      <div class="info-row">
        <span class="info-label">Stop Loss</span>
        <span class="info-value">${order.stopLossPrice.toFixed(4)}</span>
      </div>
      ` : ''}
      ${order.takeProfitPrice ? `
      <div class="info-row">
        <span class="info-label">Take Profit</span>
        <span class="info-value">${order.takeProfitPrice.toFixed(4)}</span>
      </div>
      ` : ''}
      ${order.fxValueDate ? `
      <div class="info-row">
        <span class="info-label">Value Date</span>
        <span class="info-value">${OrderFormatters.formatDate(order.fxValueDate)}</span>
      </div>
      ` : ''}
      ${order.fxForwardDate ? `
      <div class="info-row">
        <span class="info-label">Forward Date</span>
        <span class="info-value">${OrderFormatters.formatDate(order.fxForwardDate)}</span>
      </div>
      ` : ''}
      ` : order.assetType === 'term_deposit' ? `
      <div class="info-row">
        <span class="info-label">Deposit Currency</span>
        <span class="info-value">${order.depositCurrency || order.currency}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Tenor</span>
        <span class="info-value">${TERM_DEPOSIT_TENORS.find(t => t.value === order.depositTenor)?.label || order.depositTenor || 'N/A'}</span>
      </div>
      ${order.depositMaturityDate ? `
      <div class="info-row">
        <span class="info-label">Maturity Date</span>
        <span class="info-value">${OrderFormatters.formatDate(order.depositMaturityDate)}</span>
      </div>
      ` : ''}
      ` : `
      ${hasRealIsin(order) ? `
      <div class="info-row">
        <span class="info-label">ISIN</span>
        <span class="info-value">${order.isin}</span>
      </div>
      ` : ''}${optionDetailRowsHtml(order)}
      `}
      <div class="info-row">
        <span class="info-label">Asset Type</span>
        <span class="info-value">${OrderFormatters.getAssetTypeLabel(order.assetType)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Currency</span>
        <span class="info-value">${order.currency}</span>
      </div>
    </div>
  </div>

  ${showIssuer ? `
  <div class="section">
    <h2>Issuer</h2>
    <div class="info-grid">
      ${issuer.name ? `
      <div class="info-row">
        <span class="info-label">Issuer</span>
        <span class="info-value">${issuer.name}</span>
      </div>
      ` : ''}
      ${issuer.contactName ? `
      <div class="info-row">
        <span class="info-label">Contact</span>
        <span class="info-value">${issuer.contactName}</span>
      </div>
      ` : ''}
      ${issuer.contactEmail ? `
      <div class="info-row">
        <span class="info-label">Email</span>
        <span class="info-value">${issuer.contactEmail}</span>
      </div>
      ` : ''}
      ${issuer.contactPhone ? `
      <div class="info-row">
        <span class="info-label">Phone</span>
        <span class="info-value">${issuer.contactPhone}</span>
      </div>
      ` : ''}
    </div>
  </div>
  ` : ''}

  <div class="section">
    <h2>Order Details</h2>
    <div class="highlight">
      <div class="highlight-row">
        <span class="highlight-label">Order Type</span>
        <span class="highlight-value">${OrderFormatters.orderDirectionLabel(order)}</span>
      </div>
      <div class="highlight-row">
        <span class="highlight-label">${quantityLabelFor(order)}</span>
        <span class="highlight-value">${order.assetType === 'fx' ? `${OrderFormatters.formatFxAmount(order.quantity, order.fxAmountCurrency)} ${order.fxAmountCurrency || ''}`.trim() : OrderFormatters.formatQuantity(order.quantity)}</span>
      </div>
      ${order.assetType === 'structured_product' ? `
        ${order.limitPrice ? `
        <div class="highlight-row">
          <span class="highlight-label">Price</span>
          <span class="highlight-value">${Number(order.limitPrice).toFixed(2)}%</span>
        </div>
        ` : ''}
      ` : order.assetType === 'term_deposit' ? '' : `
        <div class="highlight-row">
          <span class="highlight-label">Price Type</span>
          <span class="highlight-value">${OrderFormatters.getPriceTypeLabel(order.priceType)}</span>
        </div>
        ${order.priceType !== 'market' && order.limitPrice ? `
        <div class="highlight-row">
          <span class="highlight-label">${OrderFormatters.getPriceTypeLabel(order.priceType)} Price</span>
          <span class="highlight-value">${OrderFormatters.formatWithCurrency(order.limitPrice, order.currency)}</span>
        </div>
        ` : ''}
        ${order.validityType ? `
        <div class="highlight-row">
          <span class="highlight-label">Validity</span>
          <span class="highlight-value">${order.validityType === 'gtc' ? 'Good Till Canceled' : order.validityType === 'gtd' ? `Good Till ${order.validityDate ? OrderFormatters.formatDate(order.validityDate) : 'Date'}` : 'Day Order'}</span>
        </div>
        ` : ''}
      `}
      ${order.broker ? `
      <div class="highlight-row">
        <span class="highlight-label">Broker</span>
        <span class="highlight-value">${order.broker}</span>
      </div>
      ` : ''}
      ${order.estimatedValue ? `
      <div class="highlight-row">
        <span class="highlight-label">Estimated Value</span>
        <span class="highlight-value">${OrderFormatters.formatWithCurrency(order.estimatedValue, order.currency)}</span>
      </div>
      ` : ''}
    </div>
  </div>

  ${(!ticket && bankVisibleHistory.length > 0) ? `
  <div class="section">
    <h2>Limit Modification History</h2>
    <table style="width: 100%; border-collapse: collapse; font-size: 10pt;">
      <thead>
        <tr style="border-bottom: 1px solid #e5e7eb;">
          <th style="text-align: left; padding: 6px 8px; color: #6b7280;">Date</th>
          <th style="text-align: left; padding: 6px 8px; color: #6b7280;">Previous Type</th>
          <th style="text-align: left; padding: 6px 8px; color: #6b7280;">Previous Price</th>
          <th style="text-align: left; padding: 6px 8px; color: #6b7280;">Changed By</th>
          <th style="text-align: left; padding: 6px 8px; color: #6b7280;">Reason</th>
        </tr>
      </thead>
      <tbody>
        ${bankVisibleHistory.map(entry => `
        <tr style="border-bottom: 1px solid #f3f4f6;">
          <td style="padding: 6px 8px;">${OrderFormatters.formatDateTime(entry.changedAt)}</td>
          <td style="padding: 6px 8px;">${OrderFormatters.getPriceTypeLabel(entry.priceType)}</td>
          <td style="padding: 6px 8px;">${entry.price != null ? OrderFormatters.formatWithCurrency(entry.price, order.currency) : 'N/A'}</td>
          <td style="padding: 6px 8px;">${entry.changedByName || 'Unknown'}</td>
          <td style="padding: 6px 8px;">${entry.reason || '-'}</td>
        </tr>
        `).join('')}
      </tbody>
    </table>
  </div>
  ` : ''}

  <!-- Allocation warnings excluded from bank PDF — kept in audit trail only -->
  <!-- Internal notes excluded from bank PDF — kept in audit trail only -->
  ${order.bankComment ? `
  <div class="notes">
    <div class="notes-title">Comments</div>
    <div class="notes-content">${order.bankComment}</div>
  </div>
  ` : ''}

  <div class="footer">
    <div class="footer-line">${ticketTitle} generated by Ambervision Platform</div>
  </div>
</body>
</html>
  `;
}

/**
 * Build chronological audit timeline from order fields
 */
function buildAuditTimeline(order) {
  const events = [];

  // Created
  if (order.createdAt) {
    events.push({ date: order.createdAt, event: 'Order Created', by: order.createdByName || '', details: `${(order.orderType || '').toUpperCase()} ${order.securityName || ''}` });
  }

  // Phone order source
  if (order.orderSource === 'phone') {
    const phoneDetails = [order.phoneCallLine, order.phoneCallTime ? `at ${OrderFormatters.formatDateTime(order.phoneCallTime)}` : ''].filter(Boolean).join(' ');
    events.push({ date: order.createdAt, event: 'Phone Order', by: order.createdByName || '', details: phoneDetails || 'Phone call' });
  }

  // Allocation warning
  if (order.allocationWarning?.checkedAt) {
    const breachSummary = (order.allocationWarning.breaches || []).map(b => `${b.category}: ${(b.projected || 0).toFixed(1)}% > ${b.limit}%`).join(', ');
    events.push({ date: order.allocationWarning.checkedAt, event: 'Allocation Warning', by: 'System', details: breachSummary });
  }

  // Validated
  if (order.validatedAt) {
    events.push({ date: order.validatedAt, event: 'Validated (Four-Eyes)', by: order.validatedByName || '', details: '' });
  }

  // Rejected
  if (order.rejectedAt) {
    events.push({ date: order.rejectedAt, event: 'Rejected', by: order.rejectedByName || '', details: order.rejectionReason || '' });
  }

  // Modification / cancellation requests
  (order.limitHistory || []).forEach(entry => {
    const isCancel = entry.kind === TICKET_KINDS.CANCEL;
    const changes = isCancel ? [] : OrderHelpers.describeOrderChange(entry, order);
    const changeText = changes.map(row => `${row.label}: ${row.from} → ${row.to}`).join('; ');
    events.push({
      date: entry.changedAt,
      event: isCancel ? 'Cancellation Requested' : 'Modification Requested',
      by: entry.changedByName || '',
      details: [changeText, entry.reason ? `Reason: ${entry.reason}` : ''].filter(Boolean).join(' — ')
        || `Changed to ${OrderFormatters.getPriceTypeLabel(entry.newPriceType || 'limit')}`
    });
    if (entry.validatedAt) {
      events.push({ date: entry.validatedAt, event: isCancel ? 'Cancellation Validated (Four-Eyes)' : 'Modification Validated (Four-Eyes)', by: entry.validatedByName || '', details: '' });
    }
    if (entry.rejectedAt) {
      events.push({ date: entry.rejectedAt, event: isCancel ? 'Cancellation Rejected' : 'Modification Rejected', by: entry.rejectedByName || '', details: entry.rejectionReason || '' });
    }
    if (entry.bankNotice?.sentAt) {
      events.push({
        date: entry.bankNotice.sentAt,
        event: isCancel ? 'Cancellation Sent to Bank' : 'Amendment Sent to Bank',
        by: '',
        details: entry.bankNotice.sentMethod === 'graph' ? 'Sent via Outlook' : 'Sent mail filed on the order'
      });
    }
  });

  // Transmitted
  if (order.transmittedAt) {
    events.push({ date: order.transmittedAt, event: 'Transmitted to Bank', by: order.transmittedByName || '', details: '' });
  }

  // Email sent
  if (order.sentAt) {
    events.push({ date: order.sentAt, event: 'Email Sent', by: '', details: `To: ${order.sentTo || 'bank desk'}` });
  }

  // Termsheet updates
  if (order.termsheetUpdatedAt) {
    events.push({ date: order.termsheetUpdatedAt, event: `Termsheet: ${order.termsheetStatus || 'updated'}`, by: order.termsheetUpdatedBy || '', details: '' });
  }

  // Email trace uploads
  (order.emailTraces || []).forEach(trace => {
    events.push({
      date: trace.uploadedAt,
      event: `Document Attached: ${EMAIL_TRACE_LABELS[trace.traceType] || trace.traceType}`,
      by: trace.uploadedByName || '',
      details: trace.fileName || ''
    });
  });

  // Executed
  if (order.executedAt) {
    const execDetails = [];
    if (order.executedQuantity) execDetails.push(`Qty: ${OrderFormatters.formatQuantity(order.executedQuantity)}`);
    if (order.executedPrice) execDetails.push(`Price: ${OrderFormatters.formatWithCurrency(order.executedPrice, order.currency)}`);
    if (order.executionDate) execDetails.push(`Date: ${OrderFormatters.formatDate(order.executionDate)}`);
    events.push({ date: order.executedAt, event: 'Marked as Executed', by: order.executedByName || '', details: execDetails.join(', ') });
  }

  // Cancelled
  // (a four-eyes cancellation is already on the timeline through its history entry)
  if (order.cancelledAt && !(order.limitHistory || []).some(entry => entry.kind === TICKET_KINDS.CANCEL && entry.validatedAt)) {
    events.push({ date: order.cancelledAt, event: 'Cancelled', by: order.cancelledBy || '', details: order.cancellationReason || '' });
  }

  // Sort chronologically
  events.sort((a, b) => new Date(a.date) - new Date(b.date));
  return events;
}

/**
 * Parse email trace file contents for audit trail PDF
 * Reads .eml, .pdf, .html files and extracts displayable content
 * Returns a map of traceId -> parsed content
 */
async function parseEmailTraceContents(order) {
  const traces = order.emailTraces || [];
  const parsed = {};

  for (const trace of traces) {
    if (!trace.filePath || !fs.existsSync(trace.filePath)) {
      parsed[trace._id] = { error: 'File not found on disk' };
      continue;
    }

    const ext = (trace.fileName || '').toLowerCase();
    try {
      if (ext.endsWith('.eml')) {
        const { simpleParser } = require('mailparser');
        const fileContent = fs.readFileSync(trace.filePath);
        const email = await simpleParser(fileContent);
        parsed[trace._id] = {
          type: 'email',
          from: email.from?.text || '',
          to: email.to?.text || '',
          cc: email.cc?.text || '',
          subject: email.subject || '',
          date: email.date || null,
          text: email.text || '',
          html: email.html || null,
          hasAttachments: (email.attachments || []).length > 0,
          attachmentNames: (email.attachments || []).map(a => a.filename || 'unnamed')
        };
      } else if (ext.endsWith('.pdf')) {
        try {
          const pdfParse = require('pdf-parse');
          const pdfData = await pdfParse(fs.readFileSync(trace.filePath));
          parsed[trace._id] = {
            type: 'pdf',
            text: pdfData.text || '[Could not extract text]'
          };
        } catch (pdfErr) {
          parsed[trace._id] = { type: 'pdf', error: 'Could not extract PDF text' };
        }
      } else if (ext.endsWith('.html') || ext.endsWith('.htm')) {
        const content = fs.readFileSync(trace.filePath, 'utf8');
        // Strip HTML tags for plain text display in PDF
        const textContent = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        parsed[trace._id] = {
          type: 'html',
          text: textContent.substring(0, 10000)
        };
      } else if (ext.endsWith('.msg')) {
        parsed[trace._id] = { type: 'msg', error: 'MSG files cannot be parsed for inline display' };
      } else {
        // Images and other files — just metadata
        parsed[trace._id] = { type: 'other' };
      }
    } catch (err) {
      console.warn(`[AUDIT_TRAIL] Could not parse trace ${trace.fileName}:`, err.message);
      parsed[trace._id] = { error: `Parse error: ${err.message}` };
    }
  }

  return parsed;
}

/**
 * Generate HTML for Audit Trail PDF
 */
function generateAuditTrailPDFHTML(order, client, bankAccount, bank, createdByUser, timeline, parsedTraces) {
  const orderDate = OrderFormatters.formatDateTime(order.createdAt);
  const clientName = client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown';
  const createdByName = createdByUser ? `${createdByUser.profile?.firstName || ''} ${createdByUser.profile?.lastName || ''}`.trim() : 'System';

  // Lifecycle order for email traces display
  const traceLifecycleOrder = ['client_order', 'order_to_bank', 'order_to_issuer', 'bank_confirmation'];
  const sortedTraces = (order.emailTraces || []).slice().sort((a, b) => {
    const aIdx = traceLifecycleOrder.indexOf(a.traceType);
    const bIdx = traceLifecycleOrder.indexOf(b.traceType);
    return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
  });

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Audit Trail - ${order.orderReference}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      color: #1f2937;
      background: white;
      padding: 20px 30px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0ea5e9;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .order-info { text-align: right; }
    .order-ref { font-size: 13pt; font-weight: 600; color: #1f2937; }
    .order-date { font-size: 9pt; color: #6b7280; margin-top: 2px; }
    .order-type {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 10pt;
      margin-top: 6px;
      color: white;
      background: ${order.orderType === 'buy' ? '#10b981' : '#ef4444'};
    }
    .doc-title {
      font-size: 9pt;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-top: 4px;
    }
    h2 {
      font-size: 11pt;
      font-weight: 600;
      color: #374151;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px;
      margin: 20px 0 12px 0;
    }
    .section { margin-bottom: 20px; }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 24px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 5px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .info-row.full-width { grid-column: 1 / -1; }
    .info-label { color: #6b7280; font-size: 9pt; }
    .info-value { font-weight: 500; color: #1f2937; text-align: right; font-size: 9pt; }
    .highlight {
      background: #f0f9ff;
      padding: 12px;
      border-radius: 6px;
      border-left: 3px solid #0ea5e9;
    }
    .highlight-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6px;
    }
    .highlight-row:last-child { margin-bottom: 0; }
    .highlight-label { font-weight: 500; color: #374151; font-size: 9pt; }
    .highlight-value { font-weight: 600; color: #0ea5e9; font-size: 10pt; }
    .execution-box {
      background: #f0fdf4;
      padding: 12px;
      border-radius: 6px;
      border-left: 3px solid #10b981;
      margin-top: 12px;
    }
    .execution-box .highlight-value { color: #10b981; }
    .timeline-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9pt;
    }
    .timeline-table th {
      text-align: left;
      padding: 6px 8px;
      color: #6b7280;
      font-weight: 600;
      border-bottom: 2px solid #e5e7eb;
      font-size: 8pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .timeline-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #f3f4f6;
      vertical-align: top;
    }
    .timeline-table tr:last-child td { border-bottom: none; }
    .event-badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 8pt;
      font-weight: 500;
      white-space: nowrap;
    }
    .event-created { background: #dbeafe; color: #1e40af; }
    .event-validated { background: #d1fae5; color: #065f46; }
    .event-rejected { background: #fee2e2; color: #991b1b; }
    .event-modified { background: #fef3c7; color: #92400e; }
    .event-transmitted { background: #e0e7ff; color: #3730a3; }
    .event-sent { background: #dbeafe; color: #1e40af; }
    .event-executed { background: #d1fae5; color: #065f46; }
    .event-cancelled { background: #fee2e2; color: #991b1b; }
    .event-document { background: #f3e8ff; color: #6b21a8; }
    .event-warning { background: #fef3c7; color: #92400e; }
    .event-termsheet { background: #e0e7ff; color: #3730a3; }
    .trace-card {
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 12px;
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    .trace-type {
      font-weight: 600;
      font-size: 10pt;
      color: #374151;
      margin-bottom: 4px;
    }
    .trace-meta { font-size: 8pt; color: #6b7280; }
    .trace-filename { font-size: 9pt; color: #1f2937; margin-top: 4px; }
    .email-header {
      background: #f9fafb;
      padding: 8px 10px;
      border-radius: 4px;
      margin-top: 8px;
      font-size: 8pt;
      color: #374151;
    }
    .email-header-row { margin-bottom: 2px; }
    .email-header-label { font-weight: 600; color: #6b7280; display: inline-block; width: 55px; }
    .email-body {
      margin-top: 8px;
      padding: 10px;
      background: #fff;
      border: 1px solid #f3f4f6;
      border-radius: 4px;
      font-size: 8pt;
      color: #374151;
      line-height: 1.5;
      white-space: pre-wrap;
      word-wrap: break-word;
      max-height: 500px;
      overflow: hidden;
    }
    .email-attachments {
      margin-top: 6px;
      font-size: 8pt;
      color: #6b7280;
    }
    .notes {
      background: #fef3c7;
      padding: 12px;
      border-radius: 6px;
      border-left: 3px solid #f59e0b;
      margin-top: 12px;
    }
    .notes-title { font-weight: 600; color: #92400e; margin-bottom: 4px; font-size: 9pt; }
    .notes-content { color: #78350f; font-size: 9pt; white-space: pre-wrap; }
    .page-break { page-break-before: always; }
    .footer {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      font-size: 8pt;
      color: #9ca3af;
      text-align: center;
    }
    .footer-line { margin-bottom: 2px; }
    .no-data { color: #9ca3af; font-style: italic; font-size: 9pt; padding: 12px 0; }
  </style>
</head>
<body>

  <!-- PAGE 1: ORDER TICKET -->
  <div class="header">
    <div>
      <img src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png" alt="Amberlake Partners" style="height: 36px; object-fit: contain;" />
      <div class="doc-title">Order Audit Trail</div>
    </div>
    <div class="order-info">
      <div class="order-ref">${order.orderReference}</div>
      <div class="order-date">${orderDate}</div>
      <div class="order-type">${(order.assetType === 'term_deposit' ? OrderFormatters.orderDirectionLabel(order) : (order.orderType || '')).toUpperCase()}</div>
    </div>
  </div>

  <div class="section">
    <h2>Account Information</h2>
    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Account Name</span>
        <span class="info-value">${clientName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Bank</span>
        <span class="info-value">${bank?.name || 'N/A'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Account Number</span>
        <span class="info-value">${bankAccount?.accountNumber || order.portfolioCode || 'N/A'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Reference Currency</span>
        <span class="info-value">${bankAccount?.referenceCurrency || order.currency}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Created By</span>
        <span class="info-value">${createdByName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-value">${OrderFormatters.getStatusLabel(order.status)}</span>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>${instrumentSectionHeading(order)}</h2>
    <div class="info-grid">
      <div class="info-row full-width">
        <span class="info-label">${hasRealIsin(order) ? 'Security Name' : 'Description'}</span>
        <span class="info-value">${order.securityName || 'N/A'}</span>
      </div>
      ${hasRealIsin(order) ? `
      <div class="info-row">
        <span class="info-label">ISIN</span>
        <span class="info-value">${order.isin}</span>
      </div>
      ` : ''}${optionDetailRowsHtml(order)}
      ${order.coverageCheck ? `
      <div class="info-row full-width">
        <span class="info-label">Cover at entry</span>
        <span class="info-value">${order.coverageCheck.isCovered
          ? `Covered - ${OrderFormatters.formatQuantity(order.coverageCheck.heldShares)} shares held`
          : `UNCOVERED - short by ${OrderFormatters.formatQuantity(order.coverageCheck.shortfallShares)} shares${order.coverageCheck.justification ? ` (reason: ${order.coverageCheck.justification})` : ''}`}</span>
      </div>
      ` : ''}
      <div class="info-row">
        <span class="info-label">Asset Type</span>
        <span class="info-value">${OrderFormatters.getAssetTypeLabel(order.assetType)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Currency</span>
        <span class="info-value">${order.currency}</span>
      </div>
      ${order.assetType === 'fx' && order.fxPair ? `
      <div class="info-row">
        <span class="info-label">FX Pair</span>
        <span class="info-value">${order.fxPair}</span>
      </div>
      ` : ''}
    </div>
  </div>

  <div class="section">
    <h2>Order Details</h2>
    <div class="highlight">
      <div class="highlight-row">
        <span class="highlight-label">Order Type</span>
        <span class="highlight-value">${OrderFormatters.orderDirectionLabel(order)}</span>
      </div>
      <div class="highlight-row">
        <span class="highlight-label">${quantityLabelFor(order)}</span>
        <span class="highlight-value">${order.assetType === 'fx' ? `${OrderFormatters.formatFxAmount(order.quantity, order.fxAmountCurrency)} ${order.fxAmountCurrency || ''}`.trim() : OrderFormatters.formatQuantity(order.quantity)}</span>
      </div>
      ${order.assetType === 'structured_product' ? `
        ${order.limitPrice ? `
        <div class="highlight-row">
          <span class="highlight-label">Price</span>
          <span class="highlight-value">${Number(order.limitPrice).toFixed(2)}%</span>
        </div>
        ` : ''}
      ` : order.assetType === 'term_deposit' ? '' : `
        <div class="highlight-row">
          <span class="highlight-label">Price Type</span>
          <span class="highlight-value">${OrderFormatters.getPriceTypeLabel(order.priceType)}</span>
        </div>
        ${order.priceType !== 'market' && order.limitPrice ? `
        <div class="highlight-row">
          <span class="highlight-label">${OrderFormatters.getPriceTypeLabel(order.priceType)} Price</span>
          <span class="highlight-value">${OrderFormatters.formatWithCurrency(order.limitPrice, order.currency)}</span>
        </div>
        ` : ''}
        ${order.validityType ? `
        <div class="highlight-row">
          <span class="highlight-label">Validity</span>
          <span class="highlight-value">${order.validityType === 'gtc' ? 'Good Till Canceled' : order.validityType === 'gtd' ? `Good Till ${order.validityDate ? OrderFormatters.formatDate(order.validityDate) : 'Date'}` : 'Day Order'}</span>
        </div>
        ` : ''}
      `}
      ${order.broker ? `
      <div class="highlight-row">
        <span class="highlight-label">Broker</span>
        <span class="highlight-value">${order.broker}</span>
      </div>
      ` : ''}
      ${order.estimatedValue ? `
      <div class="highlight-row">
        <span class="highlight-label">Estimated Value</span>
        <span class="highlight-value">${OrderFormatters.formatWithCurrency(order.estimatedValue, order.currency)}</span>
      </div>
      ` : ''}
    </div>

    ${order.executedAt ? `
    <div class="execution-box">
      <div class="highlight-row">
        <span class="highlight-label">Execution Status</span>
        <span class="highlight-value" style="color: #10b981;">EXECUTED</span>
      </div>
      ${order.executedQuantity ? `
      <div class="highlight-row">
        <span class="highlight-label">Executed Quantity</span>
        <span class="highlight-value" style="color: #10b981;">${OrderFormatters.formatQuantity(order.executedQuantity)}</span>
      </div>
      ` : ''}
      ${order.executedPrice ? `
      <div class="highlight-row">
        <span class="highlight-label">Executed Price</span>
        <span class="highlight-value" style="color: #10b981;">${OrderFormatters.formatWithCurrency(order.executedPrice, order.currency)}</span>
      </div>
      ` : ''}
      ${order.executionDate ? `
      <div class="highlight-row">
        <span class="highlight-label">Execution Date</span>
        <span class="highlight-value" style="color: #10b981;">${OrderFormatters.formatDate(order.executionDate)}</span>
      </div>
      ` : ''}
    </div>
    ` : ''}
  </div>

  <!-- Notes excluded from bank PDF — kept in audit trail only -->

  <!-- PAGE 2: AUDIT TIMELINE -->
  <div class="page-break"></div>
  <div class="header">
    <div>
      <img src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png" alt="Amberlake Partners" style="height: 36px; object-fit: contain;" />
      <div class="doc-title">Order Audit Trail</div>
    </div>
    <div class="order-info">
      <div class="order-ref">${order.orderReference}</div>
      <div class="order-date">Status: ${OrderFormatters.getStatusLabel(order.status)}</div>
    </div>
  </div>

  <div class="section">
    <h2>Order Lifecycle — Audit Trail</h2>
    ${timeline.length > 0 ? `
    <table class="timeline-table">
      <thead>
        <tr>
          <th style="width: 18%;">Date / Time</th>
          <th style="width: 25%;">Event</th>
          <th style="width: 20%;">By</th>
          <th style="width: 37%;">Details</th>
        </tr>
      </thead>
      <tbody>
        ${timeline.map(entry => {
          let badgeClass = 'event-created';
          const evt = entry.event.toLowerCase();
          if (evt.includes('validated') || evt.includes('executed')) badgeClass = 'event-executed';
          else if (evt.includes('rejected') || evt.includes('cancelled')) badgeClass = 'event-rejected';
          else if (evt.includes('modified')) badgeClass = 'event-modified';
          else if (evt.includes('transmitted')) badgeClass = 'event-transmitted';
          else if (evt.includes('email sent')) badgeClass = 'event-sent';
          else if (evt.includes('document')) badgeClass = 'event-document';
          else if (evt.includes('warning')) badgeClass = 'event-warning';
          else if (evt.includes('termsheet')) badgeClass = 'event-termsheet';

          return `
        <tr>
          <td>${OrderFormatters.formatDateTime(entry.date)}</td>
          <td><span class="event-badge ${badgeClass}">${entry.event}</span></td>
          <td>${entry.by || '—'}</td>
          <td>${entry.details || '—'}</td>
        </tr>`;
        }).join('')}
      </tbody>
    </table>
    ` : '<div class="no-data">No lifecycle events recorded.</div>'}
  </div>

  <!-- PAGE 3: ATTACHED DOCUMENTS -->
  ${sortedTraces.length > 0 ? `
  <div class="page-break"></div>
  <div class="header">
    <div>
      <img src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png" alt="Amberlake Partners" style="height: 36px; object-fit: contain;" />
      <div class="doc-title">Order Audit Trail</div>
    </div>
    <div class="order-info">
      <div class="order-ref">${order.orderReference}</div>
      <div class="order-date">Attached Documents</div>
    </div>
  </div>

  <div class="section">
    <h2>Attached Documents</h2>
    ${sortedTraces.map(trace => {
      const parsed = parsedTraces[trace._id];
      const isEmail = parsed?.type === 'email';
      const isPdf = parsed?.type === 'pdf';
      const isHtml = parsed?.type === 'html';
      const hasContent = isEmail || ((isPdf || isHtml) && parsed?.text);

      // Escape HTML entities in text content for safe embedding
      const escapeHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      return `
    <div class="trace-card">
      <div class="trace-type">${EMAIL_TRACE_LABELS[trace.traceType] || trace.traceType}</div>
      <div class="trace-filename">${trace.fileName || 'Unknown file'}</div>
      <div class="trace-meta">
        Uploaded: ${OrderFormatters.formatDateTime(trace.uploadedAt)}
        ${trace.uploadedByName ? ` · By: ${trace.uploadedByName}` : ''}
      </div>
      ${isEmail ? `
      <div class="email-header">
        <div class="email-header-row"><span class="email-header-label">From:</span> ${escapeHtml(parsed.from)}</div>
        <div class="email-header-row"><span class="email-header-label">To:</span> ${escapeHtml(parsed.to)}</div>
        ${parsed.cc ? `<div class="email-header-row"><span class="email-header-label">Cc:</span> ${escapeHtml(parsed.cc)}</div>` : ''}
        <div class="email-header-row"><span class="email-header-label">Subject:</span> ${escapeHtml(parsed.subject)}</div>
        <div class="email-header-row"><span class="email-header-label">Date:</span> ${parsed.date ? OrderFormatters.formatDateTime(parsed.date) : 'N/A'}</div>
      </div>
      <div class="email-body">${escapeHtml(parsed.text).substring(0, 5000)}</div>
      ${parsed.hasAttachments ? `<div class="email-attachments">Attachments: ${parsed.attachmentNames.join(', ')}</div>` : ''}
      ` : ''}
      ${(isPdf || isHtml) && parsed?.text ? `
      <div class="email-body">${escapeHtml(parsed.text).substring(0, 5000)}</div>
      ` : ''}
      ${parsed?.error ? `<div class="trace-meta" style="margin-top: 6px; font-style: italic;">${escapeHtml(parsed.error)}</div>` : ''}
    </div>`;
    }).join('')}
  </div>
  ` : ''}

  <div class="footer">
    <div class="footer-line">Audit Trail generated by Ambervision Platform — ${OrderFormatters.formatDateTime(new Date())}</div>
    <div class="footer-line">This document is for internal compliance and record-keeping purposes.</div>
  </div>
</body>
</html>
  `;
}

/**
 * Additional helper methods for orders
 */
Meteor.methods({
  /**
   * Get clients list for order creation (RM sees their clients, Admin sees all)
   */
  async 'users.getClients'({ sessionId }) {
    check(sessionId, String);

    const { user } = await validateSession(sessionId);

    if (!OrderHelpers.canPlaceOrders(user.role)) {
      throw new Meteor.Error('not-authorized', 'Only RMs and Admins can access client list');
    }

    let query = { role: 'client' };

    // RMs/Assistants only see their assigned clients
    if (user.role === 'rm' || user.role === 'assistant') {
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      query.relationshipManagerId = { $in: rmIds };
    }
    // Admins and superadmins see all clients

    const users = await UsersCollection.find(query, {
      fields: {
        _id: 1,
        username: 1,
        profile: 1,
        role: 1
      },
      sort: { 'profile.lastName': 1, 'profile.firstName': 1 }
    }).fetchAsync();

    // Also return client entities (new entity-based architecture). Some clients
    // exist only as ClientEntities with no legacy user account — those need to
    // appear here so the Order Modal's post-selection lookups (availableClients.find)
    // resolve to a real display name instead of "N/A".
    const { ClientEntitiesCollection: EntCol, ClientEntityHelpers } = require('../../imports/api/clientEntities.js');
    let entityCursor;
    if (user.role === 'rm' || user.role === 'assistant') {
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      entityCursor = ClientEntityHelpers.getEntitiesByRMs(rmIds);
    } else {
      entityCursor = ClientEntityHelpers.getAllEntities();
    }
    // Archived (closed) relationships are not clients any more: they must not be
    // selectable for a new order, nor clutter the blotter's client filter. Every
    // other client-facing read path already excludes them (holdings, products,
    // RM dashboard, View As picker); this list was the one that did not, which is
    // why resigned clients kept showing up in the filter. Their existing orders
    // stay visible in the blotter under "All Clients".
    const entitiesInScope = await entityCursor.fetchAsync();
    const entities = entitiesInScope.filter(e => !ClientEntityHelpers.isEntityArchived(e));
    const archivedEntityIds = new Set(
      entitiesInScope.filter(e => ClientEntityHelpers.isEntityArchived(e)).map(e => e._id)
    );

    // Collapse legacy user accounts into the entity that replaced them. Only one
    // entity ever got its migratedFromUserId stamped during the migration, so
    // relying on that field alone listed most clients twice — often under two
    // spellings ("baloise" / "BALOISE", "Aurelia" / "Aurelia"). The shared
    // resolver corroborates the migration's bank-account stamps against the
    // names; see ClientEntityHelpers.getLegacyUserEntityLinks().
    const legacyLinks = await ClientEntityHelpers.getLegacyUserEntityLinks();
    const entityIdsInScope = new Set(entities.map(e => e._id));
    const legacyIdsByEntity = new Map();
    for (const [userId, entityId] of legacyLinks) {
      if (!entityIdsInScope.has(entityId)) continue;
      if (!legacyIdsByEntity.has(entityId)) legacyIdsByEntity.set(entityId, []);
      legacyIdsByEntity.get(entityId).push(userId);
    }

    const mappedEntities = entities.map(e => ({
      _id: e._id,
      username: ClientEntityHelpers.getEntityDisplayName(e),
      displayName: ClientEntityHelpers.getEntityDisplayName(e),
      profile: {
        ...(e.profile || {}),
        clientType: e.type === 'company' ? 'company' : 'individual'
      },
      role: 'client',
      entityId: e._id,
      migratedFromUserId: e.migratedFromUserId || null,
      // Every id this client's records may be filed under, so callers can query
      // across the entity and the legacy accounts it absorbed.
      linkedClientIds: [...new Set([
        e._id,
        ...(legacyIdsByEntity.get(e._id) || []),
        ...(e.migratedFromUserId ? [e.migratedFromUserId] : [])
      ])]
    }));

    // A legacy user is dropped when its canonical entity is in this caller's
    // scope, or when that entity is archived. Scoping matters so an RM whose
    // client was reassigned to another RM's entity does not lose the client from
    // their list; the archived case matters because the entity has just been
    // filtered out above — without it, a closed relationship would walk straight
    // back into the list through its legacy login.
    const filteredUsers = users
      .filter(u => {
        const linkedEntityId = legacyLinks.get(u._id);
        if (!linkedEntityId) return true;
        return !(entityIdsInScope.has(linkedEntityId) || archivedEntityIds.has(linkedEntityId));
      })
      .map(u => ({
        ...u,
        // Company logins carry their name on profile.companyName, with the
        // first/last name fields left empty — without this the list fell back to
        // the raw username and showed "baloise" instead of the company name.
        displayName: (
          (u.profile?.clientType === 'company' && u.profile?.companyName)
            ? u.profile.companyName
            : (`${u.profile?.firstName || ''} ${u.profile?.lastName || ''}`.trim()
              || u.profile?.companyName
              || u.username)
        ),
        linkedClientIds: [u._id]
      }));

    return [...filteredUsers, ...mappedEntities];
  },

  /**
   * Get bank accounts for a specific client
   */
  async 'bankAccounts.getForClient'({ clientId }, sessionId) {
    check(clientId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);

    if (!OrderHelpers.canPlaceOrders(user.role)) {
      throw new Meteor.Error('not-authorized', 'Only RMs and Admins can access bank accounts');
    }

    // Verify access to client (supports both user IDs and entity IDs)
    if (user.role === 'rm' || user.role === 'assistant') {
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      const client = await UsersCollection.findOneAsync(clientId);
      if (client) {
        if (!rmIds.includes(client.relationshipManagerId)) {
          throw new Meteor.Error('not-authorized', 'You do not have access to this client');
        }
      } else {
        const { ClientEntitiesCollection: EntCol } = require('../../imports/api/clientEntities.js');
        const entity = await EntCol.findOneAsync({ $or: [{ _id: clientId }, { migratedFromUserId: clientId }], isActive: true });
        if (!entity || !rmIds.includes(entity.relationshipManagerId)) {
          throw new Meteor.Error('not-authorized', 'You do not have access to this client');
        }
      }
    }

    // Find accounts by userId OR entityId (supports both legacy users and entity-based clients)
    const accounts = await BankAccountsCollection.find({
      $or: [{ userId: clientId }, { entityId: clientId }],
      isActive: true
    }).fetchAsync();

    // Enrich with bank names and beneficiary info
    const client = await UsersCollection.findOneAsync(clientId);
    const isCompany = client?.profile?.clientType === 'company';
    const clientDisplayName = isCompany && client?.profile?.companyName
      ? client.profile.companyName
      : `${client?.profile?.firstName || ''} ${client?.profile?.lastName || ''}`.trim() || '';

    const enrichedAccounts = await Promise.all(accounts.map(async (account) => {
      const bank = await BanksCollection.findOneAsync(account.bankId);
      // For life insurance: beneficiary is the client (the person the policy is for)
      // For companies: show the beneficial owner from stakeholders if available
      let beneficiary = null;
      if (account.accountStructure === 'life_insurance' || account.accountType === 'life_insurance') {
        beneficiary = clientDisplayName;
      } else if (isCompany && client?.profile?.stakeholders?.length > 0) {
        const owners = client.profile.stakeholders
          .filter(s => s.role === 'beneficial_owner' || s.role === 'director')
          .map(s => `${s.firstName || ''} ${s.lastName || ''}`.trim())
          .filter(Boolean);
        if (owners.length > 0) beneficiary = owners.join(', ');
      }
      return {
        ...account,
        bankName: bank?.name || 'Unknown Bank',
        beneficiary
      };
    }));

    return enrichedAccounts;
  },

  /**
   * Get holdings for a specific bank account (for sell order selection)
   */
  async 'orders.getAccountHoldings'({ clientId, bankAccountId }, sessionId) {
    check(clientId, String);
    check(bankAccountId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);

    if (!OrderHelpers.canPlaceOrders(user.role)) {
      throw new Meteor.Error('not-authorized', 'Not authorized to access holdings');
    }

    // Resolve client: supports both user IDs and entity IDs
    const resolved = await resolveClientId(clientId);

    // Verify access to client
    if (user.role === 'rm' || user.role === 'assistant') {
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!rmIds.includes(resolved.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You do not have access to this client');
      }
    }

    // Get the bank account to find portfolioCode
    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    if (!bankAccount) {
      return [];
    }

    return findAccountHoldings(resolved, bankAccount);
  },

  /**
   * Orders already raised on the same security in the same account, shown by
   * the order modal before a new one is placed: every order still open (from
   * pending validation to partially executed) and every non-cancelled order of
   * the last RECENT_ORDER_DAYS days. Two uses:
   * - a duplicate warning: the same instruction entered twice gets executed twice;
   * - for a sell, the quantity already committed to other sells, which the bank
   *   file does not reflect yet (open orders, and executions after the file date).
   */
  async 'orders.getRelatedForPosition'({ clientId, bankAccountId, isin, holdingId }, sessionId) {
    check(clientId, String);
    check(bankAccountId, String);
    check(isin, String);
    check(holdingId, Match.Maybe(String));
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    if (!OrderHelpers.canPlaceOrders(user.role)) {
      throw new Meteor.Error('not-authorized', 'Not authorized to access orders');
    }

    const resolved = await resolveClientId(clientId);
    if (user.role === 'rm' || user.role === 'assistant') {
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!rmIds.includes(resolved.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You do not have access to this client');
      }
    }

    if (!isin || isPlaceholderIsin(isin)) {
      return { orders: [], sellCommittedQuantity: 0, sellCommittedQuantityFormatted: null, recentDays: RECENT_ORDER_DAYS };
    }

    const OPEN_STATUSES = [
      ORDER_STATUSES.PENDING_VALIDATION, ORDER_STATUSES.PENDING, ORDER_STATUSES.PENDING_MODIFICATION,
      ORDER_STATUSES.REVISION_REQUESTED, ORDER_STATUSES.TRANSMITTED, ORDER_STATUSES.SENT,
      ORDER_STATUSES.PARTIALLY_EXECUTED
    ];
    const since = new Date(Date.now() - RECENT_ORDER_DAYS * 24 * 60 * 60 * 1000);

    const orders = await OrdersCollection.find({
      bankAccountId,
      isin,
      status: { $nin: [ORDER_STATUSES.DRAFT, ...TERMINAL_ORDER_STATUSES] },
      $or: [{ status: { $in: OPEN_STATUSES } }, { createdAt: { $gte: since } }]
    }, { sort: { createdAt: -1 }, limit: 50 }).fetchAsync();

    // Executions dated after the position's file date are not in its quantity yet
    let fileDate = null;
    if (holdingId) {
      const holding = await PMSHoldingsCollection.findOneAsync(holdingId, { fields: { snapshotDate: 1, fileDate: 1 } });
      const d = holding?.snapshotDate || holding?.fileDate;
      fileDate = d ? new Date(d) : null;
    }

    let sellCommittedQuantity = 0;
    const rows = orders.map(order => {
      const isOpen = OPEN_STATUSES.includes(order.status);
      const executed = Number(order.executedQuantity) || (order.status === ORDER_STATUSES.EXECUTED ? Number(order.quantity) || 0 : 0);
      const executedAfterFile = executed > 0 && order.executionDate
        && (!fileDate || new Date(order.executionDate) > fileDate);
      const committed = (isOpen ? remainingOrderQuantity(order) : 0) + (executedAfterFile ? executed : 0);
      if (order.orderType === 'sell') sellCommittedQuantity += committed;

      const f = OrderFormatters.formatOrderDetails(order);
      return {
        _id: order._id,
        orderReference: order.orderReference,
        orderType: order.orderType,
        quantityFormatted: f.quantityFormatted,
        priceText: f.restingLabel || (order.limitPrice != null ? `Limit ${f.limitPriceFormatted || order.limitPrice}` : 'Market'),
        statusLabel: f.statusLabel,
        createdAtFormatted: f.createdAtFull,
        createdByName: order.createdByName || null,
        isOpen,
        notInBankFile: !!executedAfterFile
      };
    });

    return {
      orders: rows,
      sellCommittedQuantity,
      sellCommittedQuantityFormatted: sellCommittedQuantity > 0 ? OrderFormatters.formatQuantity(sellCommittedQuantity) : null,
      recentDays: RECENT_ORDER_DAYS
    };
  },

  /**
   * Short-call cover, computed NOW.
   *
   * Two callers, two reasons. The order modal calls it once before confirming,
   * to pick up contracts already written by other live orders - netting the
   * client cannot see. The validation blotter calls it when a short call is
   * opened for review, because bank files land between entry and validation and
   * can flip the answer; the validator needs today's picture next to the
   * snapshot taken when the desk raised it.
   *
   * Pass `excludeOrderId` when re-checking an existing order so it doesn't
   * count its own contracts against itself.
   */
  /**
   * The listed-option chain for an underlying, for the order entry screen.
   *
   * Resolves the underlying to its US listing first (the search often hands
   * back an LSE or XETRA line for a US name), then loads the EOD chain. Returns
   * { available: false, reason } - never throws for "no options here" - so the
   * modal can fall back to typed contract entry for Eurex/Euronext names.
   */
  async 'orders.getOptionChain'({ underlyingTicker, underlyingIsin, sessionId }) {
    check(underlyingTicker, Match.Maybe(String));
    check(underlyingIsin, Match.Maybe(String));
    check(sessionId, String);
    this.unblock();

    const { user } = await validateSession(sessionId);
    if (!OrderHelpers.canPlaceOrders(user.role)) {
      throw new Meteor.Error('not-authorized', 'Not authorized to load option chains');
    }

    const symbol = await EODApiHelpers.resolveUsOptionsSymbol({ ticker: underlyingTicker, isin: underlyingIsin });
    if (!symbol) {
      return { available: false, reason: 'No US listing for this underlying - the option feed covers US-listed contracts only' };
    }
    return EODApiHelpers.getOptionsChain(symbol);
  },

  async 'orders.checkShortCallCoverage'({ clientId, bankAccountId, underlyingIsin, underlyingName, contracts, contractSize, excludeOrderId, sessionId }) {
    check(clientId, String);
    check(bankAccountId, String);
    check(underlyingIsin, String);
    check(underlyingName, Match.Maybe(String));
    check(contracts, Number);
    check(contractSize, Match.Maybe(Number));
    check(excludeOrderId, Match.Maybe(String));
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    if (!OrderHelpers.canPlaceOrders(user.role)) {
      throw new Meteor.Error('not-authorized', 'Not authorized to access position data');
    }

    const resolved = await resolveClientId(clientId);

    if (user.role === 'rm' || user.role === 'assistant') {
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!rmIds.includes(resolved.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You do not have access to this client');
      }
    }

    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    if (!bankAccount) return null;

    return resolveShortCallCoverage({
      resolved,
      bankAccount,
      order: {
        quantity: contracts,
        optionContractSize: contractSize || DEFAULT_OPTION_CONTRACT_SIZE,
        optionUnderlyingIsin: underlyingIsin,
        optionUnderlyingName: underlyingName || null
      },
      excludeOrderId
    });
  },

  /**
   * Get cash balance for a specific bank account
   */
  async 'orders.getAccountCashBalance'({ clientId, bankAccountId }, sessionId) {
    check(clientId, String);
    check(bankAccountId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);

    if (!OrderHelpers.canPlaceOrders(user.role)) {
      throw new Meteor.Error('not-authorized', 'Not authorized to access cash data');
    }

    // Resolve client: supports both user IDs and entity IDs
    const resolved = await resolveClientId(clientId);

    // Verify RM access
    if (user.role === 'rm' || user.role === 'assistant') {
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!rmIds.includes(resolved.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You do not have access to this client');
      }
    }

    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    if (!bankAccount) {
      return { cashBalance: null, currency: null };
    }

    // Load the account's holdings and classify them with the SAME predicates the
    // PMS cash monitor uses. This used to select cash with a name regex
    // (/cash|liquidity|compte|konto/), which counted an "Amundi Euro
    // Liquidity-Rated" money-market fund as cash: the modal showed a second,
    // positive EUR line of 1.5M next to the real -400,970.09 balance, and the
    // two never matched the PMS.
    const portfolioRegex = new RegExp('^' + bankAccount.accountNumber.split('-')[0]);
    const accountQuery = {
      isActive: true,
      isLatest: true,
      portfolioCode: { $regex: portfolioRegex }
    };
    // Try with userId first
    let accountHoldings = await PMSHoldingsCollection.find({ ...accountQuery, userId: resolved.holdingsUserId }).fetchAsync();
    let scope = { userId: resolved.holdingsUserId };
    // If no results, try with bankId + portfolioCode only (entity-based accounts)
    if (accountHoldings.length === 0) {
      accountHoldings = await PMSHoldingsCollection.find({ ...accountQuery, bankId: bankAccount.bankId }).fetchAsync();
      scope = { bankId: bankAccount.bankId };
    }

    // Holdings whose own fields say nothing are classified from securities
    // metadata, exactly as the cash monitor does.
    const heldIsins = accountHoldings.map(h => h.isin).filter(Boolean);
    const cashEquivalentMetadata = heldIsins.length > 0
      ? await SecuritiesMetadataCollection.find({
        isin: { $in: heldIsins },
        assetClass: { $in: ['monetary_products', 'time_deposit'] }
      }, { fields: { isin: 1 } }).fetchAsync()
      : [];
    const cashEquivalentISINs = new Set(cashEquivalentMetadata.map(m => m.isin));

    const cashHoldings = accountHoldings.filter(h => isPureCashHolding(h));
    // Near-cash: liquidity the client really has, but which has to be sold
    // before it can settle anything. Reported separately, never added to cash.
    const nearCashHoldings = accountHoldings.filter(
      h => !isPureCashHolding(h) && isCashEquivalentHolding(h, cashEquivalentISINs)
    );

    // `marketValue` is stored in the portfolio's reference currency, NOT in the
    // position's own currency (a CHF account holding 291.91 CHF is stored with
    // marketValue = 313.82 when the portfolio reference is EUR). Each cash line
    // must be shown in its own currency — unconverted — so read the native
    // figure from marketValueOriginalCurrency, falling back to the account
    // balance for records written before that field existed.
    const nativeAmount = (h) => {
      if (typeof h.marketValueOriginalCurrency === 'number') return h.marketValueOriginalCurrency;
      if (typeof h.balance === 'number') return h.balance;
      if (typeof h.quantity === 'number') return h.quantity;
      return h.marketValue || 0;
    };

    // Consolidated total stays in the reference currency — it is the only figure
    // here that is a cross-currency roll-up, and it is labelled as such.
    const totalCash = cashHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
    const currency = bankAccount.referenceCurrency || cashHoldings[0]?.currency || 'EUR';

    /**
     * One row per currency, like the PMS Cash Balances panel. Two cash lines in
     * the same currency (a current account and a savings account, say) are one
     * balance to whoever is placing the order, not two.
     */
    const aggregateByCurrency = (holdings) => {
      const byCurrency = new Map();
      for (const h of holdings) {
        const ccy = h.currency || currency;
        const row = byCurrency.get(ccy) || { currency: ccy, amount: 0, names: [] };
        row.amount += nativeAmount(h);
        if (h.securityName) row.names.push(h.securityName);
        byCurrency.set(ccy, row);
      }
      return [...byCurrency.values()].map(row => ({
        currency: row.currency,
        amount: row.amount,
        name: row.names.length === 1 ? row.names[0] : null,
        names: row.names
      }));
    };

    const cashPositions = aggregateByCurrency(cashHoldings);
    const nearCashPositions = aggregateByCurrency(nearCashHoldings);

    // Show a zero row for every currency in which the portfolio has any holding
    // but no cash position — makes the absence of cash explicit rather than hiding it.
    const portfolioCurrencies = new Set(accountHoldings.map(h => h.currency).filter(Boolean));
    const cashCurrencies = new Set(cashPositions.map(p => p.currency));
    for (const ccy of portfolioCurrencies) {
      if (!cashCurrencies.has(ccy)) {
        cashPositions.push({ currency: ccy, amount: 0, name: null });
      }
    }
    cashPositions.sort((a, b) => {
      if ((a.amount > 0) !== (b.amount > 0)) return a.amount > 0 ? -1 : 1;
      return (a.currency || '').localeCompare(b.currency || '');
    });

    nearCashPositions.sort((a, b) => (a.currency || '').localeCompare(b.currency || ''));

    return {
      cashBalance: totalCash,
      currency,
      cashPositions,
      // Money market funds / term deposits, kept apart from cash on purpose.
      nearCashPositions
    };
  },

  /**
   * Look up product info by ISIN (for auto-filling order fields)
   */
  async 'orders.getProductByIsin'({ isin }, sessionId) {
    check(isin, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    if (!OrderHelpers.canPlaceOrders(user.role)) {
      return null;
    }

    const product = await ProductsCollection.findOneAsync(
      { isin: { $regex: new RegExp('^' + isin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i') } },
      { fields: { title: 1, isin: 1, issuer: 1, currency: 1, denomination: 1, templateId: 1, structureParams: 1, structureParameters: 1, structure: 1 } }
    );

    if (!product) return null;

    return {
      name: product.title,
      isin: product.isin,
      issuer: product.issuer || '',
      currency: product.currency || '',
      denomination: product.denomination || null,
      // null when the record gives nothing to classify from
      capitalProtected: isProductCapitalProtected(product)
    };
  },

  /**
   * Check allocation impact of a buy order against investment profile limits
   * Returns current vs projected allocation and any breaches (warning only)
   */
  async 'orders.checkAllocationImpact'({ bankAccountId, clientId, assetType, estimatedValue, orderType, capitalProtected, sessionId }) {
    check(bankAccountId, String);
    check(clientId, String);
    check(assetType, String);
    check(estimatedValue, Match.Maybe(Number));
    check(orderType, String);
    check(capitalProtected, Match.Maybe(Boolean));
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    if (!OrderHelpers.canPlaceOrders(user.role)) {
      throw new Meteor.Error('not-authorized', 'Not authorized');
    }

    // Skip check for sell orders
    if (orderType === 'sell') {
      return { hasBreaches: false };
    }

    // Skip if no estimated value
    if (!estimatedValue) {
      return { hasBreaches: false, noEstimate: true };
    }

    return await checkAllocationImpact({
      bankAccountId,
      clientId,
      assetType,
      estimatedValue,
      capitalProtected: !!capitalProtected
    });
  }
});
