/**
 * BarrierDataProcessor - Handles barrier level extraction and data generation
 * 
 * Responsibilities:
 * - Extract barrier levels from product structure
 * - Generate barrier datasets with proper styling
 * - Handle dynamic barriers (step-down, time-based)
 * - Process barrier data points for charts
 */
export class BarrierDataProcessor {
  constructor() {
    this.version = '1.0.0';
    this.colors = {
      barriers: {
        protection: '#f87171',      // Light red for protection barrier
        autocall: '#34d399',        // Light green for autocall level
        coupon: '#fbbf24',          // Light orange for coupon barrier
        upper: '#a78bfa',           // Light purple for upper barriers
        reference: '#d1d5db'        // Light gray for reference lines
      }
    };
  }

  /**
   * Generate barrier level datasets
   * @param {Object} product - Product configuration
   * @param {Object} dateRange - Date range information
   * @param {Object} evaluationResults - Evaluation results
   * @returns {Object} Barrier datasets
   */
  generateBarrierDatasets(product, dateRange, evaluationResults) {
    const datasets = [];
    const barriers = this.extractBarrierLevels(product, evaluationResults);
    
    // Always add 100% reference line (initial level)
    datasets.push({
      label: 'Initial Level (100%)',
      data: dateRange.labels.map(label => ({ x: label, y: 100 })),
      borderColor: this.colors.barriers.reference,
      backgroundColor: this.colors.barriers.reference + '15',
      borderWidth: 1.5,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0,
      tension: 0,
      isPercentage: true,
      isReferenceLine: true
    });
    
    // Protection barrier (always show if detected, even at 100%)
    if (barriers.protection !== null) {
      const protectionData = this.generateDynamicBarrierData(
        barriers.protection, 
        'protection', 
        product, 
        dateRange, 
        evaluationResults
      );
      
      // Protection barrier line with gradient fill
      datasets.push({
        label: `Capital Protection Barrier`,
        data: protectionData,
        borderColor: this.colors.barriers.protection,
        backgroundColor: this.colors.barriers.protection + '30', // Semi-transparent fill
        borderWidth: 3, // Thicker line to distinguish from reference
        borderDash: [8, 3], // Different dash pattern
        fill: 'start', // Fill from line to bottom of chart
        pointRadius: 0,
        tension: 0,
        isPercentage: true,
        isBarrierLine: true,
        order: 1 // Behind stock lines
      });
    }
    
    // Autocall levels (can vary with step-down)
    if (barriers.autocall && barriers.autocall.length > 0) {
      const autocallData = this.generateDynamicBarrierData(
        barriers.autocall, 
        'autocall', 
        product, 
        dateRange, 
        evaluationResults
      );
      
      // Autocall barrier line with gradient fill
      datasets.push({
        label: 'Autocall Level',
        data: autocallData,
        borderColor: this.colors.barriers.autocall,
        backgroundColor: this.colors.barriers.autocall + '25', // Semi-transparent fill
        borderWidth: 2,
        borderDash: [10, 5],
        fill: 'origin', // Fill from line to bottom of chart (y=0)
        pointRadius: 0,
        tension: 0,
        isPercentage: true,
        isBarrierLine: true,
        order: 1 // Render first (behind all other datasets)
      });
    }
    
    // Coupon barriers (can vary with step-down)
    if (barriers.coupon && barriers.coupon.length > 0) {
      const couponData = this.generateStepDownData(barriers.coupon, dateRange, product);
      
      // Coupon barrier line with gradient fill
      datasets.push({
        label: 'Coupon Barrier',
        data: couponData,
        borderColor: this.colors.barriers.coupon,
        backgroundColor: this.colors.barriers.coupon + '20', // Semi-transparent fill
        borderWidth: 2,
        borderDash: [8, 4],
        fill: 'origin', // Fill from line to bottom of chart (y=0)
        pointRadius: 0,
        tension: 0,
        isPercentage: true,
        isBarrierLine: true,
        order: 1 // Render first (behind all other datasets)
      });
    }
    
    // Upper barriers (if present)
    if (barriers.upper !== null && barriers.upper !== 100) {
      datasets.push({
        label: `Upper Barrier (${barriers.upper}%)`,
        data: dateRange.labels.map(label => ({ x: label, y: barriers.upper })),
        borderColor: this.colors.barriers.upper,
        backgroundColor: this.colors.barriers.upper + '20',
        borderWidth: 2,
        borderDash: [3, 3],
        fill: false,
        pointRadius: 0,
        tension: 0,
        isPercentage: true,
        isBarrierLine: true
      });
    }
    
    // Add any additional important levels from evaluation results
    const additionalLevels = this.extractAdditionalBarrierLevels(evaluationResults);
    additionalLevels.forEach((levelInfo, index) => {
      if (levelInfo.level && levelInfo.level !== 100 && 
          !datasets.find(d => d.data.some(point => point.y === levelInfo.level))) {
        
        datasets.push({
          label: `${levelInfo.type} Level (${levelInfo.level}%)`,
          data: dateRange.labels.map(label => ({ x: label, y: levelInfo.level })),
          borderColor: levelInfo.color || '#9ca3af',
          backgroundColor: (levelInfo.color || '#9ca3af') + '20',
          borderWidth: 1.5,
          borderDash: [6, 3],
          fill: false,
          pointRadius: 0,
          tension: 0,
          isPercentage: true,
          isBarrierLine: true
        });
      }
    });

    return { datasets };
  }

