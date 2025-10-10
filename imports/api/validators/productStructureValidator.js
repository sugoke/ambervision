/**
 * Product Structure Validator
 * 
 * Validates payoff structures for completeness, consistency, and correctness
 * both on client and server side. Provides clear error messages to help
 * users fix structural issues before evaluation.
 */

import { ItemTypes, isValidComponentType } from '../componentTypes.js';
import { isValidOperator } from '../operatorMapping.js';
import { isWeekend, isMarketHoliday } from '../../utils/dateUtils.js';

/**
 * Validation result structure
 */
export class ValidationResult {
  constructor() {
    this.isValid = true;
    this.errors = [];
    this.warnings = [];
    this.suggestions = [];
  }
  
  addError(message, component = null, field = null) {
    this.isValid = false;
    this.errors.push({
      message,
      component: component?.id || component?.type || 'unknown',
      field,
      severity: 'error'
    });
  }
  
  addWarning(message, component = null, field = null) {
    this.warnings.push({
      message,
      component: component?.id || component?.type || 'unknown', 
      field,
      severity: 'warning'
    });
  }
  
  addSuggestion(message, component = null) {
    this.suggestions.push({
      message,
      component: component?.id || component?.type || 'unknown',
      severity: 'suggestion'
    });
  }
  
  hasWarnings() {
    return this.warnings.length > 0;
  }
  
  getFormattedErrors() {
    return this.errors.map(e => `${e.component}: ${e.message}`);
  }
  
  getFormattedWarnings() {
    return this.warnings.map(w => `${w.component}: ${w.message}`);
  }
}

/**
 * Product Structure Validator Class
 */
export class ProductStructureValidator {
  constructor() {
    this.validationRules = {
      // Component structure validation
      componentShape: true,
      requiredFields: true,
      operatorValidity: true,
      
      // Logical validation
      scheduleCoherence: true,
      underlyingReferences: true,
      conditionalLogic: true,
      
      // Advanced validation
      circularDependencies: true,
      unreachableComponents: true,
      performanceOptimization: false // Optional
    };
  }
  
  /**
   * Main validation method
   * @param {Object} product - Product to validate
   * @param {Object} options - Validation options
   * @returns {ValidationResult} - Validation results
   */
  validate(product, options = {}) {
    const result = new ValidationResult();
    
    // Basic product validation
    this.validateBasicProduct(product, result);
    
    if (!product.payoffStructure || !Array.isArray(product.payoffStructure)) {
      result.addError('Product must have a valid payoff structure');
      return result;
    }
    
    // Component-level validation
    for (const component of product.payoffStructure) {
      this.validateComponent(component, result);
    }
    
    // Structure-level validation  
    this.validatePayoffStructure(product.payoffStructure, result);
    
    // Schedule validation
    this.validateSchedules(product, result);
    
    // Underlying references validation
    this.validateUnderlyingReferences(product, result);
    
    // Logical coherence validation
    this.validateLogicalCoherence(product.payoffStructure, result);
    
    // Performance recommendations
    if (options.includeOptimizationSuggestions) {
      this.addOptimizationSuggestions(product, result);
    }
    
    return result;
  }
  
  /**
   * Validate basic product fields
   */
  validateBasicProduct(product, result) {
    if (!product.title || !product.title.trim()) {
      result.addError('Product title is required', null, 'title');
    }
    
    if (!product.isin || !product.isin.trim()) {
      result.addError('ISIN is required', null, 'isin');
    } else if (!/^[A-Z]{2}[A-Z0-9]{10}$/.test(product.isin)) {
      result.addWarning('ISIN format may be invalid (expected: 12 characters, starting with 2 letters)', null, 'isin');
    }
    
    if (!product.tradeDate) {
      result.addError('Trade date is required', null, 'tradeDate');
    } else {
      const tradeDate = new Date(product.tradeDate);
      if (isNaN(tradeDate.getTime())) {
        result.addError('Trade date must be a valid date', null, 'tradeDate');
      } else if (tradeDate > new Date()) {
        result.addWarning('Trade date is in the future', null, 'tradeDate');
      }
    }
    
    if (!product.maturityDate && !product.maturity) {
      result.addError('Maturity date is required', null, 'maturityDate');
    } else {
      const maturityDate = new Date(product.maturityDate || product.maturity);
      if (isNaN(maturityDate.getTime())) {
        result.addError('Maturity date must be a valid date', null, 'maturityDate');
      } else if (product.tradeDate && maturityDate <= new Date(product.tradeDate)) {
        result.addError('Maturity date must be after trade date', null, 'maturityDate');
      }
    }
  }
  
