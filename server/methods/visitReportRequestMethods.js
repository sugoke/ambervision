import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES, UserHelpers } from '../../imports/api/users.js';
import { ClientEntitiesCollection, ClientEntityHelpers, ENTITY_STATUSES } from '../../imports/api/clientEntities.js';
import { resolveClientRmIds } from '../../imports/api/notificationService.js';
import { NotificationHelpers, EVENT_TYPES } from '../../imports/api/notifications.js';
import { AuditLog } from '../../imports/api/auditLog.js';
import { VisitReportRequestsCollection, VISIT_REQUEST_STATUS } from '../../imports/api/visitReportRequests.js';

/**
 * Visit report requests: compliance asks the client's RM for a meeting /
 * visit report from the compliance dashboard. The RM is notified (in-app and
 * the daily digest); the notification opens the meeting-report editor on that
 * client, and finalizing a report for the client closes the request
 * (fulfillVisitReportRequests, called from meetingReports.finalize).
 */

const COMPLIANCE_ROLES = [USER_ROLES.SUPERADMIN, USER_ROLES.COMPLIANCE];
const RM_ROLES = [USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT, USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE];
const MAX_NOTE_LENGTH = 1000;

const userName = (u) => [u?.profile?.firstName, u?.profile?.lastName].filter(Boolean).join(' ').trim()
  || u?.username || u?.email || 'Unknown';

const formatDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '');

async function validateSession(sessionId, roles) {
  const session = await SessionHelpers.validateSession(sessionId);
  if (!session) throw new Meteor.Error('not-authorized', 'Invalid or expired session');
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) throw new Meteor.Error('not-authorized', 'User not found');
  if (roles && !roles.includes(user.role)) {
    throw new Meteor.Error('not-authorized', 'Your role cannot do this');
  }
  return user;
}

/**
 * Close every open request for the client once a meeting report has been
 * finalized for it, and tell whoever asked. Never throws: finalizing the
 * report must not fail because of the request bookkeeping.
 */
export async function fulfillVisitReportRequests({ entityId, meetingReportId, user }) {
  if (!entityId) return 0;
  try {
    const open = await VisitReportRequestsCollection.find({ entityId, status: VISIT_REQUEST_STATUS.OPEN }).fetchAsync();
    for (const request of open) {
      await VisitReportRequestsCollection.updateAsync(
        { _id: request._id, status: VISIT_REQUEST_STATUS.OPEN },
        {
          $set: {
            status: VISIT_REQUEST_STATUS.FULFILLED,
            meetingReportId,
            fulfilledAt: new Date(),
            fulfilledBy: user?._id || null
          }
        }
      );
      await NotificationHelpers.create({
        userId: request.requestedBy,
        type: 'success',
        eventType: EVENT_TYPES.VISIT_REPORT_DELIVERED,
        title: `Visit report delivered — ${request.clientNameSnapshot}`,
        message: `${userName(user)} finalized the meeting report you requested on ${formatDate(request.requestedAt)}. It is filed on the client file (KYC → Visit Reports).`,
        metadata: { visitReportRequestId: request._id, entityId, meetingReportId }
      });
      await AuditLog.record({
        actorUserId: user?._id || null,
        actorRole: user?.role || null,
        action: 'visitReport.requestFulfilled',
        targetType: 'visitReportRequest',
        targetId: request._id,
        meta: { entityId, meetingReportId }
      });
    }
    return open.length;
  } catch (err) {
    console.error('[VISIT-REQUEST] Could not close requests for', entityId, err);
    return 0;
  }
}

