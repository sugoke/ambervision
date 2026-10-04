import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import * as XLSX from 'xlsx';
import { SessionHelpers } from '../../imports/api/sessions.js';
import { UsersCollection, USER_ROLES } from '../../imports/api/users.js';
import { ClientEntitiesCollection, ClientEntityHelpers } from '../../imports/api/clientEntities.js';
import { BankAccountsCollection, getAuthorizedEmails, getAccountHolderIds, ACCOUNT_ACCESS_RIGHTS_LABELS } from '../../imports/api/bankAccounts.js';
import { BanksCollection } from '../../imports/api/banks.js';
import { AccountProfilesCollection, getProfileName } from '../../imports/api/accountProfiles.js';
import { PortfolioSnapshotsCollection } from '../../imports/api/portfolioSnapshots.js';
import { AuditLog } from '/imports/api/auditLog';

/**
 * Full client-base export to Excel.
 *
 * One workbook, one row per record:
 *   Clients        - every client entity (prospects and archived included, with status)
 *   Bank Accounts  - every active account, with bank, mandate, contacts, risk profile,
 *                    KYC risk and the latest value reported in the bank files
 *   Stakeholders   - UBOs, directors, signatories... of each client
 *   Family Members - family members recorded on each client
 *
 * Profile, KYC and US-person columns are derived from the data itself: every
 * field present on any client becomes a column, so new fields appear in the
 * export without a code change.
 *
 * Personal data of the whole client base: restricted to admin, superadmin and
 * compliance, and every export is written to the audit log.
 */

const EXPORT_ROLES = [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE];

// Nested structures that get their own sheet instead of a column
const SEPARATE_SHEET_FIELDS = new Set(['familyMembers', 'stakeholders']);

const formatDate = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString().slice(0, 10);
};

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

const cellValue = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatDate(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) {
    return value.map(v => (isPlainObject(v) ? JSON.stringify(v) : cellValue(v))).join(', ');
  }
  if (isPlainObject(value)) return JSON.stringify(value);
  return value;
};

/** Flatten nested objects into "a.b" keys; arrays and dates stay as leaf values. */
const flatten = (obj, prefix = '', out = {}) => {
  if (!isPlainObject(obj)) return out;
  for (const [key, value] of Object.entries(obj)) {
    if (!prefix && SEPARATE_SHEET_FIELDS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) flatten(value, path, out);
    else out[path] = value;
  }
  return out;
};

const humanize = (path) => path
  .split('.')
  .map(part => part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()))
  .join(' - ');

