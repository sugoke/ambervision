import React from 'react';
import { useTheme } from './ThemeContext.jsx';

const RightSettingsMenu = ({ onNavigateToAdmin, isMobile, userRole, isOpen, onClose }) => {
  const { toggleTheme, isDark } = useTheme();

  // Only show for admin/superadmin users
  const hasAdminAccess = userRole === 'admin' || userRole === 'superadmin';

  if (!hasAdminAccess) {
    return null;
  }

  // Admin menu items for mobile panel
  const adminItems = [
    { id: 'administration', label: 'Admin Dashboard', icon: '🏠', description: 'Main admin overview' },
    { id: 'user-management', label: 'User Management', icon: '👥', description: 'Manage users and roles' },
    { id: 'issuer-management', label: 'Issuers', icon: '🏦', description: 'Manage product issuers' },
    { id: 'bank-management', label: 'Banks', icon: '🏛️', description: 'Bank connections' },
    { id: 'price-data-upload', label: 'Price Data', icon: '📊', description: 'Upload market data' },
    { id: 'market-data', label: 'Market Data', icon: '📈', description: 'Market data settings' },
  ];

  // Mobile: render full-screen admin panel overlay
  if (isMobile) {
    if (!isOpen) return null;

    return (
      <>
        {/* Dark overlay backdrop */}
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            zIndex: 1100,
            animation: 'fadeIn 0.2s ease'
          }}
        />

        {/* Admin panel sliding from right */}
        <div
          style={{
            position: 'fixed',
            top: 0,
            right: 0,
            width: '85%',
            maxWidth: '320px',
            height: '100vh',
            background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
            borderLeft: '1px solid var(--border-color)',
            boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.25)',
            zIndex: 1101,
            display: 'flex',
            flexDirection: 'column',
            animation: 'slideInRight 0.25s ease'
          }}
        >
          {/* Header */}
          <div style={{
            padding: '1.25rem 1rem',
            borderBottom: '2px solid var(--border-color)',
            background: 'linear-gradient(135deg, #6c757d 0%, #495057 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '1.5rem' }}>⚙️</span>
              <div>
                <h2 style={{
                  margin: 0,
                  fontSize: '1.1rem',
                  fontWeight: '700',
                  color: 'white'
                }}>
                  Administration
                </h2>
                <p style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  color: 'rgba(255,255,255,0.7)'
                }}>
                  {userRole === 'superadmin' ? 'Super Admin' : 'Admin'} Panel
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                border: 'none',
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                fontSize: '1.2rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              ✕
            </button>
          </div>

          {/* Theme Toggle */}
          <div style={{
            padding: '0.75rem 1rem',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--bg-primary)'
          }}>
            <span style={{
              fontSize: '0.9rem',
              color: 'var(--text-secondary)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem'
            }}>
              {isDark ? '🌙' : '☀️'} {isDark ? 'Dark' : 'Light'} Mode
            </span>
            <button
              onClick={toggleTheme}
              style={{
                width: '50px',
                height: '26px',
                borderRadius: '13px',
                border: 'none',
                background: isDark ? 'var(--accent-color)' : 'var(--text-muted)',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
            >
              <div
                style={{
                  width: '22px',
                  height: '22px',
                  borderRadius: '50%',
                  background: 'white',
                  position: 'absolute',
                  top: '2px',
                  left: isDark ? '26px' : '2px',
                  transition: 'left 0.3s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.6rem'
                }}
              >
                {isDark ? '🌙' : '☀️'}
              </div>
            </button>
          </div>

          {/* Admin Menu Items */}
          <div style={{
            flex: 1,
            padding: '1rem 0',
            overflowY: 'auto'
          }}>
            {adminItems.map((item) => (
              <div
                key={item.id}
                onClick={() => {
                  onNavigateToAdmin(item.id);
                  onClose();
                }}
                style={{
                  margin: '0.5rem 1rem',
                  padding: '0.875rem 1rem',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  border: '1px solid transparent',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}>
                  <span style={{
                    fontSize: '1.25rem',
                    opacity: 0.9
                  }}>
                    {item.icon}
                  </span>
                  <div>
                    <span style={{
                      fontSize: '1rem',
                      fontWeight: '600',
                      display: 'block'
                    }}>
                      {item.label}
                    </span>
                    <span style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)'
                    }}>
                      {item.description}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div style={{
            padding: '0.75rem 1rem',
            borderTop: '1px solid var(--border-color)',
            background: 'var(--bg-tertiary)',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textAlign: 'center'
          }}>
            <div style={{ marginBottom: '0.25rem' }}>
              Role: <span style={{
                color: '#6c757d',
                fontWeight: '600',
                textTransform: 'capitalize'
              }}>
                {userRole}
              </span>
            </div>
            <div>
              © 2025 Ambervision Admin
            </div>
          </div>
        </div>

        {/* CSS animations */}
        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to { transform: translateX(0); }
          }
        `}</style>
      </>
    );
  }

  // Desktop: render floating admin button
  return (
    <button
      onClick={() => onNavigateToAdmin()}
      title="Administration"
      style={{
        position: 'fixed',
        top: '60%',
        right: '20px',
        transform: 'translateY(-50%)',
        width: '50px',
        height: '50px',
        borderRadius: '25px',
        border: 'none',
        background: 'linear-gradient(135deg, #6c757d 0%, #495057 100%)',
        color: 'white',
        fontSize: '1.2rem',
        cursor: 'pointer',
        zIndex: 901,
        boxShadow: '0 4px 12px rgba(108, 117, 125, 0.3)',
        transition: 'all 0.3s ease',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
      onMouseEnter={(e) => {
        e.target.style.transform = 'translateY(-50%) scale(1.1)';
        e.target.style.boxShadow = '0 6px 20px rgba(108, 117, 125, 0.4)';
      }}
      onMouseLeave={(e) => {
        e.target.style.transform = 'translateY(-50%) scale(1)';
        e.target.style.boxShadow = '0 4px 12px rgba(108, 117, 125, 0.3)';
      }}
    >
      ⚙️
    </button>
  );
};

export default RightSettingsMenu;
