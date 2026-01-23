// Clean database connection setup
if (process.env.METEOR_SETTINGS) {
  try {
    const settings = JSON.parse(process.env.METEOR_SETTINGS);
    if (settings && settings.private && settings.private.MONGO_URL) {
      process.env.MONGO_URL = settings.private.MONGO_URL;
      console.log('✅ MONGO_URL configured from settings');
    }
    if (settings && settings.private && settings.private.MONGO_OPLOG_URL) {
      process.env.MONGO_OPLOG_URL = settings.private.MONGO_OPLOG_URL;
      console.log('✅ MONGO_OPLOG_URL configured from settings');
    }
  } catch (error) {
    console.error('❌ Error parsing METEOR_SETTINGS:', error.message);
  }
}

import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { WebApp } from 'meteor/webapp';
import { MongoInternals } from 'meteor/mongo';

// Server log capture - must be early to capture all logs
import './logCapture';

import { LinksCollection } from '/imports/api/links';
import { ProductsCollection } from '/imports/api/products';
import { ChartDataCollection } from '/imports/api/chartData';
import { UsersCollection, USER_ROLES, UserHelpers } from '/imports/api/users';
import { BanksCollection, BankHelpers } from '/imports/api/banks';
import { BankConnectionsCollection, BankConnectionHelpers } from '/imports/api/bankConnections';
import { BankConnectionLogsCollection, BankConnectionLogHelpers } from '/imports/api/bankConnectionLogs';
import { BankAccountsCollection, BankAccountHelpers } from '/imports/api/bankAccounts';
import { ProductPricesCollection, ProductPriceHelpers } from '/imports/api/productPrices';
import { IssuersCollection, IssuerHelpers, DEFAULT_ISSUERS } from '/imports/api/issuers';
import { TemplatesCollection, TemplateHelpers, BUILT_IN_TEMPLATES } from '/imports/api/templates';
import '/imports/api/eodApi';
import '/imports/api/cbondsApi';
import '/imports/api/underlyingPrices';
// Removed: product evaluation module
import '/imports/api/marketDataCache';
import '/imports/api/tickerCache';
import '/imports/api/currencyCache';
import { CurrencyCache } from '/imports/api/currencyCache';
import '/imports/api/dashboardMetrics';  // Pre-computed AUM metrics cache
import { SessionsCollection, SessionHelpers } from '/imports/api/sessions';
import { PasswordResetTokensCollection, PasswordResetHelpers } from '/imports/api/passwordResetTokens';
import { EmailService } from '/imports/api/emailService';
import { AllocationsCollection, AllocationHelpers } from '/imports/api/allocations';
import { NotificationsCollection, NotificationHelpers } from '/imports/api/notifications';
import { CronJobLogsCollection } from '/imports/api/cronJobLogs';
import { NewslettersCollection } from '/imports/api/newsletters';
import { initializeCronJobs } from './cron/jobs';
import { updateMarketTickerPrices, isDataStale } from './cron/updateMarketTicker';
// Schedule is now included in reports, no separate collection needed
import { EquityHoldingsCollection, EquityHoldingsHelpers } from '/imports/api/equityHoldings';
import { PMSHoldingsCollection, PMSHoldingsHelpers } from '/imports/api/pmsHoldings';
import { SecuritiesMetadataCollection, SecuritiesMetadataHelpers } from '/imports/api/securitiesMetadata';
import { MarketDataHelpers, MarketDataCacheCollection } from '/imports/api/marketDataCache';
import { BankFileStructuresCollection, BankFileStructureHelpers } from '/imports/api/bankFileStructures';
import { globalProductValidator } from '/imports/api/validators/productStructureValidator.js';
import '/imports/api/reports';
import '/imports/api/templateReports';
import '/imports/api/underlyingsAnalysis';
import '/imports/api/riskAnalysis';
import '/imports/api/termSheetExtractor';
import '/imports/api/amberConversations';
import '/imports/api/amberService';
import './methods/bankConnectionMethods';
import './methods/bankPositionMethods';
import './methods/pmsMigrationMethods';
import './migrations/migratePMSHoldingsVersioning';
import './migrations/cleanupDuplicateVersions';
import './migrations/cleanupDuplicateHoldings';
import './migrations/cleanDuplicateCMBHoldings';
import './migrations/activateCFMConnection';
import './migrations/activateSGConnection';
import './migrations/initializeSeenLocalFiles';
import './migrations/syncProductsToSecuritiesMetadata';
// import './migrations/fixNullAssetClass';  // One-time migration - already run
import './methods/securitiesMethods';
import './methods/performanceMethods';
import './methods/pdfGenerationMethods';
import './methods/pmsPdfMethods';
import './methods/riskAnalysisPdfMethods';
import './methods/pmsLinkingMethods';
import './methods/accountProfileMethods';
import './methods/rmDashboardMethods';
import './methods/landingMethods';
import './methods/clientDocumentMethods';
import './pdfAuth'; // PDF authentication middleware
import './publications/underlyingsAnalysis';
import './publications/bankConnections';
import './publications/securitiesMetadata';
import './publications/accountProfiles';
import './publications'; // Import all publications from index.js

// Complex product templates are now part of BUILT_IN_TEMPLATES in /imports/api/templates.js
// import './insertComplexTemplates';
import { createTestData } from './createTestData';

// Control whether demo/mock data is seeded on startup
const SHOULD_SEED = (
  process.env.SEED_DEMO_DATA === 'true' ||
  (Meteor.settings && Meteor.settings.private && Meteor.settings.private.seedDemoData === true)
);

// Collections are imported and initialized normally

async function insertLink({ title, url }) {
  await LinksCollection.insertAsync({ title, url, createdAt: new Date() });
}

Meteor.startup(async () => {
  console.log('\n✅ Starting Ambervision Server...');
  console.log(`[SEEDING] Demo data seeding is ${SHOULD_SEED ? 'ENABLED' : 'DISABLED'}`);
  
  // Log database connection information
  const mongoUrl = process.env.MONGO_URL || 'default local MongoDB';
  const mongoOplogUrl = process.env.MONGO_OPLOG_URL || 'none';
  console.log('=== DATABASE CONNECTION INFO ===');
  console.log('MONGO_URL:', mongoUrl.includes('mongodb+srv') ? 
    `${mongoUrl.substring(0, 25)}...${mongoUrl.substring(mongoUrl.lastIndexOf('/'))}` : mongoUrl);
  console.log('MONGO_OPLOG_URL:', mongoOplogUrl.includes('mongodb+srv') ? 
    `${mongoOplogUrl.substring(0, 25)}...${mongoOplogUrl.substring(mongoOplogUrl.lastIndexOf('/'))}` : mongoOplogUrl);
  console.log('Database Type:', mongoUrl.includes('mongodb+srv') ? 'Atlas (Cloud)' : 'Local MongoDB');
  console.log('====================================\n');

  // Check if SFTP Private Key is available in settings
  if (Meteor.settings && Meteor.settings.private && Meteor.settings.private.SFTP_PRIVATE_KEY) {
    console.log('✅ SFTP_PRIVATE_KEY loaded from settings file');
  } else {
    console.log('⚠️  SFTP_PRIVATE_KEY not found in Meteor.settings.private');
  }

  // Log collection counts at startup
  const productCount = await ProductsCollection.find().countAsync();
  const equityHoldingsCount = await EquityHoldingsCollection.find().countAsync();
  const bankAccountsCount = await BankAccountsCollection.find().countAsync();
  
  console.log('Server startup collection counts:');
  console.log(`  - Products: ${productCount}`);
  console.log(`  - Equity Holdings: ${equityHoldingsCount}`);
  console.log(`  - Bank Accounts: ${bankAccountsCount}`);
  console.log('');
  
  const db = EquityHoldingsCollection.rawDatabase();
  console.log(`Connected to database: ${db.databaseName}\n`);
  
  if (productCount > 0) {
    const products = await ProductsCollection.find().fetchAsync();
    products.forEach(product => {
      console.log(`[PRODUCTS] Startup found: ${product.title} (${product.isin || 'no ISIN'}) - ID: ${product._id}`);
    });
    
    // Delete the sample products if they exist
    const sampleTitles = [
      "Generic Early Termination Product",
      "Multi-Asset Structure", 
      "Protected Structure"
    ];
    
    for (const title of sampleTitles) {
      const sampleProduct = await ProductsCollection.findOneAsync({ title });
      if (sampleProduct) {
        await ProductsCollection.removeAsync(sampleProduct._id);
        console.log(`[PRODUCTS] Deleted sample product: ${title}`);
      }
    }
    
    const remainingCount = await ProductsCollection.find().countAsync();
    console.log(`[PRODUCTS] After cleanup - ${remainingCount} products remaining`);
  }
  
  // If the Links collection is empty, add some data.
  if (await LinksCollection.find().countAsync() === 0) {
    await insertLink({
      title: 'Do the Tutorial',
      url: 'https://www.meteor.com/tutorials/react/creating-an-app',
    });

    await insertLink({
      title: 'Follow the Guide',
      url: 'https://guide.meteor.com',
    });

    await insertLink({
      title: 'Read the Docs',
      url: 'https://docs.meteor.com',
    });

    await insertLink({
      title: 'Discussions',
      url: 'https://forums.meteor.com',
    });
  }

  // Initialize built-in templates
  console.log('🏗️  Initializing built-in templates...');
  try {
    for (const template of BUILT_IN_TEMPLATES) {
      const existing = await TemplatesCollection.findOneAsync({ 
        name: template.name, 
        isBuiltIn: true 
      });
      
      if (!existing) {
        await TemplatesCollection.insertAsync(template);
        console.log(`✅ Inserted built-in template: ${template.name}`);
      } else {
        console.log(`⏭️  Template already exists: ${template.name}`);
      }
    }
    console.log('🏗️  Built-in templates initialization complete');
  } catch (error) {
    console.error('❌ Error initializing built-in templates:', error);
  }

  // One-time migration: Update termsheet URLs from old format (/termsheets/{productId}/{filename}) to new flat format (/termsheets/{filename})
  console.log('📄 Migrating termsheet URLs to flat structure...');
  try {
    const productsWithTermsheets = await ProductsCollection.find({
      'termSheet.url': { $exists: true, $ne: null }
    }).fetchAsync();

    let migrated = 0;
    for (const product of productsWithTermsheets) {
      const url = product.termSheet.url;

      // Check if URL is in old format: /termsheets/{productId}/{filename}
      const urlParts = url.replace(/^\//, '').split('/');
      if (urlParts.length === 3 && urlParts[0] === 'termsheets') {
        // Old format detected - update to new flat format
        const filename = urlParts[2];
        const newUrl = `/termsheets/${filename}`;

        await ProductsCollection.updateAsync(product._id, {
          $set: {
            'termSheet.url': newUrl
          }
        });

        console.log(`  ✅ Migrated: ${product.title} (${product._id})`);
        console.log(`     Old: ${url}`);
        console.log(`     New: ${newUrl}`);
        migrated++;
      }
    }

    if (migrated > 0) {
      console.log(`📄 Migrated ${migrated} termsheet URL(s) to flat structure`);
    } else {
      console.log(`📄 No termsheet URLs needed migration`);
    }
  } catch (error) {
    console.error('❌ Error migrating termsheet URLs:', error);
  }

  // Ensure admin user exists
  console.log('👤 Checking for admin user...');
  try {
    const adminEmail = 'admin@example.com';
    const existingAdmin = await UsersCollection.findOneAsync({ username: adminEmail });

    if (!existingAdmin) {
      // Create admin user
      const adminUser = {
        username: adminEmail,
        password: UserHelpers.hashPassword('admin123'),
        role: USER_ROLES.SUPERADMIN,
        profile: {
          firstName: 'Admin',
          lastName: 'User',
          preferredLanguage: 'en',
          createdAt: new Date(),
          updatedAt: new Date()
        }
      };

      const result = await UsersCollection.insertAsync(adminUser);
      console.log('✅ Admin user created successfully!');
      console.log('   Email: admin@example.com');
      console.log('   Password: admin123');
      console.log('   Role: superadmin');
      console.log(`   User ID: ${result}`);
    } else {
      console.log('⏭️  Admin user already exists');
      console.log(`   User ID: ${existingAdmin._id}`);
      console.log(`   Role: ${existingAdmin.role}`);
    }
  } catch (error) {
    console.error('❌ Error checking/creating admin user:', error);
  }

  // Initialize cron jobs for nightly operations
  console.log('⏰ Initializing cron jobs...');
  try {
    await initializeCronJobs();
    console.log('✅ Cron jobs initialized successfully');
  } catch (error) {
    console.error('❌ Error initializing cron jobs:', error);
  }

  // First-user trigger: Update market ticker prices when user connects after idle period
  Meteor.onConnection((connection) => {
    // Check if ticker data is stale (>15 minutes old)
    if (isDataStale(15)) {
      console.log('[MarketTicker] Stale data detected on new connection, triggering immediate update');

      // Run async without blocking connection
      Meteor.defer(async () => {
        try {
          await updateMarketTickerPrices();
          console.log('[MarketTicker] First-user trigger update completed');
        } catch (error) {
          console.error('[MarketTicker] First-user trigger update failed:', error);
        }
      });
    }
  });

  console.log('✅ Market ticker first-user trigger configured');

  // We publish the entire Links collection to all clients.
  // In order to be fetched in real-time to the clients
  Meteor.publish("links", function () {
    return LinksCollection.find();
  });

  // Role-based products publication with access control  
  Meteor.publish("products", async function (sessionId = null) {
    // Use provided sessionId parameter or fallback to connection ID
    const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
    let currentUser = null;
    
    // Try to get user from session (if available)
    if (effectiveSessionId) {
      try {
        const session = await SessionHelpers.validateSession(effectiveSessionId);
        
        if (session && session.userId) {
          currentUser = await UsersCollection.findOneAsync(session.userId);
        }
      } catch (error) {
        // Session validation failed - continue with no user
      }
    }
    
    // If no authenticated user, return empty (security)
    if (!currentUser) {
      return this.ready();
    }
    
    // SuperAdmin sees everything
    if (currentUser.role === USER_ROLES.SUPERADMIN) {
      console.log(`[PRODUCTS] SuperAdmin ${currentUser.email} accessing products`);
      return ProductsCollection.find();
    }
    
    // Admin sees everything (same as superadmin for now)
    if (currentUser.role === USER_ROLES.ADMIN) {
      console.log(`[PRODUCTS] Admin ${currentUser.email} accessing products`);
      return ProductsCollection.find();
    }

    // Compliance sees everything (for compliance review purposes)
    if (currentUser.role === USER_ROLES.COMPLIANCE) {
      console.log(`[PRODUCTS] Compliance ${currentUser.email} accessing products`);
      return ProductsCollection.find();
    }

    // AllocationsCollection is already imported at the top

    // Relationship Manager sees products of their assigned clients
    if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      // Get all clients assigned to this RM
      const assignedClients = await UsersCollection.find({
        role: USER_ROLES.CLIENT,
        relationshipManagerId: currentUser._id
      }).fetchAsync();
      
      const clientIds = assignedClients.map(client => client._id);
      
      if (clientIds.length === 0) {
        return this.ready();
      }
      
      // Find all allocations for these clients
      const clientAllocations = await AllocationsCollection.find({
        clientId: { $in: clientIds }
      }).fetchAsync();
      
      const productIds = [...new Set(clientAllocations.map(alloc => alloc.productId))];
      
      return ProductsCollection.find({ _id: { $in: productIds } });
    }
    
    // Client sees only products they have allocations in
    if (currentUser.role === USER_ROLES.CLIENT) {
      // Find all allocations for this client (active, matured, or cancelled)
      const userAllocations = await AllocationsCollection.find({
        clientId: currentUser._id
      }).fetchAsync();
      
      const productIds = [...new Set(userAllocations.map(alloc => alloc.productId))];
      
      if (productIds.length === 0) {
        return this.ready();
      }
      
      return ProductsCollection.find({ _id: { $in: productIds } });
    }
    
    // Unknown role - return empty
    return this.ready();
  });

  // Publish single product by ID
  Meteor.publish("products.single", async function (productId, sessionId = null) {
    check(productId, String);
    
    const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
    let currentUser = null;
    
    if (effectiveSessionId) {
      try {
        const session = await SessionHelpers.validateSession(effectiveSessionId);
        if (session && session.userId) {
          currentUser = await UsersCollection.findOneAsync(session.userId);
        }
      } catch (error) {
        // Session validation failed
      }
    }
    
    // If no authenticated user, return empty
    if (!currentUser) {
      return this.ready();
    }
    
    // Find the specific product
    const product = await ProductsCollection.findOneAsync(productId);
    if (!product) {
      return this.ready();
    }
    
    // Apply same access control as products publication
    if (currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.ADMIN || currentUser.role === USER_ROLES.COMPLIANCE) {
      return ProductsCollection.find({ _id: productId });
    }

    // For clients and RMs, check if they have access to this product through allocations
    let hasAccess = false;
    
    if (currentUser.role === USER_ROLES.CLIENT) {
      const allocation = await AllocationsCollection.findOneAsync({ 
        productId: productId, 
        clientId: currentUser._id 
      });
      hasAccess = !!allocation;
    } else if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
      const assignedClients = await UsersCollection.find({
        role: USER_ROLES.CLIENT,
        relationshipManagerId: currentUser._id
      }).fetchAsync();
      
      const clientIds = assignedClients.map(client => client._id);
      const allocation = await AllocationsCollection.findOneAsync({ 
        productId: productId, 
        clientId: { $in: clientIds } 
      });
      hasAccess = !!allocation;
    }
    
    if (hasAccess) {
      return ProductsCollection.find({ _id: productId });
    }
    
    return this.ready();
  });

  // Publish product allocations with role-based access control
  Meteor.publish("productAllocations", async function (productId, sessionId = null) {
    check(productId, String);
    
    // Get the current user making the subscription request
    const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
    let currentUser = null;
    
    // Try to get user from session
    if (effectiveSessionId) {
      try {
        // SessionHelpers is already imported at the top
        const session = await SessionHelpers.validateSession(effectiveSessionId);
        if (session && session.userId) {
          currentUser = await UsersCollection.findOneAsync(session.userId);
        }
      } catch (error) {
        // console.log('productAllocations publication: No valid session found');
      }
    }
    
    // If no authenticated user, return empty
    if (!currentUser) {
      // console.log('productAllocations publication: No authenticated user, returning empty');
      return this.ready();
    }
    
    // console.log('productAllocations publication: User role:', currentUser.role, 'productId:', productId);

    try {
      // AllocationsCollection is already imported at the top
      
      // SuperAdmin and Admin see all allocations for the product
      if (currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.ADMIN) {
        // console.log('productAllocations publication: Admin/SuperAdmin access - returning all allocations');
        return AllocationsCollection.find({ productId: productId });
      }
      
      // Relationship Manager sees allocations for their assigned clients only
      if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
        // console.log('productAllocations publication: RM access - finding client allocations');
        
        // Get all clients assigned to this RM
        const assignedClients = await UsersCollection.find({
          role: USER_ROLES.CLIENT,
          relationshipManagerId: currentUser._id
        }).fetchAsync();
        
        const clientIds = assignedClients.map(client => client._id);
        // console.log('productAllocations publication: RM has', clientIds.length, 'assigned clients');
        
        if (clientIds.length === 0) {
          return this.ready();
        }
        
        return AllocationsCollection.find({ 
          productId: productId,
          clientId: { $in: clientIds }
        });
      }
      
      // Client sees only their own allocations
      if (currentUser.role === USER_ROLES.CLIENT) {
        // console.log('productAllocations publication: Client access - returning own allocations');
        return AllocationsCollection.find({ 
          productId: productId,
          clientId: currentUser._id
        });
      }
      
      // Unknown role - return empty
      // console.log('productAllocations publication: Unknown role:', currentUser.role);
      return this.ready();
    } catch (error) {
      console.log('productAllocations publication error:', error.message);
      return this.ready();
    }
  });

  // Publish all allocations with role-based access control
  Meteor.publish("allAllocations", async function (sessionId = null) {
    // Get the current user making the subscription request
    const effectiveSessionId = sessionId || this.connection.headers?.sessionid || this.connection.id;
    let currentUser = null;
    
    // Try to get user from session
    if (effectiveSessionId) {
      try {
        // SessionHelpers is already imported at the top
        const session = await SessionHelpers.validateSession(effectiveSessionId);
        if (session && session.userId) {
          currentUser = await UsersCollection.findOneAsync(session.userId);
        }
      } catch (error) {
        // console.log('allAllocations publication: Session validation error:', error.message);
      }
    }
    
    // If no authenticated user, return empty
    if (!currentUser) {
      // console.log('allAllocations publication: No authenticated user, returning empty');
      return this.ready();
    }

    try {
      // AllocationsCollection is already imported at the top
      
      // SuperAdmin and Admin see all allocations
      if (currentUser.role === USER_ROLES.SUPERADMIN || currentUser.role === USER_ROLES.ADMIN) {
        return AllocationsCollection.find();
      }
      
      // Relationship Manager sees allocations for their assigned clients only
      if (currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) {
        const assignedClients = await UsersCollection.find({
          role: USER_ROLES.CLIENT,
          relationshipManagerId: currentUser._id
        }).fetchAsync();
        
        const clientIds = assignedClients.map(client => client._id);
        if (clientIds.length === 0) {
          return this.ready();
        }
        
        return AllocationsCollection.find({ clientId: { $in: clientIds } });
      }
      
      // Client sees only their own allocations
      if (currentUser.role === USER_ROLES.CLIENT) {
        return AllocationsCollection.find({ clientId: currentUser._id });
      }
      
      return this.ready();
    } catch (error) {
      console.log('allAllocations publication error:', error.message);
      return this.ready();
    }
  });

  // Publish users for admin management
  Meteor.publish("customUsers", function () {
    // For now, publish all users (in production, add proper access control)
    return UsersCollection.find({}, {
      fields: {
        email: 1,
        username: 1,
        role: 1,
        profile: 1,
        createdAt: 1
      }
    });
  });

  // Publish templates for all users
  Meteor.publish("templates", async function () {
    const { TemplatesCollection } = require('/imports/api/templates');
    
    // Debug: Check how many templates exist
    const count = await TemplatesCollection.find({}).countAsync();
    // console.log(`Templates publication: Found ${count} templates in database`);
    
    return TemplatesCollection.find({}, { 
      sort: { name: 1 }
    });
  });

  // Publish banks for bank selection
  Meteor.publish("banks", function () {
    return BanksCollection.find({ isActive: true }, { sort: { name: 1 } });
  });

  // Publish banks management (admin only)
  Meteor.publish("banksManagement", function () {
    return BanksCollection.find({}, { sort: { name: 1 } });
  });

  // Publish user's bank accounts
  Meteor.publish("userBankAccounts", function (userId) {
    if (!userId) return this.ready();
    return BankAccountsCollection.find({ userId: userId, isActive: true });
  });

  // Publish all bank accounts (admin only for linking)
  // REMOVED DUPLICATE - see line 3671 for the actual allBankAccounts publication

  // Publish issuers for general use
  Meteor.publish("issuers", function () {
    return IssuersCollection.find({ active: true }, { sort: { name: 1 } });
  });

  // Publish all issuers for management (admin only)
  Meteor.publish("issuersManagement", async function () {
    const user = await UsersCollection.findOneAsync(this.userId);
    if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
      return this.ready();
    }
    return IssuersCollection.find({}, { sort: { name: 1 } });
  });

  // Publish market data cache (admin only)
  Meteor.publish("marketDataCache", async function () {
    const user = await UsersCollection.findOneAsync(this.userId);
    if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
      return this.ready();
    }
    
    // Import here to avoid circular dependency
    const { MarketDataCacheCollection } = require('/imports/api/marketDataCache');
    return MarketDataCacheCollection.find({}, { 
      sort: { date: -1 }, 
      limit: 1000 // Limit for performance
    });
  });

  // Publish market data for underlyings view (public - for all authenticated users)
  Meteor.publish("underlyingsMarketData", function () {
    // Import here to avoid circular dependency
    const { MarketDataCacheCollection } = require('/imports/api/marketDataCache');
    
    // Return only the latest market data for each symbol
    return MarketDataCacheCollection.find({}, { 
      sort: { timestamp: -1 },
      limit: 500 // Reasonable limit for performance
    });
  });

  // Publish recent price uploads (superadmin only)
  Meteor.publish("recentPriceUploads", async function (limit = 10) {
    const user = await UsersCollection.findOneAsync(this.userId);
    if (!user || user.role !== USER_ROLES.SUPERADMIN) {
      return this.ready();
    }
    return ProductPricesCollection.find(
      { isActive: true },
      { sort: { uploadDate: -1 }, limit: Math.min(limit, 100) }
    );
  });

  // Publish price history for specific ISIN
  Meteor.publish("priceHistory", function (isin, limit = 50) {
    if (!isin) return this.ready();
    return ProductPricesCollection.find(
      { isin: isin.toUpperCase(), isActive: true },
      { sort: { priceDate: -1, uploadDate: -1 }, limit: Math.min(limit, 200) }
    );
  });

  // Publish users (for allocation selection)
  Meteor.publish("users", async function () {
    // Get session from connection
    const sessionId = this.connection?.id;
    if (!sessionId) {
      return this.ready();
    }

    const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
    if (!session || !session.userId) {
      return this.ready();
    }

    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
      return this.ready();
    }
    
    return UsersCollection.find({}, {
      fields: {
        email: 1,
        username: 1,
        role: 1,
        profile: 1
      }
    });
  });

  // Publish bank accounts (for allocation selection)
  Meteor.publish("bankAccounts", async function () {
    // Get session from connection
    const sessionId = this.connection?.id;
    if (!sessionId) {
      return this.ready();
    }

    const session = await SessionsCollection.findOneAsync({ sessionId, isActive: true });
    if (!session || !session.userId) {
      return this.ready();
    }

    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
      return this.ready();
    }
    
    return BankAccountsCollection.find({ isActive: true });
  });

  // Ensure demo accounts exist (create or update existing users)
  if (SHOULD_SEED) {
    try {
      const results = await Meteor.callAsync('users.ensureDemoAccounts');
      console.log('Demo accounts status:', results);
    } catch (error) {
      console.error('Error ensuring demo accounts:', error);
    }
  } else {
    console.log('[SEEDING] Skipping demo account creation');
  }

  // Create sample client users if none exist
  if (SHOULD_SEED) {
    try {
      const existingClients = await UsersCollection.find({ role: USER_ROLES.CLIENT }).countAsync();
      if (existingClients === 0) {
        const client1Id = await UsersCollection.insertAsync({
          email: 'client1@example.com',
          username: 'client1',
          password: UserHelpers.hashPassword('client123'),
          role: USER_ROLES.CLIENT,
          profile: { firstName: 'John', lastName: 'Smith', createdAt: new Date(), updatedAt: new Date() },
          createdAt: new Date()
        });
        const client2Id = await UsersCollection.insertAsync({
          email: 'client2@example.com',
          username: 'client2',
          password: UserHelpers.hashPassword('client123'),
          role: USER_ROLES.CLIENT,
          profile: { firstName: 'Jane', lastName: 'Doe', createdAt: new Date(), updatedAt: new Date() },
          createdAt: new Date()
        });
        const client3Id = await UsersCollection.insertAsync({
          email: 'client3@example.com',
          username: 'client3',
          password: UserHelpers.hashPassword('client123'),
          role: USER_ROLES.CLIENT,
          profile: { firstName: 'Michael', lastName: 'Johnson', createdAt: new Date(), updatedAt: new Date() },
          createdAt: new Date()
        });
        console.log('Created sample client users:', client1Id, client2Id, client3Id);
      }
    } catch (error) {
      console.error('Error creating sample clients:', error);
    }
  } else {
    console.log('[SEEDING] Skipping sample client user creation');
  }

  // Create default banks if none exist
  if (SHOULD_SEED) {
    if (await BanksCollection.find().countAsync() === 0) {
      const defaultBanks = [
        { name: 'UBS', city: 'Zurich', country: 'Switzerland', countryCode: 'CH' },
        { name: 'Credit Suisse', city: 'Zurich', country: 'Switzerland', countryCode: 'CH' },
        { name: 'JPMorgan Chase', city: 'New York', country: 'United States', countryCode: 'US' },
        { name: 'Bank of America', city: 'Charlotte', country: 'United States', countryCode: 'US' },
        { name: 'Deutsche Bank', city: 'Frankfurt', country: 'Germany', countryCode: 'DE' },
        { name: 'BNP Paribas', city: 'Paris', country: 'France', countryCode: 'FR' },
        { name: 'HSBC', city: 'London', country: 'United Kingdom', countryCode: 'GB' },
        { name: 'Barclays', city: 'London', country: 'United Kingdom', countryCode: 'GB' }
      ];
      for (const bank of defaultBanks) {
        await BanksCollection.insertAsync({
          ...bank,
          isActive: true,
          createdAt: new Date(),
          createdBy: 'system'
        });
      }
    }
  } else {
    console.log('[SEEDING] Skipping default bank creation');
  }

  // Create sample bank accounts for clients if none exist
  if (SHOULD_SEED) {
    try {
      const existingBankAccounts = await BankAccountsCollection.find().countAsync();
      if (existingBankAccounts === 0) {
        const banks = await BanksCollection.find().fetchAsync();
        const clients = await UsersCollection.find({ role: USER_ROLES.CLIENT }).fetchAsync();
        if (banks.length > 0 && clients.length > 0) {
          for (const client of clients) {
            const clientName = client.username || client.email?.split('@')[0] || client._id.substring(0, 8);
            const bankAccount1Id = await BankAccountsCollection.insertAsync({
              userId: client._id,
              bankId: banks[0]._id,
              accountNumber: `${clientName.toUpperCase()}-001`,
              referenceCurrency: 'USD',
              isActive: true,
              createdAt: new Date()
            });
            const bankAccount2Id = await BankAccountsCollection.insertAsync({
              userId: client._id,
              bankId: banks[1]._id,
              accountNumber: `${clientName.toUpperCase()}-002`,
              referenceCurrency: 'EUR',
              isActive: true,
              createdAt: new Date()
            });
            console.log(`Created bank accounts for ${clientName}:`, bankAccount1Id, bankAccount2Id);
          }
        }
      }
    } catch (error) {
      console.error('Error creating sample bank accounts:', error);
    }
  } else {
    console.log('[SEEDING] Skipping sample bank account creation');
  }
  
  // Create additional test data for admin functionality
  if (SHOULD_SEED) {
    await createTestData();
  } else {
    console.log('[SEEDING] Skipping additional admin test data creation');
  }

  // Create default issuers if none exist
  if (SHOULD_SEED) {
    if (await IssuersCollection.find().countAsync() === 0) {
      for (const issuer of DEFAULT_ISSUERS) {
        await IssuersCollection.insertAsync({
          ...issuer,
          createdAt: new Date(),
          createdBy: 'system'
        });
      }
    }
  } else {
    console.log('[SEEDING] Skipping default issuer creation');
  }

  // Clear any existing built-in templates from database
  if (SHOULD_SEED) {
    try {
      const deletedCount = await TemplatesCollection.removeAsync({ isBuiltIn: true });
      if (deletedCount > 0) {
        console.log(`Removed ${deletedCount} existing built-in templates from database`);
      }
    } catch (error) {
      console.error('Error removing built-in templates:', error);
    }
  } else {
    console.log('[SEEDING] Skipping built-in template maintenance');
  }

  // Create the single generic Reverse Convertible template
  try {
    const existingTemplate = await TemplatesCollection.findOneAsync({ 
      name: 'Reverse Convertible - Single Underlying',
      isBuiltIn: true 
    });
    
    if (!existingTemplate && SHOULD_SEED) {
      const reverseConvertibleTemplate = {
        name: 'Reverse Convertible - Single Underlying',
        description: 'European barrier reverse convertible with capital protection threshold. Coupon paid in any case, capital protection depends on barrier breach at maturity.',
        category: 'capital-protected',
        isBuiltIn: true,
        isPublic: true,
        createdAt: new Date(),
        createdBy: 'system',
        updatedAt: new Date(),
        version: 1,
        droppedItems: [
          // Maturity Section - Timing
          {
            id: "timing_maturity_1704067200000",
            type: "observation",
            label: "At Maturity",
            icon: "🏁",
            column: "timing",
            section: "maturity",
            rowIndex: 0,
            sortOrder: 0,
            value: "",
            defaultValue: "",
            isDefault: true,
            configurable: false
          },
          
          // Maturity Section - Coupon Payment (always paid)
          {
            id: "coupon_fixed_1704067200001",
            type: "action",
            label: "Pay Fixed Coupon",
            icon: "💰",
            column: "action",
            section: "maturity",
            rowIndex: 0,
            sortOrder: 0,
            value: "8.0",
            defaultValue: "8.0",
            configurable: true,
            description: "Fixed coupon payment (annual rate %)"
          },
          
          // Maturity Section - Capital Protection Logic Row
          {
            id: "timing_protection_1704067200002",
            type: "observation", 
            label: "At Maturity",
            icon: "🏁",
            column: "timing",
            section: "maturity",
            rowIndex: 1,
            sortOrder: 0,
            value: "",
            defaultValue: "",
            isDefault: true,
            configurable: false
          },
          
          // IF condition for protection check
          {
            id: "if_protection_1704067200003",
            type: "logic_operator",
            label: "IF",
            icon: "🔀",
            column: "condition",
            section: "maturity",
            rowIndex: 1,
            sortOrder: -1000,
            isDefault: true,
            configurable: false
          },
          
          // Single Underlying Asset
          {
            id: "underlying_single_1704067200004",
            type: "underlying",
            label: "Single Underlying",
            icon: "📈",
            column: "condition",
            section: "maturity", 
            rowIndex: 1,
            sortOrder: 1,
            configurable: true,
            underlyingType: "single",
            isBasket: false,
            selectedSecurity: null,
            strikePrice: "100"
          },
          
          // At or Above comparison
          {
            id: "comparison_gte_1704067200005",
            type: "comparison",
            label: "At or Above",
            icon: "≥",
            column: "condition",
            section: "maturity",
            rowIndex: 1,
            sortOrder: 2,
            value: ">=",
            defaultValue: ">=",
            configurable: false
          },
          
          // Capital Protection Barrier
          {
            id: "barrier_protection_1704067200006",
            type: "barrier",
            label: "Protection Level",
            icon: "🛡️", 
            column: "condition",
            section: "maturity",
            rowIndex: 1,
            sortOrder: 3,
            value: "70",
            defaultValue: "70",
            configurable: true,
            description: "Capital protection threshold (% of initial)"
          },
          
          // Capital Protection Action
          {
            id: "action_protection_1704067200007",
            type: "action",
            label: "Protection",
            icon: "🛡️",
            column: "action", 
            section: "maturity",
            rowIndex: 1,
            sortOrder: 0,
            value: "100",
            defaultValue: "100",
            configurable: true,
            description: "Capital protection amount (% return)"
          },
          
          // ELSE condition for loss participation
          {
            id: "else_loss_1704067200008",
            type: "logic_operator",
            label: "ELSE",
            icon: "🔄",
            column: "condition",
            section: "maturity",
            rowIndex: 2,
            sortOrder: -1000,
            isDefault: true,
            configurable: false
          },
          
          // Loss Participation Action
          {
            id: "action_participation_1704067200009", 
            type: "action",
            label: "Participation",
            icon: "📈",
            column: "action",
            section: "maturity",
            rowIndex: 2,
            sortOrder: 0,
            value: "100",
            defaultValue: "100", 
            configurable: true,
            description: "Loss participation rate (%)"
          }
        ]
      };
      
      const templateId = await TemplatesCollection.insertAsync(reverseConvertibleTemplate);
      console.log(`Created Reverse Convertible template: ${templateId}`);
    } else {
      console.log('Reverse Convertible template already exists');
    }
  } catch (error) {
    console.error('Error creating Reverse Convertible template:', error);
  }


  // Create database indexes for better query performance
  try {
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
  
  // Run chartData cleanup on startup to migrate any remaining embedded chartData
  try {
    console.log('Server startup: Running chartData cleanup...');
    const result = await Meteor.callAsync('products.cleanupChartData');
    console.log(`Server startup: ChartData cleanup completed - ${result.migrated}/${result.found} products migrated`);
  } catch (error) {
    console.error('Server startup: ChartData cleanup failed:', error);
  }
  
  console.log('✅ Server startup complete!');
});

