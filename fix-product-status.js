import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';

/**
 * Fix product status by regenerating template reports
 * This will update the productStatus field based on maturity dates
 */

Meteor.startup(async () => {
  console.log('🔧 Starting product status fix...');

  try {
    // Get the Himalaya product
    const productId = 'uoeQ5wnQs7p6JaHKt';
    const product = await ProductsCollection.findOneAsync({ _id: productId });

    if (!product) {
      console.error('❌ Product not found:', productId);
      return;
    }

    console.log('📊 Product found:', {
      _id: product._id,
      title: product.title,
      maturity: product.maturity,
      currentStatus: product.productStatus,
      currentStatusField: product.status
    });

    // Get a valid session ID
    const { SessionsCollection } = await import('/imports/api/sessions');
    const activeSession = await SessionsCollection.findOneAsync(
      { isActive: true },
      { sort: { createdAt: -1 } }
    );

    if (!activeSession) {
      console.error('❌ No active session found');
      return;
    }

    console.log('🔑 Using session:', activeSession._id);

    // Trigger report regeneration
    console.log('📝 Generating template report...');
    const reportId = await Meteor.callAsync('templateReports.create', product, activeSession._id);

    console.log('✅ Report generated:', reportId);

    // Check updated product status
    const updatedProduct = await ProductsCollection.findOneAsync({ _id: productId });
    console.log('📊 Updated product status:', {
      _id: updatedProduct._id,
      title: updatedProduct.title,
      productStatus: updatedProduct.productStatus,
      statusDetails: updatedProduct.statusDetails,
      lastEvaluationDate: updatedProduct.lastEvaluationDate
    });

    console.log('✅ Product status fix completed!');
  } catch (error) {
    console.error('❌ Error fixing product status:', error);
  }
});
