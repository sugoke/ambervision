// /server/methods/updateProducts.js
import { Meteor } from 'meteor/meteor';

import { Random } from 'meteor/random';
import { check } from 'meteor/check';




Meteor.methods({

    'user.addBankAccount'(userId, bank, country, accountNumber, refCurrency) {
        console.log('user.addBankAccount method called with params:', { userId, bank, country, accountNumber, refCurrency });
        
        check(userId, String);
        check(bank, String);
        check(country, String);
        check(accountNumber, String);
        check(refCurrency, String);
    
        if (!this.userId) {
            console.log('Not authorized: this.userId is falsy');
            throw new Meteor.Error('Not authorized');
        }
    
        const newBankAccount = {
            _id: Random.id(),
            bank,
            country,
            accountNumber,
            refCurrency,
            addedAt: new Date()
        };
    
        console.log('Updating user document for userId:', userId);
        Meteor.users.update(userId, {
            $push: {
                'profile.bankAccounts': newBankAccount
            }
        });
        console.log('Bank account added successfully for userId:', userId);
        return newBankAccount._id;
      },
    
});