// Enhanced session management with persistence
const userSessions = new Map();

// Session cleanup - remove sessions older than 24 hours
setInterval(() => {
  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  for (const [sessionId, session] of userSessions.entries()) {
    if (session.loginTime < twentyFourHoursAgo) {
      userSessions.delete(sessionId);
    }
  }
}, 60 * 60 * 1000); // Check every hour

// Helper function to extract underlyings from payoff structure
const extractUnderlyingsFromPayoffStructure = (payoffStructure) => {
  const underlyings = [];
  const items = payoffStructure || [];
  
  items.forEach(item => {
    if (item.type === 'underlying') {
      if (item.isBasket && item.selectedSecurities) {
        // Handle basket underlyings
        item.selectedSecurities.forEach(security => {
          underlyings.push({
            symbol: security.symbol,
            name: security.name || security.symbol,
            exchange: security.exchange,
            type: security.type || 'Stock',
            strikePrice: parseFloat(security.strikePrice) || null,
            weight: parseFloat(security.weight) || (100 / item.selectedSecurities.length),
            isBasketComponent: true
          });
        });
      } else if (item.selectedSecurity) {
        // Handle single underlying
        const security = item.selectedSecurity;
        underlyings.push({
          symbol: security.symbol,
          name: security.name || security.symbol,
          exchange: security.exchange,
          type: security.type || 'Stock',
          strikePrice: parseFloat(item.strikePrice) || null,
          weight: 100,
          isBasketComponent: false
        });
      }
    }
  });
  
  return underlyings;
};

// Helper function to validate session and get user
const validateSessionAndGetUser = async (sessionId) => {
  if (!sessionId) {
    throw new Meteor.Error('not-authorized', 'Session ID required');
  }
  
  // Use the same SessionHelpers approach as auth methods
  const session = await SessionHelpers.validateSession(sessionId);
  if (!session) {
    throw new Meteor.Error('not-authorized', 'Invalid or expired session');
  }
  
  // Get the user from the session
  const user = await UsersCollection.findOneAsync(session.userId);
  if (!user) {
    throw new Meteor.Error('not-authorized', 'User not found');
  }
  
  return user;
};

// Helper function to generate detailed component execution trace
const generateComponentExecutionTrace = async (product, compiledFormula, marketData) => {
  const trace = {
    componentExecutionFlow: [],
    executionSummary: {
      totalComponents: 0,
      executedComponents: 0,
      skippedComponents: 0
    }
  };

  if (!product.payoffStructure || !Array.isArray(product.payoffStructure)) {
    return trace;
  }

  // Group components by section and row for logical flow
  const componentsByRow = {};
  product.payoffStructure.forEach(component => {
    const key = `${component.section}-${component.rowIndex}`;
    if (!componentsByRow[key]) {
      componentsByRow[key] = [];
    }
    componentsByRow[key].push(component);
  });

  // Process each row to determine execution status
  for (const [rowKey, components] of Object.entries(componentsByRow)) {
    const [section, rowIndex] = rowKey.split('-');
    const rowIndexNum = parseInt(rowIndex);

    // Determine execution status from evaluation traces
    let rowExecuted = false;
    let executionDetails = null;

    if (compiledFormula.evaluationTraces && compiledFormula.evaluationTraces[section]) {
      const sectionTrace = compiledFormula.evaluationTraces[section];
      const rule = sectionTrace.rules?.find(r => r.ruleNumber === rowIndexNum + 1);
      
      if (rule) {
        rowExecuted = rule.executed;
        executionDetails = {
          logicType: rule.logicType,
          conditionsMet: rule.conditionsMet,
          actions: rule.actions || [],
          variables: rule.variables || {}
        };
      }
    }

    // Create component trace entry
    const rowTrace = {
      section: section,
      rowIndex: rowIndexNum,
      components: components.map(comp => ({
        id: comp.id,
        type: comp.type,
        label: comp.label,
        value: comp.value,
        column: comp.column,
        executed: rowExecuted,
        executionStatus: rowExecuted ? 'EXECUTED' : 'SKIPPED'
      })),
      executed: rowExecuted,
      executionDetails: executionDetails
    };

    trace.componentExecutionFlow.push(rowTrace);
    
    // Update summary counters
    trace.executionSummary.totalComponents += components.length;
    if (rowExecuted) {
      trace.executionSummary.executedComponents += components.length;
    } else {
      trace.executionSummary.skippedComponents += components.length;
    }
  }

  return trace;
};