  /**
   * Extract barrier levels from product structure
   * @param {Object} product - Product configuration
   * @param {Object} evaluationResults - Evaluation results
   * @returns {Object} Barrier levels
   */
  extractBarrierLevels(product, evaluationResults) {
    const barriers = {
      protection: null,
      autocall: [],
      coupon: [],
      upper: null
    };
    
    // Extract from evaluation results logic tree (contains actual barrier values used in evaluation)
    if (evaluationResults?.logicTree) {
      Object.values(evaluationResults.logicTree).forEach(sectionRules => {
        if (Array.isArray(sectionRules)) {
          sectionRules.forEach(rule => {
            if (rule.condition?.components) {
              rule.condition.components.forEach(component => {
                if (component.label?.toLowerCase().includes('protection') && component.value) {
                  const value = parseFloat(component.value);
                  if (!isNaN(value)) {
                    barriers.protection = value;
                  }
                } else if (component.label?.toLowerCase().includes('autocall') && component.value) {
                  const value = parseFloat(component.value);
                  if (!isNaN(value)) {
                    barriers.autocall.push({ date: null, level: value });
                  }
                }
              });
            }
          });
        }
      });
    }
    
    // Extract from payoff structure
    if (product.payoffStructure) {
      product.payoffStructure.forEach((component, index) => {
        // More inclusive barrier detection (similar to reportGenerator)
        const isBarrierComponent = component.type === 'barrier' || 
                                  component.type === 'autocall' || 
                                  component.type === 'protection' ||
                                  component.type === 'comparison' || // Include comparison components
                                  component.label?.toLowerCase().includes('barrier') || 
                                  component.label?.toLowerCase().includes('protection') ||
                                  component.label?.toLowerCase().includes('autocall');
        
        if (isBarrierComponent) {
          // Extract barrier value using multiple fallback methods
          let value = null;
          
          // Use explicit value if set and not empty, otherwise use defaultValue
          const effectiveValue = (component.value !== null && component.value !== undefined && component.value !== '') 
                                ? component.value 
                                : component.defaultValue;
          
          if (effectiveValue) {
            value = parseFloat(effectiveValue.toString().replace('%', ''));
          } else if (component.level) {
            value = parseFloat(component.level.toString().replace('%', ''));
          } else if (component.parameters?.level) {
            value = parseFloat(component.parameters.level.toString().replace('%', ''));
          }
          
          if (!isNaN(value) && value !== null) {
            // For reporting purposes, show all barriers as reference lines on the chart
            // This includes both conditional barriers (IF thresholds) and unconditional barriers (continuous monitoring)
            if (component.label?.toLowerCase().includes('protection') || component.type === 'protection') {
              barriers.protection = value;
            } else if (component.label?.toLowerCase().includes('autocall') || component.type === 'autocall') {
              barriers.autocall.push({ date: null, level: value });
            } else if (component.label?.toLowerCase().includes('upper')) {
              barriers.upper = value;
            } else if (component.label?.toLowerCase().includes('coupon')) {
              barriers.coupon.push({ date: null, level: value });
            } else {
              // Generic barrier - don't make assumptions based on value alone
              // Check the component's context in the payoff structure
              if (component.label?.toLowerCase().includes('barrier')) {
                // If it's in the maturity section and there's a protection action, it's likely a protection barrier
                if (component.section === 'maturity') {
                  barriers.protection = value;
                } else {
                  // Otherwise, it could be an autocall barrier
                  barriers.autocall.push({ date: null, level: value });
                }
              }
            }
          }
        }
      });
    }
    
    return barriers;
  }

