import React from 'react';
import { useTheme } from './ThemeContext.jsx';

const RightSettingsMenu = ({ isOpen, onToggle }) => {
  const { theme, toggleTheme, setLightTheme, setDarkTheme, isDark } = useTheme();

  return (
    <>
      {/* Overlay */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 899,
            transition: 'opacity 0.3s ease'
          }}
          onClick={onToggle}
        />
      )}

      {/* Settings Toggle Button */}
      <button
        onClick={onToggle}
        style={{
          position: 'fixed',
          top: '60%',
          right: isOpen ? '280px' : '20px',
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
        {isOpen ? '✕' : '⚙️'}
      </button>

      {/* Settings Panel */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: isOpen ? '0' : '-260px',
          width: '260px',
          height: '100vh',
          background: 'linear-gradient(180deg, var(--bg-secondary) 0%, var(--bg-primary) 100%)',
          borderLeft: '1px solid var(--border-color)',
          boxShadow: isOpen ? '-4px 0 20px rgba(0, 0, 0, 0.15)' : 'none',
          zIndex: 900,
          transition: 'right 0.3s ease',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Settings Header */}
        <div style={{
          padding: '2rem 1.5rem 1rem',
          borderBottom: '2px solid var(--border-color)',
          background: 'linear-gradient(135deg, var(--bg-tertiary) 0%, var(--bg-secondary) 100%)'
        }}>
          <h2 style={{
            margin: '0 0 0.5rem 0',
            fontSize: '1.3rem',
            fontWeight: '700',
            color: 'var(--text-primary)',
            textAlign: 'center'
          }}>
            Settings
          </h2>
          <p style={{
            margin: 0,
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            textAlign: 'center'
          }}>
            Customize your experience
          </p>
        </div>

        {/* Theme Settings */}
        <div style={{
          padding: '2rem 1.5rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <h3 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            🌓 Theme
          </h3>

          {/* Theme Toggle Button */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '1rem'
          }}>
            <span style={{
              fontSize: '0.9rem',
              color: 'var(--text-secondary)'
            }}>
              Current: {isDark ? 'Dark' : 'Light'} Mode
            </span>
            <button
              onClick={toggleTheme}
              style={{
                width: '60px',
                height: '30px',
                borderRadius: '15px',
                border: 'none',
                background: isDark ? 'var(--accent-color)' : 'var(--text-muted)',
                position: 'relative',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
            >
              <div
                style={{
                  width: '26px',
                  height: '26px',
                  borderRadius: '50%',
                  background: 'white',
                  position: 'absolute',
                  top: '2px',
                  left: isDark ? '32px' : '2px',
                  transition: 'left 0.3s ease',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '0.7rem'
                }}
              >
                {isDark ? '🌙' : '☀️'}
              </div>
            </button>
          </div>

          {/* Quick Theme Buttons */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '0.5rem'
          }}>
            <button
              onClick={setLightTheme}
              style={{
                padding: '0.75rem',
                border: theme === 'light' ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                borderRadius: '8px',
                background: theme === 'light' ? 'var(--accent-color)' : 'var(--bg-primary)',
                color: theme === 'light' ? 'white' : 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: '500',
                transition: 'all 0.3s ease'
              }}
            >
              ☀️ Light
            </button>
            <button
              onClick={setDarkTheme}
              style={{
                padding: '0.75rem',
                border: theme === 'dark' ? '2px solid var(--accent-color)' : '1px solid var(--border-color)',
                borderRadius: '8px',
                background: theme === 'dark' ? 'var(--accent-color)' : 'var(--bg-primary)',
                color: theme === 'dark' ? 'white' : 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.8rem',
                fontWeight: '500',
                transition: 'all 0.3s ease'
              }}
            >
              🌙 Dark
            </button>
          </div>
        </div>

        {/* Additional Settings Placeholder */}
        <div style={{
          padding: '2rem 1.5rem',
          flex: 1
        }}>
          <h3 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            ⚡ Preferences
          </h3>
          <div style={{
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
            padding: '2rem 0'
          }}>
            Additional settings coming soon...
          </div>
        </div>

        {/* Settings Footer */}
        <div style={{
          padding: '1rem 1.5rem',
          borderTop: '1px solid var(--border-color)',
          background: 'var(--bg-tertiary)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          textAlign: 'center'
        }}>
          <div style={{ marginBottom: '0.5rem' }}>
            Theme: <span style={{ 
              color: 'var(--accent-color)', 
              fontWeight: '600', 
              textTransform: 'capitalize' 
            }}>
              {theme}
            </span>
          </div>
          <div>
            Settings Panel v1.0
          </div>
        </div>
      </div>
    </>
  );
};

export default RightSettingsMenu;