/**
 * Ticker Utilities Test Suite
 *
 * Tests for ticker normalization, validation, and exchange mapping
 */

import { normalizeTickerSymbol, validateTickerFormat, getCurrencyFromTicker, isKnownStock, extractExchange } from '../imports/utils/tickerUtils';

console.log('=== Ticker Utils Test Suite ===\n');

// Test 1: US Stocks
console.log('Test 1: US Stocks');
const usStocks = ['AAPL', 'TSLA', 'MSFT', 'GOOGL'];
usStocks.forEach(symbol => {
  const normalized = normalizeTickerSymbol(symbol);
  const currency = getCurrencyFromTicker(normalized);
  console.log(`  ${symbol} → ${normalized} (${currency})`);
});
console.log('');

// Test 2: French Stocks
console.log('Test 2: French Stocks (Euronext Paris)');
const frenchStocks = ['TTE', 'AIR', 'MC', 'OR', 'BNP'];
frenchStocks.forEach(symbol => {
  const normalized = normalizeTickerSymbol(symbol);
  const currency = getCurrencyFromTicker(normalized);
  const known = isKnownStock(symbol);
  console.log(`  ${symbol} → ${normalized} (${currency}) ${known ? '✓ Known' : '✗ Unknown'}`);
});
console.log('');

// Test 3: German Stocks
console.log('Test 3: German Stocks (XETRA)');
const germanStocks = ['SAP', 'BMW', 'SIE', 'DAI', 'BAS'];
germanStocks.forEach(symbol => {
  const normalized = normalizeTickerSymbol(symbol);
  const currency = getCurrencyFromTicker(normalized);
  const known = isKnownStock(symbol);
  console.log(`  ${symbol} → ${normalized} (${currency}) ${known ? '✓ Known' : '✗ Unknown'}`);
});
console.log('');

// Test 4: Nordic Stocks
console.log('Test 4: Nordic Stocks (Denmark, Sweden, Norway)');
const nordicStocks = [
  { symbol: 'NOVO-B', name: 'Novo Nordisk', expected: '.CO' },
  { symbol: 'NOVOB', name: 'Novo Nordisk Alt', expected: '.CO' },
  { symbol: 'DSV', name: 'DSV', expected: '.CO' },
  { symbol: 'VOLV-B', name: 'Volvo', expected: '.ST' },
  { symbol: 'ERIC-B', name: 'Ericsson', expected: '.ST' },
  { symbol: 'EQNR', name: 'Equinor', expected: '.OL' },
  { symbol: 'NOKIA', name: 'Nokia', expected: '.HE' }
];
nordicStocks.forEach(({ symbol, name, expected }) => {
  const normalized = normalizeTickerSymbol(symbol, { name });
  const currency = getCurrencyFromTicker(normalized);
  const exchange = extractExchange(normalized);
  const correct = exchange === expected.replace('.', '');
  console.log(`  ${symbol.padEnd(10)} → ${normalized.padEnd(15)} (${currency}) ${correct ? '✓' : `✗ Expected ${expected}`}`);
});
console.log('');

// Test 5: Swiss Stocks
console.log('Test 5: Swiss Stocks (SIX Swiss Exchange)');
const swissStocks = ['NESN', 'ROG', 'NOVN', 'UHR'];
swissStocks.forEach(symbol => {
  const normalized = normalizeTickerSymbol(symbol);
  const currency = getCurrencyFromTicker(normalized);
  const known = isKnownStock(symbol);
  console.log(`  ${symbol} → ${normalized} (${currency}) ${known ? '✓ Known' : '✗ Unknown'}`);
});
console.log('');

// Test 6: Dutch Stocks
console.log('Test 6: Dutch Stocks (Euronext Amsterdam)');
const dutchStocks = ['ASML', 'ING', 'UNA', 'PHIA'];
dutchStocks.forEach(symbol => {
  const normalized = normalizeTickerSymbol(symbol);
  const currency = getCurrencyFromTicker(normalized);
  const known = isKnownStock(symbol);
  console.log(`  ${symbol} → ${normalized} (${currency}) ${known ? '✓ Known' : '✗ Unknown'}`);
});
console.log('');

// Test 7: Already Normalized Tickers
console.log('Test 7: Already Normalized Tickers (Should Pass Through)');
const alreadyNormalized = ['AAPL.US', 'SAP.DE', 'ASML.AS', 'NOVO-B.CO', 'GSPC.INDX'];
alreadyNormalized.forEach(symbol => {
  const normalized = normalizeTickerSymbol(symbol);
  const currency = getCurrencyFromTicker(normalized);
  const passthrough = symbol === normalized;
  console.log(`  ${symbol.padEnd(15)} → ${normalized.padEnd(15)} (${currency}) ${passthrough ? '✓ Pass-through' : '✗ Modified'}`);
});
console.log('');

// Test 8: Invalid Tickers
console.log('Test 8: Invalid Ticker Validation');
const invalidTickers = [
  'Apple Inc',           // Company name with space
  'Novo Nordisk A/S',   // Company name with spaces
  'VERYLONGTICKER123',  // Too long
  '',                   // Empty
  '   ',                // Whitespace
];
invalidTickers.forEach(symbol => {
  const validation = validateTickerFormat(symbol);
  console.log(`  "${symbol}" → ${validation.valid ? '✓ Valid' : '✗ Invalid'}: ${validation.reason}`);
});
console.log('');

// Test 9: Currency Detection
console.log('Test 9: Currency Detection from Exchange');
const currencyTests = [
  { ticker: 'AAPL.US', expected: 'USD' },
  { ticker: 'SAP.DE', expected: 'EUR' },
  { ticker: 'NESN.SW', expected: 'CHF' },
  { ticker: 'VOD.L', expected: 'GBP' },
  { ticker: 'NOVO-B.CO', expected: 'DKK' },
  { ticker: 'VOLV-B.ST', expected: 'SEK' },
  { ticker: 'EQNR.OL', expected: 'NOK' },
  { ticker: '7203.T', expected: 'JPY' },
  { ticker: 'GSPC.INDX', expected: 'USD' },
  { ticker: 'N225.INDX', expected: 'JPY' },
];
currencyTests.forEach(({ ticker, expected }) => {
  const currency = getCurrencyFromTicker(ticker);
  const correct = currency === expected;
  console.log(`  ${ticker.padEnd(15)} → ${currency.padEnd(5)} ${correct ? '✓' : `✗ Expected ${expected}`}`);
});
console.log('');

// Test 10: Edge Cases
console.log('Test 10: Edge Cases');
const edgeCases = [
  { symbol: 'RDSA', note: 'Multi-exchange stock (NL/UK)' },
  { symbol: 'ABB', note: 'Multi-exchange stock (CH/SE)' },
  { symbol: 'BTC-USD.CC', note: 'Crypto (already normalized)' },
  { symbol: 'EURUSD.FOREX', note: 'Forex (already normalized)' },
];
edgeCases.forEach(({ symbol, note }) => {
  const validation = validateTickerFormat(symbol);
  const normalized = normalizeTickerSymbol(symbol);
  console.log(`  ${symbol.padEnd(15)} → ${normalized ? normalized.padEnd(15) : 'NULL'.padEnd(15)} (${note})`);
});
console.log('');

console.log('=== Test Suite Complete ===');

export default {
  testName: 'Ticker Utils Test Suite',
  tests: [
    'US Stocks',
    'French Stocks',
    'German Stocks',
    'Nordic Stocks',
    'Swiss Stocks',
    'Dutch Stocks',
    'Already Normalized',
    'Invalid Tickers',
    'Currency Detection',
    'Edge Cases'
  ]
};
