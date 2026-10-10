import assert from 'assert';
import { Match } from 'meteor/check';
import { parseViewAs, parseViewAsOrNull } from '/imports/utils/viewAs';
import { portfolioCodeRegex, portfolioCodeRegexForBases, portfolioCodeMatches, accountBase } from '/imports/utils/portfolioCode';
import { resolveScope, holdingsSelector, allocationsSelector, isClientInScope, isPortfolioCodeInScope, accountBelongsToClient } from '/server/helpers/accessScope.js';
import { PMSHoldingsCollection } from '/imports/api/pmsHoldings';
import { AllocationsCollection } from '/imports/api/allocations';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { UsersCollection } from '/imports/api/users';
import { seedAccessFixtures, teardownAccessFixtures, NO_ACCESS_ACTORS } from '../helpers/fixtures.js';
import { assertOnlyOwners, assertHasOwners, assertHasCode, assertNoCode, setEq } from '../helpers/assertScope.js';

describe('access: viewAs parsing', function () {
  it('accepts a UI filter with extra keys and strips them', function () {
    assert.deepStrictEqual(parseViewAs({ type: 'entity', id: 'abc', label: 'X', data: { a: 1 } }), { type: 'entity', id: 'abc' });
  });
  it('returns null for null/undefined', function () {
    assert.strictEqual(parseViewAs(null), null);
    assert.strictEqual(parseViewAs(undefined), null);
  });
  it('rejects operator injection in id', function () {
    assert.throws(() => parseViewAs({ type: 'client', id: { $ne: null } }), Match.Error);
    assert.throws(() => parseViewAs({ type: 'entity', id: { $gt: '' } }), Match.Error);
  });
  it('rejects unknown type, missing id, non-object', function () {
    assert.throws(() => parseViewAs({ type: 'bogus', id: 'x' }), Match.Error);
    assert.throws(() => parseViewAs({ type: 'entity' }), Match.Error);
    assert.throws(() => parseViewAs({ type: 'entity', id: '' }), Match.Error);
    assert.throws(() => parseViewAs('entity'), Match.Error);
    assert.throws(() => parseViewAs(['entity', 'x']), Match.Error);
    assert.strictEqual(parseViewAsOrNull({ type: 'bogus', id: 'x' }), null);
  });
});

describe('access: portfolio code regex', function () {
  it('matches the base and its sub-accounts only', function () {
    const re = portfolioCodeRegex('504024');
    assert.ok(re.test('504024'));
    assert.ok(re.test('504024-USD'));
    assert.ok(!re.test('5040241'));
    assert.ok(!re.test('15040240'));
    assert.ok(portfolioCodeMatches('504024-CHF', '504024-USD'), 'sub-account base resolves to the account');
    assert.strictEqual(accountBase('504024-USD'), '504024');
  });
  it('escapes regex metacharacters', function () {
    const re = portfolioCodeRegex('12.34+5');
    assert.ok(re.test('12.34+5'));
    assert.ok(!re.test('12X34+5'));
  });
  it('builds a multi-base regex', function () {
    const re = portfolioCodeRegexForBases(['504024', '777001-EUR']);
    assert.ok(re.test('777001'));
    assert.ok(re.test('504024-USD'));
    assert.ok(!re.test('5040241'));
    assert.strictEqual(portfolioCodeRegexForBases([]), null);
  });
});

