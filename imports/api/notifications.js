import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';

/**
 * Notifications Collection
 *
 * Stores alerts for structured product events like coupon payments,
 * autocalls, barrier breaches, final observations, etc.
 *
 * DOCUMENT STRUCTURE:
 * {
 *   _id: ObjectId,
 *   productId: String,              // Reference to products collection
 *   productName: String,             // Product display name
 *   productIsin: String,             // Product ISIN
 *
 *   eventType: String,               // 'coupon_paid', 'autocall_triggered', 'barrier_breached', etc.
 *   eventDate: Date,                 // When the event occurred
 *   observationDate: Date,           // Observation date (for scheduled events)
 *
 *   eventData: Object,               // Event-specific details
 *   summary: String,                 // Human-readable summary
 *
 *   sentToUsers: [String],           // Array of user IDs who received this
 *   sentToEmails: [String],          // Array of emails sent to
 *   emailSentAt: Date,               // When emails were sent
 *   emailStatus: String,             // 'pending', 'sent', 'failed'
 *
 *   readBy: [String],                // Array of user IDs who have read this
 *
 *   createdAt: Date,
 *   createdBy: String                // 'system-cron' or userId
 * }
 */

export const NotificationsCollection = new Mongo.Collection('notifications');

// Event type constants
export const EVENT_TYPES = {
  // Structured product events
  COUPON_PAID: 'coupon_paid',
  AUTOCALL_TRIGGERED: 'autocall_triggered',
  BARRIER_BREACHED: 'barrier_breached',
  BARRIER_NEAR: 'barrier_near',
  FINAL_OBSERVATION: 'final_observation',
  PRODUCT_MATURED: 'product_matured',
  MEMORY_COUPON_ADDED: 'memory_coupon_added',
  EARLY_REDEMPTION: 'early_redemption',
  BARRIER_RECOVERED: 'barrier_recovered',
  UNKNOWN_STRUCTURED_PRODUCT: 'unknown_structured_product',
  AUTO_ALLOCATION_CREATED: 'auto_allocation_created',
  PRICE_OVERRIDE: 'price_override',
  UNDERLYING_DOWN_20: 'underlying_down_20',
  // PMS events
  ALLOCATION_BREACH: 'allocation_breach',
  UNAUTHORIZED_OVERDRAFT: 'unauthorized_overdraft'
};

// Event type display names
export const EVENT_TYPE_NAMES = {
  [EVENT_TYPES.COUPON_PAID]: 'Coupon Paid',
  [EVENT_TYPES.AUTOCALL_TRIGGERED]: 'Autocall Triggered',
  [EVENT_TYPES.BARRIER_BREACHED]: 'Barrier Breached',
  [EVENT_TYPES.BARRIER_NEAR]: 'Near Barrier',
  [EVENT_TYPES.FINAL_OBSERVATION]: 'Final Observation',
  [EVENT_TYPES.PRODUCT_MATURED]: 'Product Matured',
  [EVENT_TYPES.MEMORY_COUPON_ADDED]: 'Memory Coupon Added',
  [EVENT_TYPES.EARLY_REDEMPTION]: 'Early Redemption',
  [EVENT_TYPES.BARRIER_RECOVERED]: 'Barrier Recovered',
  [EVENT_TYPES.UNKNOWN_STRUCTURED_PRODUCT]: 'Unknown Structured Product',
  [EVENT_TYPES.AUTO_ALLOCATION_CREATED]: 'Auto-Allocation Created',
  [EVENT_TYPES.PRICE_OVERRIDE]: 'Price Updated from Bank',
  [EVENT_TYPES.UNDERLYING_DOWN_20]: 'Underlying -20% from Strike',
  // PMS event names
  [EVENT_TYPES.ALLOCATION_BREACH]: 'Allocation Breach',
  [EVENT_TYPES.UNAUTHORIZED_OVERDRAFT]: 'Negative Cash'
};

// Event priority levels (for UI display and sorting)
export const EVENT_PRIORITY = {
  [EVENT_TYPES.AUTOCALL_TRIGGERED]: 1,
  [EVENT_TYPES.PRODUCT_MATURED]: 1,
  [EVENT_TYPES.EARLY_REDEMPTION]: 1,
  [EVENT_TYPES.BARRIER_BREACHED]: 2,
  [EVENT_TYPES.UNKNOWN_STRUCTURED_PRODUCT]: 2,
  // PMS critical alerts
  [EVENT_TYPES.ALLOCATION_BREACH]: 2,
  [EVENT_TYPES.UNAUTHORIZED_OVERDRAFT]: 2,
  [EVENT_TYPES.COUPON_PAID]: 3,
  [EVENT_TYPES.FINAL_OBSERVATION]: 3,
  [EVENT_TYPES.AUTO_ALLOCATION_CREATED]: 4,
  [EVENT_TYPES.BARRIER_NEAR]: 4,
  [EVENT_TYPES.MEMORY_COUPON_ADDED]: 4,
  [EVENT_TYPES.PRICE_OVERRIDE]: 5,
  [EVENT_TYPES.BARRIER_RECOVERED]: 5
};

