import React, { useState } from 'react';

const CashMonitoringCard = ({ cashData, onAccountClick }) => {
  const [activeTab, setActiveTab] = useState('negative');

  const { negativeCashAccounts = [], highCashAccounts = [] } = cashData || {};

  // Split negative accounts: those WITH credit line vs those WITHOUT
  const negativesWithoutCredit = negativeCashAccounts.filter(a => !a.authorizedOverdraftEUR || a.authorizedOverdraftEUR <= 0);
  const negativesWithCredit = negativeCashAccounts.filter(a => a.authorizedOverdraftEUR > 0);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: 0
    }).format(value);
  };

  const getUtilizationColor = (percent, isWithinLimit) => {
    if (!isWithinLimit) return '#ef4444'; // Red - exceeded
    if (percent >= 80) return '#f59e0b'; // Orange - warning
    return '#10b981'; // Green - OK
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
      justifyContent: 'space-between',
      marginBottom: '16px',
      flexWrap: 'wrap',
      gap: '8px'
    },
    title: {
      fontSize: '16px',
      fontWeight: '600',
      color: 'var(--text-primary)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      flexShrink: 0
    },
    tabContainer: {
      display: 'flex',
      gap: '2px',
      backgroundColor: 'var(--bg-tertiary)',
      padding: '3px',
      borderRadius: '8px',
      flexShrink: 0
    },
    tab: (isActive) => ({
      padding: '5px 8px',
      borderRadius: '6px',
      fontSize: '11px',
      fontWeight: '500',
      cursor: 'pointer',
      border: 'none',
      backgroundColor: isActive ? 'var(--bg-secondary)' : 'transparent',
      color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
      transition: 'all 0.15s ease',
      display: 'flex',
      alignItems: 'center',
      gap: '3px',
      whiteSpace: 'nowrap'
    }),
    badge: (color) => ({
      backgroundColor: color,
      color: '#fff',
      padding: '1px 5px',
      borderRadius: '8px',
      fontSize: '9px',
      fontWeight: '600',
      minWidth: '14px',
      textAlign: 'center'
    }),
    accountsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      flex: 1,
      overflow: 'auto',
      maxHeight: '220px'
    },
    accountItem: (severity) => ({
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px',
      borderRadius: '8px',
      backgroundColor: severity === 'critical'
        ? 'rgba(239, 68, 68, 0.1)'
        : severity === 'warning'
          ? 'rgba(245, 158, 11, 0.1)'
          : 'rgba(59, 130, 246, 0.1)',
      borderLeft: `3px solid ${
        severity === 'critical' ? '#ef4444' : severity === 'warning' ? '#f59e0b' : '#3b82f6'
      }`,
      cursor: 'pointer',
      transition: 'opacity 0.15s'
    }),
    accountInfo: {
      flex: 1,
      minWidth: 0
    },
    clientName: {
      fontSize: '13px',
      fontWeight: '500',
      color: 'var(--text-primary)',
      marginBottom: '2px'
    },
    accountNumber: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    },
    bankTag: {
      backgroundColor: 'var(--bg-tertiary)',
      padding: '1px 6px',
      borderRadius: '4px',
      fontSize: '10px'
    },
    amountSection: {
      textAlign: 'right'
    },
    amount: (isNegative) => ({
      fontSize: '14px',
      fontWeight: '600',
      color: isNegative ? '#ef4444' : '#10b981'
    }),
    limitInfo: {
      fontSize: '10px',
      color: 'var(--text-muted)',
      marginTop: '2px'
    },
    utilizationBar: {
      width: '60px',
      height: '4px',
      backgroundColor: 'var(--bg-tertiary)',
      borderRadius: '2px',
      overflow: 'hidden',
      marginTop: '4px',
      marginLeft: 'auto'
    },
    utilizationFill: (percent, color) => ({
      width: `${Math.min(percent, 100)}%`,
      height: '100%',
      backgroundColor: color,
      borderRadius: '2px'
    }),
    emptyState: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '30px 20px',
      color: 'var(--text-muted)',
      textAlign: 'center'
    },
    emptyIcon: {
      width: '40px',
      height: '40px',
      marginBottom: '12px',
      opacity: 0.5
    },
    sectionNote: {
      fontSize: '10px',
      color: 'var(--text-muted)',
      fontStyle: 'italic',
      marginBottom: '8px',
      display: 'flex',
      alignItems: 'center',
      gap: '4px'
    }
  };

  const renderNegativeCashAccounts = () => {
    if (negativesWithoutCredit.length === 0) {
      return (
        <div style={styles.emptyState}>
          <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>No unauthorized overdrafts</span>
        </div>
      );
    }

    return (
      <>
        <div style={styles.sectionNote}>
          <span>Cash balances only</span>
        </div>
        {negativesWithoutCredit.slice(0, 5).map((account, idx) => (
      <div
        key={idx}
        style={styles.accountItem('critical')}
        onClick={() => onAccountClick?.(account)}
        onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'}
        onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
      >
        <div style={styles.accountInfo}>
          <div style={styles.clientName}>{account.clientName}</div>
          <div style={styles.accountNumber}>
            {account.accountNumber}
            <span style={styles.bankTag}>{account.bankName}</span>
          </div>
        </div>
        <div style={styles.amountSection}>
          <div style={styles.amount(true)}>{formatCurrency(account.totalCashEUR)}</div>
          <div style={styles.limitInfo}>No credit limit</div>
        </div>
      </div>
        ))}
      </>
    );
  };

  const renderCreditLineAccounts = () => {
    if (negativesWithCredit.length === 0) {
      return (
        <div style={styles.emptyState}>
          <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>No credit lines in use</span>
        </div>
      );
    }

    return (
      <>
        <div style={styles.sectionNote}>
          <span>Cash balances only</span>
        </div>
        {negativesWithCredit.slice(0, 5).map((account, idx) => {
          const severity = !account.isWithinLimit ? 'critical' : account.utilizationPercent >= 80 ? 'warning' : 'info';
          const utilizationColor = getUtilizationColor(account.utilizationPercent, account.isWithinLimit);

          return (
            <div
              key={idx}
              style={styles.accountItem(severity)}
              onClick={() => onAccountClick?.(account)}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              <div style={styles.accountInfo}>
                <div style={styles.clientName}>{account.clientName}</div>
                <div style={styles.accountNumber}>
                  {account.accountNumber}
                  <span style={styles.bankTag}>{account.bankName}</span>
                </div>
              </div>
              <div style={styles.amountSection}>
                <div style={styles.amount(true)}>{formatCurrency(account.totalCashEUR)}</div>
                <div style={styles.limitInfo}>
                  Limit: {formatCurrency(account.authorizedOverdraftEUR)}
                </div>
                <div style={styles.utilizationBar}>
                  <div style={styles.utilizationFill(account.utilizationPercent, utilizationColor)} />
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  };

  const renderHighCashAccounts = () => {
    if (highCashAccounts.length === 0) {
      return (
        <div style={styles.emptyState}>
          <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>No accounts with excess cash (&gt;200k)</span>
        </div>
      );
    }

    return (
      <>
        <div style={styles.sectionNote}>
          <span>Includes money market & deposits</span>
        </div>
        {highCashAccounts.slice(0, 5).map((account, idx) => (
          <div
            key={idx}
            style={styles.accountItem('info')}
            onClick={() => onAccountClick?.(account)}
            onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'}
            onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
          >
            <div style={styles.accountInfo}>
              <div style={styles.clientName}>{account.clientName}</div>
              <div style={styles.accountNumber}>
                {account.accountNumber}
                <span style={styles.bankTag}>{account.bankName}</span>
              </div>
            </div>
            <div style={styles.amountSection}>
              <div style={styles.amount(false)}>{formatCurrency(account.totalCashEUR)}</div>
              <div style={styles.limitInfo}>
                +{formatCurrency(account.excessAmount)} above 200k
              </div>
            </div>
          </div>
        ))}
      </>
    );
  };

  const negativeCount = negativesWithoutCredit.length;
  const creditLineCount = negativesWithCredit.length;
  const highCount = highCashAccounts.length;
  const hasExceededLimit = negativesWithCredit.some(a => !a.isWithinLimit);

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.title}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Cash Monitor
        </span>
        <div style={styles.tabContainer}>
          <button
            style={styles.tab(activeTab === 'negative')}
            onClick={() => setActiveTab('negative')}
          >
            Negative
            {negativeCount > 0 && (
              <span style={styles.badge('#ef4444')}>
                {negativeCount}
              </span>
            )}
          </button>
          <button
            style={styles.tab(activeTab === 'credit')}
            onClick={() => setActiveTab('credit')}
          >
            Credit
            {creditLineCount > 0 && (
              <span style={styles.badge(hasExceededLimit ? '#ef4444' : '#f59e0b')}>
                {creditLineCount}
              </span>
            )}
          </button>
          <button
            style={styles.tab(activeTab === 'high')}
            onClick={() => setActiveTab('high')}
          >
            High
            {highCount > 0 && (
              <span style={styles.badge('#3b82f6')}>
                {highCount}
              </span>
            )}
          </button>
        </div>
      </div>

      <div style={styles.accountsList}>
        {activeTab === 'negative' && renderNegativeCashAccounts()}
        {activeTab === 'credit' && renderCreditLineAccounts()}
        {activeTab === 'high' && renderHighCashAccounts()}
      </div>
    </div>
  );
};

export default CashMonitoringCard;
