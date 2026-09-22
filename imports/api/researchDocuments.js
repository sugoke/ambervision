import { Mongo } from 'meteor/mongo';
import { USER_ROLES } from './users';

/**
 * Internal research library — PDFs the team uploads by hand and reads from the
 * Intranet: the house monthly report, the equity recommended list, and
 * single-stock research notes.
 *
 * Files live on disk under documentStorage.getResearchDir() and are served by
 * the token-gated /research WebApp handler (server/main.js); only metadata is
 * stored here. Nothing is ever written under public/.
 *
 * One entry is one document, in as many languages as were uploaded for it: the
 * English and French editions of the same monthly report are two PDFs on one
 * row, not two rows, so the metadata (date, security, description) is written
 * once and the list never shows the same report twice.
 *
 * Document shape:
 *   {
 *     category,            one of RESEARCH_CATEGORIES
 *     title,               display title (suggested from date / security, editable)
 *     description,         optional free text
 *     documentDate,        the document's OWN date (report month, as-of date, publication date)
 *     periodLabel,         documentDate pre-formatted per category granularity ("September 2026", "10 Sep 2026")
 *     security,            { ticker, name, isin } for stock research, else null
 *     files: {             one entry per uploaded language, keyed by RESEARCH_LANGUAGES
 *       en: {
 *         fileName,          original upload name (display only)
 *         storedFileName,    safe on-disk name, unique
 *         fileSize, mimeType,
 *         uploadedBy, uploadedByName, uploadedAt
 *       },
 *       fr: { … }
 *     },
 *     languages,           denormalized list of the keys of `files`, in RESEARCH_LANGUAGE_ORDER
 *     uploadedBy, uploadedByName, uploadedAt, updatedAt
 *   }
 */
export const ResearchDocumentsCollection = new Mongo.Collection('researchDocuments');

export const RESEARCH_CATEGORIES = {
  MONTHLY_REPORT: 'monthly_report',
  EQUITY_RECOMMENDED_LIST: 'equity_recommended_list',
  STOCK_RESEARCH: 'stock_research'
};

/**
 * Per-category behaviour. The UI and the server both read this so adding a new
 * category is a config entry, not a code change.
 *
 *   dateLabel        what the document's own date means for this category
 *   dateGranularity  'month' (month picker, label "September 2026") or 'day'
 *   hasSecurity      collect ticker / company / ISIN (single-stock notes)
 *   highlightLatest  the newest document is the "current" one (a monthly report
 *                    or a recommended list supersedes the previous issue)
 */
export const RESEARCH_CATEGORY_CONFIG = {
  [RESEARCH_CATEGORIES.MONTHLY_REPORT]: {
    label: 'Monthly Report',
    icon: '📅',
    description: 'House monthly market and portfolio report',
    dateLabel: 'Report month',
    dateGranularity: 'month',
    hasSecurity: false,
    highlightLatest: true
  },
  [RESEARCH_CATEGORIES.EQUITY_RECOMMENDED_LIST]: {
    label: 'Equity Recommended List',
    icon: '⭐',
    description: 'Current list of recommended equities',
    dateLabel: 'As of',
    dateGranularity: 'day',
    hasSecurity: false,
    highlightLatest: true
  },
  [RESEARCH_CATEGORIES.STOCK_RESEARCH]: {
    label: 'Stock Research',
    icon: '🔬',
    description: 'Single-stock research notes',
    dateLabel: 'Published',
    dateGranularity: 'day',
    hasSecurity: true,
    highlightLatest: false
  }
};

export const RESEARCH_CATEGORY_ORDER = [
  RESEARCH_CATEGORIES.MONTHLY_REPORT,
  RESEARCH_CATEGORIES.EQUITY_RECOMMENDED_LIST,
  RESEARCH_CATEGORIES.STOCK_RESEARCH
];

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

/**
 * A document may exist in several languages. Adding one (say German) is a
 * config entry here — nothing else in the library hardcodes a language.
 */
export const RESEARCH_LANGUAGES = {
  EN: 'en',
  FR: 'fr'
};

export const RESEARCH_LANGUAGE_CONFIG = {
  [RESEARCH_LANGUAGES.EN]: { label: 'English', short: 'EN', flag: '🇬🇧' },
  [RESEARCH_LANGUAGES.FR]: { label: 'Français', short: 'FR', flag: '🇫🇷' }
};

