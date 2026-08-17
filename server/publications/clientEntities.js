// Client Entities Publications
// Handles publishing client entities based on role and access grants

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { UserEntityAccessCollection } from '/imports/api/userEntityAccess';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';

// Publish client entities based on role:
// - Superadmin/Admin/Compliance: all active entities
// - RM: entities where relationshipManagerId matches
// - Assistant: entities for their assigned RMs
// - Client/other: entities they have access to via userEntityAccess
//
// The fictional demo client is excluded from all of them: it must not turn up in
// Contacts, entity pickers or counts. It stays reachable through the View As search
// (a separate method, `viewAs.search`), which is the only way in by design.
const EXCLUDE_DEMO = { isDemo: { $ne: true } };

// GDPR data minimisation (Art. 5(1)(c)): the LIST publication no longer ships the
// high-sensitivity KYC block (PEP status, wealth categories, FATCA data, risk
// scoring) or family members to every staff browser. Those fields are available
// only for one entity at a time via 'clientEntities.details' (used by the entity
// detail screen).
const LIST_FIELDS = {
  fields: {
    kyc: 0,
    usPerson: 0,
    kycRiskScore: 0,
    kycRiskScoreHistory: 0,
    'profile.familyMembers': 0
  }
};

Meteor.publish('clientEntities', async function (sessionId) {
  if (!sessionId) return this.ready();

  try {
    check(sessionId, String);

    const session = await SessionHelpers.findByToken(sessionId);

    if (!session || !session.userId) return this.ready();

    const currentUser = await UsersCollection.findOneAsync(session.userId);
    if (!currentUser) return this.ready();

    const isAdmin = currentUser.role === USER_ROLES.ADMIN ||
                    currentUser.role === USER_ROLES.SUPERADMIN ||
                    currentUser.role === USER_ROLES.COMPLIANCE;
    const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER;
    const isAssistant = currentUser.role === USER_ROLES.ASSISTANT;

    if (isAdmin) {
      // Admins see all active entities
      return ClientEntitiesCollection.find({ isActive: true, ...EXCLUDE_DEMO }, LIST_FIELDS);
    }

    if (isRM) {
      // RMs see entities assigned to them (new array or legacy field)
      return ClientEntitiesCollection.find({
        $or: [
          { assignedUserIds: currentUser._id },
          { relationshipManagerId: currentUser._id }
        ],
        isActive: true,
        ...EXCLUDE_DEMO
      }, LIST_FIELDS);
    }

    if (isAssistant) {
      // Assistants see entities for their assigned RMs
      const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
      return ClientEntitiesCollection.find({
        $or: [
          { assignedUserIds: { $in: rmIds } },
          { relationshipManagerId: { $in: rmIds } }
        ],
        isActive: true,
        ...EXCLUDE_DEMO
      }, LIST_FIELDS);
    }

    // For all other roles (including client), use access grants
    const accessRecords = await UserEntityAccessCollection.find({
      userId: currentUser._id,
      isActive: true
    }).fetchAsync();

    const entityIds = accessRecords.map(r => r.entityId);
    if (entityIds.length === 0) return this.ready();

    return ClientEntitiesCollection.find({
      _id: { $in: entityIds },
      isActive: true,
      ...EXCLUDE_DEMO
    }, LIST_FIELDS);

  } catch (error) {
    console.error('[clientEntities publication] Error:', error.message);
    return this.ready();
  }
});

// Full document for a single entity — the only channel for the KYC block.
// Access rules mirror the list publication.
Meteor.publish('clientEntities.details', async function (sessionId, entityId) {
  if (!sessionId || !entityId) return this.ready();

  try {
    check(sessionId, String);
    check(entityId, String);

    const session = await SessionHelpers.findByToken(sessionId);
    if (!session || !session.userId) return this.ready();

    const currentUser = await UsersCollection.findOneAsync(session.userId);
    if (!currentUser) return this.ready();

    const isAdmin = currentUser.role === USER_ROLES.ADMIN ||
                    currentUser.role === USER_ROLES.SUPERADMIN ||
                    currentUser.role === USER_ROLES.COMPLIANCE;
    const isRM = currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER;
    const isAssistant = currentUser.role === USER_ROLES.ASSISTANT;

    if (isAdmin) {
      return ClientEntitiesCollection.find({ _id: entityId });
    }

    if (isRM) {
      return ClientEntitiesCollection.find({
        _id: entityId,
        $or: [
          { assignedUserIds: currentUser._id },
          { relationshipManagerId: currentUser._id }
        ]
      });
    }

    if (isAssistant) {
      const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
      return ClientEntitiesCollection.find({
        _id: entityId,
        $or: [
          { assignedUserIds: { $in: rmIds } },
          { relationshipManagerId: { $in: rmIds } }
        ]
      });
    }

    const access = await UserEntityAccessCollection.findOneAsync({
      userId: currentUser._id,
      entityId,
      isActive: true
    });
    if (!access) return this.ready();

    return ClientEntitiesCollection.find({ _id: entityId });
  } catch (error) {
    console.error('[clientEntities.details publication] Error:', error.message);
    return this.ready();
  }
});
