import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
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
  // Log environment details
  console.log('Environment:', Meteor.isProduction ? 'PRODUCTION' : 'DEVELOPMENT');
  
  // Don't log full URL in production for security
  if (Meteor.isProduction) {
    console.log('Using production MongoDB connection');
  } else {
    console.log('MongoDB URL:', process.env.MONGO_URL?.replace(/:[^:\/]+@/, ':****@'));
  }
  
  // Test database connection immediately
  try {
    const testDoc = {
      test: true,
      timestamp: new Date(),
      environment: Meteor.isProduction ? 'production' : 'development'
    };

    // Test write
    const testId = Products.insert(testDoc);
    console.log('Test write successful, ID:', testId);

    // Test read
    const readTest = Products.findOne(testId);
    console.log('Test read successful:', !!readTest);

    // Clean up
    Products.remove({ _id: testId });

    // Log collection counts - with error handling for each collection
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
        console.log(`${name} collection count:`, count);
      } catch (err) {
        console.error(`Error counting ${name}:`, err);
      }
    });

  } catch (error) {
    console.error('Database initialization error:', error);
    // Log more details in development
    if (!Meteor.isProduction) {
      console.error('Full error:', error);
    }
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
