/**
 * Mathematical Primitives for Generic Structured Product Evaluation
 * 
 * This file defines the fundamental building blocks for creating ANY structured
 * product payoff without product-specific knowledge. Every structured product
 * is decomposed into these mathematical operations.
 * 
 * PHILOSOPHY: No product names, no business rules - only math and data.
 */

export const PrimitiveTypes = {
  // Data Access - Getting values from market/product data
  DATA_ACCESS: 'data_access',
  
  // Mathematical Operations - Pure math functions
  MATH_OPERATION: 'math_operation',
  
  // Comparison - Boolean comparisons
  COMPARISON: 'comparison',
  
  // Memory - State storage and retrieval
  MEMORY: 'memory',
  
  // Control Flow - Conditionals and product lifecycle
  CONTROL_FLOW: 'control_flow',
  
  // Action - Things that happen (payments, termination)
  ACTION: 'action',
  
  // Aggregation - Operations on collections
  AGGREGATION: 'aggregation',
  
  // Time - Date and time operations
  TIME: 'time'
};

/**
 * Data Access Primitives - Ways to get data from the environment
 */
export const DataAccessPrimitives = {
  // Market Data
  CURRENT_PRICE: {
    type: PrimitiveTypes.DATA_ACCESS,
    id: 'current_price',
    label: 'Current Price',
    description: 'Gets current market price of an asset',
    params: ['assetId'],
    returns: 'number'
  },
  
  INITIAL_PRICE: {
    type: PrimitiveTypes.DATA_ACCESS,
    id: 'initial_price',
    label: 'Initial Price',
    description: 'Gets initial/strike price of an asset',
    params: ['assetId'],
    returns: 'number'
  },
  
  PERFORMANCE: {
    type: PrimitiveTypes.DATA_ACCESS,
    id: 'performance',
    label: 'Performance',
    description: 'Calculates (current/initial - 1) * 100',
    params: ['assetId'],
    returns: 'number'
  },
  
  // Time Data
  CURRENT_DATE: {
    type: PrimitiveTypes.DATA_ACCESS,
    id: 'current_date',
    label: 'Current Date',
    description: 'Gets the current evaluation date',
    params: [],
    returns: 'date'
  },
  
  OBSERVATION_COUNT: {
    type: PrimitiveTypes.DATA_ACCESS,
    id: 'observation_count',
    label: 'Observation Count',
    description: 'Number of observations so far',
    params: [],
    returns: 'number'
  },
  
  DAYS_ELAPSED: {
    type: PrimitiveTypes.DATA_ACCESS,
    id: 'days_elapsed',
    label: 'Days Elapsed',
    description: 'Trading days since start',
    params: [],
    returns: 'number'
  },
  
  // Constants
  CONSTANT: {
    type: PrimitiveTypes.DATA_ACCESS,
    id: 'constant',
    label: 'Constant Value',
    description: 'A fixed numeric value',
    params: ['value'],
    returns: 'number'
  }
};

/**
 * Mathematical Operation Primitives
 */
