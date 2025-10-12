import React, { useState, useEffect, useCallback, useMemo, memo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { ProductsCollection } from '/imports/api/products';
import { normalizeTickerSymbol, validateTickerFormat, getCurrencyFromTicker } from '/imports/utils/tickerUtils';

// Define the base securities we want to track with fallback data - static constant
// EOD ticker formats:
// US Stocks/ETFs: SYMBOL.US (e.g., SPY.US, QQQ.US)
// Indices: SYMBOL.INDX (e.g., GSPC.INDX for S&P 500, IXIC.INDX for Nasdaq)
// Forex: PAIR.FOREX (e.g., EUR-USD.FOREX)
// Commodities: SYMBOL.COM (e.g., GC.COM for gold)
// Crypto: PAIR.CC (e.g., BTC-USD.CC)
const BASE_SECURITIES = [
  { symbol: 'GSPC.INDX', name: 'S&P 500', type: 'index', currency: 'USD', fallbackPrice: 6049.88, fallbackChange: -14.16 },
  { symbol: 'IXIC.INDX', name: 'Nasdaq', type: 'index', currency: 'USD', fallbackPrice: 21052.53, fallbackChange: 98.27 },
  { symbol: 'EURUSD.FOREX', name: 'EUR/USD', type: 'currency', currency: 'USD', fallbackPrice: 1.0430, fallbackChange: 0.0012 },
  { symbol: 'N225.INDX', name: 'Nikkei 225', type: 'index', currency: 'JPY', fallbackPrice: 38033.22, fallbackChange: 257.68 },
  { symbol: 'STOXX50E.INDX', name: 'Eurostoxx 50', type: 'index', currency: 'EUR', fallbackPrice: 5337.02, fallbackChange: 73.73 },
  { symbol: 'FCHI.INDX', name: 'CAC 40', type: 'index', currency: 'EUR', fallbackPrice: 7711.88, fallbackChange: 76.85 },
  { symbol: 'GDAXI.INDX', name: 'DAX', type: 'index', currency: 'EUR', fallbackPrice: 24220.28, fallbackChange: 295.92 },
  { symbol: 'AAPL.US', name: 'Apple', type: 'stock', currency: 'USD', fallbackPrice: 219.21, fallbackChange: 5.96 },
  { symbol: 'BTC-USD.CC', name: 'Bitcoin', type: 'crypto', currency: 'USD', fallbackPrice: 116605.47, fallbackChange: 1577.47 },
  { symbol: 'TSLA.US', name: 'Tesla', type: 'stock', currency: 'USD', fallbackPrice: 285.40, fallbackChange: 12.80 }
];

// Function to extract unique underlyings from products
const extractUnderlyingsFromProducts = (products) => {
  const underlyingsMap = new Map();
  
  products.forEach(product => {
    if (product.underlyings && Array.isArray(product.underlyings)) {
      product.underlyings.forEach(underlying => {
        // Handle different underlying structures
        let symbol, name;
        
        if (underlying.symbol) {
          symbol = underlying.symbol;
          name = underlying.name || symbol;
        } else if (underlying.ticker) {
          symbol = underlying.ticker;
          name = underlying.name || symbol;
        } else if (underlying.security) {
          symbol = underlying.security.symbol;
          name = underlying.security.name || symbol;
        }
        
        if (symbol) {
          // Validate ticker format
          const validation = validateTickerFormat(symbol);
          if (!validation.valid) {
            console.log(`[MarketTicker] Skipping invalid symbol: "${symbol}" (${validation.reason})`);
            return; // Skip this underlying
          }

          // Normalize symbol format for EOD API using centralized utility
          const normalizedSymbol = normalizeTickerSymbol(symbol, { name });
          if (!normalizedSymbol) {
            console.log(`[MarketTicker] Failed to normalize symbol: "${symbol}"`);
            return;
          }

          // Get currency from normalized ticker
          const currency = getCurrencyFromTicker(normalizedSymbol);

          if (!underlyingsMap.has(normalizedSymbol)) {
            underlyingsMap.set(normalizedSymbol, {
              symbol: normalizedSymbol,
              name: name || symbol,
              type: 'stock',
              currency: currency,
              fallbackPrice: 100.00,
              fallbackChange: 0.00
            });
          }
        }
      });
    }
    
    // Also check payoffStructure for underlying assets
    if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
      product.payoffStructure.forEach(item => {
        if (item.type === 'Underlying Asset' && item.definition) {
          if (item.definition.security) {
            const symbol = item.definition.security.symbol;
            const name = item.definition.security.name || symbol;

            if (symbol) {
              // Validate ticker format
              const validation = validateTickerFormat(symbol);
              if (!validation.valid) {
                console.log(`[MarketTicker] Skipping invalid symbol in payoffStructure: "${symbol}" (${validation.reason})`);
                return; // Skip this security
              }

              // Normalize symbol format for EOD API using centralized utility
              const normalizedSymbol = normalizeTickerSymbol(symbol, { name });
              if (!normalizedSymbol) {
                console.log(`[MarketTicker] Failed to normalize symbol in payoffStructure: "${symbol}"`);
                return;
              }

              // Get currency from normalized ticker
              const currency = getCurrencyFromTicker(normalizedSymbol);

              if (!underlyingsMap.has(normalizedSymbol)) {
                underlyingsMap.set(normalizedSymbol, {
                  symbol: normalizedSymbol,
                  name: name || symbol,
                  type: 'stock',
                  currency: currency,
                  fallbackPrice: 100.00,
                  fallbackChange: 0.00
                });
              }
            }
          }
          
          if (item.definition.basket && Array.isArray(item.definition.basket)) {
            item.definition.basket.forEach(security => {
              const symbol = security.symbol;
              const name = security.name || symbol;

              if (symbol) {
                // Validate ticker format
                const validation = validateTickerFormat(symbol);
                if (!validation.valid) {
                  console.log(`[MarketTicker] Skipping invalid symbol in basket: "${symbol}" (${validation.reason})`);
                  return; // Skip this security
                }

                // Normalize symbol format for EOD API using centralized utility
                const normalizedSymbol = normalizeTickerSymbol(symbol, { name });
                if (!normalizedSymbol) {
                  console.log(`[MarketTicker] Failed to normalize symbol in basket: "${symbol}"`);
                  return;
                }

                // Get currency from normalized ticker
                const currency = getCurrencyFromTicker(normalizedSymbol);

                if (!underlyingsMap.has(normalizedSymbol)) {
                  underlyingsMap.set(normalizedSymbol, {
                    symbol: normalizedSymbol,
                    name: name || symbol,
                    type: 'stock',
                    currency: currency,
                    fallbackPrice: 100.00,
                    fallbackChange: 0.00
                  });
                }
              }
            });
          }
        }
      });
    }
  });
  
  return Array.from(underlyingsMap.values());
};

