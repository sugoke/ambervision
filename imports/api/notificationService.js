import { Meteor } from 'meteor/meteor';
import { NotificationHelpers } from './notifications';
import { UsersCollection, USER_ROLES } from './users';
import { AllocationsCollection } from './allocations';
import { EmailService } from './emailService';

/**
 * Notification Service
 *
 * Handles creation and distribution of notifications
 * for structured product events.
 */

export const NotificationService = {
  /**
   * Process events and create notifications (email sending handled by daily digest)
   * @param {Object} product - Product data
   * @param {Array} events - Array of detected events
   * @param {String} triggeredBy - Who triggered the evaluation
   * @param {String} cronJobRunId - ID of cron job run (for batching in daily digest)
   */
  async processEvents(product, events, triggeredBy = 'system', cronJobRunId = null) {
    if (!events || events.length === 0) {
      console.log('[NotificationService] No events to process');
      return;
    }

    console.log(`[NotificationService] Processing ${events.length} events for product ${product._id}`);

    const createdNotifications = [];

    for (const event of events) {
      try {
        // Check for duplicate notifications
        const isDuplicate = await NotificationHelpers.checkDuplicate(
          product._id,
          event.type,
          event.date,
          24 // 24 hour threshold
        );

        if (isDuplicate) {
          console.log(`[NotificationService] Skipping duplicate ${event.type} for product ${product._id}`);
          continue;
        }

        // Get affected users
        const { users, emails } = await this.getAffectedUsers(product);

        console.log(`[NotificationService] Creating notification for ${event.type} (${users.length} users)`);

        // Create notification (without sending individual emails)
        const notificationId = await NotificationHelpers.createNotification({
          productId: product._id,
          productName: product.title || product.productName,
          productIsin: product.isin,
          eventType: event.type,
          eventDate: event.date,
          observationDate: event.observationDate,
          eventData: event.data,
          summary: event.summary,
          sentToUsers: users.map(u => u._id),
          sentToEmails: emails,
          createdBy: triggeredBy,
          cronJobRunId: cronJobRunId // Track which cron run created this
        });

        createdNotifications.push(notificationId);

      } catch (error) {
        console.error(`[NotificationService] Error processing event ${event.type}:`, error);
      }
    }

    return createdNotifications;
  },

  /**
   * Get list of users who should be notified about this product
   * @param {Object} product - Product data
   * @returns {Object} - {users: Array, emails: Array}
   */
  async getAffectedUsers(product) {
    const affectedUsers = new Set();
    const affectedEmails = new Set();

    // 1. Get all superadmins
    const superadmins = await UsersCollection.find({
      role: USER_ROLES.SUPERADMIN
    }).fetchAsync();

    superadmins.forEach(user => {
      affectedUsers.add(user);
      affectedEmails.add(user.username); // username is email
    });

    // 2. Get all admins
    const admins = await UsersCollection.find({
      role: USER_ROLES.ADMIN
    }).fetchAsync();

    admins.forEach(user => {
      affectedUsers.add(user);
      affectedEmails.add(user.username);
    });

    // 3. Get allocations for this product
    const allocations = await AllocationsCollection.find({
      productId: product._id,
      status: 'active'
    }).fetchAsync();

    const clientIds = [...new Set(allocations.map(a => a.clientId))];

    // 4. Get relationship managers for these clients
    if (clientIds.length > 0) {
      const clients = await UsersCollection.find({
        _id: { $in: clientIds },
        relationshipManagerId: { $exists: true, $ne: null }
      }).fetchAsync();

      const rmIds = [...new Set(clients.map(c => c.relationshipManagerId))];

      if (rmIds.length > 0) {
        const rms = await UsersCollection.find({
          _id: { $in: rmIds },
          role: USER_ROLES.RELATIONSHIP_MANAGER
        }).fetchAsync();

        rms.forEach(rm => {
          affectedUsers.add(rm);
          affectedEmails.add(rm.username);
        });
      }
    }

    return {
      users: Array.from(affectedUsers),
      emails: Array.from(affectedEmails)
    };
  },

  /**
   * Get notifications created during a specific cron job run
   * @param {String} cronJobRunId - Cron job run ID
   * @returns {Array} Array of notifications with product allocation data
   */
  async getNotificationsForCronRun(cronJobRunId) {
    const { NotificationsCollection } = await import('./notifications');
    const { AllocationsCollection } = await import('./allocations');
    const { ProductsCollection } = await import('./products');

    // Get all notifications from this cron run
    const notifications = await NotificationsCollection.find({
      cronJobRunId: cronJobRunId,
      emailStatus: 'pending' // Only get unsent notifications
    }).fetchAsync();

    // Enrich notifications with product allocation data
    const enrichedNotifications = await Promise.all(
      notifications.map(async (notification) => {
        // Get product allocation data
        const allocations = await AllocationsCollection.find({
          productId: notification.productId,
          status: 'active'
        }).fetchAsync();

        const totalNominalInvested = allocations.reduce(
          (sum, alloc) => sum + (alloc.nominalInvested || 0),
          0
        );

        const clientCount = new Set(allocations.map(a => a.clientId)).size;

        // Get product for additional details
        const product = await ProductsCollection.findOneAsync({ _id: notification.productId });

        return {
          ...notification,
          allocation: {
            totalNominalInvested,
            clientCount,
            currency: allocations[0]?.currency || 'CHF'
          },
          product: product || {}
        };
      })
    );

    return enrichedNotifications;
  }
};
