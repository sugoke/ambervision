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
// GDPR data minimisation: only names, birthdays and family relationships are
// returned, never the rest of the contact record.

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { SessionHelpers } from '/imports/api/sessions';

const EXCLUDE_DEMO = { isDemo: { $ne: true } };
const ADMIN_ROLES = [USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN, USER_ROLES.COMPLIANCE];
const ALLOWED_ROLES = [...ADMIN_ROLES, USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT];

// Birthdays are stored as UTC midnight; keep the calendar date only
const toISODate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const fullName = (profile = {}) =>
  [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();

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
    const perimeter = isAdmin ? {} : {
      $or: [{ assignedUserIds: { $in: rmIds } }, { relationshipManagerId: { $in: rmIds } }]
    };

    // Contacts (individuals) in perimeter
    const entities = await ClientEntitiesCollection.find(
      { type: 'physical_person', isActive: true, ...EXCLUDE_DEMO, ...perimeter },
      { fields: { 'profile.firstName': 1, 'profile.lastName': 1, 'profile.birthday': 1, 'profile.familyMembers': 1 } }
    ).fetchAsync();
    const entityById = new Map(entities.map(e => [e._id, e]));

    // Legacy client logins in perimeter with a birthday
    const legacyClients = await UsersCollection.find(
      {
        role: USER_ROLES.CLIENT,
        'profile.birthday': { $exists: true, $ne: null },
        ...(isAdmin ? {} : { relationshipManagerId: { $in: rmIds } })
      },
      { fields: { username: 1, 'profile.firstName': 1, 'profile.lastName': 1, 'profile.birthday': 1, 'profile.familyMembers': 1 } }
    ).fetchAsync();
    const legacyLinks = legacyClients.length > 0 ? await ClientEntityHelpers.getLegacyUserEntityLinks() : new Map();
    const linkedEntityId = (userId) =>
      legacyLinks instanceof Map ? legacyLinks.get(userId) : legacyLinks?.[userId];

    const people = [];
    const addFamily = (ownerId, ownerName, familyMembers = []) => {
      familyMembers.forEach((member, i) => {
        const birthday = toISODate(member?.birthday);
        if (!birthday || !member.name) return;
        people.push({
          id: `${ownerId}-family-${member._id || i}`,
          name: member.name,
          kind: 'family',
          relationship: member.relationship || null,
          relatedTo: ownerName,
          birthday
        });
      });
    };

    // Birthday a legacy login can contribute to its contact when the contact has none
    const fallbackBirthdayByEntity = new Map();
    const unlinkedLegacy = [];
    legacyClients.forEach(user => {
      const entityId = linkedEntityId(user._id);
      if (entityId && entityById.has(entityId)) {
        if (!fallbackBirthdayByEntity.has(entityId)) fallbackBirthdayByEntity.set(entityId, user);
      } else if (!entityId) {
        unlinkedLegacy.push(user);
      }
      // Linked to a contact outside the perimeter: not shown
    });

    entities.forEach(entity => {
      const name = fullName(entity.profile);
      const legacy = fallbackBirthdayByEntity.get(entity._id);
      const birthday = toISODate(entity.profile?.birthday) || toISODate(legacy?.profile?.birthday);
      if (birthday && name) {
        people.push({ id: entity._id, name, kind: 'client', subtitle: 'Contact', birthday });
      }
      const family = entity.profile?.familyMembers?.length
        ? entity.profile.familyMembers
        : (legacy?.profile?.familyMembers || []);
      addFamily(entity._id, name, family);
    });

    unlinkedLegacy.forEach(user => {
      const name = fullName(user.profile) || user.username;
      const birthday = toISODate(user.profile?.birthday);
      if (birthday && name) {
        people.push({ id: user._id, name, kind: 'client', subtitle: user.username || 'Client account', birthday });
      }
      addFamily(user._id, name, user.profile?.familyMembers || []);
    });

    // Team members: admins only, as before
    if (isAdmin) {
      const team = await UsersCollection.find(
        { role: { $ne: USER_ROLES.CLIENT }, 'profile.birthday': { $exists: true, $ne: null } },
        { fields: { username: 1, role: 1, 'profile.firstName': 1, 'profile.lastName': 1, 'profile.birthday': 1 } }
      ).fetchAsync();
      team.forEach(user => {
        const name = fullName(user.profile) || user.username;
        const birthday = toISODate(user.profile?.birthday);
        if (birthday && name) {
          people.push({ id: user._id, name, kind: 'team', role: user.role, subtitle: user.username || '', birthday });
        }
      });
    }

    return {
      people,
      contactsInPerimeter: entities.length + unlinkedLegacy.length
    };
  }
});