export const MathPrimitives = {
  // Basic Arithmetic
  ADD: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'add',
    label: 'Add',
    description: 'a + b',
    params: ['a', 'b'],
    returns: 'number'
  },
  
  SUBTRACT: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'subtract',
    label: 'Subtract',
    description: 'a - b',
    params: ['a', 'b'],
    returns: 'number'
  },
  
  MULTIPLY: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'multiply',
    label: 'Multiply',
    description: 'a × b',
    params: ['a', 'b'],
    returns: 'number'
  },
  
  DIVIDE: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'divide',
    label: 'Divide',
    description: 'a ÷ b',
    params: ['a', 'b'],
    returns: 'number'
  },
  
  // Advanced Math
  POWER: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'power',
    label: 'Power',
    description: 'a^b',
    params: ['base', 'exponent'],
    returns: 'number'
  },
  
  ABSOLUTE: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'absolute',
    label: 'Absolute Value',
    description: '|value|',
    params: ['value'],
    returns: 'number'
  },
  
  MIN: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'min',
    label: 'Minimum',
    description: 'Minimum of values',
    params: ['...values'],
    returns: 'number'
  },
  
  MAX: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'max',
    label: 'Maximum',
    description: 'Maximum of values',
    params: ['...values'],
    returns: 'number'
  },
  
  AVERAGE: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'average',
    label: 'Average',
    description: 'Average of values',
    params: ['...values'],
    returns: 'number'
  },
  
  // Transformations
  CAP: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'cap',
    label: 'Cap/Ceiling',
    description: 'min(value, cap)',
    params: ['value', 'cap'],
    returns: 'number'
  },
  
  FLOOR: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'floor',
    label: 'Floor',
    description: 'max(value, floor)',
    params: ['value', 'floor'],
    returns: 'number'
  },
  
  CLAMP: {
    type: PrimitiveTypes.MATH_OPERATION,
    id: 'clamp',
    label: 'Clamp',
    description: 'Constrain between min and max',
    params: ['value', 'min', 'max'],
    returns: 'number'
  }
};

/**
 * Comparison Primitives
 */
export const ComparisonPrimitives = {
  GREATER_THAN: {
    type: PrimitiveTypes.COMPARISON,
    id: 'greater_than',
    label: 'Greater Than',
    description: 'a > b',
    params: ['a', 'b'],
    returns: 'boolean'
  },
  
  GREATER_OR_EQUAL: {
    type: PrimitiveTypes.COMPARISON,
    id: 'greater_or_equal',
    label: 'Greater or Equal',
    description: 'a ≥ b',
    params: ['a', 'b'],
    returns: 'boolean'
  },
  
  LESS_THAN: {
    type: PrimitiveTypes.COMPARISON,
    id: 'less_than',
    label: 'Less Than',
    description: 'a < b',
    params: ['a', 'b'],
    returns: 'boolean'
  },
  
  LESS_OR_EQUAL: {
    type: PrimitiveTypes.COMPARISON,
    id: 'less_or_equal',
    label: 'Less or Equal',
    description: 'a ≤ b',
    params: ['a', 'b'],
    returns: 'boolean'
  },
  
  EQUAL: {
    type: PrimitiveTypes.COMPARISON,
    id: 'equal',
    label: 'Equal',
    description: 'a = b',
    params: ['a', 'b'],
    returns: 'boolean'
  },
  
  NOT_EQUAL: {
    type: PrimitiveTypes.COMPARISON,
    id: 'not_equal',
    label: 'Not Equal',
    description: 'a ≠ b',
    params: ['a', 'b'],
    returns: 'boolean'
  },
  
  BETWEEN: {
    type: PrimitiveTypes.COMPARISON,
    id: 'between',
    label: 'Between',
    description: 'lower ≤ value ≤ upper',
    params: ['value', 'lower', 'upper'],
    returns: 'boolean'
  },
  
  // Logical Operations
  AND: {
    type: PrimitiveTypes.COMPARISON,
    id: 'and',
    label: 'And',
    description: 'a AND b',
    params: ['a', 'b'],
    returns: 'boolean'
  },
  
  OR: {
    type: PrimitiveTypes.COMPARISON,
    id: 'or',
    label: 'Or',
    description: 'a OR b',
    params: ['a', 'b'],
    returns: 'boolean'
  },
  
  NOT: {
    type: PrimitiveTypes.COMPARISON,
    id: 'not',
    label: 'Not',
    description: 'NOT a',
    params: ['a'],
    returns: 'boolean'
  }
};

/**
 * Memory/State Primitives
 */
