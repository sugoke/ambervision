import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Mongo } from 'meteor/mongo';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { SessionHelpers, SessionsCollection } from '../../imports/api/sessions.js';
import { UsersCollection } from '../../imports/api/users.js';
import { ClientEntitiesCollection, ClientEntityHelpers } from '../../imports/api/clientEntities.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { PMSOperationsCollection } from '../../imports/api/pmsOperations.js';
import { AllocationsCollection } from '../../imports/api/allocations.js';
import { ProductsCollection } from '../../imports/api/products.js';
import { OrdersCollection } from '../../imports/api/orders.js';
import { MeetingReportsCollection } from '../../imports/api/meetingReports.js';
import {
  getFichierCentralDir,
  getOrderTracesDir,
  getEntityDocumentsDir,
  getSizeableEvidenceDir,
  getGdprExportsDir,
  resolveClientDocumentPath,
  resolveMeetingReportPdfPath,
  isSafePathSegment
} from '/imports/api/documentStorage.js';
import { ENTITY_STATUSES } from '../../imports/api/clientEntities.js';
import { SizeableTransactionReviewsCollection } from '../../imports/api/sizeableTransactions.js';
import { retentionEndFor, isPastRetention, retentionYears, formatRetentionEnd } from '../helpers/retentionPolicy.js';
import { ClientDocumentsCollection } from '../../imports/api/clientDocuments.js';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { NotificationsCollection } from '../../imports/api/notifications.js';
import { LandingLeadsCollection } from '../../imports/api/landingLeads.js';
import { PasswordResetTokensCollection } from '../../imports/api/passwordResetTokens.js';
import { AuditLog, AuditLogCollection } from '../../imports/api/auditLog.js';

/**
 * GDPR data-subject-rights tooling, under the AML retention duty.
 *
 * The firm must keep the client file (KYC documents, orders and their email
 * traces, meeting reports, closure letters, AML reviews) for five years after
 * the end of the relationship — server/helpers/retentionPolicy.js. So:
 *
 * - gdpr.exportClientData  — Art. 15/20: full data bundle for one client entity.
 * - gdpr.anonymizeClient   — Art. 17 request → Art. 18 restriction of processing:
 *   logins disabled, marketing footprint removed, and every record of the client
 *   flagged `gdprRestricted` (visible to superadmins and compliance only). Nothing
 *   is destroyed. Requires the entity to be archived (the closure date starts the
 *   retention clock).
 * - destroyExpiredRestrictedClients — run by the nightly retention sweep: once
 *   `retentionUntil` has passed, destroys the files and strips identity and free
 *   text, keeping the account-level financial records (holdings, operations,
 *   allocations, snapshots) under a pseudonymised entity.
 * - gdpr.deleteLead        — hard delete of a marketing lead (no financial history).
 *
 * Every step is recorded in the append-only `gdprRegister` collection
 * (who / when / what counts) — the register itself contains no PII.
 */

export const GdprRegisterCollection = new Mongo.Collection('gdprRegister');

async function validateSuperadminSession(sessionId) {
  // SECURITY: string-only — reject selector-object injection.
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }
  const session = await SessionHelpers.findByToken(sessionId);
  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }
  if (user.role !== 'superadmin') {
    throw new Meteor.Error('not-authorized', 'Superadmin access required for GDPR operations');
  }
  return user;
}

const removeDirIfExists = (dir) => {
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    }
  } catch (e) {
    console.error(`[GDPR] Failed to remove directory: ${e.message}`);
  }
  return false;
};

/**
 * The client "perimeter": the entity id plus every legacy customUsers id the
 * client's data may be keyed on — same bridge as the dashboard scoping
 * (migratedFromUserId + userIds stamped on the entity's bank accounts).
 */
async function resolveClientPerimeter(entity) {
  const ids = [entity._id];
  if (entity.migratedFromUserId) ids.push(entity.migratedFromUserId);
  const linkedAccounts = await BankAccountsCollection.find(
    { entityId: entity._id, userId: { $exists: true, $ne: null } },
    { fields: { userId: 1 } }
  ).fetchAsync();
  for (const a of linkedAccounts) {
    if (a.userId && !ids.includes(a.userId)) ids.push(a.userId);
  }
  return ids;
}

const ownerSelector = (ids) => ({
  $or: [
    { userId: { $in: ids } },
    { entityId: { $in: ids } },
    { clientId: { $in: ids } }
  ]
});