// Server-side methods
Meteor.methods({
  // Built-in template seeding removed - system is now completely generic

  // Method to manually delete sample products
  async 'products.deleteSamples'() {
    const currentUser = await UsersCollection.findOneAsync(this.userId);
    if (!currentUser || currentUser.role !== 'superadmin') {
      throw new Meteor.Error('access-denied', 'Only superadmins can delete sample products');
    }
    
    const sampleTitles = [
      "Generic Early Termination Product",
      "Multi-Asset Structure", 
      "Protected Structure"
    ];
    
    let deletedCount = 0;
    for (const title of sampleTitles) {
      const sampleProduct = await ProductsCollection.findOneAsync({ title });
      if (sampleProduct) {
        await ProductsCollection.removeAsync(sampleProduct._id);
        console.log(`[PRODUCTS] Manually deleted sample product: ${title}`);
        deletedCount++;
      }
    }
    
    console.log(`[PRODUCTS] Manual cleanup completed - deleted ${deletedCount} sample products`);
    return { deleted: deletedCount };
  },

  // Method to clear all built-in templates from database
  async 'templates.clearBuiltIn'() {
    console.log('Clearing all built-in templates from database');
    
    try {
      const deletedCount = await TemplatesCollection.removeAsync({ isBuiltIn: true });
      console.log(`Removed ${deletedCount} built-in templates`);
      
      const remainingCount = await TemplatesCollection.find({}).countAsync();
      console.log(`Remaining templates in database: ${remainingCount}`);
      
      return { success: true, deleted: deletedCount, remaining: remainingCount };
    } catch (error) {
      console.error('Error clearing built-in templates:', error);
      throw new Meteor.Error('clear-failed', `Failed to clear templates: ${error.message}`);
    }
  },

  // Evaluate product using generic rule engine
  async 'products.evaluate'(productId) {
    check(productId, String);
    
    console.log('products.evaluate: Starting evaluation for product:', productId);
    
    try {
      // Get the product
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        throw new Meteor.Error('not-found', 'Product not found');
      }
      
      console.log('products.evaluate: Product found:', product.title || product.productName);
      
      // Import the generic rule engine
      const { spawn } = require('child_process');
      const path = require('path');
      
      // Create a Node.js process to run the rule engine
      // Use absolute path to the project root (where generic-rule-engine.js is located)
      const ruleEnginePath = 'C:\\\\Users\\\\mf\\\\Desktop\\\\meteor\\\\interface\\\\generic-rule-engine.js';
      
      return new Promise((resolve, reject) => {
        // Execute the generic rule engine directly with product ID as argument
        const child = spawn('node', [ruleEnginePath, productId, new Date().toISOString()], {
          cwd: process.cwd(),
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        child.on('close', (code) => {
          if (code === 0) {
            try {
              const result = JSON.parse(stdout.split('\n').slice(-2)[0] || stdout.trim());
              console.log('products.evaluate: Evaluation successful');
              resolve(result);
            } catch (parseError) {
              console.error('products.evaluate: Failed to parse result:', stdout);
              reject(new Meteor.Error('evaluation-error', 'Failed to parse evaluation result'));
            }
          } else {
            console.error('products.evaluate: Evaluation failed:', stderr);
            try {
              const errorResult = JSON.parse(stderr.split('\n').slice(-2)[0] || stderr.trim());
              reject(new Meteor.Error('evaluation-error', errorResult.error));
            } catch (parseError) {
              reject(new Meteor.Error('evaluation-error', 'Product evaluation failed'));
            }
          }
        });
        
        child.on('error', (error) => {
          console.error('products.evaluate: Spawn error:', error);
          reject(new Meteor.Error('evaluation-error', 'Failed to start evaluation process'));
        });
      });
      
    } catch (error) {
      console.error('products.evaluate: Error:', error);
      throw new Meteor.Error('evaluation-error', error.message);
    }
  },

  // Force clear all templates method
  async 'templates.forceDeleteAll'() {
    console.log('Force deleting ALL templates from database');
    
    try {
      const deletedCount = await TemplatesCollection.removeAsync({});
      console.log(`Force removed ${deletedCount} templates`);
      
      return { success: true, deleted: deletedCount };
    } catch (error) {
      console.error('Error force deleting templates:', error);
      throw new Meteor.Error('clear-failed', `Failed to clear templates: ${error.message}`);
    }
  },

  // Debug method to check templates in database - server version
  async 'templates.debugServer'() {
    try {
      console.log('=== TEMPLATES DEBUG SERVER METHOD CALLED ===');
      const count = await TemplatesCollection.find({}).countAsync();
      const templates = await TemplatesCollection.find({}).fetchAsync();
      
      console.log('templates.debugServer: Found', count, 'templates');
      if (templates.length > 0) {
        console.log('templates.debugServer: Template details:', templates.map(t => ({
          id: t._id,
          name: t.name,
          isBuiltIn: t.isBuiltIn,
          category: t.category,
          hasDroppedItems: !!t.droppedItems,
          droppedItemsCount: t.droppedItems?.length || 0
        })));
      }
      
      return {
        count,
        templates: templates.map(t => ({
          id: t._id,
          name: t.name,
          isBuiltIn: t.isBuiltIn,
          category: t.category,
          droppedItemsCount: t.droppedItems?.length || 0
        }))
      };
    } catch (error) {
      console.error('templates.debugServer: ERROR:', error);
      throw new Meteor.Error('debug-failed', `Debug failed: ${error.message}`);
    }
  },

  async 'auth.login'({ email, password, rememberMe = false }) {
    // Find user by email
    const user = await UsersCollection.findOneAsync({ email });
    
    if (!user) {
      throw new Meteor.Error('user-not-found', 'User not found');
    }

    // Verify password
    if (!UserHelpers.verifyPassword(password, user.password)) {
      throw new Meteor.Error('invalid-password', 'Invalid password');
    }

    // Get client info for session tracking
    const connection = this.connection;
    const userAgent = connection?.httpHeaders?.['user-agent'] || '';
    const ipAddress = connection?.clientAddress || '';

    // Create persistent session
    const session = await SessionHelpers.createSession(
      user._id, 
      rememberMe, 
      userAgent, 
      ipAddress
    );

    // Set HTTP-only cookie for persistent sessions
    if (rememberMe && this.connection && this.connection.httpHeaders) {
      const response = this.connection._meteorSession?.socket?.httpRequest?.response;
      if (response) {
        const cookieOptions = [
          `auth_session=${session.sessionId}`,
          'HttpOnly',
          'Secure', // Use in production with HTTPS
          'SameSite=Strict',
          `Max-Age=${30 * 24 * 60 * 60}`, // 30 days
          'Path=/'
        ].join('; ');
        
        response.setHeader('Set-Cookie', cookieOptions);
        console.log('Set persistent login cookie');
      }
    }

    return {
      sessionId: session.sessionId,
      user: {
        _id: user._id,
        email: user.email,
        role: user.role,
        profile: user.profile,
        firstName: user.profile?.firstName,
        lastName: user.profile?.lastName
      },
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe
    };
  },

  async 'auth.logout'(sessionId) {
    if (sessionId) {
      await SessionHelpers.invalidateSession(sessionId);
    }
    
    // Clear cookie if present
    if (this.connection && this.connection.httpHeaders) {
      const response = this.connection._meteorSession?.socket?.httpRequest?.response;
      if (response) {
        response.setHeader('Set-Cookie', 'auth_session=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/');
        console.log('Cleared persistent login cookie');
      }
    }
    
    return true;
  },

  async 'auth.logoutAllSessions'(sessionId) {
    // First validate the current session
    const session = await SessionHelpers.validateSession(sessionId);
    if (!session) {
      throw new Meteor.Error('invalid-session', 'Invalid session');
    }
    
    // Invalidate all sessions for this user
    await SessionHelpers.invalidateAllUserSessions(session.userId);
    
    return true;
  },

  async 'auth.getActiveSessions'(sessionId) {
    // Validate current session
    const currentSession = await SessionHelpers.validateSession(sessionId);
    if (!currentSession) {
      throw new Meteor.Error('invalid-session', 'Invalid session');
    }
    
    // Get all active sessions for the user
    const sessions = await SessionHelpers.getUserSessions(currentSession.userId);
    
    // Return sanitized session info
    return sessions.map(session => ({
      sessionId: session.sessionId,
      createdAt: session.createdAt,
      lastUsed: session.lastUsed,
      rememberMe: session.rememberMe,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      isCurrentSession: session.sessionId === sessionId
    }));
  },

  async 'auth.getCurrentUser'(sessionId) {
    try {
      // Validate session using persistent storage
      const session = await SessionHelpers.validateSession(sessionId);
      if (!session) {
        return null;
      }

      // Verify user still exists in database
      const user = await UsersCollection.findOneAsync(session.userId);
      if (!user) {
        await SessionHelpers.invalidateSession(sessionId);
        return null;
      }

      return {
        _id: user._id,
        email: user.email,
        role: user.role,
        profile: user.profile,
        firstName: user.profile?.firstName,
        lastName: user.profile?.lastName,
        sessionInfo: {
          createdAt: session.createdAt,
          lastUsed: session.lastUsed,
          rememberMe: session.rememberMe
        }
      };
    } catch (error) {
      console.error('Error in auth.getCurrentUser:', error);
      return null;
    }
  },

  /**
   * Request password reset - Generate token and send email
   * Always returns success to prevent email enumeration attacks
   */
  async 'auth.requestPasswordReset'(email) {
    check(email, String);

    try {
      // Normalize email
      const normalizedEmail = email.toLowerCase().trim();

      // Find user by email
      const user = await UsersCollection.findOneAsync({ email: normalizedEmail });

      if (user) {
        // Generate reset token
        const { token, expiresAt } = await PasswordResetHelpers.createResetToken(user._id, normalizedEmail);

        // Send reset email
        try {
          await EmailService.sendPasswordResetEmail(normalizedEmail, token, user.profile?.firstName);
          console.log(`Password reset email sent to ${normalizedEmail}`);
        } catch (emailError) {
          console.error('Failed to send password reset email:', emailError);
          // Don't throw error to prevent email enumeration
          // But log it for debugging
        }
      } else {
        console.log(`Password reset requested for non-existent email: ${normalizedEmail}`);
        // Don't reveal that user doesn't exist
      }

      // Always return success (prevents email enumeration)
      return {
        success: true,
        message: 'If an account exists with this email, you will receive password reset instructions shortly.'
      };

    } catch (error) {
      console.error('Error in auth.requestPasswordReset:', error);
      // Still return success to prevent information leakage
      return {
        success: true,
        message: 'If an account exists with this email, you will receive password reset instructions shortly.'
      };
    }
  },

  /**
   * Validate password reset token
   */
  async 'auth.validateResetToken'(token) {
    check(token, String);

    try {
      const tokenData = await PasswordResetHelpers.validateToken(token);

      if (!tokenData) {
        return {
          valid: false,
          error: 'Invalid or expired reset token'
        };
      }

      // Token is valid
      return {
        valid: true,
        email: tokenData.email
      };

    } catch (error) {
      console.error('Error in auth.validateResetToken:', error);
      return {
        valid: false,
        error: 'Error validating reset token'
      };
    }
  },

  /**
   * Reset password using valid token
   */
  async 'auth.resetPassword'(token, newPassword) {
    check(token, String);
    check(newPassword, String);

    try {
      // Validate token
      const tokenData = await PasswordResetHelpers.validateToken(token);

      if (!tokenData) {
        throw new Meteor.Error('invalid-token', 'Invalid or expired reset token');
      }

      // Validate password strength (basic validation)
      if (newPassword.length < 6) {
        throw new Meteor.Error('weak-password', 'Password must be at least 6 characters long');
      }

      // Get user
      const user = await UsersCollection.findOneAsync(tokenData.userId);
      if (!user) {
        throw new Meteor.Error('user-not-found', 'User not found');
      }

      // Update password
      await UsersCollection.updateAsync(tokenData.userId, {
        $set: {
          password: UserHelpers.hashPassword(newPassword)
        }
      });

      // Mark token as used
      await PasswordResetHelpers.markTokenAsUsed(token);

      // Invalidate all active sessions for security
      await SessionHelpers.invalidateAllUserSessions(tokenData.userId);

      // Invalidate any other unused reset tokens for this user
      await PasswordResetHelpers.invalidateUserTokens(tokenData.userId);

      console.log(`Password successfully reset for user ${tokenData.userId} (${tokenData.email})`);

      // Send confirmation email (optional, don't throw if it fails)
      try {
        await EmailService.sendPasswordChangedEmail(tokenData.email, user.profile?.firstName);
      } catch (emailError) {
        console.error('Failed to send password changed confirmation:', emailError);
      }

      return {
        success: true,
        message: 'Password successfully reset. You can now log in with your new password.'
      };

    } catch (error) {
      console.error('Error in auth.resetPassword:', error);

      if (error.error) {
        // Re-throw Meteor.Error
        throw error;
      }

      throw new Meteor.Error('reset-failed', 'Failed to reset password', error.message);
    }
  },

  async 'users.create'({ email, password, role = USER_ROLES.CLIENT, profile = {}, sessionId }) {
    check(email, String);
    check(password, String);
    check(role, String);
    check(profile, Object);
    check(sessionId, Match.Optional(String));

    // 1. Authenticate the caller (if sessionId is provided)
    if (sessionId) {
      const currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);

      if (!currentUser) {
        throw new Meteor.Error('access-denied', 'Authentication required');
      }

      // 2. Check if caller has permission to create users
      if (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN) {
        throw new Meteor.Error('access-denied', 'Only admins can create users');
      }

      // 3. Check if admin is trying to create superadmin (only superadmin can do this)
      if (role === USER_ROLES.SUPERADMIN && currentUser.role !== USER_ROLES.SUPERADMIN) {
        throw new Meteor.Error('access-denied', 'Only superadmins can create other superadmins');
      }

      console.log(`User creation requested by ${currentUser.email} (${currentUser.role}) - Creating ${role} user: ${email}`);
    }

    // Check if user already exists
    const existingUser = await UsersCollection.findOneAsync({ email });
    if (existingUser) {
      throw new Meteor.Error('user-exists', 'User with this email already exists');
    }

    // Create username from email if not provided
    const username = email.split('@')[0];

    // Prepare profile data
    const userProfile = {
      ...profile,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Create the user
    const userId = await UsersCollection.insertAsync({
      email,
      username,
      password: UserHelpers.hashPassword(password),
      role,
      profile: userProfile,
      createdAt: new Date()
    });

    return userId;
  },

  async 'users.ensureSuperAdmin'() {
    // Check if superadmin exists
    const existingSuperAdmin = await UsersCollection.findOneAsync({ 
      email: 'admin@example.com'
    });
    
    if (existingSuperAdmin) {
      // Update existing user to superadmin if needed
      if (existingSuperAdmin.role !== USER_ROLES.SUPERADMIN) {
        await UsersCollection.updateAsync(existingSuperAdmin._id, {
          $set: { 
            role: USER_ROLES.SUPERADMIN,
            password: UserHelpers.hashPassword('admin123')
          }
        });
        // console.log('Updated admin@example.com to superadmin role');
        return 'updated';
      }
      return 'exists';
    } else {
      // Create new superadmin
      const superadminId = await UsersCollection.insertAsync({
        email: 'admin@example.com',
        password: UserHelpers.hashPassword('admin123'),
        role: USER_ROLES.SUPERADMIN,
        createdAt: new Date()
      });
      // console.log('Created new superadmin:', superadminId);
      return 'created';
    }
  },

  async 'users.ensureDemoAccounts'() {
    // Ensure both demo accounts exist
    const demoAccounts = [
      {
        email: 'admin@example.com',
        password: 'admin123',
        role: USER_ROLES.SUPERADMIN,
        profile: {
          firstName: 'Admin',
          lastName: 'User',
          preferredLanguage: 'en'
        }
      },
      {
        email: 'client@example.com',
        password: 'client123',
        role: USER_ROLES.CLIENT,
        profile: {
          firstName: 'Client',
          lastName: 'User',
          preferredLanguage: 'en'
        }
      }
    ];

    const results = [];
    for (const account of demoAccounts) {
      const existingUser = await UsersCollection.findOneAsync({ 
        email: account.email
      });
      
      if (existingUser) {
        // Update existing user if needed
        if (existingUser.role !== account.role || !existingUser.profile) {
          await UsersCollection.updateAsync(existingUser._id, {
            $set: { 
              role: account.role,
              password: UserHelpers.hashPassword(account.password),
              profile: {
                ...account.profile,
                createdAt: existingUser.profile?.createdAt || new Date(),
                updatedAt: new Date()
              }
            }
          });
          results.push({ email: account.email, status: 'updated' });
        } else {
          results.push({ email: account.email, status: 'exists' });
        }
      } else {
        // Create new user
        await UsersCollection.insertAsync({
          email: account.email,
          password: UserHelpers.hashPassword(account.password),
          role: account.role,
          profile: {
            ...account.profile,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          createdAt: new Date()
        });
        results.push({ email: account.email, status: 'created' });
      }
    }
    
    return results;
  },

  async 'users.checkRole'({ email }) {
    const user = await UsersCollection.findOneAsync({ email });
    return user ? { email: user.email, role: user.role } : null;
  },

  async 'users.forceAdminRole'({ email }) {
    // Direct method to force update admin role
    const user = await UsersCollection.findOneAsync({ email });
    if (!user) {
      throw new Meteor.Error('user-not-found', 'User not found');
    }

    // Update database
    await UsersCollection.updateAsync(user._id, {
      $set: { 
        role: USER_ROLES.SUPERADMIN,
        password: UserHelpers.hashPassword('admin123')
      }
    });

    // Update all existing sessions for this user
    for (const [sessionId, sessionData] of userSessions.entries()) {
      if (sessionData.email === email) {
        sessionData.role = USER_ROLES.SUPERADMIN;
        // console.log(`Updated session ${sessionId} role to superadmin`);
      }
    }

    // console.log(`Forced update: ${email} is now superadmin`);
    return 'User role updated to superadmin and sessions refreshed';
  },

  async 'users.updateRole'(userId, newRole, sessionId) {
    check(userId, String);
    check(newRole, String);
    check(sessionId, String);

    // CRITICAL: Only SUPERADMIN can change user roles
    const session = await SessionHelpers.validateSession(sessionId);
    if (!session || !session.userId) {
      throw new Meteor.Error('unauthorized', 'Invalid or expired session');
    }

    const currentUser = await UsersCollection.findOneAsync(session.userId);
    if (!currentUser || currentUser.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('unauthorized', 'Only superadmins can change user roles');
    }

    // Validate role
    if (!Object.values(USER_ROLES).includes(newRole)) {
      throw new Meteor.Error('invalid-role', 'Invalid role specified');
    }

    // Validate target user exists
    const targetUser = await UsersCollection.findOneAsync(userId);
    if (!targetUser) {
      throw new Meteor.Error('user-not-found', 'Target user not found');
    }

    // Prevent changing own role
    if (userId === currentUser._id) {
      throw new Meteor.Error('invalid-operation', 'Cannot change your own role');
    }

    console.log(`[users.updateRole] Superadmin ${currentUser.email} changing role of ${targetUser.email} from ${targetUser.role} to ${newRole}`);

    // Update the user's role
    return await UsersCollection.updateAsync(userId, {
      $set: { role: newRole }
    });
  },

  async 'users.remove'(userId) {
    return await UsersCollection.removeAsync(userId);
  },

  async 'users.adminResetPassword'(userId, newPassword, sessionId) {
    check(userId, String);
    check(newPassword, String);
    check(sessionId, String);

    // CRITICAL: Verify caller is ADMIN or SUPERADMIN using sessionId-based auth
    const session = await SessionHelpers.validateSession(sessionId);
    if (!session || !session.userId) {
      throw new Meteor.Error('unauthorized', 'Invalid or expired session');
    }

    const currentUser = await UsersCollection.findOneAsync(session.userId);
    if (!currentUser || (currentUser.role !== USER_ROLES.SUPERADMIN && currentUser.role !== USER_ROLES.ADMIN)) {
      throw new Meteor.Error('unauthorized', 'Only admins can reset user passwords');
    }

    // Validate target user exists
    const targetUser = await UsersCollection.findOneAsync(userId);
    if (!targetUser) {
      throw new Meteor.Error('user-not-found', 'Target user not found');
    }

    // Prevent ADMINs from resetting SUPERADMIN passwords
    if (currentUser.role === USER_ROLES.ADMIN && targetUser.role === USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('unauthorized', 'Admins cannot reset superadmin passwords');
    }

    // Validate password strength
    if (!newPassword || newPassword.length < 6) {
      throw new Meteor.Error('weak-password', 'Password must be at least 6 characters long');
    }

    try {
      // Update password
      await UsersCollection.updateAsync(userId, {
        $set: {
          password: UserHelpers.hashPassword(newPassword)
        }
      });

      // Invalidate all active sessions for security (force re-login)
      await SessionHelpers.invalidateAllUserSessions(userId);

      // Log action for audit trail
      const adminType = currentUser.role === USER_ROLES.SUPERADMIN ? 'Superadmin' : 'Admin';
      console.log(`[ADMIN PASSWORD RESET] ${adminType} ${currentUser.email} (${session.userId}) reset password for user ${targetUser.email} (${userId})`);

      return {
        success: true,
        message: 'Password reset successfully. User has been logged out of all sessions.'
      };
    } catch (error) {
      console.error('Error resetting password:', error);
      throw new Meteor.Error('reset-failed', 'Failed to reset password', error.message);
    }
  },

  async 'users.updateProfile'(userId, userData) {
    console.log('Server: users.updateProfile called with:', { userId, userData });
    
    // Validate that the user exists
    const user = await UsersCollection.findOneAsync(userId);
    if (!user) {
      throw new Meteor.Error('user-not-found', 'User not found');
    }

    console.log('Server: Current user data:', { 
      email: user.email, 
      profile: user.profile 
    });

    const updateData = {};

    // Update email if provided
    if (userData.email) {
      if (!userData.email.trim()) {
        throw new Meteor.Error('invalid-email', 'Email is required');
      }

      // Check if email is already taken by another user
      const existingUser = await UsersCollection.findOneAsync({
        email: userData.email.trim(),
        _id: { $ne: userId }
      });
      
      if (existingUser) {
        throw new Meteor.Error('email-exists', 'Email is already in use by another user');
      }

      updateData.email = userData.email.trim();
    }

    // Update profile if provided
    if (userData.profile) {
      updateData.profile = {
        ...user.profile,
        ...userData.profile,
        updatedAt: new Date()
      };
      console.log('Server: Merged profile data:', updateData.profile);
    }

    // Update relationship manager ID if provided (including null to unassign)
    if (userData.hasOwnProperty('relationshipManagerId')) {
      if (userData.relationshipManagerId) {
        // Verify the RM exists and has the correct role (RM, admin, or superadmin)
        const rmUser = await UsersCollection.findOneAsync({
          _id: userData.relationshipManagerId,
          role: { $in: [USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN] }
        });

        if (!rmUser) {
          throw new Meteor.Error('invalid-rm', 'Invalid relationship manager (must be RM, admin, or superadmin)');
        }

        updateData.relationshipManagerId = userData.relationshipManagerId;
        console.log('Server: Assigning client to RM:', rmUser.email, `(${rmUser.role})`);
      } else {
        // Explicitly unassign the RM
        updateData.relationshipManagerId = null;
        console.log('Server: Unassigning RM from client');
      }
    }

    console.log('Server: Final update data:', updateData);

    const result = await UsersCollection.updateAsync(userId, {
      $set: updateData
    });

    console.log('Server: Update result:', result);
    return result;
  },

  // Bank management methods
  async 'banks.add'({ name, city, country, countryCode }) {
    return await BankHelpers.addBank(name, city, country, countryCode, this.userId || 'system');
  },

  async 'banks.update'(bankId, updates) {
    return await BankHelpers.updateBank(bankId, updates, this.userId || 'system');
  },

  async 'banks.deactivate'(bankId) {
    return await BankHelpers.deactivateBank(bankId, this.userId || 'system');
  },

  // Bank account management methods
  async 'bankAccounts.add'({ bankId, accountNumber, referenceCurrency, authorizedOverdraft, sessionId }) {
    console.log('Server: bankAccounts.add called with:', {
      bankId: bankId ? 'Present' : 'Missing',
      accountNumber: accountNumber ? 'Present' : 'Missing',
      referenceCurrency: referenceCurrency || 'None',
      authorizedOverdraft: authorizedOverdraft || 'None',
      sessionId: sessionId ? 'Present' : 'Missing'
    });

    try {
      const user = await validateSessionAndGetUser(sessionId);
      console.log('Server: User validated successfully:', { userId: user._id, username: user.username });
      const result = await BankAccountHelpers.addBankAccount(user._id, bankId, accountNumber, referenceCurrency, 'personal', 'direct', null, authorizedOverdraft);
      console.log('Server: Account added successfully:', result);
      return result;
    } catch (error) {
      console.error('Server: Error in bankAccounts.add:', error);
      throw error;
    }
  },

  async 'bankAccounts.create'({ userId, bankId, accountNumber, referenceCurrency, accountType = 'personal', accountStructure = 'direct', lifeInsuranceCompany, authorizedOverdraft, comment, sessionId }) {
    check(userId, String);
    check(bankId, String);
    check(accountNumber, String);
    check(referenceCurrency, String);
    check(accountType, String);
    check(accountStructure, String);
    check(sessionId, String);

    console.log('Server: bankAccounts.create called with:', { userId, bankId, accountNumber, referenceCurrency, accountType, accountStructure, lifeInsuranceCompany, authorizedOverdraft, comment });

    // Validate session and get current user
    const currentUser = await validateSessionAndGetUser(sessionId);

    // Only admins and superadmins can create bank accounts for users
    if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('not-authorized', 'Only administrators can create bank accounts for users');
    }

    // Validate that the target user exists
    const targetUser = await UsersCollection.findOneAsync(userId);
    if (!targetUser) {
      throw new Meteor.Error('user-not-found', 'Target user not found');
    }

    // Validate that the bank exists
    const bank = await BanksCollection.findOneAsync(bankId);
    if (!bank || !bank.isActive) {
      throw new Meteor.Error('bank-not-found', 'Bank not found or not active');
    }

    // Check if account number already exists for this user
    const existingAccount = await BankAccountsCollection.findOneAsync({
      userId: userId,
      accountNumber: accountNumber,
      isActive: true
    });

    if (existingAccount) {
      throw new Meteor.Error('account-exists', 'Account number already exists for this user');
    }

    // Create the bank account
    const bankAccountData = {
      userId,
      bankId,
      accountNumber,
      referenceCurrency: referenceCurrency.toUpperCase(),
      accountType,
      accountStructure,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add life insurance company if account is through life insurance
    if (accountStructure === 'life_insurance' && lifeInsuranceCompany) {
      bankAccountData.lifeInsuranceCompany = lifeInsuranceCompany;
    }

    // Add authorized overdraft (credit line) if provided
    if (authorizedOverdraft && authorizedOverdraft > 0) {
      bankAccountData.authorizedOverdraft = authorizedOverdraft;
    }

    // Add comment/description if provided
    if (comment && comment.trim()) {
      bankAccountData.comment = comment.trim();
    }

    console.log('Server: Creating bank account with data:', bankAccountData);
    const bankAccountId = await BankAccountsCollection.insertAsync(bankAccountData);
    console.log('Server: Bank account created successfully with ID:', bankAccountId);

    // Verify the account was created
    const createdAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    console.log('Server: Verification - created account:', createdAccount);

    return bankAccountId;
  },

  async 'bankAccounts.update'({ accountId, updates, sessionId }) {
    const user = await validateSessionAndGetUser(sessionId);

    // Verify account exists
    const account = await BankAccountsCollection.findOneAsync(accountId);
    if (!account) {
      throw new Meteor.Error('not-found', 'Account not found');
    }

    // Allow admin/superadmin to update any account, users can only update their own
    const isAdmin = user.role === USER_ROLES.ADMIN || user.role === USER_ROLES.SUPERADMIN;
    if (!isAdmin && account.userId !== user._id) {
      throw new Meteor.Error('not-authorized', 'Access denied');
    }

    return await BankAccountHelpers.updateBankAccount(accountId, updates);
  },

  async 'bankAccounts.remove'({ accountId, sessionId }) {
    check(accountId, String);
    check(sessionId, String);

    console.log('Server: bankAccounts.remove called with:', { accountId, sessionId });

    // Validate session and get current user
    const currentUser = await validateSessionAndGetUser(sessionId);
    
    // Only admins and superadmins can delete bank accounts
    if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('not-authorized', 'Only administrators can delete bank accounts');
    }

    // Verify account exists
    const account = await BankAccountsCollection.findOneAsync(accountId);
    if (!account) {
      throw new Meteor.Error('account-not-found', 'Bank account not found');
    }

    console.log('Server: Removing bank account:', account);
    const result = await BankAccountHelpers.deactivateBankAccount(accountId);
    console.log('Server: Bank account removed successfully');
    
    return result;
  },

  // Product price management methods
  async 'productPrices.bulkUpload'({ pricesData, source, metadata = {} }) {
    // Only superadmins can upload prices
    const user = await UsersCollection.findOneAsync(this.userId);
    if (!user || user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only superadmins can upload price data');
    }

    if (!Array.isArray(pricesData) || pricesData.length === 0) {
      throw new Meteor.Error('invalid-data', 'No price data provided');
    }

    try {
      // Validate and insert the price data
      const { validData, errors } = ProductPriceHelpers.validatePriceData(pricesData);
      
      if (validData.length === 0) {
        throw new Meteor.Error('no-valid-data', `No valid data found. Errors: ${errors.join('; ')}`);
      }

      const insertedIds = await ProductPriceHelpers.bulkInsertPrices(
        validData,
        this.userId,
        source
      );

      return {
        insertedCount: insertedIds.length,
        duplicateCount: validData.length - insertedIds.length,
        totalProcessed: pricesData.length,
        errorCount: errors.length,
        errors: errors.slice(0, 10) // Return first 10 errors
      };

    } catch (error) {
      throw new Meteor.Error('upload-failed', error.message);
    }
  },

  async 'productPrices.getLatest'(isin) {
    return ProductPriceHelpers.getLatestPrice(isin);
  },

  async 'productPrices.getHistory'(isin, limit = 50) {
    return ProductPriceHelpers.getPriceHistory(isin, limit).fetch();
  },

  // Bank account linking methods
  async 'users.updateBankAccountLinks'(userId, linkedAccountIds) {
    // Only admins and superadmins can link bank accounts to users
    const currentUser = await UsersCollection.findOneAsync(this.userId);
    if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('not-authorized', 'Only administrators can link bank accounts to users');
    }

    // Validate that the target user exists
    const targetUser = await UsersCollection.findOneAsync(userId);
    if (!targetUser) {
      throw new Meteor.Error('user-not-found', 'User not found');
    }

    // Validate that all account IDs exist and are active
    if (linkedAccountIds.length > 0) {
      const validAccounts = await BankAccountsCollection.find({
        _id: { $in: linkedAccountIds },
        isActive: true
      }).countAsync();

      if (validAccounts !== linkedAccountIds.length) {
        throw new Meteor.Error('invalid-accounts', 'Some bank account IDs are invalid or inactive');
      }
    }

    // First, unlink all current accounts for this user
    await BankAccountsCollection.updateAsync(
      { userId: userId },
      { $unset: { userId: 1 }, $set: { updatedAt: new Date() } },
      { multi: true }
    );

    // Then link the selected accounts
    if (linkedAccountIds.length > 0) {
      await BankAccountsCollection.updateAsync(
        { _id: { $in: linkedAccountIds } },
        { $set: { userId: userId, updatedAt: new Date() } },
        { multi: true }
      );
    }

    return {
      success: true,
      linkedCount: linkedAccountIds.length,
      message: `Successfully ${linkedAccountIds.length > 0 ? 'linked' : 'unlinked'} ${linkedAccountIds.length} bank account(s) for user ${targetUser.email}`
    };
  },

  // Issuer management methods
  async 'issuers.create'({ name, code, sessionId }) {
    // Only admins and superadmins can create issuers
    const currentUser = await validateSessionAndGetUser(sessionId);
    if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('not-authorized', 'Only administrators can create issuers');
    }

    // Validate input
    if (!name || !name.trim()) {
      throw new Meteor.Error('invalid-name', 'Issuer name is required');
    }
    if (!code || !code.trim()) {
      throw new Meteor.Error('invalid-code', 'Issuer code is required');
    }

    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    // Check for duplicates
    if (await IssuerHelpers.nameExists(trimmedName)) {
      throw new Meteor.Error('name-exists', 'An issuer with this name already exists');
    }
    if (await IssuerHelpers.codeExists(trimmedCode)) {
      throw new Meteor.Error('code-exists', 'An issuer with this code already exists');
    }

    // Create the issuer
    const issuerId = await IssuersCollection.insertAsync({
      name: trimmedName,
      code: trimmedCode,
      active: true,
      createdAt: new Date(),
      createdBy: currentUser._id
    });

    return issuerId;
  },

  async 'issuers.update'(issuerId, { name, code, sessionId }) {
    // Only admins and superadmins can update issuers
    const currentUser = await validateSessionAndGetUser(sessionId);
    if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('not-authorized', 'Only administrators can update issuers');
    }

    // Validate issuer exists
    const issuer = await IssuersCollection.findOneAsync(issuerId);
    if (!issuer) {
      throw new Meteor.Error('issuer-not-found', 'Issuer not found');
    }

    // Validate input
    if (!name || !name.trim()) {
      throw new Meteor.Error('invalid-name', 'Issuer name is required');
    }
    if (!code || !code.trim()) {
      throw new Meteor.Error('invalid-code', 'Issuer code is required');
    }

    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    // Check for duplicates (excluding current issuer)
    if (await IssuerHelpers.nameExists(trimmedName, issuerId)) {
      throw new Meteor.Error('name-exists', 'An issuer with this name already exists');
    }
    if (await IssuerHelpers.codeExists(trimmedCode, issuerId)) {
      throw new Meteor.Error('code-exists', 'An issuer with this code already exists');
    }

    // Update the issuer
    await IssuersCollection.updateAsync(issuerId, {
      $set: {
        name: trimmedName,
        code: trimmedCode,
        updatedAt: new Date(),
        updatedBy: currentUser._id
      }
    });

    return true;
  },

  async 'issuers.toggleActive'(issuerId, newActiveState, sessionId) {
    // Only admins and superadmins can toggle issuer active state
    const currentUser = await validateSessionAndGetUser(sessionId);
    if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('not-authorized', 'Only administrators can modify issuer status');
    }

    // Validate issuer exists
    const issuer = await IssuersCollection.findOneAsync(issuerId);
    if (!issuer) {
      throw new Meteor.Error('issuer-not-found', 'Issuer not found');
    }

    // Update the active state
    await IssuersCollection.updateAsync(issuerId, {
      $set: {
        active: newActiveState,
        updatedAt: new Date(),
        updatedBy: currentUser._id
      }
    });

    return true;
  },

  async 'issuers.remove'(issuerId, sessionId) {
    // Only superadmins can remove issuers
    const currentUser = await validateSessionAndGetUser(sessionId);
    if (!currentUser || currentUser.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only superadministrators can remove issuers');
    }

    // Validate issuer exists
    const issuer = await IssuersCollection.findOneAsync(issuerId);
    if (!issuer) {
      throw new Meteor.Error('issuer-not-found', 'Issuer not found');
    }

    // Remove the issuer
    await IssuersCollection.removeAsync(issuerId);

    return true;
  },


  // Product management methods
  async 'products.checkISINUniqueness'(isin, excludeProductId = null) {
    // Validate ISIN parameter
    if (!isin || typeof isin !== 'string') {
      throw new Meteor.Error('invalid-parameter', 'ISIN is required');
    }

    // Clean and normalize ISIN
    const cleanedIsin = isin.trim().toUpperCase();

    // Build query to find products with this ISIN
    // IMPORTANT: Only check non-draft products to allow multiple draft versions
    const query = {
      isin: cleanedIsin,
      productStatus: { $ne: 'draft' } // Exclude draft products
    };

    // Exclude current product if updating
    if (excludeProductId) {
      query._id = { $ne: excludeProductId };
    }

    try {
      // Check if another non-draft product exists with this ISIN
      const existingProduct = await ProductsCollection.findOneAsync(query, {
        fields: { _id: 1, title: 1, isin: 1, createdAt: 1, productStatus: 1 }
      });

      if (existingProduct) {
        return {
          isUnique: false,
          conflict: {
            productId: existingProduct._id,
            title: existingProduct.title,
            isin: existingProduct.isin,
            createdAt: existingProduct.createdAt,
            status: existingProduct.productStatus
          }
        };
      }

      return { isUnique: true, conflict: null };
    } catch (error) {
      console.error('[ISIN CHECK] Error checking ISIN uniqueness:', error);
      throw new Meteor.Error('check-failed', `Failed to check ISIN uniqueness: ${error.message}`);
    }
  },

  async 'products.save'(productData, sessionId) {
    // Validate session and get user
    const user = await validateSessionAndGetUser(sessionId);
    
    if (!user) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to save products');
    }

    // Run comprehensive server-side validation
    console.log('[PRODUCTS] Running server-side validation...');
    const validationResult = globalProductValidator.validate(productData);
    
    if (!validationResult.isValid) {
      const errors = validationResult.getFormattedErrors();
      console.error('[PRODUCTS] Validation failed:', errors);
      throw new Meteor.Error('validation-failed', `Product validation failed: ${errors.join('; ')}`);
    }
    
    if (validationResult.hasWarnings()) {
      const warnings = validationResult.getFormattedWarnings();
      console.warn('[PRODUCTS] Validation warnings:', warnings);
      // Warnings don't prevent saving but are logged
    }
    
    console.log('[PRODUCTS] ✅ Server-side validation passed');

    // Check ISIN uniqueness before saving (only for non-draft products with ISIN)
    if (productData.isin && productData.productStatus !== 'draft') {
      const cleanedIsin = productData.isin.trim().toUpperCase();
      const existingProduct = await ProductsCollection.findOneAsync({
        isin: cleanedIsin,
        productStatus: { $ne: 'draft' }
      });

      if (existingProduct) {
        console.error(`[PRODUCTS] Duplicate ISIN detected: ${cleanedIsin} already exists in product ${existingProduct._id}`);
        throw new Meteor.Error(
          'duplicate-isin',
          `A product with ISIN "${cleanedIsin}" already exists: "${existingProduct.title || 'Untitled'}". Please use a different ISIN or update the existing product.`
        );
      }
    }

    // Use underlyings data sent from client, fallback to extraction if not provided
    const underlyings = productData.underlyings && productData.underlyings.length > 0 
      ? productData.underlyings 
      : extractUnderlyingsFromPayoffStructure(productData.payoffStructure);
    
    // Extract chart data from product data if present
    const chartData = productData.chartData;
    const { chartData: _, ...productWithoutChartData } = productData;
    
    // Add metadata
    const enrichedProductData = {
      ...productWithoutChartData,
      underlyings: underlyings, // Store client-sent or extracted underlyings
      createdBy: user._id,
      createdAt: new Date(),
      lastUpdated: new Date()
    };

    try {
      console.log(`[PRODUCTS] Creating new product: ${enrichedProductData.title} (${enrichedProductData.isin || 'no ISIN'})`);
      const productId = await ProductsCollection.insertAsync(enrichedProductData);
      console.log(`[PRODUCTS] Successfully created product with ID: ${productId}`);

      // Save chart data separately if present
      if (chartData) {
        await Meteor.callAsync('chartData.upsert', productId, chartData);
      }

      // Auto-create allocations from PMS holdings if product has ISIN
      if (enrichedProductData.isin) {
        Meteor.defer(async () => {
          try {
            const createdAllocations = await AllocationHelpers.autoCreateFromPMSHoldings(productId, enrichedProductData.isin);
            if (createdAllocations.length > 0) {
              console.log(`[PRODUCTS] Auto-created ${createdAllocations.length} allocations from PMS holdings`);
            }
          } catch (allocError) {
            console.error('[PRODUCTS] Error auto-creating allocations:', allocError);
          }
        });

        // Auto-sync to securitiesMetadata if product has ISIN
        Meteor.defer(async () => {
          try {
            // Map templateId to structuredProductType
            const templateId = enrichedProductData.templateId || enrichedProductData.template || '';
            const templateLower = templateId.toLowerCase();

            let structuredProductType = 'other';
            if (templateLower.includes('phoenix') || templateLower.includes('autocallable')) {
              structuredProductType = 'phoenix';
            } else if (templateLower.includes('orion')) {
              structuredProductType = 'orion';
            } else if (templateLower.includes('himalaya')) {
              structuredProductType = 'himalaya';
            } else if (templateLower.includes('participation')) {
              structuredProductType = 'participation_note';
            } else if (templateLower.includes('reverse_convertible_bond')) {
              structuredProductType = 'reverse_convertible_bond';
            } else if (templateLower.includes('reverse_convertible')) {
              structuredProductType = 'reverse_convertible';
            } else if (templateLower.includes('shark')) {
              structuredProductType = 'shark_note';
            }

            // Determine underlying type based on underlyings
            let underlyingType = 'equity_linked'; // Default for most products
            if (enrichedProductData.underlyings && enrichedProductData.underlyings.length > 0) {
              const firstUnderlying = enrichedProductData.underlyings[0];
              const ticker = firstUnderlying.ticker || firstUnderlying.symbol || '';
              if (ticker.includes('.BOND') || ticker.includes('BOND')) {
                underlyingType = 'fixed_income_linked';
              } else if (ticker.includes('.COMM') || ticker.includes('GOLD') || ticker.includes('OIL')) {
                underlyingType = 'commodities_linked';
              }
            }

            // Determine protection type from product structure
            let protectionType = 'capital_protected_conditional'; // Default for most structured products
            if (enrichedProductData.capitalProtection === 100) {
              protectionType = 'capital_guaranteed_100';
            } else if (enrichedProductData.capitalProtection && enrichedProductData.capitalProtection > 0) {
              protectionType = 'capital_guaranteed_partial';
            }

            const securityMetadata = {
              isin: enrichedProductData.isin,
              securityName: enrichedProductData.title || `Structured Product ${enrichedProductData.isin}`,
              assetClass: 'structured_product',
              structuredProductType: structuredProductType,
              structuredProductUnderlyingType: underlyingType,
              structuredProductProtectionType: protectionType,
              sourceProductId: productId,
              autoCreatedFromProduct: true
            };

            await SecuritiesMetadataHelpers.upsertSecurityMetadata(securityMetadata);
            console.log(`[PRODUCTS] Auto-synced to securitiesMetadata: ${enrichedProductData.isin}`);
          } catch (metadataError) {
            console.error('[PRODUCTS] Error syncing to securitiesMetadata:', metadataError);
          }
        });
      }

      return productId;
    } catch (error) {
      throw new Meteor.Error('save-failed', `Failed to save product: ${error.message}`);
    }
  },

  async 'products.update'(productId, productData, sessionId) {
    // Validate session and get user
    const user = await validateSessionAndGetUser(sessionId);
    
    if (!user) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to update products');
    }

    // Only admins and superadmins can edit products
    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only administrators can edit products');
    }

    // Validate product exists
    const product = await ProductsCollection.findOneAsync(productId);
    if (!product) {
      throw new Meteor.Error('product-not-found', 'Product not found');
    }

    // Run comprehensive server-side validation  
    console.log('[PRODUCTS] Running server-side validation for update...');
    const validationResult = globalProductValidator.validate(productData);
    
    if (!validationResult.isValid) {
      const errors = validationResult.getFormattedErrors();
      console.error('[PRODUCTS] Update validation failed:', errors);
      throw new Meteor.Error('validation-failed', `Product validation failed: ${errors.join('; ')}`);
    }
    
    if (validationResult.hasWarnings()) {
      const warnings = validationResult.getFormattedWarnings();
      console.warn('[PRODUCTS] Update validation warnings:', warnings);
    }
    
    console.log('[PRODUCTS] ✅ Server-side update validation passed');

    // Check ISIN uniqueness before updating (exclude current product from check)
    if (productData.isin && productData.productStatus !== 'draft') {
      const cleanedIsin = productData.isin.trim().toUpperCase();
      const existingProduct = await ProductsCollection.findOneAsync({
        isin: cleanedIsin,
        productStatus: { $ne: 'draft' },
        _id: { $ne: productId } // Exclude current product
      });

      if (existingProduct) {
        console.error(`[PRODUCTS] Duplicate ISIN detected on update: ${cleanedIsin} already exists in product ${existingProduct._id}`);
        throw new Meteor.Error(
          'duplicate-isin',
          `A product with ISIN "${cleanedIsin}" already exists: "${existingProduct.title || 'Untitled'}". Please use a different ISIN.`
        );
      }
    }

    // Use underlyings data sent from client, fallback to extraction if not provided
    const underlyings = productData.underlyings && productData.underlyings.length > 0
      ? productData.underlyings
      : extractUnderlyingsFromPayoffStructure(productData.payoffStructure);

    // Extract chart data from product data if present
    const chartData = productData.chartData;
    const { chartData: _, ...productWithoutChartData } = productData;

    try {
      // Log key date fields being updated
      console.log(`[PRODUCTS UPDATE] Updating product ${productId}:`);
      console.log(`  - maturityDate: ${productWithoutChartData.maturityDate}`);
      console.log(`  - maturity: ${productWithoutChartData.maturity}`);
      console.log(`  - finalObservation: ${productWithoutChartData.finalObservation}`);
      console.log(`  - finalObservationDate: ${productWithoutChartData.finalObservationDate}`);

      await ProductsCollection.updateAsync(productId, {
        $set: {
          ...productWithoutChartData,
          underlyings: underlyings, // Update client-sent or extracted underlyings
          lastUpdated: new Date(),
          updatedBy: user._id
        }
      });

      // Update chart data separately if present
      if (chartData) {
        await Meteor.callAsync('chartData.upsert', productId, chartData);
      }

      // Auto-create allocations from PMS holdings if ISIN was added/changed
      const newIsin = productWithoutChartData.isin;
      if (newIsin && newIsin !== product.isin) {
        Meteor.defer(async () => {
          try {
            const createdAllocations = await AllocationHelpers.autoCreateFromPMSHoldings(productId, newIsin);
            if (createdAllocations.length > 0) {
              console.log(`[PRODUCTS] Auto-created ${createdAllocations.length} allocations from PMS holdings on update`);
            }
          } catch (allocError) {
            console.error('[PRODUCTS] Error auto-creating allocations on update:', allocError);
          }
        });
      }

      // Auto-sync to securitiesMetadata if product has ISIN (on create or update)
      if (productWithoutChartData.isin) {
        Meteor.defer(async () => {
          try {
            // Map templateId to structuredProductType
            const templateId = productWithoutChartData.templateId || productWithoutChartData.template || '';
            const templateLower = templateId.toLowerCase();

            let structuredProductType = 'other';
            if (templateLower.includes('phoenix') || templateLower.includes('autocallable')) {
              structuredProductType = 'phoenix';
            } else if (templateLower.includes('orion')) {
              structuredProductType = 'orion';
            } else if (templateLower.includes('himalaya')) {
              structuredProductType = 'himalaya';
            } else if (templateLower.includes('participation')) {
              structuredProductType = 'participation_note';
            } else if (templateLower.includes('reverse_convertible_bond')) {
              structuredProductType = 'reverse_convertible_bond';
            } else if (templateLower.includes('reverse_convertible')) {
              structuredProductType = 'reverse_convertible';
            } else if (templateLower.includes('shark')) {
              structuredProductType = 'shark_note';
            }

            // Determine underlying type based on underlyings
            let underlyingType = 'equity_linked';
            if (underlyings && underlyings.length > 0) {
              const firstUnderlying = underlyings[0];
              const ticker = firstUnderlying.ticker || firstUnderlying.symbol || '';
              if (ticker.includes('.BOND') || ticker.includes('BOND')) {
                underlyingType = 'fixed_income_linked';
              } else if (ticker.includes('.COMM') || ticker.includes('GOLD') || ticker.includes('OIL')) {
                underlyingType = 'commodities_linked';
              }
            }

            // Determine protection type from product structure
            let protectionType = 'capital_protected_conditional';
            if (productWithoutChartData.capitalProtection === 100) {
              protectionType = 'capital_guaranteed_100';
            } else if (productWithoutChartData.capitalProtection && productWithoutChartData.capitalProtection > 0) {
              protectionType = 'capital_guaranteed_partial';
            }

            const securityMetadata = {
              isin: productWithoutChartData.isin,
              securityName: productWithoutChartData.title || `Structured Product ${productWithoutChartData.isin}`,
              assetClass: 'structured_product',
              structuredProductType: structuredProductType,
              structuredProductUnderlyingType: underlyingType,
              structuredProductProtectionType: protectionType,
              sourceProductId: productId,
              autoCreatedFromProduct: true
            };

            await SecuritiesMetadataHelpers.upsertSecurityMetadata(securityMetadata);
            console.log(`[PRODUCTS] Auto-synced to securitiesMetadata on update: ${productWithoutChartData.isin}`);
          } catch (metadataError) {
            console.error('[PRODUCTS] Error syncing to securitiesMetadata on update:', metadataError);
          }
        });
      }

      // Trigger re-evaluation to update status (live/matured/autocalled) and report
      Meteor.defer(async () => {
        try {
          console.log(`[PRODUCTS] Triggering re-evaluation after update for product: ${productId}`);
          await Meteor.callAsync('products.triggerEvaluation', productId);
          console.log(`[PRODUCTS] Re-evaluation completed for product: ${productId}`);
        } catch (evalError) {
          console.error('[PRODUCTS] Error triggering re-evaluation after update:', evalError);
        }
      });

      return true;
    } catch (error) {
      throw new Meteor.Error('update-failed', `Failed to update product: ${error.message}`);
    }
  },

  async 'products.remove'(productId, sessionId) {
    // Validate session and get user
    const user = await validateSessionAndGetUser(sessionId);
    
    if (!user) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to remove products');
    }

    // Only admins and superadmins can remove products
    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only administrators can remove products');
    }

    // Validate product exists
    const product = await ProductsCollection.findOneAsync(productId);
    if (!product) {
      throw new Meteor.Error('product-not-found', 'Product not found');
    }

    try {
      await ProductsCollection.removeAsync(productId);
      
      // Also remove associated chart data
      await Meteor.callAsync('chartData.remove', productId);
      
      return true;
    } catch (error) {
      throw new Meteor.Error('remove-failed', `Failed to remove product: ${error.message}`);
    }
  },

  async 'products.cleanupChartData'() {
    // Import ChartDataCollection for migration
    const { ChartDataCollection } = await import('/imports/api/chartData.js');

    try {
      const products = await ProductsCollection.find({}).fetchAsync();
      let migrated = 0;
      let found = products.length;

      for (const product of products) {
        // Check if product has embedded chartData that needs migration
        if (product.chartData) {
          // Migrate chart data to separate collection
          await ChartDataCollection.upsertAsync(
            { productId: product._id },
            {
              $set: {
                productId: product._id,
                type: product.chartData.type || 'line',
                data: product.chartData.data || {},
                config: product.chartData.config || {},
                generatedAt: product.chartData.generatedAt || new Date(),
                updatedAt: new Date(),
                version: 1
              }
            }
          );

          // Remove chartData from product document
          await ProductsCollection.updateAsync(product._id, {
            $unset: { chartData: 1 }
          });

          migrated++;
        }
      }

      console.log(`Chart data cleanup: Migrated ${migrated} of ${found} products`);
      return { success: true, migrated, found };
    } catch (error) {
      console.error('Chart data cleanup error:', error);
      throw new Meteor.Error('cleanup-failed', `Failed to cleanup chart data: ${error.message}`);
    }
  },

  async 'products.processAllLiveProducts'(options = {}, sessionId) {
    check(options, Match.Optional(Object));
    check(sessionId, Match.Optional(String));

    const { includeDebug = false } = options;

    if (includeDebug) {
      console.log('=== BATCH PROCESS START ===');
      console.log('[SERVER] products.processAllLiveProducts called');
      console.log('[SERVER] Options:', options);
      console.log('[SERVER] SessionId:', sessionId);
    }

    // Validate session and check admin permissions
    if (sessionId) {
      const user = await validateSessionAndGetUser(sessionId);
      if (!user) {
        throw new Meteor.Error('not-authorized', 'You must be logged in');
      }

      // Only admins and superadmins can batch process all products
      if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN) {
        throw new Meteor.Error('access-denied', 'Only admins can batch process all products');
      }

      if (includeDebug) {
        console.log('[SERVER] User authenticated:', user.email, 'Role:', user.role);
      }
    }

    const batchStartTime = Date.now();

    try {
      // Get all products from database
      const allProducts = await ProductsCollection.find({}).fetchAsync();

      if (includeDebug) {
        console.log(`[SERVER] Found ${allProducts.length} products to process`);
      }

      let succeeded = 0;
      let failed = 0;
      const errors = [];
      const durations = [];

      // Summary data
      const summary = {
        autocallCount: 0,
        totalReturns: [],
        totalEvents: 0,
        totalPayments: 0
      };

      // Process each product
      for (const product of allProducts) {
        const productStartTime = Date.now();

        try {
          if (includeDebug) {
            console.log(`[SERVER] Processing product: ${product.title} (${product._id})`);
          }

          // Generate report for product (same as CRON job)
          const report = await Meteor.callAsync('templateReports.generate', product, 'batch-process');

          const duration = Date.now() - productStartTime;
          durations.push(duration);
          succeeded++;

          // Collect summary data from report if available
          if (report) {
            // Check for autocall status
            if (report.status?.autocalled || report.hasAutocalled) {
              summary.autocallCount++;
            }

            // Collect total return if available
            if (report.summary?.totalReturn !== undefined) {
              summary.totalReturns.push(report.summary.totalReturn);
            } else if (report.performance?.totalReturn !== undefined) {
              summary.totalReturns.push(report.performance.totalReturn);
            }

            // Count events and payments
            if (report.events && Array.isArray(report.events)) {
              summary.totalEvents += report.events.length;
              summary.totalPayments += report.events.filter(e => e.type === 'payment' || e.type === 'coupon').length;
            } else if (report.schedule && Array.isArray(report.schedule)) {
              summary.totalEvents += report.schedule.length;
              summary.totalPayments += report.schedule.filter(e => e.type === 'payment' || e.type === 'coupon').length;
            }
          }

          if (includeDebug) {
            console.log(`[SERVER] ✓ ${product.title}: ${duration}ms`);
          }

        } catch (error) {
          const duration = Date.now() - productStartTime;
          failed++;

          errors.push({
            productId: product._id,
            title: product.title,
            error: error.message
          });

          if (includeDebug) {
            console.error(`[SERVER] ✗ ${product.title}: ${error.message}`);
          }
        }
      }

      const totalTimeMs = Date.now() - batchStartTime;
      const avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;

      const results = {
        success: true,
        totalProducts: allProducts.length,
        successfulProducts: succeeded,
        failedProducts: failed,
        successRate: allProducts.length > 0 ? Math.round((succeeded / allProducts.length) * 100) : 0,
        totalTimeMs,
        avgDurationMs: avgDuration,
        summary,
        errors: errors.length > 0 ? errors : undefined
      };

      if (includeDebug) {
        console.log('[SERVER] Batch processing complete:', results);
        console.log('=== BATCH PROCESS END ===');
      }

      return results;

    } catch (error) {
      console.error('[SERVER] Batch processing failed:', error);

      return {
        success: false,
        error: error.message,
        totalProducts: 0,
        successfulProducts: 0,
        failedProducts: 0,
        successRate: 0,
        totalTimeMs: Date.now() - batchStartTime
      };
    }
  },

  async 'products.create.clean'(product) {
    check(product, Object);
    const toInsert = {
      title: product.title || 'Untitled Product',
      structure: product.structure || { timing: [], condition: [], action: [], continuation: [] },
      createdAt: product.createdAt || new Date(),
      createdBy: product.createdBy || null,
      status: 'draft'
    };
    const _id = await ProductsCollection.insertAsync(toInsert);
    return { _id };
  },

  async 'products.regenerateTitle'(productId, sessionId) {
    check(productId, String);
    check(sessionId, String);

    // Validate session
    const user = await validateSessionAndGetUser(sessionId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'You must be logged in');
    }

    // Get the product
    const product = await ProductsCollection.findOneAsync({ _id: productId });
    if (!product) {
      throw new Meteor.Error('not-found', 'Product not found');
    }

    // Generate title from product data
    const parts = [];
    const templateId = product.templateId || product.template;
    const isOrion = templateId && templateId.toLowerCase().includes('orion');

    // Add underlyings
    if (product.underlyings && product.underlyings.length > 0) {
      const tickers = product.underlyings.map(u => u.ticker || u.symbol).filter(Boolean);
      if (tickers.length > 0) {
        // Special handling for Orion: always show first 2 + remaining count
        if (isOrion && tickers.length > 2) {
          parts.push(`${tickers.slice(0, 2).join('/')} +${tickers.length - 2}`);
        } else if (tickers.length === 1) {
          parts.push(tickers[0]);
        } else if (tickers.length === 2) {
          parts.push(tickers.join('/'));
        } else if (tickers.length === 3) {
          parts.push(tickers.join('/'));
        } else {
          parts.push(`${tickers.slice(0, 2).join('/')} +${tickers.length - 2}`);
        }
      }
    }

    // Add template
    if (templateId) {
      let templateName = templateId
        .replace(/_/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());

      // Special handling for Orion: just use "Orion" instead of "Orion Memory"
      if (isOrion) {
        templateName = 'Orion';
      }

      parts.push(templateName);
    }

    // Add coupon rate
    if (product.structureParams?.couponRate) {
      parts.push(`${product.structureParams.couponRate}%`);
    }

    // Add currency if not USD
    if (product.currency && product.currency !== 'USD') {
      parts.push(product.currency);
    }

    // Add maturity year
    const maturity = product.maturity || product.maturityDate;
    if (maturity) {
      const year = new Date(maturity).getFullYear();
      parts.push(year.toString());
    }

    const newTitle = parts.length > 0 ? parts.join(' ') : `Product ${product.isin || productId}`;

    // Update the product
    await ProductsCollection.updateAsync(
      { _id: productId },
      { $set: { title: newTitle, lastUpdated: new Date() } }
    );

    console.log(`✅ Regenerated title for product ${productId}: "${newTitle}"`);

    return { title: newTitle };
  },

  async 'products.getDebugSteps'(productId) {
    check(productId, String);
    console.log('===== products.getDebugSteps called for:', productId);
    
    try {
      // Import debug logger
      const { globalDebugLogger } = await import('/imports/api/debugLogger.js');
      
      // Get stored debug steps
      const steps = globalDebugLogger.getSteps();
      console.log('Retrieved debug steps:', steps.length);
      
      return { steps };
    } catch (error) {
      console.error('Error getting debug steps:', error);
      throw new Meteor.Error('debug-steps-failed', `Failed to get debug steps: ${error.message}`);
    }
  },

  // Method stub retained for compatibility; evaluation removed
  async 'products.evaluateWithDebug'(productId) {
    check(productId, String);
    console.log('===== products.evaluateWithDebug called for:', productId);
    
    try {
      // Get the product
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        throw new Meteor.Error('product-not-found', 'Product not found');
      }

      // Import required modules
      const { PriceService } = await import('/imports/api/priceService.js');
      const { globalDebugLogger } = await import('/imports/api/debugLogger.js');
      const { narrativeLogger } = await import('/imports/api/narrativeDebugLogger.js');
      
      // No-op since engine removed
      globalDebugLogger.stopLogging?.();
      narrativeLogger.stopLogging?.();
      
      // Create regular interpreter
      const priceService = new PriceService();
      throw new Meteor.Error('not-available', 'Rule engine removed');
      
      // Run the evaluation with debug tracking
      console.log('Running evaluation...');
      // not reachable
      
      // Stop debug logging
      globalDebugLogger.stopLogging();
      narrativeLogger.stopLogging();
      
      console.log('Evaluation with debug complete. Steps:', globalDebugLogger.getSteps().length);
      console.log('Narrative steps:', narrativeLogger.getNarrative().length);
      
      // Get the captured debug steps - use narrative if available, fallback to technical
      return { steps: [], result: null };
      
    } catch (error) {
      console.error('Debug evaluation error:', error);
      throw new Meteor.Error('debug-failed', `Debug evaluation failed: ${error.message}`);
    }
  },

  async 'products.compileFormulaDebug'(productId) {
    check(productId, String);
    
    try {
      // Get the product
      const product = await ProductsCollection.findOneAsync(productId);
      if (!product) {
        throw new Meteor.Error('product-not-found', 'Product not found');
      }

      throw new Meteor.Error('not-available', 'Rule engine removed');
      // Fetch current market data for debugging
      let marketData = {};
      let barrierLevels = [];
      
      // Check if product has lastEvaluationReport to use actual evaluation data
      let useActualEvaluationData = false;
      let actualEvaluationData = null;
      
      if (product.lastEvaluationReport && product.lastEvaluationReport.events) {
        console.log('Product has lastEvaluationReport, extracting actual evaluation data...');
        useActualEvaluationData = true;
        
        // Find the maturity event
        const maturityEvent = product.lastEvaluationReport.events.find(e => 
          e.date === product.finalObservation || e.date === product.maturityDate || e.type === 'maturity'
        );
        
        if (maturityEvent) {
          actualEvaluationData = {
            date: maturityEvent.date,
            performance: maturityEvent.performance,
            underlyingPrices: maturityEvent.underlyingPrices,
            outcome: maturityEvent.outcome,
            payment: maturityEvent.payment
          };
          console.log('Found maturity evaluation data:', actualEvaluationData);
        }
        
        // Extract barrier level from evaluation report
        if (product.lastEvaluationReport.summary && product.lastEvaluationReport.summary.barriers) {
          const protectionBarrier = product.lastEvaluationReport.summary.barriers.find(b => 
            b.type === 'protection' || b.type === 'capital_protection'
          );
          if (protectionBarrier) {
            console.log('Found protection barrier from evaluation report:', protectionBarrier.level);
          }
        }
      }
      
      const today = new Date();
      
      // Ensure dates are valid
      if (isNaN(tradeDate.getTime())) {
        console.log('Invalid trade date, using today:', product.tradeDate);
        product.tradeDate = today.toISOString().split('T')[0];
      }
      if (isNaN(maturityDate.getTime())) {
        console.log('Invalid maturity date, using today:', product.maturityDate);
        product.maturityDate = today.toISOString().split('T')[0];
      }
      
      // Create a clean product object for context initialization
      const cleanProduct = {
        ...product,
        tradeDate: product.tradeDate || today.toISOString().split('T')[0],
        maturityDate: product.maturityDate || today.toISOString().split('T')[0],
        observationDates: Array.isArray(product.observationDates) ? product.observationDates : []
      };
      
      return { success: false, summary: null };
      
      // Update compiledFormula with actual evaluation data if available
      if (useActualEvaluationData && product.lastEvaluationReport) {
        console.log('Updating compiledFormula with actual evaluation report data...');
        
        // Update market data to show evaluation date prices
        if (actualEvaluationData) {
          compiledFormula.marketData = marketData;
          compiledFormula.evaluationDate = actualEvaluationData.date;
          compiledFormula.actualEvaluationData = actualEvaluationData;
        }
        
        // Update barrier levels from evaluation report
        if (product.lastEvaluationReport.summary && product.lastEvaluationReport.summary.barriers) {
          compiledFormula.actualBarriers = product.lastEvaluationReport.summary.barriers;
          
          // Find and update protection barrier in payoff structure  
          const protectionBarrier = product.lastEvaluationReport.summary.barriers.find(b => 
            b.type === 'protection' || b.type === 'capital_protection'
          );
          
          if (protectionBarrier) {
            console.log(`Updating protection barrier to actual value: ${protectionBarrier.level}%`);
            // Update barrierLevels array with actual value
            const existingProtectionIndex = barrierLevels.findIndex(b => 
              b.label?.toLowerCase().includes('protection')
            );
            
            if (existingProtectionIndex >= 0) {
              barrierLevels[existingProtectionIndex].level = protectionBarrier.level;
              barrierLevels[existingProtectionIndex].actualLevel = protectionBarrier.level;
            } else {
              barrierLevels.push({
                type: 'protection_barrier',
                level: protectionBarrier.level,
                actualLevel: protectionBarrier.level,
                label: `Protection Barrier ${protectionBarrier.level}%`,
                section: 'maturity',
                isFromEvaluationReport: true
              });
            }
          }
        }
      }
      
      // Generate evaluation traces for both sections
      const evaluationTraces = {};
      
      for (const sectionName of ['life', 'maturity']) {
        if (!compiledFormula.sections[sectionName]) continue;
        
        try {
          console.log(`Generating evaluation trace for ${sectionName}...`);
          
          const trace = {
            section: sectionName,
            evaluationDate: today.toISOString().split('T')[0],
            rules: [],
            marketVariables: {}
          };

          // Extract market variables used in this section
          const underlyings = compiledFormula.metadata?.underlyings || [];
          for (const underlying of underlyings) {
            if (marketData[underlying.symbol]) {
              const data = marketData[underlying.symbol];
              trace.marketVariables[underlying.symbol] = {
                symbol: underlying.symbol,
                name: data.name,
                initialPrice: data.strike,
                currentPrice: data.currentPrice,
                performance: data.performance,
                weight: data.weight
              };
            }
          }

          // Process each node to show the evaluation flow
          const section = compiledFormula.sections[sectionName];
          for (let nodeIndex = 0; nodeIndex < section.nodes.length; nodeIndex++) {
            const node = section.nodes[nodeIndex];
            const rule = {
              ruleNumber: nodeIndex + 1,
              logicType: node.logicType || 'CONDITION',
              conditions: [],
              actions: [],
              variables: {},
              executed: false,
              conditionsMet: false
            };

            // Extract variables used in this rule
            let barrierLevel = null;
            let underlyingSymbol = null;
            let comparisonOperator = null;

            // First pass: scan all evaluators to find barrier values from all sources
            for (const condEval of node.conditionEvaluators) {
              if (condEval.component) {
                // Check for barrier type components
                if (condEval.type === 'barrier' || condEval.type === 'american_barrier' || condEval.component.type === 'barrier') {
                  const level = parseFloat(condEval.component.value) || parseFloat(condEval.component.defaultValue);
                  if (!isNaN(level)) {
                    barrierLevel = level;
                  }
                }
                
                // Also check for any component with "barrier" in the label
                if (condEval.component.label && condEval.component.label.toLowerCase().includes('barrier')) {
                  const level = parseFloat(condEval.component.value) || parseFloat(condEval.component.defaultValue);
                  if (!isNaN(level)) {
                    barrierLevel = level;
                  }
                }
              }
            }

            // Set barrier variables if found (support different barrier types)
            if (barrierLevel !== null) {
              rule.variables[`barrier_level`] = barrierLevel;
              
              // Determine barrier type based on component analysis (generic detection)
              const barrierComponent = node.conditionEvaluators.find(evaluator => 
                evaluator.type === 'barrier' || evaluator.type === 'american_barrier' || evaluator.component?.type === 'barrier'
              );
              
              if (barrierComponent && barrierComponent.component) {
                const label = barrierComponent.component.label?.toLowerCase() || '';
                rule.variables[`debug_barrier_label`] = label || 'no_label';
                
                if (label.includes('protection')) {
                  rule.variables[`capital_protection_barrier`] = barrierLevel;
                  rule.variables[`debug_barrier_type`] = 'protection';
                } else if (label.includes('autocall')) {
                  rule.variables[`autocall_barrier`] = barrierLevel;
                  rule.variables[`debug_barrier_type`] = 'autocall';
                } else if (label.includes('coupon')) {
                  rule.variables[`coupon_barrier`] = barrierLevel;
                  rule.variables[`debug_barrier_type`] = 'coupon';
                } else {
                  // Default to protection barrier for reverse convertibles and similar products
                  rule.variables[`capital_protection_barrier`] = barrierLevel;
                  rule.variables[`debug_barrier_type`] = 'default_protection';
                }
              } else {
                rule.variables[`debug_barrier_type`] = 'no_barrier_component_found';
              }
            }

            // Process condition evaluators with market data
            for (const condEval of node.conditionEvaluators) {
              if (condEval.component) {
                const condition = {
                  type: condEval.type,
                  component: condEval.component.label || condEval.type,
                  details: []
                };

                // Extract variables - Get underlying symbol from product database
                if (condEval.type === 'basket' || condEval.type === 'underlying') {
                  // Primary method: Get underlying symbol from product data in database
                  if (product.underlyings && product.underlyings.length > 0) {
                    // Debug what's in the underlyings array
                    rule.variables[`debug_underlyings_structure`] = JSON.stringify(product.underlyings[0]);
                    // Fix: Use ticker property, not symbol
                    underlyingSymbol = product.underlyings[0].ticker || product.underlyings[0].securityData?.symbol;
                    rule.variables[`debug_symbol_source`] = 'from_product_db';
                  }
                  // Fallback: Try compiled formula metadata
                  else if (compiledFormula.metadata?.underlyings?.length > 0) {
                    underlyingSymbol = compiledFormula.metadata.underlyings[0].symbol;
                    rule.variables[`debug_symbol_source`] = 'from_metadata';
                  }
                  // Last resort: Try component properties
                  else {
                    underlyingSymbol = condEval.component.selectedSecurity?.symbol || 
                                     condEval.component.selectedSecurities?.[0]?.symbol ||
                                     condEval.component.symbol ||
                                     condEval.component.value;
                    rule.variables[`debug_symbol_source`] = 'from_component';
                  }
                  
                  rule.variables[`debug_underlying_symbol`] = underlyingSymbol || 'not_found';
                  rule.variables[`debug_market_data_available`] = underlyingSymbol && marketData[underlyingSymbol] ? 'yes' : 'no';
                  rule.variables[`debug_product_underlyings_count`] = product.underlyings?.length || 0;
                  
                  if (underlyingSymbol && marketData[underlyingSymbol]) {
                    const data = marketData[underlyingSymbol];
                    rule.variables[`${underlyingSymbol}_initial`] = data.strike;
                    rule.variables[`${underlyingSymbol}_current`] = data.currentPrice;
                    rule.variables[`${underlyingSymbol}_performance`] = data.performance;
                    
                    condition.details.push(`Variable: ${underlyingSymbol}_initial = ${data.strike}`);
                    condition.details.push(`Variable: ${underlyingSymbol}_current = ${data.currentPrice}`);
                    condition.details.push(`Variable: ${underlyingSymbol}_performance = ${data.performance?.toFixed(2)}%`);
                  } else {
                    rule.variables[`debug_no_market_data_reason`] = !underlyingSymbol ? 'no_symbol' : 'no_data';
                    if (underlyingSymbol) {
                      rule.variables[`debug_available_market_symbols`] = Object.keys(marketData).join(', ');
                    }
                  }
                }

                // Extract barrier level - check multiple barrier types
                if (condEval.type === 'barrier' || condEval.type === 'american_barrier' || condEval.component.type === 'barrier') {
                  // First check if we have actual barrier from evaluation report
                  if (useActualEvaluationData && compiledFormula.actualBarriers) {
                    const barrierType = condEval.component.label?.toLowerCase() || '';
                    const actualBarrier = compiledFormula.actualBarriers.find(b => 
                      (barrierType.includes('protection') && (b.type === 'protection' || b.type === 'capital_protection')) ||
                      (barrierType.includes('autocall') && b.type === 'autocall') ||
                      (barrierType.includes('coupon') && b.type === 'coupon')
                    );
                    
                    if (actualBarrier) {
                      barrierLevel = actualBarrier.level;
                      condition.details.push(`Variable: barrier_level = ${barrierLevel}% (from evaluation report)`);
                    }
                  }
                  
                  // Fallback to component value if no evaluation report data
                  if (barrierLevel === null) {
                    barrierLevel = parseFloat(condEval.component.value) || parseFloat(condEval.component.defaultValue);
                    if (!isNaN(barrierLevel)) {
                      condition.details.push(`Variable: barrier_level = ${barrierLevel}% (from component)`);
                    }
                  }
                  
                  if (!isNaN(barrierLevel)) {
                    rule.variables[`barrier_level`] = barrierLevel;
                  }
                }

                // Extract comparison operator
                if (condEval.type === 'comparison') {
                  comparisonOperator = condEval.component.label || condEval.component.operator;
                  rule.variables[`comparison_operator`] = comparisonOperator;
                  condition.details.push(`Variable: comparison_operator = "${comparisonOperator}"`);
                  
                  // Evaluate the condition with variables
                  rule.variables[`debug_condition_check`] = `underlying:${!!underlyingSymbol}, market_data:${!!(underlyingSymbol && marketData[underlyingSymbol])}, barrier:${barrierLevel !== null}, symbol:${underlyingSymbol || 'none'}`;
                  
                  if (underlyingSymbol && marketData[underlyingSymbol] && barrierLevel !== null) {
                    const performance = marketData[underlyingSymbol].performance;
                    let conditionMet = false;
                    
                    if (performance !== null && performance !== undefined) {
                      // Convert barrier level to actual threshold (e.g., 70% barrier = -30% performance threshold)
                      const actualThreshold = barrierLevel - 100;
                      const thresholdDisplay = actualThreshold >= 0 ? `+${actualThreshold}%` : `${actualThreshold}%`;
                      const performanceDisplay = performance >= 0 ? `+${performance.toFixed(2)}%` : `${performance.toFixed(2)}%`;
                      
                      if (comparisonOperator?.toLowerCase().includes('above')) {
                        conditionMet = performance >= actualThreshold;
                        
                        // Create detailed explanation
                        const explanation = conditionMet 
                          ? `Stock performance ${performanceDisplay} is above ${thresholdDisplay} threshold (${barrierLevel}% barrier) → Capital Protected`
                          : `Stock performance ${performanceDisplay} is below ${thresholdDisplay} threshold (${barrierLevel}% barrier) → Downside Exposure`;
                        
                        rule.variables[`condition_result`] = explanation;
                        rule.variables[`detailed_comparison`] = `${performanceDisplay} compared to ${thresholdDisplay} = ${conditionMet ? 'PROTECTED' : 'EXPOSED'}`;
                        
                      } else if (comparisonOperator?.toLowerCase().includes('below')) {
                        conditionMet = performance < actualThreshold;
                        
                        const explanation = conditionMet 
                          ? `Stock performance ${performanceDisplay} is below ${thresholdDisplay} threshold (${barrierLevel}% barrier) → Condition Met`
                          : `Stock performance ${performanceDisplay} is above ${thresholdDisplay} threshold (${barrierLevel}% barrier) → Condition Not Met`;
                        
                        rule.variables[`condition_result`] = explanation;
                        rule.variables[`detailed_comparison`] = `${performanceDisplay} compared to ${thresholdDisplay} = ${conditionMet ? 'MET' : 'NOT_MET'}`;
                      }
                      
                      condition.result = `${performanceDisplay} vs ${thresholdDisplay} threshold → ${conditionMet ? 'CONDITION MET' : 'CONDITION NOT MET'}`;
                      condition.status = conditionMet ? 'met' : 'not_met';
                      
                      // If this condition is met, the entire rule's conditions are met
                      if (conditionMet) {
                        rule.conditionsMet = true;
                      }
                      
                      // Add debug info to global variables
                      rule.variables[`debug_performance`] = performance;
                      rule.variables[`debug_barrier`] = barrierLevel;
                      rule.variables[`debug_condition_met`] = conditionMet;
                      rule.variables[`debug_underlying`] = underlyingSymbol;
                    } else {
                      condition.result = `Performance data unavailable for ${underlyingSymbol}`;
                      condition.status = 'unavailable';
                    }
                  }
                }

                rule.conditions.push(condition);
              }
            }

            // Process action evaluators
            for (const actionEval of node.actionEvaluators) {
              if (actionEval.component) {
                const action = {
                  type: actionEval.type,
                  component: actionEval.component.label || actionEval.type,
                  value: actionEval.component.value,
                  details: [],
                  calculatedValue: null
                };

                // Calculate action results with variables
                if (actionEval.component.label?.includes('Return 100%')) {
                  action.calculatedValue = 100;
                  action.details.push('Capital Protection: Return 100% of initial investment');
                  action.details.push('Explanation: Barrier condition met → investor receives full capital back');
                  rule.variables[`capital_return`] = 100;
                  rule.variables[`payoff_explanation`] = 'Capital protected due to barrier condition being met';
                } else if (actionEval.component.label?.includes('Downside Exposure')) {
                  if (underlyingSymbol && marketData[underlyingSymbol]) {
                    const performance = marketData[underlyingSymbol].performance;
                    const performanceDisplay = performance >= 0 ? `+${performance.toFixed(2)}%` : `${performance.toFixed(2)}%`;
                    const totalReturn = 100 + performance;
                    
                    action.calculatedValue = totalReturn;
                    action.details.push(`Downside Exposure: 100% + ${performanceDisplay} = ${totalReturn.toFixed(2)}%`);
                    action.details.push(`Explanation: Barrier breached → investor exposed to ${underlyingSymbol} performance`);
                    rule.variables[`capital_return`] = totalReturn;
                    rule.variables[`payoff_explanation`] = `Exposed to ${underlyingSymbol} performance (${performanceDisplay})`;
                  }
                } else if (actionEval.component.label?.includes('Coupon')) {
                  const couponRate = parseFloat(actionEval.component.value || actionEval.component.defaultValue || 0);
                  action.calculatedValue = couponRate;
                  action.details.push(`Coupon Payment: ${couponRate}% of notional amount`);
                  action.details.push(`Explanation: Fixed coupon payment regardless of underlying performance`);
                  rule.variables[`coupon_rate`] = couponRate;
                  rule.variables[`coupon_explanation`] = `Unconditional ${couponRate}% coupon payment`;
                }

                rule.actions.push(action);
              }
            }

            // Determine if this rule was executed
            if (node.logicType === 'IF' || node.logicType === 'ELSE_IF') {
              rule.executed = rule.conditionsMet;
              rule.variables[`debug_rule_type`] = 'IF';
              rule.variables[`debug_conditions_met`] = rule.conditionsMet;
            } else if (node.logicType === 'ELSE') {
              // ELSE executes only if the immediately preceding IF/ELSE_IF was not executed
              const previousRule = trace.rules[trace.rules.length - 1]; // Last rule added
              const previousIfExecuted = previousRule?.executed || false;
              rule.executed = !previousIfExecuted;
              rule.conditionsMet = !previousIfExecuted; // ELSE conditions are met when IF was not
              rule.variables[`debug_rule_type`] = 'ELSE';
              rule.variables[`debug_previous_if_executed`] = previousIfExecuted;
            } else {
              // No logic operator, assume it executes
              rule.executed = true;
              rule.conditionsMet = true;
              rule.variables[`debug_rule_type`] = 'NO_LOGIC';
            }

            // Add final debug info
            rule.variables[`debug_final_executed`] = rule.executed;
            rule.variables[`debug_final_conditions_met`] = rule.conditionsMet;
            
            trace.rules.push(rule);
          }

          // Collect global variables used across all rules in this section
          const globalVariables = {};
          for (const rule of trace.rules) {
            Object.assign(globalVariables, rule.variables);
          }
          
          // Add market data variables for all underlyings to show current state
          for (const underlying of compiledFormula.metadata?.underlyings || []) {
            const data = marketData[underlying.symbol];
            if (data) {
              globalVariables[`${underlying.symbol}_initial`] = data.strike;
              globalVariables[`${underlying.symbol}_current`] = data.currentPrice;
              globalVariables[`${underlying.symbol}_performance`] = data.performance;
              
              // Add debug info for market data
              globalVariables[`debug_${underlying.symbol}_found`] = true;
              globalVariables[`debug_${underlying.symbol}_has_performance`] = data.performance !== null && data.performance !== undefined;
            } else {
              globalVariables[`debug_${underlying.symbol}_found`] = false;
            }
          }
          
          // Add common default variables if not present (generic logic only)
          if (!globalVariables.capital_return && globalVariables.coupon_rate) {
            globalVariables.capital_return = 100; // Default capital protection
          }
          if (globalVariables.barrier_level && !globalVariables.comparison_operator) {
            globalVariables.comparison_operator = "At or Above"; // Default comparison for barriers
          }
          
          trace.globalVariables = globalVariables;

          evaluationTraces[sectionName] = trace;

        } catch (traceError) {
          console.log(`Could not generate evaluation trace for ${sectionName}:`, traceError.message);
          evaluationTraces[sectionName] = {
            error: traceError.message,
            section: sectionName,
            evaluationDate: today.toISOString().split('T')[0]
          };
        }
      }

      // Rule engine removed: skip evaluation traces and component execution
      const componentExecutionTrace = null;

      // Execute a test evaluation to generate execution log
      let executionLog = [];
      try {
        // Create a test context for the maturity section
        executionLog = [];
        
      } catch (execError) {
        console.log('Could not generate execution log:', execError.message);
      }
      
      // Generate observation date traces for each observation date
      let observationDateTraces = [];
      try {
        console.log('Generating observation date traces for debugger...');
        
        // Get observation dates from product
        const observationDates = cleanProduct.observationDates || [];
        console.log(`Product has ${observationDates.length} observation dates`);
        
        // For each observation date, simulate evaluation
        for (let i = 0; i < observationDates.length; i++) {
          const obsDate = observationDates[i];
          // Rule engine removed: skip observation evaluation
          
          console.log(`\nEvaluating observation date ${i + 1}/${observationDates.length}: ${obsDate}`);
          
          // Reset context for this observation
          observationContext.setVariable('observationIndex', i);
          observationContext.setVariable('totalObservations', observationDates.length);
          observationContext.setVariable('memoryPaidThisCycle', false);
          
          // Create trace structure
          const trace = {
            observationIndex: i + 1,
            totalObservations: observationDates.length,
            date: obsDate,
            contextDate: new Date(obsDate).toISOString(),
            observationCount: i,
            marketData: {},
            barrierLevels: barrierLevels,
            componentExecutions: [],
            ruleEvaluations: []
          };
          
          // Get market data for each underlying at this observation date
          for (const underlying of underlyings) {
            const symbol = underlying.ticker || underlying.symbol;
            if (symbol) {
              try {
                const price = await priceService.getPrice(symbol, obsDate);
                const strike = underlying.strikePrice || underlying.strike || 100;
                const performance = ((price - strike) / strike) * 100;
                
                trace.marketData[symbol] = {
                  symbol: symbol,
                  currentPrice: price,
                  strikePrice: strike,
                  performance: performance
                };
              } catch (err) {
                console.log(`Could not get price for ${symbol} on ${obsDate}:`, err.message);
              }
            }
          }
          
          // Evaluate life section for this observation date
          // Skipped detailed evaluation
          
          observationDateTraces.push(trace);
          
          // If product was autocalled, stop evaluating further dates
          if (trace.postEvaluationState && trace.postEvaluationState.autocalled) {
            console.log(`Product autocalled on observation ${i + 1}, stopping evaluation`);
            break;
          }
        }
        
        console.log(`Generated ${observationDateTraces.length} observation date traces`);
        
      } catch (traceError) {
        console.error('Error generating observation date traces:', traceError);
      }
      
      // Return a serializable version of the compiled formula for debugging
      const debugData = {
        productId: product._id,
        compiledAt: null,
        metadata: null,
        sections: {},
        memoryBucket: null,
        evaluationTraces: evaluationTraces,
        observationDateTraces: observationDateTraces, // Add observation date traces
        marketData: marketData, // Add market data for visualization
        productInfo: {
          title: product.title,
          tradeDate: cleanProduct.tradeDate,
          maturityDate: cleanProduct.maturityDate,
          currency: product.currency,
          observationDates: cleanProduct.observationDates
        },
        // Add actual evaluation data if available
        actualEvaluationData: useActualEvaluationData ? actualEvaluationData : null,
        actualBarriers: compiledFormula.actualBarriers || null,
        isUsingEvaluationReport: useActualEvaluationData,
        barrierLevels: barrierLevels, // Include extracted barrier levels
        executionLog: executionLog, // Add the execution log
        componentExecutionTrace: componentExecutionTrace // Add detailed component trace
      };

      // Serialize sections for debugging
      // Sections removed

      // Save the execution trace to the product document for persistent debugging
      try {
        await ProductsCollection.updateAsync(productId, {
          $set: {
            debugExecutionTrace: {
              executionLog: executionLog,
              evaluationTraces: evaluationTraces,
              observationDateTraces: observationDateTraces, // Add observation date traces
              marketData: marketData,
              barrierLevels: barrierLevels,
              actualEvaluationData: actualEvaluationData,
              timestamp: new Date()
            }
          }
        });
        console.log('Saved execution trace to product document');
      } catch (saveError) {
        console.log('Could not save execution trace to database:', saveError.message);
      }

      return debugData;
      
    } catch (error) {
      console.error('Error compiling formula for debug:', error);
      throw new Meteor.Error('compilation-failed', `Failed to compile formula: ${error.message}`);
    }
  },

  async 'allocations.create'({ productId, allocations, sessionId }) {
    check(productId, String);
    check(allocations, [{
      clientId: String,
      bankAccountId: String,
      nominalInvested: Number,
      purchasePrice: Number
    }]);
    check(sessionId, String);

    // Validate session and get user
    const user = await validateSessionAndGetUser(sessionId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to create allocations');
    }

    // Only admins and superadmins can create allocations
    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only administrators can create allocations');
    }

    // Validate product exists
    const product = await ProductsCollection.findOneAsync(productId);
    if (!product) {
      throw new Meteor.Error('product-not-found', 'Product not found');
    }

    // AllocationsCollection is already imported at the top

    try {
      const allocationIds = [];
      
      for (const allocation of allocations) {
        // Validate client exists and is a client
        const client = await UsersCollection.findOneAsync(allocation.clientId);
        if (!client || client.role !== USER_ROLES.CLIENT) {
          throw new Meteor.Error('invalid-client', `Invalid client ID: ${allocation.clientId}`);
        }

        // Validate bank account exists and belongs to client
        const bankAccount = await BankAccountsCollection.findOneAsync({
          _id: allocation.bankAccountId,
          userId: allocation.clientId,
          isActive: true
        });
        if (!bankAccount) {
          throw new Meteor.Error('invalid-bank-account', `Invalid bank account for client: ${allocation.clientId}`);
        }

        // Create allocation
        const allocationId = await AllocationsCollection.insertAsync({
          productId,
          clientId: allocation.clientId,
          bankAccountId: allocation.bankAccountId,
          nominalInvested: allocation.nominalInvested,
          purchasePrice: allocation.purchasePrice,
          allocatedAt: new Date(),
          allocatedBy: user._id,
          status: 'active',
          // PMS Holdings linking fields
          linkedHoldingIds: [],
          holdingsSyncedAt: null,
          isin: product.isin || null
        });

        allocationIds.push(allocationId);
      }

      return { success: true, allocationIds };
    } catch (error) {
      throw new Meteor.Error('allocation-failed', `Failed to create allocations: ${error.message}`);
    }
  },

  async 'allocations.update'({ allocationId, updates, sessionId }) {
    check(allocationId, String);
    check(updates, Object);
    check(sessionId, String);

    // Validate session and get user
    const user = await validateSessionAndGetUser(sessionId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to update allocations');
    }

    // Only admins and superadmins can update allocations
    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only administrators can update allocations');
    }

    // Validate allocation exists
    const allocation = await AllocationsCollection.findOneAsync(allocationId);
    if (!allocation) {
      throw new Meteor.Error('allocation-not-found', 'Allocation not found');
    }

    try {
      const updateData = {
        lastModifiedAt: new Date(),
        lastModifiedBy: user._id
      };

      // Validate and add nominalInvested if provided
      if (updates.nominalInvested !== undefined) {
        check(updates.nominalInvested, Number);
        if (updates.nominalInvested <= 0) {
          throw new Meteor.Error('invalid-nominal', 'Nominal invested must be greater than 0');
        }
        updateData.nominalInvested = updates.nominalInvested;
      }

      // Validate and add purchasePrice if provided
      if (updates.purchasePrice !== undefined) {
        check(updates.purchasePrice, Number);
        if (updates.purchasePrice <= 0) {
          throw new Meteor.Error('invalid-price', 'Purchase price must be greater than 0');
        }
        updateData.purchasePrice = updates.purchasePrice;
      }

      // Validate and add clientId if provided
      if (updates.clientId !== undefined) {
        check(updates.clientId, String);
        const client = await UsersCollection.findOneAsync(updates.clientId);
        if (!client || client.role !== USER_ROLES.CLIENT) {
          throw new Meteor.Error('invalid-client', 'Invalid client ID');
        }
        updateData.clientId = updates.clientId;
      }

      // Validate and add bankAccountId if provided
      if (updates.bankAccountId !== undefined) {
        check(updates.bankAccountId, String);
        // Use the new clientId if provided, otherwise use existing
        const clientId = updates.clientId || allocation.clientId;
        const bankAccount = await BankAccountsCollection.findOneAsync({
          _id: updates.bankAccountId,
          userId: clientId,
          isActive: true
        });
        if (!bankAccount) {
          throw new Meteor.Error('invalid-bank-account', 'Invalid bank account for client');
        }
        updateData.bankAccountId = updates.bankAccountId;
      }

      // Update the allocation
      const result = await AllocationsCollection.updateAsync(
        { _id: allocationId },
        { $set: updateData }
      );

      return { success: true, modifiedCount: result };
    } catch (error) {
      throw new Meteor.Error('update-failed', `Failed to update allocation: ${error.message}`);
    }
  },

  async 'allocations.delete'({ allocationId, sessionId }) {
    check(allocationId, String);
    check(sessionId, String);

    // Validate session and get user
    const user = await validateSessionAndGetUser(sessionId);
    if (!user) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to delete allocations');
    }

    // Only admins and superadmins can delete allocations
    if (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('not-authorized', 'Only administrators can delete allocations');
    }

    // Validate allocation exists
    const allocation = await AllocationsCollection.findOneAsync(allocationId);
    if (!allocation) {
      throw new Meteor.Error('allocation-not-found', 'Allocation not found');
    }

    try {
      // Delete the allocation
      const result = await AllocationsCollection.removeAsync({ _id: allocationId });

      return { success: true, deletedCount: result };
    } catch (error) {
      throw new Meteor.Error('delete-failed', `Failed to delete allocation: ${error.message}`);
    }
  },

  // Assign a client to a relationship manager
  async 'users.assignRM'({ clientUserId, rmUserId, sessionId }) {
    check(clientUserId, String);
    check(rmUserId, String);
    check(sessionId, String);

    // Validate session and get admin/superadmin user
    const session = await SessionHelpers.validateSession(sessionId);
    if (!session) {
      throw new Meteor.Error('invalid-session', 'Invalid session');
    }

    const currentUser = await UsersCollection.findOneAsync(session.userId);
    if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
      throw new Meteor.Error('access-denied', 'Only admin or superadmin can assign relationship managers');
    }

    try {
      // Verify the RM user exists and has the correct role (RM, admin, or superadmin)
      const rmUser = await UsersCollection.findOneAsync({
        _id: rmUserId,
        role: { $in: [USER_ROLES.RELATIONSHIP_MANAGER, USER_ROLES.ADMIN, USER_ROLES.SUPERADMIN] }
      });
      if (!rmUser) {
        throw new Meteor.Error('invalid-rm', 'Invalid relationship manager (must be RM, admin, or superadmin)');
      }

      // Verify the client exists and has the correct role
      const clientUser = await UsersCollection.findOneAsync({ _id: clientUserId, role: USER_ROLES.CLIENT });
      if (!clientUser) {
        throw new Meteor.Error('invalid-client', 'Invalid client');
      }

      // Update the client with the RM assignment
      const result = await UsersCollection.updateAsync(
        { _id: clientUserId },
        { $set: { relationshipManagerId: rmUserId } }
      );

      console.log(`Assigned client ${clientUserId} to RM ${rmUserId} (${rmUser.role})`);
      return { success: true, updated: result };
    } catch (error) {
      throw new Meteor.Error('assignment-failed', `Failed to assign relationship manager: ${error.message}`);
    }
  }
});

