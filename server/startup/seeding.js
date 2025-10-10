// Demo Data Seeding
// Handles creation of demo accounts, sample data, and initial system setup

import { Meteor } from 'meteor/meteor';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { BanksCollection } from '/imports/api/banks';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { IssuersCollection, DEFAULT_ISSUERS } from '/imports/api/issuers';
import { TemplatesCollection } from '/imports/api/templates';
import { createTestData } from '../createTestData';

/**
 * Main seeding function - coordinates all demo data creation
 */
export async function seedDemoData() {
  console.log('[SEEDING] Starting demo data seeding...');
  
  try {
    // 1. Ensure demo accounts exist
    await ensureDemoAccounts();
    
    // 2. Create sample client users
    await createSampleClientUsers();
    
    // 3. Create default banks
    await createDefaultBanks();
    
    // 4. Create sample bank accounts
    await createSampleBankAccounts();
    
    // 5. Create additional admin test data
    await createAdminTestData();
    
    // 6. Create default issuers
    await createDefaultIssuers();
    
    // 7. Maintain built-in templates
    await maintainBuiltInTemplates();
    
    // 8. Create reverse convertible template
    await createReverseConvertibleTemplate();
    
    console.log('[SEEDING] ✅ Demo data seeding completed successfully');
    
  } catch (error) {
    console.error('[SEEDING] ❌ Error during demo data seeding:', error);
    throw error;
  }
}

/**
 * Ensure demo accounts exist (create or update existing users)
 */
async function ensureDemoAccounts() {
  try {
    const results = await Meteor.callAsync('users.ensureDemoAccounts');
    console.log('Demo accounts status:', results);
  } catch (error) {
    console.error('Error ensuring demo accounts:', error);
  }
}

/**
 * Create sample client users if none exist
 */
async function createSampleClientUsers() {
  try {
    const existingClients = await UsersCollection.find({ role: USER_ROLES.CLIENT }).countAsync();
    if (existingClients === 0) {
      // Create client users with proper profile structure
      const client1Id = await UsersCollection.insertAsync({
        username: 'client1',
        email: 'client1@test.com',
        role: USER_ROLES.CLIENT,
        profile: {
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1-555-0123',
          birthday: '1980-05-15'
        },
        createdAt: new Date()
      });

      const client2Id = await UsersCollection.insertAsync({
        username: 'client2', 
        email: 'client2@test.com',
        role: USER_ROLES.CLIENT,
        profile: {
          firstName: 'Jane',
          lastName: 'Smith',
          phone: '+1-555-0456',
          birthday: '1985-08-22'
        },
        createdAt: new Date()
      });

      const client3Id = await UsersCollection.insertAsync({
        username: 'client3',
        email: 'client3@test.com', 
        role: USER_ROLES.CLIENT,
        profile: {
          firstName: 'Bob',
          lastName: 'Johnson',
          phone: '+1-555-0789',
          birthday: '1975-12-03'
        },
        createdAt: new Date()
      });

      console.log('Created sample client users:', client1Id, client2Id, client3Id);
    }
  } catch (error) {
    console.error('Error creating sample clients:', error);
  }
}

/**
 * Create default banks if none exist
 */
async function createDefaultBanks() {
  if (await BanksCollection.find().countAsync() === 0) {
    const defaultBanks = [
      { name: 'UBS', city: 'Zurich', country: 'Switzerland', countryCode: 'CH' },
      { name: 'Credit Suisse', city: 'Zurich', country: 'Switzerland', countryCode: 'CH' },
      { name: 'Deutsche Bank', city: 'Frankfurt', country: 'Germany', countryCode: 'DE' },
      { name: 'BNP Paribas', city: 'Paris', country: 'France', countryCode: 'FR' },
      { name: 'Société Générale', city: 'Paris', country: 'France', countryCode: 'FR' }
    ];

    for (const bankData of defaultBanks) {
      const bankId = await BanksCollection.insertAsync({
        ...bankData,
        isActive: true,
        createdAt: new Date()
      });
      console.log(`Created bank: ${bankData.name} (${bankId})`);
    }
  } else {
    console.log('[SEEDING] Skipping default bank creation');
  }
}

