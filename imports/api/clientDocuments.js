/**
 * Client Documents Collection
 *
 * Stores metadata for client compliance documents (ID, Residency Card, Proof of Address)
 * Supports documents for both the main client and family members
 * Files are stored on the server at /root/HC_Volume_103962382/fichier_central/{userId}/
 */

import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const ClientDocumentsCollection = new Mongo.Collection('clientDocuments');

/**
 * Document Types
 */
export const DOCUMENT_TYPES = {
  ID: 'id',
  RESIDENCY_CARD: 'residency_card',
  PROOF_OF_ADDRESS: 'proof_of_address',
  // Amberlake Partners Pack
  ADVISORY_MANDATE: 'advisory_mandate',
  INVESTOR_PROFILE: 'investor_profile',
  DISCHARGE_FORM: 'discharge_form',
  BENEFICIAL_OWNER_FORM: 'beneficial_owner_form',
  STRUCTURED_PRODUCTS_FORM: 'structured_products_form',
  // Bank documents — paperwork exchanged with the custodian bank
  ADVISORY_POA: 'advisory_poa',
  BANK_MISC: 'bank_misc',
  // Corporate documents — companies only (registre du commerce, registre des
  // bénéficiaires effectifs, statuts, pouvoirs)
  TRADE_REGISTER: 'trade_register',
  UBO_REGISTER: 'ubo_register',
  ARTICLES_OF_ASSOCIATION: 'articles_of_association',
  SIGNATORY_POWERS: 'signatory_powers',
  // KYC (shown in the KYC tab, not the Documents tab)
  KYC_FILE: 'kyc_file',
  // Periodic KYC review — the file evidencing a completed review. Its recency is
  // tracked by the review dates on the entity, not by the upload date.
  PERIODIC_REVIEW: 'periodic_review',
  // Client visit report — one per year, filed from the KYC tab.
  VISIT_REPORT: 'visit_report',
  // Signed portfolio (portfolio statement countersigned by the client) — one per
  // portfolio per year. Each file is bound to a bank account via bankAccountId,
  // since a client can hold several portfolios signed on different dates.
  SIGNED_PORTFOLIO: 'signed_portfolio',
  // Identity media for physical persons (Entity Profile tab): one photo and
  // one specimen signature. Images only; never listed in the Documents tab.
  CLIENT_PHOTO: 'client_photo',
  CLIENT_SIGNATURE: 'client_signature'
};

// How long a completed review stays valid, by the client's risk level.
export const REVIEW_YEARS_BY_RISK = { high: 1, medium: 2, low: 3 };

/** The next review due date for a review carried out on `reviewDate`. */
export const computeNextReviewDate = (reviewDate, riskLevel) => {
  if (!reviewDate) return null;
  const d = reviewDate instanceof Date ? new Date(reviewDate) : new Date(reviewDate);
  if (Number.isNaN(d.getTime())) return null;
  const years = REVIEW_YEARS_BY_RISK[riskLevel] ?? REVIEW_YEARS_BY_RISK.medium;
  d.setFullYear(d.getFullYear() + years);
  return d;
};

// Client visits happen once a year whatever the risk level.
export const VISIT_INTERVAL_YEARS = 1;

// Each portfolio is signed by the client once a year.
export const SIGNED_PORTFOLIO_INTERVAL_YEARS = 1;

/** The next signature due date for a portfolio signed on `signedDate`. */
export const computeNextPortfolioSignatureDate = (signedDate) => {
  if (!signedDate) return null;
  const d = new Date(signedDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + SIGNED_PORTFOLIO_INTERVAL_YEARS);
  return d;
};

/** The next visit due date for a visit carried out on `visitDate`. */
export const computeNextVisitDate = (visitDate) => {
  if (!visitDate) return null;
  const d = new Date(visitDate);
  if (Number.isNaN(d.getTime())) return null;
  d.setFullYear(d.getFullYear() + VISIT_INTERVAL_YEARS);
  return d;
};

// A document carrying no expiry date of its own is treated as aged out after
// this many months. Per-type `stalesAfterMonths` overrides it; null disables it.
const DEFAULT_STALE_MONTHS = 6;

