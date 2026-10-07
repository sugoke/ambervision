/**
 * Email alert preferences
 *
 * Shared (client + server) catalogue of the alerts a user can opt into
 * receiving by email the moment they are created. Each preference maps to
 * one or more notification `eventType` values, so the dispatcher resolves a
 * notification to a preference key and checks the recipient's opt-in.
 *
 * Stored on the user document as:
 *   notificationPreferences: {
 *     email: { [preferenceKey]: Boolean },
 *     updatedAt: Date
 *   }
 *
 * Only ALERT_EMAIL_ROLES (superadmin, RM, compliance) are emailed: they receive
 * every alert until they untick it (a missing key means "on"). Every other role,
 * clients first, receives none and cannot opt in. Recipients are still only the
 * users a notification is addressed to, so an RM only ever gets alerts about
 * their own clients.
 *
 * `alwaysEmailed` marks alerts that already trigger a mandatory email through
 * their own flow (e.g. four-eyes order validation); the dispatcher skips them
 * so recipients never get the same alert twice, and the UI shows them locked.
 */

export const NOTIFICATION_PREFERENCE_GROUPS = [
  {
    id: 'products',
    label: 'Structured Products',
    description: 'Events detected when products are re-evaluated.',
    preferences: [
      { key: 'coupon_paid', label: 'Coupon paid', eventTypes: ['coupon_paid'] },
      { key: 'memory_coupon_added', label: 'Memory coupon added', eventTypes: ['memory_coupon_added'] },
      { key: 'autocall_triggered', label: 'Autocall triggered', eventTypes: ['autocall_triggered', 'early_redemption'] },
      { key: 'barrier_breached', label: 'Barrier breached', eventTypes: ['barrier_breached'] },
      { key: 'barrier_near', label: 'Near barrier', eventTypes: ['barrier_near'] },
      { key: 'barrier_recovered', label: 'Barrier recovered', eventTypes: ['barrier_recovered'] },
      { key: 'final_observation', label: 'Final observation', eventTypes: ['final_observation'] },
      { key: 'product_matured', label: 'Product matured', eventTypes: ['product_matured'] }
    ]
  },
  {
    id: 'portfolio',
    label: 'Portfolio Monitoring',
    description: 'Alerts raised while processing bank files.',
    preferences: [
      { key: 'unauthorized_overdraft', label: 'Negative cash', eventTypes: ['unauthorized_overdraft'] },
      { key: 'allocation_breach', label: 'Allocation breach', eventTypes: ['allocation_breach'] }
    ]
  },
  {
    id: 'orders',
    label: 'Orders',
    description: 'Four-eyes validation workflow and live limit orders.',
    preferences: [
      {
        key: 'order_pending_validation',
        label: 'Order pending validation',
        eventTypes: ['order_pending_validation'],
        alwaysEmailed: true,
        hint: 'Always emailed to validators by the order workflow'
      },
      { key: 'order_validated', label: 'Order / modification validated', eventTypes: ['order_validated'] },
      { key: 'order_rejected', label: 'Order / modification rejected', eventTypes: ['order_rejected'] },
      {
        key: 'limit_level_reached',
        label: 'Limit level reached',
        eventTypes: ['limit_level_reached'],
        hint: 'The market reached the level of a live limit or stop order: probably executed'
      }
    ]
  },
  {
    id: 'compliance',
    label: 'Compliance',
    description: 'Questions and report requests between compliance and relationship managers.',
    preferences: [
      { key: 'compliance_query', label: 'Compliance question received', eventTypes: ['compliance_query'] },
      { key: 'compliance_query_answered', label: 'Compliance question answered', eventTypes: ['compliance_query_answered'] },
      { key: 'visit_report_requested', label: 'Visit report requested by compliance', eventTypes: ['visit_report_requested'] },
      { key: 'visit_report_delivered', label: 'Requested visit report delivered', eventTypes: ['visit_report_delivered'] }
    ]
  },
  {
    id: 'system',
    label: 'System',
    description: 'Other operational alerts (bank file structure changes, pending modifications, ...).',
    preferences: [
      { key: 'critical_alert', label: 'Critical alerts', eventTypes: ['critical_alert'] },
      { key: 'warning_alert', label: 'Warnings', eventTypes: ['warning_alert'] },
      { key: 'info_alert', label: 'Information', eventTypes: ['info_alert'] }
    ]
  }
];

const ALL_PREFERENCES = NOTIFICATION_PREFERENCE_GROUPS.flatMap(g => g.preferences);

export const NOTIFICATION_PREFERENCE_KEYS = ALL_PREFERENCES.map(p => p.key);

const PREFERENCE_BY_EVENT_TYPE = ALL_PREFERENCES.reduce((acc, pref) => {
  pref.eventTypes.forEach(type => { acc[type] = pref; });
  return acc;
}, {});

/**
 * Resolve the preference entry that governs a notification eventType.
 * @returns {Object|null} preference definition, or null if the type is not user-configurable
 */
export const getPreferenceForEventType = (eventType) => PREFERENCE_BY_EVENT_TYPE[eventType] || null;

/**
 * The only roles that are ever emailed alerts (instant or daily digest).
 * Clients, introducers and every other role never are, whatever is stored in
 * their preferences: the list is checked again where each email is sent.
 */
export const ALERT_EMAIL_ROLES = ['superadmin', 'rm', 'compliance'];

export const canReceiveAlertEmails = (user) => ALERT_EMAIL_ROLES.includes(user?.role);

/** Default for a preference the user has never set: on for the roles above. */
export const isEmailOnByDefault = (role) => ALERT_EMAIL_ROLES.includes(role);

/** Effective value of one preference key for a user. */
export const isPreferenceEnabled = (user, key) => {
  if (!canReceiveAlertEmails(user)) return false;
  const value = user?.notificationPreferences?.email?.[key];
  return typeof value === 'boolean' ? value : isEmailOnByDefault(user?.role);
};

/** Whether a user receives instant email for the given eventType. */
export const isEmailEnabledForEventType = (user, eventType) => {
  const pref = getPreferenceForEventType(eventType);
  if (!pref || pref.alwaysEmailed) return false;
  return isPreferenceEnabled(user, pref.key);
};
