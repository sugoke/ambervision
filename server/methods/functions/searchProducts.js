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

    searchProducts(query) {
        console.log('searchProducts method called with query:', query);
        
        // Ensure the query is a string and trim it
        query = (typeof query === 'string') ? query.trim() : '';
        
        if (query.length < 2) {
            console.log('Query too short, returning empty array');
            return [];
        }

        const regexPattern = new RegExp(query, 'i');
        console.log('Regex pattern:', regexPattern);

        const searchCriteria = {
            $or: [
                { 'genericData.ISINCode': regexPattern },
                { 'genericData.name': regexPattern }
            ]
        };

        console.log('Search criteria:', JSON.stringify(searchCriteria));

        const results = Products.find(searchCriteria, { limit: 10 }).fetch();
        
        console.log('Search results count:', results.length);
        console.log('Search results:', results.map(r => ({ 
            id: r._id, 
            isin: r.genericData.ISINCode, 
            name: r.genericData.name 
        })));

        return results;
    },
    
});