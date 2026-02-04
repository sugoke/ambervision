// Banks Publications
// Handles all bank and bank account related publications

import { Meteor } from 'meteor/meteor';
import { BanksCollection } from '/imports/api/banks';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { SessionsCollection } from '/imports/api/sessions';

// Publish banks for bank selection
Meteor.publish("banks", function () {
  return BanksCollection.find({ isActive: true }, { sort: { name: 1 } });
});

// Publish banks management (admin only)
Meteor.publish("banksManagement", function () {
  return BanksCollection.find({}, { sort: { name: 1 } });
});

// Publish user's bank accounts
// Supports viewAsFilter for admins and RMs to filter to specific clients
Meteor.publish("userBankAccounts", async function (sessionId, viewAsFilter = null) {
  const self = this;

  if (!sessionId) {
    return this.ready();
  }

  const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
  if (!session || !session.userId) {
    return this.ready();
  }

  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) {
    return this.ready();
  }

  const isAdmin = user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN;
  const isRM = user.role === USER_ROLES.RELATIONSHIP_MANAGER;
  const isClient = user.role === USER_ROLES.CLIENT;

  // Determine the query based on role and viewAsFilter
  let query = { isActive: true };

  if (viewAsFilter && (isAdmin || isRM)) {
    if (viewAsFilter.type === 'client') {
      if (isRM) {
        const targetClient = await UsersCollection.findOneAsync({
          _id: viewAsFilter.id,
          relationshipManagerId: user._id
        });
        if (!targetClient) {
          return this.ready();
        }
      }
      query.userId = viewAsFilter.id;
    } else if (viewAsFilter.type === 'account') {
      const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
      if (bankAccount) {
        if (isRM) {
          const targetClient = await UsersCollection.findOneAsync({
            _id: bankAccount.userId,
            relationshipManagerId: user._id
          });
          if (!targetClient) {
            return this.ready();
          }
        }
        query.userId = bankAccount.userId;
      }
    }
  } else if (viewAsFilter && isClient && viewAsFilter.type === 'account') {
    const bankAccount = await BankAccountsCollection.findOneAsync(viewAsFilter.id);
    if (bankAccount && bankAccount.userId === user._id) {
      query._id = viewAsFilter.id;
      query.userId = user._id;
    } else {
      query.userId = user._id;
    }
  } else if (isAdmin) {
    // Admin without filter sees all
  } else if (isRM) {
    const assignedClients = await UsersCollection.find({
      role: USER_ROLES.CLIENT,
      relationshipManagerId: user._id
    }, { fields: { _id: 1 } }).fetchAsync();
    const clientIds = assignedClients.map(c => c._id);
    query.userId = { $in: clientIds };
  } else {
    // Client sees only their own
    query.userId = user._id;
  }

  // Fetch documents and publish manually to ensure they arrive before ready()
  const accounts = await BankAccountsCollection.find(query).fetchAsync();

  // Add each document
  for (const account of accounts) {
    self.added('bankAccounts', account._id, account);
  }

  // Signal ready after all documents are added
  self.ready();

  // Set up reactive observer for changes
  const handle = BankAccountsCollection.find(query).observeChanges({
    added(id, fields) {
      // Skip if already added during initial fetch
      if (!accounts.find(a => a._id === id)) {
        self.added('bankAccounts', id, fields);
      }
    },
    changed(id, fields) {
      self.changed('bankAccounts', id, fields);
    },
    removed(id) {
      self.removed('bankAccounts', id);
    }
  });

  self.onStop(() => {
    handle.stop();
  });
});

// Publish bank accounts (for allocation selection)
Meteor.publish("bankAccounts", async function () {
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

  return BankAccountsCollection.find({ isActive: true });
});






