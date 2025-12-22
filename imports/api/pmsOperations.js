import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';
import crypto from 'crypto';

export const PMSOperationsCollection = new Mongo.Collection('pmsOperations');

/**
 * PMS Operations Collection
 *
 * Stores standardized transaction/operations data from various bank operation files.
 * All bank-specific formats are converted to this unified schema.
 */

// Helper functions for PMS Operations management
export const PMSOperationsHelpers = {
  /**
   * Generate unique key for deduplication
   * Hash of: bankId + portfolioCode + operationCode + operationDate + instrumentCode
   */
  generateUniqueKey({ bankId, portfolioCode, operationCode, operationDate, instrumentCode }) {
    const data = `${bankId}|${portfolioCode}|${operationCode}|${operationDate.toISOString().split('T')[0]}|${instrumentCode || 'CASH'}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  },

  /**
   * Create or update an operation record
   */
  async upsertOperation(operationData) {
    check(operationData.bankId, String);
    check(operationData.portfolioCode, String);
    check(operationData.operationDate, Date);

    const uniqueKey = this.generateUniqueKey({
      bankId: operationData.bankId,
      portfolioCode: operationData.portfolioCode,
      operationCode: operationData.operationCode || 'UNKNOWN',
      operationDate: operationData.operationDate,
      instrumentCode: operationData.instrumentCode || 'CASH'
    });

    const now = new Date();

    // Check if record exists
    const existing = await PMSOperationsCollection.findOneAsync({ uniqueKey });

    if (existing) {
      // Update existing record
      await PMSOperationsCollection.updateAsync(existing._id, {
        $set: {
          ...operationData,
          uniqueKey,
          updatedAt: now,
          version: (existing.version || 0) + 1
        }
      });
      return { _id: existing._id, updated: true };
    } else {
      // Insert new record
      const operationId = await PMSOperationsCollection.insertAsync({
        ...operationData,
        uniqueKey,
        isActive: true,
        version: 1,
        createdAt: now,
        updatedAt: now
      });
      return { _id: operationId, updated: false };
    }
  },

  /**
   * Get operations for a specific portfolio
   */
  async getPortfolioOperations(portfolioCode, options = {}) {
    const { bankId, limit = 100, skip = 0 } = options;

    const query = { portfolioCode, isActive: true };
    if (bankId) query.bankId = bankId;

    return await PMSOperationsCollection.find(query, {
      limit,
      skip,
      sort: { operationDate: -1, inputDate: -1 }
    }).fetchAsync();
  },

  /**
   * Get operations by date range
   */
  async getOperationsByDateRange(portfolioCode, startDate, endDate, bankId = null) {
    const query = {
      portfolioCode,
      isActive: true,
      operationDate: {
        $gte: startDate,
        $lte: endDate
      }
    };
    if (bankId) query.bankId = bankId;

    return await PMSOperationsCollection.find(query, {
      sort: { operationDate: -1 }
    }).fetchAsync();
  },

  /**
   * Get operations by type
   */
  async getOperationsByType(portfolioCode, operationType, bankId = null) {
    const query = { portfolioCode, operationType, isActive: true };
    if (bankId) query.bankId = bankId;

    return await PMSOperationsCollection.find(query).fetchAsync();
  },

  /**
   * Delete operations for a specific file
   */
  async deleteByFile(bankId, sourceFile) {
    return await PMSOperationsCollection.removeAsync({ bankId, sourceFile });
  },

  /**
   * Mark old operations as inactive
   */
  async deactivateOldOperations(bankId, portfolioCode, beforeDate) {
    return await PMSOperationsCollection.updateAsync(
      {
        bankId,
        portfolioCode,
        operationDate: { $lt: beforeDate },
        isActive: true
      },
      {
        $set: { isActive: false, updatedAt: new Date() }
      },
      { multi: true }
    );
  }
};

// Create indexes on server startup
if (Meteor.isServer) {
  Meteor.startup(async () => {
    try {
      // Unique index on uniqueKey for deduplication
      await PMSOperationsCollection.createIndexAsync({ uniqueKey: 1 }, { unique: true });

      // Compound index for common queries
      await PMSOperationsCollection.createIndexAsync({
        bankId: 1,
        portfolioCode: 1,
        operationDate: -1
      });

      // Index on ISIN for security lookups
      await PMSOperationsCollection.createIndexAsync({ isin: 1 });

      // Index on portfolio and active status
      await PMSOperationsCollection.createIndexAsync({
        portfolioCode: 1,
        isActive: 1
      });

      // Index on operation date for sorting
      await PMSOperationsCollection.createIndexAsync({ operationDate: -1 });

      // Index on operation type
      await PMSOperationsCollection.createIndexAsync({ operationType: 1 });

      console.log('[PMS_OPERATIONS] Indexes created successfully');
    } catch (error) {
      // Indexes might already exist
      console.log('[PMS_OPERATIONS] Skipping index creation (might already exist)');
    }
  });
}
