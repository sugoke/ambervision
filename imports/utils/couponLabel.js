// Display label for a coupon entered "per period" (e.g. the Phoenix Structure tab's
// "Coupon Rate (% per period)"), with its annualised equivalent.

const PERIODS_PER_YEAR = {
  monthly: 12,
  quarterly: 4,
  'semi-annually': 2,
  'semi-annual': 2,
  annually: 1,
  annual: 1
};

const PERIOD_NAME = {
  monthly: 'month',
  quarterly: 'quarter',
  'semi-annually': 'semester',
  'semi-annual': 'semester'
};

const trim = (n) => String(Math.round(n * 10000) / 10000);

export const periodsPerYear = (frequency) =>
  PERIODS_PER_YEAR[String(frequency || '').toLowerCase()] || null;

// 2.8, 'quarterly' -> "2.8% per quarter (11.2% p.a.)"; 8, 'annually' -> "8% p.a."
export const formatPerPeriodCouponLabel = (ratePerPeriod, frequency) => {
  if (ratePerPeriod === undefined || ratePerPeriod === null || isNaN(Number(ratePerPeriod))) return '—';
  const rate = Number(ratePerPeriod);
  const key = String(frequency || '').toLowerCase();
  const perYear = periodsPerYear(key);
  if (!perYear) return `${trim(rate)}% per period`;
  if (perYear === 1) return `${trim(rate)}% p.a.`;
  return `${trim(rate)}% per ${PERIOD_NAME[key]} (${trim(rate * perYear)}% p.a.)`;
};
