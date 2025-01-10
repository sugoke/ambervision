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
  'updateProduct'(productId, productData) {
    check(productId, String);
    check(productData, Object);

    // Only keep basic auth check
    if (!this.userId) {
      throw new Meteor.Error('not-authorized', 'You must be logged in to update a product');
    }

    // Perform the update or insert operation
    const existingProduct = Products.findOne(productId);

    if (existingProduct) {
      // Update existing product
      Products.update(productId, { $set: productData });
    } else {
      // Insert new product with the given ID
      Products.insert({ _id: productId, ...productData });
    }

    return 'Product updated successfully';
  },
});
