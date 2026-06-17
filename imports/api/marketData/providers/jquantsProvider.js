import { Meteor } from 'meteor/meteor';
import { HTTP } from 'meteor/http';
import { ProviderError, PROVIDER_ERROR } from './providerInterface';
import { getRateLimiter } from '../rateLimiter';
import { DataProvidersCollection } from '../dataProvidersCollection';

/**
 * J-Quants — the official Japan Exchange Group (JPX) data API.
 * Japan-only provider: serves .TSE tickers exclusively, which makes it the
 * natural gap-filler the other providers' free plans can't cover.
 *
 * Uses the V2 API (accounts registered after Dec 2025 are V2-only):
 * - auth: x-api-key header (key from the J-Quants dashboard)
 * - daily bars: GET /v2/equities/bars/daily?code=72030&from=&to=
 * - master list: GET /v2/equities/master (no name search — cached + filtered locally)
 *
 * Code format: canonical '7203.TSE' <-> J-Quants 5-char code '72030'
 * (4-char local code + trailing '0'; alphanumeric codes like 130A work the same).
 *
 * NOTE: J-Quants provides end-of-day data only (and the free plan is delayed
 * by ~12 weeks). getRealTimePrice returns the latest available daily close
 * with its real date so consumers see correct timestamps.
 */
const JQUANTS_BASE_URL = 'https://api.jquants.com/v2';

function classifyJqError(statusCode, message) {
  if (statusCode === 429) return new ProviderError(PROVIDER_ERROR.RATE_LIMIT, message);
  if (statusCode === 401 || statusCode === 403) return new ProviderError(PROVIDER_ERROR.AUTH, message);
  if (statusCode === 400 || statusCode === 404) return new ProviderError(PROVIDER_ERROR.NO_DATA, message);
  return new ProviderError(PROVIDER_ERROR.TRANSIENT, message);
}

async function jqGet(path, params) {
  const apiKey = Meteor.settings.private?.J_QUANTS_API_KEY;
  if (!apiKey) {
    throw new ProviderError(PROVIDER_ERROR.AUTH, 'J_QUANTS_API_KEY not configured');
  }

  const providerDoc = await DataProvidersCollection.findOneAsync(
    { providerId: 'JQUANTS' },
    { fields: { rateLimit: 1 } }
  );
  const limiter = getRateLimiter('JQUANTS', providerDoc?.rateLimit || { perMinute: 60, perDay: 5000 });
  await limiter.acquire();

  try {
    const response = await HTTP.get(`${JQUANTS_BASE_URL}${path}`, {
      params,
      headers: { 'x-api-key': apiKey },
      timeout: 30000
    });
    return response.data;
  } catch (error) {
    const statusCode = error.response?.statusCode;
    if (statusCode) {
      const body = typeof error.response.content === 'string'
        ? error.response.content.slice(0, 200)
        : error.message;
      throw classifyJqError(statusCode, body);
    }
    throw new ProviderError(PROVIDER_ERROR.TRANSIENT, `J-Quants request failed: ${error.message}`);
  }
}

// '7203.TSE' -> '72030'; null for anything that isn't a Tokyo listing.
function toJquantsCode(fullTicker) {
  const dotIndex = fullTicker.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const symbol = fullTicker.slice(0, dotIndex).toUpperCase();
  const suffix = fullTicker.slice(dotIndex + 1).toUpperCase();
  if (suffix !== 'TSE') return null;
  if (!/^[A-Z0-9]{4,5}$/.test(symbol)) return null;
  return symbol.length === 4 ? `${symbol}0` : symbol;
}

// '72030' -> '7203' (5-char codes ending in 0 are the common listing).
function fromJquantsCode(code) {
  if (typeof code === 'string' && code.length === 5 && code.endsWith('0')) {
    return code.slice(0, 4);
  }
  return code;
}

async function fetchDailyBars(code, fromDate, toDate) {
  const formatDate = d => d.toISOString().split('T')[0];
  const rows = [];
  let paginationKey;
  do {
    const params = { code, from: formatDate(fromDate), to: formatDate(toDate) };
    if (paginationKey) params.pagination_key = paginationKey;
    const data = await jqGet('/equities/bars/daily', params);
    if (Array.isArray(data?.data)) rows.push(...data.data);
    paginationKey = data?.pagination_key;
  } while (paginationKey);
  return rows;
}

