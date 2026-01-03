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
import { SessionsCollection } from '/imports/api/sessions.js';
import { UsersCollection } from '/imports/api/users.js';

/**
 * Validate session and get user
 */
async function validateSession(sessionId) {
  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session required');
  }

  const session = await SessionsCollection.findOneAsync({
    sessionId,
    isActive: true
  });

  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid session');
  }

  const user = await UsersCollection.findOneAsync(session.userId);

  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }

  return user;
}

// Base path for document storage
const getDocumentsBasePath = () => {
  if (process.env.FICHIER_CENTRAL_PATH) {
    return process.env.FICHIER_CENTRAL_PATH;
  }
  // Development fallback - use project's public directory
  let projectRoot = process.cwd();
  if (projectRoot.includes('.meteor')) {
    projectRoot = projectRoot.split('.meteor')[0].replace(/[\\\/]$/, '');
  }
  return path.join(projectRoot, 'public', 'fichier_central');
};

// Ensure user directory exists
const ensureUserDirectory = (userId) => {
  const basePath = getDocumentsBasePath();
  const userDir = path.join(basePath, userId);

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
   * @param {string} params.sessionId - Session ID for authentication
   */
  async 'clientDocuments.upload'({ userId, familyMemberIndex, documentType, fileName, base64Data, mimeType, expirationDate, sessionId }) {
    check(userId, String);
    check(familyMemberIndex, Match.Maybe(Match.OneOf(Number, null)));
    check(documentType, Match.OneOf(...Object.values(DOCUMENT_TYPES)));
    check(fileName, String);
    check(base64Data, String);
    check(mimeType, String);
    check(expirationDate, Match.Maybe(Match.OneOf(Date, String, null)));
    check(sessionId, String);

    // Verify caller is logged in via session
    const currentUser = await validateSession(sessionId);

    // Generate unique stored filename
    const timestamp = Date.now();
    const ext = path.extname(fileName) || '.pdf';
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

    // Delete existing document of same type for same subject if exists
    const existingDoc = await ClientDocumentsCollection.findOneAsync({
      userId,
      documentType,
      familyMemberIndex: familyMemberIndex ?? null
    });

    if (existingDoc) {
      // Delete old file
      try {
        if (fs.existsSync(existingDoc.filePath)) {
          fs.unlinkSync(existingDoc.filePath);
          console.log(`Deleted old document: ${existingDoc.filePath}`);
        }
      } catch (err) {
        console.error('Error deleting old document file:', err);
      }

      // Remove old database record
      await ClientDocumentsCollection.removeAsync(existingDoc._id);
    }

    // Save new file
    try {
      const buffer = Buffer.from(base64Data, 'base64');
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

    // Create database record
    const docId = await ClientDocumentsCollection.insertAsync({
      userId,
      familyMemberIndex: familyMemberIndex ?? null,
      documentType,
      fileName,
      storedFileName,
      filePath,
      mimeType,
      fileSize: Buffer.from(base64Data, 'base64').length,
      uploadedAt: new Date(),
      uploadedBy: currentUser._id,
      expirationDate: parsedExpirationDate
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

    await validateSession(sessionId);

    const doc = await ClientDocumentsCollection.findOneAsync(documentId);
    if (!doc) {
      throw new Meteor.Error('not-found', 'Document not found');
    }

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

    await validateSession(sessionId);

    const doc = await ClientDocumentsCollection.findOneAsync(documentId);
    if (!doc) {
      throw new Meteor.Error('not-found', 'Document not found');
    }

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
   * Get document download URL
   * @param {string} documentId - Document ID
   * @param {string} sessionId - Session ID for authentication
   */
  async 'clientDocuments.getDownloadUrl'(documentId, sessionId) {
    check(documentId, String);
    check(sessionId, String);

    await validateSession(sessionId);

    const doc = await ClientDocumentsCollection.findOneAsync(documentId);
    if (!doc) {
      throw new Meteor.Error('not-found', 'Document not found');
    }

    // Return URL for file serving
    return `/fichier_central/${doc.userId}/${doc.storedFileName}`;
  }
});
