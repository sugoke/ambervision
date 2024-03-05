import { Meteor } from 'meteor/meteor';

// /server/main.js
import '/imports/api/products/server/publications.js';

import '/server/methods/updateProducts.js';


import { Products } from '/imports/api/products/products.js';


// Server side
Meteor.publish('productByISIN', function(ISINCode) {
  return Products.find({"genericInformation.ISINCode": ISINCode});
});
