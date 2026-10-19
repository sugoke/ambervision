import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { Random } from 'meteor/random';
import fs from 'fs';
import path from 'path';
import { SessionHelpers } from '../../imports/api/sessions.js';
import { issueDocumentToken } from '../documentAccess.js';
import { getSizeableEvidenceDir } from '../../imports/api/documentStorage.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { ClientEntitiesCollection, ClientEntityHelpers } from '../../imports/api/clientEntities.js';
import { BankAccountsCollection } from '../../imports/api/bankAccounts.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { PMSOperationsCollection } from '../../imports/api/pmsOperations.js';
import { PMSHoldingsCollection } from '../../imports/api/pmsHoldings.js';
import { CurrencyRateCacheCollection } from '../../imports/api/currencyCache.js';
import { OPERATION_TYPES } from '../../imports/api/constants/operationTypes.js';
import { buildRatesMap, extractBankFxRates, mergeRatesMaps } from '../../imports/api/helpers/cashCalculator.js';
import { getSignedFlowAmountEUR } from '../../imports/api/helpers/twrCalculator.js';
import { NotificationHelpers, EVENT_TYPES } from '../../imports/api/notifications.js';
import { AuditLog } from '../../imports/api/auditLog.js';
import {
  SizeableTransactionReviewsCollection,
  SIZEABLE_SINGLE_THRESHOLD_EUR,
  SIZEABLE_MONTHLY_THRESHOLD_EUR,
  SIZEABLE_KINDS,
  SIZEABLE_STATUSES,
  SIZEABLE_STATUS_LABELS,
  SIZEABLE_STATUS_COLORS
} from '../../imports/api/sizeableTransactions.js';

/**
 * Sizeable transactions: AML monitoring of client money flows.
 *
 * Reads external flows (money received by / sent from the client) from
 * PMSOperations, converts them to EUR with the same rates as the TWR
 * calculation (bank-provided rates first, EOD fallback), and raises a review
 * for every single movement >= 100k EUR and every bank account whose flows in
 * one direction cumulate >= 300k EUR over a calendar month.
 *
 * Compliance questions the RM, the RM answers, compliance closes the review.
 * Every row returned to the UI is display-ready.
 */

const COMPLIANCE_ROLES = [USER_ROLES.SUPERADMIN, USER_ROLES.COMPLIANCE];
const RM_ROLES = [USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ASSISTANT, USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN];

const EXTERNAL_FLOW_TYPES = [
  OPERATION_TYPES.TRANSFER_IN,
  OPERATION_TYPES.TRANSFER_OUT,
  OPERATION_TYPES.PAYMENT_IN,
  OPERATION_TYPES.PAYMENT_OUT
];

const OPERATION_TYPE_LABELS = {
  [OPERATION_TYPES.TRANSFER_IN]: 'Transfer in',
  [OPERATION_TYPES.TRANSFER_OUT]: 'Transfer out',
  [OPERATION_TYPES.PAYMENT_IN]: 'Payment in',
  [OPERATION_TYPES.PAYMENT_OUT]: 'Payment out'
};

// A scan covers the current calendar year (from 1 January)
const scanStartDate = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
// A dashboard refresh does not rescan more often than this
const SCAN_THROTTLE_MS = 60 * 1000;
let lastScanAt = 0;

const MAX_TEXT_LENGTH = 4000;

// ── Supporting documents (evidence attached to a review) ──
//
// Same allowlist discipline as client documents: the stored extension comes
// from this list, never from the client's filename, and extension and MIME
// must agree. Files live under <fichier_central>/sizeable/<reviewId>/ and are
// served by the /sizeable_evidence handler behind a capability token.
const EVIDENCE_WORD_EXTENSIONS = new Set(['.doc', '.docx']);
const EVIDENCE_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.tif', '.tiff',
  ...EVIDENCE_WORD_EXTENSIONS
]);
const EVIDENCE_MIME_PREFIXES = ['image/', 'application/pdf'];
const EVIDENCE_WORD_MIMES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024; // 25 MB
const MAX_EVIDENCE_PER_REVIEW = 30;
const SIZEABLE_EVIDENCE_URL_PREFIX = '/sizeable_evidence';

// Review ids are Meteor Random ids; stored filenames are built server-side
const isSafePathSegment = (value) => typeof value === 'string' && /^[A-Za-z0-9_.-]+$/.test(value) && !value.includes('..');

const formatSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// ── Formatting (the UI only displays these strings) ──

const formatEUR = (value) => `EUR ${Math.round(value).toLocaleString('en-GB')}`;

