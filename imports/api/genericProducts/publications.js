import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { GenericProductsCollection, GenericProductReportsCollection } from './collections.js';

if (Meteor.isServer) {
  Meteor.publish('genericProducts.list', function () {
    return GenericProductsCollection.find({}, { sort: { lastUpdated: -1 } });
  });

  Meteor.publish('genericProducts.byId', function (productId) {
    check(productId, String);
    return GenericProductsCollection.find({ _id: productId });
  });

  Meteor.publish('genericProductReports.forProduct', function (productId) {
    check(productId, String);
    return GenericProductReportsCollection.find(
      { productId },
      { sort: { createdAt: -1 }, limit: 20 }
    );
  });
}
