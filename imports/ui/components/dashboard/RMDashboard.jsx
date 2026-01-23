import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import AlertsCard from './AlertsCard.jsx';
import PortfolioSummaryCard from './PortfolioSummaryCard.jsx';
import BirthdaysCard from './BirthdaysCard.jsx';
import UpcomingEventsCard from './UpcomingEventsCard.jsx';
import MarketWatchlistCard from './MarketWatchlistCard.jsx';
import RecentActivityCard from './RecentActivityCard.jsx';
import CashMonitoringCard from './CashMonitoringCard.jsx';
import AUMMiniChart from './AUMMiniChart.jsx';
import { useViewAs } from '../../ViewAsContext.jsx';

const RMDashboard = ({ user, onNavigate }) => {
  const { setFilter } = useViewAs();

  // Detect if user is a client (shows personalized dashboard without RM-specific features)
  const isClient = user?.role === 'client';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dailyQuote, setDailyQuote] = useState(null);
  const [dashboardCurrency, setDashboardCurrency] = useState(() => {
    return localStorage.getItem('dashboardCurrency') || 'EUR';
  });
  const [data, setData] = useState({
    alerts: [],
    summary: null,
    birthdays: [],
    events: [],
    watchlist: [],
    activity: [],
    cashMonitoring: { negativeCashAccounts: [], highCashAccounts: [] }
  });

  useEffect(() => {
    loadDashboardData();
    loadDailyQuote();

    // Refresh every 5 minutes
    const interval = setInterval(loadDashboardData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);

  const loadDailyQuote = async () => {
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;

    try {
      const quote = await Meteor.callAsync('rmDashboard.getDailyQuote', sessionId);
      setDailyQuote(quote);
    } catch (err) {
      console.error('[RMDashboard] Error loading daily quote:', err);
    }
  };

  const loadDashboardData = async (currency = dashboardCurrency) => {
    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) {
      setError('No session found');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // Load all data in parallel (pass currency to getPortfolioSummary for AUM conversion)
      const [alerts, summary, birthdays, events, watchlist, activity, cashMonitoring] = await Promise.all([
        Meteor.callAsync('rmDashboard.getAlerts', sessionId),
        Meteor.callAsync('rmDashboard.getPortfolioSummary', sessionId, currency),
        Meteor.callAsync('rmDashboard.getBirthdays', sessionId),
        Meteor.callAsync('rmDashboard.getUpcomingEvents', sessionId, 2),
        Meteor.callAsync('rmDashboard.getWatchlist', sessionId),
        Meteor.callAsync('rmDashboard.getRecentActivity', sessionId, 5),
        Meteor.callAsync('rmDashboard.getCashMonitoring', sessionId)
      ]);

      setData({ alerts, summary, birthdays, events, watchlist, activity, cashMonitoring });
    } catch (err) {
      console.error('[RMDashboard] Error loading data:', err);
      setError(err.reason || err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  // Handle currency change from PortfolioSummaryCard - refresh only the summary
  const handleCurrencyChange = async (newCurrency) => {
    setDashboardCurrency(newCurrency);
    localStorage.setItem('dashboardCurrency', newCurrency);

    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;

    try {
      // Only refresh the summary with the new currency
      const summary = await Meteor.callAsync('rmDashboard.getPortfolioSummary', sessionId, newCurrency);
      setData(prev => ({ ...prev, summary }));
    } catch (err) {
      console.error('[RMDashboard] Error refreshing portfolio summary:', err);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const handleAlertClick = (alert) => {
    if (alert.productId && onNavigate) {
      onNavigate('report', { productId: alert.productId });
    } else if (alert.clientId && onNavigate) {
      onNavigate('client', { clientId: alert.clientId });
    }
  };

  const handleEventClick = (event) => {
    if (event.productId && onNavigate) {
      onNavigate('report', { productId: event.productId });
    }
  };

  const handleBirthdayClick = (birthday) => {
    if (birthday.clientId && onNavigate) {
      onNavigate('client', { clientId: birthday.clientId });
    }
  };

  const handleTickerClick = (ticker) => {
    // Could navigate to underlying analysis or open external chart
    console.log('Ticker clicked:', ticker);
  };

  const handleActivityClick = (activity) => {
    if (activity.productId && onNavigate) {
      onNavigate('report', { productId: activity.productId });
    }
  };

  const handleCashAccountClick = (account) => {
    if (account.clientId && onNavigate) {
      // Set view-as filter to the CLIENT (shows all their accounts)
      // Pass selectedAccountId to auto-select that specific account tab
      setFilter({
        type: 'client',
        id: account.clientId,
        label: account.clientName,
        selectedAccountId: account.accountId
      });
      // Navigate to PMS
      onNavigate('pms');
    }
  };

  const styles = {
    container: {
      padding: '24px',
      maxWidth: '1600px',
      margin: '0 auto'
    },
    header: {
      marginBottom: '24px'
    },
    greeting: {
      fontSize: '28px',
      fontWeight: '600',
      color: 'var(--text-primary)',
      marginBottom: '4px'
    },
    subtitle: {
      fontSize: '14px',
      color: 'var(--text-muted)',
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '8px'
    },
    quoteText: {
      fontSize: '14px',
      fontStyle: 'italic',
      color: '#f59e0b'
    },
    quoteAuthor: {
      fontSize: '14px',
      color: '#d97706'
    },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
      gap: '20px'
    },
    loadingOverlay: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '60px 20px',
      color: 'var(--text-muted)'
    },
    spinner: {
      width: '40px',
      height: '40px',
      border: '3px solid var(--border-color)',
      borderTopColor: 'var(--accent-color)',
      borderRadius: '50%',
      animation: 'spin 1s linear infinite',
      marginBottom: '16px'
    },
    errorBox: {
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      border: '1px solid rgba(239, 68, 68, 0.3)',
      borderRadius: '8px',
      padding: '16px',
      color: '#ef4444',
      textAlign: 'center',
      marginBottom: '20px'
    },
    refreshButton: {
      backgroundColor: 'var(--accent-color)',
      color: '#fff',
      border: 'none',
      padding: '8px 16px',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '500',
      marginTop: '12px'
    }
  };

  // Add keyframe animation for spinner
  useEffect(() => {
    const styleId = 'rm-dashboard-keyframes';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const firstName = user?.firstName || user?.profile?.firstName || user?.email?.split('@')[0] || 'there';
  const todayFormatted = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  if (loading && !data.summary) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h1 style={styles.greeting}>Hello, {firstName}</h1>
          <p style={styles.subtitle}>{todayFormatted}</p>
        </div>
        <div style={styles.loadingOverlay}>
          <div style={styles.spinner} />
          <span>Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h1 style={styles.greeting}>Hello, {firstName}</h1>
        <p style={styles.subtitle}>
          <span>{todayFormatted}</span>
          {dailyQuote && (
            <>
              <span>•</span>
              <span style={styles.quoteText}>"{dailyQuote.quote}"</span>
              <span style={styles.quoteAuthor}>— {dailyQuote.author}</span>
            </>
          )}
        </p>
      </div>

      {error && (
        <div style={styles.errorBox}>
          <div>{error}</div>
          <button style={styles.refreshButton} onClick={loadDashboardData}>
            Retry
          </button>
        </div>
      )}

      <div style={styles.grid}>
        <PortfolioSummaryCard
          summary={data.summary}
          selectedCurrency={dashboardCurrency}
          onCurrencyChange={handleCurrencyChange}
          hideClientsCount={isClient}
        />

        <AUMMiniChart
          sessionId={localStorage.getItem('sessionId')}
          currency={dashboardCurrency}
        />

        <UpcomingEventsCard
          events={data.events}
          onEventClick={handleEventClick}
        />

        <AlertsCard
          alerts={data.alerts}
          onAlertClick={handleAlertClick}
        />

        <CashMonitoringCard
          cashData={data.cashMonitoring}
          onAccountClick={handleCashAccountClick}
        />

        {/* Hide Birthdays card for clients - only show for RMs/Admins */}
        {!isClient && (
          <BirthdaysCard
            birthdays={data.birthdays}
            onBirthdayClick={handleBirthdayClick}
          />
        )}

        <MarketWatchlistCard
          watchlist={data.watchlist}
          onTickerClick={handleTickerClick}
        />

        <RecentActivityCard
          activities={data.activity}
          onActivityClick={handleActivityClick}
        />
      </div>
    </div>
  );
};

export default RMDashboard;