/** Display and fallback order: the first available language is the default. */
export const RESEARCH_LANGUAGE_ORDER = [RESEARCH_LANGUAGES.EN, RESEARCH_LANGUAGES.FR];

export const isResearchLanguage = (value) => RESEARCH_LANGUAGE_ORDER.includes(value);

/**
 * The language a document uploaded before the EN/FR split is assumed to be in.
 * Used only to read those legacy rows; every new upload states its language.
 */
const LEGACY_LANGUAGE = RESEARCH_LANGUAGES.EN;

/**
 * Normalized { language: fileEntry } map for a document.
 *
 * Pre-split documents kept their single file in top-level fields; they read as
 * one English version, so nothing disappears if the migration has not run.
 */
export function getResearchFileMap(doc) {
  if (!doc) return {};
  if (doc.files && typeof doc.files === 'object') {
    const map = {};
    RESEARCH_LANGUAGE_ORDER.forEach((language) => {
      const entry = doc.files[language];
      if (entry && entry.storedFileName) map[language] = entry;
    });
    return map;
  }
  if (doc.storedFileName) {
    return {
      [LEGACY_LANGUAGE]: {
        fileName: doc.fileName,
        storedFileName: doc.storedFileName,
        fileSize: doc.fileSize,
        mimeType: doc.mimeType,
        uploadedBy: doc.uploadedBy,
        uploadedByName: doc.uploadedByName,
        uploadedAt: doc.uploadedAt
      }
    };
  }
  return {};
}

/** Languages this document is available in, in display order. */
export function getResearchLanguages(doc) {
  const map = getResearchFileMap(doc);
  return RESEARCH_LANGUAGE_ORDER.filter((language) => map[language]);
}

/** The file entry for one language, or null if that edition was never uploaded. */
export function getResearchFile(doc, language) {
  return getResearchFileMap(doc)[language] || null;
}

/** The requested language when it exists, else the first one that does. */
export function resolveResearchLanguage(doc, preferred) {
  const languages = getResearchLanguages(doc);
  if (preferred && languages.includes(preferred)) return preferred;
  return languages[0] || null;
}

/** Selector matching whichever language slot (or legacy field) holds a file. */
export function researchStoredFileSelector(storedFileName) {
  return {
    $or: [
      ...RESEARCH_LANGUAGE_ORDER.map((language) => ({ [`files.${language}.storedFileName`]: storedFileName })),
      { storedFileName }
    ]
  };
}

/** The file entry of a document that is stored under this on-disk name. */
export function findResearchFileByStoredName(doc, storedFileName) {
  const map = getResearchFileMap(doc);
  const language = RESEARCH_LANGUAGE_ORDER.find((lang) => map[lang]?.storedFileName === storedFileName);
  return language ? { language, file: map[language] } : null;
}

/** Everyone who can open the Intranet (every non-client role) may read. */
export const canReadResearch = (user) => !!user && user.role !== USER_ROLES.CLIENT;

/** Internal staff may upload and edit. */
export const RESEARCH_WRITE_ROLES = [
  USER_ROLES.SUPERADMIN,
  USER_ROLES.ADMIN,
  USER_ROLES.COMPLIANCE,
  USER_ROLES.RELATIONSHIP_MANAGER,
  USER_ROLES.ASSISTANT,
  USER_ROLES.STAFF
];
export const canWriteResearch = (user) => !!user && RESEARCH_WRITE_ROLES.includes(user.role);

/** Admins may delete anything; other writers only what they uploaded. */
const RESEARCH_ADMIN_ROLES = [USER_ROLES.SUPERADMIN, USER_ROLES.ADMIN, USER_ROLES.COMPLIANCE];
export const canDeleteResearch = (user, doc) =>
  !!user && !!doc && canWriteResearch(user) &&
  (RESEARCH_ADMIN_ROLES.includes(user.role) || doc.uploadedBy === user._id);

/** Public URL prefix served by the /research WebApp handler. */
export const RESEARCH_URL_PREFIX = '/research';

/**
 * Pre-format a document date for display, per category granularity. Runs on
 * the server at upload/edit time so the list never formats dates itself.
 */
export function formatResearchPeriod(date, category) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const granularity = RESEARCH_CATEGORY_CONFIG[category]?.dateGranularity || 'day';
  if (granularity === 'month') {
    return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
