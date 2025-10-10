/**
 * ProductTypeAnalyzer - Analyzes product structures to determine their characteristics
 * and recommend appropriate views and charts for the report
 * 
 * This analyzer works generically without product-specific names, identifying
 * features based on the components and their relationships. Enhanced to work with
 * compiled structures and execution context for more accurate feature detection.
 */

import { ItemTypes } from './componentTypes.js';
import { globalWidgetRegistry } from '../ui/components/widgets/registry.js';

export class ProductTypeAnalyzer {
  constructor() {
    this.viewRegistry = {
      terminationAnalysis: { 
        label: 'Early Termination Analysis', 
        icon: '🎯',
        component: 'TerminationView' 
      },
      paymentSchedule: { 
        label: 'Payment Schedule', 
        icon: '💰',
        component: 'PaymentScheduleView' 
      },
      protectionMonitor: { 
        label: 'Protection Monitor', 
        icon: '🛡️',
        component: 'ProtectionMonitorView' 
      },
      payoffDiagram: { 
        label: 'Payoff Diagram', 
        icon: '📊',
        component: 'PayoffDiagramView' 
      },
      scenarioAnalysis: { 
        label: 'Scenario Analysis', 
        icon: '🎲',
        component: 'ScenarioAnalysisView' 
      },
      rangeTracking: {
        label: 'Range Tracking',
        icon: '📏',
        component: 'RangeTrackingView'
      },
      formulaCalculator: {
        label: 'Formula Calculator',
        icon: '🧮',
        component: 'FormulaCalculatorView'
      },
      basketComparison: {
        label: 'Basket Comparison',
        icon: '⚖️',
        component: 'BasketComparisonView'
      },
      variableTracker: {
        label: 'Variable Tracker',
        icon: '📝',
        component: 'VariableTrackerView'
      },
      differentialAnalysis: {
        label: 'Differential Analysis',
        icon: '📈',
        component: 'DifferentialAnalysisView'
      }
    };

    this.chartRegistry = {
      performanceLine: { 
        label: 'Performance Chart', 
        type: 'line' 
      },
      payoffDiagram: { 
        label: 'Payoff at Maturity', 
        type: 'payoff' 
      },
      protectionDistance: { 
        label: 'Protection Distance', 
        type: 'protection' 
      },
      paymentCalendar: { 
        label: 'Payment Calendar', 
        type: 'calendar' 
      },
      probabilityCone: { 
        label: 'Probability Analysis', 
        type: 'probability' 
      },
      scenarioWaterfall: { 
        label: 'Scenario Outcomes', 
        type: 'waterfall' 
      },
      basketDifferential: {
        label: 'Basket Differential',
        type: 'differential'
      },
      formulaEvolution: {
        label: 'Formula Evolution',
        type: 'formula'
      },
      variableHeatmap: {
        label: 'Variable Heatmap',
        type: 'heatmap'
      }
    };
  }

  /**
   * Main analysis method
   */
  analyzeProduct(product) {
    if (!product || !product.payoffStructure) {
      return this.getDefaultAnalysis();
    }

    const characteristics = this.detectCharacteristics(product);
    const complexity = this.calculateComplexity(product);
    const patterns = this.detectPayoffPatterns(product);
    const recommendedViews = this.getRecommendedViews(characteristics, complexity, patterns);
    const recommendedCharts = this.getRecommendedCharts(characteristics, complexity, patterns);
    const reportSections = this.generateReportSections(characteristics, patterns, complexity);

    return {
      characteristics,
      complexity,
      patterns,
      recommendedViews,
      recommendedCharts,
      reportSections,
      metadata: this.extractMetadata(product)
    };
  }

  /**
   * Enhanced analysis method that works with compiled structures and execution traces
   * @param {Object} product - Product object
   * @param {Object} compiledStructure - Compiled payoff structure (optional)
   * @param {Object} executionTrace - Execution trace with runtime data (optional)
   * @returns {Object} - Enhanced analysis with widget recommendations
   */
  analyzeProductEnhanced(product, compiledStructure = null, executionTrace = null) {
    // Run standard analysis
    const standardAnalysis = this.analyzeProduct(product);
    
    // Enhance with compiled structure analysis
    if (compiledStructure) {
      standardAnalysis.compiledFeatures = this.analyzeCompiledStructure(compiledStructure);
    }
    
    // Enhance with execution trace analysis
    if (executionTrace) {
      standardAnalysis.runtimeFeatures = this.analyzeExecutionTrace(executionTrace);
    }
    
    // Get widget recommendations from registry
    const mergedFeatures = {
      ...standardAnalysis.characteristics,
      ...(standardAnalysis.compiledFeatures || {}),
      ...(standardAnalysis.runtimeFeatures || {})
    };
    
    standardAnalysis.recommendedWidgets = globalWidgetRegistry.selectWidgets(mergedFeatures, {
      maxWidgets: 8,
      layoutPreset: this.getLayoutPreset(standardAnalysis.complexity)
    });
    
    return standardAnalysis;
  }
  
