import React from 'react';

const UserInfoDisplay = ({ user }) => {
  if (!user) {
    return (
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '2rem',
        textAlign: 'center'
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>⚠️</div>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>No user information available</p>
      </div>
    );
  }

  const formatDate = (date) => {
    if (!date) return 'Not available';
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getRoleBadgeColor = (role) => {
    switch (role) {
      case 'superadmin':
        return { bg: '#dc3545', text: 'white' };
      case 'admin':
        return { bg: '#fd7e14', text: 'white' };
      case 'client':
        return { bg: '#007bff', text: 'white' };
      default:
        return { bg: '#6c757d', text: 'white' };
    }
  };

  const roleBadge = getRoleBadgeColor(user.role || 'client');

  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      padding: '2rem',
      margin: '1rem 0'
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '2rem',
        borderBottom: '2px solid var(--border-color)',
        paddingBottom: '1rem'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{
            width: '60px',
            height: '60px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
            color: 'white'
          }}>
            👤
          </div>
          <div>
            <h3 style={{
              margin: '0 0 0.5rem 0',
              fontSize: '1.4rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              {user.profile?.firstName && user.profile?.lastName 
                ? `${user.profile.firstName} ${user.profile.lastName}`
                : 'User Profile'
              }
            </h3>
            <div style={{
              display: 'inline-block',
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              fontWeight: '600',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              backgroundColor: roleBadge.bg,
              color: roleBadge.text
            }}>
              {user.role || 'client'}
            </div>
          </div>
        </div>
        <div style={{
          textAlign: 'right',
          fontSize: '0.85rem',
          color: 'var(--text-muted)'
        }}>
          <div>User ID</div>
          <div style={{
            fontFamily: 'monospace',
            fontSize: '0.8rem',
            backgroundColor: 'var(--bg-tertiary)',
            padding: '2px 6px',
            borderRadius: '4px',
            marginTop: '2px'
          }}>
            {user._id}
          </div>
        </div>
      </div>

      {/* Account Information */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
        gap: '1.5rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color-light)',
          borderRadius: '8px',
          padding: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border-color-light)',
            paddingBottom: '0.5rem'
          }}>
            📧 Account Details
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
              }}>
                Email Address
              </div>
              <div style={{
                fontSize: '0.95rem',
                color: 'var(--text-primary)',
                fontWeight: '500',
                fontFamily: 'monospace',
                backgroundColor: 'var(--bg-tertiary)',
                padding: '4px 8px',
                borderRadius: '4px'
              }}>
                {user.email || 'Not available'}
              </div>
            </div>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
              }}>
                Account Status
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: user.emails?.[0]?.verified ? 'var(--success-color)' : 'var(--danger-color)',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                gap: '5px'
              }}>
                {user.emails?.[0]?.verified ? '✅ Verified' : '❌ Unverified'}
              </div>
            </div>
          </div>
        </div>

        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color-light)',
          borderRadius: '8px',
          padding: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border-color-light)',
            paddingBottom: '0.5rem'
          }}>
            🕒 Timeline
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
              }}>
                Account Created
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: 'var(--text-primary)',
                fontWeight: '500'
              }}>
                {formatDate(user.createdAt)}
              </div>
            </div>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
              }}>
                Last Login
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: 'var(--text-primary)',
                fontWeight: '500'
              }}>
                {formatDate(user.lastLogin) || 'Current session'}
              </div>
            </div>
          </div>
        </div>

        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color-light)',
          borderRadius: '8px',
          padding: '1.5rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border-color-light)',
            paddingBottom: '0.5rem'
          }}>
            👤 Personal Info
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
              }}>
                Name
              </div>
              <div style={{
                fontSize: '0.95rem',
                color: 'var(--text-primary)',
                fontWeight: '500'
              }}>
                {user.profile?.firstName && user.profile?.lastName 
                  ? `${user.profile.firstName} ${user.profile.lastName}`
                  : 'Not set'
                }
              </div>
            </div>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
              }}>
                Birthday
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: 'var(--text-primary)',
                fontWeight: '500'
              }}>
                {user.profile?.birthday 
                  ? new Date(user.profile.birthday).toLocaleDateString()
                  : 'Not set'
                }
              </div>
            </div>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
              }}>
                Language
              </div>
              <div style={{
                fontSize: '0.9rem',
                color: 'var(--text-primary)',
                fontWeight: '500'
              }}>
                {user.profile?.preferredLanguage || 'English'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Session Information */}
      {user.sessionData && (
        <div style={{
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color-light)',
          borderRadius: '8px',
          padding: '1.5rem',
          marginTop: '1rem'
        }}>
          <h4 style={{
            margin: '0 0 1rem 0',
            fontSize: '1rem',
            fontWeight: '600',
            color: 'var(--text-secondary)',
            borderBottom: '1px solid var(--border-color-light)',
            paddingBottom: '0.5rem'
          }}>
            🔐 Session Information
          </h4>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem'
          }}>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
              }}>
                Session ID
              </div>
              <div style={{
                fontSize: '0.8rem',
                color: 'var(--text-primary)',
                fontFamily: 'monospace',
                backgroundColor: 'var(--bg-tertiary)',
                padding: '4px 8px',
                borderRadius: '4px'
              }}>
                {user.sessionData.sessionId?.substring(0, 16)}...
              </div>
            </div>
            <div>
              <div style={{
                fontSize: '0.75rem',
                fontWeight: '600',
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '4px'
              }}>
                Session Started
              </div>
              <div style={{
                fontSize: '0.85rem',
                color: 'var(--text-primary)',
                fontWeight: '500'
              }}>
                {formatDate(user.sessionData.lastUsed)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserInfoDisplay;