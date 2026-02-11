import React, { useState, useEffect } from 'react';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';
import { useTheme } from './ThemeContext.jsx';

const RightNavigationMenu = ({ isOpen, onToggle, onNavigate, currentSection, userRole, isMobile }) => {
  const { toggleTheme, isDark } = useTheme();

  const menuItems = [
    {
      id: 'dashboard',
      label: 'Home',
      icon: '🏠',
      description: 'Dashboard overview',
      role: 'client'
    },
    {
      id: 'pms',
      label: 'PMS',
      icon: '📈',
      description: 'Portfolio Management System',
      role: 'client'
    },
    {
      id: 'products',
      label: 'Products',
      icon: '📋',
      description: 'Structured products list',
      role: 'client'
    },
    {
      id: 'create-product',
      label: 'Create Product',
      icon: '➕',
      description: 'Design new products',
      role: 'rm'
    },
    {
      id: 'profile',
      label: 'My Profile',
      icon: '👤',
      description: 'Personal information',
      role: 'client'
    },
    {
      id: 'underlyings',
      label: 'Underlyings',
      icon: '📊',
      description: 'Underlying assets performance',
      role: 'client'
    },
    {
      id: 'schedule',
      label: 'Schedule',
      icon: '📅',
      description: 'Product observation calendar',
      role: 'client'
    },
    {
      id: 'alerts',
      label: 'Alert Center',
      icon: '🚨',
      description: 'Product alerts & warnings',
      role: 'client'
    },
    {
      id: 'market-news',
      label: 'Market News',
      icon: '📰',
      description: 'Newsletters and market updates',
      role: 'client'
    },
    {
      id: 'clients',
      label: 'Clients',
      icon: '👥',
      description: 'Client management',
      role: 'rm',
      nonClientOnly: true
    },
    {
      id: 'order-book',
      label: 'Order Book',
      icon: '📋',
      description: 'Manage buy/sell orders',
      role: 'rm',
      nonClientOnly: true
    },
    {
      id: 'intranet',
      label: 'Intranet',
      icon: '🏢',
      description: 'Internal team workspace',
      role: 'rm',
      nonClientOnly: true
    },
    {
      id: 'administration',
      label: 'Administration',
      icon: '⚙️',
      description: 'Admin & system management',
      role: 'admin'
    }
  ];

  const getRoleLevel = (role) => {
    const levels = { client: 1, compliance: 2, rm: 2, admin: 2, superadmin: 3 };
    return levels[role] || 0;
  };

  const userRoleLevel = getRoleLevel(userRole);
  const visibleItems = menuItems.filter(item => getRoleLevel(item.role) <= userRoleLevel);
  
  // Check if user is in an admin section that requires form interactions
  const isInAdminFormSection = ['user-management', 'issuer-management', 'administration', 'bank-management', 'price-data-upload', 'market-data'].includes(currentSection);

  // Track previous section to detect section changes
  const [prevSection, setPrevSection] = useState(currentSection);

  // Auto-close menu when ENTERING admin sections to prevent input blocking
  // But allow manual opening/closing once already in an admin section
  useEffect(() => {
    const isEnteringAdminSection = isInAdminFormSection && prevSection !== currentSection;

    if (isEnteringAdminSection && isOpen) {
      console.log('Auto-closing navigation menu when entering admin section:', currentSection);
      onToggle();
    }

    setPrevSection(currentSection);
  }, [currentSection]);

  return (
    <>
      {/* Overlay - Remove when in admin sections to prevent input blocking */}
      {isOpen && !isInAdminFormSection && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 999,
            transition: 'opacity 0.3s ease',
            pointerEvents: 'auto'
          }}
          onClick={(e) => {
            console.log('Overlay clicked - closing menu');
            onToggle();
          }}
        />
      )}

      {/* Menu Toggle Button - Hidden on mobile (button is in header instead) */}
      {!isMobile && (
        <button
          onClick={onToggle}
          style={{
            position: 'fixed',
            top: '50%',
            right: isOpen ? '320px' : '20px',
            transform: 'translateY(-50%)',
            width: '50px',
            height: '50px',
            borderRadius: '25px',
            border: 'none',
            background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            fontSize: '1rem',
            cursor: 'pointer',
            zIndex: 1001,
            boxShadow: '0 4px 12px rgba(0, 123, 255, 0.3)',
            transition: 'all 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-50%) scale(1.1)';
            e.target.style.boxShadow = '0 6px 20px rgba(0, 123, 255, 0.4)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(-50%) scale(1)';
            e.target.style.boxShadow = '0 4px 12px rgba(0, 123, 255, 0.3)';
          }}
        >
          {isOpen ? '✕' : '☰'}
        </button>
      )}

      {/* Menu Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: isOpen ? '0' : '-300px',
          width: '300px',
          height: '100vh',
          background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: isOpen ? '-4px 0 20px rgba(0, 0, 0, 0.15)' : 'none',
          zIndex: 1000,
          transition: 'right 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Menu Header */}
        <div style={{
          padding: '1.5rem 1rem 0.75rem',
          borderBottom: '2px solid var(--border-color)',
          background: 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem',
            marginBottom: '0.5rem'
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: 'linear-gradient(135deg, #FF8A00 0%, #FFA500 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              boxShadow: '0 2px 8px rgba(255, 138, 0, 0.3)'
            }}>
              🔮
            </div>
            <h2 style={{
              margin: 0,
              fontSize: '1.2rem',
              fontWeight: '700',
              color: 'var(--text-primary)',
              background: 'linear-gradient(135deg, #FF8A00 0%, #FFA500 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }}>
              Ambervision
            </h2>
          </div>
          <p style={{
            margin: 0,
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            textAlign: 'center'
          }}>
            Structured Products Suite
          </p>
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

        {/* Menu Items */}
        <div style={{
          flex: 1,
          padding: '1rem 0',
          overflowY: 'auto'
        }}>
          {visibleItems.map((item) => (
            <div
              key={item.id}
              onClick={() => {
                onNavigate(item.id);
                onToggle();
              }}
              style={{
                margin: '0.5rem 1rem',
                padding: '0.75rem 1rem',
                borderRadius: '10px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                border: '1px solid transparent',
                background: currentSection === item.id
                  ? 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)'
                  : 'var(--bg-primary)',
                color: currentSection === item.id ? 'white' : 'var(--text-primary)'
              }}
              onMouseEnter={(e) => {
                if (currentSection !== item.id) {
                  e.currentTarget.style.background = 'var(--bg-secondary)';
                  e.currentTarget.style.borderColor = 'rgba(0, 123, 255, 0.2)';
                  e.currentTarget.style.transform = 'translateX(-2px)';
                  e.currentTarget.style.boxShadow = '0 2px 8px rgba(0, 123, 255, 0.15)';
                }
              }}
              onMouseLeave={(e) => {
                if (currentSection !== item.id) {
                  e.currentTarget.style.background = 'var(--bg-primary)';
                  e.currentTarget.style.borderColor = 'transparent';
                  e.currentTarget.style.transform = 'translateX(0)';
                  e.currentTarget.style.boxShadow = 'none';
                }
              }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}>
                <span style={{
                  fontSize: '1.1rem',
                  opacity: currentSection === item.id ? 1 : 0.8
                }}>
                  {item.icon}
                </span>
                <span style={{
                  fontSize: '1.05rem',
                  fontWeight: '600',
                  opacity: currentSection === item.id ? 1 : 0.9
                }}>
                  {item.label}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Menu Footer */}
        <div style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          textAlign: 'center'
        }}>
          <div style={{ marginBottom: '0.5rem' }}>
            Role: <span style={{ 
              color: 'var(--accent-color)', 
              fontWeight: '600', 
              textTransform: 'capitalize' 
            }}>
              {userRole}
            </span>
          </div>
          <div>
            © 2025 Structured Products Platform
          </div>
        </div>
      </div>
    </>
  );
};

export default RightNavigationMenu;