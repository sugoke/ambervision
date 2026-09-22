/**
 * Research library methods — manual PDF upload/edit/delete and token-gated
 * download URLs for the Intranet "Research" mini-app.
 *
 * One entry holds one document in as many languages as were uploaded for it
 * (`files.en`, `files.fr`, …): the English and French editions of the same
 * report share one set of metadata and one row in the library.
 *
 * Storage: <fichier_central>/research/<storedFileName> (documentStorage.getResearchDir).
 * Serving: the /research WebApp handler in server/main.js, which requires a
 * capability token minted by research.getDownloadUrl.
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { Random } from 'meteor/random';
import fs from 'fs';
import path from 'path';

import { SessionHelpers } from '/imports/api/sessions';
import { UsersCollection } from '/imports/api/users';
import {
  ResearchDocumentsCollection,
  RESEARCH_CATEGORIES,
  RESEARCH_CATEGORY_CONFIG,
  RESEARCH_LANGUAGE_CONFIG,
  RESEARCH_LANGUAGE_ORDER,
  RESEARCH_URL_PREFIX,
  canReadResearch,
  canWriteResearch,
  canDeleteResearch,
  formatResearchPeriod,
  getResearchFile,
  getResearchFileMap,
  getResearchLanguages,
  resolveResearchLanguage
} from '/imports/api/researchDocuments';
import { getResearchDir } from '/imports/api/documentStorage';
import { issueDocumentToken } from '../documentAccess.js';
import { AuditLog } from '/imports/api/auditLog';

const MAX_RESEARCH_BYTES = 25 * 1024 * 1024; // 25 MB, same ceiling as client documents
const MAX_TEXT = 300;
const MAX_DESCRIPTION = 2000;

// The store is flat: one safe path segment, nothing else. Enforced here and at
// the HTTP edge.
export const SAFE_RESEARCH_FILENAME = /^[A-Za-z0-9_-]+\.pdf$/;

async function resolveActiveUser(sessionId) {
  // SessionHelpers.validateSession string-guards sessionId (NoSQL selector
  // injection) — never look sessions up any other way.
  const session = await SessionHelpers.validateSession(sessionId);
  if (!session) throw new Meteor.Error('not-authorized', 'Invalid or expired session');
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) throw new Meteor.Error('not-authorized', 'User not found');
  return user;
}

function ensureReader(user) {
  if (!canReadResearch(user)) {
    throw new Meteor.Error('not-authorized', 'Research library is internal');
  }
}

function ensureWriter(user) {
  if (!canWriteResearch(user)) {
    throw new Meteor.Error('not-authorized', 'Your role cannot upload research documents');
  }
}

function displayName(user) {
  return [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ').trim()
    || user.username || user.email || 'Unknown';
}

function cleanText(value, max, { required = false, label = 'Field' } = {}) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new Meteor.Error('invalid-argument', `${label} is required`);
  return text.slice(0, max);
}

/**
 * Parse the document's own date. For month-granularity categories the day is
 * pinned to the 1st (UTC) so two uploads for the same month compare equal.
 */
