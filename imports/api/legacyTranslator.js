/**
 * Legacy Component Translator
 * 
 * Translates existing drag-and-drop components to mathematical primitive compositions.
 * This allows backward compatibility while migrating to the new primitive-based system.
 */

import { createPrimitive, compose } from './mathematicalPrimitives.js';
import { ItemTypes } from './componentTypes.js';

/**
 * Main translation function
 */
export function translateLegacyComponent(component, context = {}) {
  const translator = componentTranslators[component.type];
  
  if (!translator) {
    console.warn(`No translator for component type: ${component.type}`);
    return null;
  }
  
  try {
    const primitive = translator(component, context);
    console.log(`[TRANSLATOR] Translated ${component.type} "${component.label}" to primitives`);
    return primitive;
  } catch (error) {
    console.error(`[TRANSLATOR] Failed to translate ${component.type}:`, error);
    return null;
  }
}

/**
 * Translate an entire payoff structure
 */
export function translatePayoffStructure(payoffStructure) {
  if (!Array.isArray(payoffStructure)) {
    return [];
  }
  
  return payoffStructure.map(component => ({
    ...component,
    _primitive: translateLegacyComponent(component)
  }));
}

/**
 * Component-specific translators
 */
const componentTranslators = {
  // ============ TIMING COMPONENTS ============
  
  [ItemTypes.OBSERVATION]: (component) => {
    // "At Maturity" check
    if (component.label === 'At Maturity') {
      return createPrimitive('IS_MATURITY');
    }
    
    // Regular observation date check
    return createPrimitive('IS_OBSERVATION_DATE');
  },
  
  [ItemTypes.TIMING]: (component) => {
    if (component.label === 'At Maturity') {
      return createPrimitive('IS_MATURITY');
    } else if (component.label === 'During Life') {
      return createPrimitive('NOT', {
        a: createPrimitive('IS_MATURITY')
      });
    }
    
    // Default: always true
    return createPrimitive('CONSTANT', { value: 1 });
  },
  
  // ============ CONDITION COMPONENTS ============
  
  [ItemTypes.BASKET]: (component, context) => {
    const basketType = (component.basketType || component.value || component.label || 'worst-of')
      .toLowerCase().replace(/[^a-z]/g, '');
    
    // Get actual asset IDs from context if available
    const assetIds = context?.assetIds || ['$ASSETS'];
    
    switch (basketType) {
      case 'worstof':
      case 'worst':
      case 'min':
        return createPrimitive('WORST_OF', { assetIds });
        
      case 'bestof':
      case 'best':
      case 'max':
        return createPrimitive('BEST_OF', { assetIds });
        
      case 'average':
      case 'equallyweighted':
      case 'mean':
        return createPrimitive('AVERAGE_OF', { assetIds });
        
      default:
        return createPrimitive('WORST_OF', { assetIds });
    }
  },
  
  [ItemTypes.BARRIER]: (component) => {
    // Barriers just return their value as a constant
    const value = parseFloat(component.value || component.defaultValue || '100');
    return createPrimitive('CONSTANT', { value });
  },
  
  [ItemTypes.COMPARISON]: (component, context) => {
    // Determine operator from label or operator field
    let operator = component.operator || component.comparisonType;
    
    // If no operator, infer from label
    if (!operator && component.label) {
      if (component.label.includes('At or Above')) operator = '>=';
      else if (component.label.includes('Above')) operator = '>';
      else if (component.label.includes('At or Below')) operator = '<=';
      else if (component.label.includes('Below')) operator = '<';
      else if (component.label.includes('Equal')) operator = '==';
      else operator = '>='; // Default
    }
    
    let primitiveOp = 'GREATER_OR_EQUAL';
    switch (operator) {
      case '>': primitiveOp = 'GREATER_THAN'; break;
      case '>=': primitiveOp = 'GREATER_OR_EQUAL'; break;
      case '<': primitiveOp = 'LESS_THAN'; break;
      case '<=': primitiveOp = 'LESS_OR_EQUAL'; break;
      case '==': primitiveOp = 'EQUAL'; break;
      case '!=': primitiveOp = 'NOT_EQUAL'; break;
    }
    
    // For comparison, we need the left operand (usually basket) and right operand (usually barrier)
    // These should be provided by the context from adjacent components
    const leftOperand = context.leftOperand || createPrimitive('WORST_OF', { assetIds: context.assetIds || ['$ASSETS'] });
    const rightOperand = context.rightOperand || createPrimitive('CONSTANT', { value: 100 });
    
    return createPrimitive(primitiveOp, {
      a: leftOperand,
      b: rightOperand
    });
  },
  
  // ============ ACTION COMPONENTS ============
  
  [ItemTypes.ACTION]: (component) => {
    // Determine action type from label/value
    const label = component.label || '';
    
    if (label.includes('Return 100%')) {
      return createPrimitive('PAY', {
        amount: createPrimitive('CONSTANT', { value: 100 }),
        description: 'Principal Return'
      });
    }
    
    if (label.includes('Downside')) {
      return createPrimitive('PAY', {
        amount: createPrimitive('WORST_OF', { assetIds: ['$ASSETS'] }),
        description: 'Downside Exposure'
      });
    }
    
    if (label.includes('Coupon')) {
      const couponRate = parseFloat(component.value || component.defaultValue || '0');
      return createPrimitive('PAY', {
        amount: createPrimitive('CONSTANT', { value: couponRate }),
        description: 'Coupon'
      });
    }
    
    if (label.includes('Early Redemption') || label.includes('Autocall')) {
      return compose(
        createPrimitive('PAY', {
          amount: createPrimitive('CONSTANT', { value: 100 }),
          description: 'Early Redemption'
        }),
        createPrimitive('TERMINATE')
      );
    }
    
    // Default payment
    const amount = parseFloat(component.value || '0');
    return createPrimitive('PAY', {
      amount: createPrimitive('CONSTANT', { value: amount }),
      description: component.label
    });
  },
  
  [ItemTypes.COUPON]: (component) => {
    const couponRate = parseFloat(component.value || component.defaultValue || '0');
    return createPrimitive('PAY', {
      amount: createPrimitive('CONSTANT', { value: couponRate }),
      description: 'Coupon'
    });
  },
  
  [ItemTypes.AUTOCALL]: (component) => {
    const amount = parseFloat(component.value || '100');
    return compose(
      createPrimitive('PAY', {
        amount: createPrimitive('CONSTANT', { value: amount }),
        description: 'Autocall'
      }),
      createPrimitive('TERMINATE')
    );
  },
  
  // ============ MEMORY COMPONENTS ============
  
  [ItemTypes.MEMORY]: (component) => {
    // Memory coupon: accumulate value
    const couponRate = parseFloat(component.value || component.defaultValue || '0');
    return createPrimitive('ACCUMULATE', {
      key: 'unpaid_coupons',
      value: createPrimitive('CONSTANT', { value: couponRate })
    });
  },
  
  
  // ============ LOGIC OPERATORS ============
  
  [ItemTypes.LOGIC_OPERATOR]: (component) => {
    // Logic operators don't translate directly - they're handled by structure
    return createPrimitive('CONSTANT', { value: 1 });
  },
  
  // ============ CONTINUATION ============
  
  [ItemTypes.CONTINUATION]: (component) => {
    if (component.label === 'Product Ends') {
      return createPrimitive('TERMINATE');
    } else {
      return createPrimitive('CONTINUE');
    }
  }
};

