import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import fs from 'fs';
import path from 'path';
import { Random } from 'meteor/random';
import { SessionsCollection, SessionHelpers } from '../../imports/api/sessions.js';
import { issueDocumentToken } from '../documentAccess.js';
import { generatePDFFromHTML } from '../helpers/pdfHelper.js';
import { UsersCollection, UserHelpers } from '../../imports/api/users.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { ProductsCollection } from '../../imports/api/products.js';
import { PMSOperationsCollection } from '../../imports/api/pmsOperations.js';
import { OrdersCollection, ORDER_STATUSES, ASSET_TYPES, PRICE_TYPES, TRADE_MODES, TERMSHEET_STATUSES, EMAIL_TRACE_TYPES, EMAIL_TRACE_LABELS, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, TERMSHEET_EVIDENCE_TYPES, FX_SUBTYPES, TERM_DEPOSIT_TENORS, EXECUTION_TYPE_LABELS, OrderHelpers, OrderFormatters } from '../../imports/api/orders.js';
import { AuditLog } from '/imports/api/auditLog';
import { OrderCountersCollection, OrderCounterHelpers } from '../../imports/api/orderCounters.js';
import { EmailService, EMAIL, emailShell, emailKvTable, emailParagraph, emailButton } from '../../imports/api/emailService.js';
import { AccountProfilesCollection, aggregateToFourCategories, getBreakdownKeyForAssetType, mapOrderAssetTypeToProfileCategory, getProfileName } from '../../imports/api/accountProfiles.js';
import { SecuritiesMetadataCollection } from '../../imports/api/securitiesMetadata.js';
import { IssuersCollection } from '../../imports/api/issuers.js';

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
  EMAIL_TRACE_TYPES.INITIAL_TERMSHEET
];