function parseDocumentDate(raw, category) {
  const date = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Meteor.Error('invalid-argument', 'A valid document date is required');
  }
  if (RESEARCH_CATEGORY_CONFIG[category]?.dateGranularity === 'month') {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeSecurity(security, category) {
  if (!RESEARCH_CATEGORY_CONFIG[category]?.hasSecurity) return null;
  const ticker = cleanText(security?.ticker, 32).toUpperCase();
  const name = cleanText(security?.name, MAX_TEXT);
  const isin = cleanText(security?.isin, 12).toUpperCase();
  if (!ticker && !name && !isin) {
    throw new Meteor.Error('invalid-argument', 'Stock research needs at least a ticker or a company name');
  }
  if (isin && !/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) {
    throw new Meteor.Error('invalid-argument', `"${isin}" is not a valid ISIN`);
  }
  return { ticker: ticker || null, name: name || null, isin: isin || null };
}

function resolveStoredPath(storedFileName) {
  if (!SAFE_RESEARCH_FILENAME.test(storedFileName)) return null;
  const dir = path.resolve(getResearchDir());
  const filePath = path.resolve(dir, storedFileName);
  if (!filePath.startsWith(dir + path.sep)) return null;
  return filePath;
}

/** Remove a stored PDF; a missing file is not an error (the entry is going away). */
function deleteStoredFile(storedFileName, context) {
  if (!storedFileName) return;
  const filePath = resolveStoredPath(storedFileName);
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (error) {
    console.error(`[Research] Failed to delete file ${storedFileName} (${context}):`, error.message);
  }
}

function languageLabel(language) {
  return RESEARCH_LANGUAGE_CONFIG[language]?.label || language;
}

/**
 * Validate an uploaded PDF and write it to the research store, returning the
 * file entry to be stored under files.<language>.
 */
function writeLanguageFile({ category, language, documentDate, fileName, base64Data, user }) {
  // File type is proven by content, not by the client's filename or MIME.
  if (!/\.pdf$/i.test(fileName)) {
    throw new Meteor.Error('invalid-argument', `Only PDF files are accepted (${languageLabel(language)})`);
  }
  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_RESEARCH_BYTES) {
    throw new Meteor.Error('invalid-argument', `The ${languageLabel(language)} file is empty or exceeds the 25 MB limit`);
  }
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Meteor.Error('invalid-argument', `The ${languageLabel(language)} file is not a valid PDF`);
  }

  const stamp = documentDate.toISOString().slice(0, 10).replace(/-/g, '');
  const storedFileName = `${category}_${language}_${stamp}_${Random.id(10)}.pdf`;
  const filePath = resolveStoredPath(storedFileName);
  if (!filePath) throw new Meteor.Error('internal', 'Could not resolve storage path');

  const dir = path.dirname(filePath);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, buffer);
  } catch (error) {
    console.error('[Research] Failed to write file:', error);
    throw new Meteor.Error('file-system-error', 'Failed to save the PDF');
  }

  return {
    fileName: String(fileName).slice(0, 255),
    storedFileName,
    fileSize: buffer.length,
    mimeType: 'application/pdf',
    uploadedBy: user._id,
    uploadedByName: displayName(user),
    uploadedAt: new Date()
  };
}

const securityMatch = Match.Maybe(Match.OneOf(null, {
  ticker: Match.Maybe(Match.OneOf(String, null)),
  name: Match.Maybe(Match.OneOf(String, null)),
  isin: Match.Maybe(Match.OneOf(String, null))
}));

const languageMatch = Match.Where((value) => {
  check(value, String);
  return RESEARCH_LANGUAGE_ORDER.includes(value);
});

