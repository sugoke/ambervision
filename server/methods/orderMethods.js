import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import fs from 'fs';
import path from 'path';
import { Random } from 'meteor/random';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { generatePDFFromHTML } from '../helpers/pdfHelper.js';
import { UsersCollection, UserHelpers } from '../../imports/api/users.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { ProductsCollection } from '../../imports/api/products.js';
import { PMSOperationsCollection } from '../../imports/api/pmsOperations.js';
import { OrdersCollection, ORDER_STATUSES, ASSET_TYPES, PRICE_TYPES, TRADE_MODES, TERMSHEET_STATUSES, EMAIL_TRACE_TYPES, EMAIL_TRACE_LABELS, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, FX_SUBTYPES, TERM_DEPOSIT_TENORS, OrderHelpers, OrderFormatters } from '../../imports/api/orders.js';
import { OrderCountersCollection, OrderCounterHelpers } from '../../imports/api/orderCounters.js';
import { EmailService } from '../../imports/api/emailService.js';
import { AccountProfilesCollection, aggregateToFourCategories, getBreakdownKeyForAssetType, mapOrderAssetTypeToProfileCategory } from '../../imports/api/accountProfiles.js';
import { SecuritiesMetadataCollection } from '../../imports/api/securitiesMetadata.js';

/**
 * Order Management Server Methods
 */

/**
 * Validate session and return user info
 * @param {String} sessionId - Session ID
 * @returns {Object} - { user, userId, userDisplayName }
 */
