/**
 * Centralized Operator Mapping System
 * 
 * This module provides a unified system for translating human-readable labels
 * and identifiers into mathematical operators used throughout the evaluation engine.
 * 
 * Benefits:
 * - Single source of truth for all operator mappings
 * - Consistent normalization and validation
 * - Easy to extend with new operators
 * - Robust error handling and fallbacks
 */

/**
 * Core mathematical operators supported by the system
 */
export const MATHEMATICAL_OPERATORS = {
  GREATER_THAN: '>',
  GREATER_THAN_OR_EQUAL: '>=',
  LESS_THAN: '<',
  LESS_THAN_OR_EQUAL: '<=',
  EQUAL: '==',
  NOT_EQUAL: '!=',
  // Range operators
  BETWEEN: 'between',
  OUTSIDE: 'outside',
  // Logic operators
  NOT: 'not',
  // Touch operators
  TOUCHED: 'touched',
  NOT_TOUCHED: 'not_touched',
  // Special operators
  IN_RANGE: 'in_range',
  OUT_OF_RANGE: 'out_of_range'
};

/**
 * Comprehensive mapping from various label formats to mathematical operators
 * Supports multiple formats for maximum compatibility
 */
const OPERATOR_MAPPINGS = {
  // Primary human-readable labels (case-insensitive)
  'at or above': MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL,
  'at or equal to or above': MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL,
  'greater than or equal to': MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL,
  'at or below': MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL,
  'at or equal to or below': MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL,
  'less than or equal to': MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL,
  'above': MATHEMATICAL_OPERATORS.GREATER_THAN,
  'greater than': MATHEMATICAL_OPERATORS.GREATER_THAN,
  'below': MATHEMATICAL_OPERATORS.LESS_THAN,
  'less than': MATHEMATICAL_OPERATORS.LESS_THAN,
  'equal': MATHEMATICAL_OPERATORS.EQUAL,
  'equal to': MATHEMATICAL_OPERATORS.EQUAL,
  'equals': MATHEMATICAL_OPERATORS.EQUAL,
  'not equal': MATHEMATICAL_OPERATORS.NOT_EQUAL,
  'not equal to': MATHEMATICAL_OPERATORS.NOT_EQUAL,
  
  // Technical identifiers (snake_case)
  'at_or_above': MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL,
  'greater_than_or_equal': MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL,
  'at_or_below': MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL,
  'less_than_or_equal': MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL,
  'greater_than': MATHEMATICAL_OPERATORS.GREATER_THAN,
  'less_than': MATHEMATICAL_OPERATORS.LESS_THAN,
  'equal_to': MATHEMATICAL_OPERATORS.EQUAL,
  'not_equal': MATHEMATICAL_OPERATORS.NOT_EQUAL,
  'not_equals': MATHEMATICAL_OPERATORS.NOT_EQUAL,
  
  // Camel case identifiers
  'atOrAbove': MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL,
  'greaterThanOrEqual': MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL,
  'atOrBelow': MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL,
  'lessThanOrEqual': MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL,
  'greaterThan': MATHEMATICAL_OPERATORS.GREATER_THAN,
  'lessThan': MATHEMATICAL_OPERATORS.LESS_THAN,
  'equalTo': MATHEMATICAL_OPERATORS.EQUAL,
  'notEqual': MATHEMATICAL_OPERATORS.NOT_EQUAL,
  
  // Mathematical symbols (already normalized)
  '>=': MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL,
  '<=': MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL,
  '>': MATHEMATICAL_OPERATORS.GREATER_THAN,
  '<': MATHEMATICAL_OPERATORS.LESS_THAN,
  '==': MATHEMATICAL_OPERATORS.EQUAL,
  '=': MATHEMATICAL_OPERATORS.EQUAL, // Handle single equals
  '!=': MATHEMATICAL_OPERATORS.NOT_EQUAL,
  '<>': MATHEMATICAL_OPERATORS.NOT_EQUAL, // Alternative not-equal
  
  // Alternative phrasings and variations
  'gte': MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL,
  'lte': MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL,
  'gt': MATHEMATICAL_OPERATORS.GREATER_THAN,
  'lt': MATHEMATICAL_OPERATORS.LESS_THAN,
  'eq': MATHEMATICAL_OPERATORS.EQUAL,
  'ne': MATHEMATICAL_OPERATORS.NOT_EQUAL,
  'neq': MATHEMATICAL_OPERATORS.NOT_EQUAL,
  
  // Range operators
  'between': MATHEMATICAL_OPERATORS.BETWEEN,
  'in range': MATHEMATICAL_OPERATORS.BETWEEN,
  'within': MATHEMATICAL_OPERATORS.BETWEEN,
  'inside': MATHEMATICAL_OPERATORS.BETWEEN,
  'in_range': MATHEMATICAL_OPERATORS.IN_RANGE,
  'within_range': MATHEMATICAL_OPERATORS.IN_RANGE,
  
  'outside': MATHEMATICAL_OPERATORS.OUTSIDE,
  'out of range': MATHEMATICAL_OPERATORS.OUTSIDE,
  'not between': MATHEMATICAL_OPERATORS.OUTSIDE,
  'out_of_range': MATHEMATICAL_OPERATORS.OUT_OF_RANGE,
  'outside_range': MATHEMATICAL_OPERATORS.OUT_OF_RANGE,
  
  // Touch operators
  'touched': MATHEMATICAL_OPERATORS.TOUCHED,
  'has touched': MATHEMATICAL_OPERATORS.TOUCHED,
  'was touched': MATHEMATICAL_OPERATORS.TOUCHED,
  'hit': MATHEMATICAL_OPERATORS.TOUCHED,
  'breached': MATHEMATICAL_OPERATORS.TOUCHED,
  
  'not touched': MATHEMATICAL_OPERATORS.NOT_TOUCHED,
  'not_touched': MATHEMATICAL_OPERATORS.NOT_TOUCHED,
  'never touched': MATHEMATICAL_OPERATORS.NOT_TOUCHED,
  'untouched': MATHEMATICAL_OPERATORS.NOT_TOUCHED,
  'never hit': MATHEMATICAL_OPERATORS.NOT_TOUCHED,
  'never breached': MATHEMATICAL_OPERATORS.NOT_TOUCHED,
  
  // Logic operators
  'not': MATHEMATICAL_OPERATORS.NOT,
  '!': MATHEMATICAL_OPERATORS.NOT,
  'negate': MATHEMATICAL_OPERATORS.NOT,
  'negation': MATHEMATICAL_OPERATORS.NOT
};