// Function to get currency symbol from currency code
const getCurrencySymbol = (currency) => {
  const symbols = {
    'USD': '$',
    'EUR': '€',
    'GBP': '£',
    'JPY': '¥',
    'CNY': '¥',
    'CAD': 'C$',
    'AUD': 'A$',
    'CHF': 'Fr',
    'HKD': 'HK$',
    'SGD': 'S$',
    'SEK': 'kr',
    'NOK': 'kr',
    'DKK': 'kr',
    'INR': '₹',
    'BTC': '₿'
  };
  return symbols[currency] || '$'; // Default to $ if currency not found
};

// Function to get type icon for fallback
const getTypeIcon = (type) => {
  switch (type) {
    case 'index': return '📈';
    case 'currency': return '💱';
    case 'commodity': return '🏗️';
    case 'crypto': return '₿';
    default: return '📊';
  }
};

// Function to get company domain from ticker symbol for logo lookup
const getCompanyDomain = (symbol) => {
  const domainMap = {
    'AAPL.US': 'apple.com',
    'TSLA.US': 'tesla.com',
    'MSFT.US': 'microsoft.com',
    'GOOGL.US': 'google.com',
    'GOOG.US': 'google.com',
    'AMZN.US': 'amazon.com',
    'NVDA.US': 'nvidia.com',
    'META.US': 'meta.com',
    'SPY.US': 'spdrs.com',
    'QQQ.US': 'invesco.com',
    'NFLX.US': 'netflix.com',
    'AMD.US': 'amd.com',
    'INTC.US': 'intel.com'
  };
  return domainMap[symbol] || null;
};

