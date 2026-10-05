/**
 * Display formatting for the server-built PDF documents (portfolio statement,
 * product reports). Every string they show is produced server-side, so the PDF
 * pages only render. The named exports are English; `formatterFor(lang)` gives
 * the same helpers in French or English.
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

// ── Locale-aware formatters (English / French) ───────────────────────────────

const MONTHS = {
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
};
const MONTHS_ABBR = {
  en: MONTHS_SHORT,
  fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.']
};

/**
 * Number, percentage and date helpers for one language. French uses a narrow
 * no-break space between thousands and a decimal comma: 1 234,56.
 * Dates are calendar dates (UTC), as stored for products ('YYYY-MM-DD').
 */
export const formatterFor = (lang = 'en') => {
  const L = lang === 'fr' ? 'fr' : 'en';
  const fixedL = (value, decimals) => {
    const s = Math.abs(value).toLocaleString(L === 'fr' ? 'fr-FR' : 'en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return L === 'fr' ? s.replace(/[   ]/g, ' ') : s;
  };
  const numL = (value, decimals = 2) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const rounded = Number(value.toFixed(decimals));
    return `${rounded < 0 ? MINUS : ''}${fixedL(rounded, decimals)}`;
  };
  const signedL = (value, decimals = 2) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const rounded = Number(value.toFixed(decimals));
    return `${rounded > 0 ? '+' : rounded < 0 ? MINUS : ''}${fixedL(rounded, decimals)}`;
  };
  const pctSuffix = L === 'fr' ? ' %' : '%';
  const date = (d) => {
    if (!d) return null;
    const x = d instanceof Date ? d : new Date(typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d);
    return Number.isNaN(x.getTime()) ? null : x;
  };
  return {
    lang: L,
    num: numL,
    signed: signedL,
    /** 72.71 (already in %) → "72.71%" / "72,71 %" */
    pctOf: (value, decimals = 2) => (Number.isFinite(value) ? `${numL(value, decimals)}${pctSuffix}` : '—'),
    /** +58.64 (already in %) → "+58.64%" */
    signedPctOf: (value, decimals = 2) => (Number.isFinite(value) ? `${signedL(value, decimals)}${pctSuffix}` : '—'),
    /** 4 October 2026 / 4 octobre 2026 */
    dateLong: (d) => { const x = date(d); return x ? `${x.getUTCDate()} ${MONTHS[L][x.getUTCMonth()]} ${x.getUTCFullYear()}` : '—'; },
    /** 4 Oct 2026 / 4 oct. 2026 */
    dateShort: (d) => { const x = date(d); return x ? `${x.getUTCDate()} ${MONTHS_ABBR[L][x.getUTCMonth()]} ${x.getUTCFullYear()}` : '—'; },
    /** 4 Oct / 4 oct. */
    dayMonth: (d) => { const x = date(d); return x ? `${x.getUTCDate()} ${MONTHS_ABBR[L][x.getUTCMonth()]}` : '—'; },
    monthAbbr: (monthIndex) => MONTHS_ABBR[L][monthIndex],
    /** 4 October 2026, 09:45 CET (Europe/Paris wall clock) */
    timestamp: (d) => {
      const x = d instanceof Date ? d : new Date(d);
      const parts = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris', hour12: false }).formatToParts(x);
      const get = (t) => Number(parts.find(p => p.type === t)?.value);
      const time = `${String(get('hour')).padStart(2, '0')}:${String(get('minute')).padStart(2, '0')}`;
      return `${get('day')} ${MONTHS[L][get('month') - 1]} ${get('year')}${L === 'fr' ? ' à ' : ', '}${time} CET`;
    }
  };
};
