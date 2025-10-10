import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';

/**
 * Schedule Collection
 * 
 * Stores product schedule information including launch dates, observation dates,
 * coupon payment dates, and final redemption dates for structured products.
 * 
 * DOCUMENT STRUCTURE:
 * {
 *   _id: ObjectId,
 *   
 *   // Product Reference
 *   productId: String,
 *   productIsin: String,
 *   productName: String,
 *   
 *   // Schedule Metadata
 *   scheduleType: String,        // 'product_timeline', 'observation_dates', 'payment_schedule'
 *   currency: String,            // Product currency
 *   
 *   // Schedule Entries
 *   events: [{
 *     date: Date,                // Event date
 *     description: String,       // Event description (e.g., "Launch Date", "Observation Date #1")
 *     type: String,              // Event type: 'launch', 'observation', 'coupon', 'maturity', 'redemption'
 *     couponRate: Number,        // Coupon rate if applicable (percentage)
 *     redemptionAmount: Number,  // Redemption amount if applicable (percentage of nominal)
 *     status: String,            // 'upcoming', 'completed', 'current'
 *     details: Object            // Additional event-specific details
 *   }],
 *   
 *   // Audit Trail
 *   createdAt: Date,
 *   updatedAt: Date,
 *   generatedBy: String         // 'rule_engine', 'manual'
 * }
 */

export const ScheduleCollection = new Mongo.Collection('schedule');

// Server-side publications and methods
if (Meteor.isServer) {
  // Publish schedule for a specific product
  Meteor.publish('schedule.forProduct', function(productId) {
    check(productId, String);
    
    return ScheduleCollection.find({ productId }, {
      sort: { 'events.date': 1 }
    });
  });

  // Publish schedules by date range
  Meteor.publish('schedule.byDateRange', function(fromDate, toDate) {
    check(fromDate, Date);
    check(toDate, Date);
    
    return ScheduleCollection.find({
      'events.date': {
        $gte: fromDate,
        $lte: toDate
      }
    }, {
      sort: { 'events.date': 1 }
    });
  });

  // Create indexes for efficient querying
  Meteor.startup(() => {
    try {
      ScheduleCollection.createIndex({ productId: 1 });
      ScheduleCollection.createIndex({ productIsin: 1 });
      ScheduleCollection.createIndex({ 'events.date': 1 });
      ScheduleCollection.createIndex({ 'events.type': 1 });
      ScheduleCollection.createIndex({ 'events.status': 1 });
      console.log('Schedule collection indexes created successfully');
    } catch (error) {
      console.error('Error creating schedule indexes:', error);
    }
  });

  Meteor.methods({
    /**
     * Create or update schedule for a product
     */
    async 'schedule.createOrUpdate'(scheduleData) {
      check(scheduleData, Object);
      
      const schedule = {
        ...scheduleData,
        updatedAt: new Date(),
        generatedBy: scheduleData.generatedBy || 'rule_engine'
      };
      
      // Remove existing schedule for this product
      if (schedule.productId) {
        const removedCount = await ScheduleCollection.removeAsync({ productId: schedule.productId });
        if (removedCount > 0) {
          console.log(`🗓️  Removed ${removedCount} old schedules for product: ${schedule.productId}`);
        }
      }
      
      if (!schedule.createdAt) {
        schedule.createdAt = new Date();
      }
      
      const scheduleId = await ScheduleCollection.insertAsync(schedule);
      console.log(`🗓️  Schedule created: ${scheduleId}`);
      
      return scheduleId;
    },

    /**
     * Get schedule for a product
     */
    async 'schedule.getForProduct'(productId) {
      check(productId, String);
      
      return await ScheduleCollection.findOneAsync({ productId });
    },

    /**
     * Get upcoming events for a product
     */
    async 'schedule.getUpcomingEvents'(productId, fromDate = new Date()) {
      check(productId, String);
      check(fromDate, Date);
      
      const schedule = await ScheduleCollection.findOneAsync({ productId });
      
      if (!schedule) return [];
      
      return schedule.events.filter(event => 
        new Date(event.date) >= fromDate
      ).sort((a, b) => new Date(a.date) - new Date(b.date));
    },

    /**
     * Delete schedule for a product
     */
    async 'schedule.delete'(productId) {
      check(productId, String);
      
      const result = await ScheduleCollection.removeAsync({ productId });
      console.log(`🗓️  Deleted schedule for product: ${productId}`);
      
      return result;
    }
  });
}

/**
 * Helper to generate schedule from product structure
 */
