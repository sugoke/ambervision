
import { Meteor } from 'meteor/meteor';
import { Products } from '/imports/api/products/products.js'; // Adjust the import path as necessary



Meteor.methods({

    checkProductsCollection() {
        const totalProducts = Products.find().count();
        const sampleProducts = Products.find({}, { limit: 5 }).fetch();
        console.log("Total products in collection:", totalProducts);
        console.log("Sample products:", sampleProducts);
        return { totalProducts, sampleProducts };
      },

});