Meteor.methods({
  /**
   * Compliance: ask the client's RM(s) for a visit / meeting report.
   * One open request per client — asking again returns the open one.
   */
  async 'visitReportRequests.create'({ entityId, note }, sessionId) {
    check(entityId, String);
    check(note, Match.Maybe(String));
    check(sessionId, String);
    const user = await validateSession(sessionId, COMPLIANCE_ROLES);

    const entity = await ClientEntitiesCollection.findOneAsync(entityId);
    if (!entity || entity.isActive === false) throw new Meteor.Error('not-found', 'Client not found');
    if (entity.status === ENTITY_STATUSES.ARCHIVED) {
      throw new Meteor.Error('invalid', 'This client is archived');
    }

    const existing = await VisitReportRequestsCollection.findOneAsync({ entityId, status: VISIT_REQUEST_STATUS.OPEN });
    if (existing) return { ok: true, requestId: existing._id, alreadyOpen: true };

    const rmIds = await resolveClientRmIds({ clientIds: [entityId] });
    if (!rmIds.length) {
      throw new Meteor.Error('no-rm', 'No relationship manager is assigned to this client — assign one in Contacts first');
    }

    const clientName = ClientEntityHelpers.getEntityDisplayName(entity) || 'Client';
    const cleanNote = (note || '').trim().slice(0, MAX_NOTE_LENGTH) || null;
    const requestId = await VisitReportRequestsCollection.insertAsync({
      entityId,
      clientNameSnapshot: clientName,
      rmIds,
      requestedBy: user._id,
      requestedByName: userName(user),
      requestedAt: new Date(),
      note: cleanNote,
      status: VISIT_REQUEST_STATUS.OPEN
    });

    for (const rmId of rmIds) {
      await NotificationHelpers.create({
        userId: rmId,
        type: 'warning',
        eventType: EVENT_TYPES.VISIT_REPORT_REQUESTED,
        title: `Visit report requested — ${clientName}`,
        message: `${userName(user)} (compliance) asks for a meeting report on ${clientName}.${cleanNote ? ` Note: ${cleanNote}` : ''} Open it to write the report.`,
        metadata: { visitReportRequestId: requestId, entityId, clientName }
      });
    }

    await AuditLog.record({
      actorUserId: user._id,
      actorRole: user.role,
      action: 'visitReport.requested',
      targetType: 'visitReportRequest',
      targetId: requestId,
      meta: { entityId, rmIds }
    });
    return { ok: true, requestId };
  },

  /** Compliance: withdraw an open request. */
  async 'visitReportRequests.cancel'({ requestId }, sessionId) {
    check(requestId, String);
    check(sessionId, String);
    const user = await validateSession(sessionId, COMPLIANCE_ROLES);

    const updated = await VisitReportRequestsCollection.updateAsync(
      { _id: requestId, status: VISIT_REQUEST_STATUS.OPEN },
      { $set: { status: VISIT_REQUEST_STATUS.CANCELLED, cancelledAt: new Date(), cancelledBy: user._id } }
    );
    if (!updated) throw new Meteor.Error('not-found', 'No open request to cancel');

    await AuditLog.record({
      actorUserId: user._id,
      actorRole: user.role,
      action: 'visitReport.requestCancelled',
      targetType: 'visitReportRequest',
      targetId: requestId
    });
    return { ok: true };
  },

  /** RM: open requests addressed to them (Meeting Reports page). */
  async 'visitReportRequests.listForRm'(sessionId) {
    check(sessionId, String);
    const user = await validateSession(sessionId, RM_ROLES);
    const isAdmin = [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(user.role);
    // Assistants work their RM's book
    const rmIds = UserHelpers.getEffectiveRmIds(user);
    const query = { status: VISIT_REQUEST_STATUS.OPEN, ...(isAdmin ? {} : { rmIds: { $in: rmIds } }) };
    const requests = await VisitReportRequestsCollection.find(query, { sort: { requestedAt: 1 }, limit: 200 }).fetchAsync();
    return requests.map(r => ({
      _id: r._id,
      entityId: r.entityId,
      clientName: r.clientNameSnapshot,
      requestedByName: r.requestedByName,
      requestedAtText: formatDate(r.requestedAt),
      note: r.note || ''
    }));
  }
});
