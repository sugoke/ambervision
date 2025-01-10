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


    'admin.createUser'({ email, role, password }) {
        check(email, String);
        check(role, String);
        check(password, String);
        if (!this.userId) {
          throw new Meteor.Error('not-authorized', 'You must be logged in to perform this action.');
        }
        const userId = Accounts.createUser({ email, password, username: email });
        // Note: We're not setting roles here since we don't have a roles system yet
        return userId;
      },
      
});