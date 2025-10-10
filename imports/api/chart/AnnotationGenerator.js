/**
 * AnnotationGenerator - Handles chart annotation generation
 * 
 * Responsibilities:
 * - Generate vertical line annotations for key dates
 * - Generate event point annotations (coupons, autocalls, barriers)
 * - Create tooltip content for events
 * - Handle annotation positioning and styling
 */
export class AnnotationGenerator {
  constructor() {
    this.version = '1.0.0';
    this.colors = {
      events: {
        couponPayment: '#34d399',   // Light green for coupon payments
        autocall: '#60a5fa',        // Light blue for autocalls
        barrier: '#f87171',         // Light red for barrier touches
        observation: '#d1d5db'      // Light gray for observations
      }
    };
  }

  /**
   * Generate vertical line annotations for all key dates
   * Creates vertical lines for initial date, final date, and all observation dates
   * Each line includes proper styling and descriptive labels
   * @param {Object} product - Product configuration
   * @param {Object} evaluationResults - Evaluation results
   * @param {Object} dateRange - Date range information for index calculation
   * @param {Date} evaluationDate - Current evaluation date
   * @param {Object} eventExtractor - Event extractor instance
   * @returns {Object} Vertical line annotations for Chart.js annotation plugin
   */
  generateVerticalAnnotations(product, evaluationResults, dateRange, evaluationDate = new Date(), eventExtractor) {
    const annotations = {};
    
    // Helper function to find date index in labels array
    const findDateIndex = (targetDate) => {
      if (!targetDate) return -1;
      
      const targetDateStr = new Date(targetDate).toISOString().split('T')[0];
      let index = dateRange.labels.findIndex(label => label === targetDateStr);
      
      // Fallback: find closest date if exact match fails
      if (index === -1) {
        const targetTime = new Date(targetDate).getTime();
        let closestIndex = -1;
        let closestDiff = Infinity;
        
        dateRange.labels.forEach((label, i) => {
          const labelTime = new Date(label).getTime();
          const diff = Math.abs(labelTime - targetTime);
          if (diff < closestDiff) {
            closestDiff = diff;
            closestIndex = i;
          }
        });
        
        if (closestDiff < 7 * 24 * 60 * 60 * 1000) { // Within 7 days
          index = closestIndex;
        }
      }
      
      return index;
    };
    
    // Initial/Launch Date - Removed per user request
    // Launch date annotation has been disabled
    
    // Observation Dates - only show if explicitly defined (skip for ORION products)
    const isOrionProduct = product.template === 'orion_memory' || product.templateId === 'orion_memory';
    const observationDates = eventExtractor.extractObservationDates(product);

    if (observationDates.length > 0 && !isOrionProduct) {
      observationDates.forEach((date, index) => {
        const obsIndex = findDateIndex(date);

        if (obsIndex !== -1) {
          const isFinalObservation = index === observationDates.length - 1;
          const label = isFinalObservation ? 'Final' : `Obs ${index + 1}`;
          const color = isFinalObservation ? '#f87171' : '#9ca3af';

          annotations[`observation_${index}`] = {
            type: 'line',
            xMin: obsIndex,
            xMax: obsIndex,
            borderColor: color,
            borderWidth: isFinalObservation ? 3 : 2,
            borderDash: isFinalObservation ? [8, 4] : [5, 5],
            label: {
              display: true,
              content: label,
              position: 'end',
              backgroundColor: color,
              color: 'white',
              font: { weight: 'bold', size: 11 },
              padding: { x: 8, y: 4 },
              borderRadius: 4,
              yAdjust: 0
            }
          };
        }
      });
    }

    // Final Observation Date - show for ORION (which skips intermediate obs) and other products
    const finalObservationDate = product.finalObservation || product.maturity || product.maturityDate;
    if (finalObservationDate) {
      const finalIndex = findDateIndex(finalObservationDate);

      if (finalIndex !== -1) {
        // For ORION products, only show Final line
        // For other products, Final Observation Date section shows final if no observationDates exist
        const shouldShow = isOrionProduct || observationDates.length === 0;

        if (shouldShow) {
          annotations.finalObservationDate = {
            type: 'line',
            xMin: finalIndex,
            xMax: finalIndex,
            borderColor: '#ef4444', // Red color for final observation date
            borderWidth: 3,
            borderDash: [10, 5], // Different dash pattern for prominence
            label: {
              display: true,
              content: 'Final',
              position: 'end',
              backgroundColor: '#ef4444',
              color: 'white',
              font: { weight: 'bold', size: 11 },
              padding: { x: 8, y: 4 },
              borderRadius: 4,
              yAdjust: 0
            }
          };
        }
      }
    }

    return annotations;
  }

