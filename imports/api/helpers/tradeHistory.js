/**
 * Round trips on one security in one account, from its buy / sell operations.
 *
 * Pure functions (no database): the method that serves the PMS "trade history"
 * modal normalises the bank rows, calls buildTradeHistory(), and sends the
 * pre-formatted result to the UI, which only displays it.
 *
 * Matching is FIFO: a sale closes the oldest open buys first. Fees are spread
 * pro rata over the units they relate to, so a lot closed in two sales carries
 * the right share of its purchase fee in each.
 */

/** Direction of an operation row, or null when it is not a trade. */
export function tradeSide(operationType) {
  if (operationType === 'BUY' || operationType === 'SUBSCRIPTION') return 'BUY';
  if (operationType === 'SELL' || operationType === 'REDEMPTION') return 'SELL';
  return null;
}

/**
 * Securities that arrive or leave without a priced trade: the shares delivered when a
 * structured product ends, a free transfer between custodians. The bank gives no
 * consideration for them, so they move the quantity but carry no price of their own.
 */
export const MOVEMENT_TYPES = ['TRANSFER', 'TRANSFER_IN', 'TRANSFER_OUT', 'CORPORATE_ACTION'];

/**
 * Banks disagree on signs (CMB books a purchase's cash as negative and signs the
 * quantity of a sale; others do not), so everything is taken in absolute value
 * and the direction comes from the operation type alone.
 *
 * @param {Array<{ date, side, quantity, amount, fees, reference }>} trades
 *   side is BUY / SELL (priced) or IN / OUT (delivery or transfer, amount null unless the
 *   caller could derive a cost). quantity and amount are positive: amount is the gross
 *   consideration, fees the cost on top. A lot or sale without a known amount closes with
 *   pnl null and stays out of the realized total.
 * @returns {{ closed: Array, open: Array, unmatchedSoldQuantity: Number, totals: Object }}
 */
export function buildTradeHistory(trades) {
  const sorted = [...trades]
    .filter(t => t.side && t.quantity > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date) || ((a.side === 'BUY' || a.side === 'IN') ? -1 : 1));

  const lots = []; // open buys: { date, remaining, unitCost, unitFee }
  const closed = [];
  let unmatchedSoldQuantity = 0;
  const totals = { bought: 0, sold: 0, fees: 0, realized: 0, boughtQuantity: 0, soldQuantity: 0 };

  for (const t of sorted) {
    const priced = t.amount != null;
    const unitAmount = priced ? t.amount / t.quantity : null;
    const unitFee = (t.fees || 0) / t.quantity;
    totals.fees += t.fees || 0;

    if (t.side === 'BUY' || t.side === 'IN') {
      lots.push({ date: t.date, remaining: t.quantity, unitCost: unitAmount, unitFee, delivered: t.side === 'IN' });
      if (priced) totals.bought += t.amount;
      totals.boughtQuantity += t.quantity;
      continue;
    }

    if (priced) totals.sold += t.amount;
    totals.soldQuantity += t.quantity;
    let toClose = t.quantity;
    while (toClose > 1e-9 && lots.length > 0) {
      const lot = lots[0];
      const qty = Math.min(lot.remaining, toClose);
      const known = lot.unitCost != null && unitAmount != null;
      const cost = lot.unitCost != null ? qty * lot.unitCost : null;
      const proceeds = unitAmount != null ? qty * unitAmount : null;
      const fees = qty * (lot.unitFee + unitFee);
      const pnl = known ? proceeds - cost - fees : null;
      closed.push({
        openDate: lot.date,
        closeDate: t.date,
        quantity: qty,
        buyUnit: lot.unitCost,
        sellUnit: unitAmount,
        cost,
        proceeds,
        fees,
        pnl,
        pnlPercent: known && cost > 0 ? (pnl / cost) * 100 : null,
        delivered: lot.delivered,
        days: Math.max(0, Math.round((new Date(t.date) - new Date(lot.date)) / 86400000))
      });
      if (known) totals.realized += pnl;
      lot.remaining -= qty;
      toClose -= qty;
      if (lot.remaining <= 1e-9) lots.shift();
    }
    // Sold more than the history shows we bought: the purchase predates our files
    if (toClose > 1e-9) unmatchedSoldQuantity += toClose;
  }

  const open = lots.map(l => ({
    date: l.date,
    quantity: l.remaining,
    buyUnit: l.unitCost,
    cost: l.unitCost != null ? l.remaining * l.unitCost : null,
    delivered: l.delivered
  }));

  return { closed, open, unmatchedSoldQuantity, totals };
}