  /**
   * Analyze compiled payoff structure for additional insights
   * @param {Object} compiledStructure - Compiled structure
   * @returns {Object} - Additional feature flags
   */
  analyzeCompiledStructure(compiledStructure) {
    const features = {};
    
    if (compiledStructure.executionPlan) {
      features.hasPrecompiledLogic = true;
      features.executionComplexity = compiledStructure.executionPlan.length;
      features.hasOptimizedEvaluation = compiledStructure.isOptimized || false;
    }
    
    if (compiledStructure.dependencyGraph) {
      features.hasDependencies = Object.keys(compiledStructure.dependencyGraph).length > 0;
      features.dependencyComplexity = this.calculateDependencyComplexity(compiledStructure.dependencyGraph);
    }
    
    return features;
  }
  
  /**
   * Analyze execution trace for runtime insights
   * @param {Object} executionTrace - Execution trace data
   * @returns {Object} - Runtime feature flags
   */
  analyzeExecutionTrace(executionTrace) {
    const features = {};
    
    if (executionTrace.steps) {
      features.actualExecutionSteps = executionTrace.steps.length;
      features.hasConditionalPaths = executionTrace.steps.some(step => step.type === 'CONDITIONAL');
      features.hasMemoryOperations = executionTrace.steps.some(step => step.type === 'MEMORY');
    }
    
    if (executionTrace.performance) {
      features.executionTime = executionTrace.performance.totalTime;
      features.hasCachedResults = executionTrace.performance.cacheHits > 0;
    }
    
    return features;
  }
  
  /**
   * Calculate complexity of dependency graph
   * @param {Object} dependencyGraph - Dependency graph
   * @returns {string} - Complexity level
   */
  calculateDependencyComplexity(dependencyGraph) {
    const nodeCount = Object.keys(dependencyGraph).length;
    const edgeCount = Object.values(dependencyGraph).reduce((sum, deps) => sum + deps.length, 0);
    
    if (nodeCount <= 3 && edgeCount <= 3) return 'simple';
    if (nodeCount <= 8 && edgeCount <= 12) return 'moderate';
    return 'complex';
  }
  
  /**
   * Get appropriate layout preset based on complexity
   * @param {Object} complexity - Complexity analysis
   * @returns {string} - Layout preset name
   */
  getLayoutPreset(complexity) {
    if (complexity.overallComplexity <= 3) return 'compact';
    if (complexity.overallComplexity <= 7) return 'standard';
    return 'advanced';
  }

  /**
   * Detect product characteristics from payoff structure
   */
  detectCharacteristics(product) {
    const payoffStructure = product.payoffStructure || [];
    const components = this.flattenComponents(payoffStructure);

    return {
      // Early termination features
      hasEarlyTermination: this.hasEarlyTermination(components),
      earlyTerminationType: this.getEarlyTerminationType(components),
      
      // Payment features
      hasPeriodicPayments: this.hasPeriodicPayments(components),
      hasMemoryFeature: this.hasMemoryFeature(components),
      paymentFrequency: this.getPaymentFrequency(product),
      hasAccumulation: this.hasAccumulation(components),
      
      // Risk features
      hasDownsideProtection: this.hasDownsideProtection(components),
      protectionType: this.getProtectionType(components),
      hasConditionalProtection: this.hasConditionalProtection(components),
      
      // Underlying features
      isMultiAsset: this.isMultiAsset(components),
      assetSelectionMethod: this.getAssetSelectionMethod(components),
      underlyingCount: this.getUnderlyingCount(components),
      
      // Performance features
      hasPerformanceCap: this.hasPerformanceCap(components),
      hasPerformanceFloor: this.hasPerformanceFloor(components),
      hasParticipation: this.hasParticipation(components),
      hasAbsolutePerformance: this.hasAbsolutePerformance(components),
      
      // Monitoring features
      hasContinuousMonitoring: this.hasContinuousMonitoring(components),
      hasPeriodicObservation: this.hasPeriodicObservation(components),
      observationFrequency: this.getObservationFrequency(product),
      
      // Advanced features
      hasStateTracking: this.hasStateTracking(components),
      hasSequentialLogic: this.hasSequentialLogic(components),
      hasRangeAccumulation: this.hasRangeAccumulation(components),
      hasPerformanceSubstitution: this.hasPerformanceSubstitution(components),
      hasIndependentTracking: this.hasIndependentTracking(components),
      hasProgressiveFeatures: this.hasProgressiveFeatures(components),
      
      // Mathematical features
      hasMathematicalOperations: this.hasMathematicalOperations(components),
      hasFormulas: this.hasFormulas(components),
      hasVariableStorage: this.hasVariableStorage(components),
      hasMultipleBaskets: this.hasMultipleBaskets(components),
      mathematicalComplexity: this.calculateMathematicalComplexity(components)
    };
  }