/*** PORTFOLIO METHODS ***/

// Helper function to check portfolio access permissions
const checkPortfolioAccess = async (portfolioId, currentUser) => {
  const portfolio = await PortfolioCollection.findOneAsync(portfolioId);
  if (!portfolio) {
    throw new Meteor.Error('not-found', 'Portfolio not found');
  }

  let hasAccess = false;
  switch (currentUser.role) {
    case USER_ROLES.SUPERADMIN:
    case USER_ROLES.ADMIN:
      hasAccess = true;
      break;
    case USER_ROLES.RELATIONSHIP_MANAGER:
      const portfolioOwner = await UsersCollection.findOneAsync(portfolio.userId);
      hasAccess = portfolioOwner && (
        portfolioOwner.relationshipManagerId === currentUser._id || 
        portfolio.userId === currentUser._id
      );
      break;
    case USER_ROLES.CLIENT:
      hasAccess = portfolio.userId === currentUser._id;
      break;
  }

  if (!hasAccess) {
    throw new Meteor.Error('access-denied', 'Access denied to this portfolio');
  }

  return portfolio;
};

// Bank account access check helper
const checkBankAccountAccess = async (bankAccountId, currentUser) => {
  const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
  if (!bankAccount) {
    throw new Meteor.Error('not-found', 'Bank account not found');
  }

  let hasAccess = false;
  
  // Role-based access control similar to products
  switch (currentUser.role) {
    case USER_ROLES.SUPERADMIN:
    case USER_ROLES.ADMIN:
      hasAccess = true; // Admins can access all bank accounts
      break;
      
    case USER_ROLES.RELATIONSHIP_MANAGER:
      // RMs can access their own bank accounts and their clients' bank accounts
      if (bankAccount.userId === currentUser._id) {
        hasAccess = true;
      } else {
        const bankAccountOwner = await UsersCollection.findOneAsync(bankAccount.userId);
        hasAccess = bankAccountOwner && 
          bankAccountOwner.role === USER_ROLES.CLIENT && 
          bankAccountOwner.relationshipManagerId === currentUser._id;
      }
      break;
      
    case USER_ROLES.CLIENT:
    default:
      hasAccess = bankAccount.userId === currentUser._id;
      break;
  }

  if (!hasAccess) {
    throw new Meteor.Error('access-denied', 'Access denied to this bank account');
  }

  return bankAccount;
};

