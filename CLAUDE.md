# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Running the Application
- `meteor run` or `npm start` - Start the Meteor development server
- The application will be available at http://localhost:3000

### Testing
- `meteor test --once --driver-package meteortesting:mocha` or `npm test` - Run tests once
- `TEST_WATCH=1 meteor test --full-app --driver-package meteortesting:mocha` or `npm run test-app` - Run full app tests in watch mode
- Tests use Mocha testing framework
- Test files are located in the `tests/` directory

### Build and Analysis
- `meteor --production --extra-packages bundle-visualizer` or `npm run visualize` - Analyze bundle size in production mode

## Project Architecture

This is a Meteor.js application with React frontend, following the standard Meteor project structure:

### Directory Structure
- `client/` - Client-side entry point and static assets
- `server/` - Server-side entry point and logic
- `imports/` - Shared code imported by client/server
  - `imports/api/` - Database collections and server-side logic
  - `imports/ui/` - React components and UI logic
  - `imports/constants/` - Shared constants and configuration data
  - `imports/utils/` - Reusable utility functions
  - `imports/ui/components/` - Extracted React components
- `tests/` - Test files

### Key Components
- **App.jsx**: Main application component
- **StructuredProductInterface.jsx**: Advanced drag-and-drop interface for creating structured financial products (5,240 lines)
  - Templates, logic operators, and complex payoff structures
  - Database-driven template management with reactive loading
  - Modular architecture with extracted components
- **UnderlyingCreationModule.jsx**: Extracted component (371 lines) for underlying asset management
  - Complex security autocomplete and basket functionality
  - Strike price population with cascading fallback logic

### Collections and Data
- **ProductsCollection**: MongoDB collection for storing structured products data
- **TemplatesCollection**: MongoDB collection for storing user-created product templates with versioning
- **SessionsCollection**: MongoDB collection for user session management with security tracking
- **MarketDataCacheCollection**: MongoDB collection for cached market price data
- **PMSHoldings**: MongoDB collection for Portfolio Management System holdings data from multiple banks

### Bank File Parsers and Number Formatting Standardization

**🚨 CRITICAL ARCHITECTURE RULE - MANDATORY FOR ALL BANK PARSERS 🚨**

**ALL NUMBER FORMATTING AND NORMALIZATION MUST HAPPEN AT THE PARSER LEVEL DURING FILE PROCESSING**

#### Core Principle: Standardized Database Storage

The database must contain **normalized, standardized values** in decimal format. Each bank parser is responsible for converting bank-specific formats into our standardized schema **before** storing data.

#### Standardization Requirements:

**1. Percentage-Based Prices → Decimal Format**
- **Storage Format**: Always store as decimal (e.g., `1.0` = 100%, `0.6641` = 66.41%)
- **Display Format**: Multiply by 100 when displaying (handled by UI layer)
- **Example**:
  - CSV value: `66.41%` or `100`
  - Stored in DB: `0.6641` or `1.0`
  - Displayed: `66.41%` or `100.00%`

**2. Instrument-Specific Price Formats**
Different instrument types may store prices differently in bank files:
- **Bonds**: Often already in decimal format (1.0 = 100%)
- **Structured Products**: Often in percentage format (100 = 100%)
- **Equities**: Usually absolute prices

**Parser must detect and normalize accordingly**

**3. Cost Basis Calculations**
- Cost basis should be calculated using **normalized prices**
- Formula: `quantity × normalizedPrice`
- No instrument-type logic in calculation functions
- All complexity handled during normalization

#### Julius Baer Parser Example (Reference Implementation)

Location: `/imports/api/parsers/juliusBaerParser.js`

**Key Implementation Details:**

```javascript
// Centralized price normalization function
normalizePrice(rawValue, posCalc, fieldName, isin) {
  if (!rawValue && rawValue !== 0) return null;

  const isPercentageType = posCalc === '%';

  // If not a percentage type, return as-is (absolute price)
  if (!isPercentageType) {
    return rawValue;
  }

  // For percentage types, always divide by 100 to convert to decimal
  // This handles both formats consistently:
  // - 66.91 (representing 66.91%) → 0.6691
  // - 0.727 (representing 0.727%) → 0.00727
  return rawValue / 100;
}

// Usage in mapToStandardSchema()
const normalizedCostPrice = this.normalizePrice(
  this.parseNumber(row.COST_PRICE),
  row.POS_CALC,
  'COST_PRICE',
  row.INSTR_ISIN_CODE
);
```

