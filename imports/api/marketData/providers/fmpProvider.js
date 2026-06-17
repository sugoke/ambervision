import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { ProviderError, PROVIDER_ERROR } from './providerInterface';
import { toFmpSymbol, fromFmpResult } from './fmpSymbolMap';
import { getRateLimiter } from '../rateLimiter';
import { DataProvidersCollection } from '../dataProvidersCollection';

// Financial Modeling Prep — uses the current "stable" API
// (the /api/v3 endpoints are legacy and rejected for new keys).
const FMP_BASE_URL = 'https://financialmodelingprep.com/stable';

// FMP status codes (verified live):
// 402 = symbol not included in current plan OR unknown symbol -> no-data
// 401 = invalid API key -> auth
// 429 = rate limit
function classifyFmpError(statusCode, message) {
  if (statusCode === 429) return new ProviderError(PROVIDER_ERROR.RATE_LIMIT, message);
  if (statusCode === 401) return new ProviderError(PROVIDER_ERROR.AUTH, message);
  if (statusCode === 402 || statusCode === 403 || statusCode === 404) {
    return new ProviderError(PROVIDER_ERROR.NO_DATA, message);
  }
  return new ProviderError(PROVIDER_ERROR.TRANSIENT, message);
}

async function fmpGet(path, params) {
  const apiKey = Meteor.settings.private?.FMP_API_KEY;
  if (!apiKey) {
    throw new ProviderError(PROVIDER_ERROR.AUTH, 'FMP_API_KEY not configured');
  }

  const providerDoc = await DataProvidersCollection.findOneAsync(
    { providerId: 'FMP' },
    { fields: { rateLimit: 1 } }
  );
  const limiter = getRateLimiter('FMP', providerDoc?.rateLimit || { perMinute: 10, perDay: 250 });
  await limiter.acquire();

  let response;
  try {
    response = await HTTP.get(`${FMP_BASE_URL}${path}`, {
      params: { ...params, apikey: apiKey },
      timeout: 30000
    });
  } catch (error) {
    const statusCode = error.response?.statusCode;
    if (statusCode) {
      throw classifyFmpError(statusCode, error.response?.content?.slice(0, 200) || error.message);
    }
    throw new ProviderError(PROVIDER_ERROR.TRANSIENT, `FMP request failed: ${error.message}`);
  }

  // Some FMP errors arrive as HTTP 200 with an "Error Message" body.
  if (response.data && !Array.isArray(response.data) && response.data['Error Message']) {
    throw new ProviderError(PROVIDER_ERROR.NO_DATA, response.data['Error Message']);
  }
  return response.data;
}

function equitySymbol(fullTicker) {
  const mapped = toFmpSymbol(fullTicker);
  if (!mapped || mapped.fx) {
    throw new ProviderError(PROVIDER_ERROR.NO_DATA, `FMP has no mapping for ${fullTicker}`);
  }
  return mapped;
}

export const FMPProvider = {
  id: 'FMP',
  name: 'Financial Modeling Prep',
  capabilities: { equity: true, etf: true, index: false, fx: true, bond: false, search: true },

  supports(fullTicker) {
    return toFmpSymbol(fullTicker) !== null;
  },

  async getHistoricalData(fullTicker, fromDate, toDate) {
    const mapped = equitySymbol(fullTicker);
    const formatDate = d => d.toISOString().split('T')[0];
    const rows = await fmpGet('/historical-price-eod/full', {
      symbol: mapped.symbol,
      from: formatDate(fromDate),
      to: formatDate(toDate || new Date())
    });

    if (!Array.isArray(rows) || rows.length === 0) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `FMP returned no bars for ${fullTicker}`);
    }

    // FMP returns newest-first; normalize to ascending like the other providers.
    const bars = rows
      .map(r => ({
        date: new Date(r.date),
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.close),
        volume: parseInt(r.volume) || 0,
        adjustedClose: parseFloat(r.adjClose ?? r.close)
      }))
      .sort((a, b) => a.date - b.date);
    return { bars, currency: mapped.currency };
  },

  async getRealTimePrice(fullTicker) {
    const mapped = equitySymbol(fullTicker);
    const data = await fmpGet('/quote', { symbol: mapped.symbol });
    const quote = Array.isArray(data) ? data[0] : data;
    const price = quote && parseFloat(quote.price);
    if (!price || isNaN(price)) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `FMP returned no quote for ${fullTicker}`);
    }
    return { price, currency: mapped.currency, timestamp: new Date() };
  },

  // pair in EOD format, e.g. 'EURUSD.FOREX' -> FMP symbol 'EURUSD'
  async getFxRate(pair) {
    const mapped = toFmpSymbol(pair);
    if (!mapped || !mapped.fx) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Invalid FX pair for FMP: ${pair}`);
    }
    const data = await fmpGet('/quote', { symbol: mapped.symbol });
    const quote = Array.isArray(data) ? data[0] : data;
    const rate = quote && parseFloat(quote.price);
    if (!rate || isNaN(rate)) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `FMP returned no rate for ${pair}`);
    }
    return {
      rate,
      change: quote.change ?? null,
      changePercent: quote.changePercentage ?? null,
      timestamp: new Date()
    };
  },

  async searchSecurities(query, limit = 20) {
    // Ticker-looking queries hit symbol search; everything else name search
    // (one request each way — the free tier is only 250/day).
    const looksLikeTicker = /^[A-Za-z0-9.\-]{1,12}$/.test(query.trim());
    const path = looksLikeTicker ? '/search-symbol' : '/search-name';
    const rows = await fmpGet(path, { query: query.trim(), limit });
    if (!Array.isArray(rows)) return [];
    return rows
      .map(fromFmpResult)
      .filter(Boolean)
      .slice(0, limit);
  }
};
