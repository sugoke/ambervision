/**
 * Generic Component Library
 * 
 * This defines all the generic building blocks needed to construct
 * ANY structured product payoff without using product-specific names.
 * 
 * The philosophy: Every structured product is just a combination of:
 * - Timing rules (when things happen)
 * - Conditions (what needs to be true)
 * - Actions (what happens when conditions are met)
 * - Memory/State (tracking things over time)
 */

export const GenericComponentTypes = {
  // ============ TIMING COMPONENTS ============
  TIMING: {
    SPECIFIC_DATE: 'specific_date',
    PERIODIC_OBSERVATION: 'periodic_observation',
    CONTINUOUS_MONITORING: 'continuous_monitoring',
    MATURITY_ONLY: 'maturity_only',
    FIRST_PERIOD: 'first_period',
    LAST_PERIOD: 'last_period',
    TRADING_DAY_COUNT: 'trading_day_count',
    CALENDAR_DAY_COUNT: 'calendar_day_count'
  },

  // ============ VALUE REFERENCES ============
  VALUES: {
    UNDERLYING_PRICE: 'underlying_price',
    UNDERLYING_PERFORMANCE: 'underlying_performance',
    BASKET_PERFORMANCE: 'basket_performance',
    WORST_PERFORMANCE: 'worst_performance',
    BEST_PERFORMANCE: 'best_performance',
    AVERAGE_PERFORMANCE: 'average_performance',
    NTH_BEST_PERFORMANCE: 'nth_best_performance',
    VOLATILITY: 'volatility',
    CORRELATION: 'correlation',
    TIME_VALUE: 'time_value'
  },

  // ============ COMPARISON OPERATORS ============
  COMPARISONS: {
    GREATER_THAN: 'greater_than',
    GREATER_OR_EQUAL: 'greater_or_equal',
    LESS_THAN: 'less_than',
    LESS_OR_EQUAL: 'less_or_equal',
    EQUAL: 'equal',
    NOT_EQUAL: 'not_equal',
    BETWEEN: 'between',
    OUTSIDE: 'outside',
    HAS_OCCURRED: 'has_occurred',
    HAS_NOT_OCCURRED: 'has_not_occurred'
  },

  // ============ MEMORY/STATE TRACKING ============
  MEMORY: {
    STORE_VALUE: 'store_value',
    RETRIEVE_VALUE: 'retrieve_value',
    ACCUMULATE_VALUE: 'accumulate_value',
    TRACK_MAXIMUM: 'track_maximum',
    TRACK_MINIMUM: 'track_minimum',
    COUNT_OCCURRENCES: 'count_occurrences',
    MARK_OCCURRENCE: 'mark_occurrence',
    CHECK_ALL_MARKED: 'check_all_marked',
    REMOVE_FROM_SET: 'remove_from_set',
    LOCK_IF_CONDITION: 'lock_if_condition'
  },

  // ============ MATHEMATICAL OPERATIONS ============
  OPERATIONS: {
    ADD: 'add',
    SUBTRACT: 'subtract',
    MULTIPLY: 'multiply',
    DIVIDE: 'divide',
    POWER: 'power',
    ABSOLUTE: 'absolute',
    MINIMUM: 'minimum',
    MAXIMUM: 'maximum',
    AVERAGE: 'average',
    CAP: 'cap',
    FLOOR: 'floor',
    TRANSFORM_NEGATIVE: 'transform_negative'
  },

  // ============ PAYMENT ACTIONS ============
  PAYMENTS: {
    FIXED_PAYMENT: 'fixed_payment',
    PERFORMANCE_PAYMENT: 'performance_payment',
    CONDITIONAL_PAYMENT: 'conditional_payment',
    ACCUMULATED_PAYMENT: 'accumulated_payment',
    INCREMENTAL_PAYMENT: 'incremental_payment',
    PROGRESSIVE_PAYMENT: 'progressive_payment',
    BUFFERED_PAYMENT: 'buffered_payment',
    SWITCHED_PAYMENT: 'switched_payment',
    CAPPED_PAYMENT: 'capped_payment',
    FLOORED_PAYMENT: 'floored_payment'
  },

  // ============ PRODUCT CONTROL ============
  CONTROL: {
    TERMINATE_PRODUCT: 'terminate_product',
    CONTINUE_PRODUCT: 'continue_product',
    SKIP_REMAINING: 'skip_remaining',
    RESET_MEMORY: 'reset_memory',
    CHANGE_FREQUENCY: 'change_frequency',
    ACTIVATE_FEATURE: 'activate_feature',
    DEACTIVATE_FEATURE: 'deactivate_feature'
  },

  // ============ LOGICAL FLOW ============
  LOGIC: {
    IF_THEN: 'if_then',
    ELSE_IF: 'else_if',
    ELSE: 'else',
    AND: 'and',
    OR: 'or',
    NOT: 'not',
    XOR: 'xor'
  },

  // ============ ADVANCED FEATURES ============
  ADVANCED: {
    // Performance modifications
    LOCK_GAINS: 'lock_gains',
    RESET_STRIKES: 'reset_strikes',
    ADJUST_BARRIERS: 'adjust_barriers',
    
    // Complex calculations
    PERIOD_ON_PERIOD: 'period_on_period',
    ROLLING_AVERAGE: 'rolling_average',
    WEIGHTED_AVERAGE: 'weighted_average',
    
    // Multi-asset operations
    INDEPENDENT_TRACKING: 'independent_tracking',
    SEQUENTIAL_REMOVAL: 'sequential_removal',
    CONDITIONAL_ASSIGNMENT: 'conditional_assignment',
    
    // Time-based modifications
    TIME_DECAY: 'time_decay',
    OBSERVATION_SCALING: 'observation_scaling',
    PERIOD_ADJUSTMENT: 'period_adjustment',
    
    // Range operations
    RANGE_ACCUMULATION: 'range_accumulation',
    BREACH_COUNTING: 'breach_counting',
    DURATION_IN_RANGE: 'duration_in_range'
  }
};

