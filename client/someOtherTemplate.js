import { globalLoading } from './mainlayout.js';

Template.someOtherTemplate.onCreated(function() {
  this.autorun(() => {
    // Set loading while waiting for data
    globalLoading.set(true);
    
    const subsReady = Iron.controller()?.ready() ?? false;
    const data = Collection.find().fetch();
    
    if (subsReady && data) {
      Meteor.setTimeout(() => {
        globalLoading.set(false);
      }, 100);
    }
  });
});

Template.someOtherTemplate.onDestroyed(function() {
  globalLoading.set(true);
}); 