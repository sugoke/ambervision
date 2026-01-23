/**
 * AMBERVISION STANDARD OPERATION TYPES TAXONOMY
 *
 * This file is the SINGLE SOURCE OF TRUTH for operation/transaction classification.
 * All bank parsers MUST output one of these OPERATION_TYPES.
 *
 * IMPORTANT: When adding a new bank operation parser, import OPERATION_TYPES from this file
 * and use these constants in your mapOperationType() function.
 */

// =============================================================================
// OPERATION TYPES (Parser Output)
// =============================================================================
// These are the ONLY valid values for PMSOperations.operationType
// All bank parsers must map their bank-specific codes to one of these values

export const OPERATION_TYPES = {
  // Securities Trading
  BUY: 'BUY',                          // Securities purchase
  SELL: 'SELL',                        // Securities sale
  SUBSCRIPTION: 'SUBSCRIPTION',         // New issue subscription

  // Income
  DIVIDEND: 'DIVIDEND',                // Dividend payment
  COUPON: 'COUPON',                    // Bond coupon payment
  INTEREST: 'INTEREST',                // Account interest (debit/credit)

  // Fees & Taxes
  FEE: 'FEE',                          // All fees (custody, management, AUM, transaction)
  TAX: 'TAX',                          // Tax withholding/payment

  // Transfers & Payments
  TRANSFER_IN: 'TRANSFER_IN',          // Incoming transfer (cash or securities)
  TRANSFER_OUT: 'TRANSFER_OUT',        // Outgoing transfer
  PAYMENT_IN: 'PAYMENT_IN',            // Incoming payment
  PAYMENT_OUT: 'PAYMENT_OUT',          // Outgoing payment

  // FX & Cards
  FX_TRADE: 'FX_TRADE',                // Foreign exchange transaction
  CARD_PAYMENT: 'CARD_PAYMENT',        // Card payments/withdrawals

  // Corporate Events
  REDEMPTION: 'REDEMPTION',            // Bond/product maturity, early redemption
  CORPORATE_ACTION: 'CORPORATE_ACTION', // Splits, mergers, spin-offs

  // Catch-all
  OTHER: 'OTHER'                       // Unclassified operations
};

// =============================================================================
// OPERATION TYPE LABELS (UI Display)
// =============================================================================
// Human-readable labels for each operation type

export const OPERATION_TYPE_LABELS = {
  [OPERATION_TYPES.BUY]: 'Buy',
  [OPERATION_TYPES.SELL]: 'Sell',
  [OPERATION_TYPES.SUBSCRIPTION]: 'Subscription',
  [OPERATION_TYPES.DIVIDEND]: 'Dividend',
  [OPERATION_TYPES.COUPON]: 'Coupon',
  [OPERATION_TYPES.INTEREST]: 'Interest',
  [OPERATION_TYPES.FEE]: 'Fee',
  [OPERATION_TYPES.TAX]: 'Tax',
  [OPERATION_TYPES.TRANSFER_IN]: 'Transfer In',
  [OPERATION_TYPES.TRANSFER_OUT]: 'Transfer Out',
  [OPERATION_TYPES.PAYMENT_IN]: 'Payment In',
  [OPERATION_TYPES.PAYMENT_OUT]: 'Payment Out',
  [OPERATION_TYPES.FX_TRADE]: 'FX Trade',
  [OPERATION_TYPES.CARD_PAYMENT]: 'Card Payment',
  [OPERATION_TYPES.REDEMPTION]: 'Redemption',
  [OPERATION_TYPES.CORPORATE_ACTION]: 'Corporate Action',
  [OPERATION_TYPES.OTHER]: 'Other'
};

// =============================================================================
// OPERATION TYPE COLORS (UI Styling)
// =============================================================================
// Colors for badges/chips in UI and PDF reports

