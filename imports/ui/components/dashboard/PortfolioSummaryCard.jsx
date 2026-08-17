import React, { useState } from 'react';

const CURRENCIES = [
  { code: 'CHF', symbol: 'CHF', locale: 'de-CH', icon: 'CHF' },
  { code: 'EUR', symbol: '€', locale: 'de-DE', icon: '€' },
  { code: 'USD', symbol: '$', locale: 'en-US', icon: '$' },
  { code: 'GBP', symbol: '£', locale: 'en-GB', icon: '£' }
];

const PortfolioSummaryCard = ({ summary, onCurrencyChange, selectedCurrency, userCurrency, hideClientsCount = false, alertsCount = 0, nextEvent = null }) => {
  // Use selectedCurrency prop if provided, otherwise fall back to localStorage, then user's referenceCurrency
  const [localCurrency, setLocalCurrency] = useState(() => {
    return localStorage.getItem('dashboardCurrency') || userCurrency || 'EUR';
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Use prop if provided, otherwise use local state
  const currency = selectedCurrency || localCurrency;

  const handleCurrencyChange = (newCurrency) => {
    setLocalCurrency(newCurrency);
    localStorage.setItem('dashboardCurrency', newCurrency);
    setDropdownOpen(false);
    // Notify parent to refresh data with new currency
    if (onCurrencyChange) {
      onCurrencyChange(newCurrency);
    }
  };

  const currentCurrency = CURRENCIES.find(c => c.code === currency) || CURRENCIES[0];

  const formatCurrency = (value, compact = false) => {
    if (!value) return `${currentCurrency.code} 0`;
    return new Intl.NumberFormat(currentCurrency.locale, {
      style: 'currency',
      currency: currentCurrency.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
      notation: compact ? 'compact' : 'standard'
    }).format(value);
  };

  const formatPercent = (value) => {
    if (value === null || value === undefined) return null;
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
  };

  // Dynamic icon based on selected currency
  const getCurrencyIcon = () => {
    const icon = currentCurrency.icon;
    if (icon.length === 1) {
      // Single character symbol (€, $, £)
      return <span style={{ fontSize: '20px', fontWeight: '700' }}>{icon}</span>;
    }
    // Multi-character (CHF)
    return <span style={{ fontSize: '12px', fontWeight: '700' }}>{icon}</span>;
  };

  // Calculate variation display
  const hasVariation = summary?.previousAUM !== null && summary?.previousAUM !== undefined;
  const variationIsPositive = summary?.aumChange >= 0;
  const variationColor = variationIsPositive ? 'var(--gain-color)' : 'var(--loss-color)';

  // Secondary tiles. Deliberately NOT the old Clients/Live/Autocalled/Matured
  // counts — static inventory numbers that never changed day to day. These three
  // answer the morning questions instead: what moved, what needs me, what's next.
  // All are scoped to the active View As perimeter by the dashboard methods.
  const dayChangeIsPositive = (summary?.aumChange ?? 0) >= 0;
  const stats = [
    {
      label: 'Total AUM',
      value: formatCurrency(summary?.totalAUM),
      icon: getCurrencyIcon(),
      fullWidth: true,
      color: 'var(--gain-color)',
      variation: hasVariation ? {
        change: summary?.aumChange,
        percent: summary?.aumChangePercent,
        isPositive: variationIsPositive,
        color: variationColor
      } : null
    },
    {
      label: 'Day P&L',
      value: hasVariation
        ? `${dayChangeIsPositive ? '+' : ''}${formatCurrency(summary?.aumChange, true)}`
        : '—',
      sub: hasVariation && summary?.aumChangePercent != null
        ? `${dayChangeIsPositive ? '+' : ''}${summary.aumChangePercent.toFixed(2)}% vs yesterday`
        : 'no comparison snapshot',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      ),
      color: hasVariation ? (dayChangeIsPositive ? 'var(--gain-color)' : 'var(--loss-color)') : 'var(--neutral-color)'
    },
    {
      label: 'Active alerts',
      value: alertsCount,
      sub: alertsCount === 0 ? 'nothing needs attention' : 'needs attention',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
      ),
      color: alertsCount > 0 ? 'var(--warning-color)' : 'var(--gain-color)'
    },
    {
      label: 'Next observation',
      value: nextEvent ? nextEvent.daysLeftText : '—',
      sub: nextEvent ? nextEvent.productTitle : 'none scheduled',
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
      color: 'var(--info-color)'
    }
  ];

  const styles = {
    card: {
      background: 'var(--card-bg, var(--bg-secondary))',
      borderRadius: 'var(--radius, 14px)',
      padding: '22px',
      border: '1px solid var(--border-color)',
      boxShadow: 'var(--card-shadow)',
      height: '100%'
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
      color: 'var(--text-muted)',
      flex: 1
    },
    currencySelector: {
      position: 'relative'
    },
    currencyButton: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
      padding: '4px 8px',
      backgroundColor: 'var(--bg-tertiary)',
      border: '1px solid var(--border-color)',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '12px',
      fontWeight: '500',
      color: 'var(--text-secondary)',
      transition: 'background-color 0.15s'
    },
    currencyDropdown: {
      position: 'absolute',
      top: '100%',
      right: 0,
      marginTop: '4px',
      backgroundColor: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '8px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
      zIndex: 10,
      minWidth: '80px',
      overflow: 'hidden'
    },
    currencyOption: (isSelected) => ({
      padding: '8px 12px',
      cursor: 'pointer',
      fontSize: '12px',
      color: isSelected ? 'var(--accent-color)' : 'var(--text-primary)',
      backgroundColor: isSelected ? 'var(--bg-tertiary)' : 'transparent',
      transition: 'background-color 0.15s',
      fontWeight: isSelected ? '600' : '400'
    }),
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, 1fr)',
      gap: '12px'
    },
    statCard: (fullWidth, color) => ({
      gridColumn: fullWidth ? '1 / -1' : 'auto',
      backgroundColor: 'var(--bg-tertiary)',
      borderRadius: '8px',
      padding: fullWidth ? '16px' : '12px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      minWidth: 0 // allow the flex row to shrink so children can ellipsize, not overflow
    }),
    iconWrapper: (color) => ({
      width: '36px',
      height: '36px',
      borderRadius: '8px',
      backgroundColor: `color-mix(in srgb, ${color} 13%, transparent)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: color,
      flexShrink: 0 // keep the icon square when the row is tight
    }),
    statContent: {
      display: 'flex',
      flexDirection: 'column',
      minWidth: 0, // critical: lets nowrap value/sub text ellipsize within the cell
      flex: 1
    },
    // The AUM figure is the statement of the whole dashboard — serif display voice,
    // like the proposal's hero value. Secondary stats keep the serif at a smaller size.
    statValue: (fullWidth) => ({
      fontFamily: 'var(--font-serif)',
      // Lower clamp floor so the AUM figure scales down on phones instead of overflowing.
      fontSize: fullWidth ? 'clamp(22px, 6vw, 42px)' : 'clamp(17px, 5vw, 22px)',
      fontWeight: '500',
      letterSpacing: fullWidth ? '-0.5px' : '0',
      lineHeight: 1.05,
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--text-primary)',
      // Ellipsize rather than spill out of the cell.
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }),
    statLabel: {
      fontSize: '12px',
      color: 'var(--text-muted)',
      marginTop: '2px'
    }
  };

  return (
    <div style={styles.card}>
      {/* Collapse the 2-col stat grid to a single column on phones so the tiles
          (and the AUM figure) never get squeezed into overflowing cells. */}
      <style>{`
        @media (max-width: 600px) {
          .ps-summary-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
      <div style={styles.header}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
          <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
          <line x1="12" y1="22.08" x2="12" y2="12" />
        </svg>
        <span style={styles.title}>Portfolio Summary</span>

        {/* Currency Selector */}
        <div style={styles.currencySelector}>
          <button
            style={styles.currencyButton}
            onClick={() => setDropdownOpen(!dropdownOpen)}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-primary)'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
          >
            {currentCurrency.code}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {dropdownOpen && (
            <div style={styles.currencyDropdown}>
              {CURRENCIES.map((curr) => (
                <div
                  key={curr.code}
                  style={styles.currencyOption(curr.code === currency)}
                  onClick={() => handleCurrencyChange(curr.code)}
                  onMouseOver={(e) => {
                    if (curr.code !== currency) {
                      e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                    }
                  }}
                  onMouseOut={(e) => {
                    if (curr.code !== currency) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  {curr.code}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div style={styles.grid} className="ps-summary-grid">
        {stats.map((stat, idx) => (
          <div key={idx} style={styles.statCard(stat.fullWidth, stat.color)}>
            <div style={styles.iconWrapper(stat.color)}>
              {stat.icon}
            </div>
            <div style={styles.statContent}>
              <span style={{
                ...styles.statValue(stat.fullWidth),
                // Day P&L reads pos/neg at a glance, like the proposal's chips
                ...(stat.label === 'Day P&L' ? { color: stat.color } : {})
              }}>{stat.value}</span>
              <span style={styles.statLabel}>{stat.label}</span>
              {stat.sub && (
                <span style={{
                  fontSize: '11px',
                  color: 'var(--text-muted)',
                  marginTop: '2px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '100%'
                }}>{stat.sub}</span>
              )}
              {/* Day-over-day variation for AUM */}
              {stat.variation && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  marginTop: '4px',
                  fontSize: '12px',
                  flexWrap: 'wrap' // vs-yesterday detail wraps under on narrow cards
                }}>
                  <span style={{
                    color: stat.variation.color,
                    fontWeight: '600',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '2px'
                  }}>
                    {stat.variation.isPositive ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    )}
                    {formatPercent(stat.variation.percent)}
                  </span>
                  <span style={{ color: 'var(--text-muted)' }}>
                    ({stat.variation.isPositive ? '+' : ''}{formatCurrency(stat.variation.change, true)})
                  </span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '11px' }}>
                    vs {summary?.comparisonDateLabel || 'yesterday'}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PortfolioSummaryCard;
