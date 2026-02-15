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
//   assetType: 'equity' | 'bond' | 'structured_product' | 'fx' | 'fund' | 'other',
//   currency: String,
//
//   // Order Details
//   quantity: Number,
//   priceType: 'market' | 'limit',
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
//   // Status: 'draft' | 'pending' | 'sent' | 'executed' | 'partially_executed' | 'cancelled' | 'rejected'
//   status: String,
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
  CLIENT_CONFIRMATION: 'client_confirmation',
  ORDER_TO_BANK: 'order_to_bank',
  BANK_CONFIRMATION: 'bank_confirmation',
  ORDER_TO_ISSUER: 'order_to_issuer'
};

// Email trace type labels for display
export const EMAIL_TRACE_LABELS = {
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
  PENDING: 'pending',
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
  LIMIT: 'limit'
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
      [ORDER_STATUSES.PENDING]: 'Pending',
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
      [ORDER_STATUSES.PENDING]: '#f59e0b',     // amber
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
      [ASSET_TYPES.OTHER]: 'Other'
    };
    return labels[assetType] || assetType;
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
      status: { $in: [ORDER_STATUSES.PENDING, ORDER_STATUSES.SENT] }
    }).countAsync();
  },

  // Check if user can place orders (RM or Admin only)
  canPlaceOrders(userRole) {
    return ['rm', 'admin', 'superadmin'].includes(userRole);
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
      priceTypeLabel: order.priceType === 'market' ? 'Market' : 'Limit',
      tradeModeLabel: order.tradeMode === 'block' ? 'Block' : 'Ind.',
      wealthAmbassadorFormatted: order.wealthAmbassador || '',
      termsheetLabel: OrderFormatters.getTermsheetLabel(order.termsheetStatus),
      termsheetColor: OrderFormatters.getTermsheetColor(order.termsheetStatus),
      termsheetUpdatedByFormatted: order.termsheetUpdatedBy || null,
      termsheetUpdatedAtFormatted: order.termsheetUpdatedAt ? OrderFormatters.formatDateTime(order.termsheetUpdatedAt) : null
    };
  },

  // Format multiple orders for display
  formatOrdersList(orders) {
    if (!orders || !Array.isArray(orders)) return [];
    return orders.map(order => this.formatOrderDetails(order));
  },

  // Generate email body for mailto
  generateEmailBody(order, client, bank, bankAccount) {
    const lines = [
      `Order Reference: ${order.orderReference}`,
      `Date: ${OrderFormatters.formatDateTime(order.createdAt)}`,
      '',
      '--- ORDER DETAILS ---',
      `Type: ${order.orderType.toUpperCase()}`,
      `Security: ${order.securityName}`,
      `ISIN: ${order.isin}`,
      `Asset Type: ${OrderFormatters.getAssetTypeLabel(order.assetType)}`,
      `Currency: ${order.currency}`,
      `Quantity: ${OrderFormatters.formatQuantity(order.quantity)}`,
      `Price Type: ${order.priceType === 'market' ? 'Market' : 'Limit'}`,
    ];

    if (order.priceType === 'limit' && order.limitPrice) {
      lines.push(`Limit Price: ${OrderFormatters.formatWithCurrency(order.limitPrice, order.currency)}`);
    }

    if (order.estimatedValue) {
      lines.push(`Estimated Value: ${OrderFormatters.formatWithCurrency(order.estimatedValue, order.currency)}`);
    }

    if (order.broker) {
      lines.push(`Broker / Issuer: ${order.broker}`);
    }

    if (order.underlyings) {
      lines.push(`Underlyings: ${order.underlyings}`);
    }

    if (order.settlementCurrency) {
      lines.push(`Settlement Currency: ${order.settlementCurrency}`);
    }

    lines.push(
      '',
      '--- ACCOUNT DETAILS ---',
      `Client: ${client?.profile?.firstName || ''} ${client?.profile?.lastName || ''}`.trim(),
      `Bank: ${bank?.name || 'N/A'}`,
      `Account: ${bankAccount?.accountNumber || order.portfolioCode || 'N/A'}`,
      `Portfolio: ${order.portfolioCode || 'N/A'}`
    );

    if (order.notes) {
      lines.push('', '--- NOTES ---', order.notes);
    }

    lines.push(
      '',
      '---',
      'Please find attached the Order Confirmation PDF.',
      '',
      'Best regards,',
      'Ambervision Team'
    );

    return lines.join('\n');
  },

  // Generate email subject
  generateEmailSubject(order) {
    return `Order: ${order.orderReference} - ${order.orderType.toUpperCase()} ${order.securityName}`;
  }
};
