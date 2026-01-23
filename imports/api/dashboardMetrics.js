import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

/**
 * Dashboard Metrics Collection
 *
 * Stores pre-computed AUM metrics for fast dashboard loading.
 * Computed daily after CMB sync (09:00 CET) and cached for 24 hours.
 *
 * Schema:
 * {
 *   metricType: 'aum_summary',      // Type identifier
 *   scope: 'global',                // 'global' for admin view
 *
 *   // Summary metrics
 *   totalAUM: Number,               // Total AUM in EUR
 *   previousDayAUM: Number,         // Yesterday's AUM
 *   aumChange: Number,              // Absolute change
 *   aumChangePercent: Number,       // Percentage change
 *
 *   // WTD History (for chart)
 *   wtdHistory: [{ date: Date, value: Number }, ...],
 *
 *   // Metadata
 *   portfolioCount: Number,
 *   clientCount: Number,
 *   snapshotDate: Date,
 *   computedAt: Date,
 *   expiresAt: Date                 // TTL index
 * }
 */
export const DashboardMetricsCollection = new Mongo.Collection('dashboardMetrics');

if (Meteor.isServer) {
  // Create TTL index for automatic cleanup (expires based on expiresAt field)
  DashboardMetricsCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  // Create compound index for efficient lookup
  DashboardMetricsCollection.createIndex({ scope: 1, metricType: 1 });
}

// Cache duration in milliseconds (24 hours)
const CACHE_DURATION = 24 * 60 * 60 * 1000;

/**
 * Dashboard Metrics Helpers
 */
export const DashboardMetricsHelpers = {
  /**
   * Get cached metrics by scope and type
   * @param {String} scope - 'global' for admin view
   * @param {String} metricType - 'aum_summary'
   * @returns {Object|null} Cached metrics or null if expired/not found
   */
  async getMetrics(scope, metricType) {
    try {
      const now = new Date();
      const cached = await DashboardMetricsCollection.findOneAsync({
        scope,
        metricType,
        expiresAt: { $gt: now }
      });

      return cached || null;
    } catch (error) {
      console.error(`[DashboardMetrics] Error getting metrics (${scope}/${metricType}):`, error.message);
      return null;
    }
  },

  /**
   * Save computed metrics to cache
   * @param {Object} data - Metrics data to save
   * @returns {Object} Upsert result
   */
  async saveMetrics(data) {
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + CACHE_DURATION);

      const metricsData = {
        ...data,
        computedAt: now,
        expiresAt
      };

      // Upsert based on scope and metricType
      const result = await DashboardMetricsCollection.upsertAsync(
        { scope: data.scope, metricType: data.metricType },
        { $set: metricsData }
      );

      console.log(`[DashboardMetrics] Saved ${data.metricType} for ${data.scope} scope`);
      return result;
    } catch (error) {
      console.error(`[DashboardMetrics] Error saving metrics:`, error.message);
      throw error;
    }
  },

  /**
   * Clear all cached metrics (useful for manual refresh)
   * @param {String} scope - Optional scope to clear, or all if not specified
   * @returns {Number} Number of records removed
   */
  async clearCache(scope = null) {
    try {
      const query = scope ? { scope } : {};
      const removed = await DashboardMetricsCollection.removeAsync(query);
      console.log(`[DashboardMetrics] Cleared ${removed} cached metrics${scope ? ` for ${scope}` : ''}`);
      return removed;
    } catch (error) {
      console.error('[DashboardMetrics] Error clearing cache:', error.message);
      throw error;
    }
  },

  /**
   * Check if metrics are currently cached and valid
   * @param {String} scope - 'global' for admin view
   * @param {String} metricType - 'aum_summary'
   * @returns {Boolean} True if valid cache exists
   */
  async isCached(scope, metricType) {
    const cached = await this.getMetrics(scope, metricType);
    return cached !== null;
  },

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  async getCacheStats() {
    try {
      const now = new Date();
      const total = await DashboardMetricsCollection.find({}).countAsync();
      const valid = await DashboardMetricsCollection.find({
        expiresAt: { $gt: now }
      }).countAsync();

      const latestMetrics = await DashboardMetricsCollection.findOneAsync(
        { scope: 'global', metricType: 'aum_summary' },
        { sort: { computedAt: -1 } }
      );

      return {
        totalRecords: total,
        validRecords: valid,
        expiredRecords: total - valid,
        lastComputedAt: latestMetrics?.computedAt || null,
        expiresAt: latestMetrics?.expiresAt || null,
        cacheDurationHours: CACHE_DURATION / (60 * 60 * 1000)
      };
    } catch (error) {
      console.error('[DashboardMetrics] Error getting cache stats:', error.message);
      return {
        totalRecords: 0,
        validRecords: 0,
        expiredRecords: 0,
        lastComputedAt: null,
        cacheDurationHours: 24
      };
    }
  }
};
