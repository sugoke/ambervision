// Importing products.html into products.js
import '../html/productDetails.html';


import {
  Products
} from '/imports/api/products/products.js';

Template.productDetails.onCreated(function() {
  // Extract ISIN code from the URL
  const urlParams = new URLSearchParams(window.location.search);
  const isin = urlParams.get('isin');

  // Store the ISIN code in the session
  Session.set('currentISIN', isin);
});

Template.productDetails.helpers({
  productDetails: function() {
    // Retrieve the ISIN from the session
    const isin = Session.get('currentISIN');

    // Find the product document by its ISIN
    const product = Products.findOne({
      'genericInformation.ISINCode': isin
    });

    // If the product has underlyings, transform them into an array for easier template iteration
    if (product && product.underlyings) {
      product.underlyingsArray = Object.entries(product.underlyings).map(([key, value]) => ({
        ticker: key,
        ...value
      }));
    }

    return product;
  },

  observations: function() {
    // Retrieve the ISIN from the session
    const isin = Session.get('currentISIN');

    // Use the ISIN to find the product and log its observations for debugging
    const product = Products.findOne({
      'genericInformation.ISINCode': isin
    });

    console.log(product?.observations);

    // Return the observations
    return product?.observations;
  }
});



Template.productDetails.events({
  'click #editProduct'(event, instance) {
    // Prevent the default button action
    event.preventDefault();

    // Retrieve the ISIN code from the session
    const isin = Session.get('currentISIN');
    if (isin) {
      // Construct the URL with the mode and ISIN code as query parameters
      const url = `/editProduct?mode=editProduct&ISINCode=${isin}`;
      // Redirect to the constructed URL
      window.location.href = url;
    } else {
      console.log('ISIN code is not available.');
    }
  }
});
