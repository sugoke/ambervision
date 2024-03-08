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
  'products.upsert'(productData) {
    const { isEditMode, isinCodeQueryParam, genericInformation, underlyings, observations } = productData;

    // Remove properties not part of the product schema
    delete productData.isEditMode;
    delete productData.isinCodeQueryParam;

    if (isEditMode) {
      // Assuming the ISIN code in query param is used to find the existing product
      const existingProduct = Products.findOne({ 'genericInformation.ISINCode': isinCodeQueryParam });

      if (!existingProduct) {
        throw new Meteor.Error('product-not-found', 'No product found with the specified ISIN code for update.');
      }

      // Update scenario
      // If ISIN is being modified, ensure it's unique
      if (genericInformation.ISINCode !== isinCodeQueryParam) {
        const isinConflict = Products.findOne({
          'genericInformation.ISINCode': genericInformation.ISINCode,
          '_id': { $ne: existingProduct._id }
        });

        if (isinConflict) {
          throw new Meteor.Error('isin-conflict', 'Another product with the same ISIN code already exists.');
        }
      }

      Products.update(existingProduct._id, {
        $set: {
          genericInformation,
          underlyings,
          observations
        }
      });

      return { status: 'updated', productId: existingProduct._id };
    } else {
      // Insert scenario
      // Ensure ISIN code uniqueness
      const existingProductByISIN = Products.findOne({
        'genericInformation.ISINCode': genericInformation.ISINCode
      });

      if (existingProductByISIN) {
        throw new Meteor.Error('isin-conflict', 'A product with this ISIN code already exists.');
      }

      const productId = Products.insert({
        genericInformation,
        underlyings,
        observations
      });

      return { status: 'inserted', productId: productId };
    }
  }
});
