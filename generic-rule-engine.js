/**
 * Generic Rule Engine for Structured Products
 * 
 * This engine takes any product's payoffStructure and converts it into
 * executable logic that can be run against market data to determine
 * the product's performance at any point in time.
 * 
 * ARCHITECTURE:
 * - Product-agnostic: Works with ANY drag-and-drop structure
 * - Market data driven: Uses actual price data to evaluate conditions
 * - Generic evaluators: Each component type has a universal evaluator
 * - Executable tree: Converts payoff structure to executable logic
 */

const { MongoClient, ObjectId } = require('mongodb');

// Standalone schedule helpers (no Meteor dependencies)
const ScheduleHelpers = {
  /**
   * Generate schedule events from product data
   */
  generateProductSchedule(product) {
    const events = [];
    const today = new Date();
    
    // Launch/Trade Date
    if (product.tradeDate) {
      events.push({
        date: new Date(product.tradeDate),
        description: 'Product Launch Date',
        type: 'launch',
        status: new Date(product.tradeDate) <= today ? 'completed' : 'upcoming',
        details: {
          nominal: product.nominal || '100%',
          currency: product.currency || 'USD'
        }
      });
    }
    
    // Observation Dates (from payoff structure)
    this.extractObservationDates(product, events, today);
    
    // Coupon Payment Dates (from payoff structure)
    this.extractCouponDates(product, events, today);
    
    // Final Observation/Redemption Date
    const finalDate = product.finalObservation || product.maturity || product.maturityDate;
    if (finalDate) {
      const finalObservationDate = new Date(finalDate);
      events.push({
        date: finalObservationDate,
        description: 'Final Redemption Date',
        type: 'redemption',
        redemptionAmount: 100, // Default to 100% nominal
        status: finalObservationDate <= today ? 'completed' : 'upcoming',
        details: {
          finalPayment: true,
          finalObservation: true,
          currency: product.currency || 'USD'
        }
      });
    }
    
    // Sort events by date
    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    // Remove duplicate events (same date, type, and description)
    const uniqueEvents = [];
    const seen = new Set();
    
    events.forEach(event => {
      const key = `${event.date.getTime()}-${event.type}-${event.description}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueEvents.push(event);
      }
    });
    
    return {
      productId: product._id,
      productIsin: product.isin,
      productName: product.title || product.productName,
      scheduleType: 'product_timeline',
      currency: product.currency || 'USD',
      events: uniqueEvents
    };
  },
  
  /**
   * Extract observation dates from payoff structure
   */
  extractObservationDates(product, events, today) {
    if (!product.payoffStructure) return;
    
    const observationComponents = product.payoffStructure.filter(component => 
      component.type === 'OBSERVATION' || 
      component.label?.toLowerCase().includes('observation')
    );
    
    observationComponents.forEach((component, index) => {
      // Generate observation dates based on frequency
      const frequency = component.frequency || 'quarterly';
      const startDate = new Date(product.tradeDate || product.createdAt);
      const endDate = new Date(product.maturity || product.maturityDate);
      
      const observationDates = this.generateDatesByFrequency(startDate, endDate, frequency);
      
      observationDates.forEach((date, dateIndex) => {
        events.push({
          // Base fields (always present)
          date: date,
          description: `Observation Date #${dateIndex + 1}`,
          type: 'observation',
          status: date <= today ? 'completed' : 'upcoming',
          
          // Optional fields (UI displays if present)
          observationLevel: component.value || component.defaultValue,
          barrierLevel: component.value || component.defaultValue,
          underlying: product.underlyings?.[0]?.symbol || 'Underlying',
          frequency: frequency,
          
          // Additional optional fields for advanced products
          // autocallLevel: null,
          // memoryCount: null,
          // lockInStatus: null,
          
          details: {
            frequency: frequency,
            observationLevel: component.value || component.defaultValue,
            underlying: product.underlyings?.[0]?.symbol || 'Underlying'
          }
        });
      });
    });
  },
  
  /**
   * Extract coupon payment dates from payoff structure
   */
  extractCouponDates(product, events, today) {
    if (!product.payoffStructure) return;
    
    const couponComponents = product.payoffStructure.filter(component => 
      component.type === 'action' && 
      (component.label?.toLowerCase().includes('coupon') || 
       component.value?.toLowerCase().includes('coupon'))
    );
    
    couponComponents.forEach((component, index) => {
      const couponRate = this.extractCouponRate(component);
      
      if (couponRate > 0) {
        // Check if this is a maturity-only coupon
        const isMaturityCoupon = component.label?.toLowerCase().includes('maturity');
        
        if (isMaturityCoupon) {
          // Add coupon payment at final observation date
          const finalDate = product.finalObservation || product.maturity || product.maturityDate;
          const finalObservationDate = new Date(finalDate);
          events.push({
            // Base fields (always present)
            date: finalObservationDate,
            description: `Final Coupon Payment`,
            type: 'coupon',
            status: finalObservationDate <= today ? 'completed' : 'upcoming',
            
            // Optional fields (UI displays if present)
            couponRate: couponRate,
            annualizedRate: couponRate,
            currency: product.currency || 'USD',
            frequency: 'at_final_observation',
            
            details: {
              frequency: 'at_final_observation',
              annualizedRate: couponRate,
              currency: product.currency || 'USD',
              finalObservationPayment: true
            }
          });
        } else {
          // Generate regular coupon payment dates (typically quarterly or annual)
          const frequency = component.frequency || 'quarterly';
          const startDate = new Date(product.tradeDate || product.createdAt);
          const endDate = new Date(product.maturity || product.maturityDate);
          
          const couponDates = this.generateDatesByFrequency(startDate, endDate, frequency);
          
          couponDates.forEach((date, dateIndex) => {
            events.push({
              // Base fields (always present)
              date: date,
              description: `Coupon Payment #${dateIndex + 1}`,
              type: 'coupon',
              status: date <= today ? 'completed' : 'upcoming',
              
              // Optional fields (UI displays if present)
              couponRate: couponRate,
              annualizedRate: couponRate,
              currency: product.currency || 'USD',
              frequency: frequency,
              
              // Additional optional fields for advanced products
              // memoryBuffer: null,
              // conditionalPayment: null,
              // barrierDependency: null,
              
              details: {
                frequency: frequency,
                annualizedRate: couponRate,
                currency: product.currency || 'USD'
              }
            });
          });
        }
      }
    });
  },
  
  /**
   * Generate dates by frequency
   */
  generateDatesByFrequency(startDate, endDate, frequency) {
    const dates = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    let current = new Date(start);
    let monthIncrement;
    
    switch (frequency.toLowerCase()) {
      case 'monthly':
        monthIncrement = 1;
        break;
      case 'quarterly':
        monthIncrement = 3;
        break;
      case 'semi-annual':
      case 'semiannual':
        monthIncrement = 6;
        break;
      case 'annual':
      case 'yearly':
        monthIncrement = 12;
        break;
      default:
        monthIncrement = 3; // Default to quarterly
    }
    
    // Start from first period after launch
    current.setMonth(current.getMonth() + monthIncrement);
    
    while (current < end) {
      dates.push(new Date(current));
      current.setMonth(current.getMonth() + monthIncrement);
    }
    
    return dates;
  },
  
  /**
   * Extract coupon rate from component
   */
  extractCouponRate(component) {
    const value = component.value || component.defaultValue || '';
    const label = component.label || '';
    
    // Check if component is explicitly a coupon
    const isCouponComponent = label.toLowerCase().includes('coupon');
    
    // Look for percentage values first
    const percentMatch = (value + ' ' + label).match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      return parseFloat(percentMatch[1]);
    }
    
    // For coupon components, treat numeric values as percentages
    if (isCouponComponent && value && !isNaN(parseFloat(value))) {
      const num = parseFloat(value);
      return num > 0 ? num : 0;
    }
    
    // Look for decimal values in general
    const decimalMatch = (value + ' ' + label).match(/(\d+(?:\.\d+)?)/);
    if (decimalMatch) {
      const num = parseFloat(decimalMatch[1]);
      // If less than 1, assume it's already a percentage (0.05 = 5%)
      return num < 1 ? num * 100 : num;
    }
    
    return 0;
  }
};

