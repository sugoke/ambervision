// Golden comparison: the RM dashboard, PDF statements and allocation scope are
// built on getFilteredClientIds(). resolveScope().ownerIds must reproduce it
// (equal for staff; a superset for clients, whose perimeter it widens through
// their sole-holder accounts exactly as clientAllocationSelector does).
import assert from 'assert';
import { UsersCollection } from '/imports/api/users';
import { resolveScope } from '/server/helpers/accessScope.js';
import { getFilteredClientIds } from '/server/methods/rmDashboardMethods.js';
import { seedAccessFixtures, teardownAccessFixtures } from '../helpers/fixtures.js';

describe('access: golden getFilteredClientIds vs resolveScope', function () {
  this.timeout(60000);
  let F;
  before(async function () { F = await seedAccessFixtures(); });
  after(async function () { await teardownAccessFixtures(F); });

  const userOf = (name) => UsersCollection.findOneAsync(F.users[name]);
  const fixtureOnly = (ids) => ids.filter(id => Object.values(F.entities).includes(id) || Object.values(F.users).includes(id));

  const cases = () => [
    ['rmA', null], ['rmB', null], ['assistantA', null],
    ['rmA', { type: 'entity', id: F.entities.entityA }],
    ['rmA', { type: 'entity', id: F.entities.entityB }],
    ['rmA', { type: 'account', id: F.accounts.acctA }],
    ['rmA', { type: 'account', id: F.accounts.acctB }],
    ['rmB', { type: 'client', id: F.users.clientB }],
    ['rmA', { type: 'client', id: F.users.clientB }],
    ['admin', { type: 'entity', id: F.entities.entityA }],
    ['admin', { type: 'account', id: F.accounts.acctB }],
    ['admin', { type: 'entity', id: F.entities.entityArchived }],
    ['compliance', { type: 'entity', id: F.entities.entityB }]
  ];

  it('staff perimeters agree (fixture ids only)', async function () {
    for (const [name, viewAs] of cases()) {
      const user = await userOf(name);
      const legacy = fixtureOnly(await getFilteredClientIds(user, viewAs));
      const scope = await resolveScope(user, viewAs);
      const next = scope.denied ? [] : fixtureOnly(scope.ownerIds);
      // The new resolver may add legacy user ids of HELD accounts and the backup
      // entity; it must never drop anything the legacy helper returned.
      for (const id of legacy) {
        assert.ok(next.includes(id), `${name} ${JSON.stringify(viewAs)}: resolveScope dropped ${id}`);
      }
      // And never add an owner the legacy helper would have refused outright.
      if (legacy.length === 0) {
        assert.strictEqual(next.length, 0, `${name} ${JSON.stringify(viewAs)}: legacy denied but resolveScope returned ${next}`);
      }
    }
  });

  it('client perimeter is a superset of the legacy one', async function () {
    for (const name of ['clientA', 'clientB', 'clientJoint']) {
      const user = await userOf(name);
      const legacy = await getFilteredClientIds(user, null);
      const scope = await resolveScope(user);
      for (const id of legacy) assert.ok(scope.ownerIds.includes(id), `${name}: dropped ${id}`);
      // never another client's entity
      const others = Object.entries(F.owners).filter(([k]) => !['A', 'B', 'J'].includes(k)).flatMap(([, o]) => [...o.entityIds, ...o.userIds]);
      for (const id of scope.ownerIds) assert.ok(!others.includes(id), `${name}: foreign owner ${id}`);
    }
  });
});
