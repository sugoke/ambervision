/**
 * Test file for the centralized operator mapping system
 * 
 * This file contains validation tests to ensure the operator mapping
 * system works correctly and maintains backward compatibility.
 */

import { 
  resolveOperator, 
  getOperatorLabel, 
  isValidOperator, 
  getSupportedOperators,
  getRecognizedInputs,
  enhanceComponentOperator,
  debugOperatorResolution,
  MATHEMATICAL_OPERATORS
} from './operatorMapping.js';

/**
 * Run all operator mapping tests
 */
export function runOperatorMappingTests() {
  console.log('\n=== Running Operator Mapping Tests ===');
  
  let passed = 0;
  let failed = 0;
  
  // Test basic resolution
  const basicTests = [
    { input: 'at or above', expected: '>=' },
    { input: 'At or Above', expected: '>=' },
    { input: 'AT OR ABOVE', expected: '>=' },
    { input: 'at or below', expected: '<=' },
    { input: 'above', expected: '>' },
    { input: 'below', expected: '<' },
    { input: 'equal', expected: '==' },
    { input: 'at_or_above', expected: '>=' },
    { input: 'atOrAbove', expected: '>=' },
    { input: '>=', expected: '>=' },
    { input: 'gte', expected: '>=' }
  ];
  
  console.log('\n--- Basic Resolution Tests ---');
  basicTests.forEach(test => {
    const result = resolveOperator(test.input);
    if (result === test.expected) {
      console.log(`✅ "${test.input}" → "${result}"`);
      passed++;
    } else {
      console.log(`❌ "${test.input}" → "${result}" (expected "${test.expected}")`);
      failed++;
    }
  });
  
  // Test component enhancement
  console.log('\n--- Component Enhancement Tests ---');
  const componentTests = [
    {
      input: { type: 'comparison', label: 'At or Above', value: '100%' },
      expectedOperator: '>='
    },
    {
      input: { type: 'comparison', operator: 'at or below' },
      expectedOperator: '<='
    },
    {
      input: { type: 'comparison', comparisonType: 'above' },
      expectedOperator: '>'
    }
  ];
  
  componentTests.forEach((test, index) => {
    const enhanced = enhanceComponentOperator(test.input);
    if (enhanced.operator === test.expectedOperator) {
      console.log(`✅ Component ${index + 1}: operator = "${enhanced.operator}"`);
      passed++;
    } else {
      console.log(`❌ Component ${index + 1}: operator = "${enhanced.operator}" (expected "${test.expectedOperator}")`);
      failed++;
    }
  });
  
  // Test error handling
  console.log('\n--- Error Handling Tests ---');
  const errorTests = [
    { input: null, shouldUseFailback: true },
    { input: undefined, shouldUseFailback: true },
    { input: '', shouldUseFailback: true },
    { input: 'invalid_operator', shouldUseFailback: true }
  ];
  
  errorTests.forEach((test, index) => {
    const result = resolveOperator(test.input, '>=', false);
    if (test.shouldUseFailback && result === '>=') {
      console.log(`✅ Error test ${index + 1}: used fallback correctly`);
      passed++;
    } else if (!test.shouldUseFailback && result !== '>=') {
      console.log(`✅ Error test ${index + 1}: handled correctly`);
      passed++;
    } else {
      console.log(`❌ Error test ${index + 1}: unexpected result "${result}"`);
      failed++;
    }
  });
  
  // Test validation functions
  console.log('\n--- Validation Function Tests ---');
  const validationTests = [
    { operator: '>=', shouldBeValid: true },
    { operator: 'invalid', shouldBeValid: false },
    { operator: '==', shouldBeValid: true }
  ];
  
  validationTests.forEach((test, index) => {
    const isValid = isValidOperator(test.operator);
    if (isValid === test.shouldBeValid) {
      console.log(`✅ Validation test ${index + 1}: "${test.operator}" validation correct`);
      passed++;
    } else {
      console.log(`❌ Validation test ${index + 1}: "${test.operator}" validation incorrect`);
      failed++;
    }
  });
  
  // Test debug function
  console.log('\n--- Debug Function Test ---');
  const debugResult = debugOperatorResolution('at or above');
  if (debugResult.resolved === '>=' && debugResult.isValid) {
    console.log(`✅ Debug function works correctly`);
    passed++;
  } else {
    console.log(`❌ Debug function failed`);
    failed++;
  }
  
  // Summary
  console.log(`\n=== Test Results ===`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
  
  if (failed === 0) {
    console.log(`🎉 All tests passed! Operator mapping system is working correctly.`);
  } else {
    console.log(`⚠️  Some tests failed. Please review the implementation.`);
  }
  
  return { passed, failed, successRate: (passed / (passed + failed)) * 100 };
}

/**
 * Test backward compatibility with existing components
 */
export function testBackwardCompatibility() {
  console.log('\n=== Testing Backward Compatibility ===');
  
  // Simulate old component structures that might exist in the database
  const oldComponents = [
    {
      type: 'comparison',
      label: 'At or Above',
      value: '100%'
    },
    {
      type: 'comparison', 
      operator: 'at or above'
    },
    {
      type: 'comparison',
      comparisonType: 'gte'
    },
    {
      type: 'comparison',
      label: 'Below',
      condition: 'below' // Legacy field
    }
  ];
  
  oldComponents.forEach((component, index) => {
    console.log(`\n--- Old Component ${index + 1} ---`);
    console.log('Original:', JSON.stringify(component, null, 2));
    
    const enhanced = enhanceComponentOperator(component);
    console.log('Enhanced:', JSON.stringify(enhanced, null, 2));
    
    if (enhanced.operator && isValidOperator(enhanced.operator)) {
      console.log(`✅ Successfully enhanced with operator: ${enhanced.operator}`);
    } else {
      console.log(`❌ Failed to enhance component`);
    }
  });
}

/**
 * Performance test for operator resolution
 */
export function performanceTest() {
  console.log('\n=== Performance Test ===');
  
  const testInputs = [
    'at or above', 'at or below', 'above', 'below', 'equal',
    'At Or Above', 'AT OR BELOW', 'ABOVE', 'BELOW',
    'at_or_above', 'at_or_below', 'greater_than', 'less_than',
    'atOrAbove', 'atOrBelow', 'greaterThan', 'lessThan',
    '>=', '<=', '>', '<', '==', '!=',
    'gte', 'lte', 'gt', 'lt', 'eq', 'ne'
  ];
  
  const iterations = 1000;
  const startTime = Date.now();
  
  for (let i = 0; i < iterations; i++) {
    testInputs.forEach(input => {
      resolveOperator(input);
    });
  }
  
  const endTime = Date.now();
  const totalOperations = iterations * testInputs.length;
  const timePerOperation = (endTime - startTime) / totalOperations;
  
  console.log(`📈 Performance Results:`);
  console.log(`  Total operations: ${totalOperations.toLocaleString()}`);
  console.log(`  Total time: ${endTime - startTime}ms`);
  console.log(`  Average time per operation: ${timePerOperation.toFixed(4)}ms`);
  console.log(`  Operations per second: ${(1000 / timePerOperation).toFixed(0)}`);
  
  if (timePerOperation < 0.01) {
    console.log(`✅ Performance is excellent`);
  } else if (timePerOperation < 0.1) {
    console.log(`✅ Performance is good`);
  } else {
    console.log(`⚠️  Performance could be improved`);
  }
}

// Auto-run tests if this file is executed directly
if (typeof window === 'undefined' && typeof global !== 'undefined') {
  // Running in Node.js environment - run tests
  runOperatorMappingTests();
  testBackwardCompatibility();
  performanceTest();
}