// Logins that belong to the firm, never to a data subject
const STAFF_ROLES = ['superadmin', 'admin', 'relationship_manager', 'assistant', 'compliance', 'staff'];

const accountsOf = (perimeter) => ({ $or: [{ entityId: { $in: perimeter } }, { userId: { $in: perimeter } }] });

async function bankAccountIdsOf(perimeter) {
  const accounts = await BankAccountsCollection.find(accountsOf(perimeter), { fields: { _id: 1 } }).fetchAsync();
  return accounts.map(a => a._id);
}

const reportsOf = (perimeter, bankAccountIds) => ({
  $or: [{ entityId: { $in: perimeter } }, { bankAccountId: { $in: bankAccountIds } }]
});

/**
 * Physically destroy a client's file and strip identity and free text, keeping
 * the account-level financial records under a pseudonym. Called by the retention
 * sweep once the retention period has elapsed — never directly from a method.
 *
 * Every file is resolved from the store root and the stored name
 * (documentStorage.js); absolute paths kept on records are not trusted.
 */
async function destroyClientRecords(entity) {
  const entityId = entity._id;
  const perimeter = await resolveClientPerimeter(entity);
  const pseudonym = `ERASED-${entityId.slice(0, 6)}`;
  const counts = {};
  const now = new Date();

  // Collect user emails BEFORE scrambling (needed for notification cleanup).
  const users = await UsersCollection.find({ _id: { $in: perimeter } }, { fields: { email: 1, role: 1 } }).fetchAsync();
  const allEmails = [...new Set([...users.map(u => u.email), entity.profile?.email].filter(Boolean))];

  // 1. clientEntities: strip identity, KYC, FATCA, stakeholders, family, closure letter.
  counts.entity = 1;
  await ClientEntitiesCollection.updateAsync(entityId, {
    $set: {
      profile: {
        ...(entity.type === 'physical_person' ? { firstName: '', lastName: pseudonym } : { companyName: pseudonym }),
        updatedAt: now
      },
      status: ENTITY_STATUSES.ARCHIVED,
      isActive: false,
      gdprErasedAt: now,
      gdprDestroyedAt: now
    },
    $unset: { kyc: '', usPerson: '', stakeholders: '', kycRiskScore: '', kycRiskScoreHistory: '', closureLetter: '' }
  });

  // 2. customUsers in the perimeter (client logins only — never staff).
  counts.users = 0;
  for (const u of users) {
    if (STAFF_ROLES.includes(u.role)) continue;
    await UsersCollection.updateAsync(u._id, {
      $set: {
        email: `${pseudonym.toLowerCase()}-${u._id}@erased.invalid`,
        username: `${pseudonym.toLowerCase()}-${u._id}`,
        password: crypto.randomBytes(48).toString('hex'), // unusable non-scrypt value
        isActive: false,
        profile: { lastName: pseudonym, updatedAt: now },
        gdprErasedAt: now
      }
    });
    counts.users++;
  }

  // 3. bankAccounts: strip contact fields and the risk profile; the account number
  //    stays (re-identification is restricted to the firm — permitted pseudonymisation).
  counts.bankAccounts = await BankAccountsCollection.updateAsync(accountsOf(perimeter), {
    $set: { comment: null },
    $unset: {
      authorizedEmails: '', authorizedEmail: '', authorizedCcEmails: '', authorizedPhone: '', name: '',
      kycRiskScore: '', kycRiskScoreHistory: ''
    }
  }, { multi: true });
  const bankAccountIds = await bankAccountIdsOf(perimeter);

  // 4. meetingReports: delete the PDFs, remove free text and the name snapshot.
  const reports = await MeetingReportsCollection.find(reportsOf(perimeter, bankAccountIds), { fields: { pdfPath: 1 } }).fetchAsync();
  counts.meetingReports = reports.length;
  counts.meetingReportPdfsDeleted = 0;
  for (const r of reports) {
    const pdfPath = resolveMeetingReportPdfPath(r.pdfPath);
    try {
      if (pdfPath && fs.existsSync(pdfPath)) { fs.unlinkSync(pdfPath); counts.meetingReportPdfsDeleted++; }
    } catch (e) { /* best effort */ }
    await MeetingReportsCollection.updateAsync(r._id, {
      $set: { clientNameSnapshot: pseudonym, rawNotes: '', sections: {}, location: '', pdfPath: null, gdprErasedAt: now },
      $unset: { satisfaction: '', visitDocumentId: '' }
    });
  }

  // 5. orders: delete the email-trace files, strip notes and recipients.
  const orders = await OrdersCollection.find({ clientId: { $in: perimeter } }, { fields: { emailTraces: 1 } }).fetchAsync();
  counts.orders = orders.length;
  counts.orderTraceFoldersDeleted = 0;
  for (const o of orders) {
    if (isSafePathSegment(o._id) && removeDirIfExists(path.join(getOrderTracesDir(), o._id))) counts.orderTraceFoldersDeleted++;
    await OrdersCollection.updateAsync(o._id, {
      $set: { notes: null, sentTo: null, emailTraces: [], gdprErasedTraces: (o.emailTraces || []).length, gdprErasedAt: now }
    });
  }

  // 6. clientDocuments: delete rows AND the ID/KYC files, then the whole subject
  //    folders (stray files) and the entity folder (closure letter).
  const docs = await ClientDocumentsCollection.find({ userId: { $in: perimeter } }).fetchAsync();
  counts.documents = docs.length;
  for (const doc of docs) {
    try {
      const filePath = resolveClientDocumentPath(doc);
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) { /* best effort */ }
    await ClientDocumentsCollection.removeAsync(doc._id);
  }
  for (const id of perimeter) {
    if (isSafePathSegment(id)) removeDirIfExists(path.join(getFichierCentralDir(), id));
  }
  if (isSafePathSegment(entityId)) removeDirIfExists(path.join(getEntityDocumentsDir(), entityId));

  // 7. sizeable-transaction reviews: delete the evidence files, strip the name
  //    and the conversation; the flagged amounts stay (AML record).
  const reviews = await SizeableTransactionReviewsCollection.find(reportsOf(perimeter, bankAccountIds), { fields: { _id: 1 } }).fetchAsync();
  counts.sizeableReviews = reviews.length;
  for (const r of reviews) {
    if (isSafePathSegment(r._id)) removeDirIfExists(path.join(getSizeableEvidenceDir(), r._id));
    await SizeableTransactionReviewsCollection.updateAsync(r._id, {
      $set: { clientName: pseudonym, documents: [], thread: [], closingNote: '', gdprErasedAt: now }
    });
  }

  // 8. notifications: pull the client's emails from recipient lists.
  counts.notificationEmailPulls = allEmails.length
    ? await NotificationsCollection.updateAsync({ sentToEmails: { $in: allEmails } }, { $pull: { sentToEmails: { $in: allEmails } } }, { multi: true })
    : 0;

  // KEPT deliberately (AML/CFT record-keeping): pmsHoldings, pmsOperations,
  // portfolioSnapshots, allocations — all keyed to the pseudonymised entity.
  return { pseudonym, counts, perimeterSize: perimeter.length };
}