// Standalone report helpers (no Meteor dependencies)
const ReportHelpers = {
  transformEvaluationToReport(product, evaluationResult, userId = null) {
    const { marketContext, results, summary, logicTree } = evaluationResult;
    
    // Extract underlying data
    const underlyings = Object.values(marketContext.underlyings).map(u => ({
      symbol: u.symbol,
      strike: u.strike,
      tradePrice: u.tradePrice,
      currentPrice: u.currentPrice,
      redemptionPrice: u.redemptionPrice,
      performance: u.performance,
      performanceRatio: u.performanceRatio,
      pricingDate: u.pricingDate,
      isMatured: u.isMatured
    }));

    // Analyze execution results
    const conditionsMet = [];
    const triggeredActions = [];
    
    Object.values(results).forEach(sectionResults => {
      sectionResults.forEach(result => {
        if (result.conditionMet) {
          conditionsMet.push(`Row ${result.rowIndex}: Condition met`);
          
          if (result.actions) {
            result.actions.forEach(action => {
              triggeredActions.push(action.description);
            });
          }
        }
      });
    });

    // Create report document
    return {
      // Product Reference
      productId: product._id,
      productIsin: product.isin,
      productName: product.title || product.productName,
      
      // Report Metadata
      reportType: 'evaluation',
      status: marketContext.hasMatured ? 'matured' : 'live',
      
      // Evaluation Context
      evaluationDate: marketContext.evaluationDate,
      tradeDate: marketContext.tradeDate,
      maturityDate: marketContext.maturityDate,
      hasMatured: marketContext.hasMatured,
      pricingDate: marketContext.pricingDate,
      currency: marketContext.currency,
      
      // Market Data
      underlyings: underlyings,
      
      // Logic Execution Results
      logicTree: logicTree,
      executionResults: results,
      
      // Calculated Payoffs
      payoff: {
        totalPayout: parseFloat(summary.totalPayout.replace('%', '')),
        breakdown: summary.payoutBreakdown,
        conditionsMet: conditionsMet,
        triggeredActions: triggeredActions
      },
      
      // Summary Metrics
      summary: {
        capitalProtected: this.isCapitalProtected(results),
        couponPaid: this.isCouponPaid(results),
        earlyTermination: this.hasEarlyTermination(results),
        finalPayout: parseFloat(summary.totalPayout.replace('%', '')),
        investorReturn: parseFloat(summary.underlyingPerformance.replace('%', ''))
      },
      
      // Audit Trail
      createdBy: userId,
      
      // Additional Data
      tags: this.generateTags(product, results),
      notes: '',
      
      // Product Schedule
      schedule: ScheduleHelpers.generateProductSchedule(product)
    };
  },

  /**
   * Check if capital is protected
   */
  isCapitalProtected(results) {
    return Object.values(results).some(sectionResults =>
      sectionResults.some(result =>
        result.actions?.some(action => 
          action.action?.toLowerCase().includes('capital')
        )
      )
    );
  },

  /**
   * Check if coupon was paid
   */
  isCouponPaid(results) {
    return Object.values(results).some(sectionResults =>
      sectionResults.some(result =>
        result.actions?.some(action => 
          action.action?.toLowerCase().includes('coupon')
        )
      )
    );
  },

  /**
   * Check for early termination
   */
  hasEarlyTermination(results) {
    // Check if any autocall or early termination conditions were met
    return Object.values(results).some(sectionResults =>
      sectionResults.some(result =>
        result.actions?.some(action => 
          action.action?.toLowerCase().includes('autocall') ||
          action.action?.toLowerCase().includes('call')
        )
      )
    );
  },

  /**
   * Generate intelligent tags for the report based on payoff structure analysis
   */
  generateTags(product, results) {
    const tags = [];
    
    if (!product.payoffStructure) {
      return ['unstructured'];
    }
    
    // Analyze payoff structure components
    const analysis = this.analyzePayoffStructure(product.payoffStructure);
    
    // CAPITAL PROTECTION CLASSIFICATION
    if (analysis.hasCapitalProtection) {
      if (analysis.protectionLevel >= 100) {
        tags.push('Total Capital Guarantee');
      } else if (analysis.protectionLevel > 0) {
        tags.push(`Conditional Guarantee (${analysis.protectionLevel}%)`);
      }
    } else {
      tags.push('No Capital Protection');
    }
    
    // BARRIER CLASSIFICATION
    if (analysis.barriers.length > 0) {
      tags.push('Barrier Product');
      
      // Specific barrier types
      if (analysis.barriers.some(b => b.type === 'protection')) {
        tags.push('Capital Protection Barrier');
      }
      if (analysis.barriers.some(b => b.type === 'autocall')) {
        tags.push('Autocall Barrier');
      }
      if (analysis.barriers.some(b => b.type === 'knock_in')) {
        tags.push('Knock-In Barrier');
      }
    }
    
    // AUTOCALLABLE CLASSIFICATION
    if (analysis.hasAutocall) {
      tags.push('Autocallable');
      
      if (analysis.autocalls.length > 1) {
        tags.push('Multiple Autocall Levels');
      }
      
      if (analysis.hasMemoryFeature) {
        tags.push('Memory Feature');
      }
    }
    
    // COUPON CLASSIFICATION
    if (analysis.coupons.length > 0) {
      tags.push('Coupon Bearing');
      
      const couponTypes = [...new Set(analysis.coupons.map(c => c.type))];
      if (couponTypes.includes('fixed')) {
        tags.push('Fixed Coupon');
      }
      if (couponTypes.includes('conditional')) {
        tags.push('Conditional Coupon');
      }
      if (couponTypes.includes('memory')) {
        tags.push('Memory Coupon');
      }
    }
    
    // PARTICIPATION CLASSIFICATION
    if (analysis.participation.upside > 0 && analysis.participation.downside > 0) {
      if (analysis.participation.upside === analysis.participation.downside) {
        tags.push(`1:1 Participation (${analysis.participation.upside}%)`);
      } else {
        tags.push(`Asymmetric Participation (${analysis.participation.upside}%/${analysis.participation.downside}%)`);
      }
    } else if (analysis.participation.upside > 0) {
      tags.push(`Upside Participation (${analysis.participation.upside}%)`);
    } else if (analysis.participation.downside > 0) {
      tags.push(`Downside Participation (${analysis.participation.downside}%)`);
    }
    
    // UNDERLYING CLASSIFICATION
    if (product.underlyings) {
      if (product.underlyings.length === 1) {
        tags.push('Single Asset');
      } else if (product.underlyings.length > 1) {
        tags.push(`Multi-Asset (${product.underlyings.length} underlyings)`);
        
        if (analysis.hasWorstOfLogic) {
          tags.push('Worst-of Structure');
        }
        if (analysis.hasBestOfLogic) {
          tags.push('Best-of Structure');
        }
        if (analysis.hasBasketLogic) {
          tags.push('Basket Structure');
        }
      }
    }
    
    // COMPLEXITY CLASSIFICATION
    const complexityScore = this.calculateComplexityScore(analysis);
    if (complexityScore <= 2) {
      tags.push('Simple Structure');
    } else if (complexityScore <= 5) {
      tags.push('Moderate Complexity');
    } else {
      tags.push('Complex Structure');
    }
    
    // PERFORMANCE-BASED TAGS (from execution results)
    Object.values(results).forEach(sectionResults => {
      sectionResults.forEach(result => {
        if (result.conditionMet) {
          result.actions?.forEach(action => {
            if (action.action?.toLowerCase().includes('autocall')) {
              tags.push('Autocalled');
            }
            if (action.action?.toLowerCase().includes('coupon')) {
              tags.push('Coupon Triggered');
            }
            if (action.action?.toLowerCase().includes('capital')) {
              tags.push('Capital Protected');
            }
          });
        }
      });
    });
    
    return [...new Set(tags)]; // Remove duplicates
  },
  
  /**
   * Analyze payoff structure to extract classification features
   */
  analyzePayoffStructure(payoffStructure) {
    const analysis = {
      hasCapitalProtection: false,
      protectionLevel: 0,
      barriers: [],
      hasAutocall: false,
      autocalls: [],
      hasMemoryFeature: false,
      coupons: [],
      participation: { upside: 0, downside: 0 },
      hasWorstOfLogic: false,
      hasBestOfLogic: false,
      hasBasketLogic: false
    };
    
    payoffStructure.forEach(component => {
      const label = (component.label || '').toLowerCase();
      const value = component.value || component.defaultValue || '';
      
      // CAPITAL PROTECTION ANALYSIS
      if (label.includes('capital') && label.includes('protection')) {
        analysis.hasCapitalProtection = true;
        const level = parseFloat(value) || 100;
        analysis.protectionLevel = Math.max(analysis.protectionLevel, level);
      }
      
      if (label.includes('protection') && label.includes('barrier')) {
        analysis.hasCapitalProtection = true;
        const level = parseFloat(value) || 100;
        analysis.protectionLevel = Math.max(analysis.protectionLevel, level);
      }
      
      // BARRIER ANALYSIS
      if (label.includes('barrier')) {
        const barrierType = 
          label.includes('autocall') ? 'autocall' :
          label.includes('protection') || label.includes('capital') ? 'protection' :
          label.includes('knock') ? 'knock_in' :
          'generic';
          
        analysis.barriers.push({
          type: barrierType,
          level: parseFloat(value) || 0,
          label: component.label
        });
      }
      
      // AUTOCALL ANALYSIS
      if (label.includes('autocall')) {
        analysis.hasAutocall = true;
        analysis.autocalls.push({
          level: parseFloat(value) || 100,
          label: component.label
        });
      }
      
      // MEMORY FEATURE ANALYSIS
      if (label.includes('memory')) {
        analysis.hasMemoryFeature = true;
      }
      
      // COUPON ANALYSIS
      if (label.includes('coupon')) {
        const couponType = 
          label.includes('fixed') ? 'fixed' :
          label.includes('conditional') ? 'conditional' :
          label.includes('memory') ? 'memory' :
          'fixed'; // default
          
        analysis.coupons.push({
          type: couponType,
          rate: parseFloat(value) || 0,
          label: component.label
        });
      }
      
      // PARTICIPATION ANALYSIS
      if (label.includes('participation')) {
        const rate = parseFloat(value) || 100;
        if (label.includes('upside')) {
          analysis.participation.upside = rate;
        } else if (label.includes('downside') || label.includes('loss')) {
          analysis.participation.downside = rate;
        } else {
          // Generic participation applies to both
          analysis.participation.upside = rate;
          analysis.participation.downside = rate;
        }
      }
      
      if (label.includes('exposure')) {
        const rate = parseFloat(value) || 100;
        analysis.participation.upside = Math.max(analysis.participation.upside, rate);
        analysis.participation.downside = Math.max(analysis.participation.downside, rate);
      }
      
      // MULTI-ASSET LOGIC ANALYSIS
      if (label.includes('worst')) {
        analysis.hasWorstOfLogic = true;
      }
      if (label.includes('best')) {
        analysis.hasBestOfLogic = true;
      }
      if (label.includes('basket') || label.includes('average')) {
        analysis.hasBasketLogic = true;
      }
    });
    
    return analysis;
  },
  
  /**
   * Calculate complexity score for classification
   */
  calculateComplexityScore(analysis) {
    let score = 0;
    
    // Base complexity
    score += 1;
    
    // Barrier complexity
    score += analysis.barriers.length;
    
    // Autocall complexity
    if (analysis.hasAutocall) score += 1;
    score += analysis.autocalls.length;
    
    // Memory feature
    if (analysis.hasMemoryFeature) score += 1;
    
    // Multiple coupon types
    score += analysis.coupons.length;
    
    // Participation complexity
    if (analysis.participation.upside !== analysis.participation.downside) score += 1;
    
    // Multi-asset complexity
    if (analysis.hasWorstOfLogic || analysis.hasBestOfLogic || analysis.hasBasketLogic) score += 2;
    
    return score;
  }
};

