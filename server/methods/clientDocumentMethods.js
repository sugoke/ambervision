/**
 * Client Document Methods
 *
 * Server methods for managing client compliance documents
 * (ID, Residency Card, Proof of Address)
 */

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import fs from 'fs';
import path from 'path';
import { ClientDocumentsCollection, DOCUMENT_TYPES } from '/imports/api/clientDocuments.js';
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions.js';
import { UsersCollection } from '/imports/api/users.js';
import { issueDocumentToken } from '../documentAccess.js';
import { getFichierCentralDir } from '/imports/api/documentStorage.js';
import { BankAccountsCollection, accountHolderSelector } from '/imports/api/bankAccounts.js';

// A document bound to a portfolio (e.g. a signed portfolio) may only name a bank
// account that belongs to the document's subject: as holder or co-holder (same
// rule as the client's account list) or as beneficial owner.
async function assertAccountOfSubject(bankAccountId, subjectId) {
  if (!bankAccountId) return;
  const account = await BankAccountsCollection.findOneAsync({
    _id: bankAccountId,
    $or: [
      accountHolderSelector([subjectId]),
      { beneficialOwnerIds: subjectId },
      { beneficialOwnerId: subjectId }
    ]
  }, { fields: { _id: 1 } });
  if (!account) {
    throw new Meteor.Error('invalid-argument', 'This portfolio does not belong to the client');
  }
}

/**
 * Validate session and get user
 */
async function validateSession(sessionId) {
  // SECURITY: string-only — reject selector objects ({$gt:""}) that would otherwise
  // match the first live session (NoSQL auth-bypass).
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionHelpers.findByToken(sessionId);

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  return user;
}

// Base path for document storage.
// SECURITY/GDPR: never falls back to public/ — Meteor serves that tree
// unauthenticated, which would expose passport scans and KYC files. Resolved
// by imports/api/documentStorage.js, the same module /fichier_central reads.
const getDocumentsBasePath = () => getFichierCentralDir();

// SECURITY: a document "subject" id is used as a directory name and must never be
// able to escape the storage root. Meteor/entity ids are alphanumeric; reject anything
// else (path separators, '..', dots, whitespace) before it reaches the filesystem.
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const assertSafeSubjectId = (userId) => {
  if (typeof userId !== 'string' || !SAFE_ID.test(userId)) {
    throw new Meteor.Error('invalid-argument', 'Invalid document subject id');
  }
};

// Client documents are KYC/PII. Only the subject themselves or a staff member may
// read or mutate them — a bare valid session is not sufficient (matches getDownloadUrl).
const STAFF_ROLES = ['admin', 'superadmin', 'compliance', 'rm', 'assistant'];
const authorizeDocumentSubject = (user, subjectUserId) => {
  const isSelf = user._id === subjectUserId;
  const isStaff = STAFF_ROLES.includes(user.role);
  if (!isSelf && !isStaff) {
    throw new Meteor.Error('not-authorized', 'Not authorized for this client\'s documents');
  }
};

// Only these document types may be stored, matched by extension AND mime.
//
// Word is accepted because KYC files and corporate deeds (articles, signatory
// powers) routinely arrive as .doc/.docx. It is safe to store and serve: the
// stored extension comes from this allowlist rather than the client's filename,
// and the document endpoint serves Word as a download, never rendered inline.
// The MIME side stays an exact list, not a prefix — 'application/' as a prefix
// would wave through anything.
const WORD_EXTENSIONS = new Set(['.doc', '.docx']);
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif', '.tif', '.tiff',
  ...WORD_EXTENSIONS
]);
const ALLOWED_MIME_PREFIXES = ['image/', 'application/pdf'];
const ALLOWED_WORD_MIMES = new Set([
  'application/msword',                                                       // .doc
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'   // .docx
]);
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024; // 25 MB

