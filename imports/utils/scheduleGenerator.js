// Observation schedule generation for autocallable-style products.
//
// Pure functions (no Meteor/React) so the same logic runs in the Schedule tab and in
// tests. Stored schedule rows are the source of truth: nothing here is called on load,
// only when the user changes a Schedule Configuration field or asks to regenerate.

import {
  addBusinessDaysISO,
  calendarForCurrency,
  calendarsForUnderlyings,
  countBusinessDaysISO,
  parseISODate,
  rollFollowingISO,
  toISODate
} from './holidayCalendars.js';

// Used only when the product has no trade/issue dates to derive the issuer's lag from
export const FALLBACK_PAYMENT_LAG_BUSINESS_DAYS = 10;

const FREQUENCY_MONTHS = {
  monthly: 1,
  quarterly: 3,
  'semi-annually': 6,
  'semi-annual': 6,
  annually: 12,
  annual: 12
};

// Config fields that change dates vs. fields that only change levels
export const DATE_CONFIG_FIELDS = ['frequency', 'observationCalendar', 'paymentCalendar', 'paymentLagBusinessDays'];
export const LEVEL_CONFIG_FIELDS = ['coolOffPeriods', 'stepDownValue', 'initialAutocallLevel', 'initialCouponBarrier', 'autocallFloor'];

const DATE_FIELDS = ['observationDate', 'valueDate'];
const LEVEL_FIELDS = ['autocallLevel', 'isCallable', 'couponBarrier'];

const round = (n) => Math.round(n * 1e6) / 1e6;

// Add calendar months, clamping to the month's last day (31 Jan + 1M = 28/29 Feb)
export const addMonthsISO = (isoDate, months) => {
  const d = parseISODate(isoDate);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toISODate(target);
};

const normalizeISO = (value) => {
  const d = parseISODate(value);
  return d ? toISODate(d) : null;
};

/**
 * Resolve which holiday calendars apply.
 * - Observation dates: scheduled trading days of the underlyings' exchanges (default),
 *   or an explicit calendar chosen in the Schedule Configuration.
 * - Payment dates: settlement calendar of the product currency (default), or explicit.
 */
export const resolveCalendars = ({ scheduleConfig = {}, underlyings = [], currency } = {}) => {
  const paymentCalendars = [scheduleConfig.paymentCalendar || calendarForCurrency(currency)];

  let observationCalendars;
  let unmappedExchanges = [];
  if (scheduleConfig.observationCalendar && scheduleConfig.observationCalendar !== 'underlyings') {
    observationCalendars = [scheduleConfig.observationCalendar];
  } else {
    const fromUnderlyings = calendarsForUnderlyings(underlyings);
    unmappedExchanges = fromUnderlyings.unmapped;
    observationCalendars = fromUnderlyings.calendars.length > 0 ? fromUnderlyings.calendars : paymentCalendars;
  }

  return { observationCalendars, paymentCalendars, unmappedExchanges };
};

// Issuer lag in business days, derived from the product's trade → issue date
export const derivePaymentLag = (productDetails = {}, paymentCalendars = []) => {
  const trade = normalizeISO(productDetails.tradeDate);
  const value = normalizeISO(productDetails.valueDate);
  const lag = countBusinessDaysISO(trade, value, paymentCalendars);
  return lag > 0 ? lag : null;
};

export const resolvePaymentLag = (scheduleConfig = {}, productDetails = {}, paymentCalendars = []) => {
  const explicit = scheduleConfig.paymentLagBusinessDays;
  if (explicit !== undefined && explicit !== null && explicit !== '' && !isNaN(Number(explicit))) {
    return { lag: Number(explicit), source: 'config' };
  }
  const derived = derivePaymentLag(productDetails, paymentCalendars);
  if (derived) return { lag: derived, source: 'issueDate' };
  return { lag: FALLBACK_PAYMENT_LAG_BUSINESS_DAYS, source: 'fallback' };
};

export const generateObservationDates = ({ tradeDate, finalObservation, frequency = 'quarterly' }, calendars = []) => {
  const start = normalizeISO(tradeDate);
  const final = normalizeISO(finalObservation);
  if (!start || !final || final <= start) return [];

  const interval = FREQUENCY_MONTHS[frequency] || FREQUENCY_MONTHS.quarterly;
  const dates = [];
  for (let k = 1; k < 1200; k++) {
    // Always step from the trade date so month-end clamping does not drift
    const unadjusted = addMonthsISO(start, k * interval);
    if (unadjusted >= final) {
      dates.push(final);
      break;
    }
    const adjusted = rollFollowingISO(unadjusted, calendars);
    if (adjusted >= final) {
      dates.push(final);
      break;
    }
    dates.push(adjusted);
  }
  return dates;
};

