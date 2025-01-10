import { Meteor } from 'meteor/meteor';

Meteor.startup(async () => {
  try {
    console.log('Starting initial news fetch...');
    await Meteor.call('news.refresh');
    console.log('Initial news fetch completed');
    
    // Refresh news every 6 hours
    Meteor.setInterval(async () => {
      console.log('Running scheduled news refresh...');
      await Meteor.call('news.refresh');
    }, 6 * 60 * 60 * 1000);
  } catch (error) {
    console.error('Error during news refresh:', error);
  }
}); 