Meteor.methods({
  /**
   * Upload a research PDF, creating the entry with its first language edition.
   * Further languages are attached with research.addVersion — one call per
   * file, so a two-language upload never puts 50 MB on a single DDP message.
   *
   * @param {string} sessionId
   * @param {Object} payload { category, title, description, documentDate, security, language, fileName, base64Data }
   */
  async 'research.upload'(sessionId, payload) {
    check(sessionId, String);
    check(payload, {
      category: Match.OneOf(...Object.values(RESEARCH_CATEGORIES)),
      title: Match.Maybe(String),
      description: Match.Maybe(String),
      documentDate: Match.OneOf(Date, String),
      security: securityMatch,
      language: languageMatch,
      fileName: String,
      base64Data: String
    });

    const user = await resolveActiveUser(sessionId);
    ensureWriter(user);

    const { category, language } = payload;
    const config = RESEARCH_CATEGORY_CONFIG[category];

    const documentDate = parseDocumentDate(payload.documentDate, category);
    const security = normalizeSecurity(payload.security, category);
    const periodLabel = formatResearchPeriod(documentDate, category);
    const title = cleanText(payload.title, MAX_TEXT)
      || (security ? [security.ticker, security.name].filter(Boolean).join(' — ') : `${config.label} — ${periodLabel}`);
    const description = cleanText(payload.description, MAX_DESCRIPTION);

    const file = writeLanguageFile({
      category,
      language,
      documentDate,
      fileName: payload.fileName,
      base64Data: payload.base64Data,
      user
    });

    const now = new Date();
    let docId;
    try {
      docId = await ResearchDocumentsCollection.insertAsync({
        category,
        title,
        description,
        documentDate,
        periodLabel,
        security,
        files: { [language]: file },
        languages: [language],
        uploadedBy: user._id,
        uploadedByName: displayName(user),
        uploadedAt: now,
        updatedAt: now
      });
    } catch (error) {
      // Never leave an orphan PDF behind when the metadata insert fails.
      deleteStoredFile(file.storedFileName, 'insert rollback');
      throw error;
    }

    await AuditLog.record({
      actorUserId: user._id,
      actorRole: user.role,
      action: 'research.upload',
      targetType: 'researchDocument',
      targetId: docId,
      meta: { category, title, language, fileSize: file.fileSize }
    });

    console.log(`[Research] ${displayName(user)} uploaded ${category} "${title}" [${language}] (${file.fileSize} bytes) -> ${file.storedFileName}`);
    return { success: true, documentId: docId };
  },

  /**
   * Attach — or replace — one language edition of an existing document. The
   * metadata is untouched: this is the same document in another language.
   */
  async 'research.addVersion'(sessionId, documentId, payload) {
    check(sessionId, String);
    check(documentId, String);
    check(payload, {
      language: languageMatch,
      fileName: String,
      base64Data: String
    });

    const user = await resolveActiveUser(sessionId);
    ensureWriter(user);

    const doc = await ResearchDocumentsCollection.findOneAsync(documentId);
    if (!doc) throw new Meteor.Error('not-found', 'Research document not found');

    const { language } = payload;
    const previous = getResearchFile(doc, language);
    // Adding a missing translation is collaborative — any writer may. Replacing
    // an edition destroys someone else's file, so it needs the same right as
    // deleting it.
    if (previous && !canDeleteResearch(user, doc)) {
      throw new Meteor.Error('not-authorized', 'Only the uploader or an admin can replace an existing version');
    }

    const file = writeLanguageFile({
      category: doc.category,
      language,
      documentDate: doc.documentDate instanceof Date ? doc.documentDate : new Date(doc.documentDate),
      fileName: payload.fileName,
      base64Data: payload.base64Data,
      user
    });

    // getResearchFileMap folds a pre-split single-file document into the map,
    // so an entry never ends up carrying both shapes.
    const files = { ...getResearchFileMap(doc), [language]: file };
    const languages = RESEARCH_LANGUAGE_ORDER.filter((lang) => files[lang]);

    try {
      await ResearchDocumentsCollection.updateAsync(documentId, {
        $set: { files, languages, updatedAt: new Date() },
        $unset: { storedFileName: '', fileName: '', fileSize: '', mimeType: '' }
      });
    } catch (error) {
      deleteStoredFile(file.storedFileName, 'addVersion rollback');
      throw error;
    }

    // Only once the new file is recorded is the replaced one expendable.
    if (previous?.storedFileName) deleteStoredFile(previous.storedFileName, 'replaced version');

    await AuditLog.record({
      actorUserId: user._id,
      actorRole: user.role,
      action: previous ? 'research.replaceVersion' : 'research.addVersion',
      targetType: 'researchDocument',
      targetId: documentId,
      meta: { category: doc.category, title: doc.title, language, fileSize: file.fileSize }
    });

    console.log(`[Research] ${displayName(user)} ${previous ? 'replaced' : 'added'} the ${language} version of "${doc.title}" -> ${file.storedFileName}`);
    return { success: true, documentId, language };
  },

  /**
   * Remove one language edition. The last remaining one cannot be removed —
   * deleting the document is how you remove everything.
   */
  async 'research.removeVersion'(sessionId, documentId, language) {
    check(sessionId, String);
    check(documentId, String);
    check(language, languageMatch);

    const user = await resolveActiveUser(sessionId);
    const doc = await ResearchDocumentsCollection.findOneAsync(documentId);
    if (!doc) throw new Meteor.Error('not-found', 'Research document not found');
    if (!canDeleteResearch(user, doc)) {
      throw new Meteor.Error('not-authorized', 'You can only remove versions of documents you uploaded');
    }

    const files = getResearchFileMap(doc);
    const target = files[language];
    if (!target) throw new Meteor.Error('not-found', `This document has no ${languageLabel(language)} version`);
    if (Object.keys(files).length <= 1) {
      throw new Meteor.Error('invalid-argument', 'This is the only version — delete the document instead');
    }

    delete files[language];
    const languages = RESEARCH_LANGUAGE_ORDER.filter((lang) => files[lang]);

    await ResearchDocumentsCollection.updateAsync(documentId, {
      $set: { files, languages, updatedAt: new Date() },
      $unset: { storedFileName: '', fileName: '', fileSize: '', mimeType: '' }
    });
    deleteStoredFile(target.storedFileName, 'removed version');

    await AuditLog.record({
      actorUserId: user._id,
      actorRole: user.role,
      action: 'research.removeVersion',
      targetType: 'researchDocument',
      targetId: documentId,
      meta: { category: doc.category, title: doc.title, language }
    });
    return { success: true };
  },

  /**
   * Edit a document's metadata (the PDFs themselves are immutable — upload a
   * new version to replace one).
   */
  async 'research.updateMetadata'(sessionId, documentId, changes) {
    check(sessionId, String);
    check(documentId, String);
    check(changes, {
      title: Match.Maybe(String),
      description: Match.Maybe(String),
      documentDate: Match.Maybe(Match.OneOf(Date, String)),
      security: securityMatch
    });

    const user = await resolveActiveUser(sessionId);
    ensureWriter(user);

    const doc = await ResearchDocumentsCollection.findOneAsync(documentId);
    if (!doc) throw new Meteor.Error('not-found', 'Research document not found');

    const $set = { updatedAt: new Date() };
    if (changes.documentDate !== undefined) {
      $set.documentDate = parseDocumentDate(changes.documentDate, doc.category);
      $set.periodLabel = formatResearchPeriod($set.documentDate, doc.category);
    }
    if (changes.security !== undefined) {
      $set.security = normalizeSecurity(changes.security, doc.category);
    }
    if (changes.title !== undefined) {
      $set.title = cleanText(changes.title, MAX_TEXT, { required: true, label: 'Title' });
    }
    if (changes.description !== undefined) {
      $set.description = cleanText(changes.description, MAX_DESCRIPTION);
    }

    await ResearchDocumentsCollection.updateAsync(documentId, { $set });
    return { success: true };
  },

  /**
   * Delete a document and every language file it holds. Admins may delete
   * anything, other writers only their own uploads.
   */
  async 'research.delete'(sessionId, documentId) {
    check(sessionId, String);
    check(documentId, String);

    const user = await resolveActiveUser(sessionId);
    const doc = await ResearchDocumentsCollection.findOneAsync(documentId);
    if (!doc) throw new Meteor.Error('not-found', 'Research document not found');
    if (!canDeleteResearch(user, doc)) {
      throw new Meteor.Error('not-authorized', 'You can only delete documents you uploaded');
    }

    const files = getResearchFileMap(doc);
    Object.entries(files).forEach(([language, file]) => {
      deleteStoredFile(file.storedFileName, `delete ${language}`);
    });

    await ResearchDocumentsCollection.removeAsync(documentId);
    await AuditLog.record({
      actorUserId: user._id,
      actorRole: user.role,
      action: 'research.delete',
      targetType: 'researchDocument',
      targetId: documentId,
      meta: { category: doc.category, title: doc.title, languages: Object.keys(files) }
    });
    return { success: true };
  },

  /**
   * Mint a short-lived download URL for the /research endpoint. `language` is
   * optional: the document's first available edition is served when the one
   * asked for does not exist.
   */
  async 'research.getDownloadUrl'(sessionId, documentId, language) {
    check(sessionId, String);
    check(documentId, String);
    check(language, Match.Maybe(Match.OneOf(null, String)));

    const user = await resolveActiveUser(sessionId);
    ensureReader(user);

    const doc = await ResearchDocumentsCollection.findOneAsync(documentId);
    if (!doc) throw new Meteor.Error('not-found', 'Research document not found');

    const resolved = resolveResearchLanguage(doc, language || null);
    if (!resolved) throw new Meteor.Error('not-found', 'This document has no file attached');
    const file = getResearchFile(doc, resolved);
    if (!SAFE_RESEARCH_FILENAME.test(file.storedFileName)) {
      throw new Meteor.Error('internal', 'Stored filename is invalid');
    }

    const publicPath = `${RESEARCH_URL_PREFIX}/${file.storedFileName}`;
    const token = await issueDocumentToken(publicPath, user._id);
    return {
      url: `${publicPath}?dl=${token}`,
      fileName: file.fileName,
      language: resolved,
      availableLanguages: getResearchLanguages(doc)
    };
  }
});