// Equity Holdings server methods
Meteor.methods({
  async 'equityHoldings.add'(bankAccountId, stockData, transactionData, sessionId = null) {
    check(bankAccountId, String);
    check(stockData, Object);
    check(transactionData, Object);
    check(sessionId, Match.Optional(String));
    
    // Debug logging to identify validation issues
    console.log('equityHoldings.add called with:', {
      bankAccountId,
      stockData,
      transactionData,
      sessionId: sessionId ? 'provided' : 'null'
    });
    
    // Get current user and verify access (prioritize session over userId)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to add holding');
    }

    // Verify bank account access
    const bankAccount = await checkBankAccountAccess(bankAccountId, currentUser);
    
    try {
      const holdingId = await EquityHoldingsHelpers.addHolding(
        bankAccountId, 
        bankAccount.userId, 
        bankAccount.accountNumber,
        stockData, 
        transactionData
      );
      
      console.log('equityHoldings.add successful, holdingId:', holdingId);
      return holdingId;
    } catch (error) {
      console.error('equityHoldings.add failed:', error.message);
      console.error('Failed stockData:', stockData);
      console.error('Failed transactionData:', transactionData);
      throw error;
    }
  },
  
  async 'equityHoldings.remove'(holdingId, sessionId = null) {
    check(holdingId, String);
    check(sessionId, Match.Optional(String));
    
    // Get current user (prioritize session over userId)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to remove holding');
    }

    // Get holding and verify access to its bank account
    const holding = await EquityHoldingsCollection.findOneAsync(holdingId);
    if (!holding) {
      throw new Meteor.Error('not-found', 'Holding not found');
    }

    await checkBankAccountAccess(holding.bankAccountId, currentUser);
    
    return await EquityHoldingsHelpers.removeHolding(holdingId, holding.userId);
  },
  
  async 'equityHoldings.sellShares'(holdingId, quantity, price, fees = 0, date = new Date(), notes = '', sessionId = null) {
    check(holdingId, String);
    check(quantity, Number);
    check(price, Number);
    check(fees, Number);
    check(date, Date);
    check(notes, String);
    check(sessionId, Match.Optional(String));
    
    // Get current user (prioritize session over userId)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to sell shares');
    }

    // Get holding and verify access to its bank account
    const holding = await EquityHoldingsCollection.findOneAsync(holdingId);
    if (!holding) {
      throw new Meteor.Error('not-found', 'Holding not found');
    }

    await checkBankAccountAccess(holding.bankAccountId, currentUser);
    
    return await EquityHoldingsHelpers.sellShares(holdingId, holding.userId, quantity, price, fees, date, notes);
  },

  async 'equityHoldings.updatePosition'(holdingId, updates, sessionId = null) {
    check(holdingId, String);
    check(updates, Object);
    check(sessionId, Match.Optional(String));
    
    // Get current user (prioritize session over userId)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to update position');
    }

    // Get holding and verify access to its bank account
    const holding = await EquityHoldingsCollection.findOneAsync(holdingId);
    if (!holding) {
      throw new Meteor.Error('not-found', 'Holding not found');
    }

    await checkBankAccountAccess(holding.bankAccountId, currentUser);
    
    // Prepare update data
    const updateData = {};
    
    if (updates.quantity !== undefined) {
      check(updates.quantity, Number);
      if (updates.quantity <= 0) {
        throw new Meteor.Error('invalid-quantity', 'Quantity must be greater than 0');
      }
      updateData.quantity = updates.quantity;
    }
    
    if (updates.averagePrice !== undefined) {
      check(updates.averagePrice, Number);
      if (updates.averagePrice <= 0) {
        throw new Meteor.Error('invalid-price', 'Average price must be greater than 0');
      }
      updateData.averagePrice = updates.averagePrice;
    }

    // Recalculate dependent values
    const quantity = updateData.quantity || holding.quantity;
    const averagePrice = updateData.averagePrice || holding.averagePrice;
    const currentPrice = holding.currentPrice || averagePrice;
    
    updateData.totalCost = quantity * averagePrice;
    updateData.currentValue = quantity * currentPrice;
    updateData.totalReturn = updateData.currentValue - updateData.totalCost;
    updateData.totalReturnPercent = ((updateData.currentValue / updateData.totalCost) - 1) * 100;
    updateData.updatedAt = new Date();
    
    // Update the holding
    const result = await EquityHoldingsCollection.updateAsync(holdingId, {
      $set: updateData
    });
    
    console.log(`Updated equity holding ${holdingId}:`, {
      quantity: updateData.quantity || holding.quantity,
      averagePrice: updateData.averagePrice || holding.averagePrice,
      totalCost: updateData.totalCost,
      currentValue: updateData.currentValue
    });
    
    return result;
  },

  async 'equityHoldings.migrateFxRates'(sessionId = null) {
    // Get current user (prioritize session over userId)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
      throw new Meteor.Error('not-authorized', 'Admin privileges required for FX rate migration');
    }

    console.log('🔄 Starting FX rate migration for all equity holdings...');
    await EquityHoldingsHelpers.migrateAllHoldingsFxRates();
    return { success: true, message: 'FX rate migration completed' };
  },

  async 'equityHoldings.getFxRate'(fromCurrency, toCurrency, sessionId = null) {
    check(fromCurrency, String);
    check(toCurrency, String);
    check(sessionId, Match.Optional(String));
    
    // Get current user (optional, FX rates are generally public data)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : null;

    console.log(`Getting FX rate: ${fromCurrency} → ${toCurrency}`);
    
    try {
      const fxRateData = await EquityHoldingsHelpers.getFxRateWithMetadata(fromCurrency, toCurrency);
      return fxRateData;
    } catch (error) {
      console.error('Error getting FX rate:', error);
      throw new Meteor.Error('fx-rate-error', 'Failed to get FX rate: ' + error.message);
    }
  },
  
  async 'equityHoldings.updatePrices'(bankAccountId, sessionId = null) {
    check(bankAccountId, String);
    check(sessionId, Match.Optional(String));
    
    // Get current user (prioritize session over userId)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to update prices');
    }

    // Verify bank account access
    const bankAccount = await checkBankAccountAccess(bankAccountId, currentUser);
    
    // Ensure currency rates are fresh for conversion
    try {
      await CurrencyCache.getMainCurrencyRates();
      console.log('Currency rates refreshed for price updates');
    } catch (error) {
      console.warn('Failed to refresh currency rates:', error.message);
    }
    
    // Get holdings for this bank account
    const holdings = await EquityHoldingsHelpers.getBankAccountHoldings(bankAccountId, bankAccount.userId);
    // console.log(`Found ${holdings.length} holdings to update prices for bank account ${bankAccountId}`);
    
    const tickers = holdings.map(h => h.fullTicker).filter(Boolean);
    
    if (tickers.length === 0) {
      console.log('No tickers found to update');
      return { updated: 0 };
    }
    
    const priceData = await MarketDataHelpers.getBatchPrices(tickers);
    
    await EquityHoldingsHelpers.updatePrices(bankAccountId, bankAccount.userId, priceData);
    
    return { updated: tickers.length };
  },

  // Batch update prices for all accounts at once - more efficient for admin users
  async 'equityHoldings.batchUpdateAllPrices'(tickers, sessionId = null) {
    check(tickers, [String]);
    check(sessionId, Match.Optional(String));
    
    // Get current user (prioritize session over userId)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to update prices');
    }
    
    // Only admins can perform batch updates across all accounts
    if (!currentUser.role || (currentUser.role !== 'admin' && currentUser.role !== 'superadmin')) {
      throw new Meteor.Error('access-denied', 'Admin access required for batch price updates');
    }
    
    console.log(`Starting batch price update for ${tickers.length} unique tickers`);
    
    try {
      // Ensure currency rates are fresh for conversion
      try {
        await CurrencyCache.getMainCurrencyRates();
        console.log('Currency rates refreshed for batch price updates');
      } catch (error) {
        console.warn('Failed to refresh currency rates:', error.message);
      }
      
      // Get price data for all unique tickers in one batch call
      const priceData = await MarketDataHelpers.getBatchPrices(tickers);
      console.log(`Retrieved price data for ${Object.keys(priceData).length} tickers`);
      
      // Get all holdings that need updating
      const allHoldings = await EquityHoldingsCollection.find({
        fullTicker: { $in: tickers }
      }).fetchAsync();
      
      // Group holdings by bank account for efficient updates
      const holdingsByAccount = allHoldings.reduce((acc, holding) => {
        if (!acc[holding.bankAccountId]) {
          acc[holding.bankAccountId] = [];
        }
        acc[holding.bankAccountId].push(holding);
        return acc;
      }, {});
      
      // Update prices for each account
      let updatedAccounts = 0;
      let updatedHoldings = 0;
      
      for (const [bankAccountId, accountHoldings] of Object.entries(holdingsByAccount)) {
        try {
          // Get the bank account owner
          const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
          if (bankAccount) {
            console.log(`Batch update: Processing account ${bankAccount.accountNumber} (${bankAccount.referenceCurrency}) with ${accountHoldings.length} holdings`);
            await EquityHoldingsHelpers.updatePrices(bankAccountId, bankAccount.userId, priceData);
            updatedAccounts++;
            updatedHoldings += accountHoldings.length;
            console.log(`Batch update: Completed account ${bankAccount.accountNumber}`);
          }
        } catch (error) {
          console.error(`Error updating prices for account ${bankAccountId}:`, error);
        }
      }
      
      console.log(`Batch update completed: ${updatedAccounts} accounts, ${updatedHoldings} holdings`);
      
      return {
        success: true,
        updatedAccounts,
        updatedHoldings,
        tickersProcessed: Object.keys(priceData).length
      };
      
    } catch (error) {
      console.error('Batch price update failed:', error);
      throw new Meteor.Error('batch-update-failed', `Batch price update failed: ${error.message}`);
    }
  },
  
  async 'equityHoldings.getCurrentPrice'(fullTicker, sessionId = null) {
    check(fullTicker, String);
    check(sessionId, Match.Optional(String));
    
    // Get current user with session-based authentication (prioritize session over userId)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to get current price');
    }
    
    return await MarketDataHelpers.getCurrentPrice(fullTicker);
  },

  // CSV Upload method for bulk equity holdings
  async 'equityHoldings.uploadCsv'(bankAccountId, csvData, sessionId = null) {
    check(bankAccountId, String);
    check(csvData, [Object]);
    check(sessionId, Match.Optional(String));
    
    console.log('equityHoldings.uploadCsv called with:', {
      bankAccountId,
      recordCount: csvData.length,
      sessionId: sessionId ? 'provided' : 'null'
    });
    
    // Get current user and verify access
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to upload holdings');
    }

    // Verify bank account access
    const bankAccount = await checkBankAccountAccess(bankAccountId, currentUser);
    
    const stats = {
      processed: 0,
      added: 0,
      updated: 0,
      errors: 0,
      errorDetails: []
    };
    
    try {
      // Process each CSV row
      for (const row of csvData) {
        stats.processed++;
        
        try {
          // Validate required fields
          if (!row.isin || !row.quantity || !row.currency || !row.purchasePrice) {
            stats.errors++;
            stats.errorDetails.push({
              row: stats.processed,
              error: 'Missing required fields (ISIN, quantity, currency, or price)'
            });
            continue;
          }
          
          if (row.quantity <= 0 || row.purchasePrice <= 0) {
            stats.errors++;
            stats.errorDetails.push({
              row: stats.processed,
              error: 'Quantity and price must be positive numbers'
            });
            continue;
          }
          
          // Check if holding already exists for this ISIN
          const existingHolding = await EquityHoldingsCollection.findOneAsync({
            bankAccountId: bankAccountId,
            userId: bankAccount.userId,
            isin: row.isin
          });
          
          if (existingHolding) {
            // Update existing holding by adding to position
            const newQuantity = existingHolding.quantity + row.quantity;
            const newTotalCost = existingHolding.totalCost + (row.quantity * row.purchasePrice);
            const newAveragePrice = newTotalCost / newQuantity;
            
            await EquityHoldingsCollection.updateAsync(existingHolding._id, {
              $set: {
                quantity: newQuantity,
                averagePrice: newAveragePrice,
                totalCost: newTotalCost,
                lastUpdated: new Date()
              }
            });
            
            stats.updated++;
            console.log(`Updated existing holding for ${row.isin}: +${row.quantity} shares`);
          } else {
            // Create new holding
            const stockData = {
              symbol: row.isin.substring(0, 4), // Extract basic symbol from ISIN
              isin: row.isin,
              name: `Stock ${row.isin}`, // Will be updated when price data is fetched
              fullTicker: row.isin, // Use ISIN as ticker for now
              currency: row.currency
            };
            
            const transactionData = {
              transactionType: 'buy',
              quantity: row.quantity,
              price: row.purchasePrice,
              fees: 0,
              date: new Date(),
              notes: 'Imported from CSV upload'
            };
            
            const holdingId = await EquityHoldingsHelpers.addHolding(
              bankAccount.userId,
              bankAccountId,
              bankAccount.accountNumber,
              stockData,
              transactionData
            );
            
            stats.added++;
            console.log(`Added new holding for ${row.isin}: ${row.quantity} shares at ${row.currency} ${row.purchasePrice}`);
          }
          
        } catch (error) {
          console.error(`Error processing CSV row ${stats.processed}:`, error);
          stats.errors++;
          stats.errorDetails.push({
            row: stats.processed,
            error: error.message || 'Unknown processing error'
          });
        }
      }
      
      console.log('CSV upload completed:', stats);
      
      return {
        success: true,
        message: `Successfully processed ${stats.processed} rows`,
        stats: stats
      };
      
    } catch (error) {
      console.error('CSV upload failed:', error.message);
      throw new Meteor.Error('csv-upload-failed', `CSV upload failed: ${error.message}`);
    }
  },

  // Debug method to check currency rates
  async 'debug.checkCurrencyRates'() {
    try {
      const stats = await CurrencyCache.getCacheStats();
      const rates = await CurrencyCache.getMainCurrencyRates();
      
      // Get all cached pairs
      const { CurrencyRateCacheCollection } = await import('/imports/api/currencyCache');
      const allRates = await CurrencyRateCacheCollection.find({}).fetchAsync();
      
      return {
        stats,
        rates,
        allCachedPairs: allRates.map(r => ({ pair: r.pair, rate: r.rate, lastUpdated: r.lastUpdated }))
      };
    } catch (error) {
      console.error('Error checking currency rates:', error);
      throw new Meteor.Error('currency-check-failed', error.message);
    }
  },

  // Test currency conversion method
  async 'debug.testCurrencyConversion'(amount, fromCurrency, toCurrency) {
    check(amount, Number);
    check(fromCurrency, String);
    check(toCurrency, String);
    
    try {
      console.log(`Testing conversion of ${amount} ${fromCurrency} to ${toCurrency}`);
      
      // Test using EquityHoldingsHelpers.convertCurrency
      const result = await EquityHoldingsHelpers.convertCurrency(amount, fromCurrency, toCurrency);
      
      // Also get raw cache data
      const directPair = `${fromCurrency}${toCurrency}.FOREX`;
      const inversePair = `${toCurrency}${fromCurrency}.FOREX`;
      
      const { CurrencyRateCacheCollection } = await import('/imports/api/currencyCache');
      const directRate = await CurrencyRateCacheCollection.findOneAsync({ pair: directPair });
      const inverseRate = await CurrencyRateCacheCollection.findOneAsync({ pair: inversePair });
      
      return {
        input: { amount, fromCurrency, toCurrency },
        result: result,
        conversionWorked: result !== amount,
        directPair: directPair,
        inversePair: inversePair,
        directRateFound: directRate ? { pair: directRate.pair, rate: directRate.rate } : null,
        inverseRateFound: inverseRate ? { pair: inverseRate.pair, rate: inverseRate.rate } : null
      };
    } catch (error) {
      console.error('Error testing currency conversion:', error);
      throw new Meteor.Error('conversion-test-failed', error.message);
    }
  },

  // Force refresh currency cache
  async 'debug.refreshCurrencyCache'() {
    try {
      console.log('Force refreshing currency cache...');
      
      // Force refresh of main currency pairs
      const result = await CurrencyCache.refreshCurrencyRates();
      
      // Get updated stats
      const stats = await CurrencyCache.getCacheStats();
      
      return {
        refreshResult: result,
        stats: stats
      };
    } catch (error) {
      console.error('Error refreshing currency cache:', error);
      throw new Meteor.Error('currency-refresh-failed', error.message);
    }
  },

  // Debug method to diagnose currency conversion issue
  async 'debug.diagnoseCurrencyIssue'(sessionId) {
    check(sessionId, Match.Optional(String));
    
    try {
      // Get current user
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'Must be logged in');
      }

      const { BankAccountsCollection } = await import('/imports/api/bankAccounts');
      const { EquityHoldingsCollection } = await import('/imports/api/equityHoldings');
      const { CurrencyRateCacheCollection } = await import('/imports/api/currencyCache');

      // 1. Check bank accounts and their reference currencies - match publication logic
      const { USER_ROLES } = await import('/imports/api/users');
      let bankAccountQuery = {};

      switch (currentUser.role) {
        case USER_ROLES.SUPERADMIN:
        case USER_ROLES.ADMIN:
          // Admins can see all bank accounts
          bankAccountQuery = { isActive: true };
          console.log(`Admin diagnosis: checking all accounts`);
          break;
          
        case USER_ROLES.RELATIONSHIP_MANAGER:
          // RMs can see bank accounts of their assigned clients + their own
          const rmClients = await UsersCollection.find({ 
            relationshipManagerId: currentUser._id,
            role: USER_ROLES.CLIENT 
          }).fetchAsync();
          
          const clientUserIds = rmClients.map(client => client._id);
          clientUserIds.push(currentUser._id); // Include RM's own accounts
          
          bankAccountQuery = {
            userId: { $in: clientUserIds },
            isActive: true
          };
          console.log(`RM diagnosis: checking accounts for ${clientUserIds.length} users`);
          break;
          
        case USER_ROLES.CLIENT:
        default:
          // Clients can only see their own bank accounts
          bankAccountQuery = {
            userId: currentUser._id,
            isActive: true
          };
          console.log(`Client diagnosis: checking user's own accounts`);
          break;
      }

      const bankAccounts = await BankAccountsCollection.find(bankAccountQuery).fetchAsync();
      console.log(`Found ${bankAccounts.length} bank accounts matching role-based query`);

      // 2. Get all equity holdings for these accounts
      const allHoldings = [];
      for (const account of bankAccounts) {
        // For admin/RM roles, get all holdings for each account
        // For clients, only get their own holdings
        const holdingsQuery = (currentUser.role === USER_ROLES.ADMIN || 
                              currentUser.role === USER_ROLES.SUPERADMIN || 
                              currentUser.role === USER_ROLES.RELATIONSHIP_MANAGER) ?
          { bankAccountId: account._id } :
          { bankAccountId: account._id, userId: currentUser._id };
          
        const holdings = await EquityHoldingsCollection.find(holdingsQuery).fetchAsync();
        
        allHoldings.push({
          account: account,
          holdings: holdings.map(h => ({
            symbol: h.symbol,
            currentValue: h.currentValue,
            currentPrice: h.currentPrice,
            originalPrice: h.originalPrice,
            originalCurrency: h.originalCurrency,
            stockCurrency: h.currency,
            conversionRate: h.conversionRate,
            lastUpdated: h.lastUpdated
          }))
        });
      }

      // 3. Check currency cache
      const currencyRates = await CurrencyRateCacheCollection.find({}).fetchAsync();

      // 4. Analysis
      const currencies = [...new Set(bankAccounts.map(acc => acc.referenceCurrency))];
      const allCurrentValues = new Set();
      
      allHoldings.forEach(accountData => {
        accountData.holdings.forEach(h => {
          if (h.currentValue) allCurrentValues.add(h.currentValue.toFixed(2));
        });
      });

      return {
        bankAccounts: bankAccounts.map(acc => ({
          accountNumber: acc.accountNumber,
          referenceCurrency: acc.referenceCurrency,
          id: acc._id
        })),
        holdingsByAccount: allHoldings,
        currencyRates: currencyRates.map(r => ({
          pair: r.pair,
          rate: r.rate,
          isExpired: new Date() > new Date(r.expiresAt),
          lastUpdated: r.lastUpdated
        })),
        analysis: {
          uniqueCurrencies: currencies,
          multipleCurrencies: currencies.length > 1,
          uniqueValues: Array.from(allCurrentValues),
          identicalValues: allCurrentValues.size <= 1,
          possibleIssues: []
        }
      };

    } catch (error) {
      console.error('Error diagnosing currency issue:', error);
      throw new Meteor.Error('currency-diagnosis-failed', error.message);
    }
  },

  // Debug method to fix bank account currencies  
  async 'debug.fixBankAccountCurrencies'(sessionId) {
    check(sessionId, Match.Optional(String));
    
    try {
      // Get current user
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'Must be logged in');
      }

      const { BankAccountsCollection } = await import('/imports/api/bankAccounts');
      const { USER_ROLES } = await import('/imports/api/users');
      
      // Use same role-based access as diagnostic method
      let bankAccountQuery = {};

      switch (currentUser.role) {
        case USER_ROLES.SUPERADMIN:
        case USER_ROLES.ADMIN:
          // Admins can see/update all bank accounts
          bankAccountQuery = { isActive: true };
          console.log(`Admin fix: updating all accounts`);
          break;
          
        case USER_ROLES.RELATIONSHIP_MANAGER:
          // RMs can update bank accounts of their assigned clients + their own
          const rmClients = await UsersCollection.find({ 
            relationshipManagerId: currentUser._id,
            role: USER_ROLES.CLIENT 
          }).fetchAsync();
          
          const clientUserIds = rmClients.map(client => client._id);
          clientUserIds.push(currentUser._id); // Include RM's own accounts
          
          bankAccountQuery = {
            userId: { $in: clientUserIds },
            isActive: true
          };
          console.log(`RM fix: updating accounts for ${clientUserIds.length} users`);
          break;
          
        case USER_ROLES.CLIENT:
        default:
          // Clients can only update their own bank accounts
          bankAccountQuery = {
            userId: currentUser._id,
            isActive: true
          };
          console.log(`Client fix: updating user's own accounts`);
          break;
      }

      const bankAccounts = await BankAccountsCollection.find(bankAccountQuery).fetchAsync();
      console.log(`Found ${bankAccounts.length} bank accounts to potentially update`);

      // Set up different currencies for different accounts
      const currencyMapping = {
        0: 'USD',  // First account stays USD
        1: 'EUR',  // Second account to EUR
        2: 'CHF',  // Third account to CHF  
        3: 'GBP',  // Fourth account to GBP
        4: 'USD',  // Fifth back to USD
        5: 'EUR',  // Sixth to EUR
        6: 'CHF',  // Continue pattern
        7: 'GBP',
        8: 'USD',
        9: 'EUR'
      };

      const updates = [];
      
      for (let i = 0; i < bankAccounts.length; i++) {
        const account = bankAccounts[i];
        const newCurrency = currencyMapping[i] || 'USD';
        
        if (account.referenceCurrency !== newCurrency) {
          await BankAccountsCollection.updateAsync(account._id, {
            $set: {
              referenceCurrency: newCurrency,
              updatedAt: new Date()
            }
          });
          
          updates.push({
            accountNumber: account.accountNumber,
            from: account.referenceCurrency,
            to: newCurrency
          });
          
          console.log(`Updated account ${account.accountNumber}: ${account.referenceCurrency} → ${newCurrency}`);
        }
      }

      return {
        success: true,
        message: `Updated ${updates.length} bank accounts with different currencies`,
        updates: updates,
        totalAccounts: bankAccounts.length
      };

    } catch (error) {
      console.error('Error fixing bank account currencies:', error);
      throw new Meteor.Error('currency-fix-failed', error.message);
    }
  },
  
  async 'equityHoldings.searchStocks'(query, limit = 20, sessionId = null) {
    check(query, String);
    check(limit, Number);
    check(sessionId, Match.Optional(String));
    
    // Get current user with session-based authentication (prioritize session over userId)
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
    
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'Must be logged in to search stocks');
    }
    
    return await MarketDataHelpers.searchStocksForPortfolio(query, limit);
  },

  // Admin method to create test data
  async 'admin.createTestData'(sessionId = null) {
    check(sessionId, Match.Optional(String));
    
    console.log('Server: admin.createTestData called with sessionId:', sessionId);
    
    try {
      // Get current user with session-based authentication
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      console.log('Server: Current user for test data creation:', currentUser ? { id: currentUser._id, username: currentUser.username, role: currentUser.role } : 'none');
      
      if (!currentUser || (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN)) {
        throw new Meteor.Error('not-authorized', 'Only administrators can create test data');
      }

      console.log('Server: Authorization passed, creating test data...');
      
      // Get banks
      const banks = await BanksCollection.find({ isActive: true }).fetchAsync();
      if (banks.length === 0) {
        throw new Meteor.Error('no-banks', 'No banks available. Please create banks first.');
      }
      
      // Create a bank account for the current admin user if they don't have one
      const existingAccount = await BankAccountsCollection.findOneAsync({ userId: currentUser._id });
      if (!existingAccount) {
        const adminName = currentUser.username || currentUser._id.substring(0, 8);
        const bankAccountId = await BankAccountsCollection.insertAsync({
          userId: currentUser._id,
          bankId: banks[0]._id,
          accountNumber: `${adminName.toUpperCase()}-ADMIN-001`,
          referenceCurrency: 'USD',
          isActive: true,
          createdAt: new Date()
        });
        
        console.log(`Server: Created admin bank account ${bankAccountId}`);
        
        // Create a sample holding
        await EquityHoldingsCollection.insertAsync({
          userId: currentUser._id,
          bankAccountId: bankAccountId,
          accountNumber: `${adminName.toUpperCase()}-ADMIN-001`,
          symbol: 'AAPL',
          exchange: 'NASDAQ',
          fullTicker: 'AAPL.NASDAQ',
          companyName: 'Apple Inc.',
          sector: 'Technology',
          currency: 'USD',
          quantity: 100,
          averagePrice: 150.00,
          currentPrice: 175.00,
          totalCost: 15000,
          currentValue: 17500,
          totalReturn: 2500,
          totalReturnPercent: 16.67,
          dayChange: 250,
          dayChangePercent: 1.45,
          purchaseDate: new Date('2024-01-15'),
          lastUpdated: new Date(),
          transactions: [{
            type: 'BUY',
            quantity: 100,
            price: 150.00,
            amount: 15000,
            fees: 9.95,
            date: new Date('2024-01-15'),
            notes: 'Admin test holding'
          }]
        });
        
        console.log('Server: Created sample AAPL holding for admin');
      }
      
      // Also create test data for other users
      await createTestData();
      console.log('Server: Test data creation completed successfully');
      
      return { success: true, message: 'Test data created successfully' };
    } catch (error) {
      console.error('Server: Error in admin.createTestData:', error);
      throw error;
    }
  },

  // Simple method to create a bank account for the current user
  async 'admin.createMyBankAccount'(sessionId = null) {
    check(sessionId, Match.Optional(String));
    
    console.log('Server: admin.createMyBankAccount called');
    
    try {
      // Get current user
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'User not authenticated');
      }
      
      console.log('Server: Creating bank account for user:', { id: currentUser._id, username: currentUser.username, role: currentUser.role });
      
      // Check if user already has a bank account
      const existingAccount = await BankAccountsCollection.findOneAsync({ userId: currentUser._id, isActive: true });
      if (existingAccount) {
        console.log('Server: User already has a bank account:', existingAccount._id);
        return { success: true, message: 'Bank account already exists', accountId: existingAccount._id };
      }
      
      // Get banks
      const banks = await BanksCollection.find({ isActive: true }).fetchAsync();
      if (banks.length === 0) {
        throw new Meteor.Error('no-banks', 'No banks available');
      }
      
      // Create bank account
      const userName = currentUser.username || currentUser._id.substring(0, 8);
      const bankAccountId = await BankAccountsCollection.insertAsync({
        userId: currentUser._id,
        bankId: banks[0]._id,
        accountNumber: `${userName.toUpperCase()}-001`,
        referenceCurrency: 'USD',
        isActive: true,
        createdAt: new Date()
      });
      
      console.log('Server: Created bank account:', bankAccountId);
      
      return { success: true, message: 'Bank account created successfully', accountId: bankAccountId };
      
    } catch (error) {
      console.error('Server: Error in admin.createMyBankAccount:', error);
      throw error;
    }
  },

  // Debug method to check what bank accounts exist
  async 'admin.debugBankAccounts'(sessionId = null) {
    check(sessionId, Match.Optional(String));
    
    try {
      // Get current user
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'User not authenticated');
      }
      
      console.log('Server: Debug bank accounts for user:', currentUser.username, currentUser.role);
      
      // Get all bank accounts
      const allBankAccounts = await BankAccountsCollection.find({}).fetchAsync();
      console.log('Server: All bank accounts in database:', allBankAccounts);
      
      // Get active bank accounts
      const activeBankAccounts = await BankAccountsCollection.find({ isActive: true }).fetchAsync();
      console.log('Server: Active bank accounts:', activeBankAccounts);
      
      // Get user's bank accounts
      const userBankAccounts = await BankAccountsCollection.find({ userId: currentUser._id }).fetchAsync();
      console.log('Server: User bank accounts:', userBankAccounts);
      
      return { 
        success: true, 
        message: 'Debug info logged to server console',
        allCount: allBankAccounts.length,
        activeCount: activeBankAccounts.length,
        userCount: userBankAccounts.length
      };
      
    } catch (error) {
      console.error('Server: Error in admin.debugBankAccounts:', error);
      throw error;
    }
  },

  // Temporary method to create admin session for debugging
  async 'auth.createAdminSession'() {
    try {
      // Find admin user
      const adminUser = await UsersCollection.findOneAsync({ role: 'superadmin' });
      if (!adminUser) {
        throw new Meteor.Error('no-admin', 'No admin user found');
      }

      // Create a new session
      const session = await SessionHelpers.createSession(
        adminUser._id,
        true, // rememberMe
        'AdminDebugSession',
        '127.0.0.1'
      );

      console.log('Created admin session:', session.sessionId);
      return {
        sessionId: session.sessionId,
        userId: adminUser._id,
        email: adminUser.email,
        role: adminUser.role
      };

    } catch (error) {
      console.error('Error creating admin session:', error);
      throw error;
    }
  },

  // Simple admin login for debugging
  async 'auth.adminQuickLogin'() {
    try {
      // Login as admin with default password
      const result = await Meteor.callAsync('auth.login', {
        email: 'admin@example.com',
        password: 'admin123',
        rememberMe: true
      });
      
      console.log('Admin logged in successfully');
      return result;
    } catch (error) {
      console.error('Admin login failed:', error);
      // If login fails, try creating the admin user first
      if (error.error === 'user-not-found') {
        console.log('Creating admin user...');
        await Meteor.callAsync('users.create', {
          email: 'admin@example.com',
          password: 'admin123',
          role: 'superadmin'
        });
        
        // Try login again
        return await Meteor.callAsync('auth.login', {
          email: 'admin@example.com',
          password: 'admin123',
          rememberMe: true
        });
      }
      throw error;
    }
  },

  // Debug method to check database state and connection
  async 'debug.checkDatabaseState'() {
    // First, log database connection info
    const mongoUrl = process.env.MONGO_URL || 'default local MongoDB';
    console.log('\n=== CURRENT DATABASE CONNECTION ===');
    console.log('MONGO_URL:', mongoUrl.includes('mongodb+srv') ? 
      `${mongoUrl.substring(0, 25)}...${mongoUrl.substring(mongoUrl.lastIndexOf('/'))}` : mongoUrl);
    console.log('Database Type:', mongoUrl.includes('mongodb+srv') ? 'Atlas (Cloud)' : 'Local MongoDB');
    
    // Get the actual MongoDB connection details
    try {
      const db = EquityHoldingsCollection.rawDatabase();
      const admin = db.admin();
      const connectionStatus = await admin.command({ connectionStatus: 1 });
      console.log('Actual Database Name:', db.databaseName);
      console.log('MongoDB Server Info:', connectionStatus.authInfo?.authenticatedUsers?.[0]?.db || 'No auth info');
    } catch (error) {
      console.log('Could not get MongoDB connection details:', error.message);
    }
    console.log('=====================================');
    
    const bankAccounts = await BankAccountsCollection.find({}).fetchAsync();
    const equityHoldings = await EquityHoldingsCollection.find({}).fetchAsync();
    const sessions = await SessionsCollection.find({}).fetchAsync();
    const users = await UsersCollection.find({}).fetchAsync();
    
    console.log('\n=== DATABASE STATE CHECK ===');
    console.log('Total bank accounts:', bankAccounts.length);
    console.log('Bank accounts:', bankAccounts.map(a => ({
      id: a._id,
      accountNumber: a.accountNumber,
      userId: a.userId,
      isActive: a.isActive
    })));
    
    console.log('\nTotal equity holdings:', equityHoldings.length);
    console.log('Holdings:', equityHoldings.map(h => ({
      id: h._id,
      symbol: h.symbol,
      bankAccountId: h.bankAccountId,
      quantity: h.quantity
    })));
    
    console.log('\nTotal sessions:', sessions.length);
    console.log('Sessions:', sessions.map(s => ({
      sessionId: s.sessionId,
      userId: s.userId,
      isActive: s.isActive,
      createdAt: s.createdAt
    })));
    
    console.log('\nTotal users:', users.length);
    console.log('Users:', users.map(u => ({
      id: u._id,
      email: u.email,
      role: u.role
    })));
    
    return {
      bankAccountsCount: bankAccounts.length,
      holdingsCount: equityHoldings.length,
      sessionsCount: sessions.length,
      usersCount: users.length
    };
  },

  // Check current session validity
  async 'debug.checkSession'(sessionId) {
    console.log('\n=== SESSION CHECK ===');
    console.log('Checking session:', sessionId);
    
    const session = await SessionsCollection.findOneAsync({ sessionId });
    if (!session) {
      console.log('❌ Session NOT FOUND in database');
      
      // Show valid sessions
      const validSessions = await SessionsCollection.find({}).fetchAsync();
      console.log('Valid sessions:', validSessions.map(s => s.sessionId));
      
      return { valid: false, message: 'Session not found' };
    }
    
    console.log('✅ Session found');
    console.log('User ID:', session.userId);
    console.log('Active:', session.isActive);
    console.log('Created:', session.createdAt);
    
    // Check user
    const user = await UsersCollection.findOneAsync(session.userId);
    if (!user) {
      console.log('❌ User NOT FOUND for session');
      return { valid: false, message: 'User not found' };
    }
    
    console.log('✅ User found:', user.email, user.role);
    
    // Check admin bank account
    const adminAccount = await BankAccountsCollection.findOneAsync({
      userId: user._id,
      isActive: true
    });
    
    if (adminAccount) {
      console.log('✅ User has bank account:', adminAccount.accountNumber);
    } else {
      console.log('❌ User has NO bank accounts');
    }
    
    return {
      valid: true,
      sessionId: session.sessionId,
      userId: user._id,
      email: user.email,
      role: user.role,
      hasBankAccount: !!adminAccount,
      bankAccountId: adminAccount?._id
    };
  }
});

