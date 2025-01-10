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

    'admin.deleteUser'(userId) {
        check(userId, String);
        if (!this.userId) {
          throw new Meteor.Error('not-authorized', 'You must be logged in to perform this action.');
        }
        Meteor.users.remove(userId);
      },
    
});