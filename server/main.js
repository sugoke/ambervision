import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
// /server/main.js
import '/imports/api/products/server/publications.js';

import '/server/methods/updateProducts.js';
import '/server/methods/updateTickers.js';

import { Products } from '/imports/api/products/products.js';

import { Tickers } from '/imports/api/products/products.js';


// Server side
Meteor.publish('productByISIN', function(ISINCode) {
  return Products.find({"genericInformation.ISINCode": ISINCode});
});

/*
Meteor.publish('tickers', function() {
  return Tickers.find({});
});
*/


Meteor.methods({
  'searchTickersByName'(name) {
    check(name, String);

    const regex = new RegExp(name, 'i');
    const tickers = Tickers.find({
      Name: regex
      // Optionally, you can filter by Type to exclude certain types.
    }, {
      limit: 10,
      fields: { Code: 1, Name: 1, Country: 1, Exchange: 1, Currency: 1  } // Include Country in the fields to return
    }).fetch();

    return tickers;
  },
  // Server: Method to fetch the last closing price
  'getTickerClosingPrice'(symbolWithExchange) {
    this.unblock();
    console.log("Fetching closing price for symbol with exchange:", symbolWithExchange);
    const url = `https://eodhd.com/api/eod/${symbolWithExchange}?filter=last_close&api_token=5c265eab2c9066.19444326&fmt=json`;

    try {
      const result = HTTP.get(url);
      // Assuming the API returns a simple number for the last close, wrap it in an object
      const data = { close: JSON.parse(result.content), date: new Date().toISOString().split('T')[0] }; // Use current date as no date is returned
      console.log("API call result:", data);
      return [data]; // Wrap in an array to match client-side expectations
    } catch (error) {
      console.error("Failed to fetch ticker closing price for", symbolWithExchange, ":", error);
      throw new Meteor.Error('api-call-failed', 'Failed to fetch ticker closing price');
    }
  }




});
