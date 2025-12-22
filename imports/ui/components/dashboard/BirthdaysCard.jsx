import React from 'react';

const BirthdaysCard = ({ birthdays, onBirthdayClick }) => {
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
      gap: '8px',
      flex: 1,
      overflow: 'auto',
      maxHeight: '180px'
    },
    birthdayItem: (isToday) => ({
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '10px 12px',
      borderRadius: '8px',
      backgroundColor: isToday ? 'rgba(245, 158, 11, 0.15)' : 'var(--bg-tertiary)',
      border: isToday ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid transparent'
    }),
    avatar: (isToday) => ({
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      backgroundColor: isToday ? 'rgba(245, 158, 11, 0.3)' : 'var(--bg-primary)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: isToday ? '18px' : '14px',
      color: isToday ? '#f59e0b' : 'var(--text-muted)'
    }),
    content: {
      flex: 1,
      minWidth: 0
    },
    name: {
      fontSize: '13px',
      fontWeight: '500',
      color: 'var(--text-primary)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    relation: {
      fontSize: '11px',
      color: 'var(--text-muted)',
      marginTop: '2px'
    },
    dateTag: (isToday) => ({
      fontSize: '11px',
      padding: '3px 8px',
      borderRadius: '10px',
      backgroundColor: isToday ? '#f59e0b' : 'var(--bg-primary)',
      color: isToday ? '#fff' : 'var(--text-muted)',
      fontWeight: isToday ? '600' : '400'
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
              <div style={styles.avatar(birthday.isToday)}>
                {birthday.isToday ? (
                  <span>&#127874;</span>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
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
