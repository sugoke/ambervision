// Startup Tasks
// Handles additional startup tasks and cleanup operations

import { Meteor } from 'meteor/meteor';

/**
 * Perform additional startup tasks like cleanup, migrations, etc.
 */
export async function performStartupTasks() {
  // Run chartData cleanup on startup to migrate any remaining embedded chartData
  try {
    console.log('Server startup: Running chartData cleanup...');
    const result = await Meteor.callAsync('products.cleanupChartData');
    console.log(`Server startup: ChartData cleanup completed - ${result.migrated}/${result.found} products migrated`);
  } catch (error) {
    console.error('Server startup: ChartData cleanup failed:', error);
  }
  
  // Future startup tasks can be added here:
  // - Data migrations
  // - Cache warming
  // - External service connectivity checks
  // - Scheduled job initialization
}