  /**
   * Validate individual component
   */
  validateComponent(component, result) {
    // Check component shape
    if (!component || typeof component !== 'object') {
      result.addError('Component must be a valid object', component);
      return;
    }
    
    // Check required fields
    if (!component.type) {
      result.addError('Component type is required', component, 'type');
      return;
    }
    
    // Check component type validity
    if (!isValidComponentType(component.type)) {
      result.addError(`Invalid component type: ${component.type}`, component, 'type');
      return;
    }
    
    // Check component-specific fields
    this.validateComponentFields(component, result);
    
    // Check operators if present
    if (component.operator && !isValidOperator(component.operator)) {
      result.addError(`Invalid operator: ${component.operator}`, component, 'operator');
    }
    
    // Check references
    this.validateComponentReferences(component, result);
  }
  
  /**
   * Validate component-specific fields
   */
  validateComponentFields(component, result) {
    switch (component.type) {
      case ItemTypes.BARRIER:
        this.validateBarrierComponent(component, result);
        break;
        
      case ItemTypes.OBSERVATION:
        this.validateObservationComponent(component, result);
        break;
        
      case ItemTypes.COMPARISON:
        this.validateComparisonComponent(component, result);
        break;
        
      case ItemTypes.BASKET:
        this.validateBasketComponent(component, result);
        break;
        
      case ItemTypes.ACTION:
        this.validateActionComponent(component, result);
        break;
        
      case ItemTypes.IF:
      case ItemTypes.ELSE:
        this.validateLogicComponent(component, result);
        break;
        
      case ItemTypes.COUPON:
        this.validateCouponComponent(component, result);
        break;
        
      case ItemTypes.MEMORY:
        this.validateMemoryComponent(component, result);
        break;
    }
  }
  
  /**
   * Validate barrier component
   */
  validateBarrierComponent(component, result) {
    if (!component.value && component.value !== 0) {
      result.addError('Barrier component must have a value', component, 'value');
    } else if (typeof component.value === 'string') {
      const numValue = parseFloat(component.value);
      if (isNaN(numValue)) {
        result.addError('Barrier value must be numeric', component, 'value');
      } else if (numValue < 0) {
        result.addWarning('Negative barrier value may be unusual', component, 'value');
      } else if (numValue > 200) {
        result.addWarning('Barrier value above 200% may be unusual', component, 'value');
      }
    }
    
    if (component.barrier_type) {
      const validTypes = ['protection', 'autocall', 'coupon', 'knockout', 'knockin'];
      if (!validTypes.includes(component.barrier_type)) {
        result.addWarning(`Unusual barrier type: ${component.barrier_type}`, component, 'barrier_type');
      }
    }
  }
  
  /**
   * Validate observation component
   */
  validateObservationComponent(component, result) {
    if (component.date) {
      const obsDate = new Date(component.date);
      if (isNaN(obsDate.getTime())) {
        result.addError('Observation date must be valid', component, 'date');
      } else {
        // Check if observation date falls on weekend/holiday
        if (isWeekend(obsDate)) {
          result.addWarning('Observation date falls on weekend', component, 'date');
        }
        
        // Basic holiday check for major markets
        if (isMarketHoliday(obsDate, ['US'])) {
          result.addWarning('Observation date may be a market holiday', component, 'date');
        }
      }
    }
    
    if (component.frequency) {
      const validFrequencies = ['daily', 'weekly', 'monthly', 'quarterly', 'semi-annual', 'annual'];
      if (!validFrequencies.includes(component.frequency.toLowerCase())) {
        result.addWarning(`Unusual observation frequency: ${component.frequency}`, component, 'frequency');
      }
    }
  }
  
  /**
   * Validate comparison component
   */
  validateComparisonComponent(component, result) {
    if (!component.operator && !component.comparisonType && !component.label) {
      result.addError('Comparison component must have an operator, comparisonType, or label', component);
    }
    
    if (component.threshold !== undefined) {
      const threshold = parseFloat(component.threshold);
      if (isNaN(threshold)) {
        result.addError('Comparison threshold must be numeric', component, 'threshold');
      }
    }
  }
  
