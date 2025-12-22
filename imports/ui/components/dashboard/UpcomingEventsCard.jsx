import React from 'react';

const UpcomingEventsCard = ({ events, onEventClick }) => {
  const getColorByUrgency = () => {
    // Always use blue for consistent styling
    return { bg: 'rgba(59, 130, 246, 0.15)', border: '#3b82f6', text: '#3b82f6' };
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
      gap: '10px',
      flex: 1
    },
    eventItem: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px',
      padding: '12px',
      borderRadius: '10px',
      backgroundColor: 'var(--bg-tertiary)',
      cursor: 'pointer',
      transition: 'transform 0.15s, box-shadow 0.15s',
      border: '1px solid var(--border-color-light)'
    },
    dateBox: (urgency) => {
      const colors = getColorByUrgency(urgency);
      return {
        minWidth: '52px',
        textAlign: 'center',
        padding: '8px',
        borderRadius: '8px',
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`
      };
    },
    dateDays: (urgency) => {
      const colors = getColorByUrgency(urgency);
      return {
        fontSize: '18px',
        fontWeight: '700',
        color: colors.text,
        lineHeight: '1'
      };
    },
    dateLabel: {
      fontSize: '10px',
      color: 'var(--text-muted)',
      marginTop: '3px',
      textTransform: 'uppercase'
    },
    content: {
      flex: 1,
      minWidth: 0
    },
    productTitle: {
      fontSize: '13px',
      fontWeight: '500',
      color: 'var(--text-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      marginBottom: '4px'
    },
    eventType: {
      fontSize: '12px',
      color: 'var(--text-muted)',
      display: 'flex',
      alignItems: 'center',
      gap: '6px'
    },
    finalBadge: {
      backgroundColor: 'rgba(139, 92, 246, 0.2)',
      color: '#8b5cf6',
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '10px',
      fontWeight: '600'
    },
    dateText: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      marginTop: '4px'
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
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span style={styles.title}>Upcoming Events</span>
      </div>

      <div style={styles.list}>
        {!events || events.length === 0 ? (
          <div style={styles.emptyState}>
            <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
              <path d="M9 16l2 2 4-4" />
            </svg>
            <span>No upcoming events</span>
          </div>
        ) : (
          events.map((event, idx) => (
            <div
              key={idx}
              style={styles.eventItem}
              onClick={() => onEventClick?.(event)}
              onMouseOver={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={styles.dateBox(event.daysLeftColor)}>
                <div style={styles.dateDays(event.daysLeftColor)}>
                  {Number(event.daysLeft) === 0 ? 'Today' : event.daysLeft}
                </div>
                {Number(event.daysLeft) !== 0 && (
                  <div style={styles.dateLabel}>
                    {Number(event.daysLeft) === 1 ? 'day' : 'days'}
                  </div>
                )}
              </div>
              <div style={styles.content}>
                <div style={styles.productTitle}>{event.productTitle}</div>
                <div style={styles.eventType}>
                  {event.eventType}
                  {event.isFinal && <span style={styles.finalBadge}>FINAL</span>}
                </div>
                <div style={styles.dateText}>{event.observationDateFormatted}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default UpcomingEventsCard;
