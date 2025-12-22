import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTheme } from './ThemeContext.jsx';

/**
 * AlertCenter Component
 *
 * Displays product-related alerts: barrier breaches, underlying drops,
 * product redemption/maturity, and coupon payments.
 * - Admins see all alerts
 * - Clients/RMs see only their own product alerts
 */
const AlertCenter = ({ user }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [alerts, setAlerts] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Filters - default to unread only
  const [filters, setFilters] = useState({
    alertType: '',
    unreadOnly: true,
    limit: 50,
    skip: 0
  });

  // Alert types specific to Alert Center (subset of notification event types)
  const alertTypes = [
    { value: '', label: 'All Alerts' },
    // Structured product alerts
    { value: 'barrier_breached', label: 'Barrier Breached', icon: '🚨', color: '#ef4444', priority: 'critical' },
    { value: 'barrier_near', label: 'Near Barrier', icon: '⚡', color: '#f59e0b', priority: 'warning' },
    { value: 'underlying_down_20', label: 'Underlying -20%', icon: '📉', color: '#ef4444', priority: 'critical' },
    { value: 'coupon_paid', label: 'Coupon Paid', icon: '💰', color: '#10b981', priority: 'info' },
    { value: 'product_matured', label: 'Product Matured', icon: '✅', color: '#059669', priority: 'info' },
    { value: 'autocall_triggered', label: 'Autocall Triggered', icon: '🔔', color: '#3b82f6', priority: 'important' },
    { value: 'early_redemption', label: 'Early Redemption', icon: '📤', color: '#3b82f6', priority: 'important' },
    // PMS alerts
    { value: 'allocation_breach', label: 'Allocation Breach', icon: '⚖️', color: '#ef4444', priority: 'critical' },
    { value: 'unauthorized_overdraft', label: 'Negative Cash', icon: '💳', color: '#ef4444', priority: 'critical' }
  ];

  // Event type configurations
  const getAlertConfig = (eventType) => {
    const config = alertTypes.find(t => t.value === eventType);
    return config || { icon: '📢', color: '#6b7280', priority: 'info' };
  };

  // Load alerts on mount and when filters change
  useEffect(() => {
    loadAlerts();
  }, [filters]);

  const loadAlerts = async () => {
    if (!user) return;

    setIsLoading(true);
    try {
      const sessionId = localStorage.getItem('sessionId');

      // Use existing notifications.getAll with alert-specific event types
      const alertEventTypes = alertTypes
        .filter(t => t.value)
        .map(t => t.value);

      const queryFilters = {
        ...filters,
        eventTypes: filters.alertType ? [filters.alertType] : alertEventTypes
      };

      const result = await Meteor.callAsync('notifications.getAlerts', queryFilters, sessionId);

      if (filters.skip === 0) {
        setAlerts(result.notifications || []);
      } else {
        setAlerts(prev => [...prev, ...(result.notifications || [])]);
      }
      setTotalCount(result.total || 0);
      setHasMore(result.hasMore || false);
    } catch (error) {
      console.error('Error loading alerts:', error);
      // Fallback to regular notifications method if getAlerts doesn't exist
      try {
        const sessionId = localStorage.getItem('sessionId');
        const alertEventTypes = alertTypes.filter(t => t.value).map(t => t.value);

        const fallbackFilters = {
          ...filters,
          eventType: filters.alertType || ''
        };

        const result = await Meteor.callAsync('notifications.getAll', fallbackFilters, sessionId);

        // Filter to only alert-relevant event types
        const filteredNotifications = (result.notifications || []).filter(n =>
          alertEventTypes.includes(n.eventType)
        );

        if (filters.skip === 0) {
          setAlerts(filteredNotifications);
        } else {
          setAlerts(prev => [...prev, ...filteredNotifications]);
        }
        setTotalCount(filteredNotifications.length);
        setHasMore(result.hasMore || false);
      } catch (fallbackError) {
        console.error('Fallback also failed:', fallbackError);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value,
      skip: 0
    }));
  };

  const handleMarkAsRead = async (alertId) => {
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('notifications.markAsRead', alertId, sessionId);
      loadAlerts();
    } catch (error) {
      console.error('Error marking alert as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('notifications.markAllAsRead', sessionId);
      loadAlerts();
    } catch (error) {
      console.error('Error marking all as read:', error);
    }
  };

  const handleLoadMore = () => {
    setFilters(prev => ({
      ...prev,
      skip: prev.skip + prev.limit
    }));
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const isUnread = (alert) => {
    return !alert.readBy || !alert.readBy.includes(user._id);
  };

  const unreadCount = alerts.filter(isUnread).length;

  const getPriorityBadge = (priority) => {
    const styles = {
      critical: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' },
      warning: { bg: '#fffbeb', color: '#d97706', border: '#fde68a' },
      important: { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe' },
      info: { bg: '#f0fdf4', color: '#16a34a', border: '#bbf7d0' }
    };
    return styles[priority] || styles.info;
  };

  return (
    <div
      style={{
        padding: '2rem',
        minHeight: '100vh'
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          background: isDark ? 'rgba(31, 41, 55, 0.9)' : 'rgba(255, 255, 255, 0.9)',
          borderRadius: '16px',
          padding: '2rem',
          boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
          backdropFilter: 'blur(10px)'
        }}
      >
        {/* Header */}
        <div
          style={{
            marginBottom: '2rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem'
          }}
        >
          <div>
            <h1
              style={{
                margin: '0 0 0.5rem 0',
                fontSize: '2rem',
                fontWeight: '700',
                color: isDark ? '#f9fafb' : '#1f2937',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem'
              }}
            >
              <span style={{ fontSize: '2rem' }}>🚨</span>
              Alert Center
              {unreadCount > 0 && (
                <span
                  style={{
                    padding: '0.25rem 0.75rem',
                    background: '#ef4444',
                    color: 'white',
                    fontSize: '0.9rem',
                    fontWeight: '600',
                    borderRadius: '20px'
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: '0.9rem',
                color: isDark ? '#9ca3af' : '#6b7280'
              }}
            >
              {totalCount} total alerts
              {unreadCount > 0 && ` • ${unreadCount} unread`}
            </p>
          </div>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              style={{
                padding: '0.75rem 1.5rem',
                background: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontSize: '0.875rem',
                fontWeight: '500',
                cursor: 'pointer',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#2563eb';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#3b82f6';
              }}
            >
              Mark All as Read
            </button>
          )}
        </div>

        {/* Filters */}
        <div
          style={{
            marginBottom: '2rem',
            padding: '1.5rem',
            background: isDark ? '#374151' : '#f9fafb',
            borderRadius: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '1.5rem',
            alignItems: 'center'
          }}
        >
          {/* Alert Type Filter */}
          <div style={{ minWidth: '200px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: '500',
                color: isDark ? '#d1d5db' : '#374151'
              }}
            >
              Alert Type
            </label>
            <select
              value={filters.alertType}
              onChange={(e) => handleFilterChange('alertType', e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                borderRadius: '6px',
                background: isDark ? '#1f2937' : 'white',
                color: isDark ? '#f9fafb' : '#1f2937',
                fontSize: '0.875rem'
              }}
            >
              {alertTypes.map(type => (
                <option key={type.value} value={type.value}>
                  {type.icon ? `${type.icon} ${type.label}` : type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Unread Only Filter */}
          <div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                cursor: 'pointer',
                marginTop: '1.5rem',
                fontSize: '0.875rem',
                color: isDark ? '#d1d5db' : '#374151'
              }}
            >
              <input
                type="checkbox"
                checked={filters.unreadOnly}
                onChange={(e) => handleFilterChange('unreadOnly', e.target.checked)}
                style={{
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer'
                }}
              />
              Show Unread Only
            </label>
          </div>

          {/* Priority Legend */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {[
              { label: 'Critical', priority: 'critical' },
              { label: 'Warning', priority: 'warning' },
              { label: 'Important', priority: 'important' },
              { label: 'Info', priority: 'info' }
            ].map(item => {
              const badge = getPriorityBadge(item.priority);
              return (
                <div
                  key={item.priority}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                    fontSize: '0.75rem',
                    color: isDark ? '#9ca3af' : '#6b7280'
                  }}
                >
                  <span
                    style={{
                      width: '12px',
                      height: '12px',
                      borderRadius: '50%',
                      background: badge.color
                    }}
                  />
                  {item.label}
                </div>
              );
            })}
          </div>
        </div>

        {/* Alerts List */}
        {isLoading && filters.skip === 0 ? (
          <div
            style={{
              padding: '4rem',
              textAlign: 'center',
              color: isDark ? '#6b7280' : '#9ca3af'
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
            <p>Loading alerts...</p>
          </div>
        ) : alerts.length === 0 ? (
          <div
            style={{
              padding: '4rem',
              textAlign: 'center',
              color: isDark ? '#6b7280' : '#9ca3af'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔔</div>
            <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No alerts found</p>
            <p style={{ fontSize: '0.875rem' }}>
              {filters.unreadOnly
                ? 'You have no unread alerts'
                : 'Alerts will appear here when important product events occur'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {alerts.map((alert) => {
              const unread = isUnread(alert);
              const config = getAlertConfig(alert.eventType);
              const priorityBadge = getPriorityBadge(config.priority);

              return (
                <div
                  key={alert._id}
                  style={{
                    padding: '1.5rem',
                    background: isDark ? '#1f2937' : 'white',
                    borderRadius: '12px',
                    border: `2px solid ${
                      config.priority === 'critical'
                        ? '#ef4444'
                        : config.priority === 'warning'
                        ? '#f59e0b'
                        : unread
                        ? '#3b82f6'
                        : isDark ? '#374151' : '#e5e7eb'
                    }`,
                    cursor: unread ? 'pointer' : 'default',
                    transition: 'all 0.2s ease',
                    position: 'relative',
                    overflow: 'hidden'
                  }}
                  onMouseEnter={(e) => {
                    if (unread) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (unread) {
                      e.currentTarget.style.transform = 'translateY(0)';
                      e.currentTarget.style.boxShadow = 'none';
                    }
                  }}
                  onClick={() => {
                    if (unread) {
                      handleMarkAsRead(alert._id);
                    }
                  }}
                >
                  {/* Priority indicator stripe */}
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: '4px',
                      background: config.color
                    }}
                  />

                  <div style={{ display: 'flex', gap: '1rem', paddingLeft: '0.5rem' }}>
                    {/* Alert Icon */}
                    <div
                      style={{
                        flexShrink: 0,
                        width: '56px',
                        height: '56px',
                        borderRadius: '12px',
                        background: `${config.color}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '2rem'
                      }}
                    >
                      {config.icon}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Header Row */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'start',
                          marginBottom: '0.75rem',
                          gap: '1rem',
                          flexWrap: 'wrap'
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem', flexWrap: 'wrap' }}>
                            <h3
                              style={{
                                margin: 0,
                                fontSize: '1.1rem',
                                fontWeight: '600',
                                color: isDark ? '#f9fafb' : '#1f2937'
                              }}
                            >
                              {alert.title || alert.productName || 'Alert'}
                            </h3>
                            {unread && (
                              <span
                                style={{
                                  padding: '0.25rem 0.5rem',
                                  background: '#3b82f6',
                                  color: 'white',
                                  fontSize: '0.7rem',
                                  fontWeight: '600',
                                  borderRadius: '6px',
                                  textTransform: 'uppercase'
                                }}
                              >
                                New
                              </span>
                            )}
                            <span
                              style={{
                                padding: '0.25rem 0.5rem',
                                background: priorityBadge.bg,
                                color: priorityBadge.color,
                                border: `1px solid ${priorityBadge.border}`,
                                fontSize: '0.7rem',
                                fontWeight: '600',
                                borderRadius: '6px',
                                textTransform: 'uppercase'
                              }}
                            >
                              {config.priority}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: isDark ? '#9ca3af' : '#6b7280', flexWrap: 'wrap' }}>
                            {alert.productIsin && (
                              <>
                                <span>{alert.productIsin}</span>
                                <span>•</span>
                              </>
                            )}
                            <span
                              style={{
                                color: config.color,
                                fontWeight: '500'
                              }}
                            >
                              {alertTypes.find(t => t.value === alert.eventType)?.label || alert.eventType}
                            </span>
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: '0.8rem',
                            color: isDark ? '#6b7280' : '#9ca3af',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {formatDate(alert.createdAt || alert.eventDate)}
                        </span>
                      </div>

                      {/* Summary */}
                      {(alert.summary || alert.message) && (
                        <p
                          style={{
                            margin: 0,
                            fontSize: '0.9rem',
                            color: isDark ? '#d1d5db' : '#4b5563',
                            lineHeight: '1.5'
                          }}
                        >
                          {alert.summary || alert.message}
                        </p>
                      )}

                      {/* Event Data Details - check both eventData and metadata for different notification types */}
                      {(alert.eventData || alert.metadata) && (
                        <div
                          style={{
                            marginTop: '0.75rem',
                            padding: '0.75rem',
                            background: isDark ? '#374151' : '#f9fafb',
                            borderRadius: '8px',
                            fontSize: '0.8rem',
                            display: 'flex',
                            gap: '1.5rem',
                            flexWrap: 'wrap'
                          }}
                        >
                          {/* Structured product event data */}
                          {alert.eventData?.barrierLevel && (
                            <div>
                              <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Barrier: </span>
                              <span style={{ color: isDark ? '#f9fafb' : '#1f2937', fontWeight: '600' }}>
                                {alert.eventData.barrierLevel}%
                              </span>
                            </div>
                          )}
                          {alert.eventData?.currentLevel && (
                            <div>
                              <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Current: </span>
                              <span style={{ color: isDark ? '#f9fafb' : '#1f2937', fontWeight: '600' }}>
                                {alert.eventData.currentLevel}%
                              </span>
                            </div>
                          )}
                          {alert.eventData?.couponRate && (
                            <div>
                              <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Coupon: </span>
                              <span style={{ color: '#10b981', fontWeight: '600' }}>
                                {alert.eventData.couponRate}%
                              </span>
                            </div>
                          )}
                          {alert.eventData?.underlying && (
                            <div>
                              <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Underlying: </span>
                              <span style={{ color: isDark ? '#f9fafb' : '#1f2937', fontWeight: '600' }}>
                                {alert.eventData.underlying}
                              </span>
                            </div>
                          )}

                          {/* PMS Allocation Breach - data is in metadata for user notifications */}
                          {alert.eventType === 'allocation_breach' && alert.metadata?.breaches && (
                            <div style={{ width: '100%' }}>
                              <div style={{ marginBottom: '0.5rem', color: isDark ? '#9ca3af' : '#6b7280' }}>
                                Breached Categories:
                              </div>
                              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                                {alert.metadata.breaches.map((breach, idx) => (
                                  <div
                                    key={idx}
                                    style={{
                                      padding: '0.5rem 0.75rem',
                                      background: isDark ? '#1f2937' : '#fee2e2',
                                      borderRadius: '6px',
                                      border: '1px solid #ef4444'
                                    }}
                                  >
                                    <span style={{ fontWeight: '600', color: '#ef4444' }}>
                                      {breach.category}:
                                    </span>{' '}
                                    <span style={{ color: isDark ? '#f9fafb' : '#1f2937' }}>
                                      {breach.current}% (limit: {breach.limit}%)
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* PMS Unauthorized Overdraft - data is in metadata for user notifications */}
                          {alert.eventType === 'unauthorized_overdraft' && alert.metadata && (
                            <div style={{ width: '100%', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
                              {alert.metadata.totalNegativeCash !== undefined && (
                                <div>
                                  <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Negative Cash: </span>
                                  <span style={{ color: '#ef4444', fontWeight: '600' }}>
                                    {typeof alert.metadata.totalNegativeCash === 'number'
                                      ? alert.metadata.totalNegativeCash.toLocaleString('en-US', { style: 'currency', currency: alert.metadata.currency || 'EUR' })
                                      : alert.metadata.totalNegativeCash}
                                  </span>
                                </div>
                              )}
                              {alert.metadata.authorizedOverdraft !== undefined && (
                                <div>
                                  <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Authorized Limit: </span>
                                  <span style={{ color: isDark ? '#f9fafb' : '#1f2937', fontWeight: '600' }}>
                                    {typeof alert.metadata.authorizedOverdraft === 'number'
                                      ? alert.metadata.authorizedOverdraft.toLocaleString('en-US', { style: 'currency', currency: alert.metadata.currency || 'EUR' })
                                      : alert.metadata.authorizedOverdraft}
                                  </span>
                                </div>
                              )}
                              {alert.metadata.excessOverdraft !== undefined && (
                                <div>
                                  <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Excess: </span>
                                  <span style={{ color: '#ef4444', fontWeight: '600' }}>
                                    {typeof alert.metadata.excessOverdraft === 'number'
                                      ? alert.metadata.excessOverdraft.toLocaleString('en-US', { style: 'currency', currency: alert.metadata.currency || 'EUR' })
                                      : alert.metadata.excessOverdraft}
                                  </span>
                                </div>
                              )}
                              {alert.metadata.accountNumber && (
                                <div>
                                  <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Account: </span>
                                  <span style={{ color: isDark ? '#f9fafb' : '#1f2937', fontWeight: '600' }}>
                                    {alert.metadata.accountNumber}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Client name for PMS alerts */}
                          {(alert.eventType === 'allocation_breach' || alert.eventType === 'unauthorized_overdraft') && alert.metadata?.clientName && (
                            <div>
                              <span style={{ color: isDark ? '#9ca3af' : '#6b7280' }}>Client: </span>
                              <span style={{ color: isDark ? '#f9fafb' : '#1f2937', fontWeight: '600' }}>
                                {alert.metadata.clientName}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Load More Button */}
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                <button
                  onClick={handleLoadMore}
                  disabled={isLoading}
                  style={{
                    padding: '0.75rem 2rem',
                    background: isDark ? '#374151' : '#f3f4f6',
                    color: isDark ? '#f9fafb' : '#1f2937',
                    border: `1px solid ${isDark ? '#4b5563' : '#d1d5db'}`,
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: '500',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    opacity: isLoading ? 0.6 : 1,
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (!isLoading) {
                      e.currentTarget.style.background = isDark ? '#4b5563' : '#e5e7eb';
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isDark ? '#374151' : '#f3f4f6';
                  }}
                >
                  {isLoading ? 'Loading...' : 'Load More'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default AlertCenter;
