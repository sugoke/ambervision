import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const Issuers = new Mongo.Collection('issuers');

// Ensure index on name field
if (Meteor.isServer) {
  Issuers._ensureIndex({ name: 1 });

  Issuers.allow({
    insert(userId, doc) {
      const user = Meteor.users.findOne(userId);
      return user && user.profile?.role === 'superAdmin';
    },
    update(userId, doc) {
      const user = Meteor.users.findOne(userId);
      return user && user.profile?.role === 'superAdmin';
    },
    remove(userId, doc) {
      const user = Meteor.users.findOne(userId);
      return user && user.profile?.role === 'superAdmin';
    }
  });
} 