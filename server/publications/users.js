// Users Publications
// Handles all user-related publications with role-based access control

import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';

// Publish users for admin management (staff only).
// Previously this published every user's email/role/profile PII to ANY connected
// client with no auth. Now it requires a validated session with a staff role.
const STAFF_ROLES = [
  USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE,
  USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT
];
Meteor.publish("customUsers", async function (sessionId) {
  // SECURITY: string-only — a selector object ({$gt:""}) would otherwise match a live
  // (often staff) session and leak the whole user PII directory.
  if (typeof sessionId !== 'string' || sessionId.length === 0) return this.ready();

  const session = await SessionHelpers.findByToken(sessionId);
  if (!session || !session.userId) return this.ready();

  const currentUser = await UsersCollection.findOneAsync(session.userId);
  if (!currentUser || !STAFF_ROLES.includes(currentUser.role)) return this.ready();

  return UsersCollection.find({}, {
    fields: {
      email: 1,
      username: 1,
      role: 1,
      profile: 1,
      createdAt: 1,
      canValidateOrders: 1
    }
  });
});

// Publish users for the Users section (role-based)
// Admins/Superadmins see all users, RMs see only their assigned clients
Meteor.publish("rmClients", async function (sessionId) {
  // SECURITY: only accept a string sessionId; ignore a non-string (injection) arg and
  // fall back to connection-derived identifiers, which are always strings.
  const safeSessionId = (typeof sessionId === 'string' && sessionId.length > 0) ? sessionId : null;
  const effectiveSessionId = safeSessionId || this.connection?.httpHeaders?.['x-session-id'] || this.connection?.id;

  if (!effectiveSessionId || typeof effectiveSessionId !== 'string') {
    console.log('[rmClients] No sessionId found');
    return this.ready();
  }

  // Find session and current user using SessionsCollection
  const session = await SessionHelpers.findByToken(effectiveSessionId);
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
    // Compliance sees all users: clients, prospects, employees (staff/rm/compliance/admin), and introducers
    const query = { isActive: { $ne: false } };
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
  } else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT) {
    // RMs see their assigned clients, assistants see clients of all their assigned RMs
    const rmIds = currentUser.role === USER_ROLES.ASSISTANT
      ? (currentUser.assignedRmIds || [])
      : [currentUser._id];
    return UsersCollection.find(
      {
        role: USER_ROLES.CLIENT,
        isActive: { $ne: false },
        relationshipManagerId: { $in: rmIds }
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

  const session = await SessionHelpers.findByToken(sessionId);
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
      profile: 1,
      canValidateOrders: 1
    }
  });
});