// Listed-issue master cache (~4000 issues, name search is done locally).
let masterCache = { data: null, fetchedAt: null };
const MASTER_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 1 week

async function getMasterList() {
  const now = Date.now();
  if (masterCache.data && now - masterCache.fetchedAt < MASTER_CACHE_DURATION) {
    return masterCache.data;
  }
  const issues = [];
  let paginationKey;
  do {
    const params = paginationKey ? { pagination_key: paginationKey } : {};
    const data = await jqGet('/equities/master', params);
    if (Array.isArray(data?.data)) issues.push(...data.data);
    paginationKey = data?.pagination_key;
  } while (paginationKey);
  masterCache = { data: issues, fetchedAt: now };
  console.log(`[JQuants] Cached listed-issue master: ${issues.length} issues`);
  return issues;
}

export const JQuantsProvider = {
  id: 'JQUANTS',
  name: 'J-Quants (JPX)',
  capabilities: { equity: true, etf: true, index: false, fx: false, bond: false, search: true },

  supports(fullTicker) {
    return toJquantsCode(fullTicker) !== null;
  },

  async getHistoricalData(fullTicker, fromDate, toDate) {
    const code = toJquantsCode(fullTicker);
    if (!code) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `J-Quants only serves .TSE tickers, got ${fullTicker}`);
    }
    const rows = await fetchDailyBars(code, fromDate, toDate || new Date());
    // Non-trading rows can carry null prices — drop them.
    const bars = rows
      .filter(r => r.C !== null && r.C !== undefined)
      .map(r => ({
        date: new Date(r.Date),
        open: parseFloat(r.O),
        high: parseFloat(r.H),
        low: parseFloat(r.L),
        close: parseFloat(r.C),
        volume: parseInt(r.Vo) || 0,
        adjustedClose: parseFloat(r.AdjC ?? r.C)
      }))
      .sort((a, b) => a.date - b.date);
    if (bars.length === 0) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `J-Quants returned no bars for ${fullTicker}`);
    }
    return { bars, currency: 'JPY' };
  },

  // EOD-only data: return the most recent daily close with its REAL date
  // (on the free plan this can be ~12 weeks old — the date makes that visible).
  async getRealTimePrice(fullTicker) {
    const code = toJquantsCode(fullTicker);
    if (!code) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `J-Quants only serves .TSE tickers, got ${fullTicker}`);
    }
    const fromDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000); // free-plan delay tolerant
    const rows = await fetchDailyBars(code, fromDate, new Date());
    const latest = rows.filter(r => r.C !== null && r.C !== undefined).pop();
    if (!latest) {
      throw new ProviderError(PROVIDER_ERROR.NO_DATA, `J-Quants has no recent close for ${fullTicker}`);
    }
    return {
      price: parseFloat(latest.C),
      currency: 'JPY',
      timestamp: new Date(latest.Date)
    };
  },

  async getFxRate(pair) {
    throw new ProviderError(PROVIDER_ERROR.NO_DATA, `J-Quants does not provide FX rates (${pair})`);
  },

  async searchSecurities(query, limit = 20) {
    const issues = await getMasterList();
    const q = query.trim().toLowerCase();
    const matches = [];
    for (const issue of issues) {
      const code4 = fromJquantsCode(issue.Code);
      const nameEn = (issue.CoNameEn || '').toLowerCase();
      const nameJp = issue.CoName || '';
      if (
        code4.toLowerCase().startsWith(q) ||
        nameEn.includes(q) ||
        nameJp.includes(query.trim())
      ) {
        matches.push({
          Code: code4,
          Name: issue.CoNameEn || issue.CoName || code4,
          Exchange: 'TSE',
          Type: 'Common Stock',
          Currency: 'JPY',
          Country: 'Japan',
          ISIN: null,
          source: 'JQUANTS'
        });
        if (matches.length >= limit) break;
      }
    }
    return matches;
  }
};
