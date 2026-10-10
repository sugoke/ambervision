// Access-isolation fixtures.
//
// One deterministic firm: two RMs with disjoint books, an assistant, clients of
// every linkage flavour (grant, legacy userId, joint holder), a prefix-colliding
// account pair (504024 vs 5040241), a wrapper account reached through
// beneficialOwnerIds, a backup-RM account, an archived and a demo entity, and
// one login for every role that must see nothing. Everything is tagged with
// `__testRun` so teardown removes exactly what seed created.
import { Random } from 'meteor/random';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { ClientEntitiesCollection, ENTITY_STATUSES, ENTITY_TYPES } from '/imports/api/clientEntities';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UserEntityAccessCollection } from '/imports/api/userEntityAccess';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { PMSOperationsCollection } from '/imports/api/pmsOperations';
import { PortfolioSnapshotsCollection } from '/imports/api/portfolioSnapshots';
import { EquityHoldingsCollection } from '/imports/api/equityHoldings';
import { AllocationsCollection } from '/imports/api/allocations';
import { OrdersCollection } from '/imports/api/orders';
import { ProductsCollection } from '/imports/api/products';
import { ClientDocumentsCollection } from '/imports/api/clientDocuments';
import { BanksCollection } from '/imports/api/banks';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';

const TAG = '__testRun';

const COLLECTIONS = [
  UsersCollection, ClientEntitiesCollection, BankAccountsCollection, UserEntityAccessCollection,
  PMSHoldingsCollection, PMSOperationsCollection, PortfolioSnapshotsCollection, EquityHoldingsCollection,
  AllocationsCollection, OrdersCollection, ProductsCollection, ClientDocumentsCollection, BanksCollection,
  SessionsCollection
];

export const ACTOR_ROLES = {
  superadmin: USER_ROLES.SUPERADMIN,
  admin: USER_ROLES.ADMIN,
  compliance: USER_ROLES.COMPLIANCE,
  rmA: USER_ROLES.RELATIONSHIP_MANAGER,
  rmB: USER_ROLES.RELATIONSHIP_MANAGER,
  assistantA: USER_ROLES.ASSISTANT,
  clientA: USER_ROLES.CLIENT,
  clientB: USER_ROLES.CLIENT,
  clientJoint: USER_ROLES.CLIENT,
  introducer: USER_ROLES.INTRODUCER,
  staff: USER_ROLES.STAFF,
  lifeInsurance: USER_ROLES.LIFE_INSURANCE,
  prospect: USER_ROLES.PROSPECT
};

export const NO_ACCESS_ACTORS = ['introducer', 'staff', 'lifeInsurance', 'prospect'];
export const SEE_ALL_ACTORS = ['superadmin', 'admin', 'compliance'];

/**
 * Seed the fixture firm. Returns ids keyed by name plus session tokens.
 */
export async function seedAccessFixtures() {
  const runId = Random.id();
  const F = { runId, users: {}, entities: {}, accounts: {}, products: {}, tokens: {}, holdings: {}, orders: {}, allocations: {} };
  try {
    await seedInto(F);
  } catch (e) {
    // A half-seeded run must not pollute the next one
    await teardownAccessFixtures(F);
    throw e;
  }
  return F;
}

