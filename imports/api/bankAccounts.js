import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

// Bank Accounts collection
export const BankAccountsCollection = new Mongo.Collection('bankAccounts');

// Shared validators for authorized contact fields
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

/**
 * Every email address authorized to give order instructions for an account.
 * Reads the canonical `authorizedEmails` list and falls back to the legacy
 * single address + CC pair for records not yet re-saved.
 */
export function getAuthorizedEmails(account) {
  const raw = Array.isArray(account?.authorizedEmails) && account.authorizedEmails.length > 0
    ? account.authorizedEmails
    : [account?.authorizedEmail, ...(Array.isArray(account?.authorizedCcEmails) ? account.authorizedCcEmails : [])];
  const seen = new Set();
  const out = [];
  for (const e of raw) {
    const v = typeof e === 'string' ? e.trim() : '';
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/**
 * Trim, drop blanks, de-duplicate (case-insensitive) and validate a list of
 * authorized emails coming from a client. Throws on the first invalid entry.
 */
function normalizeAuthorizedEmails(list) {
  const cleaned = getAuthorizedEmails({ authorizedEmails: (list || []).filter(e => typeof e === 'string') });
  for (const email of cleaned) {
    if (!EMAIL_REGEX.test(email)) {
      throw new Error(`Invalid authorized email: ${email}`);
    }
  }
  return cleaned;
}

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
//   holderEntityIds: [String] (optional, ALL client entities holding this account —
//     a joint account is held by several, e.g. a couple. entityId above is the
//     PRIMARY holder and is always included here. Absent/single-element means a
//     sole account. See the joint-account helpers below),
//   relationshipManagerId: String (optional, reference to UsersCollection - the RM managing this account),
//   beneficialOwnerIds: [String] (optional, references to ClientEntitiesCollection - UBOs for life insurance accounts),
//   introducerId: String (optional, reference to UsersCollection - the business introducer for this account),
//   authorizedEmails: [String] (optional, every email address allowed to give order
//     instructions for this account — the validator's sender check accepts any of them),
//   authorizedEmail: String (legacy mirror of authorizedEmails[0]; kept in sync on write),
//   authorizedCcEmails: [String] (legacy CC list, folded into authorizedEmails on the next save;
//     always read contacts through getAuthorizedEmails()),
//   authorizedPhone: String (optional, authorized phone number in E.164 format, e.g. +33612345678),
//   kycRiskScore: Object (optional, the KYC risk assessment for THIS banking relationship —
//     { assessmentDate, assessedBy, clientProspect/beneficialOwner/businessRelationship:
//       { criteria, totalScore, riskLevel }, comments, nextReviewDate }),
//   kycRiskScoreHistory: [Object] (optional, superseded assessments, oldest first),
//   isActive: Boolean,
//   createdAt: Date,
//   updatedAt: Date
// }
//
// Risk assessment is per bank account, not per client: each banking relationship
// has its own jurisdiction, product mix and review cycle, so a client banking in
// two places carries two assessments with two review dates.

// GDPR data minimisation (Art. 5(1)(c)), matching the clientEntities publications:
// the KYC risk assessment is not shipped by the broad account-list publications —
// that would put the whole firm's risk scoring in every staff browser. It comes
// one owner at a time via the 'bankAccounts.details' publication.
export const BANK_ACCOUNT_LIST_FIELDS = {
  fields: {
    kycRiskScore: 0,
    kycRiskScoreHistory: 0
  }
};

// ---------------------------------------------------------------------------
// Joint accounts
// ---------------------------------------------------------------------------
//
// A joint account is held by several client entities — typically a couple. It is
// ONE account at the bank, so it is ONE row here, with `holderEntityIds` listing
// every holder.
//
// `entityId` remains the PRIMARY holder and keeps its old meaning, so the many
// existing `{ entityId }` queries stay correct: they resolve the account to a
// real owner, just not necessarily the only one. Code that must see an account
// from ANY holder's point of view (is this entity a client? which accounts does
// this entity have?) uses `accountHolderSelector` / `isAccountHolder` below.
//
// This replaces an earlier workaround where a joint account was either one row
// per co-holder (duplicating the account, and stamping holdings with only one
// holder's id) or a single combined pseudo-entity such as "David & Bethany
// WARKENTIN" — which put a person who does not exist in the client list.

/** Every entity id holding this account, primary first. */
export function getAccountHolderIds(account) {
  if (!account) return [];
  const ids = Array.isArray(account.holderEntityIds) ? [...account.holderEntityIds] : [];
  // entityId is the primary holder and is always part of the set, even if an
  // older row predates holderEntityIds or omitted it.
  if (account.entityId && !ids.includes(account.entityId)) ids.unshift(account.entityId);
  return ids;
}

/** Is `ownerId` (entity id, or a legacy user id) a holder of this account? */
export function isAccountHolder(account, ownerId) {
  if (!account || !ownerId) return false;
  if (account.userId === ownerId) return true;
  return getAccountHolderIds(account).includes(ownerId);
}

/**
 * Mongo selector matching accounts held by any of `ownerIds` — as primary
 * holder, co-holder, or under a legacy userId. Use this wherever "the accounts
 * belonging to this client" is the question; a bare `{ entityId }` silently
 * drops the other holders of a joint account.
 */
export function accountHolderSelector(ownerIds) {
  const ids = Array.isArray(ownerIds) ? ownerIds.filter(Boolean) : [ownerIds].filter(Boolean);
  if (ids.length === 0) return { _id: null };
  return {
    $or: [
      { entityId: { $in: ids } },
      { holderEntityIds: { $in: ids } },
      { userId: { $in: ids } }
    ]
  };
}

/** True when the account has more than one holder. */
export function isJointAccount(account) {
  return getAccountHolderIds(account).length > 1;
}

/**
 * Display name for a set of holders: "WARKENTIN David & Bethany" when they share
 * a surname, otherwise "David WARKENTIN & Bethany SMITH". `holders` are entity
 * documents; callers resolve the ids first.
 */
export function buildJointAccountName(holders) {
  const people = (holders || []).filter(Boolean);
  if (people.length === 0) return '';

  const nameOf = (e) => {
    const p = e.profile || {};
    if (p.companyName) return p.companyName;
    return `${p.lastName || ''} ${p.firstName || ''}`.trim();
  };

  if (people.length === 1) return nameOf(people[0]);

  const surnames = people.map(e => (e.profile?.lastName || '').trim().toUpperCase());
  const allPersons = people.every(e => !e.profile?.companyName);
  const sharedSurname = allPersons && surnames[0] && surnames.every(s => s === surnames[0]);

  if (sharedSurname) {
    // "WARKENTIN David & Bethany" — the couple reads as one household
    const firstNames = people.map(e => (e.profile?.firstName || '').trim()).filter(Boolean);
    return `${people[0].profile.lastName} ${firstNames.join(' & ')}`.trim();
  }

  return people.map(nameOf).filter(Boolean).join(' & ');
}

// Helper functions for bank account management
export const BankAccountHelpers = {
  // Get all bank accounts for a user (legacy - use getEntityBankAccounts for new code)
  getUserBankAccounts(userId) {
    check(userId, String);
    return BankAccountsCollection.find({ userId: userId, isActive: true }, { sort: { createdAt: -1 } });
  },

  // Get all bank accounts for a client entity, including joint accounts where
  // the entity is a co-holder rather than the primary holder.
  getEntityBankAccounts(entityId) {
    check(entityId, String);
    return BankAccountsCollection.find(
      { ...accountHolderSelector([entityId]), isActive: true },
      { sort: { createdAt: -1 } }
    );
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
  async addEntityBankAccount(entityId, bankId, accountNumber, referenceCurrency, accountType = 'personal', accountStructure = 'direct', { name = null, lifeInsuranceCompany = null, relationshipManagerId = null, backupRmIds = null, beneficialOwnerIds = null, authorizedOverdraft = null, comment = null, authorizedEmails = null, authorizedEmail = null, authorizedCcEmails = null, authorizedPhone = null } = {}) {
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

    // Authorized emails: the list is canonical; legacy callers may still pass the
    // single address / CC pair, which is folded into it.
    const emails = normalizeAuthorizedEmails([
      ...(Array.isArray(authorizedEmails) ? authorizedEmails : []),
      authorizedEmail,
      ...(Array.isArray(authorizedCcEmails) ? authorizedCcEmails : [])
    ]);
    if (emails.length > 0) {
      accountData.authorizedEmails = emails;
      accountData.authorizedEmail = emails[0];
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

    const allowedFields = ['name', 'bankId', 'accountNumber', 'referenceCurrency', 'accountType', 'accountStructure', 'lifeInsuranceCompany', 'relationshipManagerId', 'backupRmIds', 'beneficialOwnerIds', 'authorizedOverdraft', 'comment', 'introducerId', 'authorizedEmails', 'authorizedEmail', 'authorizedCcEmails', 'authorizedPhone', 'holderEntityIds'];
    const filteredUpdates = {};

    allowedFields.forEach(field => {
      if (updates[field] !== undefined) {
        filteredUpdates[field] = updates[field];
      }
    });

    // The primary holder is always part of the holder set — otherwise an account
    // edited to add a co-holder could drop its own owner out of the list.
    if (filteredUpdates.holderEntityIds !== undefined) {
      const account = await BankAccountsCollection.findOneAsync(accountId);
      const ids = Array.isArray(filteredUpdates.holderEntityIds)
        ? filteredUpdates.holderEntityIds.filter(id => typeof id === 'string' && id)
        : [];
      const primary = filteredUpdates.entityId || account?.entityId;
      if (primary && !ids.includes(primary)) ids.unshift(primary);
      filteredUpdates.holderEntityIds = [...new Set(ids)];
    }

    if (filteredUpdates.referenceCurrency) {
      filteredUpdates.referenceCurrency = filteredUpdates.referenceCurrency.toUpperCase();
    }

    // Authorized emails: any of the three fields on the payload rewrites the
    // canonical list; the legacy mirror follows and the old CC list is dropped.
    let unsetFields = null;
    if (filteredUpdates.authorizedEmails !== undefined
        || filteredUpdates.authorizedEmail !== undefined
        || filteredUpdates.authorizedCcEmails !== undefined) {
      const emails = normalizeAuthorizedEmails([
        ...(Array.isArray(filteredUpdates.authorizedEmails) ? filteredUpdates.authorizedEmails : []),
        filteredUpdates.authorizedEmail,
        ...(Array.isArray(filteredUpdates.authorizedCcEmails) ? filteredUpdates.authorizedCcEmails : [])
      ]);
      filteredUpdates.authorizedEmails = emails;
      filteredUpdates.authorizedEmail = emails[0] || '';
      delete filteredUpdates.authorizedCcEmails;
      unsetFields = { authorizedCcEmails: '' };
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
          $unset: { authorizedOverdraft: '', ...(unsetFields || {}) }
        });
      }
    }

    filteredUpdates.updatedAt = new Date();

    const modifier = { $set: filteredUpdates };
    if (unsetFields) modifier.$unset = unsetFields;
    return await BankAccountsCollection.updateAsync(accountId, modifier);
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