// Ensure user directory exists (also used to file finalized meeting reports
// as visit reports — server/helpers/meetingReportFiling.js)
export const ensureUserDirectory = (userId) => {
  assertSafeSubjectId(userId);
  const basePath = getDocumentsBasePath();
  const userDir = path.join(basePath, userId);

  // Defence in depth: confirm the resolved directory is still inside the root.
  const resolvedBase = path.resolve(basePath);
  const resolvedDir = path.resolve(userDir);
  if (resolvedDir !== resolvedBase && !resolvedDir.startsWith(resolvedBase + path.sep)) {
    throw new Meteor.Error('invalid-argument', 'Resolved path escapes storage root');
  }

  if (!fs.existsSync(basePath)) {
    fs.mkdirSync(basePath, { recursive: true });
  }

  if (!fs.existsSync(userDir)) {
    fs.mkdirSync(userDir, { recursive: true });
  }

  return userDir;
};

Meteor.methods({
  /**
   * Upload a client document
   * @param {Object} params - Upload parameters
   * @param {string} params.userId - Client's user ID
   * @param {number|null} params.familyMemberIndex - Index in familyMembers array, null for main client
   * @param {string} params.documentType - Type of document (id, residency_card, proof_of_address)
   * @param {string} params.fileName - Original filename
   * @param {string} params.base64Data - Base64-encoded file data
   * @param {string} params.mimeType - File MIME type
   * @param {Date} params.expirationDate - Expiration date (for ID and residency card)
   * @param {string} params.documentNumber - ID/Passport number or document reference
   * @param {Date} params.issuanceDate - Date when document was issued
   * @param {string} params.sessionId - Session ID for authentication
   */
  async 'clientDocuments.upload'({ userId, familyMemberIndex, documentType, fileName, base64Data, mimeType, expirationDate, documentNumber, issuanceDate, bankAccountId, sessionId }) {
    check(bankAccountId, Match.Maybe(Match.OneOf(String, null)));
    check(userId, String);
    check(familyMemberIndex, Match.Maybe(Match.OneOf(Number, null)));
    check(documentType, Match.OneOf(...Object.values(DOCUMENT_TYPES)));
    check(fileName, String);
    check(base64Data, String);
    check(mimeType, String);
    check(expirationDate, Match.Maybe(Match.OneOf(Date, String, null)));
    check(documentNumber, Match.Maybe(Match.OneOf(String, null)));
    check(issuanceDate, Match.Maybe(Match.OneOf(Date, String, null)));
    check(sessionId, String);

    // Verify caller is logged in via session
    const currentUser = await validateSession(sessionId);

    // SECURITY: subject id must be a safe token, and the caller must be the subject
    // or staff — this is KYC/PII and was previously writable by any logged-in user
    // with an arbitrary (traversal-capable) userId.
    assertSafeSubjectId(userId);
    authorizeDocumentSubject(currentUser, userId);
    await assertAccountOfSubject(bankAccountId, userId);

    // SECURITY: restrict stored file type (extension + mime) and size. The extension
    // is derived ONLY from an allowlist, never trusted from the client filename, so a
    // caller cannot plant a served .html/.js payload in the dev static path.
    const rawExt = (path.extname(fileName) || '').toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(rawExt)) {
      throw new Meteor.Error('invalid-argument', `Unsupported file type: ${rawExt || '(none)'}`);
    }
    const mimeAllowed = ALLOWED_MIME_PREFIXES.some(p => mimeType.startsWith(p))
      || ALLOWED_WORD_MIMES.has(mimeType);
    if (!mimeAllowed) {
      throw new Meteor.Error('invalid-argument', `Unsupported MIME type: ${mimeType}`);
    }
    // Extension and MIME must agree on whether this is a Word file, so a Word
    // payload can't be stored under a .pdf extension (or the reverse).
    if (WORD_EXTENSIONS.has(rawExt) !== ALLOWED_WORD_MIMES.has(mimeType)) {
      throw new Meteor.Error('invalid-argument', `File type ${rawExt} does not match MIME type ${mimeType}`);
    }
    const buffer = Buffer.from(base64Data, 'base64');
    if (buffer.length === 0 || buffer.length > MAX_DOCUMENT_BYTES) {
      throw new Meteor.Error('invalid-argument', 'File is empty or exceeds the 25 MB limit');
    }

    // Generate unique stored filename
    const timestamp = Date.now();
    const ext = rawExt;
    const familySuffix = familyMemberIndex !== null && familyMemberIndex !== undefined ? `_fm${familyMemberIndex}` : '';
    const storedFileName = `${documentType}${familySuffix}_${timestamp}${ext}`;

    // Get user directory
    const userDir = ensureUserDirectory(userId);
    const filePath = path.join(userDir, storedFileName);

    const subjectLabel = familyMemberIndex !== null && familyMemberIndex !== undefined
      ? `family member #${familyMemberIndex}`
      : 'main client';
    console.log(`Uploading client document: ${documentType} for ${subjectLabel} of user ${userId}`);
    console.log(`   File: ${fileName} -> ${storedFileName}`);
    console.log(`   Path: ${filePath}`);

    // Several files are allowed per document type, so we simply add a new record
    // for each upload (the timestamped storedFileName keeps files distinct).

    // Save new file (buffer validated above)
    try {
      fs.writeFileSync(filePath, buffer);
      console.log(`Document saved: ${filePath} (${buffer.length} bytes)`);
    } catch (error) {
      console.error('Error saving document file:', error);
      throw new Meteor.Error('file-system-error', 'Failed to save document file');
    }

    // Parse expiration date if string
    let parsedExpirationDate = null;
    if (expirationDate) {
      parsedExpirationDate = typeof expirationDate === 'string' ? new Date(expirationDate) : expirationDate;
    }

    // Parse issuance date if string
    let parsedIssuanceDate = null;
    if (issuanceDate) {
      parsedIssuanceDate = typeof issuanceDate === 'string' ? new Date(issuanceDate) : issuanceDate;
    }

    // Create database record
    const docId = await ClientDocumentsCollection.insertAsync({
      userId,
      familyMemberIndex: familyMemberIndex ?? null,
      documentType,
      fileName,
      storedFileName,
      filePath,
      mimeType,
      fileSize: buffer.length,
      uploadedAt: new Date(),
      uploadedBy: currentUser._id,
      expirationDate: parsedExpirationDate,
      documentNumber: documentNumber || null,
      issuanceDate: parsedIssuanceDate,
      bankAccountId: bankAccountId || null
    });

    console.log(`Document record created: ${docId}`);

    return { success: true, documentId: docId };
  },

  /**
   * Delete a client document
   * @param {string} documentId - Document ID to delete
   * @param {string} sessionId - Session ID for authentication
   */
  async 'clientDocuments.delete'(documentId, sessionId) {
    check(documentId, String);
    check(sessionId, String);

    const currentUser = await validateSession(sessionId);

    const doc = await ClientDocumentsCollection.findOneAsync(documentId);
    if (!doc) {
      throw new Meteor.Error('not-found', 'Document not found');
    }
    authorizeDocumentSubject(currentUser, doc.userId);

    console.log(`🗑️ Deleting client document: ${doc.documentType} for user ${doc.userId}`);

    // Delete file
    try {
      if (fs.existsSync(doc.filePath)) {
        fs.unlinkSync(doc.filePath);
        console.log(`   File deleted: ${doc.filePath}`);
      }
    } catch (error) {
      console.error('Error deleting document file:', error);
    }

    // Remove database record
    await ClientDocumentsCollection.removeAsync(documentId);

    return { success: true };
  },

  /**
   * Update document expiration date
   * @param {string} documentId - Document ID
   * @param {Date} expirationDate - New expiration date
   * @param {string} sessionId - Session ID for authentication
   */
  async 'clientDocuments.updateExpiration'(documentId, expirationDate, sessionId) {
    check(documentId, String);
    check(expirationDate, Match.OneOf(Date, String, null));
    check(sessionId, String);

    const currentUser = await validateSession(sessionId);

    const doc = await ClientDocumentsCollection.findOneAsync(documentId);
    if (!doc) {
      throw new Meteor.Error('not-found', 'Document not found');
    }
    authorizeDocumentSubject(currentUser, doc.userId);

    // Parse date if string
    let parsedDate = null;
    if (expirationDate) {
      parsedDate = typeof expirationDate === 'string' ? new Date(expirationDate) : expirationDate;
    }

    await ClientDocumentsCollection.updateAsync(documentId, {
      $set: { expirationDate: parsedDate }
    });

    console.log(`📅 Updated expiration date for document ${documentId}: ${parsedDate}`);

    return { success: true };
  },

  /**
   * Update document details (number and issuance date)
   * @param {string} documentId - Document ID
   * @param {Object} details - Details to update
   * @param {string} details.documentNumber - ID/Passport number
   * @param {Date} details.issuanceDate - Issuance date
   * @param {string} sessionId - Session ID for authentication
   */
  async 'clientDocuments.updateDetails'(documentId, details, sessionId) {
    check(documentId, String);
    check(details, {
      documentNumber: Match.Maybe(Match.OneOf(String, null)),
      issuanceDate: Match.Maybe(Match.OneOf(Date, String, null)),
      bankAccountId: Match.Maybe(Match.OneOf(String, null))
    });
    check(sessionId, String);

    const currentUser = await validateSession(sessionId);

    const doc = await ClientDocumentsCollection.findOneAsync(documentId);
    if (!doc) {
      throw new Meteor.Error('not-found', 'Document not found');
    }
    authorizeDocumentSubject(currentUser, doc.userId);

    const updateFields = {};

    if (details.documentNumber !== undefined) {
      updateFields.documentNumber = details.documentNumber || null;
    }

    if (details.issuanceDate !== undefined) {
      let parsedDate = null;
      if (details.issuanceDate) {
        parsedDate = typeof details.issuanceDate === 'string' ? new Date(details.issuanceDate) : details.issuanceDate;
      }
      updateFields.issuanceDate = parsedDate;
    }

    if (details.bankAccountId !== undefined) {
      await assertAccountOfSubject(details.bankAccountId, doc.userId);
      updateFields.bankAccountId = details.bankAccountId || null;
    }

    if (Object.keys(updateFields).length > 0) {
      await ClientDocumentsCollection.updateAsync(documentId, {
        $set: updateFields
      });
      console.log(`📝 Updated document details for ${documentId}:`, updateFields);
    }

    return { success: true };
  },

  /**
   * Get document download URL
   * @param {string} documentId - Document ID
   * @param {string} sessionId - Session ID for authentication
   */
  async 'clientDocuments.getDownloadUrl'(documentId, sessionId) {
    check(documentId, String);
    check(sessionId, String);

    const user = await validateSession(sessionId);

    const doc = await ClientDocumentsCollection.findOneAsync(documentId);
    if (!doc) {
      throw new Meteor.Error('not-found', 'Document not found');
    }

    // Authorize: the client themselves, or a staff member (client documents are
    // KYC/PII, so a bare valid session is not sufficient).
    const STAFF_ROLES = ['admin', 'superadmin', 'compliance', 'rm', 'assistant'];
    const isSelf = user._id === doc.userId;
    const isStaff = STAFF_ROLES.includes(user.role);
    if (!isSelf && !isStaff) {
      throw new Meteor.Error('not-authorized', 'Not authorized to access this document');
    }

    // Mint a short-lived, single-use token bound to this exact path. The
    // endpoint (/fichier_central) requires it — the URL alone is not enough.
    const filePath = `/fichier_central/${doc.userId}/${doc.storedFileName}`;
    const token = await issueDocumentToken(filePath, user._id);
    return `${filePath}?dl=${token}`;
  }
});
