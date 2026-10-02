import { Meteor } from 'meteor/meteor';
import { NotificationsCollection, EVENT_TYPE_NAMES } from './notifications';
import { UsersCollection } from './users';
import { EmailService, EMAIL, emailShell, emailGreeting, emailParagraph, emailProductCard, emailNotice, emailButton, emailMutedNote } from './emailService';
import { getPreferenceForEventType, isEmailEnabledForEventType } from '/imports/constants/notificationPreferences';

/**
 * Instant alert emails
 *
 * Sends an email to each recipient of a notification who ticked that alert
 * type in Profile > Notifications, as soon as the notification is created.
 *
 * - Gated by `Meteor.settings.private.INSTANT_ALERT_EMAILS_ENABLED === true`
 *   (dev and prod share the Atlas DB, so only the server that owns email
 *   delivery should have it on).
 * - `INSTANT_ALERT_TEST_EMAIL` reroutes every instant email to one inbox.
 * - An alert is emailed to a user once: if an identical earlier notification
 *   (same product/eventType/summary, or same eventType/title/message for user
 *   alerts) was already emailed to them, it is not sent again.
 * - Delivery is recorded on the notification in `instantEmail`, which the
 *   daily digest reads to avoid repeating the alert.
 */

const TONE_BY_TYPE = { error: 'danger', warning: 'warning', success: 'success', info: 'info' };

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const displayName = (user) => user?.profile?.firstName || '';