export const paymentDateFor = (observationDate, lagBusinessDays, calendars = []) =>
  addBusinessDaysISO(normalizeISO(observationDate), lagBusinessDays, calendars);

export const computeLevels = (index, scheduleConfig = {}) => {
  const coolOffPeriods = Number(scheduleConfig.coolOffPeriods ?? 0);
  const stepDown = Number(scheduleConfig.stepDownValue ?? 0);
  const initial = Number(scheduleConfig.initialAutocallLevel ?? 100);
  const couponBarrier = scheduleConfig.initialCouponBarrier ?? 70;
  const floor = scheduleConfig.autocallFloor;
  const hasFloor = floor !== undefined && floor !== null && floor !== '' && !isNaN(Number(floor));

  const isCallable = index >= coolOffPeriods;
  let autocallLevel = null;
  if (isCallable) {
    autocallLevel = round(initial + stepDown * (index - coolOffPeriods));
    if (hasFloor) {
      // Step-down stops at the floor; a step-up stops at the same bound used as a cap
      autocallLevel = stepDown < 0 ? Math.max(autocallLevel, Number(floor)) : Math.min(autocallLevel, Number(floor));
    }
  }

  return { isCallable, autocallLevel, couponBarrier };
};

/**
 * Build a full schedule from the Schedule Configuration.
 * The last observation pays on the product maturity date when one is set.
 */
export const generateSchedule = ({
  productDetails = {},
  scheduleConfig = {},
  underlyings = [],
  isParticipationNote = false,
  previousSchedule = []
} = {}) => {
  const { observationCalendars, paymentCalendars } = resolveCalendars({
    scheduleConfig, underlyings, currency: productDetails.currency
  });
  const { lag } = resolvePaymentLag(scheduleConfig, productDetails, paymentCalendars);
  const observationDates = generateObservationDates({
    tradeDate: productDetails.tradeDate,
    finalObservation: productDetails.finalObservation,
    frequency: scheduleConfig.frequency
  }, observationCalendars);
  const maturity = normalizeISO(productDetails.maturity);

  return observationDates.map((observationDate, index) => {
    const isLast = index === observationDates.length - 1;
    const valueDate = isLast && maturity && maturity >= observationDate
      ? maturity
      : paymentDateFor(observationDate, lag, paymentCalendars);

    const previous = previousSchedule[index];
    const rebateAmount = isParticipationNote
      ? (previous?.rebateAmount ?? 0)
      : null;

    return {
      id: `period_${index}`,
      observationDate,
      valueDate,
      ...computeLevels(index, scheduleConfig),
      periodIndex: index + 1,
      rebateAmount
    };
  });
};

// Recompute autocall/coupon levels after a level-only config change. Dates are kept,
// and so is any level the user typed by hand in the table.
export const applyLevelConfig = (schedule = [], scheduleConfig = {}) =>
  schedule.map((row, index) => {
    const manual = row.manualFields || [];
    const levels = computeLevels(index, scheduleConfig);
    const next = { ...row };
    LEVEL_FIELDS.forEach(field => {
      if (!manual.includes(field)) next[field] = levels[field];
    });
    return next;
  });

// Record a hand edit in the schedule table so regeneration can respect or warn about it
export const markManualEdit = (row, field, value) => {
  const manualFields = Array.from(new Set([...(row.manualFields || []), field]));
  return { ...row, [field]: value, manualOverride: true, manualFields };
};

export const countManualDateEdits = (schedule = []) =>
  schedule.filter(row => (row.manualFields || []).some(f => DATE_FIELDS.includes(f))).length;

export const isDateConfigField = (field) => DATE_CONFIG_FIELDS.includes(field);

// The Schedule tab builds a schedule by itself only for a product that has none yet.
// A stored schedule (saved, edited by hand or extracted from a term sheet) is shown as is.
export const shouldAutoBuildSchedule = (schedule, productDetails = {}) =>
  (!schedule || schedule.length === 0) &&
  Boolean(productDetails.tradeDate && productDetails.finalObservation);
