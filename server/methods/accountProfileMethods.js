import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import {
  AccountProfilesCollection,
  PROFILE_CATEGORIES,
  PROFILE_LIMIT_FIELDS,
  getProfileLimit
} from '../../imports/api/accountProfiles.js';
import { SessionsCollection, SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';

Meteor.methods({
  /**
   * Upsert (create or update) an account profile
   * @param {String} bankAccountId - The bank account ID
   * @param {Object} profile - The profile data (min/max for Cash, Bonds, Equities, Alternative)
   * @param {String} sessionId - The session ID for authorization
   */
  async 'accountProfiles.upsert'(bankAccountId, profile, sessionId) {
    check(bankAccountId, String);
    check(profile, {
      profileName: Match.Maybe(String),
      minCash: Match.Maybe(Match.Integer),
      maxCash: Match.Integer,
      minBonds: Match.Maybe(Match.Integer),
      maxBonds: Match.Integer,
      minEquities: Match.Maybe(Match.Integer),
      maxEquities: Match.Integer,
      minAlternative: Match.Maybe(Match.Integer),
      maxAlternative: Match.Integer,
      isProfessionalInvestor: Match.Maybe(Boolean)
    });
    check(sessionId, String);

    // Validate session
    const session = await SessionHelpers.findByToken(sessionId);

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

    // Authorization: Admin/Superadmin/Compliance can edit any, RM can edit assigned clients/entities
    let canEdit = currentUser.role === USER_ROLES.ADMIN ||
                    currentUser.role === USER_ROLES.SUPERADMIN ||
                    currentUser.role === USER_ROLES.COMPLIANCE;

    if (!canEdit && currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      // Check user-based assignment
      if (bankAccount.userId) {
        canEdit = !!(await UsersCollection.findOneAsync({
          _id: bankAccount.userId,
          relationshipManagerId: currentUser._id
        }));
      }
      // Check entity-based assignment
      if (!canEdit && bankAccount.entityId) {
        const { ClientEntitiesCollection } = require('../../imports/api/clientEntities.js');
        canEdit = !!(await ClientEntitiesCollection.findOneAsync({
          _id: bankAccount.entityId,
          relationshipManagerId: currentUser._id
        }));
      }
    }

    if (!canEdit) {
      throw new Meteor.Error('not-authorized', 'You do not have permission to edit this profile');
    }

    // Validate percentages are between 0 and 100
    for (const field of PROFILE_LIMIT_FIELDS) {
      const value = profile[field];
      if (value === undefined) continue;
      if (value < 0 || value > 100) {
        throw new Meteor.Error('invalid-value', `${field} must be between 0 and 100`);
      }
    }

    // Validate each category's minimum does not exceed its maximum
    for (const category of PROFILE_CATEGORIES) {
      const min = getProfileLimit(profile, `min${category.key}`);
      const max = getProfileLimit(profile, `max${category.key}`);
      if (min > max) {
        throw new Meteor.Error('invalid-range', `${category.label}: minimum (${min}%) cannot exceed maximum (${max}%)`);
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
    const session = await SessionHelpers.findByToken(sessionId);

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
                    currentUser.role === USER_ROLES.COMPLIANCE ||
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
