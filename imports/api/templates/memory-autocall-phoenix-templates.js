// Memory Autocall Phoenix and Complex Structured Products Templates
// Modular, reusable templates for sophisticated structured products

// Base Memory Autocall Phoenix Template
export const memoryAutocallPhoenixTemplate = {
  name: "Memory Autocall Phoenix - Base",
  description: "Core memory autocall structure with observation dates, step-down autocall levels, memory coupons, and capital protection at maturity",
  category: "Autocallable",
  tags: ["memory", "autocall", "phoenix", "observation", "protection"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  defaultParameters: {
    initialAutocallLevel: 100,
    couponBarrier: 65,
    protectionBarrier: 65,
    couponRate: 8.0,
    observationFrequency: "quarterly", // monthly, quarterly, semi-annual, annual
    stepDownAmount: 5 // Autocall level steps down by 5% each observation
  },
  
  droppedItems: [
    // ========== OBSERVATION DATES - Periodic Monitoring ==========
    {
      id: 'map-obs-timing',
      type: 'observation',
      label: 'Observation Date',
      frequency: 'quarterly',
      section: 'life',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    
    // Autocall Check - IF underlying >= autocall level
    {
      id: 'map-obs-if-autocall',
      type: 'logic_operator',
      label: 'IF',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'map-obs-underlying',
      type: 'underlying',
      label: 'Underlying',
      basketType: 'worst_of', // single, worst_of, best_of, average
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'map-obs-autocall-comparison',
      type: 'comparison',
      label: 'At or Above',
      operator: '>=',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'map-obs-autocall-barrier',
      type: 'barrier',
      label: 'Autocall Level',
      barrier_type: 'autocall',
      defaultValue: '100',
      stepDown: true,
      stepDownAmount: '5',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    
    // THEN Early Redemption with Memory Coupons
    {
      id: 'map-obs-then',
      type: 'logic_operator',
      label: 'THEN',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'map-obs-autocall-action',
      type: 'autocall',
      label: 'Early Redemption + Memory Coupons',
      basePayment: '100',
      includeMemoryCoupons: true,
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 1
    },
    
    // ELSE IF coupon barrier check
    {
      id: 'map-obs-else-if',
      type: 'logic_operator',
      label: 'ELSE IF',
      section: 'life',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 0
    },
    {
      id: 'map-obs-underlying-coupon',
      type: 'underlying',
      label: 'Underlying',
      basketType: 'worst_of',
      section: 'life',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 1
    },
    {
      id: 'map-obs-coupon-comparison',
      type: 'comparison',
      label: 'At or Above',
      operator: '>=',
      section: 'life',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 2
    },
    {
      id: 'map-obs-coupon-barrier',
      type: 'barrier',
      label: 'Coupon Barrier',
      barrier_type: 'coupon',
      defaultValue: '65',
      section: 'life',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 3
    },
    
    // THEN Pay Coupon + Memory Coupons
    {
      id: 'map-obs-coupon-then',
      type: 'logic_operator',
      label: 'THEN',
      section: 'life',
      column: 'action',
      rowIndex: 1,
      sortOrder: 0
    },
    {
      id: 'map-obs-coupon-payment',
      type: 'memory_coupon',
      label: 'Pay Coupon + Memory',
      couponRate: '8.0',
      includeMemory: true,
      section: 'life',
      column: 'action',
      rowIndex: 1,
      sortOrder: 1
    },
    
    // ELSE Store Coupon in Memory
    {
      id: 'map-obs-else',
      type: 'logic_operator',
      label: 'ELSE',
      section: 'life',
      column: 'action',
      rowIndex: 1,
      sortOrder: 2
    },
    {
      id: 'map-obs-memory-store',
      type: 'memory_add',
      label: 'Store Coupon in Memory',
      bucketName: 'unpaidCoupons',
      valueToStore: '8.0',
      section: 'life',
      column: 'action',
      rowIndex: 1,
      sortOrder: 3
    },
    
    // ========== MATURITY SECTION ==========
    {
      id: 'map-mat-timing',
      type: 'timing',
      label: 'At Maturity',
      section: 'maturity',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    
    // Capital Protection Check
    {
      id: 'map-mat-if-protection',
      type: 'logic_operator',
      label: 'IF',
      section: 'maturity',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'map-mat-underlying',
      type: 'underlying',
      label: 'Underlying',
      basketType: 'worst_of',
      section: 'maturity',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'map-mat-protection-comparison',
      type: 'comparison',
      label: 'At or Above',
      operator: '>=',
      section: 'maturity',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'map-mat-protection-barrier',
      type: 'barrier',
      label: 'Protection Barrier',
      barrier_type: 'protection',
      defaultValue: '65',
      section: 'maturity',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    
    // THEN Protected Return + Memory Coupons
    {
      id: 'map-mat-protection-then',
      type: 'logic_operator',
      label: 'THEN',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'map-mat-protected-return',
      type: 'result',
      label: '100% + Memory Coupons',
      baseReturn: '100',
      includeMemoryCoupons: true,
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 1
    },
    
    // ELSE Downside Exposure + Memory Coupons
    {
      id: 'map-mat-else',
      type: 'logic_operator',
      label: 'ELSE',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'map-mat-downside',
      type: 'result',
      label: 'Underlying Performance + Memory Coupons',
      exposureType: 'direct', // direct or leveraged
      multiplier: '1.0',
      includeMemoryCoupons: true,
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 3
    }
  ],
  
  instructions: `
This is the base Memory Autocall Phoenix template with core features:

**Key Features:**
- Quarterly observation dates (configurable)
- Step-down autocall levels (starts at 100%, reduces by 5% each observation)
- Memory coupon accumulation (unpaid coupons accumulate)
- Capital protection at maturity (65% barrier)

**Observation Logic:**
1. IF underlying ≥ autocall level → Early redemption + all memory coupons
2. ELSE IF underlying ≥ coupon barrier → Pay coupon + all memory coupons  
3. ELSE → Store coupon in memory, continue

**Maturity Logic:**
1. IF underlying ≥ protection barrier → 100% + memory coupons
2. ELSE → Underlying performance + memory coupons

**To Use:**
1. Set underlying (single stock, basket, or index)
2. Adjust barriers and coupon rate as needed
3. Combine with extension modules for additional features
`
};

// Memory Lock Extension Template
export const memoryLockExtensionTemplate = {
  name: "Memory Lock Extension",
  description: "Extension module: Autocall triggers when ALL stocks have been observed above autocall level (even on different dates)",
  category: "Extension",
  tags: ["memory_lock", "extension", "all_stocks", "modular"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  defaultParameters: {
    requireAllStocks: true
  },
  
  // This replaces/modifies the autocall logic in the base template
  droppedItems: [
    {
      id: 'ml-obs-timing',
      type: 'observation',
      label: 'Observation Date',
      section: 'life',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'ml-obs-memory-lock-check',
      type: 'memory_lock',
      label: 'Check Memory Lock',
      condition: 'all_stocks_above_autocall',
      memoryBucket: 'stocks_above_autocall',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'ml-obs-if-all-triggered',
      type: 'logic_operator',
      label: 'IF',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'ml-obs-all-stocks-condition',
      type: 'underlying',
      label: 'All Stocks Above Autocall',
      basketType: 'all_above_threshold',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'ml-obs-autocall-action',
      type: 'autocall',
      label: 'Memory Lock Autocall + Memory Coupons',
      basePayment: '100',
      includeMemoryCoupons: true,
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    }
  ],
  
  instructions: `
**Memory Lock Extension:**
This modifies the standard autocall logic to require ALL stocks in a basket to have been observed above the autocall level (can be on different dates).

**How it works:**
- System tracks which stocks have been above autocall level on any observation
- Autocall only triggers when ALL stocks have been recorded above threshold
- Stocks don't need to be above threshold simultaneously - memory is used

**Usage:**
- Add this extension to Memory Autocall Phoenix base template
- Works with multi-asset baskets (not applicable to single stocks)
`
};

// American Barrier Extension Template  
export const americanBarrierExtensionTemplate = {
  name: "American Barrier Extension",
  description: "Extension module: Daily monitoring - if underlying touches protection barrier, capital protection is permanently removed",
  category: "Extension", 
  tags: ["american_barrier", "extension", "daily_monitoring", "knock_in"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  defaultParameters: {
    monitoringFrequency: "daily"
  },
  
  droppedItems: [
    {
      id: 'ab-daily-timing',
      type: 'timing',
      label: 'Live (Daily)',
      frequency: 'daily',
      section: 'life',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'ab-daily-if',
      type: 'logic_operator',
      label: 'IF',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'ab-daily-underlying',
      type: 'underlying',
      label: 'Underlying',
      basketType: 'worst_of',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'ab-daily-comparison',
      type: 'comparison',
      label: 'Below',
      operator: '<',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'ab-daily-barrier',
      type: 'barrier',
      label: 'Protection Barrier',
      barrier_type: 'american_knock_in',
      defaultValue: '65',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    {
      id: 'ab-daily-then',
      type: 'logic_operator',
      label: 'THEN',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'ab-daily-knock-in',
      type: 'american_barrier',
      label: 'Remove Capital Protection',
      action: 'disable_protection',
      permanent: true,
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 1
    }
  ],
  
  instructions: `
**American Barrier Extension:**
Adds daily monitoring that permanently removes capital protection if barrier is touched.

**Key Features:**
- Daily closing price monitoring
- If underlying closes below protection barrier on ANY day → protection permanently lost
- At maturity: no protection, direct exposure to underlying performance
- Memory coupons still apply

**Usage:**
- Add to any template with capital protection
- Changes maturity payoff when barrier is breached
`
};

// First Month Enhancement Template
export const firstMonthEnhancementTemplate = {
  name: "First Month Enhancement",
  description: "Extension module: If underlying doesn't fall below X% in first month, coupon rate doubles",
  category: "Extension",
  tags: ["first_month", "enhancement", "coupon_boost", "monitoring"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  defaultParameters: {
    enhancementThreshold: 85, // Don't fall below 85% in first month
    enhancedCouponMultiplier: 2.0 // Double the coupon rate
  },
  
  droppedItems: [
    {
      id: 'fme-first-month-timing',
      type: 'first_period_monitor',
      label: 'First Month Monitoring',
      period: '30_days',
      section: 'life',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'fme-if-stable',
      type: 'logic_operator',
      label: 'IF',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'fme-underlying',
      type: 'underlying',
      label: 'Underlying',
      basketType: 'worst_of',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'fme-comparison',
      type: 'comparison',
      label: 'Never Below',
      operator: 'never_below',
      period: 'first_month',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'fme-threshold',
      type: 'barrier',
      label: 'Enhancement Threshold',
      barrier_type: 'enhancement',
      defaultValue: '85',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    {
      id: 'fme-then',
      type: 'logic_operator',
      label: 'THEN',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'fme-enhance-coupon',
      type: 'memory_add',
      label: 'Double Coupon Rate',
      bucketName: 'coupon_enhancement',
      valueToStore: '2.0',
      action: 'multiply_coupon_rate',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 1
    }
  ],
  
  instructions: `
**First Month Enhancement:**
Monitors performance during the first month to determine if coupon rate should be enhanced.

**Logic:**
- If underlying never closes below 85% during first 30 days
- Then all future coupons are doubled (8% becomes 16%)
- Enhancement applies to both paid coupons and memory coupons

**Usage:**
- Add to any template with coupons
- Adjust threshold and multiplier as needed
`
};

// Jump Feature Extension Template
export const jumpFeatureExtensionTemplate = {
  name: "Jump Feature Extension", 
  description: "Extension module: Final coupon can be underlying performance if higher than standard coupon",
  category: "Extension",
  tags: ["jump", "final_coupon", "performance", "enhancement"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  defaultParameters: {
    standardCouponRate: 8.0
  },
  
  // This modifies the final observation/maturity coupon logic
  droppedItems: [
    {
      id: 'jf-final-obs-timing',
      type: 'observation',
      label: 'Final Observation',
      isFinalObservation: true,
      section: 'life',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'jf-jump-if',
      type: 'logic_operator',
      label: 'IF',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'jf-underlying-performance',
      type: 'underlying',
      label: 'Underlying Performance',
      basketType: 'worst_of',
      measureType: 'performance_percent',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'jf-comparison',
      type: 'comparison',
      label: 'Greater Than',
      operator: '>',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'jf-coupon-rate',
      type: 'value',
      label: 'Standard Coupon Rate',
      defaultValue: '8.0',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    {
      id: 'jf-then',
      type: 'logic_operator',
      label: 'THEN',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'jf-jump-coupon',
      type: 'jump_coupon',
      label: 'Use Performance as Final Coupon',
      couponSource: 'underlying_performance',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'jf-else',
      type: 'logic_operator',
      label: 'ELSE',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'jf-standard-coupon',
      type: 'memory_coupon',
      label: 'Pay Standard Coupon',
      couponRate: '8.0',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 3
    }
  ],
  
  instructions: `
**Jump Feature Extension:**
Final coupon payment can "jump" to underlying performance if it's higher than the standard coupon.

**Logic:**
- On final observation, compare underlying performance vs standard coupon rate
- If performance > coupon rate → final coupon = performance
- Else → final coupon = standard rate
- Memory coupons still apply as normal

**Example:**
- Standard coupon: 8%
- Final underlying performance: 15%
- Final coupon paid: 15% (jumps to performance)

**Usage:**
- Add to templates with observation-based coupons
- Provides upside participation on final coupon only
`
};

// Export function to insert all templates
export const insertMemoryAutocallPhoenixTemplates = async (TemplatesCollection) => {
  const templates = [
    memoryAutocallPhoenixTemplate,
    memoryLockExtensionTemplate, 
    americanBarrierExtensionTemplate,
    firstMonthEnhancementTemplate,
    jumpFeatureExtensionTemplate
  ];
  
  const results = [];
  
  for (const template of templates) {
    try {
      // Check if template already exists
      const existing = await TemplatesCollection.findOneAsync({ 
        name: template.name,
        version: template.version 
      });
      
      if (!existing) {
        const templateId = await TemplatesCollection.insertAsync(template);
        results.push({
          name: template.name,
          id: templateId,
          status: 'inserted'
        });
      } else {
        results.push({
          name: template.name,
          id: existing._id,
          status: 'exists'
        });
      }
    } catch (error) {
      results.push({
        name: template.name,
        status: 'error',
        error: error.message
      });
    }
  }
  
  return results;
};