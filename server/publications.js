import { Products } from '/imports/api/products/products.js';

Meteor.publish('searchProducts', function(query) {
  check(query, String);
  
  if (!query || query.length < 2) return this.ready();
  
  const regex = new RegExp(query, 'i');
  return Products.find({
    $or: [
      { ISINCode: regex },
      { name: regex },
      { 'underlyings.ticker': regex },
      { 'underlyings.name': regex }
    ]
  }, { 
    limit: 10,
    fields: {
      name: 1,
      ISINCode: 1,
      underlyings: 1,
      'genericData.name': 1,
      'genericData.currency': 1
    }
  });
}); 