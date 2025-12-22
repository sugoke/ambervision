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

## Recent Updates (January 2025)

### MarketTicker Enhancements
- **Hover to Pause**: MarketTicker now pauses scrolling when hovering over it using CSS `animation-play-state: paused`
- **Smooth Animation**: Fixed scrolling issues with proper CSS keyframes and viewport-based positioning
- **Live Price Integration**: Enhanced server-side price fetching with proper EOD API integration and fallback handling
- **Performance**: Reduced server logging noise and improved client-side data processing

### Direct Equities Portfolio Management
- **Styled Confirmation Modals**: Replaced browser default `confirm()` with custom styled modals matching app theme
- **Holdings Management**: Added modify, buy more, and sell functionality for equity positions
- **Real-time Price Updates**: Integrated with market data cache for live price updates
- **Portfolio Analytics**: Enhanced return calculations and performance tracking

### Infrastructure Improvements
- **Logging Cleanup**: Removed verbose [EQUITY PUB] and server logs that were flooding console
- **Cache Optimization**: Improved ticker price caching with 15-minute refresh intervals
- **Error Handling**: Better handling of "NA" values from EOD API responses
- **Database Optimization**: Enhanced query performance for equity holdings and market data

### Database Access
To access the MongoDB database directly (when MCP is not available):
1. Use Node.js with MongoDB driver: `const { MongoClient } = require('mongodb');`
2. Connection string is stored in `settings.json` under `private.MONGO_URL` (excluded from version control)
3. Database name: `amberlake`
4. Key collections: `customUsers`, `products`, `templates`, `sessions`, `banks`, `bankAccounts`, `issuers`

### MongoDB Atlas API Credentials
For MCP MongoDB Atlas access (Service Account):
- Credentials are stored in `.claude/settings.local.json` (excluded from version control)
- Note: Service account returns 401 Unauthorized - may need additional permissions or configuration

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

### 🚨 MANDATORY DEVELOPMENT RULE - NEVER VIOLATE 🚨
**ABSOLUTE PROHIBITION: NEVER HARD-CODE PRODUCT-SPECIFIC RULES OR LOGIC**

This is the most critical rule in the entire codebase. Violation of this rule will break the core architecture.

#### WHAT IS FORBIDDEN:
- ❌ **NO product type checks** (e.g., `if (productType === 'reverse_convertible')`)
- ❌ **NO hardcoded product names** (reverse convertible, autocallable, barrier reverse convertible, etc.)
- ❌ **NO assumptions about payoff structure** based on product names
- ❌ **NO special case handling** for "known" structured products
- ❌ **NO predefined logic flows** for specific product categories

#### WHAT IS REQUIRED:
- ✅ **PURE COMPONENT ANALYSIS**: Examine only the actual drag-and-drop components present
- ✅ **MATHEMATICAL EVALUATION**: Base all logic on mathematical formulas and relationships
- ✅ **GENERIC INTERPRETATION**: Process payoff structures through universal algorithms
- ✅ **DYNAMIC ADAPTATION**: The rule engine must work for ANY custom payoff users create
- ✅ **COMPOSITIONAL FLEXIBILITY**: Support unlimited combinations of timing, conditions, actions, and continuations

#### MANDATORY APPROACH:
1. **Analyze Structure, Not Names**: Look at what components exist, not what the product is called
2. **Process Components Generically**: Every component type has one universal evaluator function
3. **Mathematical Relationships Only**: Use formulas, not business rules for specific products
4. **Universal Logic Tree**: Convert drag-and-drop to executable logic without product assumptions
5. **Infinite Extensibility**: New payoff structures should work without code changes

#### EXAMPLES OF CORRECT THINKING:
- Instead of: "This is a reverse convertible, so it has protection at maturity"
- Think: "This structure has a BARRIER component at 100% in the maturity section"
- Instead of: "Autocallables need quarterly observations"
- Think: "This structure has OBSERVATION components with quarterly frequency"
- Instead of: "Phoenix products step down barriers"
- Think: "This structure has BARRIER components with decreasing values over time"

#### THE ACID TEST:
**Can a user create a completely novel payoff structure that has never existed before, and will the system evaluate it correctly without any code changes?**

If the answer is NO, then the implementation violates this rule and must be rewritten.

#### CONSEQUENCES OF VIOLATION:
- The system becomes rigid and cannot handle innovative payoff structures
- Every new product type requires code changes instead of just drag-and-drop configuration
- The generic rule engine architecture collapses
- Users cannot experiment with novel structured product ideas

## Generic Rule Engine Architecture

### Core Philosophy: Universal Payoff Composition

