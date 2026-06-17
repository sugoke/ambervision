import { Mongo } from 'meteor/mongo';
import { Random } from 'meteor/random';
import { check, Match } from 'meteor/check';

// Client Entities collection
// Represents the actual account holders: physical persons, life insurance companies, corporations
// Separated from user accounts (login) to allow multiple users to view the same entity
export const ClientEntitiesCollection = new Mongo.Collection('clientEntities');

// Client entity schema structure:
// {
//   type: String (physical_person, company),
//   isInsurance: Boolean (true if this company is a life insurance company),
//   status: String (prospect, active, archived) - lifecycle status,
//   relationshipManagerId: String (DEPRECATED - use assignedUserIds),
//   assignedUserIds: [String] (array of RM/assistant userIds managing this entity),
//   referenceCurrency: String (USD, EUR, GBP, CHF, etc.),
//   profile: {
//     // physical_person:
//     firstName: String,
//     lastName: String,
//     birthday: Date,
//     birthPlace: String,
//     birthCountry: String,
//     nationalities: [String] (ordered, primary first),
//     familyMembers: [{ name: String, relationship: String, birthday: Date, _id: String }],
//     // company:
//     companyName: String,
//     registrationNumber: String,
//     incorporationDate: Date,
//     incorporationCountry: String,
//     // life_insurance:
//     companyName: String,
//     policyNumber: String,
//     // common:
//     preferredLanguage: String,
//     taxAddress: { street: String, postalCode: String, city: String, country: String },
//     secondaryAddress: { street: String, postalCode: String, city: String, country: String },
//     mobilePhone: String,
//     professionalPhone: String,
//     homePhone: String,
//     email: String,
//     createdAt: Date,
//     updatedAt: Date
//   },
//   kyc: {
//     isPep: Boolean|null (politically exposed person),
//     portfolioAmount: String (portfolio amount / initial contribution),
//     portfolioPotential: String ('500k_1m' | '1m_2m' | 'over_2m'),
//     wealthCategory: String ('modest' | 'affluent' | 'high' | 'hnwi' | 'uhnwi'),
//     wealthRealEstate: String,
//     wealthBankAssets: String,
//     wealthOther: String,
//     annualIncomeCategory: String ('modest' | 'average' | 'comfortable' | 'high' | 'very_high'),
//     otherBankAccounts: String
//   },
//   usPerson: {
//     isUsPerson: Boolean|null,
//     usCitizenship: Boolean|null,
//     usPermanentResidence: Boolean|null,
//     usBirthPlace: Boolean|null,
//     usAddress: Boolean|null,
//     usOtherTaxReason: Boolean|null
//   },
//   stakeholders: [{
//     _id: String,
//     role: String (beneficiary, director, ubo, signatory, shareholder),
//     name: String,
//     nationality: String,
//     ownershipPercentage: Number,
//     details: Object
//   }],
//   migratedFromUserId: String (original userId for rollback, null for new entities),
//   isActive: Boolean,
//   createdAt: Date,
//   updatedAt: Date
// }

// Entity lifecycle statuses
export const ENTITY_STATUSES = {
  PROSPECT: 'prospect',
  ACTIVE: 'active',
  ARCHIVED: 'archived'
};

// Entity types (life insurance companies are stored as 'company' with isInsurance flag)
export const ENTITY_TYPES = {
  PHYSICAL_PERSON: 'physical_person',
  COMPANY: 'company'
};

// Stakeholder roles
export const STAKEHOLDER_ROLES = {
  BENEFICIARY: 'beneficiary',
  DIRECTOR: 'director',
  UBO: 'ubo',
  SIGNATORY: 'signatory',
  SHAREHOLDER: 'shareholder'
};

