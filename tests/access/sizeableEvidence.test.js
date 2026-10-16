// Sizeable-transaction evidence: who may attach, open and remove the
// documents corroborating a flagged money flow.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import '/server/methods/sizeableTransactionMethods.js';
import { SizeableTransactionReviewsCollection, SIZEABLE_STATUSES } from '/imports/api/sizeableTransactions';
import { NotificationsCollection } from '/imports/api/notifications';
import { getSizeableEvidenceDir } from '/imports/api/documentStorage';
import { seedAccessFixtures, teardownAccessFixtures } from '../helpers/fixtures.js';
import { callMethod, tryMethod } from '../helpers/harness.js';

const PDF_BASE64 = Buffer.from('%PDF-1.4\n%mocha evidence\n%%EOF\n').toString('base64');

describe('access: sizeable transaction evidence', function () {
  this.timeout(120000);
  let F;
  let reviewId;

  before(async function () {
    F = await seedAccessFixtures();
    reviewId = await SizeableTransactionReviewsCollection.insertAsync({
      key: `single|mocha-${F.runId}`,
      kind: 'single', direction: 'out', period: '2026-10', operationDate: new Date('2026-10-08T00:00:00Z'),
      bankId: null, bankName: 'Test Bank', portfolioCode: '504024', bankAccountId: F.accounts.acctA,
      entityId: F.entities.entityA, clientName: 'Client A',
      rmIds: [F.users.rmA], amountEUR: 260405, thresholdEUR: 100000,
      operationIds: [], operations: [],
      status: SIZEABLE_STATUSES.QUESTIONED,
      thread: [{ at: new Date(), byUserId: F.users.compliance, byName: 'Compliance', role: 'compliance', text: 'Origin of funds?' }],
      createdAt: new Date(), updatedAt: new Date()
    });
  });

  after(async function () {
    if (reviewId) {
      await SizeableTransactionReviewsCollection.removeAsync(reviewId);
      await NotificationsCollection.removeAsync({ 'metadata.sizeableReviewId': reviewId });
      try { fs.rmSync(path.join(getSizeableEvidenceDir(), reviewId), { recursive: true, force: true }); } catch (e) { /* nothing written */ }
    }
    await teardownAccessFixtures(F);
  });

  const tok = (name) => F.tokens[name];
  const isDenied = (error) => !!error && /not-authorized|not authorized|not the relationship manager/i.test(`${error.error} ${error.reason} ${error.message}`);
  const attach = (actor, fileName = 'invoice.pdf', mimeType = 'application/pdf') =>
    tryMethod('sizeableTransactions.attachDocument', { reviewId, fileName, base64Data: PDF_BASE64, mimeType }, tok(actor));

  it('compliance and the assigned RM can attach; other RMs and clients cannot', async function () {
    const compliance = await attach('compliance');
    assert.ok(!compliance.error, `compliance attach: ${compliance.error?.message}`);

    const rmA = await attach('rmA', 'contract.pdf');
    assert.ok(!rmA.error, `rmA attach: ${rmA.error?.message}`);

    const rmB = await attach('rmB');
    assert.ok(isDenied(rmB.error), 'rmB is not the RM of this account');

    const client = await attach('clientA');
    assert.ok(isDenied(client.error), 'clients never see the review');

    const review = await SizeableTransactionReviewsCollection.findOneAsync(reviewId);
    assert.strictEqual(review.documents.length, 2);
    assert.strictEqual(review.status, SIZEABLE_STATUSES.ANSWERED, 'an RM attachment counts as an answer');
    assert.ok(review.thread.some(t => /Attached document: contract.pdf/.test(t.text)), 'attachment is kept in the conversation');
    for (const doc of review.documents) {
      assert.ok(fs.existsSync(path.join(getSizeableEvidenceDir(), reviewId, doc.storedFileName)), 'file written to the evidence store');
      assert.ok(/^\d+_[A-Za-z0-9]+\.pdf$/.test(doc.storedFileName), 'stored name is built server-side');
    }
  });

  it('file type is checked: extension and content type must be on the allowlist and agree', async function () {
    const html = await attach('compliance', 'payload.html', 'text/html');
    assert.ok(html.error && /Unsupported file type/.test(html.error.reason), 'html refused');
    const mismatch = await attach('compliance', 'letter.pdf', 'application/msword');
    assert.ok(mismatch.error && /does not match/.test(mismatch.error.reason), 'Word content under a .pdf name refused');
  });

  it('download URLs are minted for compliance and the assigned RM only', async function () {
    const review = await SizeableTransactionReviewsCollection.findOneAsync(reviewId);
    const documentId = review.documents[0]._id;
    const url = await callMethod('sizeableTransactions.getDocumentUrl', { reviewId, documentId }, tok('rmA'));
    assert.ok(url.startsWith(`/sizeable_evidence/${reviewId}/`) && /\?dl=amdl_/.test(url), `token-bound url: ${url}`);
    const compliance = await tryMethod('sizeableTransactions.getDocumentUrl', { reviewId, documentId }, tok('compliance'));
    assert.ok(!compliance.error, 'compliance can open');
    const rmB = await tryMethod('sizeableTransactions.getDocumentUrl', { reviewId, documentId }, tok('rmB'));
    assert.ok(isDenied(rmB.error), 'rmB cannot open');
    const client = await tryMethod('sizeableTransactions.getDocumentUrl', { reviewId, documentId }, tok('clientA'));
    assert.ok(isDenied(client.error), 'clients cannot open');
  });

  it('an RM removes only their own documents; compliance removes any', async function () {
    const review = await SizeableTransactionReviewsCollection.findOneAsync(reviewId);
    const complianceDoc = review.documents.find(d => d.role === 'compliance');
    const rmDoc = review.documents.find(d => d.role === 'rm');

    const rmOnCompliance = await tryMethod('sizeableTransactions.removeDocument', { reviewId, documentId: complianceDoc._id }, tok('rmA'));
    assert.ok(isDenied(rmOnCompliance.error), 'rmA cannot remove the compliance upload');

    const rmOwn = await tryMethod('sizeableTransactions.removeDocument', { reviewId, documentId: rmDoc._id }, tok('rmA'));
    assert.ok(!rmOwn.error, `rmA removes own: ${rmOwn.error?.message}`);
    assert.ok(!fs.existsSync(path.join(getSizeableEvidenceDir(), reviewId, rmDoc.storedFileName)), 'file deleted from disk');

    const rows = await callMethod('sizeableTransactions.listForRm', tok('rmA'));
    const row = rows.rows.find(r => r._id === reviewId);
    assert.ok(row, 'rmA still sees the review');
    assert.strictEqual(row.documents.length, 1);
    assert.strictEqual(row.documents[0].canRemove, false, 'RM gets no remove flag on the compliance upload');
    assert.strictEqual(row.canAttach, true);
  });

  it('once closed, the RM can no longer attach but compliance still can', async function () {
    await callMethod('sizeableTransactions.markDone', { reviewId, note: 'Documents reviewed' }, tok('compliance'));
    const rm = await attach('rmA', 'late.pdf');
    assert.ok(rm.error && /already closed/.test(rm.error.reason), 'RM window closes with the review');
    const compliance = await attach('compliance', 'filed.pdf');
    assert.ok(!compliance.error, `compliance after closure: ${compliance.error?.message}`);

    const listed = await callMethod('sizeableTransactions.list', { status: 'done' }, tok('compliance'));
    const row = listed.rows.find(r => r._id === reviewId);
    assert.ok(row, 'closed review listed for compliance');
    assert.strictEqual(row.documentCountText, '2 documents');
    assert.ok(row.documents.every(d => d.canRemove === true), 'compliance may remove any document');
  });
});
