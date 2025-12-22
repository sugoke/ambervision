import React from 'react';

const AlertsCard = ({ alerts, onAlertClick }) => {
  // Format date for display
  const formatAlertDate = (date) => {
    if (!date) return null;
    const d = new Date(date);
    const now = new Date();
    const diffMs = now - d;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    // For older dates, show the actual date
    return d.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short'
    });
  };
  const getSeverityStyles = (severity) => {
    switch (severity) {
      case 'critical':
        return {
          bg: 'rgba(217, 119, 6, 0.15)',
          border: '#d97706',
          icon: '#d97706',
          iconBg: 'rgba(217, 119, 6, 0.2)'
        };
      case 'warning':
        return {
          bg: 'rgba(245, 158, 11, 0.15)',
          border: '#f59e0b',
          icon: '#f59e0b',
          iconBg: 'rgba(245, 158, 11, 0.2)'
        };
      default:
        return {
          bg: 'rgba(59, 130, 246, 0.15)',
          border: '#3b82f6',
          icon: '#3b82f6',
          iconBg: 'rgba(59, 130, 246, 0.2)'
        };
    }
  };

  const getIcon = (type) => {
    switch (type) {
      case 'barrier_breach':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'barrier_warning':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4m0 4h.01" />
          </svg>
        );
      case 'profile_breach':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        );
      case 'unknown_products':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <path d="M12 17h.01" />
          </svg>
        );
      case 'unread_notifications':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        );
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4m0-4h.01" />
          </svg>
        );
    }
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
      marginBottom: '16px'
    },
    title: {
      fontSize: '16px',
      fontWeight: '600',
      color: 'var(--text-primary)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    badge: {
      backgroundColor: alerts?.filter(a => a.severity === 'critical').length > 0 ? '#d97706' : '#3b82f6',
      color: '#fff',
      padding: '2px 8px',
      borderRadius: '12px',
      fontSize: '12px',
      fontWeight: '600'
    },
    alertsList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      flex: 1,
      overflow: 'auto',
      maxHeight: '200px'
    },
    alertItem: (severity) => {
      const s = getSeverityStyles(severity);
      return {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '10px 12px',
        borderRadius: '8px',
        backgroundColor: s.bg,
        borderLeft: `3px solid ${s.border}`,
        cursor: 'pointer',
        transition: 'transform 0.15s, opacity 0.15s'
      };
    },
    iconWrapper: (severity) => {
      const s = getSeverityStyles(severity);
      return {
        width: '28px',
        height: '28px',
        borderRadius: '50%',
        backgroundColor: s.iconBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: s.icon,
        flexShrink: 0
      };
    },
    alertContent: {
      flex: 1,
      minWidth: 0
    },
    alertMessage: {
      fontSize: '13px',
      color: 'var(--text-primary)',
      lineHeight: '1.4'
    },
    alertMeta: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      marginTop: '2px'
    },
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
    }
  };

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <span style={styles.title}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Alerts
        </span>
        {alerts?.length > 0 && (
          <span style={styles.badge}>{alerts.length}</span>
        )}
      </div>

      <div style={styles.alertsList}>
        {!alerts || alerts.length === 0 ? (
          <div style={styles.emptyState}>
            <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>No alerts at this time</span>
          </div>
        ) : (
          alerts.slice(0, 5).map((alert, idx) => (
            <div
              key={idx}
              style={styles.alertItem(alert.severity)}
              onClick={() => onAlertClick?.(alert)}
              onMouseOver={(e) => e.currentTarget.style.opacity = '0.85'}
              onMouseOut={(e) => e.currentTarget.style.opacity = '1'}
            >
              <div style={styles.iconWrapper(alert.severity)}>
                {getIcon(alert.type)}
              </div>
              <div style={styles.alertContent}>
                <div style={styles.alertMessage}>{alert.message}</div>
                <div style={styles.alertMeta}>
                  {alert.productTitle && <span>{alert.productTitle}</span>}
                  {alert.productTitle && alert.createdAt && <span> • </span>}
                  {alert.createdAt && <span>{formatAlertDate(alert.createdAt)}</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AlertsCard;
