import { Mongo } from 'meteor/mongo';
import { check, Match } from 'meteor/check';

// Orders collection for managing buy/sell orders
export const OrdersCollection = new Mongo.Collection('orders');

// Order schema structure:
// {
//   _id: String,
//   orderReference: String,        // 2025-00001 format
//   orderType: 'buy' | 'sell',
//
//   // Security
//   isin: String,
//   securityName: String,
//   assetType: 'equity' | 'bond' | 'structured_product' | 'fx' | 'fund' | 'etf' | 'term_deposit' | 'other',
//   currency: String,
//
//   // Order Details
//   quantity: Number,
//   priceType: 'market' | 'limit' | 'stop_loss' | 'take_profit',
//   limitPrice: Number (optional),
//   estimatedValue: Number (optional),
//
//   // Account
//   clientId: String,
//   bankAccountId: String,
//   bankId: String,
//   portfolioCode: String,
//
//   // For SELL - source position
//   sourceHoldingId: String (optional),
//   sourcePositionQuantity: Number (optional),
//
//   // Status: 'draft' | 'pending_validation' | 'pending' | 'sent' | 'executed' | 'partially_executed' | 'cancelled' | 'rejected'
//   status: String,
//
//   // Four-eyes validation (pending_validation → pending)
//   validatedAt: Date,
//   validatedBy: String,
//   validatedByName: String,
//   rejectedAt: Date,
//   rejectedBy: String,
//   rejectedByName: String,
//   rejectionReason: String,
//
//   // Execution
//   executedQuantity: Number,
//   executedPrice: Number (optional),
//   executionDate: Date (optional),
//   linkedHoldingId: String (optional),
//
//   // Email
//   sentAt: Date,
//   sentTo: String,
//   sentMethod: 'mailto' | 'sendpulse',
//
//   // Bulk grouping
//   bulkOrderGroupId: String (optional),
//
//   // Additional fields
//   wealthAmbassador: String (optional),        // Auto-filled from creating user's initials
//   broker: String (optional),                   // Broker / Issuer (free text)
//   settlementCurrency: String (optional),       // Settlement currency (may differ from security currency)
//   tradeMode: 'individual' | 'block',           // Derived from bulk vs single order
//   underlyings: String (optional),              // Sous-jacents (e.g. "TSLA/AAPL/MSFT")
//
//   // Termsheet (structured products only)
//   termsheetStatus: 'none' | 'sent' | 'signed',   // Tracks if client received/signed termsheet
//   termsheetUpdatedBy: String,                      // Display name of user who last changed termsheet status
//   termsheetUpdatedAt: Date,                        // When termsheet status was last changed
//
//   // FX-specific fields
//   fxSubtype: 'spot' | 'forward',
//   fxPair: String (e.g. "EUR/USD"),
//   fxBuyCurrency: String,
//   fxSellCurrency: String,
//   fxRate: Number (optional - indicative rate),
//   fxForwardDate: Date (optional - for forwards),
//   fxValueDate: Date (optional),
//
//   // Term Deposit-specific fields
//   depositTenor: String (e.g. "1M", "6M", "2Y"),
//   depositCurrency: String,
//   depositMaturityDate: Date (optional),
//
//   // Limit modification history
//   limitHistory: [{ price: Number, priceType: String, changedAt: Date, changedBy: String, changedByName: String, reason: String }],
//
//   // Notes
//   notes: String,
//
//   // Audit
//   createdAt: Date,
//   createdBy: String,
//   updatedAt: Date,
//   updatedBy: String,
//   cancelledAt: Date,
//   cancelledBy: String,
//   cancellationReason: String,
//
//   // Email traces
//   emailTraces: [{
//     _id: String,
//     traceType: 'client_confirmation' | 'order_to_bank' | 'bank_confirmation' | 'order_to_issuer',
//     fileName: String,
//     storedFileName: String,
//     filePath: String,
//     mimeType: String,
//     fileSize: Number,
//     uploadedAt: Date,
//     uploadedBy: String
//   }]
// }

// Email trace types for order documentation
export const EMAIL_TRACE_TYPES = {
  CLIENT_ORDER: 'client_order',
  CLIENT_CONFIRMATION: 'client_confirmation',
  ORDER_TO_BANK: 'order_to_bank',
  BANK_CONFIRMATION: 'bank_confirmation',
  ORDER_TO_ISSUER: 'order_to_issuer'
};

