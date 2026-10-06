/**
 * Compliance checks for one client file
 *
 * The rules behind the compliance dashboard, shared with the client file so
 * both say the same thing: which documents are missing or outdated, whether the
 * Amberlake pack is signed, when the periodic review / visit / portfolio
 * signatures are due, per-account risk reviews and mandates, and whether the
 * client's static data is complete.
 *
 * Pure functions: no collection access, usable on client and server.
 */

import {
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_CONFIG,
  ClientDocumentHelpers,
  getDocumentsByCategory,
  isOptionalDocumentType,
  computeNextReviewDate,
  computeNextVisitDate,
  computeNextPortfolioSignatureDate
} from './clientDocuments.js';

// Document types shown in the Documents tab (KYC files live in the KYC tab).
// Corporate documents (trade register, UBO register, articles, signatory powers)
// only apply to companies, so they are appended for company entities only —
// otherwise every individual would show four permanently missing documents.
// The personal compliance documents (ID, residency card, proof of address) only
// apply to individuals: a company is identified by its corporate documents.
export const getDocumentTabTypes = (isCompany) => [
  ...(isCompany ? [] : getDocumentsByCategory('compliance')),
  ...getDocumentsByCategory('amberlake'),
  ...getDocumentsByCategory('bank'),
  ...(isCompany ? getDocumentsByCategory('corporate') : [])
];

// Types that count towards the "N missing" badge — catch-all buckets don't.
export const getExpectedDocumentTypes = (isCompany) =>
  getDocumentTabTypes(isCompany).filter(type => !isOptionalDocumentType(type));

/** Company-type client (legacy life-insurance entities are companies too). */
export const isCompanyEntity = (entity) =>
  entity?.type === 'company' || entity?.type === 'life_insurance';

/**
 * A client's review cadence follows their WORST-rated banking relationship,
 * across the client, beneficial-owner and business-relationship scores.
 */
export const getOverallRisk = (accounts) => {
  const levels = (accounts || [])
    .map(a => a.kycRiskScore)
    .filter(Boolean)
    .flatMap(rs => [rs.clientProspect?.riskLevel, rs.beneficialOwner?.riskLevel, rs.businessRelationship?.riskLevel])
    .filter(Boolean);
  if (levels.includes('high')) return 'high';
  if (levels.includes('medium')) return 'medium';
  return levels.length ? 'low' : null;
};

/**
 * Static data every client file must hold, by client type. `path` is read
 * from the entity profile; a list counts as filled when it has one entry.
 */
export const REQUIRED_STATIC_FIELDS = {
  physical_person: [
    { path: 'firstName', label: 'First name' },
    { path: 'lastName', label: 'Last name' },
    { path: 'birthday', label: 'Date of birth' },
    { path: 'nationalities', label: 'Nationality' },
    { path: 'taxAddress.street', label: 'Tax address (street)' },
    { path: 'taxAddress.city', label: 'Tax address (city)' },
    { path: 'taxAddress.country', label: 'Tax address (country)' },
    { path: 'email', label: 'Email' },
    { path: 'mobilePhone', label: 'Mobile phone' }
  ],
  company: [
    { path: 'companyName', label: 'Company name' },
    { path: 'registrationNumber', label: 'Registration number' },
    { path: 'incorporationDate', label: 'Incorporation date' },
    { path: 'incorporationCountry', label: 'Incorporation country' },
    { path: 'taxAddress.street', label: 'Registered address (street)' },
    { path: 'taxAddress.city', label: 'Registered address (city)' },
    { path: 'taxAddress.country', label: 'Registered address (country)' },
    { path: 'email', label: 'Email' }
  ]
};

export const COMPLIANCE_CATEGORIES = {
  DOCUMENTS: 'documents',
  AMBERLAKE: 'amberlake',
  PERIODIC_REVIEW: 'periodicReview',
  SIGNED_PORTFOLIO: 'signedPortfolio',
  VISIT: 'visit',
  ACCOUNT_RISK_REVIEW: 'accountRiskReview',
  MANDATE: 'mandate',
  STATIC_DATA: 'staticData'
};

export const COMPLIANCE_CATEGORY_LABELS = {
  documents: 'Outdated & missing documents',
  amberlake: 'Amberlake forms',
  periodicReview: 'Periodic reviews',
  signedPortfolio: 'Signed portfolios',
  visit: 'Client visits',
  accountRiskReview: 'Account risk reviews',
  mandate: 'Bank mandates',
  staticData: 'Static data'
};

// A due date closer than this is flagged ahead of time
export const DUE_SOON_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

const readPath = (obj, path) => path.split('.').reduce((v, key) => (v == null ? v : v[key]), obj);

const isFilled = (value) => {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.some(isFilled);
  if (typeof value === 'string') return value.trim() !== '';
  return true;
};

const latestDate = (docs) => docs
  .map(d => toDate(d.issuanceDate))
  .filter(Boolean)
  .sort((a, b) => b - a)[0] || null;