/**
 * Document type configuration
 *
 * `dateLabel` names the document's own date for that type (issued / signed on /
 * statement date ...). EVERY type carries one — it is stored in `issuanceDate`
 * and is what document age is measured from, since the upload date only says
 * when the file reached us, not how old the document itself is.
 *
 * `optional: true` marks a type that is not expected for every client (a
 * catch-all bucket), so an empty one is not counted as a missing document.
 * `hint` is an optional one-line explanation shown under the type's header.
 */
export const DOCUMENT_TYPE_CONFIG = {
  [DOCUMENT_TYPES.ID]: {
    label: 'ID / Passport',
    requiresExpiration: true,
    dateLabel: 'Issued',
    icon: '🪪',
    category: 'compliance'
  },
  [DOCUMENT_TYPES.RESIDENCY_CARD]: {
    label: 'Residency Card',
    requiresExpiration: true,
    dateLabel: 'Issued',
    icon: '🏠',
    category: 'compliance',
    // Not every client has one, so never "missing"; once filed, its expiry is
    // followed like any other (Documents tab, compliance dashboard and alerts)
    optional: true,
    hint: 'Optional. When filed, its expiry date is monitored.'
  },
  [DOCUMENT_TYPES.PROOF_OF_ADDRESS]: {
    label: 'Proof of Address',
    requiresExpiration: false,
    dateLabel: 'Statement date',
    icon: '📄',
    category: 'compliance'
  },
  // Amberlake Partners Pack
  // Amberlake pack forms are signed once and never change, so they carry no
  // staleness rule: the only alert for them is a missing document.
  [DOCUMENT_TYPES.ADVISORY_MANDATE]: {
    label: 'Advisory Mandate',
    requiresExpiration: false,
    dateLabel: 'Signed on',
    stalesAfterMonths: null,
    icon: '📜',
    category: 'amberlake'
  },
  [DOCUMENT_TYPES.INVESTOR_PROFILE]: {
    label: "Investor's Profile",
    requiresExpiration: false,
    dateLabel: 'Signed on',
    stalesAfterMonths: null,
    icon: '📊',
    category: 'amberlake'
  },
  [DOCUMENT_TYPES.DISCHARGE_FORM]: {
    label: 'Discharge (Exchange of Info & Electronic Orders)',
    requiresExpiration: false,
    dateLabel: 'Signed on',
    stalesAfterMonths: null,
    icon: '📝',
    category: 'amberlake'
  },
  [DOCUMENT_TYPES.BENEFICIAL_OWNER_FORM]: {
    label: 'Beneficial Owner Identification',
    requiresExpiration: false,
    dateLabel: 'Signed on',
    stalesAfterMonths: null,
    icon: '👤',
    category: 'amberlake'
  },
  [DOCUMENT_TYPES.STRUCTURED_PRODUCTS_FORM]: {
    label: 'Structured Products Form (Signed)',
    requiresExpiration: false,
    dateLabel: 'Signed on',
    stalesAfterMonths: null,
    icon: '📈',
    category: 'amberlake'
  },
  // Bank documents. The advisory power of attorney is the bank's own mandate
  // authorising us to advise / place orders on the account; it stays valid until
  // revoked, so it never goes stale. The miscellaneous bucket is a catch-all for
  // whatever else the bank sends (statements, forms, correspondence) — several
  // files are allowed per type, and it is `optional` so an empty bucket is not
  // reported as a missing document.
  [DOCUMENT_TYPES.ADVISORY_POA]: {
    label: 'Advisory Power of Attorney',
    requiresExpiration: false,
    dateLabel: 'Signed on',
    stalesAfterMonths: null,
    icon: '📑',
    category: 'bank',
    allowsWord: true
  },
  [DOCUMENT_TYPES.BANK_MISC]: {
    label: 'Miscellaneous Bank Documents',
    requiresExpiration: false,
    dateLabel: 'Document date',
    stalesAfterMonths: null,
    optional: true,
    hint: 'Any other document from the bank — statements, forms, correspondence',
    icon: '🗂️',
    category: 'bank',
    allowsWord: true
  },
  // Corporate documents — only shown for company entities. Word is accepted
  // alongside PDF/images: statuts and pouvoirs often arrive as .doc/.docx.
  // A register extract is a point-in-time snapshot, so it goes stale; the deed
  // documents (articles, powers) stay valid until the company changes them.
  [DOCUMENT_TYPES.TRADE_REGISTER]: {
    label: 'Trade Register Extract',           // Registre du Commerce
    requiresExpiration: false,
    dateLabel: 'Extract date',
    icon: '🏛️',
    category: 'corporate',
    allowsWord: true
  },
  [DOCUMENT_TYPES.UBO_REGISTER]: {
    label: 'UBO Register Extract',             // Registre des Bénéficiaires Effectifs
    requiresExpiration: false,
    dateLabel: 'Extract date',
    icon: '🧾',
    category: 'corporate',
    allowsWord: true
  },
  [DOCUMENT_TYPES.ARTICLES_OF_ASSOCIATION]: {
    label: 'Articles of Association',          // Statuts
    requiresExpiration: false,
    dateLabel: 'Document date',
    stalesAfterMonths: null,
    icon: '📘',
    category: 'corporate',
    allowsWord: true
  },
  [DOCUMENT_TYPES.SIGNATORY_POWERS]: {
    label: 'Signatory Powers',                 // Pouvoirs
    requiresExpiration: false,
    dateLabel: 'Document date',
    stalesAfterMonths: null,
    icon: '✍️',
    category: 'corporate',
    allowsWord: true
  },
  [DOCUMENT_TYPES.PERIODIC_REVIEW]: {
    label: 'Periodic Review',
    requiresExpiration: false,
    // The review dates carry the recency signal, so the file itself never
    // goes "stale" on upload age.
    stalesAfterMonths: null,
    icon: '🔁',
    category: 'review',
    allowsWord: true
  },
  [DOCUMENT_TYPES.VISIT_REPORT]: {
    label: 'Visit Report',
    requiresExpiration: false,
    dateLabel: 'Visit date',
    // The visit dates carry the recency signal, like the periodic review.
    stalesAfterMonths: null,
    icon: '🤝',
    category: 'review',
    allowsWord: true
  },
  [DOCUMENT_TYPES.SIGNED_PORTFOLIO]: {
    label: 'Signed Portfolio',
    requiresExpiration: false,
    dateLabel: 'Signed on',
    // Recency is tracked per portfolio from the signature date, like the reviews.
    stalesAfterMonths: null,
    icon: '✍️',
    category: 'review',
    allowsWord: true,
    // Every file names the portfolio (bank account) it signs
    requiresBankAccount: true
  },
  // Identity media — one image each, shown inline on the Entity Profile tab.
  [DOCUMENT_TYPES.CLIENT_PHOTO]: {
    label: 'Client Photo',
    requiresExpiration: false,
    dateLabel: 'Taken on',
    stalesAfterMonths: null,
    icon: '📷',
    category: 'identity',
    imageOnly: true
  },
  [DOCUMENT_TYPES.CLIENT_SIGNATURE]: {
    label: 'Specimen Signature',
    requiresExpiration: false,
    dateLabel: 'Signed on',
    stalesAfterMonths: null,
    icon: '✒️',
    category: 'identity',
    imageOnly: true
  },
  // KYC file(s) — surfaced in the KYC tab via the 'kyc' category
  [DOCUMENT_TYPES.KYC_FILE]: {
    label: 'KYC File',
    requiresExpiration: false,
    dateLabel: 'Completed on',
    icon: '✅',
    category: 'kyc',
    allowsWord: true // KYC docs are often Word or PDF
  }
};

