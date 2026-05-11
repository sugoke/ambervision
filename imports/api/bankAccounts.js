import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

// Bank Accounts collection
export const BankAccountsCollection = new Mongo.Collection('bankAccounts');

// Shared validators for authorized contact fields
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

// Bank account schema structure:
// {
//   entityId: String (reference to ClientEntitiesCollection - the account owner),
//   userId: String (DEPRECATED - reference to UsersCollection, kept for backward compat),
//   name: String (display name, defaults to entity name),
//   bankId: String (reference to BanksCollection),
//   accountNumber: String,
//   referenceCurrency: String (USD, EUR, GBP, CHF, etc.),
//   accountType: String (personal, company, life_insurance),
//   accountStructure: String (direct, life_insurance),
//   lifeInsuranceCompany: String (only if accountType is life_insurance),
//   authorizedOverdraft: Number (optional, credit line amount in reference currency),
//   comment: String (optional, user notes like "Investment Account", "Credit Card", etc.),
//   relationshipManagerId: String (optional, reference to UsersCollection - the RM managing this account),
//   beneficialOwnerIds: [String] (optional, references to ClientEntitiesCollection - UBOs for life insurance accounts),
//   introducerId: String (optional, reference to UsersCollection - the business introducer for this account),
//   authorizedEmail: String (optional, primary authorized email to send/receive orders for this account),
//   authorizedCcEmails: [String] (optional, CC list of authorized emails),
//   authorizedPhone: String (optional, authorized phone number in E.164 format, e.g. +33612345678),
//   isActive: Boolean,
//   createdAt: Date,
//   updatedAt: Date
// }