**Smart Format Detection:**
Julius Baer CSV files are inconsistent - different price fields use different formats!
- **POS_PRICE (current)**: Usually percentage format (66.91 = 66.91%)
- **COST_PRICE (average)**: Usually decimal format (0.727 = 72.7%)

The parser uses value-range heuristics to detect the correct format:
- **Value >= 10** with POS_CALC='%' → Percentage format → Divide by 100
  - Example: 66.91 → 0.6691 (66.91%)
  - Example: 100.0 → 1.0 (100%)
- **Value < 10** with POS_CALC='%' → Already decimal → Use as-is
  - Example: 0.727 → 0.727 (72.7%)
  - Example: 0.05 → 0.05 (5%)
- **Explicit "%" symbol**: "66.41%" → 0.6641 (detected in parseNumber)
- **POS_CALC ≠ '%'**: Absolute prices → 335.50 (no normalization)

**Fields That Must Be Normalized:**
- `marketPrice`: Normalized via normalizePrice() function
- `costPrice`: Normalized via normalizePrice() function
- All cost basis calculations use normalized values
- Market values in currency units (no normalization needed)

**Detection Logic:**
- Primary indicator: `POS_CALC` field (% vs absolute)
- Secondary: Detect '%' symbol in value string
- Consistent normalization regardless of raw value format
- Julius Baer may write prices as "66.91" or "0.727" - both handled correctly

#### When Adding a New Bank Parser:

**Required Steps:**

1. **Create Parser File**: `/imports/api/parsers/[bankname]Parser.js`

2. **Implement Detection Logic**:
   - Identify how the bank indicates percentage vs absolute pricing
   - Create a `normalizePrice()` function similar to Julius Baer parser
   - Handle explicit percentage strings (with '%' symbol) in `parseNumber()`
   - Document bank-specific field mappings in code comments

3. **Normalize All Price Fields**:
   - Convert percentage prices to decimal (÷ 100) consistently
   - Use centralized normalization function for all price fields
   - Handle multiple input formats (66.91, 0.727, "66.41%") uniformly
   - Document bank-specific quirks and value ranges in comments

4. **Calculate Derived Fields**:
   - Use normalized values for all calculations
   - Cost basis, unrealized P&L, performance metrics
   - Keep calculation functions simple and generic

5. **Map to Standardized Schema**:
   - Output must match PMSHoldings schema exactly
   - All prices in decimal format
   - All dates as Date objects
   - Currency codes standardized (ISO 4217)

6. **Test Both Instrument Types**:
   - Verify bonds display correctly
   - Verify structured products display correctly
   - Verify equities display correctly
   - Verify cost basis calculations are accurate

#### Benefits of This Architecture:

✅ **Consistent Database**: All banks store data in same format
✅ **Simple Display Logic**: UI just multiplies by 100 for percentages
✅ **Bank Independence**: Each parser handles its own quirks
✅ **Easy Maintenance**: Bug fixes don't affect other banks
✅ **Scalable**: Adding new banks doesn't require UI changes

#### Anti-Patterns to Avoid:

❌ **DO NOT** store raw bank values without normalization
❌ **DO NOT** put normalization logic in UI components
❌ **DO NOT** put normalization logic in calculation functions
❌ **DO NOT** assume all banks use same price formats
❌ **DO NOT** hardcode instrument type logic in multiple places

**The parser is the ONLY place where bank-specific formatting logic should exist.**

### Bank-Provided FX Rates Implementation

**🚨 CRITICAL: Store Bank FX Rates in Each Holding for Cash Monitoring Consistency 🚨**

When banks provide FX rates in their files, we store them in each holding's `bankFxRates` field. This ensures cash calculations match bank statements exactly.

#### FX Rate Architecture Overview

