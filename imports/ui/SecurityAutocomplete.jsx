import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import ReactCountryFlag from 'react-country-flag';
import { getSecurityCountryFlag } from '/imports/utils/securityUtils.js';
import { normalizeExchangeForEOD } from '/imports/utils/tickerUtils.js';

const SecurityAutocomplete = ({ 
  value = '', 
  onChange, 
  placeholder = 'Search for securities...', 
  onSecuritySelect,
  disabled = false 
}) => {
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [prices, setPrices] = useState({});
  const [error, setError] = useState('');
  
  const inputRef = useRef(null);
  const dropdownRef = useRef(null);
  const timeoutRef = useRef(null);

  // Update input value when prop changes
  useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Handle clicks outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        dropdownRef.current && 
        !dropdownRef.current.contains(event.target) &&
        !inputRef.current.contains(event.target)
      ) {
        setShowDropdown(false);
        setSelectedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search securities with debouncing
  const searchSecurities = async (query) => {
    if (!query || query.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const results = await Meteor.callAsync('eod.searchSecurities', query, 15);
      
      if (results && results.length > 0) {
        setSuggestions(results);
        setShowDropdown(true);
        
        // No longer fetch prices in autocomplete for better performance
      } else {
        setSuggestions([]);
        setShowDropdown(false);
      }
    } catch (err) {
      console.error('Security search error:', err);
      setError('Failed to search securities. Please try again.');
      setSuggestions([]);
      setShowDropdown(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle input change with debouncing
  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange && onChange(newValue);
    
    // Clear existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    // Set new timeout for search
    timeoutRef.current = setTimeout(() => {
      searchSecurities(newValue);
    }, 300);
  };

  // Handle input focus
  const handleInputFocus = () => {
    if (suggestions.length > 0) {
      setShowDropdown(true);
    }
  };

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (!showDropdown || suggestions.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : 0
        );
        break;
      
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev > 0 ? prev - 1 : suggestions.length - 1
        );
        break;
      
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          handleSecuritySelect(suggestions[selectedIndex]);
        }
        break;
      
      case 'Escape':
        setShowDropdown(false);
        setSelectedIndex(-1);
        inputRef.current?.blur();
        break;
    }
  };

  // Handle security selection
  const handleSecuritySelect = (security) => {
    // STEP 1: Clean the symbol by removing country/market codes (e.g., "ADS GY" → "ADS")
    let cleanSymbol = security.Code || '';

    // Remove common Bloomberg-style suffixes (space + 2 letters)
    // Examples: "ADS GY" → "ADS", "AIR FP" → "AIR", "INTC UQ" → "INTC"
    const symbolMatch = cleanSymbol.match(/^([A-Z0-9]+)(\s+[A-Z]{2})?$/);
    if (symbolMatch) {
      cleanSymbol = symbolMatch[1]; // Take only the first part
    }

    // STEP 2: Normalize exchange name to uppercase API format
    let exchangeCode = security.Exchange || '';

    // Convert common human-readable names to uppercase codes
    const exchangeNormalizations = {
      'xetra': 'XETRA',
      'frankfurt': 'XETRA',
      'euronext paris': 'PA',
      'paris': 'PA',
      'euronext amsterdam': 'AS',
      'amsterdam': 'AS',
      'euronext brussels': 'BR',
      'brussels': 'BR',
      'london': 'LSE',
      'nasdaq': 'NASDAQ',
      'nyse': 'NYSE'
    };

    const normalizedExchange = exchangeNormalizations[exchangeCode.toLowerCase()] || exchangeCode.toUpperCase();

    // STEP 3: Create ticker and apply EOD API normalization
    const rawTicker = normalizedExchange ? `${cleanSymbol}.${normalizedExchange}` : cleanSymbol;
    const normalizedTicker = normalizeExchangeForEOD(rawTicker);

    console.log(`[SecurityAutocomplete] Selected security:`, {
      original: { code: security.Code, exchange: security.Exchange },
      cleaned: { symbol: cleanSymbol, exchange: normalizedExchange },
      ticker: normalizedTicker
    });

    const displayName = `${security.Code} - ${security.Name}`;

    setInputValue(displayName);
    setShowDropdown(false);
    setSelectedIndex(-1);

    // Call onChange with the display name
    onChange && onChange(displayName);

    // Call onSecuritySelect with enhanced security data
    onSecuritySelect && onSecuritySelect({
      ...security,
      Code: cleanSymbol,        // Override with cleaned symbol
      Exchange: normalizedExchange,  // Override with normalized exchange
      ticker: normalizedTicker,  // Add normalized ticker field
      displayName,
      price: prices[normalizedTicker]
    });
  };

  // Get country flag emoji
  const getCountryFlag = (countryCode) => {
    const flagMap = {
      'US': '🇺🇸', 'USA': '🇺🇸', 'United States': '🇺🇸',
      'GB': '🇬🇧', 'UK': '🇬🇧', 'United Kingdom': '🇬🇧',
      'DE': '🇩🇪', 'Germany': '🇩🇪',
      'FR': '🇫🇷', 'France': '🇫🇷',
      'JP': '🇯🇵', 'Japan': '🇯🇵',
      'CA': '🇨🇦', 'Canada': '🇨🇦',
      'AU': '🇦🇺', 'Australia': '🇦🇺',
      'CH': '🇨🇭', 'Switzerland': '🇨🇭',
      'NL': '🇳🇱', 'Netherlands': '🇳🇱',
      'IT': '🇮🇹', 'Italy': '🇮🇹',
      'ES': '🇪🇸', 'Spain': '🇪🇸',
      'SE': '🇸🇪', 'Sweden': '🇸🇪',
      'NO': '🇳🇴', 'Norway': '🇳🇴',
      'DK': '🇩🇰', 'Denmark': '🇩🇰',
      'FI': '🇫🇮', 'Finland': '🇫🇮',
      'BE': '🇧🇪', 'Belgium': '🇧🇪',
      'AT': '🇦🇹', 'Austria': '🇦🇹',
      'IE': '🇮🇪', 'Ireland': '🇮🇪',
      'PT': '🇵🇹', 'Portugal': '🇵🇹',
      'LU': '🇱🇺', 'Luxembourg': '🇱🇺',
      'HK': '🇭🇰', 'Hong Kong': '🇭🇰',
      'SG': '🇸🇬', 'Singapore': '🇸🇬',
      'KR': '🇰🇷', 'South Korea': '🇰🇷',
      'IN': '🇮🇳', 'India': '🇮🇳',
      'CN': '🇨🇳', 'China': '🇨🇳',
      'BR': '🇧🇷', 'Brazil': '🇧🇷',
      'MX': '🇲🇽', 'Mexico': '🇲🇽',
      'AR': '🇦🇷', 'Argentina': '🇦🇷',
      'CL': '🇨🇱', 'Chile': '🇨🇱',
      'ZA': '🇿🇦', 'South Africa': '🇿🇦',
      'RU': '🇷🇺', 'Russia': '🇷🇺',
      'TR': '🇹🇷', 'Turkey': '🇹🇷',
      'PL': '🇵🇱', 'Poland': '🇵🇱',
      'CZ': '🇨🇿', 'Czech Republic': '🇨🇿',
      'HU': '🇭🇺', 'Hungary': '🇭🇺',
      'GR': '🇬🇷', 'Greece': '🇬🇷',
      'IL': '🇮🇱', 'Israel': '🇮🇱',
      'TH': '🇹🇭', 'Thailand': '🇹🇭',
      'MY': '🇲🇾', 'Malaysia': '🇲🇾',
      'ID': '🇮🇩', 'Indonesia': '🇮🇩',
      'PH': '🇵🇭', 'Philippines': '🇵🇭',
      'TW': '🇹🇼', 'Taiwan': '🇹🇼',
      'NZ': '🇳🇿', 'New Zealand': '🇳🇿'
    };
    
    if (!countryCode) return '';
    
    // Try exact match first
    const flag = flagMap[countryCode.toUpperCase()];
    if (flag) return flag;
    
    // Try case-insensitive name match
    const countryName = Object.keys(flagMap).find(key => 
      key.toLowerCase() === countryCode.toLowerCase()
    );
    
    return countryName ? flagMap[countryName] : '🌍'; // Default world flag
  };

  // Get asset type color coding
  const getAssetTypeColor = (type) => {
    const normalizedType = (type || '').toLowerCase();
    
    if (normalizedType.includes('index')) {
      return { bg: '#e3f2fd', border: '#1976d2', text: '#1565c0' }; // Blue for indices
    } else if (normalizedType.includes('etf')) {
      return { bg: '#f3e5f5', border: '#7b1fa2', text: '#6a1b9a' }; // Purple for ETFs
    } else if (normalizedType.includes('stock') || normalizedType.includes('equity') || normalizedType.includes('common stock')) {
      return { bg: '#e8f5e8', border: '#388e3c', text: '#2e7d32' }; // Green for stocks
    } else if (normalizedType.includes('bond')) {
      return { bg: '#fff3e0', border: '#f57c00', text: '#ef6c00' }; // Orange for bonds
    } else if (normalizedType.includes('commodity')) {
      return { bg: '#fce4ec', border: '#c2185b', text: '#ad1457' }; // Pink for commodities
    } else if (normalizedType.includes('currency') || normalizedType.includes('forex')) {
      return { bg: '#e0f2f1', border: '#00695c', text: '#004d40' }; // Teal for currencies
    } else {
      return { bg: '#f5f5f5', border: '#757575', text: '#616161' }; // Gray for others
    }
  };

  // Format security display
  const formatSecurityDisplay = (security) => {
    
    const {
      Code: symbol,
      Name: name,
      Exchange: exchange,
      Country: country,
      Currency: currency,
      Type: type
    } = security;
    
    // Try alternative field names for country
    let countryValue = country || security.country || security.COUNTRY || security.CountryCode || security.countryCode;
    
    // If no country data, try to infer from exchange
    if (!countryValue && exchange) {
      const exchangeToCountry = {
        'NASDAQ': 'US', 'NYSE': 'US', 'US': 'US', 'AMEX': 'US',
        'LSE': 'GB', 'LON': 'GB',
        'XETRA': 'DE', 'FRA': 'DE', 'FRANKFURT': 'DE',
        'EPA': 'FR', 'PAR': 'FR', 'PARIS': 'FR',
        'TSE': 'JP', 'JPX': 'JP', 'TOKYO': 'JP',
        'TSX': 'CA', 'TORONTO': 'CA',
        'ASX': 'AU', 'SYDNEY': 'AU',
        'SIX': 'CH', 'ZURICH': 'CH',
        'AMS': 'NL', 'AMSTERDAM': 'NL',
        'MIL': 'IT', 'MILAN': 'IT',
        'BME': 'ES', 'MADRID': 'ES',
        'OMX': 'SE', 'STOCKHOLM': 'SE',
        'OSL': 'NO', 'OSLO': 'NO',
        'CSE': 'DK', 'COPENHAGEN': 'DK',
        'HEL': 'FI', 'HELSINKI': 'FI',
        'BRU': 'BE', 'BRUSSELS': 'BE',
        'VIE': 'AT', 'VIENNA': 'AT',
        'ISE': 'IE', 'DUBLIN': 'IE',
        'LIS': 'PT', 'LISBON': 'PT',
        'LUX': 'LU', 'LUXEMBOURG': 'LU',
        'HKEX': 'HK', 'HKG': 'HK', 'HONG KONG': 'HK',
        'SGX': 'SG', 'SINGAPORE': 'SG',
        'KRX': 'KR', 'SEOUL': 'KR',
        'BSE': 'IN', 'NSE': 'IN', 'MUMBAI': 'IN',
        'SSE': 'CN', 'SZSE': 'CN', 'SHANGHAI': 'CN', 'SHENZHEN': 'CN'
      };
      
      countryValue = exchangeToCountry[exchange.toUpperCase()] || countryValue;
    }

    let displayName = name || symbol;
    if (displayName.length > 40) {
      displayName = displayName.substring(0, 37) + '...';
    }

    const ticker = exchange ? `${symbol}.${exchange}` : symbol;
    const exchangeInfo = exchange ? ` (${exchange})` : '';
    const currencyInfo = currency ? ` - ${currency}` : '';
    const countryFlag = getCountryFlag(countryValue);
    const priceData = prices[ticker];
    const colors = getAssetTypeColor(type);

    return {
      primary: `${symbol}${exchangeInfo}`,
      secondary: displayName,
      details: `${type || 'Security'}${currencyInfo}`,
      currency: currency,
      country: countryValue,
      exchange: exchange,
      countryFlag: countryFlag,
      price: priceData,
      colors
    };
  };

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      {/* Input Field */}
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleInputFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          style={{
            width: '100%',
            padding: '12px 40px 12px 16px',
            borderWidth: '2px',
            borderStyle: 'solid',
            borderColor: showDropdown ? 'var(--accent-color)' : 'var(--border-color)',
            borderTopLeftRadius: '8px',
            borderTopRightRadius: '8px',
            borderBottomLeftRadius: showDropdown ? '0' : '8px',
            borderBottomRightRadius: showDropdown ? '0' : '8px',
            fontSize: '1rem',
            boxSizing: 'border-box',
            background: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            transition: 'border-color 0.2s ease'
          }}
        />
        
        {/* Loading/Search Icon */}
        <div style={{
          position: 'absolute',
          right: '12px',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--text-muted)',
          fontSize: '1rem'
        }}>
          {isLoading ? '🔄' : '🔍'}
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div style={{
          marginTop: '4px',
          padding: '8px 12px',
          backgroundColor: 'rgba(220, 53, 69, 0.1)',
          border: '1px solid rgba(220, 53, 69, 0.3)',
          borderRadius: '6px',
          color: 'var(--danger-color)',
          fontSize: '0.875rem'
        }}>
          {error}
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: 'var(--bg-primary)',
            border: '2px solid var(--accent-color)',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            zIndex: 1000,
            maxHeight: '300px',
            overflowY: 'auto'
          }}
        >
          {suggestions.map((security, index) => {
            const display = formatSecurityDisplay(security);
            const isSelected = index === selectedIndex;
            
            return (
              <div
                key={`${security.Code}-${security.Exchange || 'default'}-${index}`}
                onClick={() => handleSecuritySelect(security)}
                style={{
                  padding: '12px 16px',
                  borderBottom: index < suggestions.length - 1 ? '1px solid var(--border-color)' : 'none',
                  cursor: 'pointer',
                  backgroundColor: isSelected ? 'var(--bg-secondary)' : 'transparent',
                  transition: 'background-color 0.2s ease'
                }}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '12px'
                }}>
                  {/* Asset Type Badge */}
                  <div style={{
                    flexShrink: 0,
                    alignSelf: 'flex-start',
                    marginTop: '2px'
                  }}>
                    <div style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      fontSize: '0.7rem',
                      fontWeight: '600',
                      backgroundColor: display.colors.bg,
                      color: display.colors.text,
                      border: `1px solid ${display.colors.border}`,
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px'
                    }}>
                      {security.Type === 'Index' ? 'IDX' : 
                       security.Type === 'ETF' ? 'ETF' :
                       security.Type === 'Common Stock' ? 'STK' :
                       security.Type?.substring(0, 3) || 'SEC'}
                    </div>
                  </div>
                  
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      fontSize: '0.95rem',
                      marginBottom: '2px'
                    }}>
                      {display.primary}
                    </div>
                    <div style={{
                      color: 'var(--text-secondary)',
                      fontSize: '0.875rem',
                      marginBottom: '2px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {display.secondary}
                    </div>
                    <div style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        color: 'var(--text-muted)',
                        fontSize: '0.8rem'
                      }}>
                        <span>{display.details}</span>
                        {display.country && getSecurityCountryFlag(display.country, display.exchange, display.isin)}
                      </div>
                      {display.currency && (
                        <div style={{
                          backgroundColor: 'var(--accent-color)',
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.75rem',
                          fontWeight: '600',
                          flexShrink: 0
                        }}>
                          {display.currency}
                        </div>
                      )}
                    </div>
                  </div>
                  
                </div>
              </div>
            );
          })}
          
          {/* Footer */}
          <div style={{
            padding: '8px 16px',
            background: 'var(--bg-tertiary)',
            borderTop: '1px solid var(--border-color)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textAlign: 'center'
          }}>
            {suggestions.length} securities found • Use ↑↓ to navigate, Enter to select
          </div>
        </div>
      )}
    </div>
  );
};

export default SecurityAutocomplete;