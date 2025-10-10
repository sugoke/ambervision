// Complex Products Templates - Main Import File
// Imports and exports all complex structured product templates

import { 
  memoryAutocallPhoenixTemplate,
  memoryLockExtensionTemplate,
  americanBarrierExtensionTemplate,
  firstMonthEnhancementTemplate,
  jumpFeatureExtensionTemplate,
  insertMemoryAutocallPhoenixTemplates
} from './memory-autocall-phoenix-templates.js';

import {
  participationTemplate,
  sharkNoteTemplate,
  twinWinTemplate,
  orionBasketTemplate,
  insertParticipationProductsTemplates
} from './participation-products-templates.js';

// Combined export of all templates
export const COMPLEX_PRODUCT_TEMPLATES = [
  // Memory Autocall Phoenix family
  memoryAutocallPhoenixTemplate,
  memoryLockExtensionTemplate,
  americanBarrierExtensionTemplate,
  firstMonthEnhancementTemplate,
  jumpFeatureExtensionTemplate,
  
  // Participation products family
  participationTemplate,
  sharkNoteTemplate,
  twinWinTemplate,
  orionBasketTemplate
];

// Master function to insert all complex product templates
export const insertAllComplexProductTemplates = async (TemplatesCollection) => {
  console.log('🏗️  Inserting complex structured product templates...');
  
  const results = [];
  
  try {
    // Insert Memory Autocall Phoenix templates
    const phoenixResults = await insertMemoryAutocallPhoenixTemplates(TemplatesCollection);
    results.push(...phoenixResults);
    
    // Insert Participation product templates
    const participationResults = await insertParticipationProductsTemplates(TemplatesCollection);
    results.push(...participationResults);
    
    // Summary
    const inserted = results.filter(r => r.status === 'inserted').length;
    const existing = results.filter(r => r.status === 'exists').length;
    const errors = results.filter(r => r.status === 'error').length;
    
    console.log(`✅ Complex templates insertion complete:`);
    console.log(`   - Inserted: ${inserted} new templates`);
    console.log(`   - Already existed: ${existing} templates`);
    console.log(`   - Errors: ${errors} templates`);
    
    if (errors > 0) {
      console.log('❌ Template insertion errors:');
      results.filter(r => r.status === 'error').forEach(r => {
        console.log(`   - ${r.name}: ${r.error}`);
      });
    }
    
    return results;
    
  } catch (error) {
    console.error('❌ Error inserting complex product templates:', error);
    throw error;
  }
};

// Template categories for UI organization
export const COMPLEX_PRODUCT_CATEGORIES = {
  AUTOCALLABLE: {
    name: 'Autocallable',
    description: 'Memory autocall products with observation dates',
    templates: [
      'Memory Autocall Phoenix - Base'
    ]
  },
  EXTENSIONS: {
    name: 'Extensions',
    description: 'Modular extensions to add features to base products',
    templates: [
      'Memory Lock Extension',
      'American Barrier Extension', 
      'First Month Enhancement',
      'Jump Feature Extension'
    ]
  },
  PARTICIPATION: {
    name: 'Participation',
    description: 'Capital guarantee products with upside participation',  
    templates: [
      'Participation - Capital Guarantee',
      'Shark Note - Barrier Touch Rebate',
      'Twin Win - Absolute Performance',
      'Orion - Individual Stock Level Lock'
    ]
  }
};

// Template combination suggestions
export const TEMPLATE_COMBINATIONS = [
  {
    name: "Enhanced Memory Autocall Phoenix",
    description: "Full-featured autocall with memory lock, american barrier, and jump feature",
    baseTemplate: "Memory Autocall Phoenix - Base",
    extensions: [
      "Memory Lock Extension",
      "American Barrier Extension", 
      "Jump Feature Extension"
    ],
    complexity: "High"
  },
  {
    name: "Simple Memory Phoenix",
    description: "Basic memory autocall with first month enhancement",
    baseTemplate: "Memory Autocall Phoenix - Base",
    extensions: [
      "First Month Enhancement"
    ],
    complexity: "Medium"
  },
  {
    name: "Enhanced Participation Note",
    description: "Participation product with barrier touch rebate feature",
    baseTemplate: "Participation - Capital Guarantee",
    extensions: [
      "Shark Note - Barrier Touch Rebate"
    ],
    complexity: "Medium"
  }
];

