import { Mongo } from 'meteor/mongo';
import { check, Match } from 'meteor/check';
import { SECURITY_TYPES } from './constants/instrumentTypes';

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
//   fundQuantityMode: 'units' | 'nominal' (optional, fund orders only — interpretation of quantity),
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
//   // Creator attested they will attach the client-order trace later.
//   // Cleared when a CLIENT_ORDER emailTrace is uploaded.
//   clientOrderDeferred: { by: String, byName: String, at: Date } (optional),
//
//   // Validator attested they compared the order to the original client
//   // instruction even though no CLIENT_ORDER trace was attached at review time.
//   validationAttestation: { emailCompared: Boolean, by: String, byName: String, at: Date } (optional),
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
//   sentMethod: 'mailto' | 'sendpulse' | 'graph',
//
//   // Present when the order was sent from the user's own Outlook mailbox via
//   // Microsoft Graph. The ids are captured from the DRAFT before sending —
//   // sending moves the message to Sent Items under a new id, and
//   // internetMessageId is the only handle stable across that move (it is also
//   // what matches the bank's reply back to this order).
//   graphSend: {
//     draftId, internetMessageId, conversationId,
//     mailbox,                  // address it was sent from
//     sentBy, sentAt,
//     sentTraceStatus: 'pending' | 'attached'
//                               // 'pending' = the mail went out but the Sent
//                               // Items copy had not materialised yet, so the
//                               // order_to_bank trace still needs filing
//   } (optional),
//
//   // Bulk grouping
//   bulkOrderGroupId: String (optional),
//
//   // Additional fields
//   wealthAmbassador: String (optional),        // Auto-filled from creating user's initials
//   broker: String (optional),                   // Broker / Issuer (free text)
//   issuerId: String (optional),                 // Selected issuer (structured products)
//   issuerName: String (optional),               // Issuer name snapshotted at creation
//   issuerContact: {                             // Issuer coordinates snapshotted at creation,
//     name, email, phone, code, capturedAt       // so the order keeps what was on file then
//   } (optional),
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
//   // Listed option-specific fields. `quantity` is the number of CONTRACTS and
//   // `isin` is the literal 'OPT' - a listed contract has no tradeable ISIN of
//   // its own, so the underlying is carried separately.
//   optionType: 'call' | 'put',
//   optionStrike: Number,
//   optionExpiry: Date,
//   optionContractSize: Number (shares per contract, default 100),
//   optionUnderlyingIsin: String,
//   optionUnderlyingName: String,
//   optionUnderlyingTicker: String (optional),
//   optionExchange: String (optional),
//   optionContractSymbol: String (optional - OCC symbol e.g. AAPL261002C00315000,
//                         set when the contract was picked from the EOD chain),
//   optionQuoteAtEntry: { bid, ask, last, mid, impliedVolatility, delta,
//                         openInterest, updatedAt, source } (optional - the
//                         end-of-day quote shown to the desk when it entered
//                         the order; a record, never a live price),
//
//   // Short-call cover, snapshotted at creation. Never blocks the order - the
//   // four-eyes validator decides. See computeShortCallCoverage below.
//   coverageCheck: {
//     kind: 'short_call', underlyingIsin, underlyingName, contracts, contractSize,
//     requiredShares, heldShares, committedShares, availableShares,
//     isCovered, shortfallShares, holdingsAsOf, committedOrderRefs,
//     checkedAt, justification (optional, supplied by the trader)
//   } (optional),
//
//   // Modification / cancellation history (validated or rejected requests)
//   limitHistory: [{
//     _id: String, kind: 'amend' | 'cancel' (absent on old rows = amend),
//     price, priceType, stopLossPrice, takeProfitPrice, quantity, validityType, validityDate,  // before
//     newPrice, newPriceType, newStopLossPrice, newTakeProfitPrice, newQuantity, newValidityType, newValidityDate,
//     changedAt: Date, changedBy: String, changedByName: String, reason: String,
//     validatedAt, validatedBy, validatedByName, rejected: Boolean,
//     // The bank already had the order, so the change must be sent to it
//     bankNotice: { required: Boolean, sentAt: Date, sentMethod: 'graph'|'trace', sentBy: String, traceId: String }
//   }],
//
//   // A validated amendment/cancellation the bank has not been told about yet
//   pendingBankNotice: { kind: 'amend' | 'cancel', historyId: String, validatedAt: Date } | null,
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
//   // Traces (file or phone call)
//   emailTraces: [{
//     _id: String,
//     traceType: 'client_order' | 'order_to_bank' | 'bank_confirmation' | 'order_to_issuer' | 'initial_termsheet' | 'termsheet_sent' | 'termsheet_signed',
//     traceMode: 'file' | 'phone',
//     // File mode fields:
//     fileName: String,
//     storedFileName: String,
//     filePath: String,
//     mimeType: String,
//     fileSize: Number,
//     uploadedAt: Date,
//     uploadedBy: String,
//     // Provenance, present only when the message was picked from the user's
//     // Outlook mailbox rather than dropped in. Graph returns RFC-822 MIME, so
//     // the stored file is a .eml either way and everything downstream is
//     // unchanged; these fields just record where it came from.
//     source: 'graph' (optional),
//     graph: {
//       messageId, internetMessageId, conversationId,
//       receivedDateTime: Date, fromAddress
//     } (optional),
//     // Phone mode fields:
//     phoneCallTime: Date,
//     phoneCaller: String,
//     phoneCallee: String,
//     phoneNotes: String,
//     loggedAt: Date,
//     loggedBy: String
//   }]
// }

// Trace types for order documentation
export const EMAIL_TRACE_TYPES = {
  CLIENT_ORDER: 'client_order',
  ORDER_TO_BANK: 'order_to_bank',
  BANK_CONFIRMATION: 'bank_confirmation',
  ORDER_TO_ISSUER: 'order_to_issuer',
  INITIAL_TERMSHEET: 'initial_termsheet',
  TERMSHEET: 'termsheet',
  TERMSHEET_SENT: 'termsheet_sent',
  TERMSHEET_SIGNED: 'termsheet_signed',
  AMENDMENT_TO_BANK: 'amendment_to_bank',
  CANCELLATION_TO_BANK: 'cancellation_to_bank'
};

// An order can be amended more than once, so these traces accumulate instead of
// replacing the previous one of the same type (which would destroy evidence).
export const MULTI_INSTANCE_TRACE_TYPES = new Set([
  EMAIL_TRACE_TYPES.AMENDMENT_TO_BANK,
  EMAIL_TRACE_TYPES.CANCELLATION_TO_BANK
]);

