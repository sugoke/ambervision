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

  // Owner ids every firm-wide aggregate must skip: AUM, cash monitoring, alerts,
  // notifications, AUM history and consolidation. Every current caller is such an
  // aggregate — none of them is ever "scoped to the demo" — so demo is folded in here
  // rather than churning each call site. Kept under the historical name for those callers.
  async getArchivedOwnerIds() {
    return this.getExcludedOwnerIds();
  },

  // Resolve every identifier tied to a DEMO entity, in the same shape as
  // getArchivedExclusion(). Demo clients are fictional: they must never reach an AUM
  // figure, dashboard stat, alert or product holder list. They differ from archived
  // clients in one decisive way — a demo IS meant to be viewable when someone explicitly
  // selects it in the View As picker, which is the entire point of it existing. So its
  // exclusion is conditional (see hiddenHoldingsSelector), never blanket.
  async getDemoExclusion() {
    const demo = await ClientEntitiesCollection.find(
      { isDemo: true },
      { fields: { _id: 1, migratedFromUserId: 1 } }
    ).fetchAsync();

    const entityIds = demo.map(e => e._id);
    const userIds = demo.map(e => e.migratedFromUserId).filter(Boolean);

    let bankAccountIds = [];
    let accountKeys = [];
    if (entityIds.length > 0) {
      const { BankAccountsCollection } = await import('./bankAccounts');
      const accounts = await BankAccountsCollection.find(
        { entityId: { $in: entityIds } },
        { fields: { _id: 1, bankId: 1, accountNumber: 1 } }
      ).fetchAsync();
      bankAccountIds = accounts.map(a => a._id);
      // No live-account reassignment guard here (unlike archived): demo accounts are
      // synthetic and sit on a synthetic bank, so their (bankId, accountNumber) pair can
      // never be shared with a real client's account.
      accountKeys = accounts
        .filter(a => a.bankId && a.accountNumber)
        .map(a => ({ bankId: a.bankId, accountNumber: a.accountNumber }));
    }

    return { entityIds, userIds, bankAccountIds, accountKeys };
  },

  // True when the entity is the fictional demo client.
  isEntityDemo(entity) {
    return !!entity && entity.isDemo === true;
  },

  // Turn an exclusion descriptor into $nor clauses against PMSHoldings/PMSOperations.
  // Shared by the archived and demo paths so both stay in step.
  async _holdingsClausesFor({ entityIds, userIds, accountKeys }) {
    const clauses = [];
    if (entityIds.length > 0) clauses.push({ entityId: { $in: entityIds } });
    if (userIds.length > 0) clauses.push({ userId: { $in: userIds } });

    // Un-migrated holdings carry only (bankId + portfolioCode). Pre-resolve the actual
    // portfolioCodes to avoid $regex in the selector, which would break oplog tailing.
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
    return clauses;
  },

  /**
   * Holdings selector hiding everything the caller must not aggregate: archived clients
   * (always) and demo clients (unless the view is explicitly scoped to that demo entity).
   *
   * Returns a SINGLE merged `$nor`. Call sites assign it (`filter.$nor = sel.$nor`), so
   * handing back two separate selectors would silently clobber one of them.
   *
   * @param {Object}  [opts]
   * @param {string}  [opts.exceptEntityId] - entity the view is scoped to; when it is the
   *   demo entity, demo rows are let through so the demo portfolio actually renders.
   */
  async hiddenHoldingsSelector({ exceptEntityId = null } = {}) {
    const archived = await this.getArchivedExclusion();
    const demo = await this.getDemoExclusion();

    const clauses = await this._holdingsClausesFor(archived);

    // Drill-down into the demo client is the one context where its data belongs on screen.
    const viewingThisDemo = exceptEntityId && demo.entityIds.includes(exceptEntityId);
    if (!viewingThisDemo) {
      clauses.push(...await this._holdingsClausesFor(demo));
    }

    return clauses.length > 0 ? { $nor: clauses } : {};
  },

  /**
   * Allocations equivalent of hiddenHoldingsSelector. Allocations key on clientId
   * (legacy userId or entityId) and bankAccountId.
   */
  async hiddenAllocationsSelector({ exceptEntityId = null } = {}) {
    const archived = await this.getArchivedExclusion();
    const demo = await this.getDemoExclusion();

    const clauses = [];
    const addClauses = ({ entityIds, userIds, bankAccountIds }) => {
      const ownerIds = [...userIds, ...entityIds];
      if (ownerIds.length > 0) clauses.push({ clientId: { $in: ownerIds } });
      if (bankAccountIds.length > 0) clauses.push({ bankAccountId: { $in: bankAccountIds } });
    };

    addClauses(archived);

    const viewingThisDemo = exceptEntityId && demo.entityIds.includes(exceptEntityId);
    if (!viewingThisDemo) addClauses(demo);

    return clauses.length > 0 ? { $nor: clauses } : {};
  },

  /**
   * The entity a View As filter drills into, or null for a broad view.
   * `entity` filters name it directly; `account` filters name it through the account's
   * owner. `client` filters address a legacy user account, which a demo never is.
   *
   * Callers pass the result as `exceptEntityId` so a demo client stays visible in the one
   * view that is explicitly about it.
   */
  async resolveScopedEntityId(viewAsFilter) {
    if (!viewAsFilter || !viewAsFilter.id) return null;
    if (viewAsFilter.type === 'entity') return viewAsFilter.id;
    if (viewAsFilter.type === 'account') {
      const { BankAccountsCollection } = await import('./bankAccounts');
      const account = await BankAccountsCollection.findOneAsync(
        viewAsFilter.id,
        { fields: { entityId: 1 } }
      );
      return account?.entityId || null;
    }
    return null;
  },

  // Owner ids to strip from firm-wide aggregates (AUM, alerts, snapshots, consolidation).
  // Aggregates are never "scoped to the demo", so both sets always apply.
  async getExcludedOwnerIds() {
    const archived = await this.getArchivedExclusion();
    const demo = await this.getDemoExclusion();
    return {
      entityIds: [...archived.entityIds, ...demo.entityIds],
      userIds: [...archived.userIds, ...demo.userIds]
    };
  },

  // Mongo selector fragment that EXCLUDES holdings the caller must not see.
  // Returns {} when there is nothing to hide. Compose into a query with:
  //   collection.find({ $and: [ baseSelector, await hiddenHoldingsSelector() ] })
  // Uses $nor so holdings whose owner field is absent are kept (only owned rows drop).
  //
  // Kept under the historical name for the call sites that have no view scope to offer;
  // it now also hides demo clients, which is correct for every one of them. Paths that
  // resolve a view scope should call hiddenHoldingsSelector({ exceptEntityId }) directly.
  async archivedHoldingsSelector() {
    return this.hiddenHoldingsSelector();
  },

  // Allocations equivalent; see archivedHoldingsSelector for why the name is retained.
  async archivedAllocationsSelector() {
    return this.hiddenAllocationsSelector();
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

  // Computed lifecycle status — the single source of truth for the Prospect/Active
  // distinction. "Prospect" is derived, not stored: a prospect is an entity we have no
  // relationship with yet. Any of these ends that and makes it active:
  //   - hasAccounts          → holds a bank account itself (a direct client)
  //   - hasStakeholderRoles  → UBO/director/signatory/shareholder of another entity
  //   - isBeneficialOwner    → beneficial owner of a life-insurance contract held by
  //                            the insurer (e.g. Utmost). Not a direct client — the
  //                            account belongs to the insurer — but not a prospect
  //                            either, so this MUST be checked; ignoring it files real
  //                            beneficiaries under "Prospects".
  // Only "archived" is honoured from the stored status.
  // Both the contacts list and the entity detail header must use this so the badges
  // can never contradict each other.
  getComputedEntityStatus(entity, { hasAccounts = false, hasStakeholderRoles = false, isBeneficialOwner = false } = {}) {
    if (!entity) return ENTITY_STATUSES.ACTIVE;
    if (entity.status === ENTITY_STATUSES.ARCHIVED) return ENTITY_STATUSES.ARCHIVED;
    if (hasAccounts || hasStakeholderRoles || isBeneficialOwner) return ENTITY_STATUSES.ACTIVE;
    return ENTITY_STATUSES.PROSPECT;
  },

  // Beneficial owners of an account, tolerating the legacy singular field.
  getAccountBeneficialOwnerIds(account) {
    if (!account) return [];
    if (account.beneficialOwnerIds?.length) return account.beneficialOwnerIds.filter(Boolean);
    return account.beneficialOwnerId ? [account.beneficialOwnerId] : [];
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