/**
 * Retention sweep: destroy the file of every client whose erasure request was
 * restricted and whose retention period has now elapsed. Archived clients who
 * never asked for erasure are only counted (`archivedPastRetention`), never
 * touched — how long to keep them beyond the legal minimum is the firm's call.
 *
 * Idempotent: an entity is destroyed once (gdprDestroyedAt) and registered.
 */
export async function destroyExpiredRestrictedClients({ now = new Date() } = {}) {
  const results = { destroyed: 0, awaitingRetentionEnd: 0, archivedPastRetention: 0 };

  const restricted = await ClientEntitiesCollection.find({
    gdprRestrictedAt: { $exists: true },
    gdprDestroyedAt: { $exists: false }
  }).fetchAsync();

  for (const entity of restricted) {
    if (!isPastRetention(entity, now)) { results.awaitingRetentionEnd++; continue; }
    try {
      const { pseudonym, counts, perimeterSize } = await destroyClientRecords(entity);
      await GdprRegisterCollection.insertAsync({
        action: 'destroy',
        entityId: entity._id,
        pseudonym,
        perimeterSize,
        counts,
        restrictedAt: entity.gdprRestrictedAt,
        retentionUntil: entity.retentionUntil || retentionEndFor(entity),
        performedBy: null,
        performedAt: now
      });
      await AuditLog.record({
        actorUserId: null, actorRole: 'system', action: 'gdpr.destroy',
        targetType: 'clientEntity', targetId: entity._id, meta: { counts }
      });
      console.log(`[GDPR] Retention ended — entity ${entity._id} destroyed as ${pseudonym}:`, JSON.stringify(counts));
      results.destroyed++;
    } catch (error) {
      console.error(`[GDPR] Destruction failed for entity ${entity._id}:`, error);
    }
  }

  const archived = await ClientEntitiesCollection.find(
    { status: ENTITY_STATUSES.ARCHIVED, archivedAt: { $exists: true }, gdprRestrictedAt: { $exists: false } },
    { fields: { archivedAt: 1 } }
  ).fetchAsync();
  results.archivedPastRetention = archived.filter(e => isPastRetention(e, now)).length;

  return results;
}