class GenericRuleEngine {
  constructor() {
    this.evaluators = this.createEvaluators();
  }

  /**
   * Main entry point: Evaluate a product against market data
   */
  async evaluateProduct(product, evaluationDate = new Date(), userId = null, saveToReports = true) {
    console.log('🔧 Generic Rule Engine - Product Evaluation');
    console.log('==========================================\n');
    
    // Step 1: Parse the payoff structure into executable logic
    const logicTree = this.parsePayoffStructure(product.payoffStructure);
    console.log('📋 Parsed Logic Tree:');
    console.log(JSON.stringify(logicTree, null, 2));
    
    // Step 2: Gather market data context
    const marketContext = await this.buildMarketContext(product, evaluationDate);
    console.log('\n📊 Market Context:');
    console.log(JSON.stringify(marketContext, null, 2));
    
    // Step 3: Execute the logic tree
    const result = await this.executeLogicTree(logicTree, marketContext);
    result.logicTree = logicTree; // Add logic tree to result for report
    
    console.log('\n✅ Evaluation Result:');
    console.log(JSON.stringify(result, null, 2));
    
    // Step 4: Save to reports collection if enabled
    if (saveToReports) {
      await this.saveEvaluationReport(product, result, userId);
    }
    
    return result;
  }

  /**
   * Parse payoffStructure into executable logic tree
   */
  parsePayoffStructure(payoffStructure) {
    // Group components by section and row
    const sections = {};
    
    payoffStructure.forEach(component => {
      const section = component.section || 'default';
      const row = component.rowIndex || 0;
      
      if (!sections[section]) sections[section] = {};
      if (!sections[section][row]) sections[section][row] = {
        timing: [],
        condition: [],
        action: [],
        continuation: []
      };
      
      const column = component.column || 'condition';
      if (sections[section][row][column]) {
        sections[section][row][column].push(component);
      }
    });
    
    // Convert to logic tree
    const logicTree = {};
    
    Object.keys(sections).forEach(sectionName => {
      logicTree[sectionName] = [];
      
      Object.keys(sections[sectionName])
        .sort((a, b) => parseInt(a) - parseInt(b))
        .forEach(rowIndex => {
          const row = sections[sectionName][rowIndex];
          
          // Build conditional logic
          if (row.condition.length > 0) {
            const rule = {
              type: 'conditional_rule',
              rowIndex: parseInt(rowIndex),
              condition: this.buildConditionLogic(row.condition),
              action: this.buildActionLogic(row.action),
              timing: row.timing || [],
              continuation: row.continuation || []
            };
            
            logicTree[sectionName].push(rule);
          } else if (row.action.length > 0) {
            // Standalone action without condition
            const rule = {
              type: 'standalone_action',
              rowIndex: parseInt(rowIndex),
              action: this.buildActionLogic(row.action),
              timing: row.timing || []
            };
            
            logicTree[sectionName].push(rule);
          }
        });
    });
    
    return logicTree;
  }