export const OPERATION_TYPE_COLORS = {
  [OPERATION_TYPES.BUY]: { bg: '#dbeafe', text: '#1e40af' },           // Blue
  [OPERATION_TYPES.SELL]: { bg: '#fef3c7', text: '#92400e' },          // Amber
  [OPERATION_TYPES.SUBSCRIPTION]: { bg: '#dbeafe', text: '#1e40af' },  // Blue
  [OPERATION_TYPES.DIVIDEND]: { bg: '#d1fae5', text: '#065f46' },      // Green
  [OPERATION_TYPES.COUPON]: { bg: '#d1fae5', text: '#065f46' },        // Green
  [OPERATION_TYPES.INTEREST]: { bg: '#d1fae5', text: '#065f46' },      // Green
  [OPERATION_TYPES.FEE]: { bg: '#fee2e2', text: '#991b1b' },           // Red
  [OPERATION_TYPES.TAX]: { bg: '#fee2e2', text: '#991b1b' },           // Red
  [OPERATION_TYPES.TRANSFER_IN]: { bg: '#e0e7ff', text: '#3730a3' },   // Indigo
  [OPERATION_TYPES.TRANSFER_OUT]: { bg: '#e0e7ff', text: '#3730a3' },  // Indigo
  [OPERATION_TYPES.PAYMENT_IN]: { bg: '#f3e8ff', text: '#6b21a8' },    // Purple
  [OPERATION_TYPES.PAYMENT_OUT]: { bg: '#f3e8ff', text: '#6b21a8' },   // Purple
  [OPERATION_TYPES.FX_TRADE]: { bg: '#cffafe', text: '#155e75' },      // Cyan
  [OPERATION_TYPES.CARD_PAYMENT]: { bg: '#fce7f3', text: '#9d174d' },  // Pink
  [OPERATION_TYPES.REDEMPTION]: { bg: '#f3f4f6', text: '#374151' },    // Gray
  [OPERATION_TYPES.CORPORATE_ACTION]: { bg: '#f3f4f6', text: '#374151' }, // Gray
  [OPERATION_TYPES.OTHER]: { bg: '#f3f4f6', text: '#374151' }          // Gray
};

// =============================================================================
// BANK-SPECIFIC MAPPINGS
// =============================================================================

/**
 * CMB Monaco operation type mapping
 * Maps Order_Type_ID and Meta_Type_ID to standardized operation types
 */
export const CMB_OPERATION_TYPE_MAPPING = {
  // By Order_Type_ID (primary identifier)
  'mba$widrw_of#fest_opeme_trx': OPERATION_TYPES.CARD_PAYMENT,
  'mba$new': null, // Requires context: check transactionCategory
  'mba$xferfee': OPERATION_TYPES.FEE,
  'mba$forex': OPERATION_TYPES.FX_TRADE,
  'mba$aio_fee': OPERATION_TYPES.FEE,
  'mba$acc_fee_aum': OPERATION_TYPES.FEE,
  'mba$defrcard_liq': OPERATION_TYPES.CARD_PAYMENT,
  'mba$pay': null, // Requires context: check transactionCategory
  'sectrx2_div_cash': OPERATION_TYPES.DIVIDEND,
  'sectrx2_coup_cash': OPERATION_TYPES.COUPON,
  'sectrx2_redm_cash': OPERATION_TYPES.REDEMPTION,
  'sectrx2_buy': OPERATION_TYPES.BUY,
  'sectrx2_sell': OPERATION_TYPES.SELL,

  // By Meta_Type_ID (category)
  'cardtrx': OPERATION_TYPES.CARD_PAYMENT,
  'xferfee': OPERATION_TYPES.FEE,
  'fxtr': OPERATION_TYPES.FX_TRADE,
  'sectrx2': null, // Security transaction - needs sub-type
  'pay': OPERATION_TYPES.PAYMENT_OUT,
  'inpay': OPERATION_TYPES.PAYMENT_IN,
  'intr': OPERATION_TYPES.INTEREST,
  'xfermon': OPERATION_TYPES.TRANSFER_OUT
};

/**
 * CFM (Indosuez) operation type mapping
 * Maps OPERATION_TYPE field to standardized types
 */
