import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';

const UserProfileForm = ({ user, onProfileUpdate, compact = false }) => {
  const [profile, setProfile] = useState({
    firstName: '',
    lastName: '',
    birthday: '',
    preferredLanguage: 'en'
  });
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Language options
  const languages = [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
    { code: 'de', name: 'Deutsch' },
    { code: 'es', name: 'Español' },
    { code: 'it', name: 'Italiano' },
    { code: 'pt', name: 'Português' },
    { code: 'nl', name: 'Nederlands' },
    { code: 'sv', name: 'Svenska' },
    { code: 'da', name: 'Dansk' },
    { code: 'no', name: 'Norsk' }
  ];

  useEffect(() => {
    if (user && user.profile) {
      setProfile({
        firstName: user.profile.firstName || '',
        lastName: user.profile.lastName || '',
        birthday: user.profile.birthday ? user.profile.birthday.toISOString().split('T')[0] : '',
        preferredLanguage: user.profile.preferredLanguage || 'en'
      });
    }
  }, [user]);

  const hasProfile = user && user.profile && (user.profile.firstName || user.profile.lastName);

  const handleSubmit = (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setSuccess('');

    const profileData = {
      firstName: profile.firstName.trim(),
      lastName: profile.lastName.trim(),
      birthday: profile.birthday ? new Date(profile.birthday) : null,
      preferredLanguage: profile.preferredLanguage
    };

    Meteor.call('users.updateProfile', user._id, profileData, (err) => {
      setIsLoading(false);
      if (err) {
        setError(err.reason || 'Failed to update profile');
      } else {
        setSuccess('Profile updated successfully!');
        setIsEditing(false);
        // Update the user object
        if (onProfileUpdate) {
          const updatedUser = { ...user, profile: { ...user.profile, ...profileData } };
          onProfileUpdate(updatedUser);
        }
        // Clear success message after 3 seconds
        setTimeout(() => setSuccess(''), 3000);
      }
    });
  };

  if (compact && hasProfile) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontSize: '0.9rem',
        color: 'var(--text-secondary)'
      }}>
        <span>{user.profile.firstName} {user.profile.lastName}</span>
        <button
          onClick={() => setIsEditing(true)}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--accent-color)',
            cursor: 'pointer',
            fontSize: '0.8rem',
            textDecoration: 'underline'
          }}
        >
          Edit Profile
        </button>
      </div>
    );
  }

  if (!hasProfile && !isEditing) {
    return (
      <div style={{
        background: 'var(--bg-secondary)',
        border: '2px dashed var(--border-color)',
        borderRadius: '12px',
        padding: '2rem',
        textAlign: 'center',
        margin: '1rem 0'
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '1rem', opacity: 0.5 }}>👤</div>
        <h3 style={{
          margin: '0 0 1rem 0',
          color: 'var(--text-secondary)',
          fontSize: '1.2rem'
        }}>
          Complete Your Profile
        </h3>
        <p style={{
          margin: '0 0 1.5rem 0',
          color: 'var(--text-muted)',
          fontSize: '0.9rem'
        }}>
          Add your personal information to enhance your experience
        </p>
        <button
          onClick={() => setIsEditing(true)}
          style={{
            background: 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
            color: 'white',
            border: 'none',
            padding: '12px 24px',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'all 0.3s ease'
          }}
        >
          Add Profile Information
        </button>
      </div>
    );
  }

  if (isEditing) {
    return (
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '2rem',
        margin: '1rem 0'
      }}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem'
        }}>
          <h3 style={{
            margin: 0,
            fontSize: '1.3rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            {hasProfile ? 'Edit Profile' : 'Complete Your Profile'}
          </h3>
          <button
            onClick={() => {
              setIsEditing(false);
              setError('');
              setSuccess('');
            }}
            style={{
              background: 'none',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              padding: '8px 16px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.9rem'
            }}
          >
            Cancel
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1.5rem',
            marginBottom: '1.5rem'
          }}>
            <div>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                First Name *
              </label>
              <input
                type="text"
                value={profile.firstName}
                onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Last Name *
              </label>
              <input
                type="text"
                value={profile.lastName}
                onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                required
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Birthday
              </label>
              <input
                type="date"
                value={profile.birthday}
                onChange={(e) => setProfile({ ...profile, birthday: e.target.value })}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
              />
            </div>

            <div>
              <label style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '0.875rem',
                fontWeight: '600',
                color: 'var(--text-primary)'
              }}>
                Preferred Language
              </label>
              <select
                value={profile.preferredLanguage}
                onChange={(e) => setProfile({ ...profile, preferredLanguage: e.target.value })}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  background: 'var(--bg-primary)',
                  color: 'var(--text-primary)'
                }}
              >
                {languages.map(lang => (
                  <option key={lang.code} value={lang.code}>
                    {lang.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <div style={{
              color: 'var(--danger-color)',
              marginBottom: '1rem',
              padding: '12px 16px',
              backgroundColor: 'rgba(220, 53, 69, 0.1)',
              border: '1px solid rgba(220, 53, 69, 0.3)',
              borderRadius: '8px',
              fontSize: '0.875rem'
            }}>
              {error}
            </div>
          )}

          {success && (
            <div style={{
              color: 'var(--success-color)',
              marginBottom: '1rem',
              padding: '12px 16px',
              backgroundColor: 'rgba(40, 167, 69, 0.1)',
              border: '1px solid rgba(40, 167, 69, 0.3)',
              borderRadius: '8px',
              fontSize: '0.875rem'
            }}>
              {success}
            </div>
          )}

          <div style={{
            display: 'flex',
            gap: '1rem',
            justifyContent: 'flex-end'
          }}>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                setError('');
                setSuccess('');
              }}
              style={{
                padding: '12px 24px',
                border: '1px solid var(--border-color)',
                background: 'var(--bg-primary)',
                color: 'var(--text-secondary)',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              style={{
                padding: '12px 24px',
                background: isLoading ? 'var(--text-muted)' : 'linear-gradient(135deg, var(--accent-color) 0%, #4da6ff 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                fontSize: '1rem',
                fontWeight: '600'
              }}
            >
              {isLoading ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Display profile information
  return (
    <div style={{
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border-color)',
      borderRadius: '12px',
      padding: '2rem',
      margin: '1rem 0'
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '1.5rem'
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '1.3rem',
          fontWeight: '600',
          color: 'var(--text-primary)'
        }}>
          Profile Information
        </h3>
        <button
          onClick={() => setIsEditing(true)}
          style={{
            background: 'var(--accent-color)',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '0.9rem',
            fontWeight: '500'
          }}
        >
          Edit
        </button>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '1rem'
      }}>
        <div>
          <div style={{
            fontSize: '0.8rem',
            fontWeight: '600',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '4px'
          }}>
            Name
          </div>
          <div style={{
            fontSize: '1rem',
            color: 'var(--text-primary)',
            fontWeight: '500'
          }}>
            {profile.firstName} {profile.lastName}
          </div>
        </div>

        <div>
          <div style={{
            fontSize: '0.8rem',
            fontWeight: '600',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '4px'
          }}>
            Birthday
          </div>
          <div style={{
            fontSize: '1rem',
            color: 'var(--text-primary)',
            fontWeight: '500'
          }}>
            {profile.birthday ? new Date(profile.birthday).toLocaleDateString() : 'Not set'}
          </div>
        </div>

        <div>
          <div style={{
            fontSize: '0.8rem',
            fontWeight: '600',
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            marginBottom: '4px'
          }}>
            Language
          </div>
          <div style={{
            fontSize: '1rem',
            color: 'var(--text-primary)',
            fontWeight: '500'
          }}>
            {languages.find(lang => lang.code === profile.preferredLanguage)?.name || 'English'}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UserProfileForm;