/**
 * Types that every client is expected to provide — the basis of any
 * "missing documents" count. Catch-all buckets (`optional: true`) are excluded:
 * an empty miscellaneous folder is not an outstanding item.
 */
export const isOptionalDocumentType = (documentType) =>
  !!DOCUMENT_TYPE_CONFIG[documentType]?.optional;

/**
 * Get documents by category
 */
export const getDocumentsByCategory = (category) => {
  return Object.entries(DOCUMENT_TYPE_CONFIG)
    .filter(([_, config]) => config.category === category)
    .map(([type, _]) => type);
};

/**
 * Schema fields:
 * - userId: String - Client's user ID
 * - familyMemberIndex: Number|null - Index in familyMembers array, null for main client
 * - documentType: String - Type of document (id, residency_card, proof_of_address)
 * - fileName: String - Original filename
 * - storedFileName: String - Stored filename (with timestamp)
 * - filePath: String - Full path on server
 * - mimeType: String
 * - fileSize: Number
 * - uploadedAt: Date
 * - uploadedBy: String - RM who uploaded
 * - expirationDate: Date - For ID and residency card
 * - documentNumber: String - ID/Passport number or document reference number
 * - issuanceDate: Date - The document's own date (issued / signed / statement
 *   date, per DOCUMENT_TYPE_CONFIG[type].dateLabel). Captured for every type and
 *   used as the age reference for staleness; null when not yet filled in.
 */

