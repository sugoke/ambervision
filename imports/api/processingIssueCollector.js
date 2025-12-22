/**
 * Processing Issue Collector
 *
 * Collects and manages processing issues during product evaluation.
 * Used throughout the evaluation pipeline to track warnings and errors.
 */

import { createProcessingIssue, PROCESSING_ISSUE_TYPES } from './constants/processingIssueTypes.js';

export class ProcessingIssueCollector {
  /**
   * Create a new issue collector for a product
   *
   * @param {string} productId - The product ID being evaluated
   */
  constructor(productId) {
    this.productId = productId;
    this.issues = [];
    this.startTime = new Date();
  }

  /**
   * Add a typed issue using a predefined issue type
   *
   * @param {string} typeCode - Issue type code from PROCESSING_ISSUE_TYPES
   * @param {Object} params - Parameters for the issue (ticker, error, etc.)
   * @returns {ProcessingIssueCollector} - Returns this for chaining
   */
  addIssue(typeCode, params = {}) {
    const issue = createProcessingIssue(typeCode, params);
    this.issues.push(issue);
    return this;
  }

  /**
   * Add a custom warning
   *
   * @param {string} message - Warning message
   * @param {Object} context - Additional context data
   * @returns {ProcessingIssueCollector} - Returns this for chaining
   */
  addWarning(message, context = {}) {
    this.issues.push({
      type: 'CUSTOM_WARNING',
      severity: 'warning',
      category: 'custom',
      message,
      timestamp: new Date(),
      ...context.underlying && { underlying: context.underlying },
      context
    });
    return this;
  }

  /**
   * Add a custom error
   *
   * @param {string} message - Error message
   * @param {Object} context - Additional context data
   * @returns {ProcessingIssueCollector} - Returns this for chaining
   */
  addError(message, context = {}) {
    this.issues.push({
      type: 'CUSTOM_ERROR',
      severity: 'error',
      category: 'custom',
      message,
      timestamp: new Date(),
      ...context.underlying && { underlying: context.underlying },
      context
    });
    return this;
  }

  /**
   * Check if any errors have been collected
   *
   * @returns {boolean}
   */
  hasErrors() {
    return this.issues.some(i => i.severity === 'error');
  }

  /**
   * Check if any warnings have been collected
   *
   * @returns {boolean}
   */
  hasWarnings() {
    return this.issues.some(i => i.severity === 'warning');
  }

  /**
   * Check if any issues (errors or warnings) have been collected
   *
   * @returns {boolean}
   */
  hasIssues() {
    return this.issues.length > 0;
  }

  /**
   * Get all collected issues
   *
   * @returns {Array} - Array of issue objects
   */
  getIssues() {
    return this.issues;
  }

  /**
   * Get issues filtered by severity
   *
   * @param {string} severity - 'error' or 'warning'
   * @returns {Array} - Filtered issues
   */
  getIssuesBySeverity(severity) {
    return this.issues.filter(i => i.severity === severity);
  }

  /**
   * Get issues filtered by category
   *
   * @param {string} category - Category to filter by
   * @returns {Array} - Filtered issues
   */
  getIssuesByCategory(category) {
    return this.issues.filter(i => i.category === category);
  }

  /**
   * Get issues for a specific underlying
   *
   * @param {string} ticker - Underlying ticker
   * @returns {Array} - Issues for that underlying
   */
  getIssuesForUnderlying(ticker) {
    return this.issues.filter(i => i.underlying === ticker);
  }

  /**
   * Get a summary of all collected issues
   *
   * @returns {Object} - Summary object with status flags and issues
   */
  getSummary() {
    const hasErrors = this.hasErrors();
    const hasWarnings = this.hasWarnings();

    return {
      processingStatus: hasErrors ? 'error' : hasWarnings ? 'warning' : 'success',
      hasProcessingErrors: hasErrors,
      hasProcessingWarnings: hasWarnings,
      processingIssues: this.issues,
      issueCount: this.issues.length,
      errorCount: this.issues.filter(i => i.severity === 'error').length,
      warningCount: this.issues.filter(i => i.severity === 'warning').length,
      processingDuration: new Date() - this.startTime
    };
  }

  /**
   * Merge issues from another collector
   *
   * @param {ProcessingIssueCollector} otherCollector - Another collector to merge from
   * @returns {ProcessingIssueCollector} - Returns this for chaining
   */
  merge(otherCollector) {
    if (otherCollector && otherCollector.issues) {
      this.issues.push(...otherCollector.issues);
    }
    return this;
  }

  /**
   * Clear all collected issues
   *
   * @returns {ProcessingIssueCollector} - Returns this for chaining
   */
  clear() {
    this.issues = [];
    return this;
  }

  /**
   * Create a log-friendly representation of issues
   *
   * @returns {string} - Formatted string for logging
   */
  toLogString() {
    if (!this.hasIssues()) {
      return `[${this.productId}] No processing issues`;
    }

    const errors = this.getIssuesBySeverity('error');
    const warnings = this.getIssuesBySeverity('warning');

    let log = `[${this.productId}] Processing issues:`;
    if (errors.length > 0) {
      log += `\n  Errors (${errors.length}):`;
      errors.forEach(e => {
        log += `\n    - [${e.type}] ${e.message}`;
      });
    }
    if (warnings.length > 0) {
      log += `\n  Warnings (${warnings.length}):`;
      warnings.forEach(w => {
        log += `\n    - [${w.type}] ${w.message}`;
      });
    }
    return log;
  }
}

/**
 * Re-export issue types and helpers for convenience
 */
export { PROCESSING_ISSUE_TYPES, createProcessingIssue };
