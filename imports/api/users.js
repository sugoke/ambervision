import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

// Custom Users collection for our simple auth system
export const UsersCollection = new Mongo.Collection('customUsers');

// User profile schema structure:
// {
//   username: String,
//   password: String (hashed),
//   role: String (superadmin/admin/compliance/rm/assistant/client),
//   relationshipManagerId: String (userId of the RM assigned to this client, only for CLIENT role),
//   assignedRmIds: [String] (array of RM userIds, only for ASSISTANT role),
//   profile: {
//     firstName: String,
//     lastName: String,
//     birthday: Date,
//     preferredLanguage: String (en, fr, de, es, it, etc.),
//     referenceCurrency: String (USD, EUR, GBP, CHF, ILS - client's preferred reporting currency),
//     familyMembers: Array of {
//       name: String,
//       relationship: String (spouse, child, parent, sibling, etc.),
//       birthday: Date,
//       _id: String (auto-generated)
//     },
//     createdAt: Date,
//     updatedAt: Date
//   }
// }

// User roles
export const USER_ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  COMPLIANCE: 'compliance',
  RELATIONSHIP_MANAGER: 'rm',
  ASSISTANT: 'assistant',
  CLIENT: 'client',
  PROSPECT: 'prospect',
  STAFF: 'staff',
  INTRODUCER: 'introducer',
  LIFE_INSURANCE: 'life_insurance'
};

// User type categories for filtering in the Clients section
export const USER_TYPE_CATEGORIES = {
  CLIENTS: 'clients',
  PROSPECTS: 'prospects',
  STAFF: 'staff',
  INTRODUCERS: 'introducers',
  LIFE_INSURANCE: 'life_insurance'
};

// Map roles to categories
export const getRoleCategory = (role) => {
  switch (role) {
    case USER_ROLES.CLIENT:
      return USER_TYPE_CATEGORIES.CLIENTS;
    case USER_ROLES.PROSPECT:
      return USER_TYPE_CATEGORIES.PROSPECTS;
    case USER_ROLES.SUPERADMIN:
    case USER_ROLES.ADMIN:
    case USER_ROLES.COMPLIANCE:
    case USER_ROLES.RELATIONSHIP_MANAGER:
    case USER_ROLES.ASSISTANT:
    case USER_ROLES.STAFF:
      return USER_TYPE_CATEGORIES.STAFF;
    case USER_ROLES.INTRODUCER:
      return USER_TYPE_CATEGORIES.INTRODUCERS;
    case USER_ROLES.LIFE_INSURANCE:
      return USER_TYPE_CATEGORIES.LIFE_INSURANCE;
    default:
      return USER_TYPE_CATEGORIES.CLIENTS;
  }
};

// Helper functions for role management
export const UserHelpers = {
  hasRole(userId, role) {
    const user = UsersCollection.findOne(userId);
    return user && user.role === role;
  },

  isSuperAdmin(userId) {
    return this.hasRole(userId, USER_ROLES.SUPERADMIN);
  },

  isAdmin(userId) {
    return this.hasRole(userId, USER_ROLES.ADMIN) || this.isSuperAdmin(userId);
  },

  isClient(userId) {
    return this.hasRole(userId, USER_ROLES.CLIENT);
  },

  isRelationshipManager(userId) {
    return this.hasRole(userId, USER_ROLES.RELATIONSHIP_MANAGER);
  },

  isAssistant(userId) {
    return this.hasRole(userId, USER_ROLES.ASSISTANT);
  },

  // Get the effective RM IDs for a user (for RM/superadmin: own ID, for assistant: their assigned RM IDs)
  getEffectiveRmIds(user) {
    if (user.role === USER_ROLES.RELATIONSHIP_MANAGER || user.role === USER_ROLES.SUPERADMIN) {
      return [user._id];
    }
    if (user.role === USER_ROLES.ASSISTANT) {
      return user.assignedRmIds || [];
    }
    return [];
  },

  isCompliance(userId) {
    return this.hasRole(userId, USER_ROLES.COMPLIANCE);
  },

  // Check if user can view all clients (admins, superadmins, and compliance)
  canViewAllClients(userId) {
    const user = UsersCollection.findOne(userId);
    if (!user) return false;
    return [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE].includes(user.role);
  },

  // Get all clients assigned to a specific relationship manager
  getClientsByRM(rmUserId) {
    return UsersCollection.find({
      role: USER_ROLES.CLIENT,
      relationshipManagerId: rmUserId
    });
  },

  // Assign a client to a relationship manager
  assignClientToRM(clientUserId, rmUserId) {
    check(clientUserId, String);
    check(rmUserId, String);
    
    // Verify the RM user exists and has the correct role
    const rmUser = UsersCollection.findOne({ _id: rmUserId, role: USER_ROLES.RELATIONSHIP_MANAGER });
    if (!rmUser) {
      throw new Meteor.Error('invalid-rm', 'Invalid relationship manager');
    }
    
    // Update the client
    return UsersCollection.update(
      { _id: clientUserId, role: USER_ROLES.CLIENT },
      { $set: { relationshipManagerId: rmUserId } }
    );
  },

  setUserRole(userId, role) {
    if (Object.values(USER_ROLES).includes(role)) {
      UsersCollection.update(userId, {
        $set: { role: role }
      });
    }
  },

  // Simple password hashing (for demo purposes - use proper hashing in production)
  hashPassword(password) {
    return btoa(password + 'salt123'); // Simple base64 encoding with salt
  },

  verifyPassword(password, hashedPassword) {
    return this.hashPassword(password) === hashedPassword;
  },

  // Check if user has order validation permission (four-eyes principle)
  canValidateOrders(userId) {
    const user = UsersCollection.findOne(userId);
    if (!user) return false;
    const staffRoles = [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT, USER_ROLES.COMPLIANCE, USER_ROLES.STAFF];
    return staffRoles.includes(user.role) && (user.canValidateOrders === true || user.role === USER_ROLES.COMPLIANCE);
  }
};