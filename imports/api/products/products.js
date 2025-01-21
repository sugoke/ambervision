import { Meteor } from 'meteor/meteor';
import { Mongo } from 'meteor/mongo';

// Define collections
export const Products = new Mongo.Collection('products');
export const Holdings = new Mongo.Collection('holdings');
export const Historical = new Mongo.Collection('historical');
export const Prices = new Mongo.Collection('prices');
export const Tickers = new Mongo.Collection('tickers');
export const Risk = new Mongo.Collection('risk');
export const Schedules = new Mongo.Collection('schedules');

// Allow/deny rules if needed
if (Meteor.isServer) {
  Products.rawCollection().createIndex(
    { "genericData.ISINCode": 1 },
    { unique: true }
  );
  
  Tickers._ensureIndex({ "symbol": 1 }, { unique: true });
}

// Export collections object for convenience
export const Collections = {
  Products,
  Holdings,
  Historical,
  Prices,
  Tickers,
  Risk,
  Schedules
};

try {
  Products.insert(productData);
} catch (error) {
  if (error.code === 11000) {
    throw new Meteor.Error('duplicate-isin', 'Product with this ISIN already exists');
  }
  throw error;
}

