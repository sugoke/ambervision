// Regulatory retention: a GDPR erasure request restricts processing but destroys
// nothing until five years after the end of the relationship; the retention
// sweep then destroys the file. Files are always resolved from the store root.
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import '/server/methods/gdprMethods.js';
import '/server/methods/clientDocumentMethods.js';
import '/server/publications/clientDocuments.js';
import { destroyExpiredRestrictedClients, GdprRegisterCollection } from '/server/methods/gdprMethods.js';
import { retentionEndFor, isPastRetention, retentionYears } from '/server/helpers/retentionPolicy.js';
import {
  getFichierCentralDir, getOrderTracesDir, getSizeableEvidenceDir, getMeetingReportsDir,
  resolveClientDocumentPath, resolveMeetingReportPdfPath, resolveOrderTracePath
} from '/imports/api/documentStorage';
import { ClientEntitiesCollection, ClientEntityHelpers } from '/imports/api/clientEntities';
import { ClientDocumentsCollection } from '/imports/api/clientDocuments';
import { OrdersCollection } from '/imports/api/orders';
import { MeetingReportsCollection } from '/imports/api/meetingReports';
import { SizeableTransactionReviewsCollection } from '/imports/api/sizeableTransactions';
import { seedAccessFixtures, teardownAccessFixtures } from '../helpers/fixtures.js';
import { callMethod, tryMethod, collectPublication } from '../helpers/harness.js';

const YEAR_MS = 365.25 * 24 * 3600 * 1000;
const write = (file, content = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
const rmrf = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* absent */ } };

describe('access: retention policy', function () {
  it('no archive date, no clock; archived entities keep their file for the retention years', function () {
    assert.strictEqual(retentionEndFor({ status: 'active' }), null);
    const archivedAt = new Date('2021-03-15T00:00:00Z');
    const end = retentionEndFor({ archivedAt });
    assert.strictEqual(end.toISOString(), `${2021 + retentionYears()}-03-15T00:00:00.000Z`);
    assert.strictEqual(isPastRetention({ archivedAt }, new Date(end.getTime() - 1)), false);
    assert.strictEqual(isPastRetention({ archivedAt }, end), true);
    assert.ok(retentionYears() >= 5, 'never below the legal minimum');
  });

  it('stored records resolve from the store root, never from the absolute path they carry', function () {
    const doc = { userId: 'abc', storedFileName: 'id_123.pdf', filePath: '/old/public/fichier_central/abc/id_123.pdf' };
    assert.strictEqual(resolveClientDocumentPath(doc), path.join(getFichierCentralDir(), 'abc', 'id_123.pdf'));
    assert.strictEqual(resolveClientDocumentPath({ userId: '../x', storedFileName: 'a.pdf' }), null);
    assert.strictEqual(resolveClientDocumentPath({ userId: 'abc', filePath: '/legacy/root/abc/passport_9.pdf' }), path.join(getFichierCentralDir(), 'abc', 'passport_9.pdf'));
    assert.strictEqual(resolveOrderTracePath('ord1', { storedFileName: 'client_order_1.eml' }), path.join(getOrderTracesDir(), 'ord1', 'client_order_1.eml'));
    assert.strictEqual(resolveMeetingReportPdfPath('/meetingReports/r1.pdf?dl=tok'), path.join(getMeetingReportsDir(), 'r1.pdf'));
    assert.strictEqual(resolveMeetingReportPdfPath('/etc/passwd'), null);
  });
});

