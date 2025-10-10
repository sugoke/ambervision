import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTracker } from 'meteor/react-meteor-data';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { useTheme } from './ThemeContext.jsx';

const BirthdayCalendar = () => {
  const { theme } = useTheme();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [showUpcoming, setShowUpcoming] = useState(true);
  const [daysAhead, setDaysAhead] = useState(30);

  // Responsive detection
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkScreenSize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    checkScreenSize();
    window.addEventListener('resize', checkScreenSize);
    return () => window.removeEventListener('resize', checkScreenSize);
  }, []);

  // Get current user and all users with birthdays
  const { currentUser, usersWithBirthdays, isLoading } = useTracker(() => {
    const sessionId = localStorage.getItem('sessionId');
    const usersSub = Meteor.subscribe('customUsers');
    
    // Note: We'll get the current user via Meteor method call in useEffect
    // This is just for subscribing to the users data
    const users = UsersCollection.find({
      'profile.birthday': { $exists: true, $ne: null }
    }).fetch();

    return {
      currentUser: null, // Will be set by useEffect
      usersWithBirthdays: users,
      isLoading: !usersSub.ready()
    };
  }, []);

  // Get current user via method call
  const [currentUserState, setCurrentUserState] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
      setAuthLoading(false);
      return;
    }

    Meteor.call('auth.getCurrentUser', sessionId, (err, user) => {
      if (!err && user) {
        setCurrentUserState(user);
      }
      setAuthLoading(false);
    });
  }, []);

  const actualCurrentUser = currentUserState;
  const actualIsLoading = isLoading || authLoading;

  // Filter users based on current user's role
  const getFilteredUsers = () => {
    if (!actualCurrentUser) {
      return [];
    }
    
    const allUsers = usersWithBirthdays;
    
    // Admin and SuperAdmin see everyone
    if (actualCurrentUser.role === USER_ROLES.ADMIN || actualCurrentUser.role === USER_ROLES.SUPERADMIN) {
      return allUsers;
    }
    
    // Relationship Manager sees only their assigned clients
    if (actualCurrentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      return allUsers.filter(user => 
        user.role === USER_ROLES.CLIENT && user.relationshipManagerId === actualCurrentUser._id
      );
    }
    
    // Other roles have no access
    return [];
  };

  // Process birthdays for display (includes family members)
  const processBirthdays = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const filteredUsers = getFilteredUsers();
    const allBirthdays = [];
    
    // Process user birthdays
    filteredUsers.forEach(user => {
      if (user.profile.birthday) {
        const birthday = new Date(user.profile.birthday);
        const birthMonth = birthday.getMonth();
        const birthDay = birthday.getDate();
        
        // Calculate age
        const age = today.getFullYear() - birthday.getFullYear() - 
          (today.getMonth() < birthMonth || 
           (today.getMonth() === birthMonth && today.getDate() < birthDay) ? 1 : 0);
        
        // Calculate next birthday
        const nextBirthday = new Date(today.getFullYear(), birthMonth, birthDay);
        if (nextBirthday < today) {
          nextBirthday.setFullYear(today.getFullYear() + 1);
        }
        
        // Calculate days until birthday
        const daysUntil = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
        
        allBirthdays.push({
          ...user,
          age,
          nextBirthday,
          daysUntil,
          birthMonth,
          birthDay,
          isToday: daysUntil === 0,
          isThisWeek: daysUntil > 0 && daysUntil <= 7,
          isThisMonth: daysUntil > 0 && daysUntil <= 30,
          isFamilyMember: false,
          familyRelationship: null,
          clientName: `${user.profile.firstName} ${user.profile.lastName}`
        });
      }
      
      // Process family members birthdays
      if (user.profile.familyMembers && user.profile.familyMembers.length > 0) {
        user.profile.familyMembers.forEach(familyMember => {
          if (familyMember.birthday) {
            const birthday = new Date(familyMember.birthday);
            const birthMonth = birthday.getMonth();
            const birthDay = birthday.getDate();
            
            // Calculate age (birth year is from birthday)
            const age = today.getFullYear() - birthday.getFullYear() - 
              (today.getMonth() < birthMonth || 
               (today.getMonth() === birthMonth && today.getDate() < birthDay) ? 1 : 0);
            
            // Calculate next birthday
            const nextBirthday = new Date(today.getFullYear(), birthMonth, birthDay);
            if (nextBirthday < today) {
              nextBirthday.setFullYear(today.getFullYear() + 1);
            }
            
            // Calculate days until birthday
            const daysUntil = Math.ceil((nextBirthday - today) / (1000 * 60 * 60 * 24));
            
            allBirthdays.push({
              _id: `${user._id}-family-${familyMember._id}`,
              username: familyMember.name,
              email: user.email, // Reference parent's email
              role: user.role,
              profile: {
                firstName: familyMember.name.split(' ')[0] || familyMember.name,
                lastName: familyMember.name.split(' ').slice(1).join(' ') || '',
                birthday: familyMember.birthday
              },
              age,
              nextBirthday,
              daysUntil,
              birthMonth,
              birthDay,
              isToday: daysUntil === 0,
              isThisWeek: daysUntil > 0 && daysUntil <= 7,
              isThisMonth: daysUntil > 0 && daysUntil <= 30,
              isFamilyMember: true,
              familyRelationship: familyMember.relationship,
              clientName: `${user.profile.firstName} ${user.profile.lastName}`
            });
          }
        });
      }
    });
    
    return allBirthdays.sort((a, b) => a.daysUntil - b.daysUntil);
  };

  const birthdays = processBirthdays();

  // Filter birthdays based on view mode
  const filteredBirthdays = showUpcoming 
    ? birthdays.filter(b => b.daysUntil >= 0 && b.daysUntil <= daysAhead)
    : birthdays.filter(b => b.birthMonth === selectedMonth);

  // Group birthdays by month for calendar view
  const birthdaysByMonth = {};
  birthdays.forEach(birthday => {
    const monthName = new Date(2000, birthday.birthMonth, 1).toLocaleDateString('en-US', { month: 'long' });
    if (!birthdaysByMonth[monthName]) {
      birthdaysByMonth[monthName] = [];
    }
    birthdaysByMonth[monthName].push(birthday);
  });

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  // Get role display name
  const getRoleDisplay = (role) => {
    switch(role) {
      case USER_ROLES.SUPERADMIN: return 'Super Admin';
      case USER_ROLES.ADMIN: return 'Admin';
      case USER_ROLES.RELATIONSHIP_MANAGER: return 'Relationship Manager';
      case USER_ROLES.CLIENT: return 'Client';
      default: return role;
    }
  };

  if (actualIsLoading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '400px',
        color: 'var(--text-secondary)'
      }}>
        Loading birthday calendar...
      </div>
    );
  }

  if (!actualCurrentUser || (
    actualCurrentUser.role !== USER_ROLES.ADMIN && 
    actualCurrentUser.role !== USER_ROLES.SUPERADMIN && 
    actualCurrentUser.role !== USER_ROLES.RELATIONSHIP_MANAGER
  )) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '4rem 2rem',
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        border: '2px dashed var(--border-color)',
        maxWidth: '600px',
        margin: '2rem auto'
      }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.5 }}>🚫</div>
        <h2 style={{
          margin: '0 0 1rem 0',
          color: 'var(--text-secondary)',
          fontSize: '1.2rem'
        }}>
          Access Denied
        </h2>
        <p style={{
          margin: '0',
          color: 'var(--text-muted)',
          fontSize: '1rem'
        }}>
          Only administrators and relationship managers can view the birthday calendar.
        </p>
      </div>
    );
  }

  return (
    <div style={{ 
      maxWidth: '1200px', 
      margin: '0 auto', 
      padding: isMobile ? '1rem' : '2rem',
      backgroundColor: 'transparent',
      transition: 'all 0.3s ease'
    }}>
      {/* Dashboard Header */}
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: isMobile ? '1rem' : '0',
        marginBottom: '2rem',
        padding: isMobile ? '1rem 0' : '1.5rem 0',
        borderBottom: '2px solid var(--border-color)'
      }}>
        <div>
          <h1 style={{
            margin: '0 0 0.5rem 0',
            fontSize: isMobile ? '1.5rem' : '2rem',
            fontWeight: '700',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}>
            🎂 Birthday Calendar
          </h1>
          <p style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.9rem' : '1rem'
          }}>
            Track and celebrate team and client birthdays
          </p>
        </div>
      </div>

      {/* Filter Controls */}
      <div style={{
        marginBottom: '2rem',
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'stretch' : 'center',
        gap: isMobile ? '1rem' : '0'
      }}>
        <div style={{ 
          display: 'flex', 
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : 'center',
          gap: isMobile ? '1rem' : '0'
        }}>
          {/* View Toggle Buttons */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            marginRight: isMobile ? '0' : '20px'
          }}>
            <button
              onClick={() => setShowUpcoming(true)}
              style={{
                padding: '8px 16px',
                border: `2px solid ${showUpcoming ? 'var(--accent-color)' : 'var(--border-color)'}`,
                borderRadius: '10px',
                background: showUpcoming ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: showUpcoming ? 'white' : 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '500',
                transition: 'all 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              📅 Upcoming
            </button>
            <button
              onClick={() => setShowUpcoming(false)}
              style={{
                padding: '8px 16px',
                border: `2px solid ${!showUpcoming ? 'var(--accent-color)' : 'var(--border-color)'}`,
                borderRadius: '10px',
                background: !showUpcoming ? 'var(--accent-color)' : 'var(--bg-secondary)',
                color: !showUpcoming ? 'white' : 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: '500',
                transition: 'all 0.3s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              📆 Monthly
            </button>
          </div>
        </div>

        {/* Filter Options - Right aligned */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          {showUpcoming ? (
            <>
              <span style={{
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                fontWeight: '500'
              }}>
                Show
              </span>
              <select
                value={daysAhead}
                onChange={(e) => setDaysAhead(Number(e.target.value))}
                style={{
                  padding: '6px 12px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease'
                }}
              >
                <option value="7">Next 7 days</option>
                <option value="30">Next 30 days</option>
                <option value="60">Next 60 days</option>
                <option value="90">Next 90 days</option>
                <option value="365">Next 365 days</option>
              </select>
            </>
          ) : (
            <>
              <span style={{
                color: 'var(--text-primary)',
                fontSize: '0.95rem',
                fontWeight: '500'
              }}>
                Month
              </span>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                style={{
                  padding: '6px 12px',
                  border: '2px solid var(--border-color)',
                  borderRadius: '6px',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  transition: 'all 0.3s ease',
                  minWidth: '120px'
                }}
              >
                {months.map((month, index) => (
                  <option key={month} value={index}>{month}</option>
                ))}
              </select>
            </>
          )}
        </div>
      </div>

      {/* Today's Birthdays Alert */}
      {birthdays.some(b => b.isToday) && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(255, 193, 7, 0.1) 0%, rgba(255, 193, 7, 0.05) 100%)',
          border: '1px solid var(--warning-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          marginBottom: '2rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem'
        }}>
          <span style={{ fontSize: isMobile ? '1.5rem' : '2rem' }}>🎉</span>
          <div>
            <strong style={{ 
              fontSize: isMobile ? '1rem' : '1.1rem',
              color: 'var(--text-primary)'
            }}>Today's Birthdays!</strong>
            <div style={{ 
              marginTop: '0.5rem',
              fontSize: isMobile ? '0.85rem' : '0.95rem',
              color: 'var(--text-secondary)'
            }}>
              {birthdays.filter(b => b.isToday).map(b => (
                <span key={b._id} style={{ 
                  marginRight: '1rem',
                  display: isMobile ? 'block' : 'inline'
                }}>
                  {b.profile.firstName} {b.profile.lastName} ({b.age + 1} years)
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Birthday List */}
      {filteredBirthdays.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '4rem 2rem',
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '2px dashed var(--border-color)',
          marginBottom: '2rem'
        }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '1rem', opacity: 0.5 }}>📭</div>
          <h2 style={{
            margin: '0 0 1rem 0',
            color: 'var(--text-secondary)',
            fontSize: '1.2rem'
          }}>
            No birthdays found for the selected period
          </h2>
          <p style={{
            margin: '0',
            color: 'var(--text-muted)',
            fontSize: '1rem'
          }}>
            Try adjusting your filter settings or add birthday information to user profiles.
          </p>
        </div>
      ) : (
        <div style={{
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: '1px solid var(--border-color)',
          overflow: isMobile ? 'auto' : 'hidden'
        }}>
          <table style={{
            width: isMobile ? 'max-content' : '100%',
            minWidth: isMobile ? '600px' : 'auto',
            borderCollapse: 'collapse',
            tableLayout: 'fixed'
          }}>
            <thead>
              <tr style={{
                background: 'var(--bg-tertiary)',
                borderBottom: '2px solid var(--border-color)'
              }}>
                <th style={{ 
                  padding: isMobile ? '8px 12px' : '12px 16px',
                  textAlign: 'left',
                  fontSize: isMobile ? '0.75rem' : '0.85rem',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '25%'
                }}>
                  Name
                </th>
                <th style={{ 
                  padding: isMobile ? '8px 12px' : '12px 16px',
                  textAlign: 'left',
                  fontSize: isMobile ? '0.75rem' : '0.85rem',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '20%'
                }}>
                  Role
                </th>
                <th style={{ 
                  padding: isMobile ? '8px 12px' : '12px 16px',
                  textAlign: 'left',
                  fontSize: isMobile ? '0.75rem' : '0.85rem',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '25%'
                }}>
                  Birthday
                </th>
                <th style={{ 
                  padding: isMobile ? '8px 12px' : '12px 16px',
                  textAlign: 'center',
                  fontSize: isMobile ? '0.75rem' : '0.85rem',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '15%'
                }}>
                  Age
                </th>
                <th style={{ 
                  padding: isMobile ? '8px 12px' : '12px 16px',
                  textAlign: 'center',
                  fontSize: isMobile ? '0.75rem' : '0.85rem',
                  fontWeight: '600',
                  color: 'var(--text-secondary)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  width: '15%'
                }}>
                  Days Until
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredBirthdays.map((birthday, index) => (
                <tr 
                  key={birthday._id}
                  style={{
                    borderBottom: index < filteredBirthdays.length - 1 ? '1px solid var(--border-color)' : 'none',
                    backgroundColor: birthday.isToday ? 'rgba(0, 123, 255, 0.1)' : 
                                   birthday.isThisWeek ? 'rgba(0, 123, 255, 0.05)' : 'transparent',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!birthday.isToday) {
                      e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!birthday.isToday) {
                      e.currentTarget.style.backgroundColor = birthday.isThisWeek ? 'rgba(0, 123, 255, 0.05)' : 'transparent';
                    }
                  }}
                >
                  <td style={{ 
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.85rem' : '0.95rem',
                    fontWeight: birthday.isToday ? '600' : '400',
                    color: 'var(--text-primary)'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      {birthday.isToday && <span>🎉</span>}
                      {birthday.isThisWeek && !birthday.isToday && <span>🎈</span>}
                      <div>
                        <div style={{ fontSize: isMobile ? '0.9rem' : '1.05rem', color: 'var(--text-primary)' }}>
                          {birthday.profile.firstName} {birthday.profile.lastName}
                          {birthday.isFamilyMember && (
                            <span style={{ 
                              marginLeft: '0.5rem', 
                              fontSize: isMobile ? '0.7rem' : '0.8rem',
                              color: 'var(--accent-color)',
                              fontWeight: '500'
                            }}>
                              ({birthday.familyRelationship})
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: isMobile ? '0.75rem' : '0.85rem', color: 'var(--text-secondary)' }}>
                          {birthday.isFamilyMember 
                            ? `Family of ${birthday.clientName}`
                            : birthday.username
                          }
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ 
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.85rem' : '0.95rem',
                    color: 'var(--text-primary)'
                  }}>
                    <span style={{
                      padding: '0.25rem 0.75rem',
                      borderRadius: '20px',
                      fontSize: isMobile ? '0.75rem' : '0.85rem',
                      fontWeight: '500',
                      backgroundColor: birthday.isFamilyMember ? '#f8f9fa' : 
                        birthday.role === USER_ROLES.CLIENT ? '#e3f2fd' :
                        birthday.role === USER_ROLES.RELATIONSHIP_MANAGER ? '#f3e5f5' :
                        birthday.role === USER_ROLES.ADMIN ? '#fff3e0' : '#e8f5e9',
                      color: birthday.isFamilyMember ? '#6c757d' :
                        birthday.role === USER_ROLES.CLIENT ? '#1565c0' :
                        birthday.role === USER_ROLES.RELATIONSHIP_MANAGER ? '#6a1b9a' :
                        birthday.role === USER_ROLES.ADMIN ? '#ef6c00' : '#2e7d32'
                    }}>
                      {birthday.isFamilyMember ? 'Family Member' : getRoleDisplay(birthday.role)}
                    </span>
                  </td>
                  <td style={{ 
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    fontSize: isMobile ? '0.85rem' : '0.95rem',
                    color: 'var(--text-primary)'
                  }}>
                    {new Date(birthday.profile.birthday).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </td>
                  <td style={{ 
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    textAlign: 'center',
                    fontSize: isMobile ? '0.95rem' : '1.1rem',
                    fontWeight: birthday.isToday ? '600' : '400',
                    color: birthday.isToday ? 'var(--success-color)' : 'var(--text-primary)'
                  }}>
                    {birthday.age + (birthday.daysUntil === 0 ? 1 : 0)}
                  </td>
                  <td style={{ 
                    padding: isMobile ? '10px 12px' : '14px 16px',
                    textAlign: 'center',
                    fontWeight: birthday.isToday ? '600' : '400',
                    fontSize: isMobile ? '0.85rem' : '0.95rem'
                  }}>
                    {birthday.isToday ? (
                      <span style={{ 
                        color: 'var(--success-color)',
                        fontWeight: '600',
                        fontSize: isMobile ? '0.9rem' : '1.05rem'
                      }}>
                        Today! 🎂
                      </span>
                    ) : (
                      <span style={{
                        color: birthday.isThisWeek ? 'var(--accent-color)' : 'var(--text-secondary)'
                      }}>
                        {birthday.daysUntil} day{birthday.daysUntil !== 1 ? 's' : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Statistics Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: isMobile ? '0.75rem' : '1.5rem',
        marginTop: '2rem',
        marginBottom: '2rem'
      }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          textAlign: 'center',
          boxShadow: '0 2px 4px var(--shadow)',
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'center',
          gap: isMobile ? '0.5rem' : '0'
        }}>
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            order: isMobile ? 1 : 2
          }}>
            This Month
          </div>
          <div style={{
            fontSize: isMobile ? '1.1rem' : '1.3rem',
            fontWeight: '700',
            color: 'var(--accent-color)',
            marginBottom: isMobile ? '0' : '0.5rem',
            order: isMobile ? 2 : 1
          }}>
            {birthdays.filter(b => b.isThisMonth).length}
          </div>
        </div>
        <div style={{
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          textAlign: 'center',
          boxShadow: '0 2px 4px var(--shadow)',
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'center',
          gap: isMobile ? '0.5rem' : '0'
        }}>
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            order: isMobile ? 1 : 2
          }}>
            This Week
          </div>
          <div style={{
            fontSize: isMobile ? '1.1rem' : '1.3rem',
            fontWeight: '700',
            color: 'var(--success-color)',
            marginBottom: isMobile ? '0' : '0.5rem',
            order: isMobile ? 2 : 1
          }}>
            {birthdays.filter(b => b.isThisWeek).length}
          </div>
        </div>
        <div style={{
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          textAlign: 'center',
          boxShadow: '0 2px 4px var(--shadow)',
          display: 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'center',
          gap: isMobile ? '0.5rem' : '0'
        }}>
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            order: isMobile ? 1 : 2
          }}>
            Today
          </div>
          <div style={{
            fontSize: isMobile ? '1.1rem' : '1.3rem',
            fontWeight: '700',
            color: 'var(--warning-color)',
            marginBottom: isMobile ? '0' : '0.5rem',
            order: isMobile ? 2 : 1
          }}>
            {birthdays.filter(b => b.isToday).length}
          </div>
        </div>
        <div style={{
          background: 'linear-gradient(135deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          padding: isMobile ? '1rem' : '1.5rem',
          textAlign: 'center',
          boxShadow: '0 2px 4px var(--shadow)',
          display: isMobile ? 'none' : 'flex',
          flexDirection: isMobile ? 'row' : 'column',
          alignItems: 'center',
          justifyContent: isMobile ? 'space-between' : 'center',
          gap: isMobile ? '0.5rem' : '0'
        }}>
          <div style={{
            color: 'var(--text-secondary)',
            fontSize: isMobile ? '0.85rem' : '0.9rem',
            fontWeight: '500',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            order: isMobile ? 1 : 2
          }}>
            Total Users
          </div>
          <div style={{
            fontSize: isMobile ? '1.1rem' : '1.3rem',
            fontWeight: '700',
            color: '#6b7280',
            marginBottom: isMobile ? '0' : '0.5rem',
            order: isMobile ? 2 : 1
          }}>
            {getFilteredUsers().length}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BirthdayCalendar;