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

// Publish users for the Users section (role-based)
// Admins/Superadmins see all users, RMs see only their assigned clients
Meteor.publish("rmClients", async function (sessionId) {
  // Use the same session resolution pattern as other publications
  const effectiveSessionId = sessionId || this.connection?.httpHeaders?.['x-session-id'] || this.connection?.id;

  if (!effectiveSessionId) {
    console.log('[rmClients] No sessionId found');
    return this.ready();
  }

  // Find session and current user using SessionsCollection
  const session = await SessionsCollection.findOneAsync({ sessionId: effectiveSessionId, isActive: true });
  if (!session || !session.userId) {
    console.log('[rmClients] No active session found for sessionId:', effectiveSessionId);
    return this.ready();
  }

  const currentUser = await UsersCollection.findOneAsync(session.userId);
  if (!currentUser) {
    console.log('[rmClients] No user found for userId:', session.userId);
    return this.ready();
  }

  console.log('[rmClients] Current user role:', currentUser.role);

  // Check role and return appropriate users
  if (currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.ADMIN) {
    // Admins see all users (all roles) - don't filter by isActive since some users may not have this field
    const query = { isActive: { $ne: false } };
    console.log('[rmClients] Admin query:', JSON.stringify(query));
    return UsersCollection.find(
      query,
      {
        fields: {
          email: 1,
          firstName: 1,
          lastName: 1,
          profile: 1,
          role: 1,
          isActive: 1,
          relationshipManagerId: 1,
          createdAt: 1
        }
      }
    );
  } else if (currentUser.role === USER_ROLES.COMPLIANCE) {
    // Compliance sees all clients (but not admin users)
    const query = {
      role: USER_ROLES.CLIENT,
      isActive: { $ne: false }
    };
    console.log('[rmClients] Compliance query:', JSON.stringify(query));
    return UsersCollection.find(
      query,
      {
        fields: {
          email: 1,
          firstName: 1,
          lastName: 1,
          profile: 1,
          role: 1,
          isActive: 1,
          relationshipManagerId: 1,
          createdAt: 1
        }
      }
    );
  } else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
    // RMs see only their assigned clients
    return UsersCollection.find(
      {
        role: USER_ROLES.CLIENT,
        isActive: { $ne: false },
        relationshipManagerId: currentUser._id
      },
      {
        fields: {
          email: 1,
          firstName: 1,
          lastName: 1,
          profile: 1,
          role: 1,
          isActive: 1,
          relationshipManagerId: 1,
          createdAt: 1
        }
      }
    );
  }

  // Other roles don't see users
  console.log('[rmClients] User role not authorized:', currentUser.role);
  return this.ready();
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






