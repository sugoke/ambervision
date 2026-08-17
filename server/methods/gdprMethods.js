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
import { ClientDocumentsCollection } from '../../imports/api/clientDocuments.js';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { NotificationsCollection } from '../../imports/api/notifications.js';
import { LandingLeadsCollection } from '../../imports/api/landingLeads.js';
import { PasswordResetTokensCollection } from '../../imports/api/passwordResetTokens.js';
import { AuditLog, AuditLogCollection } from '../../imports/api/auditLog.js';

/**
 * GDPR data-subject-rights tooling.
 *
 * - gdpr.exportClientData  — Art. 15/20: full data bundle for one client entity.
 * - gdpr.anonymizeClient   — Art. 17 with AML retention: strips all identity and
 *   free-text data but KEEPS account-level financial records (holdings, operations,
 *   allocations, snapshots) under a pseudonymised entity, as required for
 *   regulated record-keeping. Irreversible.
 * - gdpr.deleteLead        — hard delete of a marketing lead (no financial history).
 *
 * Every erasure is recorded in the append-only `gdprRegister` collection
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

const resolveFichierCentralBase = () => {
  if (process.env.FICHIER_CENTRAL_PATH) return process.env.FICHIER_CENTRAL_PATH;
  let projectRoot = process.cwd();
  if (projectRoot.includes('.meteor')) {
    projectRoot = projectRoot.split('.meteor')[0].replace(/[\\/]$/, '');
  }
  return path.join(projectRoot, '.fichier_central');
};

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
      const exportsDir = path.join(resolveFichierCentralBase(), 'gdpr_exports');
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
   * Art. 17 (with AML retention) — irreversibly strip identity and free-text
   * data for a client entity while keeping the financial records. Requires the
   * caller to retype the entity's display name as confirmation.
   */
  async 'gdpr.anonymizeClient'(sessionId, entityId, confirmName) {
    check(sessionId, String);
    check(entityId, String);
    check(confirmName, String);
    const actor = await validateSuperadminSession(sessionId);

    const entity = await ClientEntitiesCollection.findOneAsync(entityId);
    if (!entity) throw new Meteor.Error('not-found', 'Client entity not found');
    if (entity.gdprErasedAt) throw new Meteor.Error('already-erased', 'This entity has already been anonymised');

    const displayName = ClientEntityHelpers.getEntityDisplayName(entity);
    if (confirmName.trim().toLowerCase() !== displayName.trim().toLowerCase()) {
      throw new Meteor.Error('confirmation-mismatch',
        `Confirmation name does not match the entity display name ("${displayName}")`);
    }

    const perimeter = await resolveClientPerimeter(entity);
    const pseudonym = `ERASED-${entityId.slice(0, 6)}`;
    const counts = {};
    const basePath = resolveFichierCentralBase();

    // Collect user emails BEFORE scrambling (needed for lead/notification cleanup).
    const users = await UsersCollection.find(
      { _id: { $in: perimeter } },
      { fields: { email: 1, role: 1 } }
    ).fetchAsync();
    const userEmails = users.map(u => u.email).filter(Boolean);
    const entityEmail = entity.profile?.email || null;
    const allEmails = [...new Set([...userEmails, entityEmail].filter(Boolean))];

    // 1. clientEntities: strip identity, KYC, FATCA, stakeholders, family.
    counts.entity = 1;
    await ClientEntitiesCollection.updateAsync(entityId, {
      $set: {
        profile: {
          ...(entity.type === 'physical_person'
            ? { firstName: '', lastName: pseudonym }
            : { companyName: pseudonym }),
          updatedAt: new Date()
        },
        status: 'archived',
        isActive: false,
        gdprErasedAt: new Date(),
        gdprErasedBy: actor._id
      },
      $unset: { kyc: '', usPerson: '', stakeholders: '', kycRiskScore: '', kycRiskScoreHistory: '' }
    });

    // 2. customUsers in the perimeter (client accounts only — never staff).
    const STAFF_ROLES = ['superadmin', 'admin', 'relationship_manager', 'assistant', 'compliance', 'staff'];
    counts.users = 0;
    for (const u of users) {
      if (STAFF_ROLES.includes(u.role)) continue;
      await UsersCollection.updateAsync(u._id, {
        $set: {
          email: `${pseudonym.toLowerCase()}-${u._id}@erased.invalid`,
          username: `${pseudonym.toLowerCase()}-${u._id}`,
          password: crypto.randomBytes(48).toString('hex'), // unusable non-scrypt value
          isActive: false,
          profile: { lastName: pseudonym, updatedAt: new Date() },
          gdprErasedAt: new Date()
        }
      });
      counts.users++;
    }

    // 3. bankAccounts: strip contact fields; account number stays (AML re-identification
    //    is restricted to the firm — that is permitted pseudonymisation, not identification).
    const accountsRes = await BankAccountsCollection.updateAsync(
      { $or: [{ entityId: { $in: perimeter } }, { userId: { $in: perimeter } }] },
      { $set: { comment: null }, $unset: { authorizedEmail: '', authorizedCcEmails: '', authorizedPhone: '', name: '' } },
      { multi: true }
    );
    counts.bankAccounts = accountsRes;
    const bankAccountIds = (await BankAccountsCollection.find(
      { $or: [{ entityId: { $in: perimeter } }, { userId: { $in: perimeter } }] },
      { fields: { _id: 1 } }
    ).fetchAsync()).map(a => a._id);

    // 4. meetingReports: remove all free text and the name snapshot; delete PDFs.
    const reports = await MeetingReportsCollection.find({
      $or: [{ entityId: { $in: perimeter } }, { bankAccountId: { $in: bankAccountIds } }]
    }, { fields: { pdfPath: 1 } }).fetchAsync();
    counts.meetingReports = reports.length;
    for (const r of reports) {
      if (r.pdfPath) {
        try { if (fs.existsSync(r.pdfPath)) fs.unlinkSync(r.pdfPath); } catch (e) { /* best effort */ }
      }
      await MeetingReportsCollection.updateAsync(r._id, {
        $set: {
          clientNameSnapshot: pseudonym,
          rawNotes: '',
          sections: {},
          location: '',
          pdfPath: null,
          gdprErasedAt: new Date()
        },
        $unset: { satisfaction: '' }
      });
    }

    // 5. orders: strip notes/recipient/phone traces; delete email-trace files.
    const orders = await OrdersCollection.find(
      { clientId: { $in: perimeter } },
      { fields: { emailTraces: 1 } }
    ).fetchAsync();
    counts.orders = orders.length;
    counts.orderTraceFilesDeleted = 0;
    for (const o of orders) {
      const traceDir = path.join(basePath, 'orders', o._id);
      if (removeDirIfExists(traceDir)) counts.orderTraceFilesDeleted++;
      await OrdersCollection.updateAsync(o._id, {
        $set: {
          notes: null,
          sentTo: null,
          emailTraces: [],
          gdprErasedTraces: (o.emailTraces || []).length,
          gdprErasedAt: new Date()
        }
      });
    }

    // 6. clientDocuments: delete rows AND the ID/KYC files on disk.
    const docs = await ClientDocumentsCollection.find({ userId: { $in: perimeter } }).fetchAsync();
    counts.documents = docs.length;
    for (const doc of docs) {
      try {
        if (doc.filePath && fs.existsSync(doc.filePath)) fs.unlinkSync(doc.filePath);
      } catch (e) { /* best effort */ }
      await ClientDocumentsCollection.removeAsync(doc._id);
    }
    // Whole per-subject folders (covers stray files) + entity docs (closure letters).
    for (const id of perimeter) {
      removeDirIfExists(path.join(basePath, id));
    }
    removeDirIfExists(path.join(basePath, 'entities', entityId));

    // 7. landingLeads matching the client's emails: hard delete.
    counts.leads = allEmails.length
      ? await LandingLeadsCollection.removeAsync({ email: { $in: allEmails } })
      : 0;

    // 8. sessions + password reset tokens: purge.
    counts.sessions = await SessionsCollection.removeAsync({ userId: { $in: perimeter } });
    counts.resetTokens = await PasswordResetTokensCollection.removeAsync({
      $or: [{ userId: { $in: perimeter } }, ...(allEmails.length ? [{ email: { $in: allEmails } }] : [])]
    });

    // 9. notifications: pull the client's emails from recipient lists.
    counts.notificationEmailPulls = allEmails.length
      ? await NotificationsCollection.updateAsync(
          { sentToEmails: { $in: allEmails } },
          { $pull: { sentToEmails: { $in: allEmails } } },
          { multi: true }
        )
      : 0;

    // KEPT deliberately (AML/CFT record-keeping): pmsHoldings, pmsOperations,
    // portfolioSnapshots, allocations — all keyed to the pseudonymised entity.

    // Append-only register entry — no PII, counts only.
    await GdprRegisterCollection.insertAsync({
      action: 'anonymize',
      entityId,
      pseudonym,
      perimeterSize: perimeter.length,
      counts,
      performedBy: actor._id,
      performedAt: new Date()
    });

    await AuditLog.record({
      actorUserId: actor._id,
      actorRole: actor.role,
      action: 'gdpr.anonymize',
      targetType: 'clientEntity',
      targetId: entityId,
      meta: { counts }
    });
    console.log(`[GDPR] Entity ${entityId} anonymised as ${pseudonym} by ${actor._id}:`, JSON.stringify(counts));
    return { pseudonym, counts };
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
