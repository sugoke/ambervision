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






    'debugProductsCollection'() {
        const totalCount = Products.find().count();
        const sampleProducts = Products.find({}, { limit: 5 }).fetch();
        console.log('Total products in collection:', totalCount);
        console.log('Sample products:', sampleProducts);
        return { totalCount, sampleProducts };
      }
    
});