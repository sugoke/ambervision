import React from 'react';

const RecentActivityCard = ({ activities, onActivityClick }) => {
  const getIcon = (type) => {
    switch (type) {
      case 'barrier_breach':
      case 'warning':
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'autocall':
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        );
      case 'coupon':
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
        );
      case 'observation':
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        );
      case 'new_product':
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="16" />
            <line x1="8" y1="12" x2="16" y2="12" />
          </svg>
        );
      default:
        return (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        );
    }
  };

  const getColor = (type) => {
    switch (type) {
      case 'barrier_breach':
      case 'warning':
        return '#f59e0b';
      case 'autocall':
        return '#8b5cf6';
      case 'coupon':
        return '#10b981';
      case 'new_product':
        return '#3b82f6';
      default:
        return '#6b7280';
    }
  };

  const formatTimeAgo = (date) => {
    if (!date) return '';
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
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
    list: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      flex: 1,
      overflow: 'auto',
      maxHeight: '200px'
    },
    activityItem: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '10px',
      padding: '8px 10px',
      borderRadius: '8px',
      cursor: 'pointer',
      transition: 'background-color 0.15s'
    },
    iconWrapper: (type) => ({
      width: '28px',
      height: '28px',
      borderRadius: '50%',
      backgroundColor: `${getColor(type)}20`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: getColor(type),
      flexShrink: 0
    }),
    content: {
      flex: 1,
      minWidth: 0
    },
    activityTitle: {
      fontSize: '12px',
      fontWeight: '500',
      color: 'var(--text-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    activityMessage: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      marginTop: '2px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    time: {
      fontSize: '10px',
      color: 'var(--text-muted)',
      whiteSpace: 'nowrap'
    },
    unreadDot: {
      width: '6px',
      height: '6px',
      borderRadius: '50%',
      backgroundColor: '#3b82f6',
      flexShrink: 0,
      marginTop: '6px'
    },
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

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
        <span style={styles.title}>Recent Activity</span>
      </div>

      <div style={styles.list}>
        {!activities || activities.length === 0 ? (
          <div style={styles.emptyState}>
            <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>No recent activity</span>
          </div>
        ) : (
          activities.map((activity, idx) => (
            <div
              key={idx}
              style={styles.activityItem}
              onClick={() => onActivityClick?.(activity)}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <div style={styles.iconWrapper(activity.type)}>
                {getIcon(activity.type)}
              </div>
              <div style={styles.content}>
                <div style={styles.activityTitle}>
                  {activity.title || activity.productTitle}
                </div>
                {activity.message && (
                  <div style={styles.activityMessage}>{activity.message}</div>
                )}
              </div>
              <span style={styles.time}>{formatTimeAgo(activity.createdAt)}</span>
              {!activity.isRead && <div style={styles.unreadDot} />}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default RecentActivityCard;
