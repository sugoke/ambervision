import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTheme } from './ThemeContext.jsx';

/**
 * Password Reset Component
 * Handles the password reset form when user clicks email link
 * URL format: #reset-password?token=XXXXX
 */
const PasswordReset = ({ token, onComplete }) => {
  const { theme, isDark } = useTheme();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [validatingToken, setValidatingToken] = useState(true);
  const [tokenValid, setTokenValid] = useState(false);
  const [userEmail, setUserEmail] = useState('');

  // Validate token on mount
  useEffect(() => {
    if (!token) {
      setError('No reset token provided');
      setValidatingToken(false);
      return;
    }

    Meteor.call('auth.validateResetToken', token, (err, result) => {
      setValidatingToken(false);
      if (err || !result.valid) {
        setError(result?.error || 'Invalid or expired reset link');
        setTokenValid(false);
      } else {
        setTokenValid(true);
        setUserEmail(result.email);
      }
    });
  }, [token]);

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    // Validation
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Reset password
    setLoading(true);
    Meteor.call('auth.resetPassword', token, newPassword, (err, result) => {
      setLoading(false);

      if (err) {
        setError(err.reason || 'Failed to reset password');
      } else {
        setSuccess(true);
        // Redirect to login after 3 seconds
        setTimeout(() => {
          if (onComplete) {
            onComplete();
          }
        }, 3000);
      }
    });
  };

  // Loading state while validating token
  if (validatingToken) {
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
        background: isDark
          ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
          : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '20px',
        boxSizing: 'border-box'
      }}>
        <div style={{
          backgroundColor: isDark ? '#2d2d2d' : 'white',
          borderRadius: '16px',
          padding: '40px',
          boxShadow: isDark
            ? '0 20px 40px rgba(0, 0, 0, 0.5)'
            : '0 20px 40px rgba(0, 0, 0, 0.15)',
          textAlign: 'center',
          maxWidth: '440px',
          width: '100%'
        }}>
          <div style={{
            fontSize: '2rem',
            marginBottom: '1rem',
            animation: 'spin 1s linear infinite'
          }}>
            ⏳
          </div>
          <p style={{
            margin: 0,
            color: isDark ? '#e0e0e0' : '#374151',
            fontSize: '1rem'
          }}>
            Validating reset link...
          </p>
        </div>
      </div>
    );
  }

  // Success state
  if (success) {
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
        background: isDark
          ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
          : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
        padding: '20px',
        boxSizing: 'border-box'
      }}>
        <div style={{
          backgroundColor: isDark ? '#2d2d2d' : 'white',
          borderRadius: '16px',
          padding: '40px',
          boxShadow: isDark
            ? '0 20px 40px rgba(0, 0, 0, 0.5)'
            : '0 20px 40px rgba(0, 0, 0, 0.15)',
          textAlign: 'center',
          maxWidth: '440px',
          width: '100%'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>✓</div>
          <h2 style={{
            margin: '0 0 1rem 0',
            color: isDark ? '#10b981' : '#059669',
            fontSize: '1.5rem',
            fontWeight: '700'
          }}>
            Password Reset Successful!
          </h2>
          <p style={{
            margin: 0,
            color: isDark ? '#e0e0e0' : '#374151',
            fontSize: '1rem',
            lineHeight: '1.6'
          }}>
            Your password has been updated successfully. You can now log in with your new password.
          </p>
          <p style={{
            marginTop: '1rem',
            color: isDark ? '#b0b0b0' : '#6b7280',
            fontSize: '0.875rem'
          }}>
            Redirecting to login...
          </p>
        </div>
      </div>
    );
  }

  // Invalid token state
  if (!tokenValid) {
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
        background: isDark
          ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
          : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: '20px',
        boxSizing: 'border-box'
      }}>
        <div style={{
          backgroundColor: isDark ? '#2d2d2d' : 'white',
          borderRadius: '16px',
          padding: '40px',
          boxShadow: isDark
            ? '0 20px 40px rgba(0, 0, 0, 0.5)'
            : '0 20px 40px rgba(0, 0, 0, 0.15)',
          textAlign: 'center',
          maxWidth: '440px',
          width: '100%'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>❌</div>
          <h2 style={{
            margin: '0 0 1rem 0',
            color: isDark ? '#ef4444' : '#dc2626',
            fontSize: '1.5rem',
            fontWeight: '700'
          }}>
            Invalid Reset Link
          </h2>
          <p style={{
            margin: '0 0 2rem 0',
            color: isDark ? '#e0e0e0' : '#374151',
            fontSize: '1rem',
            lineHeight: '1.6'
          }}>
            {error || 'This password reset link is invalid or has expired.'}
          </p>
          <button
            onClick={() => {
              if (onComplete) {
                onComplete();
              }
            }}
            style={{
              padding: '12px 32px',
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '1rem',
              fontWeight: '600'
            }}
          >
            Return to Login
          </button>
        </div>
      </div>
    );
  }

  // Password reset form
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
      background: isDark
        ? 'linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)'
        : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px',
      boxSizing: 'border-box',
      zIndex: 9999
    }}>
      <div style={{
        backgroundColor: isDark ? '#2d2d2d' : 'white',
        borderRadius: '16px',
        padding: '40px',
        boxShadow: isDark
          ? '0 20px 40px rgba(0, 0, 0, 0.5)'
          : '0 20px 40px rgba(0, 0, 0, 0.15)',
        width: '100%',
        maxWidth: '440px',
        position: 'relative',
        overflow: 'hidden'
      }}>
        {/* Decorative background */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '4px',
          background: 'linear-gradient(90deg, #667eea 0%, #764ba2 100%)'
        }}></div>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '1.5rem'
          }}>
            <img
              src="https://amberlakepartners.com/assets/logos/horizontal_logo2.png"
              alt="Amber Lake Partners"
              style={{
                height: '50px',
                width: 'auto',
                objectFit: 'contain'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>
          <h1 style={{
            fontSize: '1.5rem',
            fontWeight: '700',
            color: isDark ? '#ffffff' : '#1a202c',
            marginBottom: '8px',
            letterSpacing: '-0.025em'
          }}>
            Reset Your Password
          </h1>
          <p style={{
            color: isDark ? '#b0b0b0' : '#718096',
            fontSize: '0.9rem',
            margin: 0
          }}>
            Enter a new password for <strong>{userEmail}</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ width: '100%' }}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '0.875rem',
              fontWeight: '600',
              color: isDark ? '#ffffff' : '#374151'
            }}>
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              placeholder="Enter new password"
              minLength="6"
              style={{
                width: '100%',
                padding: '14px 16px',
                border: '2px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '1rem',
                boxSizing: 'border-box',
                transition: 'all 0.2s ease',
                backgroundColor: '#ffffff',
                outline: 'none'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#667eea';
                e.target.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#e5e7eb';
                e.target.style.boxShadow = 'none';
              }}
            />
            <p style={{
              margin: '6px 0 0 0',
              fontSize: '0.75rem',
              color: isDark ? '#b0b0b0' : '#6b7280'
            }}>
              Must be at least 6 characters
            </p>
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '0.875rem',
              fontWeight: '600',
              color: isDark ? '#ffffff' : '#374151'
            }}>
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              placeholder="Confirm new password"
              minLength="6"
              style={{
                width: '100%',
                padding: '14px 16px',
                border: '2px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '1rem',
                boxSizing: 'border-box',
                transition: 'all 0.2s ease',
                backgroundColor: '#ffffff',
                outline: 'none'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#667eea';
                e.target.style.boxShadow = '0 0 0 3px rgba(102, 126, 234, 0.1)';
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#e5e7eb';
                e.target.style.boxShadow = 'none';
              }}
            />
          </div>

          {error && (
            <div style={{
              color: '#dc2626',
              marginBottom: '20px',
              padding: '12px 16px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: '8px',
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <span style={{ fontSize: '1rem' }}>⚠️</span>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%',
              padding: '14px 24px',
              background: loading
                ? '#9ca3af'
                : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '1rem',
              fontWeight: '600',
              marginBottom: '16px',
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)'
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.target.style.transform = 'translateY(-1px)';
                e.target.style.boxShadow = '0 6px 12px rgba(0, 0, 0, 0.15)';
              }
            }}
            onMouseLeave={(e) => {
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
            }}
          >
            {loading ? 'Resetting Password...' : 'Reset Password'}
          </button>

          <div style={{ textAlign: 'center' }}>
            <button
              type="button"
              onClick={() => {
                if (onComplete) {
                  onComplete();
                }
              }}
              style={{
                background: 'none',
                color: '#6b7280',
                border: 'none',
                cursor: 'pointer',
                fontSize: '0.875rem',
                textDecoration: 'underline',
                padding: '4px 8px'
              }}
              onMouseEnter={(e) => {
                e.target.style.color = '#667eea';
              }}
              onMouseLeave={(e) => {
                e.target.style.color = '#6b7280';
              }}
            >
              Back to Login
            </button>
          </div>
        </form>
      </div>

      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}
      </style>
    </div>
  );
};

export default PasswordReset;
