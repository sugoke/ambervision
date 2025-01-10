import '../html/productDetails.html';
import { Products } from '/imports/api/products/products.js';
import moment from 'moment';

import '../html/templates/orion.html';
import '../html/templates/phoenix.html';
import '../html/templates/twinWin.html';

// Register Handlebars helpers
Handlebars.registerHelper('eq', function(a, b) {
  return a === b;
});

Handlebars.registerHelper('isNegative', function(value) {
  return value < 0;
});

Handlebars.registerHelper('formatPercentage', function(value) {
  if (typeof value === 'number') {
    return value.toFixed(2);
  }
  return value;
});

Handlebars.registerHelper('formatDate', function(date) {
  if (date) {
    return moment(date).format('DD/MM/YYYY');
  }
  return '';
});

Handlebars.registerHelper('inc', function(index) {
  return index + 1;
});

Template.productDetails.onCreated(function() {
  console.log('productDetails template created');
  this.getIsin = () => {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('isin');
  };

  this.autorun(() => {
    const isin = this.getIsin();
    console.log('Autorun - ISIN:', isin);
    
    if (isin) {
      console.log('Subscribing to productDetails with ISIN:', isin);
      const handle = this.subscribe('productDetails', isin);
      
      if (handle.ready()) {
        console.log('Subscription ready');
        const product = Products.findOne({ 'genericData.ISINCode': isin });
        console.log('Product found:', product ? 'yes' : 'no');
      } else {
        console.log('Subscription not ready');
      }
    } else {
      console.warn('No ISIN available');
    }
  });
});

Template.productDetails.helpers({
  productDetails() {
    const isin = Template.instance().getIsin();
    console.log('Helper productDetails - ISIN:', isin);
    
    if (!isin) {
      console.warn('No ISIN in helper');
      return null;
    }

    const product = Products.findOne({ 'genericData.ISINCode': isin });
    console.log('Helper productDetails - Product found:', product ? 'yes' : 'no');
    
    if (product && !product.genericData?.ISINCode) {
      product.genericData = product.genericData || {};
      product.genericData.ISINCode = isin;
    }
    
    return product;
  },

  isTemplate(templateName) {
    const productDetails = Template.currentData();
    console.log('Helper isTemplate -', templateName, ':', productDetails?.genericData?.template === templateName);
    return productDetails && 
           productDetails.genericData && 
           productDetails.genericData.template === templateName;
  }
});
