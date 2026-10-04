/**
 * Harmonized view of a bank operation, stored on every PMSOperations record as `std`.
 *
 * Each bank parser decides WHICH of its raw columns feed these values (that is the
 * bank-specific part and stays in the parser); this helper only shapes, rounds and
 * labels them so every bank reads the same way:
 *
 *   std = {
 *     type, category, label,          // OPERATION_TYPES value, its category key, display label
 *     description, instrumentName, isin,
 *     quantity, price,
 *     amount,                         // signed, in `currency`: + into the account, − out
 *     currency,
 *     cashImpact,                     // false for securities moved in/out without cash
 *     fees, taxes, accruedInterest,   // positive magnitudes in `currency`
 *     fxRate,
 *     bankTypeCode, bankTypeLabel,    // the bank's own code and wording
 *     reference                       // the bank's reference for the operation
 *   }
 *
 * The original bank fields on the record are left untouched (other code and the
 * dedup key read them).
 */
import { getOperationCategory, getOperationTypeLabel, OPERATION_TYPES } from '../constants/operationTypes';

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

const round = (value, decimals) => {
  const n = toNumber(value);
  if (n === null) return null;
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
};

const magnitude = (value) => {
  const n = toNumber(value);
  return n === null || n === 0 ? null : round(Math.abs(n), 2);
};

const cleanText = (value) => {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > 0 ? s : null;
};

const cleanIsin = (value) => {
  const s = cleanText(value);
  return s && /^[A-Z]{2}[A-Z0-9]{9}\d$/i.test(s) ? s.toUpperCase() : null;
};

/**
 * Build the `std` block.
 * @param {Object} input
 * @param {string} input.type - OPERATION_TYPES value (already mapped by the parser)
 * @param {number} input.amount - Signed amount (+ into the account), in input.currency
 * @returns {Object} std block
 */
export function buildStandardOperation(input = {}) {
  const type = input.type || OPERATION_TYPES.OTHER;
  const quantity = toNumber(input.quantity);
  const price = toNumber(input.price);
  return {
    type,
    category: getOperationCategory(type),
    label: getOperationTypeLabel(type),
    description: cleanText(input.description),
    instrumentName: cleanText(input.instrumentName),
    isin: cleanIsin(input.isin),
    quantity: quantity === null || quantity === 0 ? null : round(Math.abs(quantity), 6),
    price: price === null || price === 0 ? null : round(price, 6),
    amount: round(input.amount, 2) ?? 0,
    currency: cleanText(input.currency)?.toUpperCase() || null,
    cashImpact: input.cashImpact !== false,
    fees: magnitude(input.fees),
    taxes: magnitude(input.taxes),
    accruedInterest: magnitude(input.accruedInterest),
    fxRate: toNumber(input.fxRate) || null,
    bankTypeCode: cleanText(input.bankTypeCode),
    bankTypeLabel: cleanText(input.bankTypeLabel),
    reference: cleanText(input.reference)
  };
}

/**
 * Attach a `std` block to an operation and align its stored operationType with it.
 */
export function withStandard(operation, input) {
  const std = buildStandardOperation(input);
  return { ...operation, operationType: std.type, std };
}

/**
 * Signed amount from an unsigned value and a debit/credit style flag.
 * @param {number} value - Amount (sign ignored)
 * @param {boolean} isCredit - true when cash comes into the account
 */
export function signedFromFlag(value, isCredit) {
  const n = toNumber(value);
  if (n === null) return 0;
  return isCredit ? Math.abs(n) : -Math.abs(n);
}