export const CFM_OPERATION_TYPE_MAPPING = {
  // French terms
  'achat': OPERATION_TYPES.BUY,
  'vente': OPERATION_TYPES.SELL,
  'souscription': OPERATION_TYPES.SUBSCRIPTION,
  'dividende': OPERATION_TYPES.DIVIDEND,
  'coupon': OPERATION_TYPES.COUPON,
  'interet': OPERATION_TYPES.INTEREST,
  'frais': OPERATION_TYPES.FEE,
  'commission': OPERATION_TYPES.FEE,
  'virement': OPERATION_TYPES.TRANSFER_OUT,
  'livraison': OPERATION_TYPES.TRANSFER_IN,
  'remboursement': OPERATION_TYPES.REDEMPTION,
  'echeance': OPERATION_TYPES.REDEMPTION,

  // English terms
  'buy': OPERATION_TYPES.BUY,
  'purchase': OPERATION_TYPES.BUY,
  'sell': OPERATION_TYPES.SELL,
  'sale': OPERATION_TYPES.SELL,
  'dividend': OPERATION_TYPES.DIVIDEND,
  'coupon': OPERATION_TYPES.COUPON,
  'interest': OPERATION_TYPES.INTEREST,
  'fee': OPERATION_TYPES.FEE,
  'transfer': OPERATION_TYPES.TRANSFER_OUT,
  'withdrawal': OPERATION_TYPES.TRANSFER_OUT,
  'deposit': OPERATION_TYPES.TRANSFER_IN,
  'redemption': OPERATION_TYPES.REDEMPTION,
  'maturity': OPERATION_TYPES.REDEMPTION
};

/**
 * Andbank operation type mapping
 * Maps TRANSACTION_TYPE_CODE and MOVEMENT_TYPE to standardized types
 */
export const ANDBANK_OPERATION_TYPE_MAPPING = {
  // Transaction type codes
  'BUY': OPERATION_TYPES.BUY,
  'SELL': OPERATION_TYPES.SELL,
  'DIV': OPERATION_TYPES.DIVIDEND,
  'COUP': OPERATION_TYPES.COUPON,
  'INT': OPERATION_TYPES.INTEREST,
  'FEE': OPERATION_TYPES.FEE,
  'TRF': OPERATION_TYPES.TRANSFER_OUT,
  'REDM': OPERATION_TYPES.REDEMPTION,

  // Movement type labels (lowercase)
  'compra': OPERATION_TYPES.BUY,
  'venta': OPERATION_TYPES.SELL,
  'dividendo': OPERATION_TYPES.DIVIDEND,
  'cupon': OPERATION_TYPES.COUPON,
  'interes': OPERATION_TYPES.INTEREST,
  'comision': OPERATION_TYPES.FEE,
  'transferencia': OPERATION_TYPES.TRANSFER_OUT
};

/**
 * Julius Baer operation type mapping
 * Maps OPER_NATURE and TYPE_NAME to standardized types
 */
export const JULIUS_BAER_OPERATION_TYPE_MAPPING = {
  // OPER_NATURE codes
  'PURCH': OPERATION_TYPES.BUY,
  'SALE': OPERATION_TYPES.SELL,
  'DIV': OPERATION_TYPES.DIVIDEND,
  'INT': OPERATION_TYPES.INTEREST,
  'COUP': OPERATION_TYPES.COUPON,
  'FEE': OPERATION_TYPES.FEE,
  'COMM': OPERATION_TYPES.FEE,
  'TAX': OPERATION_TYPES.TAX,
  'FX': OPERATION_TYPES.FX_TRADE,
  'REDM': OPERATION_TYPES.REDEMPTION,
  'SUBS': OPERATION_TYPES.SUBSCRIPTION,
  'TRF_IN': OPERATION_TYPES.TRANSFER_IN,
  'TRF_OUT': OPERATION_TYPES.TRANSFER_OUT,
  'CORP': OPERATION_TYPES.CORPORATE_ACTION,

  // TYPE_NAME patterns (lowercase for matching)
  'securities purchase': OPERATION_TYPES.BUY,
  'new issue purchase': OPERATION_TYPES.BUY,
  'securities sale': OPERATION_TYPES.SELL,
  'dividend': OPERATION_TYPES.DIVIDEND,
  'coupon': OPERATION_TYPES.COUPON,
  'interest': OPERATION_TYPES.INTEREST,
  'debit interest': OPERATION_TYPES.INTEREST,
  'credit interest': OPERATION_TYPES.INTEREST,
  'safecustody fees': OPERATION_TYPES.FEE,
  'acc. maintenance fee': OPERATION_TYPES.FEE,
  'management fee': OPERATION_TYPES.FEE,
  'transaction fee': OPERATION_TYPES.FEE,
  'fx spot': OPERATION_TYPES.FX_TRADE,
  'fx forward': OPERATION_TYPES.FX_TRADE,
  'redemption': OPERATION_TYPES.REDEMPTION,
  'early redemption': OPERATION_TYPES.REDEMPTION,
  'maturity': OPERATION_TYPES.REDEMPTION,
  'subscription': OPERATION_TYPES.SUBSCRIPTION,
  'transfer': OPERATION_TYPES.TRANSFER_OUT,
  'account transfer': OPERATION_TYPES.TRANSFER_OUT,
  'corporate action': OPERATION_TYPES.CORPORATE_ACTION,
  'split': OPERATION_TYPES.CORPORATE_ACTION,
  'merger': OPERATION_TYPES.CORPORATE_ACTION,
  'option premium': OPERATION_TYPES.OTHER
};

