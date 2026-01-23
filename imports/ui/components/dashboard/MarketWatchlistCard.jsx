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
    tableContainer: {
      flex: 1,
      overflow: 'auto',
      maxHeight: '220px'
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '13px'
    },
    th: {
      textAlign: 'left',
      padding: '8px 12px',
      fontSize: '11px',
      fontWeight: '600',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: '1px solid var(--border-color)',
      position: 'sticky',
      top: 0,
      backgroundColor: 'var(--bg-secondary)'
    },
    thRight: {
      textAlign: 'right',
      padding: '8px 12px',
      fontSize: '11px',
      fontWeight: '600',
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '0.5px',
      borderBottom: '1px solid var(--border-color)',
      position: 'sticky',
      top: 0,
      backgroundColor: 'var(--bg-secondary)'
    },
    tr: {
      cursor: 'pointer',
      transition: 'background-color 0.15s'
    },
    td: {
      padding: '10px 12px',
      borderBottom: '1px solid var(--border-color)',
      color: 'var(--text-primary)'
    },
    tdRight: {
      padding: '10px 12px',
      borderBottom: '1px solid var(--border-color)',
      textAlign: 'right'
    },
    tickerCell: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    },
    logo: {
      width: '28px',
      height: '28px',
      borderRadius: '6px',
      backgroundColor: 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '10px',
      fontWeight: '700',
      color: 'var(--text-muted)',
      overflow: 'hidden',
      flexShrink: 0
    },
    logoImg: {
      width: '100%',
      height: '100%',
      objectFit: 'contain'
    },
    tickerInfo: {
      minWidth: 0
    },
    symbol: {
      fontSize: '13px',
      fontWeight: '600',
      color: 'var(--text-primary)'
    },
    tickerCode: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      marginTop: '1px'
    },
    price: {
      fontSize: '13px',
      color: 'var(--text-primary)',
      fontWeight: '500'
    },
    change: (isPositive) => ({
      fontSize: '13px',
      fontWeight: '600',
      color: isPositive ? '#10b981' : '#ef4444'
    }),
    emptyState: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '30px 20px',
      color: 'var(--text-muted)',
      textAlign: 'center',
      flex: 1
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

      {!watchlist || watchlist.length === 0 ? (
        <div style={styles.emptyState}>
          <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span>No securities in watchlist</span>
        </div>
      ) : (
        <div style={styles.tableContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Security</th>
                <th style={styles.thRight}>Price</th>
                <th style={styles.thRight}>Daily</th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map((ticker, idx) => (
                <tr
                  key={idx}
                  style={styles.tr}
                  onClick={() => onTickerClick?.(ticker)}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <td style={styles.td}>
                    <div style={styles.tickerCell}>
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
                        <div style={styles.symbol}>{ticker.name || ticker.symbol}</div>
                        <div style={styles.tickerCode}>{ticker.symbol}</div>
                      </div>
                    </div>
                  </td>
                  <td style={styles.tdRight}>
                    <span style={styles.price}>{formatPrice(ticker.price)}</span>
                  </td>
                  <td style={styles.tdRight}>
                    <span style={styles.change(ticker.changePercent >= 0)}>
                      {formatChange(ticker.changePercent)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MarketWatchlistCard;
