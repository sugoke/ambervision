import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

// Custom Users collection for our simple auth system
export const UsersCollection = new Mongo.Collection('customUsers');

// User profile schema structure:
// {
//   username: String,
//   password: String (hashed),
//   role: String (superadmin/admin/rm/client),
//   relationshipManagerId: String (userId of the RM assigned to this client, only for CLIENT role),
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
  RELATIONSHIP_MANAGER: 'rm',
  CLIENT: 'client'
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
  }
};