export const ScheduleHelpers = {
  /**
   * Generate schedule events from product data
   */
  generateProductSchedule(product) {
    const events = [];
    const today = new Date();
    
    // Launch/Trade Date
    if (product.tradeDate) {
      events.push({
        date: new Date(product.tradeDate),
        description: 'Product Launch Date',
        type: 'launch',
        status: new Date(product.tradeDate) <= today ? 'completed' : 'upcoming',
        details: {
          nominal: product.nominal || '100%',
          currency: product.currency || 'USD'
        }
      });
    }
    
    // Observation Dates (from payoff structure)
    this.extractObservationDates(product, events, today);
    
    // Coupon Payment Dates (from payoff structure)
    this.extractCouponDates(product, events, today);
    
    // Final Observation/Redemption Date
    const finalDate = product.finalObservation || product.maturity || product.maturityDate;
    if (finalDate) {
      const finalObservationDate = new Date(finalDate);
      events.push({
        date: finalObservationDate,
        description: 'Final Redemption Date',
        type: 'redemption',
        redemptionAmount: 100, // Default to 100% nominal
        status: finalObservationDate <= today ? 'completed' : 'upcoming',
        details: {
          finalPayment: true,
          finalObservation: true,
          currency: product.currency || 'USD'
        }
      });
    }
    
    // Sort events by date
    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    return {
      productId: product._id,
      productIsin: product.isin,
      productName: product.title || product.productName,
      scheduleType: 'product_timeline',
      currency: product.currency || 'USD',
      events: events
    };
  },
  
  /**
   * Extract observation dates from payoff structure
   */
  extractObservationDates(product, events, today) {
    if (!product.payoffStructure) return;
    
    const observationComponents = product.payoffStructure.filter(component => 
      component.type === 'OBSERVATION' || 
      component.label?.toLowerCase().includes('observation')
    );
    
    observationComponents.forEach((component, index) => {
      // Generate observation dates based on frequency
      const frequency = component.frequency || 'quarterly';
      const startDate = new Date(product.tradeDate || product.createdAt);
      const endDate = new Date(product.maturity || product.maturityDate);
      
      const observationDates = this.generateDatesByFrequency(startDate, endDate, frequency);
      
      observationDates.forEach((date, dateIndex) => {
        events.push({
          date: date,
          description: `Observation Date #${dateIndex + 1}`,
          type: 'observation',
          status: date <= today ? 'completed' : 'upcoming',
          details: {
            frequency: frequency,
            observationLevel: component.value || component.defaultValue,
            underlying: product.underlyings?.[0]?.symbol || 'Underlying'
          }
        });
      });
    });
  },
  
  /**
   * Extract coupon payment dates from payoff structure
   */
  extractCouponDates(product, events, today) {
    if (!product.payoffStructure) return;
    
    const couponComponents = product.payoffStructure.filter(component => 
      component.type === 'ACTION' && 
      (component.label?.toLowerCase().includes('coupon') || 
       component.value?.toLowerCase().includes('coupon'))
    );
    
    couponComponents.forEach((component, index) => {
      const couponRate = this.extractCouponRate(component);
      
      if (couponRate > 0) {
        // Generate coupon payment dates (typically quarterly or annual)
        const frequency = component.frequency || 'quarterly';
        const startDate = new Date(product.tradeDate || product.createdAt);
        const endDate = new Date(product.maturity || product.maturityDate);
        
        const couponDates = this.generateDatesByFrequency(startDate, endDate, frequency);
        
        couponDates.forEach((date, dateIndex) => {
          events.push({
            date: date,
            description: `Coupon Payment #${dateIndex + 1}`,
            type: 'coupon',
            couponRate: couponRate,
            status: date <= today ? 'completed' : 'upcoming',
            details: {
              frequency: frequency,
              annualizedRate: couponRate,
              currency: product.currency || 'USD'
            }
          });
        });
      }
    });
  },
  
  /**
   * Generate dates by frequency
   */
  generateDatesByFrequency(startDate, endDate, frequency) {
    const dates = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    let current = new Date(start);
    let monthIncrement;
    
    switch (frequency.toLowerCase()) {
      case 'monthly':
        monthIncrement = 1;
        break;
      case 'quarterly':
        monthIncrement = 3;
        break;
      case 'semi-annual':
      case 'semiannual':
        monthIncrement = 6;
        break;
      case 'annual':
      case 'yearly':
        monthIncrement = 12;
        break;
      default:
        monthIncrement = 3; // Default to quarterly
    }
    
    // Start from first period after launch
    current.setMonth(current.getMonth() + monthIncrement);
    
    while (current < end) {
      dates.push(new Date(current));
      current.setMonth(current.getMonth() + monthIncrement);
    }
    
    return dates;
  },
  
  /**
   * Extract coupon rate from component
   */
  extractCouponRate(component) {
    const value = component.value || component.defaultValue || '';
    const label = component.label || '';
    
    // Look for percentage values
    const percentMatch = (value + ' ' + label).match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      return parseFloat(percentMatch[1]);
    }
    
    // Look for decimal values
    const decimalMatch = (value + ' ' + label).match(/(\d+(?:\.\d+)?)/);
    if (decimalMatch) {
      const num = parseFloat(decimalMatch[1]);
      // If less than 1, assume it's already a percentage
      return num < 1 ? num * 100 : num;
    }
    
    return 0;
  }
};