const creationAttachmentPattern = Match.Maybe([{
  traceType: Match.Where(x => CREATION_TRACE_TYPES.includes(x)),
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
  const profile = await AccountProfilesCollection.findOneAsync({ bankAccountId });
  if (!profile) {
    return { hasProfile: false, hasBreaches: false };
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

  investmentHoldings.forEach(h => {
    let holdingAssetClass = 'other';
    let subClass = null;
    let underlyingType = null;
    let protectionType = null;

    // Priority 1: metadata
    if (h.isin && metadataMap[h.isin]) {
      const metadata = metadataMap[h.isin];
      if (metadata.assetClass) {
        holdingAssetClass = metadata.assetClass;
        subClass = metadata.assetSubClass;
        underlyingType = metadata.structuredProductUnderlyingType;
        protectionType = metadata.structuredProductProtectionType;
      }
    }

    // Priority 2: holding's own assetClass
    if (holdingAssetClass === 'other' && h.assetClass) {
      holdingAssetClass = h.assetClass;
      if (h.bankSpecificData) {
        underlyingType = h.bankSpecificData.structuredProductUnderlyingType || underlyingType;
        protectionType = h.bankSpecificData.structuredProductProtectionType || protectionType;
      }
    }

    // Priority 3: heuristic detection
    if (holdingAssetClass === 'other') {
      const type = String(h.securityType || '').trim().toLowerCase();
      const name = (h.securityName || '').toLowerCase();

      const isStructuredByType = type === 'certificate' || type === 'structured' || type === '19';
      const isStructuredByIssuer = name.includes('sg issuer') || name.includes('julius baer express') ||
          name.includes('bnp paribas iss') || name.includes('raiffeisen ch') ||
          name.includes('banque intern') || name.includes('credit suisse ag') ||
          name.includes('credit agricole') || name.includes('citigroup') ||
          name.includes('ubs ag') || name.includes('vontobel');
      const isStructuredByName = name.includes('autocallable') || name.includes('phoenix') ||
          name.includes('orion') || name.includes('himalaya') || name.includes('reverse convertible') ||
          name.includes('bar.cap') || name.includes('barrier') || name.includes('express') ||
          name.includes('cap.prot') || name.includes('capital prot') ||
          (name.includes('cert') && !name.includes('certificate of deposit'));

      if (isStructuredByType || isStructuredByIssuer || isStructuredByName) {
        holdingAssetClass = 'structured_product';
        if (name.includes('capital guaranteed') || name.includes('cap.prot') ||
            name.includes('capital protection') || name.includes('100%')) {
          protectionType = 'capital_guaranteed_100';
        } else if (name.includes('bar.cap') || name.includes('barrier')) {
          protectionType = 'capital_protected_conditional';
        }
      } else if (type === '13' || name.includes('private equity') || name.includes('schroders capital') ||
          name.includes('kkr') || name.includes('blackstone')) {
        holdingAssetClass = 'private_equity';
      } else if (type === 'money_market_fund' || (name.includes('money market') && name.includes('fund'))) {
        holdingAssetClass = 'monetary_products';
      } else if (type === 'fund' || type === 'etf' || name.includes('sicav') || name.includes('ucits')) {
        holdingAssetClass = 'fund';
      } else if (type === '1' || type === 'equity' || type === 'stock') {
        holdingAssetClass = 'equity';
        if (name.includes('fund') || name.includes('etf')) subClass = 'equity_fund';
        else subClass = 'direct_equity';
      } else if (type === '2' || type === 'bond' || name.includes('treasury')) {
        holdingAssetClass = 'fixed_income';
        if (name.includes('fund')) subClass = 'fixed_income_fund';
        else subClass = 'direct_bond';
      } else if (type === 'cash') {
        holdingAssetClass = 'cash';
      } else if (type === 'term_deposit' || name.includes('term deposit') || name.includes('time deposit') || name.includes('fixed deposit')) {
        holdingAssetClass = 'time_deposit';
      } else if (name.includes('gold') || name.includes('commodity') || name.includes('metal')) {
        holdingAssetClass = 'commodities';
      }
    }

    // Build granular category key
    let categoryKey = holdingAssetClass;
    if (holdingAssetClass === 'structured_product') {
      if (protectionType === 'capital_guaranteed_100') {
        categoryKey = 'structured_product_capital_guaranteed';
      } else if (protectionType === 'capital_guaranteed_partial') {
        categoryKey = 'structured_product_partial_guarantee';
      } else if (protectionType === 'capital_protected_conditional') {
        // Equity-linked barrier-protected SPs still carry equity risk → Equities (mirrors PMS)
        categoryKey = (underlyingType === 'equity_linked')
          ? 'structured_product_equity_linked_barrier_protected'
          : 'structured_product_barrier_protected';
      } else if (underlyingType) {
        categoryKey = `structured_product_${underlyingType}`;
      }
    } else if (holdingAssetClass === 'equity' && subClass) {
      categoryKey = `equity_${subClass}`;
    } else if (holdingAssetClass === 'fixed_income' && subClass) {
      categoryKey = `fixed_income_${subClass}`;
    }

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

    // For SELL orders, validate position (skip for term deposit decreases)
    if (orderData.orderType === 'sell' && orderData.assetType !== ASSET_TYPES.TERM_DEPOSIT) {
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

    // Create order document
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
      estimatedValue: orderData.estimatedValue || null,
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
          { fields: { _id: 1, email: 1, username: 1, profile: 1 } }
        ).fetchAsync();
        const toList = recipientUsers
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
          const quantityLabel = isStructuredProduct ? 'Nominal' : (order.assetType === 'term_deposit' ? 'Amount' : 'Quantity');
          const priceDisplay = order.limitPrice
            ? (isStructuredProduct
                ? `${Number(order.limitPrice).toFixed(2)}%`
                : OrderFormatters.formatWithCurrency(order.limitPrice, order.currency))
            : null;
          const orderBookUrl = Meteor.absoluteUrl('#order-book');
          const subject = `[Pending Validation] ${orderReference} — ${order.securityName || ''}`.trim();
          const pendingRows = [
            ['Direction', String(OrderFormatters.orderDirectionLabel(order)).toUpperCase(), order.orderType === 'buy' ? EMAIL.success : EMAIL.danger],
            [order.assetType === 'term_deposit' || order.assetType === 'fx' ? 'Description' : 'Security', order.securityName || ''],
            ...(order.assetType === 'term_deposit' || order.assetType === 'fx' ? [] : [['ISIN', `<span style="font-family: Consolas, 'Courier New', monospace;">${order.isin || ''}</span>`]]),
            [quantityLabel, OrderFormatters.formatQuantity(order.quantity), EMAIL.amberText],
            ...(priceDisplay ? [['Price', priceDisplay]] : []),
            ...(order.estimatedValue ? [['Estimated Value', OrderFormatters.formatWithCurrency(order.estimatedValue, order.currency)]] : []),
            ...(order.broker ? [['Broker', order.broker]] : []),
            ['Client', order.clientName || ''],
            ['Account', accountLabel]
          ];
          const html = emailShell({
            title: 'Order Pending Validation',
            subtitle: orderReference,
            bodyHtml: `${emailParagraph(`${userDisplayName} just created an order that requires four-eyes validation. Please review it in the Orders blotter.`)}${emailKvTable(pendingRows)}${emailButton(orderBookUrl, 'Open Order Book →')}`,
            signatureName: userDisplayName,
            footerNote: 'This is an automated order notification. Please do not reply to this message.'
          });
          const text = `
Order Pending Validation: ${orderReference}

${userDisplayName} just created an order that requires four-eyes validation.

Direction: ${(order.orderType || '').toUpperCase()}
Security: ${order.securityName || ''}
ISIN: ${order.isin || ''}
${quantityLabel}: ${OrderFormatters.formatQuantity(order.quantity)}
${priceDisplay ? `Price: ${priceDisplay}` : ''}
${order.estimatedValue ? `Estimated Value: ${OrderFormatters.formatWithCurrency(order.estimatedValue, order.currency)}` : ''}
${order.broker ? `Broker: ${order.broker}` : ''}
Client: ${order.clientName || ''}
Account: ${accountLabel}

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
  async 'orders.createBulk'({ bulkOrderData, attachments, sessionId }) {
    check(sessionId, String);
    // Evidence shared by every order in the block (e.g. one client email covering all
    // accounts). Per-account evidence rides along on each row instead.
    check(attachments, creationAttachmentPattern);
    check(bulkOrderData, {
      orderType: Match.Where(x => ['buy', 'sell'].includes(x)),
      isin: String,
      securityName: String,
      assetType: Match.Where(x => Object.values(ASSET_TYPES).includes(x)),
      currency: String,
      priceType: Match.Where(x => Object.values(PRICE_TYPES).includes(x)),
      limitPrice: Match.Maybe(Number),
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
        attachments: creationAttachmentPattern
      }]
    });

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    if (!bulkOrderData.orders || bulkOrderData.orders.length === 0) {
      throw new Meteor.Error('invalid-order', 'At least one order is required');
    }

    // Generate unique bulk group ID
    const bulkOrderGroupId = `BULK-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const createdOrders = [];
    const errors = [];

    for (let i = 0; i < bulkOrderData.orders.length; i++) {
      const individualOrder = bulkOrderData.orders[i];

      try {
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
          tradeMode: TRADE_MODES.BLOCK,
          bulkOrderGroupId
        };
        // Pass through FX/TD fields if present
        if (bulkOrderData.fxSubtype) sharedFields.fxSubtype = bulkOrderData.fxSubtype;
        if (bulkOrderData.fxPair) sharedFields.fxPair = bulkOrderData.fxPair;
        if (bulkOrderData.fxBuyCurrency) sharedFields.fxBuyCurrency = bulkOrderData.fxBuyCurrency;
        if (bulkOrderData.fxSellCurrency) sharedFields.fxSellCurrency = bulkOrderData.fxSellCurrency;
        if (bulkOrderData.fxRate) sharedFields.fxRate = bulkOrderData.fxRate;
        if (bulkOrderData.fxAmountCurrency) sharedFields.fxAmountCurrency = bulkOrderData.fxAmountCurrency;
        if (bulkOrderData.fxForwardDate) sharedFields.fxForwardDate = bulkOrderData.fxForwardDate;
        if (bulkOrderData.fxValueDate) sharedFields.fxValueDate = bulkOrderData.fxValueDate;
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

        // entityId and attachments are not part of the orders.create payload shape:
        // the entity is resolved from the bank account, and the files are passed
        // alongside so each order is inserted with its evidence already attached.
        const { entityId: _rowEntityId, attachments: rowAttachments, ...rowFields } = individualOrder;

        const result = await Meteor.callAsync('orders.create', {
          orderData: {
            ...sharedFields,
            ...rowFields
          },
          attachments: [...(attachments || []), ...(rowAttachments || [])],
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

    // Cannot cancel executed orders
    if (order.status === ORDER_STATUSES.EXECUTED) {
      throw new Meteor.Error('invalid-operation', 'Cannot cancel executed orders');
    }

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: ORDER_STATUSES.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: userId,
        cancellationReason: reason || null,
        updatedAt: new Date(),
        updatedBy: userId
      }
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
      depositAction: Match.Maybe(String)
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
   * Update limit on a sent order (allows post-send limit changes)
   * Tracks change history for audit trail
   */
  /**
   * Request a limit/SL/TP modification (four-eyes: goes to PENDING_MODIFICATION)
   * Requires client instruction email attachment
   */
  async 'orders.updateLimit'({ orderId, priceType, limitPrice, stopLossPrice, takeProfitPrice, reason, clientInstructionFile, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(priceType, Match.Maybe(Match.Where(x => Object.values(PRICE_TYPES).includes(x))));
    check(limitPrice, Match.Maybe(Number));
    check(stopLossPrice, Match.Maybe(Number));
    check(takeProfitPrice, Match.Maybe(Number));
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

    // Allowed on pending and sent orders (not pending_validation or already pending_modification)
    const allowedStatuses = [ORDER_STATUSES.PENDING, ORDER_STATUSES.SENT];
    if (!allowedStatuses.includes(order.status)) {
      throw new Meteor.Error('invalid-operation', 'Modifications can only be requested on pending or sent orders');
    }

    // Client instruction is required
    if (!clientInstructionFile) {
      throw new Meteor.Error('missing-attachment', 'Client instruction email is required for modifications');
    }

    // Save client instruction file
    let instructionFilePath = null;
    if (clientInstructionFile) {
      try {
        const basePath = process.env.FICHIER_CENTRAL_PATH || './.fichier_central';
        const ordersDir = path.join(basePath, 'orders', orderId);
        if (!fs.existsSync(ordersDir)) {
          fs.mkdirSync(ordersDir, { recursive: true });
        }
        const ext = path.extname(clientInstructionFile.fileName).toLowerCase();
        const timestamp = Date.now();
        const storedFileName = `modification_instruction_${timestamp}${ext}`;
        instructionFilePath = path.join(ordersDir, storedFileName);
        const buffer = Buffer.from(clientInstructionFile.base64Data, 'base64');
        fs.writeFileSync(instructionFilePath, buffer);
      } catch (err) {
        console.error('[ORDERS] Error saving modification instruction file:', err);
        throw new Meteor.Error('file-system-error', 'Failed to save client instruction file');
      }
    }

    // Build the pending modification object with proposed changes
    const pendingModification = {
      _id: Random.id(),
      requestedBy: userId,
      requestedByName: userDisplayName,
      requestedAt: new Date(),
      reason: reason || null,
      // Snapshot old values
      oldValues: {
        priceType: order.priceType,
        limitPrice: order.limitPrice || null,
        stopLossPrice: order.stopLossPrice || null,
        takeProfitPrice: order.takeProfitPrice || null
      },
      // Proposed new values
      newValues: {
        priceType: priceType || order.priceType,
        limitPrice: (priceType === 'market') ? null : (limitPrice !== undefined ? limitPrice : order.limitPrice),
        stopLossPrice: stopLossPrice !== undefined ? stopLossPrice : order.stopLossPrice,
        takeProfitPrice: takeProfitPrice !== undefined ? takeProfitPrice : order.takeProfitPrice
      },
      // Client instruction
      instructionFile: clientInstructionFile ? {
        fileName: clientInstructionFile.fileName,
        mimeType: clientInstructionFile.mimeType,
        filePath: instructionFilePath,
        storedFileName: path.basename(instructionFilePath)
      } : null,
      // Status tracking
      statusBeforeModification: order.status,
      status: 'pending' // pending | validated | rejected
    };

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: ORDER_STATUSES.PENDING_MODIFICATION,
        pendingModification,
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Modification requested on order ${order.orderReference} by ${userDisplayName} (${userId}) - reason: ${reason || 'none'}`);

    // Notify validators
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
          title: 'Order Modification Pending',
          message: `${userDisplayName} requested a modification on order ${order.orderReference} (${order.securityName}).`,
          metadata: { orderId, orderReference: order.orderReference },
          eventType: EVENT_TYPES.ORDER_CREATED
        });
      }
    } catch (notifError) {
      console.error('[ORDERS] Error sending modification notification:', notifError);
    }

    return { success: true, orderId };
  },

  /**
   * Validate a pending modification (four-eyes: apply the changes)
   */
  async 'orders.validateModification'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    // Permission check
    if (!user.canValidateOrders && user.role !== 'compliance') {
      throw new Meteor.Error('not-authorized', 'You do not have order validation permission');
    }

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) throw new Meteor.Error('not-found', 'Order not found');
    await validateOrderAccess(order, user);

    if (order.status !== ORDER_STATUSES.PENDING_MODIFICATION || !order.pendingModification) {
      throw new Meteor.Error('invalid-operation', 'Order has no pending modification');
    }

    // Four-eyes: requester cannot validate their own modification
    if (order.pendingModification.requestedBy === userId) {
      throw new Meteor.Error('four-eyes-violation', 'You cannot validate your own modification (four-eyes principle)');
    }

    const mod = order.pendingModification;

    // Build history entry for the old values
    const historyEntry = {
      price: mod.oldValues.limitPrice,
      priceType: mod.oldValues.priceType,
      stopLossPrice: mod.oldValues.stopLossPrice,
      takeProfitPrice: mod.oldValues.takeProfitPrice,
      newPrice: mod.newValues.limitPrice,
      newPriceType: mod.newValues.priceType,
      newStopLossPrice: mod.newValues.stopLossPrice,
      newTakeProfitPrice: mod.newValues.takeProfitPrice,
      changedAt: mod.requestedAt,
      changedBy: mod.requestedBy,
      changedByName: mod.requestedByName,
      validatedAt: new Date(),
      validatedBy: userId,
      validatedByName: userDisplayName,
      reason: mod.reason,
      instructionFile: mod.instructionFile ? {
        fileName: mod.instructionFile.fileName,
        storedFileName: mod.instructionFile.storedFileName
      } : null
    };

    // Apply the modification — atomic compare-and-set against the
    // PENDING_MODIFICATION status + review-lock claim, so two simultaneous
    // validators cannot both apply the same change.
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
          status: mod.statusBeforeModification,
          priceType: mod.newValues.priceType,
          limitPrice: mod.newValues.limitPrice,
          stopLossPrice: mod.newValues.stopLossPrice,
          takeProfitPrice: mod.newValues.takeProfitPrice,
          pendingModification: null,
          updatedAt: new Date(),
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
        throw new Meteor.Error('already-validated', 'This modification was already processed.');
      }
      if (current.reviewingBy && current.reviewingBy !== userId) {
        const whoLabel = current.reviewingByName || 'another user';
        throw new Meteor.Error('locked-by-other', `This order is currently being reviewed by ${whoLabel}.`);
      }
      throw new Meteor.Error('validation-failed', 'Could not validate this modification — please refresh and try again.');
    }

    console.log(`[ORDERS] Modification validated on order ${order.orderReference} by ${userDisplayName} (${userId})`);

    // Notify the requester
    try {
      const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
      await NotificationHelpers.create({
        userId: mod.requestedBy,
        type: 'success',
        title: 'Modification Validated',
        message: `Your modification on order ${order.orderReference} (${order.securityName}) has been validated by ${userDisplayName}.`,
        metadata: { orderId, orderReference: order.orderReference },
        eventType: EVENT_TYPES.ORDER_VALIDATED
      });
    } catch (notifError) {
      console.error('[ORDERS] Error sending modification validation notification:', notifError);
    }

    return { success: true, orderId };
  },

  /**
   * Reject a pending modification (revert to previous status)
   */
  async 'orders.rejectModification'({ orderId, reason, sessionId }) {
    check(orderId, String);
    check(sessionId, String);
    check(reason, Match.Maybe(String));

    const { user, userId, userDisplayName } = await validateSession(sessionId);

    if (!user.canValidateOrders && user.role !== 'compliance') {
      throw new Meteor.Error('not-authorized', 'You do not have order validation permission');
    }

    const order = await OrdersCollection.findOneAsync(orderId);
    if (!order) throw new Meteor.Error('not-found', 'Order not found');
    await validateOrderAccess(order, user);

    if (order.status !== ORDER_STATUSES.PENDING_MODIFICATION || !order.pendingModification) {
      throw new Meteor.Error('invalid-operation', 'Order has no pending modification');
    }

    const mod = order.pendingModification;

    // Build rejected history entry
    const historyEntry = {
      price: mod.oldValues.limitPrice,
      priceType: mod.oldValues.priceType,
      stopLossPrice: mod.oldValues.stopLossPrice,
      takeProfitPrice: mod.oldValues.takeProfitPrice,
      newPrice: mod.newValues.limitPrice,
      newPriceType: mod.newValues.priceType,
      newStopLossPrice: mod.newValues.stopLossPrice,
      newTakeProfitPrice: mod.newValues.takeProfitPrice,
      changedAt: mod.requestedAt,
      changedBy: mod.requestedBy,
      changedByName: mod.requestedByName,
      rejectedAt: new Date(),
      rejectedBy: userId,
      rejectedByName: userDisplayName,
      reason: mod.reason,
      rejectionReason: reason || null,
      status: 'rejected'
    };

    // Revert to previous status without applying changes
    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: mod.statusBeforeModification,
        pendingModification: null,
        updatedAt: new Date(),
        updatedBy: userId
      },
      $push: { limitHistory: historyEntry }
    });

    console.log(`[ORDERS] Modification rejected on order ${order.orderReference} by ${userDisplayName} (${userId}) - reason: ${reason || 'N/A'}`);

    // Notify the requester
    try {
      const { NotificationHelpers, EVENT_TYPES } = await import('../../imports/api/notifications.js');
      await NotificationHelpers.create({
        userId: mod.requestedBy,
        type: 'error',
        title: 'Modification Rejected',
        message: `Your modification on order ${order.orderReference} was rejected by ${userDisplayName}.${reason ? ` Reason: ${reason}` : ''}`,
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
        email: client.username
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
      } : null
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
      missingTermsheet: Match.Maybe(Boolean)
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
      query.clientId = filters.clientId;
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

    // Count total matching orders
    const total = await OrdersCollection.find(query).countAsync();

    // Build sort
    const sortField = pagination.sortField || 'createdAt';
    const sortOrder = pagination.sortOrder || -1;
    const sort = { [sortField]: sortOrder };

    // Fetch orders
    const limit = pagination.limit || 50;
    const skip = pagination.skip || 0;

    const orders = await OrdersCollection.find(query, {
      sort,
      limit,
      skip
    }).fetchAsync();

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
        accountName: bankAccount?.name || ''
      };
    }));

    return {
      orders: enrichedOrders,
      total,
      page: Math.floor(skip / limit) + 1,
      totalPages: Math.ceil(total / limit)
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
    const html = generateOrderPDFHTML(order, client, bankAccount, bank, createdByUser);

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

    const subject = OrderHelpers.generateEmailSubject(order);
    const body = OrderHelpers.generateEmailBody(order, client, bank, bankAccount);

    return {
      to: bank?.deskEmail || '',
      subject,
      body,
      orderReference: order.orderReference
    };
  },

  /**
   * Prepare email data + PDF for an order (returns data for .eml generation client-side)
   */
  async 'orders.prepareEmail'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    if (order.status === ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Cannot prepare email for orders pending validation');
    }

    const client = await UsersCollection.findOneAsync(order.clientId);
    const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
    const bank = await BanksCollection.findOneAsync(order.bankId);
    const createdByUser = await UsersCollection.findOneAsync(order.createdBy);

    // Generate PDF
    const html = generateOrderPDFHTML(order, client, bankAccount, bank, createdByUser);
    const pdfResult = await generatePDFFromHTML(html, {
      format: 'A4', marginTop: '10mm', marginRight: '15mm', marginBottom: '10mm', marginLeft: '15mm'
    });

    // Prepare email data
    const subject = OrderHelpers.generateEmailSubject(order);
    const body = OrderHelpers.generateEmailBody(order, client, bank, bankAccount);

    // Build CC list: bank CC emails + order creator's email
    const ccList2 = [...(bank?.ccEmails || [])];
    const creatorEmail2 = createdByUser?.email;
    if (creatorEmail2 && !ccList2.includes(creatorEmail2)) {
      ccList2.push(creatorEmail2);
    }

    return {
      success: true,
      orderReference: order.orderReference,
      pdfData: pdfResult.pdfData,
      emailData: {
        to: bank?.deskEmail || '',
        cc: ccList2.join(';'),
        subject,
        body
      },
      termsheet: loadInitialTermsheetAttachment(order)
    };
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

    if (!bank?.deskEmail) {
      throw new Meteor.Error('no-desk-email', 'Bank does not have a desk email configured');
    }

    console.log(`[ORDERS] Generating PDF and sending email for order: ${order.orderReference} by ${userDisplayName}`);

    // Step 1: Generate PDF
    const html = generateOrderPDFHTML(order, client, bankAccount, bank, createdByUser);
    const pdfResult = await generatePDFFromHTML(html, {
      format: 'A4',
      marginTop: '10mm',
      marginRight: '15mm',
      marginBottom: '10mm',
      marginLeft: '15mm'
    });

    // Step 2: Prepare email content
    const subject = OrderHelpers.generateEmailSubject(order);
    const clientName = client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown';

    const isStructuredProduct = order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT;

    // For structured products, look up issuer contact info to include in the email
    let issuer = null;
    if (isStructuredProduct && order.issuerId) {
      issuer = await IssuersCollection.findOneAsync(order.issuerId);
    }
    const issuerContactHtml = (issuer && (issuer.contactName || issuer.contactEmail || issuer.contactPhone)) ? `
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
    const issuerContactText = (issuer && (issuer.contactName || issuer.contactEmail || issuer.contactPhone))
      ? `\nIssuer Contact (${issuer.name}):\n${issuer.contactName ? issuer.contactName + '\n' : ''}${issuer.contactEmail ? issuer.contactEmail + '\n' : ''}${issuer.contactPhone ? issuer.contactPhone + '\n' : ''}`
      : '';
    const quantityLabel = isStructuredProduct ? 'Nominal' : (order.assetType === 'term_deposit' ? 'Amount' : 'Quantity');
    const priceCellHtml = order.limitPrice
      ? (isStructuredProduct
          ? `${Number(order.limitPrice).toFixed(2)}%`
          : OrderFormatters.formatWithCurrency(order.limitPrice, order.currency))
      : null;
    const priceTextValue = order.limitPrice
      ? (isStructuredProduct
          ? `${Number(order.limitPrice).toFixed(2)}%`
          : OrderFormatters.formatWithCurrency(order.limitPrice, order.currency))
      : null;

    const isTdOrFx = order.assetType === 'term_deposit' || order.assetType === 'fx';
    const confirmationRows = [
      ['Order Type', `<span style="display: inline-block; padding: 4px 12px; border-radius: 12px; background-color: ${order.orderType === 'buy' ? '#EAF3EE' : '#F9EDEB'}; color: ${order.orderType === 'buy' ? EMAIL.success : EMAIL.danger}; font-weight: 600; text-transform: uppercase; font-size: 12px;">${OrderFormatters.orderDirectionLabel(order)}</span>`],
      [isTdOrFx ? 'Description' : 'Security', order.securityName],
      ...(isTdOrFx ? [] : [['ISIN', `<span style="font-family: Consolas, 'Courier New', monospace;">${order.isin}</span>`]]),
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
      footerNote: 'This order confirmation was sent via Ambervision by Amber Lake Partners.'
    });

    const emailText = `
Order Confirmation: ${order.orderReference}

Order Type: ${OrderFormatters.orderDirectionLabel(order)}
${order.assetType === 'term_deposit' || order.assetType === 'fx' ? 'Description' : 'Security'}: ${order.securityName}
${order.assetType === 'term_deposit' || order.assetType === 'fx' ? '' : `ISIN: ${order.isin}\n`}${quantityLabel}: ${OrderFormatters.formatQuantity(order.quantity)}
${isStructuredProduct
  ? (priceTextValue ? `Price: ${priceTextValue}` : '')
  : order.assetType === 'term_deposit' ? ''
  : `Price Type: ${order.priceType === 'market' ? 'Market' : 'Limit'}
${order.priceType === 'limit' && priceTextValue ? `Limit Price: ${priceTextValue}` : ''}
${order.validityType ? `Validity: ${order.validityType === 'gtc' ? 'Good Till Canceled' : order.validityType === 'gtd' ? `Good Till ${order.validityDate ? OrderFormatters.formatDate(order.validityDate) : 'Date'}` : 'Day Order'}` : ''}`
}
${order.broker ? `Broker: ${order.broker}` : ''}
Client: ${clientName}
Account: ${bankAccount?.accountNumber || order.portfolioCode || 'N/A'}
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
        to: [{ email: bank.deskEmail, name: bank.name }],
        attachments
      });

      console.log(`[ORDERS] Email sent successfully to: ${bank.deskEmail} by ${userDisplayName}`);

      // Step 4: Mark order as sent
      await OrdersCollection.updateAsync(orderId, {
        $set: {
          status: ORDER_STATUSES.SENT,
          sentAt: new Date(),
          sentTo: bank.deskEmail,
          sentMethod: 'sendpulse',
          updatedAt: new Date(),
          updatedBy: userId
        }
      });

      return {
        success: true,
        orderId,
        sentTo: bank.deskEmail,
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
      const client = await UsersCollection.findOneAsync(order.clientId);
      const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
      const bank = await BanksCollection.findOneAsync(order.bankId);
      const createdByUser = await UsersCollection.findOneAsync(order.createdBy);

      // Generate PDF
      const html = generateOrderPDFHTML(order, client, bankAccount, bank, createdByUser);
      const pdfResult = await generatePDFFromHTML(html, {
        format: 'A4',
        marginTop: '10mm',
        marginRight: '15mm',
        marginBottom: '10mm',
        marginLeft: '15mm'
      });
      pdfData = pdfResult.pdfData;

      // Prepare email data
      const subject = OrderHelpers.generateEmailSubject(order);
      const body = OrderHelpers.generateEmailBody(order, client, bank, bankAccount);
      // Build CC list: bank CC emails + order creator's email
      const ccList = [...(bank?.ccEmails || [])];
      const creatorEmail = createdByUser?.email;
      if (creatorEmail && !ccList.includes(creatorEmail)) {
        ccList.push(creatorEmail);
      }

      if (!bank?.deskEmail) {
        console.warn(`[ORDERS] Bank ${bank?.name || order.bankId} has no deskEmail configured`);
      }

      emailData = {
        to: bank?.deskEmail || '',
        cc: ccList.join(';'),
        subject,
        body,
        bankName: bank?.name || ''
      };

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
   * Reject an order validation (move from PENDING_VALIDATION → REJECTED)
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

    if (order.status !== ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Order is not pending validation');
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
 * Match an order against PMSOperations to detect if it was booked
 */
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
  windowEnd.setDate(windowEnd.getDate() + 30);

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

  return {
    bookingStatus: 'confirmed',
    matchedOperation: {
      operationDate: earliest.snapshotDate,
      quantity: earliest.quantity,
      price: earliest.costPrice,
      grossAmount: -Math.abs(holdingQty * earliest.costPrice) * (order.orderType === 'buy' ? 1 : -1),
      operationCode: null,
      instrumentName: earliest.securityName || null,
      remark: 'Synthesised from pmsHoldings (no operation row delivered)',
      operationType: 'HOLDINGS_FALLBACK'
    },
    confidence: 'holdings_fallback',
    reason: `Position appeared on ${earliest.snapshotDate.toISOString().split('T')[0]} at cost ${earliest.costPrice} ${earliest.currency || ''} — no transaction row in PMS but holding is fresh.`
  };
}

/**
 * Settlement matcher for FX orders. FX trades have no ISIN, so we match against
 * the bank's FX_TRADE operations on: same portfolio, the order's currency pair
 * (buy/sell ccy must both appear among the operation's currencies), notional
 * amount (compared in either leg via the operation's fxRate), and proximity to
 * the value/forward date. Returns the same shape as matchOrderToOperations.
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
  }, { sort: { operationDate: -1 }, limit: 25 }).fetchAsync();

  if (ops.length === 0) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'No matching FX_TRADE operations found' };
  }

  const orderCcys = [order.fxBuyCurrency, order.fxSellCurrency]
    .filter(Boolean).map(c => c.toUpperCase());
  const orderAmount = Math.abs(order.quantity || 0);
  const refDate = valueDate ? new Date(valueDate) : new Date(orderDate);

  let bestMatch = null, bestScore = 0, bestRatio = 0;
  for (const op of ops) {
    const opCcys = [op.operationCurrency, op.settlementCurrency, op.baseCurrency]
      .filter(Boolean).map(c => c.toUpperCase());

    // The order's currency pair must align with the operation's currencies.
    if (orderCcys.length === 2 && !orderCcys.every(c => opCcys.includes(c))) continue;

    // Credit the pair only when we actually verified it (both currencies known
    // and matched above); otherwise amount + date must carry the match.
    let score = orderCcys.length === 2 ? 30 : 0;

    // Amount: the op notional may be expressed in either leg, so also test it
    // scaled by the fx rate before picking the best ratio.
    const opAmount = Math.abs(op.amount || op.grossAmount || op.netAmount || op.quantity || 0);
    const rate = op.fxRate || order.fxRate || null;
    const candidates = [opAmount];
    if (rate) candidates.push(opAmount * rate, opAmount / rate);
    let ratio = 0;
    if (orderAmount > 0) {
      for (const c of candidates) {
        if (c > 0) ratio = Math.max(ratio, Math.min(orderAmount, c) / Math.max(orderAmount, c));
      }
    }
    if (ratio >= 0.99) score += 50;
    else if (ratio >= 0.95) score += 35;
    else if (ratio >= 0.90) score += 20;

    const daysDiff = Math.abs((new Date(op.valueDate || op.operationDate) - refDate) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 2) score += 25;
    else if (daysDiff <= 7) score += 15;
    else if (daysDiff <= 21) score += 5;

    if (score > bestScore) { bestScore = score; bestMatch = op; bestRatio = ratio; }
  }

  if (!bestMatch) {
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

  const opDate = bestMatch.valueDate || bestMatch.operationDate;
  return {
    bookingStatus: 'confirmed',
    matchedOperation: {
      operationDate: opDate,
      quantity: order.quantity,                       // FX "quantity" is the notional
      price: bestMatch.fxRate || order.fxRate || null, // executed rate
      grossAmount: bestMatch.grossAmount || bestMatch.amount || null,
      operationCode: bestMatch.operationNumber || null,
      instrumentName: order.fxPair || null,
      remark: `Matched FX_TRADE ${bestMatch.operationNumber || ''}`.trim(),
      operationType: 'FX_TRADE'
    },
    confidence: 'fx_operation_match',
    reason: `Matching FX_TRADE operation found${order.fxPair ? ` (${order.fxPair})` : ''}${opDate ? ` on ${new Date(opDate).toISOString().split('T')[0]}` : ''}.`
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

  // Date window: 5 days before order to 30 days after
  const orderDate = order.createdAt || new Date();
  const windowStart = new Date(orderDate);
  windowStart.setDate(windowStart.getDate() - 5);
  const windowEnd = new Date(orderDate);
  windowEnd.setDate(windowEnd.getDate() + 30);

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
 * Get base path for order file storage
 */
const getOrdersBasePath = () => {
  if (process.env.FICHIER_CENTRAL_PATH) {
    return path.join(process.env.FICHIER_CENTRAL_PATH, 'orders');
  }
  // Store outside public/ to avoid triggering Meteor hot code push
  let projectRoot = process.cwd();
  if (projectRoot.includes('.meteor')) {
    projectRoot = projectRoot.split('.meteor')[0].replace(/[\\\/]$/, '');
  }
  return path.join(projectRoot, '.fichier_central', 'orders');
};

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

  // Remove existing trace of same type (file from disk + entry from DB) if it exists
  const existingTraces = order.emailTraces || [];
  const existingTrace = existingTraces.find(t => t.traceType === traceType);
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

    // Push to order's emailTraces array and auto-advance status based on trace type
    const updateFields = { updatedAt: new Date(), updatedBy: userId };

    if (traceType === EMAIL_TRACE_TYPES.ORDER_TO_BANK && order.status !== ORDER_STATUSES.EXECUTED) {
      updateFields.status = ORDER_STATUSES.TRANSMITTED;
      updateFields.transmittedAt = new Date();
      console.log(`[ORDERS] Auto-advancing order ${order.orderReference} to TRANSMITTED (order-to-bank email uploaded)`);
    } else if (traceType === EMAIL_TRACE_TYPES.BANK_CONFIRMATION) {
      updateFields.status = ORDER_STATUSES.EXECUTED;
      updateFields.executedAt = new Date();
      console.log(`[ORDERS] Auto-advancing order ${order.orderReference} to EXECUTED (bank confirmation uploaded)`);
    }

    // Clear deferred-attach flag once the creator's promised client-order trace lands
    const updateOp = {
      $push: { emailTraces: trace },
      $set: updateFields
    };
    if (traceType === EMAIL_TRACE_TYPES.CLIENT_ORDER && order.clientOrderDeferred) {
      updateOp.$unset = { clientOrderDeferred: '' };
    }
    await OrdersCollection.updateAsync(orderId, updateOp);

    console.log(`[ORDERS] Email trace uploaded: ${traceType} for order ${order.orderReference} (${traceId}) by ${userDisplayName} (${userId})`);

    return { success: true, traceId, trace };
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

    // Remove existing trace of same type if exists
    const existingTraces = order.emailTraces || [];
    const existingTrace = existingTraces.find(t => t.traceType === traceType);
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

    // Auto-advance status based on trace type (same as file traces)
    const updateFields = { updatedAt: new Date(), updatedBy: userId };

    if (traceType === EMAIL_TRACE_TYPES.ORDER_TO_BANK && order.status !== ORDER_STATUSES.EXECUTED) {
      updateFields.status = ORDER_STATUSES.TRANSMITTED;
      updateFields.transmittedAt = new Date();
      console.log(`[ORDERS] Auto-advancing order ${order.orderReference} to TRANSMITTED (order-to-bank phone trace)`);
    } else if (traceType === EMAIL_TRACE_TYPES.BANK_CONFIRMATION) {
      updateFields.status = ORDER_STATUSES.EXECUTED;
      updateFields.executedAt = new Date();
      console.log(`[ORDERS] Auto-advancing order ${order.orderReference} to EXECUTED (bank confirmation phone trace)`);
    }

    await OrdersCollection.updateAsync(orderId, {
      $push: { emailTraces: trace },
      $set: updateFields
    });

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
      const authorized = bankAccount?.authorizedEmail ? bankAccount.authorizedEmail.trim().toLowerCase() : '';
      const ccList = Array.isArray(bankAccount?.authorizedCcEmails)
        ? bankAccount.authorizedCcEmails.map(e => String(e).trim().toLowerCase()).filter(Boolean)
        : [];
      const authorizedSet = new Set([authorized, ...ccList].filter(Boolean));

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

    const orderSummary = [
      `Order Reference: ${order.orderReference}`,
      isFx && fxLegs
        ? `Direction: BUY ${fxLegs.buy} / SELL ${fxLegs.sell} (client converts ${fxLegs.sell} into ${fxLegs.buy})`
        : `Direction: ${order.orderType?.toUpperCase()} (${order.orderType === 'buy' ? 'Purchase' : 'Sale'})`,
      `Security: ${order.securityName}`,
      isFx ? 'ISIN: none (FX trades have no ISIN)' : `ISIN: ${order.isin}`,
      `Asset Type: ${order.assetType}`,
      isFx
        ? `Amount: ${order.quantity} ${fxAmountCcy} (the amount is denominated in ${fxAmountCcy})`
        : `Quantity: ${order.quantity}`,
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

    const prompt = `You are a compliance officer at Amber Lake Partners, a wealth-management advisory firm. Amber Lake proposes investments to clients by email; clients then reply with their approval, often briefly ("ok", "ok pour moi", "yes", "accepted", "go", "perfect"). You must compare the client's instruction against the order that was entered into the system and identify real discrepancies.

KEY CONTEXT — READ CAREFULLY:
- Amber Lake Partners IS the firm running this system. Emails sent FROM @amberlakepartners.com to the client are Amber Lake's advisory proposals, NOT third-party intermediary issues. Do not flag "is Amber Lake authorized" — Amber Lake is the advisor and the question is moot.
- The client typically replies on top of a long email thread (their reply is usually short and the proposal details are in quoted text BELOW their reply, or earlier in the thread). You MUST read the whole thread, including quoted/forwarded portions, before judging completeness. A short "ok" approving a fully-detailed proposal earlier in the thread IS a complete instruction, not a vague approval.
- Authorized signatories for the account are configured separately on the bank account (authorizedEmail / authorizedCcEmails / authorizedPhone). A separate deterministic check already verifies the sender against those fields — do NOT re-flag the authorized-email match in your output (it will be added automatically).
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
- Quote the ISIN you found in the detail field.` : ''}${fxGuidance}

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
      "field": "field name (e.g. ${isFx ? 'Direction, Currency Pair, Amount, Rate, Value Date' : `Direction, Security, Quantity, Price, Currency, Settlement Date${isStructuredProduct ? ', Term sheet ISIN' : ''}`})",
      "status": "ok" | "warning" | "mismatch",
      "detail": "Brief explanation grounded in the email thread"
    }
  ],
  "notes": "Any additional observations"
}

Important:
- Read the FULL thread before judging. Look in quoted/forwarded portions for the proposal details that the client is approving.
- Do NOT include an "Authorized email" check — that is added separately.
- Do NOT question whether Amber Lake Partners is an authorized intermediary — Amber Lake IS the firm.
- Do NOT flag a mismatch because the email references additional securities/orders other than this one — multi-order emails are normal.
${isFx
  ? '- Compare direction (which currency is bought and which is sold), currency pair, amount (and the currency it is denominated in), rate if stated, and value date. FX orders have no ISIN — never flag one as missing. Missing fields → warning, not mismatch.'
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
 * Generate HTML for Order Confirmation PDF
 */
function generateOrderPDFHTML(order, client, bankAccount, bank, createdByUser) {
  const orderDate = OrderFormatters.formatDateTime(order.createdAt);
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
  <title>Order Confirmation - ${order.orderReference}</title>
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
      <div class="execution-type ${order.executionType === 'pre_executed' ? 'pre-executed' : 'to-execute'}">${EXECUTION_TYPE_LABELS[order.executionType] || 'Order to be Executed'}</div>
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
    </div>
  </div>

  <div class="section">
    <h2>${order.assetType === 'fx' ? 'FX Details' : order.assetType === 'term_deposit' ? 'Term Deposit Details' : 'Security Details'}</h2>
    <div class="info-grid">
      <div class="info-row full-width">
        <span class="info-label">${order.assetType === 'fx' || order.assetType === 'term_deposit' ? 'Description' : 'Security Name'}</span>
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
      <div class="info-row">
        <span class="info-label">ISIN</span>
        <span class="info-value">${order.isin}</span>
      </div>
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

  <div class="section">
    <h2>Order Details</h2>
    <div class="highlight">
      <div class="highlight-row">
        <span class="highlight-label">Order Type</span>
        <span class="highlight-value">${OrderFormatters.orderDirectionLabel(order)}</span>
      </div>
      <div class="highlight-row">
        <span class="highlight-label">${order.assetType === 'structured_product' ? 'Nominal' : (order.assetType === 'term_deposit' || order.assetType === 'fx' ? 'Amount' : 'Quantity')}</span>
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

  ${(order.limitHistory && order.limitHistory.length > 0) ? `
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
        ${order.limitHistory.map(entry => `
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
    <div class="footer-line">Order Confirmation generated by Ambervision Platform</div>
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

  // Limit modifications
  (order.limitHistory || []).forEach(entry => {
    events.push({
      date: entry.changedAt,
      event: 'Limit Modified',
      by: entry.changedByName || '',
      details: entry.reason || `Changed to ${OrderFormatters.getPriceTypeLabel(entry.newPriceType || 'limit')}`
    });
    if (entry.validatedAt) {
      events.push({ date: entry.validatedAt, event: 'Modification Validated', by: entry.validatedByName || '', details: '' });
    }
    if (entry.rejectedAt) {
      events.push({ date: entry.rejectedAt, event: 'Modification Rejected', by: entry.rejectedByName || '', details: entry.rejectionReason || '' });
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
  if (order.cancelledAt) {
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
    <h2>${order.assetType === 'fx' ? 'FX Details' : order.assetType === 'term_deposit' ? 'Term Deposit Details' : 'Security Details'}</h2>
    <div class="info-grid">
      <div class="info-row full-width">
        <span class="info-label">${order.assetType === 'fx' || order.assetType === 'term_deposit' ? 'Description' : 'Security Name'}</span>
        <span class="info-value">${order.securityName || 'N/A'}</span>
      </div>
      ${order.isin && order.assetType !== 'fx' && order.assetType !== 'term_deposit' ? `
      <div class="info-row">
        <span class="info-label">ISIN</span>
        <span class="info-value">${order.isin}</span>
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
        <span class="highlight-label">${order.assetType === 'structured_product' ? 'Nominal' : (order.assetType === 'term_deposit' || order.assetType === 'fx' ? 'Amount' : 'Quantity')}</span>
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
    const entities = await entityCursor.fetchAsync();

    const mappedEntities = entities.map(e => ({
      _id: e._id,
      username: ClientEntityHelpers.getEntityDisplayName(e),
      profile: {
        ...(e.profile || {}),
        clientType: e.type === 'company' ? 'company' : 'individual'
      },
      role: 'client',
      entityId: e._id,
      migratedFromUserId: e.migratedFromUserId || null
    }));

    // Dedupe: prefer the entity record over a legacy user with the same id.
    const migratedUserIds = new Set(
      mappedEntities.map(m => m.migratedFromUserId).filter(Boolean)
    );
    const filteredUsers = users.filter(u => !migratedUserIds.has(u._id));

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

    // Find latest active holdings for this account (exclude cash positions)
    const holdingsQuery = {
      isActive: true,
      isLatest: true,
      portfolioCode: { $regex: new RegExp('^' + bankAccount.accountNumber.split('-')[0]) },
      assetClass: { $nin: ['cash', 'liquidity', 'Cash', 'Liquidity', 'CASH'] },
      securityName: { $not: /^(cash|liquidity|compte|konto)/i }
    };
    const holdingsOpts = {
      fields: { isin: 1, securityName: 1, quantity: 1, marketValue: 1, currency: 1, assetClass: 1, marketPrice: 1 },
      sort: { securityName: 1 }
    };
    // Try with userId first, then by bankId for entity-based accounts
    let holdings = await PMSHoldingsCollection.find({ ...holdingsQuery, userId: resolved.holdingsUserId }, holdingsOpts).fetchAsync();
    if (holdings.length === 0) {
      holdings = await PMSHoldingsCollection.find({ ...holdingsQuery, bankId: bankAccount.bankId }, holdingsOpts).fetchAsync();
    }

    return holdings;
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

    // Find cash holdings (try by userId first, then by bankId+portfolioCode for entity-based accounts)
    const portfolioRegex = new RegExp('^' + bankAccount.accountNumber.split('-')[0]);
    const cashQuery = {
      isActive: true,
      isLatest: true,
      portfolioCode: { $regex: portfolioRegex },
      $or: [
        { assetClass: { $in: ['cash', 'liquidity', 'Cash', 'Liquidity', 'CASH'] } },
        { securityName: { $regex: /cash|liquidity|compte|konto/i } }
      ]
    };
    // Try with userId first
    let cashHoldings = await PMSHoldingsCollection.find({ ...cashQuery, userId: resolved.holdingsUserId }).fetchAsync();
    let scope = { userId: resolved.holdingsUserId };
    // If no results, try with bankId + portfolioCode only (entity-based accounts)
    if (cashHoldings.length === 0) {
      cashHoldings = await PMSHoldingsCollection.find({ ...cashQuery, bankId: bankAccount.bankId }).fetchAsync();
      scope = { bankId: bankAccount.bankId };
    }

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

    const cashPositions = cashHoldings.map(h => ({
      currency: h.currency,
      amount: nativeAmount(h),
      name: h.securityName
    }));

    // Show a zero row for every currency in which the portfolio has any holding
    // but no cash position — makes the absence of cash explicit rather than hiding it.
    const portfolioHoldings = await PMSHoldingsCollection.find({
      isActive: true,
      isLatest: true,
      portfolioCode: { $regex: portfolioRegex },
      ...scope
    }, { fields: { currency: 1 } }).fetchAsync();
    const portfolioCurrencies = new Set(portfolioHoldings.map(h => h.currency).filter(Boolean));
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

    return {
      cashBalance: totalCash,
      currency,
      cashPositions
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
      { fields: { title: 1, isin: 1, issuer: 1, currency: 1, denomination: 1 } }
    );

    if (!product) return null;

    return {
      name: product.title,
      isin: product.isin,
      issuer: product.issuer || '',
      currency: product.currency || '',
      denomination: product.denomination || null
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
