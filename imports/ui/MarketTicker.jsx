import React, { useMemo, memo } from 'react';
import { useFind, useSubscribe } from 'meteor/react-meteor-data';
import { TickerPriceCacheCollection } from '/imports/api/tickerCache';
import { getCurrencyFromTicker } from '/imports/utils/tickerUtils';
import { getStockLogoUrl } from '/imports/utils/stockLogoUtils';

// Base security metadata for display purposes (name, type)
// Actual prices come from database via subscription
const SECURITY_METADATA = {
  'GSPC.INDX': { name: 'S&P 500', type: 'index' },
  'IXIC.INDX': { name: 'Nasdaq', type: 'index' },
  'EURUSD.FOREX': { name: 'EUR/USD', type: 'currency' },
  'N225.INDX': { name: 'Nikkei 225', type: 'index' },
  'STOXX50E.INDX': { name: 'Eurostoxx 50', type: 'index' },
  'FCHI.INDX': { name: 'CAC 40', type: 'index' },
  'GDAXI.INDX': { name: 'DAX', type: 'index' },
  'AAPL.US': { name: 'Apple', type: 'stock' },
  'BTC-USD.CC': { name: 'Bitcoin', type: 'crypto' },
  'TSLA.US': { name: 'Tesla', type: 'stock' }
};

// Get metadata for a ticker symbol (name, type)
const getTickerMetadata = (symbol) => {
  // Check if we have predefined metadata
  if (SECURITY_METADATA[symbol]) {
    return SECURITY_METADATA[symbol];
  }

  // Default for unknown tickers
  return {
    name: symbol.split('.')[0], // Use base symbol as name
    type: 'stock'
  };
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

// Function to get logo URL with multiple fallback strategies
const getLogoUrl = (symbol, name, type) => {
  // Strategy 1: For stocks, use Logo.dev (more reliable and has better international coverage)
  if (type === 'stock' || type === 'etf') {
    // Extract just the ticker symbol (before the exchange suffix)
    const cleanSymbol = symbol.split('.')[0];
    return getStockLogoUrl(cleanSymbol);
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
  // Subscribe to ticker prices from database (updated by cron job)
  const tickerPricesLoading = useSubscribe('tickerPrices');

  // Get all ticker prices from database
  const tickerPricesFromDB = useFind(() =>
    TickerPriceCacheCollection.find({}, { sort: { symbol: 1 } })
  );

  // Transform database ticker prices into display format
  const marketData = useMemo(() => {
    if (!tickerPricesFromDB || tickerPricesFromDB.length === 0) {
      // Return empty if no data yet
      return [];
    }

    return tickerPricesFromDB.map(ticker => {
      const metadata = getTickerMetadata(ticker.symbol);
      const currency = getCurrencyFromTicker(ticker.symbol);

      return {
        symbol: ticker.symbol,
        name: metadata.name,
        type: metadata.type,
        currency: currency,
        price: ticker.price || null,
        change: ticker.change || null,
        changePercent: ticker.changePercent || null,
        previousClose: ticker.previousClose || null,
        source: ticker.source || 'eod',
        timestamp: ticker.timestamp,
        loading: false,
        error: false,
        fallback: false
      };
    });
  }, [tickerPricesFromDB]);

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
          margin-right: 2.5rem;
          padding: 0 1rem;
          white-space: nowrap;
          flex-shrink: 0;
          min-width: max-content;
          height: 100%;
          gap: 0;
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
            {marketData.length > 0 && marketData.map((item, index) => (
              <div key={`${item.symbol}-${index}`} className="ticker-item">
                <TickerLogo symbol={item.symbol} name={item.name} type={item.type} />
                <div style={{ display: 'flex', flexDirection: 'column', marginRight: '12px' }}>
                  <span style={{
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    lineHeight: '1.2'
                  }}>
                    {item.name}
                  </span>
                  <span style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace',
                    lineHeight: '1.2'
                  }}>
                    {item.symbol}
                  </span>
                </div>
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
            {marketData.length > 0 && marketData.map((item, index) => (
              <div key={`${item.symbol}-duplicate-${index}`} className="ticker-item">
                <TickerLogo symbol={item.symbol} name={item.name} type={item.type} />
                <div style={{ display: 'flex', flexDirection: 'column', marginRight: '12px' }}>
                  <span style={{
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    fontSize: '0.875rem',
                    lineHeight: '1.2'
                  }}>
                    {item.name}
                  </span>
                  <span style={{
                    fontSize: '0.7rem',
                    color: 'var(--text-secondary)',
                    fontFamily: 'monospace',
                    lineHeight: '1.2'
                  }}>
                    {item.symbol}
                  </span>
                </div>
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
      </div>
    </>
  );
};

export default memo(MarketTicker);