// Component type definitions for new complex product features
export const NEW_COMPONENT_TYPES = {
  // Memory and autocall components
  MEMORY_COUPON: {
    type: 'memory_coupon',
    description: 'Coupon payment with memory accumulation',
    properties: ['couponRate', 'includeMemory']
  },
  AUTOCALL: {
    type: 'autocall',
    description: 'Early redemption with memory coupons',
    properties: ['basePayment', 'includeMemoryCoupons']
  },
  MEMORY_LOCK: {
    type: 'memory_lock',
    description: 'Autocall when all stocks above level (different dates)',
    properties: ['condition', 'memoryBucket', 'requireAllStocks']
  },
  
  // Barrier and monitoring components
  AMERICAN_BARRIER: {
    type: 'american_barrier', 
    description: 'Daily monitoring that removes protection permanently',
    properties: ['action', 'permanent', 'monitoringFrequency']
  },
  FIRST_PERIOD_MONITOR: {
    type: 'first_period_monitor',
    description: 'Monitor performance during initial period',
    properties: ['period', 'enhancementThreshold']
  },
  
  // Performance and payout components
  PARTICIPATION: {
    type: 'participation',
    description: 'Capital guarantee with upside participation',
    properties: ['baseReturn', 'participationRate', 'strikeLevel']
  },
  ABSOLUTE_PERFORMANCE: {
    type: 'absolute_performance',
    description: 'Participation in absolute value of performance',
    properties: ['baseReturn', 'participationRate', 'performanceType']
  },
  REBATE: {
    type: 'rebate',
    description: 'Fixed payment if condition met',
    properties: ['baseReturn', 'rebateAmount', 'condition']
  },
  JUMP_COUPON: {
    type: 'jump_coupon',
    description: 'Coupon can jump to underlying performance',
    properties: ['couponSource', 'standardRate']
  },
  LEVEL_LOCK: {
    type: 'level_lock',
    description: 'Lock individual assets at specific performance levels',
    properties: ['bucketName', 'lockValue', 'permanent']
  }
};

// Usage documentation
export const TEMPLATE_USAGE_GUIDE = `
# Complex Structured Products Templates

## Template Architecture

These templates are designed to be **modular and combinable**. Each template falls into one of three categories:

### 1. Base Templates
- **Memory Autocall Phoenix**: Core autocall structure with memory coupons
- **Participation - Capital Guarantee**: Base participation structure

### 2. Extension Templates  
- **Memory Lock Extension**: Requires all stocks to trigger autocall
- **American Barrier Extension**: Daily monitoring removes protection
- **First Month Enhancement**: Coupon boost for stable first month
- **Jump Feature Extension**: Final coupon can be performance

### 3. Specialized Templates
- **Shark Note**: Barrier touch rebate
- **Twin Win**: Absolute performance participation  
- **Orion**: Individual stock level locking

## How to Combine Templates

1. **Start with a base template** (Memory Autocall Phoenix or Participation)
2. **Add extension modules** as needed for specific features
3. **Adjust parameters** to match product specifications
4. **Test combinations** to ensure logic flows correctly

## Example Product Configurations

### Memory-Autocall-Phoenix-Memory-Lock
\`\`\`
Base: Memory Autocall Phoenix - Base
Extensions: 
  - Memory Lock Extension
  - First Month Enhancement
  
Parameters:
  - Observation: Quarterly
  - Initial Autocall: 100%, step down 5%
  - Coupon Barrier: 65%
  - Memory Lock: All stocks must be above autocall
  - First Month: If stable, double coupon rate
\`\`\`

### Enhanced Participation Note
\`\`\`
Base: Participation - Capital Guarantee  
Extensions:
  - Shark Note - Barrier Touch Rebate
  
Parameters:
  - Capital Guarantee: 100%
  - Participation Rate: 100%
  - Barriers: 130% up, 70% down
  - Rebate: 25% if barrier touched
\`\`\`

## New Component Types

The templates introduce several new component types for complex features:
- \`memory_coupon\`: Coupon with memory accumulation
- \`autocall\`: Early redemption with memory
- \`memory_lock\`: All-stocks-above condition
- \`american_barrier\`: Daily monitoring
- \`participation\`: Upside participation
- \`absolute_performance\`: Twin win structure
- \`rebate\`: Fixed barrier rebate
- \`level_lock\`: Individual stock locking

These components can be mixed and matched to create novel product structures.
`;