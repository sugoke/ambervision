/**
 * Canonical Component Type Definitions
 * 
 * This is the single source of truth for all component types used across
 * the structured products system. These constants are used by both the
 * UI drag-and-drop interface and the backend rule engine.
 * 
 * IMPORTANT: Always import ItemTypes from this file. Never use string literals
 * for component types - use these constants instead.
 */

export const ItemTypes = {
  // Basic types
  COUPON: 'coupon',
  BARRIER: 'barrier',
  STRIKE: 'strike',
  LEVERAGE: 'leverage',
  OPERATOR: 'operator',
  CONDITION: 'condition',
  LOGIC_OPERATOR: 'logic_operator',
  VARIABLE: 'variable',
  COMPARISON: 'comparison',
  
  // Timing and observation
  OBSERVATION: 'observation',
  TIMING: 'timing',
  FREQUENCY: 'frequency',
  
  // Basket and underlyings
  BASKET: 'basket',
  UNDERLYING: 'underlying',
  
  // Memory and autocall
  MEMORY: 'memory',
  AUTOCALL: 'autocall',
  
  // Actions and results
  ACTION: 'action',
  RESULT: 'result',
  
  // Continuation
  CONTINUATION: 'continuation',
  
  DROPPED_ITEM: 'dropped_item',
  
  // Advanced barrier types
  AMERICAN_BARRIER: 'american_barrier',
  
  // Advanced features
  STEPDOWN: 'stepdown',
  WORST_OF: 'worst_of',
  DYNAMIC_COUPON: 'dynamic_coupon',
  RANGE_ACCRUAL: 'range_accrual',
  CALLABLE: 'callable',
  PARTICIPATION: 'participation',
  
  // Mathematical operations
  MATH_OPERATOR: 'math_operator',
  FORMULA: 'formula',
  VARIABLE_STORE: 'variable_store',
  VARIABLE_REF: 'variable_ref',
  
  // Conditional logic
  IF: 'if',
  ELSE: 'else',
  SETUP: 'setup',
  
  // Generic advanced components
  MULTI_ASSET_LOCK: 'multi_asset_lock',
  PERIOD_LOCK: 'period_lock',
  BEST_PERFORMER_REMOVAL: 'best_performer_removal',
  BARRIER_FIXED_ASSIGNMENT: 'barrier_fixed_assignment',
  DUAL_BARRIER_REBATE: 'dual_barrier_rebate',
  ABSOLUTE_PERFORMANCE: 'absolute_performance',
  OBSERVATION_INCREMENT: 'observation_increment',
  BUFFERED_LOSS: 'buffered_loss',
  PROGRESSIVE_RATE: 'progressive_rate',
  PERFORMANCE_SWITCH: 'performance_switch',
  GAIN_LOCK: 'gain_lock',
  
  // Generic memory management
  MEMORY_ADD: 'memory_add',
  MEMORY_CHECK: 'memory_check',
  MEMORY_GET: 'memory_get',
  
  // Conditional and array operations
  CONDITIONAL_VALUE: 'conditional_value',
  ARRAY_SUM: 'array_sum',
  ARRAY_LENGTH: 'array_length',
  ARRAY_AVERAGE: 'array_average',
  BEST_OF_REMAINING: 'best_of_remaining'
};

// Freeze the object to prevent accidental modifications
Object.freeze(ItemTypes);

/**
 * Helper function to validate if a given type is a valid component type
 * @param {string} type - The type to validate
 * @returns {boolean} True if the type is valid
 */
export function isValidComponentType(type) {
  return Object.values(ItemTypes).includes(type);
}

/**
 * Helper function to get the component type key from its value
 * @param {string} value - The component type value
 * @returns {string|null} The key name or null if not found
 */
export function getComponentTypeKey(value) {
  return Object.keys(ItemTypes).find(key => ItemTypes[key] === value) || null;
}