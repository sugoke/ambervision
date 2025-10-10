# Structured Products Database Schema

This document defines the standardized database schema for all structured products stored in the system. It ensures consistency across different product types while allowing for product-specific characteristics.

## Core Product Object Structure

All products in the database follow this base structure with common fields and product-specific extensions.

### Base Product Schema

```javascript
{
  // === SYSTEM FIELDS ===
  _id: ObjectId,                          // MongoDB unique identifier
  createdAt: Date,                        // Product creation timestamp
  updatedAt: Date,                        // Last modification timestamp
  version: Number,                        // Schema version for migrations
  
  // === PRODUCT IDENTIFICATION ===
  productId: String,                      // Human-readable product ID (e.g., "RC-TSLA-2024-001")
  title: String,                          // Generated product title
  description: String,                    // Product description
  productFamily: String,                  // Template family: "reverse_convertible", "phoenix", "orion", etc.
  status: String,                         // "draft", "active", "matured", "terminated"
  
  // === COMMON FINANCIAL DETAILS ===
  commonDetails: {
    // Trade Information
    tradeDate: Date,                      // Product trade/launch date
    valueDate: Date,                      // Value date for settlement
    finalObservation: Date,               // Last market observation date (determines product outcome)
    maturityDate: Date,                   // Settlement/payment date (typically T+2 after final observation)
    
    // Market Information
    currency: String,                     // Base currency (ISO code: "USD", "EUR", etc.)
    notional: Number,                     // Notional amount
    denomination: Number,                 // Minimum investment denomination
    
    // Issuer Information
    issuer: {
      name: String,                       // Issuer name
      id: String,                         // Issuer identifier
      rating: String                      // Credit rating
    },
    
    // Observation Schedule
    observationFrequency: String,         // "monthly", "quarterly", "semi-annual", "annual"
    observationDates: [Date],            // Array of observation dates
    observationSchedule: [{              // Detailed observation schedule
      date: Date,
      paymentDate: Date,
      isCallable: Boolean,
      autocallLevel: Number,
      couponBarrier: Number,
      description: String
    }]
  },
  
  // === UNDERLYING ASSETS ===
  underlying: {
    basketType: String,                  // "best_of", "worst_of", "average_of" (null for single stock)
    assets: [{
      id: String,                        // Unique identifier within product
      isin: String,                      // ISIN code
      ticker: String,                    // Ticker symbol
      name: String,                      // Security name
      weight: Number,                    // Weight in basket (percentage, equal weight if not specified)
      strike: Number,                    // Strike price
      initialPrice: Number,              // Price at trade date
      currency: String,                  // Trading currency
      securityData: {                    // Additional security metadata
        country: String,
        sector: String,
        marketCap: Number,
        // ... other metadata
      }
    }]
  },
  
  // === PRODUCT-SPECIFIC CHARACTERISTICS ===
  characteristics: {
    // This object structure varies by product family
    // See product-specific schemas below
  },
  
  // === PAYOFF STRUCTURE (Drag & Drop Components) ===
  droppedItems: [{
    id: String,                          // Component unique ID
    type: String,                        // Component type
    label: String,                       // Display label
    section: String,                     // "life" or "maturity"
    column: String,                      // "timing", "condition", "action", "continuation"
    rowIndex: Number,                    // Row position
    sortOrder: Number,                   // Sort order within row
    value: Mixed,                        // Component-specific value
    // ... other component properties
  }],
  
  // === CALCULATION RESULTS ===
  calculations: {
    currentPerformance: [{
      underlyingId: String,
      currentPrice: Number,
      performance: Number,               // Percentage performance vs strike
      lastUpdated: Date
    }],
    productValue: Number,                // Current product value
    totalReturn: Number,                 // Total return percentage
    lastCalculated: Date
  },
  
  // === METADATA ===
  metadata: {
    createdBy: String,                   // User ID who created the product
    clientId: String,                    // Associated client (if any)
    tags: [String],                      // Searchable tags
    notes: String,                       // Additional notes
    isTemplate: Boolean,                 // Whether this is a template
    templateSource: String               // Source template ID if created from template
  }
}
```