// Debug method specifically for EUR account currency issue
Meteor.methods({
  async 'debug.checkEURAccountAlcoa'(sessionId = null) {
    check(sessionId, Match.Optional(String));
    
    console.log('\n🔍 DEBUGGING EUR ACCOUNT ALCOA CURRENCY CONVERSION');
    console.log('================================================');
    
    try {
      // Get current user
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'Must be logged in');
      }
      
      // Find all Alcoa holdings across all accounts first
      console.log('\n🔍 FINDING ALL ALCOA HOLDINGS:');
      const allAlcoaHoldings = await EquityHoldingsCollection.find({
        symbol: 'AA'
      }).fetchAsync();
      
      console.log(`Found ${allAlcoaHoldings.length} Alcoa holdings total`);
      
      for (const holding of allAlcoaHoldings) {
        const account = await BankAccountsCollection.findOneAsync({ _id: holding.bankAccountId });
        console.log(`- Account ${account?.accountNumber} (${account?.referenceCurrency}): ${holding.currentValue} ${account?.referenceCurrency}`);
      }
      
      // Find EUR bank account
      const eurAccount = await BankAccountsCollection.findOneAsync({
        referenceCurrency: 'EUR'
      });
      
      if (!eurAccount) {
        console.log('❌ No EUR account found');
        return { error: 'No EUR account found' };
      }
      
      console.log(`\n✅ Found EUR account: ${eurAccount.accountNumber} (${eurAccount.referenceCurrency})`);
      
      // Find Alcoa holdings in EUR account
      const alcoaHoldings = await EquityHoldingsCollection.find({
        bankAccountId: eurAccount._id,
        symbol: 'AA'
      }).fetchAsync();
      
      if (alcoaHoldings.length === 0) {
        console.log('❌ No Alcoa holdings found in EUR account, but found in other accounts');
        
        // Return info about where Alcoa holdings actually are
        const alcoaAccountInfo = [];
        for (const holding of allAlcoaHoldings) {
          const account = await BankAccountsCollection.findOneAsync({ _id: holding.bankAccountId });
          alcoaAccountInfo.push({
            accountNumber: account?.accountNumber,
            currency: account?.referenceCurrency,
            holdingCurrency: holding.currency,
            currentValue: holding.currentValue,
            currentPrice: holding.currentPrice,
            quantity: holding.quantity
          });
        }
        
        return { 
          error: 'No Alcoa holdings in EUR account',
          alcoaFoundIn: alcoaAccountInfo
        };
      }
      
      const holding = alcoaHoldings[0];
      console.log('\n📊 ALCOA HOLDING ANALYSIS:');
      console.log(`Symbol: ${holding.symbol}`);
      console.log(`Stock Currency: ${holding.currency}`);
      console.log(`Bank Currency: ${eurAccount.referenceCurrency}`);
      console.log(`Current Price: ${holding.currentPrice}`);
      console.log(`Current Value: ${holding.currentValue}`);
      console.log(`Original Price: ${holding.originalPrice || 'Not stored'}`);
      console.log(`Original Currency: ${holding.originalCurrency || 'Not stored'}`);
      console.log(`Conversion Rate: ${holding.conversionRate || 'Not stored'}`);
      console.log(`Last Updated: ${holding.lastUpdated}`);
      
      // Test conversion manually
      console.log('\n🧪 MANUAL CONVERSION TEST:');
      const testPrice = 25.86; // Current Alcoa price in USD
      const testAmount = holding.quantity * testPrice;
      
      console.log(`Test amount: ${testAmount} USD`);
      const convertedAmount = await EquityHoldingsHelpers.convertCurrency(testAmount, 'USD', 'EUR');
      console.log(`Converted amount: ${convertedAmount} EUR`);
      console.log(`Conversion worked: ${Math.abs(convertedAmount - testAmount) > 1}`);
      
      // Check if currencies match (this might be the issue)
      const currenciesMatch = holding.currency === eurAccount.referenceCurrency;
      console.log(`\n⚠️  POTENTIAL ISSUE:`);
      console.log(`Stock currency (${holding.currency}) === Bank currency (${eurAccount.referenceCurrency}): ${currenciesMatch}`);
      if (currenciesMatch) {
        console.log('❌ This is the problem! The system thinks no conversion is needed.');
      }
      
      return {
        eurAccount: {
          id: eurAccount._id,
          number: eurAccount.accountNumber,
          currency: eurAccount.referenceCurrency
        },
        holding: {
          symbol: holding.symbol,
          currency: holding.currency,
          currentPrice: holding.currentPrice,
          currentValue: holding.currentValue,
          quantity: holding.quantity,
          originalPrice: holding.originalPrice,
          originalCurrency: holding.originalCurrency,
          conversionRate: holding.conversionRate
        },
        testConversion: {
          input: testAmount,
          output: convertedAmount,
          worked: Math.abs(convertedAmount - testAmount) > 1
        },
        issue: {
          currenciesMatch: currenciesMatch,
          needsConversion: !currenciesMatch
        }
      };
      
    } catch (error) {
      console.error('Error debugging EUR account:', error);
      return { error: error.message };
    }
  },

  // Find EUR accounts with USD holdings and force conversion
  async 'debug.fixEURAccountConversion'(sessionId = null) {
    check(sessionId, Match.Optional(String));
    
    console.log('\n🔧 FIXING EUR ACCOUNT USD CONVERSION ISSUE');
    console.log('=========================================');
    
    try {
      // Get current user
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'Must be logged in');
      }
      
      // Find all EUR accounts
      const eurAccounts = await BankAccountsCollection.find({
        referenceCurrency: 'EUR'
      }).fetchAsync();
      
      console.log(`Found ${eurAccounts.length} EUR accounts`);
      
      const results = [];
      
      for (const account of eurAccounts) {
        console.log(`\n📊 Checking account ${account.accountNumber}:`);
        
        // Find USD holdings in this EUR account
        const usdHoldings = await EquityHoldingsCollection.find({
          bankAccountId: account._id,
          currency: 'USD'
        }).fetchAsync();
        
        console.log(`  - Found ${usdHoldings.length} USD holdings`);
        
        if (usdHoldings.length > 0) {
          console.log(`  - Holdings: ${usdHoldings.map(h => `${h.symbol} (${h.currentValue})`).join(', ')}`);
          
          // Force update prices for this account to trigger conversion
          console.log(`  - 🔄 Forcing price update with conversion...`);
          
          try {
            await Meteor.callAsync('equityHoldings.updatePrices', account._id, sessionId);
            
            // Check if conversion worked by re-reading the holdings
            const updatedHoldings = await EquityHoldingsCollection.find({
              bankAccountId: account._id,
              currency: 'USD'
            }).fetchAsync();
            
            const conversionWorked = updatedHoldings.some(h => h.conversionRate && h.conversionRate !== 1);
            
            results.push({
              accountNumber: account.accountNumber,
              holdingsCount: usdHoldings.length,
              symbols: usdHoldings.map(h => h.symbol),
              conversionWorked: conversionWorked,
              beforeValues: usdHoldings.map(h => ({ symbol: h.symbol, value: h.currentValue })),
              afterValues: updatedHoldings.map(h => ({ 
                symbol: h.symbol, 
                value: h.currentValue, 
                rate: h.conversionRate,
                originalPrice: h.originalPrice
              }))
            });
            
            console.log(`  - ✅ Conversion ${conversionWorked ? 'WORKED' : 'FAILED'}`);
            
          } catch (error) {
            console.error(`  - ❌ Error updating prices: ${error.message}`);
            results.push({
              accountNumber: account.accountNumber,
              error: error.message
            });
          }
        } else {
          console.log(`  - No USD holdings found`);
        }
      }
      
      return {
        success: true,
        message: `Processed ${eurAccounts.length} EUR accounts`,
        results: results
      };
      
    } catch (error) {
      console.error('Error fixing EUR account conversion:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  },

  // Force currency conversion for Alcoa holding
  async 'debug.forceAlcoaConversion'(sessionId) {
    check(sessionId, Match.Optional(String));
    
    console.log('\n🔧 FORCING ALCOA CURRENCY CONVERSION');
    console.log('====================================');
    
    try {
      // Get current user
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'Must be logged in');
      }
      
      // Find EUR account
      const eurAccount = await BankAccountsCollection.findOneAsync({
        referenceCurrency: 'EUR'
      });
      
      if (!eurAccount) {
        return { success: false, error: 'No EUR account found' };
      }
      
      console.log(`✅ Found EUR account: ${eurAccount.accountNumber}`);
      
      // Get the Alcoa holding
      const alcoaHolding = await EquityHoldingsCollection.findOneAsync({
        bankAccountId: eurAccount._id,
        symbol: 'AA'
      });
      
      if (!alcoaHolding) {
        return { success: false, error: 'No Alcoa holding found in EUR account' };
      }
      
      console.log(`✅ Found Alcoa holding: ${alcoaHolding.currentValue} (currency: ${alcoaHolding.currency})`);
      
      // Create mock price data for updatePrices method
      const priceData = {
        [alcoaHolding.fullTicker]: {
          price: 25.86, // Current USD price
          source: 'manual_fix',
          date: new Date()
        }
      };
      
      console.log('🔄 Triggering currency conversion via updatePrices...');
      await EquityHoldingsHelpers.updatePrices(eurAccount._id, currentUser._id, priceData);
      
      // Verify the conversion
      const updatedHolding = await EquityHoldingsCollection.findOneAsync({
        bankAccountId: eurAccount._id,
        symbol: 'AA'
      });
      
      const conversionWorked = updatedHolding.conversionRate && updatedHolding.conversionRate !== 1;
      
      return {
        success: true,
        before: {
          currentValue: alcoaHolding.currentValue,
          currency: alcoaHolding.currency
        },
        after: {
          currentValue: updatedHolding.currentValue,
          currency: updatedHolding.currency,
          conversionRate: updatedHolding.conversionRate,
          originalPrice: updatedHolding.originalPrice,
          originalCurrency: updatedHolding.originalCurrency
        },
        conversionWorked: conversionWorked,
        message: conversionWorked ? 
          `✅ Conversion worked! ${updatedHolding.currentValue.toFixed(2)} EUR (rate: ${updatedHolding.conversionRate.toFixed(4)})` :
          '❌ Conversion may have failed - values unchanged'
      };
      
    } catch (error) {
      console.error('Error forcing Alcoa conversion:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  },

  // Direct database fix for EUR/USD currency issue
  async 'debug.fixCurrencyDataIssue'(sessionId = null) {
    check(sessionId, Match.Optional(String));
    
    console.log('\n🔧 DIRECT DATABASE FIX FOR CURRENCY ISSUE');
    console.log('==========================================');
    
    try {
      // Get current user
      const currentUser = sessionId ? 
        await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
        (this.userId ? await UsersCollection.findOneAsync(this.userId) : null);
      
      if (!currentUser) {
        throw new Meteor.Error('not-authorized', 'Must be logged in');
      }
      
      // Find all EUR accounts
      const eurAccounts = await BankAccountsCollection.find({
        referenceCurrency: 'EUR'
      }).fetchAsync();
      
      console.log(`Found ${eurAccounts.length} EUR accounts`);
      
      const fixes = [];
      
      for (const account of eurAccounts) {
        console.log(`\n📊 Analyzing account ${account.accountNumber}:`);
        
        // Get ALL holdings for this EUR account
        const allHoldings = await EquityHoldingsCollection.find({
          bankAccountId: account._id
        }).fetchAsync();
        
        console.log(`  - Total holdings: ${allHoldings.length}`);
        
        for (const holding of allHoldings) {
          console.log(`  - ${holding.symbol}: currency=${holding.currency}, value=${holding.currentValue}`);
          
          // Check if this is a US stock (symbol format, or common US stocks)
          const isUSStock = (
            holding.symbol.match(/^[A-Z]{1,5}$/) && // Simple ticker format
            !holding.symbol.match(/\.(L|PA|MI|FR|DE)$/) && // Not European exchange
            (holding.fullTicker?.includes('.US') || !holding.fullTicker?.includes('.'))
          );
          
          // Or check if it's specifically showing identical values (the bug indicator)
          const hasIdenticalValues = (
            holding.currency === 'EUR' && 
            holding.currentValue && 
            Math.abs(holding.currentValue - 8354.37) < 1 // The specific value you mentioned
          );
          
          if (isUSStock || hasIdenticalValues) {
            console.log(`    ⚠️  Potential USD stock stored as EUR: ${holding.symbol}`);
            
            // Fix: Update the holding to have USD currency and recalculate
            const originalCurrency = holding.currency;
            const originalValue = holding.currentValue;
            const originalPrice = holding.currentPrice;
            
            // Update to USD currency
            await EquityHoldingsCollection.updateAsync(holding._id, {
              $set: {
                currency: 'USD',
                originalCurrency: originalCurrency,
                needsConversion: true
              }
            });
            
            // Now force a price update to trigger conversion
            try {
              await Meteor.callAsync('equityHoldings.updatePrices', account._id, sessionId);
              
              // Check if it worked
              const updatedHolding = await EquityHoldingsCollection.findOneAsync(holding._id);
              
              fixes.push({
                symbol: holding.symbol,
                account: account.accountNumber,
                before: {
                  currency: originalCurrency,
                  value: originalValue,
                  price: originalPrice
                },
                after: {
                  currency: updatedHolding.currency,
                  value: updatedHolding.currentValue,
                  price: updatedHolding.currentPrice,
                  conversionRate: updatedHolding.conversionRate
                },
                success: updatedHolding.conversionRate && updatedHolding.conversionRate !== 1
              });
              
              console.log(`    ✅ Fixed ${holding.symbol}: ${originalValue} ${originalCurrency} → ${updatedHolding.currentValue} EUR (rate: ${updatedHolding.conversionRate})`);
              
            } catch (error) {
              console.error(`    ❌ Error updating ${holding.symbol}:`, error.message);
              fixes.push({
                symbol: holding.symbol,
                account: account.accountNumber,
                error: error.message
              });
            }
          }
        }
      }
      
      return {
        success: true,
        message: `Processed ${eurAccounts.length} EUR accounts, made ${fixes.length} fixes`,
        fixes: fixes,
        summary: {
          successful: fixes.filter(f => f.success).length,
          failed: fixes.filter(f => f.error || !f.success).length
        }
      };
      
    } catch (error) {
      console.error('Error fixing currency data issue:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  },

  // Find which account actually has the Alcoa stock showing EUR 8,354.37
  async 'debug.findAlcoaAccount'() {
    const db = MongoInternals.defaultRemoteCollectionDriver().mongo.db;
    
    console.log('\n🔍 FINDING ALCOA ACCOUNT');
    console.log('=======================');
    
    // 1. Find all accounts
    const allAccounts = await db.collection('bankAccounts').find({}).toArray();
    console.log(`Found ${allAccounts.length} total accounts:`);
    allAccounts.forEach(acc => {
      console.log(`  - ${acc.accountNumber} (${acc.referenceCurrency}) - ID: ${acc._id}`);
    });
    
    // 2. Find ALL Alcoa holdings across all accounts
    const alcoaHoldings = await db.collection('equityHoldings').find({ 
      symbol: 'AA' 
    }).toArray();
    
    console.log(`\nFound ${alcoaHoldings.length} Alcoa holdings:`);
    
    const accountAnalysis = [];
    for (const holding of alcoaHoldings) {
      try {
        const account = allAccounts.find(acc => acc._id.toString() === holding.bankAccountId.toString());
        const analysis = {
          holdingId: holding._id.toString(),
          accountId: holding.bankAccountId.toString(),
          accountNumber: account ? account.accountNumber : 'UNKNOWN',
          accountCurrency: account ? account.referenceCurrency : 'UNKNOWN',
          currentValue: holding.currentValue,
          currency: holding.currency,
          originalCurrency: holding.originalCurrency,
          conversionRate: holding.conversionRate,
          quantity: holding.quantity,
          currentPrice: holding.currentPrice,
          lastUpdated: holding.lastUpdated
        };
        
        accountAnalysis.push(analysis);
        
        console.log(`\n  📊 ${holding.symbol} in account ${account ? account.accountNumber : 'UNKNOWN'}:`);
        console.log(`     🏦 Account Currency: ${account ? account.referenceCurrency : 'UNKNOWN'}`);
        console.log(`     💰 currentValue: ${holding.currentValue}`);
        console.log(`     🏷️  currency: ${holding.currency}`);
        console.log(`     📦 quantity: ${holding.quantity}`);
        console.log(`     💵 currentPrice: ${holding.currentPrice}`);
        
        // Check if this is the problematic one
        if (Math.abs(holding.currentValue - 8354.37) < 0.01) {
          console.log(`     ❗ THIS IS THE PROBLEM HOLDING! Shows 8354.37`);
          if (account && account.referenceCurrency === 'EUR') {
            console.log(`     🎯 And it's in a EUR account - this needs conversion!`);
          } else {
            console.log(`     🤔 But account currency is ${account ? account.referenceCurrency : 'UNKNOWN'}`);
          }
        }
      } catch (error) {
        console.log(`     ❌ Error processing holding ${holding.symbol}: ${error.message}`);
      }
    }
    
    return {
      success: true,
      totalAccounts: allAccounts.length,
      alcoaHoldingsFound: alcoaHoldings.length,
      accounts: allAccounts.map(acc => ({
        id: acc._id.toString(),
        number: acc.accountNumber,
        currency: acc.referenceCurrency
      })),
      alcoaAnalysis: accountAnalysis
    };
  },

  // Debug EUR account display issue - comprehensive analysis
  async 'debug.analyzeEURDisplayIssue'() {
    const db = MongoInternals.defaultRemoteCollectionDriver().mongo.db;
    
    console.log('\n🕵️ COMPREHENSIVE EUR DISPLAY ANALYSIS');
    console.log('====================================');
    
    // 1. Find EUR account
    const eurAccount = await db.collection('bankAccounts').findOne({ referenceCurrency: 'EUR' });
    if (!eurAccount) {
      return { error: 'No EUR account found' };
    }
    
    console.log(`📋 EUR Account: ${eurAccount.accountNumber} (ID: ${eurAccount._id})`);
    console.log(`   Reference Currency: ${eurAccount.referenceCurrency}`);
    
    // 2. Find ALL holdings in EUR account
    const holdings = await db.collection('equityHoldings').find({ 
      bankAccountId: eurAccount._id
    }).toArray();
    
    console.log(`\n📊 Found ${holdings.length} holdings:`);
    
    const analysis = [];
    holdings.forEach((holding, i) => {
      const item = {
        index: i + 1,
        symbol: holding.symbol,
        id: holding._id.toString(),
        currentValue: holding.currentValue,
        currentPrice: holding.currentPrice,
        currency: holding.currency,
        originalCurrency: holding.originalCurrency,
        originalPrice: holding.originalPrice,
        conversionRate: holding.conversionRate,
        quantity: holding.quantity,
        lastUpdated: holding.lastUpdated,
        fixedByDirectMethod: holding.fixedByDirectMethod || false
      };
      
      analysis.push(item);
      
      console.log(`\n  ${i+1}. ${holding.symbol}:`);
      console.log(`     💰 currentValue: ${holding.currentValue}`);
      console.log(`     💵 currentPrice: ${holding.currentPrice}`);
      console.log(`     🏷️  currency: ${holding.currency}`);
      console.log(`     🏷️  originalCurrency: ${holding.originalCurrency || 'not set'}`);
      console.log(`     💱 conversionRate: ${holding.conversionRate || 'not set'}`);
      console.log(`     📦 quantity: ${holding.quantity}`);
      console.log(`     🕐 lastUpdated: ${holding.lastUpdated}`);
      console.log(`     🔧 fixedByDirectMethod: ${holding.fixedByDirectMethod || false}`);
      
      // Calculate what SHOULD be displayed
      if (holding.currentValue === 8354.37) {
        const shouldBeEUR = holding.currentValue * 0.859;
        console.log(`     ❗ PROBLEM DETECTED: This shows ${holding.currentValue} but should be ${shouldBeEUR.toFixed(2)} EUR`);
      }
    });
    
    // 3. Test currency conversion
    console.log(`\n🧪 Testing currency conversion:`);
    const testUsdToEur = await EquityHoldingsHelpers.convertCurrency(8354.37, 'USD', 'EUR');
    const testEurToUsd = await EquityHoldingsHelpers.convertCurrency(8354.37, 'EUR', 'USD');
    
    console.log(`   8354.37 USD -> EUR: ${testUsdToEur}`);
    console.log(`   8354.37 EUR -> USD: ${testEurToUsd}`);
    
    return {
      success: true,
      account: {
        id: eurAccount._id.toString(),
        number: eurAccount.accountNumber,
        currency: eurAccount.referenceCurrency
      },
      holdings: analysis,
      conversionTest: {
        usdToEur: testUsdToEur,
        eurToUsd: testEurToUsd
      },
      analysis: {
        totalHoldings: holdings.length,
        problemHoldings: holdings.filter(h => h.currentValue === 8354.37).length,
        fixedHoldings: holdings.filter(h => h.fixedByDirectMethod).length
      }
    };
  },

  // Test the currency conversion function directly
  async 'debug.testConversionFunction'() {
    console.log('\n🧪 TESTING CURRENCY CONVERSION FUNCTION');
    console.log('=====================================');
    
    // Test various conversions
    const tests = [
      { amount: 100, from: 'USD', to: 'EUR' },
      { amount: 100, from: 'EUR', to: 'USD' },
      { amount: 8354.37, from: 'USD', to: 'EUR' },
      { amount: 25.86, from: 'USD', to: 'EUR' }
    ];
    
    const results = [];
    
    for (const test of tests) {
      console.log(`\nTesting: ${test.amount} ${test.from} → ${test.to}`);
      
      const result = await EquityHoldingsHelpers.convertCurrency(test.amount, test.from, test.to);
      console.log(`Result: ${result}`);
      
      results.push({
        ...test,
        result,
        converted: result !== test.amount
      });
    }
    
    // Check exchange rates
    await CurrencyCache.refreshCurrencyRates(['EURUSD.FOREX']);
    const eurUsdRate = await CurrencyCache.getCachedRate('EURUSD.FOREX');
    
    return {
      conversionTests: results,
      exchangeRate: eurUsdRate,
      summary: {
        allWorking: results.every(r => r.converted),
        eurToUsdRate: eurUsdRate?.rate || 'Not found',
        usdToEurRate: eurUsdRate?.rate ? (1 / eurUsdRate.rate).toFixed(4) : 'Not found'
      }
    };
  },

  // Debug method to check actual data state
  async 'debug.checkActualDataState'() {
    const db = MongoInternals.defaultRemoteCollectionDriver().mongo.db;
    
    // Find EUR account
    const eurAccount = await db.collection('bankAccounts').findOne({ referenceCurrency: 'EUR' });
    if (!eurAccount) {
      return { error: 'No EUR account found' };
    }
    
    // Find holdings
    const holdings = await db.collection('equityHoldings').find({ 
      bankAccountId: eurAccount._id 
    }).toArray();
    
    const alcoaHolding = holdings.find(h => h.symbol === 'AA');
    
    if (!alcoaHolding) {
      return { error: 'No Alcoa holding found in EUR account' };
    }
    
    // Test conversion
    const testConversion = await EquityHoldingsHelpers.convertCurrency(100, 'USD', 'EUR');
    const reverseConversion = await EquityHoldingsHelpers.convertCurrency(100, 'EUR', 'USD');
    
    // Get current exchange rate from cache
    const eurUsdRate = await CurrencyCache.getCachedRate('EURUSD.FOREX');
    
    return {
      account: {
        id: eurAccount._id,
        number: eurAccount.accountNumber,
        currency: eurAccount.referenceCurrency
      },
      holding: {
        symbol: alcoaHolding.symbol,
        currency: alcoaHolding.currency,
        originalCurrency: alcoaHolding.originalCurrency,
        quantity: alcoaHolding.quantity,
        currentPrice: alcoaHolding.currentPrice,
        currentValue: alcoaHolding.currentValue,
        originalPrice: alcoaHolding.originalPrice,
        conversionRate: alcoaHolding.conversionRate,
        lastUpdated: alcoaHolding.lastUpdated
      },
      conversionTest: {
        usdToEur: testConversion,
        eurToUsd: reverseConversion,
        exchangeRate: eurUsdRate
      },
      expectedValue: {
        usdValue: alcoaHolding.quantity * (alcoaHolding.originalPrice || alcoaHolding.currentPrice),
        eurValue: alcoaHolding.quantity * (alcoaHolding.originalPrice || alcoaHolding.currentPrice) * 0.859
      }
    };
  },

  // Targeted fix for Alcoa EUR conversion issue
  async 'debug.fixAlcoaEURConversion'() {
    const db = MongoInternals.defaultRemoteCollectionDriver().mongo.db;
    
    console.log('\n🎯 TARGETED ALCOA EUR FIX');
    console.log('========================');
    
    // 1. Find EUR account 72112407
    const eurAccount = await db.collection('bankAccounts').findOne({ 
      accountNumber: '72112407',
      referenceCurrency: 'EUR'
    });
    
    if (!eurAccount) {
      console.log('❌ EUR account 72112407 not found');
      return { error: 'EUR account 72112407 not found' };
    }
    
    console.log(`✅ Found EUR account: ${eurAccount.accountNumber} (ID: ${eurAccount._id})`);
    
    // 2. Find Alcoa holding in this EUR account
    const alcoaHolding = await db.collection('equityHoldings').findOne({
      bankAccountId: eurAccount._id,
      symbol: 'AA'
    });
    
    if (!alcoaHolding) {
      console.log('❌ No Alcoa holding found in EUR account');
      return { error: 'No Alcoa holding found in EUR account' };
    }
    
    console.log(`📊 Found Alcoa holding:`);
    console.log(`   currentValue: ${alcoaHolding.currentValue}`);
    console.log(`   currency: ${alcoaHolding.currency}`);
    console.log(`   quantity: ${alcoaHolding.quantity}`);
    console.log(`   currentPrice: ${alcoaHolding.currentPrice}`);
    
    // 3. Check if this needs fixing (is showing USD value in EUR account)
    if (Math.abs(alcoaHolding.currentValue - 8354.37) < 0.01) {
      console.log(`🎯 CONFIRMED: This is the problem holding showing 8354.37!`);
      
      // 4. Apply EUR conversion
      const usdToEurRate = 0.859; // Approximate current rate
      const correctedEurValue = alcoaHolding.currentValue * usdToEurRate;
      const correctedEurPrice = alcoaHolding.currentPrice * usdToEurRate;
      
      console.log(`🔄 Converting:`);
      console.log(`   ${alcoaHolding.currentValue} USD -> ${correctedEurValue.toFixed(2)} EUR`);
      console.log(`   Rate: ${usdToEurRate}`);
      
      // 5. Update the holding
      const updateResult = await db.collection('equityHoldings').updateOne(
        { _id: alcoaHolding._id },
        {
          $set: {
            currentValue: correctedEurValue,
            currentPrice: correctedEurPrice,
            totalCost: alcoaHolding.totalCost * usdToEurRate,
            averagePrice: alcoaHolding.averagePrice * usdToEurRate,
            totalReturn: (correctedEurValue - (alcoaHolding.totalCost * usdToEurRate)),
            originalPrice: alcoaHolding.currentPrice,
            originalCurrency: 'USD',
            conversionRate: usdToEurRate,
            lastUpdated: new Date(),
            fixedByTargetedMethod: true
          }
        }
      );
      
      console.log(`✅ Update result: modified ${updateResult.modifiedCount} document(s)`);
      
      return {
        success: true,
        action: 'converted',
        before: alcoaHolding.currentValue,
        after: correctedEurValue,
        rate: usdToEurRate
      };
    } else {
      console.log(`ℹ️  Current value ${alcoaHolding.currentValue} doesn't match expected problem value 8354.37`);
      return {
        success: true,
        action: 'no_change_needed',
        currentValue: alcoaHolding.currentValue
      };
    }
  },

  // Direct fix for the currency conversion issue
  async 'debug.directCurrencyFix'() {
    const db = MongoInternals.defaultRemoteCollectionDriver().mongo.db;
    
    console.log('\n🔧 DIRECT CURRENCY FIX');
    console.log('====================');
    
    // 1. Find EUR account
    const eurAccount = await db.collection('bankAccounts').findOne({ referenceCurrency: 'EUR' });
    if (!eurAccount) {
      return { error: 'No EUR account found' };
    }
    
    console.log(`Found EUR account: ${eurAccount.accountNumber} (${eurAccount._id})`);
    
    // 2. Get EUR/USD rate
    await CurrencyCache.refreshCurrencyRates(['EURUSD.FOREX']);
    const eurUsdRate = await CurrencyCache.getCachedRate('EURUSD.FOREX');
    const usdToEurRate = eurUsdRate && eurUsdRate.rate ? 1 / eurUsdRate.rate : 0.859;
    
    console.log(`Exchange rate: 1 USD = ${usdToEurRate.toFixed(4)} EUR`);
    
    // 3. Find ALL holdings in EUR account (regardless of currency field)
    const holdings = await db.collection('equityHoldings').find({ 
      bankAccountId: eurAccount._id
    }).toArray();
    
    console.log(`\nFound ${holdings.length} holdings in EUR account:`);
    holdings.forEach((h, i) => {
      console.log(`  ${i+1}. ${h.symbol} - currentValue: ${h.currentValue}, currency: ${h.currency}`);
    });
    
    let fixed = 0;
    for (const holding of holdings) {
      // Check if this looks like a USD value that needs conversion (around 8354)
      if (holding.currentValue > 8000 && holding.currentValue < 9000) {
        const usdValue = holding.currentValue;
        const eurValue = usdValue * usdToEurRate;
        
        console.log(`\n🔧 Converting ${holding.symbol}:`);
        console.log(`  Before: ${usdValue.toFixed(2)} (currency field: ${holding.currency})`);
        console.log(`  After:  ${eurValue.toFixed(2)} EUR`);
        
        // Update with converted values
        const result = await db.collection('equityHoldings').updateOne(
          { _id: holding._id },
          {
            $set: {
              currentValue: eurValue,
              currentPrice: holding.currentPrice * usdToEurRate,
              totalCost: holding.totalCost ? holding.totalCost * usdToEurRate : eurValue,
              averagePrice: holding.averagePrice ? holding.averagePrice * usdToEurRate : holding.currentPrice * usdToEurRate,
              totalReturn: holding.totalReturn ? holding.totalReturn * usdToEurRate : 0,
              originalPrice: holding.currentPrice,
              originalCurrency: 'USD',
              conversionRate: usdToEurRate,
              lastUpdated: new Date(),
              fixedByDirectMethod: true
            }
          }
        );
        
        console.log(`  Update result: modified ${result.modifiedCount} document(s)`);
        fixed++;
      } else {
        console.log(`\nSkipping ${holding.symbol}: currentValue ${holding.currentValue} outside range`);
      }
    }
    
    console.log(`\n✅ Fixed ${fixed} holdings`);
    
    return {
      success: true,
      accountNumber: eurAccount.accountNumber,
      exchangeRate: usdToEurRate,
      fixedCount: fixed,
      totalHoldings: holdings.length
    };
  },

  // SIMPLE FORCE FIX - Just fix the damn currency issue
  async 'debug.simpleForceFixCurrency'(sessionId = null) {
    check(sessionId, Match.Optional(String));
    
    console.log('\n🚨 SIMPLE FORCE FIX FOR CURRENCY ISSUE');
    console.log('====================================');
    
    try {
      // Get current EUR/USD rate (approximately 0.859)
      const EUR_USD_RATE = 0.8594; // Current approximate rate
      
      // Find EUR accounts
      const eurAccounts = await BankAccountsCollection.find({
        referenceCurrency: 'EUR'
      }).fetchAsync();
      
      const fixes = [];
      
      for (const account of eurAccounts) {
        // Find holdings with the specific problematic value (8354.37)
        const holdings = await EquityHoldingsCollection.find({
          bankAccountId: account._id,
          currentValue: { $gte: 8354, $lte: 8355 }
        }).fetchAsync();
        
        console.log(`Account ${account.accountNumber}: Found ${holdings.length} problematic holdings`);
        
        for (const holding of holdings) {
          const originalValue = holding.currentValue;
          const originalPrice = holding.currentPrice;
          
          // Convert USD to EUR
          const eurValue = originalValue * EUR_USD_RATE;
          const eurPrice = originalPrice * EUR_USD_RATE;
          
          // Update with converted values
          await EquityHoldingsCollection.updateAsync(holding._id, {
            $set: {
              currentValue: eurValue,
              currentPrice: eurPrice,
              currency: 'USD', // Stock is USD
              originalPrice: originalPrice,
              originalCurrency: 'USD', 
              conversionRate: EUR_USD_RATE,
              lastUpdated: new Date(),
              forcedFix: true
            }
          });
          
          fixes.push({
            symbol: holding.symbol,
            account: account.accountNumber,
            before: originalValue,
            after: eurValue,
            rate: EUR_USD_RATE
          });
          
          console.log(`✅ Fixed ${holding.symbol}: ${originalValue} → ${eurValue.toFixed(2)} EUR`);
        }
      }
      
      return {
        success: true,
        message: `Applied simple force fix to ${fixes.length} holdings`,
        fixes: fixes,
        rate: EUR_USD_RATE
      };
      
    } catch (error) {
      console.error('Error in simple force fix:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
});

// Equity Holdings publications
Meteor.publish('userBankAccounts', async function (sessionId = null) {
  check(sessionId, Match.Optional(String));
  
  // // console.log(`Bank accounts publication: Called with sessionId: ${sessionId}, this.userId: ${this.userId}`);
  
  try {
    let currentUser = null;
    
    // Try session-based authentication first, then fall back to this.userId
    if (sessionId) {
      try {
        currentUser = await Meteor.callAsync('auth.getCurrentUser', sessionId);
        // // console.log('Bank accounts publication: Got user from session:', currentUser ? { id: currentUser._id, username: currentUser.username, role: currentUser.role } : 'null');
      } catch (sessionError) {
        // // console.log('Bank accounts publication: Session auth failed:', sessionError.message);
        currentUser = null;
      }
    }
    
    // Fallback to this.userId if session auth failed
    if (!currentUser && this.userId) {
      currentUser = await UsersCollection.findOneAsync(this.userId);
      // // console.log('Bank accounts publication: Got user from this.userId:', currentUser ? { id: currentUser._id, username: currentUser.username, role: currentUser.role } : 'null');
    }
    
    if (!currentUser) {
      // // console.log('Bank accounts publication: No valid user found, returning empty');
      return this.ready();
    }

    // // console.log(`Bank accounts publication: User ${currentUser.username} (${currentUser.role}) requesting bank accounts`);

    // Role-based access control following structured products pattern
    let bankAccountQuery = {};

    switch (currentUser.role) {
      case USER_ROLES.SUPERADMIN:
      case USER_ROLES.ADMIN:
        // Admins can see all bank accounts
        bankAccountQuery = { isActive: true };
        // // console.log('Bank accounts publication: Admin access - returning all bank accounts');
        break;
        
      case USER_ROLES.RELATIONSHIP_MANAGER:
        // RMs can see bank accounts of their assigned clients + their own
        const rmClients = await UsersCollection.find({ 
          relationshipManagerId: currentUser._id,
          role: USER_ROLES.CLIENT 
        }).fetchAsync();
        
        const clientIds = rmClients.map(client => client._id);
        clientIds.push(currentUser._id); // Include RM's own bank accounts if any
        
        bankAccountQuery = { userId: { $in: clientIds }, isActive: true };
        // // console.log(`Bank accounts publication: RM access - returning bank accounts for ${clientIds.length} users`);
        break;
        
      case USER_ROLES.CLIENT:
        // Clients can only see their own bank accounts
        bankAccountQuery = { userId: currentUser._id, isActive: true };
        // // console.log('Bank accounts publication: Client access - returning own bank accounts only');
        break;
        
      default:
        // // console.log('Bank accounts publication: Unknown role, denying access');
        return this.ready();
    }

    // // console.log('Bank accounts publication: Using query:', bankAccountQuery);
    
    // Execute the query and log results
    const cursor = BankAccountsCollection.find(bankAccountQuery, {
      sort: { createdAt: -1 }
    });
    
    const accounts = await cursor.fetchAsync();
    // // console.log(`Bank accounts publication: Found ${accounts.length} accounts matching query`);
    // console.log('Bank accounts publication: Account details:', accounts.map(acc => ({ 
    //   id: acc._id, 
    //   userId: acc.userId, 
    //   accountNumber: acc.accountNumber, 
    //   isActive: acc.isActive 
    // })));
    
    // Double check what's in the database
    const dbCount = await BankAccountsCollection.find({ isActive: true }).countAsync();
    // // console.log(`Bank accounts publication: Total active accounts in DB: ${dbCount}`);
    
    // Log session validation result
    // console.log('Bank accounts publication: Session validation result:', {
    //   sessionId,
    //   userFound: !!currentUser,
    //   userRole: currentUser?.role,
    //   userId: currentUser?._id
    // });
    
    return cursor;

  } catch (error) {
    console.error('Bank accounts publication error:', error);
    return this.ready();
  }
});

// Simple publication for admin management - return all bank accounts like customUsers does
Meteor.publish('allBankAccounts', function () {
  console.log('allBankAccounts publication: Called with this.userId:', this.userId);
  
  try {
    // Return all active bank accounts for admin management (like customUsers publication)
    const cursor = BankAccountsCollection.find({ isActive: true }, {
      sort: { createdAt: -1 }
    });
    
    console.log('allBankAccounts publication: Returning all active bank accounts');
    return cursor;
    
  } catch (error) {
    console.error('allBankAccounts publication error:', error);
    return this.ready();
  }
});

Meteor.publish('equityHoldings', async function (bankAccountId, sessionId = null) {
  check(bankAccountId, String);
  check(sessionId, Match.Optional(String));
  
  // console.log(`[EQUITY PUB] Request - bankAccountId: ${bankAccountId}, sessionId: ${sessionId}, userId: ${this.userId}`);
  
  if (!this.userId && !sessionId) {
    // console.log('[EQUITY PUB] No authentication provided - returning empty');
    return this.ready();
  }

  try {
    // Get current user with session-based authentication
    const currentUser = sessionId ? 
      await Meteor.callAsync('auth.getCurrentUser', sessionId) : 
      await UsersCollection.findOneAsync(this.userId);
    
    // console.log('[EQUITY PUB] Current user:', currentUser?._id, 'Role:', currentUser?.role);
    
    if (!currentUser) {
      // console.log('[EQUITY PUB] No valid user found');
      return this.ready();
    }

    // First, verify the bank account exists and user has access to it
    const bankAccount = await BankAccountsCollection.findOneAsync(bankAccountId);
    if (!bankAccount) {
      // console.log('Equity holdings publication: Bank account not found');
      return this.ready();
    }

    // Role-based access control
    let hasAccess = false;

    switch (currentUser.role) {
      case USER_ROLES.SUPERADMIN:
      case USER_ROLES.ADMIN:
        // Admins can see all equity holdings
        hasAccess = true;
        break;
        
      case USER_ROLES.RELATIONSHIP_MANAGER:
        // RMs can see holdings of their assigned clients' bank accounts
        const bankAccountOwner = await UsersCollection.findOneAsync(bankAccount.userId);
        hasAccess = bankAccountOwner && (
          bankAccountOwner.relationshipManagerId === currentUser._id || 
          bankAccount.userId === currentUser._id
        );
        break;
        
      case USER_ROLES.CLIENT:
        // Clients can only see their own equity holdings
        hasAccess = bankAccount.userId === currentUser._id;
        break;
    }

    if (!hasAccess) {
      // console.log('Equity holdings publication: Access denied');
      return this.ready();
    }

    // console.log(`[EQUITY PUB] Access granted for bank account ${bankAccountId}`);
    const holdings = await EquityHoldingsCollection.find({ bankAccountId }).fetchAsync();
    // console.log(`[EQUITY PUB] Returning ${holdings.length} holdings`);
    return EquityHoldingsCollection.find({ bankAccountId });

  } catch (error) {
    console.error('Equity holdings publication error:', error);
    return this.ready();
  }
});

// ViewAs Filter Methods - Optimized for fast search
Meteor.methods({
  /**
   * Search for clients and bank accounts for ViewAs filter
   * Optimized method that only returns matching results (no heavy publications)
   */
  async 'viewAs.search'(searchTerm, sessionId) {
    check(searchTerm, String);
    check(sessionId, String);

    // Validate session and get user
    const session = await SessionHelpers.validateSession(sessionId);
    if (!session) {
      throw new Meteor.Error('not-authorized', 'Invalid or expired session');
    }

    const currentUser = await UsersCollection.findOneAsync(session.userId);
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }

    // Only admins and superadmins can use ViewAs filter
    if (currentUser.role !== USER_ROLES.ADMIN && currentUser.role !== USER_ROLES.SUPERADMIN) {
      throw new Meteor.Error('access-denied', 'Only admins can use ViewAs filter');
    }

    // If search term is empty, return empty results (don't load everything)
    if (!searchTerm || searchTerm.trim().length < 2) {
      return { clients: [], bankAccounts: [] };
    }

    const searchLower = searchTerm.trim().toLowerCase();
    const searchRegex = new RegExp(searchTerm.trim(), 'i');

    // Search clients (limit to 5 results for performance)
    const clients = await UsersCollection.find(
      {
        role: USER_ROLES.CLIENT,
        $or: [
          { email: searchRegex },
          { 'profile.firstName': searchRegex },
          { 'profile.lastName': searchRegex }
        ]
      },
      {
        limit: 5,
        fields: {
          email: 1,
          username: 1,
          role: 1,
          profile: 1,
          relationshipManagerId: 1,
          reportingCurrency: 1
        },
        sort: { 'profile.lastName': 1, 'profile.firstName': 1 }
      }
    ).fetchAsync();

    // Search bank accounts (limit to 5 results for performance)
    // Search by account number OR comment/description field
    const bankAccounts = await BankAccountsCollection.find(
      {
        isActive: true,
        $or: [
          { accountNumber: searchRegex },
          { comment: searchRegex }
        ]
      },
      {
        limit: 5,
        sort: { accountNumber: 1 }
      }
    ).fetchAsync();

    // Enhance bank accounts with user and bank info
    const enhancedAccounts = await Promise.all(
      bankAccounts.map(async (account) => {
        const user = await UsersCollection.findOneAsync(account.userId);
        const bank = await BanksCollection.findOneAsync(account.bankId);

        const userName = user ? `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() : 'Unknown';
        const userEmail = user?.email || '';

        // Also check if user name or email matches search
        const userMatches = userName.toLowerCase().includes(searchLower) ||
                           userEmail.toLowerCase().includes(searchLower);

        return {
          ...account,
          userName,
          userEmail,
          bankName: bank?.name || 'Unknown Bank',
          _matchedByUser: userMatches
        };
      })
    );

    // Also search for accounts by user name/email
    const userMatches = await UsersCollection.find(
      {
        role: USER_ROLES.CLIENT,
        $or: [
          { 'profile.firstName': searchRegex },
          { 'profile.lastName': searchRegex },
          { email: searchRegex }
        ]
      },
      {
        limit: 10,
        fields: { _id: 1 }
      }
    ).fetchAsync();

    if (userMatches.length > 0) {
      const userIds = userMatches.map(u => u._id);
      const accountsByUser = await BankAccountsCollection.find(
        {
          isActive: true,
          userId: { $in: userIds },
          _id: { $nin: bankAccounts.map(a => a._id) } // Exclude already found accounts
        },
        {
          limit: 5
        }
      ).fetchAsync();

      const enhancedUserAccounts = await Promise.all(
        accountsByUser.map(async (account) => {
          const user = await UsersCollection.findOneAsync(account.userId);
          const bank = await BanksCollection.findOneAsync(account.bankId);

          return {
            ...account,
            userName: user ? `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim() : 'Unknown',
            userEmail: user?.email || '',
            bankName: bank?.name || 'Unknown Bank',
            _matchedByUser: true
          };
        })
      );

      enhancedAccounts.push(...enhancedUserAccounts);
    }

    // Limit total accounts to 5
    const finalAccounts = enhancedAccounts.slice(0, 5);

    return {
      clients,
      bankAccounts: finalAccounts
    };
  }
});

// Server-side routing for shareable report URLs
WebApp.connectHandlers.use('/report', async (req, res, next) => {
  // Extract product ID from URL: /report/:productId
  const urlParts = req.url.split('/');
  if (urlParts.length !== 2 || !urlParts[1]) {
    return next(); // Let Meteor handle it
  }

  const productId = urlParts[1];

  try {
    // Verify the product exists
    const product = await ProductsCollection.findOneAsync(productId);
    if (!product) {
      // Product not found, let Meteor handle with 404
      return next();
    }

    // Product exists, let the client-side handle the route
    // This ensures the URL is valid and the product is accessible
    next();
  } catch (error) {
    console.error('Error validating product for shareable URL:', error);
    next(); // Let Meteor handle any errors
  }
});

// Server-side routing for termsheet file serving from persistent volume
import fs from 'fs';
import path from 'path';

WebApp.connectHandlers.use('/termsheets', async (req, res, next) => {
  // URL format: /termsheets/{filename} (flat structure)
  const urlParts = req.url.split('/').filter(p => p);

  // If we're in development (no TERMSHEETS_PATH), let Meteor serve from public/
  if (!process.env.TERMSHEETS_PATH) {
    return next();
  }

  if (urlParts.length !== 1) {
    return next();
  }

  const filename = urlParts[0];

  try {
    // Construct file path from TERMSHEETS_PATH (flat structure)
    const filePath = path.join(process.env.TERMSHEETS_PATH, filename);

    // Security: Prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(process.env.TERMSHEETS_PATH)) {
      console.error('⚠️  Security: Attempted directory traversal:', req.url);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`📄 Termsheet not found: ${filePath}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Termsheet not found');
      return;
    }

    // Read and serve the PDF file
    const fileBuffer = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': stat.size,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'public, max-age=86400' // Cache for 24 hours
    });

    res.end(fileBuffer);
    console.log(`📄 Served termsheet: ${filename} (${stat.size} bytes)`);

  } catch (error) {
    console.error('Error serving termsheet:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
});

// Server-side routing for client documents (fichier_central) from persistent volume
WebApp.connectHandlers.use('/fichier_central', async (req, res, next) => {
  // URL format: /fichier_central/{userId}/{filename}
  const urlParts = req.url.split('/').filter(p => p);

  // If we're in development (no FICHIER_CENTRAL_PATH), let Meteor serve from public/
  if (!process.env.FICHIER_CENTRAL_PATH) {
    return next();
  }

  if (urlParts.length !== 2) {
    return next();
  }

  const [userId, filename] = urlParts;

  try {
    // Construct file path from FICHIER_CENTRAL_PATH
    const filePath = path.join(process.env.FICHIER_CENTRAL_PATH, userId, filename);

    // Security: Prevent directory traversal
    const normalizedPath = path.normalize(filePath);
    if (!normalizedPath.startsWith(process.env.FICHIER_CENTRAL_PATH)) {
      console.error('Security: Attempted directory traversal:', req.url);
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`Document not found: ${filePath}`);
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Document not found');
      return;
    }

    // Read and serve the file
    const fileBuffer = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);

    // Determine content type from filename extension
    const ext = path.extname(filename).toLowerCase();
    const contentTypes = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif'
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Content-Disposition': `inline; filename="${filename}"`,
      'Cache-Control': 'private, max-age=3600' // Cache for 1 hour
    });

    res.end(fileBuffer);
    console.log(`Served client document: ${userId}/${filename} (${stat.size} bytes)`);

  } catch (error) {
    console.error('Error serving client document:', error);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal server error');
  }
});

// Trigger restart
