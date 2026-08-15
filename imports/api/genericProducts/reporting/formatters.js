/**
 * Formatting helpers — the ONLY place display strings are built.
 * Reports store pre-formatted values; UI blocks never compute anything.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(isoDate) {
  if (!isoDate) return '—';
  const [y, m, d] = isoDate.split('-').map(Number);
  if (!y || !m || !d) return isoDate;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** Value on the 100-basis shown as a level, e.g. 103.75 -> "103.75%" */
export function fmtLevel(value, dp = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(dp)}%`;
}

/** Value on the 100-basis shown as signed performance, e.g. 103.75 -> "+3.75%" */
export function fmtPerf(value, dp = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const delta = value - 100;
  return `${delta >= 0 ? '+' : ''}${delta.toFixed(dp)}%`;
}

/** A rate/amount in % of denomination, e.g. 2.5 -> "2.50%" */
export function fmtRate(value, dp = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(dp)}%`;
}

export function fmtMoney(value, currency = 'USD') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
  } catch (e) {
    return `${currency} ${Math.round(value).toLocaleString('en-US')}`;
  }
}

export function fmtPrice(value, dp = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