  /**
   * Calculate product complexity score
   */
  calculateComplexity(product) {
    const payoffStructure = product.payoffStructure || [];
    const components = this.flattenComponents(payoffStructure);
    
    let complexityScore = 0;
    
    // Component count
    complexityScore += Math.min(components.length * 0.5, 10);
    
    // Logic operators (IFs)
    const logicCount = components.filter(c => c.type === 'if').length;
    complexityScore += logicCount * 2;
    
    // Nested conditions
    const nestedDepth = this.calculateNestedDepth(payoffStructure);
    complexityScore += nestedDepth * 3;
    
    // Multiple underlyings
    const underlyingCount = this.getUnderlyingCount(components);
    if (underlyingCount > 1) complexityScore += 5;
    
    // Advanced features
    if (this.hasMemoryFeature(components)) complexityScore += 3;
    if (this.hasRangeAccumulation(components)) complexityScore += 4;
    if (this.hasEarlyTerminationWithMemory(components)) complexityScore += 4;
    
    // Mathematical complexity
    const mathComplexity = this.calculateMathematicalComplexity(components);
    complexityScore += mathComplexity;
    
    return {
      score: complexityScore,
      level: this.getComplexityLevel(complexityScore),
      factors: {
        componentCount: components.length,
        logicOperators: logicCount,
        nestingDepth: nestedDepth,
        underlyingCount,
        mathematicalComplexity: mathComplexity
      }
    };
  }

  /**
   * Get recommended views based on characteristics
   */
  /**
   * Detect common payoff patterns without using product names
   */
  detectPayoffPatterns(product) {
    const components = this.flattenComponents(product.payoffStructure || []);
    const patterns = [];
    
    // Pattern 1: Early termination with accumulated payments
    if (this.hasPattern(components, [
      { type: 'autocall', orType: 'terminate' },
      { type: 'memory', orLabel: 'accumulat' }
    ])) {
      patterns.push('early_termination_with_memory');
    }
    
    // Pattern 2: Periodic monitoring with conditional payments
    if (this.hasPattern(components, [
      { type: 'observation', label: 'periodic' },
      { type: 'comparison' },
      { type: 'coupon', orType: 'payment' }
    ])) {
      patterns.push('conditional_periodic_payments');
    }
    
    // Pattern 3: Barrier breach with modified payoff
    if (this.hasPattern(components, [
      { type: 'barrier', orLabel: 'protection' },
      { label: 'downside', orLabel: 'loss' }
    ])) {
      patterns.push('barrier_dependent_payoff');
    }
    
    // Pattern 4: Multi-asset with worst/best selection
    if (this.hasPattern(components, [
      { type: 'basket', orLabel: 'multi' },
      { label: 'worst', orLabel: 'best' }
    ])) {
      patterns.push('selective_multi_asset');
    }
    
    // Pattern 5: Range-based accumulation
    if (this.hasPattern(components, [
      { label: 'range', orType: 'range_accrual' },
      { label: 'accumulat', orType: 'accumulator' }
    ])) {
      patterns.push('range_accumulation');
    }
    
    // Pattern 6: Performance transformation
    if (this.hasPattern(components, [
      { label: 'absolute', orLabel: 'transform' },
      { type: 'performance', orLabel: 'performance' }
    ])) {
      patterns.push('performance_transformation');
    }
    
    // Pattern 7: Sequential asset processing
    if (this.hasPattern(components, [
      { label: 'remove', orLabel: 'sequential' },
      { label: 'best', orLabel: 'worst' }
    ])) {
      patterns.push('sequential_selection');
    }
    
    // Pattern 8: Independent asset tracking
    if (this.hasPattern(components, [
      { label: 'independent', orLabel: 'each' },
      { label: 'lock', orLabel: 'track' }
    ])) {
      patterns.push('independent_tracking');
    }
    
    // Pattern 9: Progressive features
    if (this.hasPattern(components, [
      { label: 'increment', orLabel: 'progressive' },
      { type: 'observation', orLabel: 'period' }
    ])) {
      patterns.push('progressive_feature');
    }
    
    // Pattern 10: Dual barrier monitoring
    if (this.hasPattern(components, [
      { label: 'upper', orLabel: 'up' },
      { label: 'lower', orLabel: 'down' },
      { type: 'barrier' }
    ])) {
      patterns.push('dual_barrier');
    }
    
    // Pattern 11: Mathematical differential payoff
    if (this.hasPattern(components, [
      { type: 'basket', orType: 'underlying' },
      { type: 'math_operator', orLabel: 'subtract' },
      { type: 'basket', orType: 'underlying' }
    ])) {
      patterns.push('differential_payoff');
    }
    
    // Pattern 12: Formula-based payoff
    if (this.hasPattern(components, [
      { type: 'formula', orLabel: 'formula' },
      { type: 'action', orLabel: 'pay' }
    ])) {
      patterns.push('formula_payoff');
    }
    
    // Pattern 13: Variable-based logic
    if (this.hasPattern(components, [
      { type: 'variable_store', orLabel: 'store' },
      { type: 'variable_ref', orLabel: 'variable' }
    ])) {
      patterns.push('variable_logic');
    }
    
    // Pattern 14: Complex mathematical operations
    if (components.filter(c => c.type === 'math_operator').length >= 3) {
      patterns.push('complex_math');
    }
    
    return patterns;
  }
  
