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


    populateProductTable: function() {
        if (!this.userId) {
          throw new Meteor.Error('not-authorized');
        }
        
        console.log('Populating product table for user:', this.userId);
        const expandedProducts = Meteor.call('getExpandedProducts');
        
        console.log(`Populated ${expandedProducts.length} products for the table`);
        
        return expandedProducts;
      },
    
    
});