/**
 * Generic component configurations
 * These can be combined to create any structured product
 */
export const GenericComponents = [
  // ============ OBSERVATION TIMING ============
  {
    type: 'timing',
    subtype: 'periodic',
    label: 'Periodic Observation',
    icon: '📅',
    description: 'Evaluates on scheduled dates',
    configurable: true,
    config: {
      frequency: ['daily', 'weekly', 'monthly', 'quarterly', 'annual'],
      businessDaysOnly: true
    }
  },
  {
    type: 'timing',
    subtype: 'continuous',
    label: 'Continuous Monitoring',
    icon: '📊',
    description: 'Monitors every trading day',
    configurable: true,
    config: {
      startTime: 'market_open',
      endTime: 'market_close',
      checkType: ['close', 'intraday', 'high_low']
    }
  },
  {
    type: 'timing',
    subtype: 'specific',
    label: 'Specific Date Check',
    icon: '📌',
    description: 'Evaluates on a specific date',
    configurable: true,
    config: {
      date: 'date_picker',
      fallbackRule: ['next_business_day', 'previous_business_day']
    }
  },

  // ============ VALUE COMPARISONS ============
  {
    type: 'comparison',
    subtype: 'threshold',
    label: 'Threshold Comparison',
    icon: '🎯',
    description: 'Compares value against threshold',
    configurable: true,
    config: {
      leftValue: 'value_selector',
      operator: ['>=', '>', '<=', '<', '==', '!='],
      rightValue: 'value_input',
      tolerance: 0.0001
    }
  },
  {
    type: 'comparison',
    subtype: 'range',
    label: 'Range Check',
    icon: '↔️',
    description: 'Checks if value is within range',
    configurable: true,
    config: {
      value: 'value_selector',
      lowerBound: 'value_input',
      upperBound: 'value_input',
      inclusive: true
    }
  },
  {
    type: 'comparison',
    subtype: 'multi_asset',
    label: 'Multi-Asset Condition',
    icon: '🎲',
    description: 'Condition across multiple assets',
    configurable: true,
    config: {
      aggregation: ['all', 'any', 'count', 'none'],
      condition: 'condition_builder',
      threshold: 'number_input'
    }
  },

  // ============ MEMORY OPERATIONS ============
  {
    type: 'memory',
    subtype: 'accumulator',
    label: 'Value Accumulator',
    icon: '📊',
    description: 'Accumulates values over time',
    configurable: true,
    config: {
      operation: ['sum', 'product', 'count', 'list'],
      resetOn: ['never', 'payment', 'condition'],
      key: 'string_input'
    }
  },
  {
    type: 'memory',
    subtype: 'tracker',
    label: 'Event Tracker',
    icon: '📍',
    description: 'Tracks occurrence of events',
    configurable: true,
    config: {
      trackType: ['first_occurrence', 'last_occurrence', 'all_occurrences'],
      perAsset: true,
      eventKey: 'string_input'
    }
  },
  {
    type: 'memory',
    subtype: 'extremum',
    label: 'Min/Max Tracker',
    icon: '📈',
    description: 'Tracks minimum or maximum values',
    configurable: true,
    config: {
      trackType: ['minimum', 'maximum', 'both'],
      resetPeriod: ['never', 'annually', 'on_event'],
      key: 'string_input'
    }
  },

  // ============ PAYMENT CALCULATIONS ============
  {
    type: 'payment',
    subtype: 'fixed',
    label: 'Fixed Payment',
    icon: '💵',
    description: 'Pays a fixed amount',
    configurable: true,
    config: {
      amount: 'percentage_input',
      currency: 'currency_selector'
    }
  },
  {
    type: 'payment',
    subtype: 'performance',
    label: 'Performance Payment',
    icon: '📊',
    description: 'Pays based on performance',
    configurable: true,
    config: {
      baseValue: 'value_selector',
      multiplier: 'number_input',
      floor: 'percentage_input',
      cap: 'percentage_input'
    }
  },
  {
    type: 'payment',
    subtype: 'conditional',
    label: 'Conditional Payment',
    icon: '🔀',
    description: 'Payment depends on condition',
    configurable: true,
    config: {
      condition: 'condition_builder',
      truePayment: 'payment_selector',
      falsePayment: 'payment_selector'
    }
  },
  {
    type: 'payment',
    subtype: 'accumulated',
    label: 'Accumulated Payment',
    icon: '💰',
    description: 'Pays accumulated amount',
    configurable: true,
    config: {
      accumulatorKey: 'string_input',
      additionalAmount: 'percentage_input',
      resetAfterPayment: true
    }
  },

  // ============ TRANSFORMATIONS ============
  {
    type: 'transform',
    subtype: 'absolute',
    label: 'Absolute Value',
    icon: '📐',
    description: 'Converts to absolute value',
    configurable: true,
    config: {
      inputValue: 'value_selector',
      offset: 'number_input'
    }
  },
  {
    type: 'transform',
    subtype: 'capped',
    label: 'Capped Value',
    icon: '🎩',
    description: 'Limits value to maximum',
    configurable: true,
    config: {
      inputValue: 'value_selector',
      capLevel: 'percentage_input'
    }
  },
  {
    type: 'transform',
    subtype: 'floored',
    label: 'Floored Value',
    icon: '🔻',
    description: 'Sets minimum value',
    configurable: true,
    config: {
      inputValue: 'value_selector',
      floorLevel: 'percentage_input'
    }
  },
  {
    type: 'transform',
    subtype: 'buffered',
    label: 'Buffered Value',
    icon: '🛡️',
    description: 'Applies buffer to value',
    configurable: true,
    config: {
      inputValue: 'value_selector',
      bufferLevel: 'percentage_input',
      bufferType: ['linear', 'proportional']
    }
  },

  // ============ CONTROL FLOW ============
  {
    type: 'control',
    subtype: 'terminate',
    label: 'Terminate Product',
    icon: '🛑',
    description: 'Ends product early',
    configurable: true,
    config: {
      finalPayment: 'payment_selector',
      clearMemory: true
    }
  },
  {
    type: 'control',
    subtype: 'reset',
    label: 'Reset Values',
    icon: '🔄',
    description: 'Resets tracked values',
    configurable: true,
    config: {
      resetTargets: ['all', 'specific'],
      keys: 'key_selector'
    }
  },
  {
    type: 'control',
    subtype: 'modify',
    label: 'Modify Parameters',
    icon: '🔧',
    description: 'Changes product parameters',
    configurable: true,
    config: {
      targetParameter: 'parameter_selector',
      newValue: 'value_input',
      effectiveFrom: ['immediate', 'next_period']
    }
  },

  // ============ CAPITAL PROTECTION COMPONENTS ============
  {
    type: 'comparison',
    label: 'Capital Protection Barrier',
    icon: '🛡️',
    defaultValue: '100',
    configurable: true,
    description: 'Checks if underlying is at or above protection level'
  },
  {
    type: 'action',
    label: 'Capital Return',
    icon: '💰',
    defaultValue: '100',
    configurable: true,
    description: 'Returns capital invested when protection barrier holds'
  },
  {
    type: 'action', 
    label: '1:1 Exposure Payment',
    icon: '📉',
    defaultValue: '0',
    configurable: true,
    description: 'Payment based on 1:1 downside exposure from initial level'
  },
  {
    type: 'action',
    label: 'Maturity Coupon',
    icon: '🎫',
    defaultValue: '5',
    configurable: true,
    description: 'Fixed coupon paid at maturity only'
  },
  {
    type: 'timing',
    label: 'Maturity Evaluation',
    icon: '⏰',
    defaultValue: '',
    configurable: true,
    description: 'Evaluates conditions only at maturity date'
  },

  // ============ ADVANCED OPERATIONS ============
  {
    type: 'advanced',
    subtype: 'sequential_selection',
    label: 'Sequential Selection',
    icon: '🎯',
    description: 'Selects and removes items sequentially',
    configurable: true,
    config: {
      selectionCriteria: ['best', 'worst', 'specific'],
      removeAfterSelection: true,
      trackRemovals: true
    }
  },
  {
    type: 'advanced',
    subtype: 'independent_tracking',
    label: 'Independent Asset Tracking',
    icon: '🔐',
    description: 'Tracks each asset independently',
    configurable: true,
    config: {
      trackingCondition: 'condition_builder',
      aggregationRule: ['all_meet', 'any_meets', 'count_threshold'],
      actionOnAggregate: 'action_selector'
    }
  },
  {
    type: 'advanced',
    subtype: 'period_calculation',
    label: 'Period-on-Period Calc',
    icon: '📊',
    description: 'Calculates between periods',
    configurable: true,
    config: {
      calculationType: ['difference', 'ratio', 'growth'],
      lookbackPeriods: 'number_input',
      aggregation: ['sum', 'average', 'compound']
    }
  },
  {
    type: 'advanced',
    subtype: 'range_accumulation',
    label: 'Range Accumulation',
    icon: '📏',
    description: 'Accumulates while in range',
    configurable: true,
    config: {
      range: 'range_selector',
      accrualRate: 'percentage_input',
      accrualBasis: ['daily', 'observation', 'continuous']
    }
  }
];

