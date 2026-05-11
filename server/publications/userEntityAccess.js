// User Entity Access Publications
// Publishes access records based on role

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { UserEntityAccessCollection } from '/imports/api/userEntityAccess';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';

// Publish access records:
// - Superadmin/Admin: all active records (for managing access)
// - Others: only their own access records
Meteor.publish('userEntityAccess', async function (sessionId) {
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
                    currentUser.role === USER_ROLES.SUPERADMIN;

    if (isAdmin) {
      // Admins see all access records for management
      return UserEntityAccessCollection.find({ isActive: true });
    }

    // Others see only their own access records
    return UserEntityAccessCollection.find({
      userId: currentUser._id,
      isActive: true
    });

  } catch (error) {
    console.error('[userEntityAccess publication] Error:', error.message);
    return this.ready();
  }
});
