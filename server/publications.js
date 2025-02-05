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

Meteor.publish('userProcessingStatus', function(userId) {
  if (!this.userId || this.userId !== userId) return this.ready();
  
  return Meteor.users.find(
    { _id: userId },
    { fields: { 'processingStatus': 1 } }
  );
});

Meteor.publish('products', function() {
  console.time('products-publication');
  console.log('Products publication starting...');
  
  // Exclude heavy fields (e.g. chart100) not used on the main page.
  const cursor = Products.find({}, { fields: { chart100: 0 } });
  
  console.log('Products cursor created, count:', cursor.count());
  console.timeEnd('products-publication');
  return cursor;
});

Meteor.publish('productDetails', function(isin) {
  check(isin, String);
  return Products.find({
    $or: [
      { "genericData.ISINCode": isin },
      { "ISINCode": isin }
    ]
  });
});

Meteor.publish('issuers', function() {
  return Issuers.find({});
});

Meteor.publish('singleProduct', function(productId) {
  check(productId, String);
  
  const product = Products.find(productId);
  if (!product) {
    this.ready();
    return;
  }
  return product;
});

Meteor.publish('singleIssuer', function(issuerId) {
  check(issuerId, String);
  
  const issuer = Issuers.find(issuerId);
  if (!issuer) {
    this.ready();
    return;
  }
  return issuer;
});

Meteor.publish('productByISIN', function(isin) {
  check(isin, String);
  
  return Products.find({
    'genericData.ISINCode': isin
  });
}); 