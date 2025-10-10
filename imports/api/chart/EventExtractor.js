/**
 * EventExtractor - Extracts event data for chart annotations
 * 
 * Responsibilities:
 * - Extract observation dates from product structure
 * - Extract coupon events from evaluation results
 * - Extract autocall, barrier, and memory events
 * - Process generic events for annotations
 */
export class EventExtractor {
  constructor() {
    this.version = '1.0.0';
  }

  /**
   * Extract observation dates from product configuration
   * ONLY processes the actual drag-and-drop payoff structure mechanism
   * IGNORES hardcoded observationDates and observationFrequency fields
   */
  extractObservationDates(product) {
    const dates = [];
    
    
    // ONLY process payoff structure components (the actual mechanism)
    if (product.payoffStructure) {
      
      product.payoffStructure.forEach((component, index) => {
        // Only count components that are explicitly observation types with dates
        if (component.type === 'observation' && component.date) {
          dates.push(component.date);
        }
        // Check for timing components that represent observations
        if (component.type === 'timing' && component.date) {
          dates.push(component.date);
        }
        // Check for observation-related components with explicit dates
        if ((component.type === 'observation_date' || component.type === 'observation_trigger') && component.date) {
          dates.push(component.date);
        }
      });
      
      // Analyze the product structure to understand observation mechanism
      const sections = [...new Set(product.payoffStructure.map(c => c.section))];
      const hasLifeSection = sections.includes('life');
      const hasMaturityOnly = sections.length === 1 && sections[0] === 'maturity';
      
      if (hasMaturityOnly) {
      } else if (hasLifeSection) {
      }
    }
    
    // Remove duplicates and sort
    const uniqueDates = [...new Set(dates)].sort();
    
    if (uniqueDates.length > 0) {
    } else {
    }
    
    return uniqueDates;
  }

  /**
   * Extract coupon dates from evaluation results and product structure
   */
  extractCouponDates(evaluationResults) {
    const dates = [];
    
    if (evaluationResults?.schedule?.events) {
      evaluationResults.schedule.events.forEach(event => {
        if (event.couponRate && event.couponRate > 0) {
          dates.push(event.date);
        }
      });
    }
    
    return dates.sort();
  }

  /**
   * Extract all event dates from evaluation results
   */
  extractAllEventDates(evaluationResults) {
    const events = [];
    
    if (evaluationResults?.schedule?.events) {
      evaluationResults.schedule.events.forEach(event => {
        events.push({
          date: event.date,
          type: event.type,
          description: event.description,
          hasActions: !!(event.couponRate || event.redemptionAmount)
        });
      });
    }
    
    return events;
  }

