import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { MarketDataHelpers } from '/imports/api/marketDataCache';
import { StockLogo, StockLogoFallback } from '/imports/utils/stockLogoUtils';

const AddStockModal = ({ isOpen, onClose, onStockAdded, portfolioCurrency }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedStock, setSelectedStock] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [stockSelected, setStockSelected] = useState(false);
  
  // Transaction form state
  const [quantity, setQuantity] = useState('');
  const [price, setPurchasePrice] = useState('');
  const [fees, setFees] = useState('0');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  
  // FX rate state
  const [fxRate, setFxRate] = useState('');
  const [useManualFxRate, setUseManualFxRate] = useState(false);
  const [currentFxRate, setCurrentFxRate] = useState(null);
  const [isLoadingFxRate, setIsLoadingFxRate] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentPrice, setCurrentPrice] = useState(null);
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);

  const searchTimeoutRef = useRef(null);
  const modalRef = useRef(null);

  // Get session ID for API calls
  const getSessionId = () => localStorage.getItem('sessionId');

  // Search for stocks
  useEffect(() => {
    if (searchQuery.length < 2 || stockSelected) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    setIsSearching(true);
    setShowResults(true);

    // Debounce search
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const sessionId = getSessionId();
        const results = await Meteor.callAsync('equityHoldings.searchStocks', searchQuery, 20, sessionId);
        setSearchResults(results);
      } catch (error) {
        console.error('Error searching stocks:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Get current price and FX rate when stock is selected
  useEffect(() => {
    if (selectedStock && selectedStock.fullTicker) {
      getCurrentPrice();
      getCurrentFxRate();
    }
  }, [selectedStock]);

  const getCurrentPrice = async () => {
    if (!selectedStock) return;
    
    setIsLoadingPrice(true);
    try {
      const sessionId = getSessionId();
      const priceData = await Meteor.callAsync('equityHoldings.getCurrentPrice', selectedStock.fullTicker, sessionId);
      setCurrentPrice(priceData.price);
      // Don't automatically set the purchase price - let the user enter it manually
      // Only set it if the field is still completely empty and untouched
      // Removed: if (!price) { setPurchasePrice(priceData.price.toString()); }
    } catch (error) {
      console.error('Error getting current price:', error);
      setCurrentPrice(null);
    } finally {
      setIsLoadingPrice(false);
    }
  };

  const getCurrentFxRate = async () => {
    if (!selectedStock || !portfolioCurrency) return;
    
    const stockCurrency = selectedStock.currency || 'USD';
    const accountCurrency = portfolioCurrency || 'USD';
    
    // Skip if same currency
    if (stockCurrency === accountCurrency) {
      setCurrentFxRate(null);
      setFxRate('1.0000');
      return;
    }
    
    setIsLoadingFxRate(true);
    try {
      // Call a server method to get current FX rate with metadata
      const sessionId = getSessionId();
      const result = await Meteor.callAsync('equityHoldings.getFxRate', stockCurrency, accountCurrency, sessionId);
      
      setCurrentFxRate(result);
      setFxRate(result.rate.toFixed(4));
      
      console.log(`FX Rate: ${stockCurrency}→${accountCurrency} = ${result.rate.toFixed(4)} (${result.pair})`);
    } catch (error) {
      console.error('Error getting FX rate:', error);
      setCurrentFxRate(null);
      setFxRate('1.0000');
    } finally {
      setIsLoadingFxRate(false);
    }
  };

  const handleStockSelect = (stock) => {
    setSelectedStock(stock);
    setSearchQuery(stock.name || stock.symbol);
    setShowResults(false);
    setStockSelected(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!selectedStock || !quantity || !price) {
      alert('Please fill in all required fields');
      return;
    }

    setIsSubmitting(true);
    try {
      // Clean up optional fields - don't send empty strings
      const stockData = {
        symbol: selectedStock.symbol,
        exchange: selectedStock.exchange,
        fullTicker: selectedStock.fullTicker,
        companyName: selectedStock.name,
        currency: selectedStock.currency,
        currentPrice: currentPrice || parseFloat(price)
      };
      
      // Only include optional fields if they have values
      if (selectedStock.isin && selectedStock.isin.trim()) {
        stockData.isin = selectedStock.isin.trim();
      }
      if (selectedStock.sector && selectedStock.sector.trim()) {
        stockData.sector = selectedStock.sector.trim();
      }

      const transactionData = {
        quantity: parseFloat(quantity),
        price: parseFloat(price),
        date: new Date(purchaseDate)
      };
      
      // Include manual FX rate if specified
      if (useManualFxRate && fxRate) {
        transactionData.manualFxRate = parseFloat(fxRate);
        console.log('Using manual FX rate:', transactionData.manualFxRate);
      }
      
      // Only include optional fields if they have values
      if (fees && parseFloat(fees) !== 0) {
        transactionData.fees = parseFloat(fees);
      }
      if (notes && notes.trim()) {
        transactionData.notes = notes.trim();
      }

      console.log('AddStockModal: Sending data:', {
        stockData,
        transactionData
      });

      await onStockAdded(stockData, transactionData);
    } catch (error) {
      console.error('Error adding stock:', error);
      alert('Failed to add stock: ' + error.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSearchQuery('');
    setSearchResults([]);
    setSelectedStock(null);
    setShowResults(false);
    setStockSelected(false);
    setQuantity('');
    setPurchasePrice('');
    setFees('0');
    setPurchaseDate(new Date().toISOString().split('T')[0]);
    setNotes('');
    setFxRate('');
    setUseManualFxRate(false);
    setCurrentFxRate(null);
    setCurrentPrice(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  // Handle clicks outside modal
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 1000
    }}>
      <div
        ref={modalRef}
        style={{
          backgroundColor: 'var(--bg-secondary)',
          borderRadius: '12px',
          padding: '2rem',
          width: '90%',
          maxWidth: '600px',
          maxHeight: '90vh',
          overflowY: 'auto',
          position: 'relative',
          border: '1px solid var(--border-color)'
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem'
        }}>
          <h2 style={{
            margin: 0,
            fontSize: '1.8rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            📈 Add Stock to Portfolio
          </h2>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '1.5rem',
              cursor: 'pointer',
              color: 'var(--text-muted)',
              padding: '0.5rem'
            }}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Stock Search */}
          <div style={{ marginBottom: '1.5rem', position: 'relative' }}>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '1rem',
              fontWeight: '500',
              color: 'var(--text-primary)'
            }}>
              Search Stock (Ticker or Company Name) *
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setStockSelected(false);
              }}
              placeholder="e.g., AAPL, Apple Inc, US0378331005"
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '1rem'
              }}
              required
            />

            {/* Search Results Dropdown */}
            {showResults && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                backgroundColor: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                maxHeight: '300px',
                overflowY: 'auto',
                zIndex: 1001,
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)'
              }}>
                {isSearching ? (
                  <div style={{
                    padding: '1rem',
                    textAlign: 'center',
                    color: 'var(--text-muted)'
                  }}>
                    Searching...
                  </div>
                ) : searchResults.length > 0 ? (
                  searchResults.map((stock, index) => (
                    <div
                      key={index}
                      onClick={() => handleStockSelect(stock)}
                      style={{
                        padding: '0.75rem',
                        cursor: 'pointer',
                        borderBottom: index < searchResults.length - 1 ? '1px solid var(--border-color)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.75rem',
                        transition: 'background-color 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-secondary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <StockLogo symbol={stock.symbol} companyName={stock.name} />
                      <StockLogoFallback symbol={stock.symbol} />
                      <div style={{ flex: 1 }}>
                        <div style={{
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          fontSize: '0.95rem'
                        }}>
                          {stock.symbol} ({stock.exchange})
                        </div>
                        <div style={{
                          color: 'var(--text-muted)',
                          fontSize: '0.85rem'
                        }}>
                          {stock.name}
                        </div>
                        <div style={{
                          color: 'var(--text-muted)',
                          fontSize: '0.8rem'
                        }}>
                          {stock.type} • {stock.country} • {stock.currency}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{
                    padding: '1rem',
                    textAlign: 'center',
                    color: 'var(--text-muted)'
                  }}>
                    No results found
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Selected Stock Display */}
          {selectedStock && (
            <div style={{
              backgroundColor: 'var(--bg-primary)',
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '0.5rem'
              }}>
                <StockLogo symbol={selectedStock.symbol} companyName={selectedStock.name} />
                <StockLogoFallback symbol={selectedStock.symbol} />
                <div>
                  <div style={{
                    fontWeight: '600',
                    color: 'var(--text-primary)'
                  }}>
                    {selectedStock.symbol} ({selectedStock.exchange})
                  </div>
                  <div style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.9rem'
                  }}>
                    {selectedStock.name}
                  </div>
                </div>
              </div>
              
              {/* Current Price */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.9rem',
                color: 'var(--text-muted)'
              }}>
                Current Price: 
                {isLoadingPrice ? (
                  <span>Loading...</span>
                ) : currentPrice ? (
                  <span style={{ 
                    color: 'var(--text-primary)', 
                    fontWeight: '600' 
                  }}>
                    {selectedStock.currency} {currentPrice.toFixed(2)}
                  </span>
                ) : (
                  <span>Price unavailable</span>
                )}
              </div>
            </div>
          )}

          {/* Transaction Details */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <div>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '1rem',
                fontWeight: '500',
                color: 'var(--text-primary)'
              }}>
                Quantity *
              </label>
              <input
                type="number"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Number of shares"
                min="0"
                step="0.01"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem'
                }}
                required
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '1rem',
                fontWeight: '500',
                color: 'var(--text-primary)'
              }}>
                Purchase Price per Share *
              </label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPurchasePrice(e.target.value)}
                placeholder="Price per share"
                min="0"
                step="0.01"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem'
                }}
                required
              />
            </div>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '1rem',
            marginBottom: '1.5rem'
          }}>
            <div>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '1rem',
                fontWeight: '500',
                color: 'var(--text-primary)'
              }}>
                Transaction Fees
              </label>
              <input
                type="number"
                value={fees}
                onChange={(e) => setFees(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '1rem',
                fontWeight: '500',
                color: 'var(--text-primary)'
              }}>
                Purchase Date
              </label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.75rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  fontSize: '1rem'
                }}
              />
            </div>
          </div>

          {/* Notes */}
          <div style={{ marginBottom: '2rem' }}>
            <label style={{
              display: 'block',
              marginBottom: '0.5rem',
              fontSize: '1rem',
              fontWeight: '500',
              color: 'var(--text-primary)'
            }}>
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any notes about this purchase..."
              rows={3}
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '1rem',
                resize: 'vertical'
              }}
            />
          </div>

          {/* FX Rate Section (only show if different currencies) */}
          {selectedStock && selectedStock.currency && portfolioCurrency && 
           selectedStock.currency !== portfolioCurrency && (
            <div style={{
              backgroundColor: 'var(--bg-primary)',
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '1.5rem',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '1rem'
              }}>
                <label style={{
                  fontSize: '1rem',
                  fontWeight: '500',
                  color: 'var(--text-primary)'
                }}>
                  💱 FX Rate ({currentFxRate?.pair?.replace('.FOREX', '') || `${selectedStock.currency}${portfolioCurrency}`})
                </label>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.9rem',
                  color: 'var(--text-secondary)',
                  cursor: 'pointer'
                }}>
                  <input
                    type="checkbox"
                    checked={useManualFxRate}
                    onChange={(e) => setUseManualFxRate(e.target.checked)}
                    style={{ margin: 0 }}
                  />
                  Use manual rate
                </label>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem'
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    marginBottom: '0.5rem',
                    fontSize: '0.9rem',
                    color: 'var(--text-muted)'
                  }}>
                    Current Market Rate:
                    {isLoadingFxRate ? (
                      <span>Loading...</span>
                    ) : currentFxRate ? (
                      <span style={{ 
                        color: 'var(--text-primary)', 
                        fontWeight: '600',
                        fontFamily: 'monospace'
                      }}>
                        {currentFxRate.rate.toFixed(4)}
                      </span>
                    ) : (
                      <span>1.0000</span>
                    )}
                  </div>
                  
                  <input
                    type="number"
                    value={fxRate}
                    onChange={(e) => setFxRate(e.target.value)}
                    placeholder="1.0000"
                    min="0"
                    step="0.0001"
                    disabled={!useManualFxRate}
                    style={{
                      width: '100%',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      border: useManualFxRate ? 
                        '2px solid var(--accent-color)' : 
                        '1px solid var(--border-color)',
                      backgroundColor: useManualFxRate ? 
                        'var(--bg-secondary)' : 
                        'var(--bg-tertiary)',
                      color: useManualFxRate ? 
                        'var(--text-primary)' : 
                        'var(--text-muted)',
                      fontSize: '1rem',
                      fontFamily: 'monospace',
                      cursor: useManualFxRate ? 'text' : 'not-allowed'
                    }}
                  />
                </div>
                
                <div style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-muted)',
                  textAlign: 'center',
                  minWidth: '100px'
                }}>
                  {useManualFxRate ? (
                    <div>
                      <div style={{ color: 'var(--warning-color)', fontWeight: '600' }}>
                        Manual Rate
                      </div>
                      <div style={{ marginTop: '0.25rem' }}>
                        Use your actual trade rate
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div style={{ color: 'var(--success-color)', fontWeight: '600' }}>
                        Market Rate
                      </div>
                      <div style={{ marginTop: '0.25rem' }}>
                        {currentFxRate?.pair || 'Live rate'}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Total Cost Summary */}
          {quantity && price && (
            <div style={{
              backgroundColor: 'var(--bg-primary)',
              padding: '1rem',
              borderRadius: '8px',
              marginBottom: '2rem',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                color: 'var(--text-primary)'
              }}>
                <span>Total Cost:</span>
                <span style={{ fontWeight: '600', fontSize: '1.1rem' }}>
                  {selectedStock?.currency || portfolioCurrency} {(
                    parseFloat(quantity) * parseFloat(price) + parseFloat(fees || 0)
                  ).toFixed(2)}
                </span>
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: 'var(--text-muted)',
                marginTop: '0.25rem'
              }}>
                {quantity} shares × {selectedStock?.currency || portfolioCurrency} {price} + {selectedStock?.currency || portfolioCurrency} {fees || 0} fees
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'flex-end'
          }}>
            <button
              type="button"
              onClick={handleClose}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                fontSize: '1rem',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedStock || !quantity || !price}
              style={{
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: isSubmitting ? 'var(--text-muted)' : '#FF9800',
                color: 'white',
                fontSize: '1rem',
                cursor: isSubmitting ? 'not-allowed' : 'pointer',
                opacity: isSubmitting || !selectedStock || !quantity || !price ? 0.6 : 1
              }}
            >
              {isSubmitting ? 'Adding...' : 'Add Stock'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddStockModal;