import { PriceService } from './priceService.js';

/**
 * EvaluationContext - Manages state and data access during product evaluation
 * 
 * This class provides a unified interface for component evaluators to:
 * - Access market data and prices
 * - Resolve values and percentages
 * - Manage memory/state between evaluations
 * - Track events and debug information
 */
export class EvaluationContext {
  constructor(product, priceService, currentDate) {
    this.product = product;
    this.priceService = priceService;
    
    // Validate and set current date
    if (currentDate) {
      const dateObj = new Date(currentDate);
      if (isNaN(dateObj.getTime())) {
        this.currentDate = new Date();
      } else {
        this.currentDate = dateObj;
      }
    } else {
      this.currentDate = new Date();
    }
    
    // Evaluation state
    this.variables = {}; // User-defined variables
    this.memory = {}; // Persistent memory between observations
    this.memoryBuckets = {}; // Named memory buckets for generic tracking
    this.events = []; // Event log for this evaluation
    this.debugLog = []; // Debug information
    this.errors = []; // Error log
    
    // Cache frequently accessed data
    this.underlyingPriceCache = new Map();
    this.initialPrices = null; // Prices at trade date
    this.observationCount = 0;
    this.currentObservation = null; // Current observation data
    
    // Initialize context
    this.initialize();
  }

  /**
   * Initialize the evaluation context
   */
  async initialize() {
    // Initialize evaluation context with minimal logging to prevent console spam
    
    // Cache initial prices for performance calculations
    try {
      const initStartTime = Date.now();
      this.initialPrices = await this.loadInitialPrices();
      const initTime = Date.now() - initStartTime;
      
      this.recordDebug('INIT', `Loaded initial prices for ${this.product.underlyings?.length || 0} underlyings in ${initTime}ms`, this.observationCount);
      
    } catch (error) {
      this.recordError('INIT', `Failed to load initial prices: ${error.message}`);
    }
  }

  /**
   * Load initial prices at trade date for all underlyings
   */
  async loadInitialPrices() {
    if (!this.product.underlyings || this.product.underlyings.length === 0) {
      return {};
    }

    // Use trade date as the initial observation date for calculations
    const tradeDate = new Date(this.product.tradeDate);
    const initialPrices = {};

    // Loading initial prices for underlyings

    for (const [index, underlying] of this.product.underlyings.entries()) {
      // Processing underlying

      // Try multiple identifiers and store price under all of them for lookup flexibility
      const identifiers = [
        underlying.ticker,
        underlying.id, 
        underlying.symbol,
        underlying.name
      ].filter(Boolean);
      
      let price = null;
      let successfulIdentifier = null;
      
      for (const identifier of identifiers) {
        try {
          // Trying to fetch price using identifier
          price = await this.priceService.getPrice(identifier, tradeDate, 'close');
          if (price !== null) {
            successfulIdentifier = identifier;
            // Got initial price
            break;
          }
        } catch (error) {
          // Failed with identifier - continue to next
          continue;
        }
      }
      
      // Store the price under all identifiers for flexible lookup
      if (price !== null) {
        for (const identifier of identifiers) {
          initialPrices[identifier] = price;
          // Stored initial price
        }
      } else {
        // No initial price found for underlying
        for (const identifier of identifiers) {
          initialPrices[identifier] = null;
        }
        this.recordError('INIT', `Failed to get initial price for underlying with identifiers: ${identifiers.join(', ')}`);
      }
    }

    // Initial prices loaded
    return initialPrices;
  }

  // ============ PRICE AND MARKET DATA ACCESS ============