Our structured products application implements a **universal, product-agnostic rule engine** that can evaluate ANY payoff structure created through the drag-and-drop interface. This is not just a design choice - it's the fundamental architecture that enables infinite innovation.

**The system must treat every payoff as a unique composition of generic building blocks.**

**Core Architectural Principles:**
- **Pure Component-Based Logic**: All payoff structures are built from generic, reusable components that have no knowledge of product types
- **Mathematical Formula Evaluation**: Logic is based exclusively on mathematical formulas and component relationships, never business rules
- **Infinite Compositional Freedom**: Users can combine timing, conditions, actions, and continuations in unlimited ways
- **Zero-Configuration Extensibility**: New payoff structures work immediately without any code changes
- **Universal Evaluation Engine**: One rule engine handles all possible structured product variations - past, present, and future

**Innovation Enablement:**
This architecture specifically enables users to:
- Invent completely novel payoff structures that don't exist in traditional finance
- Experiment with hybrid combinations of existing structured product features
- Create asymmetric payoffs with complex conditional logic
- Design multi-stage products with evolving terms
- Compose products with unlimited underlying assets and barrier configurations

### Three-Phase Processing Pipeline

#### Phase 1: Structure Creation (Drag-and-Drop Interface)
Users build products by dragging components from the library into timeline columns:
- **Timing Components**: Define when evaluations occur (observation dates, maturity, barriers)
- **Condition Components**: Logic operators (IF/ELSE), comparisons, barriers, underlyings
- **Action Components**: Outcomes (autocall, coupons, returns, exposure)
- **Continuation Components**: Whether product continues or terminates

#### Phase 2: Generic Interpretation (Domain Specific Language)
The drag-and-drop structure is converted into an executable logic tree:
- Components are stored as generic objects with `type`, `column`, `section`, and `value` properties
- Relationships between components are preserved through `rowIndex` and `sortOrder`
- The PayoffInterpreter converts this structure into evaluable logic
- No product names or hard-coded rules - only component analysis

#### Phase 3: Dynamic Report Generation (Widget Creation)
Based on detected components, the system automatically generates appropriate report widgets:
- **Feature Detection**: Analyzes components to identify barriers, coupons, protection levels
- **Widget Mapping**: Creates standardized report cards based on detected features
- **Standardized Objects**: Common data structures for charts, monitors, and analysis tools

### Rule Engine Components

#### PayoffInterpreter (`/imports/api/payoffInterpreter.js`)
The core interpreter converts drag-and-drop structures to executable logic:
- Parses component relationships and dependencies
- Builds evaluation trees from IF/ELSE chains
- Handles timing-based evaluations (life vs maturity)
- Processes barrier touches, comparisons, and actions generically

#### ComponentEvaluators (`/imports/api/componentEvaluators.js`)
Generic evaluation functions for each component type:
- **Timing Evaluators**: Process observation dates, maturity, live monitoring
- **Comparison Evaluators**: Handle above/below, touched/not touched, ranges
- **Barrier Evaluators**: Calculate autocall levels, protection barriers, caps
- **Action Evaluators**: Execute autocalls, coupons, returns, exposures
- **Logic Evaluators**: Process IF/ELSE conditional chains

### Domain Specific Language (DSL)

#### Generic Logic Flow
All products follow the same evaluation pattern:
1. **Timing Check**: Is this timing condition met?
2. **Condition Evaluation**: Process IF/ELSE chains with comparisons
3. **Action Execution**: Execute appropriate actions based on conditions
4. **Continuation Decision**: Determine if product continues or terminates

### Key Architecture Principles

#### Universal Component Evaluation
Every component is evaluated through generic functions that work regardless of product type:

```javascript
// Generic barrier evaluation - works for any barrier type
const evaluateBarrier = (underlying, barrier, comparison) => {
  const currentLevel = underlying.performance;
  const barrierLevel = barrier.level;
  
  switch(comparison.type) {
    case 'at_or_above': return currentLevel >= barrierLevel;
    case 'above': return currentLevel > barrierLevel;
    case 'at_or_below': return currentLevel <= barrierLevel;
    case 'below': return currentLevel < barrierLevel;
  }
};
```

#### Mathematical Formula-Based Logic
All calculations use mathematical relationships rather than product-specific rules:

```javascript
// Generic performance calculation
const calculatePerformance = (current, strike) => {
  return ((current - strike) / strike) * 100;
};

// Generic payoff calculation  
const calculatePayoff = (performance, structure) => {
  if (structure.hasProtection && performance >= structure.protectionLevel) {
    return 100 + structure.couponRate;
  } else if (structure.hasProtection) {
    return Math.max(100 + performance, structure.minReturn) + structure.couponRate;
  }
  return 100 + performance + structure.couponRate;
};
```

