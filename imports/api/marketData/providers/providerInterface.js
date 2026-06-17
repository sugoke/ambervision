/**
 * Market data provider contract.
 *
 * Every provider adapter exposes the same shape so the MarketDataRouter can
 * chain them by priority without knowing anything provider-specific:
 *
 * {
 *   id: String,                    // stable identifier, stored in cache docs as dataSource
 *   name: String,                  // display name for the dashboard
 *   capabilities: {                // which ticker classes the provider can serve
 *     equity: Boolean, etf: Boolean, index: Boolean,
 *     fx: Boolean, bond: Boolean, search: Boolean
 *   },
 *   supports(fullTicker): Boolean, // cheap static check (symbol mapping exists, etc.)
 *   getHistoricalData(fullTicker, fromDate, toDate)
 *     -> { bars: [{ date, open, high, low, close, volume, adjustedClose }], currency: String|null },
 *   getRealTimePrice(fullTicker)
 *     -> { price: Number, currency: String|null, timestamp: Date },
 *   getFxRate(pair)                // pair in EOD format, e.g. 'EURUSD.FOREX'
 *     -> { rate: Number, change: Number|null, changePercent: Number|null, timestamp: Date },
 *   searchSecurities(query, limit)
 *     -> [EOD-shaped rows: { Code, Name, Exchange, Type, Currency, Country, ISIN }]
 * }
 *
 * All tickers passed in are canonical EOD format (TICKER.EXCHANGE); adapters
 * translate at their own boundary.
 */

// Error taxonomy. The kind drives router behavior:
// - 'no-data' / 'auth'    -> permanent for this ticker: the router may persist a
//                            provider switch on the cache doc.
// - 'rate-limit' / 'transient' -> fall through to the next provider for this one
//                            call only; never persist a switch.
export const PROVIDER_ERROR = {
  NO_DATA: 'no-data',
  RATE_LIMIT: 'rate-limit',
  AUTH: 'auth',
  TRANSIENT: 'transient'
};

export class ProviderError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'ProviderError';
    this.kind = Object.values(PROVIDER_ERROR).includes(kind) ? kind : PROVIDER_ERROR.TRANSIENT;
  }
}

// Classify a fullTicker into a capability key so the router can filter providers.
export function tickerCapability(fullTicker) {
  const suffix = (fullTicker.split('.').pop() || '').toUpperCase();
  if (suffix === 'FOREX') return 'fx';
  if (suffix === 'INDX') return 'index';
  if (suffix === 'EUBOND') return 'bond';
  return 'equity';
}
