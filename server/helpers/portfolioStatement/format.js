/**
 * Display formatting for the portfolio statement. Every string the statement
 * shows is produced here, server-side, so the PDF page only renders.
 */

const MINUS = '−'; // typographic minus, as in the design

const fixed = (value, decimals) => Math.abs(value).toLocaleString('en-US', {
  minimumFractionDigits: decimals,
  maximumFractionDigits: decimals
});

/** 6,326,574.08 / −2,397,577.57 */
export const num = (value, decimals = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(decimals));
  return `${rounded < 0 ? MINUS : ''}${fixed(rounded, decimals)}`;
};

/** +1,021,171.87 / −93,389.86 / 0.00 */
export const signed = (value, decimals = 2) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const rounded = Number(value.toFixed(decimals));
  const sign = rounded > 0 ? '+' : rounded < 0 ? MINUS : '';
  return `${sign}${fixed(rounded, decimals)}`;
};

/** Ratio (0.379) to "37.90%" */
export const pct = (ratio, decimals = 2) => (Number.isFinite(ratio) ? `${num(ratio * 100, decimals)}%` : '—');

/** Ratio to "+90.85%" */
export const signedPct = (ratio, decimals = 2) => (Number.isFinite(ratio) ? `${signed(ratio * 100, decimals)}%` : '—');

/** Quantity without trailing zeros: 2,581 / 0.5 / 1,000,000 */
export const qty = (value) => {
  if (!Number.isFinite(value)) return '—';
  const decimals = Number.isInteger(value) ? 0 : Math.min(4, (String(value).split('.')[1] || '').length);
  return num(value, decimals);
};

/** 6,326,574 → "6.33M", 81,758 → "81.8K" */
export const compact = (value) => {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${abs.toFixed(0)}`;
};

const toDate = (d) => (d instanceof Date ? d : new Date(d));

/** 30 September 2026 */
export const dateLong = (d) => toDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
// Fixed three-letter months: en-GB in recent ICU writes "Sept"
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 30 Sep 2026 */
export const dateShort = (d) => { const x = toDate(d); return `${x.getUTCDate()} ${MONTHS_SHORT[x.getUTCMonth()]} ${x.getUTCFullYear()}`; };
/** 30 Sep */
export const dayMonth = (d) => { const x = toDate(d); return `${x.getUTCDate()} ${MONTHS_SHORT[x.getUTCMonth()]}`; };
/** September 2026 */
export const monthYear = (d) => toDate(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** 1 October 2026, 09:45 CET (Europe/Paris wall clock) */
export const timestamp = (d) => {
  const date = toDate(d);
  const day = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  return `${day}, ${time} CET`;
};

let currencyNames = null;
let regionNames = null;
try {
  currencyNames = new Intl.DisplayNames(['en'], { type: 'currency' });
  regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
} catch (e) { /* older runtime: codes are shown as-is */ }

/** USD → "US Dollar (USD)" */
export const currencyName = (code) => {
  if (!code) return '—';
  const name = currencyNames?.of(code);
  return name && name !== code ? `${name.replace(/^./, c => c.toUpperCase())} (${code})` : code;
};

/** US → "United States"; XS → "International" */
export const countryName = (code) => {
  if (!code) return 'Unclassified';
  if (code === 'XS' || code === 'EU') return 'International';
  const name = regionNames?.of(code);
  return name && name !== code ? name : code;
};
