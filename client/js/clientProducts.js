import { Template } from 'meteor/templating';
import { Products, Holdings, Prices } from '/imports/api/products/products.js';
import '../html/clientProducts.html';

Template.clientProducts.helpers({
  user() {
    return Template.currentData().user;
  },
  userProducts() {
    return Template.currentData().userProducts;
  },
  quantityForThisHolding(productId) {
    const userId = Template.currentData().user._id;
    const holding = Holdings.findOne({ 
      userId: userId,
      productId: productId 
    });
    return holding?.quantity?.toLocaleString() || 0;
  },
  purchasePriceForThisHolding(productId) {
    const userId = Template.currentData().user._id;
    const holding = Holdings.findOne({ 
      userId: userId,
      productId: productId 
    });
    return holding?.purchasePrice?.toLocaleString() || 0;
  },
  currentPrice(isin) {
    const price = Prices.findOne({ isin: isin });
    return price?.bid?.toLocaleString() || '-';
  }
}); 