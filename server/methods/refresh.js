import { Meteor } from 'meteor/meteor';
import { Products } from '/imports/api/products/products.js';
import { processPhoenixProduct } from './templates/phoenix.js';
import { processOrionProduct } from './templates/orion.js';
import { processTwinWinProduct } from './templates/twinWin.js';

Meteor.methods({
  process() {
    console.log('Starting product processing');
    const allProducts = Products.find({ /* 'genericData.ISINCode': "CH1279850411"  */ }).fetch();
    console.log(`Found ${allProducts.length} products to process`);

    let processedProducts = [];

    allProducts.forEach((product, index) => {
      console.log(`Processing product ${index + 1} of ${allProducts.length}`);
      if (product.genericData && product.genericData.template === "phoenix") {
        console.log('Processing Phoenix product');
        const result = processPhoenixProduct(product);
        processedProducts.push(result);
      } else if (product.genericData && product.genericData.template === "orion") {
        console.log('Processing Orion product');
        processOrionProduct(product);
      } else if (product.genericData && product.genericData.template === "twinWin") {
        console.log('Processing TwinWin product');
        const result = processTwinWinProduct(product);
        processedProducts.push(result);
      } else {
        console.log(`Unknown template for product ${product._id}`);
      }
    });

    console.log(`Processed ${processedProducts.length} products successfully`);
    return processedProducts;
  }
});