// Function to get logo URL with multiple fallback strategies
const getLogoUrl = (symbol, name, type) => {
  // Strategy 1: For stocks, use Financial Modeling Prep logo API (more accurate for stocks)
  if (type === 'stock' || type === 'etf') {
    const tickerSymbol = symbol.replace('.US', '').replace('.', '-');
    return `https://financialmodelingprep.com/image-stock/${tickerSymbol}.png`;
  }
  
  // Strategy 2: For major indices, use flag emojis and custom icons
  if (type === 'index') {
    const indexLogos = {
      'GSPC.INDX': '🇺🇸',
      'IXIC.INDX': '🇺🇸',
      'STOXX50E.INDX': '🇪🇺',
      'FCHI.INDX': '🇫🇷', 
      'GDAXI.INDX': '🇩🇪',
      'N225.INDX': '🇯🇵'
    };
    return indexLogos[symbol] || '📈';
  }
  
  // Strategy 3: For forex, use currency symbols
  if (type === 'currency') {
    const currencyLogos = {
      'EURUSD.FOREX': '💱'
    };
    return currencyLogos[symbol] || '💱';
  }
  
  // Strategy 4: For crypto, use crypto symbols
  if (type === 'crypto') {
    const cryptoLogos = {
      'BTC-USD.CC': '₿',
      'ETH-USD.CC': 'Ξ', 
      'ADA-USD.CC': '₳'
    };
    return cryptoLogos[symbol] || '₿';
  }
  
  return null;
};

// Component for displaying logo with fallback
const TickerLogo = ({ symbol, name, type }) => {
  const logoUrl = getLogoUrl(symbol, name, type);
  
  // If it's an emoji or no URL, return the emoji/icon
  if (!logoUrl || !logoUrl.startsWith('http')) {
    return (
      <span style={{ 
        fontSize: '1.2rem', 
        marginRight: '8px',
        display: 'inline-block',
        minWidth: '24px',
        textAlign: 'center',
        lineHeight: '1'
      }}>
        {logoUrl || getTypeIcon(type)}
      </span>
    );
  }
  
  // For actual image URLs, use img with emoji fallback
  return (
    <>
      <img 
        src={logoUrl}
        alt={name}
        style={{
          width: '24px',
          height: '24px',
          borderRadius: '4px',
          marginRight: '8px',
          objectFit: 'contain',
          backgroundColor: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.1)'
        }}
        onError={(e) => {
          // Replace with emoji fallback on error
          const container = e.target.parentNode;
          const fallbackSpan = document.createElement('span');
          fallbackSpan.style.fontSize = '1.2rem';
          fallbackSpan.style.marginRight = '8px';
          fallbackSpan.style.display = 'inline-block';
          fallbackSpan.style.minWidth = '24px';
          fallbackSpan.style.textAlign = 'center';
          fallbackSpan.style.lineHeight = '1';
          fallbackSpan.textContent = getTypeIcon(type);
          container.replaceChild(fallbackSpan, e.target);
        }}
      />
    </>
  );
};