  /**
   * Build condition logic from condition components
   */
  buildConditionLogic(conditionComponents) {
    // Sort by sortOrder to maintain logical sequence
    const sorted = conditionComponents.sort((a, b) => 
      (a.sortOrder || 0) - (b.sortOrder || 0)
    );
    
    const logic = {
      type: 'condition_chain',
      components: sorted.map(comp => ({
        type: comp.type,
        label: comp.label,
        value: comp.value || comp.defaultValue,
        id: comp.id,
        evaluator: this.getEvaluatorForType(comp.type)
      }))
    };
    
    return logic;
  }

  /**
   * Build action logic from action components
   */
  buildActionLogic(actionComponents) {
    if (!actionComponents || actionComponents.length === 0) return null;
    
    const sorted = actionComponents.sort((a, b) => 
      (a.sortOrder || 0) - (b.sortOrder || 0)
    );
    
    return {
      type: 'action_sequence',
      components: sorted.map(comp => ({
        type: comp.type,
        label: comp.label,
        value: comp.value || comp.defaultValue,
        id: comp.id,
        evaluator: this.getEvaluatorForType(comp.type)
      }))
    };
  }

  /**
   * Build market context for evaluation
   */
  async buildMarketContext(product, evaluationDate) {
    const client = new MongoClient('mongodb://127.0.0.1:3001/meteor');
    await client.connect();
    const db = client.db('meteor');
    
    try {
      const maturityDate = new Date(product.maturity);
      const tradeDate = new Date(product.tradeDate);
      
      // Determine if product has matured and what pricing date to use
      // For structured products: Trade Date (start) to Final Observation Date (end)
      const initialDate = new Date(product.tradeDate);
      const finalObservationDate = product.finalObservation ? new Date(product.finalObservation) : maturityDate;
      const hasMatured = evaluationDate >= maturityDate;
      
      // Use Final Observation Date for matured products, evaluation date for active products
      const pricingDate = hasMatured ? finalObservationDate : evaluationDate;
      
      const context = {
        evaluationDate,
        tradeDate: tradeDate,
        maturityDate: maturityDate,
        hasMatured: hasMatured,
        pricingDate: pricingDate,
        underlyings: {},
        currency: product.currency || 'USD'
      };
      
      console.log(`📅 Product maturity status: ${hasMatured ? 'MATURED' : 'ACTIVE'}`);
      console.log(`📅 Using pricing date: ${pricingDate.toISOString().split('T')[0]} ${hasMatured ? '(final observation date)' : '(evaluation date)'}`);
      
      // Get market data for each underlying
      for (const underlying of product.underlyings || []) {
        const symbol = underlying.ticker || underlying.symbol;
        const strike = underlying.strike || underlying.strikePrice;
        
        // Get stock data from new marketDataCache structure
        // Try multiple ticker formats to ensure we find the data
        const stockData = await db.collection('marketDataCache')
          .findOne({
            $or: [
              { symbol: symbol },
              { fullTicker: symbol },
              { fullTicker: `${symbol}.US` },
              { fullTicker: `${symbol}.NASDAQ` },
              { fullTicker: `${symbol}.NYSE` }
            ]
          });
        
        if (stockData && stockData.history) {
          const tradeDateStr = initialDate.toISOString().split('T')[0];
          const pricingDateStr = pricingDate.toISOString().split('T')[0];
          
          // Get trade date price (initial level for performance calculation)
          const initialPrice = stockData.history.find(h => 
            h.date.toISOString().split('T')[0] === tradeDateStr
          );
          
          // Get pricing date price (redemption date for matured products, evaluation date for active)
          const pricingPrice = stockData.history
            .filter(h => h.date <= pricingDate)
            .sort((a, b) => b.date - a.date)[0];          // Prepare historical price data for chart generation
          const underlying = product.underlyings.find(u => (u.ticker || u.symbol) === symbol);
          const strikePrice = underlying?.strike || initialPrice?.close;
          
          console.log(`🔍 DEBUG: Symbol ${symbol}`);
          console.log(`  underlying.strike: ${underlying?.strike}`);
          console.log(`  initialPrice.close: ${initialPrice?.close}`);
          console.log(`  final strikePrice: ${strikePrice}`);
          
          // Extract relevant price history for the product period
          const tradeDate = new Date(product.tradeDate);
          const finalObsDate = new Date(product.finalObservation || product.maturity);
          
          const chartPriceData = stockData.history
            .filter(h => h.date >= tradeDate && h.date <= finalObsDate)
            .map(h => ({
              date: h.date.toISOString().split('T')[0],
              price: h.close,
              rebasedPerformance: Math.round((h.close / strikePrice) * 10000) / 100 // Rebase to strike, 2 decimal places
            }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));

          context.underlyings[symbol] = {
            symbol,
            strike: strike || initialPrice?.close,
            strikePrice: strikePrice, // Add strike price for chart rebasing
            tradePrice: initialPrice?.close, // Using trade date price as reference
            currentPrice: pricingPrice?.close,
            redemptionPrice: hasMatured ? pricingPrice?.close : null,
            performance: initialPrice && pricingPrice ? 
              ((pricingPrice.close / initialPrice.close) - 1) * 100 : 0,
            performanceRatio: initialPrice && pricingPrice ? 
              (pricingPrice.close / initialPrice.close) * 100 : 100,
            priceCount: stockData.history.length,
            pricingDate: pricingDate,
            isMatured: hasMatured,
            // Add historical price data for chart generation
            chartData: chartPriceData
          };
        } else {
          // Market data not found - provide helpful error message
          const errorMessage = `Market data not found for underlying '${symbol}'. Please download market data through the admin interface:
1. Go to Administration → Market Data
2. Search for '${symbol}' or '${underlying.name || symbol}'  
3. Click 'Download Historical Data'
4. Re-run the evaluation after download completes`;
          
          console.error(`❌ ${errorMessage}`);
          throw new Error(errorMessage);
        }
      }
      
      return context;
    } finally {
      await client.close();
    }
  }

