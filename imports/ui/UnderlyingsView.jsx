import React, { useState, useEffect, useMemo } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker, useSubscribe } from 'meteor/react-meteor-data';
import { ProductsCollection } from '/imports/api/products';
import { MarketDataCacheCollection } from '/imports/api/marketDataCache';
import { useTheme } from './ThemeContext.jsx';

const UnderlyingsView = ({ user }) => {
  const { isDarkMode } = useTheme();
  const [sortColumn, setSortColumn] = useState('symbol');
  const [sortDirection, setSortDirection] = useState('asc');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Subscribe to products and market data
  const isLoading = useSubscribe('products');
  const marketDataLoading = useSubscribe('underlyingsMarketData');
  
  // Get all live Phoenix products
  const { liveProducts, marketData } = useTracker(() => {
    const products = ProductsCollection.find({
      $and: [
        {
          $or: [
            { status: 'live' },
            { status: 'Live' },
            { status: 'active' },
            { status: 'Active' },
            { productStatus: 'live' },
            { productStatus: 'Live' },
            { productStatus: 'active' },
            { productStatus: 'Active' }
          ]
        },
        {
          $or: [
            { template: 'phoenix_autocallable' },
            { templateId: 'phoenix_autocallable' }
          ]
        }
      ]
    }).fetch();

    const marketDataCache = MarketDataCacheCollection.find({}).fetch();
    const marketDataMap = {};
    // Index by both fullTicker and symbol for flexible lookup
    marketDataCache.forEach(item => {
      marketDataMap[item.fullTicker] = item;
      marketDataMap[item.symbol] = item; // Also index by symbol for backward compatibility
    });

    return { liveProducts: products, marketData: marketDataMap };
  }, []);
  
  // Extract all unique underlyings from live products
  const underlyingsData = useMemo(() => {
    const underlyingsMap = new Map();

    liveProducts.forEach(product => {
      // Use the new underlyings array if available, otherwise fall back to extracting from payoffStructure
      const productUnderlyings = product.underlyings || [];
      
      if (productUnderlyings.length === 0 && product.payoffStructure) {
        // Fallback: extract from payoffStructure for older products
        const items = product.payoffStructure || [];

        items.forEach(item => {
          if (item.type === 'underlying') {
            if (item.isBasket && item.selectedSecurities) {
              item.selectedSecurities.forEach(security => {
                productUnderlyings.push({
                  symbol: security.symbol,
                  name: security.name || security.symbol,
                  exchange: security.exchange,
                  type: security.type || 'Stock',
                  strikePrice: parseFloat(security.strikePrice) || null,
                  weight: parseFloat(security.weight) || (100 / item.selectedSecurities.length),
                  isBasketComponent: true
                });
              });
            } else if (item.selectedSecurity) {
              const security = item.selectedSecurity;
              productUnderlyings.push({
                symbol: security.symbol,
                name: security.name || security.symbol,
                exchange: security.exchange,
                type: security.type || 'Stock',
                strikePrice: parseFloat(item.strikePrice) || null,
                weight: 100,
                isBasketComponent: false
              });
            }
          }
        });
      }
      
      // Process each underlying
      productUnderlyings.forEach(underlying => {
        // Use fullTicker as primary key if available, otherwise use symbol
        // Priority: securityData.ticker (validated from EOD API) > fullTicker > constructed from symbol+exchange
        const fullTicker = underlying.securityData?.ticker ||
                          underlying.fullTicker ||
                          (underlying.ticker && underlying.ticker.includes('.') ? underlying.ticker : null) ||
                          (underlying.symbol && underlying.exchange ? `${underlying.symbol}.${underlying.exchange}` : null);

        const symbol = underlying.symbol || underlying.ticker || underlying.securityData?.symbol;
        const name = underlying.name || underlying.securityData?.name || symbol;
        const exchange = underlying.securityData?.exchange || underlying.exchange;

        const key = fullTicker || symbol;

        if (!underlyingsMap.has(key)) {
          underlyingsMap.set(key, {
            symbol: symbol,
            fullTicker: fullTicker,
            ticker: fullTicker, // For market data lookup
            name: name,
            exchange: exchange,
            type: underlying.type || 'Stock',
            products: [],
            tradeDates: [],
            initialPrices: []
          });
        }

        const mapEntry = underlyingsMap.get(key);

        // Check if this product has capital protection (protection barrier exists)
        const hasProtection = product.structureParams?.protectionBarrierLevel > 0 ||
                             product.structureParams?.protectionBarrier > 0 ||
                             (product.structure?.maturity || product.payoffStructure || []).some(
                               item => item.type === 'barrier' && item.barrier_type === 'protection'
                             );

        mapEntry.products.push({
          id: product._id,
          title: product.title,
          isin: product.isin,
          tradeDate: product.tradeDate,
          finalObservation: product.finalObservation || product.finalObservationDate,
          weight: underlying.weight || 100,
          hasProtection: hasProtection
        });

        if (product.tradeDate) {
          mapEntry.tradeDates.push(new Date(product.tradeDate));
        }

        // Track final observation dates
        if (!mapEntry.finalObservationDates) {
          mapEntry.finalObservationDates = [];
        }
        const finalObs = product.finalObservation || product.finalObservationDate;
        if (finalObs) {
          mapEntry.finalObservationDates.push(new Date(finalObs));
        }

        // Check multiple possible field names for strike price
        const strikePrice = underlying.strike || underlying.strikePrice;
        if (strikePrice) {
          mapEntry.initialPrices.push({
            date: product.tradeDate,
            price: parseFloat(strikePrice)
          });
        }
      });
    });
    
    // Calculate performance for each underlying
    const underlyingsArray = Array.from(underlyingsMap.values()).map(underlying => {
      // Get current market data - prioritize fullTicker lookup, fallback to symbol
      const currentMarketData = marketData[underlying.fullTicker] ||
                               marketData[underlying.ticker] ||
                               marketData[underlying.symbol];
      const currentPrice = currentMarketData?.cache?.latestPrice ||
                          currentMarketData?.price ||
                          0;
      
      // Calculate earliest trade date
      const earliestTradeDate = underlying.tradeDates.length > 0
        ? new Date(Math.min(...underlying.tradeDates))
        : null;

      // Calculate latest final observation date (furthest in the future)
      const latestFinalObservation = underlying.finalObservationDates && underlying.finalObservationDates.length > 0
        ? new Date(Math.max(...underlying.finalObservationDates))
        : null;

      // Get initial price (use average if multiple)
      const initialPrice = underlying.initialPrices.length > 0
        ? underlying.initialPrices.reduce((sum, p) => sum + p.price, 0) / underlying.initialPrices.length
        : currentPrice;

      // Calculate performance
      const performance = initialPrice > 0 ? ((currentPrice - initialPrice) / initialPrice * 100) : 0;

      // Calculate days to final observation (negative if already passed)
      const daysToFinalObservation = latestFinalObservation
        ? Math.ceil((latestFinalObservation - new Date()) / (1000 * 60 * 60 * 24))
        : 0;

      // Check if any product using this underlying has capital protection
      const hasAnyProtection = underlying.products.some(p => p.hasProtection);
      const protectionProductCount = underlying.products.filter(p => p.hasProtection).length;

      return {
        ...underlying,
        currentPrice,
        initialPrice,
        performance,
        earliestTradeDate,
        latestFinalObservation,
        daysToFinalObservation,
        productCount: underlying.products.length,
        hasAnyProtection,
        protectionProductCount,
        lastUpdate: currentMarketData?.cache?.latestDate || currentMarketData?.lastUpdated || currentMarketData?.timestamp,
        hasMarketData: !!currentMarketData
      };
    });
    
    return underlyingsArray;
  }, [liveProducts, marketData]);
  
  // Filter and sort data
  const filteredAndSortedData = useMemo(() => {
    let filtered = underlyingsData;
    
    // Apply search filter
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      filtered = filtered.filter(item => 
        item.symbol.toLowerCase().includes(searchLower) ||
        item.name.toLowerCase().includes(searchLower) ||
        item.products.some(p => 
          p.title.toLowerCase().includes(searchLower) ||
          p.isin.toLowerCase().includes(searchLower)
        )
      );
    }
    
    // Sort data
    const sorted = [...filtered].sort((a, b) => {
      let aValue = a[sortColumn];
      let bValue = b[sortColumn];
      
      // Handle numeric columns
      if (['currentPrice', 'initialPrice', 'performance', 'daysToFinalObservation', 'productCount'].includes(sortColumn)) {
        aValue = parseFloat(aValue) || 0;
        bValue = parseFloat(bValue) || 0;
      }
      
      // Handle date columns
      if (sortColumn === 'earliestTradeDate') {
        aValue = aValue ? new Date(aValue).getTime() : 0;
        bValue = bValue ? new Date(bValue).getTime() : 0;
      }

      // Handle boolean columns (protection)
      if (sortColumn === 'hasAnyProtection') {
        aValue = aValue ? 1 : 0;
        bValue = bValue ? 1 : 0;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    
    return sorted;
  }, [underlyingsData, searchTerm, sortColumn, sortDirection]);
  
  const handleSort = (column) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  };
  
  const getPerformanceColor = (performance) => {
    if (performance > 0) return '#10b981';
    if (performance < 0) return '#ef4444';
    return '#6b7280';
  };
  
  if (isLoading() || marketDataLoading()) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '400px',
        color: 'var(--text-secondary)'
      }}>
        Loading underlying data...
      </div>
    );
  }
  
  return (
    <div style={{
      padding: '2rem',
      background: 'var(--bg-primary)',
      minHeight: '100vh'
    }}>
          {/* Header */}
          <div style={{
            background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
            borderRadius: '20px',
            padding: '2rem',
            marginBottom: '2rem',
            border: '1px solid var(--border-color)',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)'
          }}>
            <h1 style={{
              margin: '0 0 0.5rem 0',
              fontSize: '2rem',
              fontWeight: '700',
              color: 'var(--text-primary)',
              letterSpacing: '-0.02em'
            }}>
              Phoenix Autocallable - Underlying Assets
            </h1>
            <p style={{
              margin: 0,
              fontSize: '1rem',
              color: 'var(--text-secondary)'
            }}>
              Track performance of underlying assets in live Phoenix products
            </p>
          </div>
          
          {/* Statistics Cards */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem',
            marginBottom: '2rem'
          }}>
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: '12px',
              padding: '1.5rem',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Total Underlyings
              </div>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                {underlyingsData.length}
              </div>
            </div>
            
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: '12px',
              padding: '1.5rem',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Live Phoenix Products
              </div>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: 'var(--text-primary)' }}>
                {liveProducts.length}
              </div>
            </div>
            
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: '12px',
              padding: '1.5rem',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Positive Performance
              </div>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: '#10b981' }}>
                {underlyingsData.filter(u => u.performance > 0).length}
              </div>
            </div>
            
            <div style={{
              background: 'var(--bg-secondary)',
              borderRadius: '12px',
              padding: '1.5rem',
              border: '1px solid var(--border-color)'
            }}>
              <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                Negative Performance
              </div>
              <div style={{ fontSize: '2rem', fontWeight: '700', color: '#ef4444' }}>
                {underlyingsData.filter(u => u.performance < 0).length}
              </div>
            </div>
          </div>
          
          {/* Search Bar */}
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: '12px',
            padding: '1rem',
            marginBottom: '2rem',
            border: '1px solid var(--border-color)'
          }}>
            <input
              type="text"
              placeholder="Search by symbol, name, product title or ISIN..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'var(--bg-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '8px',
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                outline: 'none'
              }}
            />
          </div>
          
          {/* Table */}
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: '12px',
            border: '1px solid var(--border-color)',
            overflow: 'hidden'
          }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '0.95rem'
              }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border-color)' }}>
                    <th
                      onClick={() => handleSort('hasAnyProtection')}
                      style={{
                        padding: '0.5rem',
                        textAlign: 'center',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                        width: '60px'
                      }}
                      title="Capital Protection"
                    >
                      🛡️ {sortColumn === 'hasAnyProtection' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th
                      onClick={() => handleSort('symbol')}
                      style={{
                        padding: '1rem',
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Symbol {sortColumn === 'symbol' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th 
                      onClick={() => handleSort('name')}
                      style={{
                        padding: '1rem',
                        textAlign: 'left',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Name {sortColumn === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th 
                      onClick={() => handleSort('currentPrice')}
                      style={{
                        padding: '1rem',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Current Price {sortColumn === 'currentPrice' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th 
                      onClick={() => handleSort('initialPrice')}
                      style={{
                        padding: '1rem',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Initial Price {sortColumn === 'initialPrice' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th 
                      onClick={() => handleSort('performance')}
                      style={{
                        padding: '1rem',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Performance {sortColumn === 'performance' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th
                      onClick={() => handleSort('daysToFinalObservation')}
                      style={{
                        padding: '1rem',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Days to Final Obs {sortColumn === 'daysToFinalObservation' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th 
                      onClick={() => handleSort('productCount')}
                      style={{
                        padding: '1rem',
                        textAlign: 'center',
                        fontWeight: '600',
                        color: 'var(--text-secondary)',
                        cursor: 'pointer',
                        userSelect: 'none',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      Products {sortColumn === 'productCount' && (sortDirection === 'asc' ? '↑' : '↓')}
                    </th>
                    <th style={{
                      padding: '1rem',
                      textAlign: 'left',
                      fontWeight: '600',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap'
                    }}>
                      Used In Products
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAndSortedData.map((underlying, index) => (
                    <tr 
                      key={underlying.symbol}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        transition: 'background-color 0.2s',
                        cursor: 'pointer'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                      }}
                    >
                      <td style={{
                        padding: '0.5rem',
                        textAlign: 'center',
                        background: underlying.hasAnyProtection
                          ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(5, 150, 105, 0.1) 100%)'
                          : 'transparent'
                      }}>
                        {underlying.hasAnyProtection ? (
                          <span
                            style={{
                              fontSize: '1.25rem',
                              cursor: 'help'
                            }}
                            title={`${underlying.protectionProductCount} of ${underlying.productCount} products have capital protection`}
                          >
                            🛡️
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: '1rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                        {underlying.symbol}
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-primary)' }}>
                        {underlying.name}
                        {underlying.exchange && (
                          <span style={{ 
                            marginLeft: '0.5rem', 
                            fontSize: '0.75rem', 
                            color: 'var(--text-secondary)' 
                          }}>
                            ({underlying.exchange})
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right', fontWeight: '500' }}>
                        {underlying.hasMarketData ? (
                          underlying.currentPrice.toFixed(2)
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>No data</span>
                        )}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'right', color: 'var(--text-secondary)' }}>
                        {underlying.initialPrice > 0 ? underlying.initialPrice.toFixed(2) : (
                          <span style={{ fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td style={{
                        padding: '1rem',
                        textAlign: 'right',
                        fontWeight: '600',
                        color: getPerformanceColor(underlying.performance)
                      }}>
                        {underlying.hasMarketData && underlying.initialPrice > 0 ? (
                          `${underlying.performance >= 0 ? '+' : ''}${underlying.performance.toFixed(2)}%`
                        ) : (
                          <span style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>—</span>
                        )}
                      </td>
                      <td style={{
                        padding: '1rem',
                        textAlign: 'right',
                        color: underlying.daysToFinalObservation < 0 ? '#ef4444' : 'var(--text-secondary)',
                        fontWeight: underlying.daysToFinalObservation < 0 ? '600' : 'normal'
                      }}>
                        {underlying.daysToFinalObservation < 0 ? (
                          `${underlying.daysToFinalObservation} (expired)`
                        ) : (
                          underlying.daysToFinalObservation
                        )}
                      </td>
                      <td style={{ padding: '1rem', textAlign: 'center' }}>
                        <span style={{
                          padding: '0.25rem 0.75rem',
                          background: 'var(--bg-primary)',
                          borderRadius: '12px',
                          fontSize: '0.875rem',
                          fontWeight: '600'
                        }}>
                          {underlying.productCount}
                        </span>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                          {underlying.products.slice(0, 3).map(product => (
                            <span
                              key={product.id}
                              style={{
                                padding: '0.25rem 0.5rem',
                                background: product.hasProtection
                                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(5, 150, 105, 0.15) 100%)'
                                  : 'var(--bg-primary)',
                                borderRadius: '6px',
                                fontSize: '0.75rem',
                                color: 'var(--text-secondary)',
                                border: product.hasProtection
                                  ? '1px solid rgba(16, 185, 129, 0.3)'
                                  : '1px solid var(--border-color)',
                                position: 'relative',
                                paddingLeft: product.hasProtection ? '1.25rem' : '0.5rem'
                              }}
                              title={`${product.title} (${product.isin})${product.hasProtection ? ' - Capital Protected' : ''}`}
                            >
                              {product.hasProtection && (
                                <span style={{
                                  position: 'absolute',
                                  left: '0.25rem',
                                  fontSize: '0.65rem'
                                }}>
                                  🛡️
                                </span>
                              )}
                              {product.isin}
                            </span>
                          ))}
                          {underlying.products.length > 3 && (
                            <span style={{
                              padding: '0.25rem 0.5rem',
                              background: 'var(--bg-tertiary)',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              color: 'var(--text-secondary)',
                              fontWeight: '600'
                            }}>
                              +{underlying.products.length - 3} more
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              
              {filteredAndSortedData.length === 0 && (
                <div style={{
                  padding: '3rem',
                  textAlign: 'center',
                  color: 'var(--text-secondary)'
                }}>
                  No underlying assets found
                </div>
              )}
            </div>
          </div>
          
          {/* Last Update */}
          {underlyingsData.length > 0 && underlyingsData[0].lastUpdate && (
            <div style={{
              marginTop: '1rem',
              textAlign: 'center',
              fontSize: '0.875rem',
              color: 'var(--text-secondary)'
            }}>
              Market data last updated: {new Date(underlyingsData[0].lastUpdate).toLocaleString()}
            </div>
          )}
    </div>
  );
};

export default UnderlyingsView;