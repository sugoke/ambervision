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
  PROOF_OF_ADDRESS: 'proof_of_address'
};

/**
 * Document type configuration
 */
export const DOCUMENT_TYPE_CONFIG = {
  [DOCUMENT_TYPES.ID]: {
    label: 'ID / Passport',
    requiresExpiration: true,
    icon: '🪪'
  },
  [DOCUMENT_TYPES.RESIDENCY_CARD]: {
    label: 'Residency Card',
    requiresExpiration: true,
    icon: '🏠'
  },
  [DOCUMENT_TYPES.PROOF_OF_ADDRESS]: {
    label: 'Proof of Address',
    requiresExpiration: false,
    icon: '📄'
  }
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
   * Check if proof of address is stale (> 6 months old)
   */
  isProofOfAddressStale(uploadedAt) {
    if (!uploadedAt) return false;
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    return new Date(uploadedAt) < sixMonthsAgo;
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
    } else {
      // Proof of address - check staleness
      if (this.isProofOfAddressStale(doc.uploadedAt)) {
        return { status: 'stale', message: 'Document is older than 6 months' };
      }
      return { status: 'ok', message: 'Valid' };
    }
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
  Meteor.startup(() => {
    // Unique index for one document per type per person (main client or family member)
    ClientDocumentsCollection.createIndexAsync(
      { userId: 1, documentType: 1, familyMemberIndex: 1 },
      { unique: true }
    );
    ClientDocumentsCollection.createIndexAsync({ expirationDate: 1 });
  });
}
