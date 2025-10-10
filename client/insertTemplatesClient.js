// Client-side script to insert ORION and Himalaya templates
// This can be run from the browser console or added to a UI button

import { Meteor } from 'meteor/meteor';

// Function to insert the templates
export async function insertOrionHimalayaTemplates() {
  try {
    console.log('Calling method to insert ORION and Himalaya templates...');
    
    const result = await Meteor.callAsync('templates.insertOrionHimalaya');
    
    if (result.success) {
      console.log('✅ Templates insertion completed successfully!');
      console.log('Results:', result.results);
      
      result.results.forEach(r => {
        if (r.status === 'inserted') {
          console.log(`  ✅ ${r.name} - Inserted with ID: ${r.id}`);
        } else {
          console.log(`  ℹ️ ${r.name} - Already exists with ID: ${r.id}`);
        }
      });
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error inserting templates:', error);
    throw error;
  }
}

// Make it available globally for browser console
if (typeof window !== 'undefined') {
  window.insertOrionHimalayaTemplates = insertOrionHimalayaTemplates;
  console.log('You can now run: insertOrionHimalayaTemplates() in the console to insert the templates');
}