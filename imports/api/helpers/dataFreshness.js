/**
 * Data Freshness Helper
 *
 * Provides functions to check if bank data is fresh or stale.
 * Banks upload files after midnight with previous business day's balances.
 *
 * Freshness Rules:
 * - Fresh (🟢): Data is from expected date (previous business day)
 * - Stale (🟡): Data is 1+ business days older than expected
 * - Error (🔴): Last sync failed
 */

/**
 * Check if a date is a weekend (Saturday or Sunday)
 * @param {Date} date
 * @returns {boolean}
 */
const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday = 0, Saturday = 6
};

/**
 * Get the previous business day from a given date
 * @param {Date} fromDate - The reference date
 * @returns {Date} - The previous business day (midnight UTC)
 */
export const getPreviousBusinessDay = (fromDate = new Date()) => {
  const date = new Date(fromDate);
  date.setUTCHours(0, 0, 0, 0);

  // Go back one day
  date.setUTCDate(date.getUTCDate() - 1);

  // If it's a weekend, keep going back
  while (isWeekend(date)) {
    date.setUTCDate(date.getUTCDate() - 1);
  }

  return date;
};

/**
 * Get the expected data date for today
 * Banks upload after midnight with previous business day's balances
 * @param {Date} today - Current date (default: now)
 * @returns {Date} - Expected data date (midnight UTC)
 */
export const getExpectedDataDate = (today = new Date()) => {
  return getPreviousBusinessDay(today);
};

/**
 * Calculate business days between two dates
 * @param {Date} startDate - Earlier date
 * @param {Date} endDate - Later date
 * @returns {number} - Number of business days between (excluding weekends)
 */
export const getBusinessDaysBetween = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);

  let count = 0;
  const current = new Date(start);

  while (current < end) {
    current.setUTCDate(current.getUTCDate() + 1);
    if (!isWeekend(current)) {
      count++;
    }
  }

  return count;
};

/**
 * Check the freshness status of a data date
 * @param {Date} dataDate - The date of the bank data
 * @param {Date} today - Current date (default: now)
 * @returns {Object} - { status: 'fresh'|'stale'|'old', businessDaysOld, expectedDate, isExpected }
 */
export const checkDataFreshness = (dataDate, today = new Date()) => {
  if (!dataDate) {
    return {
      status: 'error',
      businessDaysOld: null,
      expectedDate: null,
      isExpected: false,
      message: 'No data date available'
    };
  }

  const expectedDate = getExpectedDataDate(today);
  const dateDateNormalized = new Date(dataDate);
  dateDateNormalized.setUTCHours(0, 0, 0, 0);

  // Check if data is from expected date
  const isExpected = dateDateNormalized.getTime() === expectedDate.getTime();

  // Calculate how many business days old the data is
  const businessDaysOld = getBusinessDaysBetween(dateDateNormalized, expectedDate);

  let status;
  let message;

  if (isExpected) {
    status = 'fresh';
    message = 'Data is current';
  } else if (businessDaysOld === 1) {
    status = 'stale';
    message = '1 business day old';
  } else if (businessDaysOld > 1) {
    status = 'old';
    message = `${businessDaysOld} business days old`;
  } else {
    // Data is newer than expected (shouldn't happen normally)
    status = 'fresh';
    message = 'Data is current';
  }

  return {
    status,
    businessDaysOld,
    expectedDate,
    isExpected,
    message
  };
};

/**
 * Format a date for display
 * @param {Date} date
 * @returns {string} - Formatted date like "Dec 24"
 */
export const formatDataDate = (date) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });
};

/**
 * Get color class for freshness status
 * @param {string} status - 'fresh', 'stale', 'old', or 'error'
 * @returns {string} - Tailwind CSS color class
 */
export const getFreshnessColor = (status) => {
  switch (status) {
    case 'fresh':
      return 'bg-green-500';
    case 'stale':
      return 'bg-yellow-500';
    case 'old':
      return 'bg-orange-500';
    case 'error':
      return 'bg-red-500';
    default:
      return 'bg-gray-500';
  }
};

/**
 * Get icon for freshness status
 * @param {string} status
 * @returns {string} - Emoji icon
 */
export const getFreshnessIcon = (status) => {
  switch (status) {
    case 'fresh':
      return '🟢';
    case 'stale':
      return '🟡';
    case 'old':
      return '🟠';
    case 'error':
      return '🔴';
    default:
      return '⚪';
  }
};