/**
 * Translate a complete logic node (row with timing, condition, action)
 */
export function translateLogicNode(node, productContext = {}) {
  // Extract asset IDs from product context
  const assetIds = productContext.underlyings?.map(u => u.symbol || u.ticker) || ['$ASSETS'];
  const context = { assetIds, ...productContext };
  
  // Analyze the node structure to build proper context
  const components = [
    ...(node.timing || []),
    ...(node.condition || []),
    ...(node.action || []),
    ...(node.continuation || [])
  ];
  
  // Find basket and barrier components to build comparison context
  const basketComponent = components.find(c => c.type === ItemTypes.BASKET);
  const barrierComponent = components.find(c => c.type === ItemTypes.BARRIER);
  const comparisonComponent = components.find(c => c.type === ItemTypes.COMPARISON);
  
  // Build context for comparison
  if (comparisonComponent) {
    if (basketComponent) {
      context.leftOperand = translateLegacyComponent(basketComponent, context);
    }
    if (barrierComponent) {
      context.rightOperand = translateLegacyComponent(barrierComponent, context);
    }
  }
  
  // Now translate the node structure
  const primitives = [];
  
  // Translate timing conditions
  if (node.timing && node.timing.length > 0) {
    const timingPrimitives = node.timing
      .map(t => translateLegacyComponent(t, context))
      .filter(p => p !== null);
    
    if (timingPrimitives.length > 0) {
      // All timing conditions must be true
      if (timingPrimitives.length === 1) {
        primitives.push(timingPrimitives[0]);
      } else {
        primitives.push(
          timingPrimitives.reduce((acc, prim) => 
            createPrimitive('AND', { a: acc, b: prim })
          )
        );
      }
    }
  }
  
  // Handle IF/ELSE logic
  if (node.logicOperator) {
    const conditionPrimitives = (node.condition || [])
      .map(c => translateLegacyComponent(c, context))
      .filter(p => p !== null);
    
    const actionPrimitives = (node.action || [])
      .map(a => translateLegacyComponent(a, context))
      .filter(p => p !== null);
    
    // Add continuation to actions if present
    const continuationPrimitives = (node.continuation || [])
      .map(c => translateLegacyComponent(c, context))
      .filter(p => p !== null);
    
    if (continuationPrimitives.length > 0) {
      actionPrimitives.push(...continuationPrimitives);
    }
    
    // Combine conditions - for comparison + barrier pattern, we need special handling
    let combinedCondition = null;
    
    // Check if we have the basket -> comparison -> barrier pattern
    if (comparisonComponent && (basketComponent || barrierComponent)) {
      // The comparison already includes the basket and barrier logic
      combinedCondition = context.leftOperand && context.rightOperand ? 
        translateLegacyComponent(comparisonComponent, context) : null;
    } else if (conditionPrimitives.length === 1) {
      combinedCondition = conditionPrimitives[0];
    } else if (conditionPrimitives.length > 1) {
      combinedCondition = conditionPrimitives.reduce((acc, prim) => 
        createPrimitive('AND', { a: acc, b: prim })
      );
    }
    
    // Combine actions in sequence
    let combinedAction = null;
    if (actionPrimitives.length === 1) {
      combinedAction = actionPrimitives[0];
    } else if (actionPrimitives.length > 1) {
      combinedAction = createPrimitive('SEQUENCE', {
        operations: actionPrimitives
      });
    }
    
    if (combinedCondition && combinedAction) {
      // Check if we have timing conditions to wrap around
      const timingCondition = primitives.length > 0 ? primitives[0] : null;
      
      const ifPrimitive = createPrimitive('IF', {
        condition: combinedCondition,
        thenBranch: combinedAction
      });
      
      if (timingCondition) {
        return createPrimitive('IF', {
          condition: timingCondition,
          thenBranch: ifPrimitive
        });
      }
      
      return ifPrimitive;
    }
  }
  
  // Simple node without logic operators
  const allPrimitives = [
    ...(node.timing || []).map(t => translateLegacyComponent(t, context)),
    ...(node.condition || []).map(c => translateLegacyComponent(c, context)),
    ...(node.action || []).map(a => translateLegacyComponent(a, context)),
    ...(node.continuation || []).map(c => translateLegacyComponent(c, context))
  ].filter(p => p !== null);
  
  if (allPrimitives.length === 0) {
    return null;
  } else if (allPrimitives.length === 1) {
    return allPrimitives[0];
  } else {
    return createPrimitive('SEQUENCE', {
      operations: allPrimitives
    });
  }
}

/**
 * Example translations for common patterns
 */
export const CommonPatternTranslations = {
  // Memory coupon pattern
  memoryCouponLogic: (couponRate = 8.5, barrierLevel = 60) => {
    return createPrimitive('IF', {
      condition: createPrimitive('LESS_THAN', {
        a: createPrimitive('WORST_OF', { assetIds: ['$ASSETS'] }),
        b: createPrimitive('CONSTANT', { value: barrierLevel })
      }),
      thenBranch: createPrimitive('ACCUMULATE', {
        key: 'unpaid_coupons',
        value: createPrimitive('CONSTANT', { value: couponRate })
      }),
      elseBranch: createPrimitive('SEQUENCE', {
        operations: [
          createPrimitive('PAY', {
            amount: createPrimitive('ADD', {
              a: createPrimitive('CONSTANT', { value: couponRate }),
              b: createPrimitive('RETRIEVE', {
                key: 'unpaid_coupons',
                defaultValue: 0
              })
            }),
            description: 'Coupon with Memory'
          }),
          createPrimitive('RESET', { key: 'unpaid_coupons' })
        ]
      })
    });
  },
  
  // Autocall pattern
  autocallLogic: (autocallLevel = 100) => {
    return createPrimitive('IF', {
      condition: createPrimitive('GREATER_OR_EQUAL', {
        a: createPrimitive('WORST_OF', { assetIds: ['$ASSETS'] }),
        b: createPrimitive('CONSTANT', { value: autocallLevel })
      }),
      thenBranch: createPrimitive('SEQUENCE', {
        operations: [
          createPrimitive('PAY', {
            amount: createPrimitive('CONSTANT', { value: 100 }),
            description: 'Autocall Principal'
          }),
          createPrimitive('PAY', {
            amount: createPrimitive('RETRIEVE', {
              key: 'unpaid_coupons',
              defaultValue: 0
            }),
            description: 'Accumulated Coupons'
          }),
          createPrimitive('TERMINATE')
        ]
      }),
      elseBranch: createPrimitive('CONTINUE')
    });
  },
  
  // Protection at maturity pattern
  protectionAtMaturity: (protectionLevel = 60) => {
    return createPrimitive('IF', {
      condition: createPrimitive('GREATER_OR_EQUAL', {
        a: createPrimitive('WORST_OF', { assetIds: ['$ASSETS'] }),
        b: createPrimitive('CONSTANT', { value: protectionLevel })
      }),
      thenBranch: createPrimitive('PAY', {
        amount: createPrimitive('CONSTANT', { value: 100 }),
        description: 'Protected Return'
      }),
      elseBranch: createPrimitive('PAY', {
        amount: createPrimitive('WORST_OF', { assetIds: ['$ASSETS'] }),
        description: 'Downside Exposure'
      })
    });
  }
};