#### Dynamic Feature Detection
The system identifies product characteristics by analyzing actual components:

```javascript
const analyzeProduct = (components) => {
  return {
    hasBarriers: components.some(c => c.type === 'BARRIER'),
    hasCoupons: components.some(c => c.type === 'ACTION' && c.value.includes('coupon')),
    hasProtection: components.some(c => c.type === 'BARRIER' && c.barrier_type === 'protection'),
    hasAutocall: components.some(c => c.type === 'ACTION' && c.value.includes('autocall')),
    underlyingCount: components.filter(c => c.type === 'BASKET').length,
    observationFrequency: detectFrequency(components.filter(c => c.type === 'OBSERVATION'))
  };
};
```

### Developer Guidelines

#### Adding New Components
When creating new draggable components, follow the universal design pattern:

1. **Define Generic Properties**: Use `type`, `defaultValue`, `icon` - never product-specific names or references
2. **Create Universal Evaluator Function**: Add to `componentEvaluators.js` with purely mathematical logic that works in any context
3. **Update Generic Feature Detection**: Modify feature detection in `ProductTypeAnalyzer` to recognize the component's mathematical properties
4. **Test Infinite Combinations**: Ensure component works in any payoff combination, including with components that don't exist yet
5. **Verify Compositional Independence**: The component must function correctly regardless of what other components are present

**Component Design Acid Test:**
- Can this component be combined with any other component?
- Does it make mathematical sense in isolation?
- Can users create novel payoffs using this component in ways you never imagined?
- Does the component evaluation depend only on market data and mathematical relationships?

If any answer is NO, redesign the component.

#### Extending Report Widgets  
When adding new widget types, maintain generic flexibility:

1. **Identify Mathematical Triggers**: What mathematical properties or component relationships trigger this widget?
2. **Create Universal Config**: Define configuration that works for any payoff structure, not specific product types
3. **Implement Adaptive Rendering**: Widget must dynamically adjust to any underlying/barrier/timing combination
4. **Add to Generic Registry**: Register in `ProductTypeAnalyzer.viewRegistry` with mathematical detection logic
5. **Test Novel Compositions**: Verify the widget works with payoff structures that don't exist yet

**Widget Design Requirements:**
- Must work with any number of underlyings (1 to unlimited)
- Must adapt to any barrier configuration (protection, autocall, coupon, caps, floors)
- Must handle any timing structure (daily, weekly, monthly, quarterly, custom dates)
- Must support any combination of conditions and actions
- Must render meaningful information for payoffs that have never been created before

### Technical Implementation

#### File Organization
- `/imports/api/ruleEngine.js`: Main engine entry point and orchestration
- `/imports/api/payoffInterpreter.js`: Converts drag-and-drop to executable logic
- `/imports/api/componentEvaluators.js`: Generic evaluation functions for each component type
- `/imports/api/evaluationContext.js`: Market data and calculation environment
- `/imports/api/reportGenerator.js`: Creates widgets based on detected features
- `/imports/api/productTypeAnalyzer.js`: Analyzes structures and recommends widgets
- `/imports/ui/ProductReport.jsx`: Renders generated widgets in the report interface

#### Performance Considerations
- **Lazy Evaluation**: Only calculate required scenarios and timeframes
- **Caching Strategy**: Cache market data and intermediate calculations
- **Incremental Updates**: Update only changed components when market data refreshes
- **Efficient Rendering**: Use React memoization for expensive widget calculations

#### Error Handling and Validation
- **Graceful Degradation**: Show partial results when some data is unavailable
- **Structure Validation**: Verify component relationships and required dependencies  
- **User-Friendly Messages**: Convert technical errors to actionable user guidance
- **Fallback Logic**: Provide reasonable defaults when components are misconfigured

This architecture ensures our application can handle any structured product configuration while maintaining performance, reliability, and ease of development.

## Report Architecture and Data Flow

### Core Principle: Report Page is Display-Only

**🚨 CRITICAL ARCHITECTURAL RULE - NEVER VIOLATE 🚨**
**ABSOLUTE PROHIBITION: NO CALCULATIONS IN REPORTING COMPONENTS**

The report page (`ProductReport.jsx`, `TemplateProductReport.jsx`) performs **ZERO calculations, computations, or data transformations**. All data comes pre-calculated from the report object stored in the database.

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

**ORIGINAL CRITICAL RULE**: The report page (`ProductReport.jsx`) performs **ZERO calculations**. All data comes pre-calculated from the report object stored in the database.

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