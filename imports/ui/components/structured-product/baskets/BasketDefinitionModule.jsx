import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';
import SecurityAutocomplete from '../../../SecurityAutocomplete.jsx';
import { getSecurityCountryFlag } from '/imports/utils/securityUtils.js';
import { StockLogo, StockLogoFallback } from '/imports/utils/stockLogoUtils.js';
import { BASKET_TYPES, BASKET_TYPE_CONFIGS, BasketHelpers } from '/imports/utils/basketTypes.js';

const BasketDefinitionModule = ({ baskets, setBaskets, productDetails, activeBasketId, setActiveBasketId }) => {
  const [isCreatingBasket, setIsCreatingBasket] = useState(false);
  const [newBasketName, setNewBasketName] = useState('');
  const [newBasketType, setNewBasketType] = useState(BASKET_TYPES.INDIVIDUAL_SECURITIES);
  const [newUnderlying, setNewUnderlying] = useState({ isin: '', ticker: '', name: '', weight: 0, strike: 0, securityData: null });

  // Create a new basket
  const createBasket = () => {
    if (!newBasketName.trim()) return;
    
    const basket = BasketHelpers.createBasket(newBasketName, newBasketType);
    setBaskets(prev => [...prev, basket]);
    setActiveBasketId(basket.id); // Auto-select the newly created basket
    setIsCreatingBasket(false);
    setNewBasketName('');
    setNewBasketType(BASKET_TYPES.INDIVIDUAL_SECURITIES);
  };

  // Delete a basket
  const deleteBasket = (basketId) => {
    setBaskets(prev => {
      const filtered = prev.filter(b => b.id !== basketId);
      // If we're deleting the active basket, select the first remaining basket
      if (activeBasketId === basketId && filtered.length > 0) {
        setActiveBasketId(filtered[0].id);
      } else if (activeBasketId === basketId) {
        setActiveBasketId(null);
      }
      return filtered;
    });
  };

  // Get active basket
  const activeBasket = baskets.find(b => b.id === activeBasketId);

  // Add security to active basket
  const addSecurityToBasket = async (security) => {
    if (!activeBasket) return;

    const underlying = {
      id: Date.now(),
      ticker: (security.symbol || security.Code).toUpperCase(),
      name: security.name || security.Name,
      isin: security.ISIN || '',
      weight: 0,
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

    // Update the active basket
    setBaskets(prev => prev.map(basket => {
      if (basket.id === activeBasketId) {
        const newSecurities = [...basket.securities, underlying];
        
        // Auto-assign weights for weighted baskets
        if (basket.calculationMethod === 'weighted_average' || BASKET_TYPE_CONFIGS[basket.type]?.allowCustomWeights) {
          const equalWeight = 100 / newSecurities.length;
          newSecurities.forEach(sec => sec.weight = equalWeight);
        }
        
        return { ...basket, securities: newSecurities, updatedAt: new Date() };
      }
      return basket;
    }));

    // Fetch prices (similar to original logic)
    const symbol = security.Code || security.symbol;
    const exchange = security.Exchange || security.exchange;
    
    let tradeDatePrice = 0;
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

    let lastPrice = 0;
    try {
      const priceData = await Meteor.callAsync('eod.getRealTimePrice', symbol, exchange);
      if (priceData) {
        lastPrice = typeof priceData === 'number' ? priceData : (priceData.close || priceData.price || priceData.last || 0);
      }
    } catch (error) {
      console.error('Error fetching real-time price:', error);
    }

    // Update with prices
    setBaskets(prev => prev.map(basket => {
      if (basket.id === activeBasketId) {
        return {
          ...basket,
          securities: basket.securities.map(sec => {
            if (sec.id === underlying.id) {
              return {
                ...sec,
                strike: tradeDatePrice > 0 ? tradeDatePrice : (lastPrice > 0 ? lastPrice : sec.strike),
                securityData: {
                  ...sec.securityData,
                  price: lastPrice > 0 ? { close: lastPrice, price: lastPrice } : null,
                  tradeDatePrice: tradeDatePrice > 0 ? { close: tradeDatePrice, price: tradeDatePrice } : null
                }
              };
            }
            return sec;
          })
        };
      }
      return basket;
    }));

    // Clear form
    setNewUnderlying({ isin: '', ticker: '', name: '', weight: 0, strike: 0, securityData: null });
  };

  // Remove security from basket
  const removeSecurityFromBasket = (basketId, securityId) => {
    setBaskets(prev => prev.map(basket => {
      if (basket.id === basketId) {
        const newSecurities = basket.securities.filter(s => s.id !== securityId);
        
        // Rebalance weights if needed
        if ((basket.calculationMethod === 'weighted_average' || BASKET_TYPE_CONFIGS[basket.type]?.allowCustomWeights) && newSecurities.length > 0) {
          const equalWeight = 100 / newSecurities.length;
          newSecurities.forEach(sec => sec.weight = equalWeight);
        }
        
        return { ...basket, securities: newSecurities, updatedAt: new Date() };
      }
      return basket;
    }));
  };

  // Update security weight
  const updateSecurityWeight = (basketId, securityId, weight) => {
    setBaskets(prev => prev.map(basket => {
      if (basket.id === basketId) {
        return {
          ...basket,
          securities: basket.securities.map(sec => 
            sec.id === securityId ? { ...sec, weight: parseFloat(weight) || 0 } : sec
          ),
          updatedAt: new Date()
        };
      }
      return basket;
    }));
  };

  // Update security strike price (reference level)
  const updateSecurityStrike = (basketId, securityId, strike) => {
    setBaskets(prev => prev.map(basket => {
      if (basket.id === basketId) {
        return {
          ...basket,
          securities: basket.securities.map(sec => 
            sec.id === securityId ? { ...sec, strike: parseFloat(strike) || 0 } : sec
          ),
          updatedAt: new Date()
        };
      }
      return basket;
    }));
  };

  // Update basket type (calculation method)
  const updateBasketType = (basketId, newType) => {
    setBaskets(prev => prev.map(basket => {
      if (basket.id === basketId) {
        const config = BasketHelpers.getBasketConfig(newType);
        return {
          ...basket,
          type: newType,
          calculationMethod: config.defaultCalculation,
          updatedAt: new Date()
        };
      }
      return basket;
    }));
  };

  // Get total weight for a basket
  const getTotalWeight = (basket) => {
    return basket?.securities?.reduce((sum, s) => sum + (s.weight || 0), 0) || 0;
  };

  return (
    <div className="basket-definition-module">
      <h3 className="card-title">🗂️ Basket Definitions</h3>
      
      {/* Basket Tabs */}
      <div className="basket-tabs" style={{
        display: 'flex',
        gap: '0.5rem',
        marginBottom: '1rem',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        {baskets.map(basket => {
          const config = BasketHelpers.getBasketConfig(basket.type);
          return (
            <button
              key={basket.id}
              onClick={() => setActiveBasketId(basket.id)}
              className={`basket-tab ${activeBasketId === basket.id ? 'active' : ''}`}
              style={{
                padding: '0.5rem 1rem',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                background: activeBasketId === basket.id ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: activeBasketId === basket.id ? 'white' : 'var(--text-primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.9rem'
              }}
            >
              <span>{config.icon}</span>
              <span>{basket.name}</span>
              <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>
                ({basket.securities?.length || 0})
              </span>
              {baskets.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteBasket(basket.id);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'inherit',
                    cursor: 'pointer',
                    marginLeft: '0.25rem',
                    fontSize: '0.8rem'
                  }}
                >
                  ×
                </button>
              )}
            </button>
          );
        })}
        
        {/* Add New Basket Button */}
        <button
          onClick={() => setIsCreatingBasket(true)}
          style={{
            padding: '0.5rem 1rem',
            border: '2px dashed var(--border-color)',
            borderRadius: '6px',
            background: 'transparent',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontSize: '0.9rem'
          }}
        >
          <span>+</span>
          <span>Add Basket</span>
        </button>
      </div>

      {/* Create New Basket Modal */}
      {isCreatingBasket && (
        <div style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '1rem',
          marginBottom: '1rem'
        }}>
          <h4 style={{ marginBottom: '1rem' }}>Create New Basket</h4>
          
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '500' }}>
                Basket Name
              </label>
              <input
                type="text"
                value={newBasketName}
                onChange={(e) => setNewBasketName(e.target.value)}
                placeholder="e.g., Long Equity Basket"
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>
            
            <div>
              <label style={{ display: 'block', marginBottom: '0.5rem', fontSize: '0.9rem', fontWeight: '500' }}>
                Basket Type
              </label>
              <select
                value={newBasketType}
                onChange={(e) => setNewBasketType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
              >
                {Object.entries(BASKET_TYPE_CONFIGS).map(([type, config]) => (
                  <option key={type} value={type}>
                    {config.label}
                  </option>
                ))}
              </select>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'end', gap: '0.5rem' }}>
              <button
                onClick={createBasket}
                disabled={!newBasketName.trim()}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  opacity: !newBasketName.trim() ? 0.5 : 1
                }}
              >
                Create
              </button>
              <button
                onClick={() => setIsCreatingBasket(false)}
                style={{
                  padding: '0.5rem 1rem',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
            </div>
          </div>
          
          {newBasketType && (
            <div style={{
              padding: '0.75rem',
              background: 'var(--bg-primary)',
              borderRadius: '4px',
              fontSize: '0.85rem',
              color: 'var(--text-secondary)'
            }}>
              <strong>{BASKET_TYPE_CONFIGS[newBasketType].label}:</strong> {BASKET_TYPE_CONFIGS[newBasketType].description}
            </div>
          )}
        </div>
      )}

      {/* Active Basket Content */}
      {activeBasket ? (
        <div className="active-basket-content">
          <div className="basket-header" style={{
            padding: '1rem',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            marginBottom: '1rem',
            border: '1px solid var(--border-color)'
          }}>
            {/* Basket Header with Name and Securities Count */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
              <div style={{ flex: 1 }}>
                <h4 style={{ margin: '0 0 0.5rem 0', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.2rem' }}>{BasketHelpers.getBasketConfig(activeBasket.type).icon}</span>
                  <span>{activeBasket.name}</span>
                </h4>
                
                {/* Calculation Method Selector */}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.5rem',
                  marginTop: '0.5rem'
                }}>
                  <label style={{ 
                    fontSize: '0.85rem', 
                    fontWeight: '500', 
                    color: 'var(--text-secondary)',
                    minWidth: 'auto'
                  }}>
                    Type:
                  </label>
                  <select
                    value={activeBasket.type}
                    onChange={(e) => updateBasketType(activeBasket.id, e.target.value)}
                    style={{
                      padding: '0.375rem 0.5rem',
                      border: '1px solid var(--border-color)',
                      borderRadius: '6px',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      fontSize: '0.85rem',
                      minWidth: '180px'
                    }}
                  >
                    {Object.entries(BASKET_TYPE_CONFIGS).map(([type, config]) => (
                      <option key={type} value={type}>
                        {config.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              
              <div style={{ 
                fontSize: '0.8rem', 
                color: 'var(--text-secondary)',
                background: 'var(--bg-tertiary)',
                padding: '0.25rem 0.5rem',
                borderRadius: '12px',
                fontWeight: '500',
                whiteSpace: 'nowrap',
                marginLeft: '1rem'
              }}>
                {activeBasket.securities?.length || 0}&nbsp;securities
              </div>
            </div>
            
            {/* Description */}
            <div style={{ 
              fontSize: '0.8rem', 
              color: 'var(--text-secondary)', 
              background: 'var(--bg-tertiary)',
              padding: '0.5rem',
              borderRadius: '6px',
              marginBottom: '0.75rem',
              lineHeight: '1.4'
            }}>
              {BasketHelpers.getBasketConfig(activeBasket.type).description}
            </div>
          </div>

          {/* Add Security Section */}
          <div className="add-security-section" style={{
            padding: '1rem',
            background: 'var(--bg-tertiary)', 
            borderRadius: '8px',
            marginBottom: '1rem',
            border: '1px solid var(--border-color)'
          }}>
            <h4 style={{ marginBottom: '0.5rem' }}>🔍 Add Security to {activeBasket.name}</h4>
            <SecurityAutocomplete
              value={newUnderlying.ticker}
              onChange={(value) => setNewUnderlying(prev => ({ ...prev, ticker: value }))}
              placeholder="Search stocks, indices (SPX, SX5E), ETFs, or ISIN..."
              onSecuritySelect={addSecurityToBasket}
            />
          </div>

          {/* Securities Table */}
          {activeBasket.securities && activeBasket.securities.length > 0 ? (
            <div className="securities-table">
              <div className="table-header" style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1.2fr 1fr 80px',
                gap: '1rem',
                padding: '0.75rem',
                background: 'var(--bg-secondary)',
                borderRadius: '6px 6px 0 0',
                fontWeight: '600',
                fontSize: '0.9rem'
              }}>
                <div>Security</div>
                <div>Weight (%)</div>
                <div>Reference Level</div>
                <div>Last Price (Today)</div>
                <div>Actions</div>
              </div>
              
              {activeBasket.securities.map((security) => (
                <div key={security.id} className="table-row" style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1.2fr 1fr 80px',
                  gap: '1rem',
                  padding: '0.75rem',
                  background: 'var(--bg-primary)',
                  borderBottom: '1px solid var(--border-color)',
                  alignItems: 'center'
                }}>
                  <div className="security-info">
                    {security.securityData ? (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.25rem' }}>
                          <StockLogo symbol={security.securityData.symbol} companyName={security.securityData.name} />
                          <span style={{ fontWeight: '600' }}>{security.securityData.symbol}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            ({security.securityData.exchange}) {getSecurityCountryFlag(security.securityData.country, security.securityData.exchange, security.isin)}
                          </span>
                          <span style={{ 
                            fontSize: '0.7rem', 
                            background: security.securityData.type === 'Index' ? '#2196F3' : '#4CAF50',
                            color: 'white',
                            padding: '2px 6px',
                            borderRadius: '3px'
                          }}>
                            {security.securityData.type || 'Stock'}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                          {security.securityData.name}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.9rem' }}>
                        {security.ticker} - {security.name}
                      </div>
                    )}
                  </div>
                  
                  <div>
                    {BASKET_TYPE_CONFIGS[activeBasket.type].allowCustomWeights ? (
                      <input
                        type="number"
                        value={security.weight.toFixed(2)}
                        onChange={(e) => updateSecurityWeight(activeBasket.id, security.id, e.target.value)}
                        step="0.01"
                        className={`weight-input-table ${getTotalWeight(activeBasket) > 100 ? 'invalid' : ''}`}
                        style={{
                          width: '70px',
                          textAlign: 'center',
                          background: getTotalWeight(activeBasket) > 100 ? '#ffebee' : 'var(--bg-primary)'
                        }}
                      />
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>Auto</span>
                    )}
                  </div>
                  
                  {/* Reference Level Input */}
                  <div>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="number"
                        value={(security.securityData?.tradeDatePrice?.price || security.strike || 0).toFixed(2)}
                        onChange={(e) => updateSecurityStrike(activeBasket.id, security.id, e.target.value)}
                        step="0.01"
                        style={{
                          width: '80px',
                          background: security.securityData?.tradeDatePrice?.price ? 'var(--bg-primary)' : 'var(--bg-secondary)',
                          fontWeight: security.securityData?.tradeDatePrice?.price ? 'bold' : 'normal'
                        }}
                      />
                      <div style={{ 
                        fontSize: '0.7rem', 
                        color: security.securityData?.tradeDatePrice?.price ? 'var(--accent-color)' : 'var(--text-muted)', 
                        marginTop: '2px',
                        textAlign: 'left'
                      }}>
                        {productDetails.tradeDate ? 
                          `${new Date(productDetails.tradeDate).toLocaleDateString()}` :
                          'Set trade date'
                        }
                      </div>
                    </div>
                  </div>
                  
                  {/* Last Price Display */}
                  <div style={{ fontSize: '0.9rem', fontFamily: 'monospace' }}>
                    {security.securityData?.price?.price ? (
                      <div>
                        <div style={{ fontWeight: '600' }}>
                          {security.securityData.currency} {security.securityData.price.price.toFixed(2)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          Last available
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>Loading...</span>
                    )}
                  </div>
                  
                  <div>
                    <button
                      onClick={() => removeSecurityFromBasket(activeBasket.id, security.id)}
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
                      title="Remove security"
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
              No securities added to this basket yet
            </div>
          )}

          {/* Weight Validation */}
          {BASKET_TYPE_CONFIGS[activeBasket.type].allowCustomWeights && activeBasket.securities?.length > 0 && (
            <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--bg-tertiary)', borderRadius: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Total Weight: <strong>{getTotalWeight(activeBasket).toFixed(2)}%</strong></span>
                {getTotalWeight(activeBasket) !== 100 && (
                  <span style={{ 
                    color: getTotalWeight(activeBasket) > 100 ? '#f44336' : '#ff9800',
                    fontSize: '0.85rem'
                  }}>
                    {getTotalWeight(activeBasket) > 100 ? '⚠️ Over 100%' : '⚠️ Under 100%'}
                  </span>
                )}
              </div>
            </div>
          )}
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
          {baskets.length === 0 ? (
            <div>
              <h4>No baskets defined yet</h4>
              <p>Create your first basket to get started</p>
            </div>
          ) : (
            <div>
              <h4>Select a basket to view details</h4>
              <p>Choose from the tabs above to manage securities</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default BasketDefinitionModule;