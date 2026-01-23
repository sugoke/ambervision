import React, { useState, useMemo, useEffect } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import UserDetailsScreen from './UserDetailsScreen.jsx';
import LiquidGlassCard from './components/LiquidGlassCard.jsx';

const ClientsSection = ({ user: currentUser, theme }) => {
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Create user form state
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserFirstName, setNewUserFirstName] = useState('');
  const [newUserLastName, setNewUserLastName] = useState('');
  const [newUserBirthday, setNewUserBirthday] = useState('');
  const [newUserRole, setNewUserRole] = useState(USER_ROLES.CLIENT);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [userBreaches, setUserBreaches] = useState({});

  // Subscribe to clients based on user role
  const subscription = useMemo(() => {
    const sessionId = localStorage.getItem('sessionId');
    return Meteor.subscribe('rmClients', sessionId);
  }, []);

  const { users, isLoading } = useTracker(() => {
    const isReady = subscription.ready();

    // Query all users - the publication handles filtering based on role
    // Use $ne: false to match users where isActive is true, undefined, or null
    const allUsers = UsersCollection.find(
      { isActive: { $ne: false } },
      { sort: { lastName: 1, firstName: 1 } }
    ).fetch();

    return {
      users: allUsers,
      isLoading: !isReady
    };
  }, [subscription]);

  // Fetch breach status for all clients
  useEffect(() => {
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId || users.length === 0) return;

    Meteor.call('rmDashboard.getClientBreachStatus', sessionId, (err, result) => {
      if (!err && result) {
        setUserBreaches(result);
      }
    });
  }, [users.length]);

  // Helper to get user name (check both top-level and profile)
  const getUserName = (user) => {
    const firstName = user.firstName || user.profile?.firstName || '';
    const lastName = user.lastName || user.profile?.lastName || '';
    return { firstName, lastName };
  };

  // Helper to get role display label and color
  const getRoleDisplay = (role) => {
    switch (role) {
      case USER_ROLES.SUPERADMIN:
        return { label: 'Super Admin', color: '#dc2626', bg: 'rgba(220, 38, 38, 0.1)' };
      case USER_ROLES.ADMIN:
        return { label: 'Admin', color: '#9333ea', bg: 'rgba(147, 51, 234, 0.1)' };
      case USER_ROLES.COMPLIANCE:
        return { label: 'Compliance', color: '#0891b2', bg: 'rgba(8, 145, 178, 0.1)' };
      case USER_ROLES.RELATIONSHIP_MANAGER:
        return { label: 'RM', color: '#2563eb', bg: 'rgba(37, 99, 235, 0.1)' };
      case USER_ROLES.CLIENT:
      default:
        return { label: 'Client', color: '#059669', bg: 'rgba(5, 150, 105, 0.1)' };
    }
  };

  // Role priority for sorting (lower number = higher priority)
  const getRolePriority = (role) => {
    switch (role) {
      case USER_ROLES.SUPERADMIN: return 1;
      case USER_ROLES.ADMIN: return 2;
      case USER_ROLES.COMPLIANCE: return 3;
      case USER_ROLES.RELATIONSHIP_MANAGER: return 4;
      case USER_ROLES.CLIENT: return 5;
      default: return 6;
    }
  };

  // Filter users by search term, then sort by role priority and name
  const filteredUsers = users
    .filter(user => {
      const { firstName, lastName } = getUserName(user);
      const fullName = `${firstName} ${lastName}`.toLowerCase();
      const email = (user.email || '').toLowerCase();
      const roleDisplay = getRoleDisplay(user.role).label.toLowerCase();
      const search = searchTerm.toLowerCase();
      return fullName.includes(search) || email.includes(search) || roleDisplay.includes(search);
    })
    .sort((a, b) => {
      // First sort by role priority
      const roleDiff = getRolePriority(a.role) - getRolePriority(b.role);
      if (roleDiff !== 0) return roleDiff;
      // Then sort by last name, first name
      const { lastName: aLast, firstName: aFirst } = getUserName(a);
      const { lastName: bLast, firstName: bFirst } = getUserName(b);
      const lastNameCompare = (aLast || '').localeCompare(bLast || '');
      if (lastNameCompare !== 0) return lastNameCompare;
      return (aFirst || '').localeCompare(bFirst || '');
    });

  const canCreateUsers = currentUser?.role === USER_ROLES.ADMIN || currentUser?.role === USER_ROLES.SUPERADMIN;

  const handleCreateUser = (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Only SUPERADMINs can create SUPERADMIN users
    if (newUserRole === USER_ROLES.SUPERADMIN && currentUser?.role !== USER_ROLES.SUPERADMIN) {
      setError('Only Super Admins can create Super Admin users');
      return;
    }

    setIsCreatingUser(true);

    const sessionId = localStorage.getItem('sessionId');

    Meteor.call('users.create', {
      email: newUserEmail,
      password: newUserPassword,
      role: newUserRole,
      profile: {
        firstName: newUserFirstName,
        lastName: newUserLastName,
        birthday: newUserBirthday ? new Date(newUserBirthday) : null
      },
      sessionId
    }, (err, result) => {
      setIsCreatingUser(false);
      if (err) {
        setError(err.reason || 'Failed to create user');
      } else {
        const roleLabel = getRoleDisplay(newUserRole).label;
        setSuccess(`${roleLabel} created successfully!`);
        setNewUserEmail('');
        setNewUserPassword('');
        setNewUserFirstName('');
        setNewUserLastName('');
        setNewUserBirthday('');
        setNewUserRole(USER_ROLES.CLIENT);
        setShowCreateForm(false);
        // Select the new user
        if (result && result.customUserId) {
          setSelectedUserId(result.customUserId);
        }
        setTimeout(() => setSuccess(''), 3000);
      }
    });
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setNewUserPassword(password);
  };

  return (
    <div style={{
      display: 'flex',
      height: 'calc(100vh - 80px)',
      background: 'var(--bg-primary)'
    }}>
      {/* Left Panel - User List */}
      <div style={{
        width: '320px',
        minWidth: '320px',
        borderRight: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-secondary)'
      }}>
        {/* Header */}
        <div style={{
          padding: '1.5rem',
          borderBottom: '1px solid var(--border-color)'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1rem'
          }}>
            <h2 style={{
              margin: 0,
              fontSize: '1.5rem',
              fontWeight: '600',
              color: 'var(--text-primary)'
            }}>
              Users
            </h2>
            {canCreateUsers && (
              <button
                onClick={() => setShowCreateForm(!showCreateForm)}
                style={{
                  background: showCreateForm ? 'var(--danger-color)' : 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600'
                }}
              >
                {showCreateForm ? 'Cancel' : '+ New'}
              </button>
            )}
          </div>

          {/* Search */}
          <input
            type="text"
            placeholder="Search users..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '10px 14px',
              border: '2px solid var(--border-color)',
              borderRadius: '8px',
              fontSize: '0.95rem',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              boxSizing: 'border-box'
            }}
          />
        </div>

        {/* Create Form */}
        {showCreateForm && canCreateUsers && (
          <div style={{
            padding: '1rem',
            borderBottom: '1px solid var(--border-color)',
            background: 'var(--bg-primary)'
          }}>
            <form onSubmit={handleCreateUser}>
              <div style={{ marginBottom: '0.75rem' }}>
                <input
                  type="email"
                  placeholder="Email *"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="Password *"
                  value={newUserPassword}
                  onChange={(e) => setNewUserPassword(e.target.value)}
                  required
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)'
                  }}
                />
                <button
                  type="button"
                  onClick={generateRandomPassword}
                  style={{
                    padding: '10px',
                    background: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '0.8rem'
                  }}
                  title="Generate random password"
                >
                  🎲
                </button>
              </div>
              <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem' }}>
                <input
                  type="text"
                  placeholder="First Name"
                  value={newUserFirstName}
                  onChange={(e) => setNewUserFirstName(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)'
                  }}
                />
                <input
                  type="text"
                  placeholder="Last Name"
                  value={newUserLastName}
                  onChange={(e) => setNewUserLastName(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '10px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)'
                  }}
                />
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <input
                  type="date"
                  placeholder="Birthday"
                  value={newUserBirthday}
                  onChange={(e) => setNewUserBirthday(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box'
                  }}
                />
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <select
                  value={newUserRole}
                  onChange={(e) => setNewUserRole(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '0.9rem',
                    background: 'var(--bg-secondary)',
                    color: 'var(--text-primary)',
                    boxSizing: 'border-box',
                    cursor: 'pointer'
                  }}
                >
                  <option value={USER_ROLES.CLIENT}>Client</option>
                  <option value={USER_ROLES.RELATIONSHIP_MANAGER}>Relationship Manager</option>
                  <option value={USER_ROLES.COMPLIANCE}>Compliance</option>
                  <option value={USER_ROLES.ADMIN}>Admin</option>
                  {currentUser?.role === USER_ROLES.SUPERADMIN && (
                    <option value={USER_ROLES.SUPERADMIN}>Super Admin</option>
                  )}
                </select>
              </div>
              {error && (
                <div style={{
                  color: 'var(--danger-color)',
                  fontSize: '0.85rem',
                  marginBottom: '0.75rem'
                }}>
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={isCreatingUser}
                style={{
                  width: '100%',
                  padding: '10px',
                  background: isCreatingUser ? 'var(--text-muted)' : 'var(--accent-color)',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: isCreatingUser ? 'not-allowed' : 'pointer',
                  fontSize: '0.9rem',
                  fontWeight: '600'
                }}
              >
                {isCreatingUser ? 'Creating...' : 'Create User'}
              </button>
            </form>
          </div>
        )}

        {/* Success message */}
        {success && (
          <div style={{
            padding: '0.75rem 1rem',
            background: 'rgba(16, 185, 129, 0.1)',
            borderBottom: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#10b981',
            fontSize: '0.85rem'
          }}>
            {success}
          </div>
        )}

        {/* User List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0.5rem'
        }}>
          {isLoading ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--text-secondary)'
            }}>
              Loading users...
            </div>
          ) : filteredUsers.length === 0 ? (
            <div style={{
              padding: '2rem',
              textAlign: 'center',
              color: 'var(--text-secondary)'
            }}>
              {searchTerm ? 'No users match your search' : 'No users found'}
            </div>
          ) : (
            filteredUsers.map(user => {
              const { firstName, lastName } = getUserName(user);
              const displayName = firstName || lastName ? `${firstName} ${lastName}`.trim() : 'Unnamed';
              const initials = `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase() || '?';
              const roleDisplay = getRoleDisplay(user.role);

              return (
                <div
                  key={user._id}
                  onClick={() => setSelectedUserId(user._id)}
                  style={{
                    padding: '1rem',
                    marginBottom: '0.5rem',
                    background: selectedUserId === user._id
                      ? 'var(--accent-color)'
                      : 'var(--bg-primary)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    border: selectedUserId === user._id
                      ? '1px solid var(--accent-color)'
                      : '1px solid var(--border-color)'
                  }}
                >
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.75rem'
                  }}>
                    {/* Avatar */}
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      background: selectedUserId === user._id
                        ? 'rgba(255,255,255,0.2)'
                        : 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: '600',
                      fontSize: '0.9rem'
                    }}>
                      {initials}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        marginBottom: '2px'
                      }}>
                        <span style={{
                          fontWeight: '600',
                          color: selectedUserId === user._id
                            ? 'white'
                            : 'var(--text-primary)',
                          fontSize: '0.95rem',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }}>
                          {displayName}
                        </span>
                        {/* Role Badge */}
                        <span style={{
                          fontSize: '0.65rem',
                          fontWeight: '600',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: selectedUserId === user._id ? 'rgba(255,255,255,0.2)' : roleDisplay.bg,
                          color: selectedUserId === user._id ? 'white' : roleDisplay.color,
                          whiteSpace: 'nowrap',
                          flexShrink: 0
                        }}>
                          {roleDisplay.label}
                        </span>
                      </div>
                      <div style={{
                        fontSize: '0.8rem',
                        color: selectedUserId === user._id
                          ? 'rgba(255,255,255,0.7)'
                          : 'var(--text-secondary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {user.email}
                      </div>
                    </div>

                    {/* Warning indicator for allocation breach (only for clients) */}
                    {user.role === USER_ROLES.CLIENT && userBreaches[user._id] && (
                      <div
                        style={{
                          color: selectedUserId === user._id ? 'white' : '#f59e0b',
                          display: 'flex',
                          alignItems: 'center',
                          flexShrink: 0
                        }}
                        title="Allocation breach"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 2L1 21h22L12 2zm0 3.5L19.5 19h-15L12 5.5zM11 10v4h2v-4h-2zm0 6v2h2v-2h-2z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* User count */}
        <div style={{
          padding: '0.75rem 1rem',
          borderTop: '1px solid var(--border-color)',
          fontSize: '0.8rem',
          color: 'var(--text-secondary)',
          textAlign: 'center'
        }}>
          {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Right Panel - User Details */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        background: 'var(--bg-primary)'
      }}>
        {selectedUserId ? (
          <UserDetailsScreen
            userId={selectedUserId}
            onBack={() => setSelectedUserId(null)}
            embedded={true}
          />
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: 'var(--text-secondary)',
            padding: '2rem'
          }}>
            <div style={{ fontSize: '4rem', marginBottom: '1rem', opacity: 0.3 }}>👥</div>
            <h3 style={{
              margin: '0 0 0.5rem 0',
              color: 'var(--text-primary)',
              fontWeight: '500'
            }}>
              Select a User
            </h3>
            <p style={{
              margin: 0,
              fontSize: '0.95rem',
              textAlign: 'center',
              maxWidth: '300px'
            }}>
              Choose a user from the list to view and edit their details, bank accounts, and settings.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientsSection;
