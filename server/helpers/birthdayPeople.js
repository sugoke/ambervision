/**
 * The people whose birthdays the firm follows: contacts (individual client
 * entities), their family members, legacy client logins not yet folded into a
 * contact, and (for admins) the team.
 *
 * One collector for both consumers:
 *   - the Intranet birthday calendar (server/methods/birthdayMethods.js), which
 *     shows the caller's perimeter;
 *   - the daily birthday reminders (server/helpers/birthdayReminders.js), which
 *     notify the relationship managers a contact is linked to.
 *
 * Every person therefore carries `ownerRmIds`: the RMs of the contact they
 * belong to (assignedUserIds + the legacy relationshipManagerId), which is the
 * same linkage the Contacts list and the access scope use.
 *
 * GDPR data minimisation: only names, birthdays, family relationships and the
 * RM linkage are returned, never the rest of the contact record.
 */

import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';
import { UsersCollection, USER_ROLES } from '/imports/api/users';

const EXCLUDE_DEMO = { isDemo: { $ne: true } };

// Birthdays are stored as UTC midnight; keep the calendar date only
export const toISODate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const fullName = (profile = {}) =>
  [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim();

const rmIdsOfEntity = (entity) =>
  [...new Set([...(entity.assignedUserIds || []), entity.relationshipManagerId].filter(Boolean))];

/**
 * @param {Object}   options
 * @param {String[]} [options.rmIds]       restrict to contacts linked to these RMs (null = every contact)
 * @param {Boolean}  [options.includeTeam] add staff birthdays (admin calendar only)
 * @returns {{ people: Object[], contactsInPerimeter: Number }}
 *   person: { id, name, kind: 'client'|'family'|'team', birthday: 'YYYY-MM-DD',
 *             entityId, ownerRmIds, relationship?, relatedTo?, subtitle?, role? }
 */
export async function collectBirthdayPeople({ rmIds = null, includeTeam = false } = {}) {
  const perimeter = rmIds ? {
    $or: [{ assignedUserIds: { $in: rmIds } }, { relationshipManagerId: { $in: rmIds } }]
  } : {};

  // Contacts (individuals) in perimeter — archived and GDPR-restricted clients are
  // no longer followed (isActive is cleared in both cases)
  const entities = await ClientEntitiesCollection.find(
    { type: 'physical_person', isActive: true, ...EXCLUDE_DEMO, ...perimeter },
    { fields: {
      'profile.firstName': 1, 'profile.lastName': 1, 'profile.birthday': 1, 'profile.familyMembers': 1,
      assignedUserIds: 1, relationshipManagerId: 1
    } }
  ).fetchAsync();
  const entityById = new Map(entities.map(e => [e._id, e]));

  // Legacy client logins in perimeter with a birthday
  const legacyClients = await UsersCollection.find(
    {
      role: USER_ROLES.CLIENT,
      isActive: { $ne: false },
      'profile.birthday': { $exists: true, $ne: null },
      ...(rmIds ? { relationshipManagerId: { $in: rmIds } } : {})
    },
    { fields: { username: 1, relationshipManagerId: 1, 'profile.firstName': 1, 'profile.lastName': 1, 'profile.birthday': 1, 'profile.familyMembers': 1 } }
  ).fetchAsync();
  const legacyLinks = legacyClients.length > 0 ? await ClientEntityHelpers.getLegacyUserEntityLinks() : new Map();
  const linkedEntityId = (userId) =>
    legacyLinks instanceof Map ? legacyLinks.get(userId) : legacyLinks?.[userId];

  const people = [];
  const addFamily = (owner, ownerName, familyMembers = []) => {
    familyMembers.forEach((member, i) => {
      const birthday = toISODate(member?.birthday);
      if (!birthday || !member.name) return;
      people.push({
        id: `${owner.entityId || owner.legacyUserId}-family-${member._id || i}`,
        name: member.name,
        kind: 'family',
        relationship: member.relationship || null,
        relatedTo: ownerName,
        birthday,
        entityId: owner.entityId,
        ownerRmIds: owner.ownerRmIds
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
    const owner = { entityId: entity._id, ownerRmIds: rmIdsOfEntity(entity) };
    const birthday = toISODate(entity.profile?.birthday) || toISODate(legacy?.profile?.birthday);
    if (birthday && name) {
      people.push({ id: entity._id, name, kind: 'client', subtitle: 'Contact', birthday, ...owner });
    }
    const family = entity.profile?.familyMembers?.length
      ? entity.profile.familyMembers
      : (legacy?.profile?.familyMembers || []);
    addFamily(owner, name, family);
  });

  // A legacy login with no contact has no client file to open: entityId stays null
  unlinkedLegacy.forEach(user => {
    const name = fullName(user.profile) || user.username;
    const birthday = toISODate(user.profile?.birthday);
    const owner = { entityId: null, legacyUserId: user._id, ownerRmIds: [user.relationshipManagerId].filter(Boolean) };
    if (birthday && name) {
      people.push({ id: user._id, name, kind: 'client', subtitle: user.username || 'Client account', birthday, ...owner });
    }
    addFamily(owner, name, user.profile?.familyMembers || []);
  });

  if (includeTeam) {
    const team = await UsersCollection.find(
      { role: { $ne: USER_ROLES.CLIENT }, 'profile.birthday': { $exists: true, $ne: null } },
      { fields: { username: 1, role: 1, 'profile.firstName': 1, 'profile.lastName': 1, 'profile.birthday': 1 } }
    ).fetchAsync();
    team.forEach(user => {
      const name = fullName(user.profile) || user.username;
      const birthday = toISODate(user.profile?.birthday);
      if (birthday && name) {
        people.push({ id: user._id, name, kind: 'team', role: user.role, subtitle: user.username || '', birthday, entityId: null, ownerRmIds: [] });
      }
    });
  }

  return { people, contactsInPerimeter: entities.length + unlinkedLegacy.length };
}
