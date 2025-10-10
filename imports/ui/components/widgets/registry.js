/**
 * Widget Registry - Maps feature flags to available widgets/cards
 * 
 * This registry provides a flexible mapping system that allows the report
 * generator to dynamically select appropriate widgets based on detected
 * product features, without hardcoding product-specific logic.
 */

import { ItemTypes } from '../../../api/componentTypes.js';

/**
 * Available widget components and their metadata
 */
export const WIDGET_COMPONENTS = {
  // Termination and Autocall widgets
  AutocallCard: {
    component: 'AutocallCard',
    title: 'Autocall Levels',
    icon: '🎯',
    description: 'Early termination triggers and conditions',
    category: 'termination'
  },
  
  // Barrier monitoring widgets
  BarrierMonitorCard: {
    component: 'BarrierMonitorCard', 
    title: 'Barrier Monitor',
    icon: '🚧',
    description: 'Real-time barrier level monitoring',
    category: 'protection'
  },
  
  ProtectionMonitorCard: {
    component: 'ProtectionMonitorCard',
    title: 'Protection Monitor', 
    icon: '🛡️',
    description: 'Downside protection status and distance',
    category: 'protection'
  },
  
  // Payment and coupon widgets
  CouponScheduleCard: {
    component: 'CouponScheduleCard',
    title: 'Coupon Schedule',
    icon: '💰',
    description: 'Periodic payment schedule and history',
    category: 'payments'
  },
  
  PaymentScheduleCard: {
    component: 'PaymentScheduleCard',
    title: 'Payment Schedule',
    icon: '📅',
    description: 'All product payments and timeline',
    category: 'payments'
  },
  
  // Performance and payoff widgets
  PayoffDiagramCard: {
    component: 'PayoffDiagramCard',
    title: 'Payoff Diagram',
    icon: '📊',
    description: 'Payoff structure visualization',
    category: 'performance'
  },
  
  // Multi-asset widgets
  BasketComparisonView: {
    component: 'BasketComparisonView',
    title: 'Basket Comparison',
    icon: '⚖️',
    description: 'Multi-asset performance comparison',
    category: 'assets'
  },
  
  // Advanced calculation widgets
  FormulaCalculatorView: {
    component: 'FormulaCalculatorView',
    title: 'Formula Calculator',
    icon: '🧮',
    description: 'Mathematical formula evaluation',
    category: 'calculations'
  },
  
  // Memory and accumulation widgets
  MemoryTrackerCard: {
    component: 'MemoryTrackerCard',
    title: 'Memory Tracker',
    icon: '🧠',
    description: 'Memory feature status and history',
    category: 'memory'
  },
  
  // Range and accrual widgets
  RangeAccrualCard: {
    component: 'RangeAccrualCard',
    title: 'Range Accrual',
    icon: '📏',
    description: 'Range accrual tracking and status',
    category: 'accrual'
  }
};

/**
 * Feature-to-widget mapping rules
 * Each rule defines:
 * - conditions: Feature flags and their required values
 * - widgets: List of widgets to include when conditions are met
 * - priority: Higher priority widgets appear first (optional)
 */
export const FEATURE_WIDGET_MAPPINGS = [
  // Autocall features
  {
    name: 'autocall_monitoring',
    conditions: {
      hasEarlyTermination: true,
      earlyTerminationType: ['autocall', 'callable']
    },
    widgets: ['AutocallCard'],
    priority: 90
  },
  
  // Barrier features
  {
    name: 'barrier_monitoring', 
    conditions: {
      hasDownsideProtection: true
    },
    widgets: ['BarrierMonitorCard', 'ProtectionMonitorCard'],
    priority: 85
  },
  
  // Coupon features
  {
    name: 'coupon_schedule',
    conditions: {
      hasPeriodicPayments: true
    },
    widgets: ['CouponScheduleCard', 'PaymentScheduleCard'],
    priority: 80
  },
  
  // Memory features
  {
    name: 'memory_tracking',
    conditions: {
      hasMemoryFeature: true
    },
    widgets: ['MemoryTrackerCard'],
    priority: 75
  },
  
  // Multi-asset features
  {
    name: 'basket_analysis',
    conditions: {
      isMultiAsset: true,
      underlyingCount: (count) => count > 1
    },
    widgets: ['BasketComparisonView'],
    priority: 70
  },
  
  // Mathematical features
  {
    name: 'formula_calculations',
    conditions: {
      hasMathematicalOperations: true,
      hasFormulas: true
    },
    widgets: ['FormulaCalculatorView'],
    priority: 65
  },
  
  // Range accrual features
  {
    name: 'range_accrual',
    conditions: {
      hasRangeAccumulation: true
    },
    widgets: ['RangeAccrualCard'],
    priority: 60
  },
  
  // Always show payoff diagram for any product
  {
    name: 'payoff_visualization',
    conditions: {
      // Always true - every product gets a payoff diagram
    },
    widgets: ['PayoffDiagramCard'],
    priority: 50
  }
];

/**
 * Default layout configurations for different widget categories
 */
