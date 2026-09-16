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
 * Document shape:
 *   {
 *     category,            one of RESEARCH_CATEGORIES
 *     title,               display title (suggested from date / security, editable)
 *     description,         optional free text
 *     documentDate,        the document's OWN date (report month, as-of date, publication date)
 *     periodLabel,         documentDate pre-formatted per category granularity ("September 2026", "10 Sep 2026")
 *     security,            { ticker, name, isin } for stock research, else null
 *     fileName,            original upload name (display only)
 *     storedFileName,      safe on-disk name, unique
 *     fileSize, mimeType,
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