| Source | Storage | Priority |
|--------|---------|----------|
| **Bank-provided rates** | `PMSHoldings.bankFxRates` field | **First** (used if available) |
| **EOD API rates** | `CurrencyRateCacheCollection` | Fallback (if bank rate missing) |

#### Required `bankFxRates` Field Format

Every parser must add a `bankFxRates` field to each holding:

```javascript
// In mapToStandardSchema() return object:
bankFxRates: {
  'USD': 1.0850,  // Rate for converting USD to EUR
  'GBP': 0.8520,  // Rate for converting GBP to EUR
  'ILS': 3.7793   // Rate for converting ILS to EUR
}
```

**Rate Format**: All rates must be stored in "divide" format:
- `EUR = amount / rate`
- Example: 100 USD / 1.085 = 92.17 EUR

The cash calculator automatically converts these to "multiply" format internally.

#### How FX Rates Flow Through the System

```
Bank File (CSV)           Parser                    PMSHoldings              Cash Calculator
  ┌──────────────┐       ┌──────────────┐          ┌──────────────┐         ┌──────────────┐
  │ FX rate file │ ───▶  │ parseFxRates()│ ───▶    │ bankFxRates  │ ───▶    │ extractBank- │
  │ or CSV field │       │              │          │ { USD: 1.08 }│         │ FxRates()    │
  └──────────────┘       └──────────────┘          └──────────────┘         └──────────────┘
                                                                                    │
                                                                                    ▼
  EOD API                                                                   ┌──────────────┐
  ┌──────────────┐                                                          │ mergeRates-  │
  │ FOREX pairs  │ ─────────────────────────────────────────────────────▶   │ Maps()       │
  └──────────────┘                                                          │ (bank wins)  │
                                                                            └──────────────┘
```

#### Implementation by Bank

**1. CMB Monaco** - Separate FX rates file (`curry_xchng`)
```javascript
// In parseFxRates():
// Returns: { 'USD': { 'EUR': 1.0850 }, 'GBP': { 'EUR': 0.8520 } }

// In mapToStandardSchema():
bankFxRates: Object.keys(fxRates).reduce((acc, currency) => {
  if (fxRates[currency] && fxRates[currency]['EUR']) {
    acc[currency] = fxRates[currency]['EUR'];
  }
  return acc;
}, {}),
```

**2. CFM (Indosuez)** - Separate FX rates file (`crsc`)
```javascript
// In parseFxRates():
// Returns: { 'ILS': 3.779, 'GBP': 0.823 } (units per 1 EUR)

// In mapToStandardSchema():
bankFxRates: fxRates,  // Already in correct format
```

**3. Julius Baer** - Per-position exchange rates in CSV
```javascript
// CSV fields: PTF_POS_CCY_EXCH, PRICE_EXCH_RATE, COST_EXCH_RATE

// In mapToStandardSchema():
bankFxRates: (() => {
  const positionCurrency = row.POS_PRICE_CCY_ISO || row.INSTR_REF_CCY_ISO;
  const exchangeRate = this.parseNumber(row.PTF_POS_CCY_EXCH);
  if (positionCurrency && exchangeRate && positionCurrency !== 'EUR') {
    return { [positionCurrency]: exchangeRate };
  }
  return {};
})(),
```

**4. Andbank** - Per-position exchange rates in CSV (MULTIPLY format)
```javascript
// CSV fields: EXCH_RATE_PTF, EXCH_RATE_CUST
// ⚠️ Andbank uses MULTIPLY format, must convert to DIVIDE format!

// In mapToStandardSchema():
bankFxRates: (() => {
  const positionCurrency = row.ROW_CCY;
  const rate = this.parseNumber(row.EXCH_RATE_PTF);
  if (positionCurrency && rate && rate !== 0 && positionCurrency !== 'EUR') {
    // Store inverse: Andbank rate is "multiply", convert to "divide" format
    return { [positionCurrency]: 1 / rate };
  }
  return {};
})(),
```

#### When Adding a New Bank Parser

**Step 7: Implement Bank FX Rates** (add to existing checklist)

1. **Identify FX Rate Source**:
   - Separate FX rates file? (like CMB Monaco `curry_xchng`, CFM `crsc`)
   - Per-position exchange rate fields? (like Julius Baer, Andbank)
   - Derived from market values? (calculate from value in two currencies)

