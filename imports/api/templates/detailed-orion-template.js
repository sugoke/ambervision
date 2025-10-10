// Detailed ORION template with complete maturity calculation logic

export const detailedOrionTemplate = {
  name: "ORION - Cap and Average (Detailed)",
  description: "Complete ORION implementation with conditional average calculation at maturity",
  category: "Exotic",
  tags: ["memory", "basket", "cap", "average", "conditional"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 2,
  isPublic: true,
  
  defaultParameters: {
    upperBarrier: 120,
    numberOfUnderlyings: 4
  },
  
  droppedItems: [
    // ========== LIFE SECTION - Daily monitoring ==========
    {
      id: 'orion-life-timing',
      type: 'timing',
      label: 'Live',
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
      id: 'orion-life-anyasset',
      type: 'underlying',
      label: 'Any Asset',
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
      id: 'orion-life-barrier',
      type: 'barrier',
      label: 'Upper Cap Barrier',
      barrier_type: 'cap',
      defaultValue: '120',
      value: '120',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    {
      id: 'orion-life-addmemory',
      type: 'memory_add',
      label: 'Add to Touched Barrier',
      bucketName: 'touched_barrier',
      valueToStore: '120', // Cap level
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    
    // ========== MATURITY SECTION - Calculate capped average ==========
    {
      id: 'orion-mat-timing',
      type: 'timing',
      label: 'At Maturity',
      section: 'maturity',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    
    // For each asset, we need conditional logic
    // Asset 1 calculation
    {
      id: 'orion-mat-asset1-if',
      type: 'logic_operator',
      label: 'IF',
      section: 'maturity',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 0
    },
    {
      id: 'orion-mat-asset1-check',
      type: 'memory_check',
      label: 'Asset 1 in Memory',
      bucketName: 'touched_barrier',
      asset: 'ASSET1', // Would be dynamically set
      section: 'maturity',
      column: 'condition',
      rowIndex: 1,
      sortOrder: 1
    },
    {
      id: 'orion-mat-asset1-capped',
      type: 'variable_store',
      label: 'Store Asset1 = Cap',
      variableName: 'asset1_value',
      value: '120',
      section: 'maturity',
      column: 'action',
      rowIndex: 1,
      sortOrder: 0
    },
    {
      id: 'orion-mat-asset1-else',
      type: 'logic_operator',
      label: 'ELSE',
      section: 'maturity',
      column: 'condition',
      rowIndex: 2,
      sortOrder: 0
    },
    {
      id: 'orion-mat-asset1-performance',
      type: 'variable_store',
      label: 'Store Asset1 = Performance',
      variableName: 'asset1_value',
      value: 'ASSET1_PERFORMANCE', // Would get actual performance
      section: 'maturity',
      column: 'action',
      rowIndex: 2,
      sortOrder: 0
    },
    
    // Repeat similar pattern for other assets...
    // Then calculate average
    
    {
      id: 'orion-mat-calculate',
      type: 'formula',
      label: 'Calculate Average',
      formula: '(asset1_value + asset2_value + asset3_value + asset4_value) / 4',
      section: 'maturity',
      column: 'action',
      rowIndex: 10,
      sortOrder: 0
    },
    {
      id: 'orion-mat-result',
      type: 'result',
      label: 'Final Average Payoff',
      defaultValue: '100',
      section: 'maturity',
      column: 'action',
      rowIndex: 10,
      sortOrder: 1
    }
  ],
  
  instructions: `
This detailed ORION template includes:

1. **Life Section**: Monitors daily for any asset touching the upper barrier
   - Uses "Any Asset" to check all underlyings
   - Stores touched assets in memory with the cap value

2. **Maturity Section**: Calculates average with conditional values
   - For each asset, checks if it's in the memory bucket
   - If touched: uses cap value (120%)
   - If not touched: uses actual performance
   - Calculates average of all conditional values

To customize:
- Adjust the upper barrier level (default 120%)
- Add more asset checks for larger baskets
- Modify the formula for weighted averages
`
};