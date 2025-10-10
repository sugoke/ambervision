import React, { useMemo } from 'react';

const PortfolioSummary = ({ portfolio, holdings }) => {
  // Calculate portfolio metrics from holdings
  const portfolioMetrics = useMemo(() => {
    if (!holdings || holdings.length === 0) {
      return {
        totalValue: 0,
        totalCost: 0,
        totalReturn: 0,
        totalReturnPercent: 0,
        dayChange: 0,
        dayChangePercent: 0,
        holdingsCount: 0,
        averageReturnPercent: 0,
        bestPerformer: null,
        worstPerformer: null
      };
    }

    const metrics = holdings.reduce((acc, holding) => {
      const currentValue = Number.isFinite(holding.currentValue) ? holding.currentValue : 0;
      const totalCost = Number.isFinite(holding.totalCost) ? holding.totalCost : 0;
      const dayChange = Number.isFinite(holding.dayChange) ? holding.dayChange : 0;
      const totalReturn = Number.isFinite(holding.totalReturn)
        ? holding.totalReturn
        : (Number.isFinite(holding.currentValue) && Number.isFinite(holding.totalCost)) ? (holding.currentValue - holding.totalCost) : 0;

      acc.totalValue += currentValue;
      acc.totalCost += totalCost;
      acc.dayChange += dayChange;
      acc.totalReturn += totalReturn;
      return acc;
    }, {
      totalValue: 0,
      totalCost: 0,
      dayChange: 0,
      totalReturn: 0
    });

    const totalReturnPercent = metrics.totalCost > 0 ? 
      (metrics.totalReturn / metrics.totalCost) * 100 : 0;
    
    const dayChangePercent = (metrics.totalValue - metrics.dayChange) > 0 ? 
      (metrics.dayChange / (metrics.totalValue - metrics.dayChange)) * 100 : 0;

    // Find best and worst performers
    let bestPerformer = null;
    let worstPerformer = null;
    
    holdings.forEach(holding => {
      if (!bestPerformer || (holding.totalReturnPercent || 0) > (bestPerformer.totalReturnPercent || 0)) {
        bestPerformer = holding;
      }
      if (!worstPerformer || (holding.totalReturnPercent || 0) < (worstPerformer.totalReturnPercent || 0)) {
        worstPerformer = holding;
      }
    });

    return {
      totalValue: metrics.totalValue,
      totalCost: metrics.totalCost,
      totalReturn: metrics.totalReturn,
      totalReturnPercent,
      dayChange: metrics.dayChange,
      dayChangePercent,
      holdingsCount: holdings.length,
      bestPerformer,
      worstPerformer
    };
  }, [holdings]);

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

  const getChangeIcon = (value) => {
    if (value > 0) return '↗️';
    if (value < 0) return '↘️';
    return '➡️';
  };

  return (
    <div style={{
      backgroundColor: 'var(--bg-secondary)',
      borderRadius: '12px',
      padding: '2rem',
      marginBottom: '2rem',
      border: '1px solid var(--border-color)'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem'
      }}>
        <div>
          <h3 style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            {portfolio?.name || 'Portfolio'}
          </h3>
          <p style={{
            margin: '0.25rem 0 0 0',
            color: 'var(--text-muted)',
            fontSize: '0.9rem'
          }}>
            {portfolio?.description || 'Portfolio overview'}
          </p>
        </div>
        <div style={{
          backgroundColor: 'var(--bg-primary)',
          padding: '0.5rem 1rem',
          borderRadius: '8px',
          fontSize: '0.9rem',
          color: 'var(--text-muted)'
        }}>
          {portfolioMetrics.holdingsCount} holdings
        </div>
      </div>

      {/* Main Metrics */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2rem'
      }}>
        {/* Total Value */}
        <div style={{
          backgroundColor: 'var(--bg-primary)',
          padding: '1.5rem',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{
            fontSize: '0.9rem',
            color: 'var(--text-muted)',
            marginBottom: '0.5rem'
          }}>
            Total Portfolio Value
          </div>
          <div style={{
            fontSize: '2rem',
            fontWeight: '700',
            color: 'var(--text-primary)',
            marginBottom: '0.25rem'
          }}>
            {formatCurrency(portfolioMetrics.totalValue)}
          </div>
          <div style={{
            fontSize: '0.85rem',
            color: 'var(--text-muted)'
          }}>
            Cost Basis: {formatCurrency(portfolioMetrics.totalCost)}
          </div>
        </div>

        {/* Total Return */}
        <div style={{
          backgroundColor: 'var(--bg-primary)',
          padding: '1.5rem',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{
            fontSize: '0.9rem',
            color: 'var(--text-muted)',
            marginBottom: '0.5rem'
          }}>
            Total Return
          </div>
          <div style={{
            fontSize: '2rem',
            fontWeight: '700',
            color: getChangeColor(portfolioMetrics.totalReturn),
            marginBottom: '0.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            {getChangeIcon(portfolioMetrics.totalReturn)}
            {formatCurrency(portfolioMetrics.totalReturn)}
          </div>
          <div style={{
            fontSize: '0.85rem',
            color: getChangeColor(portfolioMetrics.totalReturnPercent)
          }}>
            {formatPercent(portfolioMetrics.totalReturnPercent)}
          </div>
        </div>

        {/* Day Change */}
        <div style={{
          backgroundColor: 'var(--bg-primary)',
          padding: '1.5rem',
          borderRadius: '8px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{
            fontSize: '0.9rem',
            color: 'var(--text-muted)',
            marginBottom: '0.5rem'
          }}>
            Today's Change
          </div>
          <div style={{
            fontSize: '2rem',
            fontWeight: '700',
            color: getChangeColor(portfolioMetrics.dayChange),
            marginBottom: '0.25rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            {getChangeIcon(portfolioMetrics.dayChange)}
            {formatCurrency(portfolioMetrics.dayChange)}
          </div>
          <div style={{
            fontSize: '0.85rem',
            color: getChangeColor(portfolioMetrics.dayChangePercent)
          }}>
            {formatPercent(portfolioMetrics.dayChangePercent)}
          </div>
        </div>
      </div>

      {/* Performance Highlights */}
      {portfolioMetrics.holdingsCount > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1rem'
        }}>
          {/* Best Performer */}
          {portfolioMetrics.bestPerformer && (
            <div style={{
              backgroundColor: 'var(--bg-primary)',
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid #4CAF50'
            }}>
              <div style={{
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
                marginBottom: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                🏆 Best Performer
              </div>
              <div style={{
                fontWeight: '600',
                color: 'var(--text-primary)',
                marginBottom: '0.25rem'
              }}>
                {portfolioMetrics.bestPerformer.symbol}
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: '#4CAF50',
                fontWeight: '600'
              }}>
                {formatPercent(portfolioMetrics.bestPerformer.totalReturnPercent || 0)}
              </div>
            </div>
          )}

          {/* Worst Performer */}
          {portfolioMetrics.worstPerformer && portfolioMetrics.holdingsCount > 1 && (
            <div style={{
              backgroundColor: 'var(--bg-primary)',
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid #f44336'
            }}>
              <div style={{
                fontSize: '0.85rem',
                color: 'var(--text-muted)',
                marginBottom: '0.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem'
              }}>
                📉 Needs Attention
              </div>
              <div style={{
                fontWeight: '600',
                color: 'var(--text-primary)',
                marginBottom: '0.25rem'
              }}>
                {portfolioMetrics.worstPerformer.symbol}
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: '#f44336',
                fontWeight: '600'
              }}>
                {formatPercent(portfolioMetrics.worstPerformer.totalReturnPercent || 0)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {portfolioMetrics.holdingsCount === 0 && (
        <div style={{
          textAlign: 'center',
          padding: '3rem 2rem',
          color: 'var(--text-muted)'
        }}>
          <div style={{
            fontSize: '3rem',
            marginBottom: '1rem'
          }}>
            📊
          </div>
          <h4 style={{
            margin: '0 0 0.5rem 0',
            color: 'var(--text-primary)'
          }}>
            No holdings yet
          </h4>
          <p style={{ margin: 0 }}>
            Add your first stock to start tracking your portfolio performance
          </p>
        </div>
      )}
    </div>
  );
};

export default PortfolioSummary;