  /**
   * Execute the logic tree against market context
   */
  async executeLogicTree(logicTree, marketContext) {
    const results = {};
    const evaluationTrace = [];
    
    // Execute each section
    for (const [sectionName, rules] of Object.entries(logicTree)) {
      console.log(`\n🔍 Executing section: ${sectionName}`);
      evaluationTrace.push({
        type: 'section',
        section: sectionName,
        message: `🔍 Evaluating ${sectionName} section`,
        timestamp: new Date().toISOString()
      });
      
      const sectionResults = [];
      
      for (const rule of rules) {
        const ruleResult = await this.executeRule(rule, marketContext);
        
        // Generate detailed trace for this rule
        const ruleTrace = this.generateRuleTrace(rule, ruleResult, marketContext);
        evaluationTrace.push(...ruleTrace);
        
        sectionResults.push(ruleResult);
        
        console.log(`  Rule ${rule.rowIndex}: ${ruleResult.conditionMet ? '✅ TRUE' : '❌ FALSE'}`);
        if (ruleResult.conditionMet && ruleResult.actions) {
          console.log(`    Actions: ${ruleResult.actions.map(a => `${a.type}(${a.value})`).join(', ')}`);
        }
      }
      
      results[sectionName] = sectionResults;
    }
    
    return {
      timestamp: new Date(),
      marketContext,
      results,
      summary: this.summarizeResults(results, marketContext),
      evaluationTrace // Add detailed step-by-step trace
    };
  }

