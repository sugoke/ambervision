import { ProviderError, PROVIDER_ERROR } from './providerInterface';
import { TelekursQuotesHelpers } from '/imports/api/telekursQuotes';

/**
 * Telekurs (Excel) — a DB-backed, last-resort price provider.
 *
 * Serves prices for instruments EOD doesn't cover — typically Japanese
 * stocks — from data pushed into the
 * `telekursQuotes` collection by a VBA macro in a locally live-updated Excel
 * (see imports/api/telekursQuotes.js and server/telekursIngestHandler.js).
 *
 * It reads from Mongo instead of an HTTP API, so there is no rate limiter and no
 * API key. It is registered LAST in the chain (highest priority number), so it
 * is only reached after every real market-data provider has returned NO_DATA.
 *
 * Not a discovery source: searchSecurities returns nothing (the Excel is a
 * curated mirror of instruments already used in the app, not a universe).
 */
export const TelekursProvider = {
  id: 'TELEKURS',
  name: 'Telekurs (Excel)',
  capabilities: { equity: true, etf: true, index: false, fx: false, bond: false, search: false },

  // MUST be synchronous — the router calls this without awaiting
  // (marketDataRouter.js `_getChain`). A DB check would return a Promise (always
  // truthy) and defeat the gate, so we do a cheap static check here and let the
  // getters do the real lookup, throwing NO_DATA when the ticker isn't stored.
  supports(fullTicker) {
    return typeof fullTicker === 'string' && fullTicker.includes('.');
  },

  async getHistoricalData(fullTicker, fromDate, toDate) {
    const quote = await TelekursQuotesHelpers.getQuote(fullTicker);
    if (!quote || !Array.isArray(quote.history) || quote.history.length === 0) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Telekurs has no data for ${fullTicker}`);
    }

    const from = fromDate ? new Date(fromDate).getTime() : -Infinity;
    const to = toDate ? new Date(toDate).getTime() : Infinity;

    const bars = quote.history
      .filter(b => {
        const t = new Date(b.date).getTime();
        return t >= from && t <= to;
      })
      .map(b => ({
        date: new Date(b.date),
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume || 0,
        adjustedClose: b.adjustedClose ?? b.close
      }))
      .sort((a, b) => a.date - b.date);

    if (bars.length === 0) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Telekurs has no bars for ${fullTicker} in range`);
    }

    return { bars, currency: quote.currency || null };
  },

  async getRealTimePrice(fullTicker) {
    const quote = await TelekursQuotesHelpers.getQuote(fullTicker);
    if (!quote || quote.lastPrice === null || quote.lastPrice === undefined) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Telekurs has no price for ${fullTicker}`);
    }
    return {
      price: quote.lastPrice,
      currency: quote.currency || null,
      timestamp: quote.lastDate ? new Date(quote.lastDate) : new Date(quote.lastUpdated)
    };
  },

  async getFxRate(pair) {
    throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Telekurs does not provide FX rates (${pair})`);
  },

  // Not a discovery source — the Excel only mirrors instruments already in use.
  async searchSecurities() {
    return [];
  }
};