/**
 * Create sample bank accounts for clients if none exist
 */
async function createSampleBankAccounts() {
  try {
    const existingBankAccounts = await BankAccountsCollection.find().countAsync();
    if (existingBankAccounts === 0) {
      // Get the first bank and clients
      const firstBank = await BanksCollection.findOneAsync({ isActive: true });
      const clients = await UsersCollection.find({ role: USER_ROLES.CLIENT }).fetchAsync();
      
      if (firstBank && clients.length > 0) {
        for (const client of clients.slice(0, 3)) { // Limit to first 3 clients
          const clientName = `${client.profile?.firstName || 'Unknown'} ${client.profile?.lastName || 'User'}`;
          
          // Create two accounts per client - USD and EUR
          const bankAccount1Id = await BankAccountsCollection.insertAsync({
            userId: client._id,
            bankId: firstBank._id,
            accountNumber: `${Math.floor(Math.random() * 1000000000)}`,
            accountType: 'Investment',
            referenceCurrency: 'USD',
            isActive: true,
            createdAt: new Date()
          });
          
          const bankAccount2Id = await BankAccountsCollection.insertAsync({
            userId: client._id,
            bankId: firstBank._id,
            accountNumber: `${Math.floor(Math.random() * 1000000000)}`,
            accountType: 'Investment', 
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
}

/**
 * Create additional test data for admin functionality
 */
async function createAdminTestData() {
  await createTestData();
}

/**
 * Create default issuers if none exist
 */
async function createDefaultIssuers() {
  if (await IssuersCollection.find().countAsync() === 0) {
    for (const issuer of DEFAULT_ISSUERS) {
      await IssuersCollection.insertAsync({
        ...issuer,
        createdAt: new Date()
      });
    }
    console.log(`Created ${DEFAULT_ISSUERS.length} default issuers`);
  } else {
    console.log('[SEEDING] Skipping default issuer creation');
  }
}

/**
 * Clear any existing built-in templates from database
 */
async function maintainBuiltInTemplates() {
  try {
    const deletedCount = await TemplatesCollection.removeAsync({ isBuiltIn: true });
    if (deletedCount > 0) {
      console.log(`Removed ${deletedCount} existing built-in templates from database`);
    }
  } catch (error) {
    console.error('Error removing built-in templates:', error);
  }
}

/**
 * Create the single generic Reverse Convertible template
 */
async function createReverseConvertibleTemplate() {
  // Check if template already exists
  const existingTemplate = await TemplatesCollection.findOneAsync({ 
    name: 'Reverse Convertible - Single Underlying' 
  });
  
  if (!existingTemplate) {
    const reverseConvertibleTemplate = {
      name: 'Reverse Convertible - Single Underlying',
      description: 'European barrier reverse convertible with capital protection threshold. Coupon paid in any case, capital protection depends on barrier breach at maturity.',
      category: 'Capital Protection',
      structure: [
        {
          type: 'basket',
          column: 'underlyings',
          section: 'life',
          value: 'Single underlying',
          sortOrder: 0,
          rowIndex: 0,
          id: 'basket-0'
        },
        // Add more structure components as needed...
      ],
      tags: ['reverse convertible', 'capital protection', 'coupon', 'barrier'],
      isBuiltIn: false,
      createdAt: new Date(),
      version: '1.0.0'
    };
    
    try {
      const templateId = await TemplatesCollection.insertAsync(reverseConvertibleTemplate);
      console.log(`Created Reverse Convertible template: ${templateId}`);
    } catch (error) {
      console.log('Reverse Convertible template already exists');
    }
  } else {
    console.error('Error creating Reverse Convertible template:', error);
  }
}