  /**
   * Execute a single rule
   */
  async executeRule(rule, marketContext) {
    if (rule.type === 'conditional_rule') {
      // Evaluate condition
      const conditionResult = await this.evaluateCondition(rule.condition, marketContext);
      
      let actionResults = null;
      if (conditionResult.result && rule.action) {
        actionResults = await this.evaluateActions(rule.action, marketContext);
      }
      
      return {
        type: rule.type,
        rowIndex: rule.rowIndex,
        conditionMet: conditionResult.result,
        conditionDetails: conditionResult.details,
        actions: actionResults
      };
    } else if (rule.type === 'standalone_action') {
      const actionResults = await this.evaluateActions(rule.action, marketContext);
      
      return {
        type: rule.type,
        rowIndex: rule.rowIndex,
        conditionMet: true,
        actions: actionResults
      };
    }
    
    return { conditionMet: false };
  }

  /**
   * Generate detailed human-readable trace for a rule execution
   */
  generateRuleTrace(rule, ruleResult, marketContext) {
    const trace = [];
    const timestamp = new Date().toISOString();
    
    // Rule header
    trace.push({
      type: 'rule_start',
      ruleIndex: rule.rowIndex,
      message: `📋 Rule ${rule.rowIndex}: ${rule.type}`,
      timestamp
    });
    
    // Condition evaluation details
    if (ruleResult.conditionDetails) {
      trace.push({
        type: 'condition_start',
        message: `🔍 Evaluating condition...`,
        timestamp
      });
      
      for (const detail of ruleResult.conditionDetails) {
        let message = '';
        
        switch (detail.type) {
          case 'if':
            message = `🔀 Starting conditional logic: IF statement`;
            break;
            
          case 'underlying':
            const underlying = marketContext.underlyings[detail.symbol];
            const performanceText = underlying ? `${underlying.performance?.toFixed(2)}%` : 'N/A';
            const priceText = underlying ? `$${underlying.currentPrice?.toFixed(2)}` : 'N/A';
            const strikeText = underlying ? `$${underlying.strike?.toFixed(2)}` : 'N/A';
            message = `📈 ${detail.symbol} performance: ${performanceText} (${priceText} vs strike ${strikeText})`;
            break;
            
          case 'comparison':
            message = `⚖️ Comparison operator: ${detail.operator}`;
            break;
            
          case 'action':
            if (detail.action === 'Capital Protection Barrier') {
              message = `🛡️ Capital Protection Barrier level: ${detail.value}%`;
            } else {
              message = `🎯 ${detail.action}: ${detail.value}%`;
            }
            break;
            
          case 'logic_operator':
            message = `🔗 Logic operator: ${detail.operator}`;
            break;
            
          default:
            message = detail.description || `❓ ${detail.type}: ${detail.value}`;
        }
        
        trace.push({
          type: 'condition_step',
          component: detail.type,
          message,
          value: detail.value,
          timestamp
        });
      }
      
      // Condition result
      const conditionResultMessage = ruleResult.conditionMet 
        ? `✅ Condition PASSED: All requirements met`
        : `❌ Condition FAILED: Requirements not satisfied`;
        
      trace.push({
        type: 'condition_result',
        result: ruleResult.conditionMet,
        message: conditionResultMessage,
        timestamp
      });
      
      // Generate comparison analysis
      if (ruleResult.conditionMet && ruleResult.conditionDetails.length >= 4) {
        const underlying = ruleResult.conditionDetails.find(d => d.type === 'underlying');
        const barrier = ruleResult.conditionDetails.find(d => d.type === 'action' && d.action === 'Capital Protection Barrier');
        const comparison = ruleResult.conditionDetails.find(d => d.type === 'comparison');
        
        if (underlying && barrier && comparison) {
          const perfValue = underlying.value?.toFixed(2) || '0';
          const barrierValue = barrier.value;
          const operator = comparison.operator;
          
          trace.push({
            type: 'comparison_analysis',
            message: `📊 Analysis: ${underlying.symbol} performance ${perfValue}% is ${operator.toLowerCase()} barrier ${barrierValue}% ✅`,
            underlying: underlying.symbol,
            performance: perfValue,
            barrier: barrierValue,
            operator,
            timestamp
          });
        }
      }
    }
    
    // Action execution
    if (ruleResult.conditionMet && ruleResult.actions) {
      trace.push({
        type: 'actions_start',
        message: `🚀 Executing actions...`,
        timestamp
      });
      
      for (const action of ruleResult.actions) {
        let actionMessage = '';
        
        switch (action.action) {
          case 'Capital Return':
            actionMessage = `💰 Capital Return: ${action.value}% of principal will be returned`;
            break;
          case 'Maturity Coupon':
            actionMessage = `🎁 Maturity Coupon: ${action.value}% bonus payment`;
            break;
          case '1:1 Exposure Payment':
            actionMessage = `📉 1:1 Exposure Payment: ${action.value}% (performance-linked payment)`;
            break;
          default:
            actionMessage = `⚡ ${action.action}: ${action.value}%`;
        }
        
        trace.push({
          type: 'action_executed',
          action: action.action,
          value: action.value,
          message: actionMessage,
          timestamp
        });
      }
      
      // Calculate total payout
      const totalPayout = ruleResult.actions.reduce((sum, action) => sum + (parseFloat(action.value) || 0), 0);
      trace.push({
        type: 'payout_summary',
        totalPayout,
        message: `💵 Total Payout: ${totalPayout}% (${ruleResult.actions.map(a => `${a.value}%`).join(' + ')})`,
        timestamp
      });
    }
    
    return trace;
  }