const formatAmount = (value, currency) =>
  `${currency || ''} ${Math.abs(value || 0).toLocaleString('en-GB', { maximumFractionDigits: 2 })}`.trim();

const formatDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  : '');

const formatDateTime = (d) => (d
  ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '');

const periodOf = (date) => new Date(date).toISOString().slice(0, 7);

const formatPeriod = (period) => new Date(`${period}-01T00:00:00Z`)
  .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

const userName = (user) => (user
  ? `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.username || user.email
  : '');

// Bank account numbers may carry a "-N" sub-portfolio suffix in bank files
const accountBase = (portfolioCode) => String(portfolioCode || '').split('-')[0];

// ── Session ──

async function validateSession(sessionId, allowedRoles) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }
  const session = await SessionHelpers.findByToken(sessionId);
  if (!session) throw new Meteor.Error('not-authorized', 'Invalid session');
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user || !allowedRoles.includes(user.role)) {
    throw new Meteor.Error('not-authorized', 'You are not allowed to access sizeable transactions');
  }
  return user;
}

const isCompliance = (user) => COMPLIANCE_ROLES.includes(user.role);

/**
 * Who may see and corroborate a review: compliance, admins, and the RMs the
 * account is assigned to. Same perimeter as the answer method.
 */
const canAccessReview = (user, review) =>
  isCompliance(user)
  || [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN].includes(user.role)
  || (review.rmIds || []).includes(user._id);

/** Compliance owns the file; an RM's window closes with the review. */
const canEditEvidence = (user, review) =>
  canAccessReview(user, review) && (isCompliance(user) || review.status !== SIZEABLE_STATUSES.DONE);

async function loadReviewFor(user, reviewId) {
  const review = await SizeableTransactionReviewsCollection.findOneAsync(reviewId);
  if (!review) throw new Meteor.Error('not-found', 'Review not found');
  if (!canAccessReview(user, review)) {
    throw new Meteor.Error('not-authorized', 'You are not the relationship manager of this account');
  }
  return review;
}

/** <fichier_central>/sizeable/<reviewId>, created on first write, never outside the root. */
function evidenceDirFor(reviewId) {
  if (!isSafePathSegment(reviewId)) throw new Meteor.Error('invalid-argument', 'Invalid review id');
  const base = path.resolve(getSizeableEvidenceDir());
  const dir = path.resolve(path.join(base, reviewId));
  if (dir !== base && !dir.startsWith(base + path.sep)) {
    throw new Meteor.Error('invalid-argument', 'Resolved path escapes storage root');
  }
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Detection ──

async function buildFlowRatesMap() {
  const currencyRates = await CurrencyRateCacheCollection.find({}).fetchAsync();
  const recentHoldings = await PMSHoldingsCollection.find(
    { bankFxRates: { $exists: true } },
    { fields: { bankFxRates: 1 }, sort: { updatedAt: -1 }, limit: 500 }
  ).fetchAsync();
  return mergeRatesMaps(buildRatesMap(currencyRates), extractBankFxRates(recentHoldings));
}

// Real ISINs only: some banks (CMB) put internal cash codes in the isin field
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const isSecuritiesMovement = (op) => ISIN_PATTERN.test(String(op.isin || '').trim());

const describeOperation = (op, eurAmount) => {
  const currency = op.operationCurrency || op.currency || op.settlementCurrency || 'EUR';
  const raw = op.amountPortfolioCcy != null && op.amountPortfolioCcy !== 0
    ? op.amountPortfolioCcy
    : (op.netAmount || op.grossAmount || 0);
  return {
    operationId: op._id,
    dateText: formatDate(op.operationDate),
    typeLabel: OPERATION_TYPE_LABELS[op.operationType] || op.operationType,
    assetLabel: isSecuritiesMovement(op) ? `Securities · ${String(op.isin).trim()}` : 'Cash',
    isSecurities: isSecuritiesMovement(op),
    description: op.std?.description || op.text || op.description || op.operationTypeName || op.originalOperationType || '',
    amountText: formatAmount(raw, op.amountPortfolioCcy ? 'EUR' : currency),
    amountEURText: formatEUR(Math.abs(eurAmount))
  };
};

/**
 * Scan recent external flows and create / refresh review documents.
 * Workflow fields (status, thread, closure) are never overwritten, except that
 * a closed monthly review is reopened when new operations join its month.
 */
export async function scanSizeableTransactions({ force = false } = {}) {
  if (!force && Date.now() - lastScanAt < SCAN_THROTTLE_MS) return { skipped: true };
  lastScanAt = Date.now();

  const fromDate = scanStartDate();

  const operations = await PMSOperationsCollection.find({
    isActive: true,
    operationType: { $in: EXTERNAL_FLOW_TYPES },
    operationDate: { $gte: fromDate }
  }, { sort: { operationDate: 1 } }).fetchAsync();

  if (operations.length === 0) return { scanned: 0, flagged: 0 };

  const ratesMap = await buildFlowRatesMap();

  // Candidates keyed by review key
  const candidates = new Map();
  const monthly = new Map();

  for (const op of operations) {
    if (!op.operationDate || !op.portfolioCode) continue;
    const signedEUR = getSignedFlowAmountEUR(op, ratesMap);
    const absEUR = Math.abs(signedEUR);
    if (!absEUR) continue;

    const direction = signedEUR >= 0 ? 'in' : 'out';
    const account = accountBase(op.portfolioCode);
    const period = periodOf(op.operationDate);
    const described = describeOperation(op, signedEUR);

    if (absEUR >= SIZEABLE_SINGLE_THRESHOLD_EUR) {
      const key = `single|${op.uniqueKey || op._id}`;
      candidates.set(key, {
        key, kind: SIZEABLE_KINDS.SINGLE, direction, period,
        operationDate: op.operationDate,
        bankId: op.bankId, account, entityId: op.entityId || null,
        amountEUR: absEUR, thresholdEUR: SIZEABLE_SINGLE_THRESHOLD_EUR,
        operationIds: [op._id], operations: [described]
      });
    }

    const monthKey = `monthly|${op.bankId}|${account}|${period}|${direction}`;
    const group = monthly.get(monthKey) || {
      key: monthKey, kind: SIZEABLE_KINDS.MONTHLY, direction, period,
      bankId: op.bankId, account, entityId: op.entityId || null,
      amountEUR: 0, thresholdEUR: SIZEABLE_MONTHLY_THRESHOLD_EUR,
      operationIds: [], operations: []
    };
    group.amountEUR += absEUR;
    group.operationIds.push(op._id);
    group.operations.push(described);
    if (!group.entityId && op.entityId) group.entityId = op.entityId;
    monthly.set(monthKey, group);
  }

  // A month made of one movement is already covered by that movement's single
  // flag, so the monthly rule only adds cumulations of several movements
  for (const [key, group] of monthly) {
    if (group.amountEUR >= SIZEABLE_MONTHLY_THRESHOLD_EUR && group.operationIds.length > 1) candidates.set(key, group);
  }

  if (candidates.size === 0) return { scanned: operations.length, flagged: 0 };

  // Reference data for the flagged accounts only
  const flagged = [...candidates.values()];
  const bankIds = [...new Set(flagged.map(c => c.bankId).filter(Boolean))];
  const [banks, accounts] = await Promise.all([
    BanksCollection.find({ _id: { $in: bankIds } }, { fields: { name: 1 } }).fetchAsync(),
    BankAccountsCollection.find(
      { bankId: { $in: bankIds }, isActive: true },
      { fields: { bankId: 1, accountNumber: 1, entityId: 1, relationshipManagerId: 1, backupRmIds: 1 } }
    ).fetchAsync()
  ]);
  const bankName = Object.fromEntries(banks.map(b => [b._id, b.name]));
  const accountByKey = new Map(accounts.map(a => [`${a.bankId}|${accountBase(a.accountNumber)}`, a]));

  const entityIds = new Set(flagged.map(c => c.entityId).filter(Boolean));
  accounts.forEach(a => a.entityId && entityIds.add(a.entityId));
  const entities = await ClientEntitiesCollection.find({ _id: { $in: [...entityIds] } }).fetchAsync();
  const entityById = new Map(entities.map(e => [e._id, e]));

  // The account's own RM and backups are the ones questioned, whatever their
  // role (a superadmin can be the RM). The client's RM and assigned users only
  // stand in when the account has none, so a former assignee on the client
  // does not take over an account managed by someone else.
  const rmCache = new Map();
  const rmsFor = async (account, entity) => {
    const cacheKey = `${account?._id}|${entity?._id}`;
    if (!rmCache.has(cacheKey)) {
      let ids = account ? [account.relationshipManagerId, ...(account.backupRmIds || [])].filter(Boolean) : [];
      if (ids.length === 0 && entity) ids = [entity.relationshipManagerId, ...(entity.assignedUserIds || [])].filter(Boolean);
      ids = [...new Set(ids)];
      const staff = ids.length ? await UsersCollection.find(
        { _id: { $in: ids }, role: { $ne: USER_ROLES.CLIENT }, deactivatedAt: { $exists: false } },
        { fields: { _id: 1 } }
      ).fetchAsync() : [];
      const staffIds = new Set(staff.map(u => u._id));
      rmCache.set(cacheKey, ids.filter(id => staffIds.has(id)));
    }
    return rmCache.get(cacheKey);
  };

  let created = 0;
  let reopened = 0;

  for (const c of flagged) {
    const account = accountByKey.get(`${c.bankId}|${c.account}`);
    const entityId = c.entityId || account?.entityId || null;
    const entity = entityId ? entityById.get(entityId) : null;
    const detection = {
      kind: c.kind,
      direction: c.direction,
      period: c.period,
      operationDate: c.operationDate || null,
      bankId: c.bankId,
      bankName: bankName[c.bankId] || '',
      portfolioCode: c.account,
      bankAccountId: account?._id || null,
      entityId,
      clientName: entity ? ClientEntityHelpers.getEntityDisplayName(entity) : c.account,
      rmIds: await rmsFor(account, entity),
      amountEUR: c.amountEUR,
      thresholdEUR: c.thresholdEUR,
      operationIds: c.operationIds,
      operations: c.operations
    };

    const existing = await SizeableTransactionReviewsCollection.findOneAsync({ key: c.key });
    if (!existing) {
      await SizeableTransactionReviewsCollection.insertAsync({
        key: c.key,
        ...detection,
        status: SIZEABLE_STATUSES.OPEN,
        thread: [],
        createdAt: new Date(),
        updatedAt: new Date()
      });
      created++;
      continue;
    }

    const knownIds = new Set(existing.operationIds || []);
    const hasNewOperations = c.operationIds.some(id => !knownIds.has(id));
    const modifier = { $set: { ...detection, updatedAt: new Date() } };
    if (existing.status === SIZEABLE_STATUSES.DONE && hasNewOperations) {
      modifier.$set.status = SIZEABLE_STATUSES.OPEN;
      modifier.$push = {
        thread: {
          at: new Date(), byUserId: null, byName: 'System', role: 'system',
          text: `Reopened: new operations were booked for this month after closure (total now ${formatEUR(c.amountEUR)}).`
        }
      };
      reopened++;
    }
    await SizeableTransactionReviewsCollection.updateAsync(existing._id, modifier);
  }

  console.log(`[SizeableTransactions] Scanned ${operations.length} flows, ${flagged.length} flags (${created} new, ${reopened} reopened)`);
  return { scanned: operations.length, flagged: flagged.length, created, reopened };
}

// ── Display rows ──

/**
 * Display rows. `viewer` (the user the rows are returned to) decides which
 * attached documents they may remove, so the UI only reads a flag.
 */
async function toRows(reviews, viewer = null) {
  const userIds = new Set();
  reviews.forEach(r => {
    (r.rmIds || []).forEach(id => userIds.add(id));
    (r.thread || []).forEach(t => t.byUserId && userIds.add(t.byUserId));
    (r.documents || []).forEach(d => d.uploadedBy && userIds.add(d.uploadedBy));
  });
  const users = await UsersCollection.find(
    { _id: { $in: [...userIds] } },
    { fields: { profile: 1, username: 1, email: 1 } }
  ).fetchAsync();
  const nameById = Object.fromEntries(users.map(u => [u._id, userName(u)]));

  return reviews.map(r => {
    const isSingle = r.kind === SIZEABLE_KINDS.SINGLE;
    return {
      _id: r._id,
      kind: r.kind,
      kindLabel: isSingle ? 'Single ≥ 100k' : 'Monthly ≥ 300k',
      directionLabel: r.direction === 'in' ? '↓ Received' : '↑ Sent',
      isIncoming: r.direction === 'in',
      whenText: isSingle ? formatDate(r.operationDate) : formatPeriod(r.period),
      period: r.period,
      periodText: formatPeriod(r.period),
      clientName: r.clientName,
      entityId: r.entityId,
      bankName: r.bankName,
      accountText: [r.bankName, r.portfolioCode].filter(Boolean).join(' · '),
      amountEURText: formatEUR(r.amountEUR),
      operationCountText: `${(r.operations || []).length} operation${(r.operations || []).length > 1 ? 's' : ''}`,
      assetText: (r.operations || []).some(o => o.isSecurities)
        ? ((r.operations || []).every(o => o.isSecurities) ? 'Securities' : 'Cash + securities')
        : 'Cash',
      operations: r.operations || [],
      rmNamesText: (r.rmIds || []).map(id => nameById[id]).filter(Boolean).join(', '),
      hasRm: (r.rmIds || []).length > 0,
      status: r.status,
      statusLabel: SIZEABLE_STATUS_LABELS[r.status] || r.status,
      statusColor: SIZEABLE_STATUS_COLORS[r.status] || 'var(--text-muted)',
      isDone: r.status === SIZEABLE_STATUSES.DONE,
      thread: (r.thread || []).map(t => ({
        atText: formatDateTime(t.at),
        byName: t.byName || nameById[t.byUserId] || '',
        role: t.role,
        roleLabel: t.role === 'compliance' ? 'Compliance' : t.role === 'rm' ? 'RM' : 'System',
        text: t.text
      })),
      closedText: r.status === SIZEABLE_STATUSES.DONE && r.closedAt
        ? `Closed by ${r.closedByName || ''} on ${formatDateTime(r.closedAt)}`
        : '',
      closingNote: r.closingNote || '',
      documents: (r.documents || []).map(d => ({
        _id: d._id,
        fileName: d.fileName,
        metaText: [
          d.role === 'compliance' ? 'Compliance' : 'RM',
          d.uploadedByName || nameById[d.uploadedBy] || '',
          formatDateTime(d.uploadedAt),
          formatSize(d.fileSize)
        ].filter(Boolean).join(' · '),
        canRemove: !!viewer && canEditEvidence(viewer, r) && (isCompliance(viewer) || d.uploadedBy === viewer._id)
      })),
      documentCountText: (r.documents || []).length
        ? `${r.documents.length} document${r.documents.length > 1 ? 's' : ''}`
        : '',
      canAttach: !!viewer && canEditEvidence(viewer, r)
    };
  });
}

const sortReviews = (a, b) => {
  const aDate = a.operationDate ? new Date(a.operationDate) : new Date(`${a.period}-28T00:00:00Z`);
  const bDate = b.operationDate ? new Date(b.operationDate) : new Date(`${b.period}-28T00:00:00Z`);
  return bDate - aDate || b.amountEUR - a.amountEUR;
};

// Reviews of archived clients are no longer followed: hidden from every list and count
async function notArchivedSelector() {
  const { entityIds, bankAccountIds } = await ClientEntityHelpers.getArchivedExclusion();
  return { entityId: { $nin: entityIds }, bankAccountId: { $nin: bankAccountIds } };
}

async function statusCounts() {
  const live = await notArchivedSelector();
  const counts = { all: 0 };
  for (const status of Object.values(SIZEABLE_STATUSES)) {
    counts[status] = await SizeableTransactionReviewsCollection.find({ status, ...live }).countAsync();
    counts.all += counts[status];
  }
  counts.pending = counts.all - counts[SIZEABLE_STATUSES.DONE];
  return counts;
}

export async function getSizeableSummary() {
  return statusCounts();
}

const cleanText = (text) => String(text || '').trim().slice(0, MAX_TEXT_LENGTH);

const reviewTitle = (review) => `${review.clientName} (${[review.bankName, review.portfolioCode].filter(Boolean).join(' ')})`;

Meteor.methods({
  /**
   * Compliance: every review (optionally filtered), after a fresh scan.
   */
  async 'sizeableTransactions.list'({ status = 'pending', period = null } = {}, sessionId) {
    this.unblock();
    check(status, String);
    check(period, Match.Maybe(String));
    check(sessionId, String);
    const user = await validateSession(sessionId, COMPLIANCE_ROLES);

    try {
      await scanSizeableTransactions();
    } catch (err) {
      console.error('[SizeableTransactions] Scan failed:', err);
    }

    const query = await notArchivedSelector();
    if (status === 'pending') query.status = { $ne: SIZEABLE_STATUSES.DONE };
    else if (status !== 'all') query.status = status;
    if (period) query.period = period;

    const reviews = (await SizeableTransactionReviewsCollection.find(query).fetchAsync()).sort(sortReviews);
    const periods = (await SizeableTransactionReviewsCollection.rawCollection().distinct('period'))
      .filter(Boolean).sort().reverse()
      .map(p => ({ value: p, label: formatPeriod(p) }));

    return {
      rows: await toRows(reviews, user),
      counts: await statusCounts(),
      periods,
      rulesText: `Single movement ≥ ${formatEUR(SIZEABLE_SINGLE_THRESHOLD_EUR)} · Monthly total per account and direction ≥ ${formatEUR(SIZEABLE_MONTHLY_THRESHOLD_EUR)} · since ${formatDate(scanStartDate())}`
    };
  },

  /**
   * Compliance: question the RM(s) of the account about a review.
   */
  async 'sizeableTransactions.ask'({ reviewId, question }, sessionId) {
    check(reviewId, String);
    check(question, String);
    check(sessionId, String);
    const user = await validateSession(sessionId, COMPLIANCE_ROLES);
    const text = cleanText(question);
    if (!text) throw new Meteor.Error('invalid', 'Please write a question');

    const review = await SizeableTransactionReviewsCollection.findOneAsync(reviewId);
    if (!review) throw new Meteor.Error('not-found', 'Review not found');
    if (review.status === SIZEABLE_STATUSES.DONE) throw new Meteor.Error('invalid', 'This review is already closed');
    if (!(review.rmIds || []).length) {
      throw new Meteor.Error('no-rm', 'No relationship manager is assigned to this account — assign one in Contacts first');
    }

    await SizeableTransactionReviewsCollection.updateAsync(reviewId, {
      $set: { status: SIZEABLE_STATUSES.QUESTIONED, updatedAt: new Date() },
      $push: { thread: { at: new Date(), byUserId: user._id, byName: userName(user), role: 'compliance', text } }
    });

    const [row] = await toRows([review]);
    for (const rmId of review.rmIds) {
      await NotificationHelpers.create({
        userId: rmId,
        type: 'warning',
        eventType: EVENT_TYPES.COMPLIANCE_QUERY,
        title: `Compliance question — ${reviewTitle(review)}`,
        message: `${row.kindLabel} · ${row.directionLabel} ${row.amountEURText} (${row.whenText}). ${userName(user)} asks: ${text}`,
        metadata: { sizeableReviewId: reviewId, entityId: review.entityId || null, bankAccountId: review.bankAccountId || null }
      });
    }

    await AuditLog.record({
      actorUserId: user._id, actorRole: user.role, action: 'sizeableTransaction.ask',
      targetType: 'sizeableTransaction', targetId: reviewId, meta: { rmIds: review.rmIds }
    });
    return { ok: true };
  },

  /**
   * RM: the reviews they are questioned on (plus recently closed ones).
   */
  async 'sizeableTransactions.listForRm'(sessionId) {
    this.unblock();
    check(sessionId, String);
    const user = await validateSession(sessionId, RM_ROLES);

    const recent = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const reviews = await SizeableTransactionReviewsCollection.find({
      ...(await notArchivedSelector()),
      rmIds: user._id,
      $or: [
        { status: { $in: [SIZEABLE_STATUSES.QUESTIONED, SIZEABLE_STATUSES.ANSWERED] } },
        { status: SIZEABLE_STATUSES.DONE, closedAt: { $gte: recent }, 'thread.role': 'rm' }
      ]
    }).fetchAsync();

    const order = { [SIZEABLE_STATUSES.QUESTIONED]: 0, [SIZEABLE_STATUSES.ANSWERED]: 1, [SIZEABLE_STATUSES.DONE]: 2 };
    reviews.sort((a, b) => (order[a.status] - order[b.status]) || sortReviews(a, b));
    const rows = await toRows(reviews, user);
    return {
      rows,
      toAnswerCount: rows.filter(r => r.status === SIZEABLE_STATUSES.QUESTIONED).length
    };
  },

  /**
   * RM: send the explanation back to compliance.
   */
  async 'sizeableTransactions.answer'({ reviewId, answer }, sessionId) {
    check(reviewId, String);
    check(answer, String);
    check(sessionId, String);
    const user = await validateSession(sessionId, RM_ROLES);
    const text = cleanText(answer);
    if (!text) throw new Meteor.Error('invalid', 'Please write an explanation');

    const review = await SizeableTransactionReviewsCollection.findOneAsync(reviewId);
    if (!review) throw new Meteor.Error('not-found', 'Review not found');
    const isAssigned = (review.rmIds || []).includes(user._id);
    if (!isAssigned && ![USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN].includes(user.role)) {
      throw new Meteor.Error('not-authorized', 'You are not the relationship manager of this account');
    }
    if (![SIZEABLE_STATUSES.QUESTIONED, SIZEABLE_STATUSES.ANSWERED].includes(review.status)) {
      throw new Meteor.Error('invalid', 'Compliance has not asked a question on this item');
    }

    await SizeableTransactionReviewsCollection.updateAsync(reviewId, {
      $set: { status: SIZEABLE_STATUSES.ANSWERED, updatedAt: new Date() },
      $push: { thread: { at: new Date(), byUserId: user._id, byName: userName(user), role: 'rm', text } }
    });

    // Notify the compliance officers who asked on this item
    const askers = [...new Set((review.thread || []).filter(t => t.role === 'compliance' && t.byUserId).map(t => t.byUserId))];
    for (const complianceId of askers) {
      await NotificationHelpers.create({
        userId: complianceId,
        type: 'info',
        eventType: EVENT_TYPES.COMPLIANCE_QUERY_ANSWERED,
        title: `RM answered — ${reviewTitle(review)}`,
        message: `${userName(user)}: ${text}`,
        metadata: { sizeableReviewId: reviewId, entityId: review.entityId || null, bankAccountId: review.bankAccountId || null }
      });
    }

    await AuditLog.record({
      actorUserId: user._id, actorRole: user.role, action: 'sizeableTransaction.answer',
      targetType: 'sizeableTransaction', targetId: reviewId
    });
    return { ok: true };
  },

  /**
   * Compliance: close a review (with or without a question to the RM).
   */
  async 'sizeableTransactions.markDone'({ reviewId, note = '' }, sessionId) {
    check(reviewId, String);
    check(note, String);
    check(sessionId, String);
    const user = await validateSession(sessionId, COMPLIANCE_ROLES);

    const review = await SizeableTransactionReviewsCollection.findOneAsync(reviewId);
    if (!review) throw new Meteor.Error('not-found', 'Review not found');
    if (review.status === SIZEABLE_STATUSES.DONE) return { ok: true };

    const closingNote = cleanText(note);
    const modifier = {
      $set: {
        status: SIZEABLE_STATUSES.DONE,
        closedBy: user._id,
        closedByName: userName(user),
        closedAt: new Date(),
        closingNote,
        updatedAt: new Date()
      }
    };
    if (closingNote) {
      modifier.$push = { thread: { at: new Date(), byUserId: user._id, byName: userName(user), role: 'compliance', text: `Closed: ${closingNote}` } };
    }
    await SizeableTransactionReviewsCollection.updateAsync(reviewId, modifier);

    await AuditLog.record({
      actorUserId: user._id, actorRole: user.role, action: 'sizeableTransaction.done',
      targetType: 'sizeableTransaction', targetId: reviewId, meta: { fromStatus: review.status }
    });
    return { ok: true };
  },

  /**
   * Compliance or the account's RM: attach a supporting document (bank
   * instruction, invoice, contract, source-of-funds letter…) to a review.
   * An RM's attachment counts as (part of) their answer: a questioned review
   * moves to "RM answered" and the compliance officers who asked are notified.
   */
  async 'sizeableTransactions.attachDocument'({ reviewId, fileName, base64Data, mimeType }, sessionId) {
    check(reviewId, String);
    check(fileName, String);
    check(base64Data, String);
    check(mimeType, String);
    check(sessionId, String);
    const user = await validateSession(sessionId, [...new Set([...COMPLIANCE_ROLES, ...RM_ROLES])]);
    const review = await loadReviewFor(user, reviewId);
    if (!canEditEvidence(user, review)) throw new Meteor.Error('invalid', 'This review is already closed');
    if ((review.documents || []).length >= MAX_EVIDENCE_PER_REVIEW) {
      throw new Meteor.Error('invalid', `At most ${MAX_EVIDENCE_PER_REVIEW} documents per review`);
    }

    const ext = (path.extname(fileName) || '').toLowerCase();
    if (!EVIDENCE_EXTENSIONS.has(ext)) {
      throw new Meteor.Error('invalid-argument', `Unsupported file type: ${ext || '(none)'} — PDF, Word or image`);
    }
    const mimeAllowed = EVIDENCE_MIME_PREFIXES.some(p => mimeType.startsWith(p)) || EVIDENCE_WORD_MIMES.has(mimeType);
    if (!mimeAllowed || EVIDENCE_WORD_EXTENSIONS.has(ext) !== EVIDENCE_WORD_MIMES.has(mimeType)) {
      throw new Meteor.Error('invalid-argument', `File type ${ext} does not match its content type`);
    }
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_EVIDENCE_BYTES) {
      throw new Meteor.Error('invalid-argument', 'File is empty or exceeds the 25 MB limit');
    }

    const storedFileName = `${Date.now()}_${Random.id(8)}${ext}`;
    const dir = evidenceDirFor(reviewId);
    try {
      fs.writeFileSync(path.join(dir, storedFileName), buffer);
    } catch (error) {
      console.error('[SizeableTransactions] Could not store evidence:', error);
      throw new Meteor.Error('file-system-error', 'Failed to save the document');
    }

    const role = isCompliance(user) ? 'compliance' : 'rm';
    const cleanName = cleanText(fileName).slice(0, 200) || storedFileName;
    const document = {
      _id: Random.id(),
      fileName: cleanName,
      storedFileName,
      mimeType,
      fileSize: buffer.length,
      uploadedAt: new Date(),
      uploadedBy: user._id,
      uploadedByName: userName(user),
      role
    };

    const modifier = {
      $set: { updatedAt: new Date() },
      $push: {
        documents: document,
        thread: { at: new Date(), byUserId: user._id, byName: userName(user), role, text: `Attached document: ${cleanName}` }
      }
    };
    const rmAnswers = role === 'rm' && review.status === SIZEABLE_STATUSES.QUESTIONED;
    if (rmAnswers) modifier.$set.status = SIZEABLE_STATUSES.ANSWERED;
    await SizeableTransactionReviewsCollection.updateAsync(reviewId, modifier);

    if (role === 'rm') {
      const askers = [...new Set((review.thread || []).filter(t => t.role === 'compliance' && t.byUserId).map(t => t.byUserId))];
      for (const complianceId of askers) {
        await NotificationHelpers.create({
          userId: complianceId,
          type: 'info',
          eventType: EVENT_TYPES.COMPLIANCE_QUERY_ANSWERED,
          title: `RM attached a document — ${reviewTitle(review)}`,
          message: `${userName(user)} attached "${cleanName}"`,
          metadata: { sizeableReviewId: reviewId, entityId: review.entityId || null, bankAccountId: review.bankAccountId || null }
        });
      }
    }

    await AuditLog.record({
      actorUserId: user._id, actorRole: user.role, action: 'sizeableTransaction.attachDocument',
      targetType: 'sizeableTransaction', targetId: reviewId,
      meta: { documentId: document._id, fileName: cleanName, fileSize: buffer.length }
    });
    return { ok: true, documentId: document._id };
  },

  /**
   * Remove an attached document: compliance at any time, an RM their own
   * uploads while the review is open. The file is deleted from disk and the
   * removal is kept in the conversation.
   */
  async 'sizeableTransactions.removeDocument'({ reviewId, documentId }, sessionId) {
    check(reviewId, String);
    check(documentId, String);
    check(sessionId, String);
    const user = await validateSession(sessionId, [...new Set([...COMPLIANCE_ROLES, ...RM_ROLES])]);
    const review = await loadReviewFor(user, reviewId);
    const document = (review.documents || []).find(d => d._id === documentId);
    if (!document) throw new Meteor.Error('not-found', 'Document not found');
    if (!canEditEvidence(user, review)) throw new Meteor.Error('invalid', 'This review is already closed');
    if (!isCompliance(user) && document.uploadedBy !== user._id) {
      throw new Meteor.Error('not-authorized', 'You can only remove documents you attached');
    }

    if (isSafePathSegment(document.storedFileName)) {
      try {
        const filePath = path.join(evidenceDirFor(reviewId), document.storedFileName);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (error) {
        console.error('[SizeableTransactions] Could not delete evidence file:', error.message);
      }
    }

    const role = isCompliance(user) ? 'compliance' : 'rm';
    await SizeableTransactionReviewsCollection.updateAsync(reviewId, {
      $set: { updatedAt: new Date() },
      $pull: { documents: { _id: documentId } },
      $push: { thread: { at: new Date(), byUserId: user._id, byName: userName(user), role, text: `Removed document: ${document.fileName}` } }
    });

    await AuditLog.record({
      actorUserId: user._id, actorRole: user.role, action: 'sizeableTransaction.removeDocument',
      targetType: 'sizeableTransaction', targetId: reviewId, meta: { documentId, fileName: document.fileName }
    });
    return { ok: true };
  },

  /**
   * Short-lived download URL for an attached document (compliance, admins and
   * the account's RMs). The /sizeable_evidence endpoint requires the token.
   */
  async 'sizeableTransactions.getDocumentUrl'({ reviewId, documentId }, sessionId) {
    check(reviewId, String);
    check(documentId, String);
    check(sessionId, String);
    const user = await validateSession(sessionId, [...new Set([...COMPLIANCE_ROLES, ...RM_ROLES])]);
    const review = await loadReviewFor(user, reviewId);
    const document = (review.documents || []).find(d => d._id === documentId);
    if (!document) throw new Meteor.Error('not-found', 'Document not found');

    const filePath = `${SIZEABLE_EVIDENCE_URL_PREFIX}/${reviewId}/${document.storedFileName}`;
    const token = await issueDocumentToken(filePath, user._id);
    return `${filePath}?dl=${token}`;
  }
});
