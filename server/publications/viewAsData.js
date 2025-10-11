// Publications for View As Filter
// Allows admins to see list of clients and bank accounts for filtering
console.log('🔍 Loading viewAsData.js publication file...');

import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';

// Publish list of all clients for admins to filter by
Meteor.publish('users.clients', async function(sessionId = null) {
  const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
  let currentUser = null;

  // Try to get user from session
  if (effectiveSessionId) {
    try {
      const session = await SessionHelpers.validateSession(effectiveSessionId);
      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);
      }
    } catch (error) {
      console.log('[VIEW AS] Session validation error:', error.message);
    }
  }

  // Only allow admins and superadmins to view client list
  if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
    console.log('[VIEW AS] Access denied - user is not admin/superadmin');
    return this.ready();
  }

  console.log('[VIEW AS] Publishing client list for admin:', currentUser.email);

  // Return all clients with basic info (excluding passwords)
  return UsersCollection.find(
    { role: USER_ROLES.CLIENT },
    {
      fields: {
        email: 1,
        username: 1,
        role: 1,
        profile: 1,
        relationshipManagerId: 1
      },
      sort: { 'profile.lastName': 1, 'profile.firstName': 1 }
    }
  );
});

// Publish list of all bank accounts for admins to filter by
Meteor.publish('bankAccounts.all', async function(sessionId = null) {
  const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
  let currentUser = null;

  // Try to get user from session
  if (effectiveSessionId) {
    try {
      const session = await SessionHelpers.validateSession(effectiveSessionId);
      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);
      }
    } catch (error) {
      console.log('[VIEW AS] Session validation error:', error.message);
    }
  }

  // Only allow admins and superadmins to view all bank accounts
  if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
    console.log('[VIEW AS] Access denied - user is not admin/superadmin');
    return this.ready();
  }

  console.log('[VIEW AS] Publishing bank accounts list for admin:', currentUser.email);

  // Return all active bank accounts
  return BankAccountsCollection.find(
    { isActive: true },
    { sort: { accountNumber: 1 } }
  );
});

// Publish list of all banks (needed to show bank names in the filter)
Meteor.publish('banks.all', async function(sessionId = null) {
  const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
  let currentUser = null;

  // Try to get user from session
  if (effectiveSessionId) {
    try {
      const session = await SessionHelpers.validateSession(effectiveSessionId);
      if (session && session.userId) {
        currentUser = await UsersCollection.findOneAsync(session.userId);
      }
    } catch (error) {
      console.log('[VIEW AS] Session validation error:', error.message);
    }
  }

  // Only allow authenticated users
  if (!currentUser) {
    console.log('[VIEW AS] Access denied - user not authenticated');
    return this.ready();
  }

  // Return all banks
  return BanksCollection.find({});
});

console.log('[VIEW AS] Publications registered successfully');