  /**
   * Generate generic event box annotations for significant events
   * Creates box markers positioned at top of chart for coupons, autocalls, barrier touches, memory events, etc.
   * All event types are handled generically without hardcoding specific product logic
   * @param {Object} product - Product configuration
   * @param {Object} evaluationResults - Evaluation results
   * @param {Object} marketData - Market data context
   * @param {Object} dateRange - Date range information
   * @param {Object} eventExtractor - Event extractor instance
   * @returns {Object} Event box annotations for Chart.js annotation plugin
   */
  generateEventPointAnnotations(product, evaluationResults, marketData, dateRange, eventExtractor) {
    const annotations = {};
    let annotationCount = 0;
    
    // Helper function to create improved event markers positioned at top of chart
    const createEventBox = (eventDate, eventType, eventData, color) => {
      const dateStr = new Date(eventDate).toISOString().split('T')[0];
      const xIndex = dateRange.labels.findIndex(label => label === dateStr);
      
      if (xIndex === -1) return null;
      
      // Define event icons and positions
      const eventConfig = {
        coupon: { icon: '💰', yLevel: 108, radius: 8 },
        autocall: { icon: '🎯', yLevel: 120, radius: 14 },
        barrier_touch: { icon: '🛡️', yLevel: 110, radius: 10 },
        memory: { icon: '📦', yLevel: 118, radius: 12 },
        observation: { icon: '👁️', yLevel: 112, radius: 10 },
        redemption: { icon: '🏁', yLevel: 100, radius: 10 }
      };
      
      const config = eventConfig[eventType] || eventConfig.observation;
      
      // Create detailed label content
      let labelContent = config.icon;
      if (eventData.rate) {
        labelContent += ` ${eventData.rate}%`;
      } else if (eventData.amount) {
        labelContent += ` ${eventData.amount}%`;
      } else if (eventData.description) {
        labelContent += ` ${eventData.description}`;
      }
      
      // Use enhanced point annotation positioned at top of chart
      return {
        type: 'point',
        xValue: xIndex,
        yValue: config.yLevel,
        backgroundColor: color,
        borderColor: '#ffffff',
        borderWidth: 3,
        radius: config.radius,
        label: {
          display: true,
          content: labelContent,
          color: '#ffffff',
          backgroundColor: color,
          font: { weight: 'bold', size: 14 },
          padding: { x: 10, y: 6 },
          borderRadius: 6,
          position: 'top',
          yAdjust: -10
        },
        // Enhanced event metadata for tooltips
        eventType: eventType,
        eventDate: eventDate,
        eventData: {
          ...eventData,
          observationIndex: eventData.observationIndex || null,
          paymentDate: eventData.paymentDate || null,
          tooltipContent: this.createEventTooltip(eventType, eventData)
        }
      };
    };
    
    // Extract coupon payment events
    const couponEvents = eventExtractor.extractCouponEvents(evaluationResults, product);
    
    couponEvents.forEach((event, index) => {
      const annotation = createEventBox(
        event.date,
        'coupon',
        {
          description: `Coupon Payment`,
          amount: event.amount,
          rate: event.rate,
          observationIndex: event.observationIndex,
          paymentDate: event.paymentDate
        },
        this.colors.events.couponPayment
      );
      
      if (annotation) {
        annotations[`coupon_box_${index}`] = annotation;
        annotationCount++;
      }
    });
    
    // Extract autocall events
    const autocallEvents = eventExtractor.extractAutocallEvents(evaluationResults, product);
    autocallEvents.forEach((event, index) => {
      const annotation = createEventBox(
        event.date,
        'autocall',
        {
          description: `Early Redemption`,
          payoff: event.payoff,
          triggerLevel: event.triggerLevel,
          observationIndex: event.observationIndex
        },
        this.colors.events.autocall
      );
      
      if (annotation) {
        annotations[`autocall_${index}`] = annotation;
        annotationCount++;
      }
    });
    
    // Extract barrier touch/breach events
    const barrierEvents = eventExtractor.extractBarrierEvents(evaluationResults, product);
    barrierEvents.forEach((event, index) => {
      const annotation = createEventBox(
        event.date,
        'barrier_touch',
        {
          description: `${event.barrierType} Barrier Touch`,
          barrierType: event.barrierType,
          barrierLevel: event.barrierLevel
        },
        this.colors.events.barrier
      );
      
      if (annotation) {
        annotations[`barrier_${index}`] = annotation;
        annotationCount++;
      }
    });
    
    // Extract memory events (for phoenix products)
    const memoryEvents = eventExtractor.extractMemoryEvents(evaluationResults, product);
    memoryEvents.forEach((event, index) => {
      const annotation = createEventBox(
        event.date,
        'memory',
        {
          description: `Memory Event`,
          amount: event.amount,
          memoryType: event.type
        },
        '#8b5cf6' // Purple for memory events
      );
      
      if (annotation) {
        annotations[`memory_${index}`] = annotation;
        annotationCount++;
      }
    });
    
    // Extract other generic events from evaluation results
    const genericEvents = eventExtractor.extractGenericEvents(evaluationResults, product);
    genericEvents.forEach((event, index) => {
      const annotation = createEventBox(
        event.date,
        event.type || 'observation',
        {
          description: event.description || `${event.type} Event`,
          details: event.details
        },
        event.color || '#6b7280'
      );
      
      if (annotation) {
        annotations[`event_${index}`] = annotation;
        annotationCount++;
      }
    });

    return annotations;
  }