  /**
   * Validate basket component
   */
  validateBasketComponent(component, result) {
    if (!component.symbol && !component.underlying && !component.ticker) {
      result.addError('Basket component must reference an underlying asset', component);
    }
    
    if (component.weight !== undefined) {
      const weight = parseFloat(component.weight);
      if (isNaN(weight)) {
        result.addError('Basket weight must be numeric', component, 'weight');
      } else if (weight < 0) {
        result.addWarning('Negative basket weight may be unusual', component, 'weight');
      } else if (weight > 1) {
        result.addWarning('Basket weight above 100% may be unusual', component, 'weight');
      }
    }
  }
  
  /**
   * Validate action component
   */
  validateActionComponent(component, result) {
    if (!component.value && !component.label) {
      result.addError('Action component must have a value or label', component);
    }
    
    if (component.value && typeof component.value === 'string') {
      // Check for common action patterns
      if (component.value.includes('autocall') && !component.value.includes('%')) {
        result.addSuggestion('Autocall actions typically specify a percentage', component);
      }
      
      if (component.value.includes('coupon') && !component.value.includes('%')) {
        result.addSuggestion('Coupon actions typically specify a percentage', component);
      }
    }
  }
  
  /**
   * Validate logic component (IF/ELSE)
   */
  validateLogicComponent(component, result) {
    if (component.type === ItemTypes.IF && !component.condition && !component.label) {
      result.addError('IF component should have a condition or descriptive label', component);
    }
  }
  
  /**
   * Validate coupon component
   */
  validateCouponComponent(component, result) {
    if (component.rate !== undefined) {
      const rate = parseFloat(component.rate);
      if (isNaN(rate)) {
        result.addError('Coupon rate must be numeric', component, 'rate');
      } else if (rate < 0) {
        result.addWarning('Negative coupon rate may be unusual', component, 'rate');
      } else if (rate > 50) {
        result.addWarning('Coupon rate above 50% may be unusual', component, 'rate');
      }
    }
  }
  
  /**
   * Validate memory component
   */
  validateMemoryComponent(component, result) {
    if (!component.bucketName && !component.variable) {
      result.addError('Memory component must specify a bucket name or variable', component);
    }
  }
  
  /**
   * Validate component references
   */
  validateComponentReferences(component, result) {
    // Check for invalid or circular references
    if (component.dependsOn) {
      if (Array.isArray(component.dependsOn)) {
        for (const dep of component.dependsOn) {
          if (dep === component.id) {
            result.addError('Component cannot depend on itself', component, 'dependsOn');
          }
        }
      }
    }
  }
  
  /**
   * Validate overall payoff structure
   */
  validatePayoffStructure(payoffStructure, result) {
    const componentsBySection = this.groupComponentsBySection(payoffStructure);
    
    // Check for empty sections
    if (componentsBySection.life.length === 0 && componentsBySection.maturity.length === 0) {
      result.addError('Product must have components in life or maturity section');
    }
    
    // Check for balanced IF/ELSE statements
    this.validateConditionalBalance(payoffStructure, result);
    
    // Check for unreachable components
    this.validateReachability(payoffStructure, result);
  }
  
  /**
   * Validate schedules coherence
   */
  validateSchedules(product, result) {
    if (product.observationSchedule && Array.isArray(product.observationSchedule)) {
      const schedule = product.observationSchedule;
      
      // Check dates are in chronological order
      for (let i = 1; i < schedule.length; i++) {
        const prevDate = new Date(schedule[i-1].date);
        const currDate = new Date(schedule[i].date);
        
        if (currDate <= prevDate) {
          result.addWarning(`Observation dates may not be in chronological order: ${schedule[i-1].date} → ${schedule[i].date}`);
        }
      }
      
      // Check first observation is after trade date
      if (schedule.length > 0 && product.tradeDate) {
        const firstObs = new Date(schedule[0].date);
        const tradeDate = new Date(product.tradeDate);
        
        if (firstObs <= tradeDate) {
          result.addWarning('First observation date should be after trade date');
        }
      }
      
      // STRICT RULE: NEVER observations after final or maturity date
      if (schedule.length > 0 && (product.maturityDate || product.maturity)) {
        const maturityDate = new Date(product.maturityDate || product.maturity);
        
        // Check ALL observation dates - none should be after maturity
        for (let i = 0; i < schedule.length; i++) {
          const obsDate = new Date(schedule[i].date);
          if (obsDate > maturityDate) {
            result.addError(`Observation date ${schedule[i].date} cannot be after maturity date ${product.maturityDate || product.maturity}`);
          }
        }
        
        // Additional check for chronological order within observations
        for (let i = 1; i < schedule.length; i++) {
          const prevObs = new Date(schedule[i-1].date);
          const currObs = new Date(schedule[i].date);
          if (currObs <= prevObs) {
            result.addError(`Observation dates must be in chronological order: ${schedule[i-1].date} → ${schedule[i].date}`);
          }
        }
      }
    }
  }
  
