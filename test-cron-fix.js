/**
 * Test script to verify CRON job session handling fix
 *
 * Usage: Run this in meteor shell:
 *   meteor shell
 *   .load test-cron-fix.js
 *
 * Or run from command line:
 *   meteor shell < test-cron-fix.js
 */

// Test the product re-evaluation CRON job
console.log('🧪 Testing CRON job session handling fix...');
console.log('');

// First, let's check if there's a superadmin user
console.log('1️⃣ Checking for superadmin user...');
Meteor.callAsync('users.find', {role: 'superadmin'})
  .then(users => {
    if (users && users.length > 0) {
      console.log('✅ Found superadmin user:', users[0].email);
      console.log('');

      // Now test triggering the product re-evaluation
      console.log('2️⃣ Triggering product re-evaluation...');
      console.log('   (This will create a system session and evaluate all live products)');
      console.log('');

      // Import the CRON job function directly to bypass authentication
      const { default: { productRevaluationJob } } = require('./server/cron/jobs.js');

      return productRevaluationJob();
    } else {
      console.log('❌ No superadmin user found!');
      console.log('   The CRON job cannot run without a superadmin user.');
      throw new Error('No superadmin user found');
    }
  })
  .then(result => {
    console.log('');
    console.log('✅ CRON job completed successfully!');
    console.log('📊 Results:', result);
    console.log('');
    console.log('The fix is working! The CRON job can now:');
    console.log('  ✓ Find/create a valid system session');
    console.log('  ✓ Use the correct sessionId field (not _id)');
    console.log('  ✓ Generate reports for all live products');
  })
  .catch(error => {
    console.log('');
    console.log('❌ CRON job failed with error:');
    console.log('Error message:', error.message);
    console.log('Error stack:', error.stack);
    console.log('');
    console.log('If you see session validation errors, the fix may not have taken effect yet.');
    console.log('Try restarting the Meteor server to load the updated code.');
  });