/** Severity of a due date: overdue is critical, due within DUE_SOON_DAYS a warning, else none. */
const dueSeverity = (dueDate, now) => {
  if (!dueDate) return null;
  if (dueDate < now) return 'critical';
  if (dueDate - now <= DUE_SOON_DAYS * DAY_MS) return 'warning';
  return null;
};

/** "Overdue by 12 days" / "Due in 30 days" for a due date. */
export const describeDue = (dueDate, now = new Date()) => {
  if (!dueDate) return '';
  const days = Math.round((dueDate - now) / DAY_MS);
  if (days < 0) return `Overdue by ${-days} day${days === -1 ? '' : 's'}`;
  if (days === 0) return 'Due today';
  return `Due in ${days} day${days === 1 ? '' : 's'}`;
};

const accountLabel = (account, bankNameById) => [
  bankNameById?.get?.(account.bankId),
  account.accountNumber,
  account.name && account.name !== account.accountNumber ? `(${account.name})` : ''
].filter(Boolean).join(' ') || account._id;

/**
 * Every outstanding compliance item on one client file.
 *
 * @param {Object} entity             client entity
 * @param {Array}  documents          clientDocuments metadata for this client (both
 *                                    the entity id and a legacy user id, if any)
 * @param {Array}  accounts           active accounts the client holds (own or joint)
 * @param {Array}  beneficiaryAccounts active accounts where the client is beneficial owner
 * @param {Map}    bankNameById       bankId -> bank name, for readable account labels
 * @param {Date}   now
 * @returns {Array<{category, severity, subject, label, detail, dueDate}>}
 */