  /**
   * Validate underlying references
   */
  validateUnderlyingReferences(product, result) {
    const referencedUnderlyings = new Set();
    const availableUnderlyings = new Set();
    
    // Collect available underlyings
    if (product.underlyings && Array.isArray(product.underlyings)) {
      for (const underlying of product.underlyings) {
        if (underlying.symbol) availableUnderlyings.add(underlying.symbol);
        if (underlying.ticker) availableUnderlyings.add(underlying.ticker);
      }
    }
    
    // Collect referenced underlyings
    for (const component of product.payoffStructure) {
      if (component.symbol) referencedUnderlyings.add(component.symbol);
      if (component.ticker) referencedUnderlyings.add(component.ticker);
      if (component.underlying) referencedUnderlyings.add(component.underlying);
    }
    
    // Check for missing references
    for (const ref of referencedUnderlyings) {
      if (!availableUnderlyings.has(ref)) {
        result.addWarning(`Referenced underlying '${ref}' not found in underlyings list`);
      }
    }
    
    // Check for unused underlyings
    for (const available of availableUnderlyings) {
      if (!referencedUnderlyings.has(available)) {
        result.addSuggestion(`Underlying '${available}' is defined but not used in payoff structure`);
      }
    }
  }
  
  /**
   * Validate logical coherence
   */
  validateLogicalCoherence(payoffStructure, result) {
    // Check for orphaned conditions
    const conditions = payoffStructure.filter(c => c.type === ItemTypes.COMPARISON || c.type === ItemTypes.CONDITION);
    const actions = payoffStructure.filter(c => c.type === ItemTypes.ACTION);
    
    if (conditions.length > 0 && actions.length === 0) {
      result.addWarning('Product has conditions but no actions - may not produce any results');
    }
    
    // Check for actions without conditions
    const ifStatements = payoffStructure.filter(c => c.type === ItemTypes.IF);
    if (actions.length > 0 && conditions.length === 0 && ifStatements.length === 0) {
      result.addSuggestion('Product has actions but no conditions - actions will always execute');
    }
  }
  
  /**
   * Helper methods
   */
  
  groupComponentsBySection(payoffStructure) {
    return {
      life: payoffStructure.filter(c => c.section === 'life'),
      maturity: payoffStructure.filter(c => c.section === 'maturity'),
      setup: payoffStructure.filter(c => c.section === 'setup')
    };
  }
  
  validateConditionalBalance(payoffStructure, result) {
    // Count IF and ELSE statements  
    const ifCount = payoffStructure.filter(c => c.type === ItemTypes.IF).length;
    const elseCount = payoffStructure.filter(c => c.type === ItemTypes.ELSE).length;
    
    if (ifCount > 0 && elseCount === 0) {
      result.addSuggestion('Consider adding ELSE statements to handle cases when IF conditions are not met');
    }
  }
  
  validateReachability(payoffStructure, result) {
    // Basic reachability check - more sophisticated analysis could be added
    const hasUnreachableCode = false; // Placeholder for future implementation
    
    if (hasUnreachableCode) {
      result.addWarning('Some components may be unreachable based on conditional logic');
    }
  }
  
  addOptimizationSuggestions(product, result) {
    const componentCount = product.payoffStructure.length;
    
    if (componentCount > 20) {
      result.addSuggestion('Product has many components - consider simplifying for better performance');
    }
    
    const memoryComponents = product.payoffStructure.filter(c => c.type === ItemTypes.MEMORY).length;
    if (memoryComponents > 5) {
      result.addSuggestion('Many memory components detected - ensure they are necessary for performance');
    }
  }
}

// Global validator instance
export const globalProductValidator = new ProductStructureValidator();