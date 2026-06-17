import { Meteor } from 'meteor/meteor';
import { DataProvidersCollection, recordProviderHealth } from './dataProvidersCollection';
import { ProviderError, PROVIDER_ERROR, tickerCapability } from './providers/providerInterface';
import { EODProvider } from './providers/eodProvider';
import { TwelveDataProvider } from './providers/twelveDataProvider';
import { FMPProvider } from './providers/fmpProvider';
import { JQuantsProvider } from './providers/jquantsProvider';

// Static registry — adding a future provider (bonds etc.) means writing an
// adapter that implements providerInterface and listing it here + in the seed.
const PROVIDER_REGISTRY = {
  [EODProvider.id]: EODProvider,
  [TwelveDataProvider.id]: TwelveDataProvider,
  [FMPProvider.id]: FMPProvider,
  [JQuantsProvider.id]: JQuantsProvider
};

/**
 * Routes market data requests across enabled providers in priority order,
 * falling through on failure. The preferredProvider (the provider that last
 * served this ticker, persisted on the cache doc) is tried first so we don't
 * burn calls re-probing providers known to lack a ticker.
 */
export const MarketDataRouter = {
  async _getChain(fullTicker, preferredProvider = null) {
    const capability = tickerCapability(fullTicker);
    const docs = await DataProvidersCollection.find(
      { enabled: true, hasApiKey: true },
      { sort: { priority: 1 } }
    ).fetchAsync();

    let chain = docs
      .map(doc => PROVIDER_REGISTRY[doc.providerId])
      .filter(provider =>
        provider &&
        provider.capabilities[capability] &&
        provider.supports(fullTicker)
      );

    if (preferredProvider) {
      const idx = chain.findIndex(p => p.id === preferredProvider);
      if (idx > 0) {
        const [preferred] = chain.splice(idx, 1);
        chain.unshift(preferred);
      }
    }
    return chain;
  },

  async _tryChain(fullTicker, preferredProvider, attempt) {
    const chain = await this._getChain(fullTicker, preferredProvider);
    if (chain.length === 0) {
      throw new Meteor.Error('market-data-unavailable', `No enabled provider supports ${fullTicker}`);
    }

    const providersTried = [];
    for (const provider of chain) {
      try {
        const result = await attempt(provider);
        recordProviderHealth(provider.id, true);
        return {
          ...result,
          providerId: provider.id,
          providersTried,
          // A persisted provider switch is only safe when every earlier failure
          // was permanent (no-data/auth) — a transient outage or rate limit must
          // not flip a ticker to another provider and trigger a full re-fetch.
          providerSwitchAllowed: providersTried.every(
            t => t.kind === PROVIDER_ERROR.NO_DATA || t.kind === PROVIDER_ERROR.AUTH
          )
        };
      } catch (error) {
        const kind = error instanceof ProviderError ? error.kind : PROVIDER_ERROR.TRANSIENT;
        providersTried.push({ providerId: provider.id, kind, error: error.message });
        recordProviderHealth(provider.id, false, error.message);
        console.log(`[MarketDataRouter] ${provider.id} failed for ${fullTicker} (${kind}): ${error.message}`);
      }
    }

    const summary = providersTried.map(t => `${t.providerId}: ${t.error}`).join(' | ');
    const err = new Meteor.Error('market-data-unavailable', `All providers failed for ${fullTicker} — ${summary}`);
    err.providersTried = providersTried;
    throw err;
  },

  // -> { bars, currency, providerId, providersTried, providerSwitchAllowed }
  async getHistoricalBars(fullTicker, fromDate, toDate, { preferredProvider = null } = {}) {
    return await this._tryChain(fullTicker, preferredProvider, provider =>
      provider.getHistoricalData(fullTicker, fromDate, toDate)
    );
  },

  // -> { price, currency, timestamp, providerId, ... }
  async getRealTimePrice(fullTicker, { preferredProvider = null } = {}) {
    return await this._tryChain(fullTicker, preferredProvider, provider =>
      provider.getRealTimePrice(fullTicker)
    );
  },

  // pair in EOD format ('EURUSD.FOREX') -> { rate, change, changePercent, timestamp, providerId, ... }
  async getFxRate(pair, { preferredProvider = null } = {}) {
    return await this._tryChain(pair, preferredProvider, provider =>
      provider.getFxRate(pair)
    );
  },

  /**
   * Multi-provider security search. EOD runs first (unchanged behavior); the
   * secondary providers are only consulted when EOD returns few results, which
   * keeps autocomplete keystrokes from draining the Twelve Data free tier.
   * Results are EOD-shaped rows, deduped by ISIN then Code+Exchange (EOD wins).
   */
  async searchSecurities(query, limit = 15) {
    let results = [];
    try {
      results = await EODProvider.searchSecurities(query, limit);
    } catch (error) {
      console.log(`[MarketDataRouter] EOD search failed for "${query}": ${error.message}`);
    }

    // Gap-fill threshold: a strong EOD result set (5+) skips secondary
    // providers to protect their request budget; a thin one (like a Japanese
    // local code matching only stray bonds) consults them.
    if (results.length >= 5) return results.slice(0, limit);

    const secondaryDocs = await DataProvidersCollection.find(
      { enabled: true, hasApiKey: true, providerId: { $ne: EODProvider.id }, 'capabilities.search': true },
      { sort: { priority: 1 } }
    ).fetchAsync();

    for (const doc of secondaryDocs) {
      const provider = PROVIDER_REGISTRY[doc.providerId];
      if (!provider) continue;
      try {
        const extra = await provider.searchSecurities(query, limit);
        const seenIsin = new Set(results.map(r => r.ISIN).filter(Boolean));
        const seenKey = new Set(results.map(r => `${r.Code}.${r.Exchange}`));
        for (const row of extra) {
          if (row.ISIN && seenIsin.has(row.ISIN)) continue;
          if (seenKey.has(`${row.Code}.${row.Exchange}`)) continue;
          results.push(row);
          if (row.ISIN) seenIsin.add(row.ISIN);
          seenKey.add(`${row.Code}.${row.Exchange}`);
        }
      } catch (error) {
        console.log(`[MarketDataRouter] ${doc.providerId} search failed for "${query}": ${error.message}`);
      }
    }
    return results.slice(0, limit);
  },

  // Dashboard "test ticker": run a short history + quote against EVERY enabled
  // provider individually (bypassing fallback) so coverage gaps are visible.
  async testTicker(fullTicker) {
    const docs = await DataProvidersCollection.find(
      { enabled: true, hasApiKey: true },
      { sort: { priority: 1 } }
    ).fetchAsync();

    const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const results = [];
    for (const doc of docs) {
      const provider = PROVIDER_REGISTRY[doc.providerId];
      if (!provider) continue;
      const entry = { providerId: provider.id, name: provider.name };
      if (!provider.supports(fullTicker) || !provider.capabilities[tickerCapability(fullTicker)]) {
        results.push({ ...entry, ok: false, error: 'Ticker not supported by this provider' });
        continue;
      }
      try {
        const [history, quote] = await Promise.all([
          provider.getHistoricalData(fullTicker, fromDate, new Date()),
          provider.getRealTimePrice(fullTicker).catch(e => ({ error: e.message }))
        ]);
        results.push({
          ...entry,
          ok: true,
          barCount: history.bars.length,
          latestClose: history.bars[history.bars.length - 1]?.close ?? null,
          currency: history.currency,
          livePrice: quote.error ? null : quote.price,
          liveError: quote.error || null
        });
      } catch (error) {
        results.push({ ...entry, ok: false, error: error.message });
      }
    }
    return results;
  }
};