export const MemoryPrimitives = {
  STORE: {
    type: PrimitiveTypes.MEMORY,
    id: 'store',
    label: 'Store Value',
    description: 'Store a value with a key',
    params: ['key', 'value'],
    returns: 'void'
  },
  
  RETRIEVE: {
    type: PrimitiveTypes.MEMORY,
    id: 'retrieve',
    label: 'Retrieve Value',
    description: 'Get stored value by key',
    params: ['key', 'defaultValue'],
    returns: 'any'
  },
  
  ACCUMULATE: {
    type: PrimitiveTypes.MEMORY,
    id: 'accumulate',
    label: 'Accumulate',
    description: 'Add to stored value',
    params: ['key', 'value'],
    returns: 'number'
  },
  
  INCREMENT: {
    type: PrimitiveTypes.MEMORY,
    id: 'increment',
    label: 'Increment',
    description: 'Add 1 to counter',
    params: ['key'],
    returns: 'number'
  },
  
  RESET: {
    type: PrimitiveTypes.MEMORY,
    id: 'reset',
    label: 'Reset',
    description: 'Clear stored value',
    params: ['key'],
    returns: 'void'
  },
  
  EXISTS: {
    type: PrimitiveTypes.MEMORY,
    id: 'exists',
    label: 'Value Exists',
    description: 'Check if key has value',
    params: ['key'],
    returns: 'boolean'
  }
};

/**
 * Control Flow Primitives
 */
export const ControlFlowPrimitives = {
  IF: {
    type: PrimitiveTypes.CONTROL_FLOW,
    id: 'if',
    label: 'If-Then-Else',
    description: 'Conditional execution',
    params: ['condition', 'thenBranch', 'elseBranch'],
    returns: 'any'
  },
  
  SEQUENCE: {
    type: PrimitiveTypes.CONTROL_FLOW,
    id: 'sequence',
    label: 'Sequence',
    description: 'Execute multiple operations',
    params: ['...operations'],
    returns: 'array'
  },
  
  TERMINATE: {
    type: PrimitiveTypes.CONTROL_FLOW,
    id: 'terminate',
    label: 'Terminate Product',
    description: 'End product lifecycle',
    params: [],
    returns: 'void'
  },
  
  CONTINUE: {
    type: PrimitiveTypes.CONTROL_FLOW,
    id: 'continue',
    label: 'Continue',
    description: 'Continue to next observation',
    params: [],
    returns: 'void'
  },
  
  SKIP: {
    type: PrimitiveTypes.CONTROL_FLOW,
    id: 'skip',
    label: 'Skip',
    description: 'Skip remaining operations',
    params: [],
    returns: 'void'
  }
};

/**
 * Action Primitives
 */
export const ActionPrimitives = {
  PAY: {
    type: PrimitiveTypes.ACTION,
    id: 'pay',
    label: 'Make Payment',
    description: 'Generate a payment',
    params: ['amount', 'description'],
    returns: 'payment'
  },
  
  EVENT: {
    type: PrimitiveTypes.ACTION,
    id: 'event',
    label: 'Record Event',
    description: 'Log an event',
    params: ['type', 'description'],
    returns: 'void'
  }
};

/**
 * Aggregation Primitives - Operations on asset baskets
 */
export const AggregationPrimitives = {
  WORST_OF: {
    type: PrimitiveTypes.AGGREGATION,
    id: 'worst_of',
    label: 'Worst Of',
    description: 'Minimum performance in basket',
    params: ['assetIds'],
    returns: 'number'
  },
  
  BEST_OF: {
    type: PrimitiveTypes.AGGREGATION,
    id: 'best_of',
    label: 'Best Of',
    description: 'Maximum performance in basket',
    params: ['assetIds'],
    returns: 'number'
  },
  
  AVERAGE_OF: {
    type: PrimitiveTypes.AGGREGATION,
    id: 'average_of',
    label: 'Average Of',
    description: 'Average performance in basket',
    params: ['assetIds'],
    returns: 'number'
  },
  
  COUNT_ABOVE: {
    type: PrimitiveTypes.AGGREGATION,
    id: 'count_above',
    label: 'Count Above',
    description: 'Count assets above threshold',
    params: ['assetIds', 'threshold'],
    returns: 'number'
  },
  
  ALL_ABOVE: {
    type: PrimitiveTypes.AGGREGATION,
    id: 'all_above',
    label: 'All Above',
    description: 'Check if all assets above threshold',
    params: ['assetIds', 'threshold'],
    returns: 'boolean'
  },
  
  ANY_ABOVE: {
    type: PrimitiveTypes.AGGREGATION,
    id: 'any_above',
    label: 'Any Above',
    description: 'Check if any asset above threshold',
    params: ['assetIds', 'threshold'],
    returns: 'boolean'
  }
};