async function seedInto(F) {
  const { runId } = F;
  const tag = { [TAG]: runId };
  const now = new Date();

  const passwordHash = UserHelpers.hashPassword('Test1234x');

  // --- users ---------------------------------------------------------------
  const user = async (name, role, extra = {}) => {
    const _id = await UsersCollection.insertAsync({
      email: `${name}.${runId}@test.local`, username: `${name}_${runId}`, password: passwordHash,
      role, isActive: true, createdAt: now, ...extra, ...tag
    });
    F.users[name] = _id;
    return _id;
  };

  await user('superadmin', USER_ROLES.SUPERADMIN);
  await user('admin', USER_ROLES.ADMIN);
  await user('compliance', USER_ROLES.COMPLIANCE);
  const rmA = await user('rmA', USER_ROLES.RELATIONSHIP_MANAGER);
  const rmB = await user('rmB', USER_ROLES.RELATIONSHIP_MANAGER);
  await user('assistantA', USER_ROLES.ASSISTANT, { assignedRmIds: [rmA] });
  const clientA = await user('clientA', USER_ROLES.CLIENT);
  const clientB = await user('clientB', USER_ROLES.CLIENT, { relationshipManagerId: rmB }); // legacy link
  const clientJoint = await user('clientJoint', USER_ROLES.CLIENT);
  // The insurance wrapper's legacy login: stamped as userId on the wrapper
  // account, a different person from the beneficial owner (clientA)
  const wrapperLogin = await user('wrapperLogin', USER_ROLES.CLIENT);
  await user('introducer', USER_ROLES.INTRODUCER);
  await user('staff', USER_ROLES.STAFF);
  await user('lifeInsurance', USER_ROLES.LIFE_INSURANCE);
  await user('prospect', USER_ROLES.PROSPECT);

  // --- entities --------------------------------------------------------------
  const entity = async (name, extra = {}) => {
    const _id = await ClientEntitiesCollection.insertAsync({
      type: ENTITY_TYPES.PHYSICAL_PERSON,
      profile: { firstName: name, lastName: runId.slice(0, 6) },
      status: ENTITY_STATUSES.ACTIVE, isActive: true, createdAt: now, ...extra, ...tag
    });
    F.entities[name] = _id;
    return _id;
  };

  const entityA = await entity('entityA', { assignedUserIds: [rmA] });                 // canonical RM link
  const entityB = await entity('entityB', { relationshipManagerId: rmB, migratedFromUserId: clientB }); // legacy RM link
  const entityJoint = await entity('entityJoint', { assignedUserIds: [rmB] });         // co-holder with A, book of rmB
  const entityArchived = await entity('entityArchived', { assignedUserIds: [rmA], status: ENTITY_STATUSES.ARCHIVED });
  const entityDemo = await entity('entityDemo', { assignedUserIds: [rmA], isDemo: true });
  const entityWrapper = await entity('entityWrapper', { assignedUserIds: [rmB] });     // insurance wrapper for A, in B's book
  const entityWrapper2 = await entity('entityWrapper2', { assignedUserIds: [rmB] });   // sibling wrapper for B, same legacy login
  const entityBackup = await entity('entityBackup', { assignedUserIds: [rmB] });       // rmA is backup on its account

  // Access grants: clientA → entityA, clientJoint → entityJoint
  await UserEntityAccessCollection.insertAsync({ userId: clientA, entityId: entityA, accessLevel: 'full', isActive: true, grantedAt: now, ...tag });
  await UserEntityAccessCollection.insertAsync({ userId: clientJoint, entityId: entityJoint, accessLevel: 'full', isActive: true, grantedAt: now, ...tag });

  // --- bank + accounts -------------------------------------------------------
  const bankX = await BanksCollection.insertAsync({ name: `BankX ${runId}`, code: `BX${runId.slice(0, 4)}`, isActive: true, ...tag });
  F.bankX = bankX;

  const account = async (name, extra) => {
    const _id = await BankAccountsCollection.insertAsync({
      bankId: bankX, isActive: true, referenceCurrency: 'EUR', createdAt: now, ...extra, ...tag
    });
    F.accounts[name] = _id;
    return _id;
  };

  const acctA = await account('acctA', { accountNumber: '504024', entityId: entityA, holderEntityIds: [entityA], name: 'A main' });
  const acctAUsd = await account('acctAUsd', { accountNumber: '504024-USD', entityId: entityA, holderEntityIds: [entityA], name: 'A usd' });
  const acctB = await account('acctB', { accountNumber: '5040241', entityId: entityB, holderEntityIds: [entityB], userId: clientB, name: 'B prefix-collision', kycRiskScore: { total: 7 } });
  const acctJoint = await account('acctJoint', { accountNumber: '777001', entityId: entityA, holderEntityIds: [entityA, entityJoint], name: 'Joint A+J' });
  const acctWrapper = await account('acctWrapper', { accountNumber: '880001', entityId: entityWrapper, holderEntityIds: [entityWrapper], beneficialOwnerIds: [entityA], userId: wrapperLogin, name: 'Wrapper for A' });
  // Sibling wrapper: same legacy login, different beneficial owner. Reaching one
  // wrapper through beneficialOwnerIds must never pull in the other.
  const acctWrapper2 = await account('acctWrapper2', { accountNumber: '880002', entityId: entityWrapper2, holderEntityIds: [entityWrapper2], beneficialOwnerIds: [entityB], userId: wrapperLogin, name: 'Wrapper for B' });
  const acctBackup = await account('acctBackup', { accountNumber: '990001', entityId: entityBackup, holderEntityIds: [entityBackup], backupRmIds: [rmA], name: 'Backup rmA' });
  const acctArchived = await account('acctArchived', { accountNumber: '660001', entityId: entityArchived, holderEntityIds: [entityArchived], name: 'Archived' });
  const acctDemo = await account('acctDemo', { accountNumber: '550001', entityId: entityDemo, holderEntityIds: [entityDemo], name: 'Demo' });

  // --- products ---------------------------------------------------------------
  const product = async (name, isin) => {
    const _id = await ProductsCollection.insertAsync({ title: `${name} ${runId}`, isin, status: 'live', createdAt: now, ...tag });
    F.products[name] = _id;
    return _id;
  };
  const prodA = await product('prodA', `XS${runId.slice(0, 10).toUpperCase()}A`);
  const prodB = await product('prodB', `XS${runId.slice(0, 10).toUpperCase()}B`);
  const prodJoint = await product('prodJoint', `XS${runId.slice(0, 10).toUpperCase()}J`);
  const prodUnheld = await product('prodUnheld', `XS${runId.slice(0, 10).toUpperCase()}U`);

  // --- per-account data -------------------------------------------------------
  const accountRows = [
    { key: 'acctA', id: acctA, code: '504024', entityId: entityA, userId: null, product: prodA, owner: 'A' },
    { key: 'acctAUsd', id: acctAUsd, code: '504024-USD', entityId: entityA, userId: null, product: prodA, owner: 'A' },
    { key: 'acctB', id: acctB, code: '5040241', entityId: entityB, userId: clientB, product: prodB, owner: 'B' },
    { key: 'acctJoint', id: acctJoint, code: '777001', entityId: entityA, userId: null, product: prodJoint, owner: 'J' },
    { key: 'acctWrapper', id: acctWrapper, code: '880001', entityId: entityWrapper, userId: wrapperLogin, product: prodA, owner: 'W' },
    { key: 'acctWrapper2', id: acctWrapper2, code: '880002', entityId: entityWrapper2, userId: wrapperLogin, product: prodB, owner: 'V' },
    { key: 'acctBackup', id: acctBackup, code: '990001', entityId: entityBackup, userId: null, product: prodB, owner: 'K' },
    { key: 'acctArchived', id: acctArchived, code: '660001', entityId: entityArchived, userId: null, product: prodB, owner: 'X' },
    { key: 'acctDemo', id: acctDemo, code: '550001', entityId: entityDemo, userId: null, product: prodA, owner: 'D' }
  ];

  for (const [rowIndex, row] of accountRows.entries()) {
    const prod = await ProductsCollection.findOneAsync(row.product);
    // Distinct snapshotDate per account: portfolioSnapshots has a unique
    // (userId, portfolioCode, snapshotDate) index and the roll-ups share a code.
    const snapshotDate = new Date(now.getTime() - rowIndex * 1000);
    const base = { bankId: bankX, bankName: 'BankX', portfolioCode: row.code, snapshotDate, isLatest: true, isActive: true, ...tag };
    // Keyed by entityId (post-migration)
    const h1 = await PMSHoldingsCollection.insertAsync({
      ...base, entityId: row.entityId, uniqueKey: `${row.code}|${prod.isin}|${runId}`, isin: prod.isin,
      securityName: `${prod.title}`, quantity: 100, marketValue: 100000, currency: 'EUR', assetClass: 'structured'
    });
    // Keyed by (bankId, portfolioCode) only — un-migrated bank-file row
    const h2 = await PMSHoldingsCollection.insertAsync({
      ...base, uniqueKey: `${row.code}|CASH_EUR|${runId}`, securityName: 'Cash EUR', quantity: 1, marketValue: 5000,
      currency: 'EUR', assetClass: 'cash'
    });
    F.holdings[row.key] = [h1, h2];
    // Legacy-userId-only row where a legacy user exists
    if (row.userId) {
      F.holdings[row.key].push(await PMSHoldingsCollection.insertAsync({
        ...base, userId: row.userId, uniqueKey: `${row.code}|LEGACY|${runId}`, securityName: 'Legacy row',
        quantity: 10, marketValue: 1000, currency: 'EUR', assetClass: 'equity'
      }));
    }
    // CONSOLIDATED roll-up copy
    await PMSHoldingsCollection.insertAsync({
      ...base, entityId: row.entityId, portfolioCode: 'CONSOLIDATED', uniqueKey: `CONS|${row.code}|${runId}`,
      securityName: 'Consolidated', quantity: 100, marketValue: 100000, currency: 'EUR', assetClass: 'structured'
    });

    await PMSOperationsCollection.insertAsync({ ...base, entityId: row.entityId, uniqueKey: `op|${row.code}|buy|${runId}`, operationType: 'buy', amount: 1000, operationDate: now });
    await PMSOperationsCollection.insertAsync({ ...base, uniqueKey: `op|${row.code}|fee|${runId}`, operationType: 'fee', amount: -10, operationDate: now });

    await PortfolioSnapshotsCollection.insertAsync({ ...base, entityId: row.entityId, userId: row.userId || `legacy-${row.entityId}`, totalAccountValue: 105000, currency: 'EUR' });
    await PortfolioSnapshotsCollection.insertAsync({ ...base, entityId: row.entityId, userId: row.userId || `legacy-${row.entityId}`, portfolioCode: 'CONSOLIDATED', totalAccountValue: 105000, currency: 'EUR' });

    await EquityHoldingsCollection.insertAsync({ bankAccountId: row.id, userId: row.userId || undefined, isin: prod.isin, quantity: 10, ...tag });

    // Allocation keyed by entity id and one by bankAccountId only
    F.allocations[row.key] = [
      await AllocationsCollection.insertAsync({ productId: row.product, clientId: row.entityId, bankAccountId: row.id, nominal: 100000, createdAt: now, ...tag }),
      await AllocationsCollection.insertAsync({ productId: row.product, bankAccountId: row.id, nominal: 50000, createdAt: now, ...tag })
    ];
    if (row.userId) {
      F.allocations[row.key].push(await AllocationsCollection.insertAsync({ productId: row.product, clientId: row.userId, bankAccountId: row.id, nominal: 25000, createdAt: now, ...tag }));
    }

    F.orders[row.key] = await OrdersCollection.insertAsync({
      clientId: row.entityId, bankAccountId: row.id, bankId: bankX, accountNumber: row.code, status: 'executed',
      orderType: 'buy', isin: prod.isin, createdAt: now, createdBy: rmA, ...tag
    });

    await ClientDocumentsCollection.insertAsync({ userId: row.userId || row.entityId, bankAccountId: row.id, fileName: `doc-${row.code}.pdf`, uploadedAt: now, ...tag });
  }

  // Legacy order filed under clientB's user id
  F.orders.legacyB = await OrdersCollection.insertAsync({
    clientId: clientB, bankAccountId: acctB, bankId: bankX, accountNumber: '5040241', status: 'executed',
    orderType: 'buy', createdAt: now, createdBy: rmB, ...tag
  });

  // --- sessions ---------------------------------------------------------------
  for (const [name, id] of Object.entries(F.users)) {
    const s = await SessionHelpers.createSession(id, false, 'mocha', '127.0.0.1');
    await SessionsCollection.updateAsync({ sessionId: s.sessionId }, { $set: tag }).catch(() => {});
    // createSession stores the hash; tag the stored row by userId instead
    await SessionsCollection.updateAsync({ userId: id, userAgent: 'mocha' }, { $set: tag }, { multi: true });
    F.tokens[name] = s.sessionId;
  }

  // Convenience owner sets per client, for assertions
  F.owners = {
    A: { entityIds: [entityA], userIds: [clientA], accountIds: [acctA, acctAUsd, acctJoint, acctWrapper], codes: ['504024', '504024-USD', '777001', '880001'] },
    B: { entityIds: [entityB], userIds: [clientB], accountIds: [acctB], codes: ['5040241'] },
    J: { entityIds: [entityJoint], userIds: [clientJoint], accountIds: [acctJoint], codes: ['777001'] },
    W: { entityIds: [entityWrapper], userIds: [], accountIds: [acctWrapper], codes: ['880001'] },
    V: { entityIds: [entityWrapper2], userIds: [], accountIds: [acctWrapper2], codes: ['880002'] },
    K: { entityIds: [entityBackup], userIds: [], accountIds: [acctBackup], codes: ['990001'] },
    X: { entityIds: [entityArchived], userIds: [], accountIds: [acctArchived], codes: ['660001'] },
    D: { entityIds: [entityDemo], userIds: [], accountIds: [acctDemo], codes: ['550001'] }
  };
}

