// Fix Shark Note Product Structure
// Run this in Meteor shell or MongoDB console

// Update the product with correct Shark Note parameters
db.products.updateOne(
  { _id: "uJcKm9Gicjm9iWJEz" },
  {
    $set: {
      templateId: "shark_note",
      template: "shark_note",
      structureParams: {
        upperBarrier: 140,           // 140% knock-out barrier
        rebateValue: 10,             // 10% fixed rebate if touched
        floorLevel: 90,              // 90% minimum redemption
        referencePerformance: "worst-of"  // Basket calculation
      },
      // Remove observation schedule (not needed for Shark Note)
      observationSchedule: []
    }
  }
);

// Then regenerate the report by calling:
// Meteor.call('templateReports.create', productData, sessionId);

console.log('Product updated. Now regenerate the report through the UI.');
