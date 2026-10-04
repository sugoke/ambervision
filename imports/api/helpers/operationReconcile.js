/**
 * Matching rules used when a bank's operations are re-read from its files and the
 * stored records are reconciled with the new parse (bankPositions.reprocessOperations).
 *
 * A stored record whose key no longer comes out of the parse (its operation type or id
 * changed, or it was a duplicate leg that the parser now merges) is matched to the new
 * record describing the same movement: same account, day and instrument, and the same
 * amount in one of its amount fields. Records without any amount (pure bookings) match
 * on the bank's own code instead.
 */

const dayOf = (date) => new Date(date).toISOString().slice(0, 10);

const amountViews = (op) => [...new Set(
  [op.netAmount, op.grossAmount, op.std?.amount]
    .filter(v => v != null && Number(v) !== 0 && Number.isFinite(Number(v)))
    .map(v => Math.abs(Number(v)).toFixed(2))
)];

const bankCodeOf = (op) => op.operationCode || op.transactionTypeCode || op.std?.bankTypeCode || '';

const baseOf = (op) => `${op.portfolioCode}|${dayOf(op.operationDate)}|${op.isin || ''}`;

/**
 * Signatures a record can be found under, most specific first.
 */
export function operationSignatures(op) {
  const base = baseOf(op);
  const views = amountViews(op);
  const signatures = views.map(a => `${base}|amt:${a}`);
  signatures.push(`${base}|code:${bankCodeOf(op)}`);
  if (views.length === 0) signatures.push(`${base}|zero`);
  return signatures;
}

/**
 * Index new records by every signature they can be found under.
 * Records without any amount are also indexed under `zero`.
 */
export function buildSignatureIndex(operations) {
  const index = new Map();
  for (const op of operations) {
    const signatures = operationSignatures(op);
    if (amountViews(op).length > 0) signatures.push(`${baseOf(op)}|zero`);
    for (const sig of signatures) {
      if (!index.has(sig)) index.set(sig, []);
      index.get(sig).push(op);
    }
  }
  return index;
}

/**
 * The new record replacing a stored one, or null.
 * Amount-based matches are tried first; a stored record without any amount falls back
 * to the bank code, then to any record of the same account, day and instrument.
 */
export function findReplacement(storedOp, index) {
  const hasAmount = amountViews(storedOp).length > 0;
  const base = baseOf(storedOp);
  const candidates = hasAmount
    ? amountViews(storedOp).map(a => `${base}|amt:${a}`)
    : [`${base}|code:${bankCodeOf(storedOp)}`, `${base}|zero`];
  for (const sig of candidates) {
    const list = index.get(sig);
    if (list && list.length > 0) return list[0];
  }
  return null;
}
