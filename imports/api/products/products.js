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

// Drop existing index if it exists
Meteor.startup(() => {
  if (Meteor.isServer) {
    try {
      Products.rawCollection().dropIndex("genericData.ISINCode_1")
        .catch(error => {
          // Ignore error if index doesn't exist
          if (error.code !== 27) {
            console.error('Error dropping index:', error);
          }
        })
        .then(() => {
          // Create new index
          Products.createIndex({ "genericData.ISINCode": 1 }, { 
            unique: true,
            background: true,
            name: "isin_unique_index" 
          });
        });
    } catch (error) {
      console.error('Index management error:', error);
    }
  }
});

// Allow/deny rules if needed
if (Meteor.isServer) {
  Tickers._ensureIndex({ "symbol": 1 }, { unique: true });
  Products._ensureIndex({ 'genericData.ISINCode': 1 });
  Products._ensureIndex({ 'ISINCode': 1 });
  Products._ensureIndex({ 'status': 1 });
  Products._ensureIndex({ 'genericData.ISINCode': 1, 'status': 1 });
  
  // Compound index for common queries
  Products._ensureIndex({
    'genericData.ISINCode': 1,
    'status': 1,
    'genericData.template': 1
  });
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

export const insertProduct = (productData) => {
  try {
    return Products.insert(productData);
  } catch (error) {
    if (error.code === 11000) {
      throw new Meteor.Error('duplicate-isin', 'Product with this ISIN already exists');
    }
    throw error;
  }
};