## Product-Specific Characteristics Schemas

### Reverse Convertible Characteristics

```javascript
characteristics: {
  productFamily: "reverse_convertible",
  
  // Protection Features
  protectionBarrier: Number,             // Protection barrier level (percentage)
  protectionType: String,               // "european", "american"
  protectionReference: String,          // "worst_of", "average", "best_of"
  
  // Strike Information
  strike: Number,                       // Strike price/level (percentage or absolute)
  strikeType: String,                   // "percentage", "absolute"
  strikeReference: String,              // "initial", "fixing", "average"
  
  // Coupon Features
  couponRate: Number,                   // Fixed coupon rate (percentage)
  couponPaymentDates: [Date],           // Actual coupon payment dates
  couponBarrier: Number,                // Barrier for coupon payment (if applicable)
  couponMemory: Boolean,                // Whether unpaid coupons accumulate
  
  // Specific Settings
  knockInType: String,                  // "continuous", "discrete"
  settlementType: String,               // "cash", "physical"
  observationLevel: String,             // "closing", "intraday"
  
  // Capital Protection
  capitalProtection: Number,            // Capital protection level (percentage, usually 100)
  capitalAtRisk: Number,                // Amount at risk below barrier
  
  // Additional Features
  features: {
    hasMemoryFeature: Boolean,
    hasStepDown: Boolean,
    stepDownSchedule: [{
      date: Date,
      level: Number
    }],
    hasEarlyRedemption: Boolean,
    earlyRedemptionDates: [Date]
  }
}
```

### Phoenix/Autocall Characteristics

```javascript
characteristics: {
  productFamily: "phoenix",
  
  // Autocall Features
  autocallBarrier: Number,              // Autocall trigger level (percentage)
  autocallFrequency: String,            // Observation frequency for autocalls
  autocallDates: [Date],                // Potential autocall dates
  autocallAmounts: [{                   // Redemption amounts at each date
    date: Date,
    amount: Number
  }],
  
  // Memory Coupon Features
  memoryCouponRate: Number,             // Memory coupon rate per period
  couponBarrier: Number,                // Barrier for coupon payment
  memoryFeature: Boolean,               // Whether unpaid coupons are remembered
  
  // Protection Features
  protectionBarrier: Number,            // Final protection barrier
  protectionType: String,               // "american", "european"
  
  // Step Down Features
  hasStepDown: Boolean,                 // Whether barriers step down
  stepDownSchedule: [{
    date: Date,
    autocallLevel: Number,
    couponBarrier: Number
  }],
  
  // Specific Settings
  observationType: String,              // "closing", "intraday"
  settlementType: String,               // "cash", "physical"
  
  // Additional Features
  features: {
    hasKnockOut: Boolean,
    knockOutBarrier: Number,
    hasLock: Boolean,
    lockFeature: {
      enabled: Boolean,
      lockLevel: Number,
      lockDates: [Date]
    }
  }
}
```

### ORION Characteristics

```javascript
characteristics: {
  productFamily: "orion",
  
  // Average Performance Features
  averageType: String,                  // "arithmetic", "geometric"
  averageReference: String,             // "closing", "fixing"
  averagingDates: [Date],               // Dates for averaging calculation
  
  // Cap Features
  capLevel: Number,                     // Cap level (percentage)
  capType: String,                      // "hard_cap", "soft_cap"
  capApplication: String,               // "individual", "basket"
  
  // Lock Features
  lockFeature: {
    enabled: Boolean,
    lockLevel: Number,                  // Level at which assets lock
    lockType: String,                   // "individual", "basket"
    lockDates: [Date]                   // Potential lock dates
  },
  
  // Protection Features
  protectionLevel: Number,              // Final protection level
  protectionType: String,               // Type of protection
  
  // Basket Features
  basketDefinition: {
    numberOfAssets: Number,
    selectionCriteria: String,          // "best_of", "worst_of", "average"
    rebalancing: {
      enabled: Boolean,
      frequency: String,
      dates: [Date]
    }
  },
  
  // Additional Features
  features: {
    hasMemoryFeature: Boolean,
    hasBarrierMonitoring: Boolean,
    monitoringLevel: Number
  }
}
```

