import { Mongo } from 'meteor/mongo';

// Order Counters collection for generating sequential reference numbers
export const OrderCountersCollection = new Mongo.Collection('orderCounters');

// Counter schema structure:
// {
//   year: Number,        // e.g., 2025
//   lastNumber: Number   // Last used number for this year
// }

// Helper functions for order counter management
export const OrderCounterHelpers = {
  /**
   * Generate next order reference number (atomic operation)
   * Format: YYYY-XXXXX (e.g., 2025-00001)
   * @returns {Promise<string>} The generated order reference
   */
  async generateNextReference() {
    const currentYear = new Date().getFullYear();

    // Find and update counter atomically using MongoDB's findAndModify
    const result = await OrderCountersCollection.rawCollection().findOneAndUpdate(
      { year: currentYear },
      { $inc: { lastNumber: 1 } },
      {
        upsert: true,
        returnDocument: 'after'
      }
    );

    const nextNumber = result.lastNumber;
    const reference = `${currentYear}-${String(nextNumber).padStart(5, '0')}`;

    return reference;
  },

  /**
   * Get current counter value for a year (without incrementing)
   * @param {number} year - The year to check
   * @returns {Promise<number>} The current counter value
   */
  async getCurrentCount(year = new Date().getFullYear()) {
    const counter = await OrderCountersCollection.findOneAsync({ year });
    return counter?.lastNumber || 0;
  },

  /**
   * Reset counter for a year (admin only, use with caution)
   * @param {number} year - The year to reset
   * @param {number} startFrom - The number to start from (default: 0)
   * @returns {Promise<void>}
   */
  async resetCounter(year, startFrom = 0) {
    await OrderCountersCollection.upsertAsync(
      { year },
      { $set: { lastNumber: startFrom } }
    );
  },

  /**
   * Parse order reference to extract year and number
   * @param {string} reference - Order reference (e.g., 2025-00001)
   * @returns {Object|null} Parsed data or null if invalid
   */
  parseReference(reference) {
    const match = reference?.match(/^(\d{4})-(\d{5})$/);
    if (!match) return null;

    return {
      year: parseInt(match[1], 10),
      number: parseInt(match[2], 10)
    };
  },

  /**
   * Validate order reference format
   * @param {string} reference - Order reference to validate
   * @returns {boolean} True if valid format
   */
  isValidReference(reference) {
    return /^\d{4}-\d{5}$/.test(reference);
  }
};
