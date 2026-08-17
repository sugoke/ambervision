import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { USER_ROLES } from '/imports/api/users';
import { useTheme } from './ThemeContext.jsx';

const Login = ({ onUserChange, compact = false }) => {
  const { theme, isDark } = useTheme();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true); // Default to true for better persistence
  const [error, setError] = useState('');
  const [currentUser, setCurrentUser] = useState(null);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetError, setResetError] = useState('');
  // True while a stored session is being validated on mount — during that
  // window we hold a blank branded ground instead of flashing the login form.
  const [checkingSession, setCheckingSession] = useState(() => !!localStorage.getItem('sessionId'));

  useEffect(() => {
    // Check for existing session on component mount
    const sessionId = localStorage.getItem('sessionId');
    const rememberMeFlag = localStorage.getItem('rememberMe') === 'true';
    const sessionExpiresAt = localStorage.getItem('sessionExpiresAt');
    
    // Set remember me state from localStorage
    if (rememberMeFlag) {
      setRememberMe(true);
    }
    
    if (sessionId) {
      // Check if session has expired locally first
      if (sessionExpiresAt && new Date() > new Date(sessionExpiresAt)) {
        console.log('Session expired locally, clearing...');
        localStorage.removeItem('sessionId');
        localStorage.removeItem('sessionLastUsed');
        localStorage.removeItem('rememberMe');
        localStorage.removeItem('sessionExpiresAt');
        localStorage.removeItem('userEmail');
        setCheckingSession(false);
        if (onUserChange) onUserChange(null);
        return;
      }

      console.log('Restoring session from localStorage...');
      Meteor.call('auth.getCurrentUser', sessionId, (err, user) => {
        setCheckingSession(false);
        if (!err && user) {
          console.log('✅ Session restored successfully for:', user.email);
          setCurrentUser(user);
          if (onUserChange) onUserChange(user);
          // Refresh session timestamp to extend expiration
          localStorage.setItem('sessionLastUsed', new Date().toISOString());
          
          // Extend session expiration if "Remember Me" is enabled
          if (rememberMeFlag) {
            const newExpiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString();
            localStorage.setItem('sessionExpiresAt', newExpiresAt);
          }
        } else {
          console.log('❌ Session invalid or expired, clearing...');
          // Clean up invalid session
          localStorage.removeItem('sessionId');
          localStorage.removeItem('sessionLastUsed');
          localStorage.removeItem('rememberMe');
          localStorage.removeItem('sessionExpiresAt');
          localStorage.removeItem('userEmail');
          // Notify parent that auth check is complete but no user found
          if (onUserChange) onUserChange(null);
        }
      });
    } else {
      // No session found, notify parent that auth check is complete
      console.log('No existing session found');
      if (onUserChange) onUserChange(null);
    }

    // Set up periodic session refresh (every 15 minutes for better reliability)
    const sessionRefreshInterval = setInterval(() => {
      const currentSessionId = localStorage.getItem('sessionId');
      const currentRememberMe = localStorage.getItem('rememberMe') === 'true';
      
      if (currentSessionId) {
        Meteor.call('auth.getCurrentUser', currentSessionId, (err, user) => {
          if (!err && user) {
            localStorage.setItem('sessionLastUsed', new Date().toISOString());
            
            // Extend session if "Remember Me" is enabled
            if (currentRememberMe) {
              const newExpiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString();
              localStorage.setItem('sessionExpiresAt', newExpiresAt);
            }
            
            console.log('🔄 Session refreshed and extended for:', user.email);
          } else {
            console.log('❌ Session refresh failed, logging out...');
            // Session expired, clear everything
            localStorage.removeItem('sessionId');
            localStorage.removeItem('sessionLastUsed');
            localStorage.removeItem('rememberMe');
            localStorage.removeItem('sessionExpiresAt');
            localStorage.removeItem('userEmail');
            setCurrentUser(null);
            if (onUserChange) onUserChange(null);
          }
        });
      }
    }, 15 * 60 * 1000); // 15 minutes for better reliability

    // Refresh session when window gets focus (user returns to tab)
    const handleWindowFocus = () => {
      const currentSessionId = localStorage.getItem('sessionId');
      if (currentSessionId && currentUser) {
        Meteor.call('auth.getCurrentUser', currentSessionId, (err, user) => {
          if (!err && user) {
            localStorage.setItem('sessionLastUsed', new Date().toISOString());
            console.log('🎯 Session refreshed on window focus for:', user.email);
          } else {
            console.log('❌ Session invalid on window focus, logging out...');
            localStorage.removeItem('sessionId');
            localStorage.removeItem('sessionLastUsed');
            localStorage.removeItem('rememberMe');
            localStorage.removeItem('sessionExpiresAt');
            localStorage.removeItem('userEmail');
            setCurrentUser(null);
            if (onUserChange) onUserChange(null);
          }
        });
      }
    };

    window.addEventListener('focus', handleWindowFocus);

    // Cleanup interval and event listener on unmount
    return () => {
      clearInterval(sessionRefreshInterval);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, []); // Only run on mount to prevent loops


  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (isLogin) {
      // Login
      Meteor.call('auth.login', { email, password, rememberMe }, (err, result) => {
        if (err) {
          setError(err.reason);
        } else {
          console.log('Login successful for:', result.user.email);
          localStorage.setItem('sessionId', result.sessionId);
          localStorage.setItem('sessionLastUsed', new Date().toISOString());
          localStorage.setItem('userEmail', result.user.email);
          
          // Always store remember me state and expiration
          localStorage.setItem('rememberMe', rememberMe ? 'true' : 'false');
          if (result.session && result.session.expiresAt) {
            localStorage.setItem('sessionExpiresAt', result.session.expiresAt);
          } else {
            // Calculate expiration based on current time and remember me setting
            const expirationMs = rememberMe ? (30 * 24 * 60 * 60 * 1000) : (7 * 24 * 60 * 60 * 1000);
            const expiresAt = new Date(Date.now() + expirationMs).toISOString();
            localStorage.setItem('sessionExpiresAt', expiresAt);
          }
          
          setCurrentUser(result.user);
          if (onUserChange) onUserChange(result.user);
        }
      });
    } else {
      // Register
      Meteor.call('users.create', { email, password, role: USER_ROLES.CLIENT }, (err) => {
        if (err) {
          setError(err.reason);
        } else {
          // Auto-login after registration with remember me
          Meteor.call('auth.login', { email, password, rememberMe: true }, (loginErr, result) => {
            if (!loginErr) {
              console.log('Auto-login after registration successful for:', result.user.email);
              localStorage.setItem('sessionId', result.sessionId);
              localStorage.setItem('sessionLastUsed', new Date().toISOString());
              localStorage.setItem('userEmail', result.user.email);
              localStorage.setItem('rememberMe', 'true');
              
              // Calculate expiration for 30 days
              const expirationMs = 30 * 24 * 60 * 60 * 1000;
              const expiresAt = new Date(Date.now() + expirationMs).toISOString();
              localStorage.setItem('sessionExpiresAt', expiresAt);
              
              setCurrentUser(result.user);
              if (onUserChange) onUserChange(result.user);
            }
          });
        }
      });
    }
  };

  const handleLogout = () => {
    const sessionId = localStorage.getItem('sessionId');
    console.log('Logging out user...');
    Meteor.call('auth.logout', sessionId, () => {
      // Clear all session-related data
      localStorage.removeItem('sessionId');
      localStorage.removeItem('sessionLastUsed');
      localStorage.removeItem('userEmail');
      localStorage.removeItem('rememberMe');
      localStorage.removeItem('sessionExpiresAt');
      setCurrentUser(null);
      if (onUserChange) onUserChange(null);
      console.log('User logged out and localStorage cleared');
    });
  };

  const handleForgotPassword = (e) => {
    e.preventDefault();
    setResetError('');
    setResetLoading(true);

    Meteor.call('auth.requestPasswordReset', resetEmail, (err, result) => {
      setResetLoading(false);

      if (err) {
        setResetError(err.reason || 'Failed to send reset email');
      } else {
        setResetSuccess(true);
        // Auto-close after 5 seconds
        setTimeout(() => {
          setShowForgotPassword(false);
          setResetSuccess(false);
          setResetEmail('');
        }, 5000);
      }
    });
  };

  if (currentUser) {
    if (compact) {
      return (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          color: 'var(--text-primary)',
          fontSize: '0.75rem',
          flexShrink: 0,
          justifyContent: 'flex-end'
        }}>
          <span style={{
            padding: '3px 8px',
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)',
            borderRadius: '3px',
            fontWeight: '500'
          }}>
            {currentUser.email} ({currentUser.role})
          </span>
          <button onClick={handleLogout} style={{
            padding: '4px 10px',
            backgroundColor: isDark ? 'rgba(220, 53, 69, 0.2)' : 'rgba(220, 53, 69, 0.1)',
            color: isDark ? '#ff6b6b' : '#dc3545',
            border: `1px solid ${isDark ? 'rgba(220, 53, 69, 0.3)' : 'rgba(220, 53, 69, 0.2)'}`,
            borderRadius: '3px',
            cursor: 'pointer',
            fontSize: '0.7rem',
            fontWeight: '500',
            transition: 'all 0.2s ease'
          }}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = isDark ? 'rgba(220, 53, 69, 0.3)' : 'rgba(220, 53, 69, 0.15)';
            e.target.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = isDark ? 'rgba(220, 53, 69, 0.2)' : 'rgba(220, 53, 69, 0.1)';
            e.target.style.transform = 'translateY(0)';
          }}
          >
            Logout
          </button>
        </div>
      );
    }

    return (
      <div style={{
        padding: '20px',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-sm)',
        margin: '20px 0',
        background: 'var(--card-bg)',
        color: 'var(--text-primary)'
      }}>
        <h3 style={{ fontFamily: 'var(--font-serif)', fontWeight: 500 }}>Welcome, {currentUser.email}</h3>
        <p><strong>Role:</strong> {currentUser.role}</p>
        <button onClick={handleLogout} style={{
          padding: '10px 20px',
          backgroundColor: 'var(--danger-color)',
          color: '#fff',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          cursor: 'pointer'
        }}>
          Logout
        </button>
      </div>
    );
  }

  // Don't show login form in compact mode when not logged in
  if (compact) {
    return null;
  }

  // Session restore in flight: show only the branded ground, no form flash
  if (checkingSession) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'var(--page-bg)',
        zIndex: 9999
      }} />
    );
  }

  const fieldLabelStyle = {
    display: 'block',
    marginBottom: '8px',
    fontSize: '11.5px',
    fontWeight: 600,
    letterSpacing: '1.8px',
    textTransform: 'uppercase',
    color: 'var(--text-muted)'
  };

  const fieldInputStyle = {
    width: '100%',
    padding: '13px 15px',
    border: '1px solid var(--border-color)',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.95rem',
    fontFamily: 'var(--font-sans)',
    boxSizing: 'border-box',
    transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    outline: 'none'
  };

  const handleFieldFocus = (e) => {
    e.target.style.borderColor = 'var(--accent-color)';
    e.target.style.boxShadow = '0 0 0 3px color-mix(in srgb, var(--accent-color) 18%, transparent)';
  };

  const handleFieldBlur = (e) => {
    e.target.style.borderColor = 'var(--border-color)';
    e.target.style.boxShadow = 'none';
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--page-bg)',
      padding: '20px',
      boxSizing: 'border-box',
      zIndex: 9999
    }}>
      <div style={{
        background: 'var(--card-bg)',
        border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius)',
        padding: '44px 40px 36px',
        boxShadow: '0 24px 60px -24px var(--shadow)',
        width: '100%',
        maxWidth: '440px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Signature amber rule */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '2px',
          background: 'linear-gradient(90deg, var(--accent-strong) 0%, color-mix(in srgb, var(--accent-strong) 15%, transparent) 85%)'
        }}></div>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1.75rem'
          }}>
            <img
              src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png"
              alt="Amber Lake Partners"
              style={{
                height: '56px',
                width: 'auto',
                objectFit: 'contain'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
                // Fallback: show text if image fails to load
                const fallback = document.createElement('div');
                fallback.style.fontFamily = 'var(--font-serif)';
                fallback.style.fontSize = '1.5rem';
                fallback.style.fontWeight = '500';
                fallback.style.color = 'var(--text-primary)';
                fallback.textContent = 'Amber Lake Partners';
                e.target.parentNode.appendChild(fallback);
              }}
            />
          </div>
          <h1 style={{
            fontFamily: 'var(--font-serif)',
            fontSize: '1.75rem',
            fontWeight: 500,
            color: 'var(--text-primary)',
            margin: '0 0 8px',
            letterSpacing: '0.2px'
          }}>
            {isLogin ? 'Welcome back' : 'Create account'}
          </h1>
          <p style={{
            color: 'var(--text-muted)',
            fontSize: '0.9rem',
            margin: 0
          }}>
            {isLogin ? 'Sign in to your account to continue' : 'Join us to start creating structured products'}
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <div style={{ marginBottom: '22px' }}>
            <label style={fieldLabelStyle}>
              Email Address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="Enter your email"
              style={fieldInputStyle}
              onFocus={handleFieldFocus}
              onBlur={handleFieldBlur}
            />
          </div>

          <div style={{ marginBottom: '22px' }}>
            <label style={fieldLabelStyle}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter your password"
              style={fieldInputStyle}
              onFocus={handleFieldFocus}
              onBlur={handleFieldBlur}
            />
          </div>

          {/* Remember Me Checkbox & Forgot Password - Only show for login */}
          {isLogin && (
            <div style={{
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <input
                  type="checkbox"
                  id="rememberMe"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  style={{
                    width: '16px',
                    height: '16px',
                    accentColor: 'var(--accent-color)',
                    cursor: 'pointer'
                  }}
                />
                <label
                  htmlFor="rememberMe"
                  style={{
                    fontSize: '0.875rem',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  Remember me
                </label>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowForgotPassword(true);
                  setResetEmail(email); // Pre-fill with current email if entered
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-color)',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  padding: '4px',
                  textDecoration: 'none'
                }}
                onMouseEnter={(e) => {
                  e.target.style.textDecoration = 'underline';
                }}
                onMouseLeave={(e) => {
                  e.target.style.textDecoration = 'none';
                }}
              >
                Forgot password?
              </button>
            </div>
          )}
          
          {error && (
            <div style={{
              color: 'var(--danger-color)',
              marginBottom: '22px',
              padding: '12px 16px',
              backgroundColor: 'color-mix(in srgb, var(--danger-color) 10%, transparent)',
              border: '1px solid color-mix(in srgb, var(--danger-color) 30%, transparent)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              {error}
            </div>
          )}


          <button type="submit" style={{
            width: '100%',
            padding: '14px 24px',
            background: 'var(--accent-strong)',
            color: 'var(--accent-contrast)',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer',
            fontSize: '0.95rem',
            fontWeight: 600,
            letterSpacing: '0.3px',
            marginBottom: '20px',
            transition: 'all 0.2s ease',
            boxShadow: '0 6px 16px -8px color-mix(in srgb, var(--accent-strong) 60%, transparent)'
          }}
          onMouseEnter={(e) => {
            e.target.style.transform = 'translateY(-1px)';
            e.target.style.filter = 'brightness(1.05)';
            e.target.style.boxShadow = '0 10px 22px -8px color-mix(in srgb, var(--accent-strong) 70%, transparent)';
          }}
          onMouseLeave={(e) => {
            e.target.style.transform = 'translateY(0)';
            e.target.style.filter = 'none';
            e.target.style.boxShadow = '0 6px 16px -8px color-mix(in srgb, var(--accent-strong) 60%, transparent)';
          }}
          >
            {isLogin ? 'Sign In' : 'Create Account'}
          </button>

          <div style={{ textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                // Clear fields when switching modes
                setEmail('');
                setPassword('');
                setError('');
              }}
              style={{
                background: 'none',
                color: 'var(--text-muted)',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.875rem',
                textDecoration: 'none',
                padding: '4px 8px'
              }}
              onMouseEnter={(e) => {
                e.target.style.color = 'var(--accent-color)';
                e.target.style.textDecoration = 'underline';
              }}
              onMouseLeave={(e) => {
                e.target.style.color = 'var(--text-muted)';
                e.target.style.textDecoration = 'none';
              }}
            >
              {isLogin ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </form>

        <div style={{ textAlign: 'center', marginTop: '16px' }}>
          <a
            href="/#privacy"
            style={{ fontSize: '12px', color: 'var(--text-muted)', textDecoration: 'none' }}
          >
            Privacy policy
          </a>
        </div>
      </div>

      {/* Forgot Password Modal */}
      {showForgotPassword && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10000
          }}
          onClick={() => {
            if (!resetLoading) {
              setShowForgotPassword(false);
              setResetSuccess(false);
              setResetError('');
            }
          }}
        >
          <div
            style={{
              background: 'var(--card-bg)',
              border: '1px solid var(--border-color)',
              borderRadius: 'var(--radius)',
              padding: '32px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 24px 60px -24px var(--shadow)',
              position: 'relative',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Signature amber rule */}
            <div style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              height: '2px',
              background: 'linear-gradient(90deg, var(--accent-strong) 0%, color-mix(in srgb, var(--accent-strong) 15%, transparent) 85%)'
            }}></div>

            {/* Close button */}
            <button
              onClick={() => {
                if (!resetLoading) {
                  setShowForgotPassword(false);
                  setResetSuccess(false);
                  setResetError('');
                }
              }}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'none',
                border: 'none',
                fontSize: '1.5rem',
                cursor: resetLoading ? 'not-allowed' : 'pointer',
                color: 'var(--text-muted)',
                padding: '4px 8px'
              }}
            >
              ×
            </button>

            {resetSuccess ? (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '3rem', marginBottom: '1rem', color: 'var(--success-color)' }}>✓</div>
                <h3
                  style={{
                    margin: '0 0 1rem 0',
                    fontFamily: 'var(--font-serif)',
                    color: 'var(--success-color)',
                    fontSize: '1.35rem',
                    fontWeight: 500
                  }}
                >
                  Check Your Email
                </h3>
                <p
                  style={{
                    margin: 0,
                    color: 'var(--text-secondary)',
                    fontSize: '0.95rem',
                    lineHeight: '1.6'
                  }}
                >
                  If an account exists with this email, you will receive password reset instructions shortly.
                </p>
              </div>
            ) : (
              <>
                <h3
                  style={{
                    margin: '0 0 1rem 0',
                    fontFamily: 'var(--font-serif)',
                    color: 'var(--text-primary)',
                    fontSize: '1.35rem',
                    fontWeight: 500,
                    letterSpacing: '0.2px'
                  }}
                >
                  Reset Password
                </h3>
                <p
                  style={{
                    margin: '0 0 1.5rem 0',
                    color: 'var(--text-muted)',
                    fontSize: '0.9rem',
                    lineHeight: '1.5'
                  }}
                >
                  Enter your email address and we'll send you instructions to reset your password.
                </p>

                <form onSubmit={handleForgotPassword}>
                  <div style={{ marginBottom: '20px' }}>
                    <label style={fieldLabelStyle}>
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={resetEmail}
                      onChange={(e) => setResetEmail(e.target.value)}
                      required
                      placeholder="Enter your email"
                      disabled={resetLoading}
                      style={{
                        ...fieldInputStyle,
                        backgroundColor: resetLoading ? 'var(--bg-tertiary)' : 'var(--bg-primary)',
                        opacity: resetLoading ? 0.7 : 1
                      }}
                      onFocus={handleFieldFocus}
                      onBlur={handleFieldBlur}
                    />
                  </div>

                  {resetError && (
                    <div
                      style={{
                        color: 'var(--danger-color)',
                        marginBottom: '16px',
                        padding: '10px 12px',
                        backgroundColor: 'color-mix(in srgb, var(--danger-color) 10%, transparent)',
                        border: '1px solid color-mix(in srgb, var(--danger-color) 30%, transparent)',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.875rem'
                      }}
                    >
                      {resetError}
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={resetLoading}
                    style={{
                      width: '100%',
                      padding: '12px 20px',
                      background: resetLoading ? 'var(--bg-tertiary)' : 'var(--accent-strong)',
                      color: resetLoading ? 'var(--text-muted)' : 'var(--accent-contrast)',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      cursor: resetLoading ? 'not-allowed' : 'pointer',
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      letterSpacing: '0.3px',
                      transition: 'all 0.2s ease'
                    }}
                  >
                    {resetLoading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default Login;