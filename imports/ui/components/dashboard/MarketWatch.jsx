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

const getCloseLabel = (q) => {
  if (!q || isSameUtcDay(q.timestamp)) return null;
  const ts = typeof q.timestamp === 'number' ? q.timestamp * 1000 : Date.parse(q.timestamp);
  if (!Number.isFinite(ts)) return 'CLOSE';
  return `CLOSE ${new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}`;
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
    background: 'var(--card-bg, var(--bg-secondary))',
    borderRadius: 'var(--radius, 14px)',
    padding: '22px',
    border: '1px solid var(--border-color)',
    boxShadow: 'var(--card-shadow)',
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
    fontSize: '11.5px',
    fontWeight: '600',
    letterSpacing: '1.8px',
    textTransform: 'uppercase',
    color: 'var(--text-muted)'
  },
  subtitle: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    marginLeft: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: 'auto'
  },
  idxGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '1px',
    background: 'var(--border-color)',
    border: '1px solid var(--border-color)',
    borderRadius: '9px',
    overflow: 'hidden'
  },
  idxCell: {
    background: 'var(--bg-tertiary)',
    padding: '14px'
  },
  idxName: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    minWidth: 0
  },
  idxNameText: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  idxValue: {
    fontFamily: 'var(--font-serif)',
    fontSize: '22px',
    fontWeight: '500',
    color: 'var(--text-primary)',
    marginTop: '3px',
    fontVariantNumeric: 'tabular-nums'
  },
  idxChange: (isPositive, isNeutral) => ({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12px',
    marginTop: '2px',
    color: isNeutral ? 'var(--text-muted)' : isPositive ? 'var(--gain-color)' : 'var(--loss-color)'
  }),
  wl: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    marginTop: '14px'
  },
  wlRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '9px 6px',
    borderRadius: '8px',
    transition: 'background-color 0.15s'
  },
  wlTicker: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '13px',
    fontWeight: '600',
    letterSpacing: '0.5px',
    width: '64px',
    flex: 'none',
    color: 'var(--text-primary)'
  },
  wlName: {
    fontSize: '12.5px',
    color: 'var(--text-muted)',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  wlPrice: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '13px',
    color: 'var(--text-primary)',
    fontVariantNumeric: 'tabular-nums'
  },
  wlChange: (isPositive, isNeutral) => ({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12.5px',
    width: '66px',
    textAlign: 'right',
    color: isNeutral ? 'var(--text-muted)' : isPositive ? 'var(--gain-color)' : 'var(--loss-color)'
  }),
  closeTag: {
    fontSize: '9px',
    fontWeight: '700',
    color: 'var(--text-muted)',
    background: 'var(--bg-secondary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '1px 5px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    lineHeight: 1,
    flex: 'none'
  },
  statusDot: (isLive) => ({
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    background: isLive ? 'var(--gain-color)' : 'var(--neutral-color)',
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

      <div style={styles.body}>
        {/* Index grid — big serif values, like the Morning Desk proposal */}
        <div style={styles.idxGrid}>
          {INSTRUMENTS.slice(0, 4).map((inst) => {
            const q = quotes[inst.symbol];
            const price = q ? toNumber(q.close ?? q.price) : null;
            const changePct = q ? toNumber(q.changePercent) : null;
            const isNeutral = changePct == null;
            const isPositive = !isNeutral && changePct >= 0;
            const closeLabel = getCloseLabel(q);

            return (
              <div key={inst.symbol} style={styles.idxCell}>
                <div style={styles.idxName}>
                  <span style={styles.idxNameText}>{inst.name}</span>
                  {closeLabel && (
                    <span style={styles.closeTag} title="Market closed — last closing price">
                      {closeLabel}
                    </span>
                  )}
                </div>
                <div style={styles.idxValue}>{formatPrice(price, inst.digits)}</div>
                <div style={styles.idxChange(isPositive, isNeutral)}>{formatChange(changePct)}</div>
              </div>
            );
          })}
        </div>

        {/* Compact watchlist rows for FX / commodities */}
        <div style={styles.wl}>
          {INSTRUMENTS.slice(4).map((inst) => {
            const q = quotes[inst.symbol];
            const price = q ? toNumber(q.close ?? q.price) : null;
            const changePct = q ? toNumber(q.changePercent) : null;
            const isNeutral = changePct == null;
            const isPositive = !isNeutral && changePct >= 0;
            const closeLabel = getCloseLabel(q);

            return (
              <div
                key={inst.symbol}
                style={styles.wlRow}
                title={closeLabel ? `Market closed — last closing price (${closeLabel})` : undefined}
                onMouseOver={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'; }}
                onMouseOut={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <span style={styles.wlTicker}>{inst.code}</span>
                <span style={styles.wlName}>{inst.name}</span>
                <span style={styles.wlPrice}>{formatPrice(price, inst.digits)}</span>
                <span style={styles.wlChange(isPositive, isNeutral)}>{formatChange(changePct)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MarketWatch;
