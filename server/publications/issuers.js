import { Meteor } from 'meteor/meteor';
import { Issuers } from '/imports/api/issuers/issuers.js';

Meteor.publish('issuers', function() {
  const user = Meteor.users.findOne(this.userId);
  if (!user || user.profile?.role !== 'superAdmin') {
    return this.ready();
  }
  return Issuers.find();
}); 