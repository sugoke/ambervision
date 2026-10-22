import assert from 'assert';
import { buildTradeHistory, tradeSide } from '../imports/api/helpers/tradeHistory';

const buy = (date, quantity, amount, fees = 0) => ({ date, side: 'BUY', quantity, amount, fees });
const sell = (date, quantity, amount, fees = 0) => ({ date, side: 'SELL', quantity, amount, fees });

describe('tradeHistory', function () {
  it('maps operation types to a side', function () {
    assert.strictEqual(tradeSide('BUY'), 'BUY');
    assert.strictEqual(tradeSide('SUBSCRIPTION'), 'BUY');
    assert.strictEqual(tradeSide('SELL'), 'SELL');
    assert.strictEqual(tradeSide('REDEMPTION'), 'SELL');
    assert.strictEqual(tradeSide('DIVIDEND'), null);
  });

  it('closes one full round trip with fees', function () {
    const h = buildTradeHistory([buy('2026-01-05', 100, 1000, 10), sell('2026-03-05', 100, 1200, 12)]);
    assert.strictEqual(h.closed.length, 1);
    assert.strictEqual(h.open.length, 0);
    assert.ok(Math.abs(h.closed[0].pnl - 178) < 1e-9); // 1200 - 1000 - 22
    assert.strictEqual(h.closed[0].days, 59);
  });

  it('matches FIFO across lots and leaves the remainder open', function () {
    const h = buildTradeHistory([
      buy('2026-01-01', 100, 1000), buy('2026-02-01', 100, 2000), sell('2026-03-01', 150, 3000)
    ]);
    assert.strictEqual(h.closed.length, 2);
    assert.strictEqual(h.closed[0].quantity, 100); // oldest lot first
    assert.strictEqual(h.closed[1].quantity, 50);
    assert.ok(Math.abs(h.closed[0].pnl - 1000) < 1e-9);  // 100 @ 20 - 100 @ 10
    assert.ok(Math.abs(h.closed[1].pnl - 0) < 1e-9);     // 50 @ 20 - 50 @ 20
    assert.strictEqual(h.open.length, 1);
    assert.strictEqual(h.open[0].quantity, 50);
  });

  it('spreads a purchase fee over the sales that close its lot', function () {
    const h = buildTradeHistory([
      buy('2026-01-01', 100, 1000, 10), sell('2026-02-01', 40, 500), sell('2026-03-01', 60, 700)
    ]);
    assert.ok(Math.abs(h.closed[0].fees - 4) < 1e-9);
    assert.ok(Math.abs(h.closed[1].fees - 6) < 1e-9);
  });

  it('reports a sale larger than the known purchases instead of inventing a cost', function () {
    const h = buildTradeHistory([buy('2026-01-01', 10, 100), sell('2026-02-01', 25, 300)]);
    assert.strictEqual(h.closed[0].quantity, 10);
    assert.strictEqual(h.unmatchedSoldQuantity, 15);
  });

  it('orders by date whatever the input order, a buy before a same-day sell', function () {
    const h = buildTradeHistory([sell('2026-02-01', 10, 150), buy('2026-02-01', 10, 100), buy('2026-01-01', 5, 40)]);
    assert.strictEqual(h.closed[0].openDate, '2026-01-01');
    assert.strictEqual(h.unmatchedSoldQuantity, 0);
  });

  it('keeps a delivery without a price open and never invents its result', function () {
    const h = buildTradeHistory([
      { date: '2026-09-10', side: 'IN', quantity: 1000, amount: null, fees: 0 },
      sell('2026-10-01', 400, 120000)
    ]);
    assert.strictEqual(h.closed.length, 1);
    assert.strictEqual(h.closed[0].pnl, null);
    assert.strictEqual(h.totals.realized, 0);
    assert.strictEqual(h.open[0].quantity, 600);
    assert.strictEqual(h.open[0].cost, null);
  });

  it('values a delivery at a supplied cost', function () {
    const h = buildTradeHistory([
      { date: '2026-09-10', side: 'IN', quantity: 100, amount: 24883, fees: 0 },
      sell('2026-10-01', 100, 26000)
    ]);
    assert.ok(Math.abs(h.closed[0].pnl - 1117) < 1e-9);
  });
});
