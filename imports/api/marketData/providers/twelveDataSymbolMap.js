/**
 * Symbol translation between the app's canonical EOD-style tickers
 * (TICKER.EXCHANGE, e.g. '7203.TSE') and Twelve Data's model
 * (bare symbol + ISO 10383 MIC code, e.g. symbol=7203 & mic_code=XJPX).
 */

// EOD exchange suffix -> Twelve Data MIC code.
// null = US listing (Twelve Data resolves bare US symbols without a MIC).
// Entries absent from this map are unsupported on Twelve Data (INDX, EUBOND, CC, ...).
const EOD_SUFFIX_TO_MIC = {
  US: null, NASDAQ: null, NYSE: null, AMEX: null, BATS: null,

  TSE: 'XJPX',   // Tokyo (EOD calls it TSE) — the motivating gap-fill case
  TO: 'XTSE',    // Toronto
  V: 'XTSX',     // TSX Venture
  L: 'XLON', LSE: 'XLON',
  PA: 'XPAR',
  AS: 'XAMS', AMS: 'XAMS',
  BR: 'XBRU',
  LS: 'XLIS',
  MI: 'XMIL',
  MC: 'XMAD',
  DE: 'XETR', XETRA: 'XETR',
  F: 'XFRA', FWB: 'XFRA',
  SW: 'XSWX', SIX: 'XSWX', SWX: 'XSWX', // SIX blue chips retried as XVTX on no-data
  VI: 'XWBO',
  ST: 'XSTO',
  CO: 'XCSE',
  HE: 'XHEL',
  OL: 'XOSL',
  IC: 'XICE',
  WAR: 'XWAR',
  PR: 'XPRA',
  BUD: 'XBUD',
  AT: 'ASEX',
  IR: 'XDUB',
  HK: 'XHKG', HKG: 'XHKG',
  AU: 'XASX', ASX: 'XASX',
  SG: 'XSES',
  KO: 'XKRX',
  KQ: 'XKOS',
  TW: 'XTAI',
  SHG: 'XSHG',
  SHE: 'XSHE',
  NSE: 'XNSE',
  BSE: 'XBOM',
  MX: 'XMEX',
  SA: 'BVMF',
  TA: 'XTAE',
  JSE: 'XJSE',
  SR: 'XSAU'
};

// Inverse map for converting Twelve Data search results back to canonical
// EOD-style fullTickers. US MICs all collapse to the .US suffix.
export const MIC_TO_EOD_SUFFIX = {
  XNAS: 'US', XNYS: 'US', XASE: 'US', ARCX: 'US', BATS: 'US', XNGS: 'US', XNMS: 'US', XNCM: 'US', IEXG: 'US',
  XJPX: 'TSE',
  XTSE: 'TO', XTSX: 'V',
  XLON: 'L',
  XPAR: 'PA', XAMS: 'AS', XBRU: 'BR', XLIS: 'LS',
  XMIL: 'MI', XMAD: 'MC',
  XETR: 'DE', XFRA: 'F',
  XSWX: 'SW', XVTX: 'SW',
  XWBO: 'VI',
  XSTO: 'ST', XCSE: 'CO', XHEL: 'HE', XOSL: 'OL', XICE: 'IC',
  XWAR: 'WAR', XPRA: 'PR', XBUD: 'BUD',
  ASEX: 'AT', XDUB: 'IR',
  XHKG: 'HK', XASX: 'AU', XSES: 'SG',
  XKRX: 'KO', XKOS: 'KQ', XTAI: 'TW',
  XSHG: 'SHG', XSHE: 'SHE',
  XNSE: 'NSE', XBOM: 'BSE',
  XMEX: 'MX', BVMF: 'SA',
  XTAE: 'TA', XJSE: 'JSE', XSAU: 'SR'
};

/**
 * Canonical fullTicker -> Twelve Data request params.
 * Returns:
 *   { symbol, micCode|null }            for equities/ETFs
 *   { fx: true, symbol: 'EUR/USD' }     for FOREX pairs
 *   null                                if Twelve Data can't serve this ticker
 */
export function toTwelveDataParams(fullTicker) {
  const dotIndex = fullTicker.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const symbol = fullTicker.slice(0, dotIndex);
  const suffix = fullTicker.slice(dotIndex + 1).toUpperCase();

  if (suffix === 'FOREX') {
    // EOD pair format: EURUSD.FOREX -> TD format: EUR/USD
    if (symbol.length !== 6) return null;
    return { fx: true, symbol: `${symbol.slice(0, 3)}/${symbol.slice(3)}` };
  }

  if (!(suffix in EOD_SUFFIX_TO_MIC)) return null; // INDX, EUBOND, CC, COMM, MONEY...
  return { symbol, micCode: EOD_SUFFIX_TO_MIC[suffix] };
}

/**
 * Twelve Data /symbol_search row -> EOD-shaped search result, or null when the
 * MIC can't be mapped back (we must never emit a fullTicker we can't price).
 * TD row: { symbol, instrument_name, exchange, mic_code, currency, country, instrument_type }
 */
export function fromTwelveDataResult(row) {
  const suffix = MIC_TO_EOD_SUFFIX[row.mic_code];
  if (!suffix || !row.symbol) return null;
  return {
    Code: row.symbol,
    Name: row.instrument_name || row.symbol,
    Exchange: suffix,
    Type: row.instrument_type || 'Common Stock',
    Currency: normalizeCurrency(row.currency),
    Country: row.country || '',
    ISIN: row.isin || null,
    source: 'TWELVE_DATA'
  };
}

// Twelve Data reports London prices in 'GBp' (pence); the rest of the app
// uses EOD's 'GBX' convention for pence.
export function normalizeCurrency(currency) {
  if (!currency) return null;
  if (currency === 'GBp' || currency === 'GBp.') return 'GBX';
  return currency;
}
