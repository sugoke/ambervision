/**
 * Feature Manifest System for Product Capability Detection
 * 
 * This module provides a self-describing manifest of product capabilities
 * detected from the payoff structure. It enables the report generator to
 * understand what features a product has without any hardcoded product types.
 * 
 * The manifest drives widget selection, table column generation, and chart
 * configuration in a completely generic way.
 */

import { ItemTypes } from './componentTypes.js';

/**
 * Feature Manifest class that describes all product capabilities
 */
export class FeatureManifest {
  constructor() {
    // Observation features
    this.observations = {
      hasObservations: false,
      count: 0,
      frequency: null, // 'daily', 'weekly', 'monthly', 'quarterly', 'annual', 'custom'
      dates: [],
      hasEarlyObservations: false,
      hasFinalObservation: false
    };

    // Payment features
    this.payments = {
      hasCoupons: false,
      couponType: null, // 'fixed', 'variable', 'conditional', 'memory', 'snowball', 'range'
      hasMemoryCoupons: false,
      hasAccumulatingCoupons: false,
      hasConditionalCoupons: false,
      couponFrequency: null,
      couponRate: null,
      paymentDates: []
    };

    // Barrier features
    this.barriers = {
      hasBarriers: false,
      types: [], // Array of barrier types present
      autocall: {
        present: false,
        levels: [],
        stepDown: false,
        stepUp: false
      },
      protection: {
        present: false,
        level: null,
        type: null // 'european', 'american', 'continuous'
      },
      couponBarrier: {
        present: false,
        level: null
      },
      knockIn: {
        present: false,
        level: null,
        monitoring: null // 'continuous', 'discrete'
      },
      knockOut: {
        present: false,
        level: null,
        monitoring: null
      },
      cap: {
        present: false,
        level: null
      },
      floor: {
        present: false,
        level: null
      }
    };

    // Memory and accumulation features
    this.memory = {
      hasMemory: false,
      memoryType: null, // 'coupon', 'autocall', 'phoenix'
      hasPhoenixMemory: false,
      hasSnowball: false,
      maxAccumulation: null
    };

    // Range and accrual features
    this.accrual = {
      hasRangeAccrual: false,
      rangeType: null, // 'single', 'dual', 'corridor'
      accrualFrequency: null, // 'daily', 'period'
      ranges: []
    };

    // Underlying asset features
    this.underlyings = {
      count: 0,
      tickers: [],
      basketType: null, // 'worst-of', 'best-of', 'average', 'individual'
      hasMultipleUnderlyings: false,
      correlationDependence: false
    };

    // Calculation features
    this.calculations = {
      hasFormulas: false,
      hasVariables: false,
      hasComplexLogic: false,
      formulaTypes: [], // Types of formulas detected
      variableNames: []
    };

    // Timing features
    this.timing = {
      hasLifeEvents: false,
      hasMaturityEvents: false,
      hasContinuousMonitoring: false,
      hasDiscreteMonitoring: false,
      monitoringType: null // 'continuous', 'discrete', 'mixed'
    };

    // Continuation features
    this.continuation = {
      canTerminateEarly: false,
      hasAutocall: false,
      hasKnockOut: false,
      hasIssuerCall: false,
      terminationTypes: []
    };

    // Risk features
    this.risk = {
      hasDownsideProtection: false,
      protectionType: null, // 'full', 'partial', 'conditional'
      hasCapitalAtRisk: false,
      maxLoss: null,
      hasLeverage: false,
      leverageFactor: null
    };

    // Metadata
    this.metadata = {
      complexity: null, // 'simple', 'moderate', 'complex'
      productCategory: null, // Detected category based on features
      requiredDataFeeds: [], // What market data is needed
      evaluationFrequency: null, // How often to evaluate
      generatedAt: new Date()
    };
  }

  /**
   * Analyze a payoff structure and populate the manifest
   */
  analyzeStructure(payoffStructure, product = {}) {
    if (!payoffStructure || payoffStructure.length === 0) {
      return this;
    }

    // Flatten all components for analysis
    const components = this.flattenComponents(payoffStructure);
    
    // Analyze each feature category
    this.analyzeObservations(components, product);
    this.analyzePayments(components);
    this.analyzeBarriers(components);
    this.analyzeMemory(components);
    this.analyzeAccrual(components);
    this.analyzeUnderlyings(components, product);
    this.analyzeCalculations(components);
    this.analyzeTiming(components);
    this.analyzeContinuation(components);
    this.analyzeRisk(components);
    
    // Calculate complexity and category
    this.calculateComplexity();
    this.detectProductCategory();
    this.identifyRequiredDataFeeds();
    
    return this;
  }

