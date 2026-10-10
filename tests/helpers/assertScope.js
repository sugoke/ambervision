import assert from 'assert';
import { ownersOf } from './fixtures.js';

/**
 * Every fixture-owned document in `docs` belongs to at least one of
 * `allowedOwners` (a joint-account row belongs to both holders).
 * Documents that are not fixture rows (pre-existing data in the test DB) are
 * ignored, so the suite also runs against a non-empty database.
 */
export function assertOnlyOwners(F, docs, allowedOwners, label = '') {
  const offenders = [];
  for (const doc of docs) {
    if (!doc || doc.__testRun !== F.runId) continue;
    const owners = ownersOf(F, doc);
    if (owners.length > 0 && !owners.some(o => allowedOwners.includes(o))) {
      offenders.push({ owners, _id: doc._id, portfolioCode: doc.portfolioCode, clientId: doc.clientId, entityId: doc.entityId, bankAccountId: doc.bankAccountId });
    }
  }
  assert.strictEqual(offenders.length, 0,
    `${label}: ${offenders.length} document(s) outside allowed owners [${allowedOwners}]: ${JSON.stringify(offenders.slice(0, 3))}`);
}

/** No fixture-owned document at all. */
export function assertNoFixtureDocs(F, docs, label = '') {
  const mine = docs.filter(d => d && d.__testRun === F.runId);
  assert.strictEqual(mine.length, 0, `${label}: expected nothing, got ${mine.length} fixture document(s)`);
}

/** At least one fixture document of each `owners`. */
export function assertHasOwners(F, docs, owners, label = '') {
  const seen = new Set(docs.filter(d => d && d.__testRun === F.runId).flatMap(d => ownersOf(F, d)));
  for (const o of owners) {
    assert.ok(seen.has(o), `${label}: expected documents of owner ${o}, saw [${[...seen]}]`);
  }
}

/** Some fixture document carries this portfolio code. */
export function assertHasCode(F, docs, code, label = '') {
  assert.ok(docs.some(d => d && d.__testRun === F.runId && (d.portfolioCode === code || d.accountNumber === code)),
    `${label}: expected a document with portfolio code ${code}`);
}

export function assertNoCode(F, docs, code, label = '') {
  assert.ok(!docs.some(d => d && d.__testRun === F.runId && (d.portfolioCode === code || d.accountNumber === code)),
    `${label}: found a document with portfolio code ${code}`);
}

export const setEq = (a, b) => {
  const A = new Set(a), B = new Set(b);
  return A.size === B.size && [...A].every(x => B.has(x));
};
