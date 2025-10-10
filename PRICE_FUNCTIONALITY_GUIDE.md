# Price Functionality Guide

## Overview

The application now includes comprehensive price management functionality for structured products, allowing administrators to upload market prices via CSV files and display real-time pricing information on product reports.

## Features Implemented

### 1. Price Upload System (`/imports/ui/Prices.jsx`)

**Location**: Administration → Prices
**Access**: Admin/Superadmin users only

#### Features:
- **Drag & Drop CSV Upload**: Support for both US and European CSV formats
- **Format Auto-Detection**: Automatically detects comma vs semicolon separators
- **European Format Support**: Handles comma decimal separators (e.g., `102,50`)
- **Validation**: ISIN format validation and price validation
- **Duplicate Prevention**: Avoids duplicate entries for same day
- **Real-time Preview**: Shows parsed data before upload
- **Progress Tracking**: Upload progress and statistics

#### Supported CSV Formats:
```csv
# US Format (comma separator, dot decimal)
US1234567890,102.50
CH0012345678,98.75

# European Format (semicolon separator, comma decimal)  
US1234567890;102,50
CH0012345678;98,75
```

#### Upload Process:
1. Navigate to Administration → Prices
2. Drop CSV file or click to browse
3. Preview parsed data
4. Confirm upload
5. View upload statistics and errors

### 2. Price Database Management

**Storage**: `ProductPricesCollection` in MongoDB
**Schema**:
```javascript
{
  isin: String,           // ISIN code (e.g., "US1234567890")
  price: Number,          // Price value
  currency: String,       // Currency (defaults to "USD")
  priceDate: Date,        // Date of the price
  uploadDate: Date,       // When uploaded
  uploadedBy: String,     // User ID who uploaded
  source: String,         // Source identifier
  isActive: Boolean,      // For soft delete
  metadata: Object        // Additional data
}
```

#### Features:
- **Latest Price Lookup**: Automatically gets most recent price by ISIN
- **Historical Data**: Maintains price history
- **Search & Filter**: Search by ISIN with real-time filtering
- **Sorting**: Sort by any column (ISIN, price, date, etc.)
- **Bulk Operations**: Efficient bulk upload handling

### 3. Product Price Monitoring

**Location**: Administration → Prices (bottom section)
**Purpose**: Monitor products requiring price updates

#### Features:
- **Live Product Tracking**: Identifies products needing price updates
- **Age Detection**: Shows products with prices older than 7 days
- **Missing Price Detection**: Highlights products without any prices
- **Status Indicators**: Visual status (Missing/Outdated)
- **Product Details**: Shows product name, ISIN, last price, and age

### 4. Report Page Price Display (`/imports/ui/ProductReport.jsx`)

**Enhancement**: Added real-time price display to product reports

#### New Features:
- **Market Price Card**: Shows current ISIN price prominently
- **Freshness Indicators**: Visual indicators for price availability
- **Time Stamps**: Shows when price was last updated
- **Relative Time**: Human-readable time indicators (e.g., "2h ago", "Yesterday")
- **Currency Display**: Shows price in correct currency format
- **Price Date**: Shows the actual price date
- **No Price Handling**: Clear messaging when no price is available

#### Visual Design:
```
💰 Market Price                           Price Date
    $102.50 USD  [2h ago]                 2024-08-15
```

## Technical Implementation

### 1. Data Flow

```
CSV Upload → Parser → Validation → Database → Report Display
     ↓           ↓         ↓          ↓           ↓
  FileUpload  FormatDetect Duplicate ProductPrices RealtimeSync
```

### 2. Key Components

#### Price Upload (`PriceUploadManager.jsx`)
- Advanced CSV parser with format detection
- Multi-step upload process (upload → preview → process → complete)
- Error handling and user feedback
- File validation and size limits

#### Price Database (`productPrices.js`)
- MongoDB collection with helper methods
- Async operations for modern Meteor
- Bulk insert with duplicate detection
- Query optimization for large datasets

#### Report Enhancement (`ProductReport.jsx`)
- Real-time subscription to price data
- Automatic ISIN-based price lookup
- Responsive price display component
- Time-relative formatting

### 3. Server Methods

#### `productPrices.uploadSimpleCsv(csvData, sessionId)`
- Processes CSV upload data
- Authentication required (admin/superadmin)
- Returns upload statistics and errors

#### `productPrices.getCurrentPrice(isin)`
- Gets latest price for specific ISIN
- Public method for price lookup

#### `productPrices.getCurrentPrices(isins[])`
- Bulk price lookup for multiple ISINs
- Optimized for performance

## Testing the Functionality

### 1. Create Test Product
```bash
node create-test-product.js
```
This creates a test product with ISIN "US1234567890"

### 2. Upload Test Prices
1. Go to Administration → Prices
2. Upload the provided `test-price-data.csv` file
3. Verify upload success and statistics

### 3. View Price Display
1. Navigate to the test product report
2. Observe the new Market Price section
3. Verify price, currency, and timestamp display

## Usage Examples

### For Administrators

1. **Daily Price Updates**:
   - Export prices from market data provider
   - Format as CSV (ISIN, Price)
   - Upload via Administration → Prices
   - Monitor upload success and errors

2. **Price Monitoring**:
   - Check "Products Requiring Price Updates" section
   - Identify products needing fresh prices
   - Upload missing prices for specific ISINs

3. **Historical Analysis**:
   - Use price search to find specific ISIN prices
   - Sort by date to see price evolution
   - Export data for external analysis

### For Users

1. **Product Reports**:
   - View real-time market prices for products
   - See price freshness indicators
   - Monitor price changes over time

2. **Price Alerts**:
   - Visual indicators show outdated prices
   - Clear messaging for missing prices
   - Time-relative updates (e.g., "3 days ago")

## Error Handling

### Upload Errors
- **Invalid ISIN**: Clear error message with row number
- **Invalid Price**: Validation with specific error details
- **File Format**: Auto-detection with fallback options
- **Network Issues**: Retry mechanisms and user feedback

### Display Errors
- **Missing Prices**: Graceful fallback with clear messaging
- **Stale Data**: Visual indicators for outdated information
- **Connection Issues**: Loading states and error boundaries

## Security

### Access Control
- Price uploads restricted to admin/superadmin users
- Session-based authentication for all operations
- Input validation on all price data

### Data Validation
- ISIN format validation (2-letter country + 9 alphanumeric + 1 check digit)
- Price range validation (positive numbers only)
- Date validation (no future dates allowed)
- Currency code validation

## Performance Considerations

### Database Optimization
- Indexed queries on ISIN and dates
- Efficient aggregation pipelines
- Pagination for large datasets
- Connection pooling for bulk operations

### Client Performance
- Reactive subscriptions with smart caching
- Lazy loading for price history
- Efficient re-rendering with React memoization
- Background processing for uploads

## Future Enhancements

### Potential Improvements
1. **Real-time Price Feeds**: Integration with market data APIs
2. **Price Alerts**: Notifications for price thresholds
3. **Advanced Analytics**: Price trend analysis and charts
4. **Automated Updates**: Scheduled price refresh jobs
5. **Multi-Currency Support**: Automatic currency conversion
6. **Price History Charts**: Visual price evolution on reports

### API Integration Points
- EOD Historical Data integration
- Bloomberg API connectivity
- Reuters price feeds
- Custom data provider adapters

## Summary

The price functionality provides a complete solution for managing structured product pricing data. Administrators can easily upload prices via CSV files, monitor price freshness across all products, and users can view real-time pricing information directly on product reports.

The system is designed for scalability, performance, and ease of use, with comprehensive error handling and security measures built in.