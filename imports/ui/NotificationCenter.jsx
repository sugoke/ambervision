import React, { useState, useEffect, useRef } from 'react';
import { Meteor } from 'meteor/meteor';
import { useTheme } from './ThemeContext.jsx';

/**
 * NotificationCenter Component
 *
 * Bell icon with unread count badge and dropdown showing recent notifications
 */
const NotificationCenter = ({ currentUser, onViewAllClick }) => {
  const { theme } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [recentNotifications, setRecentNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const dropdownRef = useRef(null);

  // Load unread count and recent notifications
  useEffect(() => {
    if (!currentUser) return;

    const sessionId = localStorage.getItem('sessionId');
    if (!sessionId) return;

    // Load initial data
    loadNotifications(sessionId);

    // Poll for updates every 30 seconds
    const interval = setInterval(() => {
      loadNotifications(sessionId);
    }, 30000);

    return () => clearInterval(interval);
  }, [currentUser]);

  const loadNotifications = async (sessionId) => {
    try {
      // Get unread count
      const count = await Meteor.callAsync('notifications.getUnreadCount', sessionId);
      setUnreadCount(count);

      // Get recent notifications (last 5)
      const recent = await Meteor.callAsync('notifications.getRecent', 5, sessionId);
      setRecentNotifications(recent);
    } catch (error) {
      console.error('Error loading notifications:', error);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleBellClick = () => {
    setIsOpen(!isOpen);
  };

  const handleMarkAsRead = async (notificationId) => {
    try {
      const sessionId = localStorage.getItem('sessionId');
      await Meteor.callAsync('notifications.markAsRead', notificationId, sessionId);

      // Reload notifications
      loadNotifications(sessionId);
    } catch (error) {
      console.error('Error marking notification as read:', error);
    }
  };

  const handleViewAll = () => {
    setIsOpen(false);
    if (onViewAllClick) {
      onViewAllClick();
    }
  };

  const formatTimeAgo = (date) => {
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    if (diffDay < 7) return `${diffDay}d ago`;
    return new Date(date).toLocaleDateString();
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

  const isUnread = (notification) => {
    return !notification.readBy || !notification.readBy.includes(currentUser._id);
  };

  // Lock body scroll when dropdown is open on mobile
  useEffect(() => {
    if (isOpen && window.innerWidth <= 768) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      {/* Bell Icon Button */}
      <button
        onClick={handleBellClick}
        style={{
          position: 'relative',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '0.5rem',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.2s ease',
          color: theme === 'light' ? '#1f2937' : '#e5e7eb'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = theme === 'light' ? '#f3f4f6' : 'rgba(255, 255, 255, 0.1)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        {/* Bell Icon */}
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Unread Count Badge */}
        {unreadCount > 0 && (
          <div
            style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              background: '#ef4444',
              color: 'white',
              borderRadius: '10px',
              minWidth: '18px',
              height: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '0.65rem',
              fontWeight: '600',
              padding: '0 4px',
              boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </div>
        )}
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div
          className="notification-dropdown"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            width: '400px',
            maxHeight: '500px',
            background: theme === 'light' ? 'white' : '#1f2937',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.2)',
            border: `1px solid ${theme === 'light' ? '#e5e7eb' : '#374151'}`,
            overflow: 'hidden',
            zIndex: 9999
          }}
        >
          {/* Header */}
          <div
            className="notification-header"
            style={{
              padding: '1rem',
              borderBottom: `1px solid ${theme === 'light' ? '#e5e7eb' : '#374151'}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: '1rem',
                  fontWeight: '600',
                  color: theme === 'light' ? '#1f2937' : '#f9fafb'
                }}
              >
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span
                  style={{
                    fontSize: '0.75rem',
                    color: theme === 'light' ? '#6b7280' : '#9ca3af',
                    background: theme === 'light' ? '#f3f4f6' : '#374151',
                    padding: '0.25rem 0.5rem',
                    borderRadius: '12px',
                    fontWeight: '500'
                  }}
                >
                  {unreadCount} unread
                </span>
              )}
            </div>

            {/* Close button for mobile */}
            <button
              className="notification-close-btn"
              onClick={() => setIsOpen(false)}
              style={{
                display: 'none',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: '0.5rem',
                borderRadius: '6px',
                color: theme === 'light' ? '#6b7280' : '#9ca3af',
                fontSize: '1.5rem',
                lineHeight: '1',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = theme === 'light' ? '#f3f4f6' : '#374151';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
            >
              ✕
            </button>
          </div>

          {/* Notifications List */}
          <div
            className="notification-list"
            style={{
              maxHeight: '400px',
              overflowY: 'auto'
            }}
          >
            {recentNotifications.length === 0 ? (
              <div
                style={{
                  padding: '2rem',
                  textAlign: 'center',
                  color: theme === 'light' ? '#9ca3af' : '#6b7280'
                }}
              >
                <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔔</div>
                <p style={{ margin: 0, fontSize: '0.875rem' }}>No notifications yet</p>
              </div>
            ) : (
              recentNotifications.map((notification) => {
                const unread = isUnread(notification);
                return (
                  <div
                    key={notification._id}
                    style={{
                      padding: '1rem',
                      borderBottom: `1px solid ${theme === 'light' ? '#f3f4f6' : '#374151'}`,
                      background: unread
                        ? theme === 'light' ? '#eff6ff' : 'rgba(59, 130, 246, 0.1)'
                        : 'transparent',
                      cursor: 'pointer',
                      transition: 'background 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = theme === 'light' ? '#f9fafb' : '#374151';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = unread
                        ? theme === 'light' ? '#eff6ff' : 'rgba(59, 130, 246, 0.1)'
                        : 'transparent';
                    }}
                    onClick={() => {
                      if (unread) {
                        handleMarkAsRead(notification._id);
                      }
                    }}
                  >
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      {/* Event Icon */}
                      <div
                        style={{
                          flexShrink: 0,
                          width: '40px',
                          height: '40px',
                          borderRadius: '8px',
                          background: `${getEventColor(notification.eventType)}20`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '1.25rem'
                        }}
                      >
                        {getEventIcon(notification.eventType)}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'start',
                            marginBottom: '0.25rem'
                          }}
                        >
                          <span
                            style={{
                              fontSize: '0.875rem',
                              fontWeight: '600',
                              color: theme === 'light' ? '#1f2937' : '#f9fafb'
                            }}
                          >
                            {notification.productName}
                          </span>
                          {unread && (
                            <div
                              style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: '#3b82f6',
                                flexShrink: 0,
                                marginLeft: '0.5rem'
                              }}
                            />
                          )}
                        </div>
                        <p
                          style={{
                            margin: '0 0 0.5rem 0',
                            fontSize: '0.8rem',
                            color: theme === 'light' ? '#4b5563' : '#d1d5db',
                            lineHeight: '1.4'
                          }}
                        >
                          {notification.summary}
                        </p>
                        <span
                          style={{
                            fontSize: '0.75rem',
                            color: theme === 'light' ? '#9ca3af' : '#6b7280'
                          }}
                        >
                          {formatTimeAgo(notification.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          {recentNotifications.length > 0 && (
            <div
              className="notification-footer"
              style={{
                padding: '0.75rem',
                borderTop: `1px solid ${theme === 'light' ? '#e5e7eb' : '#374151'}`,
                textAlign: 'center'
              }}
            >
              <button
                onClick={handleViewAll}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#3b82f6',
                  fontSize: '0.875rem',
                  fontWeight: '500',
                  cursor: 'pointer',
                  padding: '0.5rem',
                  width: '100%',
                  borderRadius: '6px',
                  transition: 'background 0.2s ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = theme === 'light' ? '#eff6ff' : 'rgba(59, 130, 246, 0.1)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                View All Notifications
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mobile Responsiveness CSS */}
      <style>{`
        @media (max-width: 768px) {
          .notification-dropdown {
            position: fixed !important;
            top: 0 !important;
            right: 0 !important;
            left: 0 !important;
            bottom: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
            height: 100vh !important;
            height: -webkit-fill-available !important;
            max-height: 100vh !important;
            max-height: -webkit-fill-available !important;
            border-radius: 0 !important;
            border: none !important;
            z-index: 10000 !important;
            display: flex !important;
            flex-direction: column !important;
          }

          /* Show close button on mobile */
          .notification-close-btn {
            display: flex !important;
            align-items: center;
            justify-content: center;
          }

          /* Make notifications list fill available space */
          .notification-list {
            flex: 1 !important;
            max-height: none !important;
            overflow-y: auto !important;
            -webkit-overflow-scrolling: touch !important;
          }

          /* Compact header on mobile */
          .notification-header {
            padding: 0.75rem 1rem !important;
            flex-shrink: 0 !important;
          }

          /* Compact footer on mobile */
          .notification-footer {
            flex-shrink: 0 !important;
          }

          /* iOS safe area support */
          @supports (padding: max(0px)) {
            .notification-header {
              padding-top: max(0.75rem, env(safe-area-inset-top)) !important;
            }

            .notification-footer {
              padding-bottom: max(0.75rem, env(safe-area-inset-bottom)) !important;
            }
          }
        }

        /* Extra small devices */
        @media (max-width: 480px) {
          .notification-header {
            padding: 0.65rem 0.85rem !important;
          }
        }

        /* iOS-specific fixes */
        @supports (-webkit-touch-callout: none) {
          @media (max-width: 768px) {
            .notification-dropdown {
              height: -webkit-fill-available !important;
              max-height: -webkit-fill-available !important;
            }
          }
        }
      `}</style>
    </div>
  );
};

export default NotificationCenter;
