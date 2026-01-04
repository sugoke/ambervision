/**
 * ISIN Validation Test Script
 *
 * Tests the ISIN validator utility with various valid and invalid ISINs
 */

// Import the validation functions (Note: This is a test file, adjust imports as needed)
import { validateISIN, calculateCheckDigit, cleanISIN, formatISIN } from './imports/utils/isinValidator.js';

console.log('🧪 ISIN Validation Test Suite\n');
console.log('='.repeat(80));

// Test cases with expected results
const testCases = [
  // Valid ISINs
  { isin: 'US0378331005', expected: true, description: 'Apple Inc. (US)' },
  { isin: 'GB0002374006', expected: true, description: 'BBC (GB)' },
  { isin: 'DE0005140008', expected: true, description: 'Deutsche Bank (DE)' },
  { isin: 'CH1300968331', expected: true, description: 'Swiss product (CH)' },
  { isin: 'US88160R1014', expected: true, description: 'Tesla Inc. (US)' },
  { isin: 'US5949181045', expected: true, description: 'Microsoft Corp. (US)' },
  { isin: 'US02079K3059', expected: true, description: 'Alphabet Inc. (US)' },
  { isin: 'US67066G1040', expected: true, description: 'NVIDIA Corp. (US)' },
  { isin: 'XS1234567890', expected: true, description: 'International securities (XS)' },

  // Invalid ISINs - Wrong check digit
  { isin: 'US0378331000', expected: false, description: 'Apple with wrong check digit' },
  { isin: 'US0378331001', expected: false, description: 'Apple with wrong check digit' },

  // Invalid ISINs - Wrong format
  { isin: 'US037833100', expected: false, description: 'Too short (11 chars)' },
  { isin: 'US03783310051', expected: false, description: 'Too long (13 chars)' },
  { isin: '0S0378331005', expected: false, description: 'Invalid country code (number)' },
  { isin: 'U$0378331005', expected: false, description: 'Invalid character ($)' },
  { isin: 'ZZ0378331005', expected: false, description: 'Invalid country code (ZZ)' },
  { isin: '', expected: false, description: 'Empty string' },
  { isin: null, expected: false, description: 'Null value' },

  // Edge cases
  { isin: '  US0378331005  ', expected: true, description: 'Valid with whitespace (should be cleaned)' },
  { isin: 'us0378331005', expected: true, description: 'Valid lowercase (should be uppercased)' },
  { isin: 'US 037833100 5', expected: true, description: 'Valid with spaces (should be cleaned)' },
];

let passed = 0;
let failed = 0;

console.log('\n📋 Running Test Cases:\n');

testCases.forEach((testCase, index) => {
  try {
    const result = validateISIN(testCase.isin);
    const isValid = result.valid;
    const testPassed = isValid === testCase.expected;

    if (testPassed) {
      passed++;
      console.log(`✅ Test ${index + 1}: PASSED`);
    } else {
      failed++;
      console.log(`❌ Test ${index + 1}: FAILED`);
      console.log(`   Expected: ${testCase.expected}, Got: ${isValid}`);
    }

    console.log(`   ISIN: "${testCase.isin}"`);
    console.log(`   Description: ${testCase.description}`);
    if (!isValid) {
      console.log(`   Error: ${result.error}`);
    }
    console.log('');
  } catch (error) {
    failed++;
    console.log(`❌ Test ${index + 1}: ERROR`);
    console.log(`   ISIN: "${testCase.isin}"`);
    console.log(`   Description: ${testCase.description}`);
    console.log(`   Exception: ${error.message}`);
    console.log('');
  }
});

console.log('='.repeat(80));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);

// Test utility functions
console.log('\n🔧 Testing Utility Functions:\n');

// Test cleanISIN
console.log('Testing cleanISIN():');
console.log(`  Input: "  us 037833100 5  "`);
console.log(`  Output: "${cleanISIN('  us 037833100 5  ')}"`);
console.log(`  Expected: "US0378331005"`);
console.log('');

// Test formatISIN
console.log('Testing formatISIN():');
console.log(`  Input: "US0378331005"`);
console.log(`  Output: "${formatISIN('US0378331005')}"`);
console.log(`  Expected: "US 037833100 5"`);
console.log('');

// Test calculateCheckDigit
console.log('Testing calculateCheckDigit():');
const testBase = 'US037833100';
const calculatedDigit = calculateCheckDigit(testBase);
console.log(`  Input: "${testBase}"`);
console.log(`  Calculated check digit: "${calculatedDigit}"`);
console.log(`  Expected: "5"`);
console.log('');

console.log('='.repeat(80));
console.log('\n✨ Test suite completed!\n');
