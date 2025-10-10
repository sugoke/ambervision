/**
 * Centralized formatting utilities
 * Provides consistent data formatting across the application
 */

/**
 * Number formatting utilities
 */
export const formatNumber = (value, options = {}) => {
  if (value === null || value === undefined || isNaN(value)) {
    return options.fallback || '-';
  }

  const {
    locale = 'en-US',
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    useGrouping = true,
    style = 'decimal',
    currency = 'USD',
    fallback = '-'
  } = options;

  try {
    return new Intl.NumberFormat(locale, {
      style,
      currency: style === 'currency' ? currency : undefined,
      minimumFractionDigits,
      maximumFractionDigits,
      useGrouping
    }).format(Number(value));
  } catch (error) {
    console.warn('Number formatting error:', error);
    return fallback;
  }
};

/**
 * Currency formatting
 */
export const formatCurrency = (value, currency = 'USD', options = {}) => {
  return formatNumber(value, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options
  });
};

/**
 * Percentage formatting
 */
export const formatPercentage = (value, options = {}) => {
  if (value === null || value === undefined || isNaN(value)) {
    return options.fallback || '-';
  }

  const {
    decimals = 2,
    showSign = false,
    fallback = '-'
  } = options;

  try {
    const percentage = Number(value).toFixed(decimals);
    const sign = showSign && value > 0 ? '+' : '';
    return `${sign}${percentage}%`;
  } catch (error) {
    console.warn('Percentage formatting error:', error);
    return fallback;
  }
};

/**
 * Large number formatting (K, M, B, T)
 */
export const formatLargeNumber = (value, options = {}) => {
  if (value === null || value === undefined || isNaN(value)) {
    return options.fallback || '-';
  }

  const {
    decimals = 1,
    fallback = '-'
  } = options;

  const num = Math.abs(Number(value));
  const sign = value < 0 ? '-' : '';

  try {
    if (num >= 1e12) {
      return `${sign}${(num / 1e12).toFixed(decimals)}T`;
    } else if (num >= 1e9) {
      return `${sign}${(num / 1e9).toFixed(decimals)}B`;
    } else if (num >= 1e6) {
      return `${sign}${(num / 1e6).toFixed(decimals)}M`;
    } else if (num >= 1e3) {
      return `${sign}${(num / 1e3).toFixed(decimals)}K`;
    } else {
      return `${sign}${num.toFixed(decimals)}`;
    }
  } catch (error) {
    console.warn('Large number formatting error:', error);
    return fallback;
  }
};

/**
 * Date formatting utilities
 */
export const formatDate = (date, options = {}) => {
  if (!date) {
    return options.fallback || '-';
  }

  const {
    locale = 'en-US',
    dateStyle = 'medium',
    timeStyle,
    format = 'localeString',
    fallback = '-'
  } = options;

  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    
    if (isNaN(dateObj.getTime())) {
      return fallback;
    }

    switch (format) {
      case 'iso':
        return dateObj.toISOString();
      case 'date':
        return dateObj.toLocaleDateString(locale, { dateStyle });
      case 'time':
        return dateObj.toLocaleTimeString(locale, { timeStyle: timeStyle || 'short' });
      case 'datetime':
        return dateObj.toLocaleString(locale, { dateStyle, timeStyle: timeStyle || 'short' });
      case 'relative':
        return formatRelativeTime(dateObj, options);
      default:
        return dateObj.toLocaleString(locale, { dateStyle, timeStyle });
    }
  } catch (error) {
    console.warn('Date formatting error:', error);
    return fallback;
  }
};

/**
 * Relative time formatting (e.g., "2 hours ago", "in 3 days")
 */
export const formatRelativeTime = (date, options = {}) => {
  if (!date) {
    return options.fallback || '-';
  }

  const {
    locale = 'en-US',
    now = new Date(),
    fallback = '-'
  } = options;

  try {
    const dateObj = date instanceof Date ? date : new Date(date);
    const nowObj = now instanceof Date ? now : new Date(now);
    
    if (isNaN(dateObj.getTime()) || isNaN(nowObj.getTime())) {
      return fallback;
    }

    const diffMs = dateObj.getTime() - nowObj.getTime();
    const absDiffMs = Math.abs(diffMs);

    // Define time units in milliseconds
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    const week = 7 * day;
    const month = 30 * day;
    const year = 365 * day;

    let value, unit;

    if (absDiffMs < minute) {
      return 'just now';
    } else if (absDiffMs < hour) {
      value = Math.floor(absDiffMs / minute);
      unit = 'minute';
    } else if (absDiffMs < day) {
      value = Math.floor(absDiffMs / hour);
      unit = 'hour';
    } else if (absDiffMs < week) {
      value = Math.floor(absDiffMs / day);
      unit = 'day';
    } else if (absDiffMs < month) {
      value = Math.floor(absDiffMs / week);
      unit = 'week';
    } else if (absDiffMs < year) {
      value = Math.floor(absDiffMs / month);
      unit = 'month';
    } else {
      value = Math.floor(absDiffMs / year);
      unit = 'year';
    }

    // Use Intl.RelativeTimeFormat if available
    if (typeof Intl !== 'undefined' && Intl.RelativeTimeFormat) {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      return rtf.format(diffMs < 0 ? -value : value, unit);
    }

    // Fallback for older browsers
    const suffix = diffMs < 0 ? 'ago' : 'in';
    const prefix = diffMs < 0 ? '' : 'in ';
    const unitText = value === 1 ? unit : `${unit}s`;
    
    return diffMs < 0 ? `${value} ${unitText} ${suffix}` : `${prefix}${value} ${unitText}`;
  } catch (error) {
    console.warn('Relative time formatting error:', error);
    return fallback;
  }
};

