/**
 * Symbol translation between the app's canonical EOD-style tickers
 * (TICKER.EXCHANGE, e.g. '7203.TSE') and Financial Modeling Prep's
 * Yahoo-style suffixes (e.g. '7203.T' for Tokyo, bare 'AAPL' for US).
 */

// EOD exchange suffix -> { fmp: FMP suffix (null = bare US symbol), currency }
// The currency is needed because FMP quote/historical responses don't include
// one; entries absent from this map are unsupported on FMP (INDX, EUBOND, CC...).
const EOD_SUFFIX_TO_FMP = {
  US: { fmp: null, currency: 'USD' },
  NASDAQ: { fmp: null, currency: 'USD' },
  NYSE: { fmp: null, currency: 'USD' },
  AMEX: { fmp: null, currency: 'USD' },
  BATS: { fmp: null, currency: 'USD' },

  TSE: { fmp: 'T', currency: 'JPY' },    // Tokyo (EOD: TSE, FMP: .T)
  TO: { fmp: 'TO', currency: 'CAD' },
  V: { fmp: 'V', currency: 'CAD' },
  L: { fmp: 'L', currency: 'GBX' },      // LSE quotes in pence
  LSE: { fmp: 'L', currency: 'GBX' },
  PA: { fmp: 'PA', currency: 'EUR' },
  AS: { fmp: 'AS', currency: 'EUR' },
  AMS: { fmp: 'AS', currency: 'EUR' },
  BR: { fmp: 'BR', currency: 'EUR' },
  LS: { fmp: 'LS', currency: 'EUR' },
  MI: { fmp: 'MI', currency: 'EUR' },
  MC: { fmp: 'MC', currency: 'EUR' },
  DE: { fmp: 'DE', currency: 'EUR' },    // XETRA
  XETRA: { fmp: 'DE', currency: 'EUR' },
  F: { fmp: 'F', currency: 'EUR' },      // Frankfurt
  FWB: { fmp: 'F', currency: 'EUR' },
  SW: { fmp: 'SW', currency: 'CHF' },
  SIX: { fmp: 'SW', currency: 'CHF' },
  SWX: { fmp: 'SW', currency: 'CHF' },
  VI: { fmp: 'VI', currency: 'EUR' },
  ST: { fmp: 'ST', currency: 'SEK' },
  CO: { fmp: 'CO', currency: 'DKK' },
  HE: { fmp: 'HE', currency: 'EUR' },
  OL: { fmp: 'OL', currency: 'NOK' },
  IC: { fmp: 'IC', currency: 'ISK' },
  WAR: { fmp: 'WA', currency: 'PLN' },
  PR: { fmp: 'PR', currency: 'CZK' },
  BUD: { fmp: 'BD', currency: 'HUF' },
  AT: { fmp: 'AT', currency: 'EUR' },
  IR: { fmp: 'IR', currency: 'EUR' },
  HK: { fmp: 'HK', currency: 'HKD' },
  HKG: { fmp: 'HK', currency: 'HKD' },
  AU: { fmp: 'AX', currency: 'AUD' },
  ASX: { fmp: 'AX', currency: 'AUD' },
  SG: { fmp: 'SI', currency: 'SGD' },
  KO: { fmp: 'KS', currency: 'KRW' },
  KQ: { fmp: 'KQ', currency: 'KRW' },
  TW: { fmp: 'TW', currency: 'TWD' },
  SHG: { fmp: 'SS', currency: 'CNY' },
  SHE: { fmp: 'SZ', currency: 'CNY' },
  NSE: { fmp: 'NS', currency: 'INR' },
  BSE: { fmp: 'BO', currency: 'INR' },
  MX: { fmp: 'MX', currency: 'MXN' },
  SA: { fmp: 'SA', currency: 'BRL' },
  TA: { fmp: 'TA', currency: 'ILS' },
  JSE: { fmp: 'JO', currency: 'ZAR' },
  SR: { fmp: 'SR', currency: 'SAR' }
};

// Inverse: FMP suffix -> EOD suffix (US handled separately via bare symbols).
const FMP_SUFFIX_TO_EOD = {};
for (const [eodSuffix, info] of Object.entries(EOD_SUFFIX_TO_FMP)) {
  if (info.fmp && !(info.fmp in FMP_SUFFIX_TO_EOD)) {
    FMP_SUFFIX_TO_EOD[info.fmp] = eodSuffix;
  }
}
// Prefer the canonical EOD names over aliases for round-trips.
Object.assign(FMP_SUFFIX_TO_EOD, {
  T: 'TSE', L: 'L', AS: 'AS', DE: 'DE', F: 'F', SW: 'SW',
  HK: 'HK', AX: 'AU', SI: 'SG'
});

const FMP_US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'BATS', 'OTC', 'CBOE', 'ARCA']);

/**
 * Canonical fullTicker -> FMP request symbol.
 * Returns:
 *   { symbol, currency }           for equities/ETFs ('7203.TSE' -> { symbol: '7203.T', currency: 'JPY' })
 *   { fx: true, symbol: 'EURUSD' } for FOREX pairs
 *   null                           if FMP can't serve this ticker
 */
export function toFmpSymbol(fullTicker) {
  const dotIndex = fullTicker.lastIndexOf('.');
  if (dotIndex <= 0) return null;
  const symbol = fullTicker.slice(0, dotIndex);
  const suffix = fullTicker.slice(dotIndex + 1).toUpperCase();

  if (suffix === 'FOREX') {
    if (symbol.length !== 6) return null;
    return { fx: true, symbol }; // FMP uses 'EURUSD' directly
  }

  const info = EOD_SUFFIX_TO_FMP[suffix];
  if (!info) return null; // INDX, EUBOND, CC, COMM...
  return {
    symbol: info.fmp ? `${symbol}.${info.fmp}` : symbol,
    currency: info.currency
  };
}

/**
 * FMP search row -> EOD-shaped search result, or null when the symbol's
 * suffix/exchange can't be mapped back to a priceable canonical ticker.
 * FMP row: { symbol: '7203.T', name, currency, exchangeFullName, exchange: 'JPX' }
 */
export function fromFmpResult(row) {
  if (!row.symbol) return null;
  const dotIndex = row.symbol.lastIndexOf('.');

  let code, eodSuffix;
  if (dotIndex > 0) {
    code = row.symbol.slice(0, dotIndex);
    eodSuffix = FMP_SUFFIX_TO_EOD[row.symbol.slice(dotIndex + 1).toUpperCase()];
  } else {
    code = row.symbol;
    eodSuffix = FMP_US_EXCHANGES.has((row.exchange || '').toUpperCase()) ? 'US' : null;
  }
  if (!eodSuffix) return null;

  return {
    Code: code,
    Name: row.name || code,
    Exchange: eodSuffix,
    Type: 'Common Stock',
    Currency: row.currency === 'GBp' ? 'GBX' : (row.currency || null),
    Country: '',
    ISIN: null,
    source: 'FMP'
  };
}