  /**
   * Legacy method maintained for backward compatibility
   * @deprecated Use generateVerticalAnnotations instead
   */
  generateVerticalLines(product, evaluationResults, eventExtractor) {
    const annotations = {};
    
    // Get x-axis labels to find date positions (for Chart.js v3+ annotation plugin)
    const dateRangeGenerator = new (await import('./DateRangeGenerator.js')).DateRangeGenerator();
    const xLabels = dateRangeGenerator.generateDateRange(product).labels;
    
    // Initial date
    if (product.tradeDate) {
      let initialIndex = xLabels.findIndex(label => label === product.tradeDate);
      
      // If exact match fails, try date parsing
      if (initialIndex === -1) {
        initialIndex = xLabels.findIndex(label => {
          try {
            const labelDate = new Date(label);
            const targetDate = new Date(product.tradeDate);
            return labelDate.toDateString() === targetDate.toDateString();
          } catch (error) {
            return false;
          }
        });
      }
      
      // Initial date annotation removed per user request
    }
    
    // Observation dates (periodic)
    if (product.observationDates && product.observationDates.length > 0) {
      product.observationDates.forEach((date, index) => {
        const isFinal = index === product.observationDates.length - 1;
        let obsIndex = xLabels.findIndex(label => label === date);
        
        // If exact match fails, try date parsing
        if (obsIndex === -1) {
          obsIndex = xLabels.findIndex(label => {
            try {
              const labelDate = new Date(label);
              const targetDate = new Date(date);
              return labelDate.toDateString() === targetDate.toDateString();
            } catch (error) {
              return false;
            }
          });
        }
        
        if (obsIndex !== -1) {
          // For final observation, use "Final Date" label instead of "Final Obs"
          const label = isFinal ? 'Final Date' : `Obs ${index + 1}`;
          const backgroundColor = isFinal ? 'rgba(239, 68, 68, 0.8)' : this.colors.events.observation;
          const borderColor = isFinal ? 'rgba(239, 68, 68, 0.8)' : this.colors.events.observation;
          
          annotations[`observation_${index}`] = {
            type: 'line',
            xMin: obsIndex,
            xMax: obsIndex,
            borderColor: borderColor,
            borderWidth: isFinal ? 3 : 2,
            borderDash: isFinal ? [10, 5] : [5, 5],
            label: {
              enabled: true,
              content: label,
              position: 'end',
              backgroundColor: backgroundColor,
              color: 'white',
              font: { weight: 'bold' },
              padding: 6,
              borderRadius: 6,
              yAdjust: 0
            }
          };
        }
      });
    }
    
    // Add redemption/autocall vertical lines
    if (evaluationResults?.summary?.redeemedEarly || evaluationResults?.payoff?.triggeredActions?.some(action => action.toLowerCase().includes('autocall'))) {
      const redemptionDate = evaluationResults.evaluationDate || evaluationDate;
      
      if (redemptionDate) {
        let redemptionIndex = xLabels.findIndex(label => {
          try {
            const labelDate = new Date(label);
            const targetDate = new Date(redemptionDate);
            return labelDate.toDateString() === targetDate.toDateString();
          } catch (error) {
            return false;
          }
        });
        
        if (redemptionIndex !== -1) {
          annotations[`redemption_line`] = {
            type: 'line',
            xMin: redemptionIndex,
            xMax: redemptionIndex,
            borderColor: '#10b981', // Green for redemption
            borderWidth: 4,
            borderDash: [8, 4],
            label: {
              enabled: true,
              content: '🎯 REDEEMED',
              position: 'start',
              backgroundColor: '#10b981',
              color: 'white',
              font: { weight: 'bold', size: 12 },
              padding: 8,
              borderRadius: 6,
              yAdjust: -20
            }
          };
          
        }
      }
    }
    
    // Skip separate Final Date annotation since final observation is now labeled as "Final Date"
    return annotations;
  }