if (Meteor.isServer) {
  // Create indexes for efficient querying
  Meteor.startup(() => {
    try {
      NotificationsCollection.createIndex({ productId: 1, createdAt: -1 });
      NotificationsCollection.createIndex({ eventType: 1, createdAt: -1 });
      NotificationsCollection.createIndex({ createdAt: -1 });
      NotificationsCollection.createIndex({ sentToUsers: 1, createdAt: -1 });
      NotificationsCollection.createIndex({ readBy: 1, createdAt: -1 });
      NotificationsCollection.createIndex({ emailStatus: 1 });
    } catch (error) {
      console.error('Error creating notification indexes:', error);
    }
  });

  // Auto-cleanup notifications older than 180 days (6 months)
  Meteor.setInterval(async () => {
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    try {
      const removed = await NotificationsCollection.removeAsync({
        createdAt: { $lt: sixMonthsAgo }
      });
      if (removed > 0) {
        console.log(`Cleaned up ${removed} old notifications`);
      }
    } catch (error) {
      console.error('Error cleaning up old notifications:', error);
    }
  }, 24 * 60 * 60 * 1000); // Once per day
}

export const NotificationHelpers = {
  /**
   * Create a new notification
   */
  async createNotification({
    productId,
    productName,
    productIsin,
    eventType,
    eventDate,
    observationDate,
    eventData,
    summary,
    sentToUsers = [],
    sentToEmails = [],
    createdBy = 'system',
    cronJobRunId = null
  }) {
    check(productId, String);
    check(eventType, String);
    check(summary, String);

    // Mark old identical notifications as read for all users
    // An "identical" notification has the same productId, eventType, and summary
    // This prevents duplicate unread notifications from cluttering the notification list
    const markedAsReadResult = await NotificationsCollection.updateAsync(
      {
        productId,
        eventType,
        summary
      },
      {
        $set: { readBy: sentToUsers } // Mark as read for all recipients
      },
      { multi: true }
    );

    if (markedAsReadResult > 0) {
      console.log(`[Notification] Marked ${markedAsReadResult} old identical notification(s) as read`);
    }

    const notification = {
      productId,
      productName: productName || 'Unknown Product',
      productIsin: productIsin || '',
      eventType,
      eventDate: eventDate || new Date(),
      observationDate: observationDate || null,
      eventData: eventData || {},
      summary,
      sentToUsers,
      sentToEmails,
      emailSentAt: null,
      emailStatus: 'pending',
      readBy: [],
      createdAt: new Date(),
      createdBy,
      cronJobRunId: cronJobRunId || null // Track which cron run created this
    };

    const notificationId = await NotificationsCollection.insertAsync(notification);
    console.log(`[Notification] Created ${eventType} for product ${productId}`);

    return notificationId;
  },

  /**
   * Create a user-focused notification (for alerts, warnings, system messages)
   * This is different from createNotification which is product-focused
   * @param {Object} params
   * @param {String} params.userId - User ID to send notification to
   * @param {String} params.type - Alert type: 'info', 'warning', 'error', 'success'
   * @param {String} params.title - Notification title
   * @param {String} params.message - Notification message
   * @param {Object} params.metadata - Optional metadata object
   * @param {String} params.eventType - Optional explicit eventType (e.g., 'allocation_breach', 'unauthorized_overdraft')
   */
  async create({ userId, type, title, message, metadata, eventType }) {
    check(userId, String);
    check(title, String);
    check(message, String);

    // Derive eventType from type if not explicitly provided
    const derivedEventType = eventType || (type === 'error' ? 'critical_alert' : (type === 'warning' ? 'warning_alert' : 'info_alert'));

    // Mark old identical user notifications as read
    // Identical = same userId, eventType, and title
    const markedAsReadResult = await NotificationsCollection.updateAsync(
      {
        userId,
        eventType: derivedEventType,
        title
      },
      {
        $addToSet: { readBy: userId }
      },
      { multi: true }
    );

    if (markedAsReadResult > 0) {
      console.log(`[Notification] Marked ${markedAsReadResult} old identical user notification(s) as read`);
    }

    const notification = {
      // User-focused fields
      userId,
      type: type || 'info',  // 'info', 'warning', 'error', 'success'
      title,
      message,
      metadata: metadata || {},

      // Make compatible with existing notification UI
      sentToUsers: [userId],
      readBy: [],
      read: false,

      // Standard fields
      createdAt: new Date(),
      createdBy: 'system',

      // Mark as user notification (not product notification)
      isUserNotification: true,
      eventType: derivedEventType
    };

    const notificationId = await NotificationsCollection.insertAsync(notification);
    console.log(`[Notification] Created user notification: ${title} for user ${userId}`);

    return notificationId;
  },

  /**
   * Mark notification emails as sent
   */
  async markEmailsSent(notificationId) {
    check(notificationId, String);

    await NotificationsCollection.updateAsync(notificationId, {
      $set: {
        emailSentAt: new Date(),
        emailStatus: 'sent'
      }
    });
  },

  /**
   * Mark notification emails as failed
   */
  async markEmailsFailed(notificationId, error) {
    check(notificationId, String);

    await NotificationsCollection.updateAsync(notificationId, {
      $set: {
        emailStatus: 'failed',
        emailError: error
      }
    });
  },

  /**
   * Mark notification as read by user
   */
  async markAsRead(notificationId, userId) {
    check(notificationId, String);
    check(userId, String);

    await NotificationsCollection.updateAsync(
      { _id: notificationId },
      { $addToSet: { readBy: userId } }
    );
  },

  /**
   * Mark notification as unread by user
   */
  async markAsUnread(notificationId, userId) {
    check(notificationId, String);
    check(userId, String);

    await NotificationsCollection.updateAsync(
      { _id: notificationId },
      { $pull: { readBy: userId } }
    );
  },

  /**
   * Get unread notification count for user
   */
  async getUnreadCount(userId) {
    check(userId, String);

    return await NotificationsCollection.find({
      sentToUsers: userId,
      readBy: { $ne: userId }
    }).countAsync();
  },

  /**
   * Get total notification count for user
   * @param {String} userId - User ID
   * @param {Date|String|null} lastViewedAt - Optional timestamp to count only new notifications since this time
   */
  async getTotalCount(userId, lastViewedAt = null) {
    check(userId, String);

    const query = { sentToUsers: userId };

    // If lastViewedAt is provided, only count notifications created after that time
    if (lastViewedAt) {
      query.createdAt = { $gt: new Date(lastViewedAt) };
    }

    return await NotificationsCollection.find(query).countAsync();
  },

  /**
   * Get recent notifications for user
   */
  async getRecentNotifications(userId, limit = 10) {
    check(userId, String);
    check(limit, Number);

    return await NotificationsCollection.find(
      { sentToUsers: userId },
      {
        sort: { createdAt: -1 },
        limit
      }
    ).fetchAsync();
  },

  /**
   * Get notifications for product
   */
  async getProductNotifications(productId, limit = 50) {
    check(productId, String);
    check(limit, Number);

    return await NotificationsCollection.find(
      { productId },
      {
        sort: { createdAt: -1 },
        limit
      }
    ).fetchAsync();
  },

  /**
   * Check if similar notification already exists (avoid duplicates)
   */
  async checkDuplicate(productId, eventType, eventDate, hourThreshold = 24) {
    check(productId, String);
    check(eventType, String);

    const cutoff = new Date(Date.now() - hourThreshold * 60 * 60 * 1000);

    const existing = await NotificationsCollection.findOneAsync({
      productId,
      eventType,
      eventDate: { $gte: cutoff }
    });

    return !!existing;
  },

  /**
   * Check if similar user notification already exists (for alerts like negative cash)
   * Uses metadata.bankAccountId or metadata.portfolioCode to identify unique issues
   * @param {String} eventType - e.g., 'critical_alert', 'warning_alert'
   * @param {Object} metadata - must contain bankAccountId or portfolioCode
   * @param {Number} hourThreshold - hours to look back (default 24)
   * @returns {Boolean} - true if duplicate exists
   */
  async checkUserNotificationDuplicate(eventType, metadata, hourThreshold = 24) {
    check(eventType, String);
    check(metadata, Object);

    const cutoff = new Date(Date.now() - hourThreshold * 60 * 60 * 1000);

    const query = {
      eventType,
      createdAt: { $gte: cutoff }
    };

    // Match on bankAccountId if available
    if (metadata.bankAccountId) {
      query['metadata.bankAccountId'] = metadata.bankAccountId;
    } else if (metadata.portfolioCode && metadata.bankId) {
      query['metadata.portfolioCode'] = metadata.portfolioCode;
      query['metadata.bankId'] = metadata.bankId;
    }

    const existing = await NotificationsCollection.findOneAsync(query);
    return !!existing;
  },

  /**
   * Create a user notification with multiple recipients
   * Used for alerts that need to be seen by multiple users (admin, RM, etc.)
   * @param {Object} params
   * @param {String[]} params.userIds - Array of user IDs to send notification to
   * @param {String} params.type - Alert type: 'info', 'warning', 'error', 'success'
   * @param {String} params.title - Notification title
   * @param {String} params.message - Notification message
   * @param {Object} params.metadata - Optional metadata object
   * @param {String} params.eventType - Optional explicit eventType (e.g., 'allocation_breach', 'unauthorized_overdraft')
   */
  async createForMultipleUsers({ userIds, type, title, message, metadata, eventType }) {
    check(userIds, [String]);
    check(title, String);
    check(message, String);

    if (userIds.length === 0) return null;

    // Derive eventType from type if not explicitly provided
    const derivedEventType = eventType || (type === 'error' ? 'critical_alert' : (type === 'warning' ? 'warning_alert' : 'info_alert'));

    // Mark old identical notifications as read for all recipients
    const markedAsReadResult = await NotificationsCollection.updateAsync(
      {
        eventType: derivedEventType,
        title,
        isUserNotification: true
      },
      {
        $set: { readBy: userIds }
      },
      { multi: true }
    );

    if (markedAsReadResult > 0) {
      console.log(`[Notification] Marked ${markedAsReadResult} old identical multi-user notification(s) as read`);
    }

    const notification = {
      // User-focused fields
      userIds, // All users who should see this
      type: type || 'info',
      title,
      message,
      metadata: metadata || {},

      // Make compatible with existing notification UI
      sentToUsers: userIds,
      readBy: [],
      read: false,

      // Standard fields
      createdAt: new Date(),
      createdBy: 'system',

      // Mark as user notification
      isUserNotification: true,
      eventType: derivedEventType
    };

    const notificationId = await NotificationsCollection.insertAsync(notification);
    console.log(`[Notification] Created user notification: ${title} for ${userIds.length} users`);

    return notificationId;
  },

  /**
   * Resolve (delete) user notifications when the underlying issue is fixed
   * @param {String} eventType - e.g., 'critical_alert'
   * @param {Object} metadata - matching criteria (bankAccountId)
   * @returns {Number} - count of removed notifications
   */
  async resolveUserNotifications(eventType, metadata) {
    check(eventType, String);
    check(metadata, Object);

    const query = { eventType };

    if (metadata.bankAccountId) {
      query['metadata.bankAccountId'] = metadata.bankAccountId;
    }

    const removed = await NotificationsCollection.removeAsync(query);
    if (removed > 0) {
      console.log(`[Notification] Resolved ${removed} ${eventType} alert(s) for account ${metadata.bankAccountId}`);
    }
    return removed;
  }
};

