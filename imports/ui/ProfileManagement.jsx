import React, { useState } from 'react';
import UserInfoDisplay from './UserInfoDisplay.jsx';
import UserProfileForm from './UserProfileForm.jsx';
import BankAccountManagement from './BankAccountManagement.jsx';
import { useTheme } from './ThemeContext.jsx';

const ProfileManagement = ({ user, currentSection }) => {
  // Determine initial active tab based on currentSection
  const getInitialTab = () => {
    switch (currentSection) {
      case 'profile-information': return 'profile';
      case 'banking': return 'banking';
      case 'settings': return 'settings';
      case 'profile': return 'profile'; // Default to first tab
      default: return 'profile';
    }
  };

  const [activeTab, setActiveTab] = useState(getInitialTab());
  const { theme, toggleTheme, setLightTheme, setDarkTheme, isDark } = useTheme();

  // Theme Settings Component for Settings Tab
  const ThemeSettings = () => (
    <div style={{
      background: 'var(--bg-secondary)',
      borderRadius: '12px',
      padding: '2rem',
      boxShadow: '0 1px 3px var(--shadow)',
      border: '1px solid var(--border-color)',
      marginBottom: '2rem'
    }}>
      <h3 style={{
        margin: '0 0 1.5rem 0',
        fontSize: '1.2rem',
        fontWeight: '600',
        color: 'var(--text-primary)',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem'
      }}>
        🌓 Theme Settings
      </h3>

      {/* Theme Toggle Switch */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '1.5rem',
        padding: '1rem',
        background: 'var(--bg-tertiary)',
        borderRadius: '8px',
        border: '1px solid var(--border-color)'
      }}>
        <div>
          <div style={{
            fontSize: '1rem',
            fontWeight: '500',
            color: 'var(--text-primary)',
            marginBottom: '0.25rem'
          }}>
            Current Theme
          </div>
          <div style={{
            fontSize: '0.875rem',
            color: 'var(--text-secondary)'
          }}>
            {isDark ? 'Dark Mode' : 'Light Mode'}
          </div>
        </div>
        <button
          onClick={toggleTheme}
          style={{
            width: '80px',
            height: '40px',
            borderRadius: '20px',
            border: 'none',
            background: isDark ? 'var(--accent-color)' : 'var(--text-muted)',
            position: 'relative',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '50%',
              background: 'white',
              position: 'absolute',
              top: '2px',
              left: isDark ? '42px' : '2px',
              transition: 'left 0.3s ease',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1rem',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
            }}
          >
            {isDark ? '🌙' : '☀️'}
          </div>
        </button>
      </div>

      {/* Quick Theme Selection */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '1rem'
      }}>
        <button
          onClick={setLightTheme}
          style={{
            padding: '1rem',
            border: theme === 'light' ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
            borderRadius: '8px',
            background: theme === 'light' ? 'var(--accent-color)' : 'var(--bg-primary)',
            color: theme === 'light' ? 'white' : 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: '500',
            transition: 'all 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}
          onMouseEnter={(e) => {
            if (theme !== 'light') {
              e.target.style.background = 'var(--bg-tertiary)';
            }
          }}
          onMouseLeave={(e) => {
            if (theme !== 'light') {
              e.target.style.background = 'var(--bg-primary)';
            }
          }}
        >
          ☀️ Light Theme
        </button>
        <button
          onClick={setDarkTheme}
          style={{
            padding: '1rem',
            border: theme === 'dark' ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
            borderRadius: '8px',
            background: theme === 'dark' ? 'var(--accent-color)' : 'var(--bg-primary)',
            color: theme === 'dark' ? 'white' : 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: '500',
            transition: 'all 0.3s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '0.5rem'
          }}
          onMouseEnter={(e) => {
            if (theme !== 'dark') {
              e.target.style.background = 'var(--bg-tertiary)';
            }
          }}
          onMouseLeave={(e) => {
            if (theme !== 'dark') {
              e.target.style.background = 'var(--bg-primary)';
            }
          }}
        >
          🌙 Dark Theme
        </button>
      </div>
    </div>
  );

  const tabs = [
    {
      id: 'profile',
      label: 'Profile Information',
      icon: '👤',
      component: (
        <div>
          <UserInfoDisplay user={user} />
          <UserProfileForm 
            user={user} 
            onProfileUpdate={(updatedUser) => {
              // Update the user state if needed
            }}
          />
        </div>
      )
    },
    {
      id: 'banking',
      label: 'Bank Accounts',
      icon: '🏛️',
      component: <BankAccountManagement user={user} />
    },
    {
      id: 'settings',
      label: 'Settings & Preferences',
      icon: '⚙️',
      component: (
        <div>
          <ThemeSettings />
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: '12px',
            padding: '2rem',
            boxShadow: '0 1px 3px var(--shadow)',
            border: '1px solid var(--border-color)',
            textAlign: 'center'
          }}>
            <h3 style={{
              margin: '0 0 1rem 0',
              fontSize: '1.2rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              ⚡ Additional Preferences
            </h3>
            <div style={{
              fontSize: '0.9rem',
              color: 'var(--text-muted)'
            }}>
              More preference options coming soon...
            </div>
          </div>
        </div>
      )
    }
  ];

  return (
    <div style={{
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '2rem'
    }}>
      <section style={{
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        padding: '2rem',
        boxShadow: '0 1px 3px var(--shadow)',
        border: '1px solid var(--border-color)',
        transition: 'all 0.3s ease'
      }}>
        {/* Header */}
        <div style={{
          marginBottom: '2rem'
        }}>
          <h2 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.5rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            My Profile
          </h2>
          <p style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: '0.9rem'
          }}>
            Manage your account information, banking details, and preferences
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{
          borderBottom: '2px solid var(--border-color)',
          marginBottom: '2rem'
        }}>
          <div style={{
            display: 'flex',
            gap: '0',
            overflowX: 'auto'
          }}>
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '12px 24px',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '500',
                  color: activeTab === tab.id ? 'var(--accent-color)' : 'var(--text-secondary)',
                  borderBottom: activeTab === tab.id ? '2px solid var(--accent-color)' : '2px solid transparent',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab.id) {
                    e.target.style.color = 'var(--text-primary)';
                    e.target.style.backgroundColor = 'var(--bg-tertiary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.id) {
                    e.target.style.color = 'var(--text-secondary)';
                    e.target.style.backgroundColor = 'transparent';
                  }
                }}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div>
          {tabs.find(tab => tab.id === activeTab)?.component}
        </div>
      </section>
    </div>
  );
};

export default ProfileManagement;