import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import SecurityAutocomplete from '../../../SecurityAutocomplete.jsx';
import { getSecurityCountryFlag } from '/imports/utils/securityUtils.js';
import { StockLogo, StockLogoFallback } from '/imports/utils/stockLogoUtils.js';

const SingleUnderlyingModule = ({ underlyings, setUnderlyings, productDetails }) => {
  const [newUnderlying, setNewUnderlying] = useState({ 
    isin: '', 
    ticker: '', 
    name: '', 
    strike: 0, 
    securityData: null,
    tradeDatePrice: null,
    lastPrice: null,
    isLoadingPrices: false
  });

  // Add single underlying (replaces existing one)
  const addSingleUnderlying = async (security) => {
    // Clear existing underlyings first since we only allow one in single mode
    setUnderlyings([]);
    
    const underlying = {
      id: Date.now(),
      ticker: (security.symbol || security.Code).toUpperCase(),
      name: security.name || security.Name,
      isin: security.ISIN || '',
      strike: 0, // Will be updated with price data
      securityData: {
        symbol: security.symbol || security.Code,
        name: security.name || security.Name,
        exchange: security.exchange || security.Exchange,
        currency: security.currency || security.Currency,
        country: security.country || security.Country,
        type: security.Type || 'Common Stock',
        ticker: security.ticker,
        price: null,
        tradeDatePrice: null
      },
      isLoadingPrices: true
    };

    // Set as the single underlying (replaces any existing)
    setUnderlyings([underlying]);

    // Fetch prices asynchronously
    const symbol = security.Code || security.symbol;
    const exchange = security.Exchange || security.exchange;
    
    let tradeDatePrice = null;
    let lastPrice = null;

    // Fetch trade date price (for initial reference level)
    if (productDetails.tradeDate) {
      try {
        const tradeDate = new Date(productDetails.tradeDate);
        const tickerWithUS = symbol.includes('.') ? symbol : `${symbol}.US`;
        const localPrice = await Meteor.callAsync('underlyingPrices.getPrice', tickerWithUS, tradeDate, 'close');
        
        if (localPrice && localPrice > 0) {
          tradeDatePrice = localPrice;
        } else {
          const eodData = await Meteor.callAsync('eod.getEndOfDayPrice', symbol, exchange, productDetails.tradeDate);
          if (eodData) {
            tradeDatePrice = eodData.close || eodData.adjusted_close || eodData.price || 0;
          }
        }
      } catch (error) {
        console.error('Error fetching trade date price:', error);
      }
    }

    // Fetch current/last price for verification
    try {
      const priceData = await Meteor.callAsync('eod.getRealTimePrice', symbol, exchange);
      if (priceData) {
        lastPrice = typeof priceData === 'number' ? priceData : (priceData.close || priceData.price || priceData.last || 0);
      }
    } catch (error) {
      console.error('Error fetching real-time price:', error);
    }

    // Update the underlying with price data
    setUnderlyings(prev => prev.map(u => {
      if (u.id === underlying.id) {
        return {
          ...u,
          strike: tradeDatePrice > 0 ? tradeDatePrice : (lastPrice > 0 ? lastPrice : u.strike),
          securityData: {
            ...u.securityData,
            price: lastPrice > 0 ? { close: lastPrice, price: lastPrice } : null,
            tradeDatePrice: tradeDatePrice > 0 ? { close: tradeDatePrice, price: tradeDatePrice } : null
          },
          tradeDatePrice,
          lastPrice,
          isLoadingPrices: false
        };
      }
      return u;
    }));

    // Clear form
    setNewUnderlying({ 
      isin: '', 
      ticker: '', 
      name: '', 
      strike: 0, 
      securityData: null,
      tradeDatePrice: null,
      lastPrice: null,
      isLoadingPrices: false
    });
  };

  // Remove underlying
  const removeUnderlying = (underlyingId) => {
    setUnderlyings(prev => prev.filter(u => u.id !== underlyingId));
  };

  // Update reference level (strike)
  const updateReferenceLevel = (underlyingId, newStrike) => {
    setUnderlyings(prev => prev.map(u => 
      u.id === underlyingId ? { ...u, strike: parseFloat(newStrike) || 0 } : u
    ));
  };

  // Format price for display
  const formatPrice = (price, currency = 'USD') => {
    if (!price || price === 0) return '0.00';
    return `${currency} ${typeof price === 'object' ? (price.price || price.close || 0).toFixed(2) : price.toFixed(2)}`;
  };

  return (
    <div className="single-underlying-module">
      <h3 className="card-title">📊 Single Underlying</h3>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Choose one underlying security for your product. Perfect for simple structures with a single asset.
      </p>

      {/* Add Security Section */}
      <div className="add-security-section" style={{
        padding: '1rem',
        background: 'var(--bg-tertiary)', 
        borderRadius: '8px',
        marginBottom: '1.5rem',
        border: '1px solid var(--border-color)'
      }}>
        <h4 style={{ marginBottom: '0.5rem' }}>🔍 {underlyings.length > 0 ? 'Replace' : 'Choose'} Underlying</h4>
        {underlyings.length > 0 && (
          <div style={{
            background: '#fff3cd',
            border: '1px solid #ffeaa7',
            borderRadius: '4px',
            padding: '0.5rem',
            marginBottom: '0.5rem',
            fontSize: '0.85rem',
            color: '#856404'
          }}>
            ℹ️ Selecting a new security will replace the current underlying
          </div>
        )}
        <SecurityAutocomplete
          value={newUnderlying.ticker}
          onChange={(value) => setNewUnderlying(prev => ({ ...prev, ticker: value }))}
          placeholder="Search stocks, indices (SPX, SX5E), ETFs..."
          onSecuritySelect={addSingleUnderlying}
        />
      </div>

      {/* Underlyings Table */}
      {underlyings && underlyings.length > 0 ? (
        <div className="underlyings-table">
          <div className="table-header" style={{
            display: 'grid',
            gridTemplateColumns: '2.5fr 1.2fr 1.2fr 80px',
            gap: '1rem',
            padding: '0.75rem',
            background: 'var(--bg-secondary)',
            borderRadius: '6px 6px 0 0',
            fontWeight: '600',
            fontSize: '0.9rem'
          }}>
            <div>Security</div>
            <div>Reference Level</div>
            <div>Last Price (Today)</div>
            <div>Actions</div>
          </div>
          
          {underlyings.map((underlying) => (
            <div key={underlying.id} className="table-row" style={{
              display: 'grid',
              gridTemplateColumns: '2.5fr 1.2fr 1.2fr 80px',
              gap: '1rem',
              padding: '0.75rem',
              background: 'var(--bg-primary)',
              borderBottom: '1px solid var(--border-color)',
              alignItems: 'center'
            }}>
              <div className="security-info">
                {underlying.securityData ? (
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                      <StockLogo symbol={underlying.securityData.symbol} companyName={underlying.securityData.name} />
                      <span style={{ fontWeight: '600' }}>{underlying.securityData.symbol}</span>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        ({underlying.securityData.exchange}) {getSecurityCountryFlag(underlying.securityData.country, underlying.securityData.exchange, underlying.isin)}
                      </span>
                      <span style={{ 
                        fontSize: '0.7rem', 
                        background: underlying.securityData.type === 'Index' ? '#2196F3' : '#4CAF50',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '3px'
                      }}>
                        {underlying.securityData.type || 'Stock'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      {underlying.securityData.name}
                    </div>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.9rem' }}>
                    {underlying.ticker} - {underlying.name}
                  </div>
                )}
              </div>
              
              {/* Reference Level Input */}
              <div>
                {underlying.isLoadingPrices ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    Loading...
                  </div>
                ) : (
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      value={(underlying.securityData?.tradeDatePrice?.price || underlying.strike || 0).toFixed(2)}
                      onChange={(e) => updateReferenceLevel(underlying.id, e.target.value)}
                      step="0.01"
                      style={{
                        width: '90px',
                        padding: '0.4rem',
                        border: '2px solid var(--border-color)',
                        borderRadius: '4px',
                        textAlign: 'right',
                        background: underlying.securityData?.tradeDatePrice?.price ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                        color: 'var(--text-primary)',
                        fontSize: '0.9rem',
                        fontFamily: 'monospace',
                        fontWeight: underlying.securityData?.tradeDatePrice?.price ? 'bold' : 'normal',
                        outline: 'none',
                        transition: 'border-color 0.2s ease'
                      }}
                      onFocus={(e) => {
                        e.target.style.borderColor = 'var(--accent-color)';
                        e.target.style.boxShadow = '0 0 0 2px rgba(0, 123, 255, 0.25)';
                      }}
                      onBlur={(e) => {
                        e.target.style.borderColor = 'var(--border-color)';
                        e.target.style.boxShadow = 'none';
                      }}
                    />
                    <div style={{ 
                      fontSize: '0.7rem', 
                      color: underlying.securityData?.tradeDatePrice?.price ? 'var(--accent-color)' : 'var(--text-muted)', 
                      marginTop: '2px',
                      textAlign: 'left'
                    }}>
                      {productDetails.tradeDate && underlying.securityData?.tradeDatePrice?.price ? 
                        `${new Date(productDetails.tradeDate).toLocaleDateString()}` :
                        productDetails.tradeDate ? `Trade Date: ${new Date(productDetails.tradeDate).toLocaleDateString()}` :
                        'Set trade date first'
                      }
                    </div>
                  </div>
                )}
              </div>
              
              {/* Last Price Display */}
              <div style={{ fontSize: '0.9rem', fontFamily: 'monospace' }}>
                {underlying.isLoadingPrices ? (
                  <span style={{ color: 'var(--text-secondary)' }}>Loading...</span>
                ) : underlying.lastPrice ? (
                  <div>
                    <div style={{ fontWeight: '600' }}>
                      {formatPrice(underlying.lastPrice, underlying.securityData?.currency)}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                      Last available
                    </div>
                  </div>
                ) : (
                  <span style={{ color: 'var(--text-secondary)' }}>N/A</span>
                )}
              </div>
              
              {/* Actions */}
              <div>
                <button
                  onClick={() => removeUnderlying(underlying.id)}
                  style={{
                    background: '#f44336',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    width: '24px',
                    height: '24px',
                    cursor: 'pointer',
                    fontSize: '0.8rem'
                  }}
                  title="Remove underlying"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: '2rem',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          background: 'var(--bg-secondary)',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <h4>No underlying selected yet</h4>
          <p>Search and choose one stock, index, or ETF above</p>
        </div>
      )}

      {/* Summary Info */}
      {underlyings.length > 0 && (
        <div style={{ 
          marginTop: '1rem', 
          padding: '0.75rem', 
          background: 'var(--bg-tertiary)', 
          borderRadius: '6px',
          fontSize: '0.9rem'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>1</strong> underlying selected for single-asset product</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {productDetails.tradeDate ? 
                `Reference level for ${new Date(productDetails.tradeDate).toLocaleDateString()}` :
                '⚠️ Set trade date in Setup tab'
              }
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default SingleUnderlyingModule;