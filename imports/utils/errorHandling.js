/**
 * Centralized error handling utilities
 * Provides consistent error handling patterns across the application
 */

// Error types
export const ERROR_TYPES = {
  NETWORK: 'NETWORK',
  VALIDATION: 'VALIDATION',
  PERMISSION: 'PERMISSION',
  NOT_FOUND: 'NOT_FOUND',
  SERVER: 'SERVER',
  CLIENT: 'CLIENT'
};

// Error severity levels
export const ERROR_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

/**
 * StandardError class for consistent error handling
 */
export class StandardError extends Error {
  constructor(message, type = ERROR_TYPES.CLIENT, severity = ERROR_SEVERITY.MEDIUM, details = {}) {
    super(message);
    this.name = 'StandardError';
    this.type = type;
    this.severity = severity;
    this.details = details;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      type: this.type,
      severity: this.severity,
      details: this.details,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

/**
 * Parse Meteor method errors into standardized format
 * @param {Error} error - Meteor error object
 * @returns {StandardError} Standardized error
 */
export const parseMeteorError = (error) => {
  if (error instanceof StandardError) {
    return error;
  }

  let type = ERROR_TYPES.SERVER;
  let severity = ERROR_SEVERITY.MEDIUM;
  let message = error.message || 'An unknown error occurred';

  // Determine error type based on error properties
  if (error.error === 403 || error.reason?.includes('Access denied')) {
    type = ERROR_TYPES.PERMISSION;
    severity = ERROR_SEVERITY.HIGH;
  } else if (error.error === 404 || error.reason?.includes('not found')) {
    type = ERROR_TYPES.NOT_FOUND;
    severity = ERROR_SEVERITY.LOW;
  } else if (error.error === 400 || error.reason?.includes('validation')) {
    type = ERROR_TYPES.VALIDATION;
    severity = ERROR_SEVERITY.LOW;
  } else if (error.error >= 500) {
    type = ERROR_TYPES.SERVER;
    severity = ERROR_SEVERITY.HIGH;
  } else if (!navigator.onLine) {
    type = ERROR_TYPES.NETWORK;
    severity = ERROR_SEVERITY.MEDIUM;
  }

  return new StandardError(
    message,
    type,
    severity,
    {
      originalError: error.error,
      reason: error.reason,
      details: error.details
    }
  );
};

/**
 * Handle errors with appropriate user feedback and logging
 * @param {Error} error - Error to handle
 * @param {Object} options - Handling options
 * @param {boolean} options.showToUser - Whether to show error to user
 * @param {Function} options.onError - Custom error handler
 * @param {boolean} options.logError - Whether to log error
 * @returns {StandardError} Processed error
 */
export const handleError = (error, options = {}) => {
  const {
    showToUser = true,
    onError,
    logError = true,
    context = 'unknown'
  } = options;

  const standardError = error instanceof StandardError ? error : parseMeteorError(error);

  // Log error based on severity
  if (logError) {
    const logLevel = getLogLevel(standardError.severity);
    console[logLevel](`[${context}] ${standardError.type} Error:`, standardError.toJSON());
  }

  // Show user-friendly error message
  if (showToUser) {
    const userMessage = getUserFriendlyMessage(standardError);
    showErrorMessage(userMessage, standardError.severity);
  }

  // Call custom error handler
  if (onError && typeof onError === 'function') {
    onError(standardError);
  }

  return standardError;
};

/**
 * Get appropriate log level for error severity
 * @param {string} severity - Error severity
 * @returns {string} Console log method name
 */
const getLogLevel = (severity) => {
  switch (severity) {
    case ERROR_SEVERITY.LOW:
      return 'info';
    case ERROR_SEVERITY.MEDIUM:
      return 'warn';
    case ERROR_SEVERITY.HIGH:
    case ERROR_SEVERITY.CRITICAL:
      return 'error';
    default:
      return 'warn';
  }
};

/**
 * Convert technical error to user-friendly message
 * @param {StandardError} error - Standardized error
 * @returns {string} User-friendly message
 */
const getUserFriendlyMessage = (error) => {
  switch (error.type) {
    case ERROR_TYPES.NETWORK:
      return 'Network connection issue. Please check your internet connection and try again.';
    case ERROR_TYPES.PERMISSION:
      return 'You don\'t have permission to perform this action.';
    case ERROR_TYPES.NOT_FOUND:
      return 'The requested resource could not be found.';
    case ERROR_TYPES.VALIDATION:
      return error.message || 'Please check your input and try again.';
    case ERROR_TYPES.SERVER:
      return 'A server error occurred. Please try again later.';
    default:
      return error.message || 'An unexpected error occurred.';
  }
};

/**
 * Show error message to user (placeholder for actual notification system)
 * @param {string} message - Error message
 * @param {string} severity - Error severity
 */
const showErrorMessage = (message, severity) => {
  // This would integrate with your notification system
  // For now, we'll just log to console
  console.warn('User Error:', { message, severity });
  
  // Could integrate with toast notifications, modal dialogs, etc.
  // Example: toast.error(message);
};

/**
 * Async error boundary helper
 * @param {Function} asyncFn - Async function to wrap
 * @param {Object} options - Error handling options
 * @returns {Function} Wrapped function
 */
export const withErrorHandling = (asyncFn, options = {}) => {
  return async (...args) => {
    try {
      return await asyncFn(...args);
    } catch (error) {
      const handledError = handleError(error, {
        context: options.context || asyncFn.name,
        ...options
      });
      
      if (options.rethrow) {
        throw handledError;
      }
      
      return options.fallback || null;
    }
  };
};

/**
 * Validation error helpers
 */
export const createValidationError = (field, message) => {
  return new StandardError(
    message,
    ERROR_TYPES.VALIDATION,
    ERROR_SEVERITY.LOW,
    { field }
  );
};

export const createValidationErrors = (errors) => {
  return Object.entries(errors).map(([field, message]) => 
    createValidationError(field, message)
  );
};

/**
 * Error retry utility
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} delay - Delay between retries (ms)
 * @returns {Promise} Function result or final error
 */
export const withRetry = async (fn, maxRetries = 3, delay = 1000) => {
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        throw handleError(error, {
          context: 'withRetry',
          showToUser: true
        });
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay * attempt));
    }
  }
  
  throw lastError;
};

/**
 * Network error detection
 * @param {Error} error - Error to check
 * @returns {boolean} Whether error is network-related
 */
export const isNetworkError = (error) => {
  return (
    !navigator.onLine ||
    error.type === ERROR_TYPES.NETWORK ||
    error.message?.includes('NetworkError') ||
    error.message?.includes('fetch')
  );
};

/**
 * Permission error detection
 * @param {Error} error - Error to check
 * @returns {boolean} Whether error is permission-related
 */
export const isPermissionError = (error) => {
  return (
    error.type === ERROR_TYPES.PERMISSION ||
    error.error === 403 ||
    error.message?.includes('permission') ||
    error.message?.includes('Access denied')
  );
};