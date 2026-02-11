import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import fs from 'fs';
import path from 'path';
import { Random } from 'meteor/random';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { generatePDFFromHTML } from '../helpers/pdfHelper.js';
import { UsersCollection } from '../../imports/api/users.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { OrdersCollection, ORDER_STATUSES, ASSET_TYPES, PRICE_TYPES, TRADE_MODES, TERMSHEET_STATUSES, EMAIL_TRACE_TYPES, EMAIL_TRACE_ACCEPTED_TYPES, EMAIL_TRACE_MAX_SIZE, OrderHelpers, OrderFormatters } from '../../imports/api/orders.js';
import { OrderCountersCollection, OrderCounterHelpers } from '../../imports/api/orderCounters.js';
import { EmailService } from '../../imports/api/emailService.js';

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

  // Admins and superadmins can access all orders
  if (user.role === 'admin' || user.role === 'superadmin') {
    return true;
  }

  // RMs can access orders for their clients
  if (user.role === 'rm') {
    // Check if the order's client is managed by this RM
    const client = await UsersCollection.findOneAsync(order.clientId);
    if (client && client.rmId === user._id) {
      return true;
    }
  }

  throw new Meteor.Error('not-authorized', 'You do not have access to this order');
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
      tradeMode: Match.Maybe(Match.Where(x => Object.values(TRADE_MODES).includes(x)))
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

    // For SELL orders, validate position
    if (orderData.orderType === 'sell') {
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
    const order = {
      orderReference,
      orderType: orderData.orderType,
      isin: orderData.isin.toUpperCase(),
      securityName: orderData.securityName,
      assetType: orderData.assetType,
      currency: orderData.currency.toUpperCase(),
      quantity: orderData.quantity,
      priceType: orderData.priceType,
      limitPrice: orderData.priceType === 'limit' ? orderData.limitPrice : null,
      estimatedValue: orderData.estimatedValue || null,
      clientId: orderData.clientId,
      bankAccountId: orderData.bankAccountId,
      bankId: bankAccount.bankId,
      portfolioCode: orderData.portfolioCode || bankAccount.accountNumber,
      sourceHoldingId: orderData.orderType === 'sell' ? orderData.sourceHoldingId : null,
      status: ORDER_STATUSES.PENDING,
      executedQuantity: 0,
      notes: orderData.notes || null,
      bulkOrderGroupId: orderData.bulkOrderGroupId || null,
      wealthAmbassador: waInitials,
      broker: orderData.broker || null,
      settlementCurrency: orderData.settlementCurrency || null,
      underlyings: orderData.underlyings || null,
      tradeMode,
      createdAt: new Date(),
      createdBy: userId,
      updatedAt: new Date(),
      updatedBy: userId
    };

    // Get source position quantity for sell orders
    if (orderData.orderType === 'sell' && orderData.sourceHoldingId) {
      const holding = await PMSHoldingsCollection.findOneAsync(orderData.sourceHoldingId);
      if (holding) {
        order.sourcePositionQuantity = holding.quantity;
      }
    }

    const orderId = await OrdersCollection.insertAsync(order);

    console.log(`[ORDERS] Created order ${orderReference} (${orderId}) by ${userDisplayName} (${userId})`);

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
        const result = await Meteor.callAsync('orders.create', {
          orderData: {
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
            bulkOrderGroupId,
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
      underlyings: Match.Maybe(String)
    });

    const { user, userId, userDisplayName } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Only pending orders can be updated
    if (order.status !== ORDER_STATUSES.PENDING) {
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
    if (updateData.limitPrice !== undefined && updateData.priceType === 'limit') {
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

    // Only pending orders can be deleted
    if (order.status !== ORDER_STATUSES.PENDING) {
      throw new Meteor.Error('invalid-operation', 'Only pending orders can be deleted');
    }

    await OrdersCollection.removeAsync(orderId);

    console.log(`[ORDERS] Deleted order ${order.orderReference} by ${userDisplayName} (${userId})`);

    return { success: true, orderId, orderReference: order.orderReference };
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
    if (user.role === 'rm') {
      // RMs only see orders for their clients
      const rmClients = await UsersCollection.find({ rmId: user._id }).fetchAsync();
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

    // Enrich orders with client and bank names
    const enrichedOrders = await Promise.all(orders.map(async (order) => {
      const client = await UsersCollection.findOneAsync(order.clientId);
      const bank = await BanksCollection.findOneAsync(order.bankId);

      return {
        ...OrderHelpers.formatOrderDetails(order),
        clientName: client ? `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() : 'Unknown',
        bankName: bank?.name || 'Unknown'
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
        marginTop: '20mm',
        marginRight: '15mm',
        marginBottom: '20mm',
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
      marginTop: '20mm',
      marginRight: '15mm',
      marginBottom: '20mm',
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
   * Check for automatic execution matching (when bank file is imported)
   */
  async 'orders.checkExecution'({ orderId, sessionId }) {
    check(orderId, String);
    check(sessionId, String);

    const { user } = await validateSession(sessionId);
    validateOrderPermission(user);

    const order = await OrdersCollection.findOneAsync(orderId);
    await validateOrderAccess(order, user);

    // Only check pending/sent orders
    if (![ORDER_STATUSES.PENDING, ORDER_STATUSES.SENT].includes(order.status)) {
      return { matched: false, reason: 'Order not in pending/sent status' };
    }

    // Look for matching PMS holding
    const holdings = await PMSHoldingsCollection.find({
      isin: order.isin,
      portfolioCode: order.portfolioCode,
      isLatest: true,
      isActive: true
    }).fetchAsync();

    if (holdings.length === 0) {
      return { matched: false, reason: 'No matching holdings found' };
    }

    // For buy orders, check if position appeared after order was created
    // For sell orders, check if position quantity decreased
    const holding = holdings[0];

    if (order.orderType === 'buy') {
      // Check if holding was created after order
      if (holding.positionDate > order.createdAt) {
        return {
          matched: true,
          holding: {
            _id: holding._id,
            quantity: holding.quantity,
            positionDate: holding.positionDate
          },
          suggestion: 'Position found after order date - may be execution confirmation'
        };
      }
    } else if (order.orderType === 'sell') {
      // For sells, check if quantity decreased
      if (order.sourcePositionQuantity && holding.quantity < order.sourcePositionQuantity) {
        const soldQuantity = order.sourcePositionQuantity - holding.quantity;
        return {
          matched: soldQuantity >= order.quantity,
          holding: {
            _id: holding._id,
            previousQuantity: order.sourcePositionQuantity,
            currentQuantity: holding.quantity,
            soldQuantity
          },
          suggestion: `Position decreased by ${soldQuantity} - may be execution confirmation`
        };
      }
    }

    return { matched: false, reason: 'No execution match detected' };
  }
});

/**
 * Get base path for order file storage
 */
const getOrdersBasePath = () => {
  if (process.env.FICHIER_CENTRAL_PATH) {
    return path.join(process.env.FICHIER_CENTRAL_PATH, 'orders');
  }
  let projectRoot = process.cwd();
  if (projectRoot.includes('.meteor')) {
    projectRoot = projectRoot.split('.meteor')[0].replace(/[\\\/]$/, '');
  }
  return path.join(projectRoot, 'public', 'fichier_central', 'orders');
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

    // Push to order's emailTraces array
    await OrdersCollection.updateAsync(orderId, {
      $push: { emailTraces: trace },
      $set: { updatedAt: new Date(), updatedBy: userId }
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
      padding: 40px;
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
      margin-top: 40px;
      padding-top: 20px;
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
      <div class="logo">AMBERVISION</div>
      <div class="logo-sub">Wealth Management Platform</div>
    </div>
    <div class="order-info">
      <div class="order-ref">${order.orderReference}</div>
      <div class="order-date">${orderDate}</div>
      <div class="order-type">${order.orderType.toUpperCase()}</div>
    </div>
  </div>

  <div class="section">
    <h2>Security Details</h2>
    <div class="info-grid">
      <div class="info-row">
        <span class="info-label">Security Name</span>
        <span class="info-value">${order.securityName}</span>
      </div>
      <div class="info-row">
        <span class="info-label">ISIN</span>
        <span class="info-value">${order.isin}</span>
      </div>
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
        <span class="highlight-label">Quantity</span>
        <span class="highlight-value">${OrderFormatters.formatQuantity(order.quantity)}</span>
      </div>
      <div class="highlight-row">
        <span class="highlight-label">Price Type</span>
        <span class="highlight-value">${order.priceType === 'market' ? 'Market' : 'Limit'}</span>
      </div>
      ${order.priceType === 'limit' && order.limitPrice ? `
      <div class="highlight-row">
        <span class="highlight-label">Limit Price</span>
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
        <span class="info-label">Portfolio Code</span>
        <span class="info-value">${order.portfolioCode || 'N/A'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Reference Currency</span>
        <span class="info-value">${bankAccount?.referenceCurrency || order.currency}</span>
      </div>
    </div>
  </div>

  ${order.notes ? `
  <div class="notes">
    <div class="notes-title">Notes</div>
    <div class="notes-content">${order.notes}</div>
  </div>
  ` : ''}

  <div class="footer">
    <div class="footer-line">Order Confirmation generated by Ambervision Platform</div>
    <div class="footer-line">Created by: ${createdByName} | Generated: ${new Date().toISOString()}</div>
    <div class="footer-line">This document is for informational purposes only and does not constitute a trade confirmation.</div>
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

    // RMs only see their assigned clients
    if (user.role === 'rm') {
      query.rmId = user._id;
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
    if (user.role === 'rm') {
      const client = await UsersCollection.findOneAsync(clientId);
      if (!client || client.rmId !== user._id) {
        throw new Meteor.Error('not-authorized', 'You do not have access to this client');
      }
    }

    const accounts = await BankAccountsCollection.find({
      userId: clientId,
      isActive: true
    }).fetchAsync();

    // Enrich with bank names
    const enrichedAccounts = await Promise.all(accounts.map(async (account) => {
      const bank = await BanksCollection.findOneAsync(account.bankId);
      return {
        ...account,
        bankName: bank?.name || 'Unknown Bank'
      };
    }));

    return enrichedAccounts;
  }
});
