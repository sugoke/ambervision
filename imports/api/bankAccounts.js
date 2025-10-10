import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

// Bank Accounts collection
export const BankAccountsCollection = new Mongo.Collection('bankAccounts');

// Bank account schema structure:
// {
//   userId: String (reference to UsersCollection),
//   bankId: String (reference to BanksCollection),
//   accountNumber: String,
//   referenceCurrency: String (USD, EUR, GBP, CHF, etc.),
//   accountType: String (personal, company),
//   accountStructure: String (direct, life_insurance),
//   lifeInsuranceCompany: String (only if accountStructure is life_insurance),
//   isActive: Boolean,
//   createdAt: Date,
//   updatedAt: Date
// }

// Helper functions for bank account management
export const BankAccountHelpers = {
  // Get all bank accounts for a user
  getUserBankAccounts(userId) {
    check(userId, String);
    return BankAccountsCollection.find({ userId: userId, isActive: true }, { sort: { createdAt: -1 } });
  },

  // Add a new bank account for a user
  async addBankAccount(userId, bankId, accountNumber, referenceCurrency, accountType = 'personal', accountStructure = 'direct', lifeInsuranceCompany = null) {
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

    const bankAccountId = await BankAccountsCollection.insertAsync(accountData);

    return bankAccountId;
  },

  // Update a bank account
  async updateBankAccount(accountId, updates) {
    check(accountId, String);
    check(updates, Object);

    const allowedFields = ['bankId', 'accountNumber', 'referenceCurrency'];
    const filteredUpdates = {};
    
    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    });

    if (filteredUpdates.referenceCurrency) {
      filteredUpdates.referenceCurrency = filteredUpdates.referenceCurrency.toUpperCase();
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