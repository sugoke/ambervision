// Users Publications
// Handles all user-related publications with role-based access control

import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';

// Publish users for admin management
Meteor.publish("customUsers", function () {
  // For now, publish all users (in production, add proper access control)
  return UsersCollection.find({}, {
    fields: {
      email: 1,
      username: 1,
      role: 1,
      profile: 1,
      createdAt: 1
    }
  });
});

// Publish users (for allocation selection)
Meteor.publish("users", async function () {
  // Get session from connection
  const sessionId = this.connection?.id;
  if (!sessionId) {
    return this.ready();
  }

  const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
  if (!session || !session.userId) {
    return this.ready();
  }

  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
    return this.ready();
  }

  return UsersCollection.find({}, {
    fields: {
      email: 1,
      username: 1,
      role: 1,
      profile: 1
    }
  });
});






