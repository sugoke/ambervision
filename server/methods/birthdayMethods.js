// Intranet > Birthday Calendar
//
// Birthdays come from the contacts database (clientEntities: individuals and their
// family members), limited to the caller's perimeter with the same rules as the
// Contacts list:
//   - Admin / Superadmin / Compliance: every contact
//   - RM: contacts assigned to them
//   - Assistant: contacts of the RMs they assist
// Legacy client login accounts that are the same person as a contact are folded
// into that contact (their birthday is used only if the contact has none); those
// not yet migrated still appear. Admins also see team members' birthdays.
//
// The people themselves come from server/helpers/birthdayPeople.js, shared with
// the daily birthday reminders sent to RMs.

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { SessionHelpers } from '/imports/api/sessions';
import { collectBirthdayPeople } from '../helpers/birthdayPeople.js';

const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COMPLIANCE];
const ALLOWED_ROLES = [...ADMIN_ROLES, USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT];

Meteor.methods({
  async 'birthdays.getCalendar'(sessionId) {
    check(sessionId, String);

    const session = await SessionHelpers.findByToken(sessionId);
    if (!session?.userId) throw new Meteor.Error('not-authorized', 'Invalid session');
    const currentUser = await UsersCollection.findOneAsync(session.userId);
    if (!currentUser || !ALLOWED_ROLES.includes(currentUser.role)) {
      throw new Meteor.Error('not-authorized', 'Birthday calendar is for staff only');
    }

    const isAdmin = ADMIN_ROLES.includes(currentUser.role);
    const rmIds = currentUser.role === USER_ROLES.ASSISTANT
      ? UserHelpers.getEffectiveRmIds(currentUser)
      : [currentUser._id];

    const { people, contactsInPerimeter } = await collectBirthdayPeople({
      rmIds: isAdmin ? null : rmIds,
      includeTeam: isAdmin
    });

    // The calendar never needs the RM linkage
    return {
      people: people.map(({ ownerRmIds, entityId, legacyUserId, ...person }) => person),
      contactsInPerimeter
    };
  }
});
