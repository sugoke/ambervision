import { Meteor } from 'meteor/meteor';
import { check, Match } from 'meteor/check';
import { Products, Holdings, Schedules, Risk, Historical } from '/imports/api/products/products.js';

// Products publications
Meteor.publish('tabular_products', function() {
  if (!this.userId) {
    return this.ready();
  }
  return Products.find();
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
  
  const product = Products.find(query);
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
      Products.find({}),
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
    Products.find({ _id: { $in: productIds } }),
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
