import React, { useState, useMemo } from 'react';
import { StockLogo, StockLogoFallback } from '/imports/utils/stockLogoUtils';

const HoldingsTable = ({ holdings, portfolio, onRemoveHolding, onSellShares }) => {
  const [sortField, setSortField] = useState('currentValue');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [sellModalOpen, setSellModalOpen] = useState(false);
  const [sellQuantity, setSellQuantity] = useState('');
  const [sellPrice, setSellPrice] = useState('');

  // Sort holdings
  const sortedHoldings = useMemo(() => {
    if (!holdings || holdings.length === 0) return [];

    return [...holdings].sort((a, b) => {
      let aValue = a[sortField];
      let bValue = b[sortField];

      // Handle special cases
      if (sortField === 'symbol') {
        aValue = aValue?.toString().toLowerCase() || '';
        bValue = bValue?.toString().toLowerCase() || '';
      } else if (typeof aValue === 'number' && typeof bValue === 'number') {
        // Numbers
      } else {
        aValue = parseFloat(aValue) || 0;
        bValue = parseFloat(bValue) || 0;
      }

      if (sortDirection === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });
  }, [holdings, sortField, sortDirection]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const getSortIcon = (field) => {
    if (sortField !== field) return '↕️';
    return sortDirection === 'asc' ? '↗️' : '↘️';
  };

  const formatCurrency = (amount, currency = portfolio?.currency || 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  };

  const formatPercent = (percent) => {
    const sign = percent >= 0 ? '+' : '';
    return `${sign}${percent.toFixed(2)}%`;
  };

  const getChangeColor = (value) => {
    if (value > 0) return '#4CAF50';
    if (value < 0) return '#f44336';
    return 'var(--text-muted)';
  };

  const handleSellClick = (holding) => {
    setSelectedHolding(holding);
    setSellQuantity('');
    setSellPrice(holding.currentPrice?.toString() || '');
    setSellModalOpen(true);
  };

  const handleSellSubmit = async (e) => {
    e.preventDefault();
    if (!selectedHolding || !sellQuantity || !sellPrice) return;

    try {
      await onSellShares(
        selectedHolding._id,
        parseFloat(sellQuantity),
        parseFloat(sellPrice)
      );
      setSellModalOpen(false);
      setSelectedHolding(null);
    } catch (error) {
      console.error('Error selling shares:', error);
    }
  };

  if (!holdings || holdings.length === 0) {
    return (
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: '12px',
        padding: '3rem 2rem',
        textAlign: 'center',
        color: 'var(--text-muted)',
        border: '1px solid var(--border-color)'
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📋</div>
        <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>
          No holdings to display
        </h3>
        <p style={{ margin: 0 }}>
          Add stocks to your portfolio to see them here
        </p>
      </div>
    );
  }

  return (
    <>
      <div style={{
        backgroundColor: 'var(--bg-secondary)',
        borderRadius: '12px',
        border: '1px solid var(--border-color)',
        overflow: 'hidden'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem 2rem',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <h3 style={{
            margin: 0,
            fontSize: '1.3rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Holdings ({holdings.length})
          </h3>
          <div style={{
            fontSize: '0.9rem',
            color: 'var(--text-muted)'
          }}>
            Click column headers to sort
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: '0.9rem'
          }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-primary)' }}>
                <th
                  onClick={() => handleSort('symbol')}
                  style={{
                    padding: '1rem',
                    textAlign: 'left',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    borderBottom: '1px solid var(--border-color)',
                    userSelect: 'none'
                  }}
                >
                  Stock {getSortIcon('symbol')}
                </th>
                <th
                  onClick={() => handleSort('quantity')}
                  style={{
                    padding: '1rem',
                    textAlign: 'right',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    borderBottom: '1px solid var(--border-color)',
                    userSelect: 'none'
                  }}
                >
                  Shares {getSortIcon('quantity')}
                </th>
                <th
                  onClick={() => handleSort('averagePrice')}
                  style={{
                    padding: '1rem',
                    textAlign: 'right',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    borderBottom: '1px solid var(--border-color)',
                    userSelect: 'none'
                  }}
                >
                  Avg Price {getSortIcon('averagePrice')}
                </th>
                <th
                  onClick={() => handleSort('currentPrice')}
                  style={{
                    padding: '1rem',
                    textAlign: 'right',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    borderBottom: '1px solid var(--border-color)',
                    userSelect: 'none'
                  }}
                >
                  Current Price {getSortIcon('currentPrice')}
                </th>
                <th
                  onClick={() => handleSort('currentValue')}
                  style={{
                    padding: '1rem',
                    textAlign: 'right',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    borderBottom: '1px solid var(--border-color)',
                    userSelect: 'none'
                  }}
                >
                  Market Value {getSortIcon('currentValue')}
                </th>
                <th
                  onClick={() => handleSort('totalReturn')}
                  style={{
                    padding: '1rem',
                    textAlign: 'right',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    borderBottom: '1px solid var(--border-color)',
                    userSelect: 'none'
                  }}
                >
                  Total Return {getSortIcon('totalReturn')}
                </th>
                <th
                  onClick={() => handleSort('dayChange')}
                  style={{
                    padding: '1rem',
                    textAlign: 'right',
                    cursor: 'pointer',
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    borderBottom: '1px solid var(--border-color)',
                    userSelect: 'none'
                  }}
                >
                  Day Change {getSortIcon('dayChange')}
                </th>
                <th style={{
                  padding: '1rem',
                  textAlign: 'center',
                  color: 'var(--text-primary)',
                  fontWeight: '600',
                  borderBottom: '1px solid var(--border-color)'
                }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedHoldings.map((holding, index) => (
                <tr
                  key={holding._id}
                  style={{
                    borderBottom: index < sortedHoldings.length - 1 ? '1px solid var(--border-color)' : 'none',
                    transition: 'background-color 0.2s'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {/* Stock Info */}
                  <td style={{ padding: '1rem' }}>
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem'
                    }}>
                      <StockLogo 
                        symbol={holding.symbol} 
                        companyName={holding.companyName}
                        style={{ width: '32px', height: '32px' }}
                      />
                      <StockLogoFallback 
                        symbol={holding.symbol}
                        style={{ width: '32px', height: '32px' }}
                      />
                      <div>
                        <div style={{
                          fontWeight: '600',
                          color: 'var(--text-primary)',
                          fontSize: '1rem'
                        }}>
                          {holding.symbol}
                        </div>
                        <div style={{
                          color: 'var(--text-muted)',
                          fontSize: '0.85rem'
                        }}>
                          {holding.companyName}
                        </div>
                        {holding.exchange && (
                          <div style={{
                            color: 'var(--text-muted)',
                            fontSize: '0.8rem'
                          }}>
                            {holding.exchange} • {holding.currency}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Quantity */}
                  <td style={{
                    padding: '1rem',
                    textAlign: 'right',
                    color: 'var(--text-primary)',
                    fontWeight: '500'
                  }}>
                    {holding.quantity?.toLocaleString()}
                  </td>

                  {/* Average Price */}
                  <td style={{
                    padding: '1rem',
                    textAlign: 'right',
                    color: 'var(--text-primary)'
                  }}>
                    {formatCurrency(holding.averagePrice || 0, holding.currency)}
                  </td>

                  {/* Current Price */}
                  <td style={{
                    padding: '1rem',
                    textAlign: 'right',
                    color: 'var(--text-primary)',
                    fontWeight: '500'
                  }}>
                    {formatCurrency(holding.currentPrice || 0, holding.currency)}
                  </td>

                  {/* Market Value */}
                  <td style={{
                    padding: '1rem',
                    textAlign: 'right',
                    color: 'var(--text-primary)',
                    fontWeight: '600',
                    fontSize: '1rem'
                  }}>
                    {formatCurrency(holding.currentValue || 0, holding.currency)}
                  </td>

                  {/* Total Return */}
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <div style={{
                      color: getChangeColor(holding.totalReturn || 0),
                      fontWeight: '600'
                    }}>
                      {formatCurrency(holding.totalReturn || 0, holding.currency)}
                    </div>
                    <div style={{
                      color: getChangeColor(holding.totalReturnPercent || 0),
                      fontSize: '0.85rem'
                    }}>
                      {formatPercent(holding.totalReturnPercent || 0)}
                    </div>
                  </td>

                  {/* Day Change */}
                  <td style={{ padding: '1rem', textAlign: 'right' }}>
                    <div style={{
                      color: getChangeColor(holding.dayChange || 0),
                      fontWeight: '500'
                    }}>
                      {formatCurrency(holding.dayChange || 0, holding.currency)}
                    </div>
                    <div style={{
                      color: getChangeColor(holding.dayChangePercent || 0),
                      fontSize: '0.85rem'
                    }}>
                      {formatPercent(holding.dayChangePercent || 0)}
                    </div>
                  </td>

                  {/* Actions */}
                  <td style={{
                    padding: '1rem',
                    textAlign: 'center'
                  }}>
                    <div style={{
                      display: 'flex',
                      gap: '0.5rem',
                      justifyContent: 'center'
                    }}>
                      <button
                        onClick={() => handleSellClick(holding)}
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '6px',
                          border: '1px solid #f44336',
                          backgroundColor: 'transparent',
                          color: '#f44336',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.backgroundColor = '#f44336';
                          e.target.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.backgroundColor = 'transparent';
                          e.target.style.color = '#f44336';
                        }}
                      >
                        Sell
                      </button>
                      <button
                        onClick={() => onRemoveHolding(holding._id)}
                        style={{
                          padding: '0.5rem 0.75rem',
                          borderRadius: '6px',
                          border: '1px solid var(--border-color)',
                          backgroundColor: 'transparent',
                          color: 'var(--text-muted)',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                          e.target.style.backgroundColor = 'var(--text-muted)';
                          e.target.style.color = 'white';
                        }}
                        onMouseLeave={(e) => {
                          e.target.style.backgroundColor = 'transparent';
                          e.target.style.color = 'var(--text-muted)';
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sell Modal */}
      {sellModalOpen && selectedHolding && (
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
          <div style={{
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: '12px',
            padding: '2rem',
            width: '90%',
            maxWidth: '400px',
            border: '1px solid var(--border-color)'
          }}>
            <h3 style={{
              margin: '0 0 1.5rem 0',
              color: 'var(--text-primary)'
            }}>
              Sell {selectedHolding.symbol}
            </h3>

            <form onSubmit={handleSellSubmit}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  color: 'var(--text-primary)'
                }}>
                  Quantity to Sell (max: {selectedHolding.quantity})
                </label>
                <input
                  type="number"
                  value={sellQuantity}
                  onChange={(e) => setSellQuantity(e.target.value)}
                  max={selectedHolding.quantity}
                  min="0"
                  step="0.01"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    color: 'var(--text-primary)'
                  }}
                  required
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '0.5rem',
                  color: 'var(--text-primary)'
                }}>
                  Sell Price per Share
                </label>
                <input
                  type="number"
                  value={sellPrice}
                  onChange={(e) => setSellPrice(e.target.value)}
                  min="0"
                  step="0.01"
                  style={{
                    width: '100%',
                    padding: '0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    color: 'var(--text-primary)'
                  }}
                  required
                />
              </div>

              {sellQuantity && sellPrice && (
                <div style={{
                  backgroundColor: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  marginBottom: '1.5rem',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    color: 'var(--text-primary)'
                  }}>
                    <span>Total Proceeds:</span>
                    <span style={{ fontWeight: '600' }}>
                      {formatCurrency(parseFloat(sellQuantity) * parseFloat(sellPrice), selectedHolding.currency)}
                    </span>
                  </div>
                </div>
              )}

              <div style={{
                display: 'flex',
                gap: '1rem',
                justifyContent: 'flex-end'
              }}>
                <button
                  type="button"
                  onClick={() => setSellModalOpen(false)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.75rem 1.5rem',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: '#f44336',
                    color: 'white',
                    cursor: 'pointer'
                  }}
                >
                  Sell Shares
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};

export default HoldingsTable;