  /**
   * Flatten nested component structure
   */
  flattenComponents(structure) {
    const components = [];
    
    const flatten = (items) => {
      if (!items) return;
      
      items.forEach(item => {
        components.push(item);
        if (item.children) flatten(item.children);
        if (item.thenBranch) flatten(item.thenBranch);
        if (item.elseBranch) flatten(item.elseBranch);
      });
    };
    
    Object.values(structure).forEach(column => {
      if (Array.isArray(column)) {
        flatten(column);
      } else if (column && typeof column === 'object') {
        Object.values(column).forEach(section => {
          if (Array.isArray(section)) flatten(section);
        });
      }
    });
    
    return components;
  }

  /**
   * Analyze observation features
   */
  analyzeObservations(components, product) {
    const observations = components.filter(c => c.type === ItemTypes.OBSERVATION);
    
    if (observations.length > 0 || (product.observationDates && product.observationDates.length > 0)) {
      this.observations.hasObservations = true;
      this.observations.count = Math.max(
        observations.length,
        product.observationDates?.length || 0
      );
      
      if (product.observationDates) {
        this.observations.dates = product.observationDates;
        this.observations.frequency = this.detectFrequency(product.observationDates);
      }
      
      // Check for early observations (before maturity)
      const hasLifeObservations = observations.some(o => o.column === 'life');
      this.observations.hasEarlyObservations = hasLifeObservations;
      
      // Check for final observation
      const hasMaturityObservations = observations.some(o => o.column === 'maturity');
      this.observations.hasFinalObservation = hasMaturityObservations;
    }
  }

  /**
   * Analyze payment features
   */
  analyzePayments(components) {
    const actions = components.filter(c => c.type === ItemTypes.ACTION);
    const couponActions = actions.filter(a => a.value && a.value.toLowerCase().includes('coupon'));
    
    if (couponActions.length > 0) {
      this.payments.hasCoupons = true;
      
      // Detect coupon type
      const hasMemory = components.some(c => c.type === ItemTypes.MEMORY);
      const hasConditions = couponActions.some(c => {
        // Check if coupon is inside an IF statement
        return components.some(comp => 
          comp.type === ItemTypes.IF && 
          (comp.thenBranch?.includes(c) || comp.elseBranch?.includes(c))
        );
      });
      
      if (hasMemory) {
        this.payments.hasMemoryCoupons = true;
        this.payments.couponType = 'memory';
      } else if (hasConditions) {
        this.payments.hasConditionalCoupons = true;
        this.payments.couponType = 'conditional';
      } else {
        this.payments.couponType = 'fixed';
      }
      
      // Extract coupon rates
      const rates = couponActions.map(c => {
        const match = c.value.match(/[\d.]+/);
        return match ? parseFloat(match[0]) : null;
      }).filter(r => r !== null);
      
      if (rates.length > 0) {
        this.payments.couponRate = rates[0]; // Take first rate as primary
      }
    }
  }

  /**
   * Analyze barrier features
   */
  analyzeBarriers(components) {
    const barriers = components.filter(c => c.type === ItemTypes.BARRIER);
    
    if (barriers.length > 0) {
      this.barriers.hasBarriers = true;
      
      barriers.forEach(barrier => {
        const type = barrier.barrier_type || 'generic';
        const level = parseFloat(barrier.barrier_level || 100);
        
        if (!this.barriers.types.includes(type)) {
          this.barriers.types.push(type);
        }
        
        switch (type) {
          case 'autocall':
            this.barriers.autocall.present = true;
            this.barriers.autocall.levels.push(level);
            break;
          case 'protection':
          case 'capital_protection':
            this.barriers.protection.present = true;
            this.barriers.protection.level = level;
            break;
          case 'coupon':
            this.barriers.couponBarrier.present = true;
            this.barriers.couponBarrier.level = level;
            break;
          case 'knock_in':
            this.barriers.knockIn.present = true;
            this.barriers.knockIn.level = level;
            break;
          case 'knock_out':
            this.barriers.knockOut.present = true;
            this.barriers.knockOut.level = level;
            break;
          case 'cap':
            this.barriers.cap.present = true;
            this.barriers.cap.level = level;
            break;
          case 'floor':
            this.barriers.floor.present = true;
            this.barriers.floor.level = level;
            break;
        }
      });
      
      // Detect step-down/step-up autocall
      if (this.barriers.autocall.levels.length > 1) {
        const levels = this.barriers.autocall.levels;
        const isDecreasing = levels.every((l, i) => i === 0 || l <= levels[i-1]);
        const isIncreasing = levels.every((l, i) => i === 0 || l >= levels[i-1]);
        
        this.barriers.autocall.stepDown = isDecreasing;
        this.barriers.autocall.stepUp = isIncreasing;
      }
    }
  }

