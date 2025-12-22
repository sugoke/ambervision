/**
 * Processing Issue Types
 *
 * Defines all possible issue types that can occur during product evaluation.
 * Used by ProcessingIssueCollector to create standardized issue objects.
 */

export const PROCESSING_ISSUE_TYPES = {
  // Market Data Issues
  MISSING_PRICE_DATA: {
    code: 'MISSING_PRICE_DATA',
    severity: 'error',
    category: 'market_data',
    messageTemplate: 'Missing price data for {ticker}'
  },
  STALE_PRICE_DATA: {
    code: 'STALE_PRICE_DATA',
    severity: 'warning',
    category: 'market_data',
    messageTemplate: 'Price data for {ticker} is {days} days old'
  },
  INVALID_PRICE_VALUE: {
    code: 'INVALID_PRICE_VALUE',
    severity: 'error',
    category: 'market_data',
    messageTemplate: 'Invalid price value for {ticker}: {value}'
  },

  // Evaluation Issues
  EVALUATION_ERROR: {
    code: 'EVALUATION_ERROR',
    severity: 'error',
    category: 'evaluation',
    messageTemplate: 'Evaluation failed: {error}'
  },
  MISSING_INITIAL_PRICE: {
    code: 'MISSING_INITIAL_PRICE',
    severity: 'error',
    category: 'evaluation',
    messageTemplate: 'Missing initial price for {ticker}'
  },
  BARRIER_CALCULATION_ERROR: {
    code: 'BARRIER_CALCULATION_ERROR',
    severity: 'error',
    category: 'evaluation',
    messageTemplate: 'Cannot calculate barrier level: {reason}'
  },
  PERFORMANCE_CALCULATION_ERROR: {
    code: 'PERFORMANCE_CALCULATION_ERROR',
    severity: 'error',
    category: 'evaluation',
    messageTemplate: 'Cannot calculate performance for {ticker}: {reason}'
  },

  // Chart Generation Issues
  CHART_GENERATION_FAILED: {
    code: 'CHART_GENERATION_FAILED',
    severity: 'warning',
    category: 'chart',
    messageTemplate: 'Chart generation failed: {error}'
  },
  INSUFFICIENT_CHART_DATA: {
    code: 'INSUFFICIENT_CHART_DATA',
    severity: 'warning',
    category: 'chart',
    messageTemplate: 'Insufficient data points for chart ({count} of {required})'
  },

  // Report Generation Issues
  REPORT_GENERATION_PARTIAL: {
    code: 'REPORT_GENERATION_PARTIAL',
    severity: 'warning',
    category: 'report',
    messageTemplate: 'Report generated with missing sections: {sections}'
  },
  REPORT_INSERTION_FAILED: {
    code: 'REPORT_INSERTION_FAILED',
    severity: 'error',
    category: 'report',
    messageTemplate: 'Failed to save report to database'
  },

  // Data Integrity Issues
  MISSING_UNDERLYING: {
    code: 'MISSING_UNDERLYING',
    severity: 'error',
    category: 'data',
    messageTemplate: 'Underlying {ticker} not found in product configuration'
  },
  INVALID_DATE_CONFIGURATION: {
    code: 'INVALID_DATE_CONFIGURATION',
    severity: 'error',
    category: 'data',
    messageTemplate: 'Invalid date configuration: {field}'
  },
  MISSING_REQUIRED_FIELD: {
    code: 'MISSING_REQUIRED_FIELD',
    severity: 'error',
    category: 'data',
    messageTemplate: 'Missing required field: {field}'
  }
};

/**
 * Helper function to create a processing issue object from a type code
 *
 * @param {string} typeCode - The issue type code (e.g., 'MISSING_PRICE_DATA')
 * @param {Object} params - Parameters to substitute in the message template
 * @returns {Object} - The issue object
 */
export const createProcessingIssue = (typeCode, params = {}) => {
  const issueType = PROCESSING_ISSUE_TYPES[typeCode];
  if (!issueType) {
    // Return a generic issue if type is unknown
    return {
      type: typeCode,
      severity: 'error',
      category: 'unknown',
      message: params.message || `Unknown issue: ${typeCode}`,
      timestamp: new Date(),
      ...params.underlying && { underlying: params.underlying },
      ...params.context && { context: params.context }
    };
  }

  // Substitute template parameters
  let message = issueType.messageTemplate;
  Object.entries(params).forEach(([key, value]) => {
    if (key !== 'context' && key !== 'underlying') {
      message = message.replace(`{${key}}`, value);
    }
  });

  return {
    type: issueType.code,
    severity: issueType.severity,
    category: issueType.category,
    message,
    timestamp: new Date(),
    ...params.underlying && { underlying: params.underlying },
    ...params.context && { context: params.context }
  };
};

/**
 * Get all issue types by category
 *
 * @param {string} category - The category to filter by
 * @returns {Array} - Array of issue type objects
 */
export const getIssueTypesByCategory = (category) => {
  return Object.values(PROCESSING_ISSUE_TYPES).filter(t => t.category === category);
};

/**
 * Check if an issue type code is valid
 *
 * @param {string} typeCode - The issue type code to check
 * @returns {boolean} - True if valid
 */
export const isValidIssueType = (typeCode) => {
  return typeCode in PROCESSING_ISSUE_TYPES;
};
