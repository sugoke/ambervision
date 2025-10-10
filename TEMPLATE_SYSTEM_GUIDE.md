# Template System Guide

## Overview

The template system provides a structured way to create, evaluate, and report on different types of structured financial products. Each template (Phoenix Autocallable, Orion Memory, etc.) has three independent components:

1. **Product Creator** - UI for building products of this type
2. **Evaluator** - Server-side logic for calculating product performance
3. **Report UI** - Client-side component for displaying evaluation results

## Architecture Principles

### 🚨 Core Rules
- **Product-Agnostic Logic**: Never hardcode product-specific rules
- **Component-Based Evaluation**: All logic based on mathematical formulas and component relationships
- **Zero-Configuration Extensibility**: New templates work without modifying core files
- **Separation of Concerns**: Evaluation, UI, and creation are completely separate

### Directory Structure

```
imports/
├── api/
│   ├── templateReports.js              # Main collection & registry
│   ├── evaluators/
│   │   ├── sharedEvaluationHelpers.js  # Common pricing/status logic
│   │   ├── phoenixEvaluator.js         # Phoenix evaluation
│   │   └── orionEvaluator.js           # Orion evaluation
│   └── chartBuilders/
│       ├── phoenixChartBuilder.js      # Phoenix charts (placeholder)
│       └── orionChartBuilder.js        # Orion charts (placeholder)
└── ui/
    ├── TemplateProductReport.jsx       # Main report dispatcher
    └── templates/
        ├── PhoenixReport.jsx           # Phoenix UI
        └── OrionReport.jsx             # Orion UI
```

## Template Registry

The system uses a registry pattern in `templateReports.js`:

```javascript
const TEMPLATE_REGISTRY = {
  phoenix_autocallable: {
    evaluator: PhoenixEvaluator,
    chartBuilder: PhoenixChartBuilder,
    uiComponent: 'PhoenixReport'
  },
  orion_memory: {
    evaluator: OrionEvaluator,
    chartBuilder: OrionChartBuilder,
    uiComponent: 'OrionReport'
  }
  // Add new templates here
};
```

## Adding a New Template

Follow these steps to add a new template (e.g., "Autocallable Barrier"):

### Step 1: Create the Evaluator

Create `imports/api/evaluators/autocallableBarrierEvaluator.js`:

```javascript
import { SharedEvaluationHelpers } from './sharedEvaluationHelpers';

export const AutocallableBarrierEvaluator = {
  /**
   * Generate evaluation report for Autocallable Barrier products
   */
  async generateReport(product, context) {
    // 1. Set redemption prices for matured products
    await SharedEvaluationHelpers.setRedemptionPricesForProduct(product);

    // 2. Extract template-specific parameters
    const params = this.extractParameters(product);

    // 3. Extract underlying assets with pricing
    const underlyings = SharedEvaluationHelpers.extractUnderlyingAssetsData(product);

    // 4. Calculate template-specific logic
    const features = this.calculateFeatures(product, params, underlyings);

    // 5. Build product status
    const status = SharedEvaluationHelpers.buildProductStatus(product);

    // 6. Return standardized report structure
    return {
      templateType: 'autocallable_barrier',
      templateVersion: '1.0.0',
      features: features,
      currentStatus: status,
      structureParams: params,
      underlyings: underlyings
    };
  },

  extractParameters(product) {
    const structureParams = product.structureParams || product.structureParameters || {};

    return {
      autocallBarrier: structureParams.autocallBarrier || 100,
      barrierLevel: structureParams.barrierLevel || 60,
      couponRate: structureParams.couponRate || 0,
      participationRate: structureParams.participationRate || 100
    };
  },

  calculateFeatures(product, params, underlyings) {
    // Template-specific feature calculations
    const worstPerformance = Math.min(...underlyings.map(u => u.performance));
    const isAutocallTriggered = worstPerformance >= params.autocallBarrier;
    const isBarrierBreached = worstPerformance < params.barrierLevel;

    return {
      hasAutocall: true,
      hasBarrier: true,
      hasCoupon: params.couponRate > 0,
      isAutocallTriggered: isAutocallTriggered,
      isBarrierBreached: isBarrierBreached,
      worstPerformance: worstPerformance
    };
  }
};
```