  /**
   * Check if components match a pattern
   */
  hasPattern(components, pattern) {
    for (const requirement of pattern) {
      const found = components.some(comp => {
        let matches = true;
        
        if (requirement.type && comp.type !== requirement.type) {
          if (!requirement.orType || comp.type !== requirement.orType) {
            matches = false;
          }
        }
        
        if (requirement.label && !comp.label?.toLowerCase().includes(requirement.label)) {
          if (!requirement.orLabel || !comp.label?.toLowerCase().includes(requirement.orLabel)) {
            matches = false;
          }
        }
        
        return matches;
      });
      
      if (!found) return false;
    }
    
    return true;
  }
  
  /**
   * Generate report sections based on detected patterns
   */
  generateReportSections(characteristics, patterns, complexity) {
    const sections = [];
    
    // Always include overview
    sections.push({
      id: 'overview',
      title: 'Product Overview',
      priority: 1,
      components: ['summary_card', 'key_features', 'timeline']
    });
    
    // Early termination analysis
    if (characteristics.hasEarlyTermination) {
      sections.push({
        id: 'early_termination',
        title: 'Early Termination Analysis',
        priority: 2,
        components: ['termination_probabilities', 'trigger_levels', 'historical_triggers']
      });
    }
    
    // Payment analysis
    if (characteristics.hasPeriodicPayments) {
      sections.push({
        id: 'payments',
        title: 'Payment Analysis',
        priority: 3,
        components: characteristics.hasMemoryFeature ? 
          ['payment_schedule', 'accumulated_payments', 'payment_conditions'] :
          ['payment_schedule', 'payment_conditions']
      });
    }
    
    // Risk analysis
    if (characteristics.hasDownsideProtection) {
      sections.push({
        id: 'risk',
        title: 'Risk Analysis',
        priority: 4,
        components: ['protection_levels', 'barrier_distance', 'breach_probability']
      });
    }
    
    // Performance analysis
    if (characteristics.isMultiAsset || patterns.includes('selective_multi_asset')) {
      sections.push({
        id: 'multi_asset',
        title: 'Multi-Asset Analysis',
        priority: 5,
        components: ['asset_performance', 'correlation_matrix', 'selection_impact']
      });
    }
    
    // Advanced features
    if (patterns.includes('range_accumulation')) {
      sections.push({
        id: 'range',
        title: 'Range Analysis',
        priority: 6,
        components: ['range_visualization', 'accumulation_tracking', 'historical_ranges']
      });
    }
    
    if (patterns.includes('sequential_selection')) {
      sections.push({
        id: 'sequential',
        title: 'Sequential Selection Analysis',
        priority: 7,
        components: ['selection_history', 'remaining_assets', 'performance_impact']
      });
    }
    
    // Scenario analysis for complex products
    if (complexity.score > 15) {
      sections.push({
        id: 'scenarios',
        title: 'Scenario Analysis',
        priority: 8,
        components: ['scenario_matrix', 'sensitivity_analysis', 'probability_distribution']
      });
    }
    
    // Mathematical operations sections
    if (patterns.includes('differential_payoff')) {
      sections.push({
        id: 'differential',
        title: 'Differential Payoff Analysis',
        priority: 9,
        components: ['basket_comparison', 'differential_chart', 'spread_analysis']
      });
    }
    
    if (patterns.includes('formula_payoff')) {
      sections.push({
        id: 'formula',
        title: 'Formula Calculator',
        priority: 10,
        components: ['formula_input', 'variable_values', 'calculation_results']
      });
    }
    
    if (patterns.includes('variable_logic') || patterns.includes('complex_math')) {
      sections.push({
        id: 'variables',
        title: 'Variable Tracking',
        priority: 11,
        components: ['variable_timeline', 'variable_dependencies', 'calculation_flow']
      });
    }
    
    // Hybrid payoff structures
    if (characteristics.hasMathematicalOperations && characteristics.hasMemoryFeature) {
      sections.push({
        id: 'hybrid',
        title: 'Hybrid Payoff Analysis',
        priority: 12,
        components: ['memory_variables', 'conditional_formulas', 'state_calculations']
      });
    }
    
    return sections.sort((a, b) => a.priority - b.priority);
  }
  
