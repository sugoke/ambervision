// Basket Type Definitions and Constants

export const BASKET_TYPES = {
  INDIVIDUAL_SECURITIES: 'individual_securities',
  WORST_OF: 'worst_of',
  BEST_OF: 'best_of',
  AVERAGE_PERFORMANCE: 'average_performance',
  CUSTOM_LOGIC: 'custom_logic',
  MATHEMATICAL: 'mathematical'
};

export const CALCULATION_METHODS = {
  WEIGHTED_AVERAGE: 'weighted_average',
  EQUAL_WEIGHTED: 'equal_weighted',
  WORST_PERFORMER: 'worst_performer',
  BEST_PERFORMER: 'best_performer',
  CUSTOM_FORMULA: 'custom_formula'
};

export const PERFORMANCE_REFERENCES = {
  INITIAL_FIXING: 'initial_fixing',
  TRADE_DATE: 'trade_date',
  CUSTOM_DATE: 'custom_date'
};

// Basket configuration templates
export const DEFAULT_BASKET_CONFIG = {
  id: null,
  name: '',
  type: BASKET_TYPES.INDIVIDUAL_SECURITIES,
  description: '',
  securities: [],
  calculationMethod: CALCULATION_METHODS.WEIGHTED_AVERAGE,
  performanceReference: PERFORMANCE_REFERENCES.INITIAL_FIXING,
  customFormula: '',
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date()
};

// Predefined basket type configurations
export const BASKET_TYPE_CONFIGS = {
  [BASKET_TYPES.INDIVIDUAL_SECURITIES]: {
    label: '📊 Individual Securities',
    description: 'Traditional basket of individual securities with custom weights',
    allowCustomWeights: true,
    allowCustomFormula: false,
    defaultCalculation: CALCULATION_METHODS.WEIGHTED_AVERAGE,
    icon: '📊'
  },
  [BASKET_TYPES.WORST_OF]: {
    label: '📉 Worst Performing',
    description: 'Automatically tracks the worst performing security from the selection',
    allowCustomWeights: false,
    allowCustomFormula: false,
    defaultCalculation: CALCULATION_METHODS.WORST_PERFORMER,
    icon: '📉'
  },
  [BASKET_TYPES.BEST_OF]: {
    label: '📈 Best Performing',
    description: 'Automatically tracks the best performing security from the selection',
    allowCustomWeights: false,
    allowCustomFormula: false,
    defaultCalculation: CALCULATION_METHODS.BEST_PERFORMER,
    icon: '📈'
  },
  [BASKET_TYPES.AVERAGE_PERFORMANCE]: {
    label: '📊 Average Performance',
    description: 'Weighted or equal-weighted average performance of all securities',
    allowCustomWeights: true,
    allowCustomFormula: false,
    defaultCalculation: CALCULATION_METHODS.WEIGHTED_AVERAGE,
    icon: '📊'
  },
  [BASKET_TYPES.MATHEMATICAL]: {
    label: '🧮 Mathematical Expression',
    description: 'Custom mathematical formula combining securities and other baskets',
    allowCustomWeights: true,
    allowCustomFormula: true,
    defaultCalculation: CALCULATION_METHODS.CUSTOM_FORMULA,
    icon: '🧮'
  }
};

// Helper functions for basket management
export const BasketHelpers = {
  // Create a new basket with default values
  createBasket: (name, type = BASKET_TYPES.INDIVIDUAL_SECURITIES) => {
    const typeConfig = BASKET_TYPE_CONFIGS[type];
    return {
      ...DEFAULT_BASKET_CONFIG,
      id: `basket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name,
      type,
      calculationMethod: typeConfig.defaultCalculation,
      ...typeConfig
    };
  },

  // Validate basket configuration
  validateBasket: (basket) => {
    const errors = [];
    
    if (!basket.name || basket.name.trim() === '') {
      errors.push('Basket name is required');
    }
    
    if (!basket.securities || basket.securities.length === 0) {
      errors.push('At least one security is required');
    }
    
    if (basket.type === BASKET_TYPES.MATHEMATICAL && !basket.customFormula) {
      errors.push('Custom formula is required for mathematical baskets');
    }
    
    // Validate weights for weighted baskets
    if (basket.calculationMethod === CALCULATION_METHODS.WEIGHTED_AVERAGE) {
      const totalWeight = basket.securities.reduce((sum, sec) => sum + (sec.weight || 0), 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        errors.push('Weights must total 100%');
      }
    }
    
    return errors;
  },

  // Get basket type configuration
  getBasketConfig: (type) => BASKET_TYPE_CONFIGS[type] || BASKET_TYPE_CONFIGS[BASKET_TYPES.INDIVIDUAL_SECURITIES],

  // Calculate basket performance (placeholder - will be implemented in evaluation engine)
  calculatePerformance: (basket, marketData, referenceDate) => {
    // This will be implemented in the generic evaluation engine
    console.log('Calculating performance for basket:', basket.name);
    return 0; // Placeholder
  },

  // Generate basket summary for display
  generateSummary: (basket) => {
    const config = BasketHelpers.getBasketConfig(basket.type);
    return {
      name: basket.name,
      type: config.label,
      icon: config.icon,
      securityCount: basket.securities?.length || 0,
      description: basket.description || config.description,
      calculationMethod: basket.calculationMethod
    };
  }
};