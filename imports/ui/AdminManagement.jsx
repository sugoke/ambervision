import React, { useState, useEffect } from 'react';
import { USER_ROLES } from '/imports/api/users';
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