/**
 * Helper function to create generic payoff structures
 */
export function createGenericStructure(components) {
  return {
    timing: components.filter(c => c.type === 'timing'),
    conditions: components.filter(c => c.type === 'comparison' || c.type === 'memory'),
    actions: components.filter(c => c.type === 'payment' || c.type === 'control'),
    transformations: components.filter(c => c.type === 'transform'),
    advanced: components.filter(c => c.type === 'advanced')
  };
}

/**
 * Generic evaluator factory
 */
export function createGenericEvaluator(componentType, config) {
  return async (context) => {
    // This would create evaluators based on the generic component type
    // without any product-specific logic
    switch (componentType) {
      case 'timing':
        return evaluateTimingCondition(config, context);
      case 'comparison':
        return evaluateComparison(config, context);
      case 'memory':
        return evaluateMemoryOperation(config, context);
      case 'payment':
        return evaluatePayment(config, context);
      case 'transform':
        return evaluateTransformation(config, context);
      case 'control':
        return evaluateControl(config, context);
      case 'advanced':
        return evaluateAdvanced(config, context);
      default:
        return null;
    }
  };
}

// Evaluation functions would go here...
function evaluateTimingCondition(config, context) {
  // Generic timing evaluation
}

function evaluateComparison(config, context) {
  // Generic comparison evaluation
}

function evaluateMemoryOperation(config, context) {
  // Generic memory operation
}

function evaluatePayment(config, context) {
  // Generic payment calculation
}

function evaluateTransformation(config, context) {
  // Generic value transformation
}

function evaluateControl(config, context) {
  // Generic control flow
}

function evaluateAdvanced(config, context) {
  // Generic advanced operations
}