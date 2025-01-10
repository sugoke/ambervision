// /server/methods/updateProducts.js
import { Meteor } from 'meteor/meteor';
import { Products } from '/imports/api/products/products.js'; // Adjust the import path as necessary
import { Historical } from '/imports/api/products/products.js'; // Adjust the import path as necessary
import { HTTP } from 'meteor/http';
import { Random } from 'meteor/random';
import { check } from 'meteor/check';

import { Mongo } from 'meteor/mongo';


import { Holdings } from '/imports/api/products/products.js';

Meteor.methods({
  'searchClients'(searchTerm) {
    // Ensure user is logged in and is superAdmin
    const currentUser = Meteor.users.findOne(this.userId);
    console.log('Search clients - Current user:', {
      userId: this.userId,
      user: currentUser,
      role: currentUser?.profile?.role,
      isSuperAdmin: currentUser?.profile?.role === 'superAdmin'
    });

    // Check if user exists and has superAdmin role
    if (!currentUser) {
      throw new Meteor.Error('not-authorized', 'User not found');
    }
    
    if (currentUser.profile?.role !== 'superAdmin') {
      throw new Meteor.Error('not-authorized', 'User is not a superAdmin');
    }

    // Ensure searchTerm is a string and has minimum length
    check(searchTerm, String);
    if (searchTerm.length < 2) {
      return [];
    }

    // Create a regex for case-insensitive search
    const searchRegex = new RegExp(searchTerm, 'i');

    // Search query with corrected path to bankAccounts
    const query = {
      $or: [
        { username: searchRegex },
        { 'profile.bankAccounts.accountNumber': searchTerm },
        { 'profile.bankAccounts.bank': searchRegex }
      ]
    };

    console.log('Search query:', query);

    const results = Meteor.users.find(query).fetch();
    console.log('Search results:', results.length);

    // Process and return results with corrected path to bankAccounts
    const processedResults = results.map(user => ({
      _id: user._id,
      username: user.username,
      bankAccounts: user.profile?.bankAccounts || []
    }));

    console.log('Processed results:', processedResults.length);
    return processedResults;
  }
});
