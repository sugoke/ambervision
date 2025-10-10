# Component-by-Component Evaluation Flow

## Overview

This document details the step-by-step evaluation flow for structured product payoff components, showing how the generic rule engine processes drag-and-drop components into executable logic.

## Fixed Price Service Issues

**Problem**: The `products.compileFormulaDebug` server method was calling non-existent methods:
- ❌ `priceService.getCurrentPrice(symbol)` - Method doesn't exist
- ❌ `priceService.getPriceHistory(symbol, start, end)` - Method doesn't exist

**Solution**: Updated server method to use correct PriceService API:
- ✅ `priceService.getPrice(symbol, new Date(), 'close')` - Get current close price
- ✅ `priceService.getPriceRange(symbol, startDate, endDate)` - Get price range for history

## Component Evaluation Flow Example

Based on the user's debug data showing TSLA product evaluation:

### Step 1: Market Data Collection
```
Underlying: TSLA
Strike Price: 212.19
Current Market Price: 325.59 (fetched via priceService.getPrice())
```

### Step 2: Performance Calculation
```javascript
// Generic performance calculation formula
const performance = ((currentPrice - strikePrice) / strikePrice) * 100;
const TSLA_performance = ((325.59 - 212.19) / 212.19) * 100 = 53.4%
```

### Step 3: Component Detection and Processing

**Component Structure (from drag-and-drop):**
```
Row 0: [IF] → [BASKET: TSLA] → [COMPARISON: ≥] → [BARRIER: 90%] → [ACTION: Early Redemption]
Row 1: [ELSE] → [ACTION: Downside Exposure] → [ACTION: Coupon 8.5%]
```

### Step 4: Evaluation Execution

#### **Node 1: IF Condition Evaluation**
```
Component Type: LOGIC_OPERATOR (IF)
Condition: TSLA performance ≥ Capital Protection Barrier (90%)
Values: 53.4% ≥ 90%
Result: FALSE
Status: ❌ Condition not met, skip actions
```

**Detailed Sub-Components:**
1. **BASKET Component**: 
   - Symbol: TSLA
   - Current Level: 325.59
   - Performance: 53.4%
   - Status: ✅ Evaluated successfully

2. **COMPARISON Component**:
   - Operator: "at or above" → ">=" (via operatorMapping.js)
   - Left Value: 53.4% (TSLA performance)
   - Right Value: 90% (barrier level)
   - Evaluation: 53.4 >= 90.0 = FALSE
   - Status: ✅ Comparison executed

3. **BARRIER Component**:
   - Type: Capital Protection Barrier
   - Level: 90%
   - Touch Status: Not touched (53.4% < 90%)
   - Status: ✅ Barrier level determined

4. **ACTION Component** (Skipped):
   - Type: Early Redemption
   - Status: ❌ SKIPPED (condition failed)

#### **Node 2: ELSE Branch Execution**
```
Component Type: LOGIC_OPERATOR (ELSE)
Condition: Previous IF condition was FALSE
Result: TRUE (execute ELSE branch)
Status: ✅ Execute actions
```

**Actions Executed:**
1. **Downside Exposure Action**:
   - Formula: 100% + TSLA_performance = 100% + 53.4% = 153.4%
   - Status: ✅ EXECUTED
   - Result: 153.4%

2. **Coupon Action**:
   - Rate: 8.5%
   - Status: ✅ EXECUTED
   - Result: +8.5%

### Step 5: Final Calculation
```
Total Return = Downside Exposure + Coupon
Total Return = 153.4% + 8.5% = 161.9%
```

## Generic Component Evaluators

### COMPARISON Evaluator
```javascript
const evaluateComparison = (leftValue, operator, rightValue) => {
  // Operator mapping: "at or above" → ">="
  const resolvedOperator = resolveOperator(operator);
  
  switch(resolvedOperator) {
    case '>=': return leftValue >= rightValue;
    case '>': return leftValue > rightValue;
    case '<=': return leftValue <= rightValue;
    case '<': return leftValue < rightValue;
    case '==': return leftValue === rightValue;
    default: throw new Error(`Unknown operator: ${operator}`);
  }
};
```

### BARRIER Evaluator
```javascript
const evaluateBarrier = (underlyingPerformance, barrierLevel, barrierType) => {
  const touched = underlyingPerformance >= barrierLevel;
  
  return {
    level: barrierLevel,
    touched: touched,
    type: barrierType,
    currentLevel: underlyingPerformance
  };
};
```

### ACTION Evaluator
```javascript
const evaluateAction = (actionType, underlyingData, actionConfig) => {
  switch(actionType) {
    case 'downside_exposure':
      return 100 + underlyingData.performance;
    
    case 'coupon':
      return actionConfig.rate || 0;
    
    case 'early_redemption':
      return 100 + (actionConfig.couponRate || 0);
    
    default:
      return 0;
  }
};
```

## Execution Trace Log

The evaluation produces a detailed execution trace:

```
🚀 EXECUTION_START: Product evaluation initiated
📍 NODE_START: Row 0 - IF condition evaluation
⚙️ COMPONENT_EVALUATION: BASKET - TSLA performance = 53.4%
⚙️ COMPONENT_EVALUATION: COMPARISON - 53.4% >= 90% = FALSE
⚙️ COMPONENT_EVALUATION: BARRIER - Capital Protection at 90%, not touched
❌ NODE_SKIP_ACTIONS: Row 0 actions skipped (condition failed)
📍 NODE_START: Row 1 - ELSE branch evaluation
✅ COMPONENT_RESULT: ELSE condition = TRUE (previous IF was FALSE)
⚡ ACTIONS_EXECUTION: Downside Exposure = 153.4%
⚡ ACTIONS_EXECUTION: Coupon = 8.5%
🏁 EXECUTION_END: Final result = 161.9%
```

## Rule Engine Architecture

### Universal Processing Pipeline

1. **Structure Parsing**: Convert drag-and-drop to component array
2. **Component Enhancement**: Resolve operators and validate config
3. **Logic Tree Building**: Create IF/ELSE evaluation branches
4. **Generic Evaluation**: Process each component type uniformly
5. **Result Aggregation**: Combine actions into final payoff

### Key Principles

- **Product Agnostic**: No hardcoded product types or rules
- **Mathematical Only**: Pure formula-based evaluation
- **Component Generic**: Each evaluator works for any product structure
- **Infinite Extensibility**: New components work without code changes

## Debugging Integration

The Formula Debugger now shows:
- ✅ **Component Status**: Visual indicators for executed vs skipped
- ✅ **Execution Flow**: Step-by-step evaluation trace
- ✅ **Performance Data**: Real market data integration
- ✅ **Logic Paths**: Clear IF/ELSE branch visualization

## Fixed Issues

1. ✅ **Price Service Methods**: Corrected method calls to existing API
2. ✅ **Performance Calculation**: Proper (current-strike)/strike formula
3. ✅ **Operator Resolution**: Central mapping from labels to mathematical operators  
4. ✅ **Execution Tracing**: Complete component-by-component flow logging

The formula execution should now work correctly with proper price data and show the detailed evaluation flow the user requested.