import { Meteor } from 'meteor/meteor';

// /server/main.js
import '/imports/api/products/server/publications.js';

import '/server/methods/updateProducts.js';


import { Products } from '/imports/api/products/products.js';




Meteor.startup(() => {
  // code to run on server at startup




});