async function validateSession(sessionId) {
  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

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

  // RMs/Assistants can access orders for their clients
  if (user.role === 'rm' || user.role === 'assistant') {
    const client = await UsersCollection.findOneAsync(order.clientId);
    const rmIds = UserHelpers.getEffectiveRmIds(user);
    if (client && rmIds.includes(client.relationshipManagerId)) {
      return true;
    }
  }

  throw new Meteor.Error('not-authorized', 'You do not have access to this order');
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

  // Get all holdings for this account (including cash)
  const holdings = await PMSHoldingsCollection.find({
    userId: clientId,
    isActive: true,
    isLatest: true,
    portfolioCode: { $regex: new RegExp('^' + bankAccount.accountNumber.split('-')[0]) }
  }).fetchAsync();

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
      if (protectionType === 'capital_guaranteed_100') categoryKey = 'structured_product_capital_guaranteed';
      else if (protectionType === 'capital_guaranteed_partial') categoryKey = 'structured_product_partial_guarantee';
      else if (protectionType === 'capital_protected_conditional') categoryKey = 'structured_product_barrier_protected';
      else if (underlyingType) categoryKey = `structured_product_${underlyingType}`;
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
  async 'orders.create'({ orderData, sessionId }) {
    check(sessionId, String);
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
      notes: Match.Maybe(String),
      bulkOrderGroupId: Match.Maybe(String),
      broker: Match.Maybe(String),
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
      // Order source (email or phone)
      orderSource: Match.Maybe(String),
      phoneCallTime: Match.Maybe(String)
    });

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    // Validate client exists
    const client = await UsersCollection.findOneAsync(orderData.clientId);
    if (!client) {
      throw new Meteor.Error('invalid-client', 'Client not found');
    }

    // Validate bank account exists and belongs to client
    const bankAccount = await BankAccountsCollection.findOneAsync({
      _id: orderData.bankAccountId,
      userId: orderData.clientId,
      isActive: true
    });
    if (!bankAccount) {
      throw new Meteor.Error('invalid-account', 'Bank account not found or does not belong to client');
    }

    // For SELL orders, validate position (skip for term deposit decreases)
    if (orderData.orderType === 'sell' && orderData.assetType !== ASSET_TYPES.TERM_DEPOSIT) {
      if (!orderData.sourceHoldingId) {
        throw new Meteor.Error('invalid-order', 'Source holding required for sell orders');
      }

      const validation = await OrderHelpers.validateSellOrder(
        orderData.sourceHoldingId,
        orderData.quantity
      );

      if (!validation.valid) {
        throw new Meteor.Error('invalid-quantity', validation.error);
      }
    }

    // Generate order reference
    const orderReference = await OrderCounterHelpers.generateNextReference();

    // Get bank info for the order
    const bank = await BanksCollection.findOneAsync(bankAccount.bankId);

    // Auto-generate wealth ambassador initials from creating user
    const waInitials = (() => {
      const fn = user.profile?.firstName;
      const ln = user.profile?.lastName;
      if (fn && ln) return (fn[0] + ln[0]).toUpperCase();
      if (fn) return fn[0].toUpperCase();
      return '';
    })();

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
      clientId: orderData.clientId,
      bankAccountId: orderData.bankAccountId,
      bankId: bankAccount.bankId,
      portfolioCode: orderData.portfolioCode || bankAccount.accountNumber,
      sourceHoldingId: orderData.orderType === 'sell' ? orderData.sourceHoldingId : null,
      status: ORDER_STATUSES.PENDING_VALIDATION,
      executedQuantity: 0,
      notes: orderData.notes || null,
      bulkOrderGroupId: orderData.bulkOrderGroupId || null,
      wealthAmbassador: waInitials,
      createdByName: userDisplayName,
      broker: orderData.broker || null,
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
      // Order source (email or phone)
      orderSource: orderData.orderSource || 'email',
      ...(orderData.phoneCallTime ? { phoneCallTime: orderData.phoneCallTime } : {}),
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

    const orderId = await OrdersCollection.insertAsync(order);

    console.log(`[ORDERS] Created order ${orderReference} (${orderId}) by ${userDisplayName} (${userId})`);

    // Create linked Take Profit order
    if (orderData.attachedTakeProfit) {
      const tpRef = `${orderReference}-TP`;
      const tpOrder = {
        ...order,
        _id: undefined,
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
      const tpId = await OrdersCollection.insertAsync(tpOrder);
      console.log(`[ORDERS] Created linked TP order ${tpRef} (${tpId}) for ${orderReference}`);
    }

    // Create linked Stop Loss order
    if (orderData.attachedStopLoss) {
      const slRef = `${orderReference}-SL`;
      const slOrder = {
        ...order,
        _id: undefined,
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

    return {
      orderId,
      orderReference,
      order: { ...order, _id: orderId }
    };
  },

  /**
   * Create multiple orders in bulk (same security to multiple accounts)
   */
  async 'orders.createBulk'({ bulkOrderData, sessionId }) {
    check(sessionId, String);
    check(bulkOrderData, {
      orderType: Match.Where(x => ['buy', 'sell'].includes(x)),
      isin: String,
      securityName: String,
      assetType: Match.Where(x => Object.values(ASSET_TYPES).includes(x)),
      currency: String,
      priceType: Match.Where(x => Object.values(PRICE_TYPES).includes(x)),
      limitPrice: Match.Maybe(Number),
      notes: Match.Maybe(String),
      broker: Match.Maybe(String),
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
      orders: [{
        clientId: String,
        bankAccountId: String,
        portfolioCode: Match.Maybe(String),
        quantity: Number,
        estimatedValue: Match.Maybe(Number),
        sourceHoldingId: Match.Maybe(String)
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
          broker: bulkOrderData.broker,
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

        const result = await Meteor.callAsync('orders.create', {
          orderData: {
            ...sharedFields,
            ...individualOrder
          },
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

    // Only pending or pending_validation orders can be updated
    if (order.status !== ORDER_STATUSES.PENDING && order.status !== ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Only pending orders can be updated');
    }

    const updateFields = {
      updatedAt: new Date(),
      updatedBy: userId
    };

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

    // Only pending or pending_validation orders can be deleted
    if (order.status !== ORDER_STATUSES.PENDING && order.status !== ORDER_STATUSES.PENDING_VALIDATION) {
      throw new Meteor.Error('invalid-operation', 'Only pending orders can be deleted');
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

    // Apply the modification
    await OrdersCollection.updateAsync(orderId, {
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
      $push: { limitHistory: historyEntry }
    });

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
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Marked order ${order.orderReference} as ${newStatus} by ${userDisplayName} (${userId})`);

    return { success: true, orderId, newStatus };
  },

  /**
   * Update termsheet status for structured product orders
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

    console.log(`[ORDERS] Updated termsheet status to "${termsheetStatus}" for order ${order.orderReference} by ${userDisplayName} (${userId})`);

    return { success: true, orderId, termsheetStatus };
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

    // Enrich with related data
    const client = await UsersCollection.findOneAsync(order.clientId);
    const bankAccount = await BankAccountsCollection.findOneAsync(order.bankAccountId);
    const bank = await BanksCollection.findOneAsync(order.bankId);

    return {
      order: OrderHelpers.formatOrderDetails(order),
      client: client ? {
        _id: client._id,
        firstName: client.profile?.firstName,
        lastName: client.profile?.lastName,
        email: client.username
      } : null,
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
      bulkOrderGroupId: Match.Maybe(String)
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
    if (user.role === 'rm' || user.role === 'assistant') {
      // RMs/Assistants only see orders for their clients
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      const rmClients = await UsersCollection.find({ relationshipManagerId: { $in: rmIds } }).fetchAsync();
      const clientIds = rmClients.map(c => c._id);
      query.clientId = { $in: clientIds };
    } else if (user.role === 'client') {
      // Clients only see their own orders
      query.clientId = user._id;
    }
    // Admins and superadmins see all orders

    // Apply filters
    if (filters.status) {
      query.status = Array.isArray(filters.status) ? { $in: filters.status } : filters.status;
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
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      const client = await UsersCollection.findOneAsync(order.clientId);
      const bank = await BanksCollection.findOneAsync(order.bankId);
      const creator = await UsersCollection.findOneAsync(order.createdBy);

      return {
        ...OrderHelpers.formatOrderDetails(order),
        clientName: client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown',
        bankName: bank?.name || 'Unknown',
        createdByName: creator ? `${creator.profile?.firstName || ''} ${creator.profile?.lastName || ''}`.trim() : 'Unknown'
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

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #1A2B40 0%, #2D4A6A 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 22px;">Order Confirmation</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">${order.orderReference}</p>
        </div>
        <div style="padding: 30px; background: #f8fafc; border-radius: 0 0 8px 8px;">
          <table style="width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <tr>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280; width: 140px;">Order Type</td>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb;">
                <span style="background: ${order.orderType === 'buy' ? '#dcfce7' : '#fee2e2'}; color: ${order.orderType === 'buy' ? '#166534' : '#991b1b'}; padding: 4px 12px; border-radius: 4px; font-weight: 600; text-transform: uppercase;">${order.orderType}</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Security</td>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: 500;">${order.securityName}</td>
            </tr>
            <tr>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">ISIN</td>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-family: monospace;">${order.isin}</td>
            </tr>
            <tr>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Quantity</td>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: 600; color: #0ea5e9;">${OrderFormatters.formatQuantity(order.quantity)}</td>
            </tr>
            <tr>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Price Type</td>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb;">${order.priceType === 'market' ? 'Market' : 'Limit'}</td>
            </tr>
            ${order.priceType === 'limit' && order.limitPrice ? `
            <tr>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Limit Price</td>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb;">${OrderFormatters.formatWithCurrency(order.limitPrice, order.currency)}</td>
            </tr>
            ` : ''}
            <tr>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb; font-weight: bold; color: #6b7280;">Client</td>
              <td style="padding: 15px; border-bottom: 1px solid #e5e7eb;">${clientName}</td>
            </tr>
            <tr>
              <td style="padding: 15px; font-weight: bold; color: #6b7280;">Account</td>
              <td style="padding: 15px;">${bankAccount?.accountNumber || order.portfolioCode || 'N/A'}</td>
            </tr>
          </table>
          ${order.notes ? `
          <div style="margin-top: 20px; padding: 15px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px;">
            <strong style="color: #92400e;">Notes:</strong>
            <p style="margin: 8px 0 0 0; color: #78350f;">${order.notes}</p>
          </div>
          ` : ''}
          <p style="margin-top: 20px; color: #6b7280; font-size: 13px; text-align: center;">
            Please find the full order confirmation attached as PDF.
          </p>
        </div>
      </div>
    `;

    const emailText = `
Order Confirmation: ${order.orderReference}

Order Type: ${order.orderType.toUpperCase()}
Security: ${order.securityName}
ISIN: ${order.isin}
Quantity: ${OrderFormatters.formatQuantity(order.quantity)}
Price Type: ${order.priceType === 'market' ? 'Market' : 'Limit'}
${order.priceType === 'limit' && order.limitPrice ? `Limit Price: ${OrderFormatters.formatWithCurrency(order.limitPrice, order.currency)}` : ''}
Client: ${clientName}
Account: ${bankAccount?.accountNumber || order.portfolioCode || 'N/A'}
${order.notes ? `\nNotes: ${order.notes}` : ''}

Please find the full order confirmation attached as PDF.
    `.trim();

    // Step 3: Send email with PDF attachment
    try {
      await EmailService.sendEmail({
        subject,
        html: emailHtml,
        text: emailText,
        to: [{ email: bank.deskEmail, name: bank.name }],
        attachments: [{
          name: `${order.orderReference}.pdf`,
          content: pdfResult.pdfData,
          isBase64: true
        }]
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
   * Validate an order (four-eyes principle: move from PENDING_VALIDATION → PENDING)
   * Enforces: validator !== creator, validator has canValidateOrders permission
   */
  async 'orders.validate'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

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

    // RMs/Assistants can only validate orders for their own clients
    if (user.role === 'rm' || user.role === 'assistant') {
      const client = await UsersCollection.findOneAsync(order.clientId);
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!client || !rmIds.includes(client.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You can only validate orders for your own clients');
      }
    }

    // Four-eyes: creator cannot validate their own order
    if (order.createdBy === userId) {
      throw new Meteor.Error('four-eyes-violation', 'You cannot validate your own order (four-eyes principle)');
    }

    await OrdersCollection.updateAsync(orderId, {
      $set: {
        status: ORDER_STATUSES.PENDING,
        validatedBy: userId,
        validatedByName: userDisplayName,
        validatedAt: new Date(),
        updatedAt: new Date(),
        updatedBy: userId
      }
    });

    console.log(`[ORDERS] Validated order ${order.orderReference} by ${userDisplayName} (${userId})`);

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
      emailData = {
        to: bank?.deskEmail || '',
        cc: (bank?.ccEmails || []).join(';'),
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

    return {
      success: true,
      orderId,
      orderReference: order.orderReference,
      newStatus: ORDER_STATUSES.PENDING,
      pdfData,
      emailData
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

  /**
   * Write .eml file to temp and open it with the OS default email client
   */
  async 'orders.openEmlFile'({ emlBase64, fileName, sessionId }) {
    check(emlBase64, String);
    check(fileName, String);
    check(sessionId, String);

    await validateSession(sessionId);

    const os = require('os');
    const { exec } = require('child_process');
    const tempDir = os.tmpdir();
    const filePath = path.join(tempDir, fileName);

    // Decode and write the .eml file
    const emlContent = decodeURIComponent(escape(atob(emlBase64)));
    fs.writeFileSync(filePath, emlContent, 'utf8');

    console.log(`[ORDERS] Opening .eml file: ${filePath}`);

    // Open with OS default handler (Outlook on Windows)
    const platform = process.platform;
    let command;
    if (platform === 'win32') {
      command = `start "" "${filePath}"`;
    } else if (platform === 'darwin') {
      command = `open "${filePath}"`;
    } else {
      command = `xdg-open "${filePath}"`;
    }

    return new Promise((resolve) => {
      exec(command, (error) => {
        if (error) {
          console.error('[ORDERS] Error opening .eml file:', error);
          resolve({ success: false, error: error.message });
        } else {
          resolve({ success: true, filePath });
        }
      });
    });
  },

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
    if (user.role === 'rm' || user.role === 'assistant') {
      const client = await UsersCollection.findOneAsync(order.clientId);
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!client || !rmIds.includes(client.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You can only reject orders for your own clients');
      }
    }

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
    if (user.role === 'rm' || user.role === 'assistant') {
      const client = await UsersCollection.findOneAsync(order.clientId);
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!client || !rmIds.includes(client.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You can only modify orders for your own clients');
      }
    }

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

    // RMs/Assistants only see pending orders for their own clients
    if (user.role === 'rm' || user.role === 'assistant') {
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      const rmClients = await UsersCollection.find({ relationshipManagerId: { $in: rmIds } }).fetchAsync();
      const clientIds = rmClients.map(c => c._id);
      query.clientId = { $in: clientIds };
    }

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
async function matchOrderToOperations(order) {
  if (!order.isin || !order.portfolioCode) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'Missing ISIN or portfolio code' };
  }

  // Build operation type filter based on order type
  const opTypes = order.orderType === 'buy'
    ? ['BUY', 'SUBSCRIPTION']
    : ['SELL', 'REDEMPTION'];

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

  if (operations.length === 0) {
    return { bookingStatus: 'none', matchedOperation: null, confidence: null, reason: 'No matching operations found' };
  }

  // Score each match
  let bestMatch = null;
  let bestScore = 0;

  for (const op of operations) {
    let score = 0;

    // Quantity similarity
    const opQty = Math.abs(op.quantity || 0);
    const orderQty = Math.abs(order.quantity || 0);
    if (orderQty > 0 && opQty > 0) {
      const qtyRatio = Math.min(opQty, orderQty) / Math.max(opQty, orderQty);
      if (qtyRatio >= 0.99) {
        score += 50; // Exact match
      } else if (qtyRatio >= 0.90) {
        score += 30; // Within 10%
      } else if (qtyRatio >= 0.70) {
        score += 10; // Within 30%
      }
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
  const qtyRatio = orderQty > 0 && opQty > 0
    ? Math.min(opQty, orderQty) / Math.max(opQty, orderQty)
    : 0;
  const isExact = qtyRatio >= 0.99;

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

  return {
    bookingStatus,
    matchedOperation: {
      operationDate: bestMatch.operationDate,
      quantity: bestMatch.quantity,
      price: bestMatch.price || bestMatch.quote,
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

    // Validate file extension
    const ext = path.extname(fileName).toLowerCase();
    if (!EMAIL_TRACE_ACCEPTED_TYPES.includes(ext)) {
      throw new Meteor.Error('invalid-file-type', `File type ${ext} is not accepted. Accepted types: ${EMAIL_TRACE_ACCEPTED_TYPES.join(', ')}`);
    }

    // Validate file size (base64 is ~33% larger than binary)
    const estimatedSize = Math.ceil(base64Data.length * 0.75);
    if (estimatedSize > EMAIL_TRACE_MAX_SIZE) {
      throw new Meteor.Error('file-too-large', `File exceeds maximum size of 15MB`);
    }

    // Generate unique stored filename
    const timestamp = Date.now();
    const storedFileName = `${traceType}_${timestamp}${ext}`;

    // Ensure order directory exists
    const orderDir = ensureOrderDirectory(orderId);
    const filePath = path.join(orderDir, storedFileName);

    console.log(`[ORDERS] Uploading email trace: ${traceType} for order ${order.orderReference} by ${userDisplayName} (${userId})`);
    console.log(`   File: ${fileName} -> ${storedFileName}`);

    // Remove existing trace of same type if exists
    const existingTraces = order.emailTraces || [];
    const existingTrace = existingTraces.find(t => t.traceType === traceType);
    if (existingTrace) {
      try {
        if (fs.existsSync(existingTrace.filePath)) {
          fs.unlinkSync(existingTrace.filePath);
          console.log(`   Deleted old trace: ${existingTrace.filePath}`);
        }
      } catch (err) {
        console.error('Error deleting old trace file:', err);
      }

      await OrdersCollection.updateAsync(orderId, {
        $pull: { emailTraces: { _id: existingTrace._id } }
      });
    }

    // Save file to disk
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
      console.log(`   Trace saved: ${filePath} (${buffer.length} bytes)`);
    } catch (error) {
      console.error('Error saving email trace file:', error);
      throw new Meteor.Error('file-system-error', 'Failed to save email trace file');
    }

    // Build trace object
    const traceId = Random.id();
    const trace = {
      _id: traceId,
      traceType,
      fileName,
      storedFileName,
      filePath,
      mimeType: mimeType || 'application/octet-stream',
      fileSize: estimatedSize,
      uploadedAt: new Date(),
      uploadedBy: userId
    };

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

    await OrdersCollection.updateAsync(orderId, {
      $push: { emailTraces: trace },
      $set: updateFields
    });

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

    // Delete file from disk
    try {
      if (fs.existsSync(trace.filePath)) {
        fs.unlinkSync(trace.filePath);
        console.log(`[ORDERS] Deleted trace file: ${trace.filePath}`);
      }
    } catch (err) {
      console.error('Error deleting trace file:', err);
    }

    // Remove from order document
    await OrdersCollection.updateAsync(orderId, {
      $pull: { emailTraces: { _id: traceId } },
      $set: { updatedAt: new Date(), updatedBy: userId }
    });

    console.log(`[ORDERS] Email trace deleted: ${trace.traceType} from order ${order.orderReference} by ${userDisplayName} (${userId})`);

    return { success: true };
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

    return `/order_traces/${orderId}/${trace.storedFileName}`;
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

    const orderSummary = [
      `Order Reference: ${order.orderReference}`,
      `Direction: ${order.orderType?.toUpperCase()} (${order.orderType === 'buy' ? 'Purchase' : 'Sale'})`,
      `Security: ${order.securityName}`,
      `ISIN: ${order.isin}`,
      `Asset Type: ${order.assetType}`,
      `Quantity: ${order.quantity}`,
      `Currency: ${order.currency}`,
      `Price Type: ${order.priceType}`,
      order.limitPrice ? `Limit Price: ${order.limitPrice}` : null,
      order.stopPrice ? `Stop Price: ${order.stopPrice}` : null,
      order.estimatedValue ? `Estimated Value: ${order.estimatedValue} ${order.currency}` : null,
      `Client: ${clientName}`,
      `Bank: ${bank?.name || 'Unknown'}`,
      `Account: ${order.portfolioCode || 'N/A'}`,
      order.settlementCurrency ? `Settlement Currency: ${order.settlementCurrency}` : null,
      order.broker ? `Broker: ${order.broker}` : null,
      order.notes ? `Notes: ${order.notes}` : null,
      // FX specific
      order.fxPair ? `FX Pair: ${order.fxPair}` : null,
      order.fxSubtype ? `FX Type: ${order.fxSubtype}` : null,
      order.fxRate ? `FX Rate: ${order.fxRate}` : null,
      // Validity
      order.validityType ? `Validity: ${order.validityType}` : null,
    ].filter(Boolean).join('\n');

    const prompt = `You are a compliance officer at a wealth management firm. Compare the client's email/instruction below with the order that was entered into the system. Identify any discrepancies or potential issues.

ORDER ENTERED IN SYSTEM:
${orderSummary}

CLIENT EMAIL/INSTRUCTION:
${emailContent.substring(0, 8000)}

Analyze and respond with a JSON object (no markdown, just raw JSON):
{
  "status": "match" | "warning" | "mismatch",
  "confidence": 0-100,
  "summary": "One sentence overall assessment",
  "checks": [
    {
      "field": "field name (e.g. Direction, Security, Quantity, Price, Currency, Client)",
      "status": "ok" | "warning" | "mismatch",
      "detail": "Brief explanation"
    }
  ],
  "notes": "Any additional observations (e.g. email seems unrelated to the order, or email is a general inquiry not a trade instruction)"
}

Important:
- If the email does not appear to be a trade instruction at all, set status to "warning" and note this.
- Compare direction (buy/sell), security/ISIN, quantity, price, currency, client identity.
- A missing field in the email is not a mismatch, just note it.
- Be concise. Focus on real discrepancies.`;

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
        console.log(`[AI_CHECK] Order ${order.orderReference}: ${result.status} (confidence: ${result.confidence}%)`);
        return { success: true, result };
      }

      return { success: true, result: { status: 'warning', summary: 'Could not parse AI response', notes: textContent, checks: [], confidence: 0 } };
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
  const clientName = client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown';
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
      <div class="order-type">${order.orderType.toUpperCase()}</div>
    </div>
  </div>

  <div class="section">
    <h2>Account Information</h2>
    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Client</span>
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
        <span class="info-label">${order.assetType === 'fx' ? 'Description' : 'Security Name'}</span>
        <span class="info-value">${order.securityName}</span>
      </div>
      ${order.assetType === 'fx' && order.fxPair ? `
      <div class="info-row">
        <span class="info-label">FX Pair</span>
        <span class="info-value">${order.fxPair}</span>
      </div>
      <div class="info-row">
        <span class="info-label">FX Type</span>
        <span class="info-value">${order.fxSubtype === 'forward' ? 'Forward' : 'Spot'}</span>
      </div>
      ${order.fxAmountCurrency ? `
      <div class="info-row">
        <span class="info-label">Amount Currency</span>
        <span class="info-value">${order.fxAmountCurrency}</span>
      </div>
      ` : ''}
      ${order.fxRate ? `
      <div class="info-row">
        <span class="info-label">Rate</span>
        <span class="info-value">${order.fxRate.toFixed(6)}</span>
      </div>
      ` : ''}
      ${order.limitPrice ? `
      <div class="info-row">
        <span class="info-label">Limit Price</span>
        <span class="info-value">${order.limitPrice.toFixed(6)}</span>
      </div>
      ` : ''}
      ${order.stopLossPrice ? `
      <div class="info-row">
        <span class="info-label">Stop Loss</span>
        <span class="info-value">${order.stopLossPrice.toFixed(6)}</span>
      </div>
      ` : ''}
      ${order.takeProfitPrice ? `
      <div class="info-row">
        <span class="info-label">Take Profit</span>
        <span class="info-value">${order.takeProfitPrice.toFixed(6)}</span>
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
        <span class="highlight-value">${order.orderType.toUpperCase()}</span>
      </div>
      <div class="highlight-row">
        <span class="highlight-label">${order.assetType === 'term_deposit' ? 'Amount' : 'Quantity'}</span>
        <span class="highlight-value">${OrderFormatters.formatQuantity(order.quantity)}</span>
      </div>
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

  ${order.notes ? `
  <div class="notes">
    <div class="notes-title">Notes</div>
    <div class="notes-content">${order.notes}</div>
  </div>
  ` : ''}

  <div class="footer">
    <div class="footer-line">Order Confirmation generated by Ambervision Platform</div>
    <div class="footer-line">This document is for informational purposes only and does not constitute a trade confirmation.</div>
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
  const traceLifecycleOrder = ['client_order', 'order_to_bank', 'order_to_issuer', 'bank_confirmation', 'client_confirmation'];
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
      <div class="order-type">${(order.orderType || '').toUpperCase()}</div>
    </div>
  </div>

  <div class="section">
    <h2>Account Information</h2>
    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Client</span>
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
        <span class="info-label">${order.assetType === 'fx' ? 'Description' : 'Security Name'}</span>
        <span class="info-value">${order.securityName || 'N/A'}</span>
      </div>
      ${order.isin && order.assetType !== 'fx' ? `
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
        <span class="highlight-value">${(order.orderType || '').toUpperCase()}</span>
      </div>
      <div class="highlight-row">
        <span class="highlight-label">${order.assetType === 'term_deposit' ? 'Amount' : 'Quantity'}</span>
        <span class="highlight-value">${OrderFormatters.formatQuantity(order.quantity)}</span>
      </div>
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

  ${order.notes ? `
  <div class="notes">
    <div class="notes-title">Notes</div>
    <div class="notes-content">${order.notes}</div>
  </div>
  ` : ''}

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

    const clients = await UsersCollection.find(query, {
      fields: {
        _id: 1,
        username: 1,
        profile: 1,
        role: 1
      },
      sort: { 'profile.lastName': 1, 'profile.firstName': 1 }
    }).fetchAsync();

    return clients;
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

    // Verify access to client
    if (user.role === 'rm' || user.role === 'assistant') {
      const client = await UsersCollection.findOneAsync(clientId);
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!client || !rmIds.includes(client.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You do not have access to this client');
      }
    }

    const accounts = await BankAccountsCollection.find({
      userId: clientId,
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

    // Verify access to client
    if (user.role === 'rm' || user.role === 'assistant') {
      const client = await UsersCollection.findOneAsync(clientId);
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!client || !rmIds.includes(client.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You do not have access to this client');
      }
    }

    // Get the bank account to find portfolioCode
    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    if (!bankAccount) {
      return [];
    }

    // Find latest active holdings for this account (exclude cash positions)
    const holdings = await PMSHoldingsCollection.find({
      userId: clientId,
      isActive: true,
      isLatest: true,
      portfolioCode: { $regex: new RegExp('^' + bankAccount.accountNumber.split('-')[0]) },
      assetClass: { $nin: ['cash', 'liquidity', 'Cash', 'Liquidity', 'CASH'] },
      securityName: { $not: /^(cash|liquidity|compte|konto)/i }
    }, {
      fields: {
        isin: 1,
        securityName: 1,
        quantity: 1,
        marketValue: 1,
        currency: 1,
        assetClass: 1,
        marketPrice: 1
      },
      sort: { securityName: 1 }
    }).fetchAsync();

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

    // Verify access
    if (user.role === 'rm' || user.role === 'assistant') {
      const client = await UsersCollection.findOneAsync(clientId);
      const rmIds = UserHelpers.getEffectiveRmIds(user);
      if (!client || !rmIds.includes(client.relationshipManagerId)) {
        throw new Meteor.Error('not-authorized', 'You do not have access to this client');
      }
    }

    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    if (!bankAccount) {
      return { cashBalance: null, currency: null };
    }

    // Find cash holdings (asset class typically 'cash' or 'liquidity')
    const cashHoldings = await PMSHoldingsCollection.find({
      userId: clientId,
      isActive: true,
      isLatest: true,
      portfolioCode: { $regex: new RegExp('^' + bankAccount.accountNumber.split('-')[0]) },
      $or: [
        { assetClass: { $in: ['cash', 'liquidity', 'Cash', 'Liquidity', 'CASH'] } },
        { securityName: { $regex: /cash|liquidity|compte|konto/i } }
      ]
    }).fetchAsync();

    const totalCash = cashHoldings.reduce((sum, h) => sum + (h.marketValue || 0), 0);
    const currency = bankAccount.referenceCurrency || cashHoldings[0]?.currency || 'EUR';

    return {
      cashBalance: totalCash,
      currency,
      cashPositions: cashHoldings.map(h => ({
        currency: h.currency,
        amount: h.marketValue || 0,
        name: h.securityName
      }))
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
