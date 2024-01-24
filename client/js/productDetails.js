// Importing products.html into products.js
import '../html/productDetails.html';


import { Products } from '/imports/api/products/products.js';

Template.productDetails.helpers({

  productDetails: function() {
 const isin = Session.get('currentISIN');

    console.log(Products.findOne({ isin: isin }))

    return Products.findOne({ isin: isin });


  }
});