// Trace type labels for display
export const EMAIL_TRACE_LABELS = {
  [EMAIL_TRACE_TYPES.CLIENT_ORDER]: 'Client Order',
  [EMAIL_TRACE_TYPES.ORDER_TO_BANK]: 'Order to Bank',
  [EMAIL_TRACE_TYPES.BANK_CONFIRMATION]: 'Bank Confirmation',
  [EMAIL_TRACE_TYPES.ORDER_TO_ISSUER]: 'Order to Issuer',
  [EMAIL_TRACE_TYPES.INITIAL_TERMSHEET]: 'Initial Termsheet',
  [EMAIL_TRACE_TYPES.TERMSHEET]: 'Signed Termsheet',
  [EMAIL_TRACE_TYPES.TERMSHEET_SENT]: 'Termsheet Sent',
  [EMAIL_TRACE_TYPES.TERMSHEET_SIGNED]: 'Signed Termsheet',
  [EMAIL_TRACE_TYPES.AMENDMENT_TO_BANK]: 'Amendment to Bank',
  [EMAIL_TRACE_TYPES.CANCELLATION_TO_BANK]: 'Cancellation to Bank'
};

// Trace types that document the termsheet workflow (separate from order trace count)
export const TERMSHEET_TRACE_TYPES = new Set([
  EMAIL_TRACE_TYPES.INITIAL_TERMSHEET,
  EMAIL_TRACE_TYPES.TERMSHEET,
  EMAIL_TRACE_TYPES.TERMSHEET_SENT,
  EMAIL_TRACE_TYPES.TERMSHEET_SIGNED
]);

// Trace modes (file upload or phone call log)
export const TRACE_MODES = {
  FILE: 'file',
  PHONE: 'phone'
};

// Accepted file types for email traces
export const EMAIL_TRACE_ACCEPTED_TYPES = ['.msg', '.eml', '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.html'];
export const EMAIL_TRACE_MAX_SIZE = 15 * 1024 * 1024; // 15MB

// Stricter accepted file types when uploading termsheet evidence (no images / HTML)
export const TERMSHEET_EVIDENCE_TYPES = ['.pdf', '.eml', '.msg'];

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

// Settlement tracking (orthogonal to order status)
export const SETTLEMENT_STATUSES = {
  PENDING: 'pending',       // Order executed, awaiting settlement confirmation
  SETTLED: 'settled',       // Confirmed settled via PMS operations matching
  FORCED: 'forced'          // Manually marked as settled (edge case)
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
  OPTION: 'option',
  OTHER: 'other'
};

// Listed option contract sides.
export const OPTION_TYPES = { CALL: 'call', PUT: 'put' };

// Shares per contract when the desk doesn't say otherwise. Listed equity
// options are 100 nearly everywhere, but it stays editable per order because
// index and adjusted contracts differ.
export const DEFAULT_OPTION_CONTRACT_SIZE = 100;

// Placeholder ISINs. FX, term deposits and listed options carry no tradeable
// ISIN of their own, so the order stores a literal marker instead. Anything
// keyed on a real ISIN (reclassification, settlement matching, the ISIN row in
// bank emails) has to recognise these and step around them.
export const PLACEHOLDER_ISINS = ['FX', 'TD', 'OPT'];
export function isPlaceholderIsin(isin) {
  return PLACEHOLDER_ISINS.includes(isin);
}

// Map a canonical SECURITY_TYPES value (as stored on securities/holdings) to the
// order book's narrower assetType enum. Used when a security is reclassified so
// existing orders stay in sync. Anything without a direct order equivalent
// (commodities, private markets, cash…) falls back to 'other'.
export const SECURITY_TYPE_TO_ASSET_TYPE = {
  [SECURITY_TYPES.EQUITY]: ASSET_TYPES.EQUITY,
  [SECURITY_TYPES.ETF]: ASSET_TYPES.ETF,
  [SECURITY_TYPES.BOND]: ASSET_TYPES.BOND,
  [SECURITY_TYPES.FUND]: ASSET_TYPES.FUND,
  [SECURITY_TYPES.MONEY_MARKET]: ASSET_TYPES.FUND,
  [SECURITY_TYPES.TERM_DEPOSIT]: ASSET_TYPES.TERM_DEPOSIT,
  [SECURITY_TYPES.STRUCTURED_PRODUCT]: ASSET_TYPES.STRUCTURED_PRODUCT,
  [SECURITY_TYPES.CERTIFICATE]: ASSET_TYPES.STRUCTURED_PRODUCT,
  [SECURITY_TYPES.FX_FORWARD]: ASSET_TYPES.FX,
  [SECURITY_TYPES.OPTION]: ASSET_TYPES.OPTION
};

// Map a holding's assetClass (as stored on pmsHoldings by the bank parsers,
// e.g. 'fixed_income', 'time_deposit', 'monetary_products') to the order
// book's assetType enum. Case-insensitive; anything unmapped (commodities,
// private equity, …) falls back to 'other'.
const ASSET_CLASS_TO_ASSET_TYPE = {
  equity: ASSET_TYPES.EQUITY,
  etf: ASSET_TYPES.ETF,
  bond: ASSET_TYPES.BOND,
  fixed_income: ASSET_TYPES.BOND,
  fund: ASSET_TYPES.FUND,
  funds: ASSET_TYPES.FUND,
  money_market: ASSET_TYPES.FUND,
  monetary_products: ASSET_TYPES.FUND,
  structured_product: ASSET_TYPES.STRUCTURED_PRODUCT,
  certificate: ASSET_TYPES.STRUCTURED_PRODUCT,
  term_deposit: ASSET_TYPES.TERM_DEPOSIT,
  time_deposit: ASSET_TYPES.TERM_DEPOSIT,
  fx: ASSET_TYPES.FX,
  fx_forward: ASSET_TYPES.FX
};

export function assetTypeForAssetClass(assetClass) {
  if (!assetClass) return ASSET_TYPES.OTHER;
  return ASSET_CLASS_TO_ASSET_TYPE[String(assetClass).toLowerCase()] || ASSET_TYPES.OTHER;
}

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

// ISO 4217 currencies with zero minor units — amounts are shown without
// decimals (e.g. JPY 25,000,000, not 25,000,000.00). All other currencies
// default to 2 decimals for FX amounts.
export const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG',
  'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
]);

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

// Validated and still working: not filled, cancelled or rejected
export const LIVE_ORDER_STATUSES = ['pending', 'transmitted', 'sent', 'partially_executed'];

// Orders that wait for a price (everything but market), TP/SL legs included
export const RESTING_PRICE_TYPES = [
  PRICE_TYPES.LIMIT, PRICE_TYPES.STOP_LIMIT, PRICE_TYPES.STOP_LOSS, PRICE_TYPES.TAKE_PROFIT
];

// Includes an order whose change request awaits validation (isLiveAtBank below)
export const isLiveRestingOrder = (order) =>
  isLiveAtBank(order) && RESTING_PRICE_TYPES.includes(order.priceType);

// Statuses in which the bank already has the order, so any change to it has to
// be sent to the bank as an amendment / cancellation ticket.
export const AT_BANK_ORDER_STATUSES = ['transmitted', 'sent', 'partially_executed'];

// Ticket variants: the original order instruction, an amendment, a cancellation
export const TICKET_KINDS = {
  ORDER: 'order',
  AMEND: 'amend',
  CANCEL: 'cancel'
};

/** Can a modification or cancellation be requested on this order? */
export const isModifiableOrder = (order) =>
  !!order && LIVE_ORDER_STATUSES.includes(order.status);

