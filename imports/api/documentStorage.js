/**
 * Single source of truth for where the app's private document trees live on
 * disk, and for the term-sheet naming/URL contract.
 *
 * Before this module the same "resolve project root, honour the *_PATH env var,
 * fall back to a dotted directory" block was copy-pasted in six places, and the
 * copies had drifted:
 *   - products.uploadTermSheet still wrote to public/termsheets in dev while
 *     the extractor wrote to .termsheets (and public/ writes trip Meteor's dev
 *     watcher, hot-reloading the client mid-upload),
 *   - meeting-report PDFs fell back to <root>/.fichier_central/meetingReports
 *     even when FICHIER_CENTRAL_PATH pointed at the production volume, so they
 *     were written to the container's ephemeral filesystem.
 *
 * Layout:
 *   TERMSHEETS_PATH        or <root>/.termsheets                    product term sheets (flat)
 *   FICHIER_CENTRAL_PATH   or <root>/.fichier_central               client documents (KYC/PII)
 *     └ orders/<orderId>/                                            order email traces
 *     └ entities/<entityId>/                                         entity documents
 *     └ meetingReports/    (or MEETING_REPORTS_PATH)                 meeting report PDFs
 *     └ research/          (or RESEARCH_PATH)                         internal research PDFs
 *
 * Nothing lives under public/ — Meteor serves that tree unauthenticated. Every
 * read goes through a WebApp handler gated on a capability token
 * (see server/documentAccess.js).
 *
 * Server-only in practice: the path helpers are never called from client code,
 * but this file stays under imports/ so shared modules (imports/api/products.js,
 * imports/api/termSheetExtractor.js) can import it statically.
 */

import fs from 'fs';
import path from 'path';

/**
 * Meteor runs the server with cwd inside .meteor/local/build/... — walk back up
 * to the project root so dev fallbacks resolve next to the source tree.
 */
export function resolveProjectRoot() {
  let projectRoot = process.cwd();
  if (projectRoot.includes('.meteor')) {
    projectRoot = projectRoot.split('.meteor')[0].replace(/[\\/]$/, '');
  }
  return projectRoot;
}

/** Root of the client-document tree (KYC/PII). */
export function getFichierCentralDir() {
  return process.env.FICHIER_CENTRAL_PATH || path.join(resolveProjectRoot(), '.fichier_central');
}

/** Order email traces: <fichier_central>/orders/<orderId>/<storedFileName> */
export function getOrderTracesDir() {
  return path.join(getFichierCentralDir(), 'orders');
}

/** Entity documents: <fichier_central>/entities/<entityId>/<storedFileName> */
export function getEntityDocumentsDir() {
  return path.join(getFichierCentralDir(), 'entities');
}

/** Meeting-report PDFs. Honours MEETING_REPORTS_PATH, else sits inside the volume. */
export function getMeetingReportsDir() {
  return process.env.MEETING_REPORTS_PATH || path.join(getFichierCentralDir(), 'meetingReports');
}

/**
 * Internal research library (monthly reports, equity recommended list, single
 * stock research). Honours RESEARCH_PATH, else sits inside the volume so
 * production uploads persist across container restarts.
 */
export function getResearchDir() {
  return process.env.RESEARCH_PATH || path.join(getFichierCentralDir(), 'research');
}

/** Product term sheets — one flat directory, filename is the identity. */
export function getTermsheetsDir() {
  return process.env.TERMSHEETS_PATH || path.join(resolveProjectRoot(), '.termsheets');
}

// ---------------------------------------------------------------------------
// Term-sheet naming / URL contract
// ---------------------------------------------------------------------------

/** Public URL prefix served by the /termsheets WebApp handler. */
export const TERMSHEET_URL_PREFIX = '/termsheets';

/**
 * How a product's term sheet got into the store. Recorded on
 * `product.termSheet.source` so a document promoted from an order's evidence is
 * distinguishable from one a person uploaded on the report, and so a definitive
 * signed copy is never silently replaced by a preliminary one.
 */
