import React, { useState } from 'react';
import { Meteor } from 'meteor/meteor';

/**
 * Bond Price Query Component
 *
 * Mini-app for testing CBonds API integration
 * Allows searching for bonds by ISIN or name and displaying price data
 */
const BondPriceQuery = ({ isDark }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState(null);
  const [bondDetails, setBondDetails] = useState(null);
  const [fetchingQuotes, setFetchingQuotes] = useState(false);

  const fetchQuoteData = (securities, sessionId) => {
    if (!securities || securities.length === 0) return;

    setFetchingQuotes(true);
    let quotesProcessed = 0;
    const totalQuotes = securities.filter(sec => sec._raw?.id).length;

    securities.forEach((security, index) => {
      if (security._raw?.id) {
        // Choose the correct method based on security type
        const methodName = security.type === 'stock' ? 'cbonds.getStockQuote' : 'cbonds.getBondQuote';

        Meteor.call(methodName, security._raw.id, sessionId, (error, quoteData) => {
          quotesProcessed++;

          if (!error && quoteData) {
            console.log(`[Bond Price Query] Quote data received for ${security.type} ID`, security._raw.id, ':', quoteData);

            // Extract price and yield from quote data
            // CBonds might return data in different structures
            let price = null;
            let yieldValue = null;

            if (quoteData.items && quoteData.items.length > 0) {
              const quote = quoteData.items[0];
              price = quote.price || quote.close_price || quote.last_price || quote.close;
              yieldValue = quote.yield || quote.ytm || quote.yield_to_maturity;
            } else if (quoteData.quotes && quoteData.quotes.length > 0) {
              const quote = quoteData.quotes[0];
              price = quote.price || quote.close_price || quote.last_price || quote.close;
              yieldValue = quote.yield || quote.ytm || quote.yield_to_maturity;
            } else if (quoteData.prices && quoteData.prices.length > 0) {
              const quote = quoteData.prices[0];
              price = quote.price || quote.close_price || quote.last_price || quote.close;
              yieldValue = quote.yield || quote.ytm || quote.yield_to_maturity;
            } else if (quoteData.tradings && quoteData.tradings.length > 0) {
              // Stock trading data
              const trading = quoteData.tradings[0];
              price = trading.price || trading.close_price || trading.last_price || trading.close;
            }

            // Update security details with quote data
            if (price !== null || yieldValue !== null) {
              setBondDetails(prevDetails => {
                if (!prevDetails) return prevDetails;

                const updatedDetails = [...prevDetails];
                if (updatedDetails[index]) {
                  if (price !== null) {
                    updatedDetails[index].price = parseFloat(price);
                    updatedDetails[index].priceFormatted = `${parseFloat(price).toFixed(2)} ${updatedDetails[index].currency}`;
                  }
                  if (yieldValue !== null) {
                    updatedDetails[index].yield = parseFloat(yieldValue);
                    updatedDetails[index].yieldFormatted = `${parseFloat(yieldValue).toFixed(2)}%`;
                  }
                }
                return updatedDetails;
              });
            }
          } else if (error) {
            console.log(`[Bond Price Query] Quote not available for ${security.type} ID`, security._raw.id, ':', error.reason || error.message);
          }

          // Mark fetching complete when all quotes processed
          if (quotesProcessed >= totalQuotes) {
            setFetchingQuotes(false);
          }
        });
      }
    });

    // If no securities have IDs, mark as complete immediately
    if (totalQuotes === 0) {
      setFetchingQuotes(false);
    }
  };

  const searchSecurities = () => {
    if (!searchQuery || searchQuery.trim().length === 0) {
      setResult({ success: false, message: 'Please enter an ISIN, ticker, or name' });
      return;
    }

    setSearching(true);
    setResult(null);
    setBondDetails(null);
    setFetchingQuotes(false);

    const sessionId = localStorage.getItem('sessionId');

    Meteor.call('cbonds.searchAll', searchQuery.trim(), {}, sessionId, (error, response) => {
      setSearching(false);

      if (error) {
        console.error('CBonds search error:', error);
        setResult({
          success: false,
          message: error.reason || error.message || 'Failed to search bonds'
        });
      } else {
        console.log('CBonds search results:', response);

        if (!response || response.length === 0) {
          setResult({
            success: false,
            message: `No bonds found matching "${searchQuery}"`
          });
        } else {
          setResult({
            success: true,
            message: `Found ${response.length} bond${response.length > 1 ? 's' : ''}`
          });
          setBondDetails(response);

          // Automatically fetch quote data for all bonds
          fetchQuoteData(response, sessionId);
        }
      }
    });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !searching) {
      searchSecurities();
    }
  };

  const formatCurrency = (value, currency) => {
    if (!value) return 'N/A';
    return `${parseFloat(value).toFixed(2)} ${currency || 'USD'}`;
  };

  const formatPercentage = (value) => {
    if (!value) return 'N/A';
    return `${parseFloat(value).toFixed(2)}%`;
  };

  return (
    <div style={{
      maxWidth: '900px',
      margin: '0 auto'
    }}>
      {/* Search Card */}
      <div style={{
        background: isDark ? 'var(--bg-secondary)' : 'white',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '2rem',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        marginBottom: bondDetails ? '1.5rem' : 0
      }}>
        <div style={{
          textAlign: 'center',
          marginBottom: '2rem'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>💰</div>
          <h2 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.5rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            CBonds Search
          </h2>
          <p style={{
            margin: 0,
            fontSize: '0.95rem',
            color: 'var(--text-muted)'
          }}>
            Search bonds and stocks by ISIN, ticker, or name via CBonds API
          </p>
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <label style={{
            display: 'block',
            marginBottom: '0.5rem',
            fontSize: '0.9rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            ISIN, Ticker, ID, or Name
          </label>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="e.g., JP3788600009, AAPL, 928257, or Tesla"
            disabled={searching}
            style={{
              width: '100%',
              padding: '0.75rem 1rem',
              fontSize: '1rem',
              border: `2px solid ${isDark ? 'var(--border-color)' : '#e5e7eb'}`,
              borderRadius: '8px',
              background: searching ? 'var(--bg-tertiary)' : (isDark ? 'var(--bg-tertiary)' : 'white'),
              color: 'var(--text-primary)',
              outline: 'none',
              transition: 'border-color 0.2s ease',
              boxSizing: 'border-box',
              opacity: searching ? 0.6 : 1,
              cursor: searching ? 'not-allowed' : 'text'
            }}
            onFocus={(e) => !searching && (e.target.style.borderColor = 'var(--accent-color)')}
            onBlur={(e) => e.target.style.borderColor = isDark ? 'var(--border-color)' : '#e5e7eb'}
          />
          <div style={{
            fontSize: '0.8rem',
            color: 'var(--text-muted)',
            marginTop: '0.5rem'
          }}>
            Enter a 12-character ISIN (e.g., JP3788600009), ticker symbol (e.g., AAPL), numeric ID (e.g., 928257), or security name
          </div>
        </div>

        <button
          onClick={searchSecurities}
          disabled={searching}
          style={{
            width: '100%',
            padding: '1rem',
            fontSize: '1rem',
            fontWeight: '600',
            border: 'none',
            borderRadius: '8px',
            cursor: searching ? 'not-allowed' : 'pointer',
            background: searching
              ? '#9ca3af'
              : 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            transition: 'all 0.2s ease',
            boxShadow: searching ? 'none' : '0 2px 8px rgba(0, 123, 255, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}
          onMouseEnter={(e) => {
            if (!searching) {
              e.target.style.transform = 'translateY(-2px)';
              e.target.style.boxShadow = '0 4px 12px rgba(0, 123, 255, 0.4)';
            }
          }}
          onMouseLeave={(e) => {
            if (!searching) {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 2px 8px rgba(0, 123, 255, 0.3)';
            }
          }}
        >
          {searching ? (
            <>
              <div style={{
                width: '16px',
                height: '16px',
                border: '2px solid white',
                borderTop: '2px solid transparent',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }}></div>
              Searching...
            </>
          ) : (
            <>
              🔍 Search
            </>
          )}
        </button>

        {result && (
          <div style={{
            marginTop: '1.5rem',
            padding: '1rem 1.25rem',
            borderRadius: '8px',
            fontSize: '0.9rem',
            background: result.success
              ? 'rgba(40, 167, 69, 0.1)'
              : 'rgba(220, 53, 69, 0.1)',
            border: `1px solid ${result.success
              ? 'rgba(40, 167, 69, 0.3)'
              : 'rgba(220, 53, 69, 0.3)'}`,
            color: result.success ? '#28a745' : '#dc3545'
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              <span style={{ fontSize: '1.2rem' }}>
                {result.success ? '✅' : '❌'}
              </span>
              <strong>{result.message}</strong>
            </div>
          </div>
        )}

        <div style={{
          marginTop: '2rem',
          padding: '1rem',
          background: isDark ? 'var(--bg-tertiary)' : '#f8f9fa',
          borderRadius: '8px',
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
          lineHeight: '1.6'
        }}>
          <strong style={{ color: 'var(--text-secondary)' }}>ℹ️ How it works:</strong>
          <ul style={{ margin: '0.5rem 0 0 1.25rem', padding: 0 }}>
            <li>Searches both bonds and stocks using the CBonds API</li>
            <li>Enter a 12-character ISIN for exact matches (e.g., JP3788600009 for Sony stock)</li>
            <li>Enter a ticker symbol for stocks (e.g., AAPL for Apple)</li>
            <li>Enter a numeric CBonds ID from their website (e.g., 928257)</li>
            <li>Or enter security name keywords for broader search</li>
            <li>Returns details including issuer, currency, exchange, and market data</li>
            <li>Automatically fetches current price and yield data when available</li>
          </ul>
        </div>
      </div>

      {/* Bond Results */}
      {bondDetails && bondDetails.length > 0 && (
        <div style={{
          background: isDark ? 'var(--bg-secondary)' : 'white',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: '2rem',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1.5rem'
          }}>
            <h3 style={{
              margin: 0,
              fontSize: '1.25rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              📋 Search Results ({bondDetails.length})
            </h3>
            {fetchingQuotes && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.85rem',
                color: 'var(--text-muted)'
              }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  border: '2px solid var(--accent-color)',
                  borderTop: '2px solid transparent',
                  borderRadius: '50%',
                  animation: 'spin 1s linear infinite'
                }}></div>
                Fetching price/yield data...
              </div>
            )}
          </div>

          {bondDetails.map((bond, index) => (
            <div
              key={bond.isin || index}
              style={{
                background: isDark ? 'var(--bg-tertiary)' : '#f8f9fa',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                padding: '1.5rem',
                marginBottom: index < bondDetails.length - 1 ? '1rem' : 0
              }}
            >
              {/* Bond/Stock Header */}
              <div style={{
                marginBottom: '1.25rem',
                paddingBottom: '1rem',
                borderBottom: '1px solid var(--border-color)'
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  marginBottom: '0.5rem'
                }}>
                  <div style={{
                    fontSize: '1.1rem',
                    fontWeight: '700',
                    color: 'var(--text-primary)'
                  }}>
                    {bond.name}
                  </div>
                  <div style={{
                    display: 'inline-block',
                    padding: '0.25rem 0.75rem',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    fontWeight: '600',
                    textTransform: 'uppercase',
                    background: bond.type === 'stock' ? 'rgba(59, 130, 246, 0.15)' : 'rgba(139, 92, 246, 0.15)',
                    color: bond.type === 'stock' ? '#3b82f6' : '#8b5cf6',
                    border: `1px solid ${bond.type === 'stock' ? 'rgba(59, 130, 246, 0.3)' : 'rgba(139, 92, 246, 0.3)'}`
                  }}>
                    {bond.type === 'stock' ? '📈 Stock' : '💰 Bond'}
                  </div>
                </div>
                <div style={{
                  fontSize: '0.9rem',
                  color: 'var(--text-muted)'
                }}>
                  {bond.issuer}
                </div>
                {bond.isin && (
                  <div style={{
                    fontSize: '0.85rem',
                    color: 'var(--text-secondary)',
                    marginTop: '0.25rem',
                    fontFamily: 'monospace'
                  }}>
                    ISIN: {bond.isin}
                  </div>
                )}
              </div>

              {/* Bond Details Grid */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem'
              }}>
                {/* Bond ID */}
                {bond._raw?.id && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      🆔 Bond ID
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>
                      {bond._raw.id}
                    </div>
                  </div>
                )}

                {/* Ticker (stocks only) */}
                {bond.type === 'stock' && bond.ticker && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      🎯 Ticker
                    </div>
                    <div style={{
                      fontSize: '1.25rem',
                      fontWeight: '700',
                      color: 'var(--accent-color)',
                      fontFamily: 'monospace'
                    }}>
                      {bond.ticker}
                    </div>
                  </div>
                )}

                {/* Bloomberg ID */}
                {bond.bbgid && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      📈 Bloomberg ID
                    </div>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>
                      {bond.bbgid}
                    </div>
                  </div>
                )}

                {/* Price */}
                {bond.price !== null && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      💵 Price
                    </div>
                    <div style={{
                      fontSize: '1.25rem',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>
                      {bond.priceFormatted || formatCurrency(bond.price, bond.currency)}
                    </div>
                  </div>
                )}

                {/* Yield */}
                {bond.yield !== null && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      📈 Yield
                    </div>
                    <div style={{
                      fontSize: '1.25rem',
                      fontWeight: '700',
                      color: '#10b981',
                      fontFamily: 'monospace'
                    }}>
                      {bond.yieldFormatted || formatPercentage(bond.yield)}
                    </div>
                  </div>
                )}

                {/* Coupon */}
                {bond.coupon !== null && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      🎫 Coupon
                    </div>
                    <div style={{
                      fontSize: '1.25rem',
                      fontWeight: '700',
                      color: 'var(--accent-color)',
                      fontFamily: 'monospace'
                    }}>
                      {bond.couponFormatted || formatPercentage(bond.coupon)}
                    </div>
                  </div>
                )}

                {/* Maturity Date */}
                {bond.maturityDate && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      📅 Maturity
                    </div>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {bond.maturityDateFormatted || new Date(bond.maturityDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </div>
                  </div>
                )}

                {/* Currency */}
                {bond.currency && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      💱 Currency
                    </div>
                    <div style={{
                      fontSize: '1.25rem',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>
                      {bond.currency}
                    </div>
                  </div>
                )}

                {/* Exchange (stocks) */}
                {bond.type === 'stock' && bond.exchange && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      🏛️ Exchange
                    </div>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {bond.exchange}
                    </div>
                  </div>
                )}

                {/* Country (stocks) */}
                {bond.type === 'stock' && bond.country && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      🌍 Country
                    </div>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {bond.country}
                    </div>
                  </div>
                )}

                {/* Sector (stocks) */}
                {bond.type === 'stock' && bond.sector && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      🏢 Sector
                    </div>
                    <div style={{
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {bond.sector}
                    </div>
                  </div>
                )}

                {/* Industry (stocks) */}
                {bond.type === 'stock' && bond.industry && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      🏭 Industry
                    </div>
                    <div style={{
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {bond.industry}
                    </div>
                  </div>
                )}

                {/* Rating */}
                {bond.rating && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      ⭐ Rating
                    </div>
                    <div style={{
                      fontSize: '1.25rem',
                      fontWeight: '700',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>
                      {bond.rating}
                    </div>
                  </div>
                )}

                {/* Bond Type */}
                {bond.bondType && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      🏷️ Type
                    </div>
                    <div style={{
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {bond.bondType}
                    </div>
                  </div>
                )}

                {/* Status */}
                {bond.status && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      ℹ️ Status
                    </div>
                    <div style={{
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      color: bond.status === 'outstanding' ? '#10b981' : 'var(--text-primary)',
                      textTransform: 'capitalize'
                    }}>
                      {bond.status}
                    </div>
                  </div>
                )}

                {/* Issue Date */}
                {bond.issueDate && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      📅 Issue Date
                    </div>
                    <div style={{
                      fontSize: '0.95rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)'
                    }}>
                      {new Date(bond.issueDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric'
                      })}
                    </div>
                  </div>
                )}

                {/* Face Value */}
                {bond.faceValue !== null && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      💎 Face Value
                    </div>
                    <div style={{
                      fontSize: '1.1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>
                      {bond.faceValue.toLocaleString()} {bond.currency}
                    </div>
                  </div>
                )}

                {/* Outstanding Amount */}
                {bond.outstandingAmount !== null && (
                  <div style={{
                    background: isDark ? 'var(--bg-secondary)' : 'white',
                    padding: '1rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-color)'
                  }}>
                    <div style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      marginBottom: '0.5rem'
                    }}>
                      💰 Outstanding
                    </div>
                    <div style={{
                      fontSize: '1rem',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      fontFamily: 'monospace'
                    }}>
                      {(bond.outstandingAmount / 1000000).toFixed(0)}M {bond.currency}
                    </div>
                  </div>
                )}
              </div>

              {/* Last Update */}
              {bond.lastUpdate && (
                <div style={{
                  marginTop: '1rem',
                  paddingTop: '1rem',
                  borderTop: '1px solid var(--border-color)',
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  textAlign: 'right'
                }}>
                  Last updated: {new Date(bond.lastUpdate).toLocaleString()}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add animation keyframes */}
      <style dangerouslySetInnerHTML={{
        __html: `
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `
      }} />
    </div>
  );
};

export default BondPriceQuery;