/**
 * Time Primitives
 */
export const TimePrimitives = {
  IS_OBSERVATION_DATE: {
    type: PrimitiveTypes.TIME,
    id: 'is_observation_date',
    label: 'Is Observation Date',
    description: 'Check if current date is observation',
    params: [],
    returns: 'boolean'
  },
  
  IS_MATURITY: {
    type: PrimitiveTypes.TIME,
    id: 'is_maturity',
    label: 'Is Maturity',
    description: 'Check if at maturity date',
    params: [],
    returns: 'boolean'
  },
  
  DAYS_TO_MATURITY: {
    type: PrimitiveTypes.TIME,
    id: 'days_to_maturity',
    label: 'Days to Maturity',
    description: 'Trading days until maturity',
    params: [],
    returns: 'number'
  },
  
  DATE_AFTER: {
    type: PrimitiveTypes.TIME,
    id: 'date_after',
    label: 'Date After',
    description: 'Check if after specific date',
    params: ['date'],
    returns: 'boolean'
  },
  
  DATE_BEFORE: {
    type: PrimitiveTypes.TIME,
    id: 'date_before',
    label: 'Date Before',
    description: 'Check if before specific date',
    params: ['date'],
    returns: 'boolean'
  }
};

/**
 * All primitives combined
 */
export const AllPrimitives = {
  ...DataAccessPrimitives,
  ...MathPrimitives,
  ...ComparisonPrimitives,
  ...MemoryPrimitives,
  ...ControlFlowPrimitives,
  ...ActionPrimitives,
  ...AggregationPrimitives,
  ...TimePrimitives
};

/**
 * Helper to create a primitive node
 */
export function createPrimitive(primitiveId, params = {}) {
  const primitive = AllPrimitives[primitiveId.toUpperCase()];
  if (!primitive) {
    throw new Error(`Unknown primitive: ${primitiveId}`);
  }
  
  return {
    type: 'primitive',
    primitiveId: primitive.id,
    primitiveType: primitive.type,
    params: params,
    _primitive: primitive
  };
}

/**
 * Format primitive for display in debugger
 */
