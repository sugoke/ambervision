import React, { useEffect, useState, useRef } from 'react';
import { Meteor } from 'meteor/meteor';

const INSTRUMENTS = [
  { symbol: 'GSPC.INDX',    name: 'S&P 500',       code: 'SPX',    digits: 2 },
  { symbol: 'STOXX50E.INDX', name: 'Euro Stoxx 50', code: 'SX5E',  digits: 2 },
  { symbol: 'FCHI.INDX',    name: 'CAC 40',        code: 'CAC',    digits: 2 },
  { symbol: 'GDAXI.INDX',   name: 'DAX',           code: 'DAX',    digits: 2 },
  { symbol: 'EURUSD.FOREX', name: 'EUR/USD',       code: 'EURUSD', digits: 4 },
  { symbol: 'GC.COMM',      name: 'Gold',          code: 'XAU',    digits: 2 },
  { symbol: 'CL.COMM',      name: 'WTI Crude',     code: 'WTI',    digits: 2 }
];

const REFRESH_INTERVAL_MS = 60 * 1000;

const toNumber = (v) => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const formatPrice = (price, digits = 2) => {
  const n = toNumber(price);
  if (n == null) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  });
};

const formatChange = (change) => {
  const n = toNumber(change);
  if (n == null) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
};

const isSameUtcDay = (timestamp) => {
  if (!timestamp) return false;
  const ts = typeof timestamp === 'number' ? timestamp * 1000 : Date.parse(timestamp);
  if (Number.isNaN(ts)) return false;
  const tsDate = new Date(ts);
  const now = new Date();
  return tsDate.getUTCFullYear() === now.getUTCFullYear()
    && tsDate.getUTCMonth() === now.getUTCMonth()
    && tsDate.getUTCDate() === now.getUTCDate();
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
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  tableContainer: {
    flex: 1,
    overflow: 'auto',
    maxHeight: '340px'
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
  priceWrap: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    justifyContent: 'flex-end'
  },
  closeTag: {
    fontSize: '9px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '1px 5px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    lineHeight: 1
  },
  change: (isPositive, isNeutral) => ({
    fontSize: '13px',
    fontWeight: '600',
    color: isNeutral ? 'var(--text-muted)' : isPositive ? '#10b981' : '#ef4444'
  }),
  statusDot: (isLive) => ({
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: isLive ? '#10b981' : '#94a3b8',
    flexShrink: 0
  })
};

const MarketWatch = () => {
  const [quotes, setQuotes] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const fetchQuotes = async () => {
      try {
        const symbols = INSTRUMENTS.map(i => i.symbol);
        const result = await Meteor.callAsync('eod.getMultiplePrices', symbols);
        if (!mountedRef.current) return;
        if (result && result.success) {
          setQuotes(result.data || {});
          setLastUpdated(new Date());
        }
      } catch (err) {
        console.error('[MarketWatch] fetch failed:', err);
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    };

    fetchQuotes();
    const interval = setInterval(fetchQuotes, REFRESH_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, []);

  const anyLive = INSTRUMENTS.some(inst => {
    const q = quotes[inst.symbol];
    return q && isSameUtcDay(q.timestamp);
  });

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span style={styles.title}>Market Watch</span>
        <span style={styles.subtitle}>
          <span style={styles.statusDot(anyLive)} />
          {isLoading && !lastUpdated
            ? 'Loading…'
            : anyLive
              ? 'Live'
              : 'Last close'}
          {lastUpdated && (
            <span style={{ color: 'var(--text-muted)', marginLeft: '4px' }}>
              · {lastUpdated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </span>
      </div>

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
            {INSTRUMENTS.map((inst) => {
              const q = quotes[inst.symbol];
              const price = q ? toNumber(q.close ?? q.price) : null;
              const changePct = q ? toNumber(q.changePercent) : null;
              const isNeutral = changePct == null;
              const isPositive = !isNeutral && changePct >= 0;
              const isLive = q && isSameUtcDay(q.timestamp);
              const closeLabel = !isLive && q
                ? (() => {
                    const ts = typeof q.timestamp === 'number'
                      ? q.timestamp * 1000
                      : Date.parse(q.timestamp);
                    if (!Number.isFinite(ts)) return 'CLOSE';
                    return `CLOSE ${new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
                  })()
                : null;

              return (
                <tr
                  key={inst.symbol}
                  style={styles.tr}
                  onMouseOver={(e) => {
                    e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                  }}
                  onMouseOut={(e) => {
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <td style={styles.td}>
                    <div style={styles.tickerCell}>
                      <div style={styles.logo}>{inst.code.slice(0, 3)}</div>
                      <div style={styles.tickerInfo}>
                        <div style={styles.symbol}>{inst.name}</div>
                        <div style={styles.tickerCode}>{inst.code}</div>
                      </div>
                    </div>
                  </td>
                  <td style={styles.tdRight}>
                    <span style={styles.priceWrap}>
                      {closeLabel && (
                        <span
                          style={styles.closeTag}
                          title="Market closed — last closing price"
                        >
                          {closeLabel}
                        </span>
                      )}
                      <span style={styles.price}>{formatPrice(price, inst.digits)}</span>
                    </span>
                  </td>
                  <td style={styles.tdRight}>
                    <span style={styles.change(isPositive, isNeutral)}>
                      {formatChange(changePct)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MarketWatch;
