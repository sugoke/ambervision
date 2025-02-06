import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { Products, Holdings, Schedules, Risk, Historical } from '/imports/api/products/products.js';

// Products publications
Meteor.publish('tabular_products', function() {
  if (!this.userId) {
    return this.ready();
  }
  return Products.find({}, { fields: { chart100: 0 } });
});

Meteor.publish('productDetails', function(isin) {
  console.log('Publishing productDetails for ISIN:', isin);
  
  if (!this.userId) {
    console.log('User not logged in, stopping publication');
    return this.ready();
  }

  if (!isin) {
    console.log('No ISIN provided, stopping publication');
    return this.ready();
  }

  const query = { 'genericData.ISINCode': isin };
  console.log('Publication query:', query);
  const product = Products.find(query, {
    fields: {
      "genericData.ISINCode": 1,
      "genericData.currency": 1,
      "genericData.settlementType": 1,
      "genericData.settlementTx": 1,
      "genericData.tradeDate": 1,
      "genericData.paymentDate": 1,
      "genericData.finalObservation": 1,
      "genericData.maturityDate": 1,
      "genericData.valoren": 1,
      "genericData.name": 1,
      "genericData.issuer": 1,
      "genericData.template": 1,
      features: 1,
      underlyings: 1,
      observationDates: 1,
      chartOptions: 1,
      pnl: 1,
      redemptionIfToday: 1,
      autocallDate: 1,
      autocalled: 1,
      capitalRedemption: 1,
    },
    transform: function(doc) {
      if (doc.redemptionIfToday === undefined) {
        doc.redemptionIfToday = 100;
      }
      if (!Array.isArray(doc.observationDates)) {
        doc.observationDates = [];
      }
      if (doc.totalCouponPaid === undefined) {
        doc.totalCouponPaid = 0;
      }
      return doc;
    }
  });
  console.log('Found product:', product.fetch()[0] ? 'yes' : 'no');
  return product;
});

Meteor.publish('clientFilteredProducts', function(userId) {
  check(userId, Match.Maybe(String));
  if (!this.userId) return this.ready();

  const currentUser = Meteor.users.findOne(this.userId);
  const isSuperAdmin = currentUser?.profile?.role === 'superAdmin';

  // SuperAdmin with no userId - publish all
  if (isSuperAdmin && !userId) {
    return [
      Holdings.find({}),
      Products.find({}, { fields: { chart100: 0 } }),
      Schedules.find({}, {
        transform: function(doc) {
          // If no specific events, gather all events from all schedules
          if (!doc.events || doc.events.length === 0) {
            const allEvents = Schedules.find({})
              .fetch()
              .reduce((acc, schedule) => {
                if (schedule.events && Array.isArray(schedule.events)) {
                  return acc.concat(schedule.events);
                }
                return acc;
              }, []);
            doc.events = allEvents;
          }
          return doc;
        }
      }),
      Risk.find({}),
      Historical.find({})
    ];
  }

  // Get holdings for specific user or current user
  const targetUserId = userId || this.userId;
  const holdings = Holdings.find({ userId: targetUserId });
  const holdingIsins = holdings.fetch().map(h => h.isin);
  const productIds = holdings.fetch().map(h => h.productId);

  return [
    holdings,
    Products.find({ _id: { $in: productIds }}, { fields: { chart100: 0 } }),
    Schedules.find({ userId: targetUserId }),
    Risk.find({ ISINCode: { $in: holdingIsins } }),
    Historical.find({ ISINCode: { $in: holdingIsins } })
  ];
});

// Users publications
Meteor.publish('allUsers', function() {
  if (this.userId && Meteor.users.findOne(this.userId)?.profile?.role === 'superAdmin') {
    return Meteor.users.find({}, { 
      fields: { 
        username: 1,
        'profile.role': 1,
        'profile.bankAccounts': 1,
        createdAt: 1
      } 
    });
  }
  return this.ready();
});

Meteor.publish('singleUser', function(userId) {
  check(userId, String);
  
  return Meteor.users.find({ _id: userId }, {
    fields: {
      username: 1,
      'profile.role': 1,
      'profile.bankAccounts': 1
    }
  });
});
