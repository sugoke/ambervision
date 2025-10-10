import { Meteor } from 'meteor/meteor';
import { ProductsCollection } from '/imports/api/products';
import { TemplateReportsCollection } from '/imports/api/templateReports';

/**
 * Debug product status fields
 */

Meteor.startup(async () => {
  console.log('🔍 Debugging product status fields...\n');

  try {
    // Check the Himalaya product
    const productId = 'uoeQ5wnQs7p6JaHKt';
    const product = await ProductsCollection.findOneAsync({ _id: productId });

    if (!product) {
      console.error('❌ Product not found:', productId);
      return;
    }

    console.log('📊 PRODUCT DOCUMENT:');
    console.log('  _id:', product._id);
    console.log('  title:', product.title);
    console.log('  maturity:', product.maturity);
    console.log('  productStatus:', product.productStatus);
    console.log('  status:', product.status);
    console.log('  statusDetails:', product.statusDetails);
    console.log('  lastEvaluationDate:', product.lastEvaluationDate);
    console.log('  updatedAt:', product.updatedAt);
    console.log('  updatedBy:', product.updatedBy);

    // Check the latest report
    const report = await TemplateReportsCollection.findOneAsync(
      { productId: productId },
      { sort: { createdAt: -1 } }
    );

    if (report) {
      console.log('\n📝 LATEST REPORT:');
      console.log('  _id:', report._id);
      console.log('  createdAt:', report.createdAt);
      console.log('  templateResults.currentStatus:', report.templateResults?.currentStatus);
      console.log('  productStatus from report:', report.templateResults?.currentStatus?.productStatus);
      console.log('  hasMatured from report:', report.templateResults?.currentStatus?.hasMatured);
    } else {
      console.log('\n❌ No report found');
    }

    // Check all products to see how many have status set
    const allProducts = await ProductsCollection.find({}).fetchAsync();
    const withStatus = allProducts.filter(p => p.productStatus);
    const withoutStatus = allProducts.filter(p => !p.productStatus);

    console.log('\n📊 ALL PRODUCTS SUMMARY:');
    console.log('  Total products:', allProducts.length);
    console.log('  With productStatus field:', withStatus.length);
    console.log('  Without productStatus field:', withoutStatus.length);

    if (withStatus.length > 0) {
      console.log('\n  Products with status:');
      withStatus.forEach(p => {
        console.log(`    - ${p.title || p._id}: ${p.productStatus} (maturity: ${p.maturity})`);
      });
    }

    console.log('\n✅ Debug completed!');
  } catch (error) {
    console.error('❌ Error:', error);
  }
});