/**
 * Duration formatting (e.g., "2h 30m", "1d 4h")
 */
export const formatDuration = (milliseconds, options = {}) => {
  if (milliseconds === null || milliseconds === undefined || isNaN(milliseconds)) {
    return options.fallback || '-';
  }

  const {
    format = 'long', // 'long', 'short', 'minimal'
    maxUnits = 2,
    fallback = '-'
  } = options;

  try {
    const ms = Math.abs(milliseconds);
    
    const units = {
      year: 365 * 24 * 60 * 60 * 1000,
      month: 30 * 24 * 60 * 60 * 1000,
      day: 24 * 60 * 60 * 1000,
      hour: 60 * 60 * 1000,
      minute: 60 * 1000,
      second: 1000
    };

    const result = [];
    let remaining = ms;

    for (const [unit, unitMs] of Object.entries(units)) {
      if (remaining >= unitMs && result.length < maxUnits) {
        const value = Math.floor(remaining / unitMs);
        remaining %= unitMs;

        switch (format) {
          case 'short':
            result.push(`${value}${unit.charAt(0)}`);
            break;
          case 'minimal':
            result.push(`${value}${unit.substring(0, 2)}`);
            break;
          default: // long
            result.push(`${value} ${value === 1 ? unit : unit + 's'}`);
        }
      }
    }

    return result.length > 0 ? result.join(' ') : '0 seconds';
  } catch (error) {
    console.warn('Duration formatting error:', error);
    return fallback;
  }
};

/**
 * String formatting utilities
 */
export const formatString = {
  /**
   * Capitalize first letter
   */
  capitalize: (str) => {
    if (!str || typeof str !== 'string') return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
  },

  /**
   * Title case formatting
   */
  titleCase: (str) => {
    if (!str || typeof str !== 'string') return str;
    return str.replace(/\w\S*/g, (txt) => 
      txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
    );
  },

  /**
   * Camel case to readable text
   */
  camelToReadable: (str) => {
    if (!str || typeof str !== 'string') return str;
    return str
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (str) => str.toUpperCase())
      .trim();
  },

  /**
   * Truncate text with ellipsis
   */
  truncate: (str, maxLength = 50, suffix = '...') => {
    if (!str || typeof str !== 'string') return str;
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - suffix.length) + suffix;
  },

  /**
   * Format file size
   */
  fileSize: (bytes, decimals = 2) => {
    if (bytes === 0) return '0 Bytes';
    if (!bytes || isNaN(bytes)) return '-';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${sizes[i]}`;
  }
};

/**
 * Phone number formatting
 */
export const formatPhoneNumber = (phoneNumber, options = {}) => {
  if (!phoneNumber) return options.fallback || '-';

  const {
    country = 'US',
    format = 'national',
    fallback = '-'
  } = options;

  try {
    // Simple US phone number formatting
    if (country === 'US') {
      const cleaned = phoneNumber.replace(/\D/g, '');
      
      if (cleaned.length === 10) {
        return format === 'international' 
          ? `+1 (${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
          : `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
      } else if (cleaned.length === 11 && cleaned.startsWith('1')) {
        return format === 'international'
          ? `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`
          : `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
      }
    }

    return phoneNumber; // Return as-is if can't format
  } catch (error) {
    console.warn('Phone number formatting error:', error);
    return fallback;
  }
};

/**
 * Address formatting
 */
export const formatAddress = (address, options = {}) => {
  if (!address || typeof address !== 'object') {
    return options.fallback || '-';
  }

  const {
    format = 'multiline', // 'multiline', 'single', 'short'
    separator = ', ',
    fallback = '-'
  } = options;

  try {
    const parts = [];
    
    if (address.street) parts.push(address.street);
    if (address.street2) parts.push(address.street2);
    
    const cityStateZip = [address.city, address.state, address.zip]
      .filter(Boolean)
      .join(' ');
    
    if (cityStateZip) parts.push(cityStateZip);
    if (address.country && address.country !== 'US') parts.push(address.country);

    if (parts.length === 0) return fallback;

    switch (format) {
      case 'single':
        return parts.join(separator);
      case 'short':
        return `${address.city || ''}, ${address.state || ''}`.replace(/^,\s*|,\s*$/g, '');
      default: // multiline
        return parts.join('\n');
    }
  } catch (error) {
    console.warn('Address formatting error:', error);
    return fallback;
  }
};