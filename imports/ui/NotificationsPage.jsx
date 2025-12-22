import React, { useState, useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTheme } from './ThemeContext.jsx';

/**
 * NotificationsPage Component
 *
 * Full-page notification management interface with filtering and pagination
 */
const NotificationsPage = ({ currentUser }) => {
  const { theme } = useTheme();
  const [notifications, setNotifications] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);

  // Filters
  const [filters, setFilters] = useState({
    eventType: '',
    productId: '',
    unreadOnly: false,
    dateFrom: '',
    dateTo: '',
    limit: 50,
    skip: 0
  });

  // Event type options
  const eventTypes = [
    { value: '', label: 'All Events' },
    { value: 'warning_alert', label: 'Warning Alert' },
    { value: 'critical_alert', label: 'Critical Alert' },
    { value: 'info_alert', label: 'Info Alert' },
    { value: 'coupon_paid', label: 'Coupon Paid' },
    { value: 'autocall_triggered', label: 'Autocall Triggered' },
    { value: 'barrier_breached', label: 'Barrier Breached' },
    { value: 'barrier_near', label: 'Near Barrier' },
    { value: 'final_observation', label: 'Final Observation' },
    { value: 'product_matured', label: 'Product Matured' },
    { value: 'memory_coupon_added', label: 'Memory Coupon' },
    { value: 'barrier_recovered', label: 'Barrier Recovered' }
  ];

  // Load notifications
  useEffect(() => {
    loadNotifications();
  }, [filters]);

  const loadNotifications = async () => {
    if (!currentUser) return;

    setIsLoading(true);
    try {
      const sessionId = localStorage.getItem('sessionId');
      const result = await Meteor.callAsync('notifications.getAll', filters, sessionId);

      setNotifications(result.notifications);
      setTotalCount(result.total);
      setHasMore(result.hasMore);
    } catch (error) {
      console.error('Error loading notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({
      ...prev,
      [field]: value,
      skip: 0 // Reset pagination when filter changes
    }));
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('notifications.markAsRead', notificationId, sessionId);
      loadNotifications();
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleMarkAllAsRead = async () => {
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('notifications.markAllAsRead', sessionId);
      loadNotifications();
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
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getEventIcon = (eventType) => {
    const icons = {
      'coupon_paid': '💰',
      'autocall_triggered': '🔔',
      'barrier_breached': '⚠️',
      'barrier_near': '⚡',
      'final_observation': '🎯',
      'product_matured': '✅',
      'memory_coupon_added': '🧠',
      'barrier_recovered': '📈'
    };
    return icons[eventType] || '📢';
  };

  const getEventColor = (eventType) => {
    const colors = {
      'coupon_paid': '#10b981',
      'autocall_triggered': '#3b82f6',
      'barrier_breached': '#ef4444',
      'barrier_near': '#f59e0b',
      'final_observation': '#8b5cf6',
      'product_matured': '#059669',
      'memory_coupon_added': '#a855f7',
      'barrier_recovered': '#10b981'
    };
    return colors[eventType] || '#6b7280';
  };

  const getEventTypeName = (eventType) => {
    const names = {
      'coupon_paid': 'Coupon Paid',
      'autocall_triggered': 'Autocall Triggered',
      'barrier_breached': 'Barrier Breached',
      'barrier_near': 'Near Barrier',
      'final_observation': 'Final Observation',
      'product_matured': 'Product Matured',
      'memory_coupon_added': 'Memory Coupon',
      'barrier_recovered': 'Barrier Recovered'
    };
    return names[eventType] || eventType;
  };

  const isUnread = (notification) => {
    return !notification.readBy || !notification.readBy.includes(currentUser._id);
  };

  const unreadCount = notifications.filter(isUnread).length;

  return (
    <div
      style={{
        padding: '2rem',
        minHeight: '100vh',
        background: theme === 'light' ? 'transparent' : 'transparent'
      }}
    >
      <div
        style={{
          maxWidth: '1200px',
          margin: '0 auto',
          background: theme === 'light' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(31, 41, 55, 0.9)',
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
                color: theme === 'light' ? '#1f2937' : '#f9fafb'
              }}
            >
              Notifications
            </h1>
            <p
              style={{
                margin: 0,
                fontSize: '0.9rem',
                color: theme === 'light' ? '#6b7280' : '#9ca3af'
              }}
            >
              {totalCount} total notifications
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
            background: theme === 'light' ? '#f9fafb' : '#374151',
            borderRadius: '12px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '1rem'
          }}
        >
          {/* Event Type Filter */}
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '0.5rem',
                fontSize: '0.875rem',
                fontWeight: '500',
                color: theme === 'light' ? '#374151' : '#d1d5db'
              }}
            >
              Event Type
            </label>
            <select
              value={filters.eventType}
              onChange={(e) => handleFilterChange('eventType', e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem',
                border: `1px solid ${theme === 'light' ? '#d1d5db' : '#4b5563'}`,
                borderRadius: '6px',
                background: theme === 'light' ? 'white' : '#1f2937',
                color: theme === 'light' ? '#1f2937' : '#f9fafb',
                fontSize: '0.875rem'
              }}
            >
              {eventTypes.map(type => (
                <option key={type.value} value={type.value}>
                  {type.label}
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
                marginTop: '1.75rem',
                fontSize: '0.875rem',
                color: theme === 'light' ? '#374151' : '#d1d5db'
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
        </div>

        {/* Notifications List */}
        {isLoading && filters.skip === 0 ? (
          <div
            style={{
              padding: '4rem',
              textAlign: 'center',
              color: theme === 'light' ? '#9ca3af' : '#6b7280'
            }}
          >
            <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>⏳</div>
            <p>Loading notifications...</p>
          </div>
        ) : notifications.length === 0 ? (
          <div
            style={{
              padding: '4rem',
              textAlign: 'center',
              color: theme === 'light' ? '#9ca3af' : '#6b7280'
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔔</div>
            <p style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>No notifications found</p>
            <p style={{ fontSize: '0.875rem' }}>
              {filters.unreadOnly ? 'You have no unread notifications' : 'Notifications will appear here when product events occur'}
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {notifications.map((notification) => {
              const unread = isUnread(notification);
              return (
                <div
                  key={notification._id}
                  style={{
                    padding: '1.5rem',
                    background: theme === 'light' ? 'white' : '#1f2937',
                    borderRadius: '12px',
                    border: `2px solid ${
                      unread
                        ? '#3b82f6'
                        : theme === 'light' ? '#e5e7eb' : '#374151'
                    }`,
                    cursor: unread ? 'pointer' : 'default',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    if (unread) {
                      e.currentTarget.style.transform = 'translateY(-2px)';
                      e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.1)';
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
                      handleMarkAsRead(notification._id);
                    }
                  }}
                >
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    {/* Event Icon */}
                    <div
                      style={{
                        flexShrink: 0,
                        width: '56px',
                        height: '56px',
                        borderRadius: '12px',
                        background: `${getEventColor(notification.eventType)}20`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '2rem'
                      }}
                    >
                      {getEventIcon(notification.eventType)}
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
                          gap: '1rem'
                        }}
                      >
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
                            <h3
                              style={{
                                margin: 0,
                                fontSize: '1.1rem',
                                fontWeight: '600',
                                color: theme === 'light' ? '#1f2937' : '#f9fafb'
                              }}
                            >
                              {notification.title || notification.productName || 'Notification'}
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
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.05em'
                                }}
                              >
                                New
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: '1rem', fontSize: '0.8rem', color: theme === 'light' ? '#6b7280' : '#9ca3af' }}>
                            <span>{notification.productIsin}</span>
                            <span>•</span>
                            <span
                              style={{
                                color: getEventColor(notification.eventType),
                                fontWeight: '500'
                              }}
                            >
                              {getEventTypeName(notification.eventType)}
                            </span>
                          </div>
                        </div>
                        <span
                          style={{
                            fontSize: '0.8rem',
                            color: theme === 'light' ? '#9ca3af' : '#6b7280',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {formatDate(notification.createdAt)}
                        </span>
                      </div>

                      {/* Summary/Message */}
                      <p
                        style={{
                          margin: '0 0 1rem 0',
                          fontSize: '0.95rem',
                          color: theme === 'light' ? '#4b5563' : '#d1d5db',
                          lineHeight: '1.5'
                        }}
                      >
                        {notification.message || notification.summary || ''}
                      </p>

                      {/* Email Status */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8rem' }}>
                        {notification.emailStatus === 'sent' ? (
                          <>
                            <span style={{ color: '#10b981' }}>✓</span>
                            <span style={{ color: theme === 'light' ? '#6b7280' : '#9ca3af' }}>
                              Email sent to {notification.sentToEmails?.length || 0} recipient(s)
                            </span>
                          </>
                        ) : notification.emailStatus === 'failed' ? (
                          <>
                            <span style={{ color: '#ef4444' }}>✗</span>
                            <span style={{ color: theme === 'light' ? '#6b7280' : '#9ca3af' }}>
                              Email failed to send
                            </span>
                          </>
                        ) : (
                          <>
                            <span style={{ color: '#f59e0b' }}>⏳</span>
                            <span style={{ color: theme === 'light' ? '#6b7280' : '#9ca3af' }}>
                              Email pending
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Load More Button */}
        {hasMore && (
          <div style={{ marginTop: '2rem', textAlign: 'center' }}>
            <button
              onClick={handleLoadMore}
              disabled={isLoading}
              style={{
                padding: '0.75rem 2rem',
                background: theme === 'light' ? 'white' : '#374151',
                border: `2px solid ${theme === 'light' ? '#e5e7eb' : '#4b5563'}`,
                borderRadius: '8px',
                color: theme === 'light' ? '#1f2937' : '#f9fafb',
                fontSize: '0.875rem',
                fontWeight: '500',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                opacity: isLoading ? 0.6 : 1,
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.background = theme === 'light' ? '#f9fafb' : '#4b5563';
                }
              }}
              onMouseLeave={(e) => {
                if (!isLoading) {
                  e.currentTarget.style.background = theme === 'light' ? 'white' : '#374151';
                }
              }}
            >
              {isLoading ? 'Loading...' : 'Load More'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
