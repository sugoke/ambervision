/**
 * Execution Tracer - Collects structured execution logs and diagnostics
 * 
 * Provides detailed tracing of rule engine evaluation, formula compilation,
 * and component execution with performance metrics and debugging information.
 */

export class ExecutionTrace {
  constructor(traceId = null, options = {}) {
    this.traceId = traceId || this.generateTraceId();
    this.startTime = Date.now();
    this.options = {
      includeSteps: options.includeSteps !== false, // Default true
      includeTimings: options.includeTimings !== false, // Default true
      includeVariables: options.includeVariables || false,
      includeIntermediateResults: options.includeIntermediateResults || false,
      maxSteps: options.maxSteps || 1000,
      ...options
    };
    
    this.steps = [];
    this.performance = {
      totalTime: 0,
      stepTimes: {},
      memoryUsage: {},
      cacheHits: 0,
      cacheMisses: 0
    };
    
    this.context = {
      productId: options.productId,
      evaluationDate: options.evaluationDate,
      section: options.section,
      compiledStructure: options.compiledStructure
    };
    
    this.errors = [];
    this.warnings = [];
  }
  
  generateTraceId() {
    return `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Add an execution step
   * @param {Object} step - Step information
   */
  addStep(step) {
    if (!this.options.includeSteps) return;
    if (this.steps.length >= this.options.maxSteps) return;
    
    const timestamp = Date.now();
    const stepWithMetadata = {
      stepId: this.steps.length + 1,
      timestamp,
      elapsed: timestamp - this.startTime,
      ...step
    };
    
    this.steps.push(stepWithMetadata);
    
    // Track timing if enabled
    if (this.options.includeTimings && step.type) {
      if (!this.performance.stepTimes[step.type]) {
        this.performance.stepTimes[step.type] = { count: 0, totalTime: 0, avgTime: 0 };
      }
      
      const stepTime = step.duration || 0;
      this.performance.stepTimes[step.type].count++;
      this.performance.stepTimes[step.type].totalTime += stepTime;
      this.performance.stepTimes[step.type].avgTime = 
        this.performance.stepTimes[step.type].totalTime / this.performance.stepTimes[step.type].count;
    }
  }
  
  /**
   * Record a component evaluation
   * @param {Object} component - Component being evaluated
   * @param {*} result - Evaluation result
   * @param {number} duration - Execution time in ms
   * @param {Object} variables - Variable values (if enabled)
   */
  recordComponentEvaluation(component, result, duration = 0, variables = {}) {
    const step = {
      type: 'COMPONENT_EVALUATION',
      category: 'evaluation',
      componentId: component.id,
      componentType: component.type,
      componentLabel: component.label || component.type,
      result: this.options.includeIntermediateResults ? result : (typeof result),
      duration,
      success: result !== null && result !== undefined
    };
    
    if (this.options.includeVariables && Object.keys(variables).length > 0) {
      step.variables = variables;
    }
    
    this.addStep(step);
  }
  
  /**
   * Record a decision point (IF/ELSE logic)
   * @param {Object} condition - Condition that was evaluated
   * @param {boolean} result - Whether condition was met
   * @param {string} path - Which path was taken
   */
  recordDecision(condition, result, path) {
    this.addStep({
      type: 'DECISION',
      category: 'logic',
      condition: condition.label || condition.type,
      conditionResult: result,
      pathTaken: path,
      branchType: condition.type
    });
  }
  
  /**
   * Record a memory operation
   * @param {string} operation - Type of memory operation
   * @param {string} bucket - Memory bucket name
   * @param {*} value - Value involved in operation
   */
  recordMemoryOperation(operation, bucket, value = null) {
    this.addStep({
      type: 'MEMORY_OPERATION',
      category: 'memory',
      operation, // 'store', 'retrieve', 'check', 'clear'
      bucket,
      value: this.options.includeIntermediateResults ? value : (value ? typeof value : null)
    });
  }
  
  /**
   * Record a cache operation
   * @param {string} operation - 'hit' or 'miss'
   * @param {string} key - Cache key
   * @param {string} source - Where the cache operation occurred
   */
  recordCacheOperation(operation, key, source = 'unknown') {
    if (operation === 'hit') {
      this.performance.cacheHits++;
    } else if (operation === 'miss') {
      this.performance.cacheMisses++;
    }
    
    this.addStep({
      type: 'CACHE_OPERATION',
      category: 'performance',
      operation,
      key,
      source
    });
  }
  
  /**
   * Record an error
   * @param {Error|string} error - Error that occurred
   * @param {Object} context - Context where error occurred
   */
  recordError(error, context = {}) {
    const errorInfo = {
      message: error.message || error,
      stack: error.stack,
      timestamp: Date.now(),
      context
    };
    
    this.errors.push(errorInfo);
    
    this.addStep({
      type: 'ERROR',
      category: 'error',
      message: errorInfo.message,
      context
    });
  }
  
  /**
   * Record a warning
   * @param {string} message - Warning message
   * @param {Object} context - Context for the warning
   */
  recordWarning(message, context = {}) {
    const warningInfo = {
      message,
      timestamp: Date.now(),
      context
    };
    
    this.warnings.push(warningInfo);
    
    this.addStep({
      type: 'WARNING',
      category: 'warning',
      message,
      context
    });
  }
  
  /**
   * Record performance metrics
   * @param {string} metric - Metric name
   * @param {*} value - Metric value
   * @param {string} unit - Unit of measurement
   */
  recordPerformanceMetric(metric, value, unit = 'ms') {
    this.performance.memoryUsage[metric] = { value, unit, timestamp: Date.now() };
    
    this.addStep({
      type: 'PERFORMANCE_METRIC',
      category: 'performance',
      metric,
      value,
      unit
    });
  }
  
  /**
   * Finish the trace and calculate final metrics
   */
  finish() {
    this.performance.totalTime = Date.now() - this.startTime;
    this.performance.stepsRecorded = this.steps.length;
    this.performance.errorsCount = this.errors.length;
    this.performance.warningsCount = this.warnings.length;
    this.performance.cacheHitRate = this.performance.cacheHits + this.performance.cacheMisses > 0 ?
      (this.performance.cacheHits / (this.performance.cacheHits + this.performance.cacheMisses)) * 100 : 0;
  }
  
  /**
   * Get a summary of the trace
   * @returns {Object} - Trace summary
   */
  getSummary() {
    return {
      traceId: this.traceId,
      context: this.context,
      performance: this.performance,
      stepCategories: this.getStepCategoryCounts(),
      hasErrors: this.errors.length > 0,
      hasWarnings: this.warnings.length > 0,
      completedSuccessfully: this.errors.length === 0
    };
  }
  
  /**
   * Get counts by step category
   */
  getStepCategoryCounts() {
    const counts = {};
    for (const step of this.steps) {
      counts[step.category] = (counts[step.category] || 0) + 1;
    }
    return counts;
  }
  
  /**
   * Get detailed trace data
   * @param {Object} options - Export options
   * @returns {Object} - Complete trace data
   */
  export(options = {}) {
    const includeAllSteps = options.includeAllSteps !== false;
    const includeErrors = options.includeErrors !== false;
    const includeWarnings = options.includeWarnings !== false;
    
    return {
      traceId: this.traceId,
      context: this.context,
      summary: this.getSummary(),
      steps: includeAllSteps ? this.steps : this.steps.slice(-10), // Last 10 steps by default
      errors: includeErrors ? this.errors : [],
      warnings: includeWarnings ? this.warnings : [],
      performance: this.performance,
      options: this.options
    };
  }
}

/**
 * Execution Tracer - Factory and management class
 */
export class ExecutionTracer {
  constructor() {
    this.activeTraces = new Map();
    this.completedTraces = [];
    this.maxCompletedTraces = 100; // Keep last 100 completed traces
  }
  
  /**
   * Start a new trace
   * @param {Object} options - Trace options
   * @returns {ExecutionTrace} - New trace instance
   */
  startTrace(options = {}) {
    const trace = new ExecutionTrace(null, options);
    this.activeTraces.set(trace.traceId, trace);
    
    // Clean up old completed traces
    if (this.completedTraces.length > this.maxCompletedTraces) {
      this.completedTraces = this.completedTraces.slice(-this.maxCompletedTraces);
    }
    
    return trace;
  }
  
  /**
   * Get an active trace
   * @param {string} traceId - Trace ID
   * @returns {ExecutionTrace|null} - Trace instance or null
   */
  getTrace(traceId) {
    return this.activeTraces.get(traceId) || null;
  }
  
  /**
   * Finish a trace
   * @param {string} traceId - Trace ID
   * @returns {Object} - Trace summary
   */
  finishTrace(traceId) {
    const trace = this.activeTraces.get(traceId);
    if (!trace) {
      return null;
    }
    
    trace.finish();
    this.activeTraces.delete(traceId);
    this.completedTraces.push(trace.export());
    
    return trace.getSummary();
  }
  
  /**
   * Get trace statistics
   * @returns {Object} - Statistics
   */
  getStatistics() {
    return {
      activeTraces: this.activeTraces.size,
      completedTraces: this.completedTraces.length,
      totalTraces: this.activeTraces.size + this.completedTraces.length
    };
  }
  
  /**
   * Get recent traces
   * @param {number} count - Number of traces to return
   * @returns {Array} - Recent completed traces
   */
  getRecentTraces(count = 10) {
    return this.completedTraces.slice(-count);
  }
  
  /**
   * Clear all traces
   */
  clearTraces() {
    this.activeTraces.clear();
    this.completedTraces = [];
  }
}

// Global tracer instance
export const globalExecutionTracer = new ExecutionTracer();