/**
 * A user's email address. Logins are mostly short usernames ("mf") with the
 * address in `email`, so `email` comes first; a username is used only when it is
 * itself an address. Sending to the bare username made SendPulse reject every
 * alert ("Recipient email is invalid").
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const userEmailAddress = (user) => {
  const candidates = [user?.email, user?.emails?.[0]?.address, user?.username];
  return candidates.map(v => (typeof v === 'string' ? v.trim() : '')).find(v => EMAIL_PATTERN.test(v)) || null;
};

const buildIdenticalQuery = (notification) => {
  if (notification.isUserNotification) {
    return {
      _id: { $ne: notification._id },
      isUserNotification: true,
      eventType: notification.eventType,
      title: notification.title,
      message: notification.message
    };
  }
  return {
    _id: { $ne: notification._id },
    productId: notification.productId,
    eventType: notification.eventType,
    summary: notification.summary
  };
};

const buildEmail = (notification, user, appUrl, { isTest = false } = {}) => {
  const typeName = EVENT_TYPE_NAMES[notification.eventType] || notification.title || 'Alert';
  const heading = notification.isUserNotification ? (notification.title || typeName) : typeName;
  const body = notification.isUserNotification ? notification.message : notification.summary;

  const link = notification.productId
    ? `${appUrl}/#products/${notification.productId}`
    : `${appUrl}/#notifications`;
  const linkLabel = notification.productId ? 'View Product Details' : 'Open Notifications';

  const product = notification.productId
    ? { title: notification.productName, isin: notification.productIsin }
    : null;

  const tone = TONE_BY_TYPE[notification.type] || 'info';
  const bodyHtml = escapeHtml(body).replace(/\n/g, '<br>');

  const html = emailShell({
    title: heading,
    subtitle: notification.isUserNotification ? typeName : '',
    bodyHtml: `${emailGreeting(escapeHtml(displayName(user)))}${
      product ? `${emailParagraph('A new alert was raised for:')}${emailProductCard({
        title: escapeHtml(product.title),
        isin: escapeHtml(product.isin)
      })}${emailParagraph(bodyHtml)}` : emailNotice(tone, escapeHtml(heading), bodyHtml)
    }${emailButton(link, linkLabel)}${emailMutedNote(isTest
      ? 'You requested this test from Profile &rsaquo; Notifications.'
      : `You receive this email because <strong style="color: ${EMAIL.ink};">${escapeHtml(typeName)}</strong> alerts are enabled in your Ambervision profile (Profile &rsaquo; Notifications).`
    )}`
  });

  const name = displayName(user);
  const text = [
    heading,
    '',
    `Hello${name ? ` ${name}` : ''},`,
    '',
    ...(product ? [`${product.title} (${product.isin || 'N/A'})`, ''] : []),
    body,
    '',
    `${linkLabel}: ${link}`,
    '',
    isTest
      ? 'You requested this test from Profile > Notifications.'
      : `You receive this email because ${typeName} alerts are enabled in your Ambervision profile (Profile > Notifications).`
  ].join('\n');

  const subject = product
    ? `[Ambervision] ${typeName} - ${product.title}`
    : `[Ambervision] ${heading}`;

  return { subject, html, text };
};

export const NotificationEmailDispatcher = {
  isEnabled() {
    return Meteor.settings.private?.INSTANT_ALERT_EMAILS_ENABLED === true;
  },

  /**
   * Email a freshly created notification to its opted-in recipients.
   * Never throws: failures are logged and recorded on the notification.
   */
  async dispatch(notificationId) {
    if (!Meteor.isServer || !this.isEnabled()) return;

    try {
      const notification = await NotificationsCollection.findOneAsync(notificationId);
      if (!notification) return;

      const pref = getPreferenceForEventType(notification.eventType);
      if (!pref || pref.alwaysEmailed) return;

      const recipientIds = notification.sentToUsers || [];
      if (recipientIds.length === 0) return;

      const users = await UsersCollection.find(
        { _id: { $in: recipientIds } },
        { fields: { username: 1, email: 1, emails: 1, role: 1, profile: 1, notificationPreferences: 1 } }
      ).fetchAsync();

      const optedIn = users.filter(u => userEmailAddress(u) && isEmailEnabledForEventType(u, notification.eventType));
      if (optedIn.length === 0) return;

      // Skip users who were already emailed this exact alert
      const alreadyEmailed = new Set();
      const previous = await NotificationsCollection.find(
        { ...buildIdenticalQuery(notification), 'instantEmail.sentTo': { $in: optedIn.map(u => u._id) } },
        { fields: { 'instantEmail.sentTo': 1 } }
      ).fetchAsync();
      previous.forEach(n => (n.instantEmail?.sentTo || []).forEach(id => alreadyEmailed.add(id)));

      const toSend = optedIn.filter(u => !alreadyEmailed.has(u._id));
      if (toSend.length === 0) {
        console.log(`[InstantEmail] ${notification.eventType} ${notificationId}: already emailed to all opted-in recipients`);
        return;
      }

      const { appUrl } = EmailService.getConfig();
      const testEmail = Meteor.settings.private?.INSTANT_ALERT_TEST_EMAIL;
      const sentTo = [];
      const sentToEmails = [];
      const failures = [];

      for (const user of toSend) {
        const address = userEmailAddress(user);
        const recipient = testEmail || address;
        try {
          const { subject, html, text } = buildEmail(notification, user, appUrl);
          await EmailService.sendEmail({
            subject: testEmail ? `${subject} (for ${address})` : subject,
            html,
            text,
            to: [{ email: recipient, name: displayName(user) || recipient }]
          });
          sentTo.push(user._id);
          sentToEmails.push(address);
        } catch (error) {
          failures.push({ userId: user._id, error: error.message });
          console.error(`[InstantEmail] Failed to email ${notification.eventType} to user ${user._id}:`, error.message);
        }
      }

      const update = { $set: { 'instantEmail.lastAttemptAt': new Date() } };
      if (sentTo.length > 0) {
        update.$addToSet = {
          'instantEmail.sentTo': { $each: sentTo },
          'instantEmail.sentToEmails': { $each: sentToEmails }
        };
        update.$set['instantEmail.sentAt'] = new Date();
      }
      if (failures.length > 0) {
        update.$set['instantEmail.failures'] = failures;
      }
      await NotificationsCollection.updateAsync(notificationId, update);

      console.log(`[InstantEmail] ${notification.eventType} ${notificationId}: sent to ${sentTo.length}, failed ${failures.length}`);
    } catch (error) {
      console.error(`[InstantEmail] Dispatch error for notification ${notificationId}:`, error);
    }
  },

  /**
   * Queue dispatch without blocking the caller that created the notification.
   */
  queue(notificationId) {
    if (!Meteor.isServer || !notificationId || !this.isEnabled()) return;
    Meteor.defer(() => { this.dispatch(notificationId); });
  },

  /**
   * Send a sample email so a user can check delivery to their inbox.
   */
  async sendTest(user) {
    const { appUrl } = EmailService.getConfig();
    const sample = {
      _id: 'test',
      isUserNotification: true,
      type: 'info',
      eventType: 'info_alert',
      title: 'Test Alert Email',
      message: 'This is a test email from Ambervision. Your alert emails will look like this.'
    };
    const { subject, html, text } = buildEmail(sample, user, appUrl, { isTest: true });
    return EmailService.sendEmail({
      subject,
      html,
      text,
      to: [{ email: userEmailAddress(user), name: displayName(user) || userEmailAddress(user) }]
    });
  }
};