export const TERMSHEET_SOURCES = {
  EXTRACTION: 'extraction',            // uploaded to create the product
  MANUAL_UPLOAD: 'manual_upload',      // uploaded on the product report
  ORDER_INITIAL: 'order_initial',      // promoted from an order's initial termsheet
  ORDER_SIGNED: 'order_signed'         // promoted from an order's signed termsheet
};

/**
 * Precedence when two entry points supply a term sheet for the same product.
 * A signed copy outranks everything; a preliminary copy pulled off an order
 * only fills a gap.
 */
const TERMSHEET_SOURCE_RANK = {
  [TERMSHEET_SOURCES.ORDER_INITIAL]: 1,
  [TERMSHEET_SOURCES.EXTRACTION]: 2,
  [TERMSHEET_SOURCES.MANUAL_UPLOAD]: 2,
  [TERMSHEET_SOURCES.ORDER_SIGNED]: 3
};

/**
 * Should `incomingSource` overwrite the term sheet already on the product?
 * An existing term sheet with no recorded source predates this field and is
 * treated as a deliberate upload (rank 2).
 */
export function termsheetSourceWins(existingTermSheet, incomingSource) {
  if (!existingTermSheet?.url) return true;
  const existingRank = TERMSHEET_SOURCE_RANK[existingTermSheet.source] ?? 2;
  const incomingRank = TERMSHEET_SOURCE_RANK[incomingSource] ?? 0;
  return incomingRank > existingRank;
}

const MAX_TITLE_SEGMENT = 50;

/**
 * A term sheet's filename is derived from the product, not from the uploaded
 * file, so the same product always resolves to the same file no matter which
 * entry point stored it (create-product extraction, manual upload on the report,
 * or promotion from an order's termsheet evidence).
 */
export function buildTermsheetFilename({ isin, title } = {}) {
  const safeIsin = String(isin || 'NO_ISIN').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeTitle = String(title || 'Untitled_Product')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .substring(0, MAX_TITLE_SEGMENT);
  return `${safeIsin}_${safeTitle}.pdf`;
}

/** Public URL for a stored term-sheet filename. */
export function termsheetUrl(filename) {
  return `${TERMSHEET_URL_PREFIX}/${filename}`;
}

/**
 * Filename out of a stored term-sheet URL. Tolerates the pre-2025 nested form
 * (/termsheets/<productId>/<filename>) by always taking the last segment.
 */
export function termsheetFilenameFromUrl(url) {
  if (!url) return null;
  const clean = String(url).split('?')[0].replace(/^\//, '');
  const parts = clean.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * Absolute path of a stored term sheet, or null if it isn't on disk.
 *
 * Older installs wrote into public/termsheets/; the startup migration
 * (server/migrations/movePublicDocumentsPrivate.js) drains that tree, but the
 * fallback stays so a file that hasn't been migrated yet still resolves.
 */
export function resolveTermsheetPath(filename) {
  if (!isSafeTermsheetFilename(filename)) return null;

  const candidates = [path.join(getTermsheetsDir(), filename)];
  if (!process.env.TERMSHEETS_PATH) {
    candidates.push(path.join(resolveProjectRoot(), 'public', 'termsheets', filename));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The store is flat, so a term-sheet filename is one path segment and nothing
 * else. Enforced here rather than only at the HTTP edge because filenames also
 * arrive from stored product records.
 */
export function isSafeTermsheetFilename(filename) {
  if (!filename || typeof filename !== 'string') return false;
  if (filename === '.' || filename === '..') return false;
  return /^[A-Za-z0-9_.-]+$/.test(filename) && !filename.includes('..');
}

/** Write a term-sheet PDF into the store, creating the directory if needed. */
export function writeTermsheetFile(filename, buffer) {
  if (!isSafeTermsheetFilename(filename)) {
    throw new Error(`writeTermsheetFile: unsafe filename "${filename}"`);
  }
  const dir = getTermsheetsDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/** Best-effort delete of a stored term sheet. Never throws. */
export function deleteTermsheetFile(filename) {
  try {
    const filePath = resolveTermsheetPath(filename);
    if (filePath) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (error) {
    console.error(`[documentStorage] Failed to delete term sheet ${filename}:`, error.message);
  }
  return false;
}