// =============================================================================
// LEGACY MAPPING (for data migration)
// =============================================================================
// Maps old/inconsistent values to standardized OPERATION_TYPES

export const LEGACY_OPERATION_TYPE_MAPPING = {
  // Simplified versions that some parsers used
  'TRANSFER': OPERATION_TYPES.TRANSFER_OUT,
  'PAYMENT': OPERATION_TYPES.PAYMENT_OUT,

  // Variations
  'PURCHASE': OPERATION_TYPES.BUY,
  'SALE': OPERATION_TYPES.SELL,
  'DIVID': OPERATION_TYPES.DIVIDEND,
  'FEES': OPERATION_TYPES.FEE,
  'COMMISSION': OPERATION_TYPES.FEE,
  'WITHDRAWAL': OPERATION_TYPES.TRANSFER_OUT,
  'DEPOSIT': OPERATION_TYPES.TRANSFER_IN,
  'MATURITY': OPERATION_TYPES.REDEMPTION,
  'EARLY_REDEMPTION': OPERATION_TYPES.REDEMPTION
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if a value is a valid operation type.
 *
 * @param {string} type - Operation type to validate
 * @returns {boolean} True if valid, false otherwise
 */
export function isValidOperationType(type) {
  return Object.values(OPERATION_TYPES).includes(type);
}

/**
 * Get a human-readable label for an operation type.
 *
 * @param {string} type - One of OPERATION_TYPES values
 * @returns {string} Human-readable label
 */
export function getOperationTypeLabel(type) {
  return OPERATION_TYPE_LABELS[type] || type || 'Unknown';
}

/**
 * Get color styling for an operation type.
 *
 * @param {string} type - One of OPERATION_TYPES values
 * @returns {object} Object with bg and text color properties
 */
export function getOperationTypeColor(type) {
  return OPERATION_TYPE_COLORS[type] || OPERATION_TYPE_COLORS[OPERATION_TYPES.OTHER];
}

/**
 * Normalize a potentially legacy operation type to the standard value.
 * Used by migration scripts and for backward compatibility.
 *
 * @param {string} type - Potentially legacy operation type
 * @returns {string} Normalized OPERATION_TYPES value
 */
export function normalizeOperationType(type) {
  if (!type) return OPERATION_TYPES.OTHER;

  const upperType = String(type).trim().toUpperCase();

  // If it's already a valid type, return as-is
  if (isValidOperationType(upperType)) {
    return upperType;
  }

  // Check legacy mapping
  if (LEGACY_OPERATION_TYPE_MAPPING[upperType]) {
    return LEGACY_OPERATION_TYPE_MAPPING[upperType];
  }

  // Return OTHER if no match
  return OPERATION_TYPES.OTHER;
}

/**
 * Map CMB Monaco operation to standardized type.
 * Uses Order_Type_ID and Meta_Type_ID to determine the operation type.
 *
 * @param {string} orderTypeId - CMB Order_Type_ID value
 * @param {string} metaTypeId - CMB Meta_Type_ID value (category)
 * @param {number} amount - Transaction amount (for direction detection)
 * @returns {string} Normalized OPERATION_TYPES value
 */
export function mapCMBOperationType(orderTypeId, metaTypeId, amount = 0) {
  // Try direct mapping from Order_Type_ID first
  if (orderTypeId && CMB_OPERATION_TYPE_MAPPING[orderTypeId]) {
    return CMB_OPERATION_TYPE_MAPPING[orderTypeId];
  }

  // For mba$new, determine direction from transactionCategory
  if (orderTypeId === 'mba$new') {
    if (metaTypeId === 'inpay') return OPERATION_TYPES.PAYMENT_IN;
    if (metaTypeId === 'pay') return OPERATION_TYPES.PAYMENT_OUT;
    // Use amount sign as fallback
    return amount >= 0 ? OPERATION_TYPES.PAYMENT_IN : OPERATION_TYPES.PAYMENT_OUT;
  }

  // For mba$pay, check if it's interest
  if (orderTypeId === 'mba$pay') {
    if (metaTypeId === 'intr') return OPERATION_TYPES.INTEREST;
    return amount >= 0 ? OPERATION_TYPES.PAYMENT_IN : OPERATION_TYPES.PAYMENT_OUT;
  }

  // Fall back to Meta_Type_ID mapping
  if (metaTypeId && CMB_OPERATION_TYPE_MAPPING[metaTypeId]) {
    return CMB_OPERATION_TYPE_MAPPING[metaTypeId];
  }

  return OPERATION_TYPES.OTHER;
}

/**
 * Map CFM operation to standardized type.
 * Uses operation type text and direction indicator.
 *
 * @param {string} operationType - CFM operation type text
 * @param {string} direction - Direction indicator ('a' = buy, 'v' = sell)
 * @returns {string} Normalized OPERATION_TYPES value
 */
export function mapCFMOperationType(operationType, direction = '') {
  if (!operationType) return OPERATION_TYPES.OTHER;

  const lower = operationType.toLowerCase().trim();

  // Check direct mapping
  for (const [keyword, type] of Object.entries(CFM_OPERATION_TYPE_MAPPING)) {
    if (lower.includes(keyword)) {
      return type;
    }
  }

  // Use direction as fallback for trading operations
  if (direction === 'a') return OPERATION_TYPES.BUY;
  if (direction === 'v') return OPERATION_TYPES.SELL;

  return OPERATION_TYPES.OTHER;
}

/**
 * Map Andbank operation to standardized type.
 *
 * @param {string} transactionTypeCode - Andbank transaction type code
 * @param {string} movementType - Andbank movement type label
 * @param {string} debitCredit - Debit/credit indicator
 * @returns {string} Normalized OPERATION_TYPES value
 */
export function mapAndbankOperationType(transactionTypeCode, movementType = '', debitCredit = '') {
  // Try direct code mapping
  if (transactionTypeCode && ANDBANK_OPERATION_TYPE_MAPPING[transactionTypeCode.toUpperCase()]) {
    return ANDBANK_OPERATION_TYPE_MAPPING[transactionTypeCode.toUpperCase()];
  }

  // Try movement type label
  if (movementType) {
    const lower = movementType.toLowerCase().trim();
    for (const [keyword, type] of Object.entries(ANDBANK_OPERATION_TYPE_MAPPING)) {
      if (lower.includes(keyword.toLowerCase())) {
        return type;
      }
    }
  }

  return OPERATION_TYPES.OTHER;
}

/**
 * Map Julius Baer operation to standardized type.
 *
 * @param {string} operNature - OPER_NATURE code
 * @param {string} typeName - TYPE_NAME description
 * @param {string} subTypeName - SUB_TYPE_NAME description
 * @returns {string} Normalized OPERATION_TYPES value
 */
export function mapJuliusBaerOperationType(operNature, typeName = '', subTypeName = '') {
  // Try OPER_NATURE code first
  if (operNature && JULIUS_BAER_OPERATION_TYPE_MAPPING[operNature.toUpperCase()]) {
    return JULIUS_BAER_OPERATION_TYPE_MAPPING[operNature.toUpperCase()];
  }

  // Try TYPE_NAME
  if (typeName) {
    const lower = typeName.toLowerCase().trim();
    for (const [keyword, type] of Object.entries(JULIUS_BAER_OPERATION_TYPE_MAPPING)) {
      if (lower.includes(keyword.toLowerCase())) {
        return type;
      }
    }
  }

  // Try SUB_TYPE_NAME as last resort
  if (subTypeName) {
    const lower = subTypeName.toLowerCase().trim();
    for (const [keyword, type] of Object.entries(JULIUS_BAER_OPERATION_TYPE_MAPPING)) {
      if (lower.includes(keyword.toLowerCase())) {
        return type;
      }
    }
  }

  return OPERATION_TYPES.OTHER;
}