  /**
   * Analyze memory features
   */
  analyzeMemory(components) {
    const memoryComponents = components.filter(c => c.type === ItemTypes.MEMORY);
    
    if (memoryComponents.length > 0) {
      this.memory.hasMemory = true;
      
      // Detect memory type based on context
      const hasAutocallMemory = memoryComponents.some(m => 
        components.some(c => c.type === ItemTypes.ACTION && 
                           c.value?.includes('autocall') && 
                           Math.abs(components.indexOf(c) - components.indexOf(m)) < 3)
      );
      
      if (hasAutocallMemory) {
        this.memory.memoryType = 'autocall';
      } else {
        this.memory.memoryType = 'coupon';
      }
      
      // Check for Phoenix memory (memory with step-down autocall)
      if (this.barriers.autocall.stepDown && this.memory.hasMemory) {
        this.memory.hasPhoenixMemory = true;
      }
    }
  }

  /**
   * Analyze accrual features
   */
  analyzeAccrual(components) {
    const rangeComponents = components.filter(c => c.type === ItemTypes.RANGE);
    
    if (rangeComponents.length > 0) {
      this.accrual.hasRangeAccrual = true;
      
      rangeComponents.forEach(range => {
        const min = parseFloat(range.range_min || 0);
        const max = parseFloat(range.range_max || 999);
        
        this.accrual.ranges.push({ min, max });
      });
      
      // Determine range type
      if (this.accrual.ranges.length === 1) {
        this.accrual.rangeType = 'single';
      } else if (this.accrual.ranges.length === 2) {
        this.accrual.rangeType = 'dual';
      } else {
        this.accrual.rangeType = 'corridor';
      }
    }
  }

  /**
   * Analyze underlying assets
   */
  analyzeUnderlyings(components, product) {
    const baskets = components.filter(c => c.type === ItemTypes.BASKET);
    
    // Get underlyings from product or components
    const underlyings = product.underlyings || [];
    
    this.underlyings.count = Math.max(underlyings.length, baskets.length);
    this.underlyings.hasMultipleUnderlyings = this.underlyings.count > 1;
    
    if (underlyings.length > 0) {
      this.underlyings.tickers = underlyings.map(u => u.ticker).filter(t => t);
    }
    
    // Detect basket type from components
    if (baskets.length > 0) {
      const basketTypes = baskets.map(b => b.basket_type).filter(t => t);
      if (basketTypes.length > 0) {
        this.underlyings.basketType = basketTypes[0];
      }
    }
    
    // Check for worst-of/best-of indicators
    const hasWorstOf = components.some(c => 
      c.value?.toLowerCase().includes('worst') || 
      c.basket_type === 'worst-of'
    );
    const hasBestOf = components.some(c => 
      c.value?.toLowerCase().includes('best') || 
      c.basket_type === 'best-of'
    );
    
    if (hasWorstOf) this.underlyings.basketType = 'worst-of';
    if (hasBestOf) this.underlyings.basketType = 'best-of';
  }

