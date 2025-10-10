// Server Startup Orchestrator
// Coordinates all server startup activities in the correct order

import { Meteor } from 'meteor/meteor';
import { logDatabaseInfo, shouldSeedDemoData, createDatabaseIndexes } from '../config/database.js';
import { seedDemoData } from './seeding.js';
import { initializeCollections } from './collections.js';
import { performStartupTasks } from './tasks.js';

/**
 * Main server startup function
 * Coordinates all startup activities in the correct order
 */
export async function startServer() {
  console.log('\n✅ Starting Ambervision Server...');
  console.log(`[SEEDING] Demo data seeding is ${shouldSeedDemoData() ? 'ENABLED' : 'DISABLED'}`);
  
  try {
    // 1. Log database connection information
    logDatabaseInfo();
    
    // 2. Initialize collections and create indexes
    await initializeCollections();
    
    // 3. Create database indexes for better query performance
    await createDatabaseIndexes();
    
    // 4. Seed demo data if enabled
    if (shouldSeedDemoData()) {
      await seedDemoData();
    } else {
      console.log('[SEEDING] Skipping demo data seeding (disabled)');
    }
    
    // 5. Perform additional startup tasks
    await performStartupTasks();
    
    console.log('✅ Server startup complete!');
    
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    throw error;
  }
}

// Start the server when this module is imported
Meteor.startup(startServer);