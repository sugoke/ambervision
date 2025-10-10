import React, { useState, useEffect } from 'react';

const PerformanceChart = ({ portfolioId, portfolio, holdings }) => {
  const [chartType, setChartType] = useState('performance');
  const [timeRange, setTimeRange] = useState('1M');
  const [isLoading, setIsLoading] = useState(false);

  // Generate mock performance data for display
  const generateMockData = () => {
    if (!holdings || holdings.length === 0) return null;

    const totalValue = holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
    const totalCost = holdings.reduce((sum, h) => sum + (h.totalCost || 0), 0);
    const totalReturn = totalValue - totalCost;
    const returnPercent = totalCost > 0 ? (totalReturn / totalCost) * 100 : 0;

    return {
      totalValue,
      totalCost, 
      totalReturn,
      returnPercent,
      dataPoints: 30
    };
  };

  const mockData = generateMockData();

  const formatCurrency = (amount, currency = portfolio?.currency || 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
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
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📈</div>
        <h3 style={{ margin: '0 0 0.5rem 0', color: 'var(--text-primary)' }}>
          No data to display
        </h3>
        <p style={{ margin: 0 }}>
          Add holdings to your portfolio to see performance charts
        </p>
      </div>
    );
  }

  return (
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
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '1.3rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Portfolio Analytics
        </h3>

        <div style={{
          display: 'flex',
          gap: '0.5rem',
          alignItems: 'center',
          flexWrap: 'wrap'
        }}>
          {/* Chart Type Selector */}
          <div style={{
            display: 'flex',
            backgroundColor: 'var(--bg-primary)',
            borderRadius: '8px',
            padding: '0.25rem',
            border: '1px solid var(--border-color)'
          }}>
            {[
              { key: 'performance', label: '📈 Performance' },
              { key: 'allocation', label: '🥧 Allocation' },
              { key: 'returns', label: '📊 Returns' }
            ].map((type) => (
              <button
                key={type.key}
                onClick={() => setChartType(type.key)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '6px',
                  border: 'none',
                  backgroundColor: chartType === type.key ? 'var(--accent-color)' : 'transparent',
                  color: chartType === type.key ? 'white' : 'var(--text-primary)',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {type.label}
              </button>
            ))}
          </div>

          {/* Time Range Selector */}
          {chartType === 'performance' && (
            <div style={{
              display: 'flex',
              backgroundColor: 'var(--bg-primary)',
              borderRadius: '8px',
              padding: '0.25rem',
              border: '1px solid var(--border-color)'
            }}>
              {['1W', '1M', '3M', '6M', '1Y', 'YTD'].map((range) => (
                <button
                  key={range}
                  onClick={() => setTimeRange(range)}
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '6px',
                    border: 'none',
                    backgroundColor: timeRange === range ? 'var(--accent-color)' : 'transparent',
                    color: timeRange === range ? 'white' : 'var(--text-primary)',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    transition: 'all 0.2s'
                  }}
                >
                  {range}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chart Placeholder */}
      <div style={{
        padding: '2rem',
        height: '400px',
        position: 'relative'
      }}>
        {chartType === 'performance' && mockData && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-primary)'
          }}>
            <div style={{
              fontSize: '3rem',
              marginBottom: '2rem'
            }}>
              📈
            </div>
            <div style={{
              textAlign: 'center',
              marginBottom: '2rem'
            }}>
              <h4 style={{ margin: '0 0 1rem 0' }}>Portfolio Performance ({timeRange})</h4>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1rem',
                width: '100%',
                maxWidth: '600px'
              }}>
                <div style={{
                  backgroundColor: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Total Value</div>
                  <div style={{ fontSize: '1.5rem', fontWeight: '600', color: 'var(--text-primary)' }}>
                    {formatCurrency(mockData.totalValue)}
                  </div>
                </div>
                <div style={{
                  backgroundColor: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)'
                }}>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Total Return</div>
                  <div style={{ 
                    fontSize: '1.5rem', 
                    fontWeight: '600', 
                    color: mockData.totalReturn >= 0 ? '#4CAF50' : '#f44336' 
                  }}>
                    {formatCurrency(mockData.totalReturn)}
                  </div>
                  <div style={{ 
                    fontSize: '0.8rem', 
                    color: mockData.returnPercent >= 0 ? '#4CAF50' : '#f44336' 
                  }}>
                    {mockData.returnPercent >= 0 ? '+' : ''}{mockData.returnPercent.toFixed(2)}%
                  </div>
                </div>
              </div>
            </div>
            <div style={{
              fontSize: '1rem',
              color: 'var(--text-muted)',
              textAlign: 'center'
            }}>
              📊 Interactive charts will be available once Chart.js is fully configured
            </div>
          </div>
        )}

        {chartType === 'allocation' && holdings && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-primary)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '2rem' }}>🥧</div>
            <h4 style={{ margin: '0 0 2rem 0' }}>Portfolio Allocation</h4>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
              gap: '1rem',
              width: '100%',
              maxWidth: '800px'
            }}>
              {holdings.slice(0, 5).map((holding, index) => {
                const totalValue = holdings.reduce((sum, h) => sum + (h.currentValue || 0), 0);
                const percentage = totalValue > 0 ? ((holding.currentValue || 0) / totalValue) * 100 : 0;
                
                return (
                  <div key={holding._id} style={{
                    backgroundColor: 'var(--bg-primary)',
                    padding: '1rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}>
                    <div>
                      <div style={{ fontWeight: '600' }}>{holding.symbol}</div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        {formatCurrency(holding.currentValue || 0, holding.currency)}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '1.2rem',
                      fontWeight: '600',
                      color: 'var(--accent-color)'
                    }}>
                      {percentage.toFixed(1)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {chartType === 'returns' && holdings && (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-primary)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '2rem' }}>📊</div>
            <h4 style={{ margin: '0 0 2rem 0' }}>Individual Returns</h4>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              width: '100%',
              maxWidth: '1000px'
            }}>
              {holdings.slice(0, 8).map((holding) => (
                <div key={holding._id} style={{
                  backgroundColor: 'var(--bg-primary)',
                  padding: '1rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  textAlign: 'center'
                }}>
                  <div style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
                    {holding.symbol}
                  </div>
                  <div style={{
                    fontSize: '1.2rem',
                    fontWeight: '600',
                    color: (holding.totalReturnPercent || 0) >= 0 ? '#4CAF50' : '#f44336'
                  }}>
                    {(holding.totalReturnPercent || 0) >= 0 ? '+' : ''}{(holding.totalReturnPercent || 0).toFixed(2)}%
                  </div>
                  <div style={{
                    fontSize: '0.9rem',
                    color: (holding.totalReturn || 0) >= 0 ? '#4CAF50' : '#f44336'
                  }}>
                    {formatCurrency(holding.totalReturn || 0, holding.currency)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PerformanceChart;