  /**
   * Generate step-down data for barriers that change over time
   * @param {Array} barrierData - Array of {date, level} objects
   * @param {Object} dateRange - Date range information
   * @param {Object} product - Product configuration
   * @returns {Array} Chart data points
   */
  generateStepDownData(barrierData, dateRange, product) {
    const data = [];
    let currentLevelIndex = 0;
    
    for (const label of dateRange.labels) {
      const currentDate = new Date(label);
      
      // Find the appropriate barrier level for this date
      while (currentLevelIndex < barrierData.length - 1 && 
             currentDate >= new Date(barrierData[currentLevelIndex + 1].date)) {
        currentLevelIndex++;
      }
      
      const level = barrierData[currentLevelIndex]?.level || barrierData[0]?.level;
      if (level !== undefined) {
        data.push({ x: label, y: level });
      }
    }
    
    return data;
  }

  /**
   * Generate flexible barrier data points that can change values over time periods
   * Supports dynamic barriers like step-down autocalls, quarterly changes, etc.
   * @param {Array|Object|number} barrierValue - Barrier configuration (can be single value or array of time-based values)
   * @param {string} barrierType - Type of barrier ('protection', 'autocall', 'coupon', etc.)
   * @param {Object} product - Product configuration
   * @param {Object} dateRange - Date range information
   * @param {Object} evaluationResults - Evaluation results for context
   * @returns {Array} Array of {x: date, y: barrierValue} data points
   */
  generateDynamicBarrierData(barrierValue, barrierType, product, dateRange, evaluationResults) {
    
    try {
      const dataPoints = [];
      
      // Handle different barrier value formats
      if (Array.isArray(barrierValue)) {
        // Array of time-based barrier values (e.g., step-down barriers)
        
        for (let i = 0; i < dateRange.labels.length; i++) {
          const currentDate = dateRange.labels[i];
          
          // Find applicable barrier value for this date
          let applicableValue = null;
          
          // Look for time-based barrier definitions
          for (const barrierDef of barrierValue) {
            if (barrierDef.startDate && barrierDef.endDate) {
              const startDate = new Date(barrierDef.startDate);
              const endDate = new Date(barrierDef.endDate);
              const currentDateObj = new Date(currentDate);
              
              if (currentDateObj >= startDate && currentDateObj <= endDate) {
                applicableValue = parseFloat(barrierDef.level || barrierDef.value || barrierDef);
                break;
              }
            } else if (barrierDef.quarter) {
              // Quarterly barrier changes
              const quarterStart = this.getQuarterStartDate(barrierDef.quarter, product);
              const quarterEnd = this.getQuarterEndDate(barrierDef.quarter, product);
              const currentDateObj = new Date(currentDate);
              
              if (currentDateObj >= quarterStart && currentDateObj <= quarterEnd) {
                applicableValue = parseFloat(barrierDef.level || barrierDef.value || barrierDef);
                break;
              }
            } else if (i < barrierValue.length) {
              // Use array index for equal time periods
              const periodIndex = Math.floor((i / dateRange.labels.length) * barrierValue.length);
              const barrierDef = barrierValue[periodIndex];
              applicableValue = parseFloat(barrierDef.level || barrierDef.value || barrierDef);
            }
          }
          
          // Fallback to first barrier value if no specific period found
          if (applicableValue === null && barrierValue.length > 0) {
            const firstBarrier = barrierValue[0];
            applicableValue = parseFloat(firstBarrier.level || firstBarrier.value || firstBarrier);
          }
          
          if (applicableValue !== null && !isNaN(applicableValue)) {
            dataPoints.push({ x: currentDate, y: applicableValue });
          }
        }
        
      } else if (typeof barrierValue === 'object' && barrierValue !== null) {
        // Single barrier object with level/value property
        const level = parseFloat(barrierValue.level || barrierValue.value || barrierValue);
        if (!isNaN(level)) {
          
          // Check if this barrier has step-down behavior
          if (barrierValue.stepDown && barrierValue.stepDownSchedule) {
            // Implement step-down logic
            for (let i = 0; i < dateRange.labels.length; i++) {
              const currentDate = dateRange.labels[i];
              const stepDownLevel = this.calculateStepDownLevel(currentDate, barrierValue.stepDownSchedule, level);
              dataPoints.push({ x: currentDate, y: stepDownLevel });
            }
          } else {
            // Static barrier level for all dates
            dataPoints.push(...dateRange.labels.map(label => ({ x: label, y: level })));
          }
        }
        
      } else {
        // Simple numeric value - same level for all dates
        const level = parseFloat(barrierValue);
        if (!isNaN(level)) {
          dataPoints.push(...dateRange.labels.map(label => ({ x: label, y: level })));
        }
      }
      
      // Validate that we have data points
      if (dataPoints.length === 0) {
        dataPoints.push(...dateRange.labels.map(label => ({ x: label, y: 100 })));
      }

      return dataPoints;
      
    } catch (error) {
      // Fallback to 100% level for all dates
      return dateRange.labels.map(label => ({ x: label, y: 100 }));
    }
  }

