// Importing products.html into products.js
import '../html/products.html';


import { Products } from '/imports/api/products/products.js';

Template.products.helpers({

  product_list: function() {


return Products.find().fetch()

  },


});
