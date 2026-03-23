import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { AccountProfilesCollection } from '../../imports/api/accountProfiles.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES, UserHelpers } from '../../imports/api/users.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';

/**
 * Publish account profiles for authorized users
 * Each bank account can have its own investment profile (max allocations)
 */
Meteor.publish('accountProfiles', async function(sessionId, userId = null) {
  check(sessionId, String);
  check(userId, Match.Maybe(String));

  // Validate session
  if (!sessionId) {
    return this.ready();
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    return this.ready();
  }

  const currentUser = await UsersCollection.findOneAsync(session.userId);

  if (!currentUser) {
    return this.ready();
  }

  // Get bank account IDs to filter profiles
  let bankAccountIds = [];

  const isAdminOrCompliance = currentUser.role === USER_ROLES.ADMIN ||
                              currentUser.role === USER_ROLES.SUPERADMIN ||
                              currentUser.role === USER_ROLES.COMPLIANCE;

  // Admins/Superadmins/Compliance viewing a specific user
  if (userId && isAdminOrCompliance) {
    const accounts = await BankAccountsCollection.find({
      userId: userId,
      isActive: true
    }).fetchAsync();
    bankAccountIds = accounts.map(a => a._id);
  }
  // Admins/Superadmins/Compliance without filter - see all profiles
  else if (isAdminOrCompliance) {
    // Return all profiles
    return AccountProfilesCollection.find({});
  }
  // Relationship Managers - see profiles for assigned clients' accounts
  else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER || currentUser.role === USER_ROLES.ASSISTANT) {
    const rmIds = UserHelpers.getEffectiveRmIds(currentUser);
    const assignedClients = await UsersCollection.find({
      relationshipManagerId: { $in: rmIds }
    }).fetchAsync();

    const clientIds = assignedClients.map(c => c._id);

    if (clientIds.length > 0) {
      const accounts = await BankAccountsCollection.find({
        userId: { $in: clientIds },
        isActive: true
      }).fetchAsync();
      bankAccountIds = accounts.map(a => a._id);
    }
  }
  // Regular clients - see only their own account profiles
  else {
    const accounts = await BankAccountsCollection.find({
      userId: currentUser._id,
      isActive: true
    }).fetchAsync();
    bankAccountIds = accounts.map(a => a._id);
  }

  if (bankAccountIds.length === 0) {
    return this.ready();
  }

  return AccountProfilesCollection.find({
    bankAccountId: { $in: bankAccountIds }
  });
});