  /**
   * Extract coupon payment events for box annotations - uses observation dates, not payment dates
   */
  extractCouponEvents(evaluationResults, product) {
    const events = [];
    
    // First, try to get coupons from observation schedule (preferred method)
    if (product?.observationSchedule && Array.isArray(product.observationSchedule)) {
      product.observationSchedule.forEach((observation, index) => {
        if (observation.couponRate && observation.couponRate > 0) {
          events.push({
            date: observation.date, // Use observation date, not payment date
            rate: observation.couponRate,
            amount: observation.couponRate,
            observationIndex: observation.index || (index + 1),
            paymentDate: observation.paymentDate,
            type: 'coupon'
          });
        }
      });
    }
    
    // Fallback: Check schedule events from evaluation results
    if (events.length === 0 && evaluationResults?.schedule?.events) {
      evaluationResults.schedule.events.forEach((event, index) => {
        if (event.couponRate && event.couponRate > 0) {
          events.push({
            date: event.observation_date || event.date, // Prefer observation date
            rate: event.couponRate,
            amount: event.couponRate,
            observationIndex: index + 1,
            paymentDate: event.payment_date || event.paymentDate,
            type: 'coupon'
          });
        }
      });
    }
    
    // Check LLM evaluation timeline for coupon events
    if (events.length === 0 && evaluationResults?.timeline) {
      evaluationResults.timeline.forEach((timelineEvent, index) => {
        if (timelineEvent.payments) {
          timelineEvent.payments.forEach(payment => {
            if (payment.type === 'coupon') {
              // Use observationDate if available, otherwise fall back to timeline date
              const eventDate = timelineEvent.observationDate || timelineEvent.date;
              events.push({
                date: eventDate, // Use observation date for chart positioning
                rate: (payment.amount / (evaluationResults.notional || 100000)) * 100, // Calculate rate
                amount: (payment.amount / (evaluationResults.notional || 100000)) * 100,
                observationIndex: index + 1,
                paymentDate: timelineEvent.date, // Keep payment date for tooltip
                type: 'coupon'
              });
            }
          });
        }
      });
    }
    
    // Also check payoff breakdown for coupon payments (final fallback)
    if (events.length === 0 && evaluationResults?.payoff?.breakdown) {
      evaluationResults.payoff.breakdown.forEach(item => {
        if (item.toLowerCase().includes('coupon')) {
          // Extract coupon information from breakdown text
          const match = item.match(/(\d+\.?\d*)%/);
          if (match) {
            events.push({
              date: evaluationResults.evaluationDate || new Date().toISOString(),
              rate: parseFloat(match[1]),
              amount: parseFloat(match[1]),
              observationIndex: 1,
              type: 'coupon'
            });
          }
        }
      });
    }
    
    events.forEach(event => {
    });
    
    return events;
  }

  /**
   * Extract autocall events for box annotations - uses observation dates where autocall was triggered
   */
  extractAutocallEvents(evaluationResults, product) {
    const events = [];
    
    // First, check observation schedule for autocall levels and determine if triggered
    if (product?.observationSchedule && Array.isArray(product.observationSchedule)) {
      product.observationSchedule.forEach((observation, index) => {
        if (observation.isCallable || (observation.autocallLevel && observation.autocallLevel > 0)) {
          // Check if this observation triggered an autocall (would need underlying performance data)
          // For now, mark as potential autocall observation
          events.push({
            date: observation.date,
            payoff: 100, // Default autocall payoff
            triggerLevel: observation.autocallLevel || 100,
            observationIndex: observation.index || (index + 1),
            type: 'autocall'
          });
        }
      });
    }
    
    // Check payoff breakdown for autocall information
    if (evaluationResults?.payoff?.breakdown) {
      evaluationResults.payoff.breakdown.forEach(item => {
        if (item.toLowerCase().includes('autocall')) {
          // Extract autocall payoff from breakdown
          const match = item.match(/(\d+\.?\d*)%/);
          if (match) {
            events.push({
              date: evaluationResults.evaluationDate || new Date().toISOString(),
              payoff: parseFloat(match[1]),
              triggerLevel: 100, // Default trigger level
              observationIndex: 1,
              type: 'autocall'
            });
          }
        }
      });
    }
    
    // Check if product was redeemed early (indicates autocall)
    if (evaluationResults?.summary?.redeemedEarly) {
      events.push({
        date: evaluationResults.evaluationDate,
        payoff: evaluationResults.payoff?.totalPayout || 100,
        triggerLevel: 100,
        observationIndex: 1,
        type: 'autocall'
      });
    }
    
    events.forEach(event => {
    });
    
    return events;
  }

  /**
   * Extract barrier touch/breach events
   */
  extractBarrierEvents(evaluationResults, product) {
    const events = [];
    
    // Check summary for barrier information
    if (evaluationResults?.summary) {
      const summary = evaluationResults.summary;
      
      // Protection barrier breach
      if (summary.barrierBreach || summary.protectionBreach) {
        events.push({
          date: evaluationResults.evaluationDate,
          barrierLevel: summary.barrierLevel || 70, // Default barrier level
          barrierType: 'Protection',
          type: 'barrier_breach'
        });
      }
      
      // Autocall barrier touch
      if (summary.autocallTriggered) {
        events.push({
          date: evaluationResults.evaluationDate,
          barrierLevel: 100, // Autocall typically at 100%
          barrierType: 'Autocall',
          type: 'barrier_touch'
        });
      }
    }
    
    return events;
  }