// Email trace type labels for display
export const EMAIL_TRACE_LABELS = {
  [EMAIL_TRACE_TYPES.CLIENT_ORDER]: 'Client Order',
  [EMAIL_TRACE_TYPES.CLIENT_CONFIRMATION]: 'Client Confirmation',
  [EMAIL_TRACE_TYPES.ORDER_TO_BANK]: 'Order to Bank',
  [EMAIL_TRACE_TYPES.BANK_CONFIRMATION]: 'Bank Confirmation',
  [EMAIL_TRACE_TYPES.ORDER_TO_ISSUER]: 'Order to Issuer'
};

// Accepted file types for email traces
export const EMAIL_TRACE_ACCEPTED_TYPES = ['.msg', '.eml', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.html'];
export const EMAIL_TRACE_MAX_SIZE = 15 * 1024 * 1024; // 15MB

// Valid order statuses
export const ORDER_STATUSES = {
  DRAFT: 'draft',
  PENDING_VALIDATION: 'pending_validation',
  PENDING: 'pending',
  PENDING_MODIFICATION: 'pending_modification',
  REVISION_REQUESTED: 'revision_requested',
  TRANSMITTED: 'transmitted',
  SENT: 'sent',
  EXECUTED: 'executed',
  PARTIALLY_EXECUTED: 'partially_executed',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected'
};

// Valid asset types
export const ASSET_TYPES = {
  EQUITY: 'equity',
  BOND: 'bond',
  STRUCTURED_PRODUCT: 'structured_product',
  FX: 'fx',
  FUND: 'fund',
  ETF: 'etf',
  TERM_DEPOSIT: 'term_deposit',
  OTHER: 'other'
};

// Valid trade modes
export const TRADE_MODES = {
  INDIVIDUAL: 'individual',
  BLOCK: 'block'
};

// Valid price types
export const PRICE_TYPES = {
  MARKET: 'market',
  LIMIT: 'limit',
  STOP_LOSS: 'stop_loss',
  STOP_LIMIT: 'stop_limit',
  TAKE_PROFIT: 'take_profit'
};

// FX subtypes
export const FX_SUBTYPES = {
  SPOT: 'spot',
  FORWARD: 'forward'
};

// Term Deposit tenor options
export const TERM_DEPOSIT_TENORS = [
  { value: '2D', label: '2 Days' },
  { value: '1W', label: '1 Week' },
  { value: '2W', label: '2 Weeks' },
  { value: '3W', label: '3 Weeks' },
  { value: '1M', label: '1 Month' },
  { value: '2M', label: '2 Months' },
  { value: '6M', label: '6 Months' },
  { value: '1Y', label: '1 Year' },
  { value: '2Y', label: '2 Years' }
];

// Order validity types
export const VALIDITY_TYPES = {
  DAY: 'day',
  GTC: 'gtc',     // Good Till Canceled
  GTD: 'gtd'      // Good Till Date
};

// Linked order types (TP/SL legs)
export const LINKED_ORDER_TYPES = {
  TAKE_PROFIT: 'take_profit',
  STOP_LOSS: 'stop_loss'
};

// Order source types (how the client instruction was received)
export const ORDER_SOURCE_TYPES = {
  EMAIL: 'email',
  PHONE: 'phone',
};

// Termsheet statuses (structured products only)
export const TERMSHEET_STATUSES = {
  NONE: 'none',
  SENT: 'sent',
  SIGNED: 'signed'
};

// Number formatting utilities
export const OrderFormatters = {
  // Format currency with 2 decimal places
  formatCurrency(value, currency = 'USD') {
    if (typeof value !== 'number' || isNaN(value)) return '0.00';
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  },

  // Format with currency symbol
  formatWithCurrency(value, currency = 'USD') {
    if (typeof value !== 'number' || isNaN(value)) return `${currency} 0.00`;
    return `${currency} ${value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
  },

  // Format quantity (integer)
  formatQuantity(value) {
    if (typeof value !== 'number' || isNaN(value)) return '0';
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    });
  },

  // Format order reference
  formatOrderReference(year, number) {
    return `${year}-${String(number).padStart(5, '0')}`;
  },

  // Format date for display
  formatDate(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  },

  // Format date with time
  formatDateTime(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  },

  // Format date as dd/mm/yy (short, no time)
  formatDateShort(date) {
    if (!date) return 'N/A';
    const d = new Date(date);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${day}/${month}/${year}`;
  },

  // Get status display label
  getStatusLabel(status) {
    const labels = {
      [ORDER_STATUSES.DRAFT]: 'Draft',
      [ORDER_STATUSES.PENDING_VALIDATION]: 'Pending Validation',
      [ORDER_STATUSES.PENDING]: 'Pending',
      [ORDER_STATUSES.PENDING_MODIFICATION]: 'Pending Modification',
      [ORDER_STATUSES.REVISION_REQUESTED]: 'Revision Requested',
      [ORDER_STATUSES.TRANSMITTED]: 'Transmitted',
      [ORDER_STATUSES.SENT]: 'Sent',
      [ORDER_STATUSES.EXECUTED]: 'Executed',
      [ORDER_STATUSES.PARTIALLY_EXECUTED]: 'Partially Executed',
      [ORDER_STATUSES.CANCELLED]: 'Cancelled',
      [ORDER_STATUSES.REJECTED]: 'Rejected'
    };
    return labels[status] || status;
  },

  // Get status color for UI
  getStatusColor(status) {
    const colors = {
      [ORDER_STATUSES.DRAFT]: '#6b7280',       // gray
      [ORDER_STATUSES.PENDING_VALIDATION]: '#f97316', // orange
      [ORDER_STATUSES.PENDING]: '#f59e0b',     // amber
      [ORDER_STATUSES.PENDING_MODIFICATION]: '#a855f7', // purple
      [ORDER_STATUSES.REVISION_REQUESTED]: '#e879f9', // pink
      [ORDER_STATUSES.TRANSMITTED]: '#0ea5e9',  // sky blue
      [ORDER_STATUSES.SENT]: '#3b82f6',        // blue
      [ORDER_STATUSES.EXECUTED]: '#10b981',    // green
      [ORDER_STATUSES.PARTIALLY_EXECUTED]: '#8b5cf6', // purple
      [ORDER_STATUSES.CANCELLED]: '#ef4444',   // red
      [ORDER_STATUSES.REJECTED]: '#dc2626'     // dark red
    };
    return colors[status] || '#6b7280';
  },

  // Get asset type display label
  getAssetTypeLabel(assetType) {
    const labels = {
      [ASSET_TYPES.EQUITY]: 'Equity',
      [ASSET_TYPES.BOND]: 'Bond',
      [ASSET_TYPES.STRUCTURED_PRODUCT]: 'Structured Product',
      [ASSET_TYPES.FX]: 'FX',
      [ASSET_TYPES.FUND]: 'Fund',
      [ASSET_TYPES.ETF]: 'ETF',
      [ASSET_TYPES.TERM_DEPOSIT]: 'Term Deposit',
      [ASSET_TYPES.OTHER]: 'Other'
    };
    return labels[assetType] || assetType;
  },

  // Get price type display label
  getPriceTypeLabel(priceType) {
    const labels = {
      [PRICE_TYPES.MARKET]: 'Market',
      [PRICE_TYPES.LIMIT]: 'Limit',
      [PRICE_TYPES.STOP_LOSS]: 'Stop Loss',
      [PRICE_TYPES.STOP_LIMIT]: 'Stop Limit',
      [PRICE_TYPES.TAKE_PROFIT]: 'Take Profit'
    };
    return labels[priceType] || priceType || 'Market';
  },

  // Get termsheet status label
  getTermsheetLabel(status) {
    const labels = {
      [TERMSHEET_STATUSES.NONE]: 'None',
      [TERMSHEET_STATUSES.SENT]: 'Sent',
      [TERMSHEET_STATUSES.SIGNED]: 'Signed'
    };
    return labels[status] || 'None';
  },

  // Get termsheet status color
  getTermsheetColor(status) {
    const colors = {
      [TERMSHEET_STATUSES.NONE]: '#6b7280',
      [TERMSHEET_STATUSES.SENT]: '#f59e0b',
      [TERMSHEET_STATUSES.SIGNED]: '#10b981'
    };
    return colors[status] || '#6b7280';
  },

  // Get booking status label
  getBookingStatusLabel(status) {
    const labels = {
      'confirmed': 'Booked',
      'likely': 'Likely',
      'none': '-'
    };
    return labels[status] || '-';
  },

  // Get booking status color
  getBookingStatusColor(status) {
    const colors = {
      'confirmed': '#10b981',  // green
      'likely': '#f59e0b',     // orange
      'none': '#6b7280'        // gray
    };
    return colors[status] || '#6b7280';
  }
};

// Helper functions for order management
/**
 * Order health check - computes completeness score based on order status and required items.
 * Returns { score, max, missing, color } where score/max is the fraction and missing lists what's absent.
 */
export function getOrderHealthCheck(order) {
  if (!order) return { score: 0, max: 1, missing: [], color: '#6b7280' };

  const traces = order.emailTraces || [];
  const hasTrace = (type) => traces.some(t => t.traceType === type);
  const checks = [];

  // Terminal statuses — no health check needed
  if (order.status === ORDER_STATUSES.CANCELLED || order.status === ORDER_STATUSES.REJECTED) {
    return { score: 0, max: 0, missing: [], color: '#6b7280', label: '-' };
  }

  // 1. Client order email (always required once past draft)
  if (order.status !== ORDER_STATUSES.DRAFT) {
    const hasClientOrder = hasTrace(EMAIL_TRACE_TYPES.CLIENT_ORDER) ||
      (order.pendingModification?.instructionFile != null) ||
      order.orderSource === 'phone';
    checks.push({ name: 'Client order', ok: hasClientOrder });
  }

  // 2. Four-eyes validation (required once past pending_validation)
  const postValidationStatuses = [ORDER_STATUSES.PENDING, ORDER_STATUSES.SENT, ORDER_STATUSES.EXECUTED, ORDER_STATUSES.PARTIALLY_EXECUTED];
  if (postValidationStatuses.includes(order.status)) {
    checks.push({ name: 'Validation', ok: !!order.validatedAt });
  }

  // 3. Order sent to bank (required for sent+ statuses)
  const postSentStatuses = [ORDER_STATUSES.SENT, ORDER_STATUSES.EXECUTED, ORDER_STATUSES.PARTIALLY_EXECUTED];
  if (postSentStatuses.includes(order.status)) {
    checks.push({ name: 'Order to bank', ok: hasTrace(EMAIL_TRACE_TYPES.ORDER_TO_BANK) });
  }

  // 4. Termsheet signed (structured products only, once sent+)
  if (order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT && postSentStatuses.includes(order.status)) {
    checks.push({ name: 'Termsheet signed', ok: order.termsheetStatus === TERMSHEET_STATUSES.SIGNED });
  }

  // 5. Bank confirmation (required for executed orders)
  const executedStatuses = [ORDER_STATUSES.EXECUTED, ORDER_STATUSES.PARTIALLY_EXECUTED];
  if (executedStatuses.includes(order.status)) {
    checks.push({ name: 'Bank confirmation', ok: hasTrace(EMAIL_TRACE_TYPES.BANK_CONFIRMATION) });
  }

  // 6. Execution price (required for executed orders)
  if (executedStatuses.includes(order.status)) {
    checks.push({ name: 'Exec price', ok: order.executedPrice != null && order.executedPrice > 0 });
  }

  if (checks.length === 0) {
    return { score: 0, max: 0, missing: [], color: '#6b7280', label: '-' };
  }

  const score = checks.filter(c => c.ok).length;
  const max = checks.length;
  const missing = checks.filter(c => !c.ok).map(c => c.name);
  const ratio = score / max;

  let color;
  if (ratio === 1) color = '#10b981';       // green — complete
  else if (ratio >= 0.6) color = '#f59e0b';  // amber — some missing
  else color = '#ef4444';                     // red — many missing

  return { score, max, missing, color, label: `${score}/${max}` };
}

export const OrderHelpers = {
  // Get all orders for a client
  getClientOrders(clientId) {
    check(clientId, String);
    return OrdersCollection.find(
      { clientId, status: { $ne: ORDER_STATUSES.DRAFT } },
      { sort: { createdAt: -1 } }
    );
  },

  // Get orders by status
  getOrdersByStatus(status) {
    check(status, String);
    return OrdersCollection.find(
      { status },
      { sort: { createdAt: -1 } }
    );
  },

  // Get orders in a bulk group
  getBulkGroupOrders(bulkOrderGroupId) {
    check(bulkOrderGroupId, String);
    return OrdersCollection.find(
      { bulkOrderGroupId },
      { sort: { createdAt: 1 } }
    );
  },

  // Get pending orders count
  async getPendingOrdersCount() {
    return await OrdersCollection.find({
      status: { $in: [ORDER_STATUSES.PENDING_VALIDATION, ORDER_STATUSES.PENDING, ORDER_STATUSES.PENDING_MODIFICATION, ORDER_STATUSES.SENT] }
    }).countAsync();
  },

  // Check if user can place orders (RM or Admin only)
  canPlaceOrders(userRole) {
    return ['rm', 'assistant', 'admin', 'superadmin'].includes(userRole);
  },

  // Validate sell order against position
  async validateSellOrder(holdingId, quantity) {
    check(holdingId, String);
    check(quantity, Number);

    const { PMSHoldingsCollection } = await import('./pmsHoldings.js');
    const holding = await PMSHoldingsCollection.findOneAsync(holdingId);

    if (!holding) {
      return { valid: false, error: 'Position not found' };
    }

    if (!holding.isActive || !holding.isLatest) {
      return { valid: false, error: 'Position is not active' };
    }

    if (quantity > holding.quantity) {
      return {
        valid: false,
        error: `Insufficient quantity. Available: ${holding.quantity}, Requested: ${quantity}`
      };
    }

    return { valid: true, availableQuantity: holding.quantity };
  },

  // Pre-format order details for display (no client-side calculations)
  formatOrderDetails(order) {
    if (!order) return null;

    return {
      ...order,
      // Pre-format dates
      createdAtFormatted: OrderFormatters.formatDateShort(order.createdAt),
      createdAtFull: OrderFormatters.formatDateTime(order.createdAt),
      sentAtFormatted: OrderFormatters.formatDateTime(order.sentAt),
      executionDateFormatted: OrderFormatters.formatDate(order.executionDate),
      cancelledAtFormatted: OrderFormatters.formatDateTime(order.cancelledAt),
      // Pre-format numbers
      quantityFormatted: OrderFormatters.formatQuantity(order.quantity),
      executedQuantityFormatted: OrderFormatters.formatQuantity(order.executedQuantity || 0),
      limitPriceFormatted: order.limitPrice ? OrderFormatters.formatWithCurrency(order.limitPrice, order.currency) : null,
      executedPriceFormatted: order.executedPrice ? OrderFormatters.formatWithCurrency(order.executedPrice, order.currency) : null,
      estimatedValueFormatted: order.estimatedValue ? OrderFormatters.formatWithCurrency(order.estimatedValue, order.currency) : null,
      // Pre-format labels
      statusLabel: OrderFormatters.getStatusLabel(order.status),
      statusColor: OrderFormatters.getStatusColor(order.status),
      assetTypeLabel: OrderFormatters.getAssetTypeLabel(order.assetType),
      orderTypeLabel: order.orderType === 'buy' ? 'Buy' : 'Sell',
      priceTypeLabel: OrderFormatters.getPriceTypeLabel(order.priceType),
      tradeModeLabel: order.tradeMode === 'block' ? 'Block' : 'Ind.',
      wealthAmbassadorFormatted: order.wealthAmbassador || '',
      termsheetLabel: OrderFormatters.getTermsheetLabel(order.termsheetStatus),
      termsheetColor: OrderFormatters.getTermsheetColor(order.termsheetStatus),
      termsheetUpdatedByFormatted: order.termsheetUpdatedBy || null,
      termsheetUpdatedAtFormatted: order.termsheetUpdatedAt ? OrderFormatters.formatDateTime(order.termsheetUpdatedAt) : null,
      // FX-specific formatted fields
      fxPairFormatted: order.fxPair || null,
      fxSubtypeLabel: order.fxSubtype === 'forward' ? 'Forward' : order.fxSubtype === 'spot' ? 'Spot' : null,
      fxRateFormatted: order.fxRate ? order.fxRate.toFixed(6) : null,
      fxAmountCurrencyFormatted: order.fxAmountCurrency || null,
      fxForwardDateFormatted: order.fxForwardDate ? OrderFormatters.formatDate(order.fxForwardDate) : null,
      fxValueDateFormatted: order.fxValueDate ? OrderFormatters.formatDate(order.fxValueDate) : null,
      stopLossPriceFormatted: order.stopLossPrice ? order.stopLossPrice.toFixed(6) : null,
      takeProfitPriceFormatted: order.takeProfitPrice ? order.takeProfitPrice.toFixed(6) : null,
      // Term Deposit-specific formatted fields
      depositTenorLabel: order.depositTenor ? (TERM_DEPOSIT_TENORS.find(t => t.value === order.depositTenor)?.label || order.depositTenor) : null,
      depositMaturityDateFormatted: order.depositMaturityDate ? OrderFormatters.formatDate(order.depositMaturityDate) : null,
      depositAction: order.depositAction || null,
      // Limit modification history
      limitHistoryFormatted: (order.limitHistory || []).map(entry => ({
        ...entry,
        changedAtFormatted: OrderFormatters.formatDateTime(entry.changedAt),
        validatedAtFormatted: entry.validatedAt ? OrderFormatters.formatDateTime(entry.validatedAt) : null,
        rejectedAtFormatted: entry.rejectedAt ? OrderFormatters.formatDateTime(entry.rejectedAt) : null,
        priceTypeLabel: OrderFormatters.getPriceTypeLabel(entry.priceType),
        newPriceTypeLabel: entry.newPriceType ? OrderFormatters.getPriceTypeLabel(entry.newPriceType) : null
      })),
      // Validity fields
      validityType: order.validityType || null,
      validityLabel: order.validityType === 'gtc' ? 'Good Till Canceled' : order.validityType === 'gtd' ? `Good Till ${order.validityDate ? OrderFormatters.formatDate(order.validityDate) : 'Date'}` : order.validityType === 'day' ? 'Day Order' : null,
      validityDateFormatted: order.validityDate ? OrderFormatters.formatDate(order.validityDate) : null,
      // Linked orders (TP/SL legs)
      parentOrderRef: order.parentOrderRef || null,
      linkedOrderType: order.linkedOrderType || null,
      linkedOrderGroup: order.linkedOrderGroup || null,
      stopPriceFormatted: order.stopPrice ? OrderFormatters.formatWithCurrency(order.stopPrice, order.currency) : null,
      // Validation fields (four-eyes principle)
      validatedByName: order.validatedByName || null,
      validatedAtFormatted: order.validatedAt ? OrderFormatters.formatDateTime(order.validatedAt) : null,
      rejectedByName: order.rejectedByName || null,
      rejectedAtFormatted: order.rejectedAt ? OrderFormatters.formatDateTime(order.rejectedAt) : null,
      rejectionReason: order.rejectionReason || null
    };
  },

  // Format multiple orders for display
  formatOrdersList(orders) {
    if (!orders || !Array.isArray(orders)) return [];
    return orders.map(order => this.formatOrderDetails(order));
  },

  // Generate email body for mailto
  generateEmailBody(order, client, bank, bankAccount) {
    const clientName = client
      ? (client.profile?.clientType === 'company'
        ? (client.profile?.companyName || 'our client')
        : `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || 'our client')
      : 'our client';
    const accountNumber = bankAccount?.accountNumber || order.portfolioCode || '';

    const lines = [
      'Dear Trading Desk,',
      '',
      `Please find attached an order instruction (Ref: ${order.orderReference}) for the account of ${clientName}${accountNumber ? ` (account ${accountNumber})` : ''}.`,
      '',
      'We kindly ask you to process this order at your earliest convenience and confirm execution.',
      '',
      'Should you require any additional information, please do not hesitate to contact us.',
      '',
      'Kind regards,',
      'Amberlake Partners'
    ];

    return lines.join('\n');
  },

  // Generate email subject
  generateEmailSubject(order) {
    return `Order: ${order.orderReference} - ${order.orderType.toUpperCase()} ${order.securityName}`;
  }
};