export const LAYOUT_PRESETS = {
  standard: {
    columns: 2,
    maxWidgetsPerRow: 2,
    categories: ['termination', 'protection', 'payments', 'performance']
  },
  
  advanced: {
    columns: 3,
    maxWidgetsPerRow: 3,
    categories: ['termination', 'protection', 'payments', 'performance', 'calculations', 'memory']
  },
  
  compact: {
    columns: 1,
    maxWidgetsPerRow: 1,
    categories: ['termination', 'protection', 'performance']
  }
};

/**
 * Widget Registry Class
 */
export class WidgetRegistry {
  constructor() {
    this.mappings = FEATURE_WIDGET_MAPPINGS;
    this.components = WIDGET_COMPONENTS;
    this.layouts = LAYOUT_PRESETS;
  }
  
  /**
   * Get widgets based on feature flags
   * @param {Object} featureFlags - Detected feature flags from ProductTypeAnalyzer
   * @param {Object} options - Additional options
   * @returns {Array} - Selected widgets with metadata
   */
  selectWidgets(featureFlags, options = {}) {
    const {
      maxWidgets = 10,
      excludeCategories = [],
      layoutPreset = 'standard'
    } = options;
    
    const selectedWidgets = [];
    
    // Evaluate each mapping rule
    for (const mapping of this.mappings) {
      if (this.evaluateConditions(mapping.conditions, featureFlags)) {
        for (const widgetKey of mapping.widgets) {
          const widget = this.components[widgetKey];
          if (widget && !excludeCategories.includes(widget.category)) {
            selectedWidgets.push({
              ...widget,
              key: widgetKey,
              priority: mapping.priority || 50,
              ruleName: mapping.name
            });
          }
        }
      }
    }
    
    // Sort by priority (highest first) and remove duplicates
    const uniqueWidgets = this.deduplicateWidgets(selectedWidgets);
    uniqueWidgets.sort((a, b) => (b.priority || 50) - (a.priority || 50));
    
    // Apply layout configuration
    const layoutConfig = this.layouts[layoutPreset] || this.layouts.standard;
    const filteredWidgets = this.applyLayoutConstraints(uniqueWidgets, layoutConfig, maxWidgets);
    
    return filteredWidgets;
  }
  
  /**
   * Evaluate conditions against feature flags
   * @param {Object} conditions - Conditions to evaluate
   * @param {Object} featureFlags - Feature flags to test
   * @returns {boolean} - Whether conditions are met
   */
  evaluateConditions(conditions, featureFlags) {
    for (const [key, expectedValue] of Object.entries(conditions)) {
      const actualValue = featureFlags[key];
      
      // Handle function-based conditions
      if (typeof expectedValue === 'function') {
        if (!expectedValue(actualValue)) {
          return false;
        }
        continue;
      }
      
      // Handle array conditions (OR logic)
      if (Array.isArray(expectedValue)) {
        if (!expectedValue.includes(actualValue)) {
          return false;
        }
        continue;
      }
      
      // Handle exact match conditions
      if (actualValue !== expectedValue) {
        return false;
      }
    }
    
    return true;
  }
  
  /**
   * Remove duplicate widgets (keep highest priority)
   * @param {Array} widgets - Widget array
   * @returns {Array} - Deduplicated widgets
   */
  deduplicateWidgets(widgets) {
    const widgetMap = new Map();
    
    for (const widget of widgets) {
      const existing = widgetMap.get(widget.key);
      if (!existing || (widget.priority || 50) > (existing.priority || 50)) {
        widgetMap.set(widget.key, widget);
      }
    }
    
    return Array.from(widgetMap.values());
  }
  
  /**
   * Apply layout constraints to widget selection
   * @param {Array} widgets - Selected widgets
   * @param {Object} layoutConfig - Layout configuration
   * @param {number} maxWidgets - Maximum widgets to include
   * @returns {Array} - Layout-constrained widgets
   */
  applyLayoutConstraints(widgets, layoutConfig, maxWidgets) {
    // Filter by allowed categories
    const categoryFiltered = widgets.filter(w => 
      layoutConfig.categories.includes(w.category)
    );
    
    // Limit total count
    const limitedWidgets = categoryFiltered.slice(0, maxWidgets);
    
    // Add layout metadata
    return limitedWidgets.map((widget, index) => ({
      ...widget,
      layout: {
        order: index,
        column: index % layoutConfig.columns,
        row: Math.floor(index / layoutConfig.columns)
      }
    }));
  }
  
  /**
   * Get widget component by key
   * @param {string} key - Widget key
   * @returns {Object|null} - Widget component info
   */
  getWidget(key) {
    return this.components[key] || null;
  }
  
  /**
   * Register a new widget
   * @param {string} key - Widget key
   * @param {Object} widget - Widget component info
   */
  registerWidget(key, widget) {
    this.components[key] = widget;
  }
  
  /**
   * Add a new feature mapping
   * @param {Object} mapping - Feature mapping rule
   */
  addMapping(mapping) {
    this.mappings.push(mapping);
  }
}

// Global registry instance
export const globalWidgetRegistry = new WidgetRegistry();