// Server-side methods
if (Meteor.isServer) {
  Meteor.methods({
    /**
     * Mark notification as read
     */
    async 'notifications.markAsRead'(notificationId, sessionId) {
      check(notificationId, String);
      check(sessionId, String);

      // Get current user from session
      const { SessionHelpers } = await import('./sessions');
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        throw new Meteor.Error('not-authorized', 'Invalid session');
      }

      await NotificationHelpers.markAsRead(notificationId, session.userId);
    },

    /**
     * Mark notification as unread
     */
    async 'notifications.markAsUnread'(notificationId, sessionId) {
      check(notificationId, String);
      check(sessionId, String);

      const { SessionHelpers } = await import('./sessions');
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        throw new Meteor.Error('not-authorized', 'Invalid session');
      }

      await NotificationHelpers.markAsUnread(notificationId, session.userId);
    },

    /**
     * Get unread count
     */
    async 'notifications.getUnreadCount'(sessionId) {
      check(sessionId, String);

      const { SessionHelpers } = await import('./sessions');
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        throw new Meteor.Error('not-authorized', 'Invalid session');
      }

      return await NotificationHelpers.getUnreadCount(session.userId);
    },

    /**
     * Get total notification count
     */
    async 'notifications.getTotalCount'(sessionId, lastViewedAt = null) {
      check(sessionId, String);
      check(lastViewedAt, Match.Maybe(Match.OneOf(String, null)));

      const { SessionHelpers } = await import('./sessions');
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        throw new Meteor.Error('not-authorized', 'Invalid session');
      }

      return await NotificationHelpers.getTotalCount(session.userId, lastViewedAt);
    },

    /**
     * Get recent notifications
     */
    async 'notifications.getRecent'(limit, sessionId) {
      check(limit, Number);
      check(sessionId, String);

      const { SessionHelpers } = await import('./sessions');
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        throw new Meteor.Error('not-authorized', 'Invalid session');
      }

      return await NotificationHelpers.getRecentNotifications(session.userId, limit);
    },

    /**
     * Get all notifications for user (with filters)
     */
    async 'notifications.getAll'(filters, sessionId) {
      check(filters, Object);
      check(sessionId, String);

      const { SessionHelpers } = await import('./sessions');
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        throw new Meteor.Error('not-authorized', 'Invalid session');
      }

      const query = { sentToUsers: session.userId };

      // Apply filters
      if (filters.eventType) {
        query.eventType = filters.eventType;
      }

      if (filters.productId) {
        query.productId = filters.productId;
      }

      if (filters.unreadOnly) {
        query.readBy = { $ne: session.userId };
      }

      if (filters.dateFrom || filters.dateTo) {
        query.createdAt = {};
        if (filters.dateFrom) {
          query.createdAt.$gte = new Date(filters.dateFrom);
        }
        if (filters.dateTo) {
          query.createdAt.$lte = new Date(filters.dateTo);
        }
      }

      const limit = filters.limit || 100;
      const skip = filters.skip || 0;

      const notifications = await NotificationsCollection.find(query, {
        sort: { createdAt: -1 },
        limit,
        skip
      }).fetchAsync();

      const total = await NotificationsCollection.find(query).countAsync();

      return {
        notifications,
        total,
        hasMore: total > skip + notifications.length
      };
    },

    /**
     * Get alerts for Alert Center (role-based access)
     * - Admins see ALL alerts
     * - Clients/RMs see only their own product alerts
     */
    async 'notifications.getAlerts'(filters, sessionId) {
      check(filters, Object);
      check(sessionId, String);

      const { SessionHelpers } = await import('./sessions');
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        throw new Meteor.Error('not-authorized', 'Invalid session');
      }

      // Get user role
      const { UsersCollection } = await import('./users');
      const user = await UsersCollection.findOneAsync({ _id: session.userId });
      const userRole = user?.role || 'client';

      // Alert-specific event types
      const alertEventTypes = [
        'barrier_breached',
        'barrier_near',
        'underlying_down_20',
        'coupon_paid',
        'product_matured',
        'autocall_triggered',
        'early_redemption',
        // PMS alerts
        'allocation_breach',
        'unauthorized_overdraft'
      ];

      // Build query
      const query = {};

      // Role-based filtering
      if (userRole === 'admin' || userRole === 'superadmin') {
        // Admins see all alerts - no user filter
      } else {
        // Clients and RMs only see their own alerts
        query.sentToUsers = session.userId;
      }

      // Filter by alert event types
      if (filters.eventTypes && filters.eventTypes.length > 0) {
        query.eventType = { $in: filters.eventTypes };
      } else if (filters.alertType) {
        query.eventType = filters.alertType;
      } else {
        query.eventType = { $in: alertEventTypes };
      }

      // Unread only filter
      if (filters.unreadOnly) {
        query.readBy = { $ne: session.userId };
      }

      // Date range filter
      if (filters.dateFrom || filters.dateTo) {
        query.createdAt = {};
        if (filters.dateFrom) {
          query.createdAt.$gte = new Date(filters.dateFrom);
        }
        if (filters.dateTo) {
          query.createdAt.$lte = new Date(filters.dateTo);
        }
      }

      const limit = filters.limit || 50;
      const skip = filters.skip || 0;

      const notifications = await NotificationsCollection.find(query, {
        sort: { createdAt: -1 },
        limit,
        skip
      }).fetchAsync();

      const total = await NotificationsCollection.find(query).countAsync();

      return {
        notifications,
        total,
        hasMore: total > skip + notifications.length
      };
    },

    /**
     * Mark all notifications as read
     */
    async 'notifications.markAllAsRead'(sessionId) {
      check(sessionId, String);

      const { SessionHelpers } = await import('./sessions');
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        throw new Meteor.Error('not-authorized', 'Invalid session');
      }

      await NotificationsCollection.updateAsync(
        {
          sentToUsers: session.userId,
          readBy: { $ne: session.userId }
        },
        { $addToSet: { readBy: session.userId } },
        { multi: true }
      );
    }
  });
}
