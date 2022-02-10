Template.product_details_reverse_convertible.helpers({

    current_product: function () {


        return Products.findOne({isin_input: 'xs0989087987'});
    },


});