// Helper functions for bank account management
export const BankAccountHelpers = {
  // Get all bank accounts for a user (legacy - use getEntityBankAccounts for new code)
  getUserBankAccounts(userId) {
    check(userId, String);
    return BankAccountsCollection.find({ userId: userId, isActive: true }, { sort: { createdAt: -1 } });
  },

  // Get all bank accounts for a client entity
  getEntityBankAccounts(entityId) {
    check(entityId, String);
    return BankAccountsCollection.find({ entityId: entityId, isActive: true }, { sort: { createdAt: -1 } });
  },

  // Add a new bank account for a user
  async addBankAccount(userId, bankId, accountNumber, referenceCurrency, accountType = 'personal', accountStructure = 'direct', lifeInsuranceCompany = null, authorizedOverdraft = null, comment = null) {
    check(userId, String);
    check(bankId, String);
    check(accountNumber, String);
    check(referenceCurrency, String);
    check(accountType, String);
    check(accountStructure, String);

    // Check if account number already exists for this user
    const existingAccount = BankAccountsCollection.findOne({
      userId: userId,
      accountNumber: accountNumber,
      isActive: true
    });

    if (existingAccount) {
      throw new Error('Account number already exists for this user');
    }

    const accountData = {
      userId,
      bankId,
      accountNumber,
      referenceCurrency: referenceCurrency.toUpperCase(),
      accountType,
      accountStructure,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add life insurance company if account is through life insurance
    if (accountStructure === 'life_insurance' && lifeInsuranceCompany) {
      accountData.lifeInsuranceCompany = lifeInsuranceCompany;
    }

    // Add authorized overdraft (credit line) if provided
    if (authorizedOverdraft !== null && authorizedOverdraft > 0) {
      accountData.authorizedOverdraft = authorizedOverdraft;
    }

    // Add comment/description if provided
    if (comment && comment.trim()) {
      accountData.comment = comment.trim();
    }

    const bankAccountId = await BankAccountsCollection.insertAsync(accountData);

    return bankAccountId;
  },

  // Add a new bank account for a client entity
  async addEntityBankAccount(entityId, bankId, accountNumber, referenceCurrency, accountType = 'personal', accountStructure = 'direct', { name = null, lifeInsuranceCompany = null, relationshipManagerId = null, backupRmIds = null, beneficialOwnerIds = null, authorizedOverdraft = null, comment = null, authorizedEmail = null, authorizedCcEmails = null, authorizedPhone = null } = {}) {
    check(entityId, String);
    check(bankId, String);
    check(accountNumber, String);
    check(referenceCurrency, String);

    const existingAccount = await BankAccountsCollection.findOneAsync({
      entityId,
      accountNumber,
      isActive: true
    });

    if (existingAccount) {
      throw new Error('Account number already exists for this entity');
    }

    const accountData = {
      entityId,
      bankId,
      accountNumber,
      referenceCurrency: referenceCurrency.toUpperCase(),
      accountType,
      accountStructure,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    if (name) { accountData.name = name; }
    if (accountStructure === 'life_insurance' && lifeInsuranceCompany) {
      accountData.lifeInsuranceCompany = lifeInsuranceCompany;
    }
    if (relationshipManagerId) {
      accountData.relationshipManagerId = relationshipManagerId;
    }
    if (backupRmIds && backupRmIds.length > 0) {
      accountData.backupRmIds = backupRmIds;
    }
    if (beneficialOwnerIds && beneficialOwnerIds.length > 0) {
      accountData.beneficialOwnerIds = beneficialOwnerIds;
    }
    if (authorizedOverdraft !== null && authorizedOverdraft > 0) {
      accountData.authorizedOverdraft = authorizedOverdraft;
    }
    if (comment && comment.trim()) {
      accountData.comment = comment.trim();
    }

    if (authorizedEmail && authorizedEmail.trim()) {
      const email = authorizedEmail.trim();
      if (!EMAIL_REGEX.test(email)) {
        throw new Error(`Invalid authorizedEmail: ${email}`);
      }
      accountData.authorizedEmail = email;
    }
    if (Array.isArray(authorizedCcEmails) && authorizedCcEmails.length > 0) {
      const cleaned = authorizedCcEmails
        .map(e => (typeof e === 'string' ? e.trim() : ''))
        .filter(e => e.length > 0);
      for (const cc of cleaned) {
        if (!EMAIL_REGEX.test(cc)) {
          throw new Error(`Invalid authorizedCcEmails entry: ${cc}`);
        }
      }
      if (cleaned.length > 0) {
        accountData.authorizedCcEmails = cleaned;
      }
    }
    if (authorizedPhone && authorizedPhone.trim()) {
      const phone = authorizedPhone.trim();
      if (!E164_PHONE_REGEX.test(phone)) {
        throw new Error(`Invalid authorizedPhone (must be E.164, e.g. +33612345678): ${phone}`);
      }
      accountData.authorizedPhone = phone;
    }

    return await BankAccountsCollection.insertAsync(accountData);
  },

  // Update a bank account
  async updateBankAccount(accountId, updates) {
    check(accountId, String);
    check(updates, Object);

    const allowedFields = ['name', 'bankId', 'accountNumber', 'referenceCurrency', 'accountType', 'accountStructure', 'lifeInsuranceCompany', 'relationshipManagerId', 'backupRmIds', 'beneficialOwnerIds', 'authorizedOverdraft', 'comment', 'introducerId', 'authorizedEmail', 'authorizedCcEmails', 'authorizedPhone'];
    const filteredUpdates = {};

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    });

    if (filteredUpdates.referenceCurrency) {
      filteredUpdates.referenceCurrency = filteredUpdates.referenceCurrency.toUpperCase();
    }

    if (filteredUpdates.authorizedEmail !== undefined) {
      const email = typeof filteredUpdates.authorizedEmail === 'string'
        ? filteredUpdates.authorizedEmail.trim()
        : '';
      if (email && !EMAIL_REGEX.test(email)) {
        throw new Error(`Invalid authorizedEmail: ${email}`);
      }
      filteredUpdates.authorizedEmail = email;
    }
    if (filteredUpdates.authorizedCcEmails !== undefined) {
      const arr = Array.isArray(filteredUpdates.authorizedCcEmails)
        ? filteredUpdates.authorizedCcEmails
        : [];
      const cleaned = arr
        .map(e => (typeof e === 'string' ? e.trim() : ''))
        .filter(e => e.length > 0);
      for (const cc of cleaned) {
        if (!EMAIL_REGEX.test(cc)) {
          throw new Error(`Invalid authorizedCcEmails entry: ${cc}`);
        }
      }
      filteredUpdates.authorizedCcEmails = cleaned;
    }
    if (filteredUpdates.authorizedPhone !== undefined) {
      const phone = typeof filteredUpdates.authorizedPhone === 'string'
        ? filteredUpdates.authorizedPhone.trim()
        : '';
      if (phone && !E164_PHONE_REGEX.test(phone)) {
        throw new Error(`Invalid authorizedPhone (must be E.164, e.g. +33612345678): ${phone}`);
      }
      filteredUpdates.authorizedPhone = phone;
    }

    // Handle authorizedOverdraft - allow setting to 0 or null to remove it
    if (updates.authorizedOverdraft !== undefined) {
      if (updates.authorizedOverdraft === null || updates.authorizedOverdraft === 0 || updates.authorizedOverdraft === '') {
        // Remove the field if set to 0, null, or empty
        delete filteredUpdates.authorizedOverdraft;
        return await BankAccountsCollection.updateAsync(accountId, {
          $set: { ...filteredUpdates, updatedAt: new Date() },
          $unset: { authorizedOverdraft: '' }
        });
      }
    }

    filteredUpdates.updatedAt = new Date();

    return await BankAccountsCollection.updateAsync(accountId, {
      $set: filteredUpdates
    });
  },

  // Deactivate a bank account (soft delete)
  async deactivateBankAccount(accountId) {
    check(accountId, String);
    
    return await BankAccountsCollection.updateAsync(accountId, {
      $set: {
        isActive: false,
        updatedAt: new Date()
      }
    });
  },

  // Validate currency code
  isValidCurrency(currency) {
    const validCurrencies = [
      'USD', 'EUR', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK',
      'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK', 'RUB', 'TRY', 'ZAR', 'BRL',
      'MXN', 'INR', 'CNY', 'HKD', 'SGD', 'KRW', 'THB', 'MYR', 'IDR', 'PHP'
    ];
    return validCurrencies.includes(currency.toUpperCase());
  }
};