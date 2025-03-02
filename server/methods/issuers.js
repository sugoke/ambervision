import { Meteor } from 'meteor/meteor';
import { check } from 'meteor/check';
import { Issuers } from '/imports/api/issuers/issuers.js';

const ISSUERS_CACHE = new Map();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

Meteor.methods({
  'addIssuer'(name) {
    check(name, String);
    
    const user = Meteor.users.findOne(this.userId);
    if (!user || user.profile?.role !== 'superAdmin') {
      throw new Meteor.Error('not-authorized', 'Only superAdmin can manage issuers');
    }

    return Issuers.insert({
      name,
      createdAt: new Date(),
      createdBy: this.userId
    });
  },

  'deleteIssuer'(issuerId) {
    check(issuerId, String);
    
    const user = Meteor.users.findOne(this.userId);
    if (!user || user.profile?.role !== 'superAdmin') {
      throw new Meteor.Error('not-authorized', 'Only superAdmin can manage issuers');
    }

    return Issuers.remove(issuerId);
  },

  'updateIssuer'(issuerId, name) {
    check(issuerId, String);
    check(name, String);
    
    const user = Meteor.users.findOne(this.userId);
    if (!user || user.profile?.role !== 'superAdmin') {
      throw new Meteor.Error('not-authorized', 'Only superAdmin can manage issuers');
    }

    return Issuers.update(issuerId, {
      $set: {
        name,
        updatedAt: new Date(),
        updatedBy: this.userId
      }
    });
  },

  getIssuers() {
    // Return only necessary fields
    return Issuers.find({}, {
      fields: {
        _id: 1,
        name: 1
      },
      sort: { name: 1 }
    }).fetch();
  }
}); 