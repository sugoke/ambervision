import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import AlertsCard from './AlertsCard.jsx';
import PortfolioSummaryCard from './PortfolioSummaryCard.jsx';
import BirthdaysCard from './BirthdaysCard.jsx';
import UpcomingEventsCard from './UpcomingEventsCard.jsx';
import MarketWatchlistCard from './MarketWatchlistCard.jsx';
import MarketWatch from './MarketWatch.jsx';
import RecentActivityCard from './RecentActivityCard.jsx';
import CashMonitoringCard from './CashMonitoringCard.jsx';
import AUMMiniChart from './AUMMiniChart.jsx';
import ComplianceQuestionsCard from './ComplianceQuestionsCard.jsx';
import { useViewAs } from '../../ViewAsContext.jsx';

const RMDashboard = ({ user, onNavigate }) => {
  const { viewAsFilter, setFilter } = useViewAs();

  // Detect if user is a client (shows personalized dashboard without RM-specific features)
  const isClient = user?.role === 'client';
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dailyQuote, setDailyQuote] = useState(null);
  // Scope the saved currency preference per user so it doesn't leak across
  // logins on a shared browser (e.g. an admin who tested USD shouldn't lock
  // every compliance/RM user that logs in afterwards into USD).
  const currencyStorageKey = user?._id ? `dashboardCurrency_${user._id}` : 'dashboardCurrency';
  const [dashboardCurrency, setDashboardCurrency] = useState(() => {
    // The user's profile preferred currency is the authoritative default. The on-card
    // dropdown is a quick override that syncs back to the profile (see handleCurrencyChange),
    // so localStorage only matters as a fast fallback before/while the profile resolves.
    return user?.profile?.preferredCurrency || localStorage.getItem(currencyStorageKey) || 'EUR';
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

  // Use stringified viewAsFilter for stable dependency comparison
  const viewAsFilterKey = viewAsFilter ? `${viewAsFilter.type}-${viewAsFilter.id}` : 'none';

  useEffect(() => {
    loadDashboardData();
    loadDailyQuote();

    // Refresh every 5 minutes
    const interval = setInterval(loadDashboardData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user?._id, viewAsFilterKey]);

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

      // Fire all calls at once but patch state as EACH one resolves, in priority
      // order: the AUM summary unblocks the page the moment it lands, and the
      // less important cards (watchlist, activity…) fill in when ready instead
      // of holding the whole dashboard hostage to the slowest call. One failing
      // call only leaves its own card empty.
      const calls = [
        ['summary', () => Meteor.callAsync('rmDashboard.getPortfolioSummary', sessionId, currency, viewAsFilter)],
        ['alerts', () => Meteor.callAsync('rmDashboard.getAlerts', sessionId, viewAsFilter)],
        ['events', () => Meteor.callAsync('rmDashboard.getUpcomingEvents', sessionId, 2, viewAsFilter)],
        ['cashMonitoring', () => Meteor.callAsync('rmDashboard.getCashMonitoring', sessionId, viewAsFilter)],
        ['birthdays', () => Meteor.callAsync('rmDashboard.getBirthdays', sessionId, viewAsFilter)],
        ['watchlist', () => Meteor.callAsync('rmDashboard.getWatchlist', sessionId, viewAsFilter)],
        ['activity', () => Meteor.callAsync('rmDashboard.getRecentActivity', sessionId, 5, viewAsFilter)]
      ];
      const outcomes = await Promise.all(calls.map(([name, start]) =>
        start()
          .then(value => {
            setData(prev => ({ ...prev, [name]: value }));
            if (name === 'summary') setLoading(false); // AUM landed — show the page
            return { ok: true };
          })
          .catch(err => {
            console.error(`[RMDashboard] ${name} failed to load:`, err);
            setData(prev => ({ ...prev, [name]: null }));
            return { ok: false, err };
          })
      ));
      // Only surface a page-level error if EVERYTHING failed (e.g. session expired)
      if (outcomes.every(o => !o.ok)) {
        const first = outcomes[0].err;
        setError(first?.reason || first?.message || 'Failed to load dashboard');
      }
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
    localStorage.setItem(currencyStorageKey, newCurrency);

    // Sync the choice to the user's profile so it becomes the persistent preferred
    // currency (drives both this dashboard and the consolidated PMS total on next load).
    if (user?._id && newCurrency !== user?.profile?.preferredCurrency) {
      try {
        await Meteor.callAsync('users.updateProfile', user._id, {
          profile: { ...(user.profile || {}), preferredCurrency: newCurrency }
        }, localStorage.getItem('sessionId'));
        // Keep the in-memory user object consistent for the rest of this session.
        if (user.profile) user.profile.preferredCurrency = newCurrency;
        else user.profile = { preferredCurrency: newCurrency };
      } catch (err) {
        console.error('[RMDashboard] Error saving preferred currency to profile:', err);
      }
    }

    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;

    try {
      // Only refresh the summary with the new currency (pass viewAsFilter for proper filtering)
      const summary = await Meteor.callAsync('rmDashboard.getPortfolioSummary', sessionId, newCurrency, viewAsFilter);
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
      fontFamily: 'var(--font-serif)',
      fontSize: 'clamp(26px, 4vw, 38px)',
      fontWeight: '500',
      lineHeight: 1.05,
      letterSpacing: '0.2px',
      color: 'var(--text-primary)',
      marginBottom: '7px'
    },
    greetingName: {
      fontStyle: 'italic',
      color: 'var(--accent-color)'
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
      fontFamily: 'var(--font-serif)',
      fontSize: '18px',
      fontStyle: 'italic',
      color: 'var(--accent-strong)'
    },
    quoteAuthor: {
      fontSize: '15px',
      color: 'var(--text-muted)'
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
      color: 'var(--loss-color)',
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
          <h1 style={styles.greeting}>{getGreeting()}, <em style={styles.greetingName}>{firstName}</em>.</h1>
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
        <h1 style={styles.greeting}>{getGreeting()}, <em style={styles.greetingName}>{firstName}</em>.</h1>
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

      {/* Morning-Desk layout (dashboard proposal): the AUM statement leads with the
          triage of things needing attention beside it; calendar, cash and trend share
          the second band; markets and people the third; the activity ledger closes. */}
      <div className="av-grid">
        <div className="av-col-7">
          <PortfolioSummaryCard
            summary={data.summary}
            selectedCurrency={dashboardCurrency}
            userCurrency={user?.profile?.preferredCurrency || user?.referenceCurrency}
            onCurrencyChange={handleCurrencyChange}
            hideClientsCount={isClient}
            alertsCount={data.alerts?.length || 0}
            nextEvent={data.events?.[0] || null}
          />
        </div>

        <div className="av-col-5">
          <AlertsCard
            alerts={data.alerts}
            onAlertClick={handleAlertClick}
          />
        </div>

        {/* Compliance questions on sizeable transactions — renders only when
            compliance has questioned this user */}
        {!isClient && (
          <ComplianceQuestionsCard onOpenClient={(entityId) => onNavigate?.('client', { entityId })} />
        )}

        <div className="av-col-4">
          <UpcomingEventsCard
            events={data.events}
            onEventClick={handleEventClick}
          />
        </div>

        <div className="av-col-4">
          <CashMonitoringCard
            cashData={data.cashMonitoring}
            onAccountClick={handleCashAccountClick}
          />
        </div>

        <div className="av-col-4">
          <AUMMiniChart
            sessionId={localStorage.getItem('sessionId')}
            viewAsFilter={viewAsFilter}
            currency={dashboardCurrency}
          />
        </div>

        <div className="av-col-4">
          <MarketWatchlistCard
            watchlist={data.watchlist}
            onTickerClick={handleTickerClick}
          />
        </div>

        <div className="av-col-4">
          <MarketWatch />
        </div>

        {/* Hide Birthdays card for clients - only show for RMs/Admins */}
        {!isClient && (
          <div className="av-col-4">
            <BirthdaysCard
              birthdays={data.birthdays}
              onBirthdayClick={handleBirthdayClick}
            />
          </div>
        )}

        <div className="av-col-12">
          <RecentActivityCard
            activities={data.activity}
            onActivityClick={handleActivityClick}
          />
        </div>
      </div>
    </div>
  );
};

export default RMDashboard;
