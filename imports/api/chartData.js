import { Mongo } from 'meteor/mongo';
import { check } from 'meteor/check';

export const ChartDataCollection = new Mongo.Collection('chartData');

// Chart data document structure:
// {
//   _id: String,
//   productId: String,           // Reference to the product this chart belongs to
//   type: String,               // 'line', 'bar', 'area', etc.
//   data: Object,               // Chart.js data object
//   config: {
//     title: String,
//     initialDate: String,
//     finalDate: String,
//     observationDates: Array,
//     couponPaymentDates: Array,
//     productType: String
//   },
//   generatedAt: Date,          // When this chart data was created
//   updatedAt: Date,            // When this chart data was last updated
//   version: Number             // Chart data version for cache invalidation
// }

// Server-side methods for chart data management
if (Meteor.isServer) {
  Meteor.methods({
    async 'chartData.upsert'(productId, chartData) {
      check(productId, String);
      check(chartData, Object);
      
      const now = new Date();
      const existingChart = await ChartDataCollection.findOneAsync({ productId });
      
      if (existingChart) {
        // Update existing chart data
        return ChartDataCollection.updateAsync(existingChart._id, {
          $set: {
            ...chartData,
            updatedAt: now,
            version: (existingChart.version || 0) + 1
          }
        });
      } else {
        // Insert new chart data
        return ChartDataCollection.insertAsync({
          ...chartData,
          productId,
          generatedAt: now,
          updatedAt: now,
          version: 1
        });
      }
    },
    
    'chartData.remove'(productId) {
      check(productId, String);
      return ChartDataCollection.removeAsync({ productId });
    },
    
    async 'chartData.getByProduct'(productId) {
      check(productId, String);
      return await ChartDataCollection.findOneAsync({ productId });
    },
    
    async 'chartData.cleanup'(olderThanDays = 30) {
      check(olderThanDays, Number);
      
      // Import USER_ROLES for authorization check
      const { USER_ROLES, UsersCollection } = await import('./users.js');
      
      const user = this.userId && await UsersCollection.findOneAsync(this.userId);
      if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
        throw new Meteor.Error('not-authorized', 'Only administrators can run cleanup operations');
      }

      try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
        
        const removedCount = await ChartDataCollection.removeAsync({
          updatedAt: { $lt: cutoffDate }
        });
        
        
        return {
          success: true,
          removedCount: removedCount,
          cutoffDate: cutoffDate
        };
      } catch (error) {
        throw new Meteor.Error('cleanup-failed', `Failed to cleanup chart data: ${error.message}`);
      }
    }
  });
  
  // Publications
  Meteor.publish('chartData.byProduct', function(productId) {
    check(productId, String);
    return ChartDataCollection.find({ productId });
  });
  
  Meteor.publish('chartData.recent', function(limit = 50) {
    check(limit, Number);
    return ChartDataCollection.find({}, {
      sort: { updatedAt: -1 },
      limit: limit
    });
  });
}