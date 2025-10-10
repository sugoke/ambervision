import { Mongo } from 'meteor/mongo';

export const IssuersCollection = new Mongo.Collection('issuers');

// Default issuers to seed the database
export const DEFAULT_ISSUERS = [
  { name: 'Goldman Sachs', code: 'GS', active: true },
  { name: 'JP Morgan', code: 'JPM', active: true },
  { name: 'Morgan Stanley', code: 'MS', active: true },
  { name: 'Bank of America', code: 'BAC', active: true },
  { name: 'Citigroup', code: 'C', active: true },
  { name: 'Credit Suisse', code: 'CS', active: true },
  { name: 'UBS', code: 'UBS', active: true },
  { name: 'Deutsche Bank', code: 'DB', active: true },
  { name: 'Barclays', code: 'BARC', active: true },
  { name: 'BNP Paribas', code: 'BNP', active: true },
  { name: 'Société Générale', code: 'SG', active: true },
  { name: 'HSBC', code: 'HSBC', active: true },
  { name: 'RBC Capital Markets', code: 'RBC', active: true },
  { name: 'BMO Capital Markets', code: 'BMO', active: true },
  { name: 'TD Securities', code: 'TD', active: true }
];

// Helper functions for issuer management
export const IssuerHelpers = {
  // Get active issuers sorted by name
  getActiveIssuers() {
    return IssuersCollection.find(
      { active: true }, 
      { sort: { name: 1 } }
    ).fetch();
  },

  // Get all issuers sorted by name
  getAllIssuers() {
    return IssuersCollection.find(
      {}, 
      { sort: { name: 1 } }
    ).fetch();
  },

  // Check if issuer code already exists
  async codeExists(code, excludeId = null) {
    const query = { code: code.toUpperCase() };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }
    return await IssuersCollection.findOneAsync(query) !== undefined;
  },

  // Check if issuer name already exists
  async nameExists(name, excludeId = null) {
    const query = { name: new RegExp(`^${name}$`, 'i') };
    if (excludeId) {
      query._id = { $ne: excludeId };
    }
    return await IssuersCollection.findOneAsync(query) !== undefined;
  }
};