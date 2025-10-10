// Template definitions for ORION and Himalaya products
// These can be imported into the TemplatesCollection

export const orionTemplate = {
  name: "ORION - Cap and Average",
  description: "At maturity, investor receives average performance of basket with upper barrier cap. Assets touching the barrier during life are capped at barrier level.",
  category: "Exotic",
  tags: ["memory", "basket", "cap", "average"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  // Default parameters
  defaultParameters: {
    upperBarrier: 120,
    numberOfUnderlyings: 4
  },
  
  // Payoff structure - using droppedItems for UI compatibility
  droppedItems: [
    // Life section - Monitor for barrier touches
    {
      id: 'orion-life-1',
      type: 'timing',
      label: 'Live',
      section: 'life',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'orion-life-2',
      type: 'logic_operator',
      label: 'IF',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'orion-life-3',
      type: 'underlying',
      label: 'Any Asset',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'orion-life-4',
      type: 'comparison',
      label: 'At or Above',
      operator: '>=',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 2
    },
    {
      id: 'orion-life-5',
      type: 'barrier',
      label: 'Upper Barrier',
      barrier_type: 'cap',
      defaultValue: '120',
      value: '120',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 3
    },
    {
      id: 'orion-life-6',
      type: 'memory_add',
      label: 'Add to Memory',
      bucketName: 'touched_barrier',
      valueToStore: '120',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    
    // Maturity section - Calculate average with caps
    {
      id: 'orion-mat-1',
      type: 'timing',
      label: 'At Maturity',
      section: 'maturity',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'orion-mat-2',
      type: 'result',
      label: 'Average Performance (with caps)',
      defaultValue: '100',
      section: 'maturity',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    }
  ],
  
  // Instructions for users
  instructions: `
This template creates an ORION product where:
1. During the product life, we monitor if any asset touches the upper barrier
2. Assets that touch the barrier are capped at the barrier level
3. At maturity, the payoff is the average performance of all assets (with caps applied)

To use this template:
1. Set your basket of underlyings
2. Adjust the upper barrier level if needed (default 120%)
3. The maturity calculation will need to be configured to check each asset's cap status
`
};

export const himalayaTemplate = {
  name: "Himalaya - Best Performer Selection",
  description: "At each observation, select best performing asset (excluding previously selected). Final payoff is average of selected performances.",
  category: "Exotic",
  tags: ["memory", "basket", "selection", "best-of"],
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
  isPublic: true,
  
  // Default parameters
  defaultParameters: {
    numberOfObservations: 4,
    numberOfUnderlyings: 4
  },
  
  // Payoff structure (simplified - would need rows for each observation)
  droppedItems: [
    // Observation pattern - Find and store best performer
    {
      id: 'himalaya-obs-1',
      type: 'observation',
      label: 'Observation Date',
      section: 'life',
      column: 'timing',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'himalaya-obs-2',
      type: 'logic_operator',
      label: 'IF',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'himalaya-obs-3',
      type: 'best_of_remaining',
      label: 'Best of Remaining Assets',
      excludeBucket: 'selected_assets',
      section: 'life',
      column: 'condition',
      rowIndex: 0,
      sortOrder: 1
    },
    {
      id: 'himalaya-obs-4',
      type: 'memory_add',
      label: 'Store Performance',
      bucketName: 'selected_performances',
      valueToStore: 'bestRemainingPerformance',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 0
    },
    {
      id: 'himalaya-obs-5',
      type: 'memory_add',
      label: 'Mark Asset Selected',
      bucketName: 'selected_assets',
      valueToStore: '1',
      section: 'life',
      column: 'action',
      rowIndex: 0,
      sortOrder: 1
    },
    
    // Maturity section - Calculate average
    {
      id: 'himalaya-mat-1',
      type: 'timing',
      label: 'At Maturity',
      section: 'maturity',
      column: 'timing',
      rowIndex: 1,
      sortOrder: 0
    },
    {
      id: 'himalaya-mat-2',
      type: 'array_average',
      label: 'Average of Selected',
      bucketName: 'selected_performances',
      section: 'maturity',
      column: 'action',
      rowIndex: 1,
      sortOrder: 0
    }
  ],
  
  // Instructions for users
  instructions: `
This template creates a Himalaya product where:
1. At each observation date, we select the best performing asset
2. Selected assets are excluded from future observations
3. At maturity, the payoff is the average of all selected performances

To use this template:
1. Set your basket of underlyings (typically same number as observations)
2. Configure observation dates
3. The template will automatically handle the selection and averaging logic

Note: For a full implementation, you would need to duplicate the observation rows
for each observation date, or use a more advanced iteration mechanism.
`
};

// Function to insert templates into the collection
export async function insertOrionHimalayaTemplates(TemplatesCollection) {
  try {
    // Check if templates already exist
    const existingOrion = await TemplatesCollection.findOneAsync({ name: orionTemplate.name });
    const existingHimalaya = await TemplatesCollection.findOneAsync({ name: himalayaTemplate.name });
    
    const results = [];
    
    if (!existingOrion) {
      const orionId = await TemplatesCollection.insertAsync(orionTemplate);
      results.push({ name: 'ORION', id: orionId, status: 'inserted' });
      console.log('Inserted ORION template:', orionId);
    } else {
      results.push({ name: 'ORION', id: existingOrion._id, status: 'already exists' });
      console.log('ORION template already exists');
    }
    
    if (!existingHimalaya) {
      const himalayaId = await TemplatesCollection.insertAsync(himalayaTemplate);
      results.push({ name: 'Himalaya', id: himalayaId, status: 'inserted' });
      console.log('Inserted Himalaya template:', himalayaId);
    } else {
      results.push({ name: 'Himalaya', id: existingHimalaya._id, status: 'already exists' });
      console.log('Himalaya template already exists');
    }
    
    return results;
  } catch (error) {
    console.error('Error inserting templates:', error);
    throw error;
  }
}