  /**
   * Extract additional important barrier levels from evaluation results
   * This method identifies any additional levels that should be displayed as horizontal lines
   * @param {Object} evaluationResults - Evaluation results
   * @returns {Array} Array of level objects with type, level, and color
   */
  extractAdditionalBarrierLevels(evaluationResults) {
    const levels = [];
    
    // Check summary for additional barrier information
    if (evaluationResults?.summary) {
      const summary = evaluationResults.summary;
      
      // Cap levels (if present)
      if (summary.capLevel && summary.capLevel !== 100) {
        levels.push({
          type: 'Cap',
          level: summary.capLevel,
          color: '#f59e0b' // Orange
        });
      }
      
      // Floor levels (if present)
      if (summary.floorLevel && summary.floorLevel !== 0) {
        levels.push({
          type: 'Floor',
          level: summary.floorLevel,
          color: '#059669' // Green
        });
      }
      
      // Strike levels from underlyings (normalized to percentage)
      if (summary.strikes) {
        summary.strikes.forEach((strike, index) => {
          if (strike && strike !== 100) {
            levels.push({
              type: `Strike ${index + 1}`,
              level: strike,
              color: '#6366f1' // Indigo
            });
          }
        });
      }
    }
    
    // Check payoff structure for any embedded barrier levels
    if (evaluationResults?.payoff?.breakdown) {
      evaluationResults.payoff.breakdown.forEach(item => {
        // Look for percentage levels mentioned in breakdown
        const matches = item.match(/(\d+\.?\d*)%/g);
        if (matches) {
          matches.forEach(match => {
            const level = parseFloat(match);
            if (level && level !== 100 && level > 0 && level < 200) {
              // Only add if not already present
              if (!levels.find(l => l.level === level)) {
                levels.push({
                  type: 'Threshold',
                  level: level,
                  color: '#6b7280' // Gray
                });
              }
            }
          });
        }
      });
    }
    
    // Check for trigger levels in payoff events
    if (evaluationResults?.events) {
      evaluationResults.events.forEach(event => {
        if (event.triggerLevel && event.triggerLevel !== 100) {
          if (!levels.find(l => l.level === event.triggerLevel)) {
            levels.push({
              type: 'Trigger',
              level: event.triggerLevel,
              color: '#dc2626' // Red
            });
          }
        }
      });
    }
    
    return levels;
  }

  /**
   * Calculate step-down barrier level for a specific date
   * @param {string} currentDate - Current date
   * @param {Array} stepDownSchedule - Schedule of step-down periods
   * @param {number} initialLevel - Initial barrier level
   * @returns {number} Barrier level for the current date
   */
  calculateStepDownLevel(currentDate, stepDownSchedule, initialLevel) {
    const currentDateObj = new Date(currentDate);
    
    // Find the applicable step-down period
    for (const period of stepDownSchedule) {
      const startDate = new Date(period.startDate);
      const endDate = new Date(period.endDate);
      
      if (currentDateObj >= startDate && currentDateObj <= endDate) {
        return parseFloat(period.level);
      }
    }
    
    // Return initial level if no step-down period applies
    return initialLevel;
  }

  /**
   * Get quarter start date based on product launch date
   * @param {number} quarter - Quarter number (1, 2, 3, 4...)
   * @param {Object} product - Product configuration
   * @returns {Date} Quarter start date
   */
  getQuarterStartDate(quarter, product) {
    const launchDate = new Date(product.tradeDate || product.valueDate || product.createdAt);
    const quarterStart = new Date(launchDate);
    quarterStart.setMonth(launchDate.getMonth() + ((quarter - 1) * 3));
    return quarterStart;
  }

  /**
   * Get quarter end date based on product launch date
   * @param {number} quarter - Quarter number (1, 2, 3, 4...)
   * @param {Object} product - Product configuration
   * @returns {Date} Quarter end date
   */
  getQuarterEndDate(quarter, product) {
    const quarterStart = this.getQuarterStartDate(quarter, product);
    const quarterEnd = new Date(quarterStart);
    quarterEnd.setMonth(quarterStart.getMonth() + 3);
    quarterEnd.setDate(quarterEnd.getDate() - 1); // Last day of quarter
    return quarterEnd;
  }
}