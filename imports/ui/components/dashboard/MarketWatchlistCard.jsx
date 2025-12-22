import React from 'react';

const MarketWatchlistCard = ({ watchlist, onTickerClick }) => {
  const formatPrice = (price) => {
    if (!price && price !== 0) return '-';
    return price.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const formatChange = (change) => {
    if (!change && change !== 0) return '0.00%';
    const sign = change >= 0 ? '+' : '';
    return `${sign}${change.toFixed(2)}%`;
  };

  const styles = {
    card: {
      backgroundColor: 'var(--bg-secondary)',
      borderRadius: '12px',
      padding: '20px',
      border: '1px solid var(--border-color)',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    },
    header: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      marginBottom: '16px'
    },
    title: {
      fontSize: '16px',
      fontWeight: '600',
      color: 'var(--text-primary)'
    },
    subtitle: {
      fontSize: '12px',
      color: 'var(--text-muted)',
      marginLeft: 'auto'
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '8px',
      flex: 1,
      overflow: 'auto',
      maxHeight: '220px'
    },
    tickerItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px',
      borderRadius: '8px',
      backgroundColor: 'var(--bg-tertiary)',
      cursor: 'pointer',
      transition: 'transform 0.15s, background-color 0.15s'
    },
    logo: {
      width: '32px',
      height: '32px',
      borderRadius: '8px',
      backgroundColor: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '12px',
      fontWeight: '700',
      color: 'var(--text-muted)',
      overflow: 'hidden'
    },
    logoImg: {
      width: '100%',
      height: '100%',
      objectFit: 'contain'
    },
    tickerInfo: {
      flex: 1,
      minWidth: 0
    },
    symbol: {
      fontSize: '13px',
      fontWeight: '600',
      color: 'var(--text-primary)'
    },
    price: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      marginTop: '2px'
    },
    change: (isPositive) => ({
      fontSize: '12px',
      fontWeight: '600',
      color: isPositive ? '#10b981' : '#ef4444',
      textAlign: 'right',
      whiteSpace: 'nowrap'
    }),
    emptyState: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '30px 20px',
      color: 'var(--text-muted)',
      textAlign: 'center',
      flex: 1,
      gridColumn: '1 / -1'
    },
    emptyIcon: {
      width: '40px',
      height: '40px',
      marginBottom: '12px',
      opacity: 0.5
    }
  };

  const getTickerInitials = (symbol) => {
    if (!symbol) return '?';
    return symbol.slice(0, 2).toUpperCase();
  };

  const getLogoUrl = (fullTicker) => {
    if (!fullTicker) return null;
    const symbol = fullTicker.split('.')[0].toLowerCase();
    return `https://eodhistoricaldata.com/img/logos/US/${symbol}.png`;
  };

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span style={styles.title}>Market Watchlist</span>
        <span style={styles.subtitle}>from client holdings</span>
      </div>

      <div style={styles.grid}>
        {!watchlist || watchlist.length === 0 ? (
          <div style={styles.emptyState}>
            <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <span>No securities in watchlist</span>
          </div>
        ) : (
          watchlist.map((ticker, idx) => (
            <div
              key={idx}
              style={styles.tickerItem}
              onClick={() => onTickerClick?.(ticker)}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'scale(1.02)';
                e.currentTarget.style.backgroundColor = 'var(--bg-primary)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
              }}
            >
              <div style={styles.logo}>
                <img
                  src={getLogoUrl(ticker.fullTicker)}
                  alt={ticker.symbol}
                  style={styles.logoImg}
                  onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.parentElement.textContent = getTickerInitials(ticker.symbol);
                  }}
                />
              </div>
              <div style={styles.tickerInfo}>
                <div style={styles.symbol} title={ticker.symbol}>{ticker.name || ticker.symbol}</div>
                <div style={styles.price}>{ticker.symbol} · {formatPrice(ticker.price)}</div>
              </div>
              <div style={styles.change(ticker.changePercent >= 0)}>
                {formatChange(ticker.changePercent)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MarketWatchlistCard;
