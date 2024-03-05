import { Meteor } from 'meteor/meteor';

// /server/main.js
import '/imports/api/products/server/publications.js';

import '/server/methods/updateProducts.js';


import { Products } from '/imports/api/products/products.js';




Meteor.startup(() => {
  if (Products.find().count() === 0) {
    Products.insert({
      genericInformation: {
        name: "Structured Product Name",
        ISINCode: "ISIN12345678",
        productLive: true,
        bidPrice: 100.00,
        currency: "USD",
        nominal: 1000,
        issuer: "Issuer Name",
        tradeDate: new Date("2024-01-01"),
        issueDate: new Date("2024-01-15"),
        finalObservation: new Date("2029-01-01"),
        maturity: new Date("2029-01-15"),
        settlementType: "Cash"
      },
      specificInfo: {
        couponAmount: 5.00,
        protectionBarrier: 80.00,
        couponBarrier: 95.00
      },
      underlyings: {
        Tesla: {
          strike: 700.00,
          ticker: "TSLA"
        },
        Microsoft: {
          strike: 250.00,
          ticker: "MSFT"
        },
        Nvidia: {
          strike: 150.00,
          ticker: "NVDA"
        }
      }
    });
  }
});