/**
 * Is this order still working at the bank? Same as a live status, plus an
 * order whose change request is awaiting four-eyes: until that is validated
 * and sent, the bank is still working the original instruction.
 */
export const isLiveAtBank = (order) =>
  !!order && (LIVE_ORDER_STATUSES.includes(order.status)
    || (order.status === 'pending_modification'
      && LIVE_ORDER_STATUSES.includes(order.pendingModification?.statusBeforeModification)));

// Statuses to query for orders working at the bank; refine with isLiveAtBank
export const LIVE_AT_BANK_QUERY_STATUSES = [...LIVE_ORDER_STATUSES, 'pending_modification'];

/**
 * Has the order's validity run out? Nothing expires orders automatically (the
 * bank is the source of truth), so a passed validity is only flagged.
 * Day: placed before today. GTD: validity date before today. GTC: never.
 */
export function isOrderValidityPassed(order, now = new Date()) {
  if (!order) return false;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (order.validityType === VALIDITY_TYPES.DAY) {
    return !!order.createdAt && new Date(order.createdAt) < startOfToday;
  }
  if (order.validityType === VALIDITY_TYPES.GTD) {
    return !!order.validityDate && new Date(order.validityDate) < startOfToday;
  }
  return false;
}

/** Quantity still working at the bank (total minus what was already filled). */
export const remainingOrderQuantity = (order) =>
  Math.max(0, (Number(order?.quantity) || 0) - (Number(order?.executedQuantity) || 0));

// Order source types (how the client instruction was received)
export const ORDER_SOURCE_TYPES = {
  EMAIL: 'email',
  PHONE: 'phone',
};

// Execution types (order timing relative to trade)
export const EXECUTION_TYPES = {
  TO_EXECUTE: 'to_execute',
  PRE_EXECUTED: 'pre_executed',
};

export const EXECUTION_TYPE_LABELS = {
  [EXECUTION_TYPES.TO_EXECUTE]: 'Order to be Executed',
  [EXECUTION_TYPES.PRE_EXECUTED]: 'Pre-Executed Order',
};

// Termsheet statuses (structured products only)
export const TERMSHEET_STATUSES = {
  NONE: 'none',
  SENT: 'sent',
  SIGNED: 'signed'
};

