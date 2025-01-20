import { Products } from '/imports/api/products/products.js';
import { Issuers } from '/imports/api/issuers/issuers.js';

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

Meteor.publish('issuers', function() {
  return Issuers.find({});
});

Meteor.publish('userProcessingStatus', function(userId) {
  if (!this.userId || this.userId !== userId) return this.ready();
  
  return Meteor.users.find(
    { _id: userId },
    { fields: { 'processingStatus': 1 } }
  );
}); 