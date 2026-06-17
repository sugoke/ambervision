import { Meteor } from 'meteor/meteor';
import { EODApiHelpers } from '../../eodApi';
import { ProviderError, PROVIDER_ERROR } from './providerInterface';

// Thin adapter over the existing EODApiHelpers — eodApi.js stays untouched.
// Translates EOD raw responses and Meteor.Errors into the normalized provider
// contract so the router can treat EOD like any other provider.

const EOD_ERROR_KIND = {
  'eod-symbol-not-found': PROVIDER_ERROR.NO_DATA,
  'eod-auth-failed': PROVIDER_ERROR.AUTH,
  'eod-rate-limit': PROVIDER_ERROR.RATE_LIMIT
};

function toProviderError(error) {
  if (error instanceof ProviderError) return error;
  const kind = EOD_ERROR_KIND[error.error] || PROVIDER_ERROR.TRANSIENT;
  return new ProviderError(kind, error.reason || error.message);
}

// All US exchanges use the .US suffix on EOD price endpoints
// (mirrors the inline normalization previously done in marketDataCache.js).
function splitTicker(fullTicker) {
  const [symbol, exchange] = fullTicker.split('.');
  if (!symbol || !exchange) {
    throw new ProviderError(PROVIDER_ERROR.NO_DATA, `Invalid fullTicker format: ${fullTicker}`);
  }
  let apiExchange = exchange;
  if (exchange === 'NASDAQ' || exchange === 'NYSE' || exchange === 'AMEX') {
    apiExchange = 'US';
  }
  return { symbol, exchange, apiExchange };
}

export const EODProvider = {
  id: 'EOD',
  name: 'EOD Historical Data',
  capabilities: { equity: true, etf: true, index: true, fx: true, bond: true, search: true },

  // EOD is the universal default — it accepts any canonical ticker.
  supports() {
    return true;
  },

  async getHistoricalData(fullTicker, fromDate, toDate) {
    const { symbol, apiExchange } = splitTicker(fullTicker);
    let rows;
    try {
      rows = await EODApiHelpers.getHistoricalData(symbol, apiExchange, fromDate, toDate);
    } catch (error) {
      throw toProviderError(error);
    }
    if (!rows || rows.length === 0) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `EOD returned no data for ${fullTicker}`);
    }
    const bars = rows.map(day => ({
      date: new Date(day.date),
      open: parseFloat(day.open),
      high: parseFloat(day.high),
      low: parseFloat(day.low),
      close: parseFloat(day.close),
      volume: parseInt(day.volume),
      adjustedClose: parseFloat(day.adjusted_close || day.close)
    }));
    return { bars, currency: rows[0].currency || null };
  },

  async getRealTimePrice(fullTicker) {
    const { symbol, apiExchange } = splitTicker(fullTicker);
    let data;
    try {
      data = await EODApiHelpers.getRealTimePrice(symbol, apiExchange);
    } catch (error) {
      throw toProviderError(error);
    }
    const price = data && parseFloat(data.close || data.price);
    if (!price || isNaN(price)) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `EOD returned no price for ${fullTicker}`);
    }
    return { price, currency: data.currency || null, timestamp: new Date() };
  },

  // pair in EOD format, e.g. 'EURUSD.FOREX' — same endpoint CurrencyCache uses.
  async getFxRate(pair) {
    let data;
    try {
      data = await EODApiHelpers.getRealTimePrice(pair.split('.')[0], 'FOREX');
    } catch (error) {
      throw toProviderError(error);
    }
    const rate = data && parseFloat(data.close || data.price || data.last);
    if (!rate || isNaN(rate)) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `EOD returned no rate for ${pair}`);
    }
    return {
      rate,
      change: data.change ?? null,
      changePercent: data.change_p ?? null,
      timestamp: new Date()
    };
  },

  async searchSecurities(query, limit = 20) {
    try {
      return await EODApiHelpers.searchSecurities(query, limit);
    } catch (error) {
      throw toProviderError(error);
    }
  }
};