  /**
   * Analyze calculation features
   */
  analyzeCalculations(components) {
    const formulas = components.filter(c => c.type === ItemTypes.FORMULA);
    const variables = components.filter(c => c.type === ItemTypes.VARIABLE);
    
    if (formulas.length > 0) {
      this.calculations.hasFormulas = true;
      this.calculations.formulaTypes = [...new Set(formulas.map(f => f.formula_type).filter(t => t))];
    }
    
    if (variables.length > 0) {
      this.calculations.hasVariables = true;
      this.calculations.variableNames = [...new Set(variables.map(v => v.variable_name).filter(n => n))];
    }
    
    // Complex logic detection
    const hasNestedIfs = components.some(c => 
      c.type === ItemTypes.IF && 
      (c.thenBranch?.some(b => b.type === ItemTypes.IF) || 
       c.elseBranch?.some(b => b.type === ItemTypes.IF))
    );
    
    this.calculations.hasComplexLogic = hasNestedIfs || 
                                       (formulas.length > 2) || 
                                       (variables.length > 3);
  }

  /**
   * Analyze timing features
   */
  analyzeTiming(components) {
    const hasLifeComponents = components.some(c => c.column === 'life');
    const hasMaturityComponents = components.some(c => c.column === 'maturity');
    
    this.timing.hasLifeEvents = hasLifeComponents;
    this.timing.hasMaturityEvents = hasMaturityComponents;
    
    // Check monitoring type
    const hasContinuous = components.some(c => 
      c.monitoring === 'continuous' || 
      c.value?.includes('continuous')
    );
    const hasDiscrete = components.some(c => 
      c.monitoring === 'discrete' || 
      c.type === ItemTypes.OBSERVATION
    );
    
    this.timing.hasContinuousMonitoring = hasContinuous;
    this.timing.hasDiscreteMonitoring = hasDiscrete;
    
    if (hasContinuous && hasDiscrete) {
      this.timing.monitoringType = 'mixed';
    } else if (hasContinuous) {
      this.timing.monitoringType = 'continuous';
    } else if (hasDiscrete) {
      this.timing.monitoringType = 'discrete';
    }
  }

  /**
   * Analyze continuation features
   */
  analyzeContinuation(components) {
    const continuations = components.filter(c => c.type === ItemTypes.CONTINUATION);
    const hasTerminate = continuations.some(c => c.value === 'terminate');
    const hasAutocallAction = components.some(c => 
      c.type === ItemTypes.ACTION && c.value?.includes('autocall')
    );
    
    this.continuation.canTerminateEarly = hasTerminate || hasAutocallAction;
    this.continuation.hasAutocall = hasAutocallAction || this.barriers.autocall.present;
    this.continuation.hasKnockOut = this.barriers.knockOut.present;
    
    if (this.continuation.hasAutocall) {
      this.continuation.terminationTypes.push('autocall');
    }
    if (this.continuation.hasKnockOut) {
      this.continuation.terminationTypes.push('knock-out');
    }
  }

  /**
   * Analyze risk features
   */
  analyzeRisk(components) {
    // Check for protection
    if (this.barriers.protection.present) {
      this.risk.hasDownsideProtection = true;
      const protectionLevel = this.barriers.protection.level;
      
      if (protectionLevel === 100) {
        this.risk.protectionType = 'full';
        this.risk.hasCapitalAtRisk = false;
        this.risk.maxLoss = 0;
      } else if (protectionLevel > 0) {
        this.risk.protectionType = 'partial';
        this.risk.hasCapitalAtRisk = true;
        this.risk.maxLoss = 100 - protectionLevel;
      }
    } else {
      this.risk.hasCapitalAtRisk = true;
      this.risk.maxLoss = 100; // Could lose everything
    }
    
    // Check for leverage
    const hasLeverage = components.some(c => 
      c.value?.includes('leverage') || 
      c.leverage_factor > 1
    );
    
    if (hasLeverage) {
      this.risk.hasLeverage = true;
      const leverageComponent = components.find(c => c.leverage_factor);
      if (leverageComponent) {
        this.risk.leverageFactor = leverageComponent.leverage_factor;
      }
    }
  }

  /**
   * Calculate overall complexity
   */
  calculateComplexity() {
    let complexityScore = 0;
    
    // Add complexity points for various features
    if (this.observations.hasObservations) complexityScore += 1;
    if (this.payments.hasMemoryCoupons) complexityScore += 2;
    if (this.barriers.types.length > 2) complexityScore += 2;
    if (this.memory.hasMemory) complexityScore += 2;
    if (this.accrual.hasRangeAccrual) complexityScore += 2;
    if (this.underlyings.hasMultipleUnderlyings) complexityScore += 1;
    if (this.calculations.hasComplexLogic) complexityScore += 3;
    if (this.timing.monitoringType === 'mixed') complexityScore += 1;
    
    // Determine complexity level
    if (complexityScore <= 2) {
      this.metadata.complexity = 'simple';
    } else if (complexityScore <= 5) {
      this.metadata.complexity = 'moderate';
    } else {
      this.metadata.complexity = 'complex';
    }
  }

