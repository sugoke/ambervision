import React, { useState } from 'react';

const CURRENCIES = [
  { code: 'CHF', symbol: 'CHF', locale: 'de-CH', icon: 'CHF' },
  { code: 'EUR', symbol: '€', locale: 'de-DE', icon: '€' },
  { code: 'USD', symbol: '$', locale: 'en-US', icon: '$' },
  { code: 'GBP', symbol: '£', locale: 'en-GB', icon: '£' }
];

const PortfolioSummaryCard = ({ summary }) => {
  const [currency, setCurrency] = useState(() => {
    return localStorage.getItem('dashboardCurrency') || 'CHF';
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleCurrencyChange = (newCurrency) => {
    setCurrency(newCurrency);
    localStorage.setItem('dashboardCurrency', newCurrency);
    setDropdownOpen(false);
  };

  const currentCurrency = CURRENCIES.find(c => c.code === currency) || CURRENCIES[0];

  const formatCurrency = (value) => {
    if (!value) return `${currentCurrency.code} 0`;
    return new Intl.NumberFormat(currentCurrency.locale, {
      style: 'currency',
      currency: currentCurrency.code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
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

  const stats = [
    {
      label: 'Total AUM',
      value: formatCurrency(summary?.totalAUM),
      icon: getCurrencyIcon(),
      fullWidth: true,
      color: '#10b981'
    },
    {
      label: 'Clients',
      value: summary?.clientCount || 0,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
      color: '#3b82f6'
    },
    {
      label: 'Live',
      value: summary?.liveProducts || 0,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      ),
      color: '#10b981'
    },
    {
      label: 'Autocalled',
      value: summary?.autocalledProducts || 0,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      ),
      color: '#8b5cf6'
    },
    {
      label: 'Matured',
      value: summary?.maturedProducts || 0,
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      ),
      color: '#6b7280'
    }
  ];

  const styles = {
    card: {
      backgroundColor: 'var(--bg-secondary)',
      borderRadius: '12px',
      padding: '20px',
      border: '1px solid var(--border-color)',
      height: '100%'
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
      color: 'var(--text-primary)',
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
      gap: '12px'
    }),
    iconWrapper: (color) => ({
      width: '36px',
      height: '36px',
      borderRadius: '8px',
      backgroundColor: `${color}20`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: color
    }),
    statContent: {
      display: 'flex',
      flexDirection: 'column'
    },
    statValue: (fullWidth) => ({
      fontSize: fullWidth ? '22px' : '18px',
      fontWeight: '600',
      color: 'var(--text-primary)'
    }),
    statLabel: {
      fontSize: '12px',
      color: 'var(--text-muted)',
      marginTop: '2px'
    }
  };

  return (
    <div style={styles.card}>
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

      <div style={styles.grid}>
        {stats.map((stat, idx) => (
          <div key={idx} style={styles.statCard(stat.fullWidth, stat.color)}>
            <div style={styles.iconWrapper(stat.color)}>
              {stat.icon}
            </div>
            <div style={styles.statContent}>
              <span style={styles.statValue(stat.fullWidth)}>{stat.value}</span>
              <span style={styles.statLabel}>{stat.label}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PortfolioSummaryCard;
