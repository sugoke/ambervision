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
   * Process events and send notifications
   * @param {Object} product - Product data
   * @param {Array} events - Array of detected events
   * @param {String} triggeredBy - Who triggered the evaluation
   */
  async processEvents(product, events, triggeredBy = 'system') {
    if (!events || events.length === 0) {
      console.log('[NotificationService] No events to process');
      return;
    }

    console.log(`[NotificationService] Processing ${events.length} events for product ${product._id}`);

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

        console.log(`[NotificationService] Sending ${event.type} to ${users.length} users`);

        // Create notification
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
          createdBy: triggeredBy
        });

        // Send emails asynchronously
        Meteor.defer(async () => {
          await this.sendEventEmails(notificationId, product, event, users);
        });

      } catch (error) {
        console.error(`[NotificationService] Error processing event ${event.type}:`, error);
      }
    }
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
   * Send email notifications for an event
   * @param {String} notificationId - Notification ID
   * @param {Object} product - Product data
   * @param {Object} event - Event data
   * @param {Array} users - Users to send to
   */
  async sendEventEmails(notificationId, product, event, users) {
    try {
      console.log(`[NotificationService] Sending emails for ${event.type} to ${users.length} recipients`);

      // Send individual emails to each user
      const emailPromises = users.map(user => {
        const userName = user.profile?.firstName && user.profile?.lastName
          ? `${user.profile.firstName} ${user.profile.lastName}`
          : user.username;

        return this.sendEventEmail(user.username, userName, product, event);
      });

      await Promise.all(emailPromises);

      // Mark emails as sent
      await NotificationHelpers.markEmailsSent(notificationId);

      console.log(`[NotificationService] Emails sent successfully for notification ${notificationId}`);

    } catch (error) {
      console.error(`[NotificationService] Error sending emails:`, error);
      await NotificationHelpers.markEmailsFailed(notificationId, error.message);
    }
  },

  /**
   * Send individual event email
   * @param {String} email - Recipient email
   * @param {String} userName - Recipient name
   * @param {Object} product - Product data
   * @param {Object} event - Event data
   */
  async sendEventEmail(email, userName, product, event) {
    // Get event-specific email method
    const emailMethod = this.getEmailMethodForEvent(event.type);

    if (!emailMethod) {
      console.warn(`[NotificationService] No email method for event type: ${event.type}`);
      return;
    }

    // Call the email method
    await emailMethod(email, userName, product, event);
  },

  /**
   * Get email sending method for event type
   */
  getEmailMethodForEvent(eventType) {
    const eventEmailMethods = {
      'coupon_paid': EmailService.sendCouponPaidEmail,
      'autocall_triggered': EmailService.sendAutocallEmail,
      'barrier_breached': EmailService.sendBarrierBreachEmail,
      'barrier_near': EmailService.sendBarrierNearEmail,
      'final_observation': EmailService.sendFinalObservationEmail,
      'product_matured': EmailService.sendProductMaturedEmail,
      'memory_coupon_added': EmailService.sendMemoryCouponEmail,
      'barrier_recovered': EmailService.sendBarrierRecoveredEmail
    };

    return eventEmailMethods[eventType];
  }
};
