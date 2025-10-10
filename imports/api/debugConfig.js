/**
 * Debug Configuration for Structured Products Application
 * 
 * This module provides centralized configuration for debug logging
 * throughout the application to prevent excessive logging in production
 * and allow selective debugging during development.
 */

/**
 * Global debug configuration
 * Set these to true to enable specific debugging categories
 */
export const DEBUG_CONFIG = {
  // Operator mapping and resolution debugging
  OPERATOR_MAPPING: false,
  
  // Component evaluation debugging  
  COMPARISON_EVALUATOR: false,
  BARRIER_EVALUATOR: false,
  ACTION_EVALUATOR: false,
  
  // Formula compilation debugging
  FORMULA_COMPILER: false,
  
  // Evaluation context debugging
  EVALUATION_CONTEXT: false,
  
  // Price service debugging
  PRICE_SERVICE: false,
  
  // Report generation debugging
  REPORT_GENERATOR: false,
  
  // Payoff interpreter debugging
  PAYOFF_INTERPRETER: false
};

/**
 * Initialize debug flags on global object for easy access
 * Only in development environment
 */
export function initializeDebugFlags() {
  if (typeof global !== 'undefined' && process.env.NODE_ENV === 'development') {
    // Set global debug flags
    global.OPERATOR_MAPPING_DEBUG = DEBUG_CONFIG.OPERATOR_MAPPING;
    global.COMPARISON_EVALUATOR_DEBUG = DEBUG_CONFIG.COMPARISON_EVALUATOR;
    global.BARRIER_EVALUATOR_DEBUG = DEBUG_CONFIG.BARRIER_EVALUATOR;
    global.ACTION_EVALUATOR_DEBUG = DEBUG_CONFIG.ACTION_EVALUATOR;
    global.FORMULA_COMPILER_DEBUG = DEBUG_CONFIG.FORMULA_COMPILER;
    global.EVALUATION_CONTEXT_DEBUG = DEBUG_CONFIG.EVALUATION_CONTEXT;
    global.PRICE_SERVICE_DEBUG = DEBUG_CONFIG.PRICE_SERVICE;
    global.REPORT_GENERATOR_DEBUG = DEBUG_CONFIG.REPORT_GENERATOR;
    global.PAYOFF_INTERPRETER_DEBUG = DEBUG_CONFIG.PAYOFF_INTERPRETER;
    
    // Debug flags initialized for development
  }
}

/**
 * Enable all debugging (for troubleshooting)
 * Call this function to turn on all debug categories
 */
export function enableAllDebugging() {
  Object.keys(DEBUG_CONFIG).forEach(key => {
    DEBUG_CONFIG[key] = true;
  });
  initializeDebugFlags();
  console.log('🔍 All debugging enabled');
}

/**
 * Disable all debugging (for production-like performance)
 */
export function disableAllDebugging() {
  Object.keys(DEBUG_CONFIG).forEach(key => {
    DEBUG_CONFIG[key] = false;
  });
  initializeDebugFlags();
  console.log('🔇 All debugging disabled');
}

/**
 * Enable specific debug category
 * @param {string} category - Debug category to enable
 */
export function enableDebugCategory(category) {
  if (DEBUG_CONFIG.hasOwnProperty(category)) {
    DEBUG_CONFIG[category] = true;
    initializeDebugFlags();
    console.log(`🔍 Debug enabled for: ${category}`);
  } else {
    console.warn(`⚠️  Unknown debug category: ${category}`);
  }
}

/**
 * Disable specific debug category
 * @param {string} category - Debug category to disable
 */
export function disableDebugCategory(category) {
  if (DEBUG_CONFIG.hasOwnProperty(category)) {
    DEBUG_CONFIG[category] = false;
    initializeDebugFlags();
    console.log(`🔇 Debug disabled for: ${category}`);
  } else {
    console.warn(`⚠️  Unknown debug category: ${category}`);
  }
}

/**
 * Check if debug is enabled for a specific category
 * @param {string} category - Debug category to check
 * @returns {boolean} - True if debugging is enabled for this category
 */
export function isDebugEnabled(category) {
  return DEBUG_CONFIG[category] === true && process.env.NODE_ENV === 'development';
}

/**
 * Conditional debug logger - only logs if category is enabled
 * @param {string} category - Debug category
 * @param {string} message - Log message
 * @param {...any} args - Additional arguments to log
 */
export function debugLog(category, message, ...args) {
  if (isDebugEnabled(category)) {
    console.log(`[${category}] ${message}`, ...args);
  }
}

/**
 * Conditional debug warning - only logs if category is enabled
 * @param {string} category - Debug category
 * @param {string} message - Warning message
 * @param {...any} args - Additional arguments to log
 */
export function debugWarn(category, message, ...args) {
  if (isDebugEnabled(category)) {
    console.warn(`[${category}] ${message}`, ...args);
  }
}

/**
 * Conditional debug error - only logs if category is enabled
 * @param {string} category - Debug category
 * @param {string} message - Error message
 * @param {...any} args - Additional arguments to log
 */
export function debugError(category, message, ...args) {
  if (isDebugEnabled(category)) {
    console.error(`[${category}] ${message}`, ...args);
  }
}

// Initialize debug flags when module is loaded
initializeDebugFlags();