### Himalaya Characteristics

```javascript
characteristics: {
  productFamily: "himalaya",
  
  // Best Performer Selection
  selectionMethod: String,              // "best_performer", "worst_performer"
  selectionFrequency: String,           // How often selection is made
  selectionDates: [Date],               // Dates when selection occurs
  
  // Mountain Range Features
  mountainType: String,                 // "himalaya", "atlas", "everest"
  participationRate: Number,            // Participation in best performer
  
  // Basket Management
  basketEvolution: [{
    date: Date,
    selectedAssets: [String],           // Asset IDs selected at this date
    performance: Number
  }],
  
  // Protection Features
  protectionLevel: Number,              // Final protection
  protectionType: String,
  
  // Lock Features
  lockFeature: {
    enabled: Boolean,
    lockMethod: String,                 // "individual", "collective"
    lockLevel: Number
  },
  
  // Additional Features
  features: {
    hasCallFeature: Boolean,
    callLevel: Number,
    callDates: [Date],
    hasCapFeature: Boolean,
    capLevel: Number
  }
}
```

### Participation Certificate Characteristics

```javascript
characteristics: {
  productFamily: "participation",
  
  // Participation Features
  participationRate: Number,            // Upside participation rate
  leverageRatio: Number,                // Leverage factor
  participationCap: Number,             // Maximum participation (if capped)
  
  // Capital Guarantee
  capitalGuarantee: Number,             // Guaranteed capital return (percentage)
  guaranteeDate: Date,                  // Date when guarantee applies
  guaranteeType: String,                // "full", "partial"
  
  // Knock-out Features
  knockOutFeature: {
    enabled: Boolean,
    knockOutBarrier: Number,
    knockOutType: String,               // "american", "european"
    rebate: Number                      // Rebate if knocked out
  },
  
  // Performance Calculation
  performanceCalculation: {
    reference: String,                  // "final", "average", "best_of"
    calculationDates: [Date],
    method: String                      // "arithmetic", "geometric"
  },
  
  // Additional Features
  features: {
    hasFloor: Boolean,
    floorLevel: Number,
    hasCap: Boolean,
    capLevel: Number,
    hasCallProtection: Boolean,
    callProtectionPeriod: Number
  }
}
```

## Database Collections

### Products Collection
- **Collection Name**: `products`
- **Schema**: Base Product Schema (above)
- **Indexes**: 
  - `productId` (unique)
  - `productFamily`
  - `status`
  - `commonDetails.tradeDate`
  - `commonDetails.maturityDate`
  - `metadata.createdBy`

### Templates Collection
- **Collection Name**: `templates`
- **Schema**: Same as products but with `metadata.isTemplate: true`
- **Purpose**: Store reusable product templates

### Sessions Collection
- **Collection Name**: `sessions`
- **Schema**: User session data for tracking product creation progress

## Schema Evolution Guidelines

### Version Management
- All products must include a `version` field
- Schema changes require version increment
- Migration scripts handle version upgrades

### Adding New Product Families
1. Define characteristics schema in this document
2. Add to `productFamily` enum validation
3. Create template examples
4. Update UI form components
5. Add to report generation logic

### Field Naming Conventions
- Use camelCase for all field names
- Use descriptive, unambiguous names
- Prefix product-specific fields appropriately
- Maintain consistency across product families

### Data Validation Rules
- Required fields must be marked and validated
- Numeric fields include min/max ranges
- Date fields include proper validation
- Enum fields have defined allowed values
- Cross-field validation rules documented

## Examples

### Complete Reverse Convertible Example

