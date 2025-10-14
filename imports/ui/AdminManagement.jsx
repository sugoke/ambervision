import React, { useState, useEffect } from 'react';
import { USER_ROLES } from '/imports/api/users';
import UserManagement from './UserManagement.jsx';
import BankManagement from './BankManagement.jsx';
import IssuerManagementComponent from './IssuerManagementComponent.jsx';
import SystemOperations from './SystemOperations.jsx';
import MarketDataManager from './MarketDataManager.jsx';
import Prices from './Prices.jsx';
import CronJobsDashboard from './CronJobsDashboard.jsx';
import NotificationsPage from './NotificationsPage.jsx';

const AdminManagement = React.memo(({ user, currentSection, onEditProduct }) => {
  // Determine initial active tab based on currentSection
  const getInitialTab = () => {
    switch (currentSection) {
      case 'user-management': return 'users';
      case 'issuer-management': return 'issuers';
      case 'bank-management': return 'banks';
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
        case 'user-management': return 'users';
        case 'issuer-management': return 'issuers';
        case 'bank-management': return 'banks';
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
      id: 'issuers',
      label: 'Issuers',
      icon: '🏢',
      requiredRole: 'admin'
    },
    {
      id: 'users',
      label: 'Users',
      icon: '👥',
      requiredRole: 'superadmin'
    },
    {
      id: 'prices',
      label: 'Prices',
      icon: '📈',
      requiredRole: 'superadmin'
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
    }
  ];

  // Render active component only when needed
  const renderActiveComponent = () => {
    switch (activeTab) {
      case 'banks':
        return <BankManagement key="banks" user={user} />;
      case 'issuers':
        return <IssuerManagementComponent key="issuers" user={user} />;
      case 'users':
        return <UserManagement key="users" user={user} />;
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
            fontSize: '1.2rem',
            fontWeight: '600',
            color: 'var(--text-primary)'
          }}>
            Administration
          </h2>
          <p style={{
            margin: 0,
            color: 'var(--text-secondary)',
            fontSize: '0.9rem'
          }}>
            Manage products, users, and system settings
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
            {visibleTabs.map((tab) => (
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
                  borderBottom: activeTab === tab.id ? '3px solid var(--accent-color)' : '3px solid transparent',
                  backgroundColor: activeTab === tab.id ? 'var(--bg-tertiary)' : 'transparent',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px'
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