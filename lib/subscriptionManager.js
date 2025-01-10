import { Tracker } from 'meteor/tracker';

export const SubscriptionManager = {
  init() {
    Tracker.autorun(() => {
      const user = Meteor.user();
      const selectedClientId = Session.get('selectedClientId');

      if (!user) return;

      const isSuperAdmin = user?.profile?.role === 'superAdmin';
      
      if (isSuperAdmin && !selectedClientId) {
        Meteor.subscribe('clientFilteredProducts', null);
      } else {
        Meteor.subscribe('clientFilteredProducts', selectedClientId || user._id);
      }
    });
  }
};
