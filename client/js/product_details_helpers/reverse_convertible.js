Template.product_details_reverse_convertible.helpers({

    current_product: function () {


        return Products.findOne({isin_input: 'XS6546546546'});
    },


});
