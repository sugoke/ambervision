import { Meteor } from 'meteor/meteor';
import { DataProvidersCollection, recordProviderHealth } from './dataProvidersCollection';
import { ProviderError, PROVIDER_ERROR, tickerCapability } from './providers/providerInterface';
import { EODProvider } from './providers/eodProvider';
import { TelekursProvider } from './providers/telekursProvider';

// Static registry — adding a future provider (bonds etc.) means writing an
// adapter that implements providerInterface and listing it here + in the seed.
const PROVIDER_REGISTRY = {
  [EODProvider.id]: EODProvider,
  [TelekursProvider.id]: TelekursProvider
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
   * Security search — EOD is the only search-capable provider (Telekurs is a
   * price-only fallback, not a discovery source), so this is a thin pass-through.
   * Results are EOD-shaped rows.
   */
  async searchSecurities(query, limit = 15) {
    try {
      const results = await EODProvider.searchSecurities(query, limit);
      return results.slice(0, limit);
    } catch (error) {
      console.log(`[MarketDataRouter] EOD search failed for "${query}": ${error.message}`);
      return [];
    }
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
