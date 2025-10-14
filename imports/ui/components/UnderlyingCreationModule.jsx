import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import SecurityAutocomplete from '../SecurityAutocomplete.jsx';
import { getSecurityCountryFlag } from '/imports/utils/securityUtils.js';
import { StockLogo, StockLogoFallback } from '/imports/utils/stockLogoUtils.js';

// Underlying Creation Module Component
const UnderlyingCreationModule = ({ underlyings, setUnderlyings, basketMode, onBasketModeChange, productDetails, basketPerformanceType, setBasketPerformanceType, editingProduct, selectedTemplateId }) => {
  const [newUnderlying, setNewUnderlying] = useState({ isin: '', ticker: '', name: '', strike: 0, securityData: null });
  const [isAddingUnderlying, setIsAddingUnderlying] = useState(false);

  const addUnderlying = () => {
    if (newUnderlying.securityData || newUnderlying.isin || newUnderlying.ticker) {
      const underlying = {
        id: Date.now(),
        ...newUnderlying,
        isin: newUnderlying.isin.toUpperCase(),
        ticker: newUnderlying.ticker.toUpperCase(),
        strike: parseFloat(newUnderlying.strike) || 0
      };
      setUnderlyings(prev => {
        const newUnderlyings = [...prev, underlying];
        return newUnderlyings;
      });
      setNewUnderlying({ isin: '', ticker: '', name: '', strike: 0, securityData: null });
    }
  };

  const removeUnderlying = (id) => {
    setUnderlyings(prev => prev.filter(u => u.id !== id));
  };

  const updateUnderlying = (id, field, value) => {
    setUnderlyings(prev => 
      prev.map(u => u.id === id ? { ...u, [field]: value } : u)
    );
  };



  return (
    <div className="underlying-creation-module">
      <h3 className="card-title">Underlying Asset Definition</h3>
      
      <div className="underlying-inputs">
        <div className="basket-underlyings">
          <div className="basket-header">
            <div className="basket-summary">
              <div className="summary-item">
                <span>Count: </span>
                <span className="summary-value">{underlyings.length}</span>
              </div>
            </div>
          </div>

          {/* Basket Performance Type Dropdown - Only show when there are multiple underlyings and not ORION or Himalaya */}
          {underlyings.length > 1 && selectedTemplateId !== 'orion_memory' && selectedTemplateId !== 'himalaya' && (
            <div className="basket-performance-section" style={{
              backgroundColor: 'var(--bg-tertiary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              padding: '16px',
              marginBottom: '16px'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                marginBottom: '8px'
              }}>
                <span style={{
                  fontSize: '0.9rem',
                  fontWeight: '600',
                  color: 'var(--text-primary)'
                }}>
                  🎯 Basket Performance Type:
                </span>
                <select
                  value={basketPerformanceType}
                  onChange={(e) => setBasketPerformanceType && setBasketPerformanceType(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    backgroundColor: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    fontSize: '0.9rem',
                    cursor: 'pointer'
                  }}
                >
                  <option value="worst-of">Worst Of</option>
                  <option value="best-of">Best Of</option>
                  <option value="average">Average</option>
                </select>
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-muted)',
                fontStyle: 'italic'
              }}>
                {basketPerformanceType === 'worst-of' && 'Product performance based on the worst-performing underlying asset'}
                {basketPerformanceType === 'best-of' && 'Product performance based on the best-performing underlying asset'}
                {basketPerformanceType === 'average' && 'Product performance based on the weighted average of all underlying assets'}
              </div>
            </div>
          )}

          {/* Inline Add Security Section */}
          <div className="add-security-section">
            <div className="add-security-header">
              <h4>🔍 Add New Underlying</h4>
              <span className="add-security-subtitle">Search by name, symbol, or ISIN</span>
            </div>
            
            <div className="add-security-form">
              <div className="security-search-row">
                <div className="search-field">
                  <SecurityAutocomplete
                    value={newUnderlying.ticker}
                    onChange={(value) => setNewUnderlying(prev => ({ ...prev, ticker: value }))}
                    placeholder="e.g., AAPL, Apple Inc., SPX, US0378331005..."
                    onSecuritySelect={async (security) => {
                      
                      // STEP 2: Create the underlying immediately (dropdown should close automatically)
                      const underlying = {
                        id: Date.now(),
                        ticker: (security.symbol || security.Code).toUpperCase(),
                        name: security.name || security.Name,
                        isin: security.ISIN || '',
                        securityData: {
                          symbol: security.symbol || security.Code,
                          name: security.name || security.Name,
                          exchange: security.exchange || security.Exchange,
                          currency: security.currency || security.Currency,
                          country: security.country || security.Country,
                          ticker: security.ticker,
                          price: null,
                          tradeDatePrice: null
                        }
                      };

                      // Add to basket right away
                      setUnderlyings(prev => [...prev, underlying]);

                      // Clear the search input
                      setNewUnderlying({ isin: '', ticker: '', name: '', strike: 0, securityData: null });

                      // STEP 3: Now make API calls in parallel to get prices
                      
                      const symbol = security.Code || security.symbol;
                      const exchange = security.Exchange || security.exchange;
                      
                      // API Call 1: Get trade date price
                      let tradeDatePrice = 0;
                      if (productDetails?.tradeDate) {
                        try {
                          const tradeDate = new Date(productDetails?.tradeDate);
                          
                          // Try local database first
                          const tickerWithUS = symbol.includes('.') ? symbol : `${symbol}.US`;
                          const localPrice = await Meteor.callAsync('underlyingPrices.getPrice', tickerWithUS, tradeDate, 'close');
                          
                          if (localPrice && localPrice > 0) {
                            tradeDatePrice = localPrice;
                          } else {
                            // Try EOD API
                            const eodData = await Meteor.callAsync('eod.getEndOfDayPrice', symbol, exchange, productDetails?.tradeDate);
                            if (eodData) {
                              tradeDatePrice = eodData.close || eodData.adjusted_close || eodData.price || 0;
                            }
                          }
                        } catch (error) {
                        }
                      } else {
                      }

                      // API Call 2: Get real-time/last price
                      let lastPrice = 0;
                      try {
                        const priceData = await Meteor.callAsync('eod.getRealTimePrice', symbol, exchange);
                        if (priceData) {
                          if (typeof priceData === 'number') {
                            lastPrice = priceData;
                          } else {
                            lastPrice = priceData.close || priceData.price || priceData.last || 0;
                          }
                        }
                      } catch (error) {
                      }

                      // STEP 4: Update the underlying with the fetched prices

                      // Update the underlying in the state
                      setUnderlyings(prev => {
                        return prev.map(u => {
                          if (u.id === underlying.id) {
                            const updatedUnderlying = {
                              ...u,
                              strike: tradeDatePrice > 0 ? tradeDatePrice : (lastPrice > 0 ? lastPrice : u.strike),
                              securityData: {
                                ...u.securityData,
                                price: lastPrice > 0 ? { close: lastPrice, price: lastPrice } : null,
                                tradeDatePrice: tradeDatePrice > 0 ? { close: tradeDatePrice, price: tradeDatePrice } : null
                              }
                            };
                            return updatedUnderlying;
                          }
                          return u;
                        });
                      });

                    }}
                  />
                </div>
              </div>
            </div>
          </div>
          
          {underlyings.length > 0 ? (
            <div className="underlying-table-container">
              <div className="underlying-table-header">
                <div className="header-security">Underlying</div>
                <div className="header-strike">Initial Price</div>
                <div className="header-actions">Actions</div>
              </div>
              <div className="underlying-table-body">
                {underlyings.map((underlying) => (
                  <div key={underlying.id} className="underlying-table-row">
                    <div className="underlying-security-cell">
                      {underlying.securityData ? (
                        <div className="security-info-table">
                          <div className="security-main-info">
                            <span className="security-symbol">{underlying.securityData.symbol}</span>
                            <span className="security-exchange">
                              ({underlying.securityData.exchange}) {getSecurityCountryFlag(underlying.securityData.country, underlying.securityData.exchange, underlying.isin)}
                            </span>
                            <span className="security-currency">{underlying.securityData.currency}</span>
                            {underlying.securityData.price && (
                              <span className="security-last-price">
                                Last: ${(underlying.securityData.price.close || underlying.securityData.price.price || underlying.securityData.price)?.toFixed(2)}
                              </span>
                            )}
                          </div>
                          <div className="security-name" style={{ display: 'flex', alignItems: 'center' }}>
                            <StockLogo 
                              symbol={underlying.securityData.symbol} 
                              companyName={underlying.securityData.name}
                            />
                            <StockLogoFallback 
                              symbol={underlying.securityData.symbol}
                            />
                            {underlying.securityData.name}
                          </div>
                        </div>
                      ) : (
                        <div className="manual-security-inputs">
                          <input
                            type="text"
                            value={underlying.ticker}
                            onChange={(e) => updateUnderlying(underlying.id, 'ticker', e.target.value.toUpperCase())}
                            placeholder="Ticker Symbol"
                            className="ticker-input-table"
                          />
                          <input
                            type="text"
                            value={underlying.isin}
                            onChange={(e) => updateUnderlying(underlying.id, 'isin', e.target.value.toUpperCase())}
                            placeholder="ISIN Code"
                            className="isin-input-table"
                          />
                        </div>
                      )}
                    </div>
                    <div className="underlying-strike-cell">
                      {editingProduct ? (
                        // Editable input field for edit mode - ALWAYS show both strike and last price
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                          {/* Editable Strike Input */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <input
                              type="number"
                              step="0.01"
                              value={underlying.strike || 0}
                              onChange={(e) => updateUnderlying(underlying.id, 'strike', parseFloat(e.target.value) || 0)}
                              style={{
                                padding: '6px 8px',
                                border: '1px solid var(--border-color)',
                                borderRadius: '4px',
                                backgroundColor: 'var(--bg-primary)',
                                color: 'var(--text-primary)',
                                fontSize: '0.9rem',
                                width: '100px',
                                textAlign: 'right',
                                fontWeight: 'bold'
                              }}
                              placeholder="0.00"
                            />
                            <div style={{
                              fontSize: '0.7rem',
                              color: 'var(--accent-color)',
                              textAlign: 'center',
                              fontWeight: '600'
                            }}>
                              Strike (Editable)
                            </div>
                          </div>

                          {/* Show Last Price for Reference (Read-only) - ONLY if different from strike */}
                          {underlying.securityData?.price?.price &&
                           underlying.securityData.price.price !== underlying.strike &&
                           underlying.securityData.price.price > 0 && (
                            <div style={{
                              padding: '6px 8px',
                              border: '1px dashed var(--border-color)',
                              borderRadius: '4px',
                              backgroundColor: 'var(--bg-tertiary)',
                              color: 'var(--text-secondary)',
                              fontSize: '0.85rem',
                              width: '100px',
                              textAlign: 'right'
                            }}>
                              <div>{underlying.securityData.price.price.toFixed(2)}</div>
                              <div style={{
                                fontSize: '0.65rem',
                                color: 'var(--text-muted)',
                                marginTop: '2px'
                              }}>
                                Last Price
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        // Editable field for create mode - ALWAYS allow manual entry
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <input
                            type="number"
                            step="0.01"
                            value={underlying.strike || underlying.securityData?.tradeDatePrice?.price || underlying.securityData?.price?.price || 0}
                            onChange={(e) => updateUnderlying(underlying.id, 'strike', parseFloat(e.target.value) || 0)}
                            style={{
                              padding: '6px 8px',
                              border: '1px solid var(--border-color)',
                              borderRadius: '4px',
                              backgroundColor: 'var(--bg-primary)',
                              color: 'var(--text-primary)',
                              fontSize: '0.9rem',
                              width: '100px',
                              textAlign: 'right',
                              fontWeight: underlying.securityData?.tradeDatePrice?.price ? 'bold' : 'normal'
                            }}
                            placeholder="0.00"
                          />
                          <div style={{
                            fontSize: '0.7rem',
                            color: underlying.securityData?.tradeDatePrice?.price ? 'var(--accent-color)' : 'var(--text-muted)',
                            marginTop: '2px',
                            textAlign: 'center'
                          }}>
                            {productDetails?.tradeDate && underlying.securityData?.tradeDatePrice?.price ?
                              `${new Date(productDetails?.tradeDate).toLocaleDateString()}` :
                              'Manual entry'
                            }
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="underlying-actions-cell">
                      <button 
                        className="remove-underlying-btn-table"
                        onClick={() => removeUnderlying(underlying.id)}
                        title="Remove underlying"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="empty-basket">
              <p>No underlying assets added yet</p>
            </div>
          )}
          
        </div>
      </div>

    </div>
  );
};

export default UnderlyingCreationModule;