  getRecommendedViews(characteristics, complexity, patterns) {
    const views = [];
    
    // Always include summary
    views.push({ id: 'summary', label: 'Executive Summary', icon: '📋', priority: 1 });
    
    // Early termination view
    if (characteristics.hasEarlyTermination) {
      views.push({ 
        id: 'terminationAnalysis', 
        ...this.viewRegistry.terminationAnalysis,
        priority: 2 
      });
    }
    
    // Payment view
    if (characteristics.hasPeriodicPayments) {
      views.push({ 
        id: 'paymentSchedule', 
        ...this.viewRegistry.paymentSchedule,
        priority: 3 
      });
    }
    
    // Protection view
    if (characteristics.hasDownsideProtection) {
      views.push({ 
        id: 'protectionMonitor', 
        ...this.viewRegistry.protectionMonitor,
        priority: 4 
      });
    }
    
    // Range tracking view
    if (characteristics.hasRangeAccumulation) {
      views.push({ 
        id: 'rangeTracking', 
        ...this.viewRegistry.rangeTracking,
        priority: 5 
      });
    }
    
    // Payoff diagram for complex products
    if (complexity.score > 10) {
      views.push({ 
        id: 'payoffDiagram', 
        ...this.viewRegistry.payoffDiagram,
        priority: 6 
      });
    }
    
    // Scenario analysis for products with multiple outcomes
    if (characteristics.hasConditionalPayoffs) {
      views.push({ 
        id: 'scenarioAnalysis', 
        ...this.viewRegistry.scenarioAnalysis,
        priority: 7 
      });
    }
    
    // Mathematical features views
    if (characteristics.hasFormulas) {
      views.push({
        id: 'formulaCalculator',
        ...this.viewRegistry.formulaCalculator,
        priority: 8
      });
    }
    
    if (characteristics.hasMultipleBaskets) {
      views.push({
        id: 'basketComparison',
        ...this.viewRegistry.basketComparison,
        priority: 9
      });
    }
    
    if (characteristics.hasVariableStorage) {
      views.push({
        id: 'variableTracker',
        ...this.viewRegistry.variableTracker,
        priority: 10
      });
    }
    
    // Differential analysis for complex mathematical operations
    if (characteristics.hasMathematicalOperations && characteristics.hasMultipleBaskets) {
      views.push({
        id: 'differentialAnalysis',
        ...this.viewRegistry.differentialAnalysis,
        priority: 11
      });
    }
    
    // Sort by priority
    return views.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Get recommended charts based on characteristics
   */
  getRecommendedCharts(characteristics, complexity, patterns) {
    const charts = [];
    
    // Performance chart is always relevant
    charts.push({
      id: 'performanceLine',
      ...this.chartRegistry.performanceLine,
      priority: 1
    });
    
    // Protection distance chart
    if (characteristics.hasDownsideProtection) {
      charts.push({
        id: 'protectionDistance',
        ...this.chartRegistry.protectionDistance,
        priority: 2
      });
    }
    
    // Payment calendar
    if (characteristics.hasPeriodicPayments && characteristics.hasPeriodicObservation) {
      charts.push({
        id: 'paymentCalendar',
        ...this.chartRegistry.paymentCalendar,
        priority: 3
      });
    }
    
    // Payoff diagram
    if (!characteristics.hasCapitalProtection || complexity.score > 8) {
      charts.push({
        id: 'payoffDiagram',
        ...this.chartRegistry.payoffDiagram,
        priority: 4
      });
    }
    
    // Probability cone for products with uncertainty
    if (characteristics.hasConditionalPayoffs && complexity.score > 12) {
      charts.push({
        id: 'probabilityCone',
        ...this.chartRegistry.probabilityCone,
        priority: 5
      });
    }
    
    // Scenario waterfall for complex payoffs
    if (characteristics.hasEarlyTermination || characteristics.hasMemoryFeature) {
      charts.push({
        id: 'scenarioWaterfall',
        ...this.chartRegistry.scenarioWaterfall,
        priority: 6
      });
    }
    
    // Mathematical operation charts
    if (characteristics.hasMultipleBaskets && characteristics.hasMathematicalOperations) {
      charts.push({
        id: 'basketDifferential',
        ...this.chartRegistry.basketDifferential,
        priority: 7
      });
    }
    
    if (characteristics.hasFormulas) {
      charts.push({
        id: 'formulaEvolution',
        ...this.chartRegistry.formulaEvolution,
        priority: 8
      });
    }
    
    if (characteristics.hasVariableStorage && characteristics.mathematicalComplexity > 5) {
      charts.push({
        id: 'variableHeatmap',
        ...this.chartRegistry.variableHeatmap,
        priority: 9
      });
    }
    
    return charts.sort((a, b) => a.priority - b.priority);
  }

  // Enhanced helper methods for generic analysis
  hasEarlyTermination(components) {
    return components.some(c => 
      c.type === 'autocall' || 
      c.label?.toLowerCase().includes('terminat') ||
      c.label?.toLowerCase().includes('early') ||
      c.label?.toLowerCase().includes('call')
    );
  }
  
  getEarlyTerminationType(components) {
    const termComponent = components.find(c => 
      c.type === 'autocall' || c.label?.toLowerCase().includes('terminat')
    );
    
    if (!termComponent) return null;
    
    if (this.hasMemoryFeature(components)) return 'with_accumulation';
    if (this.hasProgressiveFeatures(components)) return 'progressive';
    return 'standard';
  }
  
  hasPeriodicPayments(components) {
    return components.some(c => 
      c.type === 'coupon' ||
      c.label?.toLowerCase().includes('payment') ||
      c.label?.toLowerCase().includes('coupon')
    );
  }
  
  hasMemoryFeature(components) {
    return components.some(c => 
      c.type === 'memory' ||
      c.label?.toLowerCase().includes('memory') ||
      c.label?.toLowerCase().includes('accumulat') ||
      c.label?.toLowerCase().includes('store')
    );
  }
  
  hasAccumulation(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('accumulat') ||
      c.label?.toLowerCase().includes('sum') ||
      c.type === 'accumulator'
    );
  }
  
