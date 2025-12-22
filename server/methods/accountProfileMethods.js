import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { AccountProfilesCollection } from '../../imports/api/accountProfiles.js';
import { SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';

Meteor.methods({
  /**
   * Upsert (create or update) an account profile
   * @param {String} bankAccountId - The bank account ID
   * @param {Object} profile - The profile data (maxCash, maxBonds, maxEquities, maxAlternative)
   * @param {String} sessionId - The session ID for authorization
   */
  async 'accountProfiles.upsert'(bankAccountId, profile, sessionId) {
    check(bankAccountId, String);
    check(profile, {
      maxCash: Match.Integer,
      maxBonds: Match.Integer,
      maxEquities: Match.Integer,
      maxAlternative: Match.Integer
    });
    check(sessionId, String);

    // Validate session
    const session = await SessionsCollection.findOneAsync({
      sessionId,
      isActive: true
    });

    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid session');
    }

    const currentUser = await UsersCollection.findOneAsync(session.userId);

    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }

    // Check if user can edit this account's profile
    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);

    if (!bankAccount) {
      throw new Meteor.Error('not-found', 'Bank account not found');
    }

    // Authorization: Admin/Superadmin can edit any, RM can edit assigned clients, clients can't edit
    const canEdit = currentUser.role === USER_ROLES.ADMIN ||
                    currentUser.role === USER_ROLES.SUPERADMIN ||
                    (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER &&
                     (await UsersCollection.findOneAsync({
                       _id: bankAccount.userId,
                       relationshipManagerId: currentUser._id
                     })));

    if (!canEdit) {
      throw new Meteor.Error('not-authorized', 'You do not have permission to edit this profile');
    }

    // Validate percentages are between 0 and 100
    for (const [key, value] of Object.entries(profile)) {
      if (value < 0 || value > 100) {
        throw new Meteor.Error('invalid-value', `${key} must be between 0 and 100`);
      }
    }

    // Upsert the profile
    const result = await AccountProfilesCollection.upsertAsync(
      { bankAccountId },
      {
        $set: {
          ...profile,
          lastUpdated: new Date(),
          updatedBy: currentUser._id
        },
        $setOnInsert: {
          bankAccountId,
          createdAt: new Date()
        }
      }
    );

    return result;
  },

  /**
   * Get account profile by bank account ID
   * @param {String} bankAccountId - The bank account ID
   * @param {String} sessionId - The session ID for authorization
   */
  async 'accountProfiles.getByAccount'(bankAccountId, sessionId) {
    check(bankAccountId, String);
    check(sessionId, String);

    // Validate session
    const session = await SessionsCollection.findOneAsync({
      sessionId,
      isActive: true
    });

    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid session');
    }

    const currentUser = await UsersCollection.findOneAsync(session.userId);

    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }

    // Get the bank account to check authorization
    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);

    if (!bankAccount) {
      return null;
    }

    // Authorization check
    const canView = currentUser.role === USER_ROLES.ADMIN ||
                    currentUser.role === USER_ROLES.SUPERADMIN ||
                    currentUser._id === bankAccount.userId ||
                    (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER &&
                     (await UsersCollection.findOneAsync({
                       _id: bankAccount.userId,
                       relationshipManagerId: currentUser._id
                     })));

    if (!canView) {
      throw new Meteor.Error('not-authorized', 'You do not have permission to view this profile');
    }

    return await AccountProfilesCollection.findOneAsync({ bankAccountId });
  }
});
