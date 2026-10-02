import { Meteor } from 'meteor/meteor';
import { NotificationHelpers } from './notifications';
import { UsersCollection, USER_ROLES } from './users';
import { AllocationsCollection } from './allocations';
import { ClientEntityHelpers } from './clientEntities';
import { EmailService } from './emailService';

/**
 * Notification Service
 *
 * Handles creation and distribution of notifications
 * for structured product events.
 */

/**
 * Relationship managers of the given clients / accounts - the only RMs an alert
 * about them may reach. Resolved from every place a client's RM is recorded:
 * the bank account (RM and backup RMs), the client entity (assignedUserIds,
 * legacy relationshipManagerId) and legacy client logins. Only users with the
 * RM role are returned.
 */
export async function resolveClientRmIds({ clientIds = [], bankAccountIds = [] }) {
  const { BankAccountsCollection } = await import('./bankAccounts');
  const { ClientEntitiesCollection } = await import('./clientEntities');
  const ids = [...new Set(clientIds.filter(Boolean))];
  const accountIds = [...new Set(bankAccountIds.filter(Boolean))];
  const candidates = new Set();

  if (accountIds.length > 0) {
    const accounts = await BankAccountsCollection.find(
      { _id: { $in: accountIds } },
      { fields: { relationshipManagerId: 1, backupRmIds: 1 } }
    ).fetchAsync();
    accounts.forEach(a => [a.relationshipManagerId, ...(a.backupRmIds || [])].forEach(id => id && candidates.add(id)));
  }
  if (ids.length > 0) {
    const entities = await ClientEntitiesCollection.find(
      { $or: [{ _id: { $in: ids } }, { migratedFromUserId: { $in: ids } }] },
      { fields: { assignedUserIds: 1, relationshipManagerId: 1 } }
    ).fetchAsync();
    entities.forEach(e => [...(e.assignedUserIds || []), e.relationshipManagerId].forEach(id => id && candidates.add(id)));
    const legacyClients = await UsersCollection.find(
      { _id: { $in: ids } },
      { fields: { relationshipManagerId: 1 } }
    ).fetchAsync();
    legacyClients.forEach(u => u.relationshipManagerId && candidates.add(u.relationshipManagerId));
  }
  if (candidates.size === 0) return [];

  const rms = await UsersCollection.find(
    { _id: { $in: [...candidates] }, role: USER_ROLES.RELATIONSHIP_MANAGER },
    { fields: { _id: 1 } }
  ).fetchAsync();
  return rms.map(u => u._id);
}

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

    // 3. Get allocations for this product — exclude archived (closed-relationship)
    // clients so their RM is no longer notified. Admins/superadmins above still
    // receive everything; active co-holders of the same product are unaffected.
    const archivedAllocExclusion = await ClientEntityHelpers.archivedAllocationsSelector();
    const allocations = await AllocationsCollection.find({
      $and: [
        { productId: product._id, status: 'active' },
        archivedAllocExclusion
      ]
    }).fetchAsync();

    // 4. Relationship managers of the clients holding the product - entity-era
    // clients record their RMs on the entity and the account, not on a login
    const rmIds = await resolveClientRmIds({
      clientIds: allocations.flatMap(a => [a.clientId, a.entityId]),
      bankAccountIds: allocations.map(a => a.bankAccountId)
    });
    if (rmIds.length > 0) {
      const rms = await UsersCollection.find({ _id: { $in: rmIds } }).fetchAsync();
      rms.forEach(rm => {
        affectedUsers.add(rm);
        affectedEmails.add(rm.username);
      });
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
