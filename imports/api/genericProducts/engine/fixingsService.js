/**
 * Fixings service — server only. Bridges the market data cache to the pure
 * engine: pre-warms the cache per underlying (same pattern as
 * templateReports.js) and returns the in-memory series shape the engine
 * expects: { [underlyingId]: [{ date: 'YYYY-MM-DD', close }] } sorted asc.
 */

import { MarketDataHelpers } from '/imports/api/marketDataCache';

function toIsoDay(date) {
  return new Date(date).toISOString().slice(0, 10);
}

export async function buildSeriesForDefinition(definition, issues = []) {
  const identity = definition.identity || {};
  const tradeDate = identity.tradeDate ? new Date(identity.tradeDate + 'T00:00:00Z') : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const fromDate = new Date(tradeDate);
  fromDate.setUTCDate(fromDate.getUTCDate() - 30);
  const toDate = new Date();

  // Skip EOD fetch for underlyings covered by manual price trackers
  const manualTrackerIsins = new Set();
  try {
    const { ManualPriceTrackersCollection } = require('/imports/api/manualPriceTrackers.js');
    const trackers = await ManualPriceTrackersCollection.find({ isActive: true }, { fields: { isin: 1 } }).fetchAsync();
    trackers.forEach(t => manualTrackerIsins.add(t.isin));
  } catch (e) {
    // Manual trackers unavailable — proceed with EOD only
  }

  const series = {};
  for (const u of definition.underlyings || []) {
    const fullTicker = u.fullTicker || `${u.ticker}.US`;
    const isLevel = u.basis === 'level';
    // Rate-level series (CMS/SOFR) have no EOD provider coverage — they are fed
    // through manual price trackers, so skip the EOD refresh (mirrors the
    // template system's rate products).
    if (!isLevel && !(u.isin && manualTrackerIsins.has(u.isin))) {
      try {
        await MarketDataHelpers.fetchAndCacheHistoricalData(fullTicker, fromDate, toDate);
      } catch (error) {
        console.warn(`[genericProducts] Market data refresh failed for ${fullTicker}:`, error.message);
        issues.push({
          code: 'MARKET_DATA_REFRESH_FAILED', severity: 'warning',
          message: `Could not refresh market data for ${fullTicker}: ${error.message}`
        });
      }
    }

    const history = await MarketDataHelpers.getHistoricalData(fullTicker, fromDate, toDate);
    // Raw close, not adjustedClose — initial fixings are unadjusted closes,
    // and the template evaluators use the same convention. Rate-level series
    // may be zero or negative, so only performance underlyings are filtered.
    series[u.id] = (history || [])
      .map(bar => ({ date: toIsoDay(bar.date), close: bar.close }))
      .filter(bar => (isLevel ? bar.close !== null && bar.close !== undefined && !Number.isNaN(bar.close) : bar.close > 0))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }
  return series;
}

/**
 * Close price for a ticker on (or last close before) a date.
 * Used by the builder's "Fetch fixing" button.
 */
export async function lookupClose(fullTicker, isoDate) {
  const target = new Date(isoDate + 'T00:00:00Z');
  const from = new Date(target);
  from.setUTCDate(from.getUTCDate() - 15);

  try {
    await MarketDataHelpers.fetchAndCacheHistoricalData(fullTicker, from, new Date());
  } catch (e) {
    // fall through to whatever is cached
  }

  const history = await MarketDataHelpers.getHistoricalData(fullTicker, from, target);
  if (!history || history.length === 0) return null;
  const sorted = history
    .map(bar => ({ date: toIsoDay(bar.date), close: bar.close }))
    .filter(bar => bar.close > 0 && bar.date <= isoDate)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  if (sorted.length === 0) return null;
  const last = sorted[sorted.length - 1];
  return { close: last.close, date: last.date, exact: last.date === isoDate };
}