export function formatPrimitive(primitive) {
  if (!primitive) return 'null';
  
  if (typeof primitive === 'string') {
    return primitive;
  }
  
  // Handle primitive nodes
  if (primitive.type === 'primitive' || primitive.nodeType === 'primitive') {
    const primitiveId = primitive.primitiveId || primitive.id;
    const params = primitive.params || {};
    
    // Format parameters
    const formatValue = (value) => {
      if (!value) return '';
      
      // Recursively format nested primitives
      if (value.type === 'primitive' || value.nodeType === 'primitive') {
        return formatPrimitive(value);
      }
      
      // Format arrays
      if (Array.isArray(value)) {
        const items = value.map(v => formatValue(v));
        return `[${items.join(', ')}]`;
      }
      
      // Format objects
      if (typeof value === 'object') {
        if (value.operations) {
          // Special case for sequence operations
          return formatValue(value.operations);
        }
        // Other objects
        const entries = Object.entries(value)
          .map(([k, v]) => `${k}: ${formatValue(v)}`)
          .join(', ');
        return `{${entries}}`;
      }
      
      // Primitive values
      return JSON.stringify(value);
    };
    
    // Build parameter string
    const paramEntries = Object.entries(params);
    let paramStr = '';
    
    if (paramEntries.length === 1 && paramEntries[0][0] === 'value') {
      // Single value parameter - show directly
      paramStr = formatValue(paramEntries[0][1]);
    } else if (paramEntries.length > 0) {
      // Multiple parameters - show as key: value
      paramStr = paramEntries
        .map(([key, value]) => {
          const formattedValue = formatValue(value);
          return formattedValue;
        })
        .join(', ');
    }
    
    return `${primitiveId.toUpperCase()}(${paramStr})`;
  }
  
  // Handle sequences
  if (primitive.type === 'sequence' && Array.isArray(primitive.items)) {
    const items = primitive.items.map(item => formatPrimitive(item));
    return `SEQUENCE([${items.join(', ')}])`;
  }
  
  // Handle compositions
  if (primitive.type === 'composition' && Array.isArray(primitive.primitives)) {
    const items = primitive.primitives.map(p => formatPrimitive(p));
    return items.join(' → ');
  }
  
  // Default: return as-is or stringify
  if (typeof primitive === 'object') {
    return JSON.stringify(primitive, null, 2);
  }
  
  return String(primitive);
}

/**
 * Helper to create nested primitive structures
 */
export function compose(...primitives) {
  return {
    type: 'composition',
    primitives: primitives
  };
}

/**
 * Example: Traditional "Memory Coupon" as primitives
 * Instead of a hardcoded "MEMORY" component, it becomes:
 * 
 * IF(
 *   LESS_THAN(WORST_OF(['asset1', 'asset2']), 60),
 *   ACCUMULATE('unpaid_coupons', 8.5),
 *   SEQUENCE([
 *     PAY(ADD(8.5, RETRIEVE('unpaid_coupons', 0))),
 *     RESET('unpaid_coupons')
 *   ])
 * )
 */
export const ExamplePrimitiveStructures = {
  memoryCoupon: {
    description: 'Accumulates coupons when barrier not hit',
    structure: createPrimitive('IF', {
      condition: createPrimitive('LESS_THAN', {
        a: createPrimitive('WORST_OF', { assetIds: ['$ASSETS'] }),
        b: createPrimitive('CONSTANT', { value: 60 })
      }),
      thenBranch: createPrimitive('ACCUMULATE', {
        key: 'unpaid_coupons',
        value: createPrimitive('CONSTANT', { value: 8.5 })
      }),
      elseBranch: createPrimitive('SEQUENCE', {
        operations: [
          createPrimitive('PAY', {
            amount: createPrimitive('ADD', {
              a: createPrimitive('CONSTANT', { value: 8.5 }),
              b: createPrimitive('RETRIEVE', {
                key: 'unpaid_coupons',
                defaultValue: 0
              })
            }),
            description: 'Coupon with memory'
          }),
          createPrimitive('RESET', { key: 'unpaid_coupons' })
        ]
      })
    })
  },
  
  autocallWithMemory: {
    description: 'Autocalls and pays accumulated amounts',
    structure: createPrimitive('IF', {
      condition: createPrimitive('GREATER_OR_EQUAL', {
        a: createPrimitive('WORST_OF', { assetIds: ['$ASSETS'] }),
        b: createPrimitive('CONSTANT', { value: 100 })
      }),
      thenBranch: createPrimitive('SEQUENCE', {
        operations: [
          createPrimitive('PAY', {
            amount: createPrimitive('CONSTANT', { value: 100 }),
            description: 'Principal'
          }),
          createPrimitive('PAY', {
            amount: createPrimitive('RETRIEVE', {
              key: 'unpaid_coupons',
              defaultValue: 0
            }),
            description: 'Accumulated coupons'
          }),
          createPrimitive('TERMINATE')
        ]
      }),
      elseBranch: createPrimitive('CONTINUE')
    })
  }
};