```javascript
{
  _id: ObjectId("..."),
  productId: "RC-TSLA-2024-001",
  title: "Tesla 8.5% Reverse Convertible Note - 70% Protection",
  description: "Capital protected note with 8.5% quarterly coupons",
  productFamily: "reverse_convertible",
  status: "active",
  version: 1,
  createdAt: ISODate("2024-01-15T10:00:00Z"),
  updatedAt: ISODate("2024-01-15T10:00:00Z"),
  
  commonDetails: {
    tradeDate: ISODate("2024-01-15T00:00:00Z"),
    valueDate: ISODate("2024-01-17T00:00:00Z"),
    finalObservation: ISODate("2025-01-13T00:00:00Z"),   // Market observation that determines outcome
    maturityDate: ISODate("2025-01-15T00:00:00Z"),       // Settlement date (T+2 after final observation)
    currency: "USD",
    notional: 100000,
    denomination: 1000,
    issuer: {
      name: "Goldman Sachs",
      id: "GS",
      rating: "A+"
    },
    observationFrequency: "quarterly",
    observationDates: [
      ISODate("2024-04-15T00:00:00Z"),
      ISODate("2024-07-15T00:00:00Z"),
      ISODate("2024-10-15T00:00:00Z"),
      ISODate("2025-01-13T00:00:00Z")
    ]
  },
  
  underlying: {
    basketType: null,                    // null for single stock
    assets: [{
      id: "tsla-1",
      isin: "US88160R1014",
      ticker: "TSLA",
      name: "Tesla Inc",
      weight: 100,
      strike: 250.00,
      initialPrice: 250.00,
      currency: "USD"
    }]
  },
  
  characteristics: {
    productFamily: "reverse_convertible",
    protectionBarrier: 70,
    protectionType: "european",
    protectionReference: "worst_of",
    strike: 100,
    strikeType: "percentage",
    strikeReference: "initial",
    couponRate: 8.5,
    couponMemory: false,
    knockInType: "continuous",
    settlementType: "cash",
    capitalProtection: 100,
    features: {
      hasMemoryFeature: false,
      hasStepDown: false,
      hasEarlyRedemption: false
    }
  },
  
  metadata: {
    createdBy: "user123",
    tags: ["tesla", "tech", "quarterly-coupon"],
    isTemplate: false
  }
}
```

### Basket Product Example

```javascript
// Example of a reverse convertible with a worst-of basket
{
  // ... other fields ...
  
  underlying: {
    basketType: "worst_of",              // Required when multiple assets
    assets: [
      {
        id: "tsla-1",
        isin: "US88160R1014",
        ticker: "TSLA",
        name: "Tesla Inc",
        weight: 33.33,
        strike: 250.00,
        initialPrice: 250.00,
        currency: "USD"
      },
      {
        id: "aapl-1",
        isin: "US0378331005",
        ticker: "AAPL",
        name: "Apple Inc",
        weight: 33.33,
        strike: 180.00,
        initialPrice: 180.00,
        currency: "USD"
      },
      {
        id: "googl-1",
        isin: "US02079K3059",
        ticker: "GOOGL",
        name: "Alphabet Inc Class A",
        weight: 33.34,
        strike: 140.00,
        initialPrice: 140.00,
        currency: "USD"
      }
    ]
  },
  
  // ... rest of product structure ...
}
```

## Business Logic Rules

### Basket Type Requirements
- **Single Asset**: `basketType` should be `null` when `assets.length === 1`
- **Multiple Assets**: `basketType` is required when `assets.length >= 2` and must be one of:
  - `"best_of"` - Performance based on best performing asset
  - `"worst_of"` - Performance based on worst performing asset  
  - `"average_of"` - Performance based on average of all assets

### Weight Management
- **Single Asset**: Weight should be 100%
- **Multiple Assets**: Weights should sum to 100%
- **Equal Weight Default**: If weights not specified, distribute equally among assets

This schema ensures consistency while allowing flexibility for product-specific features and future expansion.