  /**
   * Detect product category based on features
   */
  detectProductCategory() {
    // Note: This is pattern detection, not hardcoding product types
    // The category is used for reporting suggestions only
    
    if (this.barriers.autocall.present && this.barriers.protection.present) {
      if (this.memory.hasPhoenixMemory) {
        this.metadata.productCategory = 'memory-autocall';
      } else if (this.barriers.autocall.stepDown) {
        this.metadata.productCategory = 'step-down-autocall';
      } else {
        this.metadata.productCategory = 'standard-autocall';
      }
    } else if (this.accrual.hasRangeAccrual) {
      this.metadata.productCategory = 'range-accrual';
    } else if (this.payments.hasCoupons && !this.continuation.canTerminateEarly) {
      this.metadata.productCategory = 'income-product';
    } else if (this.risk.hasDownsideProtection && this.risk.protectionType === 'full') {
      this.metadata.productCategory = 'capital-protected';
    } else {
      this.metadata.productCategory = 'structured-product';
    }
  }

  /**
   * Identify required data feeds
   */
  identifyRequiredDataFeeds() {
    const feeds = [];
    
    // Need underlying prices
    if (this.underlyings.count > 0) {
      feeds.push('spot-prices');
    }
    
    // Need historical prices for continuous monitoring
    if (this.timing.hasContinuousMonitoring) {
      feeds.push('historical-prices');
    }
    
    // Need volatility for probability calculations
    if (this.metadata.complexity !== 'simple') {
      feeds.push('implied-volatility');
    }
    
    // Need interest rates for discounting
    if (this.payments.hasCoupons || this.continuation.canTerminateEarly) {
      feeds.push('interest-rates');
    }
    
    this.metadata.requiredDataFeeds = feeds;
  }

  /**
   * Detect observation frequency from dates
   */
  detectFrequency(dates) {
    if (!dates || dates.length < 2) return 'custom';
    
    const intervals = [];
    for (let i = 1; i < dates.length; i++) {
      const days = Math.round((new Date(dates[i]) - new Date(dates[i-1])) / (1000 * 60 * 60 * 24));
      intervals.push(days);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    
    if (avgInterval <= 1) return 'daily';
    if (avgInterval <= 7) return 'weekly';
    if (avgInterval <= 31) return 'monthly';
    if (avgInterval <= 92) return 'quarterly';
    if (avgInterval <= 183) return 'semi-annual';
    if (avgInterval <= 365) return 'annual';
    
    return 'custom';
  }

  /**
   * Get widget recommendations based on features
   */
  getRecommendedWidgets() {
    const widgets = [];
    
    // Core widgets based on features
    if (this.barriers.autocall.present) {
      widgets.push('AutocallCard');
    }
    
    if (this.barriers.protection.present || this.barriers.knockIn.present) {
      widgets.push('ProtectionMonitorCard');
    }
    
    if (this.payments.hasCoupons) {
      if (this.payments.hasMemoryCoupons) {
        widgets.push('MemoryTrackerCard');
      }
      widgets.push('CouponScheduleCard');
    }
    
    if (this.accrual.hasRangeAccrual) {
      widgets.push('RangeAccrualCard');
    }
    
    if (this.underlyings.hasMultipleUnderlyings) {
      widgets.push('BasketComparisonView');
    }
    
    if (this.calculations.hasFormulas) {
      widgets.push('FormulaCalculatorView');
    }
    
    // Always include payoff diagram for complex products
    if (this.metadata.complexity !== 'simple') {
      widgets.push('PayoffDiagramCard');
    }
    
    return widgets;
  }

  /**
   * Export manifest to JSON
   */
  toJSON() {
    return {
      observations: this.observations,
      payments: this.payments,
      barriers: this.barriers,
      memory: this.memory,
      accrual: this.accrual,
      underlyings: this.underlyings,
      calculations: this.calculations,
      timing: this.timing,
      continuation: this.continuation,
      risk: this.risk,
      metadata: this.metadata,
      recommendedWidgets: this.getRecommendedWidgets()
    };
  }
}