2. **Determine Rate Format**:
   - **"Divide" format**: `EUR = amount / rate` (CMB Monaco, CFM, Julius Baer)
   - **"Multiply" format**: `EUR = amount * rate` (Andbank - must convert!)

3. **Implement `parseFxRates()` if Separate File**:
   ```javascript
   parseFxRates(csvContent) {
     const rates = {};
     // Parse file, extract currency → rate pairs
     // Return: { 'USD': 1.085, 'GBP': 0.852, ... }
     return rates;
   }
   ```

4. **Add `bankFxRates` to Holdings Output**:
   ```javascript
   // In mapToStandardSchema() return object, add:
   bankFxRates: {
     // Map of currency → EUR rate (in DIVIDE format)
     // If bank uses multiply format, store 1/rate
   },
   ```

5. **Test FX Conversion**:
   - Verify cash monitoring shows correct EUR amounts
   - Compare with bank statement values
   - Check logs for `[CashCalculator] Using bank-provided rate for {currency}`

#### Key Files for FX Rate Implementation

| File | Purpose |
|------|---------|
| `imports/api/helpers/cashCalculator.js` | `extractBankFxRates()`, `mergeRatesMaps()` |
| `imports/api/parsers/{bank}Parser.js` | `parseFxRates()`, `bankFxRates` field |
| `imports/api/currencyCache.js` | EOD API fallback rates |
| `server/methods/bankPositionMethods.js` | Calls cash calculator |

#### Verification Logs

When bank rates are used, you'll see:
```
[CashCalculator] Using bank-provided rate for ILS: 0.264589
[CashCalculator] Using bank-provided rate for USD: 0.921659
[CASH_CHECK] Portfolio 640131: pureCashEUR=-600000.00...
```

When bank rates are missing (falls back to EOD):
```
[CashCalculator] No EUR rate found for SEK, using value as-is
```

