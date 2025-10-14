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
  COUPON_PAID: 'coupon_paid',
  AUTOCALL_TRIGGERED: 'autocall_triggered',
  BARRIER_BREACHED: 'barrier_breached',
  BARRIER_NEAR: 'barrier_near',
  FINAL_OBSERVATION: 'final_observation',
  PRODUCT_MATURED: 'product_matured',
  MEMORY_COUPON_ADDED: 'memory_coupon_added',
  EARLY_REDEMPTION: 'early_redemption',
  BARRIER_RECOVERED: 'barrier_recovered'
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
  [EVENT_TYPES.BARRIER_RECOVERED]: 'Barrier Recovered'
};

// Event priority levels (for UI display and sorting)
export const EVENT_PRIORITY = {
  [EVENT_TYPES.AUTOCALL_TRIGGERED]: 1,
  [EVENT_TYPES.PRODUCT_MATURED]: 1,
  [EVENT_TYPES.EARLY_REDEMPTION]: 1,
  [EVENT_TYPES.BARRIER_BREACHED]: 2,
  [EVENT_TYPES.COUPON_PAID]: 3,
  [EVENT_TYPES.FINAL_OBSERVATION]: 3,
  [EVENT_TYPES.BARRIER_NEAR]: 4,
  [EVENT_TYPES.MEMORY_COUPON_ADDED]: 4,
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
    createdBy = 'system'
  }) {
    check(productId, String);
    check(eventType, String);
    check(summary, String);

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
      createdBy
    };

    const notificationId = await NotificationsCollection.insertAsync(notification);
    console.log(`[Notification] Created ${eventType} for product ${productId}`);

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