### Step 2: Create the Chart Builder (Optional)

Create `imports/api/chartBuilders/autocallableBarrierChartBuilder.js`:

```javascript
export const AutocallableBarrierChartBuilder = {
  async generateChartData(product, evaluation) {
    // TODO: Implement Chart.js configuration
    return {
      chartType: 'autocallable_barrier_performance',
      data: {
        labels: [],
        datasets: []
      },
      options: {
        responsive: true,
        plugins: {}
      },
      metadata: {
        productId: product._id,
        chartTitle: 'Autocallable Barrier Performance',
        generatedAt: new Date().toISOString()
      }
    };
  }
};
```

### Step 3: Create the Report UI Component

Create `imports/ui/templates/AutocallableBarrierReport.jsx`:

```javascript
import React from 'react';

const AutocallableBarrierReport = ({ results, productId }) => {
  const params = results.structureParams || {};
  const status = results.currentStatus || {};
  const features = results.features || {};
  const underlyings = results.underlyings || [];

  return (
    <div style={{
      marginTop: '1rem',
      padding: '1rem',
      background: 'var(--bg-primary)',
      borderRadius: '6px'
    }}>
      <h3>🎯 Autocallable Barrier Evaluation</h3>

      {/* Underlying Performance Table */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        marginBottom: '1.5rem'
      }}>
        <h4>📊 Underlying Assets</h4>
        <table>
          <thead>
            <tr>
              <th>Asset</th>
              <th>Initial Price</th>
              <th>Current Price</th>
              <th>Performance</th>
            </tr>
          </thead>
          <tbody>
            {underlyings.map((u, i) => (
              <tr key={i}>
                <td>{u.ticker} - {u.name}</td>
                <td>{u.initialPriceFormatted}</td>
                <td>{u.currentPriceFormatted}</td>
                <td style={{
                  color: u.isPositive ? '#10b981' : '#ef4444',
                  fontWeight: '700'
                }}>
                  {u.performanceFormatted}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Structure Parameters */}
      <div style={{
        background: 'var(--bg-secondary)',
        padding: '1.5rem',
        borderRadius: '6px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '1.5rem'
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Autocall Barrier
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>
            {params.autocallBarrier}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Barrier Level
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>
            {params.barrierLevel}%
          </div>
        </div>

        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            Coupon Rate
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: '600' }}>
            {params.couponRate}%
          </div>
        </div>
      </div>
    </div>
  );
};

export default AutocallableBarrierReport;
```

### Step 4: Register the Template

Update `imports/api/templateReports.js`:

```javascript
// Add imports at top
import { AutocallableBarrierEvaluator } from '/imports/api/evaluators/autocallableBarrierEvaluator';
import { AutocallableBarrierChartBuilder } from '/imports/api/chartBuilders/autocallableBarrierChartBuilder';

// Add to registry
const TEMPLATE_REGISTRY = {
  phoenix_autocallable: { /* ... */ },
  orion_memory: { /* ... */ },
  autocallable_barrier: {
    evaluator: AutocallableBarrierEvaluator,
    chartBuilder: AutocallableBarrierChartBuilder,
    uiComponent: 'AutocallableBarrierReport'
  }
};
```

### Step 5: Connect the UI Component

Update `imports/ui/TemplateProductReport.jsx`:

```javascript
// Add import
import AutocallableBarrierReport from './templates/AutocallableBarrierReport.jsx';

// Add to renderTemplateResults function
const renderTemplateResults = (results, templateId, productId) => {
  // ... existing conditions ...

  if (templateId === 'autocallable_barrier' && results.templateType === 'autocallable_barrier') {
    return <AutocallableBarrierReport results={results} productId={productId} />;
  }

  // ... rest of function
};
```

### Step 6: Create Product Creator Interface (Optional)

If you want a dedicated UI for creating this template:

Create `imports/ui/templates/creators/AutocallableBarrierCreator.jsx`:

```javascript
import React, { useState } from 'react';

const AutocallableBarrierCreator = ({ onSave, onCancel }) => {
  const [params, setParams] = useState({
    autocallBarrier: 100,
    barrierLevel: 60,
    couponRate: 8,
    participationRate: 100
  });

  const handleSave = () => {
    const productData = {
      templateId: 'autocallable_barrier',
      structureParams: params,
      // ... other required fields
    };
    onSave(productData);
  };

  return (
    <div className="template-creator">
      <h2>Create Autocallable Barrier Product</h2>

      <div className="form-group">
        <label>Autocall Barrier (%)</label>
        <input
          type="number"
          value={params.autocallBarrier}
          onChange={(e) => setParams({ ...params, autocallBarrier: parseFloat(e.target.value) })}
        />
      </div>

      <div className="form-group">
        <label>Barrier Level (%)</label>
        <input
          type="number"
          value={params.barrierLevel}
          onChange={(e) => setParams({ ...params, barrierLevel: parseFloat(e.target.value) })}
        />
      </div>

      <div className="form-group">
        <label>Coupon Rate (%)</label>
        <input
          type="number"
          value={params.couponRate}
          onChange={(e) => setParams({ ...params, couponRate: parseFloat(e.target.value) })}
        />
      </div>

      <div className="actions">
        <button onClick={handleSave}>Create Product</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
};

export default AutocallableBarrierCreator;
```

## Evaluation Flow

### 1. Product Creation
```
User creates product → Sets templateId → Saves to database
```

### 2. Evaluation Trigger
```
User opens report → TemplateProductReport.jsx loads
→ Meteor.call('templateReports.create', product, sessionId)
→ Server detects templateId
→ Gets evaluator from registry
→ Runs evaluator.generateReport(product, context)
→ Stores results in templateReports collection
```

### 3. Report Display
```
TemplateProductReport subscribes to templateReports
→ Gets latest report for product
→ Checks templateType in results
→ Renders appropriate UI component
→ Displays pre-computed data
```

## Shared Evaluation Helpers

All evaluators should use these shared helpers from `sharedEvaluationHelpers.js`:

### Price Resolution
```javascript
// Automatically sets redemption prices for matured products
await SharedEvaluationHelpers.setRedemptionPricesForProduct(product);
```

### Price Hierarchy
```javascript
// Gets the appropriate price: redemption > final obs > live > initial
const price = SharedEvaluationHelpers.getEvaluationPrice(underlying, product);
```

### Underlying Data Extraction
```javascript
// Extracts all underlyings with prices, performance, formatting
const underlyings = SharedEvaluationHelpers.extractUnderlyingAssetsData(product);
// Returns: [{ ticker, name, initialPrice, currentPrice, performance, performanceFormatted, isPositive, ... }]
```

### Product Status
```javascript
// Determines if product is live, matured, or autocalled
const status = SharedEvaluationHelpers.buildProductStatus(product);
// Returns: { productStatus, evaluationDate, daysToMaturity, daysToMaturityText, ... }
```

### Formatting
```javascript
// Format currency
const formatted = SharedEvaluationHelpers.formatCurrency(123.45, 'USD'); // "$123.45"

// Calculate days to maturity
const days = SharedEvaluationHelpers.calculateDaysToMaturity(product); // 365
```

## Report Data Structure

Every evaluator must return this structure:

```javascript
{
  templateType: 'template_id',           // Must match registry key
  templateVersion: '1.0.0',              // Semantic versioning

  // Template-specific features
  features: {
    hasAutocall: Boolean,
    hasMemoryCoupon: Boolean,
    hasProtection: Boolean,
    // ... custom features
  },

  // Product status (from shared helper)
  currentStatus: {
    productStatus: 'live' | 'matured' | 'autocalled',
    evaluationDate: Date,
    daysToMaturity: Number,
    daysToMaturityText: String
  },

  // Template-specific parameters
  structureParams: {
    // Custom params for this template
  },

  // Underlying assets with pricing
  underlyings: [{
    ticker: String,
    name: String,
    initialPrice: Number,
    currentPrice: Number,
    performance: Number,
    performanceFormatted: String,
    isPositive: Boolean,
    // ... other fields
  }],

  // Optional: Additional calculated fields
  // basketPerformance, worstPerformance, etc.
}
```

## Template Detection

The system automatically detects which template a product uses in `templateReports.js`:

```javascript
const detectTemplateId = function(productData) {
  // 1. Check structural indicators FIRST
  const structureParams = productData.structureParameters || {};

  if (structureParams.upperBarrier >= 100 || structureParams.rebateValue) {
    return 'orion_memory';
  }

  // 2. Check payoff structure
  const payoffStructure = productData.payoffStructure || [];
  const hasAutocall = payoffStructure.some(item =>
    item.type === 'action' && item.value?.includes('autocall')
  );

  if (hasAutocall) {
    return 'phoenix_autocallable';
  }

  // 3. Fallback to explicit template field
  return productData.templateId || productData.template || 'unknown_template';
};
```

## Best Practices

### ✅ DO:
- Use shared helpers for pricing, status, and formatting
- Return pre-formatted values from evaluators (`performanceFormatted: "+36.90%"`)
- Keep UI components display-only (no calculations)
- Use mathematical relationships, not product names
- Test with edge cases (matured products, missing data)

### ❌ DON'T:
- Hardcode product type checks (`if (productType === 'reverse_convertible')`)
- Perform calculations in UI components
- Assume specific field names or structures
- Copy-paste logic between evaluators (use shared helpers)
- Skip error handling

## Product Title Auto-Generation

Product titles are automatically generated on save:

```javascript
// Format: "<Underlyings> <Template Type>"
// Examples:
// - "AAPL Phoenix Autocallable"
// - "TSLA/MSFT Orion Memory"
// - "BTC/ETH+2 Autocallable Barrier"
```

Title generation logic in `StructuredProductInterface.jsx`:
```javascript
const generateProductTitle = () => {
  const parts = [];

  // 1. Add underlyings
  if (underlyings.length === 1) {
    parts.push(underlyings[0].ticker);
  } else if (underlyings.length <= 3) {
    parts.push(underlyings.map(u => u.ticker).join('/'));
  } else {
    parts.push(`${underlyings.slice(0, 2).map(u => u.ticker).join('/')}+${underlyings.length - 2}`);
  }

  // 2. Add template type
  const displayName = selectedTemplateId
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
  parts.push(displayName);

  return parts.join(' ');
};
```

## Testing Your Template

1. **Create a product** with your template
2. **Verify evaluation** - Check that report generates correctly
3. **Test matured state** - Set maturity in the past, verify pricing
4. **Test edge cases** - Missing data, null values, extreme performances
5. **Check UI rendering** - All data displays correctly, no calculations in UI

## Common Patterns

### Pattern 1: Barrier Detection
```javascript
const hasProtection = underlyings.every(u => u.performance >= params.protectionBarrier);
```

### Pattern 2: Worst-Of Performance
```javascript
const worstPerformance = Math.min(...underlyings.map(u => u.performance));
```

### Pattern 3: Autocall Check
```javascript
const isAutocalled = underlyings.every(u => u.performance >= params.autocallBarrier);
```

### Pattern 4: Memory Coupon Accumulation
```javascript
const memoryCoupons = observationSchedule
  .filter(obs => obs.couponPaid || obs.couponMemory)
  .reduce((sum, obs) => sum + obs.couponRate, 0);
```

## File Checklist for New Template

- [ ] Create evaluator: `imports/api/evaluators/<template>Evaluator.js`
- [ ] Create chart builder: `imports/api/chartBuilders/<template>ChartBuilder.js`
- [ ] Create UI component: `imports/ui/templates/<Template>Report.jsx`
- [ ] Register in `imports/api/templateReports.js`
- [ ] Import UI in `imports/ui/TemplateProductReport.jsx`
- [ ] Add render condition in `renderTemplateResults()`
- [ ] (Optional) Create product creator UI
- [ ] Test evaluation flow end-to-end
- [ ] Document template-specific features

## Conclusion

This template system provides infinite extensibility while maintaining clean separation of concerns. Each template is self-contained and can be added without modifying core architecture. The shared helpers ensure consistency while the registry pattern enables dynamic template loading.

**Key Principle**: The system treats every template as a unique composition of mathematical relationships, never assuming product types or hard-coding business rules.