const userName = (user) => (user
  ? `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() || user.username
  : '');

/** Sheet from rows of { header: value }, with column widths fitted to content. */
const buildSheet = (rows, headers) => {
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  sheet['!cols'] = headers.map(h => ({
    wch: Math.min(60, Math.max(h.length, ...rows.map(r => String(r[h] ?? '').length)) + 2)
  }));
  if (rows.length > 0) sheet['!autofilter'] = { ref: sheet['!ref'] };
  return sheet;
};

/**
 * Latest snapshot per (bankId, portfolioCode). Accounts match on the part of the
 * account number before any "-" suffix, the same rule order holdings use.
 */
const loadLatestSnapshots = async () => {
  const raw = PortfolioSnapshotsCollection.rawCollection();
  const latest = await raw.aggregate([
    { $sort: { snapshotDate: -1 } },
    {
      $group: {
        _id: { bankId: '$bankId', portfolioCode: '$portfolioCode' },
        snapshotDate: { $first: '$snapshotDate' },
        totalAccountValue: { $first: '$totalAccountValue' },
        totalMarketValue: { $first: '$totalMarketValue' },
        cashBalance: { $first: '$cashBalance' },
        currency: { $first: { $ifNull: ['$portfolioCurrency', '$currency'] } }
      }
    }
  ], { allowDiskUse: true }).toArray();
  return latest;
};

const snapshotForAccount = (snapshots, account) => {
  if (!account.accountNumber || !account.bankId) return null;
  const base = String(account.accountNumber).split('-')[0];
  const matches = snapshots.filter(s => s._id.bankId === account.bankId
    && typeof s._id.portfolioCode === 'string'
    && s._id.portfolioCode.startsWith(base));
  if (matches.length === 0) return null;
  // Several sub-portfolios of one account: report their sum on the latest date
  // they all share, and only when they are in one currency.
  const latestDate = matches.reduce((d, s) => (!d || s.snapshotDate > d ? s.snapshotDate : d), null);
  const sameDay = matches.filter(s => formatDate(s.snapshotDate) === formatDate(latestDate));
  const currencies = [...new Set(sameDay.map(s => s.currency).filter(Boolean))];
  if (currencies.length > 1) {
    return { snapshotDate: latestDate, currency: currencies.join(' / '), value: null, portfolios: sameDay.length };
  }
  const value = sameDay.reduce((sum, s) => sum + (Number(s.totalAccountValue ?? s.totalMarketValue) || 0), 0);
  return { snapshotDate: latestDate, currency: currencies[0] || '', value, portfolios: sameDay.length };
};

export async function buildClientExportWorkbook() {
  const [entities, accounts, banks, staff, profiles, snapshots] = await Promise.all([
    ClientEntitiesCollection.find({}, { sort: { 'profile.lastName': 1, 'profile.companyName': 1 } }).fetchAsync(),
    BankAccountsCollection.find({ isActive: true }).fetchAsync(),
    BanksCollection.find({}, { fields: { name: 1 } }).fetchAsync(),
    UsersCollection.find({}, { fields: { username: 1, profile: 1, role: 1 } }).fetchAsync(),
    AccountProfilesCollection.find({}).fetchAsync(),
    loadLatestSnapshots()
  ]);

  const bankById = new Map(banks.map(b => [b._id, b.name]));
  const staffById = new Map(staff.map(u => [u._id, u]));  // every login, staff and legacy clients
  const entityById = new Map(entities.map(e => [e._id, e]));
  // Accounts created before entities carry the legacy userId instead of entityId
  const entityByLegacyUser = new Map(entities.filter(e => e.migratedFromUserId).map(e => [e.migratedFromUserId, e]));
  const ownerOf = (a) => entityById.get(a.entityId) || entityByLegacyUser.get(a.userId) || null;
  const profileByAccount = new Map(profiles.map(p => [p.bankAccountId, p]));
  const displayName = (e) => ClientEntityHelpers.getEntityDisplayName(e);
  const managersOf = (e) => [...new Set([...(e.assignedUserIds || []), e.relationshipManagerId].filter(Boolean))]
    .map(id => userName(staffById.get(id)) || id).join(', ');

  // ---- Clients ----
  const flatProfiles = entities.map(e => ({
    profile: flatten(e.profile || {}),
    kyc: flatten(e.kyc || {}),
    usPerson: flatten(e.usPerson || {})
  }));
  const keysOf = (section) => [...new Set(flatProfiles.flatMap(f => Object.keys(f[section])))].sort();
  const profileKeys = keysOf('profile');
  const kycKeys = keysOf('kyc');
  const usKeys = keysOf('usPerson');

  const accountsByEntity = new Map();
  for (const account of accounts) {
    const holderIds = getAccountHolderIds(account);
    if (holderIds.length === 0 && ownerOf(account)) holderIds.push(ownerOf(account)._id);
    for (const holderId of holderIds) {
      if (!accountsByEntity.has(holderId)) accountsByEntity.set(holderId, []);
      accountsByEntity.get(holderId).push(account);
    }
  }

  const clientHeaders = [
    'Client ID', 'Name', 'Type', 'Life Insurance Company', 'Status', 'Reference Currency',
    'Relationship Managers', 'Bank Accounts', 'Stakeholders', 'Family Members',
    ...profileKeys.map(k => `Profile - ${humanize(k)}`),
    ...kycKeys.map(k => `KYC - ${humanize(k)}`),
    ...usKeys.map(k => `US Person - ${humanize(k)}`),
    'Created', 'Updated'
  ];
  const clientRows = entities.map((e, i) => {
    const row = {
      'Client ID': e._id,
      'Name': displayName(e),
      'Type': e.type === 'company' ? 'Company' : 'Physical person',
      'Life Insurance Company': cellValue(!!e.isInsurance),
      'Status': e.status || '',
      'Reference Currency': e.referenceCurrency || '',
      'Relationship Managers': managersOf(e),
      'Bank Accounts': (accountsByEntity.get(e._id) || []).length,
      'Stakeholders': (e.stakeholders || []).length,
      'Family Members': (e.profile?.familyMembers || []).length,
      'Created': formatDate(e.createdAt),
      'Updated': formatDate(e.updatedAt)
    };
    profileKeys.forEach(k => { row[`Profile - ${humanize(k)}`] = cellValue(flatProfiles[i].profile[k]); });
    kycKeys.forEach(k => { row[`KYC - ${humanize(k)}`] = cellValue(flatProfiles[i].kyc[k]); });
    usKeys.forEach(k => { row[`US Person - ${humanize(k)}`] = cellValue(flatProfiles[i].usPerson[k]); });
    return row;
  });

  // ---- Bank Accounts ----
  const accountHeaders = [
    'Account ID', 'Client', 'Client ID', 'Client Status', 'Joint Holders', 'Bank', 'Account Number',
    'Account Name', 'Reference Currency', 'Account Type', 'Structure', 'Life Insurance Company',
    'Beneficial Owners', 'Mandate', 'Authorized Emails', 'Authorized Phone', 'Authorized Overdraft',
    'Relationship Manager', 'Backup RMs', 'Investment Profile', 'KYC Risk Level', 'KYC Next Review',
    'Latest Value', 'Value Currency', 'Value Date', 'Comment', 'Created'
  ];
  const accountRows = accounts.map(a => {
    const owner = ownerOf(a);
    const coHolders = getAccountHolderIds(a).filter(id => id !== a.entityId).map(id => displayName(entityById.get(id)));
    const snap = snapshotForAccount(snapshots, a);
    const kyc = a.kycRiskScore;
    return {
      'Account ID': a._id,
      // Legacy accounts still owned by a client login with no client record
      'Client': owner ? displayName(owner) : userName(staffById.get(a.userId || a.entityId)),
      'Client ID': owner?._id || a.entityId || a.userId || '',
      'Client Status': owner?.status || 'no client record',
      'Joint Holders': coHolders.join(', '),
      'Bank': bankById.get(a.bankId) || '',
      'Account Number': a.accountNumber || '',
      'Account Name': a.name || '',
      'Reference Currency': a.referenceCurrency || '',
      'Account Type': a.accountType || '',
      'Structure': a.accountStructure || '',
      'Life Insurance Company': a.lifeInsuranceCompany || '',
      'Beneficial Owners': (a.beneficialOwnerIds || []).map(id => displayName(entityById.get(id))).join(', '),
      'Mandate': ACCOUNT_ACCESS_RIGHTS_LABELS[a.accessRights] || 'Not set',
      'Authorized Emails': getAuthorizedEmails(a).join(', '),
      'Authorized Phone': a.authorizedPhone || '',
      'Authorized Overdraft': a.authorizedOverdraft ?? '',
      'Relationship Manager': userName(staffById.get(a.relationshipManagerId)),
      'Backup RMs': (a.backupRmIds || []).map(id => userName(staffById.get(id)) || id).join(', '),
      'Investment Profile': getProfileName(profileByAccount.get(a._id)) || '',
      'KYC Risk Level': kyc?.businessRelationship?.riskLevel || '',
      'KYC Next Review': formatDate(kyc?.nextReviewDate),
      'Latest Value': snap?.value ?? '',
      'Value Currency': snap?.currency || '',
      'Value Date': formatDate(snap?.snapshotDate),
      'Comment': a.comment || '',
      'Created': formatDate(a.createdAt)
    };
  });

  // ---- Stakeholders ----
  const stakeholderEntries = entities.flatMap(e => (e.stakeholders || []).map(s => ({ e, s })));
  const stakeholderDetailKeys = [...new Set(stakeholderEntries.flatMap(({ s }) => Object.keys(flatten(s.details || {}))))].sort();
  const stakeholderBaseKeys = [...new Set(stakeholderEntries.flatMap(({ s }) =>
    Object.keys(s).filter(k => !['_id', 'details'].includes(k))))].sort();
  const stakeholderHeaders = ['Client', 'Client ID',
    ...stakeholderBaseKeys.map(humanize), ...stakeholderDetailKeys.map(k => `Details - ${humanize(k)}`)];
  const stakeholderRows = stakeholderEntries.map(({ e, s }) => {
    const row = { 'Client': displayName(e), 'Client ID': e._id };
    stakeholderBaseKeys.forEach(k => { row[humanize(k)] = cellValue(s[k]); });
    const details = flatten(s.details || {});
    stakeholderDetailKeys.forEach(k => { row[`Details - ${humanize(k)}`] = cellValue(details[k]); });
    return row;
  });

  // ---- Family Members ----
  const familyEntries = entities.flatMap(e => (e.profile?.familyMembers || []).map(m => ({ e, m })));
  const familyKeys = [...new Set(familyEntries.flatMap(({ m }) => Object.keys(m).filter(k => k !== '_id')))].sort();
  const familyHeaders = ['Client', 'Client ID', ...familyKeys.map(humanize)];
  const familyRows = familyEntries.map(({ e, m }) => {
    const row = { 'Client': displayName(e), 'Client ID': e._id };
    familyKeys.forEach(k => { row[humanize(k)] = cellValue(m[k]); });
    return row;
  });

  const workbook = XLSX.utils.book_new();
  const generatedAt = new Date();
  const summary = [
    { Item: 'Generated', Value: generatedAt.toISOString().replace('T', ' ').slice(0, 19) + ' UTC' },
    { Item: 'Clients', Value: clientRows.length },
    ...['active', 'prospect', 'archived'].map(status => ({
      Item: `  ${status}`, Value: entities.filter(e => e.status === status).length
    })),
    { Item: 'Active bank accounts', Value: accountRows.length },
    { Item: 'Stakeholders', Value: stakeholderRows.length },
    { Item: 'Family members', Value: familyRows.length },
    { Item: 'Note', Value: 'Latest Value is the most recent account value reported in the bank files, in the account currency.' },
    { Item: 'Confidential', Value: 'Contains personal data. Handle under the GDPR policy; do not forward outside the firm.' }
  ];
  XLSX.utils.book_append_sheet(workbook, buildSheet(summary, ['Item', 'Value']), 'Summary');
  XLSX.utils.book_append_sheet(workbook, buildSheet(clientRows, clientHeaders), 'Clients');
  XLSX.utils.book_append_sheet(workbook, buildSheet(accountRows, accountHeaders), 'Bank Accounts');
  XLSX.utils.book_append_sheet(workbook, buildSheet(stakeholderRows, stakeholderHeaders), 'Stakeholders');
  XLSX.utils.book_append_sheet(workbook, buildSheet(familyRows, familyHeaders), 'Family Members');

  return {
    base64: XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' }),
    fileName: `ambervision-clients-${generatedAt.toISOString().slice(0, 10)}.xlsx`,
    counts: {
      clients: clientRows.length,
      accounts: accountRows.length,
      stakeholders: stakeholderRows.length,
      familyMembers: familyRows.length
    }
  };
}

Meteor.methods({
  async 'clients.exportAllToExcel'(sessionId) {
    check(sessionId, String);

    const session = await SessionHelpers.findByToken(sessionId);
    if (!session) throw new Meteor.Error('not-authorized', 'Invalid session');
    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || !EXPORT_ROLES.includes(user.role)) {
      throw new Meteor.Error('not-authorized', 'Only administrators and compliance can export the client base');
    }

    const result = await buildClientExportWorkbook();

    await AuditLog.record({
      actorUserId: user._id,
      actorRole: user.role,
      action: 'export.data',
      targetType: 'client_base',
      meta: { format: 'xlsx', ...result.counts }
    });
    console.log(`[ClientExport] ${user.username} exported ${result.counts.clients} clients / ${result.counts.accounts} accounts`);

    return result;
  }
});
