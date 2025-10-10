# Structured Product Reporting Platform Vision

## Core Philosophy: Zero Hardcoding, Infinite Flexibility

This platform is designed to accommodate the infinite variety of structured product payoffs without any hardcoded templates or product-specific logic. Every product feature, payoff structure, and reporting element must be dynamically generated based on natural language descriptions and LLM-interpreted specifications.

## Architecture Overview

### 1. Product Creation Flow

#### Basic Information (Common Fields)
Users input standard fields common to all structured products:
- ISIN code
- Initial date
- Final date  
- Issuer
- Currency
- Product name

#### Payoff Description (Natural Language)
Users describe the product's payoff structure in natural language, explaining:
- Conditional cash flows
- Barrier levels and types
- Coupon mechanisms
- Early redemption features
- Underlying basket composition
- Any innovative or unique features

#### LLM Processing
The natural language description is sent to an LLM (OpenAI API) which returns:
1. **Executable payoff code** - JavaScript/DSL that can process the product against market data
2. **Required parameters** - Dynamic list of parameters needed (barriers, coupons, etc.)
3. **Schedule structure** - Table architecture for observation dates
4. **Basket configuration** - Underlying asset requirements
5. **Reporting blueprint** - How to display this specific product type

### 2. Dynamic Components

#### Parameter Management
- No hardcoded parameters
- LLM determines what parameters are needed based on payoff description
- Each parameter has:
  - ID and label
  - Type (percentage, number, boolean, etc.)
  - Constraints (min, max, step)
  - Helper rules (static, progressive, expression-based)
  - Activation rules (which observations it applies to)

#### Schedule Builder
- Dynamically generated based on product requirements
- Features:
  - Frequency helpers (monthly, quarterly, custom)
  - Variable columns per product type
  - Activation periods (e.g., autocall only from observation 2)
  - Progressive values (e.g., decreasing barriers)
- Column types determined by LLM:
  - Observation date (always)
  - Observation type (coupon, autocall, final)
  - Product-specific parameters
  - Activation status

#### Basket Builder
- Supports unlimited configurations:
  - Single stock/index
  - Basket (average, best-of, worst-of)
  - Multiple baskets with relationships
- Features:
  - EOD API validation (key: 5c265eab2c9066.19444326)
  - Ticker autocomplete
  - Weight management
  - Custom composition rules

### 3. Market Data Management

#### Data Collection
- Admin-triggered process
- Scans all products for unique underlyings
- Fetches historical data from EOD API
- Stores in dedicated market data collection
- Optimized for:
  - Minimal API calls
  - Data reuse across products
  - Incremental updates

#### Data Storage Structure
```javascript
{
  ticker: "AAPL.US",
  exchange: "NASDAQ",
  data: [
    { date: "2024-01-01", close: 195.89, high: 196.38, low: 193.67, volume: 82498300 },
    // ... daily records
  ],
  lastUpdated: Date,
  metadata: { currency, type, sector }
}
```

### 4. Product Processing Engine

#### Execution Flow
1. Load product's executable code from database
2. Fetch relevant market data
3. Apply schedule and parameters
4. Execute payoff logic
5. Generate reporting objects
6. Store results for display

#### No Hardcoding Principle
- Engine doesn't know product types
- Executes arbitrary payoff code
- Adapts to any schedule structure
- Processes any parameter configuration

### 5. Reporting System

#### Section 1: Product Characteristics
Dynamic display of:
- ISIN and basic information
- Key dates
- Issuer details
- Product-specific characteristics determined by LLM

#### Section 2: Underlying Evolution
Cards per underlying showing:
- Name and ticker
- Performance metrics (since launch, daily)
- Distance to barriers (if applicable)
- Product-specific metrics
- All determined dynamically, nothing hardcoded

#### Section 3: Performance Chart
Chart.js implementation with:
- Rebased performance (100 at start)
- Dynamic annotations:
  - Barrier levels
  - Observation dates
  - Coupon payments
  - Autocall triggers
  - Any product-specific events
- Configuration entirely from LLM blueprint

#### Section 4: Observation Schedule
Table showing:
- Dates and observation types
- Active parameters and values
- Outcomes (coupons paid, autocalls triggered)
- Status (completed, upcoming, n/a)
- Percentage-based display (no notional)

### 6. Database Architecture

#### Collections
1. **products** - Core product information and LLM-generated code
2. **parameterSets** - Dynamic parameter values per product
3. **schedules** - Observation dates and configurations
4. **baskets** - Underlying asset compositions
5. **marketDataCache** - Historical price data
6. **chartData** - Pre-calculated chart configurations
7. **reports** - Generated reporting objects

#### Key Principles
- Separate heavy data (charts) from core data
- Store executable code, not templates
- Keep market data centralized
- Cache processed results

### 7. LLM Integration Strategy

#### Prompt Engineering
The LLM prompt must:
- Emphasize zero hardcoding requirement
- Request complete payoff logic
- Ask for UI/UX recommendations
- Generate testable, executable code
- Provide comprehensive reporting structure

#### Response Validation
- Ensure all required sections present
- Validate code syntax
- Check parameter completeness
- Verify schedule logic
- Confirm reporting blueprint

### 8. Processing Controls

#### Admin Functions
1. **Sync Market Data** - Fetches/updates all required market data
2. **Process Products** - Executes all product evaluations
3. **Generate Reports** - Creates reporting objects

#### User Functions
1. Create products with natural language
2. Fine-tune parameters and schedules
3. View dynamic reports
4. Export data (future feature)

## Implementation Priorities

### Phase 1: Core Infrastructure
- LLM integration with OpenAI
- Dynamic parameter system
- Schedule builder
- Basic basket functionality

### Phase 2: Market Data
- EOD API integration
- Market data caching
- Price synchronization
- Data validation

### Phase 3: Processing Engine
- Payoff code execution
- Report generation
- Chart data creation
- Performance optimization

### Phase 4: Reporting
- Dynamic section rendering
- Chart.js integration
- Responsive design
- Export capabilities

## Success Criteria

1. **Zero Hardcoding**: Can accommodate any new product type without code changes
2. **Full Automation**: LLM generates complete product specification from description
3. **Scalability**: Handles hundreds of products efficiently
4. **Flexibility**: Supports any payoff innovation
5. **Accuracy**: Correctly processes complex conditional logic
6. **User Experience**: Intuitive interface despite underlying complexity

## Technical Stack
- **Framework**: Meteor.js
- **Database**: MongoDB
- **LLM**: OpenAI API (GPT-4)
- **Market Data**: EOD Historical API
- **Charts**: Chart.js with annotations
- **UI**: React with dynamic component generation

## Critical Success Factors

1. **Prompt Quality**: The LLM prompt must be comprehensive and precise
2. **Code Execution**: Generated code must be sandboxed and secure
3. **Data Integrity**: Market data must be accurate and timely
4. **Performance**: Large datasets must not impact user experience
5. **Flexibility**: System must adapt to regulatory and market changes

This vision represents a paradigm shift from template-based systems to a truly dynamic, AI-driven platform that can evolve with the structured products market without requiring constant development updates.