import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { MongoInternals } from 'meteor/mongo';
// /server/main.js
import '/server/methods/updateProducts.js';
import '/server/methods/tickers.js';
import '/server/methods/refresh.js';
import '/server/methods/schedule.js';
import '/server/methods/risk.js';

// Import all method files
import './methods/functions/checkProductsCollection.js';
import './methods/functions/user.addBankAccount.js';
import './methods/functions/removeBankAccount.js';
import './methods/functions/holdings.insert.js';
import './methods/functions/searchProducts.js';
import './methods/functions/admin.getUsers.js';
import './methods/functions/admin.deleteUser.js';
import './methods/functions/admin.createUser.js';
import './methods/functions/products.upsert.js';
import './methods/functions/updateMarketData.js';
import './methods/functions/getExpandedProducts.js';
import './methods/functions/populateProductTable.js';
import './methods/functions/updateProduct.js';
import './methods/functions/insertProduct.js';
import './methods/functions/debugProductsCollection.js';
import './methods/functions/searchClient.js';
import './methods/functions/processPdf.js';

import { 
  Products, 
  Holdings, 
  Historical, 
  Prices, 
  Risk, 
  Schedules 
} from '/imports/api/products/products.js';
import '/imports/tabular-tables.js';
import '../imports/api/products/server/publications.js';
import './methods.js';
import '/imports/api/holdings/holdings.js';
import { getUsers } from './methods/functions/admin.getUsers.js';
import './publications/issuers.js';
import './methods/issuers.js';
import './methods/eod.js';
import './methods/prices.js';

Meteor.startup(() => {
  // Enhanced environment and connection logging
  console.log('=== DATABASE CONNECTION INFO ===');
  console.log('Environment:', Meteor.isProduction ? 'PRODUCTION' : 'DEVELOPMENT');
  
  // Get database info
  const driver = MongoInternals.defaultRemoteCollectionDriver();
  const db = driver.mongo.db;
  
  console.log('Connected Database:', {
    name: db.databaseName,
    host: db.serverConfig?.s?.url || 'Unknown host',
    collections: Object.keys(db.collections)
  });

  if (Meteor.isProduction) {
    console.log('Production MongoDB connection active');
  } else {
    const sanitizedUrl = process.env.MONGO_URL?.replace(
      /(mongodb(\+srv)?:\/\/)([^:]+):([^@]+)@/,
      '$1***:***@'
    );
    console.log('MongoDB URL:', sanitizedUrl);
  }
  
  // Test database connection with detailed logging
  try {
    console.log('\n=== DATABASE CONNECTION TEST ===');
    
    // Test write
    const testDoc = {
      test: true,
      timestamp: new Date(),
      environment: Meteor.isProduction ? 'production' : 'development'
    };
    
    console.log('Attempting to write test document...');
    const testId = Products.insert(testDoc);
    console.log('Test write successful:', {
      collection: 'Products',
      documentId: testId,
      database: db.databaseName
    });

    // Test read
    console.log('Attempting to read test document...');
    const readTest = Products.findOne(testId);
    console.log('Test read successful:', {
      found: !!readTest,
      documentId: testId,
      content: readTest
    });

    // Clean up
    console.log('Cleaning up test document...');
    Products.remove({ _id: testId });
    
    // Collection statistics
    console.log('\n=== COLLECTION STATISTICS ===');
    const collections = {
      Products,
      Holdings,
      Historical,
      Prices
    };

    Object.entries(collections).forEach(([name, collection]) => {
      if (!collection) {
        console.error(`Collection ${name} is not properly defined`);
        return;
      }
      try {
        const count = collection.find().count();
        const indexes = collection.rawCollection().indexes();
        console.log(`${name} Collection:`, {
          count,
          database: db.databaseName,
          indexes: indexes
        });
      } catch (err) {
        console.error(`Error accessing ${name}:`, err);
      }
    });

    // Test user creation
    console.log('\n=== USER CREATION TEST ===');
    const testUser = {
      username: `test_${new Date().getTime()}`,
      email: `test_${new Date().getTime()}@test.com`,
      password: 'password123'
    };
    
    try {
      const userId = Accounts.createUser(testUser);
      console.log('Test user created:', {
        userId,
        database: db.databaseName
      });
      // Clean up test user
      Meteor.users.remove(userId);
      console.log('Test user removed');
    } catch (userError) {
      console.error('User creation test failed:', userError);
    }

  } catch (error) {
    console.error('\n=== DATABASE ERROR ===');
    console.error('Database initialization error:', {
      error: error.message,
      stack: error.stack,
      database: db?.databaseName,
      collections: Object.keys(db?.collections || {})
    });
  }
});

// Removed Meteor.publish('productByISIN', ...) as subscriptions are not needed

Meteor.methods({
  'admin.getUsers': getUsers
});

Accounts.onCreateUser((options, user) => {
  if (!user.role) {
    user.role = 'user';
  }
  return user;
});
