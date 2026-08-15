// Shared display formatters for the PMS holdings views.
// Extracted from PortfolioManagementSystem.jsx so the mobile card component can
// reuse them without importing from the page module (circular import).

import * as CountryFlags from 'country-flag-icons/react/3x2';

// Helper function to get currency flag component
export const getCurrencyFlag = (currencyCode) => {
  // Map currency codes to ISO 3166-1 alpha-2 country codes
  const countryCodeMap = {
    'USD': 'US',
    'EUR': 'EU',
    'GBP': 'GB',
    'CHF': 'CH',
    'JPY': 'JP',
    'CNY': 'CN',
    'CAD': 'CA',
    'AUD': 'AU',
    'NZD': 'NZ',
    'HKD': 'HK',
    'SGD': 'SG',
    'SEK': 'SE',
    'NOK': 'NO',
    'DKK': 'DK',
    'INR': 'IN',
    'RUB': 'RU',
    'BRL': 'BR',
    'ZAR': 'ZA',
    'MXN': 'MX',
    'KRW': 'KR',
    'TRY': 'TR',
    'PLN': 'PL',
    'CZK': 'CZ',
    'HUF': 'HU',
    'RON': 'RO',
    'BGN': 'BG',
    'HRK': 'HR',
    'ILS': 'IL',
    'THB': 'TH',
    'MYR': 'MY',
    'IDR': 'ID',
    'PHP': 'PH',
    'TWD': 'TW',
    'VND': 'VN',
    'AED': 'AE',
    'SAR': 'SA',
    'QAR': 'QA',
    'KWD': 'KW',
    'BHD': 'BH',
    'OMR': 'OM',
    'EGP': 'EG',
    'MAD': 'MA',
    'TND': 'TN',
    'NGN': 'NG',
    'KES': 'KE',
    'GHS': 'GH',
    'ARS': 'AR',
    'CLP': 'CL',
    'COP': 'CO',
    'PEN': 'PE',
    'UYU': 'UY',
    'VEF': 'VE',
    'ISK': 'IS',
    'UAH': 'UA'
  };

  const countryCode = countryCodeMap[currencyCode] || currencyCode;
  const FlagComponent = CountryFlags[countryCode];

  // Return flag component if found, otherwise return null
  return FlagComponent || null
};

// Helper function to get currency symbol from currency code
export const getCurrencySymbol = (currencyCode) => {
  const symbols = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'CHF': 'CHF',
    'JPY': '¥',
    'CNY': '¥',
    'CAD': 'C$',
    'AUD': 'A$',
    'NZD': 'NZ$',
    'HKD': 'HK$',
    'SGD': 'S$',
    'SEK': 'kr',
    'NOK': 'kr',
    'DKK': 'kr',
    'INR': '₹',
    'RUB': '₽',
    'BRL': 'R$',
    'ZAR': 'R',
    'MXN': 'Mex$',
    'KRW': '₩',
    'TRY': '₺',
    'PLN': 'zł'
  };
  return symbols[currencyCode] || currencyCode || '$';
};

// Helper function to format currency value
export const formatCurrency = (value, currencyCode, options = {}) => {
  const symbol = getCurrencySymbol(currencyCode);
  const formattedValue = value.toLocaleString('en-US', {
    minimumFractionDigits: options.decimals !== undefined ? options.decimals : 2,
    maximumFractionDigits: options.decimals !== undefined ? options.decimals : 2
  });

  // For symbols that should appear after the value
  if (['kr', 'zł'].includes(symbol)) {
    return `${formattedValue} ${symbol}`;
  }

  return `${symbol} ${formattedValue}`;
};

// Smart price formatter - uses priceType from bank data to determine format
export const formatPrice = (value, currencyCode, priceType) => {
  if (!value && value !== 0) return '-';

  // If priceType is percentage, format as percentage
  // Values are stored as decimals (0.9840 = 98.40%, 1.07 = 107%)
  // Always multiply by 100 for display
  if (priceType === 'percentage') {
    const formattedValue = (value * 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    return `${formattedValue}%`;
  }

  // Otherwise format as absolute currency
  return formatCurrency(value, currencyCode);
};
