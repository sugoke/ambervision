import { Holdings } from '/imports/api/products/products.js';

if (Meteor.isServer) {
  // Create indexes
  Meteor.startup(() => {
    Holdings.createIndex({ userId: 1 });
    Holdings.createIndex({ productId: 1 });
    Holdings.createIndex({ isin: 1 });
  });
}

export { Holdings }; 