/**
 * Helper functions for document status
 */
export const ClientDocumentHelpers = {
  /**
   * Check if a document is expiring within 3 months
   */
  isExpiringSoon(expirationDate) {
    if (!expirationDate) return false;
    const threeMonthsFromNow = new Date();
    threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
    const expDate = new Date(expirationDate);
    return expDate <= threeMonthsFromNow && expDate > new Date();
  },

  /**
   * Check if a document has expired
   */
  isExpired(expirationDate) {
    if (!expirationDate) return false;
    return new Date(expirationDate) < new Date();
  },

  /**
   * The date a document's age is measured from: its own date when known,
   * falling back to the upload date. A statement dated two years ago is old
   * however recently it was uploaded, so `issuanceDate` wins whenever present.
   */
  getEffectiveDate(doc) {
    if (!doc) return null;
    return doc.issuanceDate || doc.uploadedAt || null;
  },

  /**
   * Check if proof of address is stale (> 6 months old)
   */
  isProofOfAddressStale(uploadedAt) {
    return this.isStale(uploadedAt, DEFAULT_STALE_MONTHS);
  },

  /**
   * Has a document that carries no expiry date aged out?
   * `months` of null/0 means the document never goes stale.
   */
  isStale(date, months = DEFAULT_STALE_MONTHS) {
    if (!date || !months) return false;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    return new Date(date) < cutoff;
  },

  /**
   * Get document status with warning level
   * Returns: { status: 'ok' | 'warning' | 'expired' | 'stale', message: string }
   */
  getDocumentStatus(doc) {
    if (!doc) {
      return { status: 'missing', message: 'No document uploaded' };
    }

    const config = DOCUMENT_TYPE_CONFIG[doc.documentType];

    if (config?.requiresExpiration) {
      if (this.isExpired(doc.expirationDate)) {
        return { status: 'expired', message: 'Document has expired' };
      }
      if (this.isExpiringSoon(doc.expirationDate)) {
        const daysLeft = Math.ceil((new Date(doc.expirationDate) - new Date()) / (1000 * 60 * 60 * 24));
        return { status: 'warning', message: `Expires in ${daysLeft} days` };
      }
      return { status: 'ok', message: 'Valid' };
    }

    // No expiry date on the document itself, so age is the only signal. Types
    // that never go stale (a company's articles stay valid until amended) opt
    // out with stalesAfterMonths: null; everything else keeps the 6-month rule.
    const staleMonths = config && 'stalesAfterMonths' in config
      ? config.stalesAfterMonths
      : DEFAULT_STALE_MONTHS;

    if (this.isStale(this.getEffectiveDate(doc), staleMonths)) {
      return { status: 'stale', message: `Document is older than ${staleMonths} months` };
    }
    return { status: 'ok', message: 'Valid' };
  },

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
};

// Server-only: Set up indexes
if (Meteor.isServer) {
  Meteor.startup(async () => {
    // We now allow several files per document type per person. The old unique
    // index { userId, documentType, familyMemberIndex } enforced one-file-per-type,
    // so drop it if present and replace with a plain index for query performance.
    try {
      await ClientDocumentsCollection.rawCollection().dropIndex('userId_1_documentType_1_familyMemberIndex_1');
      console.log('[clientDocuments] Dropped legacy unique index (now allowing multiple files per type)');
    } catch (err) {
      // Index absent (fresh DB) or already dropped — safe to ignore
    }
    try {
      await ClientDocumentsCollection.createIndexAsync(
        { userId: 1, documentType: 1, familyMemberIndex: 1 },
        { unique: false }
      );
    } catch (err) {
      console.error('[clientDocuments] Error creating documents index:', err);
    }
    ClientDocumentsCollection.createIndexAsync({ expirationDate: 1 });
  });
}