/**
 * Reverse mapping from operators to human-readable labels
 */
export const OPERATOR_TO_LABEL = {
  [MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL]: 'At or Above',
  [MATHEMATICAL_OPERATORS.LESS_THAN_OR_EQUAL]: 'At or Below',
  [MATHEMATICAL_OPERATORS.GREATER_THAN]: 'Above',
  [MATHEMATICAL_OPERATORS.LESS_THAN]: 'Below',
  [MATHEMATICAL_OPERATORS.EQUAL]: 'Equal to',
  [MATHEMATICAL_OPERATORS.NOT_EQUAL]: 'Not Equal to',
  [MATHEMATICAL_OPERATORS.BETWEEN]: 'Between',
  [MATHEMATICAL_OPERATORS.OUTSIDE]: 'Outside',
  [MATHEMATICAL_OPERATORS.NOT]: 'Not',
  [MATHEMATICAL_OPERATORS.TOUCHED]: 'Touched',
  [MATHEMATICAL_OPERATORS.NOT_TOUCHED]: 'Not Touched',
  [MATHEMATICAL_OPERATORS.IN_RANGE]: 'In Range',
  [MATHEMATICAL_OPERATORS.OUT_OF_RANGE]: 'Out of Range'
};

/**
 * Main function to resolve any operator input to a mathematical operator
 * @param {string|undefined|null} input - The operator input (label, identifier, or symbol)
 * @param {string} fallback - Fallback operator if input cannot be resolved
 * @param {boolean} strict - If true, throws error for unrecognized operators
 * @returns {string} - Mathematical operator symbol
 */
