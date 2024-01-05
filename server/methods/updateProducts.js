// /server/methods/updateProducts.js
import { Meteor } from 'meteor/meteor';
import { Products } from '/imports/api/products/products.js'; // Adjust the import path as necessary



Meteor.methods({
  'updateAllProducts'() {
    // Future logic to update all products will go here

console.log("yes")

// list all Underlyings


const tickers = {};

  const products = Products.find().fetch();
  products.forEach(product => {
    if (product.underlyings && Array.isArray(product.underlyings)) {
      product.underlyings.forEach(underlying => {
        if (underlying.ticker) {
          tickers[underlying.ticker] = true; // Store the ticker
        }
      });
    }
  });

  return Object.keys(tickers); // Return an array of unique tickers
}


  
});
