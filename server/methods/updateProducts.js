// /server/methods/updateProducts.js
import { Meteor } from 'meteor/meteor';
import { Products } from '/imports/api/products/products.js'; // Adjust the import path as necessary
import { Historical } from '/imports/api/products/products.js'; // Adjust the import path as necessary
import { HTTP } from 'meteor/http';
import { Random } from 'meteor/random';
import { check } from 'meteor/check';
import { Match } from 'meteor/check';
import { Mongo } from 'meteor/mongo';

import { Holdings } from '/imports/api/products/products.js';



//############################################################################################################################################

Meteor.methods({


});

// Function to replace dots in keys
function replaceDotsInKeys(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(replaceDotsInKeys);
  }

  return Object.keys(obj).reduce((acc, key) => {
    const newKey = key.replace(/\./g, '_');
    acc[newKey] = replaceDotsInKeys(obj[key]);
    return acc;
  }, {});
}