/** Remove everything a seed run created. */
export async function teardownAccessFixtures(F) {
  if (!F) return;
  for (const C of COLLECTIONS) {
    await C.removeAsync({ [TAG]: F.runId });
  }
}

/**
 * Which fixture owners a document belongs to, by every key it carries. A row
 * of the joint account belongs to both holders ('A' and 'J'); most rows have a
 * single owner. Returns an array of 'A','B','J','W','K','X','D' (empty when
 * unrecognised).
 */
export function ownersOf(F, doc) {
  const owners = F.owners;
  const found = new Set();
  const add = (pred) => { for (const k of Object.keys(owners)) if (pred(owners[k])) found.add(k); };

  if (doc.entityId) add(o => o.entityIds.includes(doc.entityId));
  if (doc.clientId) add(o => o.entityIds.includes(doc.clientId) || o.userIds.includes(doc.clientId));
  if (doc.bankAccountId) add(o => o.accountIds.includes(doc.bankAccountId));
  if (doc._id) add(o => o.accountIds.includes(doc._id));
  if (doc.portfolioCode && doc.portfolioCode !== 'CONSOLIDATED') add(o => o.codes.includes(doc.portfolioCode));
  if (doc.accountNumber) add(o => o.codes.includes(doc.accountNumber));
  if (doc.userId) add(o => o.userIds.includes(doc.userId));
  return [...found];
}

/** First owner, for messages. */
export function ownerOf(F, doc) {
  return ownersOf(F, doc)[0] || null;
}
