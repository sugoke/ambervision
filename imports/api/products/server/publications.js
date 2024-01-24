// /imports/api/products/server/publications.js
import { Meteor } from 'meteor/meteor';
import { Products } from '../products.js';
import { Historical } from '../products.js'; 

Meteor.publish('products', function publishProducts() {
  return Products.find();
});


Meteor.publish('historicalData', function publishHistoricalData() {
  return Historical.find();
});