export function evaluateClientCompliance({ entity, documents = [], accounts = [], beneficiaryAccounts = [], bankNameById = new Map(), now = new Date() }) {
  const issues = [];
  const push = (issue) => issues.push({ subject: null, detail: '', dueDate: null, ...issue });
  const isCompany = isCompanyEntity(entity);
  const clientName = entity?.profile?.companyName
    || `${entity?.profile?.firstName || ''} ${entity?.profile?.lastName || ''}`.trim() || 'Client';

  // The Documents tab files a migrated client's documents under its legacy
  // user id, the KYC tab (reviews, visits, signed portfolios) under the entity
  // id — read each where the client file reads it.
  const documentsSubjectId = entity.migratedFromUserId || entity._id;
  const tabDocs = documents.filter(d => d.userId === documentsSubjectId);
  const kycDocs = documents.filter(d => d.userId === entity._id);

  // ---- Documents & Amberlake pack ----
  const familyMembers = entity.profile?.familyMembers || [];
  const people = [
    { index: null, name: clientName, isCompany },
    // Family members are always individuals, even under a company entity
    // A member linked to another contact is checked on that contact, unless
    // files were filed under the member here (same rule as the Documents tab)
    ...familyMembers
      .map((m, index) => ({ index, name: m.name || `Family member ${index + 1}`, isCompany: false, linked: !!m.linkedEntityId }))
      .filter(p => !p.linked || tabDocs.some(d => d.familyMemberIndex === p.index))
  ];
  for (const person of people) {
    const personDocs = tabDocs.filter(d => (person.index === null
      ? (d.familyMemberIndex === null || d.familyMemberIndex === undefined)
      : d.familyMemberIndex === person.index));
    for (const docType of getDocumentTabTypes(person.isCompany)) {
      const config = DOCUMENT_TYPE_CONFIG[docType] || {};
      // Optional types are never missing; those with an expiry date (residency
      // card) are still followed once a file is there. Catch-all buckets aren't.
      const optional = isOptionalDocumentType(docType);
      if (optional && !config.requiresExpiration) continue;
      const isAmberlake = config.category === 'amberlake';
      // The Amberlake pack is signed by the client, not by family members
      if (isAmberlake && person.index !== null) continue;
      const docs = personDocs.filter(d => d.documentType === docType);
      const subject = person.index === null ? null : person.name;
      if (docs.length === 0) {
        if (optional) continue;
        push({
          category: isAmberlake ? COMPLIANCE_CATEGORIES.AMBERLAKE : COMPLIANCE_CATEGORIES.DOCUMENTS,
          severity: 'critical',
          subject,
          label: isAmberlake ? `${config.label} not signed / uploaded` : `${config.label} missing`
        });
        continue;
      }
      // One valid file of the type is enough: an old expired passport kept next
      // to the current one is history, not an outstanding item.
      const statuses = docs.map(doc => ({ doc, ...ClientDocumentHelpers.getDocumentStatus(doc) }));
      if (statuses.some(s => s.status === 'ok')) continue;
      const worst = statuses.find(s => s.status === 'expired') || statuses.find(s => s.status === 'stale') || statuses[0];
      const expiry = toDate(worst.doc.expirationDate);
      push({
        category: COMPLIANCE_CATEGORIES.DOCUMENTS,
        severity: worst.status === 'warning' ? 'warning' : 'critical',
        subject,
        label: worst.status === 'expired' ? `${config.label} expired`
          : worst.status === 'stale' ? `${config.label} outdated`
          : `${config.label} expiring soon`,
        detail: worst.message,
        dueDate: expiry
      });
    }
  }

  // ---- Periodic review ----
  const overallRisk = getOverallRisk(accounts);
  const kyc = entity.kyc || {};
  const lastReview = toDate(kyc.lastReviewDate)
    || latestDate(kycDocs.filter(d => d.documentType === DOCUMENT_TYPES.PERIODIC_REVIEW));
  const nextReview = toDate(kyc.nextReviewDate) || computeNextReviewDate(lastReview, overallRisk);
  if (!nextReview) {
    push({ category: COMPLIANCE_CATEGORIES.PERIODIC_REVIEW, severity: 'critical', label: 'No periodic review on file' });
  } else {
    const severity = dueSeverity(nextReview, now);
    if (severity) {
      push({
        category: COMPLIANCE_CATEGORIES.PERIODIC_REVIEW,
        severity,
        label: severity === 'critical' ? 'Periodic review overdue' : 'Periodic review due soon',
        detail: overallRisk ? `${overallRisk} risk` : 'risk not assessed',
        dueDate: nextReview
      });
    }
  }

  // ---- Client visit ----
  const lastVisit = toDate(kyc.lastVisitDate)
    || latestDate(kycDocs.filter(d => d.documentType === DOCUMENT_TYPES.VISIT_REPORT));
  const nextVisit = toDate(kyc.nextVisitDate) || computeNextVisitDate(lastVisit);
  if (!nextVisit) {
    push({ category: COMPLIANCE_CATEGORIES.VISIT, severity: 'critical', label: 'No client visit on file' });
  } else {
    const severity = dueSeverity(nextVisit, now);
    if (severity) {
      push({
        category: COMPLIANCE_CATEGORIES.VISIT,
        severity,
        label: severity === 'critical' ? 'Client visit overdue' : 'Client visit due soon',
        dueDate: nextVisit
      });
    }
  }

  // ---- Signed portfolios (own and beneficial-owner accounts, as on the client file) ----
  const portfolios = [...accounts, ...beneficiaryAccounts]
    .filter((a, i, all) => all.findIndex(x => x._id === a._id) === i);
  for (const account of portfolios) {
    const lastSigned = latestDate(kycDocs.filter(d =>
      d.documentType === DOCUMENT_TYPES.SIGNED_PORTFOLIO && d.bankAccountId === account._id));
    const nextDue = computeNextPortfolioSignatureDate(lastSigned);
    const subject = accountLabel(account, bankNameById);
    if (!nextDue) {
      push({ category: COMPLIANCE_CATEGORIES.SIGNED_PORTFOLIO, severity: 'critical', subject, label: 'Portfolio never signed' });
      continue;
    }
    const severity = dueSeverity(nextDue, now);
    if (severity) {
      push({
        category: COMPLIANCE_CATEGORIES.SIGNED_PORTFOLIO,
        severity,
        subject,
        label: severity === 'critical' ? 'Portfolio signature overdue' : 'Portfolio signature due soon',
        dueDate: nextDue
      });
    }
  }

  // ---- Per-account risk review & mandate (accounts the client holds) ----
  for (const account of accounts) {
    const subject = accountLabel(account, bankNameById);
    const risk = account.kycRiskScore;
    if (!risk) {
      push({ category: COMPLIANCE_CATEGORIES.ACCOUNT_RISK_REVIEW, severity: 'critical', subject, label: 'Risk not assessed' });
    } else {
      const nextDue = toDate(risk.nextReviewDate);
      const severity = dueSeverity(nextDue, now);
      if (severity) {
        push({
          category: COMPLIANCE_CATEGORIES.ACCOUNT_RISK_REVIEW,
          severity,
          subject,
          label: severity === 'critical' ? 'Risk review overdue' : 'Risk review due soon',
          detail: risk.businessRelationship?.riskLevel ? `${risk.businessRelationship.riskLevel} risk` : '',
          dueDate: nextDue
        });
      }
    }
    if (!account.accessRights) {
      push({
        category: COMPLIANCE_CATEGORIES.MANDATE,
        severity: 'warning',
        subject,
        label: 'Mandate not set',
        detail: 'Power of attorney or view only?'
      });
    }
  }

  // ---- Static data ----
  const requiredFields = REQUIRED_STATIC_FIELDS[isCompany ? 'company' : 'physical_person'];
  const missingFields = requiredFields.filter(f => !isFilled(readPath(entity.profile || {}, f.path)));
  if (missingFields.length > 0) {
    push({
      category: COMPLIANCE_CATEGORIES.STATIC_DATA,
      severity: 'warning',
      label: `${missingFields.length} field${missingFields.length > 1 ? 's' : ''} missing`,
      detail: missingFields.map(f => f.label).join(', ')
    });
  }

  return issues;
}
