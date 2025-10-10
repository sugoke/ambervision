import { MARKET_HOLIDAYS } from '/imports/constants/marketHolidays.js';

// Market holiday utility functions
export const formatDateToISO = (date) => {
  return date.toISOString().split('T')[0];
};

export const formatDateToDDMMYYYY = (date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

export const isWeekend = (date) => {
  const day = date.getDay();
  return day === 0 || day === 6; // Sunday or Saturday
};

export const isMarketHoliday = (date, markets = ['US']) => {
  const isoDate = formatDateToISO(date);
  return markets.some(market => 
    MARKET_HOLIDAYS[market] && MARKET_HOLIDAYS[market].includes(isoDate)
  );
};

export const getNextTradingDay = (date, markets = ['US']) => {
  const nextDay = new Date(date);
  
  do {
    nextDay.setDate(nextDay.getDate() + 1);
  } while (isWeekend(nextDay) || isMarketHoliday(nextDay, markets));
  
  return nextDay;
};

/**
 * Roll conventions for handling weekends and holidays
 */
export const ROLL_CONVENTIONS = {
  FOLLOWING: 'following',         // Move to next business day
  MODIFIED_FOLLOWING: 'modified_following', // Move to next business day unless it's in next month, then previous
  PRECEDING: 'preceding',         // Move to previous business day
  MODIFIED_PRECEDING: 'modified_preceding', // Move to previous business day unless it's in previous month, then next
  NONE: 'none'                    // No adjustment
};

/**
 * Apply roll convention to a date
 * @param {Date} date - Date to adjust
 * @param {string} convention - Roll convention to apply
 * @param {Array} markets - Markets to check holidays for
 * @returns {Date} - Adjusted date
 */
export const applyRollConvention = (date, convention = ROLL_CONVENTIONS.MODIFIED_FOLLOWING, markets = ['US']) => {
  if (convention === ROLL_CONVENTIONS.NONE) {
    return new Date(date);
  }
  
  // Check if adjustment is needed
  if (!isWeekend(date) && !isMarketHoliday(date, markets)) {
    return new Date(date);
  }
  
  const originalMonth = date.getMonth();
  let adjustedDate = new Date(date);
  
  switch (convention) {
    case ROLL_CONVENTIONS.FOLLOWING:
      while (isWeekend(adjustedDate) || isMarketHoliday(adjustedDate, markets)) {
        adjustedDate.setDate(adjustedDate.getDate() + 1);
      }
      break;
      
    case ROLL_CONVENTIONS.MODIFIED_FOLLOWING:
      while (isWeekend(adjustedDate) || isMarketHoliday(adjustedDate, markets)) {
        adjustedDate.setDate(adjustedDate.getDate() + 1);
      }
      // If we rolled into next month, go backward instead
      if (adjustedDate.getMonth() !== originalMonth) {
        adjustedDate = new Date(date);
        while (isWeekend(adjustedDate) || isMarketHoliday(adjustedDate, markets)) {
          adjustedDate.setDate(adjustedDate.getDate() - 1);
        }
      }
      break;
      
    case ROLL_CONVENTIONS.PRECEDING:
      while (isWeekend(adjustedDate) || isMarketHoliday(adjustedDate, markets)) {
        adjustedDate.setDate(adjustedDate.getDate() - 1);
      }
      break;
      
    case ROLL_CONVENTIONS.MODIFIED_PRECEDING:
      while (isWeekend(adjustedDate) || isMarketHoliday(adjustedDate, markets)) {
        adjustedDate.setDate(adjustedDate.getDate() - 1);
      }
      // If we rolled into previous month, go forward instead
      if (adjustedDate.getMonth() !== originalMonth) {
        adjustedDate = new Date(date);
        while (isWeekend(adjustedDate) || isMarketHoliday(adjustedDate, markets)) {
          adjustedDate.setDate(adjustedDate.getDate() + 1);
        }
      }
      break;
  }
  
  return adjustedDate;
};

/**
 * Generate periodic schedule
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date  
 * @param {string} frequency - 'daily', 'weekly', 'monthly', 'quarterly', 'semi-annual', 'annual'
 * @param {Object} options - Additional options
 * @returns {Array<Date>} - Array of dates
 */
export const generatePeriodicSchedule = (startDate, endDate, frequency, options = {}) => {
  const {
    rollConvention = ROLL_CONVENTIONS.MODIFIED_FOLLOWING,
    markets = ['US'],
    dayOfMonth = null, // For monthly frequencies
    excludeStart = false,
    includeEnd = true
  } = options;
  
  const dates = [];
  let currentDate = new Date(startDate);
  
  // Add start date if not excluded
  if (!excludeStart) {
    dates.push(applyRollConvention(new Date(startDate), rollConvention, markets));
  }
  
  // Generate dates based on frequency
  while (currentDate < endDate) {
    switch (frequency.toLowerCase()) {
      case 'daily':
        currentDate = getNextTradingDay(currentDate, markets);
        break;
        
      case 'weekly':
        currentDate.setDate(currentDate.getDate() + 7);
        currentDate = applyRollConvention(currentDate, rollConvention, markets);
        break;
        
      case 'monthly':
        currentDate.setMonth(currentDate.getMonth() + 1);
        if (dayOfMonth) {
          currentDate.setDate(Math.min(dayOfMonth, new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()));
        }
        currentDate = applyRollConvention(currentDate, rollConvention, markets);
        break;
        
      case 'quarterly':
        currentDate.setMonth(currentDate.getMonth() + 3);
        if (dayOfMonth) {
          currentDate.setDate(Math.min(dayOfMonth, new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()));
        }
        currentDate = applyRollConvention(currentDate, rollConvention, markets);
        break;
        
      case 'semi-annual':
      case 'semiannual':
        currentDate.setMonth(currentDate.getMonth() + 6);
        if (dayOfMonth) {
          currentDate.setDate(Math.min(dayOfMonth, new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()));
        }
        currentDate = applyRollConvention(currentDate, rollConvention, markets);
        break;
        
      case 'annual':
      case 'yearly':
        currentDate.setFullYear(currentDate.getFullYear() + 1);
        if (dayOfMonth) {
          currentDate.setDate(Math.min(dayOfMonth, new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()));
        }
        currentDate = applyRollConvention(currentDate, rollConvention, markets);
        break;
        
      default:
        throw new Error(`Unsupported frequency: ${frequency}`);
    }
    
    if (currentDate <= endDate) {
      dates.push(new Date(currentDate));
    }
  }
  
  // Add end date if included and not already present
  if (includeEnd && (dates.length === 0 || dates[dates.length - 1].getTime() !== endDate.getTime())) {
    dates.push(applyRollConvention(new Date(endDate), rollConvention, markets));
  }
  
  return dates;
};

/**
 * Handle American vs European observation semantics
 * @param {Date} observationDate - Observation date
 * @param {string} style - 'american' or 'european'
 * @param {Object} priceData - Price data for the period
 * @returns {Object} - Observation result
 */
export const evaluateObservationStyle = (observationDate, style = 'european', priceData = {}) => {
  if (style.toLowerCase() === 'american') {
    // American style: continuous monitoring
    // Check if barrier was breached at any point up to observation date
    const breaches = [];
    for (const [date, data] of Object.entries(priceData)) {
      if (new Date(date) <= observationDate) {
        breaches.push({
          date: new Date(date),
          price: data.price,
          breached: data.breached || false
        });
      }
    }
    
    return {
      style: 'american',
      observationDate,
      continuouslyMonitored: true,
      breachEvents: breaches,
      wasBreached: breaches.some(b => b.breached)
    };
  } else {
    // European style: point-in-time observation
    const dateStr = formatDateToISO(observationDate);
    const observationData = priceData[dateStr];
    
    return {
      style: 'european',
      observationDate,
      continuouslyMonitored: false,
      observationPrice: observationData?.price || null,
      wasBreached: observationData?.breached || false
    };
  }
};

/**
 * Calculate business days between two dates
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {Array} markets - Markets to check holidays for
 * @returns {number} - Number of business days
 */
export const businessDaysBetween = (startDate, endDate, markets = ['US']) => {
  let count = 0;
  const currentDate = new Date(startDate);
  
  while (currentDate <= endDate) {
    if (!isWeekend(currentDate) && !isMarketHoliday(currentDate, markets)) {
      count++;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return count;
};

/**
 * Add business days to a date
 * @param {Date} date - Start date
 * @param {number} days - Number of business days to add
 * @param {Array} markets - Markets to check holidays for
 * @returns {Date} - Result date
 */
export const addBusinessDays = (date, days, markets = ['US']) => {
  const result = new Date(date);
  let daysAdded = 0;
  
  while (daysAdded < days) {
    result.setDate(result.getDate() + 1);
    if (!isWeekend(result) && !isMarketHoliday(result, markets)) {
      daysAdded++;
    }
  }
  
  return result;
};