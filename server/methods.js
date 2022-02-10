Meteor.methods({

  'insert_product'(summary) {

    Products.insert(summary);

  }
});