  /**
   * Evaluate a condition chain
   */
  async evaluateCondition(condition, marketContext) {
    const components = condition.components;
    const details = [];
    let currentValue = null;
    let operator = null;
    let comparisonValue = null;
    
    for (const component of components) {
      const evaluation = await component.evaluator(component, marketContext);
      details.push(evaluation);
      
      if (component.type === 'underlying') {
        currentValue = evaluation.value;
      } else if (component.type === 'comparison' && component.label === 'At or Above') {
        operator = '>=';
      } else if ((component.type === 'comparison' || component.type === 'barrier') && component.label === 'Capital Protection Barrier') {
        comparisonValue = parseFloat(component.value || component.defaultValue || 70);
      }
    }
    
    // Perform the comparison
    let result = false;
    if (currentValue !== null && operator && comparisonValue !== null) {
      if (operator === '>=') {
        result = currentValue >= comparisonValue;
      }
    }
    
    return {
      result,
      details,
      comparison: `${currentValue} ${operator} ${comparisonValue} = ${result}`
    };
  }

  /**
   * Evaluate actions
   */
  async evaluateActions(actionChain, marketContext) {
    if (!actionChain || !actionChain.components) return null;
    
    const results = [];
    
    for (const component of actionChain.components) {
      const evaluation = await component.evaluator(component, marketContext);
      results.push(evaluation);
    }
    
    return results;
  }

  /**
   * Create evaluators for each component type
   */
  createEvaluators() {
    return {
      // IF condition starter
      if: async (component, context) => ({
        type: 'if',
        description: 'Conditional logic starter',
        value: true
      }),

      // Underlying performance
      underlying: async (component, context) => {
        const symbols = Object.keys(context.underlyings);
        if (symbols.length === 0) return { type: 'underlying', value: null, error: 'No underlyings found' };
        
        // For now, use first underlying (can be extended for multi-asset)
        const underlying = context.underlyings[symbols[0]];
        return {
          type: 'underlying',
          symbol: underlying.symbol,
          value: underlying.performanceRatio,
          performance: underlying.performance,
          description: `${underlying.symbol} performance: ${underlying.performanceRatio?.toFixed(2)}%`
        };
      },

      // Comparison operators
      comparison: async (component, context) => ({
        type: 'comparison',
        operator: component.label,
        value: parseFloat(component.value || 0),
        description: `Comparison: ${component.label} ${component.value || 0}%`
      }),

      // Actions
      action: async (component, context) => {
        const value = parseFloat(component.value || 0);
        return {
          type: 'action',
          action: component.label,
          value: value,
          description: `${component.label}: ${value}%`
        };
      },

      // Logic operators
      logic_operator: async (component, context) => ({
        type: 'logic_operator',
        operator: component.label,
        description: `Logic: ${component.label}`
      })
    };
  }

  /**
   * Get evaluator function for component type
   */
  getEvaluatorForType(type) {
    return this.evaluators[type] || this.evaluators.action;
  }

  /**
   * Summarize the evaluation results
   */
  summarizeResults(results, marketContext) {
    const symbols = Object.keys(marketContext.underlyings);
    const underlying = symbols.length > 0 ? marketContext.underlyings[symbols[0]] : null;
    
    let totalPayout = 0;
    let payoutDescription = [];
    
    // Analyze maturity section results
    if (results.maturity) {
      for (const result of results.maturity) {
        if (result.conditionMet && result.actions) {
          for (const action of result.actions) {
            if (action.type === 'action') {
              totalPayout += action.value;
              payoutDescription.push(`${action.action}: ${action.value}%`);
            }
          }
        }
      }
    }
    
    return {
      underlyingPerformance: underlying ? `${underlying.performance?.toFixed(2)}%` : 'N/A',
      performanceRatio: underlying ? `${underlying.performanceRatio?.toFixed(2)}%` : 'N/A',
      totalPayout: `${totalPayout}%`,
      payoutBreakdown: payoutDescription,
      evaluationDate: marketContext.evaluationDate,
      currency: marketContext.currency
    };
  }

  /**
   * Save evaluation report to reports collection with chart data generation
   */
  async saveEvaluationReport(product, evaluationResult, userId = null) {
    try {
      console.log('\n💾 Saving evaluation report with chart data...');
      
      // Transform evaluation result to report format
      const reportData = ReportHelpers.transformEvaluationToReport(
        product, 
        evaluationResult, 
        userId
      );
      
      // Add timestamps
      reportData.createdAt = new Date();
      reportData.generatedBy = 'rule_engine';
      reportData.version = '1.0.0';
      
      // Generate chart data
      console.log('📊 Generating chart data...');
      await this.generateAndSaveChartData(product, evaluationResult, reportData);
      
      // Update product status if it has matured
      if (evaluationResult.marketContext.hasMatured && product.status !== 'matured') {
        console.log('📅 Product has matured - updating status...');
        await this.updateProductStatus(product._id, 'matured');
      }
      
      // Save to MongoDB reports collection
      const client = new MongoClient('mongodb://127.0.0.1:3001/meteor');
      await client.connect();
      
      try {
        const db = client.db('meteor');
        
        // Remove old reports for this product to keep only the latest
        if (reportData.productId) {
          const removeResult = await db.collection('reports').deleteMany({ productId: reportData.productId });
          if (removeResult.deletedCount > 0) {
            console.log(`🧹 Removed ${removeResult.deletedCount} old reports for product: ${reportData.productId}`);
          }
        }
        
        const result = await db.collection('reports').insertOne(reportData);        return result.insertedId;
      } finally {
        await client.close();
      }
    } catch (error) {
      console.error('❌ Error saving evaluation report:', error.message);
    }
  }
  
