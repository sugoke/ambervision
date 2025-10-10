import React from 'react';
import ReactCountryFlag from 'react-country-flag';

// Helper function to get country flag from country code, exchange, or ISIN
export const getSecurityCountryFlag = (country, exchange, isin = null) => {
  // Try country first
  let countryCode = '';
  if (country) {
    countryCode = country.toUpperCase();
    // Fix common country code issues
    if (countryCode === 'USA') countryCode = 'US';
    if (countryCode === 'UNITED STATES') countryCode = 'US';
    if (countryCode === 'UNITED KINGDOM') countryCode = 'GB';
  }
  
  // Fallback to exchange inference
  if (!countryCode && exchange) {
    const exchangeToCountry = {
      // US Exchanges
      'NASDAQ': 'US', 'NYSE': 'US', 'US': 'US', 'AMEX': 'US',
      
      // UK Exchanges
      'LSE': 'GB', 'LON': 'GB', 'LONDON': 'GB',
      
      // German Exchanges
      'XETRA': 'DE', 'FRA': 'DE', 'FRANKFURT': 'DE', 'DE': 'DE',
      
      // French Exchanges (Enhanced)
      'EPA': 'FR', 'PAR': 'FR', 'PARIS': 'FR', 'EURONEXT': 'FR', 
      'PA': 'FR', 'FRANCE': 'FR', 'FR': 'FR',
      
      // Japanese Exchanges
      'TSE': 'JP', 'JPX': 'JP', 'TOKYO': 'JP', 'JP': 'JP',
      
      // Canadian Exchanges
      'TSX': 'CA', 'TORONTO': 'CA', 'CA': 'CA',
      
      // Other European Exchanges
      'SIX': 'CH', 'ZURICH': 'CH', 'CH': 'CH', 'SWITZERLAND': 'CH',
      'AMS': 'NL', 'AMSTERDAM': 'NL', 'NL': 'NL', 'NETHERLANDS': 'NL',
      'MIL': 'IT', 'MILAN': 'IT', 'IT': 'IT', 'ITALY': 'IT',
      'BME': 'ES', 'MADRID': 'ES', 'ES': 'ES', 'SPAIN': 'ES',
      
      // Asia-Pacific Exchanges
      'ASX': 'AU', 'SYDNEY': 'AU', 'AU': 'AU', 'AUSTRALIA': 'AU',
      'HKEX': 'HK', 'HKG': 'HK', 'HONG KONG': 'HK',
      'SGX': 'SG', 'SINGAPORE': 'SG'
    };
    countryCode = exchangeToCountry[exchange.toUpperCase()];
  }
  
  // Last fallback: extract country from ISIN (first 2 characters)
  if (!countryCode && isin && isin.length >= 2) {
    const isinCountry = isin.substring(0, 2).toUpperCase();
    // Map common ISIN country codes to flag country codes
    const isinToCountry = {
      'US': 'US', 'CA': 'CA', 'GB': 'GB', 'IE': 'IE',
      'FR': 'FR', 'DE': 'DE', 'NL': 'NL', 'BE': 'BE',
      'IT': 'IT', 'ES': 'ES', 'CH': 'CH', 'AT': 'AT',
      'DK': 'DK', 'SE': 'SE', 'NO': 'NO', 'FI': 'FI',
      'JP': 'JP', 'HK': 'HK', 'SG': 'SG', 'AU': 'AU'
    };
    countryCode = isinToCountry[isinCountry];
  }
  
  if (!countryCode) {
    return null;
  }
  
  // Use ReactCountryFlag for proper flag rendering
  return React.createElement(ReactCountryFlag, {
    key: `flag-${countryCode}`,
    countryCode: countryCode,
    svg: true,
    style: {
      width: '16px',
      height: '12px',
      marginLeft: '4px'
    },
    title: `${countryCode} flag`
  });
};