import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { SessionHelpers } from '../../imports/api/sessions.js';
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
import { resolveClientRmIds } from '../../imports/api/notificationService.js';
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
    description: op.text || op.description || op.operationTypeName || op.originalOperationType || '',
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

  const rmCache = new Map();
  const rmsFor = async (bankAccountId, entityId) => {
    const cacheKey = `${bankAccountId}|${entityId}`;
    if (!rmCache.has(cacheKey)) {
      rmCache.set(cacheKey, await resolveClientRmIds({
        clientIds: entityId ? [entityId] : [],
        bankAccountIds: bankAccountId ? [bankAccountId] : []
      }));
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
      rmIds: await rmsFor(account?._id, entityId),
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

async function toRows(reviews) {
  const userIds = new Set();
  reviews.forEach(r => {
    (r.rmIds || []).forEach(id => userIds.add(id));
    (r.thread || []).forEach(t => t.byUserId && userIds.add(t.byUserId));
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
      closingNote: r.closingNote || ''
    };
  });
}

const sortReviews = (a, b) => {
  const aDate = a.operationDate ? new Date(a.operationDate) : new Date(`${a.period}-28T00:00:00Z`);
  const bDate = b.operationDate ? new Date(b.operationDate) : new Date(`${b.period}-28T00:00:00Z`);
  return bDate - aDate || b.amountEUR - a.amountEUR;
};

async function statusCounts() {
  const counts = { all: 0 };
  for (const status of Object.values(SIZEABLE_STATUSES)) {
    counts[status] = await SizeableTransactionReviewsCollection.find({ status }).countAsync();
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
    await validateSession(sessionId, COMPLIANCE_ROLES);

    try {
      await scanSizeableTransactions();
    } catch (err) {
      console.error('[SizeableTransactions] Scan failed:', err);
    }

    const query = {};
    if (status === 'pending') query.status = { $ne: SIZEABLE_STATUSES.DONE };
    else if (status !== 'all') query.status = status;
    if (period) query.period = period;

    const reviews = (await SizeableTransactionReviewsCollection.find(query).fetchAsync()).sort(sortReviews);
    const periods = (await SizeableTransactionReviewsCollection.rawCollection().distinct('period'))
      .filter(Boolean).sort().reverse()
      .map(p => ({ value: p, label: formatPeriod(p) }));

    return {
      rows: await toRows(reviews),
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
      rmIds: user._id,
      $or: [
        { status: { $in: [SIZEABLE_STATUSES.QUESTIONED, SIZEABLE_STATUSES.ANSWERED] } },
        { status: SIZEABLE_STATUSES.DONE, closedAt: { $gte: recent }, 'thread.role': 'rm' }
      ]
    }).fetchAsync();

    const order = { [SIZEABLE_STATUSES.QUESTIONED]: 0, [SIZEABLE_STATUSES.ANSWERED]: 1, [SIZEABLE_STATUSES.DONE]: 2 };
    reviews.sort((a, b) => (order[a.status] - order[b.status]) || sortReviews(a, b));
    const rows = await toRows(reviews);
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
  }
});