  /**
   * Update product status in the database
   */
  async updateProductStatus(productId, newStatus) {
    console.log(`🔧 Updating product status: ${productId} (type: ${typeof productId}) -> ${newStatus}`);
    
    const client = new MongoClient('mongodb://127.0.0.1:3001/meteor');
    await client.connect();
    
    try {
      const db = client.db('meteor');
      // Handle both ObjectId and string formats
      const query = ObjectId.isValid(productId) && typeof productId === 'string' 
        ? { _id: new ObjectId(productId) }
        : { _id: productId };
        
      const result = await db.collection('products').updateOne(
        query,
        { 
          $set: { 
            status: newStatus,
            statusDate: new Date().toISOString()
          }
        }
      );
      
      if (result.modifiedCount > 0) {      } else {
        console.log(`⚠️ No product found with ID: ${productId}`);
      }
      
      return result;
    } finally {
      await client.close();
    }
  }

  /**
   * Generate and save chart data to chartData collection
   */
  async generateAndSaveChartData(product, evaluationResult, reportData) {
    try {
      // Import chart data generator (fix path for standalone execution)
      const path = require('path');
      const { pathToFileURL } = require('url');
      const chartDataGeneratorPath = path.join(__dirname, 'imports', 'api', 'chartDataGenerator.js');
      const chartDataGeneratorURL = pathToFileURL(chartDataGeneratorPath).href;
      const { ChartDataGenerator } = await import(chartDataGeneratorURL);
      const chartGenerator = new ChartDataGenerator();
      
      // Generate comprehensive chart data
      const chartData = await chartGenerator.generateChart(
        product,
        evaluationResult,
        evaluationResult.marketContext, // Market data from rule engine evaluation
        {
          evaluationDate: evaluationResult.evaluationDate || new Date(),
          productId: product._id
        }
      );
      
      if (chartData.error) {
        console.log(`⚠️ Chart generation failed: ${chartData.errorMessage}`);
        return null;
      }
      
      console.log('📈 Chart data generated successfully');
      console.log(`   - Data points: ${chartData.metadata?.dataPoints || 'N/A'}`);
      console.log(`   - Underlyings: ${chartData.metadata?.underlyingCount || 0}`);
      console.log(`   - Events: ${chartData.metadata?.eventCount || 0}`);
      console.log(`   - Barriers: ${chartData.metadata?.barrierCount || 0}`);
      
      // Save chart data to MongoDB
      const client = new MongoClient('mongodb://127.0.0.1:3001/meteor');
      await client.connect();
      
      try {
        const db = client.db('meteor');
        
        // Remove old chart data for this product
        const removeResult = await db.collection('chartData').deleteMany({ productId: product._id });
        if (removeResult.deletedCount > 0) {
          console.log(`🧹 Removed ${removeResult.deletedCount} old chart data entries for product: ${product._id}`);
        }
        
        // Insert new chart data
        const chartDataDocument = {
          productId: product._id,
          type: 'performance_chart',
          ...chartData,
          generatedAt: new Date(),
          version: chartData.metadata?.version || '2.0.0'
        };
        
        const insertResult = await db.collection('chartData').insertOne(chartDataDocument);        return insertResult.insertedId;
        
      } finally {
        await client.close();
      }
      
    } catch (error) {
      console.error('❌ Error generating/saving chart data:', error);
      return null;
    }
  }

  // Schedule is now included directly in the report object
}

// Export for use
module.exports = { GenericRuleEngine };

// Command-line execution for Meteor server integration
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    // Test mode - run with latest product
    async function testRuleEngine() {
      const client = new MongoClient('mongodb://127.0.0.1:3001/meteor');
      await client.connect();
      
      try {
        const db = client.db('meteor');
        const product = await db.collection('products').findOne({}, { sort: { createdAt: -1 } });
        
        if (product) {
          const engine = new GenericRuleEngine();
          
          // Test at different dates
          console.log('Testing at maturity date...');
          const maturityResult = await engine.evaluateProduct(product, new Date(product.maturity));
          
          console.log('\n' + '='.repeat(60));
          console.log('Testing at current date...');
          const currentResult = await engine.evaluateProduct(product, new Date());
          
        } else {
          console.log('No product found for testing');
        }
      } finally {
        await client.close();
      }
    }
    
    testRuleEngine().catch(console.error);
  } else {
    // Server integration mode - evaluate specific product
    const productId = args[0];
    const evaluationDate = args[1] ? new Date(args[1]) : new Date();
    
    async function evaluateProductById() {
      const client = new MongoClient('mongodb://127.0.0.1:3001/meteor');
      await client.connect();
      
      try {
        const db = client.db('meteor');
        const product = await db.collection('products').findOne({ _id: productId });
        
        if (!product) {
          console.error(JSON.stringify({ error: 'Product not found' }));
          process.exit(1);
        }
        
        const engine = new GenericRuleEngine();
        const result = await engine.evaluateProduct(product, evaluationDate, null, true);
        
        // Output result for parent process
        console.log(JSON.stringify({
          success: true,
          result: result,
          productId: productId,
          evaluationDate: evaluationDate.toISOString()
        }));
        
      } catch (error) {
        console.error(JSON.stringify({ error: error.message }));
        process.exit(1);
      } finally {
        await client.close();
      }
    }
    
    evaluateProductById().catch(error => {
      console.error(JSON.stringify({ error: error.message }));
      process.exit(1);
    });
  }
}