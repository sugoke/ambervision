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

Meteor.methods({



    'products.upsert'(productData) {


        // Additional server-side validation can be added here
    
        const existingProduct = Products.findOne({ ISINCode: productData.ISINCode });
    
        if (existingProduct) {
          // Update existing product
          return Products.update({ _id: existingProduct._id }, { $set: productData });
        } else {
          // Insert new product
          return Products.insert(productData);
        }
      },
    
});