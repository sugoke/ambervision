// Database configuration and connection setup
// Extracted from server/main.js for better modularity

import { Meteor } from 'meteor/meteor';

/**
 * Configure database connection from METEOR_SETTINGS
 * This must run before Meteor imports to properly configure the connection
 */
export function configureDatabaseConnection() {
  if (process.env.METEOR_SETTINGS) {
    try {
      const settings = JSON.parse(process.env.METEOR_SETTINGS);
      if (settings && settings.private && settings.private.MONGO_URL) {
        process.env.MONGO_URL = settings.private.MONGO_URL;
      }
      if (settings && settings.private && settings.private.MONGO_OPLOG_URL) {
        process.env.MONGO_OPLOG_URL = settings.private.MONGO_OPLOG_URL;
      }
    } catch (error) {
      console.error('❌ Error parsing METEOR_SETTINGS:', error.message);
    }
  }
}

/**
 * Log database connection information for debugging
 */
export function logDatabaseInfo() {
  const mongoUrl = process.env.MONGO_URL || 'default local MongoDB';
  const mongoOplogUrl = process.env.MONGO_OPLOG_URL || 'none';
  
  console.log('=== DATABASE CONNECTION INFO ===');
  console.log('MONGO_URL:', mongoUrl.includes('mongodb+srv') ? 
    `${mongoUrl.substring(0, 25)}...${mongoUrl.substring(mongoUrl.lastIndexOf('/'))}` : mongoUrl);
  console.log('MONGO_OPLOG_URL:', mongoOplogUrl.includes('mongodb+srv') ? 
    `${mongoOplogUrl.substring(0, 25)}...${mongoOplogUrl.substring(mongoOplogUrl.lastIndexOf('/'))}` : mongoOplogUrl);
  console.log('Database Type:', mongoUrl.includes('mongodb+srv') ? 'Atlas (Cloud)' : 'Local MongoDB');
  console.log('====================================\n');
}

/**
 * Check if demo data seeding should be enabled
 */
export function shouldSeedDemoData() {
  return (
    process.env.SEED_DEMO_DATA === 'true' ||
    (Meteor.settings && Meteor.settings.private && Meteor.settings.private.seedDemoData === true)
  );
}

/**
 * Create database indexes for improved performance
 * This should be called during server startup
 */
export async function createDatabaseIndexes() {
  try {
    // Import collections here to avoid circular imports
    const { UsersCollection } = await import('/imports/api/users');
    const { BankAccountsCollection } = await import('/imports/api/bankAccounts');
    const { BanksCollection } = await import('/imports/api/banks');
    const { ProductsCollection } = await import('/imports/api/products');
    const { EquityHoldingsCollection } = await import('/imports/api/equityHoldings');
    const { MarketDataCacheCollection } = await import('/imports/api/marketDataCache');
    
    // Index for client user lookups
    await UsersCollection.createIndexAsync({ role: 1, 'profile.lastName': 1, 'profile.firstName': 1 });
    
    // Index for active bank accounts
    await BankAccountsCollection.createIndexAsync({ isActive: 1, userId: 1 });
    
    // Index for active banks
    await BanksCollection.createIndexAsync({ isActive: 1, name: 1 });
    
    // Index for product search functionality
    await ProductsCollection.createIndexAsync({ title: 'text', isin: 'text' });
    await ProductsCollection.createIndexAsync({ title: 1 });
    await ProductsCollection.createIndexAsync({ isin: 1 });
    await ProductsCollection.createIndexAsync({ createdAt: -1 });
    
    // Index for equity holdings
    await EquityHoldingsCollection.createIndexAsync({ bankAccountId: 1 });
    await EquityHoldingsCollection.createIndexAsync({ userId: 1 });
    await EquityHoldingsCollection.createIndexAsync({ userId: 1, bankAccountId: 1 });
    await EquityHoldingsCollection.createIndexAsync({ symbol: 1 });
    await EquityHoldingsCollection.createIndexAsync({ fullTicker: 1 });
    await EquityHoldingsCollection.createIndexAsync({ accountNumber: 1 });
    
    // Skip MarketDataCache indexes temporarily to avoid conflicts
    console.log('MarketDataCache: Skipping index creation to avoid conflicts');
    
    // TODO: Re-enable these once database connection issues are resolved
    // Index for market data cache - handle existing indexes gracefully
    // try {
    //   await MarketDataCacheCollection.createIndexAsync(
    //     { fullTicker: 1, date: -1 }, 
    //     { name: 'meteor_fullTicker_date_idx', background: true }
    //   );
    // } catch (indexError) {
    //   if (indexError.code === 86 || indexError.code === 85) {
    //     console.log('MarketDataCache: Skipping fullTicker+date index - already exists with different properties');
    //   } else {
    //     console.log('MarketDataCache: Error creating fullTicker+date index:', indexError.message);
    //   }
    // }
    
    console.log('Database indexes created successfully');
    
  } catch (error) {
    // Indexes might already exist, that's fine
    if (error.code === 86) {
      console.log('Database indexes: Some indexes already exist with different properties (this is normal when switching databases)');
    } else {
      console.log('Database indexes creation error:', error.message);
    }
  }
}

// Initialize database connection immediately when this module is imported
configureDatabaseConnection();