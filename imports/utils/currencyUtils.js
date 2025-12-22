// Currency Utilities
// Helper functions for currency conversion and formatting

// Utility function to format numbers with spaces as thousand separators
export const formatNumber = (value, decimals = 2) => {
  // Handle null, undefined, NaN, and invalid values
  if (value === null || value === undefined || value === '' || Number.isNaN(value)) {
    return '0.00';
  }
  
  const numValue = typeof value === 'number' ? value : parseFloat(value);
  
  // Check if parseFloat resulted in NaN
  if (Number.isNaN(numValue)) {
    return '0.00';
  }
  
  // Format with spaces as thousand separators but keep decimal point
  return numValue.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  }).replace(/,/g, ' ');
};

// Currency conversion helper for UI display with proper guardrails
export const convertForDisplay = (amount, fromCurrency, toCurrency, rates) => {
  if (fromCurrency === toCurrency) return amount;
  if (!amount || amount === 0) return amount;
  if (!rates) return null; // Signal FX unavailable
  
  // Base currency is USD for EOD API rates
  const baseCurrency = 'USD';
  
  // Get conversion rates
  let rateFrom, rateTo;
  
  if (fromCurrency === baseCurrency) {
    rateFrom = 1;
  } else if (fromCurrency === 'EUR' && rates['EURUSD.FOREX']) {
    rateFrom = rates['EURUSD.FOREX']; // EUR to USD rate
  } else {
    return null; // Unsupported currency
  }
  
  if (toCurrency === baseCurrency) {
    rateTo = 1;
  } else if (toCurrency === 'EUR' && rates['EURUSD.FOREX']) {
    rateTo = rates['EURUSD.FOREX']; // EUR to USD rate
  } else {
    return null; // Unsupported currency
  }
  
  if (!rateFrom || !rateTo) return null;
  
  // Convert: amount / rateFrom * rateTo
  // For USD to EUR: amount / 1 * (1/EURUSD) = amount / EURUSD
  // For EUR to USD: amount / EURUSD * 1 = amount * EURUSD
  if (fromCurrency === 'USD' && toCurrency === 'EUR') {
    return amount / rateTo;
  } else if (fromCurrency === 'EUR' && toCurrency === 'USD') {
    return amount * rateFrom;
  }
  
  return null;
};

// Get the true original currency based on stock exchange/symbol
export const getStockNativeCurrency = (holding) => {
  const symbol = holding.symbol || '';
  const exchange = holding.exchange || '';
  const fullTicker = holding.fullTicker || '';
  
  // European exchanges - EUR currency
  if (exchange.includes('PA') || exchange.includes('PARIS') || fullTicker.includes('.PA')) {
    return 'EUR'; // Euronext Paris (L'Oréal)
  }
  if (exchange.includes('AS') || exchange.includes('AMSTERDAM') || fullTicker.includes('.AS')) {
    return 'EUR'; // Euronext Amsterdam
  }
  if (exchange.includes('BR') || exchange.includes('BRUSSELS') || fullTicker.includes('.BR')) {
    return 'EUR'; // Euronext Brussels
  }
  if (exchange.includes('MI') || exchange.includes('MILAN') || fullTicker.includes('.MI')) {
    return 'EUR'; // Milan
  }
  if (exchange.includes('DE') || exchange.includes('XETRA') || fullTicker.includes('.DE') || fullTicker.includes('.XETRA')) {
    return 'EUR'; // German exchanges
  }
  if (exchange.includes('MA') || exchange.includes('MADRID') || fullTicker.includes('.MA')) {
    return 'EUR'; // Madrid
  }
  
  // Swiss exchanges - CHF currency
  if (exchange.includes('SW') || exchange.includes('SWISS') || fullTicker.includes('.SW')) {
    return 'CHF';
  }
  
  // Canadian exchanges - CAD currency
  if (exchange.includes('TO') || exchange.includes('TORONTO') || fullTicker.includes('.TO')) {
    return 'CAD';
  }
  if (exchange.includes('V') || exchange.includes('VENTURE') || fullTicker.includes('.V')) {
    return 'CAD'; // TSX Venture
  }
  
  // UK exchanges - GBP currency
  if (exchange.includes('L') || exchange.includes('LSE') || exchange.includes('LONDON') || fullTicker.includes('.L')) {
    return 'GBP';
  }
  
  // Japanese exchanges - JPY currency
  if (exchange.includes('T') || exchange.includes('TOKYO') || fullTicker.includes('.T')) {
    return 'JPY';
  }
  
  // Default to USD for US exchanges and unknown
  return 'USD';
};

// Format currency value with symbol
export const formatCurrency = (amount, currency = 'USD', decimals = 2) => {
  const formattedNumber = formatNumber(amount, decimals);
  
  const currencySymbols = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'CHF': 'CHF',
    'CAD': 'C$',
    'JPY': '¥'
  };
  
  const symbol = currencySymbols[currency] || currency;
  
  // For currencies that typically go after the amount
  if (currency === 'CHF') {
    return `${formattedNumber} ${symbol}`;
  }
  
  return `${symbol} ${formattedNumber}`;
};

// Calculate percentage change
export const calculatePercentageChange = (current, previous) => {
  if (!previous || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
};

// Get color for positive/negative values
export const getChangeColor = (value, neutralColor = '#6b7280') => {
  if (value > 0) return '#10b981'; // green
  if (value < 0) return '#ef4444'; // red
  return neutralColor; // gray
};

// Format percentage with color
export const formatPercentageWithColor = (percentage) => {
  const color = getChangeColor(percentage);
  const sign = percentage > 0 ? '+' : '';
  return {
    value: `${sign}${formatNumber(percentage)}%`,
    color
  };
};

// Supported currencies list
export const SUPPORTED_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$' },
  { code: 'EUR', name: 'Euro', symbol: '€' },
  { code: 'GBP', name: 'British Pound', symbol: '£' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥' }
];

// Get currency info
export const getCurrencyInfo = (currencyCode) => {
  return SUPPORTED_CURRENCIES.find(curr => curr.code === currencyCode) || 
    { code: currencyCode, name: currencyCode, symbol: currencyCode };
};