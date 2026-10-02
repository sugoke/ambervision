import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { ClientEntitiesCollection, ClientEntityHelpers } from '../../imports/api/clientEntities.js';
import { ClientDocumentsCollection } from '../../imports/api/clientDocuments.js';
import { BankAccountsCollection, getAccountHolderIds } from '../../imports/api/bankAccounts.js';
import { BanksCollection } from '../../imports/api/banks.js';
import {
  evaluateClientCompliance,
  describeDue,
  COMPLIANCE_CATEGORIES,
  COMPLIANCE_CATEGORY_LABELS
} from '../../imports/api/complianceChecks.js';
import { getSizeableSummary } from './sizeableTransactionMethods.js';

/**
 * Compliance dashboard: firm-wide recap of every client file.
 *
 * Runs the same rules as the client file (imports/api/complianceChecks.js)
 * over every client entity - active, prospect and archived - and returns
 * display-ready rows and totals, so the dashboard only filters and renders.
 */

const COMPLIANCE_DASHBOARD_ROLES = [USER_ROLES.SUPERADMIN, USER_ROLES.COMPLIANCE];
const STATUS_KEYS = ['all', 'active', 'prospect', 'archived'];

const formatDate = (d) => (d
  ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '');

const userName = (user) => (user
  ? `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.username
  : '');

const emptyTotals = () => Object.fromEntries(
  Object.values(COMPLIANCE_CATEGORIES).map(c => [c, { critical: 0, warning: 0, clients: 0 }])
);

async function validateComplianceSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }
  const session = await SessionHelpers.findByToken(sessionId);
  if (!session) throw new Meteor.Error('not-authorized', 'Invalid session');
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user || !COMPLIANCE_DASHBOARD_ROLES.includes(user.role)) {
    throw new Meteor.Error('not-authorized', 'The compliance dashboard is reserved to compliance and superadmin');
  }
  return user;
}

export async function buildComplianceOverview(now = new Date()) {
  const [entities, documents, accounts, banks, staff] = await Promise.all([
    ClientEntitiesCollection.find({}).fetchAsync(),
    ClientDocumentsCollection.find({}, {
      fields: {
        userId: 1, familyMemberIndex: 1, documentType: 1, uploadedAt: 1,
        issuanceDate: 1, expirationDate: 1, bankAccountId: 1
      }
    }).fetchAsync(),
    BankAccountsCollection.find({ isActive: true }, { fields: { kycRiskScoreHistory: 0 } }).fetchAsync(),
    BanksCollection.find({}, { fields: { name: 1 } }).fetchAsync(),
    UsersCollection.find({ role: { $ne: USER_ROLES.CLIENT } }, { fields: { username: 1, profile: 1 } }).fetchAsync()
  ]);

  const bankNameById = new Map(banks.map(b => [b._id, b.name]));
  const staffById = new Map(staff.map(u => [u._id, u]));

  const docsBySubject = new Map();
  for (const doc of documents) {
    if (!docsBySubject.has(doc.userId)) docsBySubject.set(doc.userId, []);
    docsBySubject.get(doc.userId).push(doc);
  }

  // Accounts a client holds: primary holder, joint holder, or (legacy) owner by
  // userId - the same holders the client file lists in its Accounts tab.
  const accountsByHolder = new Map();
  const beneficiaryByOwner = new Map();
  const add = (map, key, account) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    if (!map.get(key).some(a => a._id === account._id)) map.get(key).push(account);
  };
  for (const account of accounts) {
    getAccountHolderIds(account).forEach(id => add(accountsByHolder, id, account));
    add(accountsByHolder, account.userId, account);
    [...(account.beneficialOwnerIds || []), account.beneficialOwnerId].forEach(id => add(beneficiaryByOwner, id, account));
  }

  const totals = Object.fromEntries(STATUS_KEYS.map(k => [k, emptyTotals()]));
  const statusCounts = Object.fromEntries(STATUS_KEYS.map(k => [k, 0]));
  const clientsWithIssues = Object.fromEntries(STATUS_KEYS.map(k => [k, 0]));

  const clients = entities.map(entity => {
    const status = entity.status || 'active';
    const subjectDocs = [
      ...(docsBySubject.get(entity._id) || []),
      ...(entity.migratedFromUserId ? (docsBySubject.get(entity.migratedFromUserId) || []) : [])
    ];
    const issues = evaluateClientCompliance({
      entity,
      documents: subjectDocs,
      accounts: accountsByHolder.get(entity._id) || [],
      beneficiaryAccounts: beneficiaryByOwner.get(entity._id) || [],
      bankNameById,
      now
    });

    const statusBuckets = ['all', STATUS_KEYS.includes(status) ? status : null].filter(Boolean);
    statusBuckets.forEach(k => { statusCounts[k] += 1; });
    const categoriesHit = new Set();
    for (const issue of issues) {
      statusBuckets.forEach(k => { totals[k][issue.category][issue.severity] += 1; });
      categoriesHit.add(issue.category);
    }
    categoriesHit.forEach(c => statusBuckets.forEach(k => { totals[k][c].clients += 1; }));
    if (issues.length > 0) statusBuckets.forEach(k => { clientsWithIssues[k] += 1; });

    const managerIds = [...new Set([...(entity.assignedUserIds || []), entity.relationshipManagerId].filter(Boolean))];
    const criticalCount = issues.filter(i => i.severity === 'critical').length;
    return {
      entityId: entity._id,
      name: ClientEntityHelpers.getEntityDisplayName(entity),
      status,
      rmNames: managerIds.map(id => userName(staffById.get(id))).filter(Boolean).join(', '),
      criticalCount,
      warningCount: issues.length - criticalCount,
      categories: [...categoriesHit],
      issues: issues
        .sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
        .map(issue => ({
          category: issue.category,
          severity: issue.severity,
          subject: issue.subject || '',
          label: issue.label,
          detail: issue.detail || '',
          dueDateText: formatDate(issue.dueDate),
          dueText: describeDue(issue.dueDate, now)
        }))
    };
  }).sort((a, b) => b.criticalCount - a.criticalCount || b.warningCount - a.warningCount || a.name.localeCompare(b.name));

  return {
    generatedAtText: now.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    categories: Object.values(COMPLIANCE_CATEGORIES).map(key => ({ key, label: COMPLIANCE_CATEGORY_LABELS[key] })),
    totals,
    statusCounts,
    clientsWithIssues,
    clients
  };
}

Meteor.methods({
  async 'complianceDashboard.getOverview'(sessionId) {
    this.unblock();
    check(sessionId, String);
    await validateComplianceSession(sessionId);
    const overview = await buildComplianceOverview();
    // Counts only (no rescan): the sizeable transactions modal rescans when opened
    overview.sizeableCounts = await getSizeableSummary();
    return overview;
  }
});
