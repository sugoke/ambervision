/**
 * DateRangeGenerator - Handles date range generation for chart x-axis
 * 
 * Responsibilities:
 * - Generate optimized date ranges with smart sampling
 * - Extract important dates from product structure
 * - Calculate trading days and time periods
 * - Handle quarterly and observation date logic
 */
export class DateRangeGenerator {
  constructor() {
    this.version = '1.0.0';
  }

  /**
   * Generate optimized date range for x-axis with smart sampling
   * Creates a timeline with first of month dates plus important observation dates
   * @param {Object} product - Product configuration
   * @param {Date} evaluationDate - Current evaluation date
   * @returns {Object} Date range with labels, dates, and metadata
   */
  generateDateRange(product, evaluationDate = new Date()) {
    // Validate product dates with fallbacks
    // Use Trade Date as the start date for all calculations (per user requirement)
    const startDateStr = product.tradeDate || product.valueDate || product.createdAt;
    const finalDateStr = product.finalObservation || product.maturity || product.maturityDate;
    
    if (!startDateStr) {
    }
    if (!finalDateStr) {
    }
    
    const startDate = startDateStr ? new Date(startDateStr) : new Date(evaluationDate);
    const finalDate = finalDateStr ? new Date(finalDateStr) : new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
    const today = new Date();
    
    // Validate that dates are valid
    if (isNaN(startDate.getTime())) {
      startDate.setTime(today.getTime());
    }
    if (isNaN(finalDate.getTime())) {
      finalDate.setTime(startDate.getTime() + 365 * 24 * 60 * 60 * 1000);
    }
    
    // Chart should end at final date (no extension beyond maturity)
    const chartEndDate = finalDate;
    
    // Extract important observation dates from product structure
    const importantDates = this.extractImportantDates(product);
    
    // Generate ALL daily dates for data points (full price history)
    const dates = [];
    const labels = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= chartEndDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      dates.push(new Date(currentDate));
      labels.push(dateStr);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    
    return {
      dates,
      labels,
      startDate,
      finalDate,
      chartEndDate,
      evaluationDate,
      today,
      totalDays: labels.length,
      tradingDaysToMaturity: this.calculateTradingDays(today, finalDate),
      daysFromInitial: this.calculateTradingDays(startDate, today),
      hasMatured: evaluationDate >= finalDate,
      importantDates: importantDates.map(d => d.toISOString().split('T')[0])
    };
  }

