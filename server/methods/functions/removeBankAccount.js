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

    removeBankAccount(accountId, userId) {
        console.log('removeBankAccount method called with params:', { accountId, userId });
        
        check(accountId, String);
        console.log('accountId checked:', accountId);
        
        if (!userId) {
          console.log('User not authorized: userId is falsy');
          throw new Meteor.Error('not-authorized');
        }
        console.log('User authorized, proceeding with bank account removal');
    
        // Assuming the bank accounts are stored in the user's profile
        console.log('Attempting to remove bank account for user:', userId);
        const result = Meteor.users.update(
          { _id: userId },
          { $pull: { 'profile.bankAccounts': { _id: accountId } } }
        );
        console.log('Update operation result:', result);
    
        if (result === 1) {
          console.log('Bank account successfully removed');
        } else {
          console.log('Bank account removal failed or no matching account found');
        }
      },
    
});