  /**
   * Extract memory events (for phoenix-type products)
   */
  extractMemoryEvents(evaluationResults, product) {
    const events = [];
    
    // Check payoff breakdown for memory-related information
    if (evaluationResults?.payoff?.breakdown) {
      evaluationResults.payoff.breakdown.forEach(item => {
        if (item.toLowerCase().includes('memory')) {
          const match = item.match(/(\d+\.?\d*)%/);
          if (match) {
            events.push({
              date: evaluationResults.evaluationDate || new Date().toISOString(),
              amount: parseFloat(match[1]),
              yLevel: 95, // Position near but below 100%
              type: 'memory'
            });
          }
        }
      });
    }
    
    return events;
  }

  /**
   * Extract other generic events from evaluation results
   */
  extractGenericEvents(evaluationResults, product) {
    const events = [];
    
    // Look for any other significant events in the evaluation results
    if (evaluationResults?.events) {
      evaluationResults.events.forEach(event => {
        events.push({
          date: event.date,
          type: event.type,
          description: event.description,
          yLevel: event.level || 100,
          color: event.color,
          labelPosition: event.labelPosition,
          details: event.details
        });
      });
    }
    
    return events;
  }

  // Legacy helper methods for backward compatibility
  extractCouponPayments(evaluationResults) {
    const events = this.extractCouponEvents(evaluationResults);
    return events.map(event => ({
      date: event.date,
      amount: event.amount,
      level: event.yLevel
    }));
  }

  extractCouponPaymentDates(evaluationResults) {
    return this.extractCouponPayments(evaluationResults).map(p => p.date);
  }

  extractBarrierTouches(evaluationResults) {
    // Extract from timeline or debug logs
    const touches = [];
    if (evaluationResults?.debug?.logs) {
      evaluationResults.debug.logs.forEach(log => {
        if (log.message?.includes('barrier') && log.message?.includes('touch')) {
          // Parse barrier touch events from logs
          touches.push({
            date: log.timestamp,
            type: 'barrier',
            level: 70 // Extract from log message
          });
        }
      });
    }
    return touches;
  }

  extractAutocalls(evaluationResults) {
    const autocalls = [];
    if (evaluationResults?.timeline?.events) {
      evaluationResults.timeline.events.forEach(event => {
        if (event.description?.includes('autocall')) {
          autocalls.push({
            date: event.date,
            level: 100, // Extract from event data
            return: event.totalPayoff || 0
          });
        }
      });
    }
    return autocalls;
  }

  /**
   * Detect product type for specialized handling
   * @param {Object} product - Product configuration
   * @returns {string} Product type
   */
  detectProductType(product) {
    if (!product.payoffStructure) return 'unknown';
    
    const hasAutocall = product.payoffStructure.some(c => 
      c.label?.toLowerCase().includes('autocall'));
    const hasProtection = product.payoffStructure.some(c => 
      c.label?.toLowerCase().includes('protection'));
    const hasCoupon = product.payoffStructure.some(c => 
      c.label?.toLowerCase().includes('coupon'));
    const hasMemory = product.payoffStructure.some(c => 
      c.label?.toLowerCase().includes('memory'));
    
    // Return feature-based classification instead of hardcoded product names
    const features = [];
    if (hasAutocall) features.push('autocall');
    if (hasProtection) features.push('protection');
    if (hasCoupon) features.push('coupon');
    if (hasMemory) features.push('memory');
    
    return features.length > 0 ? features.join('_') : 'basic';
  }
}