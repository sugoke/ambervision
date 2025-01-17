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
import { Accounts } from 'meteor/accounts-base';
import { Random } from 'meteor/random';

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

  // Settings check
  console.log('Settings check:', {
    hasSettings: !!Meteor.settings,
    hasPrivate: !!Meteor.settings?.private,
    hasSmtp: !!(Meteor.settings?.private?.smtp2go || Meteor.settings?.smtp2go),
    smtpSettings: Meteor.settings?.private?.smtp2go || Meteor.settings?.smtp2go
  });

  // SMTP Configuration - check both locations
  const smtpSettings = Meteor.settings?.private?.smtp2go || Meteor.settings?.smtp2go;
  if (!smtpSettings) {
    console.error('SMTP settings not found in either Meteor.settings.private.smtp2go or Meteor.settings.smtp2go');
    return;
  }
  
  // Using direct SMTP settings
  const mailUrl = `smtps://${smtpSettings.apiKey}:${smtpSettings.apiKey}@send.smtp2go.com:465`;
  process.env.MAIL_URL = mailUrl;
  
  console.log('SMTP Config:', {
    mailUrl: mailUrl.replace(smtpSettings.apiKey, '***'),
    from: smtpSettings.from
  });

  Accounts.emailTemplates.from = smtpSettings.from;
  Accounts.emailTemplates.resetPassword.subject = () => "Reset Your Password";
  Accounts.emailTemplates.resetPassword.text = (user, url) => {
    return `Click this link to reset your password: ${url}`;
  };

  // Override default email sending
  Accounts.emailTemplates.from = smtpSettings.from;
  
  // Override the default password reset email
  Accounts.sendResetPasswordEmail = function(userId, email) {
    // Generate token using Accounts method
    const token = Random.secret();
    const when = new Date();
    const tokenRecord = {
      token: token,
      email: email,
      when: when
    };

    Accounts.users.update(userId, {
      $set: {
        "services.password.reset": tokenRecord
      }
    });

    const resetUrl = Meteor.absoluteUrl(`reset-password/${token}`);
    
    Meteor.call('email.sendResetLink', email, resetUrl);
    return tokenRecord;
  };
});

Meteor.methods({
  'admin.getUsers': getUsers
});

Accounts.onCreateUser((options, user) => {
  if (!user.role) {
    user.role = 'user';
  }
  return user;
});