describe('access: GDPR restriction and destruction', function () {
  this.timeout(120000);
  let F;
  let entityId;
  let docId;
  let reportId;
  let reviewId;
  let orderId;
  const files = {};
  const tok = (name) => F.tokens[name];

  before(async function () {
    F = await seedAccessFixtures();
    entityId = F.entities.entityArchived;
    orderId = F.orders.acctArchived;
    const tag = { __testRun: F.runId };

    // The archived client's file: a KYC document, an order trace, a meeting
    // report PDF and sizeable-transaction evidence, each on disk.
    docId = await ClientDocumentsCollection.insertAsync({
      userId: entityId, documentType: 'passport', fileName: 'passport.pdf', storedFileName: `passport_${Date.now()}.pdf`,
      filePath: '/stale/location/passport.pdf', mimeType: 'application/pdf', uploadedAt: new Date(), ...tag
    });
    files.doc = resolveClientDocumentPath(await ClientDocumentsCollection.findOneAsync(docId));
    write(files.doc);

    const trace = { _id: 'tr1', traceType: 'client_order', traceMode: 'file', fileName: 'order.eml', storedFileName: 'client_order_1.eml' };
    await OrdersCollection.updateAsync(orderId, { $set: { emailTraces: [trace] } });
    files.trace = resolveOrderTracePath(orderId, trace);
    write(files.trace);

    reportId = await MeetingReportsCollection.insertAsync({
      entityId, clientNameSnapshot: 'Archived Client', status: 'finalized', rawNotes: 'private notes',
      meetingDate: new Date(), createdAt: new Date(), createdBy: F.users.rmA
    });
    await MeetingReportsCollection.updateAsync(reportId, { $set: { pdfPath: `/meetingReports/${reportId}.pdf` } });
    files.pdf = resolveMeetingReportPdfPath(`/meetingReports/${reportId}.pdf`);
    write(files.pdf, '%PDF-1.4');

    reviewId = await SizeableTransactionReviewsCollection.insertAsync({
      key: `single|retention-${F.runId}`, kind: 'single', direction: 'out', period: '2026-01', entityId,
      bankAccountId: F.accounts.acctArchived, clientName: 'Archived Client', rmIds: [F.users.rmA], amountEUR: 150000,
      thresholdEUR: 100000, operationIds: [], operations: [], status: 'done',
      thread: [{ at: new Date(), role: 'compliance', text: 'origin?' }],
      documents: [{ _id: 'd1', fileName: 'proof.pdf', storedFileName: 'proof.pdf' }], createdAt: new Date(), updatedAt: new Date()
    });
    files.evidence = path.join(getSizeableEvidenceDir(), reviewId, 'proof.pdf');
    write(files.evidence);
  });

  after(async function () {
    await MeetingReportsCollection.removeAsync({ _id: reportId });
    await SizeableTransactionReviewsCollection.removeAsync({ _id: reviewId });
    await GdprRegisterCollection.removeAsync({ entityId });
    rmrf(path.join(getFichierCentralDir(), entityId));
    rmrf(path.join(getOrderTracesDir(), orderId));
    rmrf(path.join(getSizeableEvidenceDir(), reviewId));
    try { fs.unlinkSync(files.pdf); } catch (e) { /* gone */ }
    await teardownAccessFixtures(F);
  });

  const displayName = async () => ClientEntityHelpers.getEntityDisplayName(await ClientEntitiesCollection.findOneAsync(entityId));

  it('erasure is refused while the relationship is live or the closure date is missing', async function () {
    const live = await tryMethod('gdpr.anonymizeClient', tok('superadmin'), F.entities.entityA, 'whatever');
    assert.strictEqual(live.error?.error, 'relationship-live');
    const archivedNoDate = await tryMethod('gdpr.anonymizeClient', tok('superadmin'), entityId, await displayName());
    assert.strictEqual(archivedNoDate.error?.error, 'relationship-live', 'archived without a closure date has no clock');
  });

  it('erasure restricts processing and destroys nothing', async function () {
    const archivedAt = new Date(Date.now() - 1 * YEAR_MS);
    await ClientEntitiesCollection.updateAsync(entityId, { $set: { archivedAt } });

    const result = await callMethod('gdpr.anonymizeClient', tok('superadmin'), entityId, await displayName());
    assert.strictEqual(result.retentionUntil.getTime(), retentionEndFor({ archivedAt }).getTime());

    for (const [name, file] of Object.entries(files)) assert.ok(fs.existsSync(file), `${name} still on disk`);

    const entity = await ClientEntitiesCollection.findOneAsync(entityId);
    assert.ok(entity.gdprRestricted && entity.gdprRestrictedAt && !entity.gdprDestroyedAt);
    assert.ok(entity.profile.firstName === 'entityArchived', 'identity kept');
    const doc = await ClientDocumentsCollection.findOneAsync(docId);
    assert.ok(doc.gdprRestricted && doc.retentionUntil, 'document flagged');
    assert.ok((await OrdersCollection.findOneAsync(orderId)).gdprRestricted, 'order flagged');
    assert.ok((await MeetingReportsCollection.findOneAsync(reportId)).gdprRestricted, 'report flagged');
    assert.ok((await SizeableTransactionReviewsCollection.findOneAsync(reviewId)).gdprRestricted, 'review flagged');
    assert.strictEqual((await MeetingReportsCollection.findOneAsync(reportId)).rawNotes, 'private notes', 'free text kept');

    const register = await GdprRegisterCollection.findOneAsync({ entityId, action: 'restrict' });
    assert.ok(register && register.retentionUntil, 'register records the scheduled destruction');

    const again = await tryMethod('gdpr.anonymizeClient', tok('superadmin'), entityId, await displayName());
    assert.strictEqual(again.error?.error, 'already-restricted');
  });

  it('restricted records: compliance still sees them, the RM and the client do not', async function () {
    const compliance = await collectPublication('clientDocuments', entityId, tok('compliance'));
    assert.ok(compliance.docs.some(d => d._id === docId), 'compliance sees the document');
    const rm = await collectPublication('clientDocuments', entityId, tok('rmA'));
    assert.ok(!rm.docs.some(d => d._id === docId), 'RM no longer sees the document');

    const rmUrl = await tryMethod('clientDocuments.getDownloadUrl', docId, tok('rmA'));
    assert.ok(rmUrl.error, 'RM cannot fetch it by id');
    const complianceUrl = await tryMethod('clientDocuments.getDownloadUrl', docId, tok('compliance'));
    assert.ok(!complianceUrl.error, `compliance can: ${complianceUrl.error?.message}`);
  });

  it('the retention sweep waits for the end of the period, then destroys the file', async function () {
    const entity = await ClientEntitiesCollection.findOneAsync(entityId);
    const tooEarly = new Date(entity.retentionUntil.getTime() - 24 * 3600 * 1000);
    const early = await destroyExpiredRestrictedClients({ now: tooEarly });
    assert.strictEqual(early.destroyed, 0);
    assert.ok(early.awaitingRetentionEnd >= 1);
    for (const [name, file] of Object.entries(files)) assert.ok(fs.existsSync(file), `${name} untouched before the end`);

    const due = new Date(entity.retentionUntil.getTime() + 24 * 3600 * 1000);
    const late = await destroyExpiredRestrictedClients({ now: due });
    assert.ok(late.destroyed >= 1, 'destroyed once due');
    for (const [name, file] of Object.entries(files)) assert.ok(!fs.existsSync(file), `${name} deleted`);

    const after = await ClientEntitiesCollection.findOneAsync(entityId);
    assert.ok(after.gdprDestroyedAt, 'marked destroyed');
    assert.ok(/^ERASED-/.test(after.profile.lastName), 'pseudonymised');
    assert.strictEqual(after.closureLetter, undefined);
    assert.strictEqual(await ClientDocumentsCollection.findOneAsync(docId), undefined, 'document row removed');
    const report = await MeetingReportsCollection.findOneAsync(reportId);
    assert.strictEqual(report.pdfPath, null);
    assert.strictEqual(report.rawNotes, '');
    const review = await SizeableTransactionReviewsCollection.findOneAsync(reviewId);
    assert.deepStrictEqual(review.documents, []);
    assert.deepStrictEqual((await OrdersCollection.findOneAsync(orderId)).emailTraces, []);
    assert.ok(await GdprRegisterCollection.findOneAsync({ entityId, action: 'destroy' }), 'destruction registered');

    const rerun = await destroyExpiredRestrictedClients({ now: due });
    assert.strictEqual(rerun.destroyed, 0, 'idempotent');
  });

  it('deleting a client document resolves the file from the store even when its stored path is stale', async function () {
    const staleId = await ClientDocumentsCollection.insertAsync({
      userId: F.entities.entityA, documentType: 'passport', fileName: 'old.pdf', storedFileName: `old_${Date.now()}.pdf`,
      filePath: '/was/public/fichier_central/old.pdf', mimeType: 'application/pdf', uploadedAt: new Date(), __testRun: F.runId
    });
    const file = resolveClientDocumentPath(await ClientDocumentsCollection.findOneAsync(staleId));
    write(file);
    await callMethod('clientDocuments.delete', staleId, tok('compliance'));
    assert.ok(!fs.existsSync(file), 'file removed from the real location');
    rmrf(path.join(getFichierCentralDir(), F.entities.entityA));
  });
});
