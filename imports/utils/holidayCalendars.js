// Rule-based holiday calendars for schedule generation.
//
// Holidays are computed from their defining rules (fixed dates, nth weekday of a month,
// Easter-relative dates, weekend substitution), so every year is covered without
// maintaining per-year lists. One-off closures (royal events, national mourning…) are
// merged in from MARKET_HOLIDAYS.
//
// All dates are handled as ISO strings 'YYYY-MM-DD' and computed in UTC so results do
// not depend on the browser/server time zone.

import { MARKET_HOLIDAYS } from '../constants/marketHolidays.js';

export const HOLIDAY_CALENDARS = {
  TARGET2: 'TARGET2 (EUR settlement)',
  US: 'United States (NYSE / Nasdaq)',
  GB: 'United Kingdom (LSE)',
  EU: 'Euronext (Paris, Amsterdam, Brussels, Lisbon)',
  DE: 'Germany (Xetra)',
  CH: 'Switzerland (SIX)',
  IT: 'Italy (Borsa Italiana)',
  ES: 'Spain (BME)'
};

// Exchange codes (as stored in underlying.securityData.exchange or the ticker suffix)
// mapped to the calendar governing their scheduled trading days.
const EXCHANGE_TO_CALENDAR = {
  US: 'US', NYSE: 'US', NASDAQ: 'US', NYSEARCA: 'US', AMEX: 'US', BATS: 'US',
  LSE: 'GB', L: 'GB', LON: 'GB',
  PA: 'EU', AS: 'EU', BR: 'EU', LS: 'EU', EURONEXT: 'EU',
  XETRA: 'DE', DE: 'DE', F: 'DE', FRA: 'DE',
  SW: 'CH', VX: 'CH', SIX: 'CH',
  MI: 'IT', MIL: 'IT',
  MC: 'ES', MAD: 'ES'
};

// Settlement calendar conventionally used for payments in a given currency.
const CURRENCY_TO_CALENDAR = {
  EUR: 'TARGET2',
  USD: 'US',
  GBP: 'GB',
  CHF: 'CH'
};

const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export const parseISODate = (value) => {
  if (!value) return null;
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]));
};

export const toISODate = (date) =>
  iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());

export const addDaysISO = (isoDate, days) => {
  const d = parseISODate(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
};

const weekdayOf = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday

export const isWeekendISO = (isoDate) => {
  const day = parseISODate(isoDate).getUTCDay();
  return day === 0 || day === 6;
};

// Anonymous Gregorian algorithm (Meeus/Jones/Butcher)
export const easterSunday = (year) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return iso(year, month, day);
};