Meteor.methods({
  /**
   * Art. 15/20 — export every category of personal data held on a client
   * entity as one JSON bundle. A copy is also written server-side under
   * .fichier_central/gdpr_exports/ as the record of what was disclosed.
   */
  async 'gdpr.exportClientData'(sessionId, entityId) {
    check(sessionId, String);
    check(entityId, String);
    const actor = await validateSuperadminSession(sessionId);

    const entity = await ClientEntitiesCollection.findOneAsync(entityId);
    if (!entity) throw new Meteor.Error('not-found', 'Client entity not found');
    const perimeter = await resolveClientPerimeter(entity);

    const users = await UsersCollection.find(
      { _id: { $in: perimeter } },
      { fields: { password: 0 } }
    ).fetchAsync();

    const bankAccounts = await BankAccountsCollection.find({
      $or: [{ entityId: { $in: perimeter } }, { userId: { $in: perimeter } }]
    }).fetchAsync();

    const holdings = await PMSHoldingsCollection.find(
      { ...ownerSelector(perimeter), isLatest: true, portfolioCode: { $ne: 'CONSOLIDATED' } },
      { fields: { securityName: 1, isin: 1, assetClass: 1, quantity: 1, marketPrice: 1, marketValue: 1, currency: 1, portfolioCurrency: 1, portfolioCode: 1, bankId: 1, snapshotDate: 1 } }
    ).fetchAsync();
    const holdingsHistoryCount = await PMSHoldingsCollection.find(ownerSelector(perimeter)).countAsync();

    const operationsCount = await PMSOperationsCollection.find(ownerSelector(perimeter)).countAsync();
    const operations = await PMSOperationsCollection.find(
      ownerSelector(perimeter),
      { sort: { operationDate: -1 }, limit: 500 }
    ).fetchAsync();

    const allocations = await AllocationsCollection.find({ clientId: { $in: perimeter } }).fetchAsync();
    const productIds = [...new Set(allocations.map(a => a.productId))];
    const products = await ProductsCollection.find(
      { _id: { $in: productIds } },
      { fields: { title: 1, isin: 1, template: 1 } }
    ).fetchAsync();
    const productNames = Object.fromEntries(products.map(p => [p._id, p.title || p.isin]));

    const orders = await OrdersCollection.find({ clientId: { $in: perimeter } }).fetchAsync();
    const meetingReports = await MeetingReportsCollection.find({
      $or: [
        { entityId: { $in: perimeter } },
        { bankAccountId: { $in: bankAccounts.map(a => a._id) } }
      ]
    }).fetchAsync();

    const documents = await ClientDocumentsCollection.find({ userId: { $in: perimeter } }).fetchAsync();

    const snapshotCount = await PortfolioSnapshotsCollection.find(ownerSelector(perimeter)).countAsync();
    const latestSnapshots = await PortfolioSnapshotsCollection.find(
      ownerSelector(perimeter),
      { sort: { snapshotDate: -1 }, limit: 12, fields: { snapshotDate: 1, totalValue: 1, portfolioCode: 1, currency: 1 } }
    ).fetchAsync();

    const userEmails = users.map(u => u.email).filter(Boolean);
    const notifications = await NotificationsCollection.find({
      $or: [
        { sentToUsers: { $in: perimeter } },
        ...(userEmails.length ? [{ sentToEmails: { $in: userEmails } }] : [])
      ]
    }, { fields: { title: 1, message: 1, createdAt: 1, sentToEmails: 1 } }).fetchAsync();

    const sessions = await SessionsCollection.find(
      { userId: { $in: perimeter } },
      { fields: { createdAt: 1, lastUsed: 1, expiresAt: 1, ipAddress: 1, userAgent: 1 } }
    ).fetchAsync();

    const leads = userEmails.length
      ? await LandingLeadsCollection.find({ email: { $in: userEmails } }).fetchAsync()
      : [];

    const bundle = {
      _meta: {
        exportedAt: new Date(),
        exportedBy: actor._id,
        entityId,
        perimeterIds: perimeter,
        note: 'GDPR Art. 15/20 data export. Document files are listed under documents[]; they are retrievable individually via the document manager.'
      },
      entity,
      users,
      bankAccounts,
      holdings: { latest: holdings, totalHistoryRows: holdingsHistoryCount },
      operations: { rows: operations, totalRows: operationsCount },
      allocations: allocations.map(a => ({ ...a, productName: productNames[a.productId] || null })),
      orders,
      meetingReports,
      documents,
      portfolioSnapshots: { totalRows: snapshotCount, latest: latestSnapshots },
      notifications,
      sessions,
      landingLeads: leads
    };

    // Server-side copy — record of what was disclosed.
    try {
      const exportsDir = getGdprExportsDir();
      fs.mkdirSync(exportsDir, { recursive: true });
      const fileName = `${entityId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      fs.writeFileSync(path.join(exportsDir, fileName), JSON.stringify(bundle, null, 2));
      bundle._meta.serverCopy = `gdpr_exports/${fileName}`;
    } catch (e) {
      console.error('[GDPR] Failed to write server-side export copy:', e.message);
    }

    await AuditLog.record({
      actorUserId: actor._id,
      actorRole: actor.role,
      action: 'gdpr.export',
      targetType: 'clientEntity',
      targetId: entityId
    });
    console.log(`[GDPR] Export generated for entity ${entityId} by ${actor._id}`);
    return bundle;
  },

  /**
   * Art. 17 request → Art. 18 restriction of processing.
   *
   * The client file must be kept for the regulatory retention period after the
   * end of the relationship, so nothing is destroyed here. What happens now:
   *   - the client's logins are disabled, their sessions and reset tokens
   *     purged, their marketing leads deleted;
   *   - the entity, its bank accounts, documents, orders, meeting reports and
   *     AML reviews are flagged `gdprRestricted` with `retentionUntil`: only
   *     superadmins and compliance still see them
   *     (accessPolicy.restrictedRecordsClause), the RMs and the client do not.
   * The nightly retention sweep (destroyExpiredRestrictedClients) destroys the
   * files and anonymises the records once `retentionUntil` has passed.
   *
   * Requires the entity to be archived with a closure date (the retention
   * clock), and the caller to retype the entity's display name as confirmation.
   */
  async 'gdpr.anonymizeClient'(sessionId, entityId, confirmName) {
    check(sessionId, String);
    check(entityId, String);
    check(confirmName, String);
    const actor = await validateSuperadminSession(sessionId);

    const entity = await ClientEntitiesCollection.findOneAsync(entityId);
    if (!entity) throw new Meteor.Error('not-found', 'Client entity not found');
    if (entity.gdprDestroyedAt || entity.gdprErasedAt) throw new Meteor.Error('already-erased', 'This entity has already been anonymised');
    if (entity.gdprRestrictedAt) {
      throw new Meteor.Error('already-restricted',
        `Processing is already restricted for this entity; its records are destroyed after ${formatRetentionEnd(entity.retentionUntil)}`);
    }
    if (entity.status !== ENTITY_STATUSES.ARCHIVED || !entity.archivedAt) {
      throw new Meteor.Error('relationship-live',
        `The client file must be kept ${retentionYears()} years after the end of the relationship. Archive the client with its closure date first; erasure then restricts access until that period has run out.`);
    }

    const displayName = ClientEntityHelpers.getEntityDisplayName(entity);
    if (confirmName.trim().toLowerCase() !== displayName.trim().toLowerCase()) {
      throw new Meteor.Error('confirmation-mismatch',
        `Confirmation name does not match the entity display name ("${displayName}")`);
    }

    const perimeter = await resolveClientPerimeter(entity);
    const retentionUntil = retentionEndFor(entity);
    const now = new Date();
    const counts = {};
    const restriction = { gdprRestricted: true, retentionUntil };

    const users = await UsersCollection.find({ _id: { $in: perimeter } }, { fields: { email: 1, role: 1 } }).fetchAsync();
    const allEmails = [...new Set([...users.map(u => u.email), entity.profile?.email].filter(Boolean))];

    // 1. Entity: flagged, no longer active; identity and KYC stay (they ARE the file).
    counts.entity = 1;
    await ClientEntitiesCollection.updateAsync(entityId, {
      $set: { ...restriction, isActive: false, gdprRestrictedAt: now, gdprRestrictedBy: actor._id }
    });

    // 2. Client logins: disabled, password unusable; the email stays on record.
    counts.users = 0;
    for (const u of users) {
      if (STAFF_ROLES.includes(u.role)) continue;
      await UsersCollection.updateAsync(u._id, {
        $set: { isActive: false, deactivatedAt: now, password: crypto.randomBytes(48).toString('hex'), ...restriction, gdprRestrictedAt: now }
      });
      counts.users++;
    }

    // 3. Records of the file: flagged for restricted visibility, untouched otherwise.
    counts.bankAccounts = await BankAccountsCollection.updateAsync(accountsOf(perimeter), { $set: restriction }, { multi: true });
    const bankAccountIds = await bankAccountIdsOf(perimeter);
    counts.documents = await ClientDocumentsCollection.updateAsync({ userId: { $in: perimeter } }, { $set: restriction }, { multi: true });
    counts.orders = await OrdersCollection.updateAsync({ clientId: { $in: perimeter } }, { $set: restriction }, { multi: true });
    counts.meetingReports = await MeetingReportsCollection.updateAsync(reportsOf(perimeter, bankAccountIds), { $set: restriction }, { multi: true });
    counts.sizeableReviews = await SizeableTransactionReviewsCollection.updateAsync(reportsOf(perimeter, bankAccountIds), { $set: restriction }, { multi: true });

    // 4. No lawful basis to keep: marketing leads, sessions, reset tokens.
    counts.leads = allEmails.length ? await LandingLeadsCollection.removeAsync({ email: { $in: allEmails } }) : 0;
    counts.sessions = await SessionsCollection.removeAsync({ userId: { $in: perimeter } });
    counts.resetTokens = await PasswordResetTokensCollection.removeAsync({
      $or: [{ userId: { $in: perimeter } }, ...(allEmails.length ? [{ email: { $in: allEmails } }] : [])]
    });

    // Append-only register entry — no PII, counts and the scheduled destruction date.
    await GdprRegisterCollection.insertAsync({
      action: 'restrict',
      entityId,
      perimeterSize: perimeter.length,
      counts,
      archivedAt: entity.archivedAt,
      retentionUntil,
      performedBy: actor._id,
      performedAt: now
    });

    await AuditLog.record({
      actorUserId: actor._id,
      actorRole: actor.role,
      action: 'gdpr.restrict',
      targetType: 'clientEntity',
      targetId: entityId,
      meta: { counts, retentionUntil }
    });
    console.log(`[GDPR] Entity ${entityId} restricted by ${actor._id} until ${retentionUntil.toISOString()}:`, JSON.stringify(counts));
    return { retentionUntil, retentionUntilText: formatRetentionEnd(retentionUntil), counts };
  },

  /**
   * Hard delete of a marketing lead (prospect with no financial history).
   */
  async 'gdpr.deleteLead'(sessionId, leadId) {
    check(sessionId, String);
    check(leadId, String);
    const actor = await validateSuperadminSession(sessionId);

    const removed = await LandingLeadsCollection.removeAsync(leadId);

    await GdprRegisterCollection.insertAsync({
      action: 'deleteLead',
      leadId,
      removed,
      performedBy: actor._id,
      performedAt: new Date()
    });
    await AuditLog.record({
      actorUserId: actor._id,
      actorRole: actor.role,
      action: 'gdpr.deleteLead',
      targetType: 'lead',
      targetId: leadId
    });
    return { removed };
  },

  /**
   * Query the audit trail (superadmin). Filters: action, targetId, actorUserId,
   * since (Date). Returns newest first, capped at 500 rows.
   */
  async 'auditLog.query'(sessionId, filters = {}) {
    check(sessionId, String);
    check(filters, Object);
    await validateSuperadminSession(sessionId);

    const query = {};
    if (typeof filters.action === 'string') query.action = filters.action;
    if (typeof filters.targetId === 'string') query.targetId = filters.targetId;
    if (typeof filters.actorUserId === 'string') query.actorUserId = filters.actorUserId;
    if (filters.since) query.at = { $gte: new Date(filters.since) };

    return await AuditLogCollection.find(query, {
      sort: { at: -1 },
      limit: Math.min(Number(filters.limit) || 200, 500)
    }).fetchAsync();
  }
});
