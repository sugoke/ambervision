// /server/methods/updateProducts.js
import {
  Meteor
} from 'meteor/meteor';
import {
  Products
} from '/imports/api/products/products.js'; // Adjust the import path as necessary
import {
  Historical
} from '/imports/api/products/products.js'; // Adjust the import path as necessary
//export const Historical = new Mongo.Collection('historical');

import {
  HTTP
} from 'meteor/http';

//import { Historical } from '/imports/api/historical/historical.js';


//############################################################################################################

function fillMissingData(historicalData) {
  if (historicalData.length === 0) {
    return historicalData;
  }

  // Assuming data is sorted by date in ascending order
  let lastData = historicalData[0];
  const filledData = [lastData];

  // Start from the second element
  for (let i = 1; i < historicalData.length; i++) {
    const currentDate = new Date(historicalData[i].date);
    let previousDate = new Date(lastData.date);

    while (addDays(previousDate, 1) < currentDate) {
      // Create a new object with the same data but a different date
      previousDate = addDays(previousDate, 1);
      const newData = {
        ...lastData,
        date: formatDate(previousDate)
      };
      filledData.push(newData);
    }

    filledData.push(historicalData[i]);
    lastData = historicalData[i];
  }

  return filledData;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date) {
  return date.toISOString().split('T')[0];
}



//############################################################################################################


Meteor.methods({
  'updateAllMarketData'() {
    console.log("Starting the updateAllProducts method");

    // List all Underlyings
    const tickers = {};
    const products = Products.find().fetch();
    console.log(`Found ${products.length} products`);

    products.forEach((product, index) => {
      if (product.underlyings && Array.isArray(product.underlyings)) {
        console.log(`Processing product ${index + 1} with ${product.underlyings.length} underlyings`);
        product.underlyings.forEach(underlying => {
          if (underlying.ticker) {
            tickers[underlying.ticker] = true; // Store the ticker
            console.log(`Added ticker: ${underlying.ticker}`);
          }
        });
      }
    });

    console.log(`Tickers found: ${Object.keys(tickers).join(', ')}`);

    // Fetch and update historical data for each ticker
    Object.keys(tickers).forEach(ticker => {
      try {
        console.log(`Fetching historical data for ticker: ${ticker}`);

        // Always start from '2024-01-01'
        let startDate = '2023-01-01';
        console.log(`Fetching data for ${ticker}, starting from ${startDate}`);

        const apiUrl = `https://eodhd.com/api/eod/${ticker}?api_token=5c265eab2c9066.19444326&fmt=json&from=${startDate}`;
        const response = HTTP.get(apiUrl);
        let historicalData = response.data;
        console.log(`Fetched ${historicalData.length} records for ticker: ${ticker}`);

        // Fill in missing data
        historicalData = fillMissingData(historicalData);

        // Update or insert historical data for each ticker
        const existingDocument = Historical.findOne({
          ticker: ticker
        });

        if (existingDocument) {
          // Append new data to existing document
          Historical.update({
            ticker: ticker
          }, {
            $push: {
              data: {
                $each: historicalData
              }
            }
          });
        } else {
          // Create new document for the ticker
          Historical.insert({
            ticker: ticker,
            data: historicalData
          });
        }

      } catch (error) {
        console.error(`Error fetching historical data for ${ticker}:`, error);
      }
    });

    console.log("Product update process complete");
    return "Product update process complete";
  }
});