describe('access: resolveScope', function () {
  this.timeout(60000);
  let F;
  before(async function () { F = await seedAccessFixtures(); });
  after(async function () { await teardownAccessFixtures(F); });

  const userOf = (name) => UsersCollection.findOneAsync(F.users[name]);

  it('admin without filter is see-all; compliance equals admin', async function () {
    for (const name of ['superadmin', 'admin', 'compliance']) {
      const s = await resolveScope(await userOf(name));
      assert.strictEqual(s.isAdmin, true, name);
      assert.strictEqual(s.denied, false, name);
    }
  });

  it('roles with no client-data access are denied', async function () {
    for (const name of NO_ACCESS_ACTORS) {
      const s = await resolveScope(await userOf(name));
      assert.strictEqual(s.denied, true, name);
      assert.strictEqual(s.isAdmin, false, name);
      const sel = await holdingsSelector(s);
      const n = await PMSHoldingsCollection.find({ $and: [sel, { __testRun: F.runId }] }).countAsync();
      assert.strictEqual(n, 0, `${name} sees ${n} holdings`);
    }
  });

  it('rmA perimeter: entityA (assignedUserIds), backup account entity, never entityB', async function () {
    const s = await resolveScope(await userOf('rmA'));
    assert.ok(s.entityIds.includes(F.entities.entityA));
    assert.ok(s.entityIds.includes(F.entities.entityBackup), 'backupRmIds extends the perimeter');
    assert.ok(!s.entityIds.includes(F.entities.entityB));
    assert.ok(!s.entityIds.includes(F.entities.entityArchived), 'archived excluded');
    assert.ok(!s.entityIds.includes(F.entities.entityDemo), 'demo excluded');
    // The wrapper account's legacy userId is the wrapper's own login — must NOT be adopted
    assert.ok(!s.userIds.includes(F.users.wrapperLogin), 'beneficial-owner account userId not adopted');
    assert.ok(!s.userIds.includes(F.users.clientB));
    assert.ok(s.bankAccountIds.includes(F.accounts.acctWrapper), 'wrapper account reachable via beneficialOwnerIds');
    assert.ok(s.bankAccountIds.includes(F.accounts.acctJoint), 'joint account reachable as holder');
    assert.ok(!s.bankAccountIds.includes(F.accounts.acctB));
  });

  it('assistantA has the same perimeter as rmA', async function () {
    const a = await resolveScope(await userOf('assistantA'));
    const r = await resolveScope(await userOf('rmA'));
    assert.ok(setEq(a.entityIds, r.entityIds));
    assert.ok(setEq(a.bankAccountIds, r.bankAccountIds));
  });

  it('rmB perimeter via legacy relationshipManagerId; includes clientB legacy user', async function () {
    const s = await resolveScope(await userOf('rmB'));
    assert.ok(s.entityIds.includes(F.entities.entityB));
    assert.ok(s.userIds.includes(F.users.clientB));
    assert.ok(!s.entityIds.includes(F.entities.entityA));
  });

  it('RM view-as outside perimeter is denied; inside is narrowed', async function () {
    const rmA = await userOf('rmA');
    assert.strictEqual((await resolveScope(rmA, { type: 'entity', id: F.entities.entityB })).denied, true);
    assert.strictEqual((await resolveScope(rmA, { type: 'account', id: F.accounts.acctB })).denied, true);
    assert.strictEqual((await resolveScope(rmA, { type: 'client', id: F.users.clientB })).denied, true);
    assert.strictEqual((await resolveScope(rmA, { type: 'entity', id: F.entities.entityArchived })).denied, true);
    assert.strictEqual((await resolveScope(rmA, { type: 'account', id: 'does-not-exist' })).denied, true);
    assert.strictEqual((await resolveScope(rmA, { type: 'bogus', id: 'x' })).denied, true);
    assert.strictEqual((await resolveScope(rmA, { type: 'client', id: { $ne: null } })).denied, true);

    const narrowed = await resolveScope(rmA, { type: 'entity', id: F.entities.entityA });
    assert.strictEqual(narrowed.denied, false);
    assert.deepStrictEqual(narrowed.entityIds, [F.entities.entityA]);
    assert.ok(!narrowed.bankAccountIds.includes(F.accounts.acctBackup), 'narrowing drops the rest of the perimeter');
  });

  it('admin view-as account restricts to that account and its siblings', async function () {
    const s = await resolveScope(await userOf('admin'), { type: 'account', id: F.accounts.acctA });
    assert.strictEqual(s.isAdmin, false);
    assert.deepStrictEqual(s.bankAccountIds, [F.accounts.acctA]);
    const sel = await holdingsSelector(s);
    const docs = await PMSHoldingsCollection.find({ $and: [sel, { __testRun: F.runId }] }).fetchAsync();
    const codes = new Set(docs.map(d => d.portfolioCode));
    assert.ok(codes.has('504024'));
    assert.ok(!codes.has('5040241'), 'prefix collision must not leak');
  });

  it('clientA sees own entity, joint and wrapper accounts; never B', async function () {
    const s = await resolveScope(await userOf('clientA'));
    assert.strictEqual(s.denied, false);
    assert.ok(s.entityIds.includes(F.entities.entityA));
    assert.ok(s.bankAccountIds.includes(F.accounts.acctJoint));
    assert.ok(s.bankAccountIds.includes(F.accounts.acctWrapper));
    assert.ok(!s.bankAccountIds.includes(F.accounts.acctB));
    const docs = await PMSHoldingsCollection.find({ $and: [await holdingsSelector(s), { __testRun: F.runId }] }).fetchAsync();
    assertOnlyOwners(F, docs, ['A', 'J', 'W'], 'clientA holdings');
    assertHasOwners(F, docs, ['A'], 'clientA holdings');
    assertHasCode(F, docs, '777001', 'clientA sees the joint account');
    assertHasCode(F, docs, '880001', 'clientA sees the wrapper account');
    assertNoCode(F, docs, '5040241', 'clientA');
    // The wrapper's legacy login also owns a sibling wrapper for another client:
    // reaching 880001 through beneficialOwnerIds must not pull in 880002.
    assertNoCode(F, docs, '880002', 'sibling wrapper leaked through the shared legacy login');
  });

  it('client view-as: own account narrows, anything else is ignored (own data)', async function () {
    const clientA = await userOf('clientA');
    const own = await resolveScope(clientA, { type: 'account', id: F.accounts.acctA });
    assert.deepStrictEqual(own.bankAccountIds, [F.accounts.acctA]);
    const stale = await resolveScope(clientA, { type: 'entity', id: F.entities.entityB });
    assert.strictEqual(stale.denied, false);
    assert.ok(!stale.entityIds.includes(F.entities.entityB));
    assert.ok(stale.entityIds.includes(F.entities.entityA));
    const other = await resolveScope(clientA, { type: 'account', id: F.accounts.acctB });
    assert.ok(!other.bankAccountIds.includes(F.accounts.acctB));
  });

  it('clientB (legacy userId linkage) sees own rows only', async function () {
    const s = await resolveScope(await userOf('clientB'));
    const docs = await PMSHoldingsCollection.find({ $and: [await holdingsSelector(s), { __testRun: F.runId }] }).fetchAsync();
    assertOnlyOwners(F, docs, ['B', 'V'], 'clientB holdings');
    assertHasOwners(F, docs, ['B']);
    assertHasCode(F, docs, '880002', 'clientB sees its own wrapper');
    assertNoCode(F, docs, '880001', 'clientB must not see the sibling wrapper');
    assert.ok(!docs.some(d => d.portfolioCode === '504024'));
  });

  it('joint holder sees the joint account, not the co-holder\'s private accounts', async function () {
    const s = await resolveScope(await userOf('clientJoint'));
    const docs = await PMSHoldingsCollection.find({ $and: [await holdingsSelector(s), { __testRun: F.runId }] }).fetchAsync();
    assertOnlyOwners(F, docs, ['J'], 'clientJoint holdings');
    assertHasCode(F, docs, '777001', 'clientJoint');
    assertNoCode(F, docs, '504024', 'clientJoint must not see the co-holder\'s private account');
    assertNoCode(F, docs, '504024-USD', 'clientJoint');
  });

  it('allocations selector scopes by owner and account', async function () {
    const s = await resolveScope(await userOf('rmA'));
    const docs = await AllocationsCollection.find({ $and: [await allocationsSelector(s), { __testRun: F.runId }] }).fetchAsync();
    assertOnlyOwners(F, docs, ['A', 'J', 'W', 'K'], 'rmA allocations');
    assertHasOwners(F, docs, ['A', 'K']);
    const admin = await resolveScope(await userOf('admin'));
    const all = await AllocationsCollection.find({ $and: [await allocationsSelector(admin), { __testRun: F.runId }] }).fetchAsync();
    assertOnlyOwners(F, all, ['A', 'B', 'J', 'W', 'V', 'K'], 'admin allocations hide archived and demo');
  });

  it('membership helpers', async function () {
    const rmA = await resolveScope(await userOf('rmA'));
    assert.strictEqual(await isClientInScope(rmA, F.entities.entityA), true);
    assert.strictEqual(await isClientInScope(rmA, F.entities.entityB), false);
    assert.strictEqual(await isClientInScope(rmA, F.users.clientB), false);
    assert.strictEqual(isPortfolioCodeInScope(rmA, F.bankX, '504024-USD'), true);
    assert.strictEqual(isPortfolioCodeInScope(rmA, F.bankX, '5040241'), false);
    const acctB = await BankAccountsCollection.findOneAsync(F.accounts.acctB);
    assert.strictEqual(await accountBelongsToClient(acctB, F.entities.entityB), true);
    assert.strictEqual(await accountBelongsToClient(acctB, F.entities.entityA), false);
    const acctWrapper = await BankAccountsCollection.findOneAsync(F.accounts.acctWrapper);
    assert.strictEqual(await accountBelongsToClient(acctWrapper, F.entities.entityA), true, 'beneficial owner counts');
  });
});