// nth (1-based) weekday of a month; n = -1 means the last one
const nthWeekday = (year, month, weekday, n) => {
  if (n > 0) {
    const first = weekdayOf(year, month, 1);
    const day = 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
    return iso(year, month, day);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = weekdayOf(year, month, lastDay);
  return iso(year, month, lastDay - ((last - weekday + 7) % 7));
};

// US rule: Saturday holidays observed on Friday, Sunday holidays on Monday
const usObserved = (y, m, d) => {
  const wd = weekdayOf(y, m, d);
  if (wd === 6) return addDaysISO(iso(y, m, d), -1);
  if (wd === 0) return addDaysISO(iso(y, m, d), 1);
  return iso(y, m, d);
};

// UK rule: weekend holidays move to the next working day not already a holiday
const gbSubstituted = (y, m, d, taken) => {
  let date = iso(y, m, d);
  while (isWeekendISO(date) || taken.includes(date)) date = addDaysISO(date, 1);
  return date;
};

const RULES = {
  TARGET2: (y) => {
    const easter = easterSunday(y);
    return [iso(y, 1, 1), addDaysISO(easter, -2), addDaysISO(easter, 1), iso(y, 5, 1), iso(y, 12, 25), iso(y, 12, 26)];
  },
  EU: (y) => RULES.TARGET2(y),
  US: (y) => {
    const easter = easterSunday(y);
    const days = [];
    // New Year's Day: NYSE does not close on Friday 31 December when 1 January is a Saturday
    if (weekdayOf(y, 1, 1) !== 6) days.push(usObserved(y, 1, 1));
    days.push(
      nthWeekday(y, 1, 1, 3),      // Martin Luther King Jr. Day
      nthWeekday(y, 2, 1, 3),      // Washington's Birthday
      addDaysISO(easter, -2),      // Good Friday
      nthWeekday(y, 5, 1, -1),     // Memorial Day
      usObserved(y, 7, 4),         // Independence Day
      nthWeekday(y, 9, 1, 1),      // Labor Day
      nthWeekday(y, 11, 4, 4),     // Thanksgiving
      usObserved(y, 12, 25)        // Christmas
    );
    if (y >= 2022) days.push(usObserved(y, 6, 19)); // Juneteenth
    return days;
  },
  GB: (y) => {
    const easter = easterSunday(y);
    const days = [
      gbSubstituted(y, 1, 1, []),
      addDaysISO(easter, -2),
      addDaysISO(easter, 1),
      nthWeekday(y, 5, 1, 1),      // Early May bank holiday
      nthWeekday(y, 5, 1, -1),     // Spring bank holiday
      nthWeekday(y, 8, 1, -1)      // Summer bank holiday
    ];
    const christmas = gbSubstituted(y, 12, 25, []);
    days.push(christmas, gbSubstituted(y, 12, 26, [christmas]));
    return days;
  },
  DE: (y) => {
    const easter = easterSunday(y);
    return [iso(y, 1, 1), addDaysISO(easter, -2), addDaysISO(easter, 1), iso(y, 5, 1),
      iso(y, 12, 24), iso(y, 12, 25), iso(y, 12, 26), iso(y, 12, 31)];
  },
  CH: (y) => {
    const easter = easterSunday(y);
    return [iso(y, 1, 1), iso(y, 1, 2), addDaysISO(easter, -2), addDaysISO(easter, 1),
      addDaysISO(easter, 39), addDaysISO(easter, 50), iso(y, 5, 1), iso(y, 8, 1),
      iso(y, 12, 24), iso(y, 12, 25), iso(y, 12, 26), iso(y, 12, 31)];
  },
  IT: (y) => {
    const easter = easterSunday(y);
    return [iso(y, 1, 1), addDaysISO(easter, -2), addDaysISO(easter, 1), iso(y, 5, 1),
      iso(y, 8, 15), iso(y, 12, 24), iso(y, 12, 25), iso(y, 12, 26), iso(y, 12, 31)];
  },
  ES: (y) => {
    const easter = easterSunday(y);
    return [iso(y, 1, 1), addDaysISO(easter, -2), addDaysISO(easter, 1), iso(y, 5, 1), iso(y, 12, 25), iso(y, 12, 26)];
  }
};

const cache = {};
const holidaysFor = (calendar, year) => {
  const key = `${calendar}:${year}`;
  if (!cache[key]) {
    const ruleDays = RULES[calendar] ? RULES[calendar](year) : [];
    const oneOffs = (MARKET_HOLIDAYS[calendar] || []).filter(d => d.startsWith(`${year}-`));
    cache[key] = new Set([...ruleDays, ...oneOffs]);
  }
  return cache[key];
};

export const isSupportedCalendar = (calendar) => Boolean(RULES[calendar]);

export const isHolidayISO = (isoDate, calendars = []) => {
  const year = +isoDate.slice(0, 4);
  return calendars.some(cal => holidaysFor(cal, year).has(isoDate));
};

export const isBusinessDayISO = (isoDate, calendars = []) =>
  !isWeekendISO(isoDate) && !isHolidayISO(isoDate, calendars);

// Following convention: roll forward to the first business day on or after the date
export const rollFollowingISO = (isoDate, calendars = []) => {
  let date = isoDate;
  while (!isBusinessDayISO(date, calendars)) date = addDaysISO(date, 1);
  return date;
};

export const addBusinessDaysISO = (isoDate, days, calendars = []) => {
  let date = isoDate;
  let added = 0;
  while (added < days) {
    date = addDaysISO(date, 1);
    if (isBusinessDayISO(date, calendars)) added++;
  }
  return date;
};

// Business days strictly after start, up to and including end
export const countBusinessDaysISO = (startISO, endISO, calendars = []) => {
  if (!startISO || !endISO || endISO <= startISO) return 0;
  let count = 0;
  let date = startISO;
  while (date < endISO) {
    date = addDaysISO(date, 1);
    if (isBusinessDayISO(date, calendars)) count++;
  }
  return count;
};

export const exchangeOfUnderlying = (underlying) => {
  if (!underlying) return null;
  const fromData = underlying.securityData?.exchange;
  if (fromData) return String(fromData).toUpperCase();
  const ticker = underlying.securityData?.ticker || underlying.ticker || '';
  const dot = ticker.lastIndexOf('.');
  return dot > 0 ? ticker.slice(dot + 1).toUpperCase() : null;
};

// Calendars of the exchanges the underlyings trade on. Returns the supported calendars
// plus the exchanges we could not map, so the UI can flag them.
export const calendarsForUnderlyings = (underlyings = []) => {
  const calendars = new Set();
  const unmapped = new Set();
  underlyings.forEach(u => {
    const exchange = exchangeOfUnderlying(u);
    if (!exchange) return;
    const cal = EXCHANGE_TO_CALENDAR[exchange];
    if (cal) calendars.add(cal);
    else unmapped.add(exchange);
  });
  return { calendars: [...calendars], unmapped: [...unmapped] };
};

export const calendarForCurrency = (currency) =>
  CURRENCY_TO_CALENDAR[String(currency || '').toUpperCase()] || 'TARGET2';
