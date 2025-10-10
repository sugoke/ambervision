// Participation Products Templates
// Capital guarantee products with upside participation

// Base Participation Template
export const participationTemplate = {
  name: "Participation - Capital Guarantee",
  description: "Capital guaranteed product with upside participation in underlying performance",
  category: "Participation", 
  tags: ["participation", "capital_guarantee", "upside", "protection"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  defaultParameters: {
    capitalGuarantee: 100, // 100% capital guarantee
    participationRate: 100, // 100% participation in upside
    strikeLevel: 100 // Participation from initial level
  },
  
  droppedItems: [
    // ========== MATURITY SECTION ==========
    {
      id: 'part-mat-timing',
      type: 'timing',
      label: 'At Maturity',
      section: 'maturity',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    
    // Always guaranteed minimum return
    {
      id: 'part-mat-if',
      type: 'logic_operator',
      label: 'IF',
      section: 'maturity',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'part-mat-underlying',
      type: 'underlying',
      label: 'Underlying',
      basketType: 'single', // single, worst_of, best_of, average
      section: 'maturity',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'part-mat-comparison',
      type: 'comparison',
      label: 'Above',
      operator: '>',
      section: 'maturity',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'part-mat-strike',
      type: 'barrier',
      label: 'Strike Level',
      barrier_type: 'strike',
      defaultValue: '100',
      section: 'maturity',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    
    // THEN Participation in upside
    {
      id: 'part-mat-then',
      type: 'logic_operator',
      label: 'THEN',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'part-mat-upside',
      type: 'participation',
      label: 'Capital Guarantee + Upside Participation',
      baseReturn: '100',
      participationRate: '100',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 1
    },
    
    // ELSE Minimum guarantee
    {
      id: 'part-mat-else',
      type: 'logic_operator',
      label: 'ELSE',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'part-mat-guarantee',
      type: 'result',
      label: 'Capital Guarantee',
      baseReturn: '100',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 3
    }
  ],
  
  instructions: `
**Participation Product:**
Capital guaranteed with upside participation.

**Structure:**
- Minimum return: 100% (capital guarantee)
- If underlying > strike → 100% + participation in upside
- If underlying ≤ strike → 100% guarantee

**Example:**
- Strike: 100%, Participation: 100%
- If underlying at 120% → Return: 120%
- If underlying at 80% → Return: 100%

**Variations:**
- Adjust participation rate (50%, 150%, etc.)
- Change strike level (90%, 110%, etc.)
- Modify capital guarantee (90%, 95%, etc.)
`
};

// Shark Note Template
export const sharkNoteTemplate = {
  name: "Shark Note - Barrier Touch Rebate",
  description: "Capital guarantee with fixed rebate if underlying touches barrier during product life",
  category: "Participation",
  tags: ["shark", "barrier_touch", "rebate", "capital_guarantee"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  defaultParameters: {
    capitalGuarantee: 100,
    upBarrier: 130,
    downBarrier: 70,
    rebateCoupon: 25 // Fixed amount paid if barrier touched
  },
  
  droppedItems: [
    // ========== LIFE SECTION - Daily Barrier Monitoring ==========
    {
      id: 'shark-life-timing',
      type: 'timing',
      label: 'Live (Daily)',
      frequency: 'daily',
      section: 'life',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    
    // Check for up barrier touch
    {
      id: 'shark-life-if-up',
      type: 'logic_operator',
      label: 'IF',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'shark-life-underlying-up',
      type: 'underlying',
      label: 'Underlying',
      basketType: 'single',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'shark-life-comparison-up',
      type: 'comparison',
      label: 'At or Above',
      operator: '>=',
      section: 'life',
      column: 'condition', 
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'shark-life-up-barrier',
      type: 'barrier',
      label: 'Up Barrier',
      barrier_type: 'up_barrier',
      defaultValue: '130',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    
    // OR check for down barrier touch
    {
      id: 'shark-life-or',
      type: 'logic_operator',
      label: 'OR',
      section: 'life',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 0
    },
    {
      id: 'shark-life-underlying-down',
      type: 'underlying',
      label: 'Underlying',
      basketType: 'single',
      section: 'life',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 1
    },
    {
      id: 'shark-life-comparison-down',
      type: 'comparison',
      label: 'At or Below',
      operator: '<=',
      section: 'life',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 2
    },
    {
      id: 'shark-life-down-barrier',
      type: 'barrier',
      label: 'Down Barrier',
      barrier_type: 'down_barrier',
      defaultValue: '70',
      section: 'life',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 3
    },
    
    // THEN Set rebate flag
    {
      id: 'shark-life-then',
      type: 'logic_operator',
      label: 'THEN',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'shark-life-rebate-flag',
      type: 'memory_add',
      label: 'Activate Rebate',
      bucketName: 'barrier_touched',
      valueToStore: 'true',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 1
    },
    
    // ========== MATURITY SECTION ==========
    {
      id: 'shark-mat-timing',
      type: 'timing',
      label: 'At Maturity',
      section: 'maturity',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'shark-mat-result',
      type: 'rebate',
      label: '100% + Rebate (if barrier touched)',
      baseReturn: '100',
      rebateAmount: '25',
      condition: 'barrier_touched',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    }
  ],
  
  instructions: `
**Shark Note:**
Capital guarantee with fixed rebate if barriers are touched during product life.

**Structure:**
- Daily monitoring of up and down barriers
- If ANY barrier is touched on ANY day → rebate is earned
- At maturity: 100% + rebate (if earned)

**Example:**
- Barriers: 130% (up), 70% (down)
- Rebate: 25%
- If barrier touched → Return: 125%
- If no barrier touch → Return: 100%

**Key Features:**
- One-time barrier touch sufficient to earn rebate
- Capital is always guaranteed
- Rebate earned permanently once barrier touched
`
};

// Twin Win Template
export const twinWinTemplate = {
  name: "Twin Win - Absolute Performance",
  description: "Capital guarantee with participation in absolute value of underlying performance",
  category: "Participation",
  tags: ["twin_win", "absolute_performance", "capital_guarantee"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  defaultParameters: {
    capitalGuarantee: 100,
    participationRate: 100,
    cap: null, // Optional cap on performance
    knockOutRebate: null // Optional knock-out rebate like shark note
  },
  
  droppedItems: [
    // ========== MATURITY SECTION ==========
    {
      id: 'twin-mat-timing',
      type: 'timing',
      label: 'At Maturity',
      section: 'maturity',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'twin-mat-result',
      type: 'absolute_performance',
      label: '100% + Absolute Performance',
      baseReturn: '100',
      participationRate: '100',
      performanceType: 'absolute',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    }
  ],
  
  instructions: `
**Twin Win:**
Win on both upside and downside - investor gets absolute value of performance.

**Structure:**
- Return = 100% + |underlying performance|
- Negative performance becomes positive
- Capital guarantee ensures minimum 100%

**Examples:**
- Underlying +20% → Return: 120%
- Underlying -20% → Return: 120% (absolute value)
- Underlying -5% → Return: 105%

**Optional Features:**
- Cap on maximum performance
- Knock-out rebate (like shark note)
`
};

// Orion Basket Template  
export const orionBasketTemplate = {
  name: "Orion - Individual Stock Level Lock",
  description: "Capital guarantee with basket where individual stocks are locked at fixed performance when they touch barrier",
  category: "Participation",
  tags: ["orion", "basket", "level_lock", "individual_stocks"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  defaultParameters: {
    capitalGuarantee: 100,
    lockLevel: 120, // Lock individual stocks at 120% when touched
    numberOfStocks: 4
  },
  
  droppedItems: [
    // ========== LIFE SECTION - Individual Stock Monitoring ==========
    {
      id: 'orion-life-timing',
      type: 'timing',
      label: 'Live (Daily)',
      frequency: 'daily',
      section: 'life',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'orion-life-if',
      type: 'logic_operator',
      label: 'IF',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'orion-life-any-stock',
      type: 'underlying',
      label: 'Any Individual Stock',
      basketType: 'individual_stock',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'orion-life-comparison',
      type: 'comparison',
      label: 'At or Above',
      operator: '>=',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'orion-life-lock-barrier',
      type: 'barrier',
      label: 'Lock Level',
      barrier_type: 'lock_level',
      defaultValue: '120',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    {
      id: 'orion-life-then',
      type: 'logic_operator',
      label: 'THEN',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'orion-life-lock-stock',
      type: 'level_lock',
      label: 'Lock Stock at Level',
      bucketName: 'locked_stocks',
      lockValue: '120',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 1
    },
    
    // ========== MATURITY SECTION ==========
    {
      id: 'orion-mat-timing',
      type: 'timing',
      label: 'At Maturity',
      section: 'maturity',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'orion-mat-result',
      type: 'result',
      label: '100% + Average Performance (with locks)',
      baseReturn: '100',
      calculationType: 'basket_average_with_locks',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    }
  ],
  
  instructions: `
**Orion Product:**
Basket product where individual stocks get "locked" at fixed performance levels.

**Structure:**
- Monitor each stock individually during product life
- When stock touches lock level → stock performance is capped at that level
- At maturity: 100% + average performance (using locked levels for touched stocks)

**Example (4-stock basket):**
- Lock level: 120%
- Stock A touches 120% on day 50 → locked at 120%
- Stock B never touches → uses final performance (e.g., 110%)
- Stock C touches 120% → locked at 120%  
- Stock D never touches → uses final performance (e.g., 95%)
- Final return: 100% + avg(120%, 110%, 120%, 95%) = 111.25%

**Key Features:**
- Individual stock monitoring (not basket level)
- Permanent locking once level is touched
- Average calculation uses locked vs actual performance per stock
`
};

// Export function to insert all participation templates
export const insertParticipationProductsTemplates = async (TemplatesCollection) => {
  const templates = [
    participationTemplate,
    sharkNoteTemplate,
    twinWinTemplate,
    orionBasketTemplate
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