const MarketTicker = () => {
  // Subscribe to products to get underlyings
  const sessionId = localStorage.getItem('sessionId');
  const productsLoading = useSubscribe('products', sessionId);
  const products = useFind(() => ProductsCollection.find());
  
  // Combine base securities with product underlyings - MEMOIZED to prevent infinite re-renders
  const productUnderlyings = useMemo(() => {
    return extractUnderlyingsFromProducts(products);
  }, [products]);

  // State to track validated product underlyings
  const [validatedProductUnderlyings, setValidatedProductUnderlyings] = useState([]);
  const [validationComplete, setValidationComplete] = useState(false);

  // Validate product underlyings with EOD API when they change
  useEffect(() => {
    if (productUnderlyings.length === 0) {
      setValidatedProductUnderlyings([]);
      setValidationComplete(true);
      return;
    }

    // Pre-filter to only include symbols that look like valid ticker formats
    // Valid formats: "AAPL.US", "TSLA.US", "GSPC.INDX", "BTC-USD.CC", etc.
    // Invalid: "Airbnb Inc", "Estee Lauder Companies Inc" (company names)
    const isValidTickerFormat = (symbol) => {
      if (!symbol || typeof symbol !== 'string') return false;

      // Must contain a dot (exchange suffix) OR a dash (forex/crypto)
      // Examples: AAPL.US, EUR-USD.FOREX, BTC-USD.CC
      const hasExchange = symbol.includes('.');
      const hasDash = symbol.includes('-');

      // Must not have spaces (company names have spaces)
      const hasSpaces = symbol.includes(' ');

      // Must be reasonably short (ticker symbols are typically 1-6 chars before exchange)
      const parts = symbol.split('.');
      const tickerPart = parts[0];
      const isReasonableLength = tickerPart.length <= 10;

      return (hasExchange || hasDash) && !hasSpaces && isReasonableLength;
    };

    // Filter to only valid-looking tickers before validation
    const preFilteredUnderlyings = productUnderlyings.filter(u => {
      const isValid = isValidTickerFormat(u.symbol);
      if (!isValid) {
        console.log(`[MarketTicker] Pre-filter rejected: "${u.symbol}" (looks like company name, not ticker)`);
      }
      return isValid;
    });

    if (preFilteredUnderlyings.length === 0) {
      console.log('[MarketTicker] No valid ticker symbols found after pre-filter');
      setValidatedProductUnderlyings([]);
      setValidationComplete(true);
      return;
    }

    // Reset validation status
    setValidationComplete(false);

    // Extract symbols to validate
    const symbolsToValidate = preFilteredUnderlyings.map(u => u.symbol);

    console.log(`[MarketTicker] Validating ${symbolsToValidate.length} product underlyings with EOD...`);

    // Call server validation method
    Meteor.call('tickerCache.validateTickers', symbolsToValidate, (error, result) => {
      if (error) {
        console.error('[MarketTicker] Validation error:', error);
        // On error, don't include any - better to show nothing than invalid tickers
        setValidatedProductUnderlyings([]);
        setValidationComplete(true);
        return;
      }

      if (result && result.success) {
        // Filter to only include valid tickers
        const validSymbols = new Set(result.validTickers);
        const validUnderlyings = preFilteredUnderlyings.filter(u => validSymbols.has(u.symbol));

        console.log(`[MarketTicker] Validation complete: ${validUnderlyings.length}/${preFilteredUnderlyings.length} tickers are valid`);

        if (result.invalidTickers.length > 0) {
          console.log('[MarketTicker] Invalid tickers excluded:', result.invalidTickers.map(t => `${t.symbol} (${t.reason})`));
        }

        setValidatedProductUnderlyings(validUnderlyings);
      } else {
        // On failure, don't include any
        console.warn('[MarketTicker] Validation failed, excluding all product underlyings');
        setValidatedProductUnderlyings([]);
      }

      setValidationComplete(true);
    });
  }, [productUnderlyings]);

  const allSecurities = useMemo(() => {
    // Use validated product underlyings instead of raw ones
    return [...BASE_SECURITIES, ...validatedProductUnderlyings];
  }, [validatedProductUnderlyings]);
  
  // Initialize with fallback data immediately to prevent loading delays
  const initialData = useMemo(() => allSecurities.map(security => ({
    ...security,
    price: security.fallbackPrice,
    change: security.fallbackChange,
    changePercent: security.fallbackPrice > 0 
      ? (security.fallbackChange / security.fallbackPrice) * 100 
      : 0,
    error: false,
    loading: false,
    fallback: true
  })), [allSecurities]);

  const [marketData, setMarketData] = useState(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdateTime, setLastUpdateTime] = useState(null);

  const fetchMarketData = useCallback(async (forceRefresh = false, securitiesToFetch = null) => {
    const securities = securitiesToFetch || allSecurities;
    // Check if we have cached data that's still fresh (less than 15 minutes old)
    const now = new Date();
    const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60 * 1000);
    
    if (!forceRefresh && lastUpdateTime && lastUpdateTime > fifteenMinutesAgo) {
      return;
    }
    
    // console.log('MarketTicker: Fetching fresh market data via server cache');
    
    try {
      // Get symbols to fetch
      const symbols = securities.map(security => security.symbol);
      
      // Use the server-side cache method
      Meteor.call('tickerCache.getPrices', symbols, (error, result) => {
        
        if (error) {
          console.error('MarketTicker: Error fetching cached prices:', error);
          // Keep placeholders; do not inject static fallback prices
          setMarketData(securities.map(security => ({
            ...security,
            price: null,
            change: null,
            changePercent: null,
            error: true,
            loading: false,
            fallback: false
          })));
          return;
        }

        if (result && result.success) {
            
          // Update market data with cached/fetched prices
          const updatedData = securities.map(security => {
            const priceData = result.prices[security.symbol];
            
            if (priceData) {
              return {
                ...security,
                price: priceData.price ?? null,
                change: priceData.change ?? null,
                changePercent: priceData.changePercent ?? null,
                error: false,
                loading: false,
                fallback: false,
                source: priceData.source || 'eod'
              };
            } else {
              // No data available; keep placeholders
              return {
                ...security,
                price: null,
                change: null,
                changePercent: null,
                error: true,
                loading: false,
                fallback: false
              };
            }
          });
          
          setMarketData(updatedData);
        } else {
          console.error('MarketTicker: Server cache method failed:', result?.error || 'No result returned');
          // Fall back to using fallback data
          setMarketData(securities.map(security => ({
            ...security,
            price: security.fallbackPrice,
            change: security.fallbackChange,
            changePercent: security.fallbackPrice > 0 
              ? (security.fallbackChange / security.fallbackPrice) * 100 
              : 0,
            error: false,
            loading: false,
            fallback: true
          })));
        }
      });

    } catch (err) {
      console.error('MarketTicker: Error in fetchMarketData:', err);
      // Fall back to using fallback data
      setMarketData(securities.map(security => ({
        ...security,
        price: null,
        change: null,
        changePercent: null,
        error: true,
        loading: false,
        fallback: false
      })));
    }

    setLastUpdateTime(new Date());
    setError(null);
  }, []); // Remove allSecurities dependency since it's passed as parameter

  // Update market data when securities list changes
  useEffect(() => {
    if (allSecurities.length > 0) {
      setMarketData(allSecurities.map(security => ({
        ...security,
        price: null,
        change: null,
        changePercent: null,
        error: false,
        loading: true,
        fallback: false
      })));
    }
  }, [allSecurities]);

  // Track if initial fetch has been done
  const [initialFetchDone, setInitialFetchDone] = useState(false);

  // Defer ticker price fetching until after main content is loaded (3 seconds delay)
  useEffect(() => {
    if (initialFetchDone) {
      return;
    }

    setInitialFetchDone(true);

    // Delay initial fetch to avoid blocking page load
    const deferredBaseFetch = setTimeout(() => {
      fetchMarketData(true, BASE_SECURITIES);
    }, 3000); // 3 second delay to let main content load first

    return () => {
      clearTimeout(deferredBaseFetch);
    };
  }, []); // Run once on mount

  // Fetch complete list when products are loaded (also deferred)
  useEffect(() => {
    // Skip if no securities to fetch
    if (allSecurities.length === 0) {
      return;
    }

    // Fetch all securities (base + products) - deferred to avoid blocking
    const productsFetch = setTimeout(() => {
      fetchMarketData(true, allSecurities);
    }, 4000); // 4 second delay (after base fetch)

    // Set up periodic updates - every 15 minutes
    const interval = setInterval(() => {
      fetchMarketData(true, allSecurities);
    }, 15 * 60 * 1000);

    return () => {
      clearTimeout(productsFetch);
      clearInterval(interval);
    };
  }, [allSecurities.length]); // Only depend on allSecurities.length to avoid resets


  const formatPrice = (price, type, loading, currency) => {
    if (loading) return '...';
    if (price === null || price === 0 || isNaN(price)) return '--';
    
    let formattedPrice;
    if (type === 'currency') {
      formattedPrice = price.toFixed(3);
    } else {
      formattedPrice = price.toFixed(2);
    }
    
    // Add space separators for thousands
    return formattedPrice.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  };

  const formatPriceWithCurrency = (price, type, loading, currency, fallback = false) => {
    // Don't show fallback prices as they can be misleading
    if (fallback) return '--';
    const formattedPrice = formatPrice(price, type, loading, currency);
    if (formattedPrice === '...' || formattedPrice === '--') return formattedPrice;
    const currencySymbol = getCurrencySymbol(currency || 'USD');
    return `${currencySymbol}${formattedPrice}`;
  };

  const formatChange = (change, loading) => {
    if (loading) return '';
    if (change === null || change === 0 || isNaN(change)) return '--';
    
    const formattedChange = change.toFixed(2);
    const withSpaces = formattedChange.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return change >= 0 ? `+${withSpaces}` : withSpaces;
  };

  const formatChangePercent = (changePercent, loading) => {
    if (loading) return '';
    if (changePercent === null || isNaN(changePercent)) return '--';
    return changePercent >= 0 ? `+${changePercent.toFixed(2)}%` : `${changePercent.toFixed(2)}%`;
  };

  // Never show loading state - always show the ticker

  // Debug current data
  // console.log('MarketTicker: Current marketData sample:', marketData.slice(0, 2).map(item => ({
  //   symbol: item.symbol,
  //   name: item.name,
  //   price: item.price,
  //   change: item.change,
  //   changePercent: item.changePercent,
  //   fallback: item.fallback,
  //   source: item.source
  // })));

  return (
    <>
      <style>{`
        @keyframes ticker-scroll {
          0% { 
            transform: translateX(100vw); 
          }
          100% { 
            transform: translateX(-100%); 
          }
        }
        
        .ticker-container {
          overflow: hidden;
          width: 100%;
          position: relative;
          height: 50px;
        }
        
        .ticker-content {
          display: flex;
          animation: ticker-scroll 180s linear infinite;
          white-space: nowrap;
          width: max-content;
          will-change: transform;
          position: absolute;
          height: 100%;
          align-items: center;
        }
        
        .ticker-container:hover .ticker-content {
          animation-play-state: paused;
        }
        
        .ticker-item {
          display: inline-flex;
          align-items: center;
          margin-right: 2rem;
          padding: 0 1rem;
          white-space: nowrap;
          flex-shrink: 0;
          min-width: max-content;
          height: 100%;
        }
      `}</style>
      
      <div 
        className="ticker-container"
        style={{
          height: '50px',
          background: 'linear-gradient(90deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          borderBottom: '1px solid var(--border-color)',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          alignItems: 'center'
        }}
      >
        <div className="ticker-content">
            {(marketData.length > 0 ? marketData : BASE_SECURITIES).map((item, index) => (
              <div key={`${item.symbol}-${index}`} className="ticker-item">
                <TickerLogo symbol={item.symbol} name={item.name} type={item.type} />
                <span style={{ 
                  fontWeight: '600', 
                  color: 'var(--text-primary)',
                  marginRight: '8px',
                  fontSize: '0.875rem'
                }}>
                  {item.name}
                </span>
                <span style={{ 
                  color: 'var(--text-primary)',
                  marginRight: '8px',
                  fontSize: '0.875rem',
                  fontFamily: 'monospace'
                }}>
                  {formatPriceWithCurrency(item.price, item.type, item.loading, item.currency, item.fallback)}
                </span>
                <span style={{ 
                  color: item.changePercent >= 0 ? 'var(--positive-color)' : '#FF9800',
                  fontSize: '0.8rem',
                  fontWeight: '500'
                }}>
                  {item.loading ? '' : `(${formatChangePercent(item.changePercent, item.loading)})`}
                </span>
                {item.error && (
                  <span style={{ 
                    color: 'var(--text-muted)',
                    marginLeft: '4px',
                    fontSize: '0.7rem'
                  }}>
                    ⚠️
                  </span>
                )}
                {item.fallback && (
                  <span style={{ 
                    color: 'var(--text-muted)',
                    marginLeft: '4px',
                    fontSize: '0.7rem',
                    title: 'Using fallback data'
                  }}>
                    📊
                  </span>
                )}
                {item.source === 'binance' && (
                  <span style={{ 
                    color: 'var(--positive-color)',
                    marginLeft: '4px',
                    fontSize: '0.7rem',
                    title: 'Live from Binance'
                  }}>
                    🔄
                  </span>
                )}
                {item.source === 'coingecko' && (
                  <span style={{ 
                    color: 'var(--positive-color)',
                    marginLeft: '4px',
                    fontSize: '0.7rem',
                    title: 'Live from CoinGecko'
                  }}>
                    🦎
                  </span>
                )}
              </div>
            ))}
            
            {/* Duplicate the content for seamless loop */}
            {(marketData.length > 0 ? marketData : BASE_SECURITIES).map((item, index) => (
              <div key={`${item.symbol}-duplicate-${index}`} className="ticker-item">
                <TickerLogo symbol={item.symbol} name={item.name} type={item.type} />
                <span style={{ 
                  fontWeight: '600', 
                  color: 'var(--text-primary)',
                  marginRight: '8px',
                  fontSize: '0.875rem'
                }}>
                  {item.name}
                </span>
                <span style={{ 
                  color: 'var(--text-primary)',
                  marginRight: '8px',
                  fontSize: '0.875rem',
                  fontFamily: 'monospace'
                }}>
                  {formatPriceWithCurrency(item.price, item.type, item.loading, item.currency, item.fallback)}
                </span>
                <span style={{ 
                  color: item.changePercent >= 0 ? 'var(--positive-color)' : '#FF9800',
                  fontSize: '0.8rem',
                  fontWeight: '500'
                }}>
                  {item.loading ? '' : `(${formatChangePercent(item.changePercent, item.loading)})`}
                </span>
                {item.error && (
                  <span style={{ 
                    color: 'var(--text-muted)',
                    marginLeft: '4px',
                    fontSize: '0.7rem'
                  }}>
                    ⚠️
                  </span>
                )}
                {item.fallback && (
                  <span style={{ 
                    color: 'var(--text-muted)',
                    marginLeft: '4px',
                    fontSize: '0.7rem',
                    title: 'Using fallback data'
                  }}>
                    📊
                  </span>
                )}
                {item.source === 'binance' && (
                  <span style={{ 
                    color: 'var(--positive-color)',
                    marginLeft: '4px',
                    fontSize: '0.7rem',
                    title: 'Live from Binance'
                  }}>
                    🔄
                  </span>
                )}
                {item.source === 'coingecko' && (
                  <span style={{ 
                    color: 'var(--positive-color)',
                    marginLeft: '4px',
                    fontSize: '0.7rem',
                    title: 'Live from CoinGecko'
                  }}>
                    🦎
                  </span>
                )}
              </div>
            ))}
        </div>
        
        {/* Gradient fade effects */}
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '50px',
          height: '100%',
          background: 'linear-gradient(90deg, var(--bg-secondary) 0%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 1
        }} />
        <div style={{
          position: 'absolute',
          right: 0,
          top: 0,
          width: '50px',
          height: '100%',
          background: 'linear-gradient(270deg, var(--bg-secondary) 0%, transparent 100%)',
          pointerEvents: 'none',
          zIndex: 1
        }} />
        
        {/* Last update indicator */}
        {lastUpdateTime && (
          <div style={{
            position: 'absolute',
            right: '60px',
            top: '50%',
            transform: 'translateY(-50%)',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            background: 'var(--bg-secondary)',
            padding: '2px 6px',
            borderRadius: '3px',
            zIndex: 2
          }}>
            Updated {new Date().getTime() - lastUpdateTime.getTime() < 60000 
              ? 'just now' 
              : `${Math.floor((new Date().getTime() - lastUpdateTime.getTime()) / 60000)}m ago`}
          </div>
        )}
      </div>
    </>
  );
};

export default memo(MarketTicker);