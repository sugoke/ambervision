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

    'holdings.insert'(formData) {
        // Check if user is logged in
        if (!this.userId) {
            throw new Meteor.Error('not-logged-in', 'You must be logged in to add holdings');
        }

        // Get the current user
        const currentUser = Meteor.users.findOne(this.userId);
        
        // Check if user is superAdmin or trying to add for themselves
        if (!currentUser?.profile?.role === 'superAdmin' && formData.userId !== this.userId) {
            throw new Meteor.Error('not-authorized', 'You can only add holdings for yourself');
        }

        // Validate the data
        check(formData, {
            userId: String,
            isin: String,
            productId: String,
            quantity: Number,
            purchasePrice: Number,
            purchaseDate: Date,
            bankAccountId: String
        });

        // Insert the holding
        return Holdings.insert({
            ...formData,
            createdAt: new Date()
        });
    },
});
