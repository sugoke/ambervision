/**
 * Limit order watch
 *
 * The bank confirms a limit order's execution a day or two later, so we watch
 * the market ourselves and alert when the order's level has been reached:
 * "probably executed, check with the bank". Nothing is marked executed here;
 * that stays a human decision on the bank's confirmation.
 *
 * Prices, by instrument:
 * - listed (equities, ETFs, ...): EOD daily bars since the order was placed,
 *   plus today's high/low from EOD's real-time quote (about 15 min delayed).
 *   The ISIN is resolved to an EOD ticker trading in the order's currency;
 *   without one, nothing is checked (no price in another currency).
 * - quoted in % of par (structured products, bonds): daily prices since the
 *   order, from the issuer price feed (ProductPrices) and the bank files
 *   (PMSHoldings). Daily only: the alert can lag a day, never run ahead.
 *
 * Level reached:
 * - limit / take-profit: sell when the high >= level, buy when the low <= level
 * - stop / stop-limit trigger: sell when the low <= level, buy when the high >= level
 *
 * Results are stored on the order:
 *   priceWatch:   { checkedAt, lastPrice, lastPriceAt, source, ticker, issue }
 *   levelReached: { detectedAt, date, price, level, source, onPlacementDay }
 * levelReached is kept until the level changes (modified order) or the order
 * stops being live.
 */

import {
  OrdersCollection, LIVE_ORDER_STATUSES, RESTING_PRICE_TYPES, PRICE_TYPES, quotesPriceAsPercent
} from '/imports/api/orders.js';

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/** The level the order waits for, and whether it fires on a rise or a fall. */
export function watchedLevel(order) {
  const sell = order.orderType === 'sell';
  if (order.priceType === PRICE_TYPES.STOP_LOSS || order.priceType === PRICE_TYPES.STOP_LIMIT) {
    const level = order.stopPrice ?? order.stopLossPrice;
    return Number.isFinite(level) ? { level, kind: 'stop', firesOnRise: !sell } : null;
  }
  const level = order.limitPrice ?? (order.priceType === PRICE_TYPES.TAKE_PROFIT ? order.takeProfitPrice : null);
  return Number.isFinite(level) ? { level, kind: 'limit', firesOnRise: sell } : null;
}

/** First bar (oldest first) whose range reaches the level, with the touching price. */
function firstTouch(bars, { level, firesOnRise }) {
  for (const bar of bars) {
    if (firesOnRise && Number.isFinite(bar.high) && bar.high >= level) return { ...bar, price: bar.high };
    if (!firesOnRise && Number.isFinite(bar.low) && bar.low <= level) return { ...bar, price: bar.low };
  }
  return null;
}

