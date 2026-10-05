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
        { fields: { _id: 1, bankId: 1, accountNumber: 1, userId: 1 } }
      ).fetchAsync();
      bankAccountIds = accounts.map(a => a._id);

      // Legacy owner ids stamped on the archived entities' accounts. An entity is not
      // always linked to its legacy user through migratedFromUserId; its accounts can
      // still carry that user's id, and the user's records (accounts, holdings) would
      // then bring the archived client back into every aggregate. Such a user is
      // archived too, unless it still owns an active account of a live entity (or of
      // no entity) or is the legacy user of a live entity.
      const candidateUserIds = [...new Set(accounts.map(a => a.userId).filter(id => id && !userIds.includes(id)))];
      if (candidateUserIds.length > 0) {
        const [liveAccounts, liveEntities] = await Promise.all([
          BankAccountsCollection.find(
            { userId: { $in: candidateUserIds }, isActive: true, $or: [{ entityId: { $exists: false } }, { entityId: null }, { entityId: { $nin: entityIds } }] },
            { fields: { userId: 1 } }
          ).fetchAsync(),
          ClientEntitiesCollection.find(
            { migratedFromUserId: { $in: candidateUserIds }, status: { $ne: ENTITY_STATUSES.ARCHIVED } },
            { fields: { migratedFromUserId: 1 } }
          ).fetchAsync()
        ]);
        const stillLive = new Set([...liveAccounts.map(a => a.userId), ...liveEntities.map(e => e.migratedFromUserId)]);
        userIds.push(...candidateUserIds.filter(id => !stillLive.has(id)));
      }
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

  // ---------------------------------------------------------------------------
  // Legacy user <-> entity identity resolution
  //
  // customUsers is login accounts only; client identity lives here. During the
  // entity migration most clients ended up with BOTH records, and only one
  // entity actually got its migratedFromUserId stamped - so anything listing
  // "clients" by merging the two collections shows the same person twice, often
  // under two spellings ("baloise" / "BALOISE", "Aurelia" / "Aurelia").
  //
  // A client is one client no matter how many bank accounts or ids they hold, so
  // resolution combines two independent signals and requires the name to agree:
  //
  //   1. An explicit link: entity.migratedFromUserId, or a bankAccounts row
  //      stamped with both entityId and userId by the migration.
  //   2. Name equality after normalisation (accents, case, punctuation and
  //      company legal suffixes folded away).
  //
  // Neither signal is sufficient alone. Account links are not proof of identity
  // - a beneficial owner and their company legitimately share an account, so
  // e.g. account 304435.002 carries entity DONBERG TRADING with the legacy user
  // of its owner, two clients that must stay separate. Names alone would merge
  // an RM's stray client-role record into a same-surname client. So a shared
  // account only merges when the names are compatible, and identical names merge
  // on their own.
  // ---------------------------------------------------------------------------

  // Case/accent/punctuation-insensitive form of a client name, with company
  // legal forms dropped so "DONBERG TRADING LTD" and "DONBERG TRADING LIMITED"
  // compare equal.
  normalizeClientName(name) {
    if (!name || typeof name !== 'string') return '';
    return name
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')                         // punctuation/hyphens -> space
      .replace(/\b(ltd|limited|sa|sarl|sas|scp|sca|ag|gmbh|inc|llc|plc|bv|nv|spa|srl|co|corp)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  // True when two client names plausibly denote the same client. Beyond exact
  // equality this tolerates the two ways the same client was typed twice in
  // practice: a token subset ("Buon TAN" vs "Buon Huong TAN", "UTMOST" vs
  // "UTMOST LUXEMBOURG") and a one-character typo in a token ("Iuliia" vs
  // "Iulia"). Only used to corroborate an explicit account link - on its own,
  // only exact normalised equality counts.
  clientNamesAreCompatible(nameA, nameB) {
    const a = this.normalizeClientName(nameA);
    const b = this.normalizeClientName(nameB);
    if (!a || !b) return false;
    if (a === b) return true;

    const tokensA = a.split(' ').filter(Boolean);
    const tokensB = b.split(' ').filter(Boolean);
    if (tokensA.length === 0 || tokensB.length === 0) return false;

    // Token subset: every token of the shorter name appears in the longer one,
    // allowing a one-character difference per token.
    const [short, long] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
    return short.every(t => long.some(l => t === l || this.tokensWithinOneEdit(t, l)));
  },

  // Levenshtein distance <= 1, short-circuited - enough for a dropped or
  // duplicated letter, not enough to conflate two different names.
  tokensWithinOneEdit(a, b) {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 1) return false;
    if (a.length < 3 || b.length < 3) return false;   // too short to judge safely
    const [s, l] = a.length <= b.length ? [a, b] : [b, a];
    let i = 0, j = 0, diffs = 0;
    while (i < s.length && j < l.length) {
      if (s[i] === l[j]) { i++; j++; continue; }
      if (++diffs > 1) return false;
      if (s.length === l.length) { i++; j++; } else { j++; }
    }
    return true;
  },

  // Map of legacy client userId -> canonical entityId, for every legacy user
  // that is really the same client as an entity. Used to collapse duplicate
  // client lists and to widen id-based queries.
  async getLegacyUserEntityLinks() {
    const { UsersCollection } = await import('./users');
    const { BankAccountsCollection } = await import('./bankAccounts');

    const entities = await ClientEntitiesCollection.find(
      { isActive: true },
      { fields: { _id: 1, type: 1, profile: 1, migratedFromUserId: 1 } }
    ).fetchAsync();
    if (entities.length === 0) return new Map();

    const legacyUsers = await UsersCollection.find(
      { role: 'client' },
      { fields: { _id: 1, username: 1, profile: 1 } }
    ).fetchAsync();
    if (legacyUsers.length === 0) return new Map();

    const userName = (u) => (
      `${u.profile?.firstName || ''} ${u.profile?.lastName || ''}`.trim()
      || u.profile?.companyName
      || u.username
      || ''
    );

    const links = new Map();
    const entityById = new Map(entities.map(e => [e._id, e]));

    // Signal 1a: the migration's own stamp.
    for (const e of entities) {
      if (e.migratedFromUserId) links.set(e.migratedFromUserId, e._id);
    }

    // Signal 2: identical names. An ambiguous name (the same normalised name on
    // two entities) is skipped rather than guessed at.
    const byName = new Map();
    for (const e of entities) {
      const key = this.normalizeClientName(this.getEntityDisplayName(e));
      if (!key) continue;
      if (byName.has(key)) byName.set(key, null);   // ambiguous - never match it
      else byName.set(key, e._id);
    }
    for (const u of legacyUsers) {
      if (links.has(u._id)) continue;
      const match = byName.get(this.normalizeClientName(userName(u)));
      if (match) links.set(u._id, match);
    }

    // Signal 1b: accounts the migration stamped with both ids, accepted only
    // when the two names agree (see the DONBERG example above).
    const stampedAccounts = await BankAccountsCollection.find(
      { userId: { $exists: true, $ne: null }, entityId: { $exists: true, $ne: null } },
      { fields: { userId: 1, entityId: 1 } }
    ).fetchAsync();
    const userById = new Map(legacyUsers.map(u => [u._id, u]));
    for (const acct of stampedAccounts) {
      if (links.has(acct.userId)) continue;
      const u = userById.get(acct.userId);
      const e = entityById.get(acct.entityId);
      if (!u || !e) continue;
      if (this.clientNamesAreCompatible(userName(u), this.getEntityDisplayName(e))) {
        links.set(u._id, e._id);
      }
    }

    return links;
  },

  // Every id a single client's records may be stored under: the canonical
  // entity id plus any legacy user id that resolves to it. Accepts either kind
  // of id and always includes what was passed in, so a caller can use the
  // result as a query set without special-casing unmigrated clients.
  async getLinkedClientIds(clientId) {
    if (!clientId || typeof clientId !== 'string') return [];

    const links = await this.getLegacyUserEntityLinks();
    const entityId = links.get(clientId) || clientId;

    const ids = new Set([clientId, entityId]);
    for (const [userId, linkedEntityId] of links) {
      if (linkedEntityId === entityId) ids.add(userId);
    }

    const entity = await ClientEntitiesCollection.findOneAsync(
      { _id: entityId },
      { fields: { migratedFromUserId: 1 } }
    );
    if (entity && entity.migratedFromUserId) ids.add(entity.migratedFromUserId);

    return [...ids];
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