export function resolveOperator(input, fallback = MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL, strict = false) {
  // Handle null/undefined/empty inputs
  if (!input || typeof input !== 'string') {
    if (strict) {
      throw new Error(`Invalid operator input: ${input}. Expected non-empty string.`);
    }
    console.warn(`[OPERATOR_MAPPING] Invalid operator input: ${input}, using fallback: ${fallback}`);
    return fallback;
  }
  
  // Normalize input: trim whitespace and convert to lowercase for lookup
  const normalizedInput = input.trim().toLowerCase();
  
  // Direct lookup in mapping table
  const resolvedOperator = OPERATOR_MAPPINGS[normalizedInput];
  
  if (resolvedOperator) {
    return resolvedOperator;
  }
  
  // Fallback handling
  if (strict) {
    const availableOperators = Object.keys(OPERATOR_MAPPINGS).slice(0, 10).join(', ') + '...';
    throw new Error(`Unrecognized operator: "${input}". Available operators include: ${availableOperators}`);
  }
  
  console.warn(`[OPERATOR_MAPPING] Unrecognized operator: "${input}", using fallback: ${fallback}`);
  return fallback;
}

/**
 * Get human-readable label for a mathematical operator
 * @param {string} operator - Mathematical operator symbol
 * @returns {string} - Human-readable label
 */
export function getOperatorLabel(operator) {
  return OPERATOR_TO_LABEL[operator] || operator;
}

/**
 * Validate that an operator is supported by the system
 * @param {string} operator - Operator to validate
 * @returns {boolean} - True if operator is valid
 */
export function isValidOperator(operator) {
  return Object.values(MATHEMATICAL_OPERATORS).includes(operator);
}

/**
 * Get all supported mathematical operators
 * @returns {string[]} - Array of all mathematical operator symbols
 */
export function getSupportedOperators() {
  return Object.values(MATHEMATICAL_OPERATORS);
}

/**
 * Get all recognized input formats for operator resolution
 * @returns {string[]} - Array of all recognized input formats
 */
export function getRecognizedInputs() {
  return Object.keys(OPERATOR_MAPPINGS);
}

/**
 * Enhanced component backward compatibility function
 * Replaces the scattered logic with centralized operator resolution
 * @param {Object} component - Component to enhance
 * @returns {Object} - Enhanced component with resolved operator
 */
export function enhanceComponentOperator(component) {
  if (!component) {
    return component;
  }
  
  const enhanced = { ...component };
  
  // Handle comparison components
  if (component.type === 'comparison' || component.type === 'condition') {
    // Try multiple sources for operator information
    const operatorSources = [
      component.operator,        // Explicit operator field
      component.comparisonType,  // Alternative field name
      component.label,           // Human-readable label
      component.condition        // Legacy field name
    ].filter(Boolean);
    
    if (operatorSources.length > 0) {
      // Use the first resolvable operator source
      for (const source of operatorSources) {
        try {
          const resolvedOperator = resolveOperator(source, null, false);
          if (resolvedOperator && isValidOperator(resolvedOperator)) {
            enhanced.operator = resolvedOperator;
            // Component enhancement successful - no need to log every time
            break;
          }
        } catch (error) {
          console.warn(`[OPERATOR_ENHANCEMENT] Failed to resolve operator from "${source}":`, error.message);
          continue;
        }
      }
    }
    
    // Ensure we have a valid operator (fallback)
    if (!enhanced.operator || !isValidOperator(enhanced.operator)) {
      enhanced.operator = MATHEMATICAL_OPERATORS.GREATER_THAN_OR_EQUAL;
      console.warn(`[OPERATOR_ENHANCEMENT] Component ${component.id || 'unknown'} has no valid operator, using fallback: ${enhanced.operator}`);
    }
  }
  
  return enhanced;
}

/**
 * Debug function to analyze operator resolution for a given input
 * @param {string} input - Input to analyze
 * @returns {Object} - Analysis results
 */
export function debugOperatorResolution(input) {
  const normalized = input ? input.trim().toLowerCase() : '';
  const resolved = resolveOperator(input, null, false);
  const isValid = isValidOperator(resolved);
  const label = getOperatorLabel(resolved);
  
  return {
    input,
    normalized,
    resolved,
    isValid,
    label,
    foundInMapping: OPERATOR_MAPPINGS.hasOwnProperty(normalized),
    possibleMatches: Object.keys(OPERATOR_MAPPINGS).filter(key => 
      key.includes(normalized) || normalized.includes(key)
    ).slice(0, 5)
  };
}