  /**
   * Create detailed tooltip content for event annotations
   * @param {string} eventType - Type of event (coupon, autocall, etc.)
   * @param {Object} eventData - Event details
   * @returns {string} Formatted tooltip content
   */
  createEventTooltip(eventType, eventData) {
    switch (eventType) {
      case 'coupon':
        let tooltip = `Coupon Payment: ${eventData.rate || eventData.amount}%`;
        if (eventData.observationIndex) {
          tooltip += `\nObservation #${eventData.observationIndex}`;
        }
        if (eventData.paymentDate) {
          tooltip += `\nPayment Date: ${eventData.paymentDate}`;
        }
        return tooltip;
        
      case 'autocall':
        let autocallTooltip = `Early Redemption: ${eventData.payoff}%`;
        if (eventData.triggerLevel) {
          autocallTooltip += `\nTriggered at ${eventData.triggerLevel}% level`;
        }
        if (eventData.observationIndex) {
          autocallTooltip += `\nObservation #${eventData.observationIndex}`;
        }
        return autocallTooltip;
        
      case 'barrier_touch':
        return `${eventData.barrierType || 'Barrier'} Touch\nLevel: ${eventData.barrierLevel}%`;
        
      case 'memory':
        return `Memory Event: ${eventData.amount}%\nType: ${eventData.memoryType || 'Standard'}`;
        
      default:
        return eventData.description || `${eventType} Event`;
    }
  }
}