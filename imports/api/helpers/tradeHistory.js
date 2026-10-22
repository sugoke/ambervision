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
 * Banks disagree on signs (CMB books a purchase's cash as negative and signs the
 * quantity of a sale; others do not), so everything is taken in absolute value
 * and the direction comes from the operation type alone.
 *
 * @param {Array<{ date, side, quantity, amount, fees, reference }>} trades
 *   quantity and amount are positive: amount is the gross consideration, fees the cost on top.
 * @returns {{ closed: Array, open: Array, unmatchedSoldQuantity: Number, totals: Object }}
 */
export function buildTradeHistory(trades) {
  const sorted = [...trades]
    .filter(t => t.side && t.quantity > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date) || (a.side === 'BUY' ? -1 : 1));

  const lots = []; // open buys: { date, remaining, unitCost, unitFee }
  const closed = [];
  let unmatchedSoldQuantity = 0;
  const totals = { bought: 0, sold: 0, fees: 0, realized: 0, boughtQuantity: 0, soldQuantity: 0 };

  for (const t of sorted) {
    const unitAmount = t.amount / t.quantity;
    const unitFee = (t.fees || 0) / t.quantity;
    totals.fees += t.fees || 0;

    if (t.side === 'BUY') {
      lots.push({ date: t.date, remaining: t.quantity, unitCost: unitAmount, unitFee });
      totals.bought += t.amount;
      totals.boughtQuantity += t.quantity;
      continue;
    }

    totals.sold += t.amount;
    totals.soldQuantity += t.quantity;
    let toClose = t.quantity;
    while (toClose > 1e-9 && lots.length > 0) {
      const lot = lots[0];
      const qty = Math.min(lot.remaining, toClose);
      const cost = qty * lot.unitCost;
      const proceeds = qty * unitAmount;
      const fees = qty * (lot.unitFee + unitFee);
      const pnl = proceeds - cost - fees;
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
        pnlPercent: cost > 0 ? (pnl / cost) * 100 : null,
        days: Math.max(0, Math.round((new Date(t.date) - new Date(lot.date)) / 86400000))
      });
      totals.realized += pnl;
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
    cost: l.remaining * l.unitCost
  }));

  return { closed, open, unmatchedSoldQuantity, totals };
}