  /**
   * Get current price for an underlying asset
   * @param {string} underlyingId - Underlying asset ID or ticker
   * @param {Date} date - Price date (defaults to current date)
   * @param {string} priceType - 'open', 'high', 'low', 'close'
   * @returns {Promise<number|null>} - Price value
   */
  async getUnderlyingPrice(underlyingId, date = this.currentDate, priceType = 'close') {
    const cacheKey = `${underlyingId}_${date.toISOString().split('T')[0]}_${priceType}`;
    
    // Getting price for underlying
    
    if (this.underlyingPriceCache.has(cacheKey)) {
      const cachedPrice = this.underlyingPriceCache.get(cacheKey);
      // Cache hit
      return cachedPrice;
    }
    
    // Cache miss - fetching from PriceService

    const underlying = this.findUnderlying(underlyingId);
    if (!underlying || !underlying.ticker) {
      // Available underlyings checked
      this.recordError('PRICE', `Underlying not found or missing ticker: ${underlyingId}`);
      return null;
    }

    // Found underlying

    try {
      const fetchStartTime = Date.now();
      const price = await this.priceService.getPrice(underlying.ticker, date, priceType);
      const fetchTime = Date.now() - fetchStartTime;
      
      // Price fetched successfully
      
      this.underlyingPriceCache.set(cacheKey, price);
      // Price cached
      
      return price;
    } catch (error) {
      this.recordError('PRICE', `Failed to get price for ${underlying.ticker} on ${date}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get underlying value as percentage of initial price
   * @param {string} underlyingId - Underlying asset ID
   * @param {Date} date - Evaluation date
   * @returns {Promise<number>} - Performance as percentage (100 = no change)
   */
  async getUnderlyingValue(underlyingId, date = this.currentDate) {
    // Getting underlying value
    
    const currentPrice = await this.getUnderlyingPrice(underlyingId, date);
    const initialPrice = this.initialPrices?.[underlyingId];

    // Price data retrieved

    if (!currentPrice || !initialPrice) {
      // Try alternative IDs for the underlying
      const underlying = this.findUnderlying(underlyingId);
      // Found underlying
      
      if (underlying) {
        // Try different ID variations
        const alternativeIds = [underlying.id, underlying.ticker, underlying.name].filter(Boolean);
        // Trying alternative IDs
        
        for (const altId of alternativeIds) {
          if (altId !== underlyingId) {
            const altCurrentPrice = await this.getUnderlyingPrice(altId, date);
            const altInitialPrice = this.initialPrices?.[altId];
            // Checking alternative ID
            
            if (altCurrentPrice && altInitialPrice) {
              const performance = (altCurrentPrice / altInitialPrice) * 100;
              // Success with alternative ID
              this.recordDebug('VALUE', `Underlying ${underlyingId} (via ${altId}): ${altCurrentPrice} / ${altInitialPrice} = ${performance.toFixed(2)}%`);
              return performance;
            }
          }
        }
      }
      
      // Missing price data for all variations, returning 100% as fallback
      this.recordError('VALUE', `Missing price data for underlying ${underlyingId} and all alternatives`);
      return 100; // Fallback to no change
    }

    const performance = (currentPrice / initialPrice) * 100;
    // Calculated performance
    this.recordDebug('VALUE', `Underlying ${underlyingId}: ${currentPrice} / ${initialPrice} = ${performance.toFixed(2)}%`);
    return performance;
  }

  /**
   * Get all underlying values as percentages
   * @param {Date} date - Evaluation date
   * @returns {Promise<number[]>} - Array of performance percentages
   */
  async getAllUnderlyingValues(date = this.currentDate) {
    if (!this.product.underlyings || this.product.underlyings.length === 0) {
      // No underlyings found, returning [100]
      return [100]; // No underlyings, assume no change
    }

    // Getting values for all underlyings
    
    const values = [];
    for (const [index, underlying] of this.product.underlyings.entries()) {
      // Processing underlying
      
      // Try multiple ID sources in order of preference
      const identifiers = [
        underlying.ticker,
        underlying.id, 
        underlying.symbol,
        underlying.name
      ].filter(Boolean);
      
      let value = null;
      for (const identifier of identifiers) {
        // Trying identifier
        try {
          value = await this.getUnderlyingValue(identifier, date);
          if (value !== null && !isNaN(value)) {
            // Got value
            break;
          }
        } catch (error) {
          // Failed with identifier
          continue;
        }
      }
      
      if (value === null || isNaN(value)) {
        // No valid value found for underlying, using 100% as fallback
        value = 100; // Fallback to no change
      }
      
      values.push(value);
      // Added value for underlying
    }

    // Final values calculated
    return values;
  }

  /**
   * Calculate worst-of underlying performance
   * @param {Date} date - Evaluation date
   * @returns {Promise<number>} - Worst performance percentage
   */
  async getUnderlyingPerformance(date = this.currentDate) {
    // Cache key for this specific date
    const dateKey = date.toISOString().split('T')[0];
    const cacheKey = `performance_${dateKey}`;
    
    // Check if we already calculated performance for this date in this evaluation
    if (this.underlyingPriceCache.has(cacheKey)) {
      return this.underlyingPriceCache.get(cacheKey);
    }
    
    const allValues = await this.getAllUnderlyingValues(date);
    const worstPerformance = Math.min(...allValues);
    
    // Log underlying performances (only on first calculation)
    if (this.product.underlyings && this.product.underlyings.length > 0) {
      const underlyingDetails = this.product.underlyings.map((u, i) => 
        `${u.ticker || u.name || u.id}: ${allValues[i]?.toFixed(2)}%`
      ).join(', ');
    }
    
    // Cache the result
    this.underlyingPriceCache.set(cacheKey, worstPerformance);
    
    return worstPerformance;
  }

  // ============ VALUE RESOLUTION ============

  /**
   * Resolve a value expression to a number
   * @param {string|number} valueExpression - Value to resolve
   * @returns {number} - Resolved numeric value
   */
  resolveValue(valueExpression) {
    if (typeof valueExpression === 'number') {
      return valueExpression;
    }

    if (typeof valueExpression !== 'string') {
      return 0;
    }

    // Handle percentage strings
    if (valueExpression.includes('%')) {
      return this.resolvePercentage(valueExpression);
    }

    // Handle variable references
    if (this.variables[valueExpression]) {
      return this.variables[valueExpression];
    }

    // Handle special references
    switch (valueExpression.toLowerCase()) {
      case 'strike':
      case 'initial':
        return 100; // Strike/initial level typically 100%
      case 'zero':
      case 'nothing':
        return 0;
      default:
        // Try to parse as number
        const parsed = parseFloat(valueExpression);
        return isNaN(parsed) ? 0 : parsed;
    }
  }

  /**
   * Resolve percentage string to decimal value
   * @param {string} percentageStr - Percentage string (e.g., "70%", "105%")
   * @param {number} baseValue - Base value for percentage calculation
   * @returns {number} - Resolved percentage value
   */
  resolvePercentage(percentageStr, baseValue = 100) {
    if (typeof percentageStr === 'number') {
      return percentageStr;
    }

    if (typeof percentageStr !== 'string') {
      return baseValue;
    }

    // Remove % sign and parse
    const cleanStr = percentageStr.replace('%', '').trim();
    const percentage = parseFloat(cleanStr);
    
    if (isNaN(percentage)) {
      this.recordError('RESOLVE', `Invalid percentage: ${percentageStr}`);
      return baseValue;
    }

    // Return as percentage of base value
    return (percentage / 100) * baseValue;
  }

  /**
   * Resolve amount with special handling for payoff amounts
   * @param {string|number} amountExpression - Amount expression
   * @returns {number} - Resolved amount
   */
  resolveAmount(amountExpression) {
    if (typeof amountExpression === 'number') {
      return amountExpression;
    }

    if (typeof amountExpression !== 'string') {
      return 0;
    }

    // Parse mathematical expressions in the amount
    return this.parseMathematicalExpression(amountExpression);
  }

  /**
   * Parse and evaluate mathematical expressions from labels
   * @param {string} expression - Mathematical expression (e.g., "100% + 7%", "underlying * 150%")
   * @returns {number} - Evaluated result
   */
  parseMathematicalExpression(expression) {
    try {
      const expr = expression.toLowerCase().trim();
      
      // Handle simple percentage values first
      if (/^\d+(\.\d+)?%?$/.test(expr.replace('%', ''))) {
        const value = parseFloat(expr.replace('%', ''));
        return isNaN(value) ? 0 : value;
      }

      // Handle mathematical expressions with percentages
      // Replace percentage values with their numeric equivalents
      let processedExpr = expr
        .replace(/(\d+(?:\.\d+)?)%/g, '$1') // Remove % signs but keep numbers
        .replace(/underlying(?:\s*performance)?/g, () => this.getUnderlyingPerformance().toString())
        .replace(/initial(?:\s*level)?/g, '100')
        .replace(/full(?:\s*protection)?/g, '100')
        .replace(/capital/g, '100');

      // Simple expression evaluation for common patterns
      if (processedExpr.includes('+')) {
        const parts = processedExpr.split('+').map(p => {
          const trimmed = p.trim();
          const num = parseFloat(trimmed);
          return isNaN(num) ? 0 : num;
        });
        return parts.reduce((sum, val) => sum + val, 0);
      }

      if (processedExpr.includes('-')) {
        const parts = processedExpr.split('-').map(p => {
          const trimmed = p.trim();
          const num = parseFloat(trimmed);
          return isNaN(num) ? 0 : num;
        });
        return parts.reduce((result, val, index) => index === 0 ? val : result - val, 0);
      }

      if (processedExpr.includes('*')) {
        const parts = processedExpr.split('*').map(p => {
          const trimmed = p.trim();
          const num = parseFloat(trimmed);
          return isNaN(num) ? 1 : num;
        });
        return parts.reduce((result, val) => result * val, 1);
      }

      // If no mathematical operators, try to parse as simple number
      const simpleValue = parseFloat(processedExpr);
      if (!isNaN(simpleValue)) {
        return simpleValue;
      }

      // Fallback: log the unparseable expression and return 0
      this.recordDebug('MATH_PARSE', `Could not parse expression: "${expression}", returning 0`);
      return 0;

    } catch (error) {
      this.recordError('MATH_PARSE', `Error parsing expression "${expression}": ${error.message}`);
      return 0;
    }
  }

  // ============ MEMORY AND STATE MANAGEMENT ============

  /**
   * Get value from memory
   * @param {string} key - Memory key
   * @returns {any} - Stored value
   */
  getMemoryValue(key) {
    return this.memory[key];
  }

  /**
   * Set value in memory
   * @param {string} key - Memory key
   * @param {any} value - Value to store
   */
  setMemoryValue(key, value) {
    this.memory[key] = value;
    this.recordDebug('MEMORY', `Set ${key} = ${value}`);
  }

  /**
   * Get variable value
   * @param {string} name - Variable name
   * @returns {any} - Variable value
   */
  getVariable(name) {
    return this.variables[name];
  }

  /**
   * Set variable value
   * @param {string} name - Variable name
   * @param {any} value - Variable value
   */
  setVariable(name, value) {
    this.variables[name] = value;
    this.recordDebug('VARIABLE', `Set ${name} = ${value}`);
  }

  /**
   * Get current observation count
   * @returns {number} - Number of observations processed
   */
  getObservationCount() {
    return this.observationCount;
  }

  /**
   * Increment observation count
   */
  incrementObservationCount() {
    this.observationCount++;
  }

  // ============ EVENT AND DEBUG LOGGING ============

  /**
   * Record an event
   * @param {Object} event - Event object
   */
  recordEvent(event) {
    const eventWithMetadata = {
      ...event,
      date: this.currentDate,
      timestamp: new Date(),
      observationCount: this.observationCount
    };
    
    this.events.push(eventWithMetadata);
    this.recordDebug('EVENT', `Recorded: ${event.type} - ${event.description || 'No description'}`);
  }

  /**
   * Record debug information
   * @param {string} category - Debug category
   * @param {string} message - Debug message
   */
  recordDebug(category, message) {
    this.debugLog.push({
      category,
      message,
      date: this.currentDate,
      timestamp: new Date(),
      observationCount: this.observationCount
    });
  }

  /**
   * Record an error
   * @param {string} category - Error category
   * @param {string} message - Error message
   */
  recordError(category, message) {
    const error = {
      category,
      message,
      date: this.currentDate,
      timestamp: new Date(),
      observationCount: this.observationCount
    };
    
    this.errors.push(error);
    // Only log non-price errors to console to reduce spam
    if (category !== 'VALUE' && category !== 'PRICE') {
    }
  }

  // ============ UTILITY METHODS ============

  /**
   * Find underlying asset by ID or ticker
   * @param {string} underlyingId - Underlying ID or ticker
   * @returns {Object|null} - Underlying asset object
   */
  findUnderlying(underlyingId) {
    if (!this.product.underlyings) {
      // No underlyings array in product
      return null;
    }

    // Searching for underlying

    // Try exact matches first
    let underlying = this.product.underlyings.find(u => 
      u.id === underlyingId || 
      u.ticker === underlyingId ||
      u.name === underlyingId ||
      u.symbol === underlyingId
    );

    if (underlying) {
      // Found exact match
      return underlying;
    }

    // Try case-insensitive matches
    const lowerSearchId = underlyingId.toLowerCase();
    underlying = this.product.underlyings.find(u => 
      u.id?.toLowerCase() === lowerSearchId || 
      u.ticker?.toLowerCase() === lowerSearchId ||
      u.name?.toLowerCase() === lowerSearchId ||
      u.symbol?.toLowerCase() === lowerSearchId
    );

    if (underlying) {
      // Found case-insensitive match
      return underlying;
    }

    // Try partial matches (contains)
    underlying = this.product.underlyings.find(u => 
      u.ticker?.includes(underlyingId) ||
      underlyingId.includes(u.ticker) ||
      u.name?.includes(underlyingId) ||
      underlyingId.includes(u.name)
    );

    if (underlying) {
      // Found partial match
      return underlying;
    }

    // No underlying found
    return null;
  }

  /**
   * Check if current date is at maturity
   * @returns {boolean} - True if at maturity
   */
  isAtMaturity() {
    // Use finalObservation date for evaluation, not the maturity payment date
    const finalObservationValue = this.product.finalObservation || this.product.finalObservationDate;
    const maturityDateValue = this.product.maturityDate || this.product.maturity;
    
    // Prefer finalObservation over maturity date
    const evaluationDateValue = finalObservationValue || maturityDateValue;
    
    if (!evaluationDateValue) {
      return false;
    }
    
    const evaluationDate = new Date(evaluationDateValue);
    evaluationDate.setHours(0, 0, 0, 0);
    
    const currentDateNormalized = new Date(this.currentDate);
    currentDateNormalized.setHours(0, 0, 0, 0);
    
    const result = currentDateNormalized.getTime() === evaluationDate.getTime();
    if (result) {
    }
    
    return result;
  }

  /**
   * Check if current date is during product life
   * @returns {boolean} - True if during life (not at maturity)
   */
  isDuringLife() {
    return !this.isAtMaturity();
  }

  /**
   * Get days until maturity
   * @returns {number} - Days until maturity
   */
  getDaysToMaturity() {
    const maturityDateValue = this.product.maturityDate || this.product.maturity;
    if (!maturityDateValue) {
      return 0;
    }
    const maturityDate = new Date(maturityDateValue);
    const timeDiff = maturityDate.getTime() - this.currentDate.getTime();
    return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
  }

  /**
   * Get evaluation summary
   * @returns {Object} - Summary of evaluation context
   */
  getSummary() {
    return {
      product: {
        title: this.product.title,
        isin: this.product.isin,
        tradeDate: this.product.tradeDate,
        maturityDate: this.product.maturityDate,
        underlyings: this.product.underlyings?.length || 0
      },
      evaluation: {
        currentDate: this.currentDate,
        observationCount: this.observationCount,
        isAtMaturity: this.isAtMaturity(),
        daysToMaturity: this.getDaysToMaturity()
      },
      state: {
        variableCount: Object.keys(this.variables).length,
        memoryKeys: Object.keys(this.memory),
        eventCount: this.events.length,
        errorCount: this.errors.length,
        debugLogCount: this.debugLog.length
      }
    };
  }

  /**
   * Update the current date for evaluation context
   * @param {Date} newDate - New evaluation date
   */
  updateCurrentDate(newDate) {
    if (!newDate) {
      return;
    }
    
    const dateObj = new Date(newDate);
    if (isNaN(dateObj.getTime())) {
      return;
    }
    
    this.currentDate = dateObj;
    // Updated current date
  }

  /**
   * Set current observation data for evaluation
   * @param {Object} observation - Observation data including barriers and flags
   */
  setCurrentObservation(observation) {
    this.currentObservation = observation;
  }

  /**
   * Get current observation data
   * @returns {Object|null} Current observation or null
   */
  getCurrentObservation() {
    return this.currentObservation;
  }

  /**
   * Clear context state (useful for new evaluation)
   */
  reset() {
    this.variables = {};
    this.memory = {};
    this.memoryBuckets = {};
    this.events = [];
    this.debugLog = [];
    this.errors = [];
    this.underlyingPriceCache.clear();
    this.observationCount = 0;
  }
  
  // Generic memory bucket operations
  addToMemoryBucket(bucketName, asset, value) {
    if (!this.memoryBuckets[bucketName]) {
      this.memoryBuckets[bucketName] = [];
    }
    
    // Check if asset already exists in bucket
    const existingIndex = this.memoryBuckets[bucketName].findIndex(
      item => item.asset === asset
    );
    
    if (existingIndex >= 0) {
      // Update existing entry
      this.memoryBuckets[bucketName][existingIndex] = {
        asset,
        value,
        date: this.currentDate,
        lastUpdated: new Date()
      };
    } else {
      // Add new entry
      this.memoryBuckets[bucketName].push({
        asset,
        value,
        date: this.currentDate,
        lastUpdated: new Date()
      });
    }
    
  }
  
  checkAssetInMemoryBucket(bucketName, asset) {
    if (!this.memoryBuckets[bucketName]) {
      return false;
    }
    
    return this.memoryBuckets[bucketName].some(item => item.asset === asset);
  }
  
  getMemoryBucketValue(bucketName, asset) {
    if (!this.memoryBuckets[bucketName]) {
      return null;
    }
    
    const item = this.memoryBuckets[bucketName].find(item => item.asset === asset);
    return item ? item.value : null;
  }
  
  getMemoryBucket(bucketName) {
    return this.memoryBuckets[bucketName] || [];
  }
}