// Helper functions for client entity management
export const ClientEntityHelpers = {
  // Resolve every identifier that ties data to an archived (closed) relationship:
  // the entity ids, their legacy migratedFromUserId, the bank accounts they own, and
  // the (bankId, accountNumber) keys of those accounts (to catch holdings that were
  // never stamped with entityId/userId). Read paths use this to hide the data of
  // clients we no longer work with. Archiving is soft — nothing is deleted, only filtered.
  async getArchivedExclusion() {
    const archived = await ClientEntitiesCollection.find(
      { status: ENTITY_STATUSES.ARCHIVED },
      { fields: { _id: 1, migratedFromUserId: 1 } }
    ).fetchAsync();

    const entityIds = archived.map(e => e._id);
    const userIds = archived.map(e => e.migratedFromUserId).filter(Boolean);

    let bankAccountIds = [];
    let accountKeys = [];
    if (entityIds.length > 0) {
      const { BankAccountsCollection } = await import('./bankAccounts');
      const accounts = await BankAccountsCollection.find(
        { entityId: { $in: entityIds } },
        { fields: { _id: 1, bankId: 1, accountNumber: 1 } }
      ).fetchAsync();
      bankAccountIds = accounts.map(a => a._id);
      let candidateKeys = accounts
        .filter(a => a.bankId && a.accountNumber)
        .map(a => ({ bankId: a.bankId, accountNumber: a.accountNumber }));

      // A single physical account (bankId + accountNumber) can be linked to BOTH an
      // archived wrapper and a live one — e.g. a life-insurance contract reassigned from
      // a closed entity to an active entity. The (bankId, accountNumber) holdings clause
      // in archivedHoldingsSelector matches on that pair alone, so it would hide the live
      // account's positions too. Drop any key that an active, non-archived bank account
      // also claims, so reassigned accounts stay visible.
      if (candidateKeys.length > 0) {
        const liveAccounts = await BankAccountsCollection.find(
          {
            $or: candidateKeys.map(k => ({ bankId: k.bankId, accountNumber: k.accountNumber })),
            entityId: { $nin: entityIds },
            isActive: true
          },
          { fields: { bankId: 1, accountNumber: 1 } }
        ).fetchAsync();
        const liveKeySet = new Set(liveAccounts.map(a => `${a.bankId}::${a.accountNumber}`));
        candidateKeys = candidateKeys.filter(k => !liveKeySet.has(`${k.bankId}::${k.accountNumber}`));
      }
      accountKeys = candidateKeys;
    }

    return { entityIds, userIds, bankAccountIds, accountKeys };
  },

  // Backwards-compatible shape for existing dashboard/cron AUM callers.
  async getArchivedOwnerIds() {
    const { entityIds, userIds } = await this.getArchivedExclusion();
    return { entityIds, userIds };
  },

  // Mongo selector fragment that EXCLUDES holdings belonging to archived clients.
  // Returns {} when nothing is archived. Compose into a query with:
  //   collection.find({ $and: [ baseSelector, await archivedHoldingsSelector() ] })
  // Uses $nor so holdings whose owner field is absent are kept (only archived-owned drop).
  async archivedHoldingsSelector() {
    const { entityIds, userIds, accountKeys } = await this.getArchivedExclusion();
    if (entityIds.length === 0 && userIds.length === 0) return {};

    const clauses = [];
    if (entityIds.length > 0) clauses.push({ entityId: { $in: entityIds } });
    if (userIds.length > 0) clauses.push({ userId: { $in: userIds } });

    // Un-migrated holdings carry only (bankId + portfolioCode). Pre-resolve the actual
    // portfolioCodes for each archived account to avoid $regex in the selector, which
    // would break oplog tailing (same approach as the inclusion logic in pmsHoldings).
    if (accountKeys.length > 0) {
      const { PMSHoldingsCollection } = await import('./pmsHoldings');
      for (const key of accountKeys) {
        const base = String(key.accountNumber).split('-')[0];
        const codes = await PMSHoldingsCollection.rawCollection().distinct('portfolioCode', {
          portfolioCode: { $regex: `^${base}` },
          bankId: key.bankId
        });
        if (codes.length > 0) clauses.push({ bankId: key.bankId, portfolioCode: { $in: codes } });
      }
    }

    return clauses.length > 0 ? { $nor: clauses } : {};
  },

  // Mongo selector fragment that EXCLUDES allocations belonging to archived clients.
  // Allocations key on clientId (legacy userId or entityId) and bankAccountId.
  async archivedAllocationsSelector() {
    const { entityIds, userIds, bankAccountIds } = await this.getArchivedExclusion();
    const ownerIds = [...userIds, ...entityIds];

    const clauses = [];
    if (ownerIds.length > 0) clauses.push({ clientId: { $in: ownerIds } });
    if (bankAccountIds.length > 0) clauses.push({ bankAccountId: { $in: bankAccountIds } });

    return clauses.length > 0 ? { $nor: clauses } : {};
  },

  // True when the entity is an archived (closed) relationship. Used to reject
  // explicit drill-down (viewAs) into an archived client.
  isEntityArchived(entity) {
    return !!entity && entity.status === ENTITY_STATUSES.ARCHIVED;
  },

  // Get display name based on entity type
  getEntityDisplayName(entity) {
    if (!entity) return 'Unknown';
    switch (entity.type) {
      case ENTITY_TYPES.PHYSICAL_PERSON:
        return `${entity.profile?.firstName || ''} ${entity.profile?.lastName || ''}`.trim() || 'Unnamed Person';
      case ENTITY_TYPES.COMPANY:
        return entity.profile?.companyName || 'Unnamed Company';
      case 'life_insurance': // Legacy — treated as company
        return entity.profile?.companyName || 'Unnamed Company';
      default:
        return 'Unknown Entity';
    }
  },

  // Get entity type label for display
  getEntityTypeLabel(type) {
    switch (type) {
      case ENTITY_TYPES.PHYSICAL_PERSON: return 'Person';
      case ENTITY_TYPES.COMPANY: return 'Company';
      case 'life_insurance': return 'Company';
      default: return 'Unknown';
    }
  },

  // Get entity status display info (label + color)
  getEntityStatusDisplay(status) {
    switch (status) {
      case ENTITY_STATUSES.PROSPECT: return { label: 'Prospect', color: '#f59e0b' };
      case ENTITY_STATUSES.ARCHIVED: return { label: 'Archived', color: '#6b7280' };
      case ENTITY_STATUSES.ACTIVE:
      default:
        return { label: 'Active', color: '#10b981' };
    }
  },

  // Get entity by ID
  async getEntityById(entityId) {
    check(entityId, String);
    return await ClientEntitiesCollection.findOneAsync(entityId);
  },

  // Get all entities managed by a specific user (RM or assistant)
  getEntitiesByRM(rmUserId) {
    check(rmUserId, String);
    return ClientEntitiesCollection.find({
      $or: [
        { assignedUserIds: rmUserId },
        { relationshipManagerId: rmUserId } // Legacy fallback
      ],
      isActive: true
    }, { sort: { 'profile.lastName': 1, 'profile.firstName': 1, 'profile.companyName': 1 } });
  },

  // Get all entities managed by multiple users (for assistants)
  getEntitiesByRMs(rmUserIds) {
    check(rmUserIds, [String]);
    return ClientEntitiesCollection.find({
      $or: [
        { assignedUserIds: { $in: rmUserIds } },
        { relationshipManagerId: { $in: rmUserIds } } // Legacy fallback
      ],
      isActive: true
    }, { sort: { 'profile.lastName': 1, 'profile.firstName': 1, 'profile.companyName': 1 } });
  },

  // Get all active entities
  getAllEntities() {
    return ClientEntitiesCollection.find({
      isActive: true
    }, { sort: { 'profile.lastName': 1, 'profile.firstName': 1, 'profile.companyName': 1 } });
  },

  // Create a new client entity
  async createEntity({ type, profile, relationshipManagerId, assignedUserIds, referenceCurrency, stakeholders = [], migratedFromUserId = null, status = ENTITY_STATUSES.ACTIVE }) {
    check(type, Match.OneOf(...Object.values(ENTITY_TYPES), 'life_insurance'));
    check(profile, Object);

    // Build assignedUserIds from either the new array or legacy single RM
    const effectiveAssignedUserIds = assignedUserIds || (relationshipManagerId ? [relationshipManagerId] : []);

    const entityData = {
      type,
      status: Object.values(ENTITY_STATUSES).includes(status) ? status : ENTITY_STATUSES.ACTIVE,
      profile: {
        ...profile,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      assignedUserIds: effectiveAssignedUserIds,
      relationshipManagerId: effectiveAssignedUserIds[0] || null, // Legacy compat
      referenceCurrency: referenceCurrency || 'EUR',
      stakeholders: stakeholders.map(s => ({
        ...s,
        _id: s._id || Random.id()
      })),
      migratedFromUserId,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    return await ClientEntitiesCollection.insertAsync(entityData);
  },

  // Update an entity
  async updateEntity(entityId, updates) {
    check(entityId, String);
    check(updates, Object);

    const allowedFields = ['profile', 'relationshipManagerId', 'assignedUserIds', 'referenceCurrency', 'stakeholders', 'type', 'status', 'isInsurance', 'kyc', 'usPerson', 'kycRiskScore', 'kycRiskScoreHistory'];
    const mergedObjectFields = ['profile', 'kyc', 'usPerson'];
    const setUpdates = { updatedAt: new Date() };

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        if (mergedObjectFields.includes(field)) {
          // Merge sub-fields rather than replacing the whole object
          for (const [key, value] of Object.entries(updates[field])) {
            setUpdates[`${field}.${key}`] = value;
          }
          if (field === 'profile') setUpdates['profile.updatedAt'] = new Date();
        } else {
          setUpdates[field] = updates[field];
        }
      }
    }

    return await ClientEntitiesCollection.updateAsync(entityId, { $set: setUpdates });
  },

  // Deactivate an entity (soft delete)
  async deactivateEntity(entityId) {
    check(entityId, String);
    return await ClientEntitiesCollection.updateAsync(entityId, {
      $set: { isActive: false, updatedAt: new Date() }
    });
  },

  // Find entity by migrated userId (for backward compatibility)
  async findByMigratedUserId(userId) {
    check(userId, String);
    return await ClientEntitiesCollection.findOneAsync({ migratedFromUserId: userId, isActive: true });
  }
};