  hasDownsideProtection(components) {
    return components.some(c => 
      c.type === 'barrier' ||
      c.label?.toLowerCase().includes('protection') ||
      c.label?.toLowerCase().includes('buffer') ||
      c.label?.toLowerCase().includes('floor')
    );
  }
  
  getProtectionType(components) {
    const protection = components.find(c => 
      c.type === 'barrier' || c.label?.toLowerCase().includes('protection')
    );
    
    if (!protection) return null;
    
    if (components.some(c => c.label?.toLowerCase().includes('continuous'))) return 'continuous';
    if (components.some(c => c.label?.toLowerCase().includes('buffer'))) return 'buffered';
    if (components.some(c => c.label?.toLowerCase().includes('conditional'))) return 'conditional';
    return 'standard';
  }
  
  hasConditionalProtection(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('conditional') &&
      (c.type === 'barrier' || c.label?.toLowerCase().includes('protection'))
    );
  }
  
  isMultiAsset(components) {
    const underlyings = components.filter(c => c.type === 'underlying');
    return underlyings.some(u => u.isBasket === true) || underlyings.length > 1;
  }
  
  getAssetSelectionMethod(components) {
    if (this.hasComponentLabel(components, 'worst')) return 'worst_of';
    if (this.hasComponentLabel(components, 'best')) return 'best_of';
    if (this.hasComponentLabel(components, 'average')) return 'average';
    if (this.hasComponentLabel(components, 'sequential')) return 'sequential';
    return 'standard';
  }
  
  hasPerformanceCap(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('cap') ||
      c.label?.toLowerCase().includes('maximum')
    );
  }
  
  hasPerformanceFloor(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('floor') ||
      c.label?.toLowerCase().includes('minimum')
    );
  }
  
  hasParticipation(components) {
    return components.some(c => 
      c.type === 'participation' ||
      c.label?.toLowerCase().includes('participation') ||
      c.label?.toLowerCase().includes('multiplier')
    );
  }
  
  hasAbsolutePerformance(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('absolute') ||
      c.label?.toLowerCase().includes('transform')
    );
  }
  
  hasContinuousMonitoring(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('continuous') ||
      c.label?.toLowerCase().includes('daily') ||
      c.label?.toLowerCase().includes('american')
    );
  }
  
  hasPeriodicObservation(components) {
    return components.some(c => 
      c.type === 'observation' ||
      c.label?.toLowerCase().includes('observation') ||
      c.label?.toLowerCase().includes('periodic')
    );
  }
  
  hasStateTracking(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('track') ||
      c.label?.toLowerCase().includes('state') ||
      c.label?.toLowerCase().includes('mark')
    );
  }
  
  hasSequentialLogic(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('sequential') ||
      c.label?.toLowerCase().includes('remove') ||
      c.label?.toLowerCase().includes('order')
    );
  }
  
  hasRangeAccumulation(components) {
    return components.some(c => 
      c.type === 'range_accrual' ||
      (c.label?.toLowerCase().includes('range') && 
       c.label?.toLowerCase().includes('accum'))
    );
  }
  
  hasPerformanceSubstitution(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('replace') ||
      c.label?.toLowerCase().includes('substitute') ||
      c.label?.toLowerCase().includes('assign')
    );
  }
  
  hasIndependentTracking(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('independent') ||
      c.label?.toLowerCase().includes('each') ||
      c.label?.toLowerCase().includes('individual')
    );
  }
  
  hasProgressiveFeatures(components) {
    return components.some(c => 
      c.label?.toLowerCase().includes('progressive') ||
      c.label?.toLowerCase().includes('increment') ||
      c.label?.toLowerCase().includes('declining') ||
      c.label?.toLowerCase().includes('step')
    );
  }
  
  getPaymentFrequency(product) {
    return this.getObservationFrequency(product);
  }
  
  // Original helper methods
  flattenComponents(structure) {
    const components = [];
    const traverse = (items) => {
      if (Array.isArray(items)) {
        items.forEach(item => {
          if (item.type) components.push(item);
          if (item.children) traverse(item.children);
          if (item.droppedItems) traverse(item.droppedItems);
        });
      }
    };
    traverse(structure);
    return components;
  }

  hasComponentType(components, type) {
    return components.some(c => c.type === type);
  }

  hasComponentLabel(components, label) {
    return components.some(c => 
      c.label && c.label.toLowerCase().includes(label.toLowerCase())
    );
  }

  getEarlyTerminationType(components) {
    const termination = components.find(c => c.type === 'autocall' || c.type === 'terminate');
    if (!termination) return null;
    
    if (this.hasComponentLabel(components, 'step down')) return 'stepDown';
    if (this.hasComponentLabel(components, 'fixed')) return 'fixed';
    return 'standard';
  }

  hasDownsideProtection(components) {
    return components.some(c => 
      c.type === 'barrier' || 
      (c.label && c.label.toLowerCase().includes('protection'))
    );
  }

  getProtectionType(components) {
    const protection = components.find(c => c.type === 'barrier');
    if (!protection) return null;
    
    const label = protection.label?.toLowerCase() || '';
    if (label.includes('american')) return 'american';
    if (label.includes('european')) return 'european';
    if (label.includes('continuous')) return 'continuous';
    return 'standard';
  }

  isBasketProduct(components) {
    const underlyings = components.filter(c => c.type === 'underlying');
    return underlyings.some(u => u.isBasket === true);
  }

  isWorstOfProduct(components) {
    return this.hasComponentLabel(components, 'worst of') ||
           this.hasComponentLabel(components, 'worst-of');
  }

  getUnderlyingCount(components) {
    const underlyings = components.filter(c => c.type === 'underlying');
    return underlyings.reduce((count, u) => {
      if (u.isBasket && u.selectedSecurities) {
        return count + u.selectedSecurities.length;
      }
      return count + 1;
    }, 0);
  }

  hasCapitalProtection(components) {
    return this.hasComponentLabel(components, 'capital protection') ||
           this.hasComponentLabel(components, '100%') ||
           components.some(c => c.value === '100' && c.type === 'action');
  }

  hasUpsideParticipation(components) {
    return this.hasComponentLabel(components, 'participation') ||
           this.hasComponentLabel(components, 'upside');
  }

  hasEarlyTerminationWithMemory(components) {
    return this.hasMemoryFeature(components) && this.hasEarlyTermination(components);
  }

  hasRangeAccumulation(components) {
    return this.hasComponentLabel(components, 'range') ||
           this.hasComponentLabel(components, 'accumulation');
  }

  hasProgressivePayments(components) {
    return this.hasComponentLabel(components, 'progressive') ||
           this.hasComponentLabel(components, 'step');
  }

  hasConditionalPayments(components) {
    return components.some(c => c.type === 'if') && 
           this.hasPeriodicPayments(components);
  }

  hasFixedPayoffs(components) {
    return this.hasComponentLabel(components, 'fixed') ||
           this.hasComponentLabel(components, 'digital');
  }

  hasProtectedStructure(components) {
    return this.hasDownsideProtection(components) && 
           !this.hasEarlyTermination(components) &&
           this.hasPeriodicPayments(components);
  }

  hasObservationDates(product) {
    return product.observationDates && product.observationDates.length > 0;
  }

  getObservationFrequency(product) {
    if (!product.observationDates || product.observationDates.length < 2) {
      return 'none';
    }
    
    const dates = product.observationDates.map(d => new Date(d));
    const intervals = [];
    
    for (let i = 1; i < dates.length; i++) {
      intervals.push(dates[i] - dates[i-1]);
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const days = avgInterval / (1000 * 60 * 60 * 24);
    
    if (days < 35) return 'monthly';
    if (days < 100) return 'quarterly';
    if (days < 190) return 'semi-annual';
    return 'annual';
  }

  getPaymentFrequency(product) {
    return this.getObservationFrequency(product);
  }

  hasConditionalPayoffs(components) {
    return components.filter(c => c.type === 'if').length > 0;
  }

  calculateNestedDepth(structure, depth = 0) {
    let maxDepth = depth;
    
    const traverse = (items, currentDepth) => {
      if (Array.isArray(items)) {
        items.forEach(item => {
          if (item.type === 'if') {
            maxDepth = Math.max(maxDepth, currentDepth + 1);
            if (item.droppedItems) {
              traverse(item.droppedItems, currentDepth + 1);
            }
          }
        });
      }
    };
    
    traverse(structure, depth);
    return maxDepth;
  }

  getComplexityLevel(score) {
    if (score < 5) return 'simple';
    if (score < 10) return 'moderate';
    if (score < 20) return 'complex';
    return 'highly-complex';
  }

  extractMetadata(product) {
    return {
      hasObservationDates: this.hasObservationDates(product),
      observationCount: product.observationDates?.length || 0,
      maturityDate: product.finalObservationDate || product.maturityDate,
      currency: product.currency || 'USD',
      issuer: product.issuer || 'Unknown'
    };
  }

  getDefaultAnalysis() {
    return {
      characteristics: {
        hasEarlyTermination: false,
        hasPeriodicPayments: false,
        hasDownsideProtection: false,
        isMultiAsset: false,
        hasCapitalProtection: false
      },
      complexity: {
        score: 0,
        level: 'simple'
      },
      recommendedViews: [
        { id: 'summary', label: 'Executive Summary', icon: '📋', priority: 1 }
      ],
      recommendedCharts: [
        { id: 'performanceLine', label: 'Performance Chart', type: 'line', priority: 1 }
      ],
      metadata: {}
    };
  }
  
  // Mathematical feature detection methods
  hasMathematicalOperations(components) {
    return components.some(c => 
      c.type === 'math_operator' ||
      c.label?.toLowerCase().includes('add') ||
      c.label?.toLowerCase().includes('subtract') ||
      c.label?.toLowerCase().includes('multiply') ||
      c.label?.toLowerCase().includes('divide')
    );
  }
  
  hasFormulas(components) {
    return components.some(c => 
      c.type === 'formula' ||
      c.label?.toLowerCase().includes('formula') ||
      c.label?.toLowerCase().includes('equation')
    );
  }
  
  hasVariableStorage(components) {
    return components.some(c => 
      c.type === 'variable_store' ||
      c.type === 'variable_ref' ||
      c.label?.toLowerCase().includes('variable') ||
      c.label?.toLowerCase().includes('store')
    );
  }
  
  hasMultipleBaskets(components) {
    const baskets = components.filter(c => 
      c.type === 'basket' ||
      (c.type === 'underlying' && c.isBasket)
    );
    
    // Check if baskets have unique names
    const namedBaskets = baskets.filter(b => 
      b.label && !b.label.toLowerCase().includes('basket')
    );
    
    return baskets.length > 1 || namedBaskets.length > 0;
  }
  
  calculateMathematicalComplexity(components) {
    let complexity = 0;
    
    // Count mathematical operators
    const mathOps = components.filter(c => c.type === 'math_operator').length;
    complexity += mathOps * 2;
    
    // Count formulas
    const formulas = components.filter(c => c.type === 'formula').length;
    complexity += formulas * 3;
    
    // Count variables
    const variables = components.filter(c => 
      c.type === 'variable_store' || c.type === 'variable_ref'
    ).length;
    complexity += variables;
    
    // Count named baskets
    const namedBaskets = components.filter(c => 
      (c.type === 'basket' || (c.type === 'underlying' && c.isBasket)) &&
      c.label && !c.label.toLowerCase().includes('basket')
    ).length;
    complexity += namedBaskets * 2;
    
    return complexity;
  }

  hasEarlyTermination(components) {
    return this.hasComponentType(components, 'autocall') || 
           this.hasComponentType(components, 'terminate');
  }

  hasPeriodicPayments(components) {
    return this.hasComponentType(components, 'coupon') ||
           this.hasComponentType(components, 'payment');
  }
}