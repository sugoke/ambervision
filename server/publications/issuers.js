// Issuers Publications
// Handles all issuer-related publications

import { IssuersCollection } from '/imports/api/issuers';
import { UsersCollection, USER_ROLES } from '/imports/api/users';

// Publish issuers for general use
Meteor.publish("issuers", function () {
  return IssuersCollection.find({ active: true }, { sort: { name: 1 } });
});

// Publish all issuers for management (admin only)
Meteor.publish("issuersManagement", async function () {
  const user = await UsersCollection.findOneAsync(this.userId);
  if (!user || (user.role !== USER_ROLES.ADMIN && user.role !== USER_ROLES.SUPERADMIN)) {
    return this.ready();
  }
  return IssuersCollection.find({}, { sort: { name: 1 } });
});






