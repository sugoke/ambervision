import React, { useState, useMemo, useEffect } from 'react';
import { useTracker } from 'meteor/react-meteor-data';
import { Meteor } from 'meteor/meteor';
import { USER_ROLES, UsersCollection, getRoleCategory, USER_TYPE_CATEGORIES } from '/imports/api/users';
import UserDetailsScreen from './UserDetailsScreen.jsx';
import BankManagement from './BankManagement.jsx';
import BankConnectionsManager from './BankConnectionsManager.jsx';
import SecuritiesBase from './SecuritiesBase.jsx';
import IssuerManagementComponent from './IssuerManagementComponent.jsx';
import SystemOperations from './SystemOperations.jsx';
import MarketDataManager from './MarketDataManager.jsx';
import Prices from './Prices.jsx';
import CronJobsDashboard from './CronJobsDashboard.jsx';
import NotificationsPage from './NotificationsPage.jsx';
import ServerLogsViewer from './ServerLogsViewer.jsx';
import ManualPriceTracker from './ManualPriceTracker.jsx';

// ── User Accesses Panel (moved from Contacts) ──
const USER_SUB_TABS = { ALL: 'all', STAFF: 'staff', CLIENTS: 'clients', INTRODUCERS: 'introducers' };

const UserAccessesPanel = ({ currentUser }) => {
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [subTab, setSubTab] = useState(USER_SUB_TABS.ALL);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', firstName: '', lastName: '', role: USER_ROLES.STAFF });
  const [isCreating, setIsCreating] = useState(false);

  const sessionId = localStorage.getItem('sessionId');
  const subscription = useMemo(() => Meteor.subscribe('rmClients', sessionId), []);

  const { users, isLoading } = useTracker(() => {
    const allUsers = UsersCollection.find(
      { isActive: { $ne: false } },
      { sort: { 'profile.lastName': 1, 'profile.firstName': 1 } }
    ).fetch();
    return { users: allUsers, isLoading: !subscription.ready() };
  }, [subscription]);

  const getRoleDisplay = (role) => {
    const map = {
      [USER_ROLES.SUPERADMIN]: { label: 'Super Admin', color: '#dc2626' },
      [USER_ROLES.ADMIN]: { label: 'Admin', color: '#9333ea' },
      [USER_ROLES.COMPLIANCE]: { label: 'Compliance', color: '#0891b2' },
      [USER_ROLES.RELATIONSHIP_MANAGER]: { label: 'RM', color: '#2563eb' },
      [USER_ROLES.ASSISTANT]: { label: 'Assistant', color: '#7c3aed' },
      [USER_ROLES.STAFF]: { label: 'Staff', color: '#6366f1' },
      [USER_ROLES.CLIENT]: { label: 'Client', color: '#059669' },
      [USER_ROLES.INTRODUCER]: { label: 'Introducer', color: '#ec4899' },
    };
    return map[role] || { label: role, color: '#6b7280' };
  };

  const filteredUsers = users
    .filter(u => {
      if (u.role === USER_ROLES.LIFE_INSURANCE || u.role === USER_ROLES.PROSPECT) return false;
      if (subTab === USER_SUB_TABS.STAFF && getRoleCategory(u.role) !== USER_TYPE_CATEGORIES.STAFF) return false;
      if (subTab === USER_SUB_TABS.CLIENTS && u.role !== USER_ROLES.CLIENT) return false;
      if (subTab === USER_SUB_TABS.INTRODUCERS && getRoleCategory(u.role) !== USER_TYPE_CATEGORIES.INTRODUCERS) return false;
      if (!searchTerm) return true;
      const name = `${u.profile?.firstName || ''} ${u.profile?.lastName || ''} ${u.email || ''}`.toLowerCase();
      return name.includes(searchTerm.toLowerCase());
    })
    .sort((a, b) => {
      const rolePri = { [USER_ROLES.SUPERADMIN]: 1, [USER_ROLES.ADMIN]: 2, [USER_ROLES.COMPLIANCE]: 3, [USER_ROLES.RELATIONSHIP_MANAGER]: 4, [USER_ROLES.ASSISTANT]: 5, [USER_ROLES.CLIENT]: 6 };
      const diff = (rolePri[a.role] || 7) - (rolePri[b.role] || 7);
      if (diff !== 0) return diff;
      return (a.profile?.lastName || '').localeCompare(b.profile?.lastName || '');
    });

  const subTabCounts = useMemo(() => {
    const c = { all: 0, staff: 0, clients: 0, introducers: 0 };
    users.forEach(u => {
      if (u.role === USER_ROLES.LIFE_INSURANCE || u.role === USER_ROLES.PROSPECT) return;
      c.all++;
      if (u.role === USER_ROLES.CLIENT) c.clients++;
      else if (getRoleCategory(u.role) === USER_TYPE_CATEGORIES.STAFF) c.staff++;
      else if (getRoleCategory(u.role) === USER_TYPE_CATEGORIES.INTRODUCERS) c.introducers++;
    });
    return c;
  }, [users]);

  const handleCreate = (e) => {
    e.preventDefault();
    setIsCreating(true);
    Meteor.call('users.create', { email: newUser.email, password: newUser.password, role: newUser.role, profile: { firstName: newUser.firstName, lastName: newUser.lastName }, sessionId }, (err, result) => {
      setIsCreating(false);
      if (err) { alert(err.reason || 'Failed to create user'); return; }
      setNewUser({ email: '', password: '', firstName: '', lastName: '', role: USER_ROLES.STAFF });
      setShowCreateForm(false);
      if (result?.customUserId) setSelectedUserId(result.customUserId);
    });
  };

  if (selectedUserId) {
    return <UserDetailsScreen userId={selectedUserId} onBack={() => setSelectedUserId(null)} embedded={false} />;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-primary)' }}>User Accesses</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => setShowCreateForm(!showCreateForm)} style={{
            background: showCreateForm ? 'var(--danger-color)' : 'var(--accent-color)', color: 'white', border: 'none',
            padding: '7px 14px', borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600'
          }}>{showCreateForm ? 'Cancel' : '+ New User'}</button>
        </div>
      </div>

      {/* Search + Sub-tabs */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '1rem' }}>
        <input type="text" placeholder="Search users..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
          style={{ flex: 1, padding: '9px 14px', border: '1.5px solid var(--border-color)', borderRadius: '8px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.88rem', outline: 'none' }} />
        <div style={{ display: 'flex', gap: '2px', background: 'var(--bg-tertiary)', borderRadius: '6px', padding: '2px' }}>
          {[
            { id: USER_SUB_TABS.ALL, label: 'All', count: subTabCounts.all },
            { id: USER_SUB_TABS.STAFF, label: 'Staff', count: subTabCounts.staff },
            { id: USER_SUB_TABS.CLIENTS, label: 'Clients', count: subTabCounts.clients },
            { id: USER_SUB_TABS.INTRODUCERS, label: 'Introd.', count: subTabCounts.introducers }
          ].map(t => (
            <button key={t.id} onClick={() => setSubTab(t.id)} style={{
              padding: '5px 10px', borderRadius: '5px', border: 'none', cursor: 'pointer',
              background: subTab === t.id ? 'var(--accent-color)' : 'transparent',
              color: subTab === t.id ? 'white' : 'var(--text-muted)',
              fontSize: '0.75rem', fontWeight: subTab === t.id ? '600' : '400', transition: 'all 0.15s'
            }}>{t.label} <span style={{ opacity: 0.6 }}>{t.count}</span></button>
          ))}
        </div>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <form onSubmit={handleCreate} style={{ padding: '16px', background: 'var(--bg-tertiary)', borderRadius: '10px', border: '1px solid var(--border-color)', marginBottom: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px', marginBottom: '10px' }}>
            <input type="email" placeholder="Email *" required value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})}
              style={{ padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.88rem' }} />
            <input type="text" placeholder="Password *" required value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})}
              style={{ padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.88rem' }} />
            <input type="text" placeholder="First Name" value={newUser.firstName} onChange={e => setNewUser({...newUser, firstName: e.target.value})}
              style={{ padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.88rem' }} />
            <input type="text" placeholder="Last Name" value={newUser.lastName} onChange={e => setNewUser({...newUser, lastName: e.target.value})}
              style={{ padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.88rem' }} />
            <select value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}
              style={{ padding: '9px 12px', border: '1px solid var(--border-color)', borderRadius: '6px', background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: '0.88rem', cursor: 'pointer' }}>
              <option value={USER_ROLES.STAFF}>Staff</option>
              <option value={USER_ROLES.RELATIONSHIP_MANAGER}>RM</option>
              <option value={USER_ROLES.ASSISTANT}>Assistant</option>
              <option value={USER_ROLES.COMPLIANCE}>Compliance</option>
              <option value={USER_ROLES.ADMIN}>Admin</option>
              {currentUser?.role === USER_ROLES.SUPERADMIN && <option value={USER_ROLES.SUPERADMIN}>Super Admin</option>}
              <option value={USER_ROLES.CLIENT}>Client</option>
              <option value={USER_ROLES.INTRODUCER}>Introducer</option>
            </select>
          </div>
          <button type="submit" disabled={isCreating} style={{
            background: 'var(--accent-color)', color: 'white', border: 'none', padding: '9px 20px',
            borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '600', opacity: isCreating ? 0.6 : 1
          }}>{isCreating ? 'Creating...' : 'Create User'}</button>
        </form>
      )}

      {/* User Table */}
      {isLoading ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>Loading...</div>
      ) : filteredUsers.length === 0 ? (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No users found</div>
      ) : (
        <div style={{ borderRadius: '10px', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ background: 'var(--bg-secondary)' }}>
                <th style={{ padding: '11px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1.5px solid var(--border-color)' }}>Name</th>
                <th style={{ padding: '11px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1.5px solid var(--border-color)' }}>Email</th>
                <th style={{ padding: '11px 16px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: '600', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1.5px solid var(--border-color)' }}>Role</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u, i) => {
                const rd = getRoleDisplay(u.role);
                const name = `${u.profile?.firstName || ''} ${u.profile?.lastName || ''}`.trim() || u.email || 'Unnamed';
                return (
                  <tr key={u._id} onClick={() => setSelectedUserId(u._id)}
                    style={{ cursor: 'pointer', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)', transition: 'background 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)'}
                  >
                    <td style={{ padding: '12px 16px', fontWeight: '600', color: 'var(--text-primary)', borderTop: '1px solid var(--border-color)' }}>{name}</td>
                    <td style={{ padding: '12px 16px', color: 'var(--text-secondary)', borderTop: '1px solid var(--border-color)' }}>{u.email}</td>
                    <td style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)' }}>
                      <span style={{ padding: '2px 8px', borderRadius: '6px', fontSize: '0.7rem', fontWeight: '600', color: rd.color, background: `${rd.color}14` }}>{rd.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const AdminManagement = React.memo(({ user, currentSection, onEditProduct }) => {
  // Determine initial active tab based on currentSection
  const getInitialTab = () => {
    switch (currentSection) {
      case 'issuer-management': return 'issuers';
      case 'bank-management': return 'banks';
      case 'bank-connections': return 'connections';
      case 'price-data-upload': return 'prices';
      case 'system-operations': return 'system';
      case 'market-data': return 'market';
      case 'cron-jobs': return 'cron';
      case 'notifications': return 'notifications';
      case 'administration': return 'banks'; // Default to first tab
      default: return 'banks';
    }
  };

  const [activeTab, setActiveTab] = useState(getInitialTab());

  // Update activeTab when currentSection changes
  useEffect(() => {
    const getTabFromSection = (section) => {
      switch (section) {
        case 'issuer-management': return 'issuers';
        case 'bank-management': return 'banks';
        case 'bank-connections': return 'connections';
        case 'price-data-upload': return 'prices';
        case 'system-operations': return 'system';
        case 'market-data': return 'market';
        case 'cron-jobs': return 'cron';
        case 'notifications': return 'notifications';
        case 'administration': return 'banks'; // Default to first tab
        default: return 'banks';
      }
    };

    const newTab = getTabFromSection(currentSection);
    setActiveTab(newTab);
  }, [currentSection]);

  const getUserRole = () => {
    return user?.role || 'client';
  };

  const hasAccess = (requiredRole) => {
    const roleHierarchy = { client: 1, admin: 2, superadmin: 3 };
    const userRoleLevel = roleHierarchy[getUserRole()] || 1;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 1;
    return userRoleLevel >= requiredRoleLevel;
  };

  const tabs = [
    {
      id: 'banks',
      label: 'Banks',
      icon: '🏛️',
      requiredRole: 'admin'
    },
    {
      id: 'connections',
      label: 'Connections',
      icon: '🔌',
      requiredRole: 'admin'
    },
    {
      id: 'securities',
      label: 'Securities Base',
      icon: '🔖',
      requiredRole: 'admin'
    },
    {
      id: 'issuers',
      label: 'Issuers',
      icon: '🏢',
      requiredRole: 'admin'
    },
    {
      id: 'prices',
      label: 'Prices',
      icon: '📈',
      requiredRole: 'admin'
    },
    {
      id: 'system',
      label: 'System',
      icon: '⚙️',
      requiredRole: 'admin'
    },
    {
      id: 'market',
      label: 'Market Data',
      icon: '💹',
      requiredRole: 'admin'
    },
    {
      id: 'cron',
      label: 'Cron Jobs',
      icon: '⏰',
      requiredRole: 'admin'
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: '🔔',
      requiredRole: 'admin'
    },
    {
      id: 'logs',
      label: 'Logs',
      icon: '📋',
      requiredRole: 'admin'
    },
    {
      id: 'priceTracker',
      label: 'Price Tracker',
      icon: '🔍',
      requiredRole: 'admin'
    },
    {
      id: 'users',
      label: 'User Accesses',
      icon: '🔑',
      requiredRole: 'admin'
    }
  ];

  // Render active component only when needed
  const renderActiveComponent = () => {
    switch (activeTab) {
      case 'banks':
        return <BankManagement key="banks" user={user} />;
      case 'connections':
        return <BankConnectionsManager key="connections" user={user} />;
      case 'securities':
        return <SecuritiesBase key="securities" user={user} />;
      case 'issuers':
        return <IssuerManagementComponent key="issuers" user={user} />;
      case 'prices':
        return <Prices key="prices" />;
      case 'system':
        return <SystemOperations key="system" user={user} />;
      case 'market':
        return <MarketDataManager key="market" user={user} />;
      case 'cron':
        return <CronJobsDashboard key="cron" user={user} />;
      case 'notifications':
        return <NotificationsPage key="notifications" currentUser={user} />;
      case 'logs':
        return <ServerLogsViewer key="logs" sessionId={localStorage.getItem('sessionId')} />;
      case 'priceTracker':
        return <ManualPriceTracker key="priceTracker" user={user} />;
      case 'users':
        return <UserAccessesPanel key="users" currentUser={user} />;
      default:
        return null;
    }
  };

  const visibleTabs = tabs.filter(tab => hasAccess(tab.requiredRole));

  return (
    <>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: 'min(2rem, 5vw)'
      }}>
      <section style={{
        background: 'var(--bg-secondary)',
        borderRadius: '12px',
        padding: 'min(2rem, 5vw)',
        boxShadow: '0 1px 3px var(--shadow)',
        border: '1px solid var(--border-color)',
        transition: 'all 0.3s ease'
      }}>
        {/* Header */}
        <div style={{
          marginBottom: '1.5rem'
        }}>
          <h2 style={{
            margin: '0 0 0.5rem 0',
            fontSize: 'clamp(1rem, 4vw, 1.2rem)',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Administration
          </h2>
          <p style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: 'clamp(0.8rem, 3vw, 0.9rem)'
          }}>
            Manage products, users, and system settings
          </p>
        </div>

        {/* Tab Navigation */}
        <div style={{
          borderBottom: '2px solid var(--border-color)',
          marginBottom: '1.5rem'
        }}>
          <div style={{
            display: 'flex',
            gap: '0',
            overflowX: 'auto',
            WebkitOverflowScrolling: 'touch'
          }}>
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: 'clamp(8px, 2vw, 12px) clamp(12px, 4vw, 24px)',
                  border: 'none',
                  background: 'none',
                  cursor: 'pointer',
                  fontSize: 'clamp(0.75rem, 3vw, 0.9rem)',
                  fontWeight: '500',
                  color: activeTab === tab.id ? 'var(--accent-color)' : 'var(--text-secondary)',
                  borderBottom: activeTab === tab.id ? '3px solid var(--accent-color)' : '3px solid transparent',
                  backgroundColor: activeTab === tab.id ? 'var(--bg-tertiary)' : 'transparent',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'clamp(4px, 2vw, 8px)'
                }}
                onMouseEnter={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.color = 'var(--text-primary)';
                    e.currentTarget.style.backgroundColor = 'var(--bg-tertiary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (activeTab !== tab.id) {
                    e.currentTarget.style.color = 'var(--text-secondary)';
                    e.currentTarget.style.backgroundColor = 'transparent';
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
          {renderActiveComponent()}
        </div>
      </section>
      </div>
    </>
  );
});

export default AdminManagement;