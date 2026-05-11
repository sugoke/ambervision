import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';

import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import {
  MeetingReportsCollection,
  MeetingReportHelpers,
  REPORT_STATUS
} from '/imports/api/meetingReports';

const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COMPLIANCE];

/**
 * Publish meeting reports visible to the current user.
 * RM/assistant: only their own. Admins: everything.
 *
 * Optional filters:
 *   - entityId: narrow to a single client
 *   - includeDeleted (admin only): show soft-deleted entries too
 */
Meteor.publish('meetingReports.list', async function (sessionId, filters = {}) {
  check(sessionId, String);
  check(filters, Match.Maybe({
    entityId: Match.Maybe(String),
    includeDeleted: Match.Maybe(Boolean)
  }));

  const session = await SessionHelpers.validateSession(sessionId);
  if (!session) return this.ready();
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) return this.ready();

  const isAdminUser = ADMIN_ROLES.includes(user.role);
  const visibility = await MeetingReportHelpers.buildVisibilityFilter(user);
  const query = { ...visibility };

  if (!filters?.includeDeleted || !isAdminUser) {
    query.status = { $ne: REPORT_STATUS.DELETED };
  }
  if (filters?.entityId) query.entityId = filters.entityId;

  // Hide rawNotes from non-creators (compliance can still read via the
  // .get method if needed for audit). The list view doesn't need them.
  const fields = isAdminUser ? {} : { rawNotes: 0 };

  return MeetingReportsCollection.find(query, {
    fields,
    sort: { createdAt: -1 },
    limit: 200
  });
});
