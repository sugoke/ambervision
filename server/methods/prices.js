import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Prices } from '/imports/api/products/products.js';

Meteor.methods({
  'updatePrices'(pricesData) {
    check(pricesData, Array);

    // Ensure user is logged in and is superAdmin
    const user = Meteor.users.findOne(this.userId);
    if (!user || user.role !== 'superAdmin') {
      throw new Meteor.Error('not-authorized', 'Only superAdmin can update prices');
    }

    let updateCount = 0;
    pricesData.forEach(row => {
      // Skip rows with empty ISIN or invalid bid
      if (!row.isin || row.bid === 'unknown security') {
        return;
      }

      Prices.upsert(
        { isin: row.isin },
        { 
          $set: { 
            bid: parseFloat(row.bid),
            lastUpdated: new Date()
          }
        }
      );
      updateCount++;
    });

    return { updated: updateCount };
  }
}); 