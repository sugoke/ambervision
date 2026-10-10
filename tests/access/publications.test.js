// Publication isolation matrix: every client-data publication, exercised as
// every kind of user, with benign and hostile View As filters. Nothing a user
// receives may belong to a client outside their perimeter.
import assert from 'assert';
import '/server/publications/index.js';
import '/imports/api/templateReports.js';
import '/imports/api/reports.js';
import '/imports/api/chartData.js';
import { seedAccessFixtures, teardownAccessFixtures, NO_ACCESS_ACTORS, SEE_ALL_ACTORS } from '../helpers/fixtures.js';
import { collectPublication, hasPublication } from '../helpers/harness.js';
import { assertOnlyOwners, assertNoFixtureDocs, assertHasOwners, assertHasCode, assertNoCode } from '../helpers/assertScope.js';

describe('access: publications', function () {
  this.timeout(120000);
  let F;
  before(async function () { F = await seedAccessFixtures(); });
  after(async function () { await teardownAccessFixtures(F); });

  const tok = (name) => F.tokens[name];

  // What each actor may see, by fixture owner letter
  const ALLOWED = () => ({
    superadmin: ['A', 'B', 'J', 'W', 'V', 'K'],       // archived (X) and demo (D) hidden
    admin: ['A', 'B', 'J', 'W', 'V', 'K'],
    compliance: ['A', 'B', 'J', 'W', 'V', 'K'],
    rmA: ['A', 'J', 'W', 'K'],                          // entityA, joint, wrapper (beneficial), backup account
    assistantA: ['A', 'J', 'W', 'K'],
    rmB: ['B', 'J', 'W', 'V', 'K'],                     // entityB, joint co-holder, wrappers, backup owner
    clientA: ['A', 'J', 'W'],
    clientB: ['B', 'V'],
    clientJoint: ['J']
  });

  const HOSTILE_FILTERS = () => [
    { type: 'client', id: { $ne: null } },
    { type: 'entity', id: { $gt: '' } },
    { type: 'bogus', id: 'x' },
    { type: 'account', id: 'does-not-exist' },
    { type: 'entity' },
    'entity'
  ];

  const POSITION_PUBS = () => [
    { name: 'pmsHoldings', args: (t, v) => [t, v, true, null] },
    { name: 'pmsOperations', args: (t, v) => [t, v] },
    { name: 'portfolioSnapshots', args: (t, v) => [t, {}, v] },
    { name: 'equityHoldings', args: (t, v) => [t, v] },
    { name: 'allAllocations', args: (t, v) => [t, v] },
    { name: 'userBankAccounts', args: (t, v) => [t, v] }
  ];

  it('every position publication is scoped per actor (no View As)', async function () {
    for (const pub of POSITION_PUBS()) {
      assert.ok(hasPublication(pub.name), `publication ${pub.name} missing`);
      for (const [actor, allowed] of Object.entries(ALLOWED())) {
        const { docs, threw } = await collectPublication(pub.name, ...pub.args(tok(actor), null));
        assert.ok(!threw, `${pub.name} as ${actor} threw: ${threw?.message}`);
        // Snapshot history keeps archived clients for see-all roles (what was
        // true at the time); positions hide them. Never for RMs or clients.
        // The account directory is where admins manage archived and demo
        // accounts, so it lists them for see-all roles.
        const extra = !SEE_ALL_ACTORS.includes(actor) ? []
          : pub.name === 'portfolioSnapshots' ? ['X']
          : pub.name === 'userBankAccounts' ? ['X', 'D']
          : [];
        assertOnlyOwners(F, docs, [...allowed, ...extra], `${pub.name} as ${actor}`);
      }
      for (const actor of NO_ACCESS_ACTORS) {
        const { docs } = await collectPublication(pub.name, ...pub.args(tok(actor), null));
        assertNoFixtureDocs(F, docs, `${pub.name} as ${actor}`);
      }
      for (const bad of [null, '', 'garbage-token', { $gt: '' }]) {
        const { docs } = await collectPublication(pub.name, ...pub.args(bad, null));
        assertNoFixtureDocs(F, docs, `${pub.name} anonymous (${JSON.stringify(bad)})`);
      }
    }
  });

  it('prefix collision: 504024 never pulls in 5040241 and vice versa', async function () {
    for (const pub of POSITION_PUBS().filter(p => ['pmsHoldings', 'pmsOperations', 'portfolioSnapshots'].includes(p.name))) {
      const a = await collectPublication(pub.name, ...pub.args(tok('clientA'), null));
      assertHasCode(F, a.docs, '504024', `${pub.name} clientA`);
      assertNoCode(F, a.docs, '5040241', `${pub.name} clientA`);
      const b = await collectPublication(pub.name, ...pub.args(tok('clientB'), null));
      assertHasCode(F, b.docs, '5040241', `${pub.name} clientB`);
      assertNoCode(F, b.docs, '504024', `${pub.name} clientB`);
      assertNoCode(F, b.docs, '504024-USD', `${pub.name} clientB`);
    }
  });

  it('hostile View As filters yield nothing (or own data for a client)', async function () {
    for (const pub of POSITION_PUBS()) {
      for (const actor of ['admin', 'rmA', 'assistantA', 'clientA']) {
        for (const bad of HOSTILE_FILTERS()) {
          const { docs, threw } = await collectPublication(pub.name, ...pub.args(tok(actor), bad));
          if (threw) continue; // Match.Error from argument validation is an acceptable outcome
          if (actor === 'clientA') {
            assertOnlyOwners(F, docs, ['A', 'J', 'W'], `${pub.name} clientA hostile ${JSON.stringify(bad)}`);
          } else {
            assertNoFixtureDocs(F, docs, `${pub.name} ${actor} hostile ${JSON.stringify(bad)}`);
          }
        }
      }
    }
  });

  it('View As narrows admins and RMs; RM outside perimeter gets nothing', async function () {
    for (const pub of POSITION_PUBS()) {
      // Admin → entityA
      let r = await collectPublication(pub.name, ...pub.args(tok('admin'), { type: 'entity', id: F.entities.entityA, label: 'x', data: {} }));
      assertOnlyOwners(F, r.docs, ['A', 'J', 'W'], `${pub.name} admin viewAs entityA`);
      // Admin → account B
      r = await collectPublication(pub.name, ...pub.args(tok('admin'), { type: 'account', id: F.accounts.acctB }));
      assertOnlyOwners(F, r.docs, ['B'], `${pub.name} admin viewAs acctB`);
      // Admin → archived / demo entity: archived refused, demo allowed
      r = await collectPublication(pub.name, ...pub.args(tok('admin'), { type: 'entity', id: F.entities.entityArchived }));
      assertNoFixtureDocs(F, r.docs, `${pub.name} admin viewAs archived`);
      // rmA → own entity ok
      r = await collectPublication(pub.name, ...pub.args(tok('rmA'), { type: 'entity', id: F.entities.entityA }));
      assertOnlyOwners(F, r.docs, ['A', 'J', 'W'], `${pub.name} rmA viewAs entityA`);
      // rmA → entityB / acctB / clientB refused
      for (const v of [{ type: 'entity', id: F.entities.entityB }, { type: 'account', id: F.accounts.acctB }, { type: 'client', id: F.users.clientB }]) {
        r = await collectPublication(pub.name, ...pub.args(tok('rmA'), v));
        assertNoFixtureDocs(F, r.docs, `${pub.name} rmA viewAs ${v.type} of B`);
      }
      // assistantA mirrors rmA
      r = await collectPublication(pub.name, ...pub.args(tok('assistantA'), { type: 'entity', id: F.entities.entityB }));
      assertNoFixtureDocs(F, r.docs, `${pub.name} assistantA viewAs entityB`);
      // clientA → own account narrows; other's account → own data only
      r = await collectPublication(pub.name, ...pub.args(tok('clientA'), { type: 'account', id: F.accounts.acctB }));
      assertOnlyOwners(F, r.docs, ['A', 'J', 'W'], `${pub.name} clientA viewAs acctB`);
      assertNoCode(F, r.docs, '5040241', `${pub.name} clientA viewAs acctB`);
    }
  });

  it('demo client is visible only when explicitly drilled into', async function () {
    const all = await collectPublication('pmsHoldings', tok('admin'), null, true, null);
    assertNoCode(F, all.docs, '550001', 'admin without viewAs must not see demo');
    const drill = await collectPublication('pmsHoldings', tok('admin'), { type: 'entity', id: F.entities.entityDemo }, true, null);
    assertHasCode(F, drill.docs, '550001', 'admin drilled into demo');
  });

  it('userBankAccounts never ships KYC risk scores in the list', async function () {
    for (const actor of ['admin', 'rmB', 'clientB']) {
      const { docs } = await collectPublication('userBankAccounts', tok(actor), null);
      const mine = docs.filter(d => d.__testRun === F.runId);
      assert.ok(mine.length > 0, `${actor} sees some accounts`);
      assert.ok(mine.every(d => d.kycRiskScore === undefined && d.kycRiskScoreHistory === undefined), `${actor}: kycRiskScore leaked`);
    }
  });

  it('bankAccounts.details: full document only for a client in scope', async function () {
    let r = await collectPublication('bankAccounts.details', tok('rmB'), F.entities.entityB);
    assert.ok(r.docs.some(d => d.__testRun === F.runId && d.kycRiskScore), 'rmB sees B risk score');
    r = await collectPublication('bankAccounts.details', tok('rmA'), F.entities.entityB);
    assertNoFixtureDocs(F, r.docs, 'rmA must not read B account details');
    r = await collectPublication('bankAccounts.details', tok('clientB'), F.entities.entityB);
    assertNoFixtureDocs(F, r.docs, 'clients do not use the details channel');
  });

  it('orders: firm-wide for staff, own for clients, nothing for others', async function () {
    for (const actor of ['superadmin', 'admin', 'compliance', 'rmA', 'rmB', 'assistantA']) {
      const { docs } = await collectPublication('orders', tok(actor), { limit: 1000 });
      assertHasOwners(F, docs, ['A', 'B'], `orders as ${actor}`);
    }
    const a = await collectPublication('orders', tok('clientA'), { limit: 1000 });
    assertOnlyOwners(F, a.docs, ['A', 'J', 'W'], 'orders as clientA');
    assertHasOwners(F, a.docs, ['A'], 'orders as clientA');
    // a client's own filter cannot widen the perimeter
    const widened = await collectPublication('orders', tok('clientA'), { clientId: F.entities.entityB, limit: 1000 });
    assertOnlyOwners(F, widened.docs, ['A', 'J', 'W'], 'orders as clientA with foreign clientId filter');
    const b = await collectPublication('orders', tok('clientB'), { limit: 1000 });
    assertOnlyOwners(F, b.docs, ['B', 'V'], 'orders as clientB');
    assert.ok(b.docs.some(d => d._id === F.orders.legacyB), 'legacy-keyed order of clientB visible to clientB');
    for (const actor of NO_ACCESS_ACTORS) {
      const { docs } = await collectPublication('orders', tok(actor), { limit: 1000 });
      assertNoFixtureDocs(F, docs, `orders as ${actor}`);
    }
    // single + liveTraces
    const single = await collectPublication('orders.single', tok('clientA'), F.orders.acctB);
    assertNoFixtureDocs(F, single.docs, 'clientA reading B order');
    const traces = await collectPublication('orders.liveTraces', tok('clientA'), [F.orders.acctB, F.orders.acctA]);
    assertOnlyOwners(F, traces.docs, ['A'], 'clientA liveTraces');
    const staffSingle = await collectPublication('orders.single', tok('rmA'), F.orders.acctB);
    assert.ok(staffSingle.docs.some(d => d._id === F.orders.acctB), 'order book staff read any order');
  });

  it('products and allocations follow holdings and allocations', async function () {
    const a = await collectPublication('products', tok('clientA'), null);
    const ids = new Set(a.docs.filter(d => d.__testRun === F.runId).map(d => d._id));
    assert.ok(ids.has(F.products.prodA));
    assert.ok(ids.has(F.products.prodJoint));
    assert.ok(!ids.has(F.products.prodUnheld), 'unheld product hidden from client');
    assert.ok(!ids.has(F.products.prodB) || ids.has(F.products.prodB) === false, 'B-only product hidden from client A');
    const intro = await collectPublication('products', tok('introducer'), null);
    assertNoFixtureDocs(F, intro.docs, 'introducer sees no products');
    const all = await collectPublication('products.all', tok('rmA'), null);
    assert.ok(all.docs.some(d => d._id === F.products.prodUnheld), 'catalogue open to RM');
    const allClient = await collectPublication('products.all', tok('clientA'), null);
    assertNoFixtureDocs(F, allClient.docs, 'catalogue closed to clients');
    const single = await collectPublication('products.single', F.products.prodB, tok('clientA'));
    assertNoFixtureDocs(F, single.docs, 'clientA cannot open product B');
    const palloc = await collectPublication('productAllocations', F.products.prodA, tok('clientA'));
    assertOnlyOwners(F, palloc.docs, ['A', 'J', 'W'], 'productAllocations clientA');
  });

  it('product-level feeds are held-only for clients', async function () {
    for (const name of ['templateReports.forProduct', 'reports.forProduct', 'chartData.byProduct']) {
      if (!hasPublication(name)) continue;
      const { docs, threw } = await collectPublication(name, F.products.prodB, tok('clientA'));
      assert.ok(!threw, `${name} threw ${threw?.message}`);
      assert.strictEqual(docs.length, 0, `${name}: clientA read an unheld product`);
    }
    const byProd = await collectPublication('pmsHoldings.byProduct', (await import('/imports/api/products')).ProductsCollection.findOne ? null : null, tok('rmA'));
    assert.ok(byProd); // smoke
  });

  it('pmsHoldings.byProduct is scoped for RMs', async function () {
    const { ProductsCollection } = await import('/imports/api/products');
    const prodA = await ProductsCollection.findOneAsync(F.products.prodA);
    const r = await collectPublication('pmsHoldings.byProduct', prodA.isin, tok('rmB'));
    // prodA is held by A (504024, 504024-USD, wrapper 880001, demo); rmB reaches only the wrapper
    assertOnlyOwners(F, r.docs, ['W', 'V', 'B', 'J', 'K'], 'byProduct rmB');
    assertNoCode(F, r.docs, '504024', 'rmB must not see A positions in a product');
    const rA = await collectPublication('pmsHoldings.byProduct', prodA.isin, tok('rmA'));
    assertHasCode(F, rA.docs, '504024', 'rmA sees A positions in product A');
  });

  it('schedule.observations is scoped by allocations and holdings', async function () {
    const r = await collectPublication('schedule.observations', tok('clientA'), null);
    // fixture products have no observationSchedule → nothing published, but no leak and no throw
    assert.ok(!r.threw);
    const rm = await collectPublication('schedule.observations', tok('introducer'), null);
    assertNoFixtureDocs(F, rm.docs, 'introducer schedule');
  });

  it('directory publications are perimeter-scoped', async function () {
    const ent = await collectPublication('entities.forViewAs', tok('rmA'));
    const entIds = new Set(ent.docs.map(d => d._id));
    assert.ok(entIds.has(F.entities.entityA), 'rmA picker lists entityA (assignedUserIds link)');
    assert.ok(!entIds.has(F.entities.entityB), 'rmA picker must not list entityB');
    const entB = await collectPublication('entities.forViewAs', tok('rmB'));
    assert.ok(new Set(entB.docs.map(d => d._id)).has(F.entities.entityB), 'rmB picker lists entityB (legacy link)');

    const ce = await collectPublication('clientEntities', tok('clientA'));
    const ceIds = new Set(ce.docs.map(d => d._id));
    assert.ok(ceIds.has(F.entities.entityA));
    assert.ok(!ceIds.has(F.entities.entityB));
    const det = await collectPublication('clientEntities.details', tok('clientA'), F.entities.entityB);
    assertNoFixtureDocs(F, det.docs, 'clientA details of B');

    const users = await collectPublication('customUsers', tok('rmA'));
    const uids = new Set(users.docs.map(d => d._id));
    assert.ok(uids.has(F.users.rmB), 'staff directory visible to RMs');
    assert.ok(uids.has(F.users.clientA), 'own client login visible');
    assert.ok(!uids.has(F.users.clientB), 'other RM client login hidden');
    assert.ok(users.docs.every(d => d.password === undefined), 'no password hashes');
    const usersClient = await collectPublication('customUsers', tok('clientA'));
    assertNoFixtureDocs(F, usersClient.docs, 'clients get no directory');

    const vc = await collectPublication('users.clients', tok('rmB'));
    const vcIds = new Set(vc.docs.map(d => d._id));
    assert.ok(vcIds.has(F.users.clientB));
    assert.ok(!vcIds.has(F.users.clientA));
  });

  it('client documents are readable by the subject and their staff only', async function () {
    const own = await collectPublication('clientDocuments', F.entities.entityA, tok('clientA'));
    assert.ok(own.docs.some(d => d.__testRun === F.runId), 'clientA reads documents of its entity');
    const other = await collectPublication('clientDocuments', F.entities.entityB, tok('clientA'));
    assertNoFixtureDocs(F, other.docs, 'clientA reads B documents');
    const rm = await collectPublication('clientDocuments', F.entities.entityB, tok('rmA'));
    assertNoFixtureDocs(F, rm.docs, 'rmA reads B documents');
    // B's documents are filed under the legacy login id (acctB has userId clientB)
    const rmLegacy = await collectPublication('clientDocuments', F.users.clientB, tok('rmA'));
    assertNoFixtureDocs(F, rmLegacy.docs, 'rmA reads B documents (legacy id)');
    const rmOk = await collectPublication('clientDocuments', F.users.clientB, tok('rmB'));
    assert.ok(rmOk.docs.some(d => d.__testRun === F.runId), 'rmB reads B documents');
    const selfB = await collectPublication('clientDocuments', F.users.clientB, tok('clientB'));
    assert.ok(selfB.docs.some(d => d.__testRun === F.runId), 'clientB reads own documents');
    const multi = await collectPublication('clientDocuments.forUsers', [F.entities.entityA, F.entities.entityB], tok('rmA'));
    assertOnlyOwners(F, multi.docs, ['A'], 'forUsers filtered to perimeter');
  });

  it('firm-wide reference and analysis feeds are gated', async function () {
    const risk = await collectPublication('riskAnalysisReports', tok('rmA'));
    assert.strictEqual(risk.docs.length, 0, 'RM must not get firm-wide risk dossiers');
    const und = await collectPublication('phoenixUnderlyingsAnalysis', tok('clientA'));
    assert.strictEqual(und.docs.length, 0);
    const banksAnon = await collectPublication('banks', null);
    assert.strictEqual(banksAnon.docs.length, 0, 'banks require a session');
    const banks = await collectPublication('banks', tok('clientA'));
    assert.ok(banks.docs.some(d => d._id === F.bankX));
  });
});