  /**
   * Extract important dates from product structure (observations, barriers, etc.)
   * ONLY processes the actual drag-and-drop payoff structure mechanism
   * IGNORES hardcoded observationDates and observationFrequency fields
   * @param {Object} product - Product configuration
   * @returns {Array} Array of important Date objects
   */
  extractImportantDates(product) {
    const importantDates = [];
    
    try {
      
      // Extract observation dates from payoff structure ONLY
      if (product.payoffStructure) {
        product.payoffStructure.forEach(component => {
          // Look for observation components with specific dates
          if (component.type === 'observation' && component.date) {
            importantDates.push(new Date(component.date));
          }
          
          // Look for timing components
          if (component.type === 'timing' && component.date) {
            importantDates.push(new Date(component.date));
          }
          
          // Look for barrier observation dates (if explicitly set in component)
          if ((component.type === 'barrier' || component.type === 'autocall') && component.observationDate) {
            importantDates.push(new Date(component.observationDate));
          }
        });
      }
      
      // Extract from schedule if it exists (legacy support)
      if (product.schedule && Array.isArray(product.schedule)) {
        product.schedule.forEach(scheduleItem => {
          if (scheduleItem.date) {
            importantDates.push(new Date(scheduleItem.date));
          }
          if (scheduleItem.observationDate) {
            importantDates.push(new Date(scheduleItem.observationDate));
          }
        });
      }
      
      // COMPLETELY IGNORE hardcoded frequency fields
      
      // Filter out invalid dates and sort
      const validDates = importantDates.filter(date => !isNaN(date.getTime()));
      
      if (validDates.length === 0) {
      }
      return validDates.sort((a, b) => a - b);
      
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if product has quarterly observation structure
   * @param {Object} product - Product configuration
   * @returns {boolean} True if quarterly structure detected
   */
  hasQuarterlyStructure(product) {
    if (product.payoffStructure) {
      return product.payoffStructure.some(component => 
        component.label && component.label.toLowerCase().includes('quarterly')
      );
    }
    return false;
  }

  /**
   * Generate quarterly observation dates based on product launch
   * @param {Object} product - Product configuration
   * @returns {Array} Array of quarterly Date objects
   */
  generateQuarterlyDates(product) {
    const quarterlyDates = [];
    const startDate = new Date(product.tradeDate || product.valueDate || product.createdAt);
    const endDate = new Date(product.maturity || product.maturityDate);
    
    let currentQuarterDate = new Date(startDate);
    currentQuarterDate.setMonth(currentQuarterDate.getMonth() + 3);
    
    while (currentQuarterDate < endDate) {
      quarterlyDates.push(new Date(currentQuarterDate));
      currentQuarterDate.setMonth(currentQuarterDate.getMonth() + 3);
    }
    
    return quarterlyDates;
  }

  /**
   * Calculate trading days between two dates
   */
  calculateTradingDays(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    let tradingDays = 0;
    const currentDate = new Date(start);
    
    while (currentDate <= end) {
      // Count only weekdays (Monday = 1, Sunday = 0)
      const dayOfWeek = currentDate.getDay();
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        tradingDays++;
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return tradingDays;
  }

  /**
   * Calculate time to maturity in various formats
   */
  calculateTimeToMaturity(product, evaluationDate) {
    if (!product.maturity && !product.maturityDate) return null;
    
    const maturityDate = new Date(product.maturity || product.maturityDate);
    const evalDate = new Date(evaluationDate);
    
    const diffTime = maturityDate.getTime() - evalDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return {
      totalDays: diffDays,
      tradingDays: this.calculateTradingDays(evalDate, maturityDate),
      months: Math.round(diffDays / 30.44),
      years: Math.round(diffDays / 365.25 * 10) / 10,
      hasMatured: diffDays <= 0,
      maturityDate: maturityDate.toISOString()
    };
  }

  /**
   * Format x-axis labels for optimal readability
   * Shows important dates with descriptive labels and monthly markers
   * @param {string} label - Date label (YYYY-MM-DD)
   * @param {Object} product - Product configuration
   * @param {number} index - Label index in the array
   * @param {number} totalLabels - Total number of labels for optimization
   * @returns {string} Formatted label or empty string
   */
  formatXAxisLabel(label, product, index, totalLabels = 0) {
    // Show important dates
    const importantDates = [
      product.tradeDate,
      product.maturity || product.maturityDate,
      ...(product.observationDates || [])
    ].filter(Boolean);
    
    if (importantDates.includes(label)) {
      if (label === product.tradeDate) return 'Initial';
      if (label === (product.maturity || product.maturityDate)) return 'Maturity';
      const obsIndex = product.observationDates?.indexOf(label);
      if (obsIndex !== -1) {
        return obsIndex === product.observationDates.length - 1 ? 'Final' : `Obs ${obsIndex + 1}`;
      }
    }
    
    // Show monthly markers - optimize frequency based on total chart width
    const monthlyInterval = totalLabels > 365 ? 60 : 30; // Every 2 months if > 1 year data
    if (index % monthlyInterval === 0) {
      const date = new Date(label);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    
    return '';
  }

  /**
   * Check if a date is an important date that should be shown on x-axis
   * @param {string} dateStr - Date string to check (YYYY-MM-DD)
   * @param {Object} product - Product configuration
   * @returns {boolean} True if date should be shown on x-axis
   */
  isImportantDate(dateStr, product) {
    if (!dateStr || !product) return false;
    
    try {
      const checkDate = new Date(dateStr).toISOString().split('T')[0];
      
      // Check if it's an observation date
      if (product.observationDates && Array.isArray(product.observationDates)) {
        const hasObsDate = product.observationDates.some(obsDate => {
          return new Date(obsDate).toISOString().split('T')[0] === checkDate;
        });
        if (hasObsDate) return true;
      }
      
      // Check payoff structure for timing components
      if (product.payoffStructure && Array.isArray(product.payoffStructure)) {
        const hasImportantComponent = product.payoffStructure.some(component => {
          if ((component.type === 'observation' || component.type === 'timing') && component.date) {
            return new Date(component.date).toISOString().split('T')[0] === checkDate;
          }
          return false;
        });
        if (hasImportantComponent) return true;
      }
      
      // Check if it's trade date or maturity date
      if (product.tradeDate && new Date(product.tradeDate).toISOString().split('T')[0] === checkDate) return true;
      if (product.maturity && new Date(product.maturity).toISOString().split('T')[0] === checkDate) return true;
      if (product.maturityDate && new Date(product.maturityDate).toISOString().split('T')[0] === checkDate) return true;
      
    } catch (error) {
    }
    
    return false;
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