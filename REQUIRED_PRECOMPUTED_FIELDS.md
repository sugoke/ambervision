# Required Pre-computed Fields for Report Architecture Fix

## Critical Architectural Requirement

**ABSOLUTE PROHIBITION**: No calculations, arithmetic operations, or number formatting in reporting components.

All values must be pre-computed during product evaluation/processing and stored as formatted, display-ready fields.

## Required Pre-computed Fields

### 1. Product Price Data (ProductPricesCollection)
```javascript
{
  price: Number,                    // Raw price value
  currency: String,                 // Currency code
  priceDate: Date,                  // Price date
  uploadDate: Date,                 // Upload date
  uploadTimeFormatted: String,      // "2h ago", "Yesterday", "3 days ago"
  priceFormatted: String,           // "$145.67", "€1,234.56"
}
```

### 2. Report Objects - hasMatured Field
```javascript
{
  hasMatured: Boolean,              // Pre-computed maturity status
  // ... existing fields
}
```

### 3. Underlying Assets (within reports)
```javascript
underlyings: [{
  symbol: String,
  name: String,
  performance: Number,              // Raw performance value
  performanceFormatted: String,     // "+36.90%", "-12.45%"
  isPositive: Boolean,              // true/false for styling
  // Chart data for MiniPerformanceChart
  chartData: {
    value: Number,                  // Absolute performance value
    backgroundColor: String,        // "rgba(34, 197, 94, 0.8)"
    borderColor: String,            // "rgba(34, 197, 94, 1)"
    maxValue: Number,               // Chart max value (calculated range)
  }
}]
```

### 4. Performance Widget Chart Configuration
```javascript
chartConfig: {
  data: Object,                     // Complete Chart.js data object
  options: Object,                  // Complete Chart.js options object
  title: String,                    // "Protection Status"
  statusText: String,               // "Protected", "Partial", "At Risk"
  statusColor: String,              // "var(--success-color)"
  width: String,                    // "400px", "100%"
  containerStyle: Object,           // Container styling
  metrics: [{                       // Pre-computed metrics display
    label: String,                  // "Current", "Distance to barrier"
    value: String,                  // "+36.90%", "+6.90%"
    color: String,                  // "var(--success-color)"
  }]
}
```

### 5. Allocation Summary (AllocationHelpers.computeAllocationSummary)
```javascript
{
  totalAllocations: Number,
  totalNominalInvested: Number,             // Raw value
  totalNominalInvestedFormatted: String,    // "1,500,000 EUR"
  clientCount: Number,
  averagePrice: Number,                     // Raw value
  averagePriceFormatted: String,            // "98.5%"
  isClientView: Boolean,
  currency: String,
  hasMixedCurrencies: Boolean,
  currencies: Array
}
```

### 6. Individual Allocations
```javascript
allocations: [{
  nominalInvested: Number,                  // Raw value
  nominalInvestedFormatted: String,         // "150,000"
  purchasePrice: Number,                    // Raw value
  purchasePriceFormatted: String,           // "98.5%"
  // ... existing fields
}]
```

### 7. Template Results - Observation Analysis
```javascript
templateResults: {
  observationAnalysis: {
    totalCouponsEarned: Number,                     // Raw value
    totalCouponsEarnedFormatted: String,            // "8.5%"
    totalMemoryCoupons: Number,                     // Raw value  
    totalMemoryCouponsFormatted: String,            // "3.4%"
    observations: [{
      couponPaid: Number,                           // Raw value
      couponPaidFormatted: String,                  // "2.1%"
      couponInMemory: Number,                       // Raw value
      couponInMemoryFormatted: String,              // "1.4%"
      // ... existing fields
    }]
  },
  
  basketAnalysis: {
    // Pre-computed barrier chart configuration
    barrierChartConfig: {
      position: String,                             // "80%" (pre-computed position)
      color: String,                                // "#ef4444"
      labelText: String,                            // "Protection Barrier (-30%)"
    }
  }
}
```

### 8. Underlying Chart Data (for basket charts)
```javascript
underlyings: [{
  // ... existing fields
  chartData: {
    width: String,                  // "100px", "150px"
    isPositive: Boolean,            // true/false
    zeroPoint: String,              // "110px" (center position)
    barHeight: String,              // "45px" (calculated height)
    gradient: String,               // "linear-gradient(...)"
    borderRadius: String,           // "6px 6px 0 0"
    border: String,                 // "2px solid #10b981"
    boxShadow: String,              // "0 4px 12px #10b98140"
  }
}]
```

## Implementation Requirements

### 1. Update AllocationHelpers.computeAllocationSummary()
Add formatted fields to the returned summary object.

### 2. Update Report Generation Methods
- `reports.createTemplate`
- `products.evaluate`
- Market data processors

### 3. Add Formatting Utilities
Create utility functions for consistent formatting:
- `formatCurrency(amount, currency)` → "1,500,000 EUR"
- `formatPercentage(value)` → "+36.90%"
- `formatTimeAgo(date)` → "2h ago"

### 4. Update Chart Data Generation
Generate complete Chart.js configurations during processing, not in UI components.

## Testing Checklist

- [ ] ProductReport.jsx displays all data without calculations
- [ ] TemplateProductReport.jsx displays all data without calculations  
- [ ] Performance charts render with pre-computed data
- [ ] Allocation summaries display formatted values
- [ ] Time-based fields show pre-formatted strings
- [ ] All percentage values are pre-formatted
- [ ] No Math.*, arithmetic operators, or .toFixed() in report components

## Critical Success Criteria

**ACID TEST**: Can you completely remove all Math operations, arithmetic operators, and number formatting methods from report components while maintaining full functionality?

If the answer is NO, more pre-computed fields are needed.