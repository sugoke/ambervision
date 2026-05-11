// Client Entities Publications
// Handles publishing client entities based on role and access grants

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { ClientEntitiesCollection } from '/imports/api/clientEntities';
import { UserEntityAccessCollection } from '/imports/api/userEntityAccess';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';

// Publish client entities based on role:
// - Superadmin/Admin/Compliance: all active entities
// - RM: entities where relationshipManagerId matches
// - Assistant: entities for their assigned RMs
// - Client/other: entities they have access to via userEntityAccess
Meteor.publish('clientEntities', async function (sessionId) {
  if (!sessionId) return this.ready();

  try {
    check(sessionId, String);

    const session = await SessionsCollection.findOneAsync({
      sessionId,
      isActive: true,
      expiresAt: { $gt: new Date() }
    });

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
      return ClientEntitiesCollection.find({ isActive: true });
    }

    if (isRM) {
      // RMs see entities assigned to them (new array or legacy field)
      return ClientEntitiesCollection.find({
        $or: [
          { assignedUserIds: currentUser._id },
          { relationshipManagerId: currentUser._id }
        ],
        isActive: true
      });
    }

    if (isAssistant) {
      // Assistants see entities for their assigned RMs
      const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
      return ClientEntitiesCollection.find({
        $or: [
          { assignedUserIds: { $in: rmIds } },
          { relationshipManagerId: { $in: rmIds } }
        ],
        isActive: true
      });
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
      isActive: true
    });

  } catch (error) {
    console.error('[clientEntities publication] Error:', error.message);
    return this.ready();
  }
});
