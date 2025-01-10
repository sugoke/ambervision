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



    getExpandedProducts: function() {
        if (!this.userId) {
          throw new Meteor.Error('not-authorized');
        }
    
        console.log(`Getting expanded products for user: ${this.userId}`);
    
        const holdings = Holdings.find({ userId: this.userId }).fetch();
        console.log(`Found ${holdings.length} holdings for user`);
    
        if (holdings.length === 0) {
          console.log('No holdings found, returning empty array');
          return [];
        }
    
        const productIsins = [...new Set(holdings.map(h => h.isin))];
        console.log(`Unique ISINs from holdings: ${productIsins.join(', ')}`);
    
        const user = Meteor.users.findOne(this.userId);
        const bankAccounts = user.profile.bankAccounts || [];
        console.log(`User has ${bankAccounts.length} bank accounts`);
    
        const products = Products.find({ ISINCode: { $in: productIsins } }).fetch();
        console.log(`Found ${products.length} products matching user's holdings`);
    
        const expandedProducts = [];
        products.forEach(product => {
          const productHoldings = holdings.filter(h => h.isin === product.ISINCode);
          productHoldings.forEach(holding => {
            const bankAccount = bankAccounts.find(acc => acc._id === holding.bankAccountId);
            expandedProducts.push({
              ...product,
              bankAccount: bankAccount ? `${bankAccount.bank} (${bankAccount.country})` : 'N/A',
              nominalInvested: holding.size,
              _id: `${product._id}_${holding._id}`
            });
          });
        });
    
        console.log(`Returning ${expandedProducts.length} expanded products`);
        return expandedProducts;
      },
    
});