### Technology Stack
- **Framework**: Meteor.js
- **Frontend**: React 18 with functional components and hooks
- **Database**: MongoDB (via Meteor's Mongo package)
- **Drag & Drop**: react-dnd with HTML5 backend for advanced drag-and-drop interactions
- **Testing**: Mocha
- **Build**: Meteor's built-in build system

## Development Notes

### File Imports
- Use absolute imports from `/imports/` for shared code
- Meteor handles ES6 modules and JSX compilation automatically

### Database Operations
- Use async/await with Meteor's modern collection methods (insertAsync, find().countAsync(), etc.)
- Collections are reactive and automatically update connected clients

### React Integration
- Components use Meteor's React hooks for data subscriptions
- Standard React patterns for state management and event handling
- Complex drag-and-drop interactions using react-dnd hooks (useDrag, useDrop)

## Template-Specific Product Architecture

### Core Philosophy: Template-Based Product Evaluation

Our structured products application uses a **template-specific architecture** where each product type has dedicated evaluators and chart builders. The drag-and-drop interface is used for template design, while evaluation is handled by template-specific code.

### Architecture Components

#### Evaluators (`/imports/api/evaluators/`)
Each product template has a dedicated evaluator:
- `phoenixEvaluator.js` + `phoenixEvaluationHelpers.js`
- `orionEvaluator.js` + `orionEvaluationHelpers.js`
- `himalayaEvaluator.js` + `himalayaEvaluationHelpers.js`
- `sharkNoteEvaluator.js` + `sharkNoteEvaluationHelpers.js`
- `participationNoteEvaluator.js` + `participationNoteEvaluationHelpers.js`
- `reverseConvertibleEvaluator.js` + `reverseConvertibleEvaluationHelpers.js`
- `reverseConvertibleBondEvaluator.js` + `reverseConvertibleBondEvaluationHelpers.js`
- `sharedEvaluationHelpers.js` - Common utilities across evaluators

#### Chart Builders (`/imports/api/chartBuilders/`)
Template-specific chart generation for each product type, creating pre-calculated Chart.js configurations.

#### Supporting Infrastructure
- `/imports/api/productTypeAnalyzer.js` - Detects product features from structure
- `/imports/api/evaluationContext.js` - Manages market data and evaluation state
- `/imports/api/genericComponentLibrary.js` - Generic component definitions for drag-and-drop interface
- `/imports/api/mathematicalPrimitives.js` - Mathematical building blocks for calculations

#### Report Components (`/imports/ui/templates/`)
Template-specific report rendering:
- `PhoenixReport.jsx` / `PhoenixReportPDF.jsx`
- `OrionReport.jsx` / `OrionReportPDF.jsx`
- `HimalayaReport.jsx`
- `SharkNoteReport.jsx`
- `ParticipationNoteReport.jsx` / `ParticipationNoteReportPDF.jsx`
- `ReverseConvertibleReport.jsx`
- `ReverseConvertibleBondReport.jsx`

### Adding New Product Templates

1. Create evaluator: `/imports/api/evaluators/{templateName}Evaluator.js`
2. Create helpers: `/imports/api/evaluators/{templateName}EvaluationHelpers.js`
3. Create chart builder: `/imports/api/chartBuilders/{templateName}ChartBuilder.js`
4. Create report component: `/imports/ui/templates/{TemplateName}Report.jsx`
5. Register in productTypeAnalyzer.js

## Report Architecture and Data Flow

### Core Principle: Report Page is Display-Only

**🚨 CRITICAL ARCHITECTURAL RULE - NEVER VIOLATE 🚨**
**ABSOLUTE PROHIBITION: NO CALCULATIONS IN REPORTING COMPONENTS**

The report page (`TemplateProductReport.jsx` and template-specific report components in `/imports/ui/templates/`) performs **ZERO calculations, computations, or data transformations**. All data comes pre-calculated from the report object stored in the database.

#### WHAT IS FORBIDDEN IN REPORTS:
- ❌ **NO mathematical operations** (addition, subtraction, multiplication, division)
- ❌ **NO percentage calculations** (performance, returns, ratios)
- ❌ **NO date arithmetic** (days between dates, time calculations)
- ❌ **NO formatting computations** (currency formatting with calculations)
- ❌ **NO conditional logic based on calculations** (if price > strike, etc.)
- ❌ **NO data aggregations** (sums, averages, maximums, minimums)
- ❌ **NO performance metrics** (volatility, returns, comparisons)

#### WHAT IS REQUIRED IN REPORTS:
- ✅ **PURE DATA DISPLAY**: Show only pre-computed values from database
- ✅ **STATIC FORMATTING**: Use pre-formatted strings from processor
- ✅ **SIMPLE CONDITIONALS**: Show/hide based on boolean flags, not calculations
- ✅ **DIRECT VALUE ACCESS**: Display `report.data.formattedValue`, not `calculateValue(report.data.raw)`

#### MANDATORY APPROACH:
1. **All calculations happen during evaluation/processing phase**
2. **Results are stored as formatted, display-ready values in database**
3. **Reports access pre-computed fields like `performanceFormatted`, `daysToMaturityText`**
4. **UI components only handle styling, layout, and conditional display**

#### EXAMPLES OF CORRECT vs INCORRECT:

**❌ WRONG (Calculations in Report):**
```javascript
// In TemplateProductReport.jsx - FORBIDDEN
const performance = ((currentPrice - initialPrice) / initialPrice) * 100;
const formatted = `${performance >= 0 ? '+' : ''}${performance.toFixed(2)}%`;
const daysToMaturity = Math.ceil((maturityDate - new Date()) / (1000*60*60*24));
```

**✅ CORRECT (Display Pre-computed Data):**
```javascript
// In TemplateProductReport.jsx - REQUIRED
const performance = underlying.performanceFormatted; // "+36.90%"
const daysText = status.daysToMaturityText; // "-218 days (matured)"
const isPositive = underlying.isPositive; // true/false
```

**❌ WRONG (Processing in Report):**
```javascript
// FORBIDDEN - Processing during display
{underlyings.map(u => (
  <div>Performance: {((u.current - u.initial) / u.initial * 100).toFixed(2)}%</div>
))}
```

**✅ CORRECT (Display Processed Data):**
```javascript
// REQUIRED - Show pre-processed values
{underlyings.map(u => (
  <div>Performance: {u.performanceFormatted}</div>
))}
```

#### THE ACID TEST:
**If you see any arithmetic operators (+, -, *, /), Math functions, or .toFixed() in a report component, it violates this rule and must be moved to the processor.**

#### CONSEQUENCES OF VIOLATION:
- Performance degradation from repeated calculations
- Inconsistent data presentation across different views
- Difficulty in caching and optimization
- Violation of separation of concerns architecture
- Makes testing and debugging more complex

**ORIGINAL CRITICAL RULE**: The report pages (`TemplateProductReport.jsx` and template-specific components) perform **ZERO calculations**. All data comes pre-calculated from the report object stored in the database.

#### Data Flow:
1. **Processing Stage** (Rule Engine): All calculations, evaluations, and data transformations happen during product evaluation
2. **Storage Stage**: Complete report object with all calculated fields is saved to MongoDB reports collection  
3. **Display Stage**: Report UI simply reads and displays data from the report object

### Chart Data Architecture

**Chart Data Collection Structure**: Every product evaluation automatically generates a comprehensive chart data object stored in the `chartData` collection. The UI never calculates chart data - it only displays the pre-built chart configuration.

#### Chart Data Object Structure

```javascript
{
  _id: ObjectId,
  productId: String,                    // Reference to the product
  type: "performance_chart",            // Chart type identifier
  
  // Complete Chart.js Configuration
  data: {
    labels: ["2024-02-16", "2024-02-17", ...],  // Daily date labels (YYYY-MM-DD)
    datasets: [
      {
        label: "TSLA",                   // Underlying name
        data: [                          // Rebased performance data (normalized to 100 at initial)
          { x: "2024-02-16", y: 100.00 },
          { x: "2024-02-17", y: 98.45 },
          ...
        ],
        borderColor: "#0ea5e9",          // Line color
        backgroundColor: "#0ea5e920",     // Fill color (with opacity)
        borderWidth: 2.5,
        isPercentage: true,
        underlyingTicker: "TSLA",
        initialPrice: 335.58,            // Original price at launch
        dataPoints: 365                  // Number of data points generated
      },
      {
        label: "Protection Barrier (70%)", // Barrier level
        data: [
          { x: "2024-02-16", y: 70 },
          { x: "2024-02-17", y: 70 },
          ...
        ],
        borderColor: "#ef4444",
        borderDash: [5, 5],              // Dashed line style
        isPercentage: true
      }
    ]
  },
  
  options: {
    // Complete Chart.js options with styling, plugins, scales
    responsive: true,
    plugins: {
      title: { 
        text: "TSLA Reverse Convertible - Performance Chart" 
      },
      annotation: {
        annotations: {
          // Vertical line annotations for key dates
          initialDate: {
            type: "line",
            xMin: 0, xMax: 0,            // Index position in labels array
            borderColor: "#374151",
            label: { content: "Launch", backgroundColor: "#374151" }
          },
          observation_0: {
            type: "line", 
            xMin: 90, xMax: 90,          // Index for observation date
            borderColor: "#6b7280",
            label: { content: "Obs 1", backgroundColor: "#6b7280" }
          },
          // Point annotations for events
          coupon_0: {
            type: "point",
            xValue: 90,                  // Index position
            yValue: 102,                 // Y-axis level
            backgroundColor: "#10b981",
            label: { content: "Coupon: 3.5%" }
          }
        }
      }
    },
    scales: {
      x: { /* X-axis configuration */ },
      y: { /* Y-axis configuration with % formatting */ }
    }
  },
  
  // Chart metadata (not displayed but used by UI components)
  metadata: {
    productId: "8yH86me3FA8ydkGoJ",
    productTitle: "TSLA Reverse Convertible",
    chartTitle: "TSLA Reverse Convertible - Performance Evolution",
    initialDate: "2024-02-16",          // Product launch date
    finalDate: "2025-02-16",            // Product maturity date
    evaluationDate: "2024-08-15T10:30:00.000Z",
    hasMatured: false,                  // Whether product has reached maturity
    timeToMaturity: {
      totalDays: 185,
      tradingDays: 132,
      months: 6,
      years: 0.5
    },
    observationDates: ["2024-05-16", "2024-08-16", "2024-11-16", "2025-02-16"],
    couponDates: ["2024-05-16", "2024-08-16"],
    eventDates: [...],                  // All significant events
    dataPoints: 365,                    // Total chart data points
    underlyingCount: 1,                 // Number of underlying assets
    barrierCount: 1,                    // Number of barrier lines
    eventCount: 3,                      // Number of event annotations
    generatedAt: "2024-08-15T10:30:15.123Z",
    version: "2.0.0"
  },
  
  // Database fields
  generatedAt: Date,
  version: "2.0.0"
}
```

#### Chart Features

1. **Rebased Performance Lines**: All underlying assets are normalized to 100 at the initial date, showing relative performance evolution

2. **Time-Aware Display**: Chart shows actual price data up to today's date, then extends the x-axis to maturity to visualize remaining time

3. **Vertical Annotations**: Automatic vertical lines for:
   - Launch date ("Launch")
   - Observation dates ("Obs 1", "Obs 2", etc.)
   - Final observation ("Final")
   - Maturity date ("Maturity") if different from final observation

4. **Barrier Lines**: Horizontal dashed lines showing:
   - Protection barriers (red dashed)
   - Autocall levels (green dashed)
   - Coupon barriers (orange dashed)
   - Reference lines (gray dashed)

5. **Generic Event Points**: Point annotations for any product events:
   - Coupon payments (green circles)
   - Autocall triggers (blue circles)
   - Barrier touches (red circles)
   - Memory events (purple circles)
   - Custom events (configurable colors)

6. **Smart Grid and Styling**: Light grid lines, optimized axis labels, responsive design

#### Generic Event Point Structure

All event points use a universal structure that works for any product type:

```javascript
{
  type: "point",
  xValue: 90,                          // Index position in date array
  yValue: 102,                         // Y-axis position (percentage)
  backgroundColor: "#10b981",          // Event-specific color
  borderColor: "#10b981",
  radius: 6,                           // Point size
  label: {
    content: "Coupon: 3.5%",           // Generic description
    backgroundColor: "#10b981",
    position: "top"                    // Label position
  },
  // Generic event metadata
  eventType: "coupon",                 // Event classification
  eventDate: "2024-05-16",            // Event date
  eventData: {                        // Event-specific data
    rate: 3.5,
    amount: 3.5,
    description: "Coupon: 3.5%"
  }
}
```

This architecture ensures:
- **Zero UI Calculations**: All chart data is pre-computed during report processing
- **Universal Compatibility**: Works with any product structure or payoff design
- **Complete Self-Containment**: Chart objects include all styling, annotations, and metadata
- **Generic Event System**: New event types work without code changes
- **Performance Optimization**: No real-time calculations in the UI

#### What Gets Pre-Calculated:
- **Market Data**: Current prices, redemption prices, performance calculations
- **Maturity Status**: Whether product has matured, appropriate pricing dates
- **Payoff Calculations**: Total payouts, condition evaluations, triggered actions
- **Schedule Generation**: All product timeline events with dates and amounts
- **Summary Metrics**: Capital protection status, coupon payments, early termination flags

#### For Matured/Redeemed Products:
- **Pricing Date Logic**: Automatically uses maturity/redemption date instead of current date
- **Historical Pricing**: Shows actual redemption prices, not current market prices  
- **Performance Calculations**: Based on redemption date pricing, not live market data
- **Schedule Status**: Events marked as 'completed' or 'upcoming' based on evaluation date

#### Benefits:
- **Performance**: No expensive calculations during page load
- **Consistency**: Same data regardless of when report is viewed
- **Historical Accuracy**: Matured products show actual redemption data, not current market prices
- **Scalability**: Report pages load instantly with pre-calculated data
- **Reliability**: No dependency on live market data for historical reports

This design ensures that report data is immutable once generated and reflects the actual state of the product at the time of evaluation.
- there is no conflict, maturity is always after final. final is the last observation on the market. maturity is when the coupon is settled by the bank, it doesn't play a role in the product,
- no hardcoding, no mock data, always generic logic to adapt to different structured product payoffs
- never fake data
- don't deploy before I say