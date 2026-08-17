import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

/**
 * Append-only audit trail of access to and disclosure of client data
 * (GDPR accountability, Art. 5(2) / Art. 30).
 *
 * One document per event:
 *   { at, actorUserId, actorRole, action, targetType, targetId, meta }
 *
 * Actions recorded (choke points, not every read):
 *   - auth.login / auth.loginFailed
 *   - document.download        (KYC/ID file served)
 *   - export.pdf / export.data (statements, reports, GDPR bundles)
 *   - order.validated / order.rejected
 *   - gdpr.export / gdpr.anonymize / gdpr.deleteLead
 *
 * Retention: 2 years (TTL). The gdprRegister keeps erasure records permanently;
 * this log answers "who accessed what, recently".
 */
export const AuditLogCollection = new Mongo.Collection('auditLog');

const TWO_YEARS_SECONDS = 2 * 365 * 24 * 60 * 60;

if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      await AuditLogCollection.rawCollection().createIndex(
        { at: 1 },
        { expireAfterSeconds: TWO_YEARS_SECONDS }
      );
      await AuditLogCollection.rawCollection().createIndex({ actorUserId: 1, at: -1 });
      await AuditLogCollection.rawCollection().createIndex({ targetType: 1, targetId: 1, at: -1 });
    } catch (e) {
      console.error('[AuditLog] Index creation failed:', e.message);
    }
  });
}

export const AuditLog = {
  /**
   * Record an audit event. Never throws — an audit failure must not break the
   * operation being audited (it is logged instead).
   */
  async record({ actorUserId = null, actorRole = null, action, targetType = null, targetId = null, meta = null }) {
    try {
      await AuditLogCollection.insertAsync({
        at: new Date(),
        actorUserId,
        actorRole,
        action,
        targetType,
        targetId,
        meta: meta || undefined
      });
    } catch (e) {
      console.error(`[AuditLog] Failed to record ${action}:`, e.message);
    }
  }
};
