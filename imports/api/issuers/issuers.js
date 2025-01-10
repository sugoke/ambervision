import { Mongo } from 'meteor/mongo';
import { Meteor } from 'meteor/meteor';

export const Issuers = new Mongo.Collection('issuers');

if (Meteor.isServer) {
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