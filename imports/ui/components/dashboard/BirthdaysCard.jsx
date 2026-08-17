import React from 'react';

const getInitials = (name) => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
};

const BirthdaysCard = ({ birthdays, onBirthdayClick }) => {
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
    list: {
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      flex: 1,
      minHeight: 0,
      overflow: 'auto'
    },
    birthdayItem: (isToday) => ({
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 6px',
      borderRadius: '8px',
      backgroundColor: isToday ? 'rgba(224, 161, 56, 0.10)' : 'transparent'
    }),
    avatar: {
      width: '34px',
      height: '34px',
      borderRadius: '50%',
      flex: 'none',
      display: 'grid',
      placeItems: 'center',
      fontSize: '12px',
      fontWeight: '600',
      color: '#0E1014',
      background: 'radial-gradient(circle at 35% 30%, #F2C46B, #E0A138)'
    },
    content: {
      flex: 1,
      minWidth: 0
    },
    name: {
      fontSize: '13.5px',
      fontWeight: '500',
      color: 'var(--text-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    relation: {
      fontSize: '11.5px',
      color: 'var(--text-muted)',
      marginTop: '1px'
    },
    dateTag: (isToday) => ({
      marginLeft: 'auto',
      fontFamily: "'JetBrains Mono', monospace",
      fontSize: '11px',
      letterSpacing: '0.3px',
      color: isToday ? 'var(--warning-color)' : 'var(--text-muted)',
      fontWeight: isToday ? '600' : '400',
      whiteSpace: 'nowrap'
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
    }
  };

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 21H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2z" />
          <path d="M4 13V9a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4" />
          <path d="M12 7V4" />
          <path d="M8 7V5" />
          <path d="M16 7V5" />
          <circle cx="12" cy="3" r="1" fill="currentColor" />
          <circle cx="8" cy="4" r="1" fill="currentColor" />
          <circle cx="16" cy="4" r="1" fill="currentColor" />
        </svg>
        <span style={styles.title}>Upcoming Birthdays</span>
      </div>

      <div style={styles.list}>
        {!birthdays || birthdays.length === 0 ? (
          <div style={styles.emptyState}>
            <svg style={styles.emptyIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>No client birthdays found</span>
          </div>
        ) : (
          birthdays.map((birthday, idx) => (
            <div
              key={idx}
              style={styles.birthdayItem(birthday.isToday)}
            >
              <div style={styles.avatar}>
                {birthday.isToday
                  ? <span style={{ fontSize: '15px' }}>&#127874;</span>
                  : getInitials(birthday.name)}
              </div>
              <div style={styles.content}>
                <div style={styles.name}>{birthday.name}</div>
                {!birthday.isClient && (
                  <div style={styles.relation}>
                    {birthday.relationship} of {birthday.clientName}
                  </div>
                )}
              </div>
              <span style={styles.dateTag(birthday.isToday)}>
                {birthday.daysUntil || birthday.dateFormatted}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default BirthdaysCard;
