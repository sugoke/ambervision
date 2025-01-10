import { Meteor } from 'meteor/meteor';
import { Products, Risk } from '/imports/api/products/products.js';

Meteor.methods({
  'risk'() {
    console.log('Risk calculation method called');

    const products = Products.find({ status: 'live' }).fetch();
    console.log(`Found ${products.length} live products`);

    // Clear the Risk collection before inserting new records
    Risk.remove({});
    console.log('Cleared existing risk records');

    let updatedRiskRecords = [];

    products.forEach((product, index) => {
      const ISINCode = product.genericData.ISINCode;
      const maturityDate = product.genericData.maturityDate;
      const template = product.genericData.template;
      const underlyings = product.underlyings || [];
      const finalObservationDate = product.genericData.finalObservation;

      console.log(`Processing product ${index + 1}/${products.length}: ${ISINCode}`);

      underlyings.forEach(underlying => {
        console.log(`Processing underlying for ${ISINCode}:`, underlying);
        try {
          const riskRecord = {
            ISINCode,
            underlyingName: underlying.name,
            underlyingEodticker: underlying.eodTicker,
            maturityDate,
            finalObservationDate,
            performance: underlying.lastPriceInfo.performance,
            distanceToBarrier: underlying.lastPriceInfo.distanceToBarrier === 0 ? '-' : underlying.lastPriceInfo.distanceToBarrier,
            template
          };
          
          console.log(`Risk record for ${ISINCode}, ${underlying.name}:`, riskRecord);

          // Insert new record (no need to check for existing records)
          const insertedId = Risk.insert(riskRecord);
          updatedRiskRecords.push({ ...riskRecord, _id: insertedId, updated: false });
        } catch (error) {
          console.error(`Error creating risk record for ${ISINCode}, underlying ${underlying.name}:`, error);
        }
      });
    });

    console.log(`Risk method completed. Created ${updatedRiskRecords.length} risk records.`);
    return {
      summary: `Processed ${products.length} products, created ${updatedRiskRecords.length} risk records`,
      productsProcessed: products.length,
      riskRecordsCreated: updatedRiskRecords.length,
      createdRecords: updatedRiskRecords
    };
  }
});



