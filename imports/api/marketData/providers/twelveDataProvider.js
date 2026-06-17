import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { ProviderError, PROVIDER_ERROR } from './providerInterface';
import { toTwelveDataParams, fromTwelveDataResult, normalizeCurrency } from './twelveDataSymbolMap';
import { getRateLimiter } from '../rateLimiter';
import { DataProvidersCollection } from '../dataProvidersCollection';

const TD_BASE_URL = 'https://api.twelvedata.com';

// Twelve Data returns most errors as HTTP 200 with a JSON error body:
// { code: 404, message: '...', status: 'error' } — so the body must be checked.
function classifyTdError(code, message) {
  if (code === 429) return new ProviderError(PROVIDER_ERROR.RATE_LIMIT, message);
  if (code === 401 || code === 403) return new ProviderError(PROVIDER_ERROR.AUTH, message);
  if (code === 400 || code === 404) return new ProviderError(PROVIDER_ERROR.NO_DATA, message);
  return new ProviderError(PROVIDER_ERROR.TRANSIENT, message);
}

async function tdGet(path, params) {
  const apiKey = Meteor.settings.private?.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    throw new ProviderError(PROVIDER_ERROR.AUTH, 'TWELVE_DATA_API_KEY not configured');
  }

  const providerDoc = await DataProvidersCollection.findOneAsync(
    { providerId: 'TWELVE_DATA' },
    { fields: { rateLimit: 1 } }
  );
  const limiter = getRateLimiter('TWELVE_DATA', providerDoc?.rateLimit || { perMinute: 8, perDay: 800 });
  await limiter.acquire();

  let response;
  try {
    response = await HTTP.get(`${TD_BASE_URL}${path}`, {
      params: { ...params, apikey: apiKey },
      timeout: 30000
    });
  } catch (error) {
    const statusCode = error.response?.statusCode;
    if (statusCode) throw classifyTdError(statusCode, error.response?.content || error.message);
    throw new ProviderError(PROVIDER_ERROR.TRANSIENT, `Twelve Data request failed: ${error.message}`);
  }

  const data = response.data;
  if (data && data.status === 'error') {
    throw classifyTdError(data.code, data.message);
  }
  return data;
}

function symbolParams(fullTicker) {
  const mapped = toTwelveDataParams(fullTicker);
  if (!mapped || mapped.fx) {
    throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Twelve Data has no mapping for ${fullTicker}`);
  }
  const params = { symbol: mapped.symbol };
  if (mapped.micCode) params.mic_code = mapped.micCode;
  return params;
}

export const TwelveDataProvider = {
  id: 'TWELVE_DATA',
  name: 'Twelve Data',
  capabilities: { equity: true, etf: true, index: false, fx: true, bond: false, search: true },

  supports(fullTicker) {
    return toTwelveDataParams(fullTicker) !== null;
  },

  async getHistoricalData(fullTicker, fromDate, toDate) {
    const formatDate = d => d.toISOString().split('T')[0];
    const data = await tdGet('/time_series', {
      ...symbolParams(fullTicker),
      interval: '1day',
      start_date: formatDate(fromDate),
      end_date: formatDate(toDate || new Date()),
      outputsize: 5000,
      order: 'ASC'
    });

    const values = data?.values;
    if (!values || values.length === 0) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Twelve Data returned no bars for ${fullTicker}`);
    }

    const bars = values.map(v => ({
      date: new Date(v.datetime),
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: parseInt(v.volume) || 0,
      // Twelve Data daily series is split-adjusted by default
      adjustedClose: parseFloat(v.close)
    }));
    return { bars, currency: normalizeCurrency(data.meta?.currency) };
  },

  async getRealTimePrice(fullTicker) {
    const data = await tdGet('/quote', symbolParams(fullTicker));
    const price = parseFloat(data?.close);
    if (!price || isNaN(price)) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Twelve Data returned no quote for ${fullTicker}`);
    }
    return {
      price,
      currency: normalizeCurrency(data.currency),
      timestamp: new Date()
    };
  },

  // pair in EOD format, e.g. 'EURUSD.FOREX'
  async getFxRate(pair) {
    const mapped = toTwelveDataParams(pair);
    if (!mapped || !mapped.fx) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Invalid FX pair for Twelve Data: ${pair}`);
    }
    const data = await tdGet('/exchange_rate', { symbol: mapped.symbol });
    const rate = parseFloat(data?.rate);
    if (!rate || isNaN(rate)) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Twelve Data returned no rate for ${pair}`);
    }
    return { rate, change: null, changePercent: null, timestamp: new Date() };
  },

  async searchSecurities(query, limit = 20) {
    const data = await tdGet('/symbol_search', { symbol: query, outputsize: Math.min(limit * 2, 60) });
    const rows = data?.data || [];
    return rows
      .map(fromTwelveDataResult)
      .filter(Boolean)
      .slice(0, limit);
  }
};