// Fund quantity modes — funds can be placed as a number of units OR as a
// nominal cash amount (subscription/redemption value). The quantity field
// holds the raw value the user typed; fundQuantityMode tells consumers how
// to interpret it.
export const FUND_QUANTITY_MODES = {
  UNITS: 'units',
  NOMINAL: 'nominal'
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

  // Format quantity. Whole quantities show no decimals (1,000 shares), but a
  // fractional quantity keeps its precision: the same field carries FX and
  // term-deposit cash amounts and fractional fund units, and rounding
  // 12,125.43 GBP to 12,125 misstates the order on the blotter and the ticket.
  formatQuantity(value) {
    if (typeof value !== 'number' || isNaN(value)) return '0';
    const isFractional = !Number.isInteger(value);
    return value.toLocaleString('en-US', {
      minimumFractionDigits: isFractional ? 2 : 0,
      maximumFractionDigits: isFractional ? 4 : 0
    });
  },

  // Format an FX amount with currency-aware decimals: 2 by default, 0 for
  // zero-minor-unit currencies (JPY, KRW, …). FX amounts must NOT be rounded
  // to integers — 181,422.62 ILS stays 181,422.62, not 181,423.
  formatFxAmount(value, currency) {
    if (typeof value !== 'number' || isNaN(value)) return '0';
    const decimals = ZERO_DECIMAL_CURRENCIES.has(String(currency || '').toUpperCase()) ? 0 : 2;
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  },

  // Derive the two legs of an FX order. Prefers the explicit fxBuyCurrency /
  // fxSellCurrency fields; falls back to the pair, which is stored as
  // BUY/SELL (e.g. "EUR/ILS" = buy EUR, sell ILS). Returns null when the order
  // isn't FX or the legs can't be determined, so callers fall back to plain B/S.
  fxLegs(order) {
    if (!order || order.assetType !== ASSET_TYPES.FX) return null;
    if (order.fxBuyCurrency && order.fxSellCurrency) {
      return { buy: order.fxBuyCurrency, sell: order.fxSellCurrency };
    }
    if (!order.fxPair) return null;
    const [buy, sell] = String(order.fxPair).split('/').map(s => s.trim());
    if (!buy || !sell) return null;
    return { buy, sell };
  },

  // Human-readable FX direction showing both legs, e.g. "Buy EUR / Sell ILS".
  // Falls back to the plain BUY/SELL label for non-FX or unparseable pairs.
  fxDirectionLabel(order) {
    const legs = this.fxLegs(order);
    if (!legs) return (order?.orderType || '').toUpperCase();
    return `Buy ${legs.buy} / Sell ${legs.sell}`;
  },

  // Human-readable order direction for confirmations/tickets. FX shows both legs;
  // a term deposit is increased or decreased (there is no "buy"/"sell" of a
  // deposit); everything else uses the plain BUY/SELL order type.
  /**
   * How the desk names an order's direction. The raw orderType is only ever
   * 'buy' or 'sell' because that is what the engine stores, but nobody "buys" a
   * term deposit — the client places more or takes some out — and an FX order's
   * direction is the pair, not a side. Every view shows this instead of the raw
   * field, so an order reads the same wherever it appears.
   */
  orderDirectionLabel(order) {
    if (!order) return '';
    if (order.assetType === ASSET_TYPES.FX) {
      // Prefer the server-formatted pair when the record carries it.
      return order.fxDirectionFormatted || this.fxDirectionLabel(order);
    }
    if (order.assetType === ASSET_TYPES.TERM_DEPOSIT) {
      return order.orderType === 'sell' ? 'Decrease' : 'Increase';
    }
    return (order.orderType || '').toUpperCase();
  },

  // Format order reference
  formatOrderReference(year, number) {
    return `${year}-${String(number).padStart(5, '0')}`;
  },

  // All order timestamps are displayed in Monaco time regardless of where the
  // code runs (the server runs in UTC, so omitting the zone shifts PDF tickets).
  DISPLAY_TIMEZONE: 'Europe/Monaco',

  // Format date for display
  formatDate(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleDateString('en-US', {
      timeZone: this.DISPLAY_TIMEZONE,
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  },

  // Format date with time
  formatDateTime(date) {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('en-US', {
      timeZone: this.DISPLAY_TIMEZONE,
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
    return new Date(date).toLocaleDateString('en-GB', {
      timeZone: this.DISPLAY_TIMEZONE,
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    });
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
      [ASSET_TYPES.OPTION]: 'Option',
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
      [TERMSHEET_STATUSES.NONE]: '#f59e0b',
      [TERMSHEET_STATUSES.SENT]: '#f59e0b',
      [TERMSHEET_STATUSES.SIGNED]: '#10b981'
    };
    return colors[status] || '#f59e0b';
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
 * Terminal statuses — the order will never proceed, so no further evidence is
 * expected and nothing should be reported as "missing".
 */
export const TERMINAL_ORDER_STATUSES = [ORDER_STATUSES.CANCELLED, ORDER_STATUSES.REJECTED];

export function isTerminalOrderStatus(status) {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/**
 * The trace types an order is expected to collect, derived from the order itself
 * (same rule the detail modal uses to decide which trace tiles to render).
 * Termsheet traces are excluded — they are tracked separately via termsheetStatus.
 */
export function getRequiredTraceTypes(order) {
  const types = [
    EMAIL_TRACE_TYPES.CLIENT_ORDER,
    EMAIL_TRACE_TYPES.ORDER_TO_BANK,
    EMAIL_TRACE_TYPES.BANK_CONFIRMATION
  ];
  if (order?.assetType === ASSET_TYPES.STRUCTURED_PRODUCT) {
    types.push(EMAIL_TRACE_TYPES.ORDER_TO_ISSUER);
  }
  return types;
}

/**
 * Trace completeness for the blotter badges and exports.
 *
 * A terminal order (cancelled / rejected) is never incomplete: it is normal for a
 * rejected order to hold only the traces captured before it died — the trade was
 * re-entered elsewhere. So we report the captured count with no denominator and a
 * neutral colour, mirroring getOrderHealthCheck() which returns '-' for these.
 *
 * Returns { count, max, label, color, isTerminal }.
 */
export function getTraceCompleteness(order) {
  const required = getRequiredTraceTypes(order);
  const traces = order?.emailTraces || [];
  const count = required.filter(type => traces.some(t => t.traceType === type)).length;

  if (isTerminalOrderStatus(order?.status)) {
    return {
      count,
      max: 0,
      label: count > 0 ? String(count) : '-',
      color: 'var(--text-muted)',
      isTerminal: true
    };
  }

  const max = required.length;
  return {
    count,
    max,
    label: `${count}/${max}`,
    color: count === max ? 'var(--gain-color)' : count > 0 ? 'var(--warning-color)' : 'var(--text-muted)',
    isTerminal: false
  };
}

/**
 * Single source of truth for price quotation convention. Structured products and
 * bonds carry limitPrice/executedPrice as a percentage of par (100 = 100 %);
 * every other asset type uses absolute currency prices. Shared by the display
 * formatter and the PMS settlement matcher, which has to translate incoming
 * bank prices into this convention — keeping one definition means a new
 * percent-quoted asset type only has to be added here.
 */
/**
 * Is this order a written (short) call? That is the only side that needs cover:
 * a long option can always be abandoned, a short put settles in cash, but a
 * short call can be assigned and the underlying has to be delivered.
 */
export function isShortCall(order) {
  return !!order
    && order.assetType === ASSET_TYPES.OPTION
    && order.optionType === OPTION_TYPES.CALL
    && order.orderType === 'sell';
}

/**
 * Human-readable contract, e.g. "Anheuser-Busch InBev CALL 60 19 Dec 2026".
 * The multiplier is only shown when it isn't the standard 100, so the common
 * case stays short.
 */
export function optionContractDescription(order) {
  if (!order || order.assetType !== ASSET_TYPES.OPTION) return '';
  const parts = [];
  if (order.optionUnderlyingName) parts.push(order.optionUnderlyingName);
  if (order.optionType) parts.push(order.optionType.toUpperCase());
  if (order.optionStrike != null) parts.push(String(order.optionStrike));
  if (order.optionExpiry) {
    parts.push(new Date(order.optionExpiry).toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric'
    }));
  }
  const size = order.optionContractSize;
  if (size && size !== DEFAULT_OPTION_CONTRACT_SIZE) parts.push(`x${size}`);
  return parts.join(' ');
}

/**
 * Does the account hold enough of the underlying to cover a short call?
 *
 * Pure on purpose: the order modal previews with it against the holdings it has
 * already loaded, and the server records the result with it. One function means
 * the number the desk was shown and the number in the audit trail cannot drift.
 *
 * `committedContracts` is the contracts already written against this underlying
 * by other live orders. Without it, two 750-contract calls each look covered
 * against 150,000 shares while together they are twice the position.
 *
 * @param {Object[]} holdings - candidate positions in the SAME bank account
 * @returns {Object} the arithmetic, all in shares
 */
export function computeShortCallCoverage({
  contracts,
  contractSize = DEFAULT_OPTION_CONTRACT_SIZE,
  underlyingIsin,
  holdings = [],
  committedContracts = 0
}) {
  const size = Number(contractSize) || DEFAULT_OPTION_CONTRACT_SIZE;
  const requiredShares = (Number(contracts) || 0) * size;
  const committedShares = (Number(committedContracts) || 0) * size;

  // Sum every matching row rather than taking the first: a bank can split one
  // ISIN across sub-positions of the same account.
  const wanted = String(underlyingIsin || '').toUpperCase();
  const heldShares = wanted
    ? holdings.reduce((sum, h) => (
      String(h?.isin || '').toUpperCase() === wanted ? sum + (Number(h.quantity) || 0) : sum
    ), 0)
    : 0;

  const availableShares = heldShares - committedShares;
  const shortfallShares = Math.max(0, requiredShares - availableShares);

  return {
    requiredShares,
    heldShares,
    committedShares,
    availableShares,
    isCovered: shortfallShares === 0,
    shortfallShares
  };
}

export function quotesPriceAsPercent(assetType) {
  return assetType === ASSET_TYPES.STRUCTURED_PRODUCT || assetType === ASSET_TYPES.BOND;
}

/**
 * Consideration of an order from its own quantity and limit price, or null
 * when the order does not carry a price (market orders, FX, deposits, funds
 * entered as a cash amount). Percent-of-par instruments divide by 100; option
 * premiums are per share, so they scale by the contract size.
 */
export function computeOrderEstimatedValue({ assetType, quantity, limitPrice, optionContractSize, fundQuantityMode }) {
  const qty = Number(quantity);
  const price = Number(limitPrice);
  if (!(qty > 0) || !(price > 0)) return null;
  if (assetType === ASSET_TYPES.FX || assetType === ASSET_TYPES.TERM_DEPOSIT) return null;
  if (assetType === ASSET_TYPES.FUND && fundQuantityMode === FUND_QUANTITY_MODES.NOMINAL) return null;

  const value = quotesPriceAsPercent(assetType)
    ? qty * price / 100
    : qty * price * (assetType === ASSET_TYPES.OPTION ? (Number(optionContractSize) || DEFAULT_OPTION_CONTRACT_SIZE) : 1);
  return Math.round(value * 100) / 100;
}

/**
 * Order health check - computes completeness score based on order status and required items.
 * Returns { score, max, missing, color } where score/max is the fraction and missing lists what's absent.
 */
// Sentinel for the order-book health filter: "any incomplete order" rather
// than one named missing item.
export const HEALTH_FILTER_ANY = '__any__';

export function getOrderHealthCheck(order) {
  if (!order) return { score: 0, max: 1, missing: [], color: '#6b7280' };

  const traces = order.emailTraces || [];
  const hasTrace = (type) => traces.some(t => t.traceType === type);
  const checks = [];

  // Terminal statuses — no health check needed
  if (isTerminalOrderStatus(order.status)) {
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

  // 3. Order sent to bank (required once validated, even before SENT)
  const postSentStatuses = [ORDER_STATUSES.SENT, ORDER_STATUSES.EXECUTED, ORDER_STATUSES.PARTIALLY_EXECUTED];
  if (postValidationStatuses.includes(order.status)) {
    checks.push({ name: 'Order to bank', ok: hasTrace(EMAIL_TRACE_TYPES.ORDER_TO_BANK) });
  }

  // 4. Order sent to issuer (structured products only, required once validated)
  if (order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT && postValidationStatuses.includes(order.status)) {
    checks.push({ name: 'Order to issuer', ok: hasTrace(EMAIL_TRACE_TYPES.ORDER_TO_ISSUER) });
  }

  // 5. Termsheet signed (buy structured products only, once sent+). Sell orders
  // never require a termsheet.
  if (order.assetType === ASSET_TYPES.STRUCTURED_PRODUCT && order.orderType === 'buy' && postSentStatuses.includes(order.status)) {
    checks.push({ name: 'Termsheet signed', ok: order.termsheetStatus === TERMSHEET_STATUSES.SIGNED });
  }

  // 6. Bank confirmation (required for executed orders)
  const executedStatuses = [ORDER_STATUSES.EXECUTED, ORDER_STATUSES.PARTIALLY_EXECUTED];
  if (executedStatuses.includes(order.status)) {
    checks.push({ name: 'Bank confirmation', ok: hasTrace(EMAIL_TRACE_TYPES.BANK_CONFIRMATION) });
  }

  // 6. Execution price (required for executed orders). A term deposit is placed
  // at a rate, not bought at a price, so it never has one.
  if (executedStatuses.includes(order.status) && order.assetType !== ASSET_TYPES.TERM_DEPOSIT) {
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

  // Propagate a security reclassification to existing orders. When a security's
  // classification changes in SecuritiesBase, every order referencing that ISIN
  // should show the same asset type (mirrors PMSHoldingsHelpers.reclassifyByIsin).
  // Returns the number of orders updated. Server-side only.
  async reclassifyByIsin(isin, { securityType, securityName } = {}) {
    if (!isin) throw new Error('ISIN is required for reclassification');
    if (!securityType) throw new Error('securityType is required for reclassification');

    // FX, term-deposit and option orders store a literal marker in `isin`
    // ('FX' / 'TD' / 'OPT'), not a real one. Reclassifying by such a value would
    // rewrite the asset type of every order of that kind at once.
    if (isPlaceholderIsin(isin)) {
      return { modifiedCount: 0, isin, assetType: null, skipped: 'placeholder-isin' };
    }

    const assetType = SECURITY_TYPE_TO_ASSET_TYPE[securityType] || ASSET_TYPES.OTHER;

    const $set = { assetType, updatedAt: new Date() };
    // Harmonize the display name across banks. Bank's raw `securityName` is left
    // untouched; the canonical name lives in `displayName`.
    if (securityName) $set.displayName = securityName;

    // Only touch orders that actually carry this ISIN. FX / term-deposit /
    // option orders carry a placeholder and are excluded above.
    const modified = await OrdersCollection.updateAsync(
      { isin },
      { $set },
      { multi: true }
    );

    return { modifiedCount: modified, isin, assetType };
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

    // Structured products and bonds quote prices as a percentage of par; everything else uses absolute currency.
    const quotesAsPercent = quotesPriceAsPercent(order.assetType);
    // Price formatter for price-only fields (limit, executed, stop). The
    // table/detail views always show the currency in a separate column, so
    // we deliberately drop the currency code here to avoid duplicating it
    // (e.g. "USD 18.72" → "18.72"). Structured products and bonds still get
    // the % suffix because that's the unit of quotation, not a currency.
    const formatPriceForOrder = (price) => {
      if (price === null || price === undefined) return null;
      if (quotesAsPercent) return `${Number(price).toFixed(2)}%`;
      return Number(price).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4
      });
    };

    // For FX and term deposits the "quantity" is a cash amount, so it is always
    // shown with its minor units (12,125.43 GBP) — same rule as the order
    // ticket. Unit-based quantities stay whole unless genuinely fractional.
    const isCashAmountQuantity = order.assetType === ASSET_TYPES.FX
      || order.assetType === ASSET_TYPES.TERM_DEPOSIT;
    const amountCurrency = order.fxAmountCurrency || order.depositCurrency || order.currency;
    const formatQuantityForOrder = (value) => (
      isCashAmountQuantity && typeof value === 'number' && !isNaN(value)
        ? OrderFormatters.formatFxAmount(value, amountCurrency)
        : OrderFormatters.formatQuantity(value)
    );

    return {
      ...order,
      // Pre-format dates
      createdAtFormatted: OrderFormatters.formatDateShort(order.createdAt),
      createdAtFull: OrderFormatters.formatDateTime(order.createdAt),
      sentAtFormatted: OrderFormatters.formatDateTime(order.sentAt),
      executionDateFormatted: OrderFormatters.formatDate(order.executionDate),
      cancelledAtFormatted: OrderFormatters.formatDateTime(order.cancelledAt),
      // Pre-format numbers
      quantityFormatted: formatQuantityForOrder(order.quantity),
      executedQuantityFormatted: formatQuantityForOrder(order.executedQuantity || 0),
      limitPriceFormatted: order.limitPrice ? formatPriceForOrder(order.limitPrice) : null,
      executedPriceFormatted: order.executedPrice ? formatPriceForOrder(order.executedPrice) : null,
      estimatedValueFormatted: order.estimatedValue ? OrderFormatters.formatWithCurrency(order.estimatedValue, order.currency) : null,
      // Pre-format labels
      statusLabel: OrderFormatters.getStatusLabel(order.status),
      statusColor: OrderFormatters.getStatusColor(order.status),
      // Effective status: overlays "Settled" on executed orders once settlement is confirmed/forced.
      // Keeps settlement orthogonal in the data model but presents it as a unified status in the UI.
      ...(() => {
        const isSettled = order.settlementStatus === SETTLEMENT_STATUSES.SETTLED;
        const isForced = order.settlementStatus === SETTLEMENT_STATUSES.FORCED;
        if (isSettled || isForced) {
          return {
            effectiveStatusLabel: isForced ? 'Settled (Forced)' : 'Settled',
            effectiveStatusColor: isForced ? '#6366f1' : '#059669',
            canForceSettle: false
          };
        }
        const canForceSettle = order.status === ORDER_STATUSES.EXECUTED || order.status === ORDER_STATUSES.PARTIALLY_EXECUTED;
        return {
          effectiveStatusLabel: OrderFormatters.getStatusLabel(order.status),
          effectiveStatusColor: OrderFormatters.getStatusColor(order.status),
          canForceSettle
        };
      })(),
      assetTypeLabel: OrderFormatters.getAssetTypeLabel(order.assetType),
      orderTypeLabel: order.orderType === 'buy' ? 'Buy' : 'Sell',
      priceTypeLabel: OrderFormatters.getPriceTypeLabel(order.priceType),
      tradeModeLabel: order.tradeMode === 'block' ? 'Block' : 'Ind.',
      wealthAmbassadorFormatted: order.wealthAmbassador || '',
      termsheetLabel: OrderFormatters.getTermsheetLabel(order.termsheetStatus),
      termsheetColor: OrderFormatters.getTermsheetColor(order.termsheetStatus),
      termsheetUpdatedByFormatted: order.termsheetUpdatedBy || null,
      termsheetUpdatedAtFormatted: order.termsheetUpdatedAt ? OrderFormatters.formatDateTime(order.termsheetUpdatedAt) : null,
      termsheetSentTrace: (order.emailTraces || []).find(t => t.traceType === EMAIL_TRACE_TYPES.TERMSHEET_SENT) || null,
      termsheetSignedTrace: (order.emailTraces || []).find(t => t.traceType === EMAIL_TRACE_TYPES.TERMSHEET_SIGNED) || null,
      // FX-specific formatted fields
      fxPairFormatted: order.fxPair || null,
      fxDirectionFormatted: order.assetType === ASSET_TYPES.FX ? OrderFormatters.fxDirectionLabel(order) : null,
      fxSubtypeLabel: order.fxSubtype === 'forward' ? 'Forward' : order.fxSubtype === 'spot' ? 'Spot' : null,
      fxRateFormatted: order.fxRate ? order.fxRate.toFixed(4) : null,
      fxAmountCurrencyFormatted: order.fxAmountCurrency || null,
      fxForwardDateFormatted: order.fxForwardDate ? OrderFormatters.formatDate(order.fxForwardDate) : null,
      fxValueDateFormatted: order.fxValueDate ? OrderFormatters.formatDate(order.fxValueDate) : null,
      stopLossPriceFormatted: order.stopLossPrice ? order.stopLossPrice.toFixed(4) : null,
      takeProfitPriceFormatted: order.takeProfitPrice ? order.takeProfitPrice.toFixed(4) : null,
      // Term Deposit-specific formatted fields
      depositTenorLabel: order.depositTenor ? (TERM_DEPOSIT_TENORS.find(t => t.value === order.depositTenor)?.label || order.depositTenor) : null,
      depositMaturityDateFormatted: order.depositMaturityDate ? OrderFormatters.formatDate(order.depositMaturityDate) : null,
      depositAction: order.depositAction || null,
      // Listed option-specific formatted fields. Each is driven by its own field
      // rather than by assetType: reclassification can leave an order typed
      // 'option' with none of the contract details filled in.
      optionTypeLabel: order.optionType ? order.optionType.toUpperCase() : null,
      optionStrikeFormatted: order.optionStrike != null
        ? Number(order.optionStrike).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
        : null,
      optionExpiryFormatted: order.optionExpiry ? OrderFormatters.formatDate(order.optionExpiry) : null,
      optionContractSizeFormatted: order.optionContractSize != null ? String(order.optionContractSize) : null,
      optionUnderlyingFormatted: order.optionUnderlyingName || order.optionUnderlyingIsin || null,
      optionUnderlyingIsin: order.optionUnderlyingIsin || null,
      optionExchangeFormatted: order.optionExchange || null,
      optionContractSymbol: order.optionContractSymbol || null,
      optionQuoteAtEntryFormatted: order.optionQuoteAtEntry ? {
        ...order.optionQuoteAtEntry,
        bidAskFormatted: (order.optionQuoteAtEntry.bid != null && order.optionQuoteAtEntry.ask != null)
          ? `${order.optionQuoteAtEntry.bid} / ${order.optionQuoteAtEntry.ask}`
          : null,
        midFormatted: order.optionQuoteAtEntry.mid != null ? Number(order.optionQuoteAtEntry.mid).toFixed(2) : null,
        impliedVolatilityFormatted: order.optionQuoteAtEntry.impliedVolatility != null
          ? `${Number(order.optionQuoteAtEntry.impliedVolatility).toFixed(1)}%`
          : null,
        deltaFormatted: order.optionQuoteAtEntry.delta != null ? Number(order.optionQuoteAtEntry.delta).toFixed(2) : null
      } : null,
      optionContractDescription: order.assetType === ASSET_TYPES.OPTION ? optionContractDescription(order) : null,
      // Shares the contracts represent - the number that actually matters for risk.
      optionShareEquivalent: (order.assetType === ASSET_TYPES.OPTION && order.quantity && order.optionContractSize)
        ? order.quantity * order.optionContractSize
        : null,
      optionShareEquivalentFormatted: (order.assetType === ASSET_TYPES.OPTION && order.quantity && order.optionContractSize)
        ? OrderFormatters.formatQuantity(order.quantity * order.optionContractSize)
        : null,
      // `quantity` carries a different unit per asset type and formatQuantity
      // returns a bare number, so every render site needs this to say what the
      // number counts. Contracts are the first unit not implied by the name.
      quantityUnitLabel: order.assetType === ASSET_TYPES.OPTION ? 'contracts' : null,
      // Short-call cover as recorded when the order was raised.
      coverageCheckFormatted: order.coverageCheck ? {
        ...order.coverageCheck,
        requiredSharesFormatted: OrderFormatters.formatQuantity(order.coverageCheck.requiredShares || 0),
        heldSharesFormatted: OrderFormatters.formatQuantity(order.coverageCheck.heldShares || 0),
        committedSharesFormatted: OrderFormatters.formatQuantity(order.coverageCheck.committedShares || 0),
        availableSharesFormatted: OrderFormatters.formatQuantity(order.coverageCheck.availableShares || 0),
        shortfallSharesFormatted: OrderFormatters.formatQuantity(order.coverageCheck.shortfallShares || 0),
        checkedAtFormatted: order.coverageCheck.checkedAt ? OrderFormatters.formatDateTime(order.coverageCheck.checkedAt) : null,
        holdingsAsOfFormatted: order.coverageCheck.holdingsAsOf ? OrderFormatters.formatDate(order.coverageCheck.holdingsAsOf) : null
      } : null,
      // Limit modification history
      limitHistoryFormatted: (order.limitHistory || []).map(entry => ({
        ...entry,
        changedAtFormatted: OrderFormatters.formatDateTime(entry.changedAt),
        validatedAtFormatted: entry.validatedAt ? OrderFormatters.formatDateTime(entry.validatedAt) : null,
        rejectedAtFormatted: entry.rejectedAt ? OrderFormatters.formatDateTime(entry.rejectedAt) : null,
        priceTypeLabel: OrderFormatters.getPriceTypeLabel(entry.priceType),
        newPriceTypeLabel: entry.newPriceType ? OrderFormatters.getPriceTypeLabel(entry.newPriceType) : null,
        kindLabel: entry.kind === TICKET_KINDS.CANCEL ? 'Cancellation' : 'Amendment',
        changeRows: entry.kind === TICKET_KINDS.CANCEL ? [] : OrderHelpers.describeOrderChange(entry, order),
        bankNoticeSentAtFormatted: entry.bankNotice?.sentAt ? OrderFormatters.formatDateTime(entry.bankNotice.sentAt) : null
      })),
      isModifiable: isModifiableOrder(order),
      // Badge for the live blotter / PMS pills while a change is in flight
      changePendingLabel: order.status === 'pending_modification'
        ? (order.pendingModification?.kind === TICKET_KINDS.CANCEL ? 'cancellation pending' : 'change pending')
        : (order.pendingBankNotice ? 'bank not yet notified' : null),
      pendingBankNoticeLabel: order.pendingBankNotice
        ? (order.pendingBankNotice.kind === TICKET_KINDS.CANCEL ? 'Cancellation not yet sent to bank' : 'Amendment not yet sent to bank')
        : null,
      // Executed-price modification history (inline edits from the blotter)
      executedPriceHistoryFormatted: (order.executedPriceHistory || []).map(entry => ({
        ...entry,
        changedAtFormatted: OrderFormatters.formatDateTime(entry.changedAt),
        previousPriceFormatted: entry.previousPrice != null ? formatPriceForOrder(entry.previousPrice) : null,
        newPriceFormatted: entry.newPrice != null ? formatPriceForOrder(entry.newPrice) : null
      })),
      quotesAsPercent,
      // Validity fields
      validityType: order.validityType || null,
      validityLabel: order.validityType === 'gtc' ? 'Good Till Canceled' : order.validityType === 'gtd' ? `Good Till ${order.validityDate ? OrderFormatters.formatDate(order.validityDate) : 'Date'}` : order.validityType === 'day' ? 'Day Order' : null,
      validityDateFormatted: order.validityDate ? OrderFormatters.formatDate(order.validityDate) : null,
      // Linked orders (TP/SL legs)
      parentOrderRef: order.parentOrderRef || null,
      linkedOrderType: order.linkedOrderType || null,
      linkedOrderGroup: order.linkedOrderGroup || null,
      stopPriceFormatted: order.stopPrice ? formatPriceForOrder(order.stopPrice) : null,
      // Live resting order (limit / stop / take-profit still working at the bank)
      ...(() => {
        const typeLabel = { limit: 'Limit', stop_limit: 'Stop limit', stop_loss: 'Stop', take_profit: 'Take profit' }[order.priceType] || null;
        const stop = order.stopPrice ?? order.stopLossPrice;
        const target = order.limitPrice ?? (order.priceType === PRICE_TYPES.TAKE_PROFIT ? order.takeProfitPrice : null);
        // The price the order waits for: stop limit shows both trigger and limit
        const triggerText = order.priceType === PRICE_TYPES.STOP_LIMIT
          ? [stop != null ? `stop ${formatPriceForOrder(stop)}` : null, target != null ? `limit ${formatPriceForOrder(target)}` : null].filter(Boolean).join(' / ')
          : formatPriceForOrder(order.priceType === PRICE_TYPES.STOP_LOSS ? (stop ?? target) : (target ?? stop));
        const remaining = remainingOrderQuantity(order);
        const partlyFilled = (Number(order.executedQuantity) || 0) > 0;
        const validityShort = order.validityType === VALIDITY_TYPES.GTC ? 'GTC'
          : order.validityType === VALIDITY_TYPES.GTD ? `GTD ${order.validityDate ? OrderFormatters.formatDate(order.validityDate) : ''}`.trim()
            : order.validityType === VALIDITY_TYPES.DAY ? 'Day' : null;
        return {
          isLiveResting: isLiveRestingOrder(order),
          restingTypeLabel: typeLabel,
          triggerPriceFormatted: triggerText || null,
          remainingQuantityFormatted: formatQuantityForOrder(remaining),
          remainingOfTotalFormatted: partlyFilled
            ? `${formatQuantityForOrder(remaining)} of ${formatQuantityForOrder(order.quantity)}`
            : formatQuantityForOrder(order.quantity),
          validityShort,
          validityPassed: isOrderValidityPassed(order),
          // Market watch (server/helpers/limitOrderWatch.js): last price seen
          // and whether the order's level has been reached
          lastSeenPriceFormatted: Number.isFinite(order.priceWatch?.lastPrice) ? formatPriceForOrder(order.priceWatch.lastPrice) : null,
          lastSeenText: Number.isFinite(order.priceWatch?.lastPrice)
            ? `${/intraday/i.test(order.priceWatch.source || '') ? OrderFormatters.formatDateTime(order.priceWatch.lastPriceAt) : OrderFormatters.formatDate(order.priceWatch.lastPriceAt)} · ${order.priceWatch.source || ''}`.trim()
            : (order.priceWatch?.issue || null),
          priceWatchIssue: order.priceWatch?.issue || null,
          levelReached: !!order.levelReached,
          levelReachedText: order.levelReached
            ? `Level reached: ${formatPriceForOrder(order.levelReached.price)} on ${OrderFormatters.formatDate(order.levelReached.date)} (${order.levelReached.source})${order.levelReached.onPlacementDay ? ', on the day the order was placed' : ''}. Probably executed: check with the bank`
            : null,
          // e.g. "Limit sell 250,000 @ 82.05%"
          restingLabel: typeLabel
            ? `${typeLabel} ${order.orderType || ''} ${formatQuantityForOrder(remaining)}${triggerText ? ` @ ${triggerText}` : ''}`.replace(/\s+/g, ' ').trim()
            : null
        };
      })(),
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

  /**
   * The issuer behind a structured-product order, with contact coordinates.
   *
   * The snapshot taken when the order was created wins - it is what the issuer's
   * coordinates were at the time, which is what the desk needs to reach them
   * about THIS trade. `liveIssuer` (an IssuersCollection document) is the
   * fallback for orders placed before snapshots existed; callers that can hit
   * the database pass it in.
   *
   * Returns null for anything that isn't a structured product with an issuer.
   */
  resolveIssuerContact(order, liveIssuer = null) {
    if (!order || order.assetType !== ASSET_TYPES.STRUCTURED_PRODUCT) return null;

    const snap = order.issuerContact;
    if (snap && (snap.name || snap.email || snap.phone)) {
      return {
        name: order.issuerName || liveIssuer?.name || '',
        contactName: snap.name || '',
        contactEmail: snap.email || '',
        contactPhone: snap.phone || ''
      };
    }

    if (liveIssuer) {
      return {
        name: liveIssuer.name || order.issuerName || '',
        contactName: liveIssuer.contactName || '',
        contactEmail: liveIssuer.contactEmail || '',
        contactPhone: liveIssuer.contactPhone || ''
      };
    }

    // Name only - still worth putting in the subject line.
    return order.issuerName
      ? { name: order.issuerName, contactName: '', contactEmail: '', contactPhone: '' }
      : null;
  },

  /** Does this issuer record carry anything the desk could actually reach? */
  hasIssuerCoordinates(issuer) {
    return !!(issuer && (issuer.contactName || issuer.contactEmail || issuer.contactPhone));
  },

  /**
   * The fields a validated amendment changed, as display rows
   * [{ label, from, to }]. Shared by the amendment ticket PDF and its email
   * body so the two cannot list different changes.
   */
  describeOrderChange(entry, order = {}) {
    if (!entry) return [];
    const asPercent = quotesPriceAsPercent(order.assetType);
    const price = (v) => {
      if (v === null || v === undefined || v === '') return '—';
      if (asPercent) return `${Number(v).toFixed(2)}%`;
      const ccy = order.currency ? ` ${order.currency}` : '';
      return `${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${ccy}`;
    };
    const qty = (v) => (v === null || v === undefined) ? '—' : OrderFormatters.formatQuantity(v);
    const validity = (type, date) => {
      if (type === VALIDITY_TYPES.GTC) return 'Good Till Canceled';
      if (type === VALIDITY_TYPES.GTD) return `Good Till ${date ? OrderFormatters.formatDate(date) : 'Date'}`;
      if (type === VALIDITY_TYPES.DAY) return 'Day';
      return '—';
    };
    // Old rows predate quantity/validity: "undefined" means not part of the change
    const has = (key) => entry[key] !== undefined;
    const rows = [];
    const push = (label, from, to) => { if (from !== to) rows.push({ label, from, to }); };

    if (has('newPriceType')) {
      push('Price type', OrderFormatters.getPriceTypeLabel(entry.priceType), OrderFormatters.getPriceTypeLabel(entry.newPriceType));
    }
    if (has('newPrice')) push('Limit price', price(entry.price), price(entry.newPrice));
    if (has('newStopLossPrice')) push('Stop loss', price(entry.stopLossPrice), price(entry.newStopLossPrice));
    if (has('newTakeProfitPrice')) push('Take profit', price(entry.takeProfitPrice), price(entry.newTakeProfitPrice));
    if (has('newQuantity')) push('Quantity', qty(entry.quantity), qty(entry.newQuantity));
    if (has('newValidityType')) {
      push('Validity', validity(entry.validityType, entry.validityDate), validity(entry.newValidityType, entry.newValidityDate));
    }
    return rows;
  },

  // Generate email body for mailto. `options.ticketKind` turns it into an
  // amendment / cancellation notice; `options.change` is the limitHistory entry.
  generateEmailBody(order, client, bank, bankAccount, liveIssuer = null, deskLabel = 'Trading Desk', options = {}) {
    const ticketKind = options.ticketKind || TICKET_KINDS.ORDER;
    const clientName = client
      ? (client.profile?.clientType === 'company'
        ? (client.profile?.companyName || 'our client')
        : `${client.profile?.firstName || ''} ${client.profile?.lastName || ''}`.trim() || 'our client')
      : 'our client';
    const accountNumber = bankAccount?.accountNumber || order.portfolioCode || '';

    const issuer = OrderHelpers.resolveIssuerContact(order, liveIssuer);
    const forAccount = `for the account of ${clientName}${accountNumber ? ` (account ${accountNumber})` : ''}`;
    const originalSentAt = order.transmittedAt || order.sentAt;
    const sentOn = originalSentAt ? ` sent on ${OrderFormatters.formatDate(originalSentAt)}` : '';

    const lines = [
      // The mail goes to a desk address with several people in copy, so it opens
      // to all of them rather than to a desk label or one named recipient.
      'Dear all,',
      ''
    ];

    if (ticketKind === TICKET_KINDS.CANCEL) {
      const remaining = remainingOrderQuantity(order);
      lines.push(
        `Please CANCEL our order instruction (Ref: ${order.orderReference})${sentOn}, ${forAccount}.`,
        '',
        `${OrderFormatters.orderDirectionLabel(order).toUpperCase()} ${order.securityName}${order.isin ? ` (${order.isin})` : ''}`,
        `Quantity to cancel: ${OrderFormatters.formatQuantity(remaining)}${order.executedQuantity ? ` (of ${OrderFormatters.formatQuantity(order.quantity)}; ${OrderFormatters.formatQuantity(order.executedQuantity)} already executed)` : ''}`,
        '',
        'The cancellation instruction is attached.',
        '',
        'We kindly ask you to cancel this order at your earliest convenience and confirm the cancellation.'
      );
    } else if (ticketKind === TICKET_KINDS.AMEND) {
      lines.push(
        `Please AMEND our order instruction (Ref: ${order.orderReference})${sentOn}, ${forAccount}, as follows:`,
        ''
      );
      for (const row of OrderHelpers.describeOrderChange(options.change, order)) {
        lines.push(`${row.label}: ${row.from} -> ${row.to}`);
      }
      lines.push(
        '',
        'The amended order instruction is attached. All other terms are unchanged.',
        '',
        'We kindly ask you to apply this amendment at your earliest convenience and confirm.'
      );
    } else {
      lines.push(`Please find attached an order instruction (Ref: ${order.orderReference}) ${forAccount}.`);
    }

    if (ticketKind !== TICKET_KINDS.ORDER) {
      lines.push(
        '',
        'Should you require any additional information, please do not hesitate to contact us.',
        '',
        'Kind regards,',
        'Amberlake Partners'
      );
      return lines.join('\n');
    }

    // The desk deals directly with the issuer on a structured product, so give
    // them the coordinates rather than making them come back and ask.
    if (issuer?.name || OrderHelpers.hasIssuerCoordinates(issuer)) {
      lines.push('');
      if (issuer.name) lines.push(`Issuer: ${issuer.name}`);
      if (issuer.contactName) lines.push(`Contact: ${issuer.contactName}`);
      if (issuer.contactEmail) lines.push(`Email: ${issuer.contactEmail}`);
      if (issuer.contactPhone) lines.push(`Phone: ${issuer.contactPhone}`);
    }

    lines.push(
      '',
      'We kindly ask you to process this order at your earliest convenience and confirm execution.',
      '',
      'Should you require any additional information, please do not hesitate to contact us.',
      '',
      'Kind regards,',
      'Amberlake Partners'
    );

    return lines.join('\n');
  },

  // Generate email subject
  generateEmailSubject(order, liveIssuer = null, ticketKind = TICKET_KINDS.ORDER) {
    const isinPart = order.isin ? ` (${order.isin})` : '';
    // The desk finds the original by its reference, so the prefix goes in front
    // of the unchanged original subject.
    const prefix = ticketKind === TICKET_KINDS.CANCEL ? 'CANCELLATION: '
      : ticketKind === TICKET_KINDS.AMEND ? 'AMENDMENT: ' : '';
    // "BUY Term Deposit" is not how the desk or the bank talks about a deposit —
    // orderDirectionLabel gives INCREASE / DECREASE there, and the pair for FX.
    const direction = OrderFormatters.orderDirectionLabel(order).toUpperCase();
    // The issuer is what the desk routes a structured-product order by, so it
    // belongs in the subject where they see it without opening the mail.
    const issuer = OrderHelpers.resolveIssuerContact(order, liveIssuer);
    const issuerPart = issuer?.name ? ` - Issuer: ${issuer.name}` : '';
    return `${prefix}Order: ${order.orderReference} - ${direction} ${order.securityName}${isinPart}${issuerPart}`;
  }
};