/** Daily % of par prices since the order, issuer feed and bank files merged per day. */
async function percentQuotedBars(order, sinceKey) {
  const { ProductPricesCollection } = await import('/imports/api/productPrices.js');
  const { PMSHoldingsCollection } = await import('/imports/api/pmsHoldings.js');
  const since = new Date(`${sinceKey}T00:00:00Z`);
  const byDay = new Map();
  const add = (date, pct, source) => {
    if (!Number.isFinite(pct) || pct <= 0) return;
    const key = dayKey(date);
    const bar = byDay.get(key) || { date: key, high: pct, low: pct, close: pct, sources: new Set() };
    bar.high = Math.max(bar.high, pct);
    bar.low = Math.min(bar.low, pct);
    bar.close = pct;
    bar.sources.add(source);
    byDay.set(key, bar);
  };

  const issuer = await ProductPricesCollection.find(
    { isin: order.isin, isActive: true, priceDate: { $gte: since } },
    { sort: { priceDate: 1 }, fields: { price: 1, priceDate: 1 } }
  ).fetchAsync();
  // Same scale rule as the price chart: a series at or below 2 is a fraction of par
  const values = issuer.map(p => p.price).filter(v => v > 0).sort((a, b) => a - b);
  const asFraction = values.length > 0 && values[Math.floor(values.length / 2)] <= 2;
  issuer.forEach(p => add(p.priceDate, asFraction ? p.price * 100 : p.price, 'issuer price'));

  // Bank files: holdings priced in % of par carry marketPrice as a fraction (normalised by the parsers)
  const holdings = await PMSHoldingsCollection.find(
    { isin: order.isin, priceType: 'percentage', snapshotDate: { $gte: since }, portfolioCode: { $not: /CONSOLIDATED/i } },
    { fields: { marketPrice: 1, snapshotDate: 1 } }
  ).fetchAsync();
  holdings.forEach(h => add(h.snapshotDate, h.marketPrice * 100, 'bank file price'));

  return [...byDay.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(b => ({ ...b, source: [...b.sources].join(' + ') }));
}

/** EOD ticker for the ISIN trading in the order's currency, cached on the order. */
async function resolveTicker(order, { withListing = false } = {}) {
  if (order.priceWatch?.ticker && !withListing) return { ticker: order.priceWatch.ticker };
  const { EODApiHelpers } = await import('/imports/api/eodApi.js');
  const results = await EODApiHelpers.searchSecurities(order.isin, 10);
  const exact = (results || []).filter(r => String(r.ISIN || '').toUpperCase() === order.isin.toUpperCase());
  const inCurrency = exact.find(r => String(r.Currency || '').toUpperCase() === String(order.currency || '').toUpperCase());
  if (inCurrency) {
    return {
      ticker: `${inCurrency.Code}.${inCurrency.Exchange}`,
      listing: { name: inCurrency.Name || null, exchange: inCurrency.Exchange || null, currency: inCurrency.Currency || null, type: inCurrency.Type || null }
    };
  }
  if (exact.length) return { issue: `No listing in ${order.currency} found for ${order.isin} (found ${exact.map(r => `${r.Code}.${r.Exchange} ${r.Currency}`).join(', ')})` };
  return { issue: `No market data listing found for ${order.isin}` };
}

/** Daily bars since the order plus today's delayed intraday range. */
async function listedBars(order, ticker, sinceKey, now) {
  const { EODApiHelpers } = await import('/imports/api/eodApi.js');
  const todayKey = dayKey(now);
  const bars = [];
  const history = await EODApiHelpers.getHistoricalData(ticker, null, new Date(`${sinceKey}T00:00:00Z`), now);
  (history || []).forEach(b => {
    if (b && b.date && b.date < todayKey) {
      bars.push({ date: b.date, high: Number(b.high), low: Number(b.low), close: Number(b.close), source: 'EOD daily' });
    }
  });
  try {
    const rt = await EODApiHelpers.getRealTimePrice(ticker);
    const at = Number(rt?.timestamp) ? new Date(Number(rt.timestamp) * 1000) : null;
    const high = Number(rt?.high); const low = Number(rt?.low); const close = Number(rt?.close);
    if (at && dayKey(at) >= sinceKey && Number.isFinite(close)) {
      bars.push({
        date: dayKey(at), at,
        high: Number.isFinite(high) ? high : close,
        low: Number.isFinite(low) ? low : close,
        close,
        source: 'EOD intraday (~15 min delayed)'
      });
    }
  } catch (error) {
    console.warn(`[LIMIT_WATCH] Real-time quote unavailable for ${ticker}:`, error.reason || error.message);
  }
  // A day present both as a daily bar and as today's quote keeps the quote
  const byDay = new Map(bars.map(b => [b.date, b]));
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function notifyLevelReached(order, reached) {
  const { NotificationHelpers, EVENT_TYPES } = await import('/imports/api/notifications.js');
  const { resolveClientRmIds } = await import('/imports/api/notificationService.js');
  const rmIds = await resolveClientRmIds({
    clientIds: [order.clientId, order.entityId],
    bankAccountIds: [order.bankAccountId]
  });
  const recipients = [...new Set([order.createdBy, ...rmIds].filter(Boolean))];
  const pct = quotesPriceAsPercent(order.assetType);
  const fmt = (v) => (pct ? `${Number(v).toFixed(2)}%` : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 })} ${order.currency || ''}`.trim());
  const side = order.orderType === 'sell' ? 'Sell' : 'Buy';
  const placementNote = reached.onPlacementDay
    ? ' The level traded on the day the order was placed, possibly before it reached the market.'
    : '';
  const message = `${side} ${order.priceType === PRICE_TYPES.LIMIT ? 'limit' : order.priceType.replace('_', ' ')} order ${order.orderReference} on ${order.securityName || order.isin} (${order.clientName || 'client'}, ${order.portfolioCode || ''}): level ${fmt(reached.level)} reached, price ${fmt(reached.price)} on ${reached.date} (${reached.source}).${placementNote} Probably executed: check with the bank.`;
  for (const userId of recipients) {
    await NotificationHelpers.create({
      userId,
      type: 'warning',
      title: `Limit level reached: ${order.orderReference}`,
      message,
      metadata: {
        orderId: order._id,
        orderReference: order.orderReference,
        isin: order.isin,
        level: reached.level,
        price: reached.price,
        date: reached.date,
        source: reached.source,
        clientName: order.clientName || null
      },
      eventType: EVENT_TYPES.LIMIT_LEVEL_REACHED
    });
  }
  return recipients.length;
}

/**
 * Check every live resting order once. Returns a summary per order.
 */
/**
 * Indicative price now, for the four-eyes review: lets the validator check the
 * order is on the right security and see where the market is against the
 * order's limit. Listed: EOD quote (~15 min delayed) of the listing matching
 * the ISIN in the order's currency, with that listing's name. Quoted in % of
 * par: latest issuer or bank-file price.
 */
export async function indicativePrice(order) {
  if (!order?.isin) return { found: false, issue: 'No ISIN on the order' };
  const pct = quotesPriceAsPercent(order.assetType);
  let price = null; let at = null; let source = null; let listing = null; let ticker = null; let changePct = null;

  if (pct) {
    const { ProductPricesCollection } = await import('/imports/api/productPrices.js');
    const { PMSHoldingsCollection } = await import('/imports/api/pmsHoldings.js');
    const issuer = await ProductPricesCollection.findOneAsync(
      { isin: order.isin, isActive: true }, { sort: { priceDate: -1, uploadDate: -1 } }
    );
    const bank = await PMSHoldingsCollection.findOneAsync(
      { isin: order.isin, priceType: 'percentage', isLatest: true, portfolioCode: { $not: /CONSOLIDATED/i }, marketPrice: { $gt: 0 } },
      { sort: { snapshotDate: -1 }, fields: { marketPrice: 1, snapshotDate: 1, securityName: 1 } }
    );
    const issuerAt = issuer?.priceDate ? new Date(issuer.priceDate) : null;
    const bankAt = bank?.snapshotDate ? new Date(bank.snapshotDate) : null;
    if (issuer && (!bankAt || (issuerAt && issuerAt >= bankAt))) {
      price = issuer.price <= 2 ? issuer.price * 100 : issuer.price;
      at = issuerAt; source = 'Issuer price';
    } else if (bank) {
      price = bank.marketPrice * 100; at = bankAt; source = 'Bank file price';
      listing = { name: bank.securityName || null };
    }
  } else {
    const resolved = await resolveTicker(order, { withListing: true });
    if (!resolved.ticker) return { found: false, issue: resolved.issue };
    ticker = resolved.ticker;
    listing = resolved.listing || null;
    const { EODApiHelpers } = await import('/imports/api/eodApi.js');
    const rt = await EODApiHelpers.getRealTimePrice(ticker);
    const close = Number(rt?.close);
    if (Number.isFinite(close) && close > 0) {
      price = close;
      at = Number(rt?.timestamp) ? new Date(Number(rt.timestamp) * 1000) : null;
      source = 'EOD (~15 min delayed)';
      changePct = Number.isFinite(Number(rt?.change_p)) ? Number(rt.change_p) : null;
    }
  }
  if (!Number.isFinite(price)) return { found: false, issue: 'No current price available for this security', ticker, listing };

  // Where the order's level sits against the market
  const watch = watchedLevel(order);
  let vsMarket = null;
  if (watch) {
    const diff = ((watch.level - price) / price) * 100;
    const side = order.orderType === 'sell' ? 'sell' : 'buy';
    const marketable = watch.kind === 'limit' && (side === 'sell' ? watch.level <= price : watch.level >= price);
    vsMarket = {
      text: `${watch.kind === 'stop' ? 'Stop' : 'Limit'} ${Math.abs(diff) < 0.005 ? 'at' : `${Math.abs(diff).toFixed(2)}% ${diff > 0 ? 'above' : 'below'}`} the market`,
      marketable,
      hint: marketable ? 'At or through the market: likely to execute immediately' : null
    };
  }
  const fmtPrice = (v) => (pct ? `${v.toFixed(2)}%` : `${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ${listing?.currency || order.currency || ''}`.trim());
  return {
    found: true,
    priceFormatted: fmtPrice(price),
    changeFormatted: changePct !== null ? `${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% today` : null,
    changePositive: changePct !== null ? changePct >= 0 : null,
    atFormatted: at ? at.toLocaleString('en-GB', { timeZone: 'Europe/Paris', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null,
    source,
    ticker,
    listingName: listing?.name || null,
    listingExchange: listing?.exchange || null,
    listingType: listing?.type || null,
    vsMarket
  };
}

export async function checkLiveLimitOrders({ now = new Date(), dryRun = false } = {}) {
  // dryRun: compute and report only, no write to the orders, no notification
  const write = (id, modifier) => (dryRun ? null : OrdersCollection.updateAsync(id, modifier));
  const orders = await OrdersCollection.find({
    status: { $in: LIVE_ORDER_STATUSES },
    priceType: { $in: RESTING_PRICE_TYPES }
  }).fetchAsync();

  const summary = [];
  for (const order of orders) {
    const watch = watchedLevel(order);
    if (!watch || !order.isin) {
      summary.push({ orderReference: order.orderReference, skipped: 'no level or ISIN' });
      continue;
    }
    // An alert already raised for this level stands; a modified level is watched afresh
    const alreadyReached = order.levelReached && order.levelReached.level === watch.level;
    const sinceKey = dayKey(order.createdAt || now);
    const priceWatch = { checkedAt: now, ticker: order.priceWatch?.ticker || null, issue: null };

    try {
      let bars;
      if (quotesPriceAsPercent(order.assetType)) {
        bars = await percentQuotedBars(order, sinceKey);
      } else {
        const resolved = await resolveTicker(order);
        if (!resolved.ticker) {
          await write(order._id, { $set: { priceWatch: { ...priceWatch, issue: resolved.issue } } });
          summary.push({ orderReference: order.orderReference, issue: resolved.issue });
          continue;
        }
        priceWatch.ticker = resolved.ticker;
        bars = await listedBars(order, resolved.ticker, sinceKey, now);

        // On the day the order was placed, the day's high/low may predate it.
        // Count only what was seen after placement: the price at each check,
        // and a new high/low made after the first check of that day.
        const prior = order.priceWatch?.intraday?.date === sinceKey ? order.priceWatch.intraday : null;
        const placementQuote = bars.find(b => b.date === sinceKey && b.at);
        let intraday = prior ? { ...prior } : null;
        if (placementQuote) {
          if (!intraday) {
            intraday = {
              date: sinceKey,
              firstHigh: placementQuote.high,
              firstLow: placementQuote.low,
              observedHigh: placementQuote.close,
              observedLow: placementQuote.close
            };
          } else {
            intraday.observedHigh = Math.max(intraday.observedHigh, placementQuote.close, placementQuote.high > intraday.firstHigh ? placementQuote.high : -Infinity);
            intraday.observedLow = Math.min(intraday.observedLow, placementQuote.close, placementQuote.low < intraday.firstLow ? placementQuote.low : Infinity);
          }
        }
        if (intraday) {
          priceWatch.intraday = intraday;
          bars = bars.map(b => (b.date === sinceKey
            ? { ...b, high: intraday.observedHigh, low: intraday.observedLow, observedAfterPlacement: true }
            : b));
        }
      }

      const last = bars[bars.length - 1];
      if (last) {
        priceWatch.lastPrice = last.close;
        priceWatch.lastPriceAt = last.at || new Date(`${last.date}T00:00:00Z`);
        priceWatch.source = last.source;
      } else {
        priceWatch.issue = 'No price since the order was placed';
      }

      const $set = { priceWatch };
      const touch = !alreadyReached ? firstTouch(bars, watch) : null;
      if (touch) {
        $set.levelReached = {
          detectedAt: now,
          date: touch.date,
          price: touch.price,
          level: watch.level,
          source: touch.source,
          // A listed daily range on the placement day, not watched after
          // placement: the level may have traded before the order was in
          onPlacementDay: touch.date === sinceKey && !touch.observedAfterPlacement && /^EOD/.test(touch.source)
        };
      }
      await write(order._id, {
        $set,
        ...(!alreadyReached && !touch && order.levelReached ? { $unset: { levelReached: '' } } : {})
      });

      let notified = 0;
      if (touch && !dryRun) notified = await notifyLevelReached(order, $set.levelReached);
      summary.push({
        orderReference: order.orderReference,
        lastPrice: priceWatch.lastPrice ?? null,
        source: priceWatch.source || null,
        levelReached: !!(touch || alreadyReached),
        newlyReached: !!touch,
        reached: $set.levelReached || order.levelReached || null,
        bars: dryRun ? bars.slice(-5).map(b => ({ date: b.date, high: b.high, low: b.low, close: b.close, source: b.source })) : undefined,
        notified
      });
    } catch (error) {
      const issue = error.reason || error.message;
      console.error(`[LIMIT_WATCH] ${order.orderReference}:`, issue);
      await write(order._id, { $set: { priceWatch: { ...priceWatch, issue } } });
      summary.push({ orderReference: order.orderReference, issue });
    }
  }
  if (summary.length) console.log('[LIMIT_WATCH]', JSON.stringify(summary));
  return summary;
}

export const LimitOrderWatchPermissions = {
  canRun: (user) => ['superadmin', 'admin', 'rm', 'assistant', 'compliance'].includes(user?.role)
};

