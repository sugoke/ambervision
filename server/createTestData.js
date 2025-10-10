import { Meteor } from 'meteor/meteor';
import { BankAccountsCollection } from '/imports/api/bankAccounts';
import { BanksCollection } from '/imports/api/banks';
import { UsersCollection, USER_ROLES } from '/imports/api/users';
import { EquityHoldingsCollection } from '/imports/api/equityHoldings';

// Create test data for admin view
export const createTestData = async () => {
  console.log('=== Creating test data for admin view ===');
  
  try {
    // Get banks
    const banks = await BanksCollection.find({ isActive: true }).fetchAsync();
    console.log(`Found ${banks.length} banks`);
    if (banks.length === 0) {
      console.log('No banks found. Cannot create test data.');
      return;
    }
    
    // Get users
    const clients = await UsersCollection.find({ role: USER_ROLES.CLIENT }).fetchAsync();
    const admins = await UsersCollection.find({ 
      $or: [{ role: USER_ROLES.ADMIN }, { role: USER_ROLES.SUPERADMIN }] 
    }).fetchAsync();
    
    console.log(`Found ${clients.length} clients and ${admins.length} admins`);
    console.log('Clients:', clients.map(c => ({ id: c._id, username: c.username, role: c.role })));
    console.log('Admins:', admins.map(a => ({ id: a._id, username: a.username, role: a.role })));
    
    // Create sample bank accounts and holdings for clients if they don't exist
    for (const client of clients) {
      const existingAccounts = await BankAccountsCollection.find({ userId: client._id }).countAsync();
      
      if (existingAccounts === 0) {
        console.log(`Creating bank accounts for client: ${client.username}`);
        
        // Create bank account for client
        const clientName = client.username || client._id.substring(0, 8);
        const bankAccountId = await BankAccountsCollection.insertAsync({
          userId: client._id,
          bankId: banks[0]._id,
          accountNumber: `${clientName.toUpperCase()}-TEST-001`,
          referenceCurrency: 'USD',
          isActive: true,
          createdAt: new Date()
        });
        
        console.log(`Created bank account ${bankAccountId} for ${clientName}`);
        
        // Create some sample equity holdings
        const sampleHoldings = [
          {
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
              notes: 'Initial purchase'
            }]
          },
          {
            symbol: 'MSFT',
            exchange: 'NASDAQ',
            fullTicker: 'MSFT.NASDAQ',
            companyName: 'Microsoft Corporation',
            sector: 'Technology',
            currency: 'USD',
            quantity: 50,
            averagePrice: 300.00,
            currentPrice: 320.00,
            totalCost: 15000,
            currentValue: 16000,
            totalReturn: 1000,
            totalReturnPercent: 6.67,
            dayChange: 100,
            dayChangePercent: 0.63,
            purchaseDate: new Date('2024-02-01'),
            lastUpdated: new Date(),
            transactions: [{
              type: 'BUY',
              quantity: 50,
              price: 300.00,
              amount: 15000,
              fees: 9.95,
              date: new Date('2024-02-01'),
              notes: 'Diversification purchase'
            }]
          }
        ];
        
        for (const holding of sampleHoldings) {
          const holdingId = await EquityHoldingsCollection.insertAsync({
            ...holding,
            userId: client._id,
            bankAccountId: bankAccountId,
            accountNumber: `${clientName.toUpperCase()}-TEST-001`
          });
          console.log(`Created holding ${holdingId} for ${holding.symbol}`);
        }
      }
    }
    
    // Create a bank account for admin users to test functionality
    for (const admin of admins) {
      const existingAccounts = await BankAccountsCollection.find({ userId: admin._id }).countAsync();
      
      if (existingAccounts === 0) {
        console.log(`Creating test bank account for admin: ${admin.username}`);
        
        const adminName = admin.username || admin._id.substring(0, 8);
        const bankAccountId = await BankAccountsCollection.insertAsync({
          userId: admin._id,
          bankId: banks[0]._id,
          accountNumber: `${adminName.toUpperCase()}-ADMIN-001`,
          referenceCurrency: 'USD',
          isActive: true,
          createdAt: new Date()
        });
        
        console.log(`Created admin test bank account ${bankAccountId}`);
        
        // Create one sample holding for admin
        const adminHolding = {
          userId: admin._id,
          bankAccountId: bankAccountId,
          accountNumber: `${adminName.toUpperCase()}-ADMIN-001`,
          symbol: 'GOOGL',
          exchange: 'NASDAQ',
          fullTicker: 'GOOGL.NASDAQ',
          companyName: 'Alphabet Inc.',
          sector: 'Technology',
          currency: 'USD',
          quantity: 25,
          averagePrice: 2500.00,
          currentPrice: 2650.00,
          totalCost: 62500,
          currentValue: 66250,
          totalReturn: 3750,
          totalReturnPercent: 6.00,
          dayChange: 375,
          dayChangePercent: 0.57,
          purchaseDate: new Date('2024-03-01'),
          lastUpdated: new Date(),
          transactions: [{
            type: 'BUY',
            quantity: 25,
            price: 2500.00,
            amount: 62500,
            fees: 15.00,
            date: new Date('2024-03-01'),
            notes: 'Admin test holding'
          }]
        };
        
        const holdingId = await EquityHoldingsCollection.insertAsync(adminHolding);
        console.log(`Created admin test holding ${holdingId} for GOOGL`);
      }
    }
    
    console.log('Test data creation completed successfully!');